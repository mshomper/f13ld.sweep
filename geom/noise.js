/* ============================================================
   F13LD.sweep · geom/noise.js
   Noise field: the ten F13LD.noise types, seed, stored normalization range.

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (13-kernels.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-NOISE v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ════════════════════════════════════════════════════════════
   NoiseKernel — the ten deterministic noise types of F13LD.noise
   (v0.11.0): simplex / cellular / fbm / ridged / billow / foam /
   strut / veined / curl / warp.  Math copied from the tool's
   DeterministicNoise (index.html) and F13LD.mesh worker/m10-noise.js,
   so the lab builds the field the tool designs and Mesh prints.

   ── Coordinates ───────────────────────────────────────────────
   Lab samples x ∈ [-π, π]³.  The tool's voxelizer and prepass use
   the same cube and map it to noise input as x·(5/π)·freq·scale
   (≡ Mesh's world [-5,5]³ · freq · scale).  The seed is a constant
   coordinate offset added in noise-input space (seedToOffset).

   ── Normalization ─────────────────────────────────────────────
   The tool exports its 32³ preview range as surface.norm_min /
   norm_max and Mesh prints with it, so that range is used whenever
   the recipe carries it.  It belongs to the exported settings:
   60-add-design.js stamps surface.norm_for = noiseNormKey(surface)
   on import, and once a lab sweep changes anything that moves the
   raw field (frequency, scale, octaves, seed …) the stamp no longer
   matches and the range is recomputed exactly as the tool's export
   does (_prepass: 32³ corner-inclusive scan, ±5 % pad).  Recipes
   with no stamp (older imports, tests) keep their stored range.
   ════════════════════════════════════════════════════════════ */
var NOISE_TYPES = ['simplex', 'cellular', 'fbm', 'ridged', 'billow', 'foam', 'strut', 'veined', 'curl', 'warp'];

var NoiseKernel = {
  family: 'noise',

  _mod289:  function (x) { return x - Math.floor(x / 289.0) * 289.0; },
  _permute: function (x) { return this._mod289(((x * 34.0) + 1.0) * x); },
  _tis:     function (r) { return 1.79284291400159 - 0.85373472095314 * r; },
  _frac:    function (x) { return x - Math.floor(x); },

  /* 3D simplex noise — verbatim from Noise tool DeterministicNoise.snoise */
  _snoise: function (vx, vy, vz) {
    var C0 = 1.0/6.0, C1 = 1.0/3.0;
    var s = (vx+vy+vz)*C1;
    var ix = Math.floor(vx+s), iy = Math.floor(vy+s), iz = Math.floor(vz+s);
    var t = (ix+iy+iz)*C0;
    var x0x = vx-ix+t, x0y = vy-iy+t, x0z = vz-iz+t;
    var gx = x0x>=x0y?1:0, gy = x0y>=x0z?1:0, gz = x0z>=x0x?1:0;
    var lx = 1-gx, ly = 1-gy, lz = 1-gz;
    var i1x = Math.min(gx,lz), i1y = Math.min(gy,lx), i1z = Math.min(gz,ly);
    var i2x = Math.max(gx,lz), i2y = Math.max(gy,lx), i2z = Math.max(gz,ly);
    var x1x = x0x-i1x+C0, x1y = x0y-i1y+C0, x1z = x0z-i1z+C0;
    var x2x = x0x-i2x+C1, x2y = x0y-i2y+C1, x2z = x0z-i2z+C1;
    var x3x = x0x-0.5,    x3y = x0y-0.5,    x3z = x0z-0.5;
    ix = this._mod289(ix); iy = this._mod289(iy); iz = this._mod289(iz);
    var p0 = this._permute(this._permute(this._permute(iz)+iy)+ix);
    var p1 = this._permute(this._permute(this._permute(iz+i1z)+iy+i1y)+ix+i1x);
    var p2 = this._permute(this._permute(this._permute(iz+i2z)+iy+i2y)+ix+i2x);
    var p3 = this._permute(this._permute(this._permute(iz+1)+iy+1)+ix+1);
    var nx = 0.285714285714, ny = -0.928571428571, nz = 0.142857142857;
    var j0 = p0-49*Math.floor(p0*nz*nz);
    var j1 = p1-49*Math.floor(p1*nz*nz);
    var j2 = p2-49*Math.floor(p2*nz*nz);
    var j3 = p3-49*Math.floor(p3*nz*nz);
    var x0_ = Math.floor(j0*nz), y0_ = Math.floor(j0-7*x0_);
    var x1_ = Math.floor(j1*nz), y1_ = Math.floor(j1-7*x1_);
    var x2_ = Math.floor(j2*nz), y2_ = Math.floor(j2-7*x2_);
    var x3_ = Math.floor(j3*nz), y3_ = Math.floor(j3-7*x3_);
    var xs0 = x0_*nx+ny, ys0 = y0_*nx+ny;
    var xs1 = x1_*nx+ny, ys1 = y1_*nx+ny;
    var xs2 = x2_*nx+ny, ys2 = y2_*nx+ny;
    var xs3 = x3_*nx+ny, ys3 = y3_*nx+ny;
    var h0 = 1-Math.abs(xs0)-Math.abs(ys0);
    var h1 = 1-Math.abs(xs1)-Math.abs(ys1);
    var h2 = 1-Math.abs(xs2)-Math.abs(ys2);
    var h3 = 1-Math.abs(xs3)-Math.abs(ys3);
    var sh0 = h0<=0?-1:0, sh1 = h1<=0?-1:0, sh2 = h2<=0?-1:0, sh3 = h3<=0?-1:0;
    var pp0x = xs0+(Math.floor(xs0)*2+1)*sh0, pp0y = ys0+(Math.floor(ys0)*2+1)*sh0, pp0z = h0;
    var pp1x = xs1+(Math.floor(xs1)*2+1)*sh1, pp1y = ys1+(Math.floor(ys1)*2+1)*sh1, pp1z = h1;
    var pp2x = xs2+(Math.floor(xs2)*2+1)*sh2, pp2y = ys2+(Math.floor(ys2)*2+1)*sh2, pp2z = h2;
    var pp3x = xs3+(Math.floor(xs3)*2+1)*sh3, pp3y = ys3+(Math.floor(ys3)*2+1)*sh3, pp3z = h3;
    var n0 = this._tis(pp0x*pp0x+pp0y*pp0y+pp0z*pp0z);
    var n1 = this._tis(pp1x*pp1x+pp1y*pp1y+pp1z*pp1z);
    var n2 = this._tis(pp2x*pp2x+pp2y*pp2y+pp2z*pp2z);
    var n3 = this._tis(pp3x*pp3x+pp3y*pp3y+pp3z*pp3z);
    pp0x*=n0; pp0y*=n0; pp0z*=n0;
    pp1x*=n1; pp1y*=n1; pp1z*=n1;
    pp2x*=n2; pp2y*=n2; pp2z*=n2;
    pp3x*=n3; pp3y*=n3; pp3z*=n3;
    var m0 = Math.max(0.6-(x0x*x0x+x0y*x0y+x0z*x0z),0); m0*=m0;
    var m1 = Math.max(0.6-(x1x*x1x+x1y*x1y+x1z*x1z),0); m1*=m1;
    var m2 = Math.max(0.6-(x2x*x2x+x2y*x2y+x2z*x2z),0); m2*=m2;
    var m3 = Math.max(0.6-(x3x*x3x+x3y*x3y+x3z*x3z),0); m3*=m3;
    return 42*(m0*m0*(pp0x*x0x+pp0y*x0y+pp0z*x0z)+
               m1*m1*(pp1x*x1x+pp1y*x1y+pp1z*x1z)+
               m2*m2*(pp2x*x2x+pp2y*x2y+pp2z*x2z)+
               m3*m3*(pp3x*x3x+pp3y*x3y+pp3z*x3z));
  },

  /* Dave Hoskins hash33 — trig-free cell-seed hash, verbatim from the
     tool (JS + GLSL) and Mesh m10-noise.js.  Replaces the old sin-fract
     hash, which the tool dropped because it clustered. */
  _hash33: function (px, py, pz) {
    var qx = this._frac(px*0.1031), qy = this._frac(py*0.1030), qz = this._frac(pz*0.0973);
    var d = qx*(qy+33.33) + qy*(qx+33.33) + qz*(qz+33.33);
    qx += d; qy += d; qz += d;
    return [this._frac((qx+qy)*qz), this._frac((qx+qx)*qy), this._frac((qx+qy)*qx)];
  },

  /* Worley loop shared by cellular / foam / strut: 3×3×3 neighbourhood,
     cell seed = 0.5 + jitter·(hash33 − 0.5).  Each function is the tool's
     own (cellular, foam, strut in DeterministicNoise), not a shared helper,
     so they diff line-for-line against it. */

  /* Cellular (Worley F2−F1, clamped to [-1,1]) */
  _cellular: function (px, py, pz, metric, jitter) {
    var pix = Math.floor(px), piy = Math.floor(py), piz = Math.floor(pz);
    var pfx = px-pix, pfy = py-piy, pfz = pz-piz;
    var d1 = 10, d2 = 10;
    for (var oz=-1; oz<=1; oz++) for (var oy=-1; oy<=1; oy++) for (var ox=-1; ox<=1; ox++) {
      var cx = pix+ox, cy = piy+oy, cz = piz+oz;
      var rp = this._hash33(cx, cy, cz);
      var rpx = 0.5+jitter*(rp[0]-0.5), rpy = 0.5+jitter*(rp[1]-0.5), rpz = 0.5+jitter*(rp[2]-0.5);
      var dx = ox+rpx-pfx, dy = oy+rpy-pfy, dz = oz+rpz-pfz;
      var d = metric==='euclidean' ? Math.sqrt(dx*dx+dy*dy+dz*dz) :
              metric==='manhattan' ? Math.abs(dx)+Math.abs(dy)+Math.abs(dz) :
              Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
      if (d<d1) { d2=d1; d1=d; } else if (d<d2) d2=d;
    }
    return Math.max(Math.min((d2-d1)*2-1, 1), -1);
  },

  /* Foam (Worley F2, raw 2nd-nearest distance) — rounded closed cells */
  _foam: function (px, py, pz, metric, jitter) {
    var pix = Math.floor(px), piy = Math.floor(py), piz = Math.floor(pz);
    var pfx = px-pix, pfy = py-piy, pfz = pz-piz;
    var d1 = 10, d2 = 10;
    for (var oz=-1; oz<=1; oz++) for (var oy=-1; oy<=1; oy++) for (var ox=-1; ox<=1; ox++) {
      var cx = pix+ox, cy = piy+oy, cz = piz+oz;
      var rp = this._hash33(cx, cy, cz);
      var rpx = 0.5+jitter*(rp[0]-0.5), rpy = 0.5+jitter*(rp[1]-0.5), rpz = 0.5+jitter*(rp[2]-0.5);
      var dx = ox+rpx-pfx, dy = oy+rpy-pfy, dz = oz+rpz-pfz;
      var d = metric==='euclidean' ? Math.sqrt(dx*dx+dy*dy+dz*dz) :
              metric==='manhattan' ? Math.abs(dx)+Math.abs(dy)+Math.abs(dz) :
              Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
      if (d<d1) { d2=d1; d1=d; } else if (d<d2) d2=d;
    }
    return d2;
  },

  /* Strut network (Worley F3−F1) — ~0 along Voronoi edges, so a low
     threshold gives connected round struts (open-cell / trabecular rods) */
  _strut: function (px, py, pz, metric, jitter) {
    var pix = Math.floor(px), piy = Math.floor(py), piz = Math.floor(pz);
    var pfx = px-pix, pfy = py-piy, pfz = pz-piz;
    var d1 = 10, d2 = 10, d3 = 10;
    for (var oz=-1; oz<=1; oz++) for (var oy=-1; oy<=1; oy++) for (var ox=-1; ox<=1; ox++) {
      var cx = pix+ox, cy = piy+oy, cz = piz+oz;
      var rp = this._hash33(cx, cy, cz);
      var rpx = 0.5+jitter*(rp[0]-0.5), rpy = 0.5+jitter*(rp[1]-0.5), rpz = 0.5+jitter*(rp[2]-0.5);
      var dx = ox+rpx-pfx, dy = oy+rpy-pfy, dz = oz+rpz-pfz;
      var d = metric==='euclidean' ? Math.sqrt(dx*dx+dy*dy+dz*dz) :
              metric==='manhattan' ? Math.abs(dx)+Math.abs(dy)+Math.abs(dz) :
              Math.max(Math.abs(dx), Math.max(Math.abs(dy), Math.abs(dz)));
      if (d<d1) { d3=d2; d2=d1; d1=d; } else if (d<d2) { d3=d2; d2=d; } else if (d<d3) { d3=d; }
    }
    return d3-d1;
  },

  _fbm: function (px, py, pz, octaves, lacunarity, gain) {
    var v = 0, a = 1, f = 1, mx = 0;
    for (var i = 0; i < octaves; i++) {
      v += this._snoise(px*f, py*f, pz*f) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return v / mx;
  },

  _warp: function (px, py, pz, strength, octaves, lacunarity, gain) {
    var qx = this._fbm(px, py, pz, octaves, lacunarity, gain);
    var qy = this._fbm(px+5.2, py+1.3, pz+8.1, octaves, lacunarity, gain);
    var qz = this._fbm(px+3.7, py+9.4, pz+2.8, octaves, lacunarity, gain);
    return this._fbm(px+strength*qx, py+strength*qy, pz+strength*qz, octaves, lacunarity, gain);
  },

  _ridged: function (px, py, pz, octaves, lacunarity, gain) {
    var v = 0, a = 1, f = 1, mx = 0;
    for (var i = 0; i < octaves; i++) {
      v += (1 - Math.abs(this._snoise(px*f, py*f, pz*f))) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return (v/mx) * 2.0 - 1.0;
  },

  _billow: function (px, py, pz, octaves, lacunarity, gain) {
    var v = 0, a = 1, f = 1, mx = 0;
    for (var i = 0; i < octaves; i++) {
      v += Math.abs(this._snoise(px*f, py*f, pz*f)) * a;
      mx += a; a *= gain; f *= lacunarity;
    }
    return (v/mx) * 2.0 - 1.0;
  },

  /* Veined — turbulence-warped periodic banding (sin of x·freq + turb·fbm) */
  _veined: function (px, py, pz, turb, freq, octaves, lacunarity, gain) {
    return Math.sin(px*freq + turb*this._fbm(px, py, pz, octaves, lacunarity, gain));
  },

  /* Curl noise — magnitude of ∇×Ψ from a simplex vector potential.
     9 snoise calls per evaluation. */
  _curl: function (px, py, pz, curlStep, potScale) {
    var s = potScale, e = curlStep;
    var psi_x = this._snoise(px*s,           py*s,           pz*s);
    var psi_y = this._snoise(px*s+3.7,       py*s+1.5,       pz*s+2.8);
    var psi_z = this._snoise(px*s+1.2,       py*s+4.6,       pz*s+0.9);
    var pzy   = this._snoise(px*s+1.2,       (py+e)*s+4.6,   pz*s+0.9);
    var pyz   = this._snoise(px*s+3.7,       py*s+1.5,       (pz+e)*s+2.8);
    var pxz   = this._snoise(px*s,           py*s,           (pz+e)*s);
    var pzx   = this._snoise((px+e)*s+1.2,   py*s+4.6,       pz*s+0.9);
    var pyx   = this._snoise((px+e)*s+3.7,   py*s+1.5,       pz*s+2.8);
    var pxy   = this._snoise(px*s,           (py+e)*s,       pz*s);
    var cx = (pzy-psi_z)/e - (pyz-psi_y)/e;
    var cy = (pxz-psi_x)/e - (pzx-psi_z)/e;
    var cz = (pyx-psi_y)/e - (pxy-psi_x)/e;
    return Math.sqrt(cx*cx + cy*cy + cz*cz);
  },

  /* seed → constant noise-input offset, verbatim from the tool's
     seedToOffset (seed 0 = no offset). */
  _seedToOffset: function (s) {
    if (s === 0) return [0, 0, 0];
    var h = function (n) { var x = Math.sin(n)*43758.5453; return (x-Math.floor(x))*64.0; };
    return [h(s*127.1+11.7), h(s*269.5+53.3), h(s*113.5+97.1)];
  },

  /* Raw field at noise-input point (sx,sy,sz) — the tool's
     DeterministicNoise.sample(): seed offset first, then type dispatch. */
  _sampleRaw: function (params, sx, sy, sz) {
    var so = params.seedOffset;
    if (so) { sx += so[0]; sy += so[1]; sz += so[2]; }
    var t = params.noiseType;
    if (t === 'simplex')  return this._snoise(sx, sy, sz);
    if (t === 'cellular') return this._cellular(sx, sy, sz, params.distanceMetric, params.jitter);
    if (t === 'fbm')      return this._fbm(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'ridged')   return this._ridged(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'billow')   return this._billow(sx, sy, sz, params.octaves, params.lacunarity, params.gain);
    if (t === 'foam')     return this._foam(sx, sy, sz, params.distanceMetric, params.jitter);
    if (t === 'strut')    return this._strut(sx, sy, sz, params.distanceMetric, params.jitter);
    if (t === 'veined')   return this._veined(sx, sy, sz, params.veinTurb, params.veinFreq, params.octaves, params.lacunarity, params.gain);
    if (t === 'curl')     return this._curl(sx, sy, sz, params.curlStep || 0.1, params.potentialScale || 1.0);
    if (t === 'warp')     return this._warp(sx, sy, sz, params.warpStrength, params.octaves, params.lacunarity, params.gain);
    throw new Error('NoiseKernel: unknown noise type "' + t + '"');
  },

  /* Normalization range exactly as the tool's export computes it
     (Raymarcher._runPrepass → norm_min/norm_max): 32³ samples on the
     corner-inclusive grid ((i/(N-1))·2−1)·π, same expression order,
     padded ±5 % of the span. */
  _prepass: function (params) {
    var N = 32, SCALE = 5.0/Math.PI;
    var sx = params.scaleX || 1.0, sy = params.scaleY || 1.0, sz = params.scaleZ || 1.0;
    var mn = Infinity, mx = -Infinity;
    for (var zi = 0; zi < N; zi++) for (var yi = 0; yi < N; yi++) for (var xi = 0; xi < N; xi++) {
      var px = ((xi/(N-1))*2-1) * Math.PI;
      var py = ((yi/(N-1))*2-1) * Math.PI;
      var pz = ((zi/(N-1))*2-1) * Math.PI;
      var v = this._sampleRaw(params,
        px*SCALE*params.frequency*sx,
        py*SCALE*params.frequency*sy,
        pz*SCALE*params.frequency*sz);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    var range = mx - mn;
    return { noiseMin: mn - range*0.05, noiseMax: mx + range*0.05 };
  },

  /* Recomputed ranges, keyed by noiseNormKey — a sweep re-parses the
     same few recipes many times. */
  _rangeCache: [],
  _rangeFor: function (params, key) {
    var c = this._rangeCache;
    for (var i = 0; i < c.length; i++) if (c[i].key === key) return c[i].r;
    var r = this._prepass(params);
    c.unshift({ key: key, r: r });
    if (c.length > 8) c.length = 8;
    return r;
  },

  /* Field-defining settings of a surface block, read exactly as the
     tool reads them, with the tool's UI defaults for absent fields
     (null-checks, so an explicit 0 — warp strength, vein turbulence,
     jitter, seed — stays 0).  Throws on an unknown noise type. */
  _readField: function (s) {
    var t = s.noise_type != null ? s.noise_type : 'simplex';
    if (NOISE_TYPES.indexOf(t) < 0) {
      throw new Error('NoiseKernel: unknown noise type "' + t + '" (supported: ' + NOISE_TYPES.join(', ') + ')');
    }
    var seed = s.seed != null ? +s.seed : 0;
    return {
      noiseType:      t,
      frequency:      s.frequency != null ? s.frequency : 0.3,
      /* the tool's prepass and voxelizer read scaleX||1 */
      scaleX:         s.scale_x || 1.0,
      scaleY:         s.scale_y || 1.0,
      scaleZ:         s.scale_z || 1.0,
      octaves:        s.octaves != null ? s.octaves : 4,
      lacunarity:     s.lacunarity != null ? s.lacunarity : 2.0,
      gain:           s.gain != null ? s.gain : 0.5,
      warpStrength:   s.warp_strength != null ? s.warp_strength : 1.0,
      distanceMetric: s.distance_metric != null ? s.distance_metric : 'euclidean',
      jitter:         s.jitter != null ? s.jitter : 0.6,
      veinTurb:       s.vein_turbulence != null ? s.vein_turbulence : 3.0,
      veinFreq:       s.vein_frequency != null ? s.vein_frequency : 3.0,
      /* the tool's sample() applies curlStep||0.1, potentialScale||1.0 */
      curlStep:       s.curl_step != null ? s.curl_step : 0.1,
      potentialScale: s.potential_scale != null ? s.potential_scale : 1.0,
      seed:           seed,
      seedOffset:     this._seedToOffset(seed)
    };
  },

  parseRecipe: function (recipe) {
    var s = recipe.surface || {};
    if (s.type !== 'noise') {
      throw new Error("NoiseKernel.parseRecipe: expected surface.type='noise', got '" + s.type + "'");
    }
    var params = this._readField(s);
    params.isoLevel   = s.center != null ? s.center : 0;
    params.halfWidth  = s.half_width != null ? s.half_width : 0.15;
    params.smoothing  = s.smoothing || 0;
    params.halfInvert = !!(recipe.geometry && recipe.geometry.half_invert);
    if (!recipe.family) recipe.family = 'noise';
    /* Stored range from the tool's export while it still belongs to these
       settings (stamp absent, or matching) — otherwise the tool's 32³ scan. */
    var key = noiseFieldKey(params);
    var stored = typeof s.norm_min === 'number' && isFinite(s.norm_min) &&
                 typeof s.norm_max === 'number' && isFinite(s.norm_max);
    if (stored && (s.norm_for == null || s.norm_for === key)) {
      params.noiseMin = s.norm_min;
      params.noiseMax = s.norm_max;
      params.normSource = 'stored';
    } else {
      var bounds = this._rangeFor(params, key);
      params.noiseMin = bounds.noiseMin;
      params.noiseMax = bounds.noiseMax;
      params.normSource = 'prepass';
    }
    return params;
  },

  /* CPU field evaluation — solver-space (x,y,z) ∈ [-π, π]³. Returns
     normalized field value in roughly [-1, 1]. */
  evaluate: function (params, x, y, z) {
    var SCALE = 5.0/Math.PI;
    var Sx = SCALE * params.frequency * params.scaleX;
    var Sy = SCALE * params.frequency * params.scaleY;
    var Sz = SCALE * params.frequency * params.scaleZ;
    var raw = this._sampleRaw(params, x*Sx, y*Sy, z*Sz);
    var mid = (params.noiseMin + params.noiseMax) * 0.5;
    var halfR = Math.max((params.noiseMax - params.noiseMin) * 0.5, 0.001);
    return (raw - mid) / halfR;
  }
};

/* Settings that decide the raw noise field (and so its normalization
   range), from parsed params.  noiseNormKey(surface) is the stamp
   60-add-design.js writes to surface.norm_for on import. */
function noiseFieldKey(p) {
  return JSON.stringify([p.noiseType, +p.frequency, +p.scaleX, +p.scaleY, +p.scaleZ, +p.octaves, +p.lacunarity,
    +p.gain, +p.warpStrength, p.distanceMetric, +p.jitter, +p.veinTurb, +p.veinFreq, +p.curlStep,
    +p.potentialScale, +p.seed]);
}
function noiseNormKey(surface) { return noiseFieldKey(NoiseKernel._readField(surface || {})); }
/* ==== /F13LD-GEOM-NOISE ==== */
