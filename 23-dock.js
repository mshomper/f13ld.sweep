/* ============================================================
   F13LD.sweep · 23-dock.js   (v0.25.0)
   Dock + Configure drawer (as F13LD.lab 51-dock.js), the inspector beside
   the design space, the results funnel, column-header tooltips and
   drop-anywhere recipe loading.

   The dock is one row: Configure · a tag per setting (sweep, material,
   solver, ranks 1–3) · progress · log chip · solver · Cancel · Run.
   Configure (or any tag, or the log chip) opens the drawer, which slides
   up over the panels without resizing them (the plot and preview canvases
   never re-layout). Every control keeps the id and handler it had in the
   sidebar, so the sweep code is unchanged; this file only paints the dock.
   Top-level code only wires listeners (loads before the families / solver
   files; everything they define is used at call time).
   ============================================================ */

var DOCK_STATE = { open: false, tab: 'sweep' };
var DOCK_STORE_KEY = 'f13ld.sweep.dock.v1';
var DOCK_LOG = { warn: 0, last: '' };

function dockSave() { try { localStorage.setItem(DOCK_STORE_KEY, JSON.stringify({ tab: DOCK_STATE.tab })); } catch (e) {} }
function dockLoad() { try { var s = JSON.parse(localStorage.getItem(DOCK_STORE_KEY) || 'null'); if (s && s.tab) DOCK_STATE.tab = s.tab; } catch (e) {} }

function toggleDrawer(open) {
  DOCK_STATE.open = (open == null) ? !DOCK_STATE.open : !!open;
  var d = document.getElementById('cfgDrawer'), b = document.getElementById('cfgBtn');
  d.classList.toggle('open', DOCK_STATE.open);
  b.classList.toggle('open', DOCK_STATE.open);
  b.setAttribute('aria-expanded', DOCK_STATE.open ? 'true' : 'false');
  if (DOCK_STATE.open && DOCK_STATE.tab === 'log') { var lb = document.getElementById('logBody'); lb.scrollTop = lb.scrollHeight; }
}

/* Show a tab; from a dock tag: open the drawer on it, or close it when that
   tab is already showing (toggle). */
function dockTab(tab, fromDock) {
  if (fromDock && DOCK_STATE.open && DOCK_STATE.tab === tab) { toggleDrawer(false); return; }
  DOCK_STATE.tab = tab;
  document.querySelectorAll('#drTabs .dr-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
  document.querySelectorAll('#cfgDrawer .dr-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === tab); });
  dockSave();
  if (fromDock || !DOCK_STATE.open) toggleDrawer(true);
  else if (tab === 'log') { var lb = document.getElementById('logBody'); lb.scrollTop = lb.scrollHeight; }
}

function dockEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function dockVal(id) { var e = document.getElementById(id); return e ? e.value : ''; }
function dockSelText(id) { var e = document.getElementById(id); return (e && e.selectedIndex >= 0) ? e.options[e.selectedIndex].text : ''; }

/* ── dock tags ───────────────────────────────────────────────── */
function updateDock() {
  var tags = [];
  var fam = (typeof SWEEP_FAMILIES !== 'undefined' && typeof baseFamily !== 'undefined' && baseFamily) ? SWEEP_FAMILIES[baseFamily] : null;
  /* sweep */
  var n = dockVal('samplesSlider'), samp = dockVal('samplingMethod') === 'uniform' ? 'random' : 'Sobol';
  var lo = [dockVal('scaleXlo'), dockVal('scaleYlo'), dockVal('scaleZlo')], hi = [dockVal('scaleXhi'), dockVal('scaleYhi'), dockVal('scaleZhi')];
  var range = (lo[0] === lo[1] && lo[1] === lo[2] && hi[0] === hi[1] && hi[1] === hi[2]) ? lo[0] + '–' + hi[0] + ' %' : 'per-axis ranges';
  if (fam && !fam.usesCellScale) range = 'field settings';
  tags.push('<button class="dock-tag" type="button" onclick="dockTab(\'sweep\', true)" title="Designs, sampling and cell-scale ranges"><b>' + dockEsc(n) + '</b> designs · ' + samp + ' · ' + dockEsc(range) + '</button>');
  /* material */
  var matVisible = document.getElementById('materialGroup') && document.getElementById('materialGroup').style.display !== 'none';
  var dom = dockSelText('domainSel').split('/')[0].trim();
  var mat = matVisible ? dockSelText('materialSel').split('(')[0].trim() : 'Normalized';
  tags.push('<button class="dock-tag" type="button" onclick="dockTab(\'mat\', true)" title="Application domain and material"><b>' + dockEsc(mat) + '</b> ' + dockEsc(dom) + '</button>');
  /* solver */
  var prec = (typeof getPrecisionMode === 'function' && getPrecisionMode() === 'rigorous') ? 'Rigorous' : 'Fast';
  var N = (typeof getSolverN === 'function') ? getSolverN() : 16;
  var st = (typeof gpuSolverStatus === 'function') ? gpuSolverStatus() : { gpu: null };
  var dot = st.gpu === true ? 'var(--green)' : st.gpu === false ? 'var(--warn)' : 'var(--ink-dim)';
  tags.push('<button class="dock-tag" type="button" onclick="dockTab(\'solver\', true)" title="Precision, grid and solver"><span class="dot" style="background:' + dot + '"></span><b>' + prec + '</b> N=' + N + '</button>');
  /* ranks */
  var dirs = (typeof directions !== 'undefined') ? directions : {};
  var rankTxt = [];
  var bothOff = ['r2metric', 'r3metric'].every(function (id) { var v = dockVal(id); return !v || v === 'none'; });
  for (var r = 1; r <= 3; r++) {
    var k = dockVal('r' + r + 'metric'), off = !k || k === 'none';
    if (bothOff && r === 3) continue;
    if (bothOff && r === 2) {   /* one tag for both unused ranks */
      tags.push('<button class="dock-tag off" type="button" onclick="dockTab(\'ranks\', true)" title="Ranks 2 and 3 are off"><span class="dot" style="background:var(--rank2)"></span><span class="dot" style="background:var(--rank3);margin-left:-4px"></span><b>R2 · R3</b> off</button>');
      continue;
    }
    var info = (!off && typeof METRIC_INFO !== 'undefined' && METRIC_INFO[k]) ? METRIC_INFO[k] : null;
    var lbl = off ? 'R' + r : (info ? info.sym : k);
    var dir = off ? 'off' : ((dirs[r] || 'max') === 'min' ? '▼' : '▲');
    if (!off) rankTxt.push(lbl + ' ' + dir);
    tags.push('<button class="dock-tag' + (off ? ' off' : '') + '" type="button" onclick="dockTab(\'ranks\', true)" title="' + (off ? 'Rank ' + r + ' is off' : 'Rank ' + r + ': ' + dockEsc(info ? info.name : k) + (dir === '▼' ? ' (min)' : ' (max)')) + '"><span class="dot" style="background:var(--rank' + r + ')"></span><b>' + dockEsc(lbl) + '</b> ' + dir + '</button>');
  }
  document.getElementById('dockTags').innerHTML = tags.join('');
  /* drawer tab summaries */
  var setT = function (id, t) { var e = document.getElementById(id); if (e) e.textContent = t; };
  setT('mvSweep', n + ' · ' + samp);
  setT('mvMat', mat);
  setT('mvSolver', (st.gpu === true ? 'GPU' : st.gpu === false ? 'CPU' : '…') + ' · ' + prec + ' · ' + N);
  setT('mvRanks', rankTxt.join(' · ') || 'off');
  setT('mvKey', (typeof tableColumnKeys === 'function') ? String(tableColumnKeys().keys.length) : '');
  var fn = document.getElementById('fileName'), fm = document.getElementById('fileMeta');
  var loaded = document.getElementById('recipeCard') && document.getElementById('recipeCard').classList.contains('loaded');
  setT('drRecipeName', loaded ? (fn.textContent + ' — ' + fm.textContent) : 'No recipe loaded');
  /* solver line in the dock */
  var hw = document.getElementById('dockHw');
  if (hw) {
    hw.textContent = st.gpu === true ? st.text.split(' · ').slice(0, 2).join(' · ') : st.gpu === false ? 'CPU solver' : '';
    hw.title = st.text || '';
    hw.className = 'dock-hw' + (st.gpu === true ? ' green' : st.gpu === false ? ' warn' : '');
  }
}

/* ── log chip (05-log.js calls this for every line) ─────────── */
function dockLog(type, msg) {
  var txt = String(msg).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  if (/^Starting sweep/.test(txt)) DOCK_LOG.warn = 0;
  if (type === 'warn') DOCK_LOG.warn++;
  DOCK_LOG.last = txt;
  var m = document.getElementById('logChipMsg'), w = document.getElementById('logChipWarn'), mv = document.getElementById('mvLog');
  if (m) m.textContent = txt;
  if (w) w.textContent = DOCK_LOG.warn ? '· ' + DOCK_LOG.warn + ' warning' + (DOCK_LOG.warn > 1 ? 's' : '') : '';
  if (mv) mv.textContent = DOCK_LOG.warn ? DOCK_LOG.warn + ' warn' : '';
}

/* ── results funnel (62-run-sweep.js) ───────────────────────── */
function renderFunnel(f) {
  var el = document.getElementById('funnel');
  if (!el) return;
  if (!f) { el.innerHTML = ''; return; }
  var h = '<b>' + f.attempts + '</b> drawn <i>→</i> <b>' + f.valid + '</b> valid';
  for (var r = 0; r < 3; r++) {
    var v = f.r[r];
    h += ' <i>→</i> <span style="color:var(--rank' + (r + 1) + ')">R' + (r + 1) + '</span> ' + (v == null ? '<span class="off">off</span>' : '<b>' + v + '</b>');
  }
  if (f.flagged) h += ' · <span class="fl">' + f.flagged + ' flagged</span>';
  el.innerHTML = h;
  el.title = f.attempts + ' designs drawn, ' + f.valid + ' passed the volume-fraction and connectivity gates; rank 1 sorts, ranks 2 and 3 keep the top share' + (f.flagged ? '; ' + f.flagged + ' may read stiffer than they are (dot on the row)' : '');
}

/* ── inspector: the hovered or selected design ──────────────── */
function renderInspector(d) {
  var t = document.getElementById('inspTitle'), b = document.getElementById('previewBadge');
  var kv = document.getElementById('inspKv'), fl = document.getElementById('inspFlag'), act = document.getElementById('inspActions');
  if (!t || !d) return;
  var isBase = d.id === 'base';
  t.textContent = isBase ? 'Loaded recipe' : 'Design #' + d.id;
  b.textContent = isBase ? 'preview' : (d.filterRank ? 'rank ' + d.filterRank : (d.family || ''));
  b.classList.toggle('rank', !isBase && d.filterRank >= 1 && d.filterRank <= 3);
  var sel = (typeof selectedDesign !== 'undefined' && selectedDesign && selectedDesign.id === d.id);
  act.innerHTML = isBase ? '' :
    (sel ? '<button class="row-btn' + ((typeof detailOpen !== 'undefined' && detailOpen) ? ' on' : '') + '" id="detailsBtn" onclick="toggleDetails()" title="Every metric of this design, above the table">All metrics</button>' : '') +
    '<button class="row-btn lab" onclick="openInLab(' + d.id + ',this)" title="Full solve in F13LD.lab">Lab</button>' +
    '<button class="row-btn mesh" onclick="openInMesh(' + d.id + ',this)" title="Print-ready mesh in F13LD.mesh">Mesh</button>';
  if (isBase) { kv.innerHTML = ''; fl.textContent = ''; fl.classList.remove('on'); return; }
  var shear = d.Gxy_GPa !== undefined;
  var cells = [
    ['volume_fraction', 'VF', '%'], ['stiffness_density', 'E/ρ', ''], ['anisotropy', 'α', '×'],
    ['Ex_GPa', 'Ex', ''], ['Ey_GPa', 'Ey', ''], ['Ez_GPa', 'Ez', '']
  ].concat(shear ? [['Gyz_GPa', 'Gyz', ''], ['Gxz_GPa', 'Gxz', ''], ['Gxy_GPa', 'Gxy', '']]
                 : [['keff_x', 'kx', ''], ['keff_y', 'ky', ''], ['keff_z', 'kz', '']]);
  var vl = d.void_limited_axes || '';
  kv.innerHTML = cells.map(function (c) {
    var v = d[c[0]], txt = (typeof formatMetric === 'function') ? formatMetric(c[0], v) : String(v);
    var col = (typeof COL_COLORS !== 'undefined' && COL_COLORS[c[0]]) || 'var(--ink)';
    var ax = { Ex_GPa: 'x', Ey_GPa: 'y', Ez_GPa: 'z' }[c[0]];
    var cls = (ax && vl.indexOf(ax) >= 0) ? ' class="sflag-val"' : '';
    var info = (typeof METRIC_INFO !== 'undefined' && METRIC_INFO[c[0]]) ? METRIC_INFO[c[0]] : null;
    return '<div title="' + dockEsc(info ? info.name + ' — ' + info.desc : c[1]) + '"><span>' + c[1] + (/_GPa$/.test(c[0]) ? ' GPa' : '') + '</span><b style="color:' + col + '"><span' + cls + '>' + dockEsc(txt) + (txt !== '—' ? c[2] : '') + '</span></b></div>';
  }).join('');
  if (d.stiffness_flag) { fl.textContent = '● Stiffness may read high: ' + (d.stiffness_flag_reasons || ''); fl.classList.add('on'); }
  else { fl.textContent = ''; fl.classList.remove('on'); }
}

/* ── column-header tooltips (instant, styled; replaces the slow native one) ── */
function dockTipShow(th) {
  var tip = document.getElementById('colTip');
  if (!tip || !th) return;
  if (th.hasAttribute('title')) { th.dataset.tip = th.getAttribute('title'); th.removeAttribute('title'); }
  var key = th.dataset.col, info = (typeof METRIC_INFO !== 'undefined' && key) ? METRIC_INFO[key] : null;
  var extra = (th.dataset.tip || '').indexOf('rank ') >= 0 ? (th.dataset.tip.match(/rank \d metric/) || [''])[0] : '';
  tip.innerHTML = info
    ? '<b>' + dockEsc(info.sym) + '</b> ' + dockEsc(info.name) + '<span>' + dockEsc(info.desc) + '</span>' + (extra ? '<em>' + dockEsc(extra) + '</em>' : '') + '<em>click to sort</em>'
    : dockEsc(th.dataset.tip || th.textContent);
  var r = th.getBoundingClientRect();
  tip.classList.add('on');
  var w = tip.offsetWidth, x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  tip.style.left = x + 'px';
  tip.style.top = (r.bottom + 6) + 'px';
}
function dockTipHide() { var tip = document.getElementById('colTip'); if (tip) tip.classList.remove('on'); }

(function wireDock() {
  var wrap = document.getElementById('tableWrap');
  wrap.addEventListener('mouseover', function (e) { var th = e.target.closest && e.target.closest('th[data-col]'); if (th) dockTipShow(th); });
  wrap.addEventListener('mouseout', function (e) { var th = e.target.closest && e.target.closest('th[data-col]'); if (th && !th.contains(e.relatedTarget)) dockTipHide(); });
  wrap.addEventListener('focusin', function (e) { var th = e.target.closest && e.target.closest('th[data-col]'); if (th) dockTipShow(th); else dockTipHide(); });
  wrap.addEventListener('focusout', dockTipHide);
  wrap.addEventListener('scroll', dockTipHide, true);

  /* any setting changed in the drawer → repaint the dock tags */
  var dr = document.getElementById('cfgDrawer');
  ['input', 'change', 'click'].forEach(function (ev) { dr.addEventListener(ev, function () { setTimeout(updateDock, 0); }); });

  /* Escape closes the drawer */
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && DOCK_STATE.open) toggleDrawer(false); });

  /* drop a recipe anywhere on the page */
  document.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', function (e) {
    document.body.classList.remove('dropping');
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    if (e.target.closest && e.target.closest('#recipeCard')) return;   /* the chip's own handler loads it */
    e.preventDefault();
    if (typeof loadFile === 'function') loadFile(e.dataTransfer.files[0]);
  });
})();

/* called from 99-init.js */
function initDock() {
  dockLoad();
  document.querySelectorAll('#drTabs .dr-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === DOCK_STATE.tab); });
  document.querySelectorAll('#cfgDrawer .dr-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === DOCK_STATE.tab); });
  updateDock();
}
