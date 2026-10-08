/* ============================================================
   F13LD.sweep · families/fam-noise.js
   Noise: how a design is varied around the loaded recipe.

   The design recipe is F13LD.noise's export shape. Noise type, seed,
   worley jitter and vein settings stay as authored. Varied, anchored to
   the recipe (× [0.75, 1.25] unless noted):
     frequency · scale_x/y/z (the field's own anisotropy — noise has no
     separate cell scale) · center (± 0.40) · half_width (target-aware
     window) · octaves (± 2) / lacunarity / gain for octave types · warp
     strength · curl step / potential scale · cellular distance metric
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
    const MULT = [0.75, 1.25];
    const MULT_HW = (ctx.targetHints && ctx.targetHints.halfWidth_mult) || MULT;
    const dimOff = 4;
    const s0 = base.surface;
    const p = NoiseKernel._readField(s0);
    const s = J.clone(s0);

    s.frequency = +J.mul(p.frequency, [0.05, 1.50], draw.u(dimOff), MULT).toFixed(3);
    s.scale_x = +J.mul(p.scaleX, [0.20, 5.00], draw.u(dimOff + 1), MULT).toFixed(3);
    s.scale_y = +J.mul(p.scaleY, [0.20, 5.00], draw.u(dimOff + 2), MULT).toFixed(3);
    s.scale_z = +J.mul(p.scaleZ, [0.20, 5.00], draw.u(dimOff + 3), MULT).toFixed(3);
    const iso0 = s0.center != null ? s0.center : 0;
    s.center = +J.clamp(iso0 + (R() * 2 - 1) * 0.40, -0.95, 0.95).toFixed(3);
    const hw0 = s0.half_width != null ? s0.half_width : 0.15;
    s.half_width = +J.mul(hw0, [0.02, 0.40], R(), MULT_HW).toFixed(3);

    const t = p.noiseType;
    if (t === 'fbm' || t === 'ridged' || t === 'billow' || t === 'warp') {
      const oct0 = p.octaves || 4;
      const octMax = Math.max(4, oct0 + 2);
      s.octaves = Math.max(1, Math.min(octMax, oct0 + Math.round((R() * 2 - 1) * 2)));
      s.lacunarity = +J.mul(p.lacunarity || 2.0, [1.2, 3.5], R(), MULT).toFixed(2);
      s.gain = +J.mul(p.gain || 0.5, [0.1, 0.9], R(), MULT).toFixed(2);
    }
    if (t === 'warp') s.warp_strength = +J.mul(p.warpStrength, [0.0, 4.0], R(), MULT).toFixed(2);
    if (t === 'curl') {
      s.curl_step = +J.mul(p.curlStep || 0.1, [0.05, 0.6], R(), MULT).toFixed(2);
      s.potential_scale = +J.mul(p.potentialScale || 1.0, [0.5, 3.5], R(), MULT).toFixed(2);
    }
    if (t === 'cellular') s.distance_metric = ['euclidean', 'manhattan', 'chebyshev'][Math.floor(R() * 3)];

    delete s.norm_for;
    stampNoiseRange(s);
    return { meta: Object.assign({}, base.meta || {}), family: 'noise', surface: s, geometry: J.clone(base.geometry || {}) };
  }
};
