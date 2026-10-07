/* ============================================================
   F13LD.sweep · fam-grain.js
   GrainKernel: spinodoid, GRF and hyperuniform from F13LD.grain.
   ============================================================ */

// ─── GrainKernel ─── spinodoid + GRF + hyperuniform from F13LD.grain ─────────
// ═════════════════════════════════════════════════════════════════════════════
//
// Path E3: ports the F13LD.grain analytic field generators into the sweep's
// FieldKernel interface. Three field types are in scope; reaction-diffusion
// is deferred (texture-based, doesn't fit the analytic-evaluator contract
// that lets the sweep run thousands of designs cheaply).
//
//   spinodoid    — VMF-sampled wave directions, uniform magnitude
//                  field = Σᵢ cos(kᵢ·p + φᵢ) / √N
//   gaussian     — uniform directions, Gaussian-sampled magnitude (GRF)
//                  field = Σᵢ cos(kᵢ·p + φᵢ) / √N
//   hyperuniform — anisotropic Gaussian kernels at jittered grid points
//                  field = Σᵢ exp(-Q(p - cᵢ)) - 0.3
//
// Solver coords are [-π,π]³ — same convention as NoiseKernel and the existing
// sweep engine. No remapping needed.
//
// Stochasticity: each field type uses mulberry32(rng_seed) to draw waves or
// kernels deterministically. parseRecipe and jitterParams bake the result
// (params.waves or params.kernels) into the opaque params payload, so workers
// receive deterministic field definitions without needing PRNG state of their
// own. This mirrors how NoiseKernel inlines its prepass result.
//
// Field range: NOT normalized to [-1,1] like noise. The grain field is left
// at its natural scale because the F13LD.grain export's geometry.center and
// geometry.half_width are calibrated against this raw scale. Sweep applyMode
// integration (E3 P2) will use raw isoLevel/halfWidth directly.

const GrainKernel = {
  family: 'grain',

  // ── Stochastic primitives — verbatim port from F13LD.grain ────────────────
  // These are used by _buildSpinodoidWaves / _buildGRFWaves / _buildHUKernels
  // on the main thread. They get stringified into the worker bundle along
  // with the rest of the kernel object, but workers never invoke them
  // (waves/kernels are baked into params before dispatch).
  _mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >> 17)) >>> 0;
      s = (s ^ (s << 5))  >>> 0;
      return s / 4294967296;
    };
  },

  // von Mises-Fisher around the +z pole (caller rotates with _rotateTo)
  _sampleVMF(rng, kappa) {
    if (kappa < 0.05) {
      const z = 2*rng() - 1, phi = 2*Math.PI*rng();
      const sr = Math.sqrt(Math.max(0, 1 - z*z));
      return [sr*Math.cos(phi), sr*Math.sin(phi), z];
    }
    let w, iter = 0;
    do {
      const xi = rng();
      w = 1 + Math.log(Math.max(xi + (1 - xi)*Math.exp(-2*kappa), 1e-30)) / kappa;
      iter++;
    } while ((w < -1 || w > 1) && iter < 2000);
    if (w < -1) w = -1; if (w > 1) w = 1;
    const phi = 2*Math.PI*rng(), sr = Math.sqrt(Math.max(0, 1 - w*w));
    return [sr*Math.cos(phi), sr*Math.sin(phi), w];
  },

  // Rotate a +z-pole sample to the (mux, muy, muz) frame
  _rotateTo(v, mux, muy, muz) {
    if (Math.abs(muz + 1) < 1e-6) return [-v[0], -v[1], -v[2]];
    if (Math.abs(muz - 1) < 1e-6) return v.slice();
    let ax = -muy, ay = mux;
    const al = Math.sqrt(ax*ax + ay*ay); ax /= al; ay /= al;
    const angle = Math.acos(Math.min(Math.max(muz, -1), 1));
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const vx = v[0], vy = v[1], vz = v[2];
    return [
      (t*ax*ax + c)*vx + (t*ax*ay)*vy + ( s*ay)*vz,
      (t*ax*ay)*vx    + (t*ay*ay + c)*vy + (-s*ax)*vz,
      (-s*ay)*vx      + (s*ax)*vy        + c*vz
    ];
  },

  // Stratified jittered grid in [0,1]³, N points, Fisher-Yates shuffled
  _jitteredGrid3D(N, rng) {
    const cells = Math.ceil(Math.pow(N, 1/3));
    const cellSize = 1.0 / cells;
    const pts = [];
    for (let ix = 0; ix < cells; ix++)
      for (let iy = 0; iy < cells; iy++)
        for (let iz = 0; iz < cells; iz++) {
          const px = (ix + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          const py = (iy + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          const pz = (iz + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          pts.push([
            Math.max(0.01, Math.min(0.99, px)),
            Math.max(0.01, Math.min(0.99, py)),
            Math.max(0.01, Math.min(0.99, pz))
          ]);
        }
    // Shuffle to remove grid ordering (so orientation sampling isn't
    // correlated with point position).
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
    }
    return pts.slice(0, N);
  },

  // ── Wave/kernel builders ─────────────────────────────────────────────────
  // Each takes a params object with rngSeed + field-type knobs and returns
  // an array of opaque per-wave / per-kernel records that evaluate() loops over.

  // Spinodoid: N waves, VMF-sampled directions (kappa controls anisotropy),
  // magnitude is uniform around 2π·freq with ±15% jitter.
  _buildSpinodoidWaves(p) {
    const rng = this._mulberry32(p.rngSeed);
    const N = p.nWaves, freq = p.frequency, kappa = p.kappa, mode = p.dirMode;
    const mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    const axes   = [[1,0,0],[0,1,0],[0,0,1]];
    const wts    = [p.wX, p.wY, p.wZ];
    const totalW = Math.max(wts[0] + wts[1] + wts[2], 1e-6);
    const waves = [];
    for (let i = 0; i < N; i++) {
      let dir;
      if (mode === 'iso') {
        dir = this._sampleVMF(rng, 0);
      } else if (mode === 'single') {
        dir = this._rotateTo(this._sampleVMF(rng, kappa), mux, muy, muz);
      } else { // 'ortho'
        const r = rng() * totalW;
        let cum = 0, chosen = 0;
        for (let a = 0; a < 3; a++) { cum += wts[a]; if (r <= cum) { chosen = a; break; } }
        dir = this._rotateTo(this._sampleVMF(rng, kappa),
                             axes[chosen][0], axes[chosen][1], axes[chosen][2]);
      }
      const mag = 2*Math.PI*freq*(0.85 + 0.3*rng());
      const phase = 2*Math.PI*rng();
      waves.push({ kx: dir[0]*mag, ky: dir[1]*mag, kz: dir[2]*mag, phase: phase });
    }
    return waves;
  },

  // GRF: N waves, uniform directions on the sphere, magnitudes drawn from
  // Gaussian(k0, sigma·k0) with k0 = 2π·freq, optional directional anisotropy.
  _buildGRFWaves(p) {
    const rng = this._mulberry32(p.rngSeed);
    const N = p.nWaves, freq = p.frequency, mode = p.dirMode;
    const sigmafrac = p.grfSigma || 0.45;
    const k0base = 2*Math.PI*freq;
    const mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    const waves = [];
    function randn() {
      const u = Math.max(rng(), 1e-10), v = rng();
      return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
    }
    for (let i = 0; i < N; i++) {
      const dir = this._sampleVMF(rng, 0); // always uniform direction
      let k0;
      if (mode === 'ortho') {
        let wx = p.wX, wy = p.wY, wz = p.wZ;
        const totalW = Math.max(wx + wy + wz, 1e-6);
        wx /= totalW; wy /= totalW; wz /= totalW;
        const maxW = Math.max(wx, wy, wz);
        let kScale = 1.0 / (Math.max(wx*dir[0]*dir[0] + wy*dir[1]*dir[1] + wz*dir[2]*dir[2], 0.05) / maxW);
        kScale = Math.min(Math.max(kScale, 0.3), 3.0);
        k0 = k0base * kScale;
      } else if (mode === 'single') {
        const alignment = Math.abs(dir[0]*mux + dir[1]*muy + dir[2]*muz);
        k0 = k0base * (1.5 - alignment);
      } else {
        k0 = k0base;
      }
      const sigma = sigmafrac * k0;
      let mag, tries = 0;
      do { mag = k0 + randn()*sigma; tries++; } while (mag <= 0 && tries < 30);
      if (mag <= 0) mag = k0 * 0.1;
      const phase = 2*Math.PI*rng();
      waves.push({ kx: dir[0]*mag, ky: dir[1]*mag, kz: dir[2]*mag, phase: phase });
    }
    return waves;
  },

  // Hyperuniform: huN anisotropic Gaussian kernels at jittered grid points.
  // Each kernel is a 3D Gaussian with elongation `aspect` along its tangent
  // direction, clamped width `bw` perpendicular. Tangent direction is VMF-
  // sampled (kappa-controlled anisotropy) around the principal axis.
  _buildHUKernels(p) {
    const rng = this._mulberry32(p.rngSeed);
    const N = p.huN || 80, aspect = p.huAspect || 4.0, bw = p.huWidth || 0.04;
    const ell = p.huEll || 1.0, sq = Math.sqrt(ell);
    const a = bw * aspect * 0.5, b = bw * 0.5, b1 = b / sq, b2 = b * sq;
    const kappa = p.kappa, mode = p.dirMode;
    const pts = this._jitteredGrid3D(N, rng);
    const mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    const axes = [[1,0,0],[0,1,0],[0,0,1]];
    const wts  = [p.wX, p.wY, p.wZ];
    const totalW = Math.max(wts[0] + wts[1] + wts[2], 1e-6);
    function cross3(u, v) {
      return [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]];
    }
    function norm3(v) {
      const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }
    const kernels = [];
    const TWO_PI = 2.0 * Math.PI;
    for (let i = 0; i < N; i++) {
      let t;
      if (mode === 'iso') {
        t = this._sampleVMF(rng, 0);
      } else if (mode === 'single') {
        t = this._rotateTo(this._sampleVMF(rng, kappa), mux, muy, muz);
      } else { // 'ortho'
        const r = rng() * totalW;
        let cum = 0, chosen = 0;
        for (let ax = 0; ax < 3; ax++) { cum += wts[ax]; if (r <= cum) { chosen = ax; break; } }
        t = this._rotateTo(this._sampleVMF(rng, kappa),
                           axes[chosen][0], axes[chosen][1], axes[chosen][2]);
      }
      const arb = (Math.abs(t[0]) < 0.9) ? [1, 0, 0] : [0, 1, 0];
      const n1 = norm3(cross3(t, arb));
      const n2 = norm3(cross3(t, n1));
      kernels.push({
        px: pts[i][0]*TWO_PI - Math.PI,
        py: pts[i][1]*TWO_PI - Math.PI,
        pz: pts[i][2]*TWO_PI - Math.PI,
        tx: t[0],   ty: t[1],   tz: t[2],
        n1x: n1[0], n1y: n1[1], n1z: n1[2],
        n2x: n2[0], n2y: n2[1], n2z: n2[2],
        a: a * TWO_PI,
        b1: b1 * TWO_PI,
        b2: b2 * TWO_PI
      });
    }
    return kernels;
  },

  // ── Recipe → opaque params ────────────────────────────────────────────────
  // Reads recipe.field.* and recipe.geometry.*, validates field type, bakes
  // waves[] or kernels[] using mulberry32(rng_seed). Throws on RD with a
  // clear deferred-feature message.
  parseRecipe(recipe) {
    if (!recipe.field) {
      throw new Error("GrainKernel.parseRecipe: recipe missing 'field' block");
    }
    const f = recipe.field;
    const g = recipe.geometry || {};
    const ft = f.type;
    if (ft === 'reactiondiffusion') {
      throw new Error(
        "GrainKernel.parseRecipe: reaction-diffusion field type is deferred " +
        "in F13LD.sweep (texture-based; doesn't fit the analytic-evaluator " +
        "contract that lets the sweep run thousands of designs cheaply)."
      );
    }
    if (ft !== 'spinodoid' && ft !== 'gaussian' && ft !== 'hyperuniform') {
      throw new Error(
        "GrainKernel.parseRecipe: unsupported field.type '" + ft +
        "' (expected spinodoid | gaussian | hyperuniform)"
      );
    }
    // Principal direction — vector form on params (skipping the deg→rad
    // round-trip the grain UI does internally). null direction (iso/ortho
    // recipes) defaults to +z; irrelevant in those modes since iso uses
    // uniform sampling and ortho rotates per-axis.
    //
    // Normalize on input — recipes carry rounded JSON values (typically 4
    // decimals) that aren't exactly unit length. The grain UI reconstructs
    // mu from (θ°, φ°) sliders so its internal vector is always unit by
    // construction; we mirror that here.
    let pdir = (Array.isArray(f.principal_direction) && f.principal_direction.length === 3)
      ? f.principal_direction.slice()
      : [0, 0, 1];
    {
      const pn = Math.sqrt(pdir[0]*pdir[0] + pdir[1]*pdir[1] + pdir[2]*pdir[2]) || 1;
      pdir = [pdir[0]/pn, pdir[1]/pn, pdir[2]/pn];
    }
    // ortho weights — null in single/iso recipes; default to 1,1,1.
    const ow = Array.isArray(f.ortho_weights) && f.ortho_weights.length === 3
      ? f.ortho_weights
      : [1, 1, 1];
    const params = {
      fieldType:  ft,
      // Common knobs
      frequency:  f.frequency != null ? f.frequency : 0.45,
      rngSeed:    f.rng_seed  != null ? f.rng_seed  : 42,
      dirMode:    f.dir_mode  || 'single',
      kappa:      f.kappa     != null ? f.kappa     : 6,
      principalX: pdir[0], principalY: pdir[1], principalZ: pdir[2],
      wX: ow[0], wY: ow[1], wZ: ow[2],
      // Type-specific (carry all; kernel ignores irrelevant ones)
      nWaves:     f.n_waves   != null ? f.n_waves   : 48,
      grfSigma:   f.grf_sigma != null ? f.grf_sigma : 0.45,
      huN:        f.hu_n      != null ? f.hu_n      : 80,
      huAspect:   f.hu_aspect != null ? f.hu_aspect : 4.0,
      huWidth:    f.hu_width  != null ? f.hu_width  : 0.04,
      huCross:    f.hu_cross  != null ? f.hu_cross  : 2.0,
      huSharp:    f.hu_sharp  != null ? f.hu_sharp  : 1.0,
      huBlend:    f.hu_blend  != null ? f.hu_blend  : 1.0,
      huEll:      f.hu_ell    != null ? f.hu_ell    : 1.0,
      // Geometry (raw scale — no normalization to [-1,1] like noise)
      isoLevel:   g.center      != null ? g.center      : 0,
      halfWidth:  g.half_width  != null ? g.half_width  : 0.15,
      smoothing:  g.smoothing   || 0,
      halfInvert: !!g.half_invert,
    };
    // Bake the stochastic draw into params so workers see the same field.
    if (ft === 'spinodoid') {
      params.waves = this._buildSpinodoidWaves(params);
    } else if (ft === 'gaussian') {
      params.waves = this._buildGRFWaves(params);
    } else { // hyperuniform
      params.kernels = this._buildHUKernels(params);
    }
    if (!recipe.family) recipe.family = 'grain';
    return params;
  },

  // ── CPU field evaluation ──────────────────────────────────────────────────
  // Returns RAW field value at solver-space (x,y,z) ∈ [-π,π]³.
  // Wave families: Σ cos(k·p + φ) / √N — natural range roughly [-1, 1].
  // HU family:     Σ exp(-Q(p - c)) - 0.3 — natural range roughly [-0.3, 1].
  evaluate(params, x, y, z) {
    if (params.kernels) {
      const ks = params.kernels;
      // Shape scalars read from params (NOT the kernels array) so they survive
      // the structured-clone postMessage to the homogenization worker — array
      // expando props are dropped by clone, scalar params are not.
      const p = params.huCross || 2.0, m = params.huSharp || 1.0, P = params.huBlend || 1.0;
      const rnd = (p === 2.0), shp = (m === 1.0), bl = (P === 1.0);
      let s = 0;
      for (let i = 0; i < ks.length; i++) {
        const k = ks[i];
        const dx = x - k.px, dy = y - k.py, dz = z - k.pz;
        const dt  = dx*k.tx  + dy*k.ty  + dz*k.tz;
        const dn1 = dx*k.n1x + dy*k.n1y + dz*k.n1z;
        const dn2 = dx*k.n2x + dy*k.n2y + dz*k.n2z;
        const u = dt/k.a, w1 = dn1/k.b1, w2 = dn2/k.b2;
        const R = u*u + (rnd ? (w1*w1 + w2*w2)
                             : (Math.pow(Math.abs(w1), p) + Math.pow(Math.abs(w2), p)));
        const Rm = shp ? R : Math.pow(R, m);
        s += bl ? Math.exp(-Rm) : Math.exp(-P*Rm);
      }
      if (!bl) s = Math.pow(s, 1.0/P);
      return s - 0.3;
    }
    const ws = params.waves;
    const N = ws.length;
    let s = 0;
    for (let i = 0; i < N; i++) {
      s += Math.cos(ws[i].kx*x + ws[i].ky*y + ws[i].kz*z + ws[i].phase);
    }
    return s / Math.sqrt(N);
  },

  // Numerical gradient — central differences. ε = 0.01 matches NoiseKernel.
  // Analytic gradients are tractable (cos waves' derivative is -sin waves;
  // HU kernels are quadratic exponents) but the central-difference cost is
  // bounded — pore analysis only invokes this near the surface (~5-10% of
  // points) — and the simpler code is worth it.
  evaluateWithGrad(params, x, y, z) {
    const phi = this.evaluate(params, x, y, z);
    const e = 0.01;
    const dx = (this.evaluate(params, x+e, y, z) - this.evaluate(params, x-e, y, z)) / (2*e);
    const dy = (this.evaluate(params, x, y+e, z) - this.evaluate(params, x, y-e, z)) / (2*e);
    const dz = (this.evaluate(params, x, y, z+e) - this.evaluate(params, x, y, z-e)) / (2*e);
    const gradMag = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return { phi, gradMag };
  },

  // ── Sweep jitter ──────────────────────────────────────────────────────────
  // Field type held FIXED across jitter (matches noise holding noiseType fixed).
  // dir_mode also held fixed. Re-rolls rngSeed deterministically and rebuilds
  // waves/kernels.
  //
  // Direction is perturbed with a small VMF(κ=8) draw around the recipe's
  // principal direction — keeps the design's directional character but
  // explores nearby orientations. (vs. full random direction reset, which
  // would discard the recipe's directional intent.)
  //
  // draw.u(i) supplies Sobol low-discrepancy samples for the first 3 dims
  // (frequency, isoLevel, halfWidth); Math.random() handles type-specific
  // and direction perturbation.
  jitterParams(params, draw, args = {}) {
    // v0.16.0: All numeric knobs migrated from flat-domain sampling to
    // recipe-anchored multiplicative jitter (× [0.6, 1.4], ±40%). Previously
    // a recipe with frequency=0.3, nWaves=64, kappa=12 would get sweep designs
    // drawn from [0.10, 1.00] × [16, 128] × [0, 20] regardless — wiping the
    // recipe's authored values. New behavior preserves recipe identity.
    // Clamps prevent degenerate values at boundary recipes.
    // v0.17.0: tightened from [0.6, 1.4] (±40%) to [0.75, 1.25] (±25%).
    // Matches the parallel tightening in NoiseKernel.jitterParams. The v0.16.0
    // ±40% range was producing too many high-VF designs that hit RHO_MAX
    // discard, especially in grain-solid mode. ±25% keeps the sweep
    // statistics anchored to recipe identity. Parameter-specific overrides
    // (frequency, isoLevel, kappa, etc.) deferred until empirical
    // characterisation of the tightened default.
    // v0.18.0: halfWidth gets a target-aware MULT override under ρ-pressure
    // (see buildTargetProfile docstring). Kappa/frequency/iso still global
    // MULT — they're in the v0.18.x deferred set.
    const MULT          = args.mult         ?? [0.75, 1.25];  // ±25% multiplicative
    const MULT_HW       = (args.targetHints?.halfWidth_mult) ?? MULT;
    const FREQ_CLAMP    = args.freqClamp    ?? [0.05, 1.50];
    const ISO_JITTER    = args.isoJitter    ?? 0.40;          // additive (kept; was 0.30, bumped to match noise)
    const ISO_CLAMP     = args.isoClamp     ?? [-0.95, 0.95];
    const HW_CLAMP      = args.hwClamp      ?? [0.02, 0.40];
    const NWAVES_CLAMP  = args.nWavesClamp  ?? [16, 128];
    const KAPPA_CLAMP   = args.kappaClamp   ?? [0,  20];      // floor 0 — recipe.kappa=0 (iso) stays at 0
    const SIGMA_CLAMP   = args.sigmaClamp   ?? [0.05, 0.80];
    const HUN_CLAMP     = args.huNClamp     ?? [30, 200];
    const HUASP_CLAMP   = args.huAspClamp   ?? [1.0, 8.0];
    const HUW_CLAMP     = args.huWClamp     ?? [0.02, 0.20];
    const HUELL_TJIT     = args.huEllTJitter ?? 0.40;        // log4 ± half-span for transverse aspect
    // v0.16.0: DIR_KAPPA now tied to recipe.kappa (with floor) and jittered.
    // Higher recipe-anisotropy → tighter direction preservation in sweep.
    const DIR_KAPPA_FLOOR = args.dirKappaFloor ?? 4;
    const DIR_KAPPA_CLAMP = args.dirKappaClamp ?? [2, 20];
    const dimOff       = args.coefDimOffset ?? 4;

    // Helper: multiplicative jitter around `base`, clamped to natural bounds.
    // `r` is a uniform [0,1] random — caller chooses Sobol dim or Math.random.
    // v0.18.0: optional per-call mult override for parameter-specific biasing.
    const mulJ = (base, clamp, r, mult) => {
      const M = mult || MULT;
      const v = base * (M[0] + r * (M[1] - M[0]));
      return Math.max(clamp[0], Math.min(clamp[1], v));
    };

    const out = { ...params };

    // Re-roll rngSeed deterministically — xorshift on the input seed plus
    // a stir constant so successive jitters wander rather than cycling.
    let s = (params.rngSeed | 0) ^ 0xC0FFEE;
    s = (s ^ (s << 13)) | 0;
    s = (s ^ (s >>> 17)) | 0;
    s = (s ^ (s << 5))  | 0;
    out.rngSeed = (s >>> 0) || 1;

    // Common knobs — Sobol on first 3 dims for low-discrepancy coverage.
    // All now recipe-anchored.
    out.frequency = +mulJ(params.frequency, FREQ_CLAMP, draw.u(dimOff)).toFixed(3);
    const isoVal  = params.isoLevel + (draw.u(dimOff+1)*2 - 1) * ISO_JITTER;
    out.isoLevel  = +Math.max(ISO_CLAMP[0], Math.min(ISO_CLAMP[1], isoVal)).toFixed(3);
    // v0.18.0: halfWidth MULT window shifts under ρ-pressure.
    out.halfWidth = +mulJ(params.halfWidth, HW_CLAMP, draw.u(dimOff+2), MULT_HW).toFixed(3);

    // Direction perturbation — draw a VMF(κ=DIR_KAPPA) sample around the
    // recipe's stored direction. v0.16.0: DIR_KAPPA now tracks recipe.kappa
    // with a floor of 4 (so low-anisotropy recipes still preserve direction
    // somewhat). Multiplicative jitter ±40% on top, clamped to [2, 20].
    // Physically: high field anisotropy → tight direction preservation;
    // low anisotropy → direction wanders more (matches recipe intent).
    const baseDirKappa = Math.max(DIR_KAPPA_FLOOR, params.kappa);
    const DIR_KAPPA = Math.max(DIR_KAPPA_CLAMP[0],
                       Math.min(DIR_KAPPA_CLAMP[1],
                                baseDirKappa * (MULT[0] + Math.random() * (MULT[1] - MULT[0]))));
    const dirRng = this._mulberry32(out.rngSeed ^ 0xDEADBEEF);
    const dirSample = this._sampleVMF(dirRng, DIR_KAPPA);
    const newDir = this._rotateTo(dirSample, params.principalX, params.principalY, params.principalZ);
    out.principalX = newDir[0]; out.principalY = newDir[1]; out.principalZ = newDir[2];

    // Field-type-specific jitter — all recipe-anchored now.
    // v0.16.0: GRF previously did NOT jitter nWaves (only spinodoid did);
    // that inconsistency is fixed here — GRF gets nWaves jitter too.
    const ft = params.fieldType;
    if (ft === 'spinodoid') {
      out.nWaves = Math.round(mulJ(params.nWaves || 48, NWAVES_CLAMP, Math.random()));
      out.kappa  = +mulJ(params.kappa, KAPPA_CLAMP, Math.random()).toFixed(2);
    } else if (ft === 'gaussian') {
      out.nWaves   = Math.round(mulJ(params.nWaves || 48, NWAVES_CLAMP, Math.random()));
      out.grfSigma = +mulJ(params.grfSigma || 0.45, SIGMA_CLAMP, Math.random()).toFixed(3);
      out.kappa    = +mulJ(params.kappa, KAPPA_CLAMP, Math.random()).toFixed(2);
    } else { // hyperuniform
      out.huN      = Math.round(mulJ(params.huN || 80, HUN_CLAMP, Math.random()));
      out.huAspect = +mulJ(params.huAspect || 4.0, HUASP_CLAMP, Math.random()).toFixed(2);
      out.huWidth  = +mulJ(params.huWidth || 0.04, HUW_CLAMP, Math.random()).toFixed(3);
      out.kappa    = +mulJ(params.kappa, KAPPA_CLAMP, Math.random()).toFixed(2);
      // Transverse aspect is the one shape knob we explore. Jitter symmetrically
      // in log4 space (ell and 1/ell are mirror cross-sections), anchored to the
      // recipe aspect, clamped to ell∈[0.25,4] (t∈[-1,1]). cross/sharp/blend pass
      // through unjittered via the {...params} spread above.
      { let tE = Math.log(params.huEll || 1.0)/Math.log(4) + (Math.random()*2 - 1)*HUELL_TJIT;
        tE = Math.max(-1, Math.min(1, tE));
        out.huEll = +Math.pow(4, tE).toFixed(3); }
    }

    // Rebuild waves/kernels with the new seed + new params
    if (ft === 'spinodoid') {
      out.waves = this._buildSpinodoidWaves(out);
      delete out.kernels;
    } else if (ft === 'gaussian') {
      out.waves = this._buildGRFWaves(out);
      delete out.kernels;
    } else {
      out.kernels = this._buildHUKernels(out);
      delete out.waves;
    }

    return out;
  },

  // ── GLSL emission ─────────────────────────────────────────────────────────
  // Returns { fns, exprFn, bakedField } where bakedField triggers a sampler3D
  // upload at the call site (P2c — replaces P2b's inline analytic shader).
  //
  // Why baked-and-sampled instead of inline analytic:
  //   - Inline 48 cosines (spinodoid/GRF) or 115 anisotropic exps (HU) per
  //     ray-march step × 384 steps = 18-44k ops/pixel before hit decision.
  //     Browser reports of HU stutter and spinodoid slowness traced here.
  //   - F13LD.grain itself uses sampler3D — its preview shader does ONE
  //     texture lookup per step, ~50× faster than inline analytic for HU.
  //   - The bake cost (~30-150ms per design) is paid once on hover, then
  //     subsequent frames sample from the texture at GPU speed.
  //
  // Why normalization (mid/halfRange) is critical:
  //   - F13LD.grain calibrates iso/halfWidth against a [-1,1] field range
  //     (evalGrid line ~590: norm = (raw - mid) / halfRange).
  //   - P2b emitted raw cos sums whose actual range is much narrower
  //     (~[-0.4, 0.4]), making iso/hw thresholds engulf the whole field
  //     range. Sheet rendered as half/solid; HU sign appeared flipped.
  //   - We replicate F13LD.grain's normalization here in the shader so iso
  //     and halfWidth from the recipe land in the same scale F13LD.grain
  //     calibrated them against.
  //
  // Bake details:
  //   - 32³ sampling grid in [-π, π]³ (matches solver-space convention)
  //   - Float32 → 8-bit quantization to match F13LD.grain's R8 texture
  //     (256 levels is plenty for visual previews; saves 4× GPU bandwidth)
  //   - mid/halfRange computed from min/max of the 32³ samples
  //
  // WebGL2-only: sampler3D is unavailable in WebGL1. The call site checks
  // isWebGL2 before calling buildFrag for grain family and shows a fallback
  // message when WebGL1 is the only option.
  emitGLSLField(params) {
    const ft = params.fieldType;
    if (ft === 'reactiondiffusion') {
      throw new Error(
        "GrainKernel.emitGLSLField: reaction-diffusion field type is deferred " +
        "in F13LD.sweep (texture-based; doesn't fit the analytic-evaluator " +
        "contract that lets the sweep run thousands of designs cheaply)."
      );
    }
    if (ft !== 'spinodoid' && ft !== 'gaussian' && ft !== 'hyperuniform') {
      throw new Error(
        "GrainKernel.emitGLSLField: unsupported fieldType '" + ft +
        "' (expected spinodoid | gaussian | hyperuniform)"
      );
    }
    if ((ft === 'spinodoid' || ft === 'gaussian') && !params.waves) {
      throw new Error("GrainKernel.emitGLSLField: " + ft + " params missing .waves array");
    }
    if (ft === 'hyperuniform' && !params.kernels) {
      throw new Error("GrainKernel.emitGLSLField: hyperuniform params missing .kernels array");
    }

    // ── Bake the field at 32³ ──────────────────────────────────────────────
    // Each voxel runs CPU evaluate() at its solver-space coordinate. Same
    // math the FFT-CG sweep uses on the worker side, so visual preview and
    // homogenization see identical fields.
    const N = 32;
    const N3 = N * N * N;
    const fieldF32 = new Float32Array(N3);
    let mn = +Infinity, mx = -Infinity;
    const PI = Math.PI;
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          // Sample in [-π, π]³ with corners inclusive — matches the
          // CLAMP_TO_EDGE sampler convention in the shader.
          const x = (i / (N - 1)) * 2 * PI - PI;
          const y = (j / (N - 1)) * 2 * PI - PI;
          const z = (k / (N - 1)) * 2 * PI - PI;
          const v = this.evaluate(params, x, y, z);
          fieldF32[i + j * N + k * N * N] = v;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
    }
    // Quantize to R8 (matches F13LD.grain's _uploadTexture3D convention).
    // Each byte = round((raw - min) / range * 255). The shader recovers raw
    // via raw = byte/255 * (max-min) + min, then normalizes via the same
    // mid/halfRange path F13LD.grain uses on its CPU side.
    const range = Math.max(mx - mn, 1e-6);
    const data = new Uint8Array(N3);
    for (let i = 0; i < N3; i++) {
      const t = (fieldF32[i] - mn) / range;
      data[i] = Math.round(Math.max(0, Math.min(1, t)) * 255);
    }

    // ── GLSL: sample the texture, recover raw value ───────────────────────
    // uField:        the R8 sampler3D the call site uploads
    // uFieldMin/Max: bounds for byte→raw recovery
    //
    // P2e: returns the RAW field value, NOT a normalized [-1,1] mapping.
    // F13LD.grain's preview shader (line 745) applies iso/halfWidth directly
    // to raw values — see grain's sampleF. The P2c attempt to normalize was
    // a misread of the source's evalGrid path (which is for a different
    // CPU 3D-volume preview, not the shader). Pre-flight verified that
    // raw-scale threshold matches recipe homog VF on all 4 sample recipes.
    //
    // The mode-wrapper in buildFrag (abs(field-iso)-hw etc) sees the raw
    // value, so iso/halfWidth live in the same scale F13LD.grain calibrated
    // them in.
    const fns =
      'uniform highp sampler3D uField;\n' +
      'uniform float uFieldMin;\n' +
      'uniform float uFieldMax;\n' +
      'float fieldEval(vec3 p,float H){\n' +
      '  vec3 uvw=clamp(p/(2.0*H)+0.5,0.0,1.0);\n' +
      '  float t=texture(uField,uvw).r;\n' +
      '  return t*(uFieldMax-uFieldMin)+uFieldMin;\n' +
      '}';

    return {
      fns,
      exprFn: 'fieldEval',
      bakedField: { data, N, fieldMin: mn, fieldMax: mx }
    };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
