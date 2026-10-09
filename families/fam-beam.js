/* ============================================================
   F13LD.sweep · families/fam-beam.js
   Beam: how a design is varied around the loaded recipe.

   The design recipe is F13LD.beam's export (same beams[] and topology)
   in the per-axis schema F13LD.mesh reads:
     cell        nominal cell edge, mm (geometric mean of scale_xyz)
     scale_xyz   per-axis cell edge, mm — the drawn cell scale
     radius_x/y/z   strut radius per axis, mm
     node_smoothing_k / node_ball_radius   mm
   F13LD.beam's own radius is cell-local (a fraction of the half-cell),
   so a 1.5 mm cell with radius 0.10 has 0.075 mm struts. The solver
   samples one periodic cell (40-design.js).

   v0.26.0 — the strut radii keep their per-axis proportions × (1 ± spread)
   and 41-density.js scales all of them (and the node smoothing / node
   ball with them) to the drawn density; the radius no longer reuses the
   cell-scale ranges. Neighbourhood keeps the recipe's node treatment ×
   (1 ± spread) — none stays none; Explore draws node smoothing 0–1.5× and
   node ball 0–2× the mean radius (v0.25 behaviour).
   ============================================================ */

SWEEP_FAMILIES.beam = {
  label: 'beam',
  usesCellScale: true,

  /* Base cell edges (mm) and strut radii (mm) per axis, as Lab / Mesh read the recipe. */
  baseDims(recipe) {
    const g = recipe.geometry || {};
    let s = null;
    if (Array.isArray(g.scale_xyz) && g.scale_xyz.length === 3 && g.scale_xyz.every(v => v > 0)) s = g.scale_xyz.slice();
    else if ([g.cell_scale_x, g.cell_scale_y, g.cell_scale_z].every(v => typeof v === 'number' && v > 0)) s = [g.cell_scale_x, g.cell_scale_y, g.cell_scale_z];
    const isNew = !!s && typeof g.cell === 'number' && g.cell > 0;
    if (!isNew) {
      const c = (typeof g.cell === 'number' && g.cell > 0) ? g.cell : 1.5;
      s = [c, c, c];
    }
    let r;
    if (isNew && typeof g.radius_x === 'number') {
      const rx = g.radius_x, ry = typeof g.radius_y === 'number' ? g.radius_y : rx, rz = typeof g.radius_z === 'number' ? g.radius_z : rx;
      r = [rx, ry, rz];
    } else {
      const rl = (typeof g.radius === 'number' && g.radius >= 0) ? g.radius : 0.1;
      r = s.map(si => rl * si / 2);
    }
    return { scale: s, radius: r, cell: Math.cbrt(s[0] * s[1] * s[2]) };
  },

  nominalScale(recipe) { return this.baseDims(recipe).cell; },

  describe(recipe) {
    const d = this.baseDims(recipe);
    const t = (recipe.topology && recipe.topology.name) || (recipe.meta && recipe.meta.preset) || 'custom';
    const r = d.radius.map(v => v.toFixed(3)).join(' / ');
    return `family: beam · topology: ${t} · ${recipe.beams.length} struts · cell ${d.cell.toFixed(3)} mm · strut radius ${r} mm`;
  },

  summary(recipe) {
    const g = recipe.geometry, t = (recipe.topology && recipe.topology.name) || 'beam';
    let extras = '';
    if (g.node_smoothing_k > 0) extras += ` k=${g.node_smoothing_k}`;
    if (g.node_ball_radius > 0) extras += ` b=${g.node_ball_radius}`;
    return `${t} · ${recipe.beams.length} struts · r=[${g.radius_x}, ${g.radius_y}, ${g.radius_z}]${extras}`;
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = ctx.rand || Math.random;
    const M = J.spreadMult(ctx);
    const d = this.baseDims(base);
    const [sx, sy, sz] = ctx.scale;
    /* radii: the recipe's per-axis proportions, each × (1 ± spread), at the
       recipe's mean (the density solve sets the overall size) */
    const rr = d.radius.map(v => v * (M[0] + ctx.u() * (M[1] - M[0])));
    const r0 = (d.radius[0] + d.radius[1] + d.radius[2]) / 3, rm = (rr[0] + rr[1] + rr[2]) / 3;
    const rx = rr[0] * r0 / rm, ry = rr[1] * r0 / rm, rz = rr[2] * r0 / rm;
    const g = J.clone(base.geometry || {});
    delete g.cell_scale; delete g.cell_scale_x; delete g.cell_scale_y; delete g.cell_scale_z;
    const s = [+sx.toFixed(4), +sy.toFixed(4), +sz.toFixed(4)];
    g.scale_xyz = s;
    g.cell = +Math.cbrt(s[0] * s[1] * s[2]).toFixed(4);
    g.radius_x = +rx.toFixed(4); g.radius_y = +ry.toFixed(4); g.radius_z = +rz.toFixed(4);
    /* scalar radius kept for readers of the plain F13LD.beam field: cell-local, mean */
    g.radius = +((2 * g.radius_x / s[0] + 2 * g.radius_y / s[1] + 2 * g.radius_z / s[2]) / 3).toFixed(4);
    if (ctx.explore) {
      g.node_smoothing_k = +(ctx.u() * r0 * 1.5).toFixed(4);
      g.node_ball_radius = +(ctx.u() * r0 * 2.0).toFixed(4);
    } else {
      const k0 = (base.geometry || {}).node_smoothing_k || 0, b0 = (base.geometry || {}).node_ball_radius || 0;
      g.node_smoothing_k = +(k0 * (M[0] + R() * (M[1] - M[0]))).toFixed(4);
      g.node_ball_radius = +(b0 * (M[0] + R() * (M[1] - M[0]))).toFixed(4);
    }
    /* topology is always written (F13LD.ingest needs it to rebuild the lattice) */
    const topology = base.topology ? J.clone(base.topology)
      : { name: (base.meta && base.meta.preset) || 'custom', beam_count: base.beams.length };
    return { meta: Object.assign({}, base.meta || {}), family: 'beam', topology, geometry: g, beams: J.clone(base.beams) };
  }
};
