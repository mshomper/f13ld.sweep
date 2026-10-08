/* ============================================================
   F13LD.sweep · families/fam-grain.js
   Grain: how a design is varied around the loaded recipe.

   The design recipe is F13LD.grain's export shape. Field type and
   direction mode stay as authored. Varied (× [0.75, 1.25] unless noted):
     random seed (a fresh draw per design — every design is a new
     realization; v0.20 reused one seed for the whole sweep) · frequency ·
     center (± 0.40) · half_width (target-aware window) · principal
     direction (von Mises–Fisher draw around the recipe's, κ from the
     recipe's κ) · spinodoid: wave count, κ · GRF: wave count, σ, κ ·
     hyperuniform: count, aspect, width, κ, transverse ellipticity
   Orthotropic weights, cross-section shape and the wrap flag are kept.
   Grain has no cell scale.
   ============================================================ */

SWEEP_FAMILIES.grain = {
  label: 'grain',
  usesCellScale: false,

  nominalScale() { return 1.0; },

  _base: new WeakMap(),            /* parsed base recipe, reused for every design of a sweep */

  describe(recipe) {
    const f = recipe.field || {}, g = recipe.geometry || {};
    const topo = `${g.topology || 'sheet'}${g.half_invert ? ' (inverted)' : ''} · iso ${g.center ?? 0} · hw ${g.half_width ?? 0.15}`;
    if (f.type === 'spinodoid')    return `family: grain · spinodoid · N=${f.n_waves} κ=${f.kappa} f=${f.frequency} · ${f.dir_mode || 'single'} · ${topo}`;
    if (f.type === 'gaussian')     return `family: grain · GRF · σ=${f.grf_sigma} N=${f.n_waves} f=${f.frequency} · ${f.dir_mode || 'single'} · ${topo}`;
    if (f.type === 'hyperuniform') return `family: grain · hyperuniform · N=${f.hu_n} aspect=${f.hu_aspect} w=${f.hu_width} · ${topo}`;
    return `family: grain · ${f.type}`;
  },

  summary(recipe) {
    const f = recipe.field, g = recipe.geometry || {};
    const tail = `iso=${g.center} hw=${g.half_width}`;
    if (f.type === 'spinodoid') return `spin N=${f.n_waves} κ=${(+f.kappa).toFixed(1)} f=${f.frequency} ${tail}`;
    if (f.type === 'gaussian')  return `grf σ=${f.grf_sigma} N=${f.n_waves} f=${f.frequency} ${tail}`;
    return `hu N=${f.hu_n} a=${(+f.hu_aspect).toFixed(1)} w=${f.hu_width} ${tail}`;
  },

  jitter(base, draw, ctx) {
    const J = jitterUtil, R = Math.random;
    const MULT = [0.75, 1.25];
    const MULT_HW = (ctx.targetHints && ctx.targetHints.halfWidth_mult) || MULT;
    const dimOff = 4;
    let p = this._base.get(base);
    if (!p) { p = GrainKernel.parseRecipe({ field: J.clone(base.field), geometry: J.clone(base.geometry || {}) }); this._base.set(base, p); }
    const f = J.clone(base.field), g = J.clone(base.geometry || {});

    f.rng_seed = 1 + Math.floor(R() * 2147483646);
    f.frequency = +J.mul(p.frequency, [0.05, 1.50], draw.u(dimOff), MULT).toFixed(3);
    g.center = +J.clamp(p.isoLevel + (draw.u(dimOff + 1) * 2 - 1) * 0.40, -0.95, 0.95).toFixed(3);
    g.half_width = +J.mul(p.halfWidth, [0.02, 0.40], draw.u(dimOff + 2), MULT_HW).toFixed(3);

    /* direction: vMF draw around the recipe's principal direction */
    if ((f.dir_mode || 'single') === 'single') {
      const dirKappa = J.clamp(Math.max(4, p.kappa) * (MULT[0] + R() * (MULT[1] - MULT[0])), 2, 20);
      const rng = GrainKernel._mulberry32(f.rng_seed ^ 0xDEADBEEF);
      const v = GrainKernel._rotateTo(GrainKernel._sampleVMF(rng, dirKappa), p.principalX, p.principalY, p.principalZ);
      f.principal_direction = [+v[0].toFixed(4), +v[1].toFixed(4), +v[2].toFixed(4)];
    }

    const ft = p.fieldType;
    if (ft === 'spinodoid') {
      f.n_waves = Math.round(J.mul(p.nWaves || 48, [16, 128], R(), MULT));
      f.kappa = +J.mul(p.kappa, [0, 20], R(), MULT).toFixed(2);
    } else if (ft === 'gaussian') {
      f.n_waves = Math.round(J.mul(p.nWaves || 48, [16, 128], R(), MULT));
      f.grf_sigma = +J.mul(p.grfSigma || 0.45, [0.05, 0.80], R(), MULT).toFixed(3);
      f.kappa = +J.mul(p.kappa, [0, 20], R(), MULT).toFixed(2);
    } else {
      f.hu_n = Math.round(J.mul(p.huN || 80, [30, 200], R(), MULT));
      f.hu_aspect = +J.mul(p.huAspect || 4.0, [1.0, 8.0], R(), MULT).toFixed(2);
      f.hu_width = +J.mul(p.huWidth || 0.04, [0.02, 0.20], R(), MULT).toFixed(3);
      f.kappa = +J.mul(p.kappa, [0, 20], R(), MULT).toFixed(2);
      let tE = Math.log(p.huEll || 1.0) / Math.log(4) + (R() * 2 - 1) * 0.40;
      tE = J.clamp(tE, -1, 1);
      f.hu_ell = +Math.pow(4, tE).toFixed(3);
    }
    return { meta: Object.assign({}, base.meta || {}), family: 'grain', field: f, geometry: g };
  }
};
