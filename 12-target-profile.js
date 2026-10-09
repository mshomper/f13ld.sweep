/* ============================================================
   F13LD.sweep · 12-target-profile.js
   Target-aware sampling (v0.18.0): tier shifts, target profile, jitter hints.
   ============================================================ */

// ─── v0.18.0: Target-aware sampling ───────────────────────────────────────────
// Translates the user's active rank metric selections into jitter biases that
// steer the sweep toward the target region of design space. This is a
// significant semantic change from v0.17.0: the same recipe + same N samples
// produces DIFFERENT generated designs depending on the active rank criteria.
//
// Three-layer architecture:
//   Layer 1 — Biased draws (the steering wheel). Bias shifts on the density
//     draw (v0.26.0 — it replaced the v0.18 wall / half-width / pipe-radius
//     multipliers) and on the sweep-level scale draws; the window keeps its
//     width and its center moves by ±0.10 / ±0.20 / ±0.25 depending on
//     agreement count among rank metrics.
//   Layer 2 — Target-aware pre-gate (the safety net): scale-similarity
//     rejection for anisotropy targets (param-level, no voxel build needed).
//     (v0.26.0 dropped the ρ-bound tightening — the density is drawn.)
//   Layer 3 — Existing applyRankFilter (precise post-sweep ranking, unchanged).
//
// What's NOT in v0.18.0 MVP — these stay at v0.17.0 defaults; if testing
// shows Layer 1+2 aren't steering strongly enough we'll add them in v0.18.x:
//   • frequency, isoLevel, kappa, nWaves/huN, octaves/lacunarity/gain biasing
//   • noise-internal scaleX/Y/Z biasing (only sweep-level cell scales biased)
//   • feature-size pressure (throat_size, pore_size targets get no bias)
//
// Conservative tier shifts (per Matt 2026-05-16):
//   tier ±1 (one metric agreeing):    ±0.10 center shift
//   tier ±2 (two metrics agreeing):   ±0.20 center shift
//   tier ±3 (three metrics agreeing): ±0.25 center shift
// The draw window keeps its width and slides inside the user's range, so
// one edge always stays on the range end.

// Maps a pressure tier to an additive shift for sample-from-range draws
// (buildDesignSpec: the density draw and the sweep-level scaleX/Y/Z; fam-tpms:
// shell normal-weights).
// Shift is a fraction of the user-configured range that the draw center moves.
function axisShiftForTier(tier) {
  if (tier === 0) return 0;
  const shifts = { '-3': -0.25, '-2': -0.20, '-1': -0.10,
                   '+1': +0.10, '+2': +0.20, '+3': +0.25 };
  const key = tier > 0 ? '+' + tier : String(tier);
  return shifts[key] || 0;
}

// Reads the current rank-metric selections from the DOM and builds the
// target profile — a structured representation of which geometric
// pressures the user implicitly wants the structure to lean toward.
// Pressures are summed contributions from each active rank (R1/R2/R3 all
// weighted equally per Matt 2026-05-16). Conflicting targets cancel
// toward neutral, which is the right behavior for the "compete to find
// the Pareto front" case.
function buildTargetProfile() {
  const selections = [];
  for (let i = 1; i <= 3; i++) {
    const m = document.getElementById(`r${i}metric`)?.value;
    if (m && m !== 'none') {
      selections.push({ metric: m, dir: directions[i] || 'max', rank: i });
    }
  }
  if (selections.length === 0) {
    return { has_bias: false, pressures: null, anisotropy_explicit: false,
             summary: [], selections: [] };
  }

  const pressures = { rho: 0, aniso: 0, axial_x: 0, axial_y: 0, axial_z: 0,
                      feature: 0, connect: 0 };
  let anisotropy_explicit = false;
  const summary = [];

  for (const sel of selections) {
    const sign = sel.dir === 'max' ? +1 : -1;
    const m = sel.metric;
    switch (m) {
      case 'volume_fraction':
        pressures.rho += sign; break;
      case 'stiffness_density':
      case 'k_density':
        // Per Matt's intuition: denominator dominates. MAX(E/ρ) → ρ-DOWN.
        pressures.rho -= sign; break;
      case 'anisotropy':
      case 'aniso_efficiency':
      case 'ortho_contrast':
      case 'directionality':
      case 'thermal_anisotropy':
        pressures.aniso += sign;
        anisotropy_explicit = true;
        break;
      case 'Ex_GPa': case 'keff_x':
        pressures.axial_x += sign; pressures.aniso += sign; pressures.rho += sign;
        break;
      case 'Ey_GPa': case 'keff_y':
        pressures.axial_y += sign; pressures.aniso += sign; pressures.rho += sign;
        break;
      case 'Ez_GPa': case 'keff_z':
        pressures.axial_z += sign; pressures.aniso += sign; pressures.rho += sign;
        break;
      case 'connect_idx':
      case 'perc_idx':
        pressures.connect += sign; pressures.rho += sign;
        break;
      case 'throat_size':
      case 'pore_size':
        pressures.feature -= sign; pressures.rho -= sign;
        break;
      case 'throat_ratio':
        pressures.feature -= sign;
        break;
      case 'U_strain':                       /* grows with compliance, like microstrain */
        pressures.rho -= sign; break;
      case 'microstrain_x':
        pressures.axial_x -= sign; pressures.rho -= sign; break;
      case 'microstrain_y':
        pressures.axial_y -= sign; pressures.rho -= sign; break;
      case 'microstrain_z':
        pressures.axial_z -= sign; pressures.rho -= sign; break;
      case 'microstrain_avg':
        pressures.rho -= sign; break;
    }
    summary.push(`${m}:${sel.dir}`);
  }

  // Clamp each pressure to ±3 (the highest tier we have shifts defined for).
  for (const k of Object.keys(pressures)) {
    pressures[k] = Math.max(-3, Math.min(3, pressures[k]));
  }

  const has_bias = Object.values(pressures).some(v => v !== 0);
  return { has_bias, pressures, anisotropy_explicit, summary, selections };
}

// Converts a target profile into per-parameter jitter hints. Hints are
// plain data (no functions) so they flow through worker postMessage cleanly.
// The kernel jitterParams and pre-gate consume specific fields; missing
// fields fall back to v0.17.0 default behavior.
function priorsToJitterHints(profile) {
  if (!profile || !profile.has_bias) return null;
  const p = profile.pressures;

  // v0.26.0 — ρ-pressure moves the density draw inside the density window
  // (the same tiers as the axial scale shifts). The wall / half-width /
  // pipe-radius multipliers, the beam radius bound shift and the ρ pre-gate
  // factors are gone: every design's density is now drawn and solved for
  // (41-density.js), so there is no density knob left for them to push.
  // Axial pressure shifts the corresponding sweep scale draw center.
  // When pure aniso (no specific axis) and aniso > 0, the scale_similarity
  // pre-gate rule handles diversification — no individual axis bias needed.
  return {
    density_shift: axisShiftForTier(p.rho),
    axial_x_shift: axisShiftForTier(p.axial_x),
    axial_y_shift: axisShiftForTier(p.axial_y),
    axial_z_shift: axisShiftForTier(p.axial_z),
    // Pre-gate rejection rules
    scale_similarity_floor: (profile.anisotropy_explicit && p.aniso > 0) ? 0.05 : null
    // Provenance for export is kept on lastSweepTargetProfile (see runSweep
    // and the meta.solver.target_profile export block), not duplicated here.
  };
}
