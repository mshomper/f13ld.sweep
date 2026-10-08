/* ============================================================
   F13LD.sweep · families/fam-tpms.js
   TPMS: how a design is varied around the loaded recipe.

   The design recipe is F13LD.tpms's export shape with a terms surface:
     · a raw preset is expanded through the shared preset table, its
       additive constant kept as a zero-factor term (so solid / shell /
       PI-TPMS all keep the preset's level, as F13LD.mesh does)
     · terms: trig swap, integer frequencies, term mask, sign flip,
       per-term phase (solid / shell); PI-TPMS keeps frequency 1, all
       terms on, no flip, no per-term phase. Coefficients are normalised
       to max |c| = 1 (the constant term scales with them)
     · solid: offset ± 0.2 · shell: wall × [0.7, 1.3] (target-aware) and
       normal_weights · PI-TPMS: pipe radius and a phase shift in eighths
     · per-axis cell scale → cell_scale_x/y/z
     · field-pair PI-TPMS: field B and its frequency multiple are kept;
       field_b_scale is recomputed for the new field A
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
    const J = jitterUtil, R = Math.random;
    const g0 = base.geometry || {};
    const mode = g0.mode || 'shell';
    const isPI = mode === 'pi-tpms';
    const hints = ctx.targetHints || null;
    const [ax, ay, az] = ctx.axialShift || [0, 0, 0];

    /* ── terms ── */
    const TRIG_SWAP = 0.20, FREQS = isPI ? [1] : [1, 2, 3];
    const TERM_ON = isPI ? 1.0 : 0.85, SIGN_FLIP = isPI ? 0.0 : 0.20, PER_TERM_PHASE = !isPI;
    const TWO_PI = 2 * Math.PI, dimOff = 4;
    const pickFreq = () => FREQS[Math.floor(R() * FREQS.length)];
    let ti = 0;
    const terms = this.baseTerms(base).map(t => {
      if (!t.factors.length) return { on: true, coef: t.coef, factors: [] };   /* additive constant */
      const i = ti++;
      const on = R() < TERM_ON;
      let coef = +(0.05 + (i < 4 ? draw.u(dimOff + i) : R()) * 4.95).toFixed(3);
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
    const varied = terms.filter(t => t.factors.length);
    const maxAbs = Math.max(0, ...varied.map(t => Math.abs(t.coef)));
    if (maxAbs > 0) terms.forEach(t => { t.coef = +(t.coef / maxAbs).toFixed(3); });

    const g = J.clone(g0);
    g.mode = mode;

    /* ── mode geometry ── */
    if (isPI) {
      const basePipe = g0.pipe_radius != null ? g0.pipe_radius : 0.18;
      const pm = hints && hints.pipe_radius_mult;
      const lo = pm ? pm[0] * 0.857 : 0.6;                       /* [0.75,1.25] → [0.6,1.4] */
      g.pipe_radius = +J.clamp(basePipe * (lo + draw.u(3) * 0.8), 0.02, 0.35).toFixed(3);
      const E = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
      let px, py, pz;
      do { px = E[Math.floor(R() * E.length)]; py = E[Math.floor(R() * E.length)]; pz = E[Math.floor(R() * E.length)]; }
      while (px === 0 && py === 0 && pz === 0);
      g.phase_shift = { x: px, y: py, z: pz };
      g.offset = null;
    } else if (mode === 'shell') {
      const W = 1.20;
      const rx = (0.40 + ax * 1.20) + draw.u(3) * W;
      const ry = (0.40 + ay * 1.20) + R() * W;
      const rz = (0.40 + az * 1.20) + R() * W;
      const mean = (rx + ry + rz) / 3;
      g.normal_weights = { wx: +(rx / mean).toFixed(4), wy: +(ry / mean).toFixed(4), wz: +(rz / mean).toFixed(4) };
      const wm = hints && hints.wt_mult;
      const wLo = wm ? wm[0] - 0.05 : 0.70;                      /* [0.75,1.25] → [0.70,1.30] */
      const baseWall = g0.wall_thickness != null ? g0.wall_thickness : 0.3;
      g.wall_thickness = +(baseWall * (wLo + R() * 0.60)).toFixed(3);
      g.offset = g0.offset != null ? g0.offset : 0;
    } else {
      g.offset = +((g0.offset != null ? g0.offset : 0) + (draw.u(3) - 0.5) * 0.4).toFixed(3);
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
