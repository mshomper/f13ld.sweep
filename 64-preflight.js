/* ============================================================
   F13LD.sweep · 64-preflight.js   (v0.31.0)
   Preflight (Matt, 2026-10-11): before a long sweep, check whether the
   solver settings can hold the thinnest designs the sweep will draw.

   · Starts on its own when a recipe loads, and again shortly after any
     setting the flags depend on changes (grid, Fast / Rigorous, material,
     density window, variation, spread, cell scale ranges). It runs on the
     sweep's own workers and GPU (computeDesign), so the page stays live.
   · Test designs ("probes"): the recipe at the bottom of the density
     window, built by the family's own jitter with every varied setting at
     the middle, one end and the other end of Spread, plus the most
     stretched cell scale corner. Same grid, precision and material as the
     run, so a probe is flagged exactly when a sweep design would be
     (stiffnessFlags, 54-estimate.js).
   · When a probe flags, two fixes are worked out in the background: the
     lowest density floor where the flagged probes clear at the current
     grid (bisection), and the first finer grid where they clear.
   · Nothing shows until Run. Then: all clear → the run starts; still
     checking → Run reads "Preflight" for the few seconds left; issues →
     the popup. Apply sets the fix and runs; Ignore runs as is; Back to
     settings (only when no fix exists) doesn't run. The popup has no
     close button — it must be answered (Matt).
   · Not exported (Matt): the stiffness flags and solver grid already in
     the export are enough to filter by. `window.SWEEP_PREFLIGHT = false`
     or `?preflight=0` switches it off (the harness does).
   Top-level code only defines things and adds document listeners.
   ============================================================ */

const PF_SETTLE_MS = 900;       /* after the last settings change */
const PF_FLOOR_STEPS = 4;       /* bisection steps for the density floor */
const PF_STRETCH_MIN = 1.15;    /* a corner this much more stretched than the middle gets its own probe */
let PF = { sig: null, coreSig: null, state: 'idle', promise: null, result: null, gen: 0,
           ignored: null, floor: 0, gating: false, _geoFor: null, _geo: null, _hashFor: null, _hash: null };
let _pfTimer = null;

function preflightOff() {
  if (typeof window === 'undefined' || window.SWEEP_PREFLIGHT === false) return true;
  try { return new URLSearchParams(location.search).get('preflight') === '0'; } catch (e) { return false; }
}
/* the density floor Preflight set, for the target rounds (63-auto-target.js tgtSetWindow) */
function preflightFloor() { return PF.floor || 0; }

function pfHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/* ── what the flags depend on ─────────────────────────────────────── */
async function pfContext() {
  if (!baseRecipe || !SWEEP_FAMILIES[baseFamily]) return null;
  const gpu = await getGpuSolver();
  const family = baseFamily, fam = SWEEP_FAMILIES[family];
  if (PF._geoFor !== baseRecipe) { PF._geo = designGeometry(baseRecipe); PF._geoFor = baseRecipe; }
  if (PF._hashFor !== baseRecipe) { PF._hash = pfHash(JSON.stringify(baseRecipe)); PF._hashFor = baseRecipe; }
  const geo = PF._geo;
  const precMode = getPrecisionMode(), pick = getSolverN();
  /* as runSweep: N = 64 is GPU-only, the CPU solver runs it at 32 */
  const gridN = resolveGridNFor(geo.sweepMode, gpu ? pick : Math.min(32, pick));
  const mat = getSolverMaterial();
  const dens = getDensityWindow(), variation = getVariation();
  const nom = fam.nominalScale(baseRecipe);
  const get = id => parseFloat((document.getElementById(id) || {}).value) || 0;
  const sc = fam.usesCellScale ? ['X', 'Y', 'Z'].map(a => {
    const lo = nom * get('scale' + a + 'lo') / 100, hi = nom * get('scale' + a + 'hi') / 100;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }) : null;
  const S = { family, mode: geo.sweepMode, geoMode: geo.mode, precMode, pick, gridN, gpu: !!gpu, gpuClient: gpu,
              mat, dens, variation, sc, voxelToUm: getVoxelToUm(), sigma_ref: getSigmaRef() ?? mat.Es * 0.0001 };
  S.coreSig = pfHash(JSON.stringify([recipeLoadId, PF._hash, family, precMode, gridN, S.gpu,
    mat.Es, mat.nu, mat.ks, variation, sc, S.voxelToUm]));
  S.sig = S.coreSig + ':' + dens.lo.toFixed(4) + '-' + dens.hi.toFixed(4);
  return S;
}

/* ── the test designs ─────────────────────────────────────────────── */
function pfProbes(S) {
  const mid = S.sc ? S.sc.map(r => (r[0] + r[1]) / 2) : null;
  const P = [
    { key: 'mid',  u: [0.50, 0.50], scale: mid, label: 'the recipe’s own shape' },
    { key: 'low',  u: [0.02, 0.98], scale: mid, label: 'shape varied one way' },
    { key: 'high', u: [0.98, 0.02], scale: mid, label: 'shape varied the other way' }
  ];
  if (S.sc) {
    const ratio = s => Math.max(...s) / Math.max(1e-9, Math.min(...s));
    let best = null, bestR = ratio(mid);
    for (let c = 0; c < 8; c++) {
      const s = S.sc.map((r, i) => r[(c >> i) & 1]), q = ratio(s);
      if (q > bestR * 1.0001) { best = s; bestR = q; }
    }
    if (best && bestR >= ratio(mid) * PF_STRETCH_MIN) P.push({ key: 'stretch', u: [0.50, 0.50], scale: best, label: 'the most stretched cell' });
  }
  /* each probe's recipe is fixed once (seeded), so re-solving it at another
     density or grid tests the same design */
  /* the varied settings alternate between the two ends of Spread: one value
     for all of them would only rescale the design (TPMS coefficients and
     normal weights are normalised), not change its shape */
  const fam = SWEEP_FAMILIES[S.family];
  P.forEach((p, i) => {
    const rand = makeRng((0x5EED0 + i * 7919) >>> 0);
    let k = 0;
    const recipe = fam.jitter(baseRecipe, null, {
      mode: S.geoMode, scale: p.scale, axialShift: [0, 0, 0],
      spread: S.variation.spread, explore: S.variation.mode === 'explore',
      u: () => p.u[(k++) & 1], targetHints: null, rand
    });
    recipe.meta = Object.assign({}, recipe.meta || {}, { tool: 'f13ld.sweep', tool_version: F13LD_SWEEP_VERSION, preflight: p.key });
    p.recipe = recipe;
    p.idx = i;
  });
  return P;
}

function pfSpec(S, p, vf, gridN) {
  const prec = PRECISION_MODES[S.precMode];
  return {
    type: 'compute_design', attemptIdx: -1 - p.idx, family: S.family,
    recipe: JSON.parse(JSON.stringify(p.recipe)), wantSlice: true,
    opts: {
      Es: S.mat.Es, nu: S.mat.nu, ks: S.mat.ks, sigma_ref: S.sigma_ref, voxelToUm: S.voxelToUm,
      eps_yield_um: S.mat.eps_yield_um, linear_cap_kind: S.mat.linear_cap_kind,
      contrast: prec.contrast, maxiter: prec.maxiter, gridN,
      targetHints: null, scale: p.scale, targetVF: vf
    }
  };
}

/* One probe at one density and grid → what Preflight reads from it. The
   reason texts come from stiffnessFlags (54-estimate.js) — keep these
   patterns in step with its wording. */
async function pfSolve(S, pool, p, vf, gridN) {
  const t0 = performance.now();
  let msg;
  try { msg = await computeDesign(pool, S.gpuClient, pfSpec(S, p, vf, gridN), S.gpu ? GPU_PRECISION[S.precMode] : null); }
  catch (e) { return { built: false, error: true, reason: e.message, ms: performance.now() - t0, vf, gridN }; }
  const ms = performance.now() - t0, hom = msg.hom;
  if (!hom || hom.degenerate) return { built: false, reason: hom ? hom.reject_reason : 'error', ms, vf, gridN };
  const issues = [];
  if (hom.void_limited_axes) {
    const vr = S.gpu ? GPU_PRECISION[S.precMode].voidRatio : PRECISION_MODES[S.precMode].contrast;
    const rho = (hom.volume_fraction || 0) / 100;
    let share = 0;
    for (const a of hom.void_limited_axes) {
      const e = hom['E' + a + '_GPa'];
      if (e > 0) share = Math.max(share, vr * S.mat.Es * (1 - rho) / e);
    }
    issues.push(`Pores carry about ${Math.round(share * 100)} % of the stiffness on ${hom.void_limited_axes.split('').join(', ')}`);
  }
  const why = hom.stiffness_flag_reasons || '';
  let m;
  if ((m = /connects differently from the metrics grid on ([xyz, ]+)/.exec(why))) issues.push(`Load path breaks on ${m[1].replace(/[ ,]/g, '').split('').join(', ')} at ${gridN}³`);
  if ((m = /solid fraction is (\d+) % off/.exec(why))) issues.push(`Solid fraction ${m[1]} % off at ${gridN}³`);
  if ((m = /broke into pieces on the solver grid \((\d+) %/.exec(why))) issues.push(`Thin walls broke into pieces (${m[1]} % of the solid)`);
  if (hom.stiffness_flag && !issues.length) issues.push('Stiffness may be inflated');
  return { built: true, flagged: !!hom.stiffness_flag, issues, E: [hom.Ex_GPa, hom.Ey_GPa, hom.Ez_GPa], ms, vf: (hom.volume_fraction || 0) / 100, gridN, slice: msg.slice || null };
}

/* The broken-load-path check: an axis the recipe's own design carries load
   on (S.expect, solved on the finest grid) reads zero stiffness here — the
   solid doesn't connect across the cell. The sweep keeps such a design
   without a stiffness flag, so Preflight adds this one itself. */
function pfJudge(S, r) {
  if (!r.built || !S.expect) return r;
  const E = { x: r.E[0], y: r.E[1], z: r.E[2] };
  const broken = S.expect.filter(a => !(E[a] > 0));
  if (!broken.length) return r;
  const old = r.issues.find(t => /^Load path breaks/.test(t));
  const prev = old ? old.replace(/^Load path breaks on /, '').replace(/ at .*$/, '').split(', ') : [];
  const all = [...new Set(broken.concat(prev))].sort();
  const issues = r.issues.filter(t => t !== old && t !== 'Stiffness may be inflated');
  issues.unshift(`Load path breaks on ${all.join(', ')} at ${r.gridN}³`);
  return Object.assign({}, r, { flagged: true, issues });
}

/* a flagged probe passes when it clears, or when it can't be built there
   (the sweep would discard it, not flag it) — a worker error never passes */
const pfPasses = r => !r.error && !(r.built && r.flagged);

async function pfRun(S, gen) {
  const pool = getSolverPool(S.gpuClient);
  const stale = () => { if (gen !== PF.gen) throw { stale: true }; };
  const probes = pfProbes(S);
  /* what the recipe itself connects, on the finest grid this solver has:
     the axes every probe should carry load on */
  const fine = resolveGridNFor(S.mode, Math.max(S.gridN, S.gpu ? 64 : 32));
  const ref = { idx: probes.length, key: 'reference', recipe: JSON.parse(JSON.stringify(baseRecipe)),
                scale: S.sc ? recipeCellScale(baseRecipe, S.family) : null };
  const [base, ...solved] = await Promise.all([pfSolve(S, pool, ref, null, fine)]
    .concat(probes.map(p => pfSolve(S, pool, p, S.dens.lo, S.gridN))));
  stale();
  S.expect = base.built ? ['x', 'y', 'z'].filter((a, i) => base.E[i] > 0) : [];
  if (!S.expect.length) S.expect = ['x', 'y', 'z'];
  const res = solved.map(r => pfJudge(S, r));
  probes.forEach((p, i) => { p.res = res[i]; });
  const flagged = probes.filter(p => p.res.built && p.res.flagged);
  const R = { S, probes, flagged: flagged.length, built: probes.filter(p => p.res.built).length, floorFix: null, gridFix: null };
  if (!flagged.length) return R;

  const testAt = async (vf, n) => {
    const r = (await Promise.all(flagged.map(p => pfSolve(S, pool, p, vf, n)))).map(x => pfJudge(S, x));
    stale();
    return { pass: r.every(pfPasses), ms: r.reduce((s, x) => s + x.ms, 0) / r.length };
  };

  /* density floor at the current grid — the default fix (Matt: the grid
     was likely picked for speed) */
  const lo = S.dens.lo, hi = S.dens.hi;
  if (hi - lo >= 0.005 && (await testAt(hi, S.gridN)).pass) {
    let a = lo, b = hi;
    for (let k = 0; k < PF_FLOOR_STEPS; k++) {
      const m = (a + b) / 2;
      if ((await testAt(m, S.gridN)).pass) b = m; else a = m;
    }
    const floor = Math.min(hi, Math.ceil(b * 200 - 1e-9) / 200);   /* up to the next 0.5 % */
    if (floor > lo + 1e-4) R.floorFix = { floor, lo, hi };
  }

  /* a finer grid at the current floor; the time against the same probes on
     the current grid, solved the same way (the first pass shared the
     workers with the reference design, so its times read long) */
  let ms0 = null;
  for (const n of [16, 32, 64]) {
    if (n <= S.pick || (n > 32 && !S.gpu)) continue;
    const N = resolveGridNFor(S.mode, n);
    if (N <= S.gridN) continue;
    if (ms0 == null) ms0 = (await testAt(lo, S.gridN)).ms;
    const t = await testAt(lo, N);
    if (t.pass) { R.gridFix = { pick: n, N, slower: ms0 > 0 ? t.ms / ms0 : null }; break; }
  }
  return R;
}

function pfStart(S) {
  const gen = ++PF.gen;
  PF.sig = S.sig; PF.coreSig = S.coreSig; PF.state = 'running'; PF.result = null;
  PF.promise = pfRun(S, gen).then(R => {
    if (gen !== PF.gen) return null;
    PF.state = 'done'; PF.result = R; pfLog(R);
    return R;
  }).catch(e => {
    if (gen !== PF.gen || (e && e.stale)) return null;
    PF.state = 'done';
    PF.result = { error: (e && e.message) || String(e), S };
    log('warn', `Preflight couldn't finish (${escapeLog(PF.result.error)}) — Run goes ahead without it`);
    return PF.result;
  });
  return PF.promise;
}

const pfPct = v => (v * 100).toFixed(1);
const pfPrecTxt = S => (S.precMode === 'fast' ? 'Fast' : 'Rigorous');
function pfLog(R) {
  const S = R.S, n = R.probes.length;
  if (!R.built) { log('info', `Preflight: none of the ${n} test designs could be built at the density floor (${pfPct(S.dens.lo)} %) — nothing to check`); return; }
  if (!R.flagged) { log('info', `Preflight: ${R.built} test designs at the density floor (${pfPct(S.dens.lo)} %) clear on ${S.gridN}³ ${pfPrecTxt(S)}`); return; }
  const fixes = [];
  if (R.floorFix) fixes.push(`density floor ${pfPct(R.floorFix.floor)} %`);
  if (R.gridFix) fixes.push(`${R.gridFix.N}³ grid`);
  log('warn', `Preflight: ${R.flagged} of ${n} test designs would be flagged on ${S.gridN}³ ${pfPrecTxt(S)}` +
    (fixes.length ? ` — fix ready (${fixes.join(' or ')}); you'll be asked when you press Run` : ' — no quick fix found; you’ll be asked when you press Run'));
}

/* ── starting it ──────────────────────────────────────────────────── */
function preflightKick(delay) {
  if (preflightOff()) return;
  clearTimeout(_pfTimer);
  _pfTimer = setTimeout(() => { pfCheck().catch(e => console.warn('[preflight]', e)); }, delay);
}
async function pfCheck() {
  if (!baseRecipe || PF.gating || sweepIsRunning() || (typeof TARGET_RUN !== 'undefined' && TARGET_RUN.running)) return;
  const S = await pfContext();
  if (!S) return;
  /* the floor Preflight set goes when other settings change, or when the
     window is set below it by hand */
  if ((PF.coreSig && PF.coreSig !== S.coreSig) || S.dens.lo < PF.floor - 1e-6) PF.floor = 0;
  if (PF.sig === S.sig && PF.state !== 'idle') return;
  pfStart(S);
}
/* 20-recipe-load.js, after a recipe loads */
function preflightOnRecipe() {
  PF.floor = 0; PF.ignored = null;
  preflightKick(300);
}
function pfOnUi(e) {
  if (!baseRecipe || preflightOff()) return;
  if (e && e.target && e.target.closest && e.target.closest('.pf-overlay')) return;
  preflightKick(PF_SETTLE_MS);
}
if (typeof document !== 'undefined') ['input', 'change', 'click'].forEach(t => document.addEventListener(t, pfOnUi, true));

/* ── Run ──────────────────────────────────────────────────────────── */
function pfRunBtnChecking(on) {
  const b = document.getElementById('runBtn');
  if (!b) return;
  b.disabled = !!on;
  b.classList.toggle('running', !!on);
  b.innerHTML = on ? SWEEP_RUN_BUSY.replace('<span>Running</span>', '<span>Preflight</span>') : SWEEP_RUN_IDLE;
}

/* 63-auto-target.js runClick → preflightGate(the run) */
async function preflightGate(run) {
  if (preflightOff() || !baseRecipe) return run();
  if (PF.gating) return;
  PF.gating = true;
  let go = null;
  try {
    clearTimeout(_pfTimer);
    const S = await pfContext();
    if (!S) { go = run; return; }
    if ((PF.coreSig && PF.coreSig !== S.coreSig) || S.dens.lo < PF.floor - 1e-6) PF.floor = 0;
    let R;
    if (PF.sig === S.sig && PF.state === 'done') R = PF.result;
    else {
      if (!(PF.sig === S.sig && PF.state === 'running')) pfStart(S);
      pfRunBtnChecking(true);
      try { R = await PF.promise; } finally { pfRunBtnChecking(false); }
    }
    if (!R || R.error || !R.flagged || PF.ignored === S.sig) { go = run; return; }
    const b = document.getElementById('runBtn');
    if (b) b.disabled = true;
    const choice = await pfPopup(R);
    if (b) b.disabled = !baseRecipe;
    if (choice === 'back') { log('info', 'Preflight: back to settings — nothing was run'); return; }
    if (choice === 'ignore') {
      PF.ignored = S.sig;
      log('info', `Preflight: ignored — running on ${S.gridN}³ with the density floor at ${pfPct(S.dens.lo)} % as set.`);
      go = run; return;
    }
    pfApply(R, choice);
    go = run;
  } finally {
    PF.gating = false;
    if (go) go();
  }
}

function pfApply(R, choice) {
  const S = R.S;
  if (choice === 'floor' && R.floorFix) {
    const f = R.floorFix.floor;
    PF.floor = f;
    pxSet('vfAuto', '0', 'input');
    pxSet('vfLo', +(f * 100).toFixed(1), 'input');
    if (getDensityWindow().hi < f) pxSet('vfHi', +(f * 100).toFixed(1), 'input');
    if (typeof pxAfter === 'function') pxAfter();
    log('accent', `Preflight: density floor raised to ${pfPct(f)} % (was ${pfPct(S.dens.lo)} %) — the window is now set by hand${typeof TARGET !== 'undefined' && TARGET && TARGET.auto ? '; the target rounds stay above it too' : ''}`);
  } else if (choice === 'grid' && R.gridFix) {
    setResolutionUI(R.gridFix.pick);
    if (typeof pxAfter === 'function') pxAfter();
    log('accent', `Preflight: solver grid set to ${R.gridFix.N}³ (was ${S.gridN}³)`);
  }
  /* the fix was tested — don't check these settings again before this run */
  pfContext().then(S2 => { if (S2) { PF.sig = S2.sig; PF.coreSig = S2.coreSig; PF.state = 'done'; PF.result = { S: S2, probes: [], flagged: 0, built: 0, applied: true }; PF.gen++; } });
}

/* ── the popup ────────────────────────────────────────────────────── */
function pfSliceCanvas(sl) {
  const c = document.createElement('canvas');
  c.className = 'pf-slice';
  if (!sl || !sl.data || !sl.N) { c.width = c.height = 1; c.classList.add('none'); return c; }
  const N = sl.N;
  c.width = N; c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  const VOID = [10, 12, 20], SOLID = [184, 184, 208], PART = [227, 155, 74];
  for (let i = 0; i < N * N; i++) {
    const v = sl.data[i] / 255;
    let col;
    if (v >= 0.98) col = SOLID;
    else if (v <= 0.02) col = VOID;
    else col = PART.map((x, k) => Math.round(VOID[k] + (x - VOID[k]) * (0.35 + 0.65 * v)));
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function pfEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* → Promise of 'floor' | 'grid' | 'ignore' | 'back' */
function pfPopup(R) {
  return new Promise(resolve => {
    const S = R.S, n = R.probes.length;
    const ov = pfEl('div', 'pf-overlay');
    const card = pfEl('div', 'pf-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'pfTitle');

    const head = pfEl('div', 'pf-head');
    const ico = pfEl('span', 'ico ico-lg pf-ico');
    ico.innerHTML = swIcon('preflight');
    const ht = pfEl('div', 'pf-ht');
    const title = pfEl('div', 'pf-title', 'Preflight found issues with your solver settings');
    title.id = 'pfTitle';
    ht.appendChild(title);
    const bad = R.probes.filter(p => p.res.built && p.res.flagged);
    const breaks = bad.some(p => p.res.issues.some(t => /^Load path breaks/.test(t)));
    const stiff = bad.some(p => p.res.issues.some(t => !/^Load path breaks/.test(t)));
    const expect = breaks && stiff ? 'Expect broken load paths (zero stiffness) and inflated stiffness on the sparsest designs in this sweep.'
                 : breaks ? 'Expect broken load paths (zero stiffness) on the sparsest designs in this sweep.'
                 : 'Expect inflated stiffness on the sparsest designs in this sweep.';
    ht.appendChild(pfEl('div', 'pf-sub', `${R.flagged} of ${n} test designs would be flagged at ${S.gridN}³ ${pfPrecTxt(S)}. ${expect}`));
    head.appendChild(ico); head.appendChild(ht);
    card.appendChild(head);

    const list = pfEl('div', 'pf-probes');
    R.probes.forEach(p => {
      const r = p.res, row = pfEl('div', 'pf-row');
      row.appendChild(pfSliceCanvas(r.slice));
      const tx = pfEl('div', 'pf-rtx');
      tx.appendChild(pfEl('div', 'pf-rname', `Lowest density (${pfPct(S.dens.lo)} %) · ${p.label}`));
      tx.appendChild(pfEl('div', 'pf-rwhy', !r.built ? 'Couldn’t be built at this density' : r.flagged ? r.issues.join(' · ') : 'Clear'));
      row.appendChild(tx);
      row.appendChild(pfEl('span', 'pf-tag ' + (!r.built ? 'skip' : r.flagged ? 'bad' : 'ok'), !r.built ? 'Skipped' : r.flagged ? 'Flagged' : 'Clear'));
      list.appendChild(row);
    });
    card.appendChild(list);
    card.appendChild(pfEl('div', 'pf-key', 'Slices: solid voxels light, partly filled voxels amber, pores dark'));

    const fixes = [];
    if (R.floorFix) fixes.push({ k: 'floor', t: `Raise the density floor to ${pfPct(R.floorFix.floor)} %`,
      s: `Keeps ${S.gridN}³ · the window was ${pfPct(R.floorFix.lo)}–${pfPct(R.floorFix.hi)} %` +
         (typeof TARGET !== 'undefined' && TARGET && TARGET.auto ? ' · the target rounds stay above it too' : '') });
    if (R.gridFix) fixes.push({ k: 'grid', t: `Use the ${R.gridFix.N}³ grid`,
      s: 'Every test design clears' + (R.gridFix.slower ? ` · they took about ${R.gridFix.slower.toFixed(1)}× longer to solve` : '') });

    let pick = fixes.length ? fixes[0].k : null;
    if (fixes.length) {
      card.appendChild(pfEl('div', 'pf-sec', 'Suggested fix'));
      const opts = [];
      fixes.forEach(f => {
        const o = pfEl('button', 'pf-fix' + (f.k === pick ? ' on' : ''));
        o.type = 'button';
        o.setAttribute('role', 'radio');
        o.setAttribute('aria-checked', f.k === pick ? 'true' : 'false');
        o.appendChild(pfEl('span', 'pf-dot'));
        const ft = pfEl('span', 'pf-ftx');
        ft.appendChild(pfEl('span', 'pf-ft', f.t));
        ft.appendChild(pfEl('span', 'pf-fs', f.s));
        o.appendChild(ft);
        o.onclick = () => {
          pick = f.k;
          opts.forEach(x => { x.el.classList.toggle('on', x.k === pick); x.el.setAttribute('aria-checked', x.k === pick ? 'true' : 'false'); });
        };
        opts.push({ k: f.k, el: o });
        card.appendChild(o);
      });
    } else {
      card.appendChild(pfEl('div', 'pf-none',
        `No quick fix found — even at the top of the density window${S.gpu ? ' and on the finest grid' : ''} these test designs flag. Change the settings, or run and filter the flagged designs out afterwards.`));
    }

    const acts = pfEl('div', 'pf-acts');
    const done = v => { ov.remove(); document.removeEventListener('keydown', trap, true); resolve(v); };
    const ign = pfEl('button', 'pf-btn ghost', 'Ignore and run'); ign.type = 'button'; ign.onclick = () => done('ignore');
    if (fixes.length) {
      const ap = pfEl('button', 'pf-btn primary', 'Apply and run'); ap.type = 'button'; ap.onclick = () => done(pick);
      acts.appendChild(ign); acts.appendChild(ap);
    } else {
      const bk = pfEl('button', 'pf-btn primary', 'Back to settings'); bk.type = 'button'; bk.onclick = () => done('back');
      acts.appendChild(bk); acts.appendChild(ign);
    }
    card.appendChild(acts);
    ov.appendChild(card);
    document.body.appendChild(ov);

    /* the popup must be answered: Escape does nothing, focus stays inside */
    const trap = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key !== 'Tab') return;
      const f = card.querySelectorAll('button');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    const first = acts.querySelector('.primary') || acts.querySelector('button');
    if (first) first.focus();
  });
}
