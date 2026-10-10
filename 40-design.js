/* ============================================================
   F13LD.sweep · 40-design.js
   Designs are recipes.

   Every design the sweep explores is a recipe in the design tools' own
   export format (F13LD.tpms / .noise / .grain / .beam / .foam / .wave, plus the keys
   F13LD.mesh reads: per-axis cell scale, normal_weights, beam radius_x/y/z
   …). The solver worker builds its geometry from that recipe, and the
   results / Export Design / F13LD.mesh handoff write that same recipe —
   so what Sweep solves, what Lab verifies and what Mesh prints are built
   from one object by one code path (geom/, shared with F13LD.lab).

   designGeometry(recipe) is exactly F13LD.lab's import path:
     labRecipeFromJson → KERNELS[family].parseRecipe → resolveBuildArgs
   The one Sweep-only step: a beam lattice is always sampled as ONE
   periodic cell (cell-local x/π), whatever its per-axis cell scale. Lab
   samples Mesh's [-5,5] world cube instead, which is the same cell only
   when the cell is cubic (a known Lab item for stretched cells).
   ============================================================ */

/* Families the sweep explores, each a shared geom/ kernel. */
var KERNELS = { tpms: TpmsKernel, noise: NoiseKernel, grain: GrainKernel, beam: BeamKernel, foam: FoamKernel, wave: WaveKernel };
const SWEEP_FAMILY_LIST = ['tpms', 'noise', 'grain', 'beam', 'foam', 'wave'];

function designGeometry(recipe) {
  const info = labRecipeInfo(recipe);
  if (!KERNELS[info.family]) {
    throw new Error(`family "${info.family}" is not swept (supported: ${SWEEP_FAMILY_LIST.join(', ')})`);
  }
  const built = labRecipeFromJson(recipe, null, info);
  if (!built.recipe) throw new Error(built.recipeNote);
  const r = built.recipe;
  const params = KERNELS[r.family].parseRecipe(r);
  const a = resolveBuildArgs(r);
  if (r.family === 'beam') params.inX = params.inY = params.inZ = 1 / Math.PI;
  return {
    family: r.family, labRecipe: r, params,
    mode: a.mode, offset: a.offset, wt: a.wt, nWeights: a.nWeights,
    pipeR: a.pipeR, phaseShift: a.phaseShift,
    // solver-policy mode (grid floors, VF bounds): beams are their own class
    sweepMode: r.family === 'beam' ? 'beam-solid' : a.mode
  };
}

/* Voxel mask (0/1, Float32Array N³, index i·N²+j·N+k) of a design. */
function designVoxels(geo, N) {
  return buildVoxels(geo.family, geo.params, geo.offset, N, geo.mode, geo.wt, geo.nWeights, geo.pipeR, geo.phaseShift);
}

/* Continuous margin of a design (solid ⟺ m > 0), as a function of
   solver-space (x,y,z) ∈ [-π,π]³ — the same test buildVoxels applies. */
function designMarginFn(geo) {
  return buildVoxelMargin(geo.family, geo.params, geo.offset, 1, geo.mode, geo.wt, geo.nWeights, geo.pipeR, geo.phaseShift, true).fn;
}

/* Noise: write the normalization range the design is built with into its
   surface block (norm_min / norm_max, stamped with norm_for) — computed
   exactly as F13LD.noise's export does — so F13LD.mesh prints with the
   same range. Call after changing anything that moves the raw field. */
function stampNoiseRange(surface) {
  const p = NoiseKernel._readField(surface);
  const r = NoiseKernel._prepass(p);
  surface.norm_min = r.noiseMin;
  surface.norm_max = r.noiseMax;
  surface.norm_for = noiseFieldKey(p);
  return surface;
}

/* ── Wave (v0.29.0): load checks and field size, used by families/fam-wave.js
   and 41-density.js (page and worker). ── */
/* Whole-number indices and a field that isn't zero: null when fine, else why. */
function waveRecipeProblem(recipe) {
  const f = recipe.field || {};
  const modes = Array.isArray(f.modes) ? f.modes : [];
  if (!modes.length) return 'the wave recipe has no modes';
  for (let i = 0; i < modes.length; i++) {
    const mm = modes[i] || {};
    for (const k of ['n', 'm', 'p']) {
      const v = mm[k];
      if (typeof v !== 'number' || !isFinite(v)) return `mode ${i + 1} has no ${k} index`;
      if (Math.abs(v - Math.round(v)) > 1e-9)
        return `mode ${i + 1} has ${k} = ${+v.toPrecision(6)} — a fractional index repeats only over several cells, ` +
               `and Sweep (like F13LD.lab and F13LD.wave's own homogenisation) solves one cell. Use whole-number indices`;
    }
  }
  if (waveFieldRMS(recipe) < 1e-6 * (1 + waveFieldBound(recipe)))
    return 'the field is zero everywhere (these indices cancel under this symmetry — e.g. Chladni needs three different indices, Schoen a non-zero first index)';
  return null;
}

/* Largest |field| the modes can reach: Σ |A·cos(phi + t)| × the symmetry's term count. */
const WAVE_SYM_TERMS = [1, 6, 6, 3, 3];
function waveFieldBound(recipe) {
  const p = WaveKernel.parseRecipe({ field: (recipe.field || {}) });
  let s = 0;
  for (const mm of p.modes) s += Math.abs((mm.A != null ? mm.A : 1) * Math.cos((mm.phi || 0) + p.t));
  return s * (WAVE_SYM_TERMS[p.sym] || 1);
}

/* RMS of the raw field on 512 fixed points of the cell (R3 set). */
let _wavePts = null;
function waveFieldRMS(recipe) {
  if (!_wavePts) {
    let g = 1.2;
    for (let i = 0; i < 30; i++) g = Math.pow(1 + g, 1 / 4);
    const a = [1 / g, 1 / (g * g), 1 / (g * g * g)];
    _wavePts = new Float64Array(512 * 3);
    for (let i = 0; i < 512; i++) for (let d = 0; d < 3; d++) _wavePts[i * 3 + d] = -Math.PI + ((0.5 + a[d] * (i + 1)) % 1) * 2 * Math.PI;
  }
  const p = WaveKernel.parseRecipe({ field: (recipe.field || {}) });
  let s = 0;
  for (let i = 0; i < 512; i++) { const v = WaveKernel._evalRaw(p, _wavePts[i * 3], _wavePts[i * 3 + 1], _wavePts[i * 3 + 2]); s += v * v; }
  return Math.sqrt(s / 512);
}

/* Fill in what a design recipe leaves to defaults, the way F13LD.mesh
   reads it, so the recipe Sweep writes means the same thing everywhere:
     TPMS   shell_normalize / pi_normalize when absent → on for the
            matching mode (Mesh's rule; Lab's import rule is off)
     noise  stored normalization range when absent (F13LD.noise's scan)
   Returns a new object; the input is not modified. */
function completeRecipe(recipe) {
  const r = JSON.parse(JSON.stringify(recipe));
  const fam = labRecipeInfo(r).family;
  if (fam === 'tpms') {
    const g = r.geometry = r.geometry || {};
    /* F13LD.mesh builds any mode other than solid / pi-tpms as a shell */
    const mode = (g.mode === 'solid' || g.mode === 'pi-tpms') ? g.mode : 'shell';
    g.mode = mode;
    if (g.shell_normalize == null && mode === 'shell') g.shell_normalize = true;
    if (g.pi_normalize == null && mode === 'pi-tpms') g.pi_normalize = true;
    if (mode === 'pi-tpms' && g.pipe_radius == null) g.pipe_radius = 0.18;
    if (mode === 'shell' && g.wall_thickness == null) g.wall_thickness = 0.3;
  } else if (fam === 'noise') {
    const s = r.surface;
    const stored = typeof s.norm_min === 'number' && typeof s.norm_max === 'number';
    if (!stored) stampNoiseRange(s);
    else if (s.norm_for == null) s.norm_for = noiseNormKey(s);
  }
  return r;
}

/* Per-axis cell scale of a design recipe, for the results table and the
   aspect of the preview box: TPMS cell_scale_x/y/z (cells per unit — a
   bigger number is a shorter cell), beam scale_xyz (cell edge in mm).
   Noise and grain have no cell scale (their own scale settings sweep). */
function recipeCellScale(recipe, family) {
  const g = recipe.geometry || {};
  if (family === 'tpms') {
    const d = g.cell_scale != null ? g.cell_scale : 1;
    return [g.cell_scale_x != null ? g.cell_scale_x : d, g.cell_scale_y != null ? g.cell_scale_y : d, g.cell_scale_z != null ? g.cell_scale_z : d];
  }
  if (family === 'beam') {
    if (Array.isArray(g.scale_xyz)) return g.scale_xyz.slice();
    const c = g.cell != null ? g.cell : 1.5;
    return [c, c, c];
  }
  return [1, 1, 1];
}

/* Physical edge lengths of one cell, relative (max = 1), for the preview box. */
function recipeCellAspect(recipe, family) {
  const s = recipeCellScale(recipe, family);
  const e = family === 'tpms' ? s.map(v => 1 / v) : s;
  const m = Math.max(e[0], e[1], e[2]) || 1;
  return e.map(v => v / m);
}
