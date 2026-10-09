/* ============================================================
   F13LD.sweep · 70-export.js
   Results export: analysis context, per-design homogenization, the one
   design-recipe builder (exports and handoffs), exportResults.
   ============================================================ */

// ─── Analysis context + per-design homog (P2g) ─────────────────────────────
// These exist because the export sites used to write `homogenization:
// baseRecipe.homogenization` directly — a stale shared reference to the
// recipe's original MIL-HS values. Every design's `design.homogenization`
// block ended up byte-identical, even though `browser:` correctly carried
// per-design FFT-CG estimates. Validators that read design.homogenization
// (the structurally-recipe-shaped block intended for re-loading into other
// tools) saw all designs as the same.
//
// Also surfaces UI-level provenance — domain selection, picked material,
// sigma_ref, and the rank metrics that produced filterRank — so an export
// is reproducible to the analysis context that generated it.

function _safeGetEl(id) {
  try { return document.getElementById(id); } catch (e) { return null; }
}

// Returns { domain, material, sigma_ref_GPa, voxelToUm_um, cellSize_mm,
//   rank_metrics } for the current UI state. Null-safe — if the DOM isn't
// present (headless tests, future programmatic use), returns sensible
// defaults rather than throwing.
//
// v0.11: voxelToUm_um and cellSize_mm capture the cell-coupling provenance
// for pore_size/throat_size dimensional values. Combined with normalized
// pore_size_norm in the export, the vault can recover dimensional pore
// metrics for any cell size without re-solving.
function buildAnalysisContext() {
  /* The settings the last sweep actually ran with (snapshotted by runSweep);
     the live page only before any sweep. */
  if (typeof lastSweepSettings !== 'undefined' && lastSweepSettings) return JSON.parse(JSON.stringify(lastSweepSettings.context));
  return buildLiveAnalysisContext();
}

function buildLiveAnalysisContext() {
  const domainEl   = _safeGetEl('domainSel');
  const materialEl = _safeGetEl('materialSel');
  const sigmaEl    = _safeGetEl('sigmaRef');
  const cellEl     = _safeGetEl('cellSize');
  const domain     = (domainEl && domainEl.value) || 'general';
  /* the reference stress the solver used: the input, or its default Es × 1e-4 */
  const sigma_ref_GPa = (typeof getSigmaRef === 'function' && getSigmaRef() != null) ? getSigmaRef()
    : ((typeof getSolverMaterial === 'function') ? getSolverMaterial().Es * 0.0001 : null);
  // Cell-size provenance — same derivation used by getVoxelToUm/estimateHomogenization.
  // cellSize_mm is the design-level cell (voxelToUm × N at N=32 reference);
  // independent of cellMult jitter so vault entries stay comparable.
  const cellSize_mm = (cellEl && cellEl.value) ? parseFloat(cellEl.value) : 2.0;
  const voxelToUm_um = cellSize_mm * 1000 / 32;
  // currentMaterial is module-scope — null when user hasn't picked one.
  const cm = (typeof currentMaterial !== 'undefined') ? currentMaterial : null;
  /* the rank metrics the user picked (not the domain defaults) */
  const ranks = [1, 2, 3].map(i => {
    const el = _safeGetEl('r' + i + 'metric');
    const m = el && el.value;
    if (!m || m === 'none') return null;
    const keep = i > 1 ? parseFloat((_safeGetEl('r' + i + 'keep') || {}).value) : null;
    return { rank: i, metric: m, direction: (typeof directions !== 'undefined' && directions[i]) || 'max', keep_pct: (keep != null && isFinite(keep)) ? keep : null };
  }).filter(x => x);
  return {
    domain,
    material: cm ? {
      key:    (materialEl && materialEl.value) || null,
      E_GPa:  cm.E,
      nu:     cm.nu,
      k_W_mK: cm.k,
      eps_yield_um:    cm.eps_yield_um    || EPS_YIELD_AGNOSTIC,
      linear_cap_kind: cm.linear_cap_kind || LINEAR_CAP_KIND_AGNOSTIC
    } : null,
    sigma_ref_GPa,
    voxelToUm_um,
    cellSize_mm,
    rank_metrics: ranks
  };
}

// Builds the per-design homogenization block from solver results (d.* fields)
// rather than reusing baseRecipe.homogenization. Optionally accepts a `grid`
// override — TPMS standard / grain at FFT_N_STD (16), PI-TPMS at FFT_N_PI (32).
// E_solid_GPa / poisson prefer currentMaterial values when present so the
// emitted reference moduli match what the solver actually used.
//
// `methodLabel` lets callers tag the source of the numbers — defaults to
// 'FFT-CG' (matches the solver method); exportSelectedDesign uses
// 'pipeline-sweep-estimate' to mark its single-row exports as estimates.
//
// P2h: emits ALL 27 solver-output metrics, not the 8-field subset that
// shipped through P2g. The earlier subset omitted connect_idx (validator-
// flagged), all thermal metrics, all microstrain metrics, and all pore/
// percolation metrics. Domain selection only drives UI table column
// visibility (DOMAIN_CONFIG[d].show) — exports always carry the full set
// regardless of domain. This matches Matt's invariant: "I want all data
// exporting every time, regardless of domain."
function perDesignHomogenization(d, gridOverride, methodLabel) {
  const cm = (typeof currentMaterial !== 'undefined') ? currentMaterial : null;
  // v0.16.0: priority order for the emitted grid value:
  //   1. explicit gridOverride (legacy callers that hard-coded 16, 48, etc.)
  //   2. d.grid_N from the solver result — picker-resolved per design
  //   3. mode-based default (legacy fallback for callers that pre-date grid_N)
  const grid = gridOverride != null
               ? gridOverride
               : (d && d.grid_N != null
                  ? d.grid_N
                  : ((baseRecipe && baseRecipe.geometry && baseRecipe.geometry.mode === 'pi-tpms') ? FFT_N_PI : FFT_N_STD));
  return {
    grid,
    E_solid_GPa:        (cm && cm.E  != null) ? cm.E  : (baseRecipe?.homogenization?.E_solid_GPa ?? 100),
    poisson:            (cm && cm.nu != null) ? cm.nu : (baseRecipe?.homogenization?.poisson    ?? 0.3),
    // ── Solver outputs (v0.14.0: dropped axial_dominance, added directionality
    //    + solver_validity + cg_iters + cg_converged) ────────────────────────
    volume_fraction:    d.volume_fraction,
    Ex_GPa:             d.Ex_GPa,
    Ey_GPa:             d.Ey_GPa,
    Ez_GPa:             d.Ez_GPa,
    anisotropy:         d.anisotropy,                // v0.14.0: nullable
    directionality:     d.directionality,            // v0.14.0: NEW
    stiffness_density:  d.stiffness_density,
    aniso_efficiency:   d.aniso_efficiency,          // v0.14.0: nullable
    // v0.14.0: axial_dominance DROPPED
    ortho_contrast:     d.ortho_contrast,
    stiff_axis:         d.stiff_axis,
    connect_idx:        d.connect_idx,
    solver_validity:    d.solver_validity,           // v0.14.0: NEW
    cg_iters:           d.cg_iters,                  // v0.14.0: NEW
    cg_converged:       d.cg_converged,              // v0.14.0: NEW
    keff_x:             d.keff_x,
    keff_y:             d.keff_y,
    keff_z:             d.keff_z,
    thermal_anisotropy: d.thermal_anisotropy,
    k_density:          d.k_density,
    U_strain:           d.U_strain,
    microstrain_x:      d.microstrain_x,
    microstrain_y:      d.microstrain_y,
    microstrain_z:      d.microstrain_z,
    microstrain_avg:    d.microstrain_avg,
    pore_size:          d.pore_size,
    throat_size:        d.throat_size,
    throat_x: d.throat_x, throat_y: d.throat_y, throat_z: d.throat_z,
    throat_ratio:       d.throat_ratio,           // v0.13: replaces throat_efficiency
    perc_idx:           d.perc_idx,
    surface_complexity: d.surface_complexity,    // v0.13: now uncapped
    // ── v0.11: Linear-regime cap diagnostics ─────────────────────────
    eps_yield_um_used:  d.eps_yield_um_used,
    linear_cap_kind:    d.linear_cap_kind,
    linear_cap_active:  d.linear_cap_active,
    // ── v0.11: Normalized (geometry-only) metrics ────────────────────
    Ex_norm:                 d.Ex_norm,
    Ey_norm:                 d.Ey_norm,
    Ez_norm:                 d.Ez_norm,
    stiffness_density_norm:  d.stiffness_density_norm,
    keff_x_norm:             d.keff_x_norm,
    keff_y_norm:             d.keff_y_norm,
    keff_z_norm:             d.keff_z_norm,
    microstrain_x_per_GPa:   d.microstrain_x_per_GPa,
    microstrain_y_per_GPa:   d.microstrain_y_per_GPa,
    microstrain_z_per_GPa:   d.microstrain_z_per_GPa,
    microstrain_avg_per_GPa: d.microstrain_avg_per_GPa,
    U_compliance:            d.U_compliance,
    pore_size_norm:          d.pore_size_norm,
    throat_size_norm:        d.throat_size_norm,
    // ── v0.12 Phase 1 + v0.13 curvature schema ───────────────────────
    H_mean:               d.H_mean,           // v0.13: now SIGNED ⟨H⟩
    H_mean_abs:           d.H_mean_abs,       // v0.13: NEW — magnitude ⟨|H|⟩
    H_std:                d.H_std,            // v0.13: NEW — σ(H) raw
    K_gauss_mean:         d.K_gauss_mean,
    curvature_uniformity: d.curvature_uniformity,  // v0.13: smooth 1/(1+σ/⟨|H|⟩)
    MIH:                  d.MIH,
    euler_char:           d.euler_char,
    genus:                d.genus,
    genus_per_cell:       d.genus_per_cell,
    tortuosity_x:         d.tortuosity_x,
    tortuosity_y:         d.tortuosity_y,
    tortuosity_z:         d.tortuosity_z,
    tortuosity_nonperc:   d.tortuosity_nonperc,
    D_eff_x_norm:         d.D_eff_x_norm,
    D_eff_y_norm:         d.D_eff_y_norm,
    D_eff_z_norm:         d.D_eff_z_norm,
    // Per-axis percolation (both phases)
    perc_x:    d.perc_x,
    perc_y:    d.perc_y,
    perc_z:    d.perc_z,
    connect_x: d.connect_x,
    connect_y: d.connect_y,
    connect_z: d.connect_z,
    // Pore-size distribution percentiles
    pore_size_p10: d.pore_size_p10,
    pore_size_p50: d.pore_size_p50,
    pore_size_p90: d.pore_size_p90,
    pore_size_cv:  d.pore_size_cv,
    method: methodLabel || 'FFT-CG',
    ...stiffnessFlagFields(d),
    ...gpuDesignFields(d),
    ...densityDesignFields(d),
    solver_version: d.solver_version || SOLVER_VERSION,
    geometry_version: GEOMETRY_VERSION
  };
}

/* v0.26.0 — the reference design (the recipe itself, #0) and the density
   each drawn design was solved to (additive fields). */
function densityDesignFields(d) {
  if (!d) return {};
  const out = {};
  if (d.reference) out.reference = true;
  if (d.density) Object.assign(out, { target_vf: d.density.target_vf, density_knob: d.density.knob, density_knob_value: d.density.knob_value });
  return out;
}

/* v0.24.0 — "stiffness may be inflated" flags (stiffnessFlags, 54-estimate.js) */
function stiffnessFlagFields(d) {
  if (!d || d.stiffness_flag === undefined) return {};
  return {
    stiffness_flag: d.stiffness_flag,
    void_limited_axes: d.void_limited_axes,
    under_resolved: d.under_resolved,
    stiffness_flag_reasons: d.stiffness_flag_reasons
  };
}

/* v0.24.0 — what only the GPU solver reports (additive; F13LD.ingest reads
   the export as before). Empty for CPU-solved designs, so CPU exports keep
   their exact shape. */
function gpuDesignFields(d) {
  if (!d || d.Gxy_GPa === undefined) return {};
  return {
    Gyz_GPa: d.Gyz_GPa, Gxz_GPa: d.Gxz_GPa, Gxy_GPa: d.Gxy_GPa,
    Gyz_norm: d.Gyz_norm, Gxz_norm: d.Gxz_norm, Gxy_norm: d.Gxy_norm,
    nu_xy: d.nu_xy, nu_xz: d.nu_xz, nu_yz: d.nu_yz,
    zener_A: d.zener_A,
    C_GPa: d.C_GPa,                 // full 6×6 Voigt stiffness [xx yy zz yz xz xy], GPa
    cell_aspect: d.cell_aspect,     // physical cell edges, max = 1 (stretched cells)
    island_trim_pct: d.island_trim_pct,
    island_trim_skipped_pct: d.island_trim_skipped_pct,
    thermal_converged: d.thermal_converged,
    solve_ms: d.solve_ms
  };
}

/* The design recipe for export / Export Design / F13LD.mesh handoff: the
   exact recipe the solver built (design-tool format, 40-design.js), with
   provenance in meta and the design's solver results in homogenization. */
function designRecipeOut(d, purpose) {
  const r = JSON.parse(JSON.stringify(d.recipe));
  r.meta = Object.assign({}, r.meta || {});
  /* Results export: no per-export fields in the recipe, so F13LD.ingest's
     content hash of a design stays stable. Single-design exports and the
     Mesh link carry their provenance. */
  if (purpose !== 'results-export') Object.assign(r.meta, {
    timestamp: new Date().toISOString(),
    source_design_id: d.id,
    sweep_rank: d.filterRank != null ? d.filterRank : null,
    purpose: purpose || 'export',
    context: buildAnalysisContext()
  });
  r.homogenization = perDesignHomogenization(d);
  return r;
}

function exportResults() {
  if (currentFiltered.length === 0) {
    log('warn', 'Run a sweep first, then export results.');
    return;
  }

  // v0.12.1: refuse to export when the swept results don't match the
  // currently-loaded recipe. Without this guard, loading a new recipe
  // (Grain → TPMS) would let exportResults emit the previous sweep's
  // per-design data under the new recipe's meta/base block — silent
  // contamination caught by the Grain-tagged-as-TPMS bug.
  if (sweptRecipeId !== recipeLoadId) {
    log('warn', 'Recipe was changed after the last sweep — re-run sweep before exporting.');
    return;
  }

  const payload = {
    meta: {
      exported: new Date().toISOString(),
      preset:   baseRecipe.meta?.preset || 'unknown',
      version:  baseRecipe.meta?.version || '?',
      tool:     'f13ld.sweep',
      tool_version: F13LD_SWEEP_VERSION,
      // v0.13.0: schema_version pins the EXPORT SHAPE (which fields are
      // present and what they mean), separate from tool_version which
      // tracks the app code. Bump schema_version on any field add/drop/
      // semantic change. Vault and audit tools should read schema_version
      // to know which fields to expect.
      // v0.15.0: meta.solver gained precision_mode, contrast, and split
      // cg_maxiter_fast/cg_maxiter_rigorous (replacing scalar cg_maxiter).
      // v0.16.0 (later): added resolution_picker — the user-selected base N
      // for this sweep. N_std/N_pi/N_beam remain as per-family floors; actual
      // N for each design is in design.homogenization.grid (varies by family).
      // v0.17.0: meta.solver gains rho_max_* family-specific upper bounds
      // (sheet/half/solid/pi/beam) replacing the v0.16.0 scalar RHO_MAX, and
      // rho_min_* records the relaxed noise/grain/beam floors. Pre-gate
      // logic (early VF rejection) is implementation-detail and not exported.
      // v0.18.0: meta.solver.target_profile records the rank-metric snapshot
      // used to bias jitter for this sweep run (null when no ranks selected).
      // Two sweeps of the same recipe with different rank criteria now
      // produce different design populations — this field is the audit
      // trail. Schema bump 0.16.0 → 0.17.0 reflects the new field.
      // v0.18.0 (Sweep v0.21.0): designs[].design is the exact recipe the solver
      // built (design-tool format); base is the completed loaded recipe;
      // solver/geometry versions recorded here and per design.
      // v0.19.0 (Sweep v0.24.0): GPU solver fields (shear moduli, 6×6,
      // cell aspect …) and the stiffness flags, all additive.
      schema_version: '0.19.0',
      count:    currentFiltered.length,
      solver: {
        method:   'FFT-CG',
        version:  (lastSweepSettings && lastSweepSettings.solver_version) || SOLVER_VERSION,
        stiffness_flag_void_share: STIFFNESS_FLAG_VOID_SHARE,
        // v0.24.0: GPU solver settings (absent on CPU sweeps)
        ...((lastSweepSettings && lastSweepSettings.backend === 'gpu') ? {
          backend:        'gpu',
          gpu_adapter:    lastSweepSettings.gpu_adapter,
          void_ratio:     lastSweepSettings.void_ratio,
          gpu_cg_tol:     lastSweepSettings.gpu_cg_tol,
          gpu_cg_maxiter: lastSweepSettings.gpu_cg_maxiter,
          thermal_cg_tol: lastSweepSettings.thermal_cg_tol,
          partial_volume: lastSweepSettings.partial_volume,
          island_trim:    lastSweepSettings.island_trim,
          load_cases:     6
        } : {}),
        geometry: GEOMETRY_VERSION,
        N_std:    FFT_N_STD,
        N_pi:     FFT_N_PI,
        N_beam:   FFT_N_BEAM,
        cg_tol:   CG_TOL,
        // v0.16.0: precision-mode provenance — which mode produced these
        // results and the resolved contrast / iter cap actually used.
        precision_mode:     lastSweepSettings ? lastSweepSettings.precision_mode : getPrecisionMode(),
        contrast:           lastSweepSettings ? lastSweepSettings.contrast : PRECISION_MODES[getPrecisionMode()].contrast,
        cg_maxiter_fast:    CG_MAXITER_FAST,
        cg_maxiter_rigorous: CG_MAXITER_RIGOROUS,
        // v0.16.0: user-selectable resolution. Per-design actuals are in
        // design.homogenization.grid (may be higher due to family floor).
        resolution_picker:  lastSweepSettings ? lastSweepSettings.resolution_picker : getSolverN(),
        sweep_seed:         lastSweepSettings ? lastSweepSettings.seed : null,
        // v0.26.0: how the designs were varied (families/fam-index.js) and the
        // density window each design's density was drawn from (41-density.js).
        variation:          lastSweepSettings ? (lastSweepSettings.variation || null) : null,
        spread:             lastSweepSettings ? (lastSweepSettings.spread != null ? lastSweepSettings.spread : null) : null,
        density_window:     lastSweepSettings ? (lastSweepSettings.density_window || null) : null,
        // v0.17.0: VF bounds provenance. Lower floors relaxed for
        // noise/grain/beam to admit purposefully sparse recipes; upper
        // bound split by mode topology so sheet/half/solid/pi/beam each
        // get a physically appropriate ceiling.
        rho_min: {
          std:   RHO_MIN_STD,
          pi:    RHO_MIN_PI,
          noise: RHO_MIN_NOISE,
          grain: RHO_MIN_GRAIN,
          beam:  RHO_MIN_BEAM
        },
        rho_max: {
          sheet: RHO_MAX_SHEET,
          half:  RHO_MAX_HALF,
          solid: RHO_MAX_SOLID,
          pi:    RHO_MAX_PI,
          beam:  RHO_MAX_BEAM
        },
        // v0.18.0: target-aware sampling profile snapshot. Captured at
        // sweep-start. null when no rank metrics were selected (sweep ran
        // with v0.17.0-identical uniform jitter). Includes the resolved
        // pressure vector and active rank summary for audit / reproduction.
        target_profile: (typeof lastSweepTargetProfile !== 'undefined' && lastSweepTargetProfile && lastSweepTargetProfile.has_bias)
          ? {
              summary:    lastSweepTargetProfile.summary,
              selections: lastSweepTargetProfile.selections,
              pressures:  lastSweepTargetProfile.pressures,
              anisotropy_explicit: lastSweepTargetProfile.anisotropy_explicit
            }
          : null
      }
    },
    // Analysis context — UI provenance for reproducibility (P2g). Captures
    // the domain, picked material, sigma_ref, and rank metrics that produced
    // filterRank. Without this, two exports of the same recipe under
    // different domain/material settings are byte-identical and not
    // reproducible.
    context: buildAnalysisContext(),
    family: baseFamily,
    base: (function() {
      /* Same shape as v0.20 (F13LD.ingest / validator compatibility). */
      const g = baseRecipe.geometry || {};
      const baseCommon = {
        E_solid_GPa: baseRecipe.homogenization?.E_solid_GPa || 100,
        poisson:     baseRecipe.homogenization?.poisson     || 0.3
      };
      if (baseFamily === 'beam') {
        const dims = SWEEP_FAMILIES.beam.baseDims(baseRecipe);
        return {
          ...baseCommon,
          mode:        'beam-solid',
          topology:    baseRecipe.topology?.name || 'custom',
          beam_count:  baseRecipe.topology?.beam_count || (baseRecipe.beams || []).length,
          radius:      g.radius != null ? g.radius : 0.1,
          cell:        +dims.cell.toFixed(4),
          cell_scale:  +dims.cell.toFixed(4)
        };
      }
      return {
        ...baseCommon,
        mode:             baseFamily === 'grain' ? (g.topology || 'sheet') : (g.mode || 'shell'),
        wall_thickness:   g.wall_thickness || 0.3,
        offset:           g.offset || 0.0,
        cell_scale:       g.cell_scale || 1.0,
        pi_normalize:     (g.mode === 'pi-tpms') ? !!g.pi_normalize    : null,
        shell_normalize:  (g.mode === 'shell')   ? !!g.shell_normalize : null
      };
    })(),
    designs: currentFiltered.map(d => ({
      id:             d.id,
      filterRank:     d.filterRank,
      // Browser FFT-CG estimates (N=16³ for TPMS, N=32³ for PI-TPMS)
      browser: {
        // P2h: full solver-output metric set, not domain-filtered. The
        // DOMAIN_CONFIG[d].show array drives UI table column visibility,
        // not export contents — exports always emit everything regardless
        // of which domain the user picked. Order matches the solver's
        // return shape (estimateHomogenization).
        Ex_GPa:             d.Ex_GPa,
        Ey_GPa:             d.Ey_GPa,
        Ez_GPa:             d.Ez_GPa,
        anisotropy:         d.anisotropy,                // v0.14.0: nullable
        directionality:     d.directionality,            // v0.14.0: NEW
        volume_fraction:    d.volume_fraction,
        stiffness_density:  d.stiffness_density,
        aniso_efficiency:   d.aniso_efficiency,          // v0.14.0: nullable
        // v0.14.0: axial_dominance DROPPED — replaced by directionality
        ortho_contrast:     d.ortho_contrast,
        // v0.13: load_path_eff dropped (redundant with stiffness_density).
        stiff_axis:         d.stiff_axis,
        connect_idx:        d.connect_idx,
        solver_validity:    d.solver_validity,           // v0.14.0: NEW
        cg_iters:           d.cg_iters,                  // v0.14.0: NEW
        cg_converged:       d.cg_converged,              // v0.14.0: NEW
        keff_x:             d.keff_x,
        keff_y:             d.keff_y,
        keff_z:             d.keff_z,
        thermal_anisotropy: d.thermal_anisotropy,
        k_density:          d.k_density,
        U_strain:           d.U_strain,
        microstrain_x:      d.microstrain_x,
        microstrain_y:      d.microstrain_y,
        microstrain_z:      d.microstrain_z,
        microstrain_avg:    d.microstrain_avg,
        pore_size:          d.pore_size,
        throat_size:        d.throat_size,
        throat_x: d.throat_x, throat_y: d.throat_y, throat_z: d.throat_z,
        throat_ratio:       d.throat_ratio,           // v0.13: replaces throat_efficiency
        perc_idx:           d.perc_idx,
        surface_complexity: d.surface_complexity,    // v0.13: now uncapped
        // ── v0.11: Linear-regime cap diagnostics ────────────────────
        eps_yield_um_used:  d.eps_yield_um_used,
        linear_cap_kind:    d.linear_cap_kind,
        linear_cap_active:  d.linear_cap_active,
        // ── v0.11: Normalized (geometry-only, vault-canonical) ──────
        Ex_norm:                 d.Ex_norm,
        Ey_norm:                 d.Ey_norm,
        Ez_norm:                 d.Ez_norm,
        stiffness_density_norm:  d.stiffness_density_norm,
        keff_x_norm:             d.keff_x_norm,
        keff_y_norm:             d.keff_y_norm,
        keff_z_norm:             d.keff_z_norm,
        microstrain_x_per_GPa:   d.microstrain_x_per_GPa,
        microstrain_y_per_GPa:   d.microstrain_y_per_GPa,
        microstrain_z_per_GPa:   d.microstrain_z_per_GPa,
        microstrain_avg_per_GPa: d.microstrain_avg_per_GPa,
        U_compliance:            d.U_compliance,
        pore_size_norm:          d.pore_size_norm,
        throat_size_norm:        d.throat_size_norm,
        // ── v0.12 P1 + v0.13 curvature schema ───────────────────────
        H_mean:               d.H_mean,           // v0.13: SIGNED ⟨H⟩
        H_mean_abs:           d.H_mean_abs,       // v0.13: NEW magnitude
        H_std:                d.H_std,            // v0.13: NEW raw σ(H)
        K_gauss_mean:         d.K_gauss_mean,
        curvature_uniformity: d.curvature_uniformity,  // v0.13: smooth formula
        MIH:                  d.MIH,
        euler_char:           d.euler_char,
        genus:                d.genus,
        genus_per_cell:       d.genus_per_cell,
        tortuosity_x:         d.tortuosity_x,
        tortuosity_y:         d.tortuosity_y,
        tortuosity_z:         d.tortuosity_z,
        tortuosity_nonperc:   d.tortuosity_nonperc,
        D_eff_x_norm:         d.D_eff_x_norm,
        D_eff_y_norm:         d.D_eff_y_norm,
        D_eff_z_norm:         d.D_eff_z_norm,
        perc_x:               d.perc_x,
        perc_y:               d.perc_y,
        perc_z:               d.perc_z,
        connect_x:            d.connect_x,
        connect_y:            d.connect_y,
        connect_z:            d.connect_z,
        pore_size_p10:        d.pore_size_p10,
        pore_size_p50:        d.pore_size_p50,
        pore_size_p90:        d.pore_size_p90,
        pore_size_cv:         d.pore_size_cv,
        ...stiffnessFlagFields(d),
        ...gpuDesignFields(d),
        ...densityDesignFields(d)
      },
      // The exact recipe this design was solved with (design-tool format).
      design: designRecipeOut(d, 'results-export')
    }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
  a.href     = url;
  a.download = `sweep_results_${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);

  log('success', `Exported ${currentFiltered.length} designs → ${a.download}`);
  log('info', 'Run batch_validate.py on this file to get GPU-validated stiffness values');
}
