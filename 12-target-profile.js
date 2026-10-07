/* ============================================================
   F13LD.sweep · 12-target-profile.js
   Target-aware sampling (v0.18.0): tier multipliers, rho pre-gates, target profile, jitter hints.
   ============================================================ */

// ─── v0.18.0: Target-aware sampling ───────────────────────────────────────────
// Translates the user's active rank metric selections into jitter biases that
// steer the sweep toward the target region of design space. This is a
// significant semantic change from v0.17.0: the same recipe + same N samples
// produces DIFFERENT generated designs depending on the active rank criteria.
//
// Three-layer architecture:
//   Layer 1 — Biased jitter (the steering wheel). Asymmetric MULT windows on
//     specific kernel knobs (halfWidth, wt, pipe_radius) and bias shifts on
//     sweep-level scale draws push ~70-80% of designs into the target zone.
//     Width of the MULT window is preserved (0.50); only the center moves by
//     ±0.10 / ±0.20 / ±0.25 depending on agreement count among rank metrics.
//   Layer 2 — Target-aware pre-gate (the safety net). Two cheap rules added
//     to the existing v0.17.0 pre-gate: (a) scale-similarity rejection for
//     anisotropy targets (param-level, no voxel build needed); (b) ρ-bound
//     tightening using already-computed solver-grid VF. Catches the 5-10%
//     of outliers Layer 1 missed. Cost: ~0ms.
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
// Default MULT [0.75, 1.25] (width 0.50) shifts to e.g. [0.50, 1.00] at
// tier -3. Window still touches the recipe value at the edge — preserves
// the "exploration around the recipe" semantics.

// Maps a pressure tier to an asymmetric MULT window.
// tier ∈ {-3, -2, -1, 0, +1, +2, +3}; sign indicates direction (low/high),
// magnitude indicates how many ranks agree on that pressure.
function multForTier(tier) {
  if (tier === 0) return null;  // null → caller uses default [0.75, 1.25]
  const shifts = { '-3': -0.25, '-2': -0.20, '-1': -0.10,
                   '+1': +0.10, '+2': +0.20, '+3': +0.25 };
  const key = tier > 0 ? '+' + tier : String(tier);
  const s = shifts[key];
  if (s == null) return null;
  return [0.75 + s, 1.25 + s];
}

// Maps a pressure tier to an additive shift for sample-from-range draws
// (used by buildDesignSpec for sweep-level scaleX/Y/Z and shell nWeights).
// Shift is a fraction of the user-configured range that the draw center moves.
function axisShiftForTier(tier) {
  if (tier === 0) return 0;
  const shifts = { '-3': -0.25, '-2': -0.20, '-1': -0.10,
                   '+1': +0.10, '+2': +0.20, '+3': +0.25 };
  const key = tier > 0 ? '+' + tier : String(tier);
  return shifts[key] || 0;
}

// Pre-gate ρ-bound factors. Multiplied into the existing pre-gate's
// (rhoMin × 0.7, RHO_MAX × 1.15) envelope for PI/noise/grain, or the
// canonical (rhoMin, RHO_MAX) for solid/shell/beam. Returns {lo, hi}
// multipliers, both 1.0 at tier=0 (byte-identical to v0.17.0 default).
function pregateRhoFactors(rho_tier) {
  if (rho_tier === 0) return { lo: 1.0, hi: 1.0 };
  if (rho_tier < 0) {
    // Want LOW VF: relax lo (admit sparser), tighten hi (reject denser)
    const t = Math.abs(rho_tier);
    return { lo: Math.max(0.5, 1.0 - 0.10 * t),
             hi: Math.max(0.6, 1.0 - 0.10 * t) };
  } else {
    // Want HIGH VF: tighten lo (reject too-sparse), slightly relax hi
    const t = rho_tier;
    return { lo: 1.0 + 0.15 * t,
             hi: 1.0 + 0.05 * t };
  }
}

// v0.18.1: Beam per-axis radius bound-shift under ρ-pressure. Shifts the
// LO or HI end of the user-configured radius range INWARD by a fraction
// of the range, biasing radius draws toward the target VF direction
// without exceeding the user's window. Matches the conservative tier
// schedule used by multForTier for noise/grain (±0.10/±0.20/±0.25).
//
// Returns {loShift, hiShift} as fractions of the user-configured range
// (hiFrac − loFrac) to subtract from each end. tier=0 → {0, 0} (v0.18.0
// behaviour for beam, identical to v0.17.0).
//
//   tier=+1 → loShift=0.10, hiShift=0  → window=[lo+0.10·w, hi]
//   tier=+2 → loShift=0.20, hiShift=0
//   tier=+3 → loShift=0.25, hiShift=0
//   tier=-1 → loShift=0,    hiShift=0.10  → window=[lo, hi-0.10·w]
//   tier=-2 → loShift=0,    hiShift=0.20
//   tier=-3 → loShift=0,    hiShift=0.25
//
// At tier=±3 the resulting window is 75% of the user's original range,
// shifted toward the favoured end. Preserves at least one boundary at
// the user's specified extreme so the recipe is still touched.
function beamRadiusBoundShift(rho_tier) {
  if (rho_tier === 0) return { loShift: 0, hiShift: 0 };
  const shifts = { 1: 0.10, 2: 0.20, 3: 0.25 };
  const mag = shifts[Math.abs(rho_tier)] || 0;
  return rho_tier > 0
    ? { loShift: mag, hiShift: 0 }   // bias UP — pull LO inward
    : { loShift: 0,   hiShift: mag };  // bias DOWN — pull HI inward
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
      case 'U_strain':
        pressures.rho += sign; break;
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

  // ρ-pressure drives multiplicative VF knobs (halfWidth in noise/grain,
  // wt in shell, pipe_radius in PI). All point the same direction —
  // higher value → higher VF → use the same MULT window for all three.
  // v0.18.1: beam_radius_bound_shift added — same ρ-tier, different
  // mechanism (shifts the bounds of the user-configured radius range
  // rather than multiplying a recipe value). Beam was deferred in
  // v0.18.0 MVP; now wired so beam sweeps respond to ρ-pressure.
  const rho_mult = multForTier(p.rho);
  const rho_factors = pregateRhoFactors(p.rho);
  const rho_beam_shift = beamRadiusBoundShift(p.rho);

  // Axial pressure shifts the corresponding sweep scale draw center.
  // When pure aniso (no specific axis) and aniso > 0, the scale_similarity
  // pre-gate rule handles diversification — no individual axis bias needed.
  return {
    halfWidth_mult: rho_mult,
    wt_mult: rho_mult,
    pipe_radius_mult: rho_mult,
    // v0.18.1: beam radius bound-shift fractions. Consumed by buildDesignSpec
    // when it resolves rXloFrac/rXhiFrac (and Y/Z) for beam mode. Null when
    // tier=0 — radius window unchanged from UI sliders in that case.
    beam_radius_bound_shift: rho_beam_shift,
    axial_x_shift: axisShiftForTier(p.axial_x),
    axial_y_shift: axisShiftForTier(p.axial_y),
    axial_z_shift: axisShiftForTier(p.axial_z),
    // Pre-gate rejection rules
    scale_similarity_floor: (profile.anisotropy_explicit && p.aniso > 0) ? 0.05 : null,
    pregate_rho_factors: rho_factors
    // Provenance for export is kept on lastSweepTargetProfile (see runSweep
    // and the meta.solver.target_profile export block), not duplicated here.
  };
}
