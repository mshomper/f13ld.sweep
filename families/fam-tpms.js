/* ============================================================
   F13LD.sweep · families/fam-tpms.js
   TPMS: how a design is varied around the loaded recipe.

   The design recipe is F13LD.tpms's export shape with a terms surface:
   a raw preset is expanded through the shared preset table, its additive
   constant kept as a zero-factor term (so solid / shell / PI-TPMS all
   keep the preset's level, as F13LD.mesh does). Coefficients are
   normalised to max |c| = 1 (the constant term scales with them).

   v0.26.0 — Neighbourhood (default): the surface keeps its identity —
     every term, trig function, frequency, sign and phase as the recipe
     has them; each term's coefficient × (1 ± spread); shell normal-weights
     × (1 ± spread) around the recipe's own (target-aware axis bias);
     PI-TPMS keeps its phase shift and field pair.
   Explore: the v0.25 redraw — trig swap, integer frequencies 1–3, term
     mask, sign flip, a random phase per term (solid / shell), PI-TPMS
     phase shift in eighths, normal-weights drawn afresh.
   Either way the density knob (solid offset, shell wall, PI pipe radius)
   is set by 41-density.js, and the per-axis cell scale → cell_scale_x/y/z.
   Field-pair PI-TPMS: field B and its frequency multiple are kept;
   field_b_scale is recomputed for the new field A.
   ============================================================ */

SWEEP_FAMILIES.tpms = {
  label: 'TPMS',
  usesCellScale: true,

  nominalScale(recipe) { return (recipe.geometry && recipe.geometry.cell_scale) || 1.0; },

  /* Field A terms of a recipe, with a raw preset's constant as a zero-factor term. */
  baseTerms(recipe) {
    const s = recipe.surface || {};
    if (s.type === 'raw_preset') {
      const e = TPMS_RAW_PRESET_TABLE[s.preset];
      if (!e) throw new Error(`TPMS preset "${s.preset}" is not in the shared preset table`);
      const t = jitterUtil.clone(e.terms);
      if (e.constant) t.push({ on: true, coef: e.constant, factors: [] });
      return t;
    }
    if (!Array.isArray(s.terms)) throw new Error('TPMS recipe has neither terms nor a preset');
    return jitterUtil.clone(s.terms);
  },

  describe(recipe) {
    const g = recipe.geometry || {}, s = recipe.surface || {};
    const m = g.mode || 'shell';
    const what = s.type === 'raw_preset' ? `preset ${s.label || s.preset}` : `${(s.terms || []).length} terms${s.preset ? ' (' + s.preset + ')' : ''}`;
    const pair = recipe.surface_b ? ` × ${recipe.surface_b.label || recipe.surface_b.preset || 'field B'}` : '';
    const k = (g.field_b_freq || 1) > 1 ? ` (B ${g.field_b_freq}×)` : '';
    let norm = '';
    if (m === 'pi-tpms') norm = ` · pi_normalize ${g.pi_normalize ? 'on' : 'off'}`;
    else if (m === 'shell') norm = ` · shell_normalize ${g.shell_normalize ? 'on' : 'off'}`;
    return `family: tpms · ${what}${pair}${k} · mode ${m}${norm}`;
  },

  summary(recipe) {
    return (recipe.surface.terms || []).filter(t => t.on && t.factors.length).map(t => t.factors.map(f => f.trig[0]).join('')).join('|');
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = ctx.rand || Math.random;
    const g0 = base.geometry || {};
    const mode = g0.mode || 'shell';
    const isPI = mode === 'pi-tpms';
    const [ax, ay, az] = ctx.axialShift || [0, 0, 0];
    const M = J.spreadMult(ctx);
    const TWO_PI = 2 * Math.PI;

    /* ── terms ── */
    let terms;
    if (!ctx.explore) {
      terms = this.baseTerms(base).map(t => {
        if (!t.factors.length) return t;                               /* additive constant */
        const out = J.clone(t);
        out.coef = +(t.coef * (M[0] + ctx.u() * (M[1] - M[0]))).toFixed(4);
        return out;
      });
    } else {
      const TRIG_SWAP = 0.20, FREQS = isPI ? [1] : [1, 2, 3];
      const TERM_ON = isPI ? 1.0 : 0.85, SIGN_FLIP = isPI ? 0.0 : 0.20, PER_TERM_PHASE = !isPI;
      const pickFreq = () => FREQS[Math.floor(R() * FREQS.length)];
      terms = this.baseTerms(base).map(t => {
        if (!t.factors.length) return { on: true, coef: t.coef, factors: [] };
        const on = R() < TERM_ON;
        let coef = +(0.05 + ctx.u() * 4.95).toFixed(3);
        if (R() < SIGN_FLIP) coef = -coef;
        const out = {
          on, coef,
          factors: t.factors.map(f => {
            let trig = f.trig;
            if (R() < TRIG_SWAP) trig = trig.startsWith('sin') ? trig.replace('sin', 'cos') : trig.replace('cos', 'sin');
            return { trig, fx: pickFreq(), fy: pickFreq(), fz: pickFreq() };
          })
        };
        if (PER_TERM_PHASE) out.phase_shift = { x: +(R() * TWO_PI).toFixed(4), y: +(R() * TWO_PI).toFixed(4), z: +(R() * TWO_PI).toFixed(4) };
        return out;
      });
    }
    const varied = terms.filter(t => t.factors.length && t.on !== false);
    const maxAbs = Math.max(0, ...varied.map(t => Math.abs(t.coef)));
    if (maxAbs > 0) terms.forEach(t => { t.coef = +(t.coef / maxAbs).toFixed(4); });

    const g = J.clone(g0);
    g.mode = mode;

    /* ── mode geometry (the density knob itself is set by 41-density.js) ── */
    if (isPI) {
      if (g.pipe_radius == null) g.pipe_radius = 0.18;
      if (ctx.explore) {
        const E = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
        let px, py, pz;
        do { px = E[Math.floor(R() * E.length)]; py = E[Math.floor(R() * E.length)]; pz = E[Math.floor(R() * E.length)]; }
        while (px === 0 && py === 0 && pz === 0);
        g.phase_shift = { x: px, y: py, z: pz };
      }
      g.offset = null;
    } else if (mode === 'shell') {
      if (g.wall_thickness == null) g.wall_thickness = 0.3;
      if (g.offset == null) g.offset = 0;
      /* normal weights: around the recipe's own (neighbourhood) or drawn
         afresh (explore); an axial target pressure thickens that axis */
      const nw0 = g0.normal_weights || { wx: 1, wy: 1, wz: 1 };
      let w;
      if (ctx.explore) {
        const W = 1.20;
        w = [(0.40 + ax * 1.20) + ctx.u() * W, (0.40 + ay * 1.20) + R() * W, (0.40 + az * 1.20) + R() * W];
      } else {
        w = [[nw0.wx, ax], [nw0.wy, ay], [nw0.wz, az]].map(([b, a]) => Math.max(0.05, b * (M[0] + ctx.u() * (M[1] - M[0])) * (1 + 2 * a)));
      }
      const mean = (w[0] + w[1] + w[2]) / 3;
      g.normal_weights = { wx: +(w[0] / mean).toFixed(4), wy: +(w[1] / mean).toFixed(4), wz: +(w[2] / mean).toFixed(4) };
    } else {
      if (g.offset == null) g.offset = 0;
    }

    /* ── cell scale ── */
    const [sx, sy, sz] = ctx.scale;
    g.cell_scale_x = +sx.toFixed(3); g.cell_scale_y = +sy.toFixed(3); g.cell_scale_z = +sz.toFixed(3);
    g.cell_scale = +Math.cbrt(g.cell_scale_x * g.cell_scale_y * g.cell_scale_z).toFixed(4);

    const rec = {
      meta: Object.assign({}, base.meta || {}),
      family: 'tpms',
      surface: { type: 'terms', preset: (base.surface && (base.surface.label || base.surface.preset)) || 'custom', terms },
      surface_b: isPI && base.surface_b ? J.clone(base.surface_b) : null,
      geometry: g
    };
    /* field-pair PI-TPMS: amplitude match for the new field A, as F13LD.tpms writes it */
    if (isPI && base.surface_b) {
      const sb = base.surface_b;
      const tB = sb.type === 'raw_preset' ? tpmsPresetTermsWithConstant(sb.preset) : sb.terms;
      const ra = tpmsFieldRMS((x, y, z) => evaluateTpms(terms, x, y, z));
      const rb = tpmsFieldRMS((x, y, z) => evaluateTpms(tB, x, y, z));
      g.field_b_scale = (ra > 1e-9 && rb > 1e-9) ? +(ra / rb).toFixed(6) : 1;
    }
    return rec;
  }
};
