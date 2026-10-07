/* ============================================================
   F13LD.sweep · 41-rasterize.js
   evaluateTpms, isotropic Voigt stiffness, buildVoxels (N^3 solid mask).
   ============================================================ */

// ─── Homogenization — FFT-CG solver (per-family N, see FFT_N_* constants) ────

function evaluateTpms(terms, x, y, z) {
  let result = 0;
  for (const term of terms) {
    if (!term.on) continue;
    // v0.13.1: per-term phase_shift (continuous, [0, 2π], periodicity-safe).
    // Applied uniformly to all factors in this term so the term's algebraic
    // identity stays clean: phase_shift X applied to both factors of a
    // sin(x)·cos(y) term means f(x+φx, y+φy). Phase shift defaults to zero
    // for backwards compat with pre-v0.13.1 designs that lack the field.
    const ps = term.phase_shift || { x: 0, y: 0, z: 0 };
    const xs = x + ps.x, ys = y + ps.y, zs = z + ps.z;
    let product = term.coef;
    for (const f of term.factors) {
      // Apply trig to the correct axis only (phase-shifted coords)
      const trig = f.trig;
      if      (trig === 'sin(x)') product *= Math.sin(f.fx * xs);
      else if (trig === 'cos(x)') product *= Math.cos(f.fx * xs);
      else if (trig === 'sin(y)') product *= Math.sin(f.fy * ys);
      else if (trig === 'cos(y)') product *= Math.cos(f.fy * ys);
      else if (trig === 'sin(z)') product *= Math.sin(f.fz * zs);
      else if (trig === 'cos(z)') product *= Math.cos(f.fz * zs);
    }
    result += product;
  }
  return result;
}

// ── Isotropic 6x6 Voigt stiffness tensor (flat array, row-major) ─────────────
// Voigt order: xx yy zz yz xz xy
function isoC(E, nu) {
  const lam = E * nu / ((1 + nu) * (1 - 2 * nu));
  const mu  = E / (2 * (1 + nu));
  const C = new Float64Array(36);
  // normal-normal block
  C[0]=C[7]=C[14] = lam + 2*mu;
  C[1]=C[2]=C[6]=C[8]=C[12]=C[13] = lam;
  // shear block
  C[21]=C[28]=C[35] = mu;
  return C;
}

// ── Build voxel solid mask, shape N³ (Float32, 0 or 1) ───────────────────────
// E1 Pass 2: takes (family, params, ...) and dispatches scalar field eval
// through KERNELS[family].evaluate. mode is now a string ('solid'|'shell'|
// 'pi-tpms') replacing the old isShell+piMode boolean pair.
//
// Normalization (TPMS only; ignored for other families):
//   piNorm=true   → PI-TPMS branch uses angle-corrected distance to
//                   intersection curve. ∇A from cached V (free via periodic
//                   FD); vB + ∇B from live evalFn (6 extra calls/voxel).
//                   ~4× slowdown vs. raw PI-TPMS.
//   shellNorm=true → shell branches divide |φ−offset| by |∇φ|. For the
//                   isotropic shell, ∇ comes from cached V (~free). For the
//                   anisotropic shell branch, the existing gx/gy/gz stencil
//                   is reused — ~free.
function buildVoxels(family, params, offset, N, mode, wt, nWeights, pipeR, phaseShift, prebuiltV, piNorm, shellNorm) {
  const L    = Math.PI;
  const step = (2 * L) / N;
  const N3   = N * N * N;
  const kernel = KERNELS[family || 'tpms'];
  // Hoist evaluate fn once — V8 keeps the inner loops monomorphic on the closure
  const evalFn = (x, y, z) => kernel.evaluate(params, x, y, z);

  // Build full field array first (single pass) — needed for shell + nWeights
  // gradient stencil and reused by PI-TPMS phiA cache.
  //
  // E4 bake-first: callers (estimateHomogenization) may have already baked V
  // via kernel.bakeField — pass it in as prebuiltV to skip the redundant
  // scatter-evaluate loop. Other call paths leave prebuiltV undefined and
  // get the legacy in-place build. Validity assumption: prebuiltV must be a
  // Float32Array of length N³ baked at the same N at voxel centers.
  let V;
  if (prebuiltV && prebuiltV.length === N3) {
    V = prebuiltV;
  } else if (kernel.bakeField) {
    // Kernel offers a contiguous bake — use it even if no prebuilt was
    // supplied. Same result, better cache locality, no API change for
    // legacy callers.
    V = kernel.bakeField(params, N);
  } else {
    V = new Float32Array(N3);
    for (let i = 0; i < N; i++) {
      const x = -L + (i + 0.5) * step;
      for (let j = 0; j < N; j++) {
        const y = -L + (j + 0.5) * step;
        for (let k = 0; k < N; k++) {
          const z = -L + (k + 0.5) * step;
          V[i*N*N + j*N + k] = evalFn(x, y, z);
        }
      }
    }
  }

  const solid = new Float32Array(N3);

  if (mode === 'pi-tpms') {
    // PI-TPMS: max(|φ(p)|, |φ(p+δ)|) < pipeR   (raw)
    //          piField(p) < pipeR              (normalized — angle-corrected)
    // δ in radians — period-invariant (fraction × 2π)
    const TWO_PI = 2 * Math.PI;
    const dx = (phaseShift?.x || 0) * TWO_PI;
    const dy = (phaseShift?.y || 0) * TWO_PI;
    const dz = (phaseShift?.z || 0) * TWO_PI;
    const pr = pipeR || 0.1;
    if (piNorm) {
      // Normalized PI: ∇A from cached V via periodic FD; vB + ∇B from live evalFn.
      // Constants match F13LD.tpms: e=0.012, EPS=0.08, COSCLAMP=0.95.
      const e = 0.012, EPS = 0.08, COSCLAMP = 0.95;
      const inv2e = 1 / (2 * e), inv2step = 1 / (2 * step);
      for (let i = 0; i < N; i++) {
        const ip = (i+1) % N, im = (i+N-1) % N;
        const x = -L + (i + 0.5) * step;
        for (let j = 0; j < N; j++) {
          const jp = (j+1) % N, jm = (j+N-1) % N;
          const y = -L + (j + 0.5) * step;
          for (let k = 0; k < N; k++) {
            const kp = (k+1) % N, km = (k+N-1) % N;
            const z = -L + (k + 0.5) * step;
            const vA = V[i*N*N + j*N + k];
            // ∇A from cached V (periodic FD — free)
            const gAx = (V[ip*N*N+j*N+k] - V[im*N*N+j*N+k]) * inv2step;
            const gAy = (V[i*N*N+jp*N+k] - V[i*N*N+jm*N+k]) * inv2step;
            const gAz = (V[i*N*N+j*N+kp] - V[i*N*N+j*N+km]) * inv2step;
            const magA = Math.max(Math.sqrt(gAx*gAx + gAy*gAy + gAz*gAz), EPS);
            // vB + ∇B from live evalFn (shift is not in general aligned to voxel grid)
            const xB = x + dx, yB = y + dy, zB = z + dz;
            const vB  = evalFn(xB, yB, zB);
            const gBx = (evalFn(xB+e,yB,zB) - evalFn(xB-e,yB,zB)) * inv2e;
            const gBy = (evalFn(xB,yB+e,zB) - evalFn(xB,yB-e,zB)) * inv2e;
            const gBz = (evalFn(xB,yB,zB+e) - evalFn(xB,yB,zB-e)) * inv2e;
            const magB = Math.max(Math.sqrt(gBx*gBx + gBy*gBy + gBz*gBz), EPS);
            const dA = vA / magA;
            const dB = vB / magB;
            let cosA = (gAx*gBx + gAy*gBy + gAz*gBz) / (magA * magB);
            if (cosA >  COSCLAMP) cosA =  COSCLAMP;
            if (cosA < -COSCLAMP) cosA = -COSCLAMP;
            const sin2 = 1 - cosA * cosA;
            const num  = dA*dA - 2*cosA*dA*dB + dB*dB;
            solid[i*N*N + j*N + k] = Math.sqrt(Math.max(num, 0) / sin2) < pr ? 1 : 0;
          }
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        const x = -L + (i + 0.5) * step;
        for (let j = 0; j < N; j++) {
          const y = -L + (j + 0.5) * step;
          for (let k = 0; k < N; k++) {
            const vA = V[i*N*N + j*N + k];
            const vB = evalFn(x + dx, y + dy, -L + (k+0.5)*step + dz);
            solid[i*N*N + j*N + k] = Math.max(Math.abs(vA), Math.abs(vB)) < pr ? 1 : 0;
          }
        }
      }
    }
  } else if (mode === 'shell' && nWeights) {
    // Anisotropic shell — needs gradient stencil from the precomputed V grid.
    // Kept inline because the gradient is already cached in V; routing through
    // applyMode would either re-evaluate or require a parallel raw-field grid.
    //
    // When shellNorm=true, the |φ−offset| numerator is also divided by gLen
    // (uniform perpendicular thickness). gLen is already computed below — free.
    const wx = nWeights.wx, wy = nWeights.wy, wz = nWeights.wz;
    const EPS_SN = 0.08; // gradient floor when shellNorm — matches F13LD.tpms
    for (let i = 0; i < N; i++) {
      const ip = (i+1) % N, im = (i+N-1) % N;
      for (let j = 0; j < N; j++) {
        const jp = (j+1) % N, jm = (j+N-1) % N;
        for (let k = 0; k < N; k++) {
          const kp = (k+1) % N, km = (k+N-1) % N;
          const gx = (V[ip*N*N+j*N+k] - V[im*N*N+j*N+k]) / (2*step);
          const gy = (V[i*N*N+jp*N+k] - V[i*N*N+jm*N+k]) / (2*step);
          const gz = (V[i*N*N+j*N+kp] - V[i*N*N+j*N+km]) / (2*step);
          const gLen = Math.sqrt(gx*gx + gy*gy + gz*gz) || 1;
          const localWt = wt * (wx*Math.abs(gx/gLen) + wy*Math.abs(gy/gLen) + wz*Math.abs(gz/gLen));
          const idx = i*N*N + j*N + k;
          const num = shellNorm
            ? Math.abs(V[idx] - offset) / Math.max(gLen, EPS_SN)
            : Math.abs(V[idx] - offset);
          solid[idx] = num < localWt ? 1 : 0;
        }
      }
    }
  } else if (mode === 'noise-sheet' || mode === 'noise-half' || mode === 'noise-solid') {
    // Noise modes operate on the kernel's already-normalized field value.
    // V is cached from kernel.evaluate above so inline threshold is correct.
    // isoLevel/halfWidth/halfInvert come from params (kernel-internal config).
    const iso = params.isoLevel;
    const hw  = params.halfWidth;
    const inv = !!params.halfInvert;
    if (mode === 'noise-sheet') {
      for (let idx = 0; idx < N3; idx++) solid[idx] = Math.abs(V[idx] - iso) < hw ? 1 : 0;
    } else if (mode === 'noise-half') {
      for (let idx = 0; idx < N3; idx++) {
        solid[idx] = inv ? (V[idx] < iso ? 1 : 0) : (V[idx] > iso ? 1 : 0);
      }
    } else { // noise-solid
      for (let idx = 0; idx < N3; idx++) solid[idx] = Math.abs(V[idx] - iso) > hw ? 1 : 0;
    }
  } else if (mode === 'grain-sheet' || mode === 'grain-half' || mode === 'grain-solid') {
    // Grain modes operate on the kernel's RAW field value (NOT normalized to
    // [-1,1] like noise — see GrainKernel header). isoLevel/halfWidth are in
    // raw field scale, matching the F13LD.grain export convention where
    // geometry.center / geometry.half_width are calibrated against the
    // natural field range (~[-1,1] for spinodoid/GRF, ~[-0.3,1] for HU).
    const iso = params.isoLevel;
    const hw  = params.halfWidth;
    const inv = !!params.halfInvert;
    if (mode === 'grain-sheet') {
      for (let idx = 0; idx < N3; idx++) solid[idx] = Math.abs(V[idx] - iso) < hw ? 1 : 0;
    } else if (mode === 'grain-half') {
      for (let idx = 0; idx < N3; idx++) {
        solid[idx] = inv ? (V[idx] < iso ? 1 : 0) : (V[idx] > iso ? 1 : 0);
      }
    } else { // grain-solid
      for (let idx = 0; idx < N3; idx++) solid[idx] = Math.abs(V[idx] - iso) > hw ? 1 : 0;
    }
  } else if (mode === 'beam-solid') {
    // Beam: V is the strut-union SDF in local units. Solid where SDF < 0.
    // No offset, no isoLevel — the radius is encoded in the SDF directly
    // via per-strut r_eff (set by jitterParams).
    for (let idx = 0; idx < N3; idx++) solid[idx] = V[idx] < 0 ? 1 : 0;
  } else {
    // Solid or isotropic shell — V is already cached, threshold inline.
    // Shell-normalize uses cached-V periodic FD for ∇φ — free vs raw shell.
    if (mode === 'shell' && shellNorm) {
      const EPS_SN = 0.08;
      const inv2step = 1 / (2 * step);
      for (let i = 0; i < N; i++) {
        const ip = (i+1) % N, im = (i+N-1) % N;
        for (let j = 0; j < N; j++) {
          const jp = (j+1) % N, jm = (j+N-1) % N;
          for (let k = 0; k < N; k++) {
            const kp = (k+1) % N, km = (k+N-1) % N;
            const idx = i*N*N + j*N + k;
            const gx = (V[ip*N*N+j*N+k] - V[im*N*N+j*N+k]) * inv2step;
            const gy = (V[i*N*N+jp*N+k] - V[i*N*N+jm*N+k]) * inv2step;
            const gz = (V[i*N*N+j*N+kp] - V[i*N*N+j*N+km]) * inv2step;
            const g = Math.max(Math.sqrt(gx*gx + gy*gy + gz*gz), EPS_SN);
            solid[idx] = Math.abs(V[idx] - offset) / g < wt ? 1 : 0;
          }
        }
      }
    } else {
      for (let idx = 0; idx < N3; idx++) {
        solid[idx] = mode === 'shell'
          ? (Math.abs(V[idx] - offset) < wt ? 1 : 0)
          : (V[idx] - offset < 0 ? 1 : 0);
      }
    }
  }

  return solid;
}
