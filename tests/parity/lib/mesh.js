// F13LD.mesh side: the worker SDF builders (what gets printed), sampled over ONE
// periodic cell on the same voxel centres as Sweep, mapped into Mesh world coords:
//   tpms   field t = p·π·cs/5        → p = t·5/(π·cs_axis)     (m20 buildTPMSSDF)
//   noise  world = solver·5/π        → p = t·5/π               (m20 buildNoiseSDF; stored norm range,
//                                                              else Mesh's 48³ preview-bake range)
//   grain  world = solver·5/π        → p = t·5/π               (m22 buildGrainSDF; hyperuniform with
//                                                              hu_wrap ≠ false → periodic min-image)
//   beam   cell-local u = t/π        → p = u·5/cs_axis          (m21 buildBeamSDF, unpruned)
'use strict';
const { DIRS, context, load, run, grid, clone } = require('./env');

const FILES = ['worker/m05-sdf-registry.js', 'worker/m10-noise.js', 'worker/m11-grain-fields.js',
  'worker/m12-reaction-diffusion.js', 'worker/m20-sdf-noise-tpms.js', 'worker/m21-sdf-beam.js', 'worker/m22-sdf-grain.js', 'worker/m24-sdf-wave.js'];
const ctx = load(context({ self: { postMessage() {} } }), DIRS.mesh, FILES);
run(ctx, `
  function __sdf(family, s, opt) {
    var j = JSON.parse(s);
    if (family === 'tpms') return buildTPMSSDF(j);
    if (family === 'beam') { j.family = 'beam'; return buildBeamSDF(j); }
    if (family === 'grain') return buildGrainSDF(j, null, null, opt && opt.periodic ? { periodic: true } : undefined);
    if (family === 'noise') return buildNoiseSDF(j, opt && opt.range ? opt.range : undefined);
    if (family === 'wave') return buildWaveSDF(j);
    throw new Error('mesh: no builder for ' + family);
  }
  /* m90 bakeRaw preview range over world [-5,5]³ at the draft preview N (42-preview-bake.js) + rawRange pad */
  function __noiseRange(s, PN) {
    var json = JSON.parse(s), fam = SDF_FAMILIES.noise, raw = fam.rawEval({ recipe: { json: json } });
    var st = 10 / PN, mn = Infinity, mx = -Infinity;
    for (var iz = 0; iz < PN; iz++) for (var iy = 0; iy < PN; iy++) for (var ix = 0; ix < PN; ix++) {
      var v = raw.evalRaw([-5 + st*(ix+.5), -5 + st*(iy+.5), -5 + st*(iz+.5)]); if (v < mn) mn = v; if (v > mx) mx = v; }
    var rr = fam.rawRange(json, mn, mx); return { fieldMin: rr.min, fieldMax: rr.max };
  }
`);

/* Per-axis cell scales as Mesh reads them (only to place sample points). */
function tpmsCellScale(g) {
  const d = g.cell_scale ?? 1;
  return [g.cell_scale_x ?? d, g.cell_scale_y ?? d, g.cell_scale_z ?? d];
}
function beamCellScale(g) {   // mirror of m21 schema detection
  let s = null;
  if (Array.isArray(g.scale_xyz) && g.scale_xyz.length === 3 && g.scale_xyz.every(v => isFinite(v) && v > 0)) s = g.scale_xyz;
  else if ([g.cell_scale_x, g.cell_scale_y, g.cell_scale_z].every(v => typeof v === 'number' && v > 0)) s = [g.cell_scale_x, g.cell_scale_y, g.cell_scale_z];
  if (s && typeof g.cell === 'number' && g.cell > 0) return s.map(v => g.cell / v);
  const c = (typeof g.cell_scale === 'number' && g.cell_scale > 0) ? g.cell_scale : 1;
  return [c, c, c];
}

const PREVIEW_N = 48;
/* Inside/outside mask of a recipe in Mesh, one cell. variant: 'cube' forces the
   non-periodic hyperuniform evaluator (info only). Returns { mask, note }. */
function voxels(family, json, N, variant) {
  const j = clone(json), s = JSON.stringify(j), g = j.geometry || {};
  const P5 = 5 / Math.PI;
  let note = '';
  if (family === 'tpms') {
    const sdf = ctx.__sdf('tpms', s), cs = tpmsCellScale(g);
    const k = cs.map(c => 5 / (Math.PI * c));
    return { mask: grid(N, (x, y, z) => sdf([x * k[0], y * k[1], z * k[2]]) < 0), note };
  }
  if (family === 'noise') {
    const sf = j.surface || {};
    let opt = null;
    if (!(sf.norm_min != null && sf.norm_max != null)) { opt = { range: ctx.__noiseRange(s, PREVIEW_N) }; note = 'mesh preview range'; }
    const sdf = ctx.__sdf('noise', s, opt);
    return { mask: grid(N, (x, y, z) => sdf([x * P5, y * P5, z * P5]) < 0), note };
  }
  if (family === 'grain') {
    const f = j.field || {};
    const periodic = f.type === 'hyperuniform' && f.hu_wrap !== false && variant !== 'cube';
    if (periodic) note = 'periodic';
    const sdf = ctx.__sdf('grain', s, { periodic });
    return { mask: grid(N, (x, y, z) => sdf([x * P5, y * P5, z * P5]) < 0), note };
  }
  if (family === 'beam') {
    const sdf = ctx.__sdf('beam', s), cs = beamCellScale(g);
    const k = cs.map(c => 5 / (Math.PI * c));
    return { mask: grid(N, (x, y, z) => sdf([x * k[0], y * k[1], z * k[2]]) < 0), note };
  }
  if (family === 'wave') {   /* v0.29.0 — one cell = world [-5,5]³ × stretch (q = p·π/5 ÷ stretch) */
    const sdf = ctx.__sdf('wave', s);
    const st = (j.field && Array.isArray(j.field.stretch)) ? j.field.stretch : [1, 1, 1];
    return { mask: grid(N, (x, y, z) => sdf([x * P5 * st[0], y * P5 * st[1], z * P5 * st[2]]) < 0), note };
  }
  throw new Error('mesh: family ' + family);
}

module.exports = { ctx, voxels };
