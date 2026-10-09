// Jitter + density + CPU solve, end to end, without a browser (v0.26.0).
// For every case in tests/recipes.json: draw a few designs the way runSweep
// does (Sobol dim 0 = density, 1–3 = cell scale, then the family's own),
// solve each design's density in the worker's code path, then run the CPU
// pipeline (estimateHomogenization) on it at N = 16.
//
//   node tests/smoke-jitter.js [designs per case] [neighbourhood|explore] [spread] [filter]
//
// Prints per design: drawn density → solved volume fraction, the knob value,
// Ex, and any reject reason. Exit 1 on an exception.  Node built-ins only.
'use strict';
const fs = require('fs'), path = require('path');
const { DIRS, context, load, run } = require('./parity/lib/env.js');

const [nArg, modeArg, spreadArg, FILTER] = process.argv.slice(2);
const N_DESIGNS = +(nArg || 3), MODE = modeArg || 'neighbourhood', SPREAD = +(spreadArg || 0.25);
const ctx = context({ self: {} });
load(ctx, DIRS.sweep, ['geom/tpms.js', 'geom/noise.js', 'geom/grain.js', 'geom/beam.js', 'geom/voxels.js', 'geom/recipe.js',
  'families/fam-index.js', 'families/fam-tpms.js', 'families/fam-noise.js', 'families/fam-grain.js', 'families/fam-beam.js',
  '40-design.js', '41-density.js', '42-fft.js', '43-elastic-solver.js', '44-solver-config.js', '45-homogenize.js', '50-hires-field.js',
  '51-transport.js', '52-geometry-metrics.js', '53-pores.js', '54-estimate.js', 'solver/lab/14a-connectivity.js', '61-sobol.js']);
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8'));
ctx.__cases = cases;
let failed = 0;
for (const name of Object.keys(cases)) {
  if (name.startsWith('_') || (FILTER && !name.includes(FILTER))) continue;
  ctx.__name = name;
  const t0 = Date.now();
  try {
    const out = run(ctx, `(() => {
      const base = completeRecipe(__cases[__name].recipe);
      const family = labRecipeInfo(base).family, fam = SWEEP_FAMILIES[family];
      const baseVf = densityOf(base);
      const lo = Math.max(0.03, baseVf * (1 - ${SPREAD})), hi = Math.min(0.7, baseVf * (1 + ${SPREAD}));
      const rand = makeRng(12345), sampler = makeSampler('sobol', 8, rand), nom = fam.nominalScale(base);
      const geo = designGeometry(base), rows = [];
      for (let i = 0; i < ${N_DESIGNS}; i++) {
        const draw = sampler.next();
        const targetVF = lo + draw.u(0) * (hi - lo);
        const sc = [1, 2, 3].map(d => nom * (0.5 + draw.u(d) * 1.5));
        let dim = fam.usesCellScale ? 4 : 1;
        const rec = fam.jitter(base, draw, { mode: geo.mode, scale: fam.usesCellScale ? sc : null, axialShift: [0, 0, 0],
          spread: ${SPREAD}, explore: ${JSON.stringify(MODE)} === 'explore', u: () => draw.u(dim++), rand, targetHints: null });
        const d = applyDensityTarget(rec, { targetVF });
        const hom = estimateHomogenization(d.recipe, { Es: 110, nu: 0.3, ks: 1, sigma_ref: 0.011, voxelToUm: 62.5, gridN: 16, contrast: 1e-3, maxiter: 300 });
        rows.push({ t: targetVF, vf: hom.volume_fraction, knob: d.density.knob_value, ex: hom.Ex_GPa, rej: hom.reject_reason || '', summ: fam.summary(d.recipe) });
      }
      return { family, baseVf, rows };
    })()`);
    console.log(`${name} (${out.family}) recipe ρ ${(out.baseVf * 100).toFixed(1)} %  ·  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const r of out.rows) console.log(`   ρ ${(r.t * 100).toFixed(1)} → ${r.vf != null ? (+r.vf).toFixed(1) : '—'} %  knob ${r.knob}  Ex ${r.ex != null ? (+r.ex).toFixed(3) : '—'} GPa ${r.rej ? '[' + r.rej + ']' : ''}  ${r.summ}`);
  } catch (e) {
    failed++;
    console.log(`${name}: ERROR ${e.stack || e.message}`);
  }
}
process.exit(failed ? 1 : 0);
