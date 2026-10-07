/* ============================================================
   F13LD.sweep · 44-solver-config.js
   Solver caches, grid / VF / CG constants, precision modes, Gamma caches.
   ============================================================ */

// ── Full FFT-CG homogenization (3 normal load cases) ─────────────────────────
// ─── Sweep-level solver caches — rebuilt once per sweep, not per design ───────
// Gamma tensors only depend on N, Es, nu, ks — all constant within a sweep run
let _cachedElasticGamma = null, _cachedElasticKey = '';
let _cachedThermalGamma = null, _cachedThermalKey = '';

// ─── Solver configuration constants ──────────────────────────────────────────
// FFT grid resolution per geometry mode. Pre-v0.16.0 these were the only
// values; in v0.16.0 they become DEFAULTS (for STD) and FLOORS (for PI and
// beam, where sub-voxel struts/pipes break connectivity below 32).
const FFT_N_STD    = 16;     // solid / shell TPMS — power of 2, sufficient for ranking
const FFT_N_PI     = 32;     // PI-TPMS — r² VF scaling needs higher resolution
const FFT_N_BEAM   = 32;     // beam lattices — strut diameters at jitter-low (50% of base)
                             // can be ~1 voxel at N=16, breaking connectivity. N=32 gives
                             // ~2 voxels at the thinnest jitter — minimum for trustworthy
                             // stiffness numbers. Same reasoning as PI-TPMS.

// v0.16.0: User-selectable solver resolution. Picker has two buckets: N=16
// (sweep default, ~5–10× faster) and N=32 (thin-wall accurate, matches PI/beam
// floor). Per-family floor logic in resolveGridN ensures PI-TPMS and beam
// always run at ≥32 regardless of picker.
const SOLVER_N_OPTIONS = { coarse: 16, fine: 32 };
let _currentSolverN = 16;
function getSolverN() { return _currentSolverN; }
function setSolverN(n) {
  if (n === 16 || n === 32) _currentSolverN = n;
}
// Resolve actual grid N for a given mode. Picker is a floor for STD-family
// modes; PI-TPMS and beam impose their own (higher) geometric floors.
function resolveGridN(mode) {
  const isPi   = (mode === 'pi-tpms');
  const isBeam = (mode === 'beam-solid');
  const familyFloor = isPi ? FFT_N_PI : isBeam ? FFT_N_BEAM : FFT_N_STD;
  return Math.max(_currentSolverN, familyFloor);
}

// Volume-fraction acceptance bounds — designs outside skip the CG solve entirely.
// v0.17.0: lower bounds relaxed for noise/grain/beam because real recipes
// authored at low VF (half-solid curl noise, ridged thin-strut surfaces,
// sparse beam lattices) were being discarded en masse despite producing
// physically meaningful designs. New floors:
//   noise: 0.02 (was 0.15) — half-solid curl/ridged produce purposefully
//                            thin strut-like surfaces below 0.10
//   grain: 0.03 (was 0.10) — spinodoid/GRF remain bicontinuous at very low VF
//   beam : 0.03 (was 0.05) — sparse strut topologies are the design intent
const RHO_MIN_STD   = 0.03;   // standard TPMS solid/shell
const RHO_MIN_PI    = 0.005;  // PI-TPMS — relaxed because pipe radius can produce thin VFs
const RHO_MIN_NOISE = 0.02;   // v0.17.0: relaxed from 0.15 — thin continuous strut-like
                              // surfaces in half-solid curl / ridged noise are the
                              // design intent, not a degenerate case.
const RHO_MIN_GRAIN = 0.03;   // v0.17.0: relaxed from 0.10 — bicontinuous spinodoid
                              // remains meaningful well below the old floor.
const RHO_MIN_BEAM  = 0.03;   // v0.17.0: relaxed from 0.05 — sparse beam lattices
                              // are recipe intent (octet at small r → low VF).

// v0.17.0: upper bound split by mode topology. Universal RHO_MAX=0.85 (v0.16.0)
// was admitting near-solid designs into the sweep — at high VF the topology
// stops being a sheet/pipe/strut and becomes a filled block with isolated
// voids, losing the recipe's authored character. Caps now match what each
// mode is physically *supposed* to look like:
//   sheet   : 0.60 — past this the sheet topology collapses to near-solid
//   half    : 0.70 — one-sided thresholds get a moderate ceiling
//   solid   : 0.75 — interior solid TPMS / noise / grain ceiling
//   PI-TPMS : 0.70 — pipe-network character lost past this VF
//   beam    : 0.50 — strut-dominated regime ends near 0.5 VF
const RHO_MAX_SHEET = 0.60;   // shell, noise-sheet, grain-sheet
const RHO_MAX_HALF  = 0.70;   // noise-half, grain-half
const RHO_MAX_SOLID = 0.75;   // solid TPMS, noise-solid, grain-solid
const RHO_MAX_PI    = 0.70;   // pi-tpms
const RHO_MAX_BEAM  = 0.50;   // beam-solid

// v0.17.0: mode → RHO_MAX dispatcher. Centralised so the pre-gate in
// estimateHomogenization and the canonical check inside fftHomogenize agree
// on the active upper bound for any given mode. Worker-included via the fns
// list in buildSolverWorkerSource so dispatch logic survives serialization.
function resolveRhoMax(mode) {
  if (mode === 'shell' || mode === 'noise-sheet' || mode === 'grain-sheet') return RHO_MAX_SHEET;
  if (mode === 'noise-half'  || mode === 'grain-half')                       return RHO_MAX_HALF;
  if (mode === 'pi-tpms')                                                    return RHO_MAX_PI;
  if (mode === 'beam-solid')                                                 return RHO_MAX_BEAM;
  return RHO_MAX_SOLID;  // solid (TPMS), noise-solid, grain-solid, fallback
}

// Conjugate-gradient solver convergence
// v0.14.0: tightened from 5e-4/40 → 1e-5/100 for production-grade accuracy.
// v0.16.0: CG_MAXITER split into mode-dependent constants. The Γ-formula fix
// in buildGamma restored proper √κ contrast scaling — CG iterations now grow
// as the operator condition number grows with contrast. Measured iter counts
// at N=16 gyroid: 117-390 @ contrast 1e-3; ~1000-1500 @ contrast 1e-4.
// Caps include ~30-50% headroom over measured worst case so legitimate
// convergence failures still surface as cg_converged=false rather than
// being masked by an aggressive cap.
const CG_TOL              = 1e-5;   // relative residual tolerance
const CG_MAXITER_FAST     = 600;    // contrast 1e-3 cap (Fast mode)
const CG_MAXITER_RIGOROUS = 2000;   // contrast 1e-4 cap (Rigorous mode)

// v0.16.0: Precision mode — UI-selectable Fast / Rigorous trade-off.
// Fast (default) caps contrast at 1e-3 for ~3× wall-time savings at ~5%
// systematic accuracy cost; relative rankings preserved. Rigorous opts in
// to 1e-4 for publication-grade absolute stiffness reporting.
const PRECISION_MODES = {
  fast:     { contrast: 1e-3, maxiter: CG_MAXITER_FAST     },
  rigorous: { contrast: 1e-4, maxiter: CG_MAXITER_RIGOROUS }
};
let _currentPrecisionMode = 'fast';
function getPrecisionMode() { return _currentPrecisionMode; }
function setPrecisionMode(m) {
  if (PRECISION_MODES[m]) _currentPrecisionMode = m;
}

function getElasticGamma(N, Es, nu) {
  const key = `${N}|${Es}|${nu}`;
  if (_cachedElasticKey !== key) {
    // v0.14.1: REVERTED to solid reference (was Voigt-avg in v0.14.0).
    // Voigt-avg C0 = (C_s + C_v)/2 makes the operator A = I + Γ(C(x)-C0)
    // INDEFINITE — eigenvalues straddle zero because (C(x) - C0) is positive
    // in solid and negative in void. Standard CG requires SPD; on indefinite
    // systems it diverges. Symptoms when v0.14.0 was active: stiffness
    // values exceeding Es by 10-100×, cg_converged=false on every load case,
    // garbage anisotropy/directionality numbers.
    //
    // The roadmap's Part 0.1 ("Voigt-avg minimizes Green's-operator spectral
    // radius") is correct for the BASIC Moulinec-Suquet fixed-point iteration
    // but NOT for the CG variant used here. Two different convergence
    // analyses; do not re-attempt without switching the iteration scheme.
    //
    // Future speedup option: Brisard-Dormieux preconditioner (M = ρ̄·C0)
    // gives 2-3× speedup without breaking SPD. See v0.14.1 hotfix discussion.
    const C0 = isoC(Es, nu);
    _cachedElasticGamma = buildGamma(N, C0[21], C0[1]);
    _cachedElasticKey = key;
  }
  return _cachedElasticGamma;
}

function getThermalGamma(N, k0) {
  const key = `${N}|${k0}`;
  if (_cachedThermalKey !== key) {
    const N3 = N * N * N;
    const twoPI_N = 2 * Math.PI / N;
    const Gamma = new Float64Array(N3 * 9);
    for (let i = 0; i < N; i++) {
      const fi = i <= N/2 ? i : i - N;
      for (let j = 0; j < N; j++) {
        const fj = j <= N/2 ? j : j - N;
        for (let k = 0; k < N; k++) {
          const fk = k <= N/2 ? k : k - N;
          const idx = (i*N*N + j*N + k) * 9;
          const xi = fi * twoPI_N, xj = fj * twoPI_N, xk = fk * twoPI_N;
          const xi2 = xi*xi + xj*xj + xk*xk;
          if (xi2 < 1e-14) continue;
          const inv = 1.0 / (k0 * xi2);
          Gamma[idx+0]=xi*xi*inv; Gamma[idx+1]=xi*xj*inv; Gamma[idx+2]=xi*xk*inv;
          Gamma[idx+3]=xj*xi*inv; Gamma[idx+4]=xj*xj*inv; Gamma[idx+5]=xj*xk*inv;
          Gamma[idx+6]=xk*xi*inv; Gamma[idx+7]=xk*xj*inv; Gamma[idx+8]=xk*xk*inv;
        }
      }
    }
    _cachedThermalGamma = Gamma;
    _cachedThermalKey = key;
  }
  return _cachedThermalGamma;
}

function invalidateSolverCaches() {
  _cachedElasticKey = '';
  _cachedThermalKey = '';
}
