/* ============================================================
   F13LD.sweep · 45-homogenize.js
   fftHomogenize (elastic, 3 load cases) and thermalHomogenize.
   ============================================================ */

// fftHomogenize(solid, N, mode, Es, nu, connect, contrast, maxiter)
//   solid   — Float32Array N³ (0/1): the design's voxels (designVoxels).
//   mode    — solver-policy mode (geo.sweepMode) for the VF bounds.
//   connect — {x, y, z} booleans from percolation: disconnected axes report
//             zero stiffness and skip the FFT-CG solve (null → all axes).
//   contrast / maxiter — precision mode (default Fast: 1e-3 / 600).
function fftHomogenize(solid, N, mode, Es, nu, connect, contrast, maxiterArg) {
  const _contrast = (contrast != null) ? contrast : 1e-3;
  const _maxiter  = (maxiterArg != null) ? maxiterArg : CG_MAXITER_FAST;
  const N3    = N * N * N;

  // Volume fraction — direct voxel count from the already-built solid field.
  let inside = 0;
  for (let i = 0; i < N3; i++) inside += solid[i];
  const rho = inside / N3;

  // PI-TPMS has r² VF scaling — relaxed lower bound vs standard TPMS
  // Per-mode VF floor. PI-TPMS relaxed because pipe radius produces thin VFs.
  // v0.17.0: noise/grain/beam lower bounds relaxed to admit purposefully
  // sparse designs (half-solid curl, ridged thin-strut surfaces, sparse beam).
  const isNoiseMode = (mode === 'noise-sheet' || mode === 'noise-half' || mode === 'noise-solid');
  const isGrainMode = (mode === 'grain-sheet' || mode === 'grain-half' || mode === 'grain-solid');
  const isBeamMode  = (mode === 'beam-solid');
  const rhoMin = mode === 'pi-tpms' ? RHO_MIN_PI :
                 isNoiseMode        ? RHO_MIN_NOISE :
                 isGrainMode        ? RHO_MIN_GRAIN :
                 isBeamMode         ? RHO_MIN_BEAM :
                 RHO_MIN_STD;
  // v0.17.0: upper bound is now mode-specific. resolveRhoMax dispatches to
  // RHO_MAX_SHEET / HALF / SOLID / PI / BEAM. This is a defensive backstop —
  // estimateHomogenization runs a pre-gate against the same bound (relaxed
  // for hi-res modes) before calling fftHomogenize, so most rejections
  // never reach this point.
  const rhoMaxMode = resolveRhoMax(mode);
  // v0.16.0: instead of bare null, return a tagged rejection so callers can
  // attribute discards by reason. Keeps backward-compatible null-style truthy
  // checks because the returned object IS truthy — but `rejected: true`
  // distinguishes it from a valid solve.
  if (rho < rhoMin)     return { rejected: true, reject_reason: 'vf_low',  rho };
  if (rho > rhoMaxMode) return { rejected: true, reject_reason: 'vf_high', rho };

  // Phase tensors
  const C_s = isoC(Es, nu);
  const C_v = isoC(Es * _contrast, nu);
  // v0.14.1: REVERTED to solid reference (was Voigt-avg in v0.14.0).
  // See getElasticGamma for full rationale — short version: Voigt-avg makes
  // the CG operator indefinite, breaking SPD convergence. Must match the
  // reference used by getElasticGamma so Lippmann-Schwinger residual
  // minimization stays consistent.
  const C0  = isoC(Es, nu);
  const mu0  = C0[21];       // C[3,3]
  const lam0 = C0[1];        // C[0,1]

  // Green operator — cached for the duration of the sweep
  const Gamma = getElasticGamma(N, Es, nu);

  const tol = CG_TOL;
  const maxiter = _maxiter;

  // v0.14.0: per-axis connectivity gate. Default = all connected (legacy path).
  const connectArr = connect
    ? [!!connect.x, !!connect.y, !!connect.z]
    : [true, true, true];

  // 3 normal load cases — disconnected axes skip CG, column stays zero
  const C_eff_nn = [[0,0,0],[0,0,0],[0,0,0]]; // 3×3 normal stiffness block
  let totalIters = 0;
  let allConverged = true;
  for (let lc = 0; lc < 3; lc++) {
    if (!connectArr[lc]) continue; // disconnected axis — column stays zero
    const eps_bar = [lc===0?1:0, lc===1?1:0, lc===2?1:0];
    const result = cgSolveNormal(solid, C_s, C_v, C0, Gamma, N, eps_bar, tol, maxiter);
    const sig_bar = result.sigma;
    totalIters += result.iters;
    if (!result.converged) allConverged = false;
    for (let p = 0; p < 3; p++) C_eff_nn[p][lc] = sig_bar[p];
  }

  // Symmetrise
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++)
    C_eff_nn[p][q] = 0.5*(C_eff_nn[p][q] + C_eff_nn[q][p]);

  // v0.14.0: connectivity-aware extraction.
  //   nConnect=3 → full 3×3 inversion → Poisson-coupled Young's moduli (legacy)
  //   nConnect=1,2 → diagonal C_eff[i][i] as constrained-modulus stiffness proxy
  //                  (no Poisson coupling possible; ~15-25% higher than the
  //                   inverted Young's modulus depending on ν — knowable
  //                   systematic difference, acceptable in `partial` regime)
  //   nConnect=0 → all stiffness reported as zero (degenerate)
  const C = C_eff_nn;
  const nConnect = connectArr.filter(Boolean).length;
  let Ex, Ey, Ez, solver_validity;

  if (nConnect === 3) {
    const det = C[0][0]*(C[1][1]*C[2][2]-C[1][2]*C[2][1])
              - C[0][1]*(C[1][0]*C[2][2]-C[1][2]*C[2][0])
              + C[0][2]*(C[1][0]*C[2][1]-C[1][1]*C[2][0]);
    if (Math.abs(det) < 1e-30) return { rejected: true, reject_reason: 'singular', rho };
    const invDet = 1/det;
    const S00 = (C[1][1]*C[2][2]-C[1][2]*C[2][1])*invDet;
    const S11 = (C[0][0]*C[2][2]-C[0][2]*C[2][0])*invDet;
    const S22 = (C[0][0]*C[1][1]-C[0][1]*C[1][0])*invDet;
    Ex = 1/S00; Ey = 1/S11; Ez = 1/S22;
    solver_validity = 'valid';
  } else if (nConnect > 0) {
    Ex = connectArr[0] ? C[0][0] : 0;
    Ey = connectArr[1] ? C[1][1] : 0;
    Ez = connectArr[2] ? C[2][2] : 0;
    solver_validity = 'partial';
  } else {
    Ex = 0; Ey = 0; Ez = 0;
    solver_validity = 'invalid';
  }

  return { rho, Ex, Ey, Ez, solid, cg_iters: totalIters,
           cg_converged: allConverged, solver_validity };
}


// ─── Thermal homogenization — scalar FFT-CG ──────────────────────────────────
// Same Lippmann-Schwinger approach as elastic but scalar:
// ∇·(k(x)∇T) = 0  →  Γ̂(ξ) = ξ⊗ξ / (k0·|ξ|²)
// Three load cases (unit gradient in X, Y, Z) → keff_x, keff_y, keff_z
function thermalHomogenize(solid, N, ks, kv) {
  const N3 = N * N * N;
  const k0 = ks;
  // Green operator — cached for the duration of the sweep
  const Gamma = getThermalGamma(N, k0);
  // Apply Green operator to a flux field q[3*N3] (interleaved x,y,z per voxel)
  // Returns corrected flux after one Lippmann-Schwinger iteration
  function applyGamma(q) {
    // FFT each component
    const qx = new Float64Array(N3*2), qy = new Float64Array(N3*2), qz = new Float64Array(N3*2);
    for (let i = 0; i < N3; i++) { qx[2*i]=q[3*i]; qy[2*i]=q[3*i+1]; qz[2*i]=q[3*i+2]; }
    fft3d(qx, N, false); fft3d(qy, N, false); fft3d(qz, N, false);
    // Apply Gamma in freq space
    for (let i = 0; i < N3; i++) {
      const gi = i*9;
      const rx = qx[2*i], ix2 = qx[2*i+1];
      const ry = qy[2*i], iy = qy[2*i+1];
      const rz = qz[2*i], iz = qz[2*i+1];
      qx[2*i]   = Gamma[gi+0]*rx + Gamma[gi+1]*ry + Gamma[gi+2]*rz;
      qx[2*i+1] = Gamma[gi+0]*ix2+ Gamma[gi+1]*iy + Gamma[gi+2]*iz;
      qy[2*i]   = Gamma[gi+3]*rx + Gamma[gi+4]*ry + Gamma[gi+5]*rz;
      qy[2*i+1] = Gamma[gi+3]*ix2+ Gamma[gi+4]*iy + Gamma[gi+5]*iz;
      qz[2*i]   = Gamma[gi+6]*rx + Gamma[gi+7]*ry + Gamma[gi+8]*rz;
      qz[2*i+1] = Gamma[gi+6]*ix2+ Gamma[gi+7]*iy + Gamma[gi+8]*iz;
    }
    fft3d(qx, N, true); fft3d(qy, N, true); fft3d(qz, N, true);
    const out = new Float64Array(N3*3);
    for (let i = 0; i < N3; i++) { out[3*i]=qx[2*i]; out[3*i+1]=qy[2*i]; out[3*i+2]=qz[2*i]; }
    return out;
  }

  // CG solve for one macroscopic gradient direction e (unit vector [ex,ey,ez])
  // Returns effective conductivity in that direction
  function cgThermal(ex, ey, ez) {
    const tol = 1e-4, maxiter = 40;
    // Local conductivity per voxel
    const kLocal = new Float64Array(N3);
    for (let i = 0; i < N3; i++) kLocal[i] = solid[i] > 0.5 ? ks : kv;

    // Initial flux field: q = k(x) * e_bar
    const q = new Float64Array(N3*3);
    for (let i = 0; i < N3; i++) {
      q[3*i]   = kLocal[i] * ex;
      q[3*i+1] = kLocal[i] * ey;
      q[3*i+2] = kLocal[i] * ez;
    }

    // Residual: r = q - k(x)·e - k(x)·Γ*(q - k0·e)
    // Simplified: polarization τ = (k(x)-k0)·(e + ∇T_fluct)
    // We iterate on the temperature gradient fluctuation field ε = ∇T - e
    const eps = new Float64Array(N3*3); // fluctuation, starts at 0

    for (let iter = 0; iter < maxiter; iter++) {
      // τ = (k-k0)*(e + eps)  — polarization
      const tau = new Float64Array(N3*3);
      for (let i = 0; i < N3; i++) {
        const dk = kLocal[i] - k0;
        tau[3*i]   = dk * (ex + eps[3*i]);
        tau[3*i+1] = dk * (ey + eps[3*i+1]);
        tau[3*i+2] = dk * (ez + eps[3*i+2]);
      }
      // New eps = -Γ * τ
      const GammaTau = applyGamma(tau);
      let res2 = 0;
      for (let i = 0; i < N3*3; i++) {
        const diff = -GammaTau[i] - eps[i];
        res2 += diff * diff;
        eps[i] = -GammaTau[i];
      }
      if (Math.sqrt(res2 / N3) < tol) break;
    }

    // Effective conductivity = mean(k(x)*(e+eps)) · e
    let keff = 0;
    for (let i = 0; i < N3; i++) {
      const gx = ex + eps[3*i], gy = ey + eps[3*i+1], gz = ez + eps[3*i+2];
      const flux = kLocal[i] * (ex*gx + ey*gy + ez*gz);
      keff += flux;
    }
    return keff / N3;
  }

  return {
    kx: +cgThermal(1,0,0).toFixed(4),
    ky: +cgThermal(0,1,0).toFixed(4),
    kz: +cgThermal(0,0,1).toFixed(4),
  };
}
