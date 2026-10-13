// v0.33.0 — the principal-curvature profile, without a browser.
//
//   node tests/curvature.js
//
// 1. Calibration on shapes with known curvature (computeCurvatureMetrics with
//    the crossing hook → computeCurvatureProfile, on the CURV_N curvature grid):
//    a ball and a pore of radius R (κ̃ = ±2π/R), a rod (κ₂ = 0) and a channel,
//    the gyroid network and sheet (saddle everywhere), and the Gauss–Bonnet
//    check passing on all of them and failing on a sharp-noded beam lattice.
// 2. Real recipes through prepareDesign + finishDesign: every family gets the
//    curv_* fields measured on the fixed grid, whatever the solver grid.
// Node built-ins only. Exit 1 on any failure. Under a minute.
'use strict';
const fs = require('fs'), path = require('path');
const { DIRS, context, load, run } = require('./parity/lib/env.js');

const ctx = context({ self: {} });
load(ctx, DIRS.sweep, ['geom/tpms.js', 'geom/noise.js', 'geom/grain.js', 'geom/beam.js', 'geom/foam.js', 'geom/wave.js', 'geom/voxels.js', 'geom/recipe.js',
  'families/fam-index.js', 'families/fam-tpms.js', 'families/fam-noise.js', 'families/fam-grain.js', 'families/fam-beam.js', 'families/fam-foam.js', 'families/fam-wave.js',
  '40-design.js', '41-density.js', '42-fft.js', '43-elastic-solver.js', '44-solver-config.js', '45-homogenize.js', '50-hires-field.js',
  '51-transport.js', '52-geometry-metrics.js', '53-pores.js', '54-estimate.js', 'solver/lab/14a-connectivity.js']);
ctx.__recipes = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'));

let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

/* 1 — analytic shapes; rawField > 0 in the void, as the metrics fields are */
const shapes = run(ctx, `(() => {
  const N = CURV_N, P = Math.PI;
  const g = (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
  const S = {
    ball:    (x, y, z) => Math.hypot(x, y, z) - 1.5,
    pore:    (x, y, z) => 1.5 - Math.hypot(x, y, z),
    rod:     (x, y, z) => Math.hypot(x, y) - 1.2,
    channel: (x, y, z) => 1.2 - Math.hypot(x, y),
    gyroid:  g,
    sheet:   (x, y, z) => Math.abs(g(x, y, z)) - 0.4,   // ~26 % VF: resolved at 48³ and 64³ (thinner sheets are flagged at 48³)
    beam:    (x, y, z) => Math.min(Math.hypot(y, z), Math.hypot(x, z), Math.hypot(x, y)) - 0.7,
  };
  const out = {};
  for (const name in S) {
    const N3 = N * N * N, raw = new Float32Array(N3), vm = new Uint8Array(N3), sm = new Uint8Array(N3);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const p = t => -P + (t + 0.5) * 2 * P / N, v = S[name](p(i), p(j), p(k)), id = i * N * N + j * N + k;
      raw[id] = v; vm[id] = v > 0 ? 1 : 0; sm[id] = v > 0 ? 0 : 1;
    }
    const cr = [];
    computeCurvatureMetrics(raw, vm, sm, 1, N, null, cr);
    out[name] = computeCurvatureProfile(cr, N, computeTopology(sm, 1, N).euler_char);
  }
  return out;
})()`);
const k = 2 * Math.PI;
check('ball: convex, kappa2 = +2pi/R', near(shapes.ball.curv_k2_mean, k / 1.5, 0.05) && shapes.ball.curv_f_neg === 0, JSON.stringify(shapes.ball));
check('pore: concave, kappa2 = -2pi/R', near(shapes.pore.curv_k2_neg_med, -k / 1.5, 0.05) && shapes.pore.curv_f_neg === 1 && shapes.pore.curv_f_sad === 0, JSON.stringify(shapes.pore));
check('rod: kappa2 = 0, neither concave nor saddle', shapes.rod.curv_f_neg === 0 && shapes.rod.curv_f_sad === 0, JSON.stringify(shapes.rod));
check('channel: concave, kappa2 = -2pi/R', near(shapes.channel.curv_k2_neg_med, -k / 1.2, 0.03 * k / 1.2) && shapes.channel.curv_f_neg === 1, JSON.stringify(shapes.channel));
check('gyroid network: saddle everywhere', shapes.gyroid.curv_f_neg > 0.99 && shapes.gyroid.curv_f_sad > 0.98, JSON.stringify(shapes.gyroid));
check('gyroid sheet: saddle everywhere', shapes.sheet.curv_f_neg > 0.99 && shapes.sheet.curv_f_sad > 0.98, JSON.stringify(shapes.sheet));
for (const n of ['ball', 'pore', 'gyroid', 'sheet'])
  check(`Gauss-Bonnet holds on the ${n}`, shapes[n].curv_flag === false, `resid ${shapes[n].curv_gb_resid}`);
check('Gauss-Bonnet flags sharp beam nodes', shapes.beam.curv_flag === true, `resid ${shapes.beam.curv_gb_resid}`);

/* 2 — real recipes at solver grid 16: the profile comes from the fixed curvature grid */
const KEYS = ['curv_f_neg', 'curv_f_sad', 'curv_k2_mean', 'curv_k2_sd', 'curv_k_neg_int', 'curv_gb_resid', 'curv_flag'];
for (const name of ['tpms-gyroid-sheet', 'beam-bcc', 'foam-open-lloyd', 'wave-schwarzp-solid', 'noise-ridged-half', 'grain-spinodoid']) {
  for (const gridN of [16]) {
    const r = run(ctx, `(() => {
      const o = { Es: 110, nu: 0.3, ks: 1, sigma_ref: 0.011, voxelToUm: 62.5, gridN: ${gridN}, contrast: 1e-3, maxiter: 300 };
      const P = prepareDesign(completeRecipe(__recipes[${JSON.stringify(name)}].recipe), o);
      if (P.reject) return { reject: P.reject };
      const S = { Ex: 10, Ey: 10, Ez: 10, cg_iters: 1, cg_converged: true, solver_validity: 'valid', kx: 1, ky: 1, kz: 1, ks_val: 1, voidRatio: 1e-3 };
      const d = finishDesign(P, S, o);
      const pick = { CURV_N }; ${JSON.stringify(KEYS)}.concat(['curv_k2_neg_med', 'curv_N', 'specific_surface', 'volume_fraction']).forEach(k => pick[k] = d[k]);
      return pick;
    })()`);
    if (r.reject) { console.log(`skip ${name} N${gridN}: rejected (${JSON.stringify(r.reject)})`); continue; }
    const ok = r.curv_N === r.CURV_N && KEYS.every(k => r[k] != null);
    check(`${name} at solver grid ${gridN}: profile on the ${r.CURV_N}³ curvature grid`, ok,
      `concave ${r.curv_f_neg} saddle ${r.curv_f_sad} median k2 ${r.curv_k2_neg_med} resid ${r.curv_gb_resid}${r.curv_flag ? ' (flagged)' : ''} S/V ${r.specific_surface} VF ${r.volume_fraction}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
