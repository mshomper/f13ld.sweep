/* ============================================================
   F13LD.sweep · geom/grain.js
   Grain field: spinodoid, Gaussian random field, hyperuniform.

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (13-kernels.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-GRAIN v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ════════════════════════════════════════════════════════════
   GrainKernel — spinodoid + GRF + hyperuniform from F13LD.grain
   Reaction-diffusion is deferred (texture-based, not analytic).
   Verbatim port of the analytic field generators.
   ════════════════════════════════════════════════════════════ */
var GrainKernel = {
  family: 'grain',

  _mulberry32: function (seed) {
    var s = seed | 0;
    return function () {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >> 17)) >>> 0;
      s = (s ^ (s << 5))  >>> 0;
      return s / 4294967296;
    };
  },

  /* von Mises-Fisher around the +z pole (caller rotates with _rotateTo) */
  _sampleVMF: function (rng, kappa) {
    if (kappa < 0.05) {
      var z = 2*rng() - 1, phi = 2*Math.PI*rng();
      var sr = Math.sqrt(Math.max(0, 1 - z*z));
      return [sr*Math.cos(phi), sr*Math.sin(phi), z];
    }
    var w, iter = 0;
    do {
      var xi = rng();
      w = 1 + Math.log(Math.max(xi + (1 - xi)*Math.exp(-2*kappa), 1e-30)) / kappa;
      iter++;
    } while ((w < -1 || w > 1) && iter < 2000);
    if (w < -1) w = -1; if (w > 1) w = 1;
    var phi2 = 2*Math.PI*rng(), sr2 = Math.sqrt(Math.max(0, 1 - w*w));
    return [sr2*Math.cos(phi2), sr2*Math.sin(phi2), w];
  },

  _rotateTo: function (v, mux, muy, muz) {
    if (Math.abs(muz + 1) < 1e-6) return [-v[0], -v[1], -v[2]];
    if (Math.abs(muz - 1) < 1e-6) return v.slice();
    var ax = -muy, ay = mux;
    var al = Math.sqrt(ax*ax + ay*ay); ax /= al; ay /= al;
    var angle = Math.acos(Math.min(Math.max(muz, -1), 1));
    var c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    var vx = v[0], vy = v[1], vz = v[2];
    return [
      (t*ax*ax + c)*vx + (t*ax*ay)*vy + ( s*ay)*vz,
      (t*ax*ay)*vx    + (t*ay*ay + c)*vy + (-s*ax)*vz,
      (-s*ay)*vx      + (s*ax)*vy        + c*vz
    ];
  },

  _jitteredGrid3D: function (N, rng) {
    var cells = Math.ceil(Math.pow(N, 1/3));
    var cellSize = 1.0 / cells;
    var pts = [];
    for (var ix = 0; ix < cells; ix++)
      for (var iy = 0; iy < cells; iy++)
        for (var iz = 0; iz < cells; iz++) {
          var px = (ix + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          var py = (iy + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          var pz = (iz + 0.5 + (rng() - 0.5) * 0.9) * cellSize;
          pts.push([
            Math.max(0.01, Math.min(0.99, px)),
            Math.max(0.01, Math.min(0.99, py)),
            Math.max(0.01, Math.min(0.99, pz))
          ]);
        }
    for (var i = pts.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
    }
    return pts.slice(0, N);
  },

  /* Spinodoid waves: VMF-sampled directions, magnitude 2π·freq ±15% */
  _buildSpinodoidWaves: function (p) {
    var rng = this._mulberry32(p.rngSeed);
    var N = p.nWaves, freq = p.frequency, kappa = p.kappa, mode = p.dirMode;
    var mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    var axes = [[1,0,0],[0,1,0],[0,0,1]];
    var wts  = [p.wX, p.wY, p.wZ];
    var totalW = Math.max(wts[0] + wts[1] + wts[2], 1e-6);
    var waves = [];
    for (var i = 0; i < N; i++) {
      var dir;
      if (mode === 'iso') {
        dir = this._sampleVMF(rng, 0);
      } else if (mode === 'single') {
        dir = this._rotateTo(this._sampleVMF(rng, kappa), mux, muy, muz);
      } else { /* ortho */
        var r = rng() * totalW;
        var cum = 0, chosen = 0;
        for (var a = 0; a < 3; a++) { cum += wts[a]; if (r <= cum) { chosen = a; break; } }
        dir = this._rotateTo(this._sampleVMF(rng, kappa),
                             axes[chosen][0], axes[chosen][1], axes[chosen][2]);
      }
      var mag = 2*Math.PI*freq*(0.85 + 0.3*rng());
      var phase = 2*Math.PI*rng();
      waves.push({ kx: dir[0]*mag, ky: dir[1]*mag, kz: dir[2]*mag, phase: phase });
    }
    return waves;
  },

  /* GRF waves: uniform directions, Gaussian-sampled magnitudes */
  _buildGRFWaves: function (p) {
    var rng = this._mulberry32(p.rngSeed);
    var N = p.nWaves, freq = p.frequency, mode = p.dirMode;
    var sigmafrac = p.grfSigma || 0.45;
    var k0base = 2*Math.PI*freq;
    var mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    var waves = [];
    function randn() {
      var u = Math.max(rng(), 1e-10), v = rng();
      return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
    }
    for (var i = 0; i < N; i++) {
      var dir = this._sampleVMF(rng, 0);
      var k0;
      if (mode === 'ortho') {
        var wx = p.wX, wy = p.wY, wz = p.wZ;
        var totalW = Math.max(wx + wy + wz, 1e-6);
        wx /= totalW; wy /= totalW; wz /= totalW;
        var maxW = Math.max(wx, wy, wz);
        var kScale = 1.0 / (Math.max(wx*dir[0]*dir[0] + wy*dir[1]*dir[1] + wz*dir[2]*dir[2], 0.05) / maxW);
        kScale = Math.min(Math.max(kScale, 0.3), 3.0);
        k0 = k0base * kScale;
      } else if (mode === 'single') {
        var alignment = Math.abs(dir[0]*mux + dir[1]*muy + dir[2]*muz);
        k0 = k0base * (1.5 - alignment);
      } else {
        k0 = k0base;
      }
      var sigma = sigmafrac * k0;
      var mag, tries = 0;
      do { mag = k0 + randn()*sigma; tries++; } while (mag <= 0 && tries < 30);
      if (mag <= 0) mag = k0 * 0.1;
      var phase = 2*Math.PI*rng();
      waves.push({ kx: dir[0]*mag, ky: dir[1]*mag, kz: dir[2]*mag, phase: phase });
    }
    return waves;
  },

  /* Hyperuniform: anisotropic Gaussian kernels at jittered grid points */
  _buildHUKernels: function (p) {
    var rng = this._mulberry32(p.rngSeed);
    var N = p.huN || 80, aspect = p.huAspect || 4.0, bw = p.huWidth || 0.04;
    var ell = p.huEll || 1, sq = Math.sqrt(ell);
    var a = bw * aspect * 0.5, b = bw * 0.5, b1 = b / sq, b2 = b * sq;
    var kappa = p.kappa, mode = p.dirMode;
    var pts = this._jitteredGrid3D(N, rng);
    var mux = p.principalX, muy = p.principalY, muz = p.principalZ;
    var axes = [[1,0,0],[0,1,0],[0,0,1]];
    var wts  = [p.wX, p.wY, p.wZ];
    var totalW = Math.max(wts[0] + wts[1] + wts[2], 1e-6);
    function cross3(u, v) {
      return [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]];
    }
    function norm3(v) {
      var l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]) || 1;
      return [v[0]/l, v[1]/l, v[2]/l];
    }
    var kernels = [];
    var TWO_PI = 2.0 * Math.PI;
    for (var i = 0; i < N; i++) {
      var t;
      if (mode === 'iso') {
        t = this._sampleVMF(rng, 0);
      } else if (mode === 'single') {
        t = this._rotateTo(this._sampleVMF(rng, kappa), mux, muy, muz);
      } else {
        var r = rng() * totalW;
        var cum = 0, chosen = 0;
        for (var ax = 0; ax < 3; ax++) { cum += wts[ax]; if (r <= cum) { chosen = ax; break; } }
        t = this._rotateTo(this._sampleVMF(rng, kappa),
                           axes[chosen][0], axes[chosen][1], axes[chosen][2]);
      }
      var arb = (Math.abs(t[0]) < 0.9) ? [1, 0, 0] : [0, 1, 0];
      var n1 = norm3(cross3(t, arb));
      var n2 = norm3(cross3(t, n1));
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
    kernels.cross = p.huCross || 2;
    kernels.sharp = p.huSharp || 1;
    kernels.blend = p.huBlend || 1;
    return kernels;
  },

  parseRecipe: function (recipe) {
    if (!recipe.field) {
      throw new Error("GrainKernel.parseRecipe: recipe missing 'field' block");
    }
    var f = recipe.field;
    var g = recipe.geometry || {};
    var ft = f.type;
    if (ft === 'reactiondiffusion') {
      throw new Error("GrainKernel.parseRecipe: reaction-diffusion is deferred (texture-based; F13LD.lab uses analytic evaluators)");
    }
    if (ft !== 'spinodoid' && ft !== 'gaussian' && ft !== 'hyperuniform') {
      throw new Error("GrainKernel.parseRecipe: unsupported field.type '" + ft + "' (expected spinodoid | gaussian | hyperuniform)");
    }
    var pdir = (Array.isArray(f.principal_direction) && f.principal_direction.length === 3)
      ? f.principal_direction.slice()
      : [0, 0, 1];
    var pn = Math.sqrt(pdir[0]*pdir[0] + pdir[1]*pdir[1] + pdir[2]*pdir[2]) || 1;
    pdir = [pdir[0]/pn, pdir[1]/pn, pdir[2]/pn];
    var ow = (Array.isArray(f.ortho_weights) && f.ortho_weights.length === 3) ? f.ortho_weights : [1, 1, 1];
    var params = {
      fieldType:  ft,
      frequency:  f.frequency != null ? f.frequency : 0.27,
      rngSeed:    f.rng_seed  != null ? f.rng_seed  : 42,
      dirMode:    f.dir_mode  || 'single',
      kappa:      f.kappa     != null ? f.kappa     : 6,
      principalX: pdir[0], principalY: pdir[1], principalZ: pdir[2],
      wX: ow[0], wY: ow[1], wZ: ow[2],
      nWaves:    f.n_waves   != null ? f.n_waves   : 48,
      grfSigma:  f.grf_sigma != null ? f.grf_sigma : 0.45,
      huN:       f.hu_n      != null ? f.hu_n      : 80,
      huAspect:  f.hu_aspect != null ? f.hu_aspect : 4.0,
      huWidth:   f.hu_width  != null ? f.hu_width  : 0.04,
      huCross:   f.hu_cross  != null ? f.hu_cross  : 2,
      huSharp:   f.hu_sharp  != null ? f.hu_sharp  : 1,
      huBlend:   f.hu_blend  != null ? f.hu_blend  : 1,
      huEll:     f.hu_ell    != null ? f.hu_ell    : 1,
      isoLevel:  g.center      != null ? g.center      : 0,
      halfWidth: g.half_width  != null ? g.half_width  : 0.15,
      smoothing: g.smoothing   || 0,
      halfInvert: !!g.half_invert
    };
    if (ft === 'spinodoid')        params.waves   = this._buildSpinodoidWaves(params);
    else if (ft === 'gaussian')    params.waves   = this._buildGRFWaves(params);
    else {
      params.kernels = this._buildHUKernels(params);
      /* Periodic wrap (v0.7.2, approved): F13LD.mesh exports hyperuniform by
         copying the design cell's kernels into every cell of the part and
         summing across cell faces (buildHUKernelsMM).  The solver treats the
         cell as periodic, so it must see the same thing: add each kernel's
         periodic images that can reach the cell.  Without this, kernels near
         a face are cut off and the faces run starved (x-face solid 0.06 vs
         0.17 interior), which pruning then deletes.  Opt out per recipe with
         field.hu_wrap = false (reproduces pre-0.7.2 results). */
      params.huWrap = (f.hu_wrap !== false);
      if (params.huWrap) params.kernels = this._wrapHUKernels(params.kernels);
    }
    if (!recipe.family) recipe.family = 'grain';
    return params;
  },

  /* Periodic images of HU kernels whose support can touch [-π, π]³.
     Reach matches F13LD.mesh buildHUKernelsMM: beyond R = 12.25^(1/m) a
     kernel contributes < 5e-6, far below any threshold in use. */
  _wrapHUKernels: function (ks) {
    if (!ks.length) return ks;
    var TP = 2 * Math.PI, PI = Math.PI;
    var p = ks.cross || 2, m = ks.sharp || 1;
    var Rc = Math.pow(12.25, 1 / m);
    var out = [];
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      var reach = Math.max(k.a * Math.sqrt(Rc), k.b1 * Math.pow(Rc, 1 / p), k.b2 * Math.pow(Rc, 1 / p));
      var pad = Math.max(1, Math.ceil(reach / TP));
      for (var ox = -pad; ox <= pad; ox++)
        for (var oy = -pad; oy <= pad; oy++)
          for (var oz = -pad; oz <= pad; oz++) {
            var cx = k.px + ox * TP, cy = k.py + oy * TP, cz = k.pz + oz * TP;
            if (cx < -PI - reach || cx > PI + reach ||
                cy < -PI - reach || cy > PI + reach ||
                cz < -PI - reach || cz > PI + reach) continue;
            var c = {};
            for (var key in k) if (Object.prototype.hasOwnProperty.call(k, key)) c[key] = k[key];
            c.px = cx; c.py = cy; c.pz = cz;
            out.push(c);
          }
    }
    out.cross = ks.cross; out.sharp = ks.sharp; out.blend = ks.blend;
    out.nDesign = ks.length;
    return out;
  },

  /* CPU field evaluation — RAW field value at solver-space (x,y,z) ∈ [-π, π]³.
     Wave families: Σ cos(k·p + φ) / √N — natural range ~[-1, 1].
     HU family:     Σ exp(-Q(p - c)) - 0.3 — natural range ~[-0.3, 1]. */
  evaluate: function (params, x, y, z) {
    if (params.kernels) {
      var ks = params.kernels;
      var pe = ks.cross || 2, me = ks.sharp || 1, Pe = ks.blend || 1;
      var rnd = (pe === 2), shp = (me === 1), bl = (Pe === 1);
      var s = 0;
      for (var i = 0; i < ks.length; i++) {
        var k = ks[i];
        var dx = x - k.px, dy = y - k.py, dz = z - k.pz;
        var dt  = dx*k.tx  + dy*k.ty  + dz*k.tz;
        var dn1 = dx*k.n1x + dy*k.n1y + dz*k.n1z;
        var dn2 = dx*k.n2x + dy*k.n2y + dz*k.n2z;
        var u = dt/k.a, w1 = dn1/k.b1, w2 = dn2/k.b2;
        var R = u*u + (rnd ? (w1*w1 + w2*w2)
                           : (Math.pow(Math.abs(w1), pe) + Math.pow(Math.abs(w2), pe)));
        var Rm = shp ? R : Math.pow(R, me);
        s += bl ? Math.exp(-Rm) : Math.exp(-Pe*Rm);
      }
      if (!bl) s = Math.pow(s, 1/Pe);
      return s - 0.3;
    }
    var ws = params.waves;
    var N = ws.length;
    var s2 = 0;
    for (var i2 = 0; i2 < N; i2++) {
      s2 += Math.cos(ws[i2].kx*x + ws[i2].ky*y + ws[i2].kz*z + ws[i2].phase);
    }
    return s2 / Math.sqrt(N);
  }
};

/* ==== /F13LD-GEOM-GRAIN ==== */
