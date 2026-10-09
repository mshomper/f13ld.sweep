/* ============================================================
   F13LD.sweep · 41-density.js   (v0.26.0)
   Density as a sampled axis.

   The sweep draws a relative density (volume fraction) for every design
   and this file sets the design's one "thickness knob" so the design
   lands on it — instead of drawing the shape and throwing away whatever
   lands outside the density window (Matt, 2026-10-09).

     family / mode          knob (design-tool recipe key)
     TPMS solid             geometry.offset
     TPMS shell             geometry.wall_thickness
     TPMS PI-TPMS           geometry.pipe_radius
     noise sheet / solid    surface.half_width
     noise half             surface.center
     grain sheet / solid    geometry.half_width
     grain half             geometry.center
     beam                   one factor on every strut radius (and the node
                            smoothing / node ball, so the node shape keeps
                            its proportion to the strut)

   How: every knob enters the design's margin field (solid ⟺ margin > 0,
   geom/voxels.js buildVoxelMargin — the same test the voxels use) as
   margin ≈ a(p)·k + c(p). Two evaluations of the margin at fixed sample
   points give a and c per point, so the solid fraction at any knob value
   is a count, and the knob for a target fraction is found exactly on the
   samples (bisection on the count, no more field evaluations). One more
   evaluation at that knob checks it; where the margin is not quite affine
   in the knob (beam smooth-min nodes, the normalised-shell clip) a few
   secant steps on real evaluations close the gap.

   Samples: DENSITY_N points of a 3-D Roberts (R3) low-discrepancy set in
   the solver cell [-π, π]³ — even coverage without aligning to the voxel
   grid or the field's own periodicity.

   Loaded by the page and by the solver worker (no DOM at load time).
   ============================================================ */

const DENSITY_N = 4096;
const DENSITY_TOL = 0.004;         /* |fraction − target| accepted on the samples */
const DENSITY_UNREACHABLE = 0.02;  /* farther than this after the solve → design rejected */

let _densityPts = null;
function densityPoints() {
  if (_densityPts) return _densityPts;
  /* R3: phi is the real root of x⁴ = x + 1 */
  let g = 1.2;
  for (let i = 0; i < 30; i++) g = Math.pow(1 + g, 1 / 4);
  const a = [1 / g, 1 / (g * g), 1 / (g * g * g)];
  const P = new Float64Array(DENSITY_N * 3), TWO_PI = 2 * Math.PI;
  for (let i = 0; i < DENSITY_N; i++) {
    for (let d = 0; d < 3; d++) {
      const u = (0.5 + a[d] * (i + 1)) % 1;
      P[i * 3 + d] = -Math.PI + u * TWO_PI;
    }
  }
  _densityPts = P;
  return P;
}

/* The design's knob, or null when the family has none. */
function densityKnob(recipe) {
  const fam = labRecipeInfo(recipe).family;
  const g = recipe.geometry || {};
  if (fam === 'tpms') {
    const mode = (g.mode === 'solid' || g.mode === 'pi-tpms') ? g.mode : 'shell';
    if (mode === 'solid') return { name: 'offset', lo: -6, hi: 6, step: 0.25,
      get: r => r.geometry.offset != null ? r.geometry.offset : 0,
      set: (r, k) => { r.geometry.offset = +k.toFixed(4); } };
    if (mode === 'pi-tpms') return { name: 'pipe_radius', lo: 0.004, hi: 0.6, rel: true,
      get: r => r.geometry.pipe_radius != null ? r.geometry.pipe_radius : 0.18,
      set: (r, k) => { r.geometry.pipe_radius = +k.toFixed(4); } };
    return { name: 'wall_thickness', lo: 0.004, hi: 3, rel: true,
      get: r => r.geometry.wall_thickness != null ? r.geometry.wall_thickness : 0.3,
      set: (r, k) => { r.geometry.wall_thickness = +k.toFixed(4); } };
  }
  if (fam === 'noise' || fam === 'grain') {
    const blk = fam === 'noise' ? 'surface' : 'geometry';
    const topo = fam === 'noise' ? (g.mode || 'sheet') : (g.topology || 'sheet');
    if (topo === 'half') return { name: 'center', lo: -0.995, hi: 0.995, step: 0.1,
      get: r => r[blk].center != null ? r[blk].center : 0,
      set: (r, k) => { r[blk].center = +k.toFixed(4); } };
    return { name: 'half_width', lo: 0.002, hi: 1.5, rel: true,
      get: r => r[blk].half_width != null ? r[blk].half_width : 0.15,
      set: (r, k) => { r[blk].half_width = +k.toFixed(4); } };
  }
  if (fam === 'beam') {
    const r0 = { x: g.radius_x, y: g.radius_y, z: g.radius_z, k: g.node_smoothing_k || 0, b: g.node_ball_radius || 0 };
    if (!(r0.x > 0)) {
      /* a plain F13LD.beam recipe: one cell-local radius */
      const rl = typeof g.radius === 'number' && g.radius > 0 ? g.radius : null;
      if (!rl) return null;
      return { name: 'strut radius ×', lo: 0.02, hi: 50, rel: true, get: () => 1,
        set: (r, k) => { r.geometry.radius = +(rl * k).toFixed(5); } };
    }
    return { name: 'strut radius ×', lo: 0.02, hi: 50, rel: true,
      get: () => 1,
      set: (r, k) => {
        const q = r.geometry, s = q.scale_xyz || [q.cell, q.cell, q.cell];
        q.radius_x = +(r0.x * k).toFixed(4); q.radius_y = +(r0.y * k).toFixed(4); q.radius_z = +(r0.z * k).toFixed(4);
        q.radius = +((2 * q.radius_x / s[0] + 2 * q.radius_y / s[1] + 2 * q.radius_z / s[2]) / 3).toFixed(4);
        q.node_smoothing_k = +(r0.k * k).toFixed(4);
        q.node_ball_radius = +(r0.b * k).toFixed(4);
      } };
  }
  return null;
}

/* Margin at every sample point for the recipe as given. */
function densityMargins(recipe) {
  const fn = designMarginFn(designGeometry(recipe));
  const P = densityPoints(), m = new Float64Array(DENSITY_N);
  for (let i = 0; i < DENSITY_N; i++) m[i] = fn(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  return m;
}
function densityFraction(m) {
  let c = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > 0) c++;
  return c / m.length;
}
/* Solid fraction of a recipe on the samples (no knob change). */
function densityOf(recipe) { return densityFraction(densityMargins(recipe)); }

/* Set the recipe's knob so its solid fraction is `target`.
   Returns { recipe (a new object), vf, k, evals, ok, knob }. ok = false when
   the target can't be reached within DENSITY_UNREACHABLE (the knob hit its
   limit — e.g. a lattice that can't get that dense before it fills in). */
function solveDensity(recipe, target) {
  const knob = densityKnob(recipe);
  if (!knob) return { recipe, vf: null, k: null, evals: 0, ok: true, knob: null };
  const clampK = k => Math.max(knob.lo, Math.min(knob.hi, k));
  const at = k => { const r = JSON.parse(JSON.stringify(recipe)); knob.set(r, k); return r; };
  let evals = 0;
  const marg = k => { evals++; return densityMargins(at(k)); };

  /* two evaluations → a(p), c(p) */
  const k0 = clampK(knob.get(recipe));
  let k1 = knob.rel ? clampK(k0 * 1.3 + 1e-3) : clampK(k0 + knob.step);
  if (k1 === k0) k1 = knob.rel ? clampK(k0 * 0.75) : clampK(k0 - knob.step);
  const m0 = marg(k0), m1 = marg(k1);
  const n = DENSITY_N, A = new Float64Array(n), C = new Float64Array(n);
  for (let i = 0; i < n; i++) { A[i] = (m1[i] - m0[i]) / (k1 - k0); C[i] = m0[i] - A[i] * k0; }
  const linFrac = k => { let c = 0; for (let i = 0; i < n; i++) if (A[i] * k + C[i] > 0) c++; return c / n; };
  /* a pure threshold knob (the same a at every sample: TPMS solid offset,
     noise / grain iso and half-width) is exactly affine — no check needed */
  let exact = true;
  for (let i = 1; i < n && exact; i++) if (Math.abs(A[i] - A[0]) > 1e-7 * (1 + Math.abs(A[0]))) exact = false;

  /* the fraction moves one way with the knob (sign of the typical a) */
  let up = 0; for (let i = 0; i < n; i++) up += A[i] > 0 ? 1 : A[i] < 0 ? -1 : 0;
  const rising = up >= 0;
  let lo = knob.lo, hi = knob.hi;
  for (let it = 0; it < 48; it++) {
    const mid = knob.rel ? Math.sqrt(lo * hi) : 0.5 * (lo + hi);
    const f = linFrac(mid);
    if ((f < target) === rising) lo = mid; else hi = mid;
  }
  let k = knob.rel ? Math.sqrt(lo * hi) : 0.5 * (lo + hi);

  /* check on real evaluations; secant steps where the margin isn't affine */
  let best = null;
  if (exact) {
    const f = linFrac(k);
    return { recipe: at(k), vf: f, k, evals, ok: Math.abs(f - target) <= DENSITY_UNREACHABLE, knob: knob.name };
  }
  const pts = [[k0, densityFraction(m0)], [k1, densityFraction(m1)]];
  for (let it = 0; it < 4; it++) {
    const f = densityFraction(marg(k));
    if (!best || Math.abs(f - target) < Math.abs(best.vf - target)) best = { k, vf: f };
    if (Math.abs(f - target) <= DENSITY_TOL) break;
    pts.push([k, f]);
    /* secant through the two evaluated points closest to the target */
    pts.sort((a, b) => Math.abs(a[1] - target) - Math.abs(b[1] - target));
    const [p, q] = pts;
    if (Math.abs(q[1] - p[1]) < 1e-9) break;
    const kn = clampK(p[0] + (target - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
    if (Math.abs(kn - k) < 1e-6) break;
    k = kn;
  }
  return { recipe: at(best.k), vf: best.vf, k: best.k, evals, ok: Math.abs(best.vf - target) <= DENSITY_UNREACHABLE, knob: knob.name };
}

/* Worker / page hook: a design spec's recipe with its density solved, or
   the recipe unchanged when the spec has no target (the reference design). */
function applyDensityTarget(recipe, opts) {
  if (!opts || opts.targetVF == null) return { recipe, density: null };
  const s = solveDensity(recipe, opts.targetVF);
  return {
    recipe: s.recipe,
    density: { target_vf: +opts.targetVF.toFixed(4), sampled_vf: s.vf == null ? null : +s.vf.toFixed(4), knob: s.knob,
               knob_value: s.k == null ? null : +s.k.toFixed(4), evals: s.evals, ok: s.ok }
  };
}
