// Density solve check (v0.26.0): for every recipe in tests/parity/fixtures.json,
// set the density knob for a few target volume fractions (41-density.js) and
// compare the result against the voxel volume fraction at N (default 32) —
// what the solver actually sees.  Node built-ins only.
//
//   node tests/density.js [N] [filter]
//
// Prints per design: knob, target → s(ampled fraction) / v(oxel fraction at N),
// "!" when the target can't be reached, the number of margin evaluations and
// the time (most of it the N³ voxel check).  Exit 1 when a reachable target
// lands more than 0.02 off on the samples (a field with a plateau — many
// samples at one value — can jump past the target).  Binary voxels at 32³ read thin
// struts and pipes a few points off; the solver's partial-volume voxels don't.
'use strict';
const fs = require('fs'), path = require('path');
const { DIRS, context, load, run } = require('./parity/lib/env.js');

const N = +(process.argv[2] || 32);
const FILTER = process.argv[3] || '';
const ctx = context();
load(ctx, DIRS.sweep, ['geom/tpms.js', 'geom/noise.js', 'geom/grain.js', 'geom/beam.js', 'geom/foam.js', 'geom/wave.js', 'geom/voxels.js', 'geom/recipe.js', '40-design.js', '41-density.js']);
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'parity', 'fixtures.json'), 'utf8'));
ctx.__fx = fx;

let bad = 0, rows = 0;
const t0all = Date.now();
for (const name of Object.keys(fx)) {
  if (FILTER && !name.includes(FILTER)) continue;
  ctx.__name = name;
  let base;
  try { base = run(ctx, `(() => { const r = completeRecipe(__fx[__name]); return { vf: densityOf(r), knob: (densityKnob(r) || {}).name || null }; })()`); }
  catch (e) { console.log(`${name.padEnd(36)} skipped: ${e.message}`); continue; }
  if (!base.knob) { console.log(`${name.padEnd(36)} no knob`); continue; }
  const targets = [0.10, 0.25, 0.40].concat([base.vf * 0.75, base.vf * 1.25].filter(v => v > 0.02 && v < 0.8));
  const out = [];
  for (const t of targets) {
    ctx.__t = t;
    const t0 = Date.now();
    const r = run(ctx, `(() => {
      const s = solveDensity(completeRecipe(__fx[__name]), __t);
      const vox = designVoxels(designGeometry(s.recipe), ${N});
      let c = 0; for (let i = 0; i < vox.length; i++) c += vox[i];
      return { vf: s.vf, ok: s.ok, evals: s.evals, k: s.k, voxVf: c / vox.length };
    })()`);
    const ms = Date.now() - t0;
    rows++;
    if (r.ok && Math.abs(r.vf - t) > 0.02) bad++;
    out.push(`${t.toFixed(2)}→${r.ok ? "" : "!"}s${(r.vf||0).toFixed(3)}/v${r.voxVf.toFixed(3)} (${r.evals}e ${ms}ms)`);
  }
  console.log(`${name.padEnd(36)} ${base.knob.padEnd(15)} base ${base.vf.toFixed(3)} | ${out.join('  ')}`);
}
console.log(`\n${rows} solves, ${bad} reachable targets more than 0.02 off on the samples · ${((Date.now() - t0all) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
