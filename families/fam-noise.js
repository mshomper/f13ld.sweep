/* ============================================================
   F13LD.sweep · fam-noise.js
   NoiseKernel: the seven F13LD.noise types.
   ============================================================ */

// ─── NoiseKernel ─── seven deterministic noise types from F13LD.noise ────────
// ═════════════════════════════════════════════════════════════════════════════
//
// Path E2: ports the Noise Scaffold Explorer's DeterministicNoise module into
// the FieldKernel interface. Seven noise types: simplex, cellular (Worley
// F2-F1), fbm, ridged, billow, warp (domain-warped fbm), curl.
//
// Domain mapping: the Noise tool parameterizes its field over normalized world
// space and applies SCALE = 5/π × frequency × scaleAxis to map from solver
// coords [-π,π]³ into noise-sampling coords. That mapping lives inside this
// kernel — consumers pass solver coords (x,y,z) to evaluate() and the kernel
// applies the SCALE multiply internally.
//
// Per-recipe normalization: the field's actual value range varies sharply by
// noise type and parameters (simplex ~[-1,1], curl can spike to 5+, fbm
// depends on octaves/gain). parseRecipe runs a 16³ prepass to find noiseMin/
// noiseMax for the specific recipe, stores them on params, and evaluate()
// returns the normalized value (raw - mid)/halfR. This way mode wrappers
// (noise-sheet/half/solid) can use isoLevel/halfWidth in canonical [-1,1]
// space regardless of which noise type is in play.

const NoiseKernel = {
  family: 'noise',

  // ── Noise primitives — verbatim port from DeterministicNoise ─────────────
  // These are private to the kernel; not exposed via the registry. They run
  // in workers via the kernel object stringification (see buildSolverWorkerSource).
  _mod289(x) { return x - Math.floor(x / 289.0) * 289.0; },
  _permute(x) { return this._mod289(((x * 34.0) + 1.0) * x); },
  _tis(r) { return 1.79284291400159 - 0.85373472095314 * r; },
  _frac(x) { return x - Math.floor(x); },

  // 3D simplex noise — verbatim from Noise tool DeterministicNoise.snoise
  _snoise(vx, vy, vz) {
    const C0 = 1.0/6.0, C1 = 1.0/3.0;
    const s = (vx+vy+vz)*C1;
    let ix = Math.floor(vx+s), iy = Math.floor(vy+s), iz = Math.floor(vz+s);
    const t = (ix+iy+iz)*C0;
    const x0x = vx-ix+t, x0y = vy-iy+t, x0z = vz-iz+t;
    const gx = x0x>=x0y?1:0, gy = x0y>=x0z?1:0, gz = x0z>=x0x?1:0;
    const lx = 1-gx, ly = 1-gy, lz = 1-gz;
    const i1x = Math.min(gx,lz), i1y = Math.min(gy,lx), i1z = Math.min(gz,ly);
    const i2x = Math.max(gx,lz), i2y = Math.max(gy,lx), i2z = Math.max(gz,ly);
    const x1x = x0x-i1x+C0, x1y = x0y-i1y+C0, x1z = x0z-i1z+C0;
    const x2x = x0x-i2x+C1, x2y = x0y-i2y+C1, x2z = x0z-i2z+C1;
    const x3x = x0x-0.5, x3y = x0y-0.5, x3z = x0z-0.5;
    ix = this._mod289(ix); iy = this._mod289(iy); iz = this._mod289(iz);
    const p0 = this._permute(this._permute(this._permute(iz)+iy)+ix);
    const p1 = this._permute(this._permute(this._permute(iz+i1z)+iy+i1y)+ix+i1x);
    const p2 = this._permute(this._permute(this._permute(iz+i2z)+iy+i2y)+ix+i2x);
    const p3 = this._permute(this._permute(this._permute(iz+1)+iy+1)+ix+1);
    const nx = 0.285714285714, ny = -0.928571428571, nz = 0.142857142857;
    const j0 = p0-49*Math.floor(p0*nz*nz);
    const j1 = p1-49*Math.floor(p1*nz*nz);
    const j2 = p2-49*Math.floor(p2*nz*nz);
    const j3 = p3-49*Math.floor(p3*nz*nz);
    const x0_ = Math.floor(j0*nz), y0_ = Math.floor(j0-7*x0_);
    const x1_ = Math.floor(j1*nz), y1_ = Math.floor(j1-7*x1_);
    const x2_ = Math.floor(j2*nz), y2_ = Math.floor(j2-7*x2_);
    const x3_ = Math.floor(j3*nz), y3_ = Math.floor(j3-7*x3_);
    const xs0 = x0_*nx+ny, ys0 = y0_*nx+ny;
    const xs1 = x1_*nx+ny, ys1 = y1_*nx+ny;
    const xs2 = x2_*nx+ny, ys2 = y2_*nx+ny;
    const xs3 = x3_*nx+ny, ys3 = y3_*nx+ny;
    const h0 = 1-Math.abs(xs0)-Math.abs(ys0);
    const h1 = 1-Math.abs(xs1)-Math.abs(ys1);
    const h2 = 1-Math.abs(xs2)-Math.abs(ys2);
    const h3 = 1-Math.abs(xs3)-Math.abs(ys3);
    const sh0 = h0<=0?-1:0, sh1 = h1<=0?-1:0, sh2 = h2<=0?-1:0, sh3 = h3<=0?-1:0;
    let pp0x = xs0+(Math.floor(xs0)*2+1)*sh0, pp0y = ys0+(Math.floor(ys0)*2+1)*sh0, pp0z = h0;
    let pp1x = xs1+(Math.floor(xs1)*2+1)*sh1, pp1y = ys1+(Math.floor(ys1)*2+1)*sh1, pp1z = h1;
    let pp2x = xs2+(Math.floor(xs2)*2+1)*sh2, pp2y = ys2+(Math.floor(ys2)*2+1)*sh2, pp2z = h2;
    let pp3x = xs3+(Math.floor(xs3)*2+1)*sh3, pp3y = ys3+(Math.floor(ys3)*2+1)*sh3, pp3z = h3;
    const n0 = this._tis(pp0x*pp0x+pp0y*pp0y+pp0z*pp0z);
    const n1 = this._tis(pp1x*pp1x+pp1y*pp1y+pp1z*pp1z);
    const n2 = this._tis(pp2x*pp2x+pp2y*pp2y+pp2z*pp2z);
    const n3 = this._tis(pp3x*pp3x+pp3y*pp3y+pp3z*pp3z);
    pp0x*=n0; pp0y*=n0; pp0z*=n0;
    pp1x*=n1; pp1y*=n1; pp1z*=n1;
    pp2x*=n2; pp2y*=n2; pp2z*=n2;
    pp3x*=n3; pp3y*=n3; pp3z*=n3;
    let m0 = Math.max(0.6-(x0x*x0x+x0y*x0y+x0z*x0z),0); m0*=m0;
    let m1 = Math.max(0.6-(x1x*x1x+x1y*x1y+x1z*x1z),0); m1*=m1;
    let m2 = Math.max(0.6-(x2x*x2x+x2y*x2y+x2z*x2z),0); m2*=m2;
    let m3 = Math.max(0.6-(x3x*x3x+x3y*x3y+x3z*x3z),0); m3*=m3;
    return 42*(m0*m0*(pp0x*x0x+pp0y*x0y+pp0z*x0z)+
               m1*m1*(pp1x*x1x+pp1y*x1y+pp1z*x1z)+
               m2*m2*(pp2x*x2x+pp2y*x2y+pp2z*x2z)+
               m3*m3*(pp3x*x3x+pp3y*x3y+pp3z*x3z));
  },

  // Cellular (Worley F2-F1) — identical hash to GLSL/Noise tool versions
  _cellular(px, py, pz, metric) {
    const pix = Math.floor(px), piy = Math.floor(py), piz = Math.floor(pz);
    const pfx = px-pix, pfy = py-piy, pfz = pz-piz;
    let d1 = 10, d2 = 10;
    for (let oz=-1; oz<=1; oz++) for (let oy=-1; oy<=1; oy++) for (let ox=-1; ox<=1; ox++) {
      const cx = pix+ox, cy = piy+oy, cz = piz+oz;
      const rpx = this._frac(Math.sin(cx*127.1+cy*311.7+cz*74.7)*43758.5453);
      const rpy = this._frac(Math.sin(cx*269.5+cy*183.3+cz*246.1)*43758.5453);
      const rpz = this._frac(Math.sin(cx*113.5+cy*271.9+cz*124.6)*43758.5453);
      const dx = ox+rpx-pfx, dy = oy+rpy-pfy, dz = oz+rpz-pfz;
      const d = metric==='euclidean' ? Math.sqrt(dx*dx+dy*dy+dz*dz) :
                metric==='manhattan' ? Math.abs(dx)+Math.abs(dy)+Math.abs(dz) :
                Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
      if (d<d1) { d2=d1; d1=d; } else if (d<d2) d2=d;
    }
    return Math.max(Math.min((d2-d1)*2-1, 1), -1);
  },

  _fbm(px, py, pz, octaves, lacunarity, gain) {
    let v = 0, a = 1, f = 1, mx = 0;
    for (let i = 0; i < octaves; i++) {
      v += this._snoise(px*f, py*f, pz*f) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return v / mx;
  },

  _warp(px, py, pz, strength, octaves, lacunarity, gain) {
    const qx = this._fbm(px, py, pz, octaves, lacunarity, gain);
    const qy = this._fbm(px+5.2, py+1.3, pz+8.1, octaves, lacunarity, gain);
    const qz = this._fbm(px+3.7, py+9.4, pz+2.8, octaves, lacunarity, gain);
    return this._fbm(px+strength*qx, py+strength*qy, pz+strength*qz, octaves, lacunarity, gain);
  },

  _ridged(px, py, pz, octaves, lacunarity, gain) {
    let v = 0, a = 1, f = 1, mx = 0;
    for (let i = 0; i < octaves; i++) {
      v += (1 - Math.abs(this._snoise(px*f, py*f, pz*f))) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return (v/mx) * 2.0 - 1.0;
  },

  _billow(px, py, pz, octaves, lacunarity, gain) {
    let v = 0, a = 1, f = 1, mx = 0;
    for (let i = 0; i < octaves; i++) {
      v += Math.abs(this._snoise(px*f, py*f, pz*f)) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return (v/mx) * 2.0 - 1.0;
  },

  // Curl noise — magnitude of ∇×Ψ from a simplex vector potential. 9 snoise
  // calls per evaluation (3 base + 6 forward-difference offsets).
  _curl(px, py, pz, curlStep, potScale) {
    const s = potScale, e = curlStep;
    const psi_x = this._snoise(px*s,           py*s,           pz*s);
    const psi_y = this._snoise(px*s+3.7,       py*s+1.5,       pz*s+2.8);
    const psi_z = this._snoise(px*s+1.2,       py*s+4.6,       pz*s+0.9);
    const pzy   = this._snoise(px*s+1.2,       (py+e)*s+4.6,   pz*s+0.9);
    const pyz   = this._snoise(px*s+3.7,       py*s+1.5,       (pz+e)*s+2.8);
    const pxz   = this._snoise(px*s,           py*s,           (pz+e)*s);
    const pzx   = this._snoise((px+e)*s+1.2,   py*s+4.6,       pz*s+0.9);
    const pyx   = this._snoise((px+e)*s+3.7,   py*s+1.5,       pz*s+2.8);
    const pxy   = this._snoise(px*s,           (py+e)*s,       pz*s);
    const cx = (pzy-psi_z)/e - (pyz-psi_y)/e;
    const cy = (pxz-psi_x)/e - (pzx-psi_z)/e;
    const cz = (pyx-psi_y)/e - (pxy-psi_x)/e;
    return Math.sqrt(cx*cx + cy*cy + cz*cz);
  },

  // Type-dispatched raw noise sample — matches DeterministicNoise.sample
  _sampleRaw(params, sx, sy, sz) {
    const t = params.noiseType;
    if (t === 'simplex')  return this._snoise(sx, sy, sz);
    if (t === 'cellular') return this._cellular(sx, sy, sz, params.distanceMetric);
    if (t === 'fbm')      return this._fbm(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'ridged')   return this._ridged(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'billow')   return this._billow(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'curl')     return this._curl(sx, sy, sz, params.curlStep || 0.1, params.potentialScale || 1.0);
    return this._warp(sx, sy, sz, params.warpStrength, params.octaves, params.lacunarity, params.gain);
  },

  // ── Per-recipe prepass — finds noiseMin/noiseMax for normalization ───────
  // Mirrors homoPrepass in the Noise tool. 16³ scan, ~ms per recipe.
  // Called inline by parseRecipe and rerun after every jitterParams (since
  // jitter changes frequency/scales/octaves which shift the field's range).
  _prepass(params) {
    const N = 16, SCALE = 5.0/Math.PI;
    const sx = params.scaleX || 1, sy = params.scaleY || 1, sz = params.scaleZ || 1;
    let mn = Infinity, mx = -Infinity;
    for (let zi = 0; zi < N; zi++) for (let yi = 0; yi < N; yi++) for (let xi = 0; xi < N; xi++) {
      const px = ((xi/(N-1))*2-1) * Math.PI;
      const py = ((yi/(N-1))*2-1) * Math.PI;
      const pz = ((zi/(N-1))*2-1) * Math.PI;
      const v = this._sampleRaw(params,
        px*SCALE*params.frequency*sx,
        py*SCALE*params.frequency*sy,
        pz*SCALE*params.frequency*sz);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const range = mx - mn;
    return { noiseMin: mn - range*0.05, noiseMax: mx + range*0.05 };
  },

  // ── Kernel interface ─────────────────────────────────────────────────────
  // Recipe → opaque params object. parseRecipe injects family='noise' when
  // surface.type === 'noise', which lets existing Noise exports load without
  // a re-export. Runs the prepass inline so workers don't have to.
  parseRecipe(recipe) {
    const s = recipe.surface || {};
    if (s.type !== 'noise') {
      throw new Error(`NoiseKernel.parseRecipe: expected surface.type='noise', got '${s.type}'`);
    }
    const params = {
      noiseType:     s.noise_type || 'simplex',
      frequency:     s.frequency || 0.3,
      scaleX:        s.scale_x || 1.0,
      scaleY:        s.scale_y || 1.0,
      scaleZ:        s.scale_z || 1.0,
      isoLevel:      s.center != null ? s.center : 0,
      halfWidth:     s.half_width != null ? s.half_width : 0.15,
      smoothing:     s.smoothing || 0,
      octaves:       s.octaves || 4,
      lacunarity:    s.lacunarity || 2.0,
      gain:          s.gain || 0.5,
      warpStrength:  s.warp_strength != null ? s.warp_strength : 1.0,
      distanceMetric: s.distance_metric || 'euclidean',
      curlStep:      s.curl_step || 0.1,
      potentialScale: s.potential_scale || 1.0,
      // halfInvert is geometry-shape, not surface-shape
      halfInvert:    !!(recipe.geometry && recipe.geometry.half_invert),
    };
    // Inject family on the recipe so downstream sees it without the
    // recipe.family || 'tpms' fallback masking what's actually loaded.
    if (!recipe.family) recipe.family = 'noise';
    // Prepass — fills noiseMin/noiseMax for normalization
    const bounds = this._prepass(params);
    params.noiseMin = bounds.noiseMin;
    params.noiseMax = bounds.noiseMax;
    return params;
  },

  // CPU field evaluation — solver-space (x,y,z) in [-π,π]³.
  // Returns the normalized field value in roughly [-1,1] so mode wrappers
  // can use isoLevel/halfWidth in canonical units.
  evaluate(params, x, y, z) {
    const SCALE = 5.0/Math.PI;
    const Sx = SCALE * params.frequency * params.scaleX;
    const Sy = SCALE * params.frequency * params.scaleY;
    const Sz = SCALE * params.frequency * params.scaleZ;
    const raw = this._sampleRaw(params, x*Sx, y*Sy, z*Sz);
    const mid = (params.noiseMin + params.noiseMax) * 0.5;
    const halfR = Math.max((params.noiseMax - params.noiseMin) * 0.5, 0.001);
    return (raw - mid) / halfR;
  },

  // Numerical gradient — central differences, 6 evaluate calls per point.
  // Pore analysis only invokes this on near-surface voxels (~5-10% of points),
  // so the perf hit is bounded. No analytic gradient available — noise types
  // are either non-smooth (cellular hash, ridged abs, curl |·|) or arbitrarily
  // composed (fbm/warp), so numerical is the only honest option.
  evaluateWithGrad(params, x, y, z) {
    const phi = this.evaluate(params, x, y, z);
    const e = 0.01; // step size — small fraction of typical feature scale
    const dx = (this.evaluate(params, x+e, y, z) - this.evaluate(params, x-e, y, z)) / (2*e);
    const dy = (this.evaluate(params, x, y+e, z) - this.evaluate(params, x, y-e, z)) / (2*e);
    const dz = (this.evaluate(params, x, y, z+e) - this.evaluate(params, x, y, z-e)) / (2*e);
    const gradMag = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return { phi, gradMag };
  },

  // Sweep jitter — keeps noiseType fixed (per E2 design call). Perturbs
  // frequency, per-axis scales, isoLevel, halfWidth, plus type-specific
  // parameters where they apply. Re-runs the prepass after jitter since the
  // field's value range shifts with these parameter changes.
  //
  // draw.u(i) supplies Sobol low-discrepancy samples for the first 4 dims;
  // Math.random() handles the rest. Octaves capped at max(4, params.octaves)
  // — imported recipes with octaves>4 keep their range, defaults stay tight.
  // Cellular distance_metric jittered uniformly across the three values.
  jitterParams(params, draw, args = {}) {
    // v0.16.0: jitter migrated from flat-domain sampling to recipe-anchored
    // multiplicative jitter (×[0.6, 1.4], ±40%) for all numeric knobs except
    // octaves (additive integer jitter ±2) and isoLevel (additive ±0.40).
    // Previously a recipe with frequency=0.3, scaleX=2 would yield sweep
    // designs drawn from flat [0.05, 1.0] × [0.4, 3.2]³ — wiping authored
    // values entirely. New behavior preserves recipe identity end-to-end.
    // v0.17.0: tightened from [0.6, 1.4] (±40%) to [0.75, 1.25] (±25%).
    // The v0.16.0 ±40% range was pushing too many designs near-solid or
    // near-void — observed ~50% of sweep designs landing close to the VF
    // upper cap. ±25% gives a 1.67× spread instead of 2.33×, keeping the
    // sweep tightly around the recipe while preserving genuine exploration.
    // Parameter-specific overrides deferred to a later pass after this
    // global tightening is validated against real batches.
    // v0.18.0: parameter-specific MULT overrides delivered via args.targetHints.
    // halfWidth gets an asymmetric MULT window driven by ρ-pressure tier.
    // Other knobs (frequency, scaleX/Y/Z, isoLevel, octaves/lac/gain) stay
    // at the default MULT — see buildTargetProfile docstring for the MVP
    // scoping decision. Default behavior with hints=null is byte-identical
    // to v0.17.0.
    const MULT         = args.mult         ?? [0.75, 1.25];  // ±25%
    const MULT_HW      = (args.targetHints?.halfWidth_mult) ?? MULT;
    const FREQ_CLAMP   = args.freqClamp    ?? [0.05, 1.50];
    const SCALE_CLAMP  = args.scaleClamp   ?? [0.20, 5.00];  // per-axis anisotropy
    const ISO_JITTER   = args.isoJitter    ?? 0.40;          // additive
    const ISO_CLAMP    = args.isoClamp     ?? [-0.95, 0.95];
    const HW_CLAMP     = args.hwClamp      ?? [0.02, 0.40];
    const OCT_DELTA    = args.octDelta     ?? 2;             // ±2 integer octaves
    const OCT_FLOOR    = args.octFloor     ?? 1;
    const LAC_CLAMP    = args.lacClamp     ?? [1.2, 3.5];
    const GAIN_CLAMP   = args.gainClamp    ?? [0.1, 0.9];
    const WARP_CLAMP   = args.warpClamp    ?? [0.0, 4.0];
    const CURL_STEP_CLAMP = args.curlStepClamp ?? [0.05, 0.6];
    const POT_SCALE_CLAMP = args.potScaleClamp ?? [0.5, 3.5];
    const dimOff       = args.coefDimOffset ?? 4;

    // Helper: multiplicative jitter around `base`, clamped to natural bounds.
    // v0.18.0: optional per-call mult override for parameter-specific biasing
    // (target-aware sampling); defaults to the kernel-wide MULT.
    const mulJ = (base, clamp, r, mult) => {
      const M = mult || MULT;
      const v = base * (M[0] + r * (M[1] - M[0]));
      return Math.max(clamp[0], Math.min(clamp[1], v));
    };

    // Fresh params object — never mutate the input
    const out = { ...params };

    // Frequency — Sobol dim (dimOff). Now anchored to recipe value (was flat
    // [0.05, 1.0] regardless of recipe — see v0.16.0 jitter audit).
    out.frequency = +mulJ(params.frequency, FREQ_CLAMP, draw.u(dimOff)).toFixed(3);
    // Per-axis scales — Sobol dims (dimOff+1..3), now recipe-anchored. Each
    // axis perturbs ±40% from the recipe's authored scale. v0.16.0 final
    // migration step: prior Option-B mean-norm preserved iso designs but
    // wiped recipe anisotropy direction. Direct multiplicative anchoring
    // preserves both magnitude and direction from the recipe. Pre-norm
    // mean-norm removed; SCALE_CLAMP keeps individual axes inside [0.20, 5.00]
    // even for highly anisotropic recipes (e.g. recipe scaleX=4 jitters to
    // [2.4, 5.0] after clamp).
    out.scaleX = +mulJ(params.scaleX || 1, SCALE_CLAMP, draw.u(dimOff+1)).toFixed(3);
    out.scaleY = +mulJ(params.scaleY || 1, SCALE_CLAMP, draw.u(dimOff+2)).toFixed(3);
    out.scaleZ = +mulJ(params.scaleZ || 1, SCALE_CLAMP, draw.u(dimOff+3)).toFixed(3);
    // isoLevel — recipe ± 0.40 additive, clamped to [-0.95, 0.95]. Already
    // recipe-anchored pre-v0.16.0; jitter width bumped from 0.4 to keep it
    // consistent with grain post-migration.
    const isoVal = params.isoLevel + (Math.random()*2 - 1) * ISO_JITTER;
    out.isoLevel = +Math.max(ISO_CLAMP[0], Math.min(ISO_CLAMP[1], isoVal)).toFixed(3);
    // halfWidth — was flat [0.02, 0.30]; now recipe × [0.6, 1.4] clamped.
    // v0.18.0: MULT window shifts under ρ-pressure (target-aware sampling).
    out.halfWidth = +mulJ(params.halfWidth, HW_CLAMP, Math.random(), MULT_HW).toFixed(3);

    // Type-specific jitter — only touch params relevant to this noise type.
    // v0.16.0: all moved to recipe-anchored. Octaves uses additive ±2 integer
    // jitter (multiplicative would stick at 1 for low-octave recipes).
    const t = params.noiseType;
    const needsOctaves = (t === 'fbm' || t === 'ridged' || t === 'billow' || t === 'warp');
    if (needsOctaves) {
      const baseOct = params.octaves || 4;
      // Cap respects user import: max(4, imported) — keeps roomy headroom
      const octMax = Math.max(4, baseOct + OCT_DELTA);
      const octJittered = baseOct + Math.round((Math.random()*2 - 1) * OCT_DELTA);
      out.octaves    = Math.max(OCT_FLOOR, Math.min(octMax, octJittered));
      out.lacunarity = +mulJ(params.lacunarity || 2.0, LAC_CLAMP, Math.random()).toFixed(2);
      out.gain       = +mulJ(params.gain       || 0.5, GAIN_CLAMP, Math.random()).toFixed(2);
    }
    if (t === 'warp') {
      out.warpStrength = +mulJ(params.warpStrength || 1.0, WARP_CLAMP, Math.random()).toFixed(2);
    }
    if (t === 'curl') {
      out.curlStep       = +mulJ(params.curlStep       || 0.1, CURL_STEP_CLAMP, Math.random()).toFixed(2);
      out.potentialScale = +mulJ(params.potentialScale || 1.0, POT_SCALE_CLAMP, Math.random()).toFixed(2);
    }
    if (t === 'cellular') {
      // Uniform across the three metrics — explores the design space rather
      // than biasing toward the recipe's starting metric. Categorical, not
      // numeric — recipe-anchoring doesn't really apply.
      const metrics = ['euclidean', 'manhattan', 'chebyshev'];
      out.distanceMetric = metrics[Math.floor(Math.random() * 3)];
    }

    // Re-prepass — frequency/scales/octaves/lacunarity/gain all changed,
    // so the noise field's value range has shifted. Without rerun, the
    // normalization in evaluate() would use stale bounds and isoLevel/
    // halfWidth would land in skewed regions of the field.
    const bounds = this._prepass(out);
    out.noiseMin = bounds.noiseMin;
    out.noiseMax = bounds.noiseMax;

    return out;
  },

  // GLSL emission — supplies a `float fieldEval(vec3 p, float H)` function
  // that mirrors the Noise tool's preview shader's `noiseField + sampleNoise`
  // composition, plus the normalization step from `implicit`. Returns a single
  // function that can be composed by mode wrappers in buildFrag.
  //
  // Note: smoothing (sigma) is not supported in the sweep preview. The Noise
  // tool's preview applies a 6-tap blur via sampleNoise; the sweep preview
  // is faster without it and the difference is visual-only.
  //
  // TODO[deferred]: PI-style mode for noise (max(|noise(p)|, |noise(p+δ)|)<r)
  // would give noise-pipe topologies analogous to PI-TPMS. Skip for now until
  // it exists in the Noise tool itself, but the kernel architecture supports
  // adding it later by extending the mode list and adding GLSL phase-shift
  // handling here, parallel to the TPMS PI-TPMS path.
  emitGLSLField(params) {
    const t = params.noiseType;
    const needsFbm = (t === 'fbm' || t === 'warp' || t === 'ridged' || t === 'billow');
    const isCurl = (t === 'curl');
    const SCALE = (5.0 / Math.PI).toFixed(6);

    // Type-specific constants baked into shader (vs. uniforms in Noise tool —
    // sweep recompiles per design anyway, so baking is fine and avoids
    // wiring uniforms through the sweep's preview shader runtime).
    const fNum = v => { const s = (+v).toFixed(6); return s.indexOf('.') >= 0 ? s : s + '.0'; };
    const fInt = v => String(Math.round(v));
    const SX = fNum(params.scaleX), SY = fNum(params.scaleY), SZ = fNum(params.scaleZ);
    const FREQ = fNum(params.frequency);
    const NMIN = fNum(params.noiseMin), NMAX = fNum(params.noiseMax);
    const OCT = fInt(params.octaves), LAC = fNum(params.lacunarity), GAIN = fNum(params.gain);
    const WARP_S = fNum(params.warpStrength || 1.0);
    const CURL_E = fNum(params.curlStep || 0.1), POT_S = fNum(params.potentialScale || 1.0);

    // Simplex noise — verbatim from Noise tool _buildFrag
    const simplexCode = [
      'vec3 smod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec4 smod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
      'vec4 sperm(vec4 x){return smod289v(((x*34.0)+1.0)*x);}',
      'vec4 stis(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
      'float snoise(vec3 v){',
      ' const vec2 C=vec2(0.166666667,0.333333333);const vec4 D=vec4(0.0,0.5,1.0,2.0);',
      ' vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);',
      ' vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;',
      ' vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);',
      ' vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;',
      ' i=smod289(i);',
      ' vec4 p=sperm(sperm(sperm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
      ' float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;',
      ' vec4 j=p-49.0*floor(p*ns.z*ns.z);',
      ' vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);',
      ' vec4 xs=x_*ns.x+ns.yyyy;vec4 ys=y_*ns.x+ns.yyyy;',
      ' vec4 h=1.0-abs(xs)-abs(ys);',
      ' vec4 b0=vec4(xs.xy,ys.xy);vec4 b1=vec4(xs.zw,ys.zw);',
      ' vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;',
      ' vec4 sh=-step(h,vec4(0.0));',
      ' vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
      ' vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);',
      ' vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);',
      ' vec4 norm=stis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
      ' p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;',
      ' vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;',
      ' return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
      '}'
    ].join('\n');

    let typeCode = '', typeCall = '';
    if (t === 'simplex') {
      typeCall = 'snoise(sp)';
    } else if (t === 'cellular') {
      const metric = params.distanceMetric || 'euclidean';
      const distExpr = metric === 'euclidean' ? 'length(diff)' :
                       metric === 'manhattan' ? 'abs(diff.x)+abs(diff.y)+abs(diff.z)' :
                       'max(abs(diff.x),max(abs(diff.y),abs(diff.z)))';
      typeCode = [
        'float cellular(vec3 p){',
        ' vec3 pi=floor(p);vec3 pf=fract(p);float d1=10.0,d2=10.0;',
        ' for(int oz=-1;oz<=1;oz++){for(int oy=-1;oy<=1;oy++){for(int ox=-1;ox<=1;ox++){',
        '  vec3 cell=pi+vec3(float(ox),float(oy),float(oz));',
        '  vec3 rp=fract(sin(vec3(dot(cell,vec3(127.1,311.7,74.7)),dot(cell,vec3(269.5,183.3,246.1)),dot(cell,vec3(113.5,271.9,124.6))))*43758.5453);',
        '  vec3 diff=vec3(float(ox),float(oy),float(oz))+rp-pf;',
        '  float d=' + distExpr + ';',
        '  if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;',
        ' }}}',
        ' return clamp((d2-d1)*2.0-1.0,-1.0,1.0);',
        '}'
      ].join('\n');
      typeCall = 'cellular(sp)';
    } else if (t === 'fbm' || t === 'warp') {
      typeCode = [
        'float fbm(vec3 p){',
        ' float v=0.0,a=1.0,f=1.0,mx=0.0;',
        ' for(int i=0;i<' + OCT + ';i++){v+=snoise(p*f)*a;mx+=a;a*=' + GAIN + ';f*=' + LAC + ';}',
        ' return v/mx;',
        '}'
      ].join('\n');
      if (t === 'warp') {
        // 2-octave fbm for q-vector (Noise tool's optimization)
        typeCode += '\n' + [
          'float fbm2(vec3 p){',
          ' float v=0.0,a=1.0,f=1.0,mx=0.0;',
          ' for(int i=0;i<2;i++){v+=snoise(p*f)*a;mx+=a;a*=' + GAIN + ';f*=' + LAC + ';}',
          ' return v/mx;',
          '}'
        ].join('\n');
        typeCall = 'fbm(sp+' + WARP_S + '*vec3(fbm2(sp),fbm2(sp+vec3(5.2,1.3,8.1)),fbm2(sp+vec3(3.7,9.4,2.8))))';
      } else {
        typeCall = 'fbm(sp)';
      }
    } else if (t === 'ridged') {
      typeCode = [
        'float ridged(vec3 p){',
        ' float v=0.0,a=1.0,f=1.0,mx=0.0;',
        ' for(int i=0;i<' + OCT + ';i++){v+=(1.0-abs(snoise(p*f)))*a;mx+=a;a*=' + GAIN + ';f*=' + LAC + ';}',
        ' return (v/mx)*2.0-1.0;',
        '}'
      ].join('\n');
      typeCall = 'ridged(sp)';
    } else if (t === 'billow') {
      typeCode = [
        'float billow(vec3 p){',
        ' float v=0.0,a=1.0,f=1.0,mx=0.0;',
        ' for(int i=0;i<' + OCT + ';i++){v+=abs(snoise(p*f))*a;mx+=a;a*=' + GAIN + ';f*=' + LAC + ';}',
        ' return (v/mx)*2.0-1.0;',
        '}'
      ].join('\n');
      typeCall = 'billow(sp)';
    } else if (t === 'curl') {
      typeCode = [
        'float curlField(vec3 p){',
        ' float s=' + POT_S + ';float e=' + CURL_E + ';',
        ' float bx=snoise(p*s);',
        ' float by=snoise(p*s+vec3(3.7,1.5,2.8));',
        ' float bz=snoise(p*s+vec3(1.2,4.6,0.9));',
        ' float ox=snoise((p+vec3(e,0.0,0.0))*s);',
        ' float oy=snoise((p+vec3(0.0,e,0.0))*s+vec3(3.7,1.5,2.8));',
        ' float oz=snoise((p+vec3(0.0,0.0,e))*s+vec3(1.2,4.6,0.9));',
        ' float cx=(oz-bz)/e-(oy-by)/e;',
        ' float cy=(ox-bx)/e-(oz-bz)/e;',
        ' float cz=(oy-by)/e-(ox-bx)/e;',
        ' return length(vec3(cx,cy,cz));',
        '}'
      ].join('\n');
      typeCall = 'curlField(sp)';
    }

    // fieldEval — solver-space (p,H) input. The cube renders at extent ±H
    // (where H = π·cellMult), but noise should sample at the same density
    // the Noise tool renders at — that is, one Noise-tool-equivalent
    // [-π,π] worth of noise space, regardless of cube size. We rescale by
    // π/H (= 1/cellMult) to map cube-sized p back into [-π,π], then apply
    // the standard SCALE × freq × scaleAxis multiply. Result: noise
    // pattern density is invariant to cellMult; the cube just clips a
    // larger or smaller region of the same pattern.
    const fns =
      simplexCode + '\n' +
      typeCode + '\n' +
      'float fieldEval(vec3 p, float H){\n' +
      '  vec3 sp = (p * (3.14159265 / H)) * vec3(' + SX + ',' + SY + ',' + SZ + ') * (' + SCALE + ' * ' + FREQ + ');\n' +
      '  float raw = ' + typeCall + ';\n' +
      '  float mid = (' + NMAX + ' + ' + NMIN + ') * 0.5;\n' +
      '  float halfR = max((' + NMAX + ' - ' + NMIN + ') * 0.5, 0.001);\n' +
      '  return (raw - mid) / halfR;\n' +
      '}';

    return { fns, exprFn: 'fieldEval' };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
