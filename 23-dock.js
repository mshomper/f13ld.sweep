/* ============================================================
   F13LD.sweep · 23-dock.js   (v0.25.0)
   Icons, dock + Configure drawer shell (as F13LD.lab 51-dock.js), the
   inspector beside the design space, the results funnel, column-header
   tooltips and drop-anywhere recipe loading.

   The dock is one row: Configure · a tag per setting (sweep, material,
   solver, ranks) · progress · log chip · solver · Cancel · Run.
   Configure (or any tag, or the log chip) opens the drawer, which slides
   up over the panels without resizing them (the plot and preview canvases
   never re-layout). The drawer has three tabs: Settings (every setting on
   one panel, 24-drawer.js), Log and Metric key.

   Every legacy control keeps its id and handler (hidden, #nativeCtl); the
   drawer's controls drive them, so the sweep code is unchanged.
   Top-level code only defines things and wires listeners (loads before the
   families / solver files; everything they define is used at call time).
   ============================================================ */

/* ── icons ─────────────────────────────────────────────────────────
   Brand icon style (as F13LD.lab): 40 × 40 grid, round caps, 2.6 strokes,
   a neon accent node (.acc). Shown in tiles (.ico). */
var SW_SV = ' fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
var SWEEP_ICONS = {
  /* fan of draws from one recipe (the tool mark) */
  sweep:    '<path d="M7 33 L14 6 M7 33 L25 7 M7 33 L33 14"' + SW_SV + '/><path d="M7 33 L35 25"' + SW_SV + ' opacity=".45"/><circle cx="7" cy="33" r="2.6" fill="currentColor"/><circle class="acc" cx="25" cy="7" r="3.3"/>',
  /* a stretched cell with its range arrows */
  scale:    '<path d="M11 11 H29 V29 H11 Z"' + SW_SV + '/><path d="M3 20 H8 M32 20 H37 M5.5 17 L3 20 L5.5 23 M34.5 17 L37 20 L34.5 23"' + SW_SV + ' stroke-width="2.2" opacity=".75"/><path d="M11 20 H29"' + SW_SV + ' stroke-width="1.5" stroke-dasharray="0.1 4" opacity=".55"/><circle class="acc" cx="20" cy="20" r="3.3"/>',
  /* solid block (as Lab's model) */
  material: '<path d="M20 4 L34 12 V28 L20 36 L6 28 V12 Z"' + SW_SV + '/><path d="M6 12 L20 20 L34 12 M20 20 V36"' + SW_SV + ' opacity=".7"/><circle class="acc" cx="20" cy="20" r="3.4"/>',
  /* voxel grid */
  solver:   '<path d="M6 6 H34 V34 H6 Z"' + SW_SV + '/><path d="M15.3 6 V34 M24.7 6 V34 M6 15.3 H34 M6 24.7 H34"' + SW_SV + ' stroke-width="1.6" opacity=".55"/><circle class="acc" cx="20" cy="20" r="3.4"/>',
  /* three ranked bars */
  ranks:    '<path d="M5 35 H35"' + SW_SV + ' opacity=".6"/><path d="M8 35 V25 H15 V35 M16.5 35 V17 H23.5 V35 M25 35 V11 H32 V35"' + SW_SV + '/><circle class="acc" cx="28.5" cy="5.5" r="3.1"/>',
  /* the log */
  log:      '<path d="M13 9 H35 M13 17 H30 M13 25 H35 M13 33 H25"' + SW_SV + '/><path d="M5 17 H6 M5 25 H6 M5 33 H6"' + SW_SV + ' opacity=".6"/><circle class="acc" cx="5.5" cy="9" r="3"/>',
  /* a legend: swatches + names */
  key:      '<path d="M5 6 H12 V13 H5 Z M5 28 H12 V35 H5 Z"' + SW_SV + ' opacity=".75"/><path d="M17 9.5 H35 M17 20.5 H31 M17 31.5 H35"' + SW_SV + ' opacity=".8"/><path d="M5 17 H12 V24 H5 Z"' + SW_SV + '/><circle class="acc" cx="8.5" cy="20.5" r="2.4"/>',
  /* sliders (settings) */
  sliders:  '<path d="M5 11 H9.5 M18.5 11 H35 M5 29 H21.5 M30.5 29 H35"' + SW_SV + '/><circle cx="14" cy="11" r="4.5"' + SW_SV + '/><circle class="acc" cx="26" cy="29" r="4"/>',
  /* one lattice cell (a recipe) */
  cell:     '<path d="M20 4 L34 12 V28 L20 36 L6 28 V12 Z"' + SW_SV + '/><path d="M20 12 L27 16 V24 L20 28 L13 24 V16 Z"' + SW_SV + ' stroke-width="2" opacity=".55"/><circle class="acc" cx="20" cy="20" r="3.2"/>'
};
function swIcon(name) { return '<svg viewBox="0 0 40 40" aria-hidden="true">' + (SWEEP_ICONS[name] || '') + '</svg>'; }

/* Small line glyphs for buttons and markers — 16 × 16, currentColor. */
var SW_GS = ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
var SWEEP_GLYPHS = {
  play:   '<path d="M4.5 2.8 L12.8 8 L4.5 13.2 Z" fill="currentColor"/>',
  x:      '<path d="M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5"' + SW_GS + '/>',
  down:   '<path d="M8 2.5 V10 M4.8 6.8 L8 10 L11.2 6.8 M3 13.5 H13"' + SW_GS + '/>',
  chev:   '<path d="M4.5 6.2 L8 9.7 L11.5 6.2"' + SW_GS + '/>',
  next:   '<path d="M6.2 4.5 L9.7 8 L6.2 11.5"' + SW_GS + '/>',
  tick:   '<path d="M3.5 8.4 L6.7 11.5 L12.5 4.8"' + SW_GS + ' stroke-width="1.9"/>',
  up:     '<path d="M8 13 V3.5 M4.6 6.9 L8 3.5 L11.4 6.9"' + SW_GS + '/>',
  dn:     '<path d="M8 3 V12.5 M4.6 9.1 L8 12.5 L11.4 9.1"' + SW_GS + '/>',
  updn:   '<path d="M5.2 6.2 L8 3.4 L10.8 6.2 M5.2 9.8 L8 12.6 L10.8 9.8"' + SW_GS + '/>',
  copy:   '<path d="M5.5 5.5 H12.5 V13 H5.5 Z"' + SW_GS + '/><path d="M3.5 10.5 V3 H10"' + SW_GS + '/>',
  link:   '<path d="M7 9 L9 7"' + SW_GS + '/><path d="M8.6 4.6 L9.9 3.3 a2.4 2.4 0 0 1 3.4 3.4 L11.4 8.6 M4.6 7.4 L3.1 9 a2.4 2.4 0 0 0 3.4 3.4 L7.8 11.1"' + SW_GS + '/>',
  unlink: '<path d="M8.6 4.6 L9.9 3.3 a2.4 2.4 0 0 1 3.4 3.4 L11.4 8.6 M4.6 7.4 L3.1 9 a2.4 2.4 0 0 0 3.4 3.4 L7.8 11.1 M3 3 L4.6 4.6 M13 13 L11.4 11.4"' + SW_GS + '/>',
  flag:   '<path d="M4 14 V2.6 M4 3.2 H11.8 L10 6.2 L11.8 9.2 H4"' + SW_GS + '/>',
  upload: '<path d="M8 10.5 V3 M4.8 6.2 L8 3 L11.2 6.2 M3 13.5 H13"' + SW_GS + '/>',
  reset:  '<path d="M3.6 8 a4.4 4.4 0 1 0 1.3 -3.1 M3.4 2.6 V5.3 H6.1"' + SW_GS + '/>'
};
function swGlyph(name, cls) { return '<svg class="g' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true">' + (SWEEP_GLYPHS[name] || '') + '</svg>'; }

/* Run-button markup (62-run-sweep.js paints through these). The busy mark is
   F13LD.lab's spinner (brand hexagon + turning arcs). */
var SWEEP_RUN_IDLE = swGlyph('play') + '<span>Run sweep</span>';
var SWEEP_RUN_BUSY = '<svg class="dock-spin" width="15" height="15" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z" fill="none" stroke="#2c4e30" stroke-width="2.5"/><g class="arcs"><path d="M20 5 A15 15 0 0 1 34 18" fill="none" stroke="#c8f542" stroke-width="3.5" stroke-linecap="round"/><path d="M20 35 A15 15 0 0 1 6 22" fill="none" stroke="#1D9E75" stroke-width="3.5" stroke-linecap="round"/></g><circle cx="20" cy="20" r="3.4" fill="#c8f542"/></svg><span>Running</span>';
function setRunBtn(busy) {
  var b = document.getElementById('runBtn');
  if (!b) return;
  b.innerHTML = busy ? SWEEP_RUN_BUSY : SWEEP_RUN_IDLE;
  b.classList.toggle('running', !!busy);
}
/* Empty-state mark (results table, plot, preview). */
function swEmptyIcon() { return '<span class="empty-ico">' + swIcon('cell') + '</span>'; }

/* Fill [data-ico] / [data-g] placeholders in static markup. */
function swFillIcons(root) {
  var r = root || document, i, els = r.querySelectorAll('[data-ico]');
  for (i = 0; i < els.length; i++) els[i].innerHTML = swIcon(els[i].getAttribute('data-ico'));
  els = r.querySelectorAll('[data-g]');
  for (i = 0; i < els.length; i++) {
    var g = els[i].getAttribute('data-g'), lbl = els[i].getAttribute('data-label');
    els[i].innerHTML = swGlyph(g) + (lbl ? '<span>' + lbl + '</span>' : '');
  }
}

/* ── drawer state ─────────────────────────────────────────────── */
var DOCK_STATE = { open: false, tab: 'set', col: null, link: null };
var DOCK_STORE_KEY = 'f13ld.sweep.dock.v1';
var DOCK_LOG = { warn: 0, last: '' };

function dockSave() { try { localStorage.setItem(DOCK_STORE_KEY, JSON.stringify({ tab: DOCK_STATE.tab })); } catch (e) {} }
function dockLoad() {
  try {
    var s = JSON.parse(localStorage.getItem(DOCK_STORE_KEY) || 'null');
    if (s && (s.tab === 'set' || s.tab === 'log' || s.tab === 'key')) DOCK_STATE.tab = s.tab;
  } catch (e) {}
}

function toggleDrawer(open) {
  DOCK_STATE.open = (open == null) ? !DOCK_STATE.open : !!open;
  var d = document.getElementById('cfgDrawer'), b = document.getElementById('cfgBtn');
  if (!d || !b) return;
  if (!DOCK_STATE.open && typeof closeDropdowns === 'function') closeDropdowns();
  d.classList.toggle('open', DOCK_STATE.open);
  b.classList.toggle('open', DOCK_STATE.open);
  b.setAttribute('aria-expanded', DOCK_STATE.open ? 'true' : 'false');
  if (DOCK_STATE.open && DOCK_STATE.tab === 'log') dockLogBottom();
  if (DOCK_STATE.open && DOCK_STATE.tab === 'set' && typeof paintSettings === 'function') paintSettings();
}
function dockLogBottom() { var lb = document.getElementById('logBody'); if (lb) lb.scrollTop = lb.scrollHeight; }

/* Show a tab. From the dock (fromDock): open the drawer on it — and, for a
   settings tag, point at its column — or close it when that same tag's view
   is already showing. Old tab names (sweep/mat/solver/ranks) map to Settings. */
function dockTab(tab, fromDock) {
  var col = null;
  if (tab === 'sweep' || tab === 'scale' || tab === 'mat' || tab === 'solver' || tab === 'ranks') { col = tab; tab = 'set'; }
  if (fromDock && DOCK_STATE.open && DOCK_STATE.tab === tab && (tab !== 'set' || DOCK_STATE.col === col)) { toggleDrawer(false); return; }
  DOCK_STATE.tab = tab;
  DOCK_STATE.col = col;
  var drw = document.getElementById('cfgDrawer'); if (drw) drw.dataset.tab = tab;
  document.querySelectorAll('#drTabs .dr-tab').forEach(function (t) { var on = t.dataset.tab === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
  document.querySelectorAll('#cfgDrawer .dr-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === tab); });
  dockSave();
  if (!DOCK_STATE.open) toggleDrawer(true);
  else if (tab === 'log') dockLogBottom();
  else if (tab === 'set' && typeof paintSettings === 'function') paintSettings();
  /* point at the column the tag stands for */
  document.querySelectorAll('#cfgDrawer .dr-col').forEach(function (c) {
    c.classList.remove('hl');
    if (col && c.dataset.col === col) { void c.offsetWidth; c.classList.add('hl'); }
  });
}

function dockEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function dockVal(id) { var e = document.getElementById(id); return e ? e.value : ''; }
function dockSelText(id) { var e = document.getElementById(id); return (e && e.selectedIndex >= 0) ? e.options[e.selectedIndex].text : ''; }

/* ── dock tags ───────────────────────────────────────────────── */
function dockTag(col, ico, icoCls, inner, title, off) {
  return '<button class="dock-tag' + (off ? ' off' : '') + '" type="button" onclick="dockTab(\'' + col + '\', true)" title="' + dockEsc(title) + '">' +
    '<span class="ico ico-sm' + (icoCls ? ' ' + icoCls : '') + '">' + ico + '</span>' + inner + '</button>';
}
function updateDock() {
  var tags = [];
  var fam = (typeof SWEEP_FAMILIES !== 'undefined' && typeof baseFamily !== 'undefined' && baseFamily) ? SWEEP_FAMILIES[baseFamily] : null;
  /* sweep: designs · sampling · cell-scale range */
  var n = dockVal('samplesSlider'), samp = dockVal('samplingMethod') === 'uniform' ? 'random' : 'Sobol';
  var lo = [dockVal('scaleXlo'), dockVal('scaleYlo'), dockVal('scaleZlo')], hi = [dockVal('scaleXhi'), dockVal('scaleYhi'), dockVal('scaleZhi')];
  var range = (lo[0] === lo[1] && lo[1] === lo[2] && hi[0] === hi[1] && hi[1] === hi[2]) ? lo[0] + '–' + hi[0] + ' %' : 'per-axis ranges';
  if (fam && !fam.usesCellScale) range = 'field settings';
  /* v0.26.0 — the density window */
  var vl = dockVal('vfLo'), vh = dockVal('vfHi');
  if (fam && vl !== '' && vh !== '') range += ' · ρ ' + (+vl).toFixed(0) + '–' + (+vh).toFixed(0) + ' %';
  tags.push(dockTag('sweep', swIcon('sweep'), '', '<b>' + dockEsc(n) + '</b>designs · ' + samp + '<span class="rg"> · ' + dockEsc(range) + '</span>', 'Designs, sampling, cell-scale ranges and density window'));
  /* material */
  var matVisible = document.getElementById('materialGroup') && document.getElementById('materialGroup').style.display !== 'none';
  var dom = dockSelText('domainSel').split('/')[0].trim();
  var mat = matVisible ? dockSelText('materialSel').split('(')[0].trim() : 'Normalized';
  tags.push(dockTag('mat', swIcon('material'), 'mdl', '<b>' + dockEsc(mat) + '</b><span class="sub">' + dockEsc(dom) + '</span>', 'Application domain and material'));
  /* solver */
  var prec = (typeof getPrecisionMode === 'function' && getPrecisionMode() === 'rigorous') ? 'Rigorous' : 'Fast';
  var N = (typeof getSolverN === 'function') ? getSolverN() : 16;
  var st = (typeof gpuSolverStatus === 'function') ? gpuSolverStatus() : { gpu: null, text: '' };
  if (typeof swSettingsGpu === 'function') { swSettingsGpu(st); N = getSolverN(); }
  var hwCls = st.gpu === true ? 'ok' : st.gpu === false ? 'cpu' : '';
  tags.push(dockTag('solver', swIcon('solver'), '', '<b>' + prec + '</b>' + N + '³<span class="hw ' + hwCls + '">' + (st.gpu === true ? 'GPU' : st.gpu === false ? 'CPU' : '') + '</span>', 'Precision, grid and solver'));
  /* ranks */
  var dirs = (typeof directions !== 'undefined') ? directions : {};
  var bothOff = ['r2metric', 'r3metric'].every(function (id) { var v = dockVal(id); return !v || v === 'none'; });
  for (var r = 1; r <= 3; r++) {
    var k = dockVal('r' + r + 'metric'), off = !k || k === 'none';
    var rn = '<span class="rk-n r' + r + '">' + r + '</span>';
    if (bothOff && r === 3) continue;
    if (bothOff && r === 2) {   /* one tag for both unused ranks */
      tags.push('<button class="dock-tag off" type="button" onclick="dockTab(\'ranks\', true)" title="Ranks 2 and 3 are off"><span class="rk-n r2">2</span><span class="rk-n r3">3</span>off</button>');
      continue;
    }
    var info = (!off && typeof METRIC_INFO !== 'undefined' && METRIC_INFO[k]) ? METRIC_INFO[k] : null;
    var isMin = (dirs[r] || 'max') === 'min';
    var inner = off ? '<b>R' + r + '</b>off' : '<b>' + dockEsc(info ? info.sym : k) + '</b>' + swGlyph(isMin ? 'dn' : 'up', 'dir');
    tags.push('<button class="dock-tag' + (off ? ' off' : '') + '" type="button" onclick="dockTab(\'ranks\', true)" title="' +
      (off ? 'Rank ' + r + ' is off' : 'Rank ' + r + ': ' + dockEsc(info ? info.name : k) + (isMin ? ' (min)' : ' (max)')) + '">' + rn + inner + '</button>');
  }
  var dt = document.getElementById('dockTags'), th = tags.join('');
  if (dt._h !== th) { dt._h = th; dt.innerHTML = th; }
  /* drawer tab counts */
  var mk = document.getElementById('mvKey');
  if (mk) mk.textContent = (typeof tableColumnKeys === 'function') ? String(tableColumnKeys().keys.length) : '';
  /* solver line in the dock */
  var hw = document.getElementById('dockHw');
  if (hw) {
    hw.textContent = st.gpu === true ? st.text.split(' · ').slice(0, 2).join(' · ') : st.gpu === false ? 'CPU solver' : '';
    hw.title = st.text || '';
    hw.className = 'dock-hw' + (st.gpu === true ? ' green' : st.gpu === false ? ' warn' : '');
  }
  if (DOCK_STATE.open && DOCK_STATE.tab === 'set' && typeof paintSettings === 'function') paintSettings();
  if (typeof swSaveSettings === 'function') swSaveSettings();
}

/* ── log chip (05-log.js calls this for every line) ─────────── */
function dockLog(type, msg) {
  var txt = String(msg).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  if (/^Starting sweep/.test(txt)) DOCK_LOG.warn = 0;
  if (type === 'warn') DOCK_LOG.warn++;
  DOCK_LOG.last = txt;
  var m = document.getElementById('logChipMsg'), w = document.getElementById('logChipWarn'), mv = document.getElementById('mvLog');
  if (m) m.textContent = txt;
  var wt = DOCK_LOG.warn ? DOCK_LOG.warn + ' warning' + (DOCK_LOG.warn > 1 ? 's' : '') : '';
  if (w) w.textContent = wt;
  if (mv) { mv.textContent = wt; mv.classList.toggle('warn', !!DOCK_LOG.warn); }
}

/* ── results funnel (62-run-sweep.js) ───────────────────────── */
function renderFunnel(f) {
  var el = document.getElementById('funnel');
  if (!el) return;
  if (!f) { el.innerHTML = ''; return; }
  var sep = swGlyph('next', 'sep');
  var h = '<b>' + f.attempts + '</b> drawn ' + sep + ' <b>' + f.valid + '</b> valid';
  for (var r = 0; r < 3; r++) {
    var v = f.r[r];
    h += ' ' + sep + ' <span style="color:var(--rank' + (r + 1) + ')">R' + (r + 1) + '</span> ' + (v == null ? '<span class="off">off</span>' : '<b>' + v + '</b>');
  }
  if (f.flagged) h += ' <span class="fl"><span class="fl-dot"></span>' + f.flagged + ' flagged</span>';
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
  if (isBase) { kv.innerHTML = ''; fl.innerHTML = ''; fl.classList.remove('on'); return; }
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
  if (d.stiffness_flag) { fl.innerHTML = '<span class="fl-dot"></span>Stiffness may read high: ' + dockEsc(d.stiffness_flag_reasons || ''); fl.classList.add('on'); }
  else { fl.innerHTML = ''; fl.classList.remove('on'); }
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

  /* Escape closes an open menu first, then the drawer */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('#cfgDrawer .dd.open')) { closeDropdowns(); return; }
    if (DOCK_STATE.open) toggleDrawer(false);
  });

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
  swFillIcons();
  var run = document.getElementById('runBtn');
  if (run) setRunBtn(false);
  document.querySelectorAll('#drTabs .dr-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === DOCK_STATE.tab); });
  document.querySelectorAll('#cfgDrawer .dr-pane').forEach(function (p) { p.classList.toggle('on', p.dataset.pane === DOCK_STATE.tab); });
  document.getElementById('cfgDrawer').dataset.tab = DOCK_STATE.tab;
  if (typeof swLoadSettings === 'function') swLoadSettings();   /* before the first paint */
  if (typeof initSettings === 'function') initSettings();
  updateDock();
}
