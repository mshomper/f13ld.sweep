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
  const family = baseFamily;
  const fam = SWEEP_FAMILIES[family];
  const baseGeo = designGeometry(baseRecipe);
  const nom = fam.nominalScale(baseRecipe);
  const mat = getSolverMaterial();
  const Es = mat.Es;
  const nu = mat.nu;
  const ks = mat.ks;
  const eps_yield_um    = mat.eps_yield_um;
  const linear_cap_kind = mat.linear_cap_kind;
  const sigma_ref = getSigmaRef() ?? Es * 0.0001;
  const voxelToUm = getVoxelToUm();
  /* Solver settings are fixed for the whole sweep (a toggle mid-sweep
     applies to the next one). */
  const precision = PRECISION_MODES[getPrecisionMode()];
  const gridN = resolveGridN(baseGeo.sweepMode);
  lastSweepSettings = null;
  const sweepSettings = {
    context: buildLiveAnalysisContext(),
    precision_mode: getPrecisionMode(), contrast: precision.contrast, maxiter: precision.maxiter,
    resolution_picker: getSolverN(), grid_N: gridN
  };

  const get = id => parseFloat(document.getElementById(id).value) || 0;
  const xLo = nom * get('scaleXlo') / 100;
  const xHi = nom * get('scaleXhi') / 100;
  const yLo = nom * get('scaleYlo') / 100;
  const yHi = nom * get('scaleYhi') / 100;
  const zLo = nom * get('scaleZlo') / 100;
  const zHi = nom * get('scaleZhi') / 100;

  // Beam: per-axis strut radius variation reuses the cell-scale % ranges,
  // applied to the recipe's radius (independently per axis).
  const rXloFrac = get('scaleXlo') / 100;
  const rXhiFrac = get('scaleXhi') / 100;
  const rYloFrac = get('scaleYlo') / 100;
  const rYhiFrac = get('scaleYhi') / 100;
  const rZloFrac = get('scaleZlo') / 100;
  const rZhiFrac = get('scaleZhi') / 100;

  log('accent', `Starting sweep: ${nSamples} samples`);
  if (fam.usesCellScale) log('info', `Cell scale X: ${xLo.toFixed(2)}→${xHi.toFixed(2)} · Y: ${yLo.toFixed(2)}→${yHi.toFixed(2)} · Z: ${zLo.toFixed(2)}→${zHi.toFixed(2)}${family === 'beam' ? ' mm (strut radius uses the same % range)' : ''}`);
  else log('info', `Cell scale: not part of ${fam.label} recipes — the field's own settings are swept instead`);

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

  // Sampling method — Sobol low-discrepancy gives better coverage than uniform
  // random at small N. Falls through to Math.random() for high-D jitter.
  const samplingMethod = document.getElementById('samplingMethod')?.value || 'sobol';
  /* One seed per sweep: the same seed and settings draw the same designs. */
  const seed = (Math.random() * 4294967296) >>> 0;
  const rand = makeRng(seed);
  sweepSettings.seed = seed;
  const sampler = makeSampler(samplingMethod, 8, rand);

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
    /* bias moves the draw window inside the range, linearly (no pile-up at an edge) */
    const _biasDraw = (u, shift) => { const lo = Math.max(0, shift), hi = Math.min(1, 1 + shift); return lo + u * (hi - lo); };
    const scaleX = xLo + _biasDraw(draw.u(0), _ax) * (xHi - xLo);
    const scaleY = yLo + _biasDraw(draw.u(1), _ay) * (yHi - yLo);
    const scaleZ = zLo + _biasDraw(draw.u(2), _az) * (zHi - zLo);

    // Beam strut radius range: under ρ-pressure (target-aware sampling) the
    // configured range is shifted inward — ρ-up biases toward thicker struts,
    // ρ-down toward thinner. Tier 0 → no shift.
    const _bShift = currentTargetHints?.beam_radius_bound_shift;
    const _applyBeamShift = (lo, hi) => {
      if (!_bShift || (_bShift.loShift === 0 && _bShift.hiShift === 0)) return [lo, hi];
      const w = hi - lo;
      return [lo + _bShift.loShift * w, hi - _bShift.hiShift * w];
    };
    const [_rXlo, _rXhi] = _applyBeamShift(rXloFrac, rXhiFrac);
    const [_rYlo, _rYhi] = _applyBeamShift(rYloFrac, rYhiFrac);
    const [_rZlo, _rZhi] = _applyBeamShift(rZloFrac, rZhiFrac);

    /* The design: a recipe in the design tool's own format (families/). */
    const recipe = fam.jitter(baseRecipe, draw, {
      mode: baseGeo.mode,
      scale: fam.usesCellScale ? [scaleX, scaleY, scaleZ] : null,
      axialShift: [_ax, _ay, _az],
      radiusFrac: { x: [_rXlo, _rXhi], y: [_rYlo, _rYhi], z: [_rZlo, _rZhi] },
      targetHints: currentTargetHints,
      rand
    });
    recipe.meta = Object.assign({}, recipe.meta || {}, {
      tool: 'f13ld.sweep', tool_version: F13LD_SWEEP_VERSION, source_preset: (baseRecipe.meta && baseRecipe.meta.preset) || null
    });
    return {
      type: 'compute_design',
      attemptIdx,
      family,
      recipe,
      opts: {
        Es, nu, ks, sigma_ref, voxelToUm, eps_yield_um, linear_cap_kind,
        contrast: precision.contrast, maxiter: precision.maxiter, gridN,
        targetHints: currentTargetHints,
        scale: fam.usesCellScale ? [scaleX, scaleY, scaleZ] : null
      }
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
        const r = spec.recipe, g = r.geometry || {};
        const sc = recipeCellScale(r, family);
        results.push({
          attemptIdx: spec.attemptIdx,
          family,
          recipe: r,
          scaleX: +sc[0].toFixed(3), scaleY: +sc[1].toFixed(3), scaleZ: +sc[2].toFixed(3),
          /* TPMS shape knobs, for the table and analytics (null when unused) */
          offset: (family === 'tpms' && g.offset != null) ? g.offset : null,
          wall_thickness: (family === 'tpms' && g.mode === 'shell') ? g.wall_thickness : null,
          pipe_radius: (family === 'tpms' && g.mode === 'pi-tpms') ? g.pipe_radius : null,
          phase_shift: (family === 'tpms' && g.mode === 'pi-tpms') ? g.phase_shift : null,
          nWeights: g.normal_weights || null,
          nTerms: family === 'tpms' ? r.surface.terms.filter(t => t.factors.length).length : 0,
          ...hom,
          terms: fam.summary(r)
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
  /* designs still in flight when the target was reached also finish —
     keep the first nSamples (by draw order), so the count is exact */
  if (results.length > nSamples) results.length = nSamples;
  results.forEach((r, i) => { r.id = i + 1; });
  if (attempts >= MAX_ATTEMPTS && results.length < nSamples)
    log('warn', `Stopped at the attempt limit (${MAX_ATTEMPTS}): ${results.length} of ${nSamples} designs were valid. Widen the ranges or relax the filters.`);

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
      aniso_insufficient: 'near-isotropic scale',
      singular: 'singular',
      error:    'errors',
      unknown:  'unknown'
    };
    const parts = ['vf_low','vf_high','aniso_insufficient','singular','error','unknown']
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

  lastSweepSettings = sweepSettings;
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
