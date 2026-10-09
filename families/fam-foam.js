/* ============================================================
   F13LD.sweep · families/fam-foam.js   (v0.27.0)
   Foam: how a design is varied around the loaded recipe.

   The design recipe is F13LD.foam's export shape — seeds (generator
   settings + every seed position), anisotropy, geometry — and only
   periodic foams load (geom/recipe.js refuses the others, as Lab and Mesh
   do). One foam tile is one cubic solver cell; it stays a cube.

   Neighbourhood (default) keeps the cell layout: seed mode, count,
   regularity, Lloyd iterations, two-size mix, lattice jitter, random seed
   and the stored seed positions — so every design has exactly the
   recipe's cells (Matt, 2026-10-09: a new layout is a different space, as
   a new seed is). What varies is the cells' shape:
     · anisotropy stretch x / y / z — the Cell scale ranges (the foam's
       analogue of a stretched cell; the tile itself stays cubic), times
       the recipe's own stretch, geometric mean held at 1 (only the
       ratios matter; the density solve sets the overall wall)
     · plateau k, fillet, node size, wet edge minimum × (1 ± spread);
       zero stays zero
   Explore also redraws the layout: cell count × (1 ± spread), regularity,
   Lloyd iterations (± 2), the two-size ratio / large fraction, lattice
   jitter, and a fresh random seed — the stored positions are dropped and
   F13LD.foam's generator (FoamSeeds, geom/foam.js) rebuilds them, as
   F13LD.mesh and F13LD.lab do for a recipe without positions.
   The density knob — wall / strut thickness, or the border radius for
   wet foam — is set by 41-density.js.
   ============================================================ */

SWEEP_FAMILIES.foam = {
  label: 'foam',
  usesCellScale: true,                 /* drives the anisotropy stretch, not a cell size */

  nominalScale() { return 1.0; },

  describe(recipe) {
    const s = recipe.seeds || {}, a = recipe.anisotropy || {}, g = recipe.geometry || {};
    const n = s.count_actual || s.count || (Array.isArray(s.positions) ? s.positions.length / 3 : '?');
    const st = a.enabled && Array.isArray(a.stretch) ? ` · stretch [${a.stretch.join(', ')}]` : '';
    const th = g.mode === 'wet' ? `border ${g.border}` : `thickness ${g.thickness}`;
    return `family: foam · ${s.mode || 'seeds'} · ${n} cells · ${g.mode || 'plateau'} · ${th}${st}`;
  },

  summary(recipe) {
    const s = recipe.seeds || {}, a = recipe.anisotropy || {}, g = recipe.geometry || {};
    const n = s.count_actual || s.count || (Array.isArray(s.positions) ? s.positions.length / 3 : '?');
    const st = a.enabled && Array.isArray(a.stretch) ? ` [${a.stretch.map(v => (+v).toFixed(2)).join(',')}]` : '';
    const th = g.mode === 'wet' ? `b=${g.border}` : `t=${g.thickness}`;
    return `${s.mode || 'foam'} ${n} ${g.mode || 'plateau'} ${th}${st}`;
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = ctx.rand || Math.random;
    const M = J.spreadMult(ctx);
    const mul = (v, lo, hi, u) => J.mul(v, [lo, hi], u, M);
    const seeds = J.clone(base.seeds || {}), a0 = base.anisotropy || {}, g = J.clone(base.geometry || {});

    /* ── anisotropy stretch: cell-scale draw × the recipe's stretch ── */
    const st0 = (a0.enabled && Array.isArray(a0.stretch) && a0.stretch.length === 3) ? a0.stretch.map(v => (isFinite(v) && v > 0) ? v : 1) : [1, 1, 1];
    const sc = ctx.scale || [1, 1, 1];
    let st = st0.map((v, i) => Math.max(0.2, Math.min(5, v * sc[i])));
    const gm = Math.cbrt(st[0] * st[1] * st[2]);
    st = st.map(v => +(v / gm).toFixed(4));
    const anisotropy = { enabled: !(st[0] === 1 && st[1] === 1 && st[2] === 1), stretch: st };

    /* ── cell shape ── */
    const wet = g.mode === 'wet';
    if (g.mode === 'plateau' && g.plateau_k > 0) g.plateau_k = +mul(g.plateau_k, 0, 1, ctx.u()).toFixed(4);
    if (!wet && g.fillet > 0) g.fillet = +mul(g.fillet, 0, 2, ctx.u()).toFixed(4);
    if (!wet && g.node > 0) g.node = +mul(g.node, 0, 3, ctx.u()).toFixed(4);
    if (wet && g.edge_min > 0) g.edge_min = +mul(g.edge_min, 0, 1, ctx.u()).toFixed(4);

    /* ── Explore: a new cell layout ── */
    if (ctx.explore) {
      const LAT = ['weairePhelan', 'kelvin', 'fcc', 'c15'];   /* F13LD.foam LATTICE_MODES */
      if (seeds.count > 0) seeds.count = Math.max(2, Math.min(500, Math.round(mul(seeds.count, 2, 500, R()))));
      if (seeds.regularity != null) seeds.regularity = +J.clamp(seeds.regularity + J.shift(ctx, R(), 0.15), 0.3, 1).toFixed(3);
      if (seeds.lloyd_iterations != null) seeds.lloyd_iterations = Math.max(0, Math.min(12, seeds.lloyd_iterations + Math.round((R() * 2 - 1) * 2)));
      if (seeds.size_ratio != null) seeds.size_ratio = +mul(seeds.size_ratio, 1.1, 4, R()).toFixed(3);
      if (seeds.large_fraction != null) seeds.large_fraction = +J.clamp(seeds.large_fraction + J.shift(ctx, R(), 0.10), 0.05, 0.9).toFixed(3);
      if (seeds.jitter != null && LAT.indexOf(seeds.mode) >= 0) seeds.jitter = +J.clamp(seeds.jitter * (M[0] + R() * (M[1] - M[0])), 0, 1).toFixed(3);
      seeds.rng_seed = 1 + Math.floor(R() * 2147483646);
      delete seeds.positions; delete seeds.weights; delete seeds.positions_for;
      delete seeds.count_actual; delete seeds.min_spacing;
    }
    return {
      family: 'foam',
      meta: Object.assign({}, base.meta || {}),
      domain: J.clone(base.domain || { world: [-5, 5], periodic: true }),
      seeds, anisotropy, geometry: g
    };
  }
};
