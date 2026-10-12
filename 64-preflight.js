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
   · A probe also flags when an axis the recipe's own design connects on
     (its voxels at 64³, no solve) reads zero stiffness: a broken load path.
     Probes skip what the flags don't read (pores, curvature, topology,
     tortuosity, thermal — opts.flagsOnly).
   · When a probe flags, two fixes are worked out in the background, in two
     parallel rounds: the lowest density floor where the flagged probes
     clear at the current grid, and the first finer grid where they clear.
   · When every test design fails, the popup shows them as one row.
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
const PF_LABEL = { mid: 'the recipe’s own shape', low: 'shape varied one way', high: 'shape varied the other way', stretch: 'the most stretched cell' };
function pfProbes(S) {
  const mid = S.sc ? S.sc.map(r => (r[0] + r[1]) / 2) : null;
  const P = [
    { key: 'mid',  u: [0.50, 0.50], scale: mid, label: PF_LABEL.mid },
    { key: 'low',  u: [0.02, 0.98], scale: mid, label: PF_LABEL.low },
    { key: 'high', u: [0.98, 0.02], scale: mid, label: PF_LABEL.high }
  ];
  if (S.sc) {
    const ratio = s => Math.max(...s) / Math.max(1e-9, Math.min(...s));
    let best = null, bestR = ratio(mid);
    for (let c = 0; c < 8; c++) {
      const s = S.sc.map((r, i) => r[(c >> i) & 1]), q = ratio(s);
      if (q > bestR * 1.0001) { best = s; bestR = q; }
    }
    if (best && bestR >= ratio(mid) * PF_STRETCH_MIN) P.push({ key: 'stretch', u: [0.50, 0.50], scale: best, label: PF_LABEL.stretch });
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
      targetHints: null, scale: p.scale, targetVF: vf,
      /* only what the flags read: no pores, curvature, topology, tortuosity
         or thermal solve (54-estimate.js prepareDesign) */
      flagsOnly: true
    }
  };
}

/* Issues are kept as { k, axes, pct } so the popup can merge them:
   break (load path), pore (pore stiffness share), vf (solid fraction off),
   trim (thin walls in pieces), flag (anything else stiffnessFlags said). */
const PF_ISSUE_ORDER = ['break', 'pore', 'vf', 'trim', 'flag'];
function pfIssueText(i, N) {
  return i.k === 'break' ? `Load path breaks on ${i.axes.join(', ')} at ${N}³`
       : i.k === 'pore'  ? `Pores carry about ${i.pct} % of the stiffness on ${i.axes.join(', ')}`
       : i.k === 'vf'    ? `Solid fraction ${i.pct} % off at ${N}³`
       : i.k === 'trim'  ? `Thin walls broke into pieces (${i.pct} % of the solid)`
       : 'Stiffness may be inflated';
}
/* several probes' issues → one of each kind (axes joined, the largest %) */
function pfMergeIssues(lists) {
  const by = {};
  lists.forEach(l => l.forEach(i => {
    const m = by[i.k] || (by[i.k] = { k: i.k, axes: [], pct: 0 });
    if (i.axes) m.axes = [...new Set(m.axes.concat(i.axes))].sort();
    if (i.pct != null) m.pct = Math.max(m.pct, i.pct);
  }));
  const out = PF_ISSUE_ORDER.filter(k => by[k]).map(k => by[k]);
  return out.length > 1 ? out.filter(i => i.k !== 'flag') : out;
}

/* One probe at one density and grid → what Preflight reads from it. The
   reasons come from stiffnessFlags (54-estimate.js) — keep these patterns
   in step with its wording. */
async function pfSolve(S, pool, p, vf, gridN) {
  const t0 = performance.now();
  let msg;
  try { msg = await computeDesign(pool, S.gpuClient, pfSpec(S, p, vf, gridN), S.gpu ? GPU_PRECISION[S.precMode] : null); }
  catch (e) { return { built: false, error: true, reason: e.message, ms: performance.now() - t0, vf, gridN }; }
  const ms = performance.now() - t0, hom = msg.hom;
  if (!hom || hom.degenerate) return { built: false, reason: hom ? hom.reject_reason : 'error', ms, vf, gridN };
  const iss = [];
  if (hom.void_limited_axes) {
    const vr = S.gpu ? GPU_PRECISION[S.precMode].voidRatio : PRECISION_MODES[S.precMode].contrast;
    const rho = (hom.volume_fraction || 0) / 100;
    let share = 0;
    for (const a of hom.void_limited_axes) {
      const e = hom['E' + a + '_GPa'];
      if (e > 0) share = Math.max(share, vr * S.mat.Es * (1 - rho) / e);
    }
    iss.push({ k: 'pore', axes: hom.void_limited_axes.split(''), pct: Math.round(share * 100) });
  }
  const why = hom.stiffness_flag_reasons || '';
  let m;
  if ((m = /connects differently from the metrics grid on ([xyz, ]+)/.exec(why))) iss.push({ k: 'break', axes: m[1].replace(/[ ,]/g, '').split('').sort() });
  if ((m = /solid fraction is (\d+) % off/.exec(why))) iss.push({ k: 'vf', pct: +m[1] });
  if ((m = /broke into pieces on the solver grid \((\d+) %/.exec(why))) iss.push({ k: 'trim', pct: +m[1] });
  if (hom.stiffness_flag && !iss.length) iss.push({ k: 'flag' });
  iss.sort((a, b) => PF_ISSUE_ORDER.indexOf(a.k) - PF_ISSUE_ORDER.indexOf(b.k));
  return { built: true, flagged: !!hom.stiffness_flag, iss, E: [hom.Ex_GPa, hom.Ey_GPa, hom.Ez_GPa], ms, vf: (hom.volume_fraction || 0) / 100, gridN, slice: msg.slice || null };
}

/* The broken-load-path check: an axis the recipe's own design connects on
   (S.expect, its voxels on a 64³ grid) reads zero stiffness here — the solid
   doesn't connect across the cell. The sweep keeps such a design without a
   stiffness flag, so Preflight adds this one itself. */
function pfJudge(S, r) {
  if (!r.built || !S.expect) return r;
  const E = { x: r.E[0], y: r.E[1], z: r.E[2] };
  const broken = S.expect.filter(a => !(E[a] > 0));
  if (!broken.length) return r;
  const old = r.iss.find(i => i.k === 'break');
  const axes = [...new Set(broken.concat(old ? old.axes : []))].sort();
  const iss = [{ k: 'break', axes }].concat(r.iss.filter(i => i.k !== 'break' && i.k !== 'flag'));
  return Object.assign({}, r, { flagged: true, iss });
}

/* a flagged probe passes when it clears, or when it can't be built there
   (the sweep would discard it, not flag it) — a worker error never passes */
const pfPasses = r => !r.error && !(r.built && r.flagged);

/* The axes the recipe's own design connects on: its voxels on a 64³ grid
   and a percolation check in a worker — no solve (sweep-worker.js
   'connectivity'). */
const PF_REF_N = 64;
async function pfReferenceAxes(pool) {
  try {
    const msg = await pool.dispatch({ type: 'connectivity', attemptIdx: -100, recipe: JSON.parse(JSON.stringify(baseRecipe)), gridN: PF_REF_N });
    const c = msg.connect || {};
    const ax = ['x', 'y', 'z'].filter(a => c[a]);
    return ax.length ? ax : ['x', 'y', 'z'];
  } catch (e) { return ['x', 'y', 'z']; }
}

async function pfRun(S, gen) {
  const pool = getSolverPool(S.gpuClient);
  const stale = () => { if (gen !== PF.gen) throw { stale: true }; };
  const t0 = performance.now();
  const probes = pfProbes(S);
  const [expect, ...solved] = await Promise.all([pfReferenceAxes(pool)]
    .concat(probes.map(p => pfSolve(S, pool, p, S.dens.lo, S.gridN))));
  stale();
  S.expect = expect;
  probes.forEach((p, i) => { p.res = pfJudge(S, solved[i]); });
  const flagged = probes.filter(p => p.res.built && p.res.flagged);
  const R = { S, probes, flagged: flagged.length, built: probes.filter(p => p.res.built).length, floorFix: null, gridFix: null,
              time: { probes: performance.now() - t0, fixes: 0 } };
  if (!flagged.length) return R;

  /* Fixes in two parallel rounds (on a phone, rounds one after another
     each wait on the slowest design). Round 1: the window at a quarter,
     half, three quarters and the top, and each finer grid at the floor.
     Round 2: three densities inside the bracket round 1 found. */
  const t1 = performance.now();
  const batch = jobs => Promise.all(jobs.map(j =>
    Promise.all(flagged.map(p => pfSolve(S, pool, p, j.vf, j.N))).then(r => r.map(x => pfJudge(S, x)))));
  const allPass = r => r.every(pfPasses), msOf = r => r.reduce((s, x) => s + x.ms, 0) / r.length;
  const lo = S.dens.lo, hi = S.dens.hi;
  const fr = hi - lo >= 0.005 ? [0.25, 0.5, 0.75, 1].map(t => lo + t * (hi - lo)) : [];
  const grids = [];
  for (const n of [16, 32, 64]) {
    if (n <= S.pick || (n > 32 && !S.gpu)) continue;
    const N = resolveGridNFor(S.mode, n);
    if (N > S.gridN && !grids.some(g => g.N === N)) grids.push({ pick: n, N });
  }
  const resA = await batch(fr.map(vf => ({ vf, N: S.gridN })).concat(grids.map(g => ({ vf: lo, N: g.N }))));
  stale();

  /* density floor at the current grid — the default fix (Matt: the grid
     was likely picked for speed) */
  const iA = fr.findIndex((vf, j) => allPass(resA[j]));
  if (iA >= 0) {
    const a = iA > 0 ? fr[iA - 1] : lo;
    let b = fr[iA];
    const fr2 = [0.25, 0.5, 0.75].map(t => a + t * (b - a));
    const resB = await batch(fr2.map(vf => ({ vf, N: S.gridN })));
    stale();
    const iB = fr2.findIndex((vf, j) => allPass(resB[j]));
    if (iB >= 0) b = fr2[iB];
    const floor = Math.min(hi, Math.ceil(b * 200 - 1e-9) / 200);   /* up to the next 0.5 % */
    if (floor > lo + 1e-4) R.floorFix = { floor, lo, hi };
  }

  /* the lowest finer grid where every flagged probe clears; its solve time
     against the current grid's in the same round */
  const msCur = fr.length ? msOf(resA[0]) : msOf(flagged.map(p => p.res));
  const iG = grids.findIndex((g, k) => allPass(resA[fr.length + k]));
  if (iG >= 0) R.gridFix = { pick: grids[iG].pick, N: grids[iG].N, slower: msCur > 0 ? msOf(resA[fr.length + iG]) / msCur : null };
  R.time.fixes = performance.now() - t1;
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
const pfSec = ms => (ms / 1000).toFixed(1) + ' s';
function pfLog(R) {
  const S = R.S, n = R.probes.length, t = R.time || { probes: 0, fixes: 0 };
  const took = R.flagged ? ` · ${pfSec(t.probes + t.fixes)} (test designs ${pfSec(t.probes)}, fixes ${pfSec(t.fixes)})` : ` · ${pfSec(t.probes)}`;
  if (!R.built) { log('info', `Preflight: none of the ${n} test designs could be built at the density floor (${pfPct(S.dens.lo)} %) — nothing to check${took}`); return; }
  if (!R.flagged) { log('info', `Preflight: ${R.built} test designs at the density floor (${pfPct(S.dens.lo)} %) clear on ${S.gridN}³ ${pfPrecTxt(S)}${took}`); return; }
  const fixes = [];
  if (R.floorFix) fixes.push(`density floor ${pfPct(R.floorFix.floor)} %`);
  if (R.gridFix) fixes.push(`${R.gridFix.N}³ grid`);
  log('warn', `Preflight: ${R.flagged} of ${n} test designs would be flagged on ${S.gridN}³ ${pfPrecTxt(S)}` +
    (fixes.length ? ` — fix ready (${fixes.join(' or ')}); you'll be asked when you press Run` : ' — no quick fix found; you’ll be asked when you press Run') + took);
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
    const breaks = bad.some(p => p.res.iss.some(i => i.k === 'break'));
    const stiff = bad.some(p => p.res.iss.some(i => i.k !== 'break'));
    const expect = breaks && stiff ? 'Expect broken load paths (zero stiffness) and inflated stiffness on the sparsest designs in this sweep.'
                 : breaks ? 'Expect broken load paths (zero stiffness) on the sparsest designs in this sweep.'
                 : 'Expect inflated stiffness on the sparsest designs in this sweep.';
    ht.appendChild(pfEl('div', 'pf-sub', `${R.flagged} of ${n} test designs would be flagged at ${S.gridN}³ ${pfPrecTxt(S)}. ${expect}`));
    head.appendChild(ico); head.appendChild(ht);
    card.appendChild(head);

    const list = pfEl('div', 'pf-probes');
    const addRow = (slice, name, why, note, kind) => {
      const row = pfEl('div', 'pf-row');
      row.appendChild(pfSliceCanvas(slice));
      const tx = pfEl('div', 'pf-rtx');
      tx.appendChild(pfEl('div', 'pf-rname', name));
      tx.appendChild(pfEl('div', 'pf-rwhy', why));
      if (note) tx.appendChild(pfEl('div', 'pf-rnote', note));
      row.appendChild(tx);
      row.appendChild(pfEl('span', 'pf-tag ' + kind, kind === 'skip' ? 'Skipped' : kind === 'bad' ? 'Flagged' : 'Clear'));
      list.appendChild(row);
    };
    const floorTxt = `at the lowest density (${pfPct(S.dens.lo)} %)`;
    if (bad.length > 1 && bad.length === R.built) {
      /* every test design that could be built fails: one row (Matt) — the
         problems merged, the thinnest slice, the designs named in small print */
      const sum = sl => (sl && sl.data) ? sl.data.reduce((s, v) => s + v, 0) / sl.data.length : Infinity;
      const thin = bad.reduce((m, p) => (sum(p.res.slice) < sum(m.res.slice) ? p : m), bad[0]);
      const names = bad.map(p => p.key);
      const parts = [];
      if (names.includes('mid')) parts.push(PF_LABEL.mid);
      if (names.includes('low') && names.includes('high')) parts.push('both shape variations');
      else { if (names.includes('low')) parts.push(PF_LABEL.low); if (names.includes('high')) parts.push(PF_LABEL.high); }
      if (names.includes('stretch')) parts.push(PF_LABEL.stretch);
      const listed = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
      const skipped = R.probes.length - R.built;
      addRow(thin.res.slice, `All ${bad.length} test designs ${floorTxt}`,
        pfMergeIssues(bad.map(p => p.res.iss)).map(i => pfIssueText(i, S.gridN)).join(' · '),
        listed.charAt(0).toUpperCase() + listed.slice(1) + (skipped ? ` · ${skipped} more couldn’t be built at this density` : ''), 'bad');
    } else {
      R.probes.forEach(p => {
        const r = p.res;
        addRow(r.slice, `Lowest density (${pfPct(S.dens.lo)} %) · ${p.label}`,
          !r.built ? 'Couldn’t be built at this density' : r.flagged ? r.iss.map(i => pfIssueText(i, r.gridN)).join(' · ') : 'Clear',
          null, !r.built ? 'skip' : r.flagged ? 'bad' : 'ok');
      });
    }
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
