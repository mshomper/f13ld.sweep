/* ============================================================
   F13LD.sweep · 63-auto-target.js   (v0.28.0)
   Aiming a sweep at a target (13-target.js): the link from F13LD.vault,
   the Run button, and the auto rounds.

   Auto rounds (Matt, 2026-10-09):
     · each round is 25 designs at Fast precision (grid ≤ 32³), ranked by
       distance to the target;
     · between rounds Sweep re-centres on the closest unflagged design so
       far, re-fits the density trend on the last two rounds and re-aims the
       density window at the density it predicts, and resizes Spread —
       tighter after a round that got closer, wider after one that didn't;
     · two rounds without progress switch Neighbourhood to Explore (shape
       changes, not just density) — one round when the density trend says
       density alone stays well off the target; two more stop the rounds;
     · the rounds stop when every metric is within the tolerance (5 %),
       after the cap (6 rounds, 150 designs), when progress stalls, or when
       the best design is pressed against a physics limit the target is past;
     · then a final run at your own settings (count, precision, grid)
       around the best design, in a tight window. Only the final run is in
       the export; the rounds stay on the plot as a faded trail.
   Top-level code only defines things.
   ============================================================ */

/* The Run button: auto rounds when a target says so, otherwise one sweep. */
function runClick() {
  if (TARGET && TARGET.metrics.length && TARGET.auto) return runTargetSweep();
  return runSweep();
}

/* What the user had before a target took over — variation and spread (so
   the browser's saved settings, 24-drawer.js swSnapshot, keep the user's
   own) and the loaded recipe (auto rounds re-centre on their best design;
   clearing the target goes back to it). */
let TGT_HOLD = null;
function tgtHoldSettings() {
  if (TGT_HOLD) return;
  TGT_HOLD = { vary: document.getElementById('variationMode').value, spread: +document.getElementById('spreadPct').value,
    recipe: baseRecipe, density: baseDensity, meta: (document.getElementById('fileMeta') || {}).textContent || '' };
}
function tgtResetRun() { TARGET_RUN = { running: false, rounds: [], trail: [], status: '', best: null, reason: null }; }

function tgtSetVariation(mode, spread) {
  pxSet('variationMode', mode === 'explore' ? 'explore' : 'neighbourhood', 'change');
  if (spread != null) pxSet('spreadPct', Math.max(1, Math.min(90, Math.round(spread * 100))), 'input');
}
/* Density window in Set mode, lo / hi as fractions (clamped to the recipe's bounds). */
function tgtSetWindow(lo, hi) {
  const b = densityBounds();
  lo = Math.max(b.lo, Math.min(b.hi, lo)); hi = Math.max(lo, Math.min(b.hi, hi));
  if (hi - lo < 0.005) { const c = (lo + hi) / 2; lo = Math.max(b.lo, c - 0.005); hi = Math.min(b.hi, c + 0.005); }
  pxSet('vfAuto', '0', 'input');
  pxSet('vfLo', +(lo * 100).toFixed(1), 'input');
  pxSet('vfHi', +(hi * 100).toFixed(1), 'input');
  return { lo, hi };
}
/* A window of ± w (relative) around the density the trend predicts, or
   around the current recipe's own density when there is no trend yet. */
function tgtAimWindow(pool, w, T) {
  const b = densityBounds();
  const pred = pool && pool.length ? tgtPredictDensity(pool, T || TARGET, b.lo, b.hi) : null;
  let c = pred ? pred.phi : (baseDensity != null ? baseDensity : (b.lo + b.hi) / 2);
  c = Math.max(b.lo, Math.min(b.hi, c));
  w = Math.max(0.03, w);
  const win = tgtSetWindow(c * (1 - w), c * (1 + w));
  return Object.assign({ centre: c, pred }, win);
}
function tgtWarnings(T) { const b = densityBounds(); return tgtPhysics(T, b.hi, b.lo); }

/* Re-centre on a design: its exact recipe becomes the one every design
   varies (as a loaded recipe would, without clearing the page). */
function tgtRecentre(d) {
  const completed = completeRecipe(JSON.parse(JSON.stringify(d.recipe)));
  designGeometry(completed);   /* throws if it can't be built */
  baseRecipe = completed;
  try { baseDensity = densityOf(completed); } catch (e) { baseDensity = null; }
  const fam = SWEEP_FAMILIES[baseFamily];
  const meta = document.getElementById('fileMeta');
  if (meta && fam) meta.textContent = fam.describe(completed);
}

/* A new recipe loaded (20-recipe-load.js): a target from Vault named the
   design it came from, so it goes; one set here stays, without its trail. */
function tgtOnNewRecipe() {
  if (TARGET && TARGET.source) { tgtClear(true); return; }
  TGT_HOLD = null;
  tgtResetRun();
}

/* ── the link from F13LD.vault ───────────────────────────────────── */
function tgtLoadFromLink() {
  const h = location.hash || '';
  if (!/(^#|&)r=/.test(h)) return;
  if (sweepIsRunning() || TARGET_RUN.running) { log('warn', 'A recipe link arrived while a sweep is running — finish or cancel it, then reload the link.'); return; }
  const L = tgtParseHash(h);
  if (L.error) log('warn', `Link: ${escapeLog(L.error)}`);
  if (!L.recipe) return;
  const T = tgtFromLink(L.target);
  const t = L.target || {};
  const src = T && T.source;
  const name = src && src.id ? `From Vault · ${src.name || 'design'} · ${src.id}` : 'From a link';
  if (TARGET) tgtClear(true);   /* the previous link's target, whatever this one carries */
  if (!loadRecipe(L.recipe, name)) return;
  if (L.target && !T) log('warn', 'The link named a target Sweep can\'t aim at (no metric it knows) — loaded the recipe only.');
  if (!T) { updateDock(); return; }
  tgtHoldSettings();
  if (t.cell_size_mm > 0 && t.cell_size_mm <= 100) pxSet('cellSize', +(+t.cell_size_mm).toFixed(3), 'input');
  const spread = t.spread > 0 && t.spread < 1 ? t.spread : null;
  tgtSetVariation(t.variation === 'explore' ? 'explore' : 'neighbourhood', spread);
  const dn = t.density || {};
  let win = null;
  if (dn.lo > 0 && dn.hi >= dn.lo) win = tgtSetWindow(dn.lo / 100, dn.hi / 100);
  TARGET = T;
  tgtResetRun();
  log('accent', `From F13LD.vault: ${escapeLog(src.name || 'design')} (${escapeLog(src.id || '?')})` +
    (src.reason === 'reach' ? ' — picked because its density trend runs closest to the target' : src.reason === 'nearest' ? ' — the nearest unflagged design to the target' : ''));
  log('info', `Target: ${escapeLog(tgtSummary(T))} · on target within ${Math.round(T.tol * 100)} %`);
  log('info', `Set from the link (change any of it in Configure): ` +
    (win ? `density ${(win.lo * 100).toFixed(1)}–${(win.hi * 100).toFixed(1)} %${dn.predicted > 0 ? ` (the trend predicts ${(+dn.predicted).toFixed(1)} %)` : ''} · ` : '') +
    `${t.variation === 'explore' ? 'Explore' : 'Neighbourhood'}${spread ? ` ± ${Math.round(spread * 100)} %` : ''}` +
    (t.cell_size_mm > 0 ? ` · cell ${+(+t.cell_size_mm).toFixed(3)} mm` : ''));
  tgtWarnings(T).forEach(w => log('warn', `Physics: ${escapeLog(w.text)} Sweep will still run and stop at the limit.`));
  log('info', `Press Run: up to ${T.cap} rounds of ${T.roundSize} Fast designs walk toward the target, then a final run at your settings.`);
  updateDock();
  if (typeof drawPlot === 'function') drawPlot();
}

/* ── auto rounds ─────────────────────────────────────────────────── */
async function runTargetSweep() {
  if (!baseRecipe || !TARGET || TARGET_RUN.running) return;
  if (typeof toggleDrawer === 'function') toggleDrawer(false);
  tgtHoldSettings();
  /* the rounds work on a copy; the target controls are locked while they run (24-drawer.js) */
  const T = JSON.parse(JSON.stringify(TARGET));
  const user = { n: parseInt(samplesSlider.value), prec: getPrecisionMode(), N: getSolverN(), vary: getVariation() };
  const roundGrid = Math.min(user.N, 32);
  const warns = tgtWarnings(T);
  TARGET_RUN = { running: true, rounds: [], trail: [], status: '', best: null, reason: null, warnings: warns, seedId: T.source ? T.source.id : null };

  const btn = document.getElementById('runBtn'), cancelBtn = document.getElementById('cancelBtn');
  btn.disabled = true; setRunBtn(true); cancelBtn.style.display = 'block';
  window._sweepCancelled = false;
  updateDock();

  try {
    log('accent', `Auto target: up to ${T.cap} rounds of ${T.roundSize} Fast designs at ${roundGrid}³, then ${user.n} designs at your settings (${user.prec === 'fast' ? 'Fast' : 'Rigorous'} ${user.N}³)`);
    warns.forEach(w => log('warn', `Physics: ${escapeLog(w.text)} The rounds stop if the best design reaches the limit.`));

    let spread = user.vary.spread, explore = user.vary.mode === 'explore', stall = 0;
    let best = null, bestOff = Infinity, reason = null, cancelled = false, last = [], pool = [];
    for (let k = 1; k <= T.cap; k++) {
      let win;
      if (k > 1) {
        tgtSetVariation(explore ? 'explore' : 'neighbourhood', spread);
        win = tgtAimWindow(pool, spread, T);
      } else win = getDensityWindow();
      TARGET_RUN.status = `Round ${k} of up to ${T.cap}` + (best ? ` · closest ${(bestOff * 100).toFixed(1)} % off` : '');
      updateDock();
      const res = await runSweep({ samples: T.roundSize, precision: 'fast', grid: roundGrid, round: { k, cap: T.cap }, keepBusy: true });
      if (res.aborted) { reason = 'aborted'; break; }
      if (res.cancelled) { cancelled = true; reason = 'cancelled'; break; }
      const des = tgtStamp(res.results, T);
      des.forEach(d => TARGET_RUN.trail.push(Object.assign({ _round: k }, ...T.metrics.map((m, i) => ({ ['tgt_' + i]: d['tgt_' + i] })), { volume_fraction: d.volume_fraction, tgt_off: d.tgt_off })));
      pool = last.concat(des); last = des;
      const rb = tgtBest(des), prev = bestOff;
      if (rb && rb.tgt_off < bestOff) { best = rb; bestOff = rb.tgt_off; }
      const improved = !!rb && rb.tgt_off < (Number.isFinite(prev) ? prev * 0.9 : Infinity);
      TARGET_RUN.rounds.push({ k, designs: des.length, closest: rb ? +rb.tgt_off.toFixed(4) : null, best: Number.isFinite(bestOff) ? +bestOff.toFixed(4) : null,
        variation: explore ? 'explore' : 'neighbourhood', spread: +spread.toFixed(3), density_window: [+(win.lo * 100).toFixed(1), +(win.hi * 100).toFixed(1)] });
      TARGET_RUN.best = best;
      log(improved ? 'success' : 'info', `Round ${k}: ${des.length} designs · closest ${rb ? (rb.tgt_off * 100).toFixed(1) + ' % off (#' + rb.id + ')' : '— (none with every metric)'} · best so far ${Number.isFinite(bestOff) ? (bestOff * 100).toFixed(1) + ' %' : '—'}`);
      if (bestOff <= T.tol) { reason = 'on-target'; break; }
      if (tgtAtLimit(best, T, warns)) { reason = 'limit'; break; }
      if (k === T.cap) { reason = 'cap'; break; }
      if (improved) { stall = 0; spread = Math.max(0.05, spread * 0.7); }
      else { stall++; spread = Math.min(0.6, spread * 1.5); }
      /* how far density alone can get, from the designs so far */
      const reach = tgtPredictDensity(pool, T, densityBounds().lo, densityBounds().hi);
      const offTrend = !!reach && reach.residual > 3 * T.tol;
      if (stall >= (explore ? 2 : offTrend ? 1 : 2)) {
        if (!explore) {
          explore = true; stall = 0;
          log('info', offTrend
            ? `Density alone gets no closer than ${(reach.residual * 100).toFixed(0)} % off — switching to Explore so the shape can change`
            : 'Two rounds without progress — switching to Explore so the shape can change, not only the density');
        } else { reason = 'stalled'; break; }
      }
      if (best) { try { tgtRecentre(best); } catch (e) { log('warn', `Couldn't re-centre on #${best.id}: ${escapeLog(e.message)}`); } }
    }

    const why = { 'on-target': `on target (every metric within ${Math.round(T.tol * 100)} %)`, cap: `the ${T.cap}-round cap`, stalled: 'no progress in Explore either',
      limit: 'the best design reached the physics limit the target is past', cancelled: 'cancelled', aborted: 'the sweep was aborted' }[reason] || reason;
    TARGET_RUN.reason = reason;
    log(reason === 'on-target' ? 'success' : 'info', `Rounds stopped: ${why}` + (best ? ` · best ${(bestOff * 100).toFixed(1)} % off` : ''));

    if (!cancelled && reason !== 'aborted' && best) {
      try { tgtRecentre(best); } catch (e) { log('warn', `Couldn't re-centre on #${best.id}: ${escapeLog(e.message)}`); }
      const fs = Math.max(0.05, Math.min(0.15, spread));
      tgtSetVariation('neighbourhood', fs);
      const win = tgtAimWindow(pool, fs, T);
      TARGET_RUN.final = { spread: +fs.toFixed(3), density_window: [+(win.lo * 100).toFixed(1), +(win.hi * 100).toFixed(1)], seed_round_off: +bestOff.toFixed(4) };
      TARGET_RUN.status = 'Final run';
      updateDock();
      log('accent', `Final run around the best design: Neighbourhood ± ${Math.round(fs * 100)} % · density ${(win.lo * 100).toFixed(1)}–${(win.hi * 100).toFixed(1)} %`);
      /* what the export records about the rounds, fixed now (70-export.js reads lastSweepSettings) */
      const runInfo = { source: T.source || null, rounds: TARGET_RUN.rounds.slice(), stopped: reason, final: TARGET_RUN.final };
      const res = await runSweep({ samples: user.n, round: 'final', keepBusy: true, targetRun: runInfo });
      TARGET_RUN.finalDone = !res.cancelled && !res.aborted;
      if (res.cancelled) log('warn', 'Final run cancelled — the designs shown are the ones it finished; the export marks it cancelled.');
    } else if (!best && !cancelled) log('warn', 'No design in the rounds had every target metric — nothing to centre a final run on. Try other metrics or a wider density window.');
    if (cancelled) log('info', 'Rounds cancelled — round designs (Fast) are not exported. Press Run again, or set the target to One sweep.');
  } catch (e) {
    log('warn', `Auto target stopped on an error: ${escapeLog(e && e.message || String(e))}`);
    TARGET_RUN.reason = 'error';
  } finally {
    TARGET_RUN.running = false;
    TARGET_RUN.status = '';
    document.getElementById('progressWrap').classList.remove('visible');
    document.getElementById('logBadge').textContent = 'done';
    btn.disabled = !baseRecipe; setRunBtn(false); cancelBtn.style.display = 'none';
    window._sweepCancelled = false;
    updateDock();
    if (typeof drawPlot === 'function') drawPlot();
  }
}

/* ── the Settings panel's target controls (24-drawer.js paints them) ── */
function tgtLocked() { return TARGET_RUN.running; }
function tgtStartManual() {
  if (tgtLocked()) return;
  tgtHoldSettings();
  TARGET = Object.assign({}, TGT_DEFAULTS, { metrics: [{ key: '_emax', value: NaN }, { key: 'volume_fraction', value: NaN }], source: null });
  if (currentFiltered.length) {
    const d = currentFiltered[0];
    TARGET.metrics.forEach(m => { const v = tgtValue(d, m); if (v != null) m.value = +v.toPrecision(3); });
  }
  TARGET.metrics = TARGET.metrics.map(m => ({ key: m.key, value: tgtNum(m.value) ? m.value : (m.key === 'volume_fraction' ? 20 : 0.05) }));
  tgtResetRun();
  pxAfter();
  tgtRerank();
}
/* quiet: a new link or recipe is replacing it (no re-rank of the old results) */
function tgtClear(quiet) {
  if (tgtLocked()) return;
  TARGET = null;
  tgtResetRun();
  if (TGT_HOLD) {
    tgtSetVariation(TGT_HOLD.vary, TGT_HOLD.spread / 100);
    if (!quiet && TGT_HOLD.recipe && TGT_HOLD.recipe !== baseRecipe) {   /* back to the recipe that was loaded */
      baseRecipe = TGT_HOLD.recipe; baseDensity = TGT_HOLD.density;
      const meta = document.getElementById('fileMeta'); if (meta) meta.textContent = TGT_HOLD.meta;
      pxSet('vfAuto', '1', 'input'); updateDensityAuto();
      log('info', 'Target cleared — back to the loaded recipe (auto rounds had re-centred on their best design); density window back on Auto');
    }
    TGT_HOLD = null;
  }
  if (!quiet && currentFiltered.length) applyFinalRanking(currentFiltered);
  pxAfter();
  if (typeof drawPlot === 'function') drawPlot();
}
function tgtAddMetric() {
  if (!TARGET || TARGET.metrics.length >= 3 || tgtLocked()) return;
  const used = TARGET.metrics.map(m => m.key);
  const key = ['volume_fraction', '_emax', '_gmean', 'pore_size_p50_norm', 'keff_max_norm'].find(k => used.indexOf(k) < 0) || 'anisotropy';
  const d = currentFiltered[0];
  const v = d ? tgtValue(d, { key }) : null;
  TARGET.metrics.push({ key, value: v != null ? +v.toPrecision(3) : 1 });
  tgtResetRun();   /* the trail was plotted on the old metric list */
  pxAfter();
  tgtRerank();
}
function tgtRemoveMetric(i) {
  if (!TARGET || tgtLocked()) return;
  TARGET.metrics.splice(i, 1);
  if (!TARGET.metrics.length) return tgtClear();
  tgtResetRun();
  pxAfter();
  tgtRerank();
}
function tgtSetMetric(i, key) {
  if (!TARGET || !TARGET.metrics[i] || !TGT_METRICS[key] || tgtLocked()) return;
  const m = { key };
  if (TGT_METRICS[key].strain) m.scale = tgtLocalStrainScale();
  const d = currentFiltered[0], v = d ? tgtValue(d, m) : null;
  m.value = v != null ? +v.toPrecision(3) : TARGET.metrics[i].value;
  TARGET.metrics[i] = m;
  tgtResetRun();
  pxAfter();
  tgtRerank();
}
/* Strain picked here (not from Vault) is under Sweep's own reference stress
   and material: με = 1000 / (E / Es) × σ [MPa] / Es [GPa]. */
function tgtLocalStrainScale() {
  try {
    const mat = getSolverMaterial(), s = getSigmaRef() ?? mat.Es * 0.0001;
    return s * 1000 / mat.Es;
  } catch (e) { return 1; }
}
/* After a manual change, re-rank what is on screen. */
function tgtRerank() {
  if (currentFiltered.length) applyFinalRanking(currentFiltered);
  if (typeof drawPlot === 'function') drawPlot();
}
