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
  if (typeof toggleDrawer === 'function') toggleDrawer(false);   /* v0.25.0 — Run closes the Configure drawer (Matt) */

  const btn = document.getElementById('runBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  btn.disabled = true;
  setRunBtn(true);
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
  /* v0.24.0 — F13LD.lab's GPU solver when this browser has WebGPU, else the
     CPU solver. N = 64 is a GPU-only grid. */
  const gpu = await getGpuSolver();
  updateSolverStatusUI();
  if (!gpu && getSolverN() > 32) {
    log('warn', 'No GPU solver here — N = 64 is GPU-only, running at N = 32');
    setResolutionUI(32);
  }
  const gpuPrec = gpu ? GPU_PRECISION[getPrecisionMode()] : null;
  const gridN = resolveGridN(baseGeo.sweepMode);
  lastSweepSettings = null;
  const sweepSettings = {
    context: buildLiveAnalysisContext(),
    precision_mode: getPrecisionMode(), contrast: precision.contrast, maxiter: precision.maxiter,
    resolution_picker: getSolverN(), grid_N: gridN
  };
  if (gpu) Object.assign(sweepSettings, {
    backend: 'gpu', gpu_adapter: gpu.adapter, solver_version: SOLVER_VERSION_GPU,
    void_ratio: gpuPrec.voidRatio, gpu_cg_tol: gpuPrec.tol, gpu_cg_maxiter: gpuPrec.maxiter,
    thermal_cg_tol: gpuPrec.thTol, partial_volume: true, island_trim: 'networks', gpu_lanes: gpuLanesFor(gridN)
  });

  const get = id => parseFloat(document.getElementById(id).value) || 0;
  const xLo = nom * get('scaleXlo') / 100;
  const xHi = nom * get('scaleXhi') / 100;
  const yLo = nom * get('scaleYlo') / 100;
  const yHi = nom * get('scaleYhi') / 100;
  const zLo = nom * get('scaleZlo') / 100;
  const zHi = nom * get('scaleZhi') / 100;

  /* v0.26.0 — how designs are varied (41-density.js, families/fam-index.js):
     a density drawn from the window and solved for, Neighbourhood or
     Explore, one Spread for every family */
  const variation = getVariation();
  const dens = getDensityWindow();
  sweepSettings.variation = variation.mode;
  sweepSettings.spread = variation.spread;
  sweepSettings.density_window = [+dens.lo.toFixed(4), +dens.hi.toFixed(4)];
  sweepSettings.reference_design = true;

  log('accent', `Starting sweep: ${nSamples} samples + the recipe itself as the reference design`);
  log('info', `Variation: ${variation.mode === 'explore' ? 'Explore (wider redraw, fresh seeds)' : 'Neighbourhood (the recipe keeps its identity)'} · spread ±${Math.round(variation.spread * 100)} % · density ${(dens.lo * 100).toFixed(1)}–${(dens.hi * 100).toFixed(1)} % (${dens.auto ? 'Auto: recipe ± spread' : 'set by hand'})`);
  /* a window far from the recipe's own density is worth a look before 100 solves */
  if (baseDensity != null && baseDensity > 0) {
    const mid = (dens.lo + dens.hi) / 2, r = mid / baseDensity;
    if (r > 2 || r < 0.5)
      log('warn', `The density window (${(dens.lo * 100).toFixed(1)}–${(dens.hi * 100).toFixed(1)} %) is ${r > 2 ? 'over twice' : 'under half'} the recipe's own density (${(baseDensity * 100).toFixed(1)} %) — designs will be much ${r > 2 ? 'denser' : 'sparser'} than the recipe. Set the window back to Auto in Configure if that isn't intended.`);
  }
  if (fam.usesCellScale) log('info', `Cell scale X: ${xLo.toFixed(2)}→${xHi.toFixed(2)} · Y: ${yLo.toFixed(2)}→${yHi.toFixed(2)} · Z: ${zLo.toFixed(2)}→${zHi.toFixed(2)}${family === 'beam' ? ' mm' : ''}`);
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

  // "CAD vision" check at sweep time — the thinnest strut the solver will
  // see: the recipe solved to the bottom of the density window, then the
  // low end of the spread on one axis. Blocks the sweep below 1.5 voxels;
  // warns in the 1.5-2.5 voxel regime.
  if (family === 'beam') {
    let thin = baseRecipe;
    try { thin = solveDensity(baseRecipe, dens.lo).recipe; } catch (e) {}
    const check = checkBeamResolution(thin, Math.max(0.01, 1 - variation.spread));
    if (check.blocking) {
      log('warn', 'Sweep aborted — strut radius below solver resolution. Adjust recipe or jitter range and try again.');
      document.getElementById('runBtn').disabled = false;
      setRunBtn(false);
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
  const pool = getSolverPool(gpu);
  log('info', `Sampling: ${samplingMethod === 'sobol' ? 'Sobol low-discrepancy (d=8) + uniform random for jitter' : 'uniform random'} · coef normalisation: max(|c|)=1 · Workers: ${pool.nWorkers}`);
  if (gpu) log('info', `Solver: GPU (${gpu.adapter || 'WebGPU'}) · F13LD.lab elastic 6×6 + thermal · N = ${gridN} · void ${gpuPrec.voidRatio.toExponential(0)} · CG tol ${gpuPrec.tol.toExponential(0)}`);
  else if (!gpuSwitchedOff()) log('info', `Solver: CPU (${gpuSolverStatus().text.replace(/^CPU solver · /, '')}) — normal stiffness only`);
  let gpuLostLogged = false;
  const t0Sweep = performance.now();
  lastSweepGpuStats = null;
  if (gpu && gpu.resetStats) gpu.resetStats();

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
  const rejectCounts = { vf_low: 0, vf_high: 0, density_unreachable: 0, aniso_insufficient: 0, singular: 0, error: 0, unknown: 0 };

  // Build a single design spec for one attempt — main-thread Sobol+random consumed here.
  // Returns the dispatch payload that the worker will compute on.
  /* The reference design: the recipe itself, solved once before the drawn
     designs (attempt 0, id 0) — no density target, nothing varied. */
  function referenceSpec() {
    const sc = fam.usesCellScale ? recipeCellScale(baseRecipe, family) : null;
    const recipe = JSON.parse(JSON.stringify(baseRecipe));
    recipe.meta = Object.assign({}, recipe.meta || {}, {
      tool: 'f13ld.sweep', tool_version: F13LD_SWEEP_VERSION, source_preset: (baseRecipe.meta && baseRecipe.meta.preset) || null, reference: true
    });
    return {
      type: 'compute_design', attemptIdx: 0, family, recipe, reference: true,
      opts: {
        Es, nu, ks, sigma_ref, voxelToUm, eps_yield_um, linear_cap_kind,
        contrast: precision.contrast, maxiter: precision.maxiter, gridN,
        targetHints: null, scale: sc, targetVF: null
      }
    };
  }

  // Build a single design spec for one attempt — main-thread Sobol+random consumed here.
  // Returns the dispatch payload that the worker will compute on.
  function buildDesignSpec(attemptIdx) {
    const draw = sampler.next();

    /* bias moves the draw window inside the range, linearly (no pile-up at an edge) */
    const _biasDraw = (u, shift) => { const lo = Math.max(0, shift), hi = Math.min(1, 1 + shift); return lo + u * (hi - lo); };

    /* Sobol dimension 0: the density. A ρ target pressure moves the draw
       inside the window (as the axial shifts move the scale draws). */
    const targetVF = dens.lo + _biasDraw(draw.u(0), currentTargetHints?.density_shift || 0) * (dens.hi - dens.lo);

    // v0.18.0: target-aware sampling. axial_*_shift biases the scale draw
    // center by a fraction of the user-configured range (±0.10 / ±0.20 /
    // ±0.25 by pressure tier); tier 0 → no shift. Dimensions 1–3.
    const _ax = currentTargetHints?.axial_x_shift || 0;
    const _ay = currentTargetHints?.axial_y_shift || 0;
    const _az = currentTargetHints?.axial_z_shift || 0;
    const scaleX = xLo + _biasDraw(draw.u(1), _ax) * (xHi - xLo);
    const scaleY = yLo + _biasDraw(draw.u(2), _ay) * (yHi - yLo);
    const scaleZ = zLo + _biasDraw(draw.u(3), _az) * (zHi - zLo);

    /* the family's own settings take the next Sobol dimensions in its order */
    let dimNext = fam.usesCellScale ? 4 : 1;

    /* The design: a recipe in the design tool's own format (families/). */
    const recipe = fam.jitter(baseRecipe, draw, {
      mode: baseGeo.mode,
      scale: fam.usesCellScale ? [scaleX, scaleY, scaleZ] : null,
      axialShift: [_ax, _ay, _az],
      spread: variation.spread,
      explore: variation.mode === 'explore',
      u: () => draw.u(dimNext++),
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
        scale: fam.usesCellScale ? [scaleX, scaleY, scaleZ] : null,
        targetVF
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
  let refPending = true;
  function dispatchChain() {
    if (window._sweepCancelled) return Promise.resolve();
    let spec;
    if (refPending) { refPending = false; spec = referenceSpec(); }
    else {
      if (validCount >= nSamples) return Promise.resolve();
      if (attempts >= MAX_ATTEMPTS) return Promise.resolve();
      attempts++;
      spec = buildDesignSpec(attempts);
    }

    return computeDesign(pool, gpu, spec, gpuPrec).then(msg => {
      const hom = msg.hom;
      if (spec.reference && !(hom && !hom.degenerate)) {
        log('warn', `The recipe itself didn't pass the gates (${(hom && hom.reject_reason) || 'error'}) — no reference design in this sweep`);
      }
      if (hom && !hom.degenerate) {
        // Valid design — keep it (we'll assign sequential IDs after sweep ends)
        if (!spec.reference) validCount++;
        /* v0.26.0 — the worker returns the recipe with its density solved */
        const r = msg.recipe || spec.recipe, g = r.geometry || {};
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
          reference: !!spec.reference,
          density: msg.density || null,
          target_vf: msg.density ? msg.density.target_vf : null,
          terms: fam.summary(r)
        });
      } else if (!spec.reference) {
        discarded++;
        // v0.16.0: bucket by reason for end-of-sweep diagnostic
        const reason = (hom && hom.reject_reason) || 'unknown';
        rejectCounts[reason] = (rejectCounts[reason] || 0) + 1;
      }
      updateProgress();
      // Chain the next dispatch (recursion via promise — keeps the worker busy)
      return dispatchChain();
    }).catch(err => {
      if (err && err.fatal && !gpuLostLogged) {
        gpuLostLogged = true;
        log('warn', `GPU solver lost (${err.message}) — the rest of this sweep runs on the CPU solver (normal stiffness only). Re-run for consistent results.`);
      }
      log('warn', `Worker error on ${spec.reference ? 'the reference design' : 'attempt ' + spec.attemptIdx}: ${err.message}`);
      if (!spec.reference) { discarded++; rejectCounts.error++; }
      return dispatchChain();
    });
  }

  // Kick off nWorkers parallel chains. Each chain keeps its worker busy until done.
  /* GPU: a few extra chains keep the GPU lanes fed while workers prepare */
  const nChains = pool.nWorkers + (gpu ? gpuLanesFor(gridN) : 0);
  const chains = [];
  for (let i = 0; i < nChains; i++) {
    chains.push(dispatchChain());
  }
  await Promise.all(chains);

  if (window._sweepCancelled) {
    log('warn', `Sweep cancelled at ${validCount} samples — showing results so far`);
  }

  // Sort by attemptIdx and assign sequential IDs — preserves Sobol determinism
  // regardless of worker completion order. The reference design is #0.
  results.sort((a, b) => a.attemptIdx - b.attemptIdx);
  /* designs still in flight when the target was reached also finish —
     keep the first nSamples (by draw order), so the count is exact */
  const nRef = results.length && results[0].reference ? 1 : 0;
  if (results.length > nSamples + nRef) results.length = nSamples + nRef;
  results.forEach((r, i) => { r.id = i + 1 - nRef; });
  if (attempts >= MAX_ATTEMPTS && results.length < nSamples)
    log('warn', `Stopped at the attempt limit (${MAX_ATTEMPTS}): ${results.length} of ${nSamples} designs were valid. Widen the ranges or relax the filters.`);

  // final progress
  progressFill.style.width = '100%';
  progressPct.textContent = '100%';

  log('success', `${results.length - nRef} valid designs collected${nRef ? ' + the reference (#0)' : ''} · ${discarded} degenerate discarded (${attempts} attempts)`);
  const dsolve = results.filter(r => r.density && r.target_vf != null && Number.isFinite(r.volume_fraction));
  if (dsolve.length) {
    const errs = dsolve.map(r => Math.abs(r.volume_fraction / 100 - r.target_vf)).sort((a, b) => a - b);
    log('info', `  Density: designs landed a median ${(errs[Math.floor(errs.length / 2)] * 100).toFixed(1)} points from their drawn density (worst ${(errs[errs.length - 1] * 100).toFixed(1)}) · knob: ${dsolve[0].density.knob}`);
  }
  if (gpu) {
    const secs = (performance.now() - t0Sweep) / 1000;
    const solveMs = results.map(r => r.solve_ms).filter(v => v > 0);
    const med = solveMs.length ? solveMs.sort((a, b) => a - b)[Math.floor(solveMs.length / 2)] : 0;
    const unconv = results.filter(r => r.cg_converged === false).length;
    const st = gpu.stats ? gpu.stats() : null;
    const busy = st ? ` · GPU had work ${Math.round(st.busyPct)} % of the time (${st.solves} solves)` : '';
    log('info', `  GPU: ${secs.toFixed(1)} s for ${attempts} attempts · median GPU solve ${med} ms per design${busy}${unconv ? ` · ${unconv} design(s) stopped before the CG tolerance` : ''}`);
    lastSweepGpuStats = st ? Object.assign({ secs, attempts }, st) : { secs, attempts };
  }
  // v0.16.0: surface the reason breakdown when there were any discards, so
  // high discard rates can be diagnosed. Display order matches frequency at
  // typical workloads (VF caps first, then numeric edge cases, then errors).
  if (discarded > 0) {
    const labels = {
      vf_low:   'vf-lo',
      vf_high:  'vf-hi',
      density_unreachable: 'density out of reach',
      aniso_insufficient: 'near-isotropic scale',
      singular: 'singular',
      error:    'errors',
      unknown:  'unknown'
    };
    const parts = ['vf_low','vf_high','density_unreachable','aniso_insufficient','singular','error','unknown']
      .filter(k => rejectCounts[k] > 0)
      .map(k => `${labels[k]}: ${rejectCounts[k]}`);
    if (parts.length) log('info', `  Discard breakdown — ${parts.join(' · ')}`);
  }
  const totalSampled = results.length;

  if (totalSampled === 0) {
    progressWrap.classList.remove('visible');
    document.getElementById('logBadge').textContent = 'done';
    btn.disabled = false;
    setRunBtn(false);
    cancelBtn.style.display = 'none';
    window._sweepCancelled = false;
    return;
  }

  /* v0.25.0 — the stat cards became a one-line funnel above the table */
  const funnel = { attempts, valid: totalSampled - nRef, r: [] };

  // Apply filters — capture count after each rank. The reference design
  // isn't ranked out: it rejoins the final list wherever it falls.
  const refDesign = results.find(r => r.reference) || null;
  let filtered = results.filter(r => !r.reference);

  const r1Active = (document.getElementById('r1metric')?.value || 'none') !== 'none';
  const r2Active = (document.getElementById('r2metric')?.value || 'none') !== 'none';
  const r3Active = (document.getElementById('r3metric')?.value || 'none') !== 'none';

  filtered = applyRankFilter(filtered, 'r1metric', 1, null, 'sort');
  log('info', r1Active
    ? `After Rank 1 sort: ${filtered.length} designs`
    : `Rank 1: inactive — no metric selected`);
  funnel.r.push(r1Active ? filtered.length : null);

  filtered = applyRankFilter(filtered, 'r2metric', 2, 'r2keep', 'keep');
  log('info', r2Active
    ? `After Rank 2 keep top %: ${filtered.length} designs`
    : `Rank 2: inactive — no metric selected (filter skipped)`);
  funnel.r.push(r2Active ? filtered.length : null);

  filtered = applyRankFilter(filtered, 'r3metric', 3, 'r3keep', 'keep');
  log('success', r3Active
    ? `After Rank 3 keep top %: ${filtered.length} designs passed all filters`
    : `Rank 3: inactive — no metric selected (filter skipped) · ${filtered.length} designs final`);
  funnel.r.push(r3Active ? filtered.length : null);
  funnel.flagged = filtered.filter(d => d.stiffness_flag).length;
  renderFunnel(funnel);
  if (refDesign) filtered.push(refDesign);

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
    validateBtnEl.style.cursor = '';
  }

  progressWrap.classList.remove('visible');
  document.getElementById('logBadge').textContent = 'done';
  btn.disabled = false;
  setRunBtn(false);
  cancelBtn.style.display = 'none';
  window._sweepCancelled = false;
}
