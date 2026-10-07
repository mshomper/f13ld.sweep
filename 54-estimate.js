/* ============================================================
   F13LD.sweep · 54-estimate.js
   estimateHomogenization: the per-design pipeline (pre-gate, masks, solve, metrics).
   ============================================================ */


function estimateHomogenization(family, params, offset, scaleX, scaleY, scaleZ, Es, nu, baseline, mode, wallThickness, nWeights, pipeR, phaseShift, ks, sigma_ref, voxelToUm, cellMult, eps_yield_um, linear_cap_kind, piNorm, shellNorm, contrast, maxiterArg, gridN, targetHints) {
  // v0.16.0: precision-mode plumbing. Callers (sweep dispatch + worker) pass
  // contrast/maxiter derived from the Fast/Rigorous toggle. Default to Fast.
  const _contrast = (contrast != null) ? contrast : 1e-3;
  const _maxiter  = (maxiterArg != null) ? maxiterArg : CG_MAXITER_FAST;
  const isPi    = mode === 'pi-tpms';
  const isBeam  = mode === 'beam-solid';
  const wt = wallThickness || 0.3;
  const kernel = KERNELS[family || 'tpms'];
  // v0.16.0: FFT grid resolution comes from the picker (gridN argument)
  // with per-family floors applied. PI-TPMS and beam force ≥32 regardless
  // of picker because sub-32 voxelization breaks their thin features
  // (pipes, struts). Standard TPMS / noise / grain accept the raw picker
  // (default 16, user opt-up 32). If gridN wasn't supplied (legacy callers
  // or direct invocations), fall back to per-family defaults.
  const familyFloor = isPi ? FFT_N_PI : isBeam ? FFT_N_BEAM : FFT_N_STD;
  const N = (gridN != null) ? Math.max(gridN, familyFloor) : familyFloor;

  // E2: noise modes share the same undersampling problem PI-TPMS hits at
  // N=16/32. A noise sheet at half_width=0.03 in normalized [-1,1] field
  // units is a thin band that voxel centers at solver resolution often miss
  // entirely, producing speckled disconnected masks. Hi-res override fixes
  // connectivity, VF, and pore metrics. N=64 chosen vs PI-TPMS's N=96
  // because noise fields are smoother than thin pipes — coarser hi-res
  // still resolves them and saves ~3.4× on the hi-res cost. The FFT-CG
  // solver itself stays at N=16 so solver wall time is unchanged.
  // Grain (spinodoid/GRF/HU) gets the same hi-res treatment — its sheet
  // mode produces thin shells just like noise sheet, so N=16 → N=64.
  const isNoise = (mode === 'noise-sheet' || mode === 'noise-half' || mode === 'noise-solid');
  const isGrain = (mode === 'grain-sheet' || mode === 'grain-half' || mode === 'grain-solid');

  // ── v0.14.0 reorder: percolation runs BEFORE the FFT-CG solver ──────────
  // Previously percolation ran AFTER fftHomogenize, so it could only inform
  // post-hoc reporting — solver wasted iterations on disconnected axes that
  // would later be flagged as zero-stiffness. New flow: percolation gates
  // the solver directly via the connect arg, and disconnected axes skip the
  // CG solve entirely.
  //
  // Per-mode connectivity source:
  //   PI/noise/grain → hi-res mask is canonical (matches manufactured part)
  //   solid/shell    → solver-grid mask IS the canonical truth (no hi-res
  //                     pipeline for these modes)
  const cellSizeMm = (voxelToUm || 62.5) * 32 / 1000; // mm per cell (N-independent)
  let connect_idx, pores;
  let solidPerc = null;
  let hiResData = null;
  let solverGridSolid = null;  // pre-built solver-grid mask for solid/shell handoff
  let rho_hi = null;            // hi-res VF (overrides solver-grid VF for PI/noise/grain)
  let bakedV = null;            // E4: cached SDF field for kernels with bakeField (beam),
                                // reused between buildVoxels and surface_complexity

  // ── v0.18.0: Target-aware pre-gate (param-level, before voxel build) ────
  // Cheapest rejection: pure parameter inspection, no field eval. Applies
  // only when the rank metrics include anisotropy with MAX direction (i.e.
  // user wants anisotropic designs and our sweep happened to draw three
  // near-equal scales). The 5% similarity floor is the value Matt requested
  // 2026-05-16 — drops are rare under v0.18.0's axial-shifted scale draws
  // since the bias steers most of them apart already.
  if (targetHints && targetHints.scale_similarity_floor != null) {
    const _arr = [scaleX, scaleY, scaleZ];
    const _mean = (_arr[0] + _arr[1] + _arr[2]) / 3;
    if (_mean > 1e-6) {
      const _allWithin = _arr.every(s => Math.abs(s - _mean) / _mean < targetHints.scale_similarity_floor);
      if (_allWithin) {
        return {
          volume_fraction: 0,
          Ex_GPa: 0, Ey_GPa: 0, Ez_GPa: 0,
          anisotropy: null,
          directionality: 0.333,
          solver_validity: 'invalid',
          cg_iters: 0, cg_converged: false, grid_N: N,
          stiffness_density: 0, surface_complexity: 0,
          throat_ratio: 0,
          degenerate: true,
          reject_reason: 'aniso_insufficient'
        };
      }
    }
  }

  // ── v0.17.0: Pre-gate — cheap VF rejection before the expensive pipeline ─
  // Build the solver-grid voxelization up front for ALL modes (was previously
  // built only in the else branch below for solid/shell/beam). Count voxels
  // → ρ_pregate and check against per-mode bounds. Reject early on out-of-
  // bounds to avoid paying for the hi-res field build (~50-200ms), the
  // percolation BFS (~20-50ms), and the pore EDT analysis (~50-100ms) for
  // designs the canonical pipeline would also reject.
  //
  // Bound tightness depends on which mask is canonical for the mode:
  //   • solid / shell / beam-solid → solver-grid IS canonical. Pre-gate
  //     uses exact rhoMin / RHO_MAX. Any rejection here would also be
  //     rejected by fftHomogenize's internal check.
  //   • PI-TPMS / noise / grain → hi-res mask is canonical. Solver-grid can
  //     under-count thin features (a noise sheet at half_width=0.03 might
  //     read ρ=0.04 at N=16 but ρ=0.06 at N=64). Pre-gate uses relaxed
  //     bounds (rhoMin × 0.7, RHO_MAX × 1.15) to avoid false rejects;
  //     borderline designs proceed to the hi-res check.
  //
  // Cost added per accepted design: one extra buildVoxels at N=16/32 for
  // PI/noise/grain modes (~5-15ms). Cost saved per rejected design:
  // 200-500ms. Net win scales with the discard rate.
  //
  // v0.18.0: pre-gate bounds get an additional multiplicative tightening
  // from targetHints.pregate_rho_factors. ρ-DOWN pressure tightens the hi
  // bound (rejects denser-than-target designs early); ρ-UP pressure
  // tightens the lo bound. Factors are 1.0 at tier=0 (byte-identical to
  // v0.17.0 default). Mild — Layer 1's biased jitter does the heavy
  // lifting, this just catches the outliers Layer 1 missed.
  if (kernel.bakeField) {
    bakedV = kernel.bakeField(params, N);
  }
  solverGridSolid = buildVoxels(family, params, offset, N, mode, wt, nWeights || null, pipeR, phaseShift, bakedV, piNorm, shellNorm);
  let _pregateInside = 0;
  for (let i = 0; i < solverGridSolid.length; i++) _pregateInside += solverGridSolid[i];
  const rho_pregate = _pregateInside / solverGridSolid.length;

  const _pregate_rhoMin = (mode === 'pi-tpms') ? RHO_MIN_PI :
                          isNoise              ? RHO_MIN_NOISE :
                          isGrain              ? RHO_MIN_GRAIN :
                          isBeam               ? RHO_MIN_BEAM :
                          RHO_MIN_STD;
  const _pregate_rhoMax = resolveRhoMax(mode);
  const _pregate_usesHiRes = (isPi || isNoise || isGrain);
  const _baseRhoLo = _pregate_usesHiRes ? _pregate_rhoMin * 0.7  : _pregate_rhoMin;
  const _baseRhoHi = _pregate_usesHiRes ? _pregate_rhoMax * 1.15 : _pregate_rhoMax;
  // v0.18.0: apply target-aware tightening factors
  const _rhoFactors = (targetHints && targetHints.pregate_rho_factors) || { lo: 1.0, hi: 1.0 };
  const _pregate_lo = _baseRhoLo * _rhoFactors.lo;
  const _pregate_hi = _baseRhoHi * _rhoFactors.hi;

  if (rho_pregate < _pregate_lo || rho_pregate > _pregate_hi) {
    return {
      volume_fraction: rho_pregate,
      Ex_GPa: 0, Ey_GPa: 0, Ez_GPa: 0,
      anisotropy: null,
      directionality: 0.333,
      solver_validity: 'invalid',
      cg_iters: 0,
      cg_converged: false,
      grid_N: N,
      stiffness_density: 0, surface_complexity: 0,
      throat_ratio: 0,
      degenerate: true,
      reject_reason: (rho_pregate < _pregate_lo) ? 'vf_low' : 'vf_high'
    };
  }

  if (isPi) {
    const N_HI = 96;
    const hiRes = buildHiResField(family, params, offset, mode, wt, pipeR, phaseShift, N_HI, piNorm, shellNorm);

    // Hi-res VF — propagates to stiffness_density, aniso_efficiency, k_density below.
    let inside = 0;
    const sm = hiRes.solidMask;
    for (let i = 0; i < sm.length; i++) inside += sm[i];
    rho_hi = inside / sm.length;

    // v0.12: face-to-face solid percolation replaces computeAxisConnectivity.
    // Same widestPath-style algorithm now used for both phases — answers
    // "does load transmit?" directly rather than via periodic-loop proxy.
    solidPerc = computeSolidPercolation(hiRes.solidMask, N_HI);
    connect_idx = solidPerc.connect_idx;

    // Pore metrics from the same prebuilt field — saves a rebuild
    pores = analyzePoresFromField(hiRes.rawField, hiRes.voidMask, family, params, offset, mode, wt, pipeR, phaseShift, cellSizeMm, N_HI, piNorm, shellNorm);

    // v0.12: stash hi-res field/masks for downstream geometric metrics
    hiResData = { rawField: hiRes.rawField, voidMask: hiRes.voidMask, solidMask: hiRes.solidMask, N: N_HI };
  } else if (isNoise || isGrain) {
    const N_HI = 64;
    const hiRes = buildHiResField(family, params, offset, mode, wt, pipeR, phaseShift, N_HI, piNorm, shellNorm);

    let inside = 0;
    const sm = hiRes.solidMask;
    for (let i = 0; i < sm.length; i++) inside += sm[i];
    rho_hi = inside / sm.length;

    solidPerc = computeSolidPercolation(hiRes.solidMask, N_HI);
    connect_idx = solidPerc.connect_idx;

    pores = analyzePoresFromField(hiRes.rawField, hiRes.voidMask, family, params, offset, mode, wt, pipeR, phaseShift, cellSizeMm, N_HI, piNorm, shellNorm);

    hiResData = { rawField: hiRes.rawField, voidMask: hiRes.voidMask, solidMask: hiRes.solidMask, N: N_HI };
  } else {
    // Solid/shell TPMS / beam — solver-grid mask IS the canonical connectivity
    // truth. v0.17.0: the mask and bakedV are now built up front by the
    // pre-gate above (was a duplicate build here in v0.16.0 and earlier).
    // This branch just consumes them for percolation + pores.
    //
    // E4 bake-first note retained for context: when the kernel exposes
    // bakeField (beam today), bakedV is reused both as the buildVoxels input
    // and by the surface_complexity loop below.
    solidPerc = computeSolidPercolation(solverGridSolid, N);
    connect_idx = solidPerc.connect_idx;

    // Existing pore analysis at N=16 (rebuilds field locally)
    const cm = cellMult || 1.0;
    pores = analyzePores(family, params, offset, mode, wt, pipeR, phaseShift, cm, cellSizeMm, 16, piNorm, shellNorm);

    // Solid/shell modes: skip narrow-band geometric metrics. N=16 is too
    // coarse for stable curvature/topology, and these modes don't already
    // build a hi-res field (cost not justified by metric value here).
    // Tortuosity falls through to a void-mask reconstruction at N=16 below
    // since it's cheap.
    hiResData = null;
  }

  // ── v0.14.0: Run FFT-CG solver with prebuilt mask + connectivity gate ───
  const connectGate = solidPerc
    ? { x: !!solidPerc.connect_x, y: !!solidPerc.connect_y, z: !!solidPerc.connect_z }
    : null;
  const fft = fftHomogenize(family, params, offset, N, mode, wt, Es, nu,
                            nWeights || null, pipeR, phaseShift,
                            solverGridSolid, connectGate, piNorm, shellNorm,
                            _contrast, _maxiter);
  // Degenerate cases — VF outside [rhoMin, RHO_MAX] or singular (det≈0).
  // v0.14.0: degenerate return shape includes the new schema fields so vault
  // ingest can count them without special-casing.
  // v0.16.0: fftHomogenize now returns a tagged rejection {rejected: true,
  // reject_reason, rho} instead of bare null. Propagate the reason so the
  // sweep runner can count discards by category.
  if (!fft || fft.rejected) return {
    volume_fraction: (fft && fft.rho != null) ? fft.rho : 0,
    Ex_GPa: 0, Ey_GPa: 0, Ez_GPa: 0,
    anisotropy: null,           // v0.14: undefined for degenerate (was 1)
    directionality: 0.333,      // v0.14: isotropic-fallback for degenerate
    solver_validity: 'invalid', // v0.14: NEW
    cg_iters: 0,                // v0.14: NEW (no CG ran)
    cg_converged: false,        // v0.14: NEW
    grid_N:    N,               // v0.16.0: still report grid even on reject
    stiffness_density: 0, surface_complexity: 0,
    throat_ratio: 0,
    degenerate: true,
    reject_reason: (fft && fft.reject_reason) ? fft.reject_reason : 'unknown'
  };

  let { rho, Ex, Ey, Ez, solid: solidVox, cg_iters, cg_converged, solver_validity } = fft;

  // Override rho with hi-res VF for PI/noise/grain (canonical for those modes)
  if (rho_hi !== null) rho = rho_hi;

  // ─── Phase 1.5c: analytical beam homogenization with saturation correction ─
  // For beam family we BYPASS the FFT-CG result for stiffness and VF entirely
  // and compute them from closed-form beam theory. The FFT mask (already
  // built above) is still used for the other metrics — percolation, surface
  // complexity, pore size, tortuosity, curvature — that need a voxelized
  // representation. But for stiffness and VF, the analytical formula is:
  //   - Physically bounded (E_i ≤ VF · E_solid by construction at unit cell)
  //   - Topology-aware (sums over struts, weighted by direction cosines)
  //   - Anisotropic under cell stretch, with nodal-coupling saturation that
  //     reproduces the qualitative behavior published in the literature
  //     (anisotropy rises to a peak around stretch ratio ~2, then DECREASES
  //     at extreme stretch as nodal constraints redistribute load)
  //
  // Formula:
  //   E_i_raw = E_solid · (π/8) · Σ_struts [r² · (s_i d_i)² / L' / sharing]
  //                                                          / (s_x s_y s_z)
  //   VF      =          (π/8) · Σ_struts [r² · L' / sharing] / (s_x s_y s_z)
  //
  // Per-strut weight uses α² (= (s_i d_i)² / L²) — this is the standard form
  // for a periodic lattice under macroscopic uniaxial strain (see Gibson-
  // Ashby, asymptotic homogenization literature). An earlier Phase 1.5b
  // version used α⁴ which corresponds to an ISOLATED beam pivoting freely
  // in vacuum — that vastly over-predicts anisotropy in a constrained
  // lattice (a 3.7× stretch produced aniso ~90, vs published ~1.4 for
  // octet at 3× stretch). The α² form gives more realistic raw values.
  //
  // Saturation correction (nodal coupling model):
  //   s_ratio = max(s_x, s_y, s_z) / min(s_x, s_y, s_z)
  //   f       = exp(-K · max(s_ratio - S_THRESH, 0))   K=0.8, S_THRESH=1.5
  //   Emean   = (E_x · E_y · E_z)^(1/3)
  //   E_i     = Emean · (E_i_raw / Emean)^f
  //
  // Saturation kicks in only above s_ratio=1.5 (below that, the lattice is
  // close to its natural geometry and the raw α² formula is accurate).
  // Above 1.5, the exponent f∈(0,1) compresses E_x/E_y/E_z toward their
  // geometric mean — modeling the fact that real lattices CAN'T fully
  // realign under stretch because nodes and transverse struts redistribute
  // load. K=0.8 calibrated to match published octet data:
  //
  //   stretch (s_ratio, raw aniso) → saturated aniso  vs  published
  //   ──────────────────────────────────────────────────────────────
  //   (1.0,  1.00)  →  1.00         (1.00 cubic baseline)
  //   (1.5,  1.98)  →  1.98         (2.5–2.75: under-predicts moderately)
  //   (2.0,  3.10)  →  2.13         (~2.0 ✓)
  //   (3.0,  5.56)  →  1.68         (1.3–1.4: slight over-predict)
  //   (3.7,  9.16)  →  1.48         (matches published trend)
  //   (10,  ~22 )  →  ~1.001        (full saturation at extreme stretch)
  //
  // The model captures the qualitative physics: aniso rises to a peak
  // around stretch 2, then DECREASES toward 1 at extreme stretch — matching
  // experimental data from Nature 2025 stretched-octet scaffolds and
  // Gibson-Ashby asymptotic limits.
  //
  // VF is NOT saturated — it's a direct geometric quantity (strut volume
  // over cell volume) and the raw formula is correct.
  //
  // Limits:
  //   - Stretch-dominated only. Bend-dominated topologies (BCC at low VF)
  //     would want different exponent. Phase 1.6 TBD.
  //   - Diagonal stiffness only. Shear moduli not computed.
  //   - Saturation is a phenomenological fit, not derived from first
  //     principles. Calibration constants (K=0.8, S_THRESH=1.5) come from
  //     published octet data and may not generalize cleanly to other
  //     topologies. The "comparative reference, vault is not validated
  //     truth" framing applies — close-enough is the bar.
  if (mode === 'beam-solid' && params.beams) {
    const nomCell = cellMult || 1.0;
    const sx = scaleX / nomCell;
    const sy = scaleY / nomCell;
    const sz = scaleZ / nomCell;
    const rEffMm = params.rEffMm || params.beams.map(() => params.baseRadiusMm);

    // ── v0.15.0 — Maxwell-criterion bending knockdown ──────────────────
    //
    // Pre-v0.15.0 the formula was pure axial-stretch (α² form): each strut
    // contributed r²·cos²θ·L to Ex/Ey/Ez. That gave a linear E∝VF scaling
    // for ANY topology — physically correct for stretch-dominated lattices
    // (octet, satisfies Maxwell's b ≥ 3n−6 criterion for static determinacy)
    // and over-predictive for everything else. Diamond, BCC, kagome, and
    // most user-imported topologies are sub-Maxwell: they have internal
    // mechanisms that admit strut bending modes with no axial restoring
    // force, so under cell-level load the struts bend rather than stretch
    // and stiffness scales as VF² (Gibson-Ashby n=2) rather than VF.
    //
    // The correction multiplies the α² weight by per-strut β that combines
    // two physically distinct factors:
    //
    //   β = 1 / (1 + ALPHA · (L/r)² · max(0, 1 − z̄/z_M))
    //
    //   1. (L/r)²       Euler-Bernoulli bending/axial compliance ratio for
    //                   a single strut. Slender struts (high L/r) deflect
    //                   more under bending; thick struts (low L/r) don't.
    //   2. (1 − z̄/z_M)  Maxwell constraint deficit. z̄ = mean node coordination
    //                   (struts per node). z_M = 6 in 3D = isostatic threshold.
    //                   Sub-Maxwell (z̄ < 6): bending modes exist, factor > 0.
    //                   Maxwell-satisfying (z̄ ≥ 6): no internal mechanisms,
    //                   factor = 0, β = 1, pure α² behavior recovered.
    //                   Linear in deficit per soft-matter mean-field rigidity
    //                   theory (Wyart/Liu/Nagel — moduli scale linearly with
    //                   constraint deficit near isostaticity).
    //
    // Calibrated against literature (v0.15 work):
    //   - Octet truss (z̄=12): deficit=0 → β=1 → matches D-F E*/Es ≈ ρ/3 ✓
    //   - Diamond cubic (z̄=4): deficit=1/3, ALPHA=0.4 brings predicted
    //     E*/Es into the published 0.4-0.7·ρ² band ✓
    //   - Boundary lattices (z̄ near 6): deficit smoothly → 0, no
    //     discontinuity for custom user-imported topologies near isostatic
    //
    // Interaction with the nodal-coupling saturation step below: β acts
    // per-strut BEFORE saturation sees Ex/Ey/Ez as aggregated magnitudes.
    // Saturation is gated by cell-aspect-ratio (s_ratio) which is unchanged.
    // For sub-Maxwell topologies the combined effect compresses anisotropy
    // more than pre-v0.15 — re-verify against stretched-octet aniso data
    // on first use; if anisotropy is over-compressed, soften saturation by
    // raising S_THRESH (~2.0) or lowering K_SAT below rather than changing
    // ALPHA.
    const ALPHA_BEND = 0.4;
    const Z_MAXWELL = 6.0;
    // Mean coordination z̄ in the periodic lattice computed by sharing-
    // factor accounting. Naive endpoint hashing undercounts because cell-
    // local data drops the periodic boundary connections — a corner node
    // appears connected to k struts within this cell but in the infinite
    // lattice is shared with 7 neighboring cells, each contributing more
    // struts. The fix: effective per-cell counts that account for sharing.
    //
    //   N_eff = Σ_n 1/sf_n   (sum over unique nodes; sf_n = 2^k where k
    //                         counts boundary coordinates at |c|=1)
    //   B_eff = Σ_b 1/sf_b   (sum over beams; sf_b stored on each beam by
    //                         sweep's beam-graph builder)
    //   z̄ = 2·B_eff / N_eff  (each beam contributes 2 node-incidences)
    //
    // Verified against canonical references for sweep's beam graphs:
    //   - Octet (14 nodes, 36 beams in cell-local): N_eff=4, B_eff=24,
    //     z̄=12 → matches FCC-with-face-diagonals literature
    //   - Diamond cubic: z̄≈4 → matches tetrahedral coordination
    //
    // For custom user-imported topologies, the same formula applies as long
    // as endpoints follow the [-1, +1]³ cell convention. Boundary tolerance
    // 1e-4 is well below canonical lattice resolution (halves, thirds,
    // quarters) and tolerant of float noise from custom imports.
    const TOL_BOUNDARY = 1e-4;
    const _nodeSf = new Map();   // posKey → sf_n
    for (const _b of params.beams) {
      const kA = _b.ax.toFixed(4)+','+_b.ay.toFixed(4)+','+_b.az.toFixed(4);
      const kB = _b.bx.toFixed(4)+','+_b.by.toFixed(4)+','+_b.bz.toFixed(4);
      if (!_nodeSf.has(kA)) {
        let sf = 1;
        if (Math.abs(Math.abs(_b.ax) - 1) < TOL_BOUNDARY) sf *= 2;
        if (Math.abs(Math.abs(_b.ay) - 1) < TOL_BOUNDARY) sf *= 2;
        if (Math.abs(Math.abs(_b.az) - 1) < TOL_BOUNDARY) sf *= 2;
        _nodeSf.set(kA, sf);
      }
      if (!_nodeSf.has(kB)) {
        let sf = 1;
        if (Math.abs(Math.abs(_b.bx) - 1) < TOL_BOUNDARY) sf *= 2;
        if (Math.abs(Math.abs(_b.by) - 1) < TOL_BOUNDARY) sf *= 2;
        if (Math.abs(Math.abs(_b.bz) - 1) < TOL_BOUNDARY) sf *= 2;
        _nodeSf.set(kB, sf);
      }
    }
    let N_eff = 0;
    for (const sfn of _nodeSf.values()) N_eff += 1.0/sfn;
    let B_eff = 0;
    for (const _b of params.beams) B_eff += 1.0/(_b.sharingFactor || 1);
    const z_bar = N_eff > 0 ? (2 * B_eff / N_eff) : Z_MAXWELL;
    const z_deficit = Math.max(0, 1 - z_bar / Z_MAXWELL);

    let Ex_sum = 0, Ey_sum = 0, Ez_sum = 0;
    let VF_sum = 0;
    for (let i = 0; i < params.beams.length; i++) {
      const b = params.beams[i];
      const dx = b.dxBa, dy = b.dyBa, dz = b.dzBa;
      const sdx = sx*dx, sdy = sy*dy, sdz = sz*dz;
      const Lp = Math.sqrt(sdx*sdx + sdy*sdy + sdz*sdz);
      if (Lp < 1e-9) continue;
      const sf = b.sharingFactor || 1;
      const r2 = rEffMm[i] * rEffMm[i];
      // α² form: weight = r² · (s_i d_i)² / L' / sharing. Equivalent to
      // r² · cos²(θ_i) · L' / sharing if you expand (s d)² = L'² · cos²θ.
      // v0.15.0: multiply by per-strut β to capture bending compliance,
      // gated by the lattice-level Maxwell deficit (computed once above).
      const slender2 = (Lp * Lp) / r2;
      const beta = 1 / (1 + ALPHA_BEND * slender2 * z_deficit);
      Ex_sum += beta * r2 * (sdx*sdx) / Lp / sf;
      Ey_sum += beta * r2 * (sdy*sdy) / Lp / sf;
      Ez_sum += beta * r2 * (sdz*sdz) / Lp / sf;
      // VF is geometry-only — bending changes stiffness, not strut volume.
      VF_sum += r2 * Lp / sf;
    }
    const vol_cell = sx * sy * sz;
    const V_unit = 8.0;  // [-1,+1]³
    const k = Math.PI / V_unit / vol_cell;
    Ex  = Es * k * Ex_sum;
    Ey  = Es * k * Ey_sum;
    Ez  = Es * k * Ez_sum;
    rho = k * VF_sum;

    // ─── Nodal-coupling saturation ───────────────────────────────────────
    // Skip if any axis is degenerate (E ≤ 0) — geometric mean undefined and
    // the saturation transform requires all three E_i > 0.
    if (Ex > 1e-9 && Ey > 1e-9 && Ez > 1e-9) {
      const s_max = Math.max(sx, sy, sz);
      const s_min = Math.min(sx, sy, sz);
      const s_ratio = s_max / s_min;
      const K_SAT = 0.8;
      const S_THRESH = 1.5;
      const f_sat = Math.exp(-K_SAT * Math.max(s_ratio - S_THRESH, 0));
      if (f_sat < 0.9999) {  // only apply when saturation is active (s_ratio > S_THRESH)
        const Emean = Math.cbrt(Ex * Ey * Ez);
        Ex = Emean * Math.pow(Ex / Emean, f_sat);
        Ey = Emean * Math.pow(Ey / Emean, f_sat);
        Ez = Emean * Math.pow(Ez / Emean, f_sat);
      }
    }
  }

  // Surface complexity from isosurface face count at N=16. The voxel mask
  // for this proxy must match the actual mode's threshold logic — the v0.8
  // implementation hardcoded TPMS-solid (`field - offset < 0`) regardless
  // of mode/family, so PI-TPMS / shell / noise modes all reported wrong
  // surface_complexity values. Now uses applyMode for family-aware solid/
  // void classification. Numbers will not match v0.8 for any mode except
  // TPMS solid (where v0.8 was already correct by accident).
  const TWO_PI_SC = 2 * Math.PI;
  const scModeArgs = {
    offset,
    wt: wt || 0.3,
    pipeR: pipeR || 0.1,
    dx: (phaseShift?.x || 0) * TWO_PI_SC,
    dy: (phaseShift?.y || 0) * TWO_PI_SC,
    dz: (phaseShift?.z || 0) * TWO_PI_SC,
    // TPMS field-normalization flags — read by applyMode (no-op for non-TPMS modes)
    piNormalize:    !!piNorm,
    shellNormalize: !!shellNorm,
    isoLevel: params.isoLevel,
    halfWidth: params.halfWidth,
    halfInvert: !!params.halfInvert,
  };
  const scEvalFn = (x, y, z) => kernel.evaluate(params, x, y, z);
  const vSolid = new Uint8Array(N*N*N);
  const L = Math.PI, step = 2*L/N;
  // E4 bake-first: if the kernel baked V already (beam path), threshold it
  // inline instead of re-running the (expensive) evaluate loop. For
  // beam-solid, applyMode reduces to (V < 0), so we read the cached V
  // directly. Other cached-V modes (when other families opt into
  // bakeField later) would need their own threshold branches here; for
  // now beam is the only kernel with bakeField, so the fallback path
  // covers everything else unchanged.
  if (bakedV && mode === 'beam-solid') {
    for (let idx = 0; idx < N*N*N; idx++) vSolid[idx] = bakedV[idx] < 0 ? 1 : 0;
  } else {
    for (let i = 0; i < N; i++) { const x2 = -L+(i+0.5)*step;
      for (let j = 0; j < N; j++) { const y2 = -L+(j+0.5)*step;
        for (let k = 0; k < N; k++) { const z2 = -L+(k+0.5)*step;
          vSolid[i*N*N+j*N+k] = applyMode(scEvalFn, x2, y2, z2, mode, scModeArgs);
        }}}
  }
  let faces = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const v = vSolid[i*N*N+j*N+k];
    if (i+1<N && vSolid[(i+1)*N*N+j*N+k]!==v) faces++;
    if (j+1<N && vSolid[i*N*N+(j+1)*N+k]!==v) faces++;
    if (k+1<N && vSolid[i*N*N+j*N+k+1]!==v)   faces++;
  }
  // v0.13: surface_complexity emitted raw (no min(1,…) cap). Cap was
  // unmotivated and clipped exactly the high-complexity designs vault
  // ranking would want to surface. faces/(N²·3) ≈ surface area density
  // in face-per-cell-area units; values >1 are valid and informative.
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
    // Hi-res path (PI-TPMS / noise / grain) — full curvature + topology + tortuosity
    const cm = computeCurvatureMetrics(hiResData.rawField, hiResData.voidMask, hiResData.solidMask, cellSizeMm, hiResData.N);
    const tm = computeTopology(hiResData.solidMask, cellSizeMm, hiResData.N);
    const tort = computeTortuosity(hiResData.voidMask, hiResData.N);

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
  } else {
    // Solid/shell path — tortuosity-only via N=16 voxel mask.
    // Build void mask from solidVox: solidVox is the solver's binary occupancy;
    // void = !solid. (solidVox is Uint8Array per the elastic solve.)
    const N3 = N * N * N;
    const voidMask = new Uint8Array(N3);
    for (let i = 0; i < N3; i++) voidMask[i] = solidVox[i] ? 0 : 1;

    const tort = computeTortuosity(voidMask, N);
    const eps_void = 1.0 - rho;
    const dEff = (tau) => {
      if (tau >= 9.99) return 0;
      return +Math.min(1.0, eps_void / (tau * tau)).toFixed(4);
    };

    geom = {
      ...geom,  // keep zero curvature/topology
      ...tort,
      D_eff_x_norm: dEff(tort.tortuosity_x),
      D_eff_y_norm: dEff(tort.tortuosity_y),
      D_eff_z_norm: dEff(tort.tortuosity_z)
    };
  }


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

  // Run thermal FFT-CG — reuses solid voxel grid from elastic solve
  const ks_val = ks || 1.0;  // normalized if no material selected
  const kv_val = ks_val * 0.0003; // void (air) ≈ 0.03% of solid
  const therm = thermalHomogenize(solidVox, N, ks_val, kv_val);
  const { kx, ky, kz } = therm;
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
    ? +(ms_perGPa_perc.reduce((a, b) => a + b, 0) / (2 * ms_perGPa_perc.length * 1e6)).toFixed(6)
    : null;

  // Stiffness normalised by solid stiffness — dimensionless, geometry-only
  const Ex_norm = +(Ex / (Es_ref + 1e-9)).toFixed(4);
  const Ey_norm = +(Ey / (Es_ref + 1e-9)).toFixed(4);
  const Ez_norm = +(Ez / (Es_ref + 1e-9)).toFixed(4);
  const stiffness_density_norm = +(
    (Ex + Ey + Ez) / (3 * rho * Es_ref + 1e-9)
  ).toFixed(4);

  // Thermal conductivity normalised by solid conductivity — dimensionless
  const ks_for_norm = ks_val || 1.0;
  const keff_x_norm = +(kx / (ks_for_norm + 1e-9)).toFixed(4);
  const keff_y_norm = +(ky / (ks_for_norm + 1e-9)).toFixed(4);
  const keff_z_norm = +(kz / (ks_for_norm + 1e-9)).toFixed(4);

  // Pore size and throat as fraction of cell — geometry-only, cell-invariant
  const cellSize_um = cellSizeMm * 1000;
  const pore_size_norm   = cellSize_um > 0 ? +(pores.pore_size   / cellSize_um).toFixed(4) : 0;
  const throat_size_norm = cellSize_um > 0 ? +(pores.throat_size / cellSize_um).toFixed(4) : 0;

  return {
    volume_fraction:    +(rho*100).toFixed(2),
    Ex_GPa:             +Ex.toFixed(2),
    Ey_GPa:             +Ey.toFixed(2),
    Ez_GPa:             +Ez.toFixed(2),
    // v0.14.0: anisotropy null-propagates when <2 axes percolate
    anisotropy:         aniso !== null ? +Math.min(aniso,99).toFixed(3) : null,
    directionality:     +directionality.toFixed(3),       // v0.14.0: NEW
    stiffness_density:  +((Ex+Ey+Ez)/3/rho).toFixed(2),
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
    keff_x:             +kx.toFixed(3),
    keff_y:             +ky.toFixed(3),
    keff_z:             +kz.toFixed(3),
    thermal_anisotropy: +Math.min(thermal_anisotropy,99).toFixed(2),
    k_density:          +k_density.toFixed(3),
    U_strain,
    microstrain_x,
    microstrain_y,
    microstrain_z,
    microstrain_avg,
    pore_size:          pores.pore_size,
    throat_size:        pores.throat_size,
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
}
