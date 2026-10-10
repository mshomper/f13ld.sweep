// F13LD.sweep side: the real geometry path, loaded into ONE vm context.
//   completed = completeRecipe(json); geo = designGeometry(completed); mask = designVoxels(geo, N)
// and the family jitter that turns a base recipe into a design recipe.
'use strict';
const { DIRS, context, load, run, toBits } = require('./env');

const FILES = ['geom/tpms.js', 'geom/noise.js', 'geom/grain.js', 'geom/beam.js', 'geom/foam.js', 'geom/wave.js', 'geom/voxels.js', 'geom/recipe.js',
  'families/fam-index.js', 'families/fam-tpms.js', 'families/fam-noise.js', 'families/fam-grain.js', 'families/fam-beam.js',
  'families/fam-foam.js', 'families/fam-wave.js', '40-design.js'];

const ctx = load(context(), DIRS.sweep, FILES);
run(ctx, `
  var __mul = function (seed) { var s = seed >>> 0; return function () {
    s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  function __seedRandom(seed) { Math.random = __mul(seed); }
  function __complete(s) { return JSON.stringify(completeRecipe(JSON.parse(s))); }
  function __voxels(s, N) {
    var geo = designGeometry(JSON.parse(s));
    return { mask: designVoxels(geo, N), mode: geo.mode, family: geo.family };
  }
  function __baseMode(s) { return designGeometry(JSON.parse(s)).mode; }
  function __nominal(f, s) { return SWEEP_FAMILIES[f].nominalScale(JSON.parse(s)); }
  function __uses(f) { return !!SWEEP_FAMILIES[f].usesCellScale; }
  /* draws: one design's quasi-random sample, draw.u(i) = draws[i] (as the Sobol sampler) */
  function __jitter(f, baseCompletedStr, draws, ctxObj, randSeed) {
    __seedRandom(randSeed);
    var base = JSON.parse(baseCompletedStr);
    var draw = { u: function (i) { if (!(i in draws)) throw new Error('draw.u(' + i + ') out of range'); return draws[i]; } };
    var c = JSON.parse(ctxObj);
    /* v0.29.0 — the v0.26 jitter reads its draws through ctx.u() and ctx.rand (as runSweep) */
    var next = c.scale ? 4 : 1;
    c.u = function () { return draw.u(next++); };
    c.rand = Math.random;
    return JSON.stringify(SWEEP_FAMILIES[f].jitter(base, draw, c));
  }
`);

module.exports = {
  ctx,
  complete: json => JSON.parse(ctx.__complete(JSON.stringify(json))),
  /* mask of a COMPLETED recipe (designGeometry → designVoxels) */
  voxels(completed, N) { const r = ctx.__voxels(JSON.stringify(completed), N); return { mask: toBits(r.mask), mode: r.mode }; },
  baseMode: completed => ctx.__baseMode(JSON.stringify(completed)),
  nominalScale: (f, completed) => ctx.__nominal(f, JSON.stringify(completed)),
  usesCellScale: f => ctx.__uses(f),
  jitter: (f, completedBase, draws, jctx, randSeed) =>
    JSON.parse(ctx.__jitter(f, JSON.stringify(completedBase), draws, JSON.stringify(jctx), randSeed)),
};
