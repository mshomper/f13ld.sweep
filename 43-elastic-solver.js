/* ============================================================
   F13LD.sweep · 43-elastic-solver.js
   Green operator, solver workspace and the CG load-case solve (CPU).
   ============================================================ */

// ── Precompute Green operator Gamma for N³ grid ───────────────────────────────
// Returns flat array of shape N³×6×6 (only normal 3×3 block needed for 3 load cases)
// We store just the 3×3 normal-normal block: indices [xx,yy,zz] × [xx,yy,zz]
function buildGamma(N, mu0, lam0) {
  const N3 = N * N * N;
  // Gamma_nn[p][q] for p,q in {0=xx,1=yy,2=zz}: shape N3, real
  const Gamma = [
    [new Float64Array(N3), new Float64Array(N3), new Float64Array(N3)],
    [new Float64Array(N3), new Float64Array(N3), new Float64Array(N3)],
    [new Float64Array(N3), new Float64Array(N3), new Float64Array(N3)],
  ];
  const a =  1.0 / mu0;
  const b = -(lam0 + mu0) / (mu0 * (lam0 + 2 * mu0));
  for (let i = 0; i < N; i++) {
    const ki = i <= N/2 ? i : i - N;
    for (let j = 0; j < N; j++) {
      const kj = j <= N/2 ? j : j - N;
      for (let k = 0; k < N; k++) {
        const kk = k <= N/2 ? k : k - N;
        const ksq = ki*ki + kj*kj + kk*kk;
        const idx = i*N*N + j*N + k;
        if (ksq === 0) { /* DC: leave zero */ continue; }
        const rk = 1.0 / Math.sqrt(ksq);
        const n = [ki*rk, kj*rk, kk*rk];
        // ── v0.16.0 — Γ-formula correctness fix ─────────────────────────────
        // Textbook Moulinec-Suquet 1998 normal-normal block reduction:
        //   Γ_iikk(n) = G_ik(n) · n_i · n_k
        // For an isotropic reference (mu0, lam0):
        //   G_pq(n) = (1/mu0)·δ_pq + b·n_p·n_q,   b = -(lam0+mu0)/(mu0·M_0)
        //   M_0 = lam0 + 2·mu0  (P-wave / constrained modulus of reference)
        // Pre-v0.16.0 used -0.25·[G_pp n_q² + G_qq n_p² + 2 G_pq n_p n_q],
        // which gave the wrong sign and a spurious off-diagonal coupling,
        // biasing the solver toward the Voigt upper bound (E/Es ∝ ρ^1.02
        // instead of literature-expected ρ^1.3 sheet / ρ^1.6-2.0 skeletal).
        // CG-Cs solver code is byte-identical; only this Γ tensor changes.
        for (let p = 0; p < 3; p++) {
          for (let q = 0; q < 3; q++) {
            const Gpq = a*(p===q?1:0) + b*n[p]*n[q];
            Gamma[p][q][idx] = Gpq * n[p] * n[q];
          }
        }
      }
    }
  }
  return Gamma;
}

// ─── Solver workspace — pre-allocated buffers, reused across CG iterations ────
// Keyed on N. Built lazily on first solve, persists across designs in a sweep.
// Killing this allocation churn is the main perf win in this refactor.
//
// Phase 2.5: Working arrays (eps, b, r, p, Ap, sig, tau, deps, FFT scratch)
// are Float32Array — halves memory bandwidth in the hot path, accuracy is
// well within CG_TOL=5e-4. Gamma stays Float64 (computed once, read many
// times — no allocation pressure). FFT line buffer stays Float64 because
// fft1d's butterfly recombination accumulates roundoff over log2(N) levels;
// the line buffer is only 2*N entries (~512 bytes), so the bandwidth cost
// is negligible vs the precision benefit.
let _solverWorkspace = null;
let _solverWorkspaceN = 0;

function getSolverWorkspace(N) {
  if (_solverWorkspaceN === N && _solverWorkspace) return _solverWorkspace;
  const N3 = N * N * N;
  const make3 = () => [new Float32Array(N3), new Float32Array(N3), new Float32Array(N3)];
  _solverWorkspace = {
    N, N3,
    // CG state — 3 components each (xx, yy, zz)
    eps:    make3(),
    b:      make3(),
    r:      make3(),
    p:      make3(),
    Ap:     make3(),
    epsNew: make3(),
    rNew:   make3(),
    // applyA scratch
    sig:    make3(),
    tau:    make3(),
    deps:   make3(),
    // applyGammaRow scratch — complex spectra (Float32 for memory bandwidth)
    fftOut:     new Float32Array(2 * N3),
    tauHat:     new Float32Array(2 * N3),
    // fft3d line buffer — Float64 to preserve butterfly precision (small footprint)
    fftLineBuf: new Float64Array(2 * N),
  };
  _solverWorkspaceN = N;
  return _solverWorkspace;
}

// ── Apply Green operator to a stress field (normal components only) ───────────
// tauFields: [Float64Array N3, Float64Array N3, Float64Array N3] — input stress fields
// GammaRow: [Float64Array N3, Float64Array N3, Float64Array N3] — Gamma[p][0..2]
// out: Float64Array N3 — destination for real-space strain correction
// ws: solver workspace (provides fftOut, tauHat, fftLineBuf scratch buffers)
function applyGammaRow(tauFields, GammaRow, N, out, ws) {
  const N3 = N * N * N;
  const fftOut  = ws.fftOut;
  const tauHat  = ws.tauHat;
  const lineBuf = ws.fftLineBuf;

  // Zero accumulator
  fftOut.fill(0);

  for (let q = 0; q < 3; q++) {
    // Pack real tau[q] into complex tauHat (real part only)
    tauHat.fill(0);
    const tq = tauFields[q];
    for (let i = 0; i < N3; i++) tauHat[2*i] = tq[i];
    fft3d(tauHat, N, false, lineBuf);
    // Multiply by Gamma[p][q] (real-valued) and accumulate
    const G = GammaRow[q];
    for (let i = 0; i < N3; i++) {
      fftOut[2*i]   += G[i] * tauHat[2*i];
      fftOut[2*i+1] += G[i] * tauHat[2*i+1];
    }
  }

  // IFFT in place into fftOut
  fft3d(fftOut, N, true, lineBuf);
  // Extract real part into out
  for (let i = 0; i < N3; i++) out[i] = fftOut[2*i];
}

// ── One CG load case (normal strain only) ────────────────────────────────────
// eps_bar: [exx, eyy, ezz] uniform macroscopic strain
// Returns: { sigma: [sxx, syy, szz], iters, converged }
function cgSolveNormal(solid, C_s, C_v, C0, Gamma, N, eps_bar, tol, maxiter) {
  const ws = getSolverWorkspace(N);
  const N3 = ws.N3;
  const { eps, b, r, p, Ap, epsNew, rNew, sig, tau, deps } = ws;

  // C(x):eps for 3 normal components — writes into sigOut (3 fields)
  // Inlines the 3-component multiplication of the Voigt 6×6 tensor (normal block only).
  function localStress(epsIn, sigOut) {
    for (let idx = 0; idx < N3; idx++) {
      const C = solid[idx] ? C_s : C_v;
      const e0 = epsIn[0][idx], e1 = epsIn[1][idx], e2 = epsIn[2][idx];
      sigOut[0][idx] = C[0]*e0  + C[1]*e1  + C[2]*e2;
      sigOut[1][idx] = C[6]*e0  + C[7]*e1  + C[8]*e2;
      sigOut[2][idx] = C[12]*e0 + C[13]*e1 + C[14]*e2;
    }
  }

  // System operator A*eps = eps + Gamma*(C(x)-C0)*eps  → writes into out
  function applyA(epsIn, out) {
    localStress(epsIn, sig);
    // tau = sig - C0*eps  (C0 is uniform, so the matrix-vector mul is cheap)
    for (let idx = 0; idx < N3; idx++) {
      const e0 = epsIn[0][idx], e1 = epsIn[1][idx], e2 = epsIn[2][idx];
      tau[0][idx] = sig[0][idx] - (C0[0]*e0  + C0[1]*e1  + C0[2]*e2);
      tau[1][idx] = sig[1][idx] - (C0[6]*e0  + C0[7]*e1  + C0[8]*e2);
      tau[2][idx] = sig[2][idx] - (C0[12]*e0 + C0[13]*e1 + C0[14]*e2);
    }
    // deps = Gamma * tau  (writes into ws.deps)
    applyGammaRow(tau, Gamma[0], N, deps[0], ws);
    applyGammaRow(tau, Gamma[1], N, deps[1], ws);
    applyGammaRow(tau, Gamma[2], N, deps[2], ws);
    // out = eps + deps
    const out0 = out[0], out1 = out[1], out2 = out[2];
    const ein0 = epsIn[0], ein1 = epsIn[1], ein2 = epsIn[2];
    const dp0 = deps[0], dp1 = deps[1], dp2 = deps[2];
    for (let i = 0; i < N3; i++) {
      out0[i] = ein0[i] + dp0[i];
      out1[i] = ein1[i] + dp1[i];
      out2[i] = ein2[i] + dp2[i];
    }
  }

  function dot(a, b) {
    let s = 0;
    const a0 = a[0], a1 = a[1], a2 = a[2];
    const b0 = b[0], b1 = b[1], b2 = b[2];
    for (let i = 0; i < N3; i++) s += a0[i]*b0[i] + a1[i]*b1[i] + a2[i]*b2[i];
    return s;
  }

  // Initialise: eps = b = uniform macroscopic strain
  for (let p_ = 0; p_ < 3; p_++) {
    eps[p_].fill(eps_bar[p_]);
    b[p_].fill(eps_bar[p_]);
  }
  const bNorm = Math.sqrt(dot(b, b)) + 1e-30;

  // r = b - A*eps  (use Ap as scratch since we don't need it yet)
  applyA(eps, Ap);
  for (let p_ = 0; p_ < 3; p_++) {
    const rP = r[p_], bP = b[p_], ApP = Ap[p_];
    for (let i = 0; i < N3; i++) rP[i] = bP[i] - ApP[i];
  }

  // p = r (initial search direction)
  for (let p_ = 0; p_ < 3; p_++) p[p_].set(r[p_]);

  let rr = dot(r, r);
  let iters = 0;
  let converged = false;

  for (let it = 0; it < maxiter; it++) {
    iters = it + 1;
    applyA(p, Ap);
    const pAp = dot(p, Ap);
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rr / pAp;

    // Fused update: epsNew = eps + alpha*p ; rNew = r - alpha*Ap
    for (let p_ = 0; p_ < 3; p_++) {
      const epsP = eps[p_], pP = p[p_], epsNewP = epsNew[p_];
      const rP = r[p_], ApP = Ap[p_], rNewP = rNew[p_];
      for (let i = 0; i < N3; i++) {
        epsNewP[i] = epsP[i] + alpha * pP[i];
        rNewP[i]   = rP[i]   - alpha * ApP[i];
      }
    }

    const rrNew = dot(rNew, rNew);
    const relRes = Math.sqrt(rrNew) / bNorm;

    // Commit: eps ← epsNew, r ← rNew
    for (let p_ = 0; p_ < 3; p_++) {
      eps[p_].set(epsNew[p_]);
      r[p_].set(rNew[p_]);
    }

    if (relRes < tol) { converged = true; break; }

    const beta = rrNew / rr;
    // p = r + beta*p (in-place since old p is no longer needed)
    for (let p_ = 0; p_ < 3; p_++) {
      const rP = r[p_], pP = p[p_];
      for (let i = 0; i < N3; i++) pP[i] = rP[i] + beta * pP[i];
    }
    rr = rrNew;
  }

  // Volume-average stress
  localStress(eps, sig);
  let s0 = 0, s1 = 0, s2 = 0;
  const sg0 = sig[0], sg1 = sig[1], sg2 = sig[2];
  for (let i = 0; i < N3; i++) { s0 += sg0[i]; s1 += sg1[i]; s2 += sg2[i]; }
  return {
    sigma: [s0/N3, s1/N3, s2/N3],
    iters: iters,
    converged: converged
  };
}
