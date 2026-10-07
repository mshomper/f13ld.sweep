/* ============================================================
   F13LD.sweep · 62-run-sweep.js
   runSweep / cancelSweep.
   ============================================================ */

// ─── Sweep ────────────────────────────────────────────────────────────────────
function cancelSweep() {
  window._sweepCancelled = true;
}

async function runSweep() {
  if (!baseRecipe) return;

  const btn = document.getElementById('runBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';
  cancelBtn.style.display = 'block';
  window._sweepCancelled = false;
  results = [];
  invalidateSolverCaches(); // main-thread cache (kept for any in-process calls)

  // Workers carry their own caches — invalidate them too so this sweep starts clean
  // (different material may mean different Es/nu/ks → different Gamma).
  // Actual cache invalidation in workers happens lazily via getElasticGamma's keying.

  const nSamples = parseInt(samplesSlider.value);
  const nom = baseRecipe.geometry.cell_scale || 1.0;
  const mat = getSolverMaterial();
  const Es = mat.Es;
  const nu = mat.nu;
  const ks = mat.ks;
  const eps_yield_um    = mat.eps_yield_um;
  const linear_cap_kind = mat.linear_cap_kind;
  const sigma_ref = getSigmaRef() ?? Es * 0.0001;
  const voxelToUm = getVoxelToUm();

  const get = id => parseFloat(document.getElementById(id).value) || 0;
  const xLo = nom * get('scaleXlo') / 100;
  const xHi = nom * get('scaleXhi') / 100;
  const yLo = nom * get('scaleYlo') / 100;
  const yHi = nom * get('scaleYhi') / 100;
  const zLo = nom * get('scaleZlo') / 100;
  const zHi = nom * get('scaleZhi') / 100;

  // Beam family: per-axis strut radius variation reuses the cell scale lo/hi
  // bounds, applied as fractions of the recipe's base radius. The user
  // configures one set of variation ranges (the existing scaleXlo/hi etc.)
  // and they apply to BOTH cell scale and strut radius independently per
  // axis. Anisotropy is always on — each axis draws independently — which
  // is the whole point of having per-axis sweep variables; isotropy
  // would be a degenerate special case the user can get by setting all
  // three axes' lo/hi to the same numbers. Non-beam families ignore these
  // values (their kernel.jitterParams contracts don't reference them).
  const rXloFrac = get('scaleXlo') / 100;
  const rXhiFrac = get('scaleXhi') / 100;
  const rYloFrac = get('scaleYlo') / 100;
  const rYhiFrac = get('scaleYhi') / 100;
  const rZloFrac = get('scaleZlo') / 100;
  const rZhiFrac = get('scaleZhi') / 100;

  log('accent', `Starting sweep: ${nSamples} samples`);
  log('info', `Periodicity X: ${xLo.toFixed(2)}→${xHi.toFixed(2)} · Y: ${yLo.toFixed(2)}→${yHi.toFixed(2)} · Z: ${zLo.toFixed(2)}→${zHi.toFixed(2)}`);

  // v0.18.0: target-aware sampling. Snapshot the active rank metrics at
  // sweep-start time and translate into per-parameter jitter hints. The
  // profile is captured ONCE — a mid-sweep change to rank dropdowns won't
  // poison this run (next sweep picks up the new criteria on its first
  // dispatch). Same snapshotting discipline as precision_mode in v0.16.0.
  // When no rank metrics are selected, currentTargetProfile.has_bias is
  // false and currentTargetHints is null — sweep behavior is byte-identical
  // to v0.17.0 in that case.
  // The profile is also stashed on a module-scope variable so the export
  // can include it in meta.solver.target_profile without re-querying the
  // DOM (which may have changed since sweep start).
  const currentTargetProfile = buildTargetProfile();
  const currentTargetHints   = priorsToJitterHints(currentTargetProfile);
  lastSweepTargetProfile = currentTargetProfile;
  if (currentTargetProfile.has_bias) {
    const p = currentTargetProfile.pressures;
    const tierStr = (label, v) => v === 0 ? null : `${label}:${v > 0 ? '+' : ''}${v}`;
    const tiers = [
      tierStr('ρ', p.rho), tierStr('aniso', p.aniso),
      tierStr('axX', p.axial_x), tierStr('axY', p.axial_y), tierStr('axZ', p.axial_z),
      tierStr('connect', p.connect), tierStr('feature', p.feature)
    ].filter(x => x).join(' · ');
    log('info', `Target-aware sampling: ${currentTargetProfile.summary.join(', ')} → ${tiers || 'no net pressure'}`);
    if (currentTargetHints?.scale_similarity_floor) {
      log('info', `Pre-gate: rejecting near-isotropic scale draws (xyz within ${(currentTargetHints.scale_similarity_floor * 100).toFixed(0)}%)`);
    }
  }

  const progressWrap = document.getElementById('progressWrap');
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const progressPct = document.getElementById('progressPct');
  progressWrap.classList.add('visible');
  document.getElementById('logBadge').textContent = 'running';

  // Family + parsed params — resolved once per sweep. Reuses loadFile's
  // _params if present (avoids a second prepass on noise/grain recipes);
  // otherwise re-parses from the recipe. Family inference mirrors loadFile.
  let family = baseRecipe.family;
  if (!family) {
    const stype = baseRecipe.surface && baseRecipe.surface.type;
    const ftype = baseRecipe.field && baseRecipe.field.type;
    if      (Array.isArray(baseRecipe.beams))                  family = 'beam';
    else if (stype === 'noise')                                family = 'noise';
    else if (stype === 'terms' || stype === 'raw_preset')      family = 'tpms';
    else if (ftype === 'spinodoid' || ftype === 'gaussian'
          || ftype === 'hyperuniform')                         family = 'grain';
    else if (ftype === 'reactiondiffusion')                    family = 'grain';
    else                                                       family = 'tpms';
  }
  const kernel = KERNELS[family];
  if (!kernel) {
    log('warn', `Unknown family "${family}" — sweep aborted`);
    document.getElementById('runBtn').disabled = false;
    document.getElementById('runBtn').textContent = '▶ Run Sweep';
    return;
  }

  // "CAD vision" check at sweep time — uses the actual jitter-low fraction
  // since that's the worst-case strut diameter the solver will see. If the
  // user picked lo=50%, a 0.03mm base radius becomes 0.015mm — less than
  // half a voxel at N=32. This check blocks the sweep entirely in that
  // regime; in the borderline 1.5-2.5 voxel regime it warns but proceeds.
  if (family === 'beam') {
    const loFrac = Math.min(rXloFrac, rYloFrac, rZloFrac);
    const check = checkBeamResolution(baseRecipe, loFrac);
    if (check.blocking) {
      log('warn', 'Sweep aborted — strut radius below solver resolution. Adjust recipe or jitter range and try again.');
      document.getElementById('runBtn').disabled = false;
      document.getElementById('runBtn').textContent = '▶ Run Sweep';
      document.getElementById('progressWrap').classList.remove('visible');
      return;
    }
  }
  const baseParams = baseRecipe._params || kernel.parseRecipe(baseRecipe);

  // Sweep mode — TPMS uses 'solid'/'shell'/'pi-tpms' directly; noise modes
  // get prefixed to 'noise-sheet'/'noise-half'/'noise-solid' for applyMode
  // dispatch (avoids collision with TPMS's 'solid'). The prefix is internal
  // to the sweep tool — the recipe's geometry.mode stays canonical.
  // Noise tool also exports 'shell' as a synonym for 'sheet' in some paths
  // (legacy mode naming), so we map both to noise-sheet for the noise family.
  //
  // Grain mirrors the noise pattern: prefix to 'grain-sheet'/'grain-half'/
  // 'grain-solid'. Grain recipes use geometry.topology (not geometry.mode)
  // since that's the field name F13LD.grain exports.
  let sweepMode = (family === 'grain')
    ? (baseRecipe.geometry?.topology || 'sheet')
    : (family === 'beam')
    ? 'beam-solid'
    : (baseRecipe.geometry?.mode || 'solid');
  if (family === 'noise') {
    if      (sweepMode === 'sheet' || sweepMode === 'shell') sweepMode = 'noise-sheet';
    else if (sweepMode === 'half')                           sweepMode = 'noise-half';
    else if (sweepMode === 'solid')                          sweepMode = 'noise-solid';
  } else if (family === 'grain') {
    if      (sweepMode === 'sheet')  sweepMode = 'grain-sheet';
    else if (sweepMode === 'half')   sweepMode = 'grain-half';
    else if (sweepMode === 'solid')  sweepMode = 'grain-solid';
  }
  const sweepWall = baseRecipe.geometry?.wall_thickness || 0.3;

  // Sampling method — Sobol low-discrepancy gives better coverage than uniform
  // random at small N. Falls through to Math.random() for high-D jitter.
  const samplingMethod = document.getElementById('samplingMethod')?.value || 'sobol';
  const sampler = makeSampler(samplingMethod, 8);

  // Solver pool — created lazily and reused across sweeps
  const pool = getSolverPool();
  log('info', `Sampling: ${samplingMethod === 'sobol' ? 'Sobol low-discrepancy (d=8) + uniform random for jitter' : 'uniform random'} · coef normalisation: max(|c|)=1 · Workers: ${pool.nWorkers}`);

  let attempts = 0;
  const MAX_ATTEMPTS = nSamples * 20; // safety cap — never spin forever
  let validCount = 0;
  let discarded = 0;
  // v0.16.0: per-reason discard counters. Categories come from
  // estimateHomogenization's reject_reason field; 'error' is added by the
  // dispatch chain's catch block. Surfaced at end of sweep so the user can
  // diagnose high discard rates (e.g. VF caps tripping for thin-wall sweeps).
  // v0.18.0: aniso_insufficient added — target-aware pre-gate rejects
  // near-isotropic scale draws when anisotropy is an explicit MAX target.
  const rejectCounts = { vf_low: 0, vf_high: 0, aniso_insufficient: 0, singular: 0, error: 0, unknown: 0 };

  // Build a single design spec for one attempt — main-thread Sobol+random consumed here.
  // Returns the dispatch payload that the worker will compute on.
  function buildDesignSpec(attemptIdx) {
    const draw = sampler.next();

    // v0.18.0: target-aware sampling. axial_*_shift biases the scale draw
    // center by a fraction of the user-configured range. tier-0 (no axial
    // pressure) gives shift=0 and behavior identical to v0.17.0. The shift
    // is clamped within [0, 1] for the draw so we don't sample outside the
    // user's range — biasing moves the distribution within the range, not
    // beyond it. Bias amount: ±0.10 / ±0.20 / ±0.25 by pressure tier.
    const _ax = currentTargetHints?.axial_x_shift || 0;
    const _ay = currentTargetHints?.axial_y_shift || 0;
    const _az = currentTargetHints?.axial_z_shift || 0;
    const _biasDraw = (u, shift) => Math.max(0, Math.min(1, u + shift));
    const scaleX = xLo + _biasDraw(draw.u(0), _ax) * (xHi - xLo);
    const scaleY = yLo + _biasDraw(draw.u(1), _ay) * (yHi - yLo);
    const scaleZ = zLo + _biasDraw(draw.u(2), _az) * (zHi - zLo);

    // Family-specific parameter jitter — extracted into the kernel in E1.
    // For TPMS: trig swap + frequency jitter + max(|c|)=1 normalisation.
    // Sobol dims 4..7 supply the per-term coefficient draws; the kernel reads
    // them via draw.u(coefDimOffset + i). Math.random() handles high-frequency
    // noise (trig swap, freq jitter, overflow coefs) — call order matches v0.8
    // byte-for-byte under seeded RNG (Pass 1 equivalence test).
    //
    // v0.13.2: pass `mode` so TPMS jitter can adapt knobs per mode. PI-TPMS
    // gets a conservative knob set (no per-term phase, no term mask, no sign
    // flip, freq=1 only) since the v0.13.1 broad knobs produce disconnected
    // pipe topologies and sub-voxel features at typical PI-TPMS resolution.
    // Solid/shell get the full v0.13.1 knob set.
    //
    // E4: beam family reads rXloFrac/rXhiFrac etc. for per-axis radius
    // draws (Sobol dims 3..5). Other families ignore those args.
    //
    // v0.18.0: targetHints flows into kernel.jitterParams so kernel-internal
    // knobs (halfWidth in noise/grain) can use the asymmetric MULT window.
    //
    // v0.18.1: beam family now also responds to ρ-pressure. The user-
    // configured rXloFrac/rXhiFrac range is shifted inward by
    // beam_radius_bound_shift fractions BEFORE being passed to BeamKernel.
    // For ρ-UP (tier > 0): LO shifts inward, draws bias toward thicker
    // struts. For ρ-DOWN (tier < 0): HI shifts inward, draws bias toward
    // thinner struts. tier=0 → byte-identical to v0.18.0 (no shift).
    // This is the Layer-1 lever that was missing in v0.18.0 MVP for beam.
    const _bShift = currentTargetHints?.beam_radius_bound_shift;
    const _applyBeamShift = (lo, hi) => {
      if (!_bShift || (_bShift.loShift === 0 && _bShift.hiShift === 0)) return [lo, hi];
      const w = hi - lo;
      return [lo + _bShift.loShift * w, hi - _bShift.hiShift * w];
    };
    const [_rXlo, _rXhi] = _applyBeamShift(rXloFrac, rXhiFrac);
    const [_rYlo, _rYhi] = _applyBeamShift(rYloFrac, rYhiFrac);
    const [_rZlo, _rZhi] = _applyBeamShift(rZloFrac, rZhiFrac);

    const jittered = kernel.jitterParams(baseParams, draw, {
      mode: sweepMode,
      rXloFrac: _rXlo, rXhiFrac: _rXhi,
      rYloFrac: _rYlo, rYhiFrac: _rYhi,
      rZloFrac: _rZlo, rZhiFrac: _rZhi,
      sobolDimOffset: 3,
      targetHints: currentTargetHints
    });

    let offset = 0, nWeights = null, sweepPipeR = null, sweepPhaseShift = null;
    // v0.16.0: per-design wall-thickness jitter. Defaults to the recipe's
    // sweepWall value (used as-is by non-shell modes). Shell mode below
    // overrides with base × [0.7, 1.3] for sheet-thickness exploration
    // alongside the directional nWeights jitter.
    let designWall = sweepWall;

    if (sweepMode === 'pi-tpms') {
      const basePipeR = baseRecipe.geometry?.pipe_radius || 0.1;
      // v0.18.0: pipe_radius MULT window shifts under ρ-pressure. Default
      // [0.6, 1.4] preserved when no hints. Hint window is the same [0.50,1.00]
      // ... [1.00, 1.50] structure used for halfWidth in noise/grain.
      const _pipeMult = currentTargetHints?.pipe_radius_mult;
      const _pipeLo = _pipeMult ? _pipeMult[0] * 0.857 : 0.6;  // map [0.75,1.25]→[0.6,1.4]
      const _pipeWidth = 0.8;
      sweepPipeR = +Math.max(0.02, Math.min(0.35,
        basePipeR * (_pipeLo + draw.u(3) * _pipeWidth))).toFixed(3);
      const EIGHTHS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
      let px, py, pz;
      do {
        px = EIGHTHS[Math.floor(Math.random() * EIGHTHS.length)];
        py = EIGHTHS[Math.floor(Math.random() * EIGHTHS.length)];
        pz = EIGHTHS[Math.floor(Math.random() * EIGHTHS.length)];
      } while (px === 0 && py === 0 && pz === 0);
      sweepPhaseShift = { x: px, y: py, z: pz };
    } else if (sweepMode === 'shell') {
      offset = baseRecipe.geometry.offset;
      // v0.16.0: tightened nWeights range from [0.20, 3.00] → [0.40, 1.60].
      // Previous range allowed local wt = nominal × 3 after mean=1 normalization,
      // pushing per-axis wall thickness to ~3× the recipe value and routinely
      // producing VF > 0.85. The new range caps max anisotropy ratio at 4×
      // (1.60/0.40), still plenty for sheet anisotropy exploration but well
      // inside the regime where designs are physically meaningful sheets
      // rather than collapsed near-solids.
      // v0.18.0: nWeights per-axis sample center shifts by axial_*_shift,
      // biasing wall thickness toward the target stiffness axis. Range
      // width unchanged. shift=0 (no axial pressure) → behavior identical
      // to v0.17.0. nWeights still mean-normalized below, so per-axis bias
      // translates into a directional weighting of the recipe wall thickness.
      const _nwShift = 1.20;  // range width (constant)
      const rx = (0.40 + _ax * 1.20) + draw.u(3)   * _nwShift;
      const ry = (0.40 + _ay * 1.20) + Math.random() * _nwShift;
      const rz = (0.40 + _az * 1.20) + Math.random() * _nwShift;
      const mean = (rx + ry + rz) / 3;
      nWeights = { wx: rx/mean, wy: ry/mean, wz: rz/mean };
      // v0.16.0: jitter wall thickness ±30% around the recipe value. This is
      // the only TPMS lever besides nWeights that directly controls VF
      // independent of the field topology. Math.random is fine here — single
      // scalar parallel to the ry/rz pattern above; Sobol coverage of the
      // 8 high-value design dimensions is preserved.
      // Worst-case local wt: designWall × max(nWeights) ≈ wt × 1.30 × 2.0 = wt × 2.6
      // (down from wt × 3.0 in v0.15.0 with the old nWeights range and no wt jitter).
      // v0.18.0: wt MULT window shifts under ρ-pressure. Default [0.70, 1.30]
      // preserved when no hints. Same window structure as halfWidth/pipe_radius.
      const _wtMult = currentTargetHints?.wt_mult;
      const _wtLo = _wtMult ? _wtMult[0] - 0.05 : 0.70;  // map [0.75,1.25]→[0.70,1.30]
      const _wtWidth = 0.60;
      designWall = +(sweepWall * (_wtLo + Math.random() * _wtWidth)).toFixed(3);
    } else if (sweepMode === 'noise-sheet'  || sweepMode === 'noise-half'  || sweepMode === 'noise-solid'
            || sweepMode === 'grain-sheet'  || sweepMode === 'grain-half'  || sweepMode === 'grain-solid') {
      // Noise/grain: jitter is fully self-contained in kernel.jitterParams
      // above (frequency, isoLevel, halfWidth, type-specific params). No
      // additional sweep-level shape parameters — offset/nWeights/pipeR/
      // phaseShift stay at their null/zero defaults.
    } else if (sweepMode === 'beam-solid') {
      // Beam: per-axis radius jitter happens inside kernel.jitterParams
      // (which baked the rXmm/rYmm/rZmm fields and per-strut r_eff into
      // the returned params). No offset, no nWeights, no pipeR, no
      // phaseShift — beam mode threshold-at-zero needs none of them.
    } else {
      // Solid TPMS — offset jitter
      offset = baseRecipe.geometry.offset + (draw.u(3) - 0.5) * 0.4;
    }

    const baseline = { ...baseRecipe.homogenization, cell_scale: nom };

    // TPMS field-normalization flags (round-tripped from F13LD.tpms exports).
    // Read at ingest time and defaulted to false; passed through to the
    // solver worker which forwards them to estimateHomogenization. Other
    // families ignore — flags are no-ops for non-TPMS modes.
    const piNorm    = !!(baseRecipe.geometry && baseRecipe.geometry.pi_normalize);
    const shellNorm = !!(baseRecipe.geometry && baseRecipe.geometry.shell_normalize);

    return {
      type: 'compute_design',
      attemptIdx,
      // Family + opaque kernel params — workers pass these through to the kernel
      family,
      params: jittered,
      // Sample parameters (round-tripped through worker for result aggregation)
      offset, scaleX, scaleY, scaleZ,
      // v0.16.0: sweepWall is now per-design (jittered ±30% in shell mode;
      // unchanged from recipe value in other modes). designWall holds the
      // resolved value.
      sweepMode, sweepWall: designWall, nWeights, sweepPipeR, sweepPhaseShift,
      // TPMS field-normalization flags
      piNorm, shellNorm,
      // Solver inputs
      Es, nu, ks, baseline, sigma_ref, voxelToUm, cellMult: nom,
      // v0.11: linear-regime cap (material-specific yield/fracture strain)
      eps_yield_um, linear_cap_kind,
      // v0.16.0: precision mode → contrast / maxiter resolution. Snapshotted
      // at spec-build time so a mid-sweep toggle change doesn't poison the
      // run (next sweep picks up the new mode on its first dispatch).
      contrast: PRECISION_MODES[getPrecisionMode()].contrast,
      maxiter:  PRECISION_MODES[getPrecisionMode()].maxiter,
      // v0.16.0: solver grid resolution. Picker (16 or 32) with per-mode
      // floor (PI-TPMS / beam always ≥32). Resolved here so the worker
      // doesn't need to know about picker state — it just runs the N it's
      // told.
      gridN:    resolveGridN(sweepMode),
      // v0.18.0: target-aware sampling hints. Forwarded to the worker so
      // estimateHomogenization's pre-gate can apply scale-similarity and
      // ρ-bound rejection rules. Null when no rank metrics are selected
      // (sweep behavior identical to v0.17.0 in that case).
      targetHints: currentTargetHints
    };
  }

  // Update progress UI — called as results arrive
  function updateProgress() {
    const pctValid    = validCount / nSamples * 100;
    const pctAttempts = attempts / MAX_ATTEMPTS * 100;
    const pct = Math.min(99, Math.round(Math.max(pctValid, pctAttempts)));
    progressFill.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    const discardRate = attempts > 0 ? Math.round(discarded / attempts * 100) : 0;
    progressLabel.textContent = `Valid: ${validCount} / ${nSamples} · discarded: ${discarded} (${discardRate}%)`;
  }

  // Continuous-dispatch chain: each result triggers the next dispatch from the same worker.
  // Returns a promise that resolves when this worker's chain hits a stop condition
  // (target reached / cancelled / attempt budget exhausted).
  function dispatchChain() {
    if (validCount >= nSamples) return Promise.resolve();
    if (attempts >= MAX_ATTEMPTS) return Promise.resolve();
    if (window._sweepCancelled) return Promise.resolve();

    attempts++;
    const spec = buildDesignSpec(attempts);

    return pool.dispatch(spec).then(msg => {
      const hom = msg.hom;
      if (hom && !hom.degenerate) {
        // Valid design — keep it (we'll assign sequential IDs after sweep ends)
        validCount++;
        // Family-aware result row.
        // - terms (string): short human-readable summary for the table cell
        // - termObjects (TPMS-only): full term/factor structure for the
        //   preview shader and F13LD.mesh handoff. Noise consumers read
        //   from params instead, which is always carried through.
        // - params: the kernel's opaque payload, family-shaped. Always present.
        const familyTerms = spec.params.terms || [];
        let termsSummary, termObjects;
        if (spec.family === 'noise') {
          const p = spec.params;
          // e.g. "simplex@f0.43 [1.2,0.8,1.5] iso=-0.15 hw=0.18"
          termsSummary = `${p.noiseType}@f${p.frequency} [${p.scaleX},${p.scaleY},${p.scaleZ}] iso=${p.isoLevel} hw=${p.halfWidth}`;
          termObjects = null; // noise has no term/factor structure
        } else if (spec.family === 'grain') {
          const p = spec.params;
          if (p.fieldType === 'spinodoid') {
            termsSummary = `spin N=${p.nWaves} κ=${(p.kappa).toFixed(1)} f=${p.frequency} iso=${p.isoLevel} hw=${p.halfWidth}`;
          } else if (p.fieldType === 'gaussian') {
            termsSummary = `grf σ=${p.grfSigma} N=${p.nWaves} f=${p.frequency} iso=${p.isoLevel} hw=${p.halfWidth}`;
          } else {
            termsSummary = `hu N=${p.huN} a=${(p.huAspect).toFixed(1)} w=${p.huWidth} iso=${p.isoLevel} hw=${p.halfWidth}`;
          }
          termObjects = null; // grain has no term/factor structure
        } else if (spec.family === 'beam') {
          const p = spec.params;
          // e.g. "octet · 36 struts · r=[0.08, 0.12, 0.10] k=0.05 b=0.08"
          // k and ball appended only when non-zero (most designs have them
          // both, since lo=0 in the jitter draw, but the zero case shows
          // up explicitly to make the comparison obvious).
          let extras = '';
          if (p.nodeSmoothKmm > 0) extras += ` k=${p.nodeSmoothKmm}`;
          if (p.nodeBallRmm   > 0) extras += ` b=${p.nodeBallRmm}`;
          termsSummary = `${p.topology} · ${p.beamCount} struts · r=[${p.rXmm}, ${p.rYmm}, ${p.rZmm}]${extras}`;
          termObjects = null; // beam has no term/factor structure
        } else {
          termsSummary = familyTerms.map(t => t.factors.map(f => f.trig[0]).join('')).join('|');
          termObjects = familyTerms.map(t => ({...t, factors: t.factors.map(f => ({...f}))}));
        }
        results.push({
          attemptIdx: spec.attemptIdx,
          family: spec.family,
          params: spec.params,
          scaleX: +spec.scaleX.toFixed(3),
          scaleY: +spec.scaleY.toFixed(3),
          scaleZ: +spec.scaleZ.toFixed(3),
          offset: +spec.offset.toFixed(3),
          nTerms: familyTerms.length,
          nWeights: spec.nWeights ? { wx: +spec.nWeights.wx.toFixed(4), wy: +spec.nWeights.wy.toFixed(4), wz: +spec.nWeights.wz.toFixed(4) } : null,
          // v0.16.0: per-design wall thickness for shell mode. Records the
          // jittered value actually used by the solver (parallel to nWeights
          // and pipe_radius). Null for modes that don't use wt (solid, PI,
          // noise, grain, beam) so vault analytics can filter cleanly.
          wall_thickness: (spec.sweepMode === 'shell') ? spec.sweepWall : null,
          pipe_radius: spec.sweepPipeR,
          phase_shift: spec.sweepPhaseShift,
          ...hom,
          terms: termsSummary,
          termObjects: termObjects
        });
      } else {
        discarded++;
        // v0.16.0: bucket by reason for end-of-sweep diagnostic
        const reason = (hom && hom.reject_reason) || 'unknown';
        rejectCounts[reason] = (rejectCounts[reason] || 0) + 1;
      }
      updateProgress();
      // Chain the next dispatch (recursion via promise — keeps the worker busy)
      return dispatchChain();
    }).catch(err => {
      log('warn', `Worker error on attempt ${spec.attemptIdx}: ${err.message}`);
      discarded++;
      rejectCounts.error++;
      return dispatchChain();
    });
  }

  // Kick off nWorkers parallel chains. Each chain keeps its worker busy until done.
  const chains = [];
  for (let i = 0; i < pool.nWorkers; i++) {
    chains.push(dispatchChain());
  }
  await Promise.all(chains);

  if (window._sweepCancelled) {
    log('warn', `Sweep cancelled at ${validCount} samples — showing results so far`);
  }

  // Sort by attemptIdx and assign sequential IDs — preserves Sobol determinism
  // regardless of worker completion order.
  results.sort((a, b) => a.attemptIdx - b.attemptIdx);
  results.forEach((r, i) => { r.id = i + 1; });

  // Phase 1.3 follow-up: for beam family, compute the max mean-scale across
  // results so every design's preview renders at a proportional cube
  // extent. Designs with the biggest cell fill the cube; smaller cells
  // leave visible margin — the eye reads "this one is 60% of the size of
  // the biggest." Non-beam families ignore this value.
  if (family === 'beam' && results.length > 0) {
    let maxMean = 0;
    let maxPad = 0;
    for (const r of results) {
      const m = (r.scaleX + r.scaleY + r.scaleZ) / 3;
      if (m > maxMean) maxMean = m;
      // Phase 1.4: pad envelope across the sweep. Each design's geometry
      // extends past the cell boundary by (rMaxLocal + nodeBallRLocal).
      // The cube must accommodate the worst case across the whole sweep
      // so every design frames consistently — proportional sizing comes
      // from the wireframe overlay position, not the cube extent itself.
      const rPad = (r.params?.rMaxLocal || 0) + (r.params?.nodeBallRLocal || 0);
      if (rPad > maxPad) maxPad = rPad;
    }
    beamCubeMaxScale = maxMean > 0 ? maxMean : 1.0;
    beamCubePadGlobal = Math.max(0.10, maxPad + 0.05);
  }

  // final progress
  progressFill.style.width = '100%';
  progressPct.textContent = '100%';

  log('success', `${results.length} valid designs collected · ${discarded} degenerate discarded (${attempts} attempts)`);
  // v0.16.0: surface the reason breakdown when there were any discards, so
  // high discard rates can be diagnosed. Display order matches frequency at
  // typical workloads (VF caps first, then numeric edge cases, then errors).
  if (discarded > 0) {
    const labels = {
      vf_low:   'vf-lo',
      vf_high:  'vf-hi',
      singular: 'singular',
      error:    'errors',
      unknown:  'unknown'
    };
    const parts = ['vf_low','vf_high','singular','error','unknown']
      .filter(k => rejectCounts[k] > 0)
      .map(k => `${labels[k]}: ${rejectCounts[k]}`);
    if (parts.length) log('info', `  Discard breakdown — ${parts.join(' · ')}`);
  }
  const totalSampled = results.length;

  if (totalSampled === 0) {
    progressWrap.classList.remove('visible');
    document.getElementById('logBadge').textContent = 'done';
    btn.disabled = false;
    btn.textContent = '▶ Run Sweep';
    cancelBtn.style.display = 'none';
    window._sweepCancelled = false;
    return;
  }

  document.getElementById('statSampled').textContent = totalSampled;

  const pctOf = (n) => `${Math.round(n / totalSampled * 100)}% of total`;

  // Apply filters — capture count after each rank
  let filtered = [...results];

  const r1Active = (document.getElementById('r1metric')?.value || 'none') !== 'none';
  const r2Active = (document.getElementById('r2metric')?.value || 'none') !== 'none';
  const r3Active = (document.getElementById('r3metric')?.value || 'none') !== 'none';

  filtered = applyRankFilter(filtered, 'r1metric', 1, null, 'sort');
  log('info', r1Active
    ? `After Rank 1 sort: ${filtered.length} designs`
    : `Rank 1: inactive — no metric selected`);
  document.getElementById('statRank1').textContent = filtered.length;
  document.getElementById('statRank1Pct').textContent = pctOf(filtered.length);

  filtered = applyRankFilter(filtered, 'r2metric', 2, 'r2keep', 'keep');
  log('info', r2Active
    ? `After Rank 2 keep top %: ${filtered.length} designs`
    : `Rank 2: inactive — no metric selected (filter skipped)`);
  document.getElementById('statRank2').textContent = filtered.length;
  document.getElementById('statRank2Pct').textContent = pctOf(filtered.length);

  filtered = applyRankFilter(filtered, 'r3metric', 3, 'r3keep', 'keep');
  log('success', r3Active
    ? `After Rank 3 keep top %: ${filtered.length} designs passed all filters`
    : `Rank 3: inactive — no metric selected (filter skipped) · ${filtered.length} designs final`);
  document.getElementById('statRank3').textContent = filtered.length;
  document.getElementById('statRank3Pct').textContent = pctOf(filtered.length);

  // Peak values for rank filter cards
  function setPeakCard(valId, labelId, subId, metricKey, dir, data) {
    const label = METRIC_LABELS[metricKey] || metricKey;
    const disabled = !metricKey || metricKey === 'none';
    document.getElementById(labelId).textContent = disabled ? '—' : `Peak ${label}`;
    if (disabled || data.length === 0) {
      document.getElementById(valId).textContent = '—';
      document.getElementById(subId).textContent = 'no filter chosen';
      return;
    }
    const vals = data.map(d => typeof d[metricKey] === 'number' ? d[metricKey] : null).filter(v => v !== null);
    if (vals.length === 0) { document.getElementById(valId).textContent = '—'; return; }
    const peak = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
    const fmt = peak >= 1000 ? Math.round(peak).toString()
               : peak >= 10  ? peak.toFixed(1)
               : peak.toFixed(2);
    const suffix = metricKey === 'volume_fraction' ? '%' : metricKey === 'anisotropy' ? '×' : '';
    document.getElementById(valId).textContent = fmt + suffix;
    document.getElementById(subId).textContent = dir === 'min' ? '▼ min' : '▲ max';
  }

  const r1key = document.getElementById('r1metric')?.value;
  const r2key = document.getElementById('r2metric')?.value;
  const r3key = document.getElementById('r3metric')?.value;
  setPeakCard('statPeakR1','statPeakR1Label','statPeakR1Sub', r1key, directions[1]||'max', filtered);
  setPeakCard('statPeakR2','statPeakR2Label','statPeakR2Sub', r2key, directions[2]||'max', filtered);
  setPeakCard('statPeakR3','statPeakR3Label','statPeakR3Sub', r3key, directions[3]||'max', filtered);

  // Store reference for rank mode switching, then apply final ranking
  currentFiltered = filtered;
  applyFinalRanking(filtered);

  // v0.12.1: stamp the recipe identity that produced these results.
  // exportResults uses this to refuse exports when the recipe has been
  // swapped underneath without a re-sweep.
  sweptRecipeId = recipeLoadId;
  // Re-enable export buttons now that fresh results exist
  const validateBtnEl = document.getElementById('validateBtn');
  if (validateBtnEl) {
    validateBtnEl.disabled = false;
    validateBtnEl.style.opacity = '';
    validateBtnEl.style.cursor = 'pointer';
  }

  progressWrap.classList.remove('visible');
  document.getElementById('logBadge').textContent = 'done';
  btn.disabled = false;
  btn.textContent = '▶ Run Sweep';
  cancelBtn.style.display = 'none';
  window._sweepCancelled = false;
}
