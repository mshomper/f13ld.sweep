/* ============================================================
   F13LD.sweep · families/fam-noise.js
   Noise: how a design is varied around the loaded recipe.

   The design recipe is F13LD.noise's export shape. Noise type, seed,
   octaves, cellular distance metric, worley jitter and vein settings stay
   as authored (Neighbourhood). Varied × (1 ± spread) around the recipe:
     frequency · scale_x/y/z (the field's own anisotropy — noise has no
     separate cell scale; their geometric mean is held at the recipe's so
     they don't repeat the frequency draw) · center (± 0.40 at 25 % spread
     — sheet and solid modes; for half it is the density knob) ·
     lacunarity / gain for octave types · warp strength · curl step /
     potential scale.
   The density knob (half-width, or center for half) is set by
   41-density.js.
   Explore also redraws the seed, octaves (± 2) and the cellular metric.
   The normalization range is then recomputed exactly as F13LD.noise's
   export does and written to norm_min / norm_max, so F13LD.mesh prints
   the design with the same range the sweep solved it with.
   ============================================================ */

SWEEP_FAMILIES.noise = {
  label: 'noise',
  usesCellScale: false,

  nominalScale() { return 1.0; },

  describe(recipe) {
    const s = recipe.surface || {}, g = recipe.geometry || {};
    const p = NoiseKernel._readField(s);
    return `family: noise · type: ${p.noiseType} · freq ${p.frequency} · scales [${p.scaleX}, ${p.scaleY}, ${p.scaleZ}]` +
           ` · seed ${p.seed} · mode ${g.mode || 'sheet'}${g.half_invert ? ' (inverted)' : ''} · center ${s.center ?? 0} · half-width ${s.half_width ?? 0.15}`;
  },

  summary(recipe) {
    const s = recipe.surface;
    return `${s.noise_type}@f${s.frequency} [${s.scale_x},${s.scale_y},${s.scale_z}] iso=${s.center} hw=${s.half_width}`;
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = ctx.rand || Math.random;
    const M = J.spreadMult(ctx);
    const s0 = base.surface, g0 = base.geometry || {};
    const p = NoiseKernel._readField(s0);
    const s = J.clone(s0);

    s.frequency = +J.mul(p.frequency, [0.05, 1.50], ctx.u(), M).toFixed(3);
    /* per-axis scale around the recipe's, geometric mean held */
    const sc = [p.scaleX, p.scaleY, p.scaleZ].map(v => v * (M[0] + ctx.u() * (M[1] - M[0])));
    const gm0 = Math.cbrt(p.scaleX * p.scaleY * p.scaleZ), gm = Math.cbrt(sc[0] * sc[1] * sc[2]);
    s.scale_x = +J.clamp(sc[0] * gm0 / gm, 0.2, 5).toFixed(3);
    s.scale_y = +J.clamp(sc[1] * gm0 / gm, 0.2, 5).toFixed(3);
    s.scale_z = +J.clamp(sc[2] * gm0 / gm, 0.2, 5).toFixed(3);
    if ((g0.mode || 'sheet') !== 'half') {
      const iso0 = s0.center != null ? s0.center : 0;
      s.center = +J.clamp(iso0 + J.shift(ctx, ctx.u(), 0.40), -0.95, 0.95).toFixed(3);
    }

    const t = p.noiseType;
    if (t === 'fbm' || t === 'ridged' || t === 'billow' || t === 'warp') {
      const oct0 = p.octaves || 4;
      if (ctx.explore) s.octaves = Math.max(1, Math.min(Math.max(4, oct0 + 2), oct0 + Math.round((R() * 2 - 1) * 2)));
      s.lacunarity = +J.mul(p.lacunarity || 2.0, [1.2, 3.5], R(), M).toFixed(2);
      s.gain = +J.mul(p.gain || 0.5, [0.1, 0.9], R(), M).toFixed(2);
    }
    if (t === 'warp') s.warp_strength = +J.mul(p.warpStrength, [0.0, 4.0], R(), M).toFixed(2);
    if (t === 'curl') {
      s.curl_step = +J.mul(p.curlStep || 0.1, [0.05, 0.6], R(), M).toFixed(2);
      s.potential_scale = +J.mul(p.potentialScale || 1.0, [0.5, 3.5], R(), M).toFixed(2);
    }
    if (ctx.explore) {
      s.seed = Math.floor(R() * 100000);
      if (t === 'cellular') s.distance_metric = ['euclidean', 'manhattan', 'chebyshev'][Math.floor(R() * 3)];
    }

    delete s.norm_for;
    stampNoiseRange(s);
    return { meta: Object.assign({}, base.meta || {}), family: 'noise', surface: s, geometry: J.clone(g0) };
  }
};
