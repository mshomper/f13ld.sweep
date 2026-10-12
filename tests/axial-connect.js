// v0.32.0 — the stiffness connectivity gate and anisotropy, without a browser.
//
//   node tests/axial-connect.js
//
// 1. computeSolidPercolation on synthetic cells: an axis connects only when a
//    piece reaches its own copy STRAIGHT along it (tilted sheets and diagonal
//    fibres used to read connected on every axis they touch).
// 2. Tilted sheets through the CPU solver: x and y are not solved, so the
//    anisotropy is no longer stiff ÷ pore floor = 99.
// 3. finishDesign: a solved axis that read 0 and an axis at the pore-material
//    level stay out of the anisotropy, and the void-level axis is named in
//    the flag reasons.
// Node built-ins only. Exit 1 on any failure. A few seconds.
'use strict';
const fs = require('fs'), path = require('path');
const { DIRS, context, load, run } = require('./parity/lib/env.js');

const ctx = context({ self: {} });
load(ctx, DIRS.sweep, ['geom/tpms.js', 'geom/noise.js', 'geom/grain.js', 'geom/beam.js', 'geom/foam.js', 'geom/wave.js', 'geom/voxels.js', 'geom/recipe.js',
  'families/fam-index.js', 'families/fam-tpms.js', 'families/fam-noise.js', 'families/fam-grain.js', 'families/fam-beam.js', 'families/fam-foam.js', 'families/fam-wave.js',
  '40-design.js', '41-density.js', '42-fft.js', '43-elastic-solver.js', '44-solver-config.js', '45-homogenize.js', '50-hires-field.js',
  '51-transport.js', '52-geometry-metrics.js', '53-pores.js', '54-estimate.js', 'solver/lab/14a-connectivity.js']);
ctx.__gyroid = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'))['tpms-gyroid-sheet'].recipe;

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };

/* 1 — synthetic cells (N = 32; index i·N² + j·N + k, i = x) */
const cells = run(ctx, `(() => {
  const N = 32, P = Math.PI * 2 / N;
  const mk = fn => { const m = new Float32Array(N * N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) m[i * N * N + j * N + k] = fn(i, j, k) ? 1 : 0;
    return m; };
  const d = (a, b) => Math.min((a - b + N) % N, (b - a + N) % N);
  const cases = {
    'sheets tilted 45 deg (normal 1,1,0)': [mk((i, j) => ((i + j) % 16) < 3), '001'],
    'fibres along the cube diagonal':      [mk((i, j, k) => d(i, j) < 2 && d(i, k) < 2), '000'],
    'gyroid sheet':                        [mk((i, j, k) => Math.abs(Math.sin(i * P) * Math.cos(j * P) + Math.sin(j * P) * Math.cos(k * P) + Math.sin(k * P) * Math.cos(i * P)) < 0.3), '111'],
    'z fibres (bundle)':                   [mk((i, j) => Math.hypot(i - 8, j - 8) < 3), '001'],
    'plates normal to x':                  [mk(i => i < 4), '011'],
    'zigzag strut along x':                [mk((i, j, k) => Math.abs(j - ((i < 16 ? i : 32 - i) / 2 + 4)) < 2 && k < 4), '100'],
    'x fibre crossing a tilted fibre':     [mk((i, j, k) => (Math.abs(j - 8) < 2 && Math.abs(k - 8) < 2) || (((i - j + N) % N) < 3 && Math.abs(k - 8) < 2)), '110'],
    'floating sphere':                     [mk((i, j, k) => Math.hypot(i - 16, j - 16, k - 16) < 8), '000'],
  };
  const out = {};
  for (const n in cases) { const p = computeSolidPercolation(cases[n][0], N);
    out[n] = { got: '' + p.connect_x + p.connect_y + p.connect_z, want: cases[n][1], shear: '' + p.shear_yz + p.shear_xz + p.shear_xy }; }
  return out;
})()`);
for (const n in cells) check(`connect x,y,z  ${n}`, cells[n].got === cells[n].want, `got ${cells[n].got} want ${cells[n].want} (shear yz,xz,xy ${cells[n].shear})`);
/* tilted sheets still carry in-plane shear: the shear gates keep any reach */
check('tilted sheets keep their shear gates', cells['sheets tilted 45 deg (normal 1,1,0)'].shear === '111');

/* 2 — tilted sheets through the CPU solver (N = 16) */
const tilt = run(ctx, `(() => {
  const N = 16, s = new Float32Array(N * N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) s[i * N * N + j * N + k] = ((i + j) % 8) < 3 ? 1 : 0;
  const p = computeSolidPercolation(s, N), c = { x: !!p.connect_x, y: !!p.connect_y, z: !!p.connect_z };
  const f = fftHomogenize(s, N, 'tpms-solid', 110, 0.3, c, 1e-3, 300, true);
  return { E: [f.Ex, f.Ey, f.Ez], validity: f.solver_validity };
})()`);
check('tilted sheets: x and y not solved, z carries load', tilt.E[0] === 0 && tilt.E[1] === 0 && tilt.E[2] > 1,
  `E = ${tilt.E.map(v => +v.toPrecision(3)).join(', ')} GPa, ${tilt.validity}`);

/* 3 — finishDesign's anisotropy on a real prepared design with made-up solves */
const fin = run(ctx, `(() => {
  const o = { Es: 110, nu: 0.3, ks: 1, sigma_ref: 0.011, voxelToUm: 62.5, gridN: 16, contrast: 1e-3, maxiter: 300 };
  const P = prepareDesign(completeRecipe(__gyroid), o);
  const S = (E, vr) => ({ Ex: E[0], Ey: E[1], Ez: E[2], cg_iters: 1, cg_converged: true, solver_validity: 'valid', kx: 1, ky: 1, kz: 1, ks_val: 1, voidRatio: vr });
  const pick = h => ({ aniso: h.anisotropy, why: h.stiffness_flag_reasons || '' });
  return {
    rho: P.rho,
    normal:  pick(finishDesign(P, S([10, 5, 5], 1e-3), o)),
    failed:  pick(finishDesign(P, S([10, 5, 0], 1e-3), o)),
    voidLvl: pick(finishDesign(P, S([10, 5, 0.06], 1e-3), o)),
    gated:   pick(finishDesign(Object.assign({}, P, { connectGate: Object.assign({}, P.connectGate, { z: false }) }), S([10, 5, 0.06], 1e-3), o)),
  };
})()`);
check('anisotropy over three load-bearing axes', fin.normal.aniso === 2, `got ${fin.normal.aniso}`);
check('a solve that read 0 is left out (not 99)', fin.failed.aniso === 2, `got ${fin.failed.aniso}`);
check('a pore-level axis is left out (not 99)', fin.voidLvl.aniso === 2, `got ${fin.voidLvl.aniso}`);
check('the pore-level axis is named in the flag reasons', /no real load path on z/.test(fin.voidLvl.why), fin.voidLvl.why);
check('an axis the gate skipped is left out', fin.gated.aniso === 2, `got ${fin.gated.aniso}`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
