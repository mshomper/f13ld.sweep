/* ============================================================
   F13LD.sweep · families/fam-wave.js   (v0.29.0)
   Wave: how a design is varied around the loaded recipe.

   The design recipe is F13LD.wave's export shape — field { symmetry,
   modes [{ n, m, p, A, phi }], mode solid | sheet, iso, thickness,
   signFlip (phase A / B), phaseTime, cellScale, stretch } — read by the
   shared WaveKernel (geom/wave.js). One wave cell is one solver cell. Each
   mode is A·cos(phi + phaseTime) times its symmetry sum.
   Stretch (Matt, 2026-10-10): field.stretch = the cell's relative edges
   [x, y, z], geometric mean 1, drawn from the Cell scale ranges × the
   recipe's own stretch — the solver solves the stretched cell, F13LD.mesh
   and F13LD.wave draw it stretched. Cubic, Chiral and Schoen give equal
   axes on a cube; the stretch is what lets them differ.

   Only whole-number mode indices load: a fractional index repeats over
   several cells (Mesh bakes a supercell), and Sweep, Lab and F13LD.wave's
   own homogenisation solve one cell (Matt, 2026-10-10). Recipes whose
   field is zero everywhere (Chladni with two equal indices, Schoen with
   a zero first index …) are refused too.

   Neighbourhood (default) keeps the symmetry, the mode list and its
   indices, solid / sheet and phase A / B. What varies:
     · each mode's amplitude × (1 ± spread), sign kept (0 stays 0)
     · each mode's phase and the phase time, shifted (± 0.5 rad at 25 %
       spread) — kept on the same side of cos = 0, so no mode vanishes or
       flips sign in Neighbourhood
     · sheet: the iso level, shifted by up to ± a quarter of the field's
       RMS at 25 % spread (Matt, 2026-10-10: with the iso off centre the
       phase time changes the surface). Solid: the iso level is the
       density knob, so it is not drawn here.
   Explore also nudges mode indices (each mode, half the time, one of its
   three indices ± 1, kept 0–8 like F13LD.wave's inputs), lets phases and
   the phase time move twice as far and cross zero, and redraws when a draw
   cancels to a zero field. A single-mode recipe starts in Explore — with
   one mode only the density moves in Neighbourhood (solid) — but the user
   can switch back.
   The density knob — iso (solid) or thickness (sheet) — is set by
   41-density.js.
   ============================================================ */

/* waveRecipeProblem / waveFieldBound / waveFieldRMS live in 40-design.js
   (the solver worker needs them for the density knob). */

function waveModeText(modes) {
  return modes.map(mm => `(${mm.n},${mm.m},${mm.p})`).join('·');
}

SWEEP_FAMILIES.wave = {
  label: 'wave',
  usesCellScale: true,                 /* drives field.stretch (the cell's edges) */

  nominalScale() { return 1.0; },

  /* refused at load (20-recipe-load.js) */
  loadProblem(recipe) { return waveRecipeProblem(recipe); },
  /* a single mode starts in Explore (20-recipe-load.js) */
  prefersExplore(recipe) { return ((recipe.field || {}).modes || []).length === 1; },

  describe(recipe) {
    const f = recipe.field || {}, modes = f.modes || [];
    const th = (f.mode === 'sheet' ? ` · thickness ${f.thickness}` : '') + (Array.isArray(f.stretch) ? ` · stretch [${f.stretch.join(', ')}]` : '');
    return `family: wave · ${f.symmetry || 'pure'} · ${modes.length} mode${modes.length === 1 ? '' : 's'} ${waveModeText(modes)}` +
           ` · ${f.mode === 'sheet' ? 'sheet' : 'solid'} · phase ${f.signFlip ? 'B' : 'A'} · iso ${f.iso != null ? f.iso : 0}${th}` +
           `${f.phaseTime ? ` · phase time ${(+f.phaseTime).toFixed(2)}` : ''}`;
  },

  summary(recipe) {
    const f = recipe.field || {}, modes = f.modes || [];
    const amps = modes.map(mm => (+(mm.A != null ? mm.A : 1)).toFixed(2)).join(',');
    const th = (f.mode === 'sheet' ? ` t=${(+f.thickness).toFixed(3)}` : '') +
      (Array.isArray(f.stretch) && f.stretch.some(v => Math.abs(v - 1) > 1e-4) ? ` [${f.stretch.map(v => (+v).toFixed(2)).join(',')}]` : '');
    return `${f.symmetry || 'pure'} ${waveModeText(modes)} A[${amps}] ${f.mode === 'sheet' ? 'sheet' : 'solid'}${f.signFlip ? ' B' : ''} iso=${(+(f.iso || 0)).toFixed(3)}${th}`;
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = ctx.rand || Math.random;
    const M = J.spreadMult(ctx);
    const f0 = base.field || {};
    const t0 = typeof f0.phaseTime === 'number' ? f0.phaseTime : 0;
    const modes0 = (f0.modes || []).map(mm => ({ n: mm.n, m: mm.m, p: mm.p, A: mm.A != null ? mm.A : 1, phi: mm.phi || 0 }));
    const sheet = f0.mode === 'sheet';
    const range = ctx.explore ? 1.0 : 0.5;          /* rad at 25 % spread */

    /* Phase time and phases: in Neighbourhood a shift that would take a
       mode across cos = 0 (vanish or flip) is halved until it doesn't. */
    const keepsSign = (phi, t, phiB, tB) => {
      const c0 = Math.cos(phiB + tB), c = Math.cos(phi + t);
      return Math.abs(c0) < 1e-9 ? Math.abs(c) < 1e-9 : (c * c0 > 0 && Math.abs(c) >= 0.15 * Math.abs(c0));
    };
    /* Sobol order: amplitudes, the sheet's iso shift, the phase time; phases on the seeded stream */
    const uA = modes0.map(() => ctx.u()), uIso = sheet ? ctx.u() : 0, uT = ctx.u(), uPhi = modes0.map(() => R());

    let dt = J.shift(ctx, uT, range);
    const okT = d => modes0.every(mm => keepsSign(mm.phi, t0 + d, mm.phi, t0));
    if (!ctx.explore) { for (let k = 0; k < 4 && !okT(dt); k++) dt *= 0.5; if (!okT(dt)) dt = 0; }
    const t = t0 + dt;

    const modes = modes0.map((mm, i) => {
      const A = mm.A === 0 ? 0 : (Math.sign(mm.A) * J.mul(Math.abs(mm.A), [1e-3, 1e3], uA[i], M));
      let d = J.shift(ctx, uPhi[i], range);
      if (!ctx.explore) { for (let k = 0; k < 4 && !keepsSign(mm.phi + d, t, mm.phi, t0); k++) d *= 0.5; if (!keepsSign(mm.phi + d, t, mm.phi, t0)) d = 0; }
      return { n: mm.n, m: mm.m, p: mm.p, A: +A.toFixed(4), phi: +(((mm.phi + d) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).toFixed(4) };
    });

    const field = J.clone(f0);
    field.phaseTime = +t.toFixed(4);
    /* the cell's stretch: Cell scale draw × the recipe's stretch, geometric mean 1 */
    const st0 = Array.isArray(f0.stretch) && f0.stretch.length === 3 ? f0.stretch.map(v => (isFinite(v) && v > 0) ? v : 1) : [1, 1, 1];
    const sc = ctx.scale || [1, 1, 1];
    let st = st0.map((v, i) => J.clamp(v * sc[i], 0.2, 5));
    const gm = Math.cbrt(st[0] * st[1] * st[2]);
    field.stretch = st.map(v => +(v / gm).toFixed(4));
    field.modes = modes;

    /* Explore: nudge indices, keeping a non-zero field */
    if (ctx.explore) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const trial = modes.map(mm => {
          const q = { ...mm };
          if (R() < 0.5) {
            const k = ['n', 'm', 'p'][Math.floor(R() * 3)];
            q[k] = Math.max(0, Math.min(8, q[k] + (R() < 0.5 ? -1 : 1)));
          }
          return q;
        });
        /* every mode must still add shape on its own: not (0,0,0) — a constant, i.e. only an iso
           shift — and not one that cancels under the symmetry */
        const live = trial.every(q => (q.n || q.m || q.p) &&
          !waveRecipeProblem({ field: { ...field, modes: [{ ...q, A: 1, phi: 0 }], phaseTime: 0 } }));
        if (live && !waveRecipeProblem({ field: { ...field, modes: trial } })) { field.modes = trial; break; }
      }
    }
    /* a draw that cancels the field keeps the recipe's own modes */
    if (waveRecipeProblem({ field })) { field.modes = modes0.map(mm => ({ ...mm })); field.phaseTime = t0; }

    /* sheet: the iso shift, scaled with the field's RMS (solid: density knob) */
    if (sheet) {
      const rms = waveFieldRMS({ field }) || 1;
      const iso0 = typeof f0.iso === 'number' ? f0.iso : 0;
      field.iso = +J.clamp(iso0 + J.shift(ctx, uIso, 0.25 * rms), -2 * rms, 2 * rms).toFixed(4);
    }

    return {
      schema: base.schema || 'f13ld.wave/v1',
      family: 'wave',
      meta: Object.assign({}, base.meta || {}),
      field,
      domain: J.clone(base.domain || { unit: 'mm', size: 10, bounds: [-5, 5] }),
      coordinate: J.clone(base.coordinate || { convention: 'f13ld', worldScale: Math.PI / 5, periodicityRadians: 2 * Math.PI, signConvention: 'negative-inside' })
    };
  }
};
