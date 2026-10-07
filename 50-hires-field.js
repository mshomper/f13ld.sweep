/* ============================================================
   F13LD.sweep · 50-hires-field.js
   Axis connectivity, TPMS gradient evaluation, hi-res field build.
   ============================================================ */

// ─── Pore analysis — gradient-normalised SDF approach ────────────────────────
// φ(p) is not a unit-SDF — its gradient |∇φ| ≠ 1 generally, especially when
// sweep jitters coefficients away from 1. True distance = φ / |∇φ| evaluated
// analytically from the term/factor structure.
//
// For each factor f(axis):
//   sin(f·x) → value: sin(f·x),  derivative wrt x: f·cos(f·x)
//   cos(f·x) → value: cos(f·x),  derivative wrt x: -f·sin(f·x)
// For a multi-factor term, ∂term/∂x uses product rule across all x-factors.

// computeAxisConnectivity — geometric BFS with periodic BC and image tracking.
// Returns { spansX, spansY, spansZ } indicating which axes the structure
// spans through periodic image continuation.
//
// Algorithm: BFS through solid voxels with 6-neighbor connectivity. When a
// neighbor crosses a periodic boundary, the per-voxel image offset is updated.
// If we re-encounter a voxel via a different image, the image difference is
// a "span vector" — proves a closed loop through the structure that wraps
// the periodic cell. Any nonzero span component for an axis → that axis is
// connected (loose definition: counts diagonals as participating in each
// axis they touch).
//
// Replaces the prior stiffness-threshold connect_idx, which broke for PI-TPMS:
// the FFT-CG solver returns nonzero Ex/Ey/Ez even for genuinely disconnected
// fragments because periodic BCs couple them through the image, so disconnected
// PI-TPMS designs were wrongly reading connect_idx = 1.0.
function computeAxisConnectivity(solid, N) {
  const N3 = N * N * N;
  const labels = new Int32Array(N3);     // 0 = unvisited, 1+ = component label
  const imgX = new Int16Array(N3);       // per-voxel "first reached" image offsets
  const imgY = new Int16Array(N3);
  const imgZ = new Int16Array(N3);
  // Queue stores linear voxel indices only — image lookup uses imgX/Y/Z arrays
  const queue = new Int32Array(N3);

  let spansX = false, spansY = false, spansZ = false;
  let nComponents = 0;
  const NN = N * N;

  for (let startIdx = 0; startIdx < N3; startIdx++) {
    if (!solid[startIdx] || labels[startIdx] !== 0) continue;

    nComponents++;
    const compLabel = nComponents;

    let head = 0, tail = 0;
    queue[tail++] = startIdx;
    labels[startIdx] = compLabel;
    // imgX/Y/Z[startIdx] default to 0 from Int16Array zero-init

    while (head < tail) {
      const id = queue[head++];
      const k = id % N;
      const j = ((id - k) / N) % N;
      const i = ((id - k) / N - j) / N;
      const ix = imgX[id], iy = imgY[id], iz = imgZ[id];

      // 6 axis-aligned neighbors (di, dj, dk) ∈ {±1, 0, 0} permutations
      for (let dir = 0; dir < 6; dir++) {
        let di = 0, dj = 0, dk = 0;
        if      (dir === 0) di = 1;
        else if (dir === 1) di = -1;
        else if (dir === 2) dj = 1;
        else if (dir === 3) dj = -1;
        else if (dir === 4) dk = 1;
        else                dk = -1;

        let ni = i + di, nj = j + dj, nk = k + dk;
        let nix = ix, niy = iy, niz = iz;

        // Wrap with periodic BC + track image change
        if (ni < 0)       { ni += N; nix -= 1; }
        else if (ni >= N) { ni -= N; nix += 1; }
        if (nj < 0)       { nj += N; niy -= 1; }
        else if (nj >= N) { nj -= N; niy += 1; }
        if (nk < 0)       { nk += N; niz -= 1; }
        else if (nk >= N) { nk -= N; niz += 1; }

        const nIdx = ni * NN + nj * N + nk;
        if (!solid[nIdx]) continue;

        if (labels[nIdx] === 0) {
          // First visit — record image and enqueue
          labels[nIdx] = compLabel;
          imgX[nIdx] = nix;
          imgY[nIdx] = niy;
          imgZ[nIdx] = niz;
          queue[tail++] = nIdx;
        } else if (labels[nIdx] === compLabel) {
          // Re-visit same component via different path — image difference reveals span
          if (nix !== imgX[nIdx]) spansX = true;
          if (niy !== imgY[nIdx]) spansY = true;
          if (niz !== imgZ[nIdx]) spansZ = true;
        }
      }
    }

    // Early exit: all three axes already proven spanned
    if (spansX && spansY && spansZ) break;
  }

  return { spansX, spansY, spansZ };
}

function evaluateTpmsWithGrad(terms, x, y, z) {
  let phi = 0;
  let gx = 0, gy = 0, gz = 0;

  for (const term of terms) {
    if (!term.on) continue;
    const c = term.coef;
    const factors = term.factors;

    // v0.13.1: per-term phase_shift (continuous, periodicity-safe).
    // Apply uniformly to all factors as a coordinate substitution
    // x → x+φx etc. The chain rule for d/dx of f(fx·(x+φx)) is just
    // fx·f'(fx·(x+φx)) — same form as without phase shift, just with
    // shifted argument. So all the existing product-rule machinery works
    // verbatim; we just substitute xs/ys/zs for x/y/z everywhere.
    const ps = term.phase_shift || { x: 0, y: 0, z: 0 };
    const xs = x + ps.x, ys = y + ps.y, zs = z + ps.z;

    // Evaluate value and per-axis derivatives for each factor
    let val = c;
    // Track which axes have x/y/z factors, and their derivative contributions
    let hasX = false, hasY = false, hasZ = false;

    // First pass: compute the full product value
    for (const f of factors) {
      const t = f.trig;
      if      (t === 'sin(x)') { val *= Math.sin(f.fx * xs); hasX = true; }
      else if (t === 'cos(x)') { val *= Math.cos(f.fx * xs); hasX = true; }
      else if (t === 'sin(y)') { val *= Math.sin(f.fy * ys); hasY = true; }
      else if (t === 'cos(y)') { val *= Math.cos(f.fy * ys); hasY = true; }
      else if (t === 'sin(z)') { val *= Math.sin(f.fz * zs); hasZ = true; }
      else if (t === 'cos(z)') { val *= Math.cos(f.fz * zs); hasZ = true; }
    }
    phi += val;

    // ∂term/∂x: product rule — replace each x-factor with its derivative,
    // keep all other factors. Sum contributions from each x-factor.
    let term_dx = 0;
    for (let fi = 0; fi < factors.length; fi++) {
      const f = factors[fi];
      const t = f.trig;
      if (t !== 'sin(x)' && t !== 'cos(x)') continue;
      // Derivative of this x-factor (uses xs since d/dx of f(x+φ) = f'(x+φ))
      let d_this = c;
      if      (t === 'sin(x)') d_this *= f.fx * Math.cos(f.fx * xs);
      else if (t === 'cos(x)') d_this *= -f.fx * Math.sin(f.fx * xs);
      // Multiply by all other factors (not this one)
      for (let fj = 0; fj < factors.length; fj++) {
        if (fj === fi) continue;
        const g = factors[fj];
        const gt = g.trig;
        if      (gt === 'sin(x)') d_this *= Math.sin(g.fx * xs);
        else if (gt === 'cos(x)') d_this *= Math.cos(g.fx * xs);
        else if (gt === 'sin(y)') d_this *= Math.sin(g.fy * ys);
        else if (gt === 'cos(y)') d_this *= Math.cos(g.fy * ys);
        else if (gt === 'sin(z)') d_this *= Math.sin(g.fz * zs);
        else if (gt === 'cos(z)') d_this *= Math.cos(g.fz * zs);
      }
      term_dx += d_this;
    }
    gx += term_dx;

    // ∂term/∂y
    let term_dy = 0;
    for (let fi = 0; fi < factors.length; fi++) {
      const f = factors[fi];
      const t = f.trig;
      if (t !== 'sin(y)' && t !== 'cos(y)') continue;
      let d_this = c;
      if      (t === 'sin(y)') d_this *= f.fy * Math.cos(f.fy * ys);
      else if (t === 'cos(y)') d_this *= -f.fy * Math.sin(f.fy * ys);
      for (let fj = 0; fj < factors.length; fj++) {
        if (fj === fi) continue;
        const g = factors[fj];
        const gt = g.trig;
        if      (gt === 'sin(x)') d_this *= Math.sin(g.fx * xs);
        else if (gt === 'cos(x)') d_this *= Math.cos(g.fx * xs);
        else if (gt === 'sin(y)') d_this *= Math.sin(g.fy * ys);
        else if (gt === 'cos(y)') d_this *= Math.cos(g.fy * ys);
        else if (gt === 'sin(z)') d_this *= Math.sin(g.fz * zs);
        else if (gt === 'cos(z)') d_this *= Math.cos(g.fz * zs);
      }
      term_dy += d_this;
    }
    gy += term_dy;

    // ∂term/∂z
    let term_dz = 0;
    for (let fi = 0; fi < factors.length; fi++) {
      const f = factors[fi];
      const t = f.trig;
      if (t !== 'sin(z)' && t !== 'cos(z)') continue;
      let d_this = c;
      if      (t === 'sin(z)') d_this *= f.fz * Math.cos(f.fz * zs);
      else if (t === 'cos(z)') d_this *= -f.fz * Math.sin(f.fz * zs);
      for (let fj = 0; fj < factors.length; fj++) {
        if (fj === fi) continue;
        const g = factors[fj];
        const gt = g.trig;
        if      (gt === 'sin(x)') d_this *= Math.sin(g.fx * xs);
        else if (gt === 'cos(x)') d_this *= Math.cos(g.fx * xs);
        else if (gt === 'sin(y)') d_this *= Math.sin(g.fy * ys);
        else if (gt === 'cos(y)') d_this *= Math.cos(g.fy * ys);
        else if (gt === 'sin(z)') d_this *= Math.sin(g.fz * zs);
        else if (gt === 'cos(z)') d_this *= Math.cos(g.fz * zs);
      }
      term_dz += d_this;
    }
    gz += term_dz;
  }

  const gradMag = Math.sqrt(gx*gx + gy*gy + gz*gz) || 1e-9;
  return { phi, gradMag };
}

// ─── Pore analysis — gradient-normalised SDF ─────────────────────────────────
// buildHiResField — single-pass evaluation of the implicit field at high
// resolution. Returns Float32 raw field + Uint8 solid/void masks.
//
// Used for PI-TPMS analysis (volume_fraction, connectivity, pore metrics)
// where the FFT-CG solver grid (N=32) is too coarse: a typical pipe radius
// of 0.1 gives ~1 voxel diameter at N=32, producing ~30-50% volume-fraction
// alignment noise. At N=96, voxel size is 2π/96 ≈ 0.065 → ~3 voxels per pipe,
// which is enough to resolve the geometry reliably for pore-scale metrics.
//
// Convention: solidMask[id] = 1 where field places material, voidMask[id] = 1
// where field places void. rawField[id] is the analyzePores-style raw value
// (positive in void, negative in solid) — used for pore-radius estimation.
function buildHiResField(family, params, offset, mode, wt, pipeR, phaseShift, N_HI, piNorm, shellNorm) {
  const N3 = N_HI * N_HI * N_HI;
  const L = Math.PI;
  const step = (2 * L) / N_HI;
  const TWO_PI = 2 * Math.PI;
  const kernel = KERNELS[family || 'tpms'];
  const evalFn = (x, y, z) => kernel.evaluate(params, x, y, z);

  // Mode args for applyModeRaw — pre-multiply phase shift to radians.
  // Noise modes also need isoLevel/halfWidth/halfInvert off params; TPMS
  // ignores those, so always populating is safe (and avoids a family check).
  const modeArgs = {
    offset,
    wt: wt || 0.3,
    pipeR: pipeR || 0.1,
    dx: (phaseShift?.x || 0) * TWO_PI,
    dy: (phaseShift?.y || 0) * TWO_PI,
    dz: (phaseShift?.z || 0) * TWO_PI,
    // TPMS field-normalization flags — read by applyModeRaw (no-op for non-TPMS modes)
    piNormalize:    !!piNorm,
    shellNormalize: !!shellNorm,
    // Noise mode fields — read from params; safely undefined for TPMS recipes
    isoLevel: params.isoLevel,
    halfWidth: params.halfWidth,
    halfInvert: !!params.halfInvert,
  };

  const rawField  = new Float32Array(N3);
  const solidMask = new Uint8Array(N3);
  const voidMask  = new Uint8Array(N3);

  const NN = N_HI * N_HI;
  for (let i = 0; i < N_HI; i++) {
    const x = -L + (i + 0.5) * step;
    for (let j = 0; j < N_HI; j++) {
      const y = -L + (j + 0.5) * step;
      const baseIdx = i * NN + j * N_HI;
      for (let k = 0; k < N_HI; k++) {
        const z = -L + (k + 0.5) * step;
        const id = baseIdx + k;

        // raw > 0 in void, raw <= 0 in solid (matches analyzePores convention)
        const raw = applyModeRaw(evalFn, x, y, z, mode, modeArgs);

        rawField[id] = raw;
        if (raw > 0) { voidMask[id] = 1; }
        else         { solidMask[id] = 1; }
      }
    }
  }

  return { rawField, solidMask, voidMask };
}

// analyzePoresFromField — pore metrics from a prebuilt hi-res field.
// Same algorithm as analyzePores, but doesn't rebuild the field. Single-pass
// near-surface gradient collection (rather than two passes), giving both
// gradNorm (for pore-radius normalisation) and maxSurfGrad (for throat) at once.
