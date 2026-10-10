// One parity job → one result row. Runs in a worker thread (lib/worker.js) or inline.
//   { kind: 'A', name }                    a design-tool recipe (lib/recipes.js)
//   { kind: 'B', family, base, i }         design i of a Sweep sweep around section-A recipe `base`
'use strict';
const { vf, diff, prng, hashStr } = require('./env');
const sweep = require('./sweep'), lab = require('./lab'), mesh = require('./mesh'), tools = require('./tools');
const recipes = require('./recipes');

/* Beam cells Lab samples as Mesh's [-5,5] world cube rather than one cell (known Lab item). */
function stretchedBeam(json) {
  const g = json.geometry || {}, s = g.scale_xyz;
  return Array.isArray(s) && s.length === 3 && !(s[0] === s[1] && s[1] === s[2]) && typeof g.cell === 'number';
}
function firstDiff(a, b, N) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
    const ii = Math.floor(i / (N * N)), jj = Math.floor(i / N) % N, kk = i % N, c = n => +(-Math.PI + (n + .5) * 2 * Math.PI / N).toFixed(4);
    return { ijk: [ii, jj, kk], xyz: [c(ii), c(jj), c(kk)], sweep: a[i], other: b[i] };
  }
  return null;
}

/* sweepJson goes straight through designGeometry; labJson / meshJson as given. */
function compare(row, family, sweepJson, labJson, meshJson, toolSpec, labNA, N, tol) {
  const N3 = N * N * N;
  try {
    const s = sweep.voxels(sweepJson, N);
    row.vfSweep = vf(s.mask); row.mode = s.mode;
    if (labNA) row.lab = 'n/a (' + labNA + ')';
    else {
      const l = lab.voxels(labJson, N);
      if (l.error) row.labError = l.error;
      else {
        row.vfLab = vf(l.mask); row.sl = diff(s.mask, l.mask);
        if (row.sl) row.slFirst = firstDiff(s.mask, l.mask, N);
        if (l.mode !== s.mode) row.labMode = l.mode;
      }
    }
    const m = mesh.voxels(family, meshJson, N);
    row.vfMesh = vf(m.mask); row.sm = diff(s.mask, m.mask) / N3;
    if (m.note) row.meshNote = m.note;
    if (row.sm > tol) row.smFirst = firstDiff(s.mask, m.mask, N);
    if (toolSpec) {
      const t = tools[toolSpec.family].voxels(toolSpec.ui, N);
      row.vfTool = vf(t); row.tm = diff(t, m.mask) / N3; row.st = diff(s.mask, t) / N3;
    }
  } catch (e) { row.error = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); }
  return row;
}

function runJob(job, N, tol) {
  const t0 = Date.now();
  let row;
  if (job.kind === 'A') {
    const R = recipes.build(job.name);
    row = { section: 'A', family: R.family, name: R.name, json: R.json };
    compare(row, R.family, sweep.complete(R.json), R.json, R.json, R.tool,
      R.family === 'beam' && stretchedBeam(R.json) ? 'stretched beam' : null, N, tol);
  } else {
    const fam = job.family, base = recipes.build(job.base);
    const completed = sweep.complete(base.json);
    const seed = hashStr(`${fam}|${job.base}|${job.i}`), rnd = prng(seed);
    const draws = Array.from({ length: 64 }, () => rnd());      /* draw.u(i) = draws[i]; u(0..2) → cell scale, as runSweep */
    let scale = null;
    if (sweep.usesCellScale(fam)) {
      const nominal = sweep.nominalScale(fam, completed);
      scale = [0, 1, 2].map(d => (0.5 + 1.5 * draws[d]) * nominal);
      /* beams: every third design cubic, so Lab (one cell only for cubic cells) has comparable designs */
      if (fam === 'beam' && job.i % 3 === 0) scale = [scale[0], scale[0], scale[0]];
    }
    const ctx = { mode: sweep.baseMode(completed), scale, axialShift: [0, 0, 0],
      radiusFrac: { x: [0.5, 2], y: [0.5, 2], z: [0.5, 2] }, targetHints: null };
    row = { section: 'B', family: fam, name: `${job.base.replace(/^\[x\] /, '')} #${job.i}`, base: job.base, seed };
    let design = null;
    try { design = sweep.jitter(fam, completed, draws, ctx, seed); }
    catch (e) { row.error = 'jitter: ' + (e && e.message || e); }
    if (design) {
      row.design = design;
      if (fam === 'beam') row.scaleNote = `scale [${design.geometry.scale_xyz.join(', ')}]`;
      compare(row, fam, design, design, design, null, fam === 'beam' && stretchedBeam(design) ? 'stretched beam' : null, N, tol);
    }
  }
  row.ms = Date.now() - t0;
  return row;
}

module.exports = { runJob };
