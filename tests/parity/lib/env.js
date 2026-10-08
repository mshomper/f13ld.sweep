// Shared helpers for the parity test: repo locations, vm loading, voxel grids, comparisons.
// Node built-ins only.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SWEEP = path.resolve(__dirname, '..', '..', '..');
const sib = name => path.resolve(SWEEP, '..', name);
const DIRS = {
  sweep: SWEEP,
  lab:   path.resolve(process.env.LAB_DIR   || sib('f13ld.lab')),
  mesh:  path.resolve(process.env.MESH_DIR  || sib('f13ld.mesh')),
  tpms:  path.resolve(process.env.TPMS_DIR  || sib('f13ld.tpms')),
  noise: path.resolve(process.env.NOISE_DIR || sib('f13ld.noise')),
  grain: path.resolve(process.env.GRAIN_DIR || sib('f13ld.grain')),
  beam:  path.resolve(process.env.BEAM_DIR  || sib('f13ld.beam')),
};

const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const quietConsole = { log() {}, info() {}, warn() {}, debug() {}, error() {} };

/* A fresh vm context. Built-ins (Math, JSON, typed arrays …) are the context's
   own, so seeding Math.random inside it never touches the host. */
function context(extra) {
  return vm.createContext(Object.assign({ console: quietConsole, performance: { now: () => 0 },
    setTimeout, clearTimeout }, extra || {}));
}
function load(ctx, dir, files) {
  for (const f of files) vm.runInContext(read(dir, f), ctx, { filename: path.join(dir, f) });
  return ctx;
}
const run = (ctx, src) => vm.runInContext(src, ctx);

/* A minimal DOM element stub for files that touch the DOM at load. */
function elStub() {
  return { style: {}, value: '', textContent: '', innerHTML: '', disabled: false, children: [], dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, remove() {} };
}

/* Deterministic PRNG (mulberry32, standard form) for the host side. */
function prng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }

/* N³ voxel-centre grid over solver coords [-π,π]³, index i·N²+j·N+k (x outer). */
function grid(N, inside) {
  const st = 2 * Math.PI / N, out = new Uint8Array(N * N * N);
  const c = new Float64Array(N); for (let i = 0; i < N; i++) c[i] = -Math.PI + (i + 0.5) * st;
  let n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) out[n++] = inside(c[i], c[j], c[k]) ? 1 : 0;
  return out;
}
function toBits(m) { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] > 0.5 ? 1 : 0; return o; }
function vf(m) { let s = 0; for (let i = 0; i < m.length; i++) s += m[i]; return s / m.length; }
function diff(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
const clone = o => JSON.parse(JSON.stringify(o));

module.exports = { DIRS, read, context, load, run, elStub, quietConsole, prng, hashStr, grid, toBits, vf, diff, clone };
