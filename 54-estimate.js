/* ============================================================
   F13LD.sweep · 54-estimate.js
   The per-design pipeline — build the design's geometry from its recipe,
   pre-gate on volume fraction, connectivity and pores, the solve (CPU
   FFT-CG here, or F13LD.lab's GPU solver), then the derived metrics.
   ============================================================ */

/* The per-design pipeline in three stages, so the GPU solver can take the
   middle one (v0.24.0):
     prepareDesign   geometry, VF / connectivity gates, pores, curvature,
                     topology, tortuosity — everything that is not a solve
     (solve)         elastic + thermal: CPU (fftHomogenize, thermalHomogenize)
                     in the same worker, or F13LD.lab's GPU solver
                     (solver/gpu-worker.js) via prepareDesignGpu → GPU →
                     finishDesignGpu
     finishDesign    every derived metric, from the prepared design and the
                     solve.
   estimateHomogenization is the CPU path, unchanged in its numbers. */

/* recipe — the design recipe (design-tool format, 40-design.js).
   opts   — { Es, nu, ks, sigma_ref, voxelToUm, eps_yield_um, linear_cap_kind,
              contrast, maxiter, gridN, targetHints, scale:[sx,sy,sz] | null } */
/* v0.27.2 — round to 4 significant figures (0 stays 0). Fixed decimals
   erased soft designs: E/Es of 3e-5 became 0.0000. */
/* v0.29.1 — metrics grid floor for the families measured on the solver
   grid, and the cell's edges per axis for the metrics (geometric mean 1, so
   a cube is [1, 1, 1] and the cell size keeps its meaning). Foam stretches
   its cells inside a cubic tile and noise its field inside a cube, so both
   are cubes here (designCellEdges, 55-estimate-gpu.js). */
const METRICS_N_MIN = 32;
function metricWeights(recipe, family) {
  const e = (typeof designCellEdges === 'function') ? designCellEdges(recipe, family) : [1, 1, 1];
  if (!e.every(v => isFinite(v) && v > 0)) return [1, 1, 1];
  if (e[0] === e[1] && e[1] === e[2]) return [1, 1, 1];
  const g = Math.cbrt(e[0] * e[1] * e[2]);
  return e.map(v => v / g);
}
function sig4(v) { return v === 0 || !isFinite(v) ? v : +v.toPrecision(4); }

function estimateHomogenization(recipe, opts) {
  const o = opts || {};
  const P = prepareDesign(recipe, o);
  if (P.reject) return P.reject;
  const { solverGridSolid, N, mode, connectGate, _contrast, _maxiter, _hiRes, rejectFn: reject } = P;
  const Es = o.Es, nu = o.nu, ks = o.ks;
  const fft = fftHomogenize(solverGridSolid, N, mode, Es, nu, connectGate, _contrast, _maxiter, _hiRes || o.solvedVF != null);
  if (!fft || fft.rejected) return reject((fft && fft.reject_reason) || 'unknown', (fft && fft.rho != null) ? fft.rho : 0);

  // Run thermal FFT-CG — reuses solid voxel grid from elastic solve
  const ks_val = ks || 1.0;  // normalized if no material selected
  const kv_val = ks_val * 0.0003; // void (air) ≈ 0.03% of solid
  const therm = thermalHomogenize(fft.solid, N, ks_val, kv_val);
  return finishDesign(P, {
    Ex: fft.Ex, Ey: fft.Ey, Ez: fft.Ez, cg_iters: fft.cg_iters, cg_converged: fft.cg_converged,
    solver_validity: fft.solver_validity, kx: therm.kx, ky: therm.ky, kz: therm.kz, ks_val
  }, o);
}

/* Stage 1. Returns { reject } for a discarded design, else the prepared
   design (P) the solve and finishDesign read. */
function prepareDesign(recipe, opts) {
  const o = opts || {};
  const geo = designGeometry(recipe);
  const mode = geo.sweepMode;
  const Es = o.Es, nu = o.nu, ks = o.ks, sigma_ref = o.sigma_ref;
  const eps_yield_um = o.eps_yield_um, linear_cap_kind = o.linear_cap_kind, targetHints = o.targetHints;
  const _contrast = (o.contrast != null) ? o.contrast : 1e-3;
  const _maxiter  = (o.maxiter != null) ? o.maxiter : CG_MAXITER_FAST;
  const isPi    = mode === 'pi-tpms';
  const isBeam  = mode === 'beam-solid';
  const isNoise = (mode === 'noise-sheet' || mode === 'noise-half' || mode === 'noise-solid');
  const isGrain = (mode === 'grain-sheet' || mode === 'grain-half' || mode === 'grain-solid');
  /* Solver grid: the picker (gridN) with per-family floors — PI-TPMS and
     beam need ≥ 32 for their thin pipes / struts. */
  const familyFloor = isPi ? FFT_N_PI : isBeam ? FFT_N_BEAM : FFT_N_STD;
  const N = (o.gridN != null) ? Math.max(o.gridN, familyFloor) : familyFloor;
  const cellSizeMm = (o.voxelToUm || 62.5) * 32 / 1000;   // mm per cell (N-independent)
  const reject = (reason, vf) => ({
    volume_fraction: vf || 0,
    Ex_GPa: 0, Ey_GPa: 0, Ez_GPa: 0, anisotropy: null, directionality: 0.333,
    solver_validity: 'invalid', cg_iters: 0, cg_converged: false, grid_N: N,
    stiffness_density: 0, surface_complexity: 0, throat_ratio: 0,
    degenerate: true, reject_reason: reason
  });

  /* ── Target-aware pre-gate (parameter-only): when anisotropy is a MAX
     target, drop near-isotropic cell-scale draws. Only for families with
     a cell scale (TPMS, beam). */
  if (o.scale && targetHints && targetHints.scale_similarity_floor != null) {
    const s = o.scale, m = (s[0] + s[1] + s[2]) / 3;
    if (m > 1e-6 && s.every(v => Math.abs(v - m) / m < targetHints.scale_similarity_floor)) return { reject: reject('aniso_insufficient') };
  }

  /* ── Solver-grid voxels + volume-fraction pre-gate. For PI / noise / grain
     the finer metrics grid is canonical for VF, so the solver grid gets
     relaxed bounds here (×0.7 / ×1.15). ── */
  const solverGridSolid = designVoxels(geo, N);
  let _in = 0;
  for (let i = 0; i < solverGridSolid.length; i++) _in += solverGridSolid[i];
  const rho_pregate = _in / solverGridSolid.length;
  const _rhoMin = isPi ? RHO_MIN_PI : isNoise ? RHO_MIN_NOISE : isGrain ? RHO_MIN_GRAIN : isBeam ? RHO_MIN_BEAM : RHO_MIN_STD;
  const _rhoMax = resolveRhoMax(mode);
  const _hiRes = (isPi || isNoise || isGrain);
  /* (v0.26.0 — no target-aware tightening: the density is drawn, 41-density.js)
     v0.26.0 — a design whose density the worker solved (o.solvedVF, the
     solid fraction on 4,096 sample points) is gated on that: binary voxels
     at 32³ read thin struts and walls several points low, which threw out
     designs drawn inside the window (Matt's beam BCC run, 2026-10-09). */
  const _lo = _hiRes ? _rhoMin * 0.7 : _rhoMin;
  const _hi = _hiRes ? _rhoMax * 1.15 : _rhoMax;
  const rho_gate = o.solvedVF != null ? o.solvedVF : rho_pregate;
  if (rho_gate < _lo || rho_gate > _hi) return { reject: reject(rho_gate < _lo ? 'vf_low' : 'vf_high', rho_gate) };

  /* ── Geometry metrics grid: 96 for PI-TPMS, 64 for noise / grain (thin
     pipes and sheets), else the solver grid itself (pores at 16 as before). */
  /* v0.24.0 — GPU Fast passes metricsN (48): a coarser metrics grid,
     never coarser than the solver grid. The CPU path keeps 96 / 64. */
  const N_GEO = (_hiRes && o.metricsN) ? Math.max(o.metricsN, N) : isPi ? 96 : (isNoise || isGrain) ? 64 : N;
  const field = _hiRes ? buildGeomField(geo, N_GEO) : null;
  const geoMask = _hiRes ? field.solidMask : solverGridSolid;
  let rho_hi = null;
  if (_hiRes) { let c = 0; for (let i = 0; i < geoMask.length; i++) c += geoMask[i] > 0.5 ? 1 : 0; rho_hi = c / geoMask.length; }
  const solidPerc = computeSolidPercolation(geoMask, N_GEO);
  /* v0.24.0 — the solver grid's own connectivity, for the under-resolved
     flag (finishDesign): a thin design the solver grid can't hold */
  const solverPerc = _hiRes ? computeSolidPercolation(solverGridSolid, N) : null;
  const connect_idx = solidPerc.connect_idx;
  /* v0.29.1 — every family is measured (Matt, 2026-10-10): pores,
     curvature, topology and tortuosity. PI-TPMS / noise / grain on their
     finer grid as before; the others on the solver grid's own voxels,
     floored at 32 (the pores used to come from a 16³ grid, curvature and
     topology were skipped and exported as 0). Volume fraction and solid
     connectivity keep their sources. Each axis is measured with the cell's
     real edge (metricWeights): a stretched cell is not a cube. */
  const N_MET = Math.max(N, METRICS_N_MIN);
  const mField = _hiRes ? field : (N_MET === N ? buildGeomFieldOn(geo, N, solverGridSolid) : buildGeomField(geo, N_MET));
  const wAx = metricWeights(recipe, geo.family);
  const pores = analyzePoresFromField(mField.rawField, mField.voidMask, cellSizeMm, mField.N, wAx);
  const hiResData = { rawField: mField.rawField, voidMask: mField.voidMask, solidMask: mField.solidMask, N: mField.N, w: wAx };

  /* ── FFT-CG solve on the solver-grid voxels, gated by connectivity ── */
  const connectGate = { x: !!solidPerc.connect_x, y: !!solidPerc.connect_y, z: !!solidPerc.connect_z,
                        yz: !!solidPerc.shear_yz, xz: !!solidPerc.shear_xz, xy: !!solidPerc.shear_xy };
  /* PI / noise / grain: the metrics grid is canonical for VF — gate on it
     here with the strict bounds, and let the solver skip its coarse check. */
  if (_hiRes && (rho_hi < _rhoMin || rho_hi > _rhoMax)) return { reject: reject(rho_hi < _rhoMin ? 'vf_low' : 'vf_high', rho_hi) };
  /* (the solver's own count of the same voxels — identical to rho_pregate) */
  let rho = rho_pregate;
  if (rho_hi !== null) rho = rho_hi;

  /* Surface complexity: voxel faces between solid and void on the solver
     grid, per cell face area (faces / 3N²). v0.29.1 — on a stretched cell
     each face counts its own area (a face normal to x is w_y·w_z). */
  let faces = 0;
  const fwx = wAx[1] * wAx[2], fwy = wAx[0] * wAx[2], fwz = wAx[0] * wAx[1];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const v = solverGridSolid[i*N*N+j*N+k] > 0.5;
    if (i+1<N && (solverGridSolid[(i+1)*N*N+j*N+k] > 0.5) !== v) faces += fwx;
    if (j+1<N && (solverGridSolid[i*N*N+(j+1)*N+k] > 0.5) !== v) faces += fwy;
    if (k+1<N && (solverGridSolid[i*N*N+j*N+k+1] > 0.5) !== v) faces += fwz;
  }
  const complexity = faces / (N*N*3);

  // ── v0.12 Phase 1: Geometric metrics (curvature, topology, tortuosity, diffusivity) ──
  let geom = {
    H_mean: 0, H_mean_abs: 0, H_std: 0,
    K_gauss_mean: 0, curvature_uniformity: 0, MIH: 0,
    euler_char: 0, genus: 0, genus_per_cell: 0,
    tortuosity_x: 0, tortuosity_y: 0, tortuosity_z: 0,
    D_eff_x_norm: 0, D_eff_y_norm: 0, D_eff_z_norm: 0
  };

  if (hiResData) {
    // Every family (v0.29.1) — full curvature + topology + tortuosity on the metrics grid
    const cm = computeCurvatureMetrics(hiResData.rawField, hiResData.voidMask, hiResData.solidMask, cellSizeMm, hiResData.N, hiResData.w);
    const tm = computeTopology(hiResData.solidMask, cellSizeMm, hiResData.N);
    const tort = computeTortuosity(hiResData.voidMask, hiResData.N, hiResData.w);

    // Bruggeman diffusivity estimate: D_eff/D_bulk = ε / τ²
    // ε = void fraction (1 - rho), τ = tortuosity per axis. Bounded [0,1] by
    // construction since τ ≥ 1 always.
    const eps_void = 1.0 - rho;
    const dEff = (tau) => {
      if (tau >= 9.99) return 0;  // tortuosity at cap → no effective transport
      return +Math.min(1.0, eps_void / (tau * tau)).toFixed(4);
    };

    geom = {
      ...cm, ...tm, ...tort,
      D_eff_x_norm: dEff(tort.tortuosity_x),
      D_eff_y_norm: dEff(tort.tortuosity_y),
      D_eff_z_norm: dEff(tort.tortuosity_z)
    };
  }


  return {
    reject: null, rejectFn: reject, geo, N, mode, isPi, isBeam, isNoise, isGrain, _contrast, _maxiter, _hiRes,
    solverGridSolid, rho_pregate, rho_hi, rho, solidPerc, solverPerc, connect_idx, connectGate, pores, complexity, geom,
    cellSizeMm, N_GEO, N_MET: mField.N
  };
}

/* Stage 3. S = the solve: { Ex, Ey, Ez, cg_iters, cg_converged,
   solver_validity, kx, ky, kz, ks_val, extra? } (extra: GPU-only fields,
   appended to the result). */
function finishDesign(P, S, opts) {
  const o = opts || {};
  const Es = o.Es, sigma_ref = o.sigma_ref, eps_yield_um = o.eps_yield_um, linear_cap_kind = o.linear_cap_kind;
  const { N, rho, solidPerc, connect_idx, pores, complexity, geom, cellSizeMm } = P;
  const { Ex, Ey, Ez, cg_iters, cg_converged, solver_validity, kx, ky, kz, ks_val } = S;

  // ── v0.14.0: anisotropy / directionality split ───────────────────────────
  //   anisotropy   — conventional max/min over PERCOLATING axes only.
  //                  null when fewer than 2 axes percolate (mathematically
  //                  undefined). Comparable to literature values.
  //   directionality (NEW) — max/sum over ALL axes including E=0. Always
  //                  defined. Range [0.333, 1.0]. 0.333 = isotropic,
  //                  1.0 = perfectly 1D. Captures geometric directionality
  //                  independent of load-carrying ability.
  //   axial_dominance — DROPPED (conceptually overlaps with directionality).
  const E_arr = [Ex, Ey, Ez];
  const connectArr_metric = solidPerc
    ? [!!solidPerc.connect_x, !!solidPerc.connect_y, !!solidPerc.connect_z]
    : [true, true, true];
  const E_perc = E_arr.filter((e, i) => connectArr_metric[i]);

  let aniso = null;
  if (E_perc.length >= 2) {
    aniso = Math.max(...E_perc) / (Math.min(...E_perc) + 1e-9);
  }

  const Emean3 = (Ex+Ey+Ez)/3;
  const Emax   = Math.max(Ex,Ey,Ez);
  const E_sum  = Ex + Ey + Ez;

  // Directionality: max/sum over all axes. Defined even with zeros.
  const directionality = E_sum > 0
    ? Emax / (E_sum + 1e-9)
    : 0.333;  // degenerate fallback — no stiffness anywhere

  // aniso_efficiency carries the same null-propagation as anisotropy
  const aniso_efficiency = (aniso !== null) ? aniso / (rho+1e-9) : null;

  const variance       = ((Ex-Emean3)**2+(Ey-Emean3)**2+(Ez-Emean3)**2)/3;
  const ortho_contrast = Emean3>0 ? Math.sqrt(variance)/Emean3 : 0;

  // v0.13: Es_ref retained for downstream normalized-field calculations.
  // load_path_eff = Emax / (ρ·Es_ref) was dropped — structurally redundant
  // with stiffness_density variants (audit Z compounds, aerospace).
  // Vault-side composition can recompute as Emax/(ρ·Es_ref) if needed.
  const Es_ref = Es || 100;

  // Stiff axis: which direction carries the peak stiffness.
  // v0.14.1: null when no axis percolates (solver_validity === 'invalid').
  // For 'partial' we still pick the strongest axis among the percolating ones —
  // Emax over (Ex, Ey, Ez) selects correctly because disconnected axes are 0.
  const stiff_axis = solver_validity === 'invalid'
    ? null
    : Emax === Ex ? 'X' : Emax === Ey ? 'Y' : 'Z';

  // (connect_idx is computed above in the hi-res analysis block — geometric BFS,
  // not the stiffness-threshold proxy that was wrong for PI-TPMS.)

  const kmax = Math.max(kx, ky, kz);
  const kmean = (kx + ky + kz) / 3;
  const thermal_anisotropy = kmax / (Math.min(kx,ky,kz) + 1e-9);
  const k_density = rho > 0 ? kmean / rho : 0;

  // Strain energy density and microstrain — derived from C_eff, zero extra solve cost
  // sig is in GPa (same units as Ex/Ey/Ez from solver)
  // U = σ²/(2E) in GPa units = GJ/m³; convert to practical units: × 1000 = MJ/m³
  // microstrain = (σ/E) × 10⁶ με  — direct and unit-consistent
  const sig = (sigma_ref !== null && sigma_ref !== undefined)
    ? sigma_ref          // already in GPa from getSigmaRef()
    : Es_ref * 0.0001;  // fallback: 0.01% of Es (very small normalized load)

  // ── v0.11+v0.14.1: Linear-regime cap + per-axis null propagation ─────────
  // Past the material's yield/fracture strain, σ/E is no longer physical.
  // Cap microstrain values at the material-specific limit; flag designs that
  // hit the cap so vault scaling isn't dominated by extrapolated runaway.
  // Worker dispatch passes eps_yield_um from getSolverMaterial; default to
  // 25000 με agnostic when called without (e.g. legacy worker path or tests).
  //
  // v0.14.1: disconnected axes (E=0 from Part 1 connectivity gating) report
  // null microstrain — no E to derive σ/E from. Capping at eps_cap was wrong
  // because it conflated "axis cannot bear load" with "axis yielded under
  // load." Pre-fix symptoms: vertical block clustering at eps_cap in plots,
  // microstrain_avg meaningless for partial-validity designs.
  const eps_cap = (eps_yield_um != null) ? eps_yield_um : 25000;
  const cap_kind = linear_cap_kind || 'yield';

  const E_arr_strain = [Ex, Ey, Ez];
  const connectArr_strain = E_arr_strain.map(E => E > 0);

  // Per-axis raw microstrain — null for disconnected axes
  const microstrains_raw = E_arr_strain.map((E, i) =>
    connectArr_strain[i] ? +(sig / (E + 1e-9) * 1e6).toFixed(0) : null
  );

  // Capped at material's linear-regime limit (null preserved)
  const microstrains_capped = microstrains_raw.map(raw =>
    raw === null ? null : Math.min(raw, eps_cap)
  );
  const [microstrain_x, microstrain_y, microstrain_z] = microstrains_capped;

  // linear_cap_active: only consider percolating axes
  const linear_cap_active = microstrains_raw.some(raw => raw !== null && raw > eps_cap);

  // microstrain_avg: mean over percolating axes only; null when none percolate
  const ms_perc = microstrains_capped.filter(v => v !== null);
  const microstrain_avg = ms_perc.length > 0
    ? Math.round(ms_perc.reduce((a, b) => a + b, 0) / ms_perc.length)
    : null;

  // Mean strain energy density in kJ/m³ — averaged over percolating axes only.
  // Algebraic identity: U_i = sig²/(2·E_i) × 1e6 = 0.5 × sig × microstrain_i
  // (when sig in GPa and microstrain_i is the σ/E·1e6 form).
  const U_strain = ms_perc.length > 0
    ? +((0.5 * sig * ms_perc.reduce((a, b) => a + b, 0)) / ms_perc.length).toFixed(1)
    : null;

  // (Pore analysis is computed above in the hi-res analysis block —
  // hi-res N=96 for PI-TPMS, existing N=16 path for solid/shell.)

  // ── v0.11+v0.14.1: Normalized (geometry-only) forms ───────────────────────
  // Vault canonical metrics — independent of material/load/cell choice. The
  // dimensional forms above remain for engineer-readable display; normalized
  // forms below are what the vault should rank/compare on across recipes.
  // Per-GPa cap (1e6 με/GPa = 100% strain at unit applied stress) is a
  // material-agnostic structural-foam cutoff; geometry alone should never
  // claim more than this regardless of how soft the structure is.
  // v0.14.1: same null propagation as the dimensional microstrains above.
  const ms_perGPa = E_arr_strain.map((E, i) =>
    connectArr_strain[i] ? Math.round(Math.min(1e6 / (E + 1e-9), 1e6)) : null
  );
  const [microstrain_x_per_GPa, microstrain_y_per_GPa, microstrain_z_per_GPa] = ms_perGPa;

  const ms_perGPa_perc = ms_perGPa.filter(v => v !== null);
  const microstrain_avg_per_GPa = ms_perGPa_perc.length > 0
    ? Math.round(ms_perGPa_perc.reduce((a, b) => a + b, 0) / ms_perGPa_perc.length)
    : null;

  // Compliance per unit applied stress squared — GPa⁻¹.
  // U_compliance × σ² = strain energy per unit volume; lets vault recover U
  // for arbitrary σ without re-solving.
  // v0.14.1: averaged over percolating axes only; null when none percolate.
  const U_compliance = ms_perGPa_perc.length > 0
    ? sig4(ms_perGPa_perc.reduce((a, b) => a + b, 0) / (2 * ms_perGPa_perc.length * 1e6))
    : null;

  // Stiffness normalised by solid stiffness — dimensionless, geometry-only
  // v0.27.2: 4 significant figures, not 4 decimals — soft designs (low-VF
  // PI-TPMS sits at E/Es ~ 1e-5) used to round to 0 here.
  const Ex_norm = sig4(Ex / (Es_ref + 1e-9));
  const Ey_norm = sig4(Ey / (Es_ref + 1e-9));
  const Ez_norm = sig4(Ez / (Es_ref + 1e-9));
  const stiffness_density_norm = sig4((Ex + Ey + Ez) / (3 * rho * Es_ref + 1e-9));

  // Thermal conductivity normalised by solid conductivity — dimensionless
  const ks_for_norm = ks_val || 1.0;
  const keff_x_norm = sig4(kx / (ks_for_norm + 1e-9));
  const keff_y_norm = sig4(ky / (ks_for_norm + 1e-9));
  const keff_z_norm = sig4(kz / (ks_for_norm + 1e-9));

  // Pore size and throat as fraction of cell — geometry-only, cell-invariant
  const cellSize_um = cellSizeMm * 1000;
  const pore_size_norm   = cellSize_um > 0 ? +(pores.pore_size   / cellSize_um).toFixed(4) : 0;
  const throat_size_norm = cellSize_um > 0 ? +(pores.throat_size / cellSize_um).toFixed(4) : 0;

  const out = {
    volume_fraction:    +(rho*100).toFixed(2),
    Ex_GPa:             sig4(Ex),
    Ey_GPa:             sig4(Ey),
    Ez_GPa:             sig4(Ez),
    // v0.14.0: anisotropy null-propagates when <2 axes percolate
    anisotropy:         aniso !== null ? +Math.min(aniso,99).toFixed(3) : null,
    directionality:     +directionality.toFixed(3),       // v0.14.0: NEW
    stiffness_density:  sig4((Ex+Ey+Ez)/3/rho),
    aniso_efficiency:   aniso_efficiency !== null
                          ? +Math.min(aniso_efficiency,999).toFixed(2)
                          : null,
    // v0.14.0: axial_dominance DROPPED — replaced by directionality
    ortho_contrast:     +ortho_contrast.toFixed(3),
    // v0.13: load_path_eff removed (redundant with stiffness_density).
    // Vault-side: recompute as Emax/(rho·Es_ref) if needed.
    stiff_axis,
    connect_idx,
    // v0.14.0: solver-quality diagnostics surfaced in export
    solver_validity,    // 'valid' | 'partial' | 'invalid'
    cg_iters,           // total CG iterations across percolating load cases
    cg_converged,       // true if every load case hit tolerance before maxiter
    // v0.16.0: resolved FFT grid for this design (picker × family floor).
    // Per-design rather than per-sweep because mixed-family sweeps can
    // legitimately run different N per design.
    grid_N:             N,
    metrics_N:          P.N_MET,    // v0.29.1 — the grid pores / curvature / topology / tortuosity were measured on
    keff_x:             sig4(kx),
    keff_y:             sig4(ky),
    keff_z:             sig4(kz),
    thermal_anisotropy: +Math.min(thermal_anisotropy,99).toFixed(2),
    k_density:          sig4(k_density),
    U_strain,
    microstrain_x,
    microstrain_y,
    microstrain_z,
    microstrain_avg,
    pore_size:          pores.pore_size,
    throat_size:        pores.throat_size,
    throat_x:           pores.throat_x,
    throat_y:           pores.throat_y,
    throat_z:           pores.throat_z,
    // v0.13: throat_ratio replaces throat_efficiency. Raw throat-as-fraction-
    // of-cell with NO VF gate. The gate baked into throat_efficiency was a
    // vault-flavored opinion (penalize VF < 30%) that belongs in vault
    // composition, not sweep emission. Vault can recover the old behavior
    // via throat_ratio × min(volume_fraction/30, 1.0) if needed.
    throat_ratio: +(
      (cellSizeMm > 0)
        ? pores.throat_size / (cellSizeMm * 1000)
        : 0
    ).toFixed(4),
    perc_idx:           pores.perc_idx,
    surface_complexity: +complexity.toFixed(3),

    // ── v0.11: Linear-regime cap diagnostics ────────────────────────────────
    // v0.27.2: the solid modulus and reference stress behind every GPa value
    // above, so downstream tools (Vault) never have to assume 100 GPa.
    Es_ref_GPa:         Es_ref,
    sigma_ref_GPa:      sig,
    eps_yield_um_used:  eps_cap,
    linear_cap_kind:    cap_kind,
    linear_cap_active,

    // ── v0.11: Normalized (geometry-only, vault-canonical) metrics ─────────
    Ex_norm,
    Ey_norm,
    Ez_norm,
    stiffness_density_norm,
    keff_x_norm,
    keff_y_norm,
    keff_z_norm,
    microstrain_x_per_GPa,
    microstrain_y_per_GPa,
    microstrain_z_per_GPa,
    microstrain_avg_per_GPa,
    U_compliance,
    pore_size_norm,
    throat_size_norm,

    // ── v0.12 P1 + v0.13 curvature schema (signed H, magnitude, σ) ─────
    H_mean:               geom.H_mean,         // v0.13: SIGNED ⟨H⟩
    H_mean_abs:           geom.H_mean_abs,     // v0.13: NEW magnitude ⟨|H|⟩
    H_std:                geom.H_std,          // v0.13: NEW raw σ(H)
    K_gauss_mean:         geom.K_gauss_mean,
    curvature_uniformity: geom.curvature_uniformity,
    MIH:                  geom.MIH,

    // ── v0.12 Phase 1: Topology ────────────────────────────────────────
    euler_char:     geom.euler_char,
    genus:          geom.genus,
    genus_per_cell: geom.genus_per_cell,

    // ── v0.12 Phase 1: Tortuosity (geometric, per-axis) ───────────────
    tortuosity_x: geom.tortuosity_x,
    tortuosity_y: geom.tortuosity_y,
    tortuosity_z: geom.tortuosity_z,
    tortuosity_nonperc: geom.tortuosity_nonperc != null ? geom.tortuosity_nonperc : null,

    // ── v0.12 Phase 1: Diffusivity (Bruggeman estimate, per-axis) ─────
    D_eff_x_norm: geom.D_eff_x_norm,
    D_eff_y_norm: geom.D_eff_y_norm,
    D_eff_z_norm: geom.D_eff_z_norm,

    // ── v0.12 Phase 1: Per-axis percolation (both phases) ─────────────
    perc_x:    pores.perc_x,
    perc_y:    pores.perc_y,
    perc_z:    pores.perc_z,
    connect_x: solidPerc ? solidPerc.connect_x : 0,
    connect_y: solidPerc ? solidPerc.connect_y : 0,
    connect_z: solidPerc ? solidPerc.connect_z : 0,

    // ── v0.12 Phase 1: Pore-size distribution percentiles ─────────────
    pore_size_p10: pores.pore_size_p10,
    pore_size_p50: pores.pore_size_p50,
    pore_size_p90: pores.pore_size_p90,
    pore_size_cv:  pores.pore_size_cv
  };
  /* GPU solver: shear moduli, full stiffness, cell aspect, provenance */
  if (S.extra) Object.assign(out, S.extra);
  Object.assign(out, stiffnessFlags(P, S, out, Es_ref, rho));
  return out;
}

/* v0.24.0 — "stiffness may be inflated" flags (both solvers; exported,
   for F13LD.vault to filter on later).
     void-limited axis: the pores' stand-in stiffness (void ratio × E_solid,
       times the pore fraction) is over STIFFNESS_FLAG_VOID_SHARE of that
       axis's modulus — the axis reads high by about that much.
     under-resolved: the solver grid can't hold the design — it connects
       different axes than the finer metrics grid, its solid fraction is
       off by over 20 %, or the island trim had to be skipped because thin
       walls broke into pieces (GPU path).
   → { stiffness_flag, void_limited_axes ('' | 'x' | 'xz' …), under_resolved,
       stiffness_flag_reasons (text | null) } */
const STIFFNESS_FLAG_VOID_SHARE = 0.10;
function stiffnessFlags(P, S, out, Es, rho) {
  const vr = S.voidRatio != null ? S.voidRatio : (P._contrast != null ? P._contrast : 1e-3);
  const E = [out.Ex_GPa, out.Ey_GPa, out.Ez_GPa], why = [];
  const vAxes = [];
  E.forEach((e, i) => { if (e > 0 && vr * Es * (1 - rho) / e > STIFFNESS_FLAG_VOID_SHARE) vAxes.push('xyz'[i]); });
  if (vAxes.length) why.push(`pore stiffness is over ${Math.round(STIFFNESS_FLAG_VOID_SHARE * 100)} % of E on ${vAxes.join(', ')}`);
  const under = [];
  if (P.solverPerc && P.solidPerc) {
    const diff = ['x', 'y', 'z'].filter(a => !!P.solverPerc['connect_' + a] !== !!P.solidPerc['connect_' + a]);
    if (diff.length) under.push(`the solver grid (N = ${P.N}) connects differently from the metrics grid on ${diff.join(', ')}`);
  }
  if (P.rho_hi != null && P.rho_hi > 0 && Math.abs(P.rho_pregate - P.rho_hi) / P.rho_hi > 0.2)
    under.push(`solid fraction is ${Math.round(Math.abs(P.rho_pregate - P.rho_hi) / P.rho_hi * 100)} % off on the solver grid`);
  if (S.trimSkipped > 0)
    under.push(`thin walls broke into pieces on the solver grid (${(S.trimSkipped * 100).toFixed(0)} % of the solid)`);
  why.push(...under);
  return {
    stiffness_flag: vAxes.length > 0 || under.length > 0,
    void_limited_axes: vAxes.join(''),
    under_resolved: under.length > 0,
    stiffness_flag_reasons: why.length ? why.join('; ') : null
  };
}
