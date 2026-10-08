/* ============================================================
   F13LD.sweep · 24-drawer.js   (v0.25.0)
   The Configure drawer's Settings panel: every setting on one panel, in
   five columns — Sweep · Cell scale · Material · Solver · Ranks — built
   from F13LD.lab's control kit (segmented buttons, chips, grouped
   drop-downs, help lines, icon tiles).

   The legacy controls stay in the page, hidden (#nativeCtl), with their
   ids and handlers; they hold the state. Every control here writes to them
   (value + the event their handlers listen for) and paints from them, so
   the sweep, the export and the test harness see exactly what they did.
   Top-level code only defines things (loads before the families / solver
   files; what they define is used at call time).
   ============================================================ */

/* ── native controls ───────────────────────────────────────────── */
function pxEl(id) { return document.getElementById(id); }
function pxSet(id, v, ev) {
  var e = pxEl(id);
  if (!e) return;
  e.value = v;
  e.dispatchEvent(new Event(ev || 'input', { bubbles: true }));
}
function pxNum(id) { var v = parseFloat(dockVal(id)); return isFinite(v) ? v : 0; }
function pxFam() { return (typeof SWEEP_FAMILIES !== 'undefined' && typeof baseFamily !== 'undefined' && baseFamily) ? SWEEP_FAMILIES[baseFamily] : null; }
function pxAfter() { updateDock(); }   /* repaints the dock tags and this panel */
/* innerHTML only when it changes, so a click that is under way keeps its target */
function pxHtml(el, h) { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } }

/* ── drop-downs (as F13LD.lab 51-dock.js) ──────────────────────── */
var DD_OPEN = null;

/* Rank metrics in groups. Keys not listed (a newer option) land in Other. */
var RANK_GROUPS = [
  { label: 'Stiffness', keys: ['Ex_GPa', 'Ey_GPa', 'Ez_GPa', 'stiffness_density', 'anisotropy', 'aniso_efficiency', 'directionality', 'ortho_contrast'] },
  { label: 'Shear · GPU solver', keys: ['Gyz_GPa', 'Gxz_GPa', 'Gxy_GPa'] },
  { label: 'Thermal', keys: ['keff_x', 'keff_y', 'keff_z', 'thermal_anisotropy', 'k_density'] },
  { label: 'Under the reference stress', keys: ['U_strain', 'microstrain_x', 'microstrain_y', 'microstrain_z', 'microstrain_avg'] },
  { label: 'Pores & connectivity', keys: ['connect_idx', 'pore_size', 'throat_size', 'throat_ratio', 'perc_idx'] },
  { label: 'Material use', keys: ['volume_fraction'] }
];

function ddRankGroups(r) {
  var sel = pxEl('r' + r + 'metric'), vals = [], i, g, out = [];
  for (i = 0; i < sel.options.length; i++) vals.push(sel.options[i].value);
  if (vals.indexOf('none') >= 0) out.push({ label: null, items: [{ v: 'none', name: 'Off', sub: 'This rank is skipped' }] });
  var used = {};
  var item = function (k) {
    var info = METRIC_INFO[k], txt = '';
    for (var j = 0; j < sel.options.length; j++) if (sel.options[j].value === k) txt = sel.options[j].text;
    used[k] = true;
    return { v: k, name: info ? info.name : txt, em: info ? info.sym : '', sub: info ? info.desc : '' };
  };
  for (g = 0; g < RANK_GROUPS.length; g++) {
    var items = RANK_GROUPS[g].keys.filter(function (k) { return vals.indexOf(k) >= 0; }).map(item);
    if (items.length) out.push({ label: RANK_GROUPS[g].label, items: items });
  }
  var rest = vals.filter(function (k) { return k !== 'none' && !used[k]; }).map(item);
  if (rest.length) out.push({ label: 'Other', items: rest });
  return out;
}

function ddDomainGroups() {
  var sel = pxEl('domainSel'), items = [];
  for (var i = 0; i < sel.options.length; i++) {
    var v = sel.options[i].value, cfg = DOMAIN_CONFIG[v] || {}, mats = DOMAIN_MATERIALS[v] || [];
    var sub;
    if (!mats.length) sub = 'Normalized solid · every metric in the table · ranks unchanged';
    else {
      var rk = ['r1', 'r2', 'r3'].map(function (r) { var c = cfg[r]; return c ? ((METRIC_INFO[c.metric] || {}).sym || c.metric) + ' ' + c.dir : null; }).filter(Boolean);
      sub = mats.map(function (m) { return MATERIALS[m].label; }).join(', ') + (rk.length ? ' · ranks ' + rk.join(', ') : '');
    }
    items.push({ v: v, name: sel.options[i].text, sub: sub });
  }
  return [{ label: null, items: items }];
}

function matSub(m) { return 'E ' + m.E + ' GPa · ν ' + m.nu + ' · k ' + m.k + ' W/m·K · ' + m.rho_mat + ' kg/m³'; }
function ddMaterialGroups() {
  var sel = pxEl('materialSel'), items = [];
  for (var i = 0; i < sel.options.length; i++) {
    var m = MATERIALS[sel.options[i].value];
    items.push({ v: sel.options[i].value, name: m ? m.label : sel.options[i].text, sub: m ? matSub(m) : '' });
  }
  return [{ label: null, items: items }];
}

/* key → { groups, value, disabled, label (when disabled) } */
function ddSpec(key) {
  if (key === 'domain') return { groups: ddDomainGroups(), value: dockVal('domainSel') };
  if (key === 'material') {
    var on = pxEl('materialGroup').style.display !== 'none';
    return on ? { groups: ddMaterialGroups(), value: dockVal('materialSel') }
              : { groups: [], value: null, disabled: true, label: 'Normalized' };
  }
  var r = +key.slice(2, 3);
  return { groups: ddRankGroups(r), value: dockVal('r' + r + 'metric') };
}
function ddFind(groups, v) {
  for (var i = 0; i < groups.length; i++) for (var j = 0; j < groups[i].items.length; j++) if (groups[i].items[j].v === v) return groups[i].items[j];
  return null;
}

function renderDd(key) {
  var host = pxEl(key + 'Dd');
  if (!host) return;
  var spec = ddSpec(key), cur = ddFind(spec.groups, spec.value);
  var open = DD_OPEN === key && !spec.disabled;
  host.classList.toggle('open', open);
  host.classList.toggle('dis', !!spec.disabled);
  var label = spec.disabled ? spec.label : cur ? dockEsc(cur.name) + (cur.em ? '<em>' + dockEsc(cur.em) + '</em>' : '') : '—';
  var off = key.indexOf('rk') === 0 && spec.value === 'none';
  var h = '<button type="button" class="dd-btn' + (off ? ' off' : '') + '" onclick="toggleDd(\'' + key + '\', event)" aria-haspopup="listbox" aria-expanded="' + open + '"' +
    (spec.disabled ? ' disabled' : '') + ' title="' + dockEsc(cur ? cur.name + (cur.sub ? ' — ' + cur.sub : '') : '') + '">' +
    '<span class="val">' + label + '</span>' + swGlyph('chev', 'chev') + '</button>';
  if (open) {
    h += '<div class="dd-menu" role="listbox">';
    for (var i = 0; i < spec.groups.length; i++) {
      var g = spec.groups[i];
      if (g.label) h += '<div class="dd-grp">' + dockEsc(g.label) + '</div>';
      for (var j = 0; j < g.items.length; j++) {
        var it = g.items[j], on = it.v === spec.value;
        h += '<button type="button" role="option" aria-selected="' + on + '" class="dd-opt' + (on ? ' on' : '') + '" onclick="pickDd(\'' + key + '\', \'' + it.v + '\', event)">' +
          '<span class="tick">' + (on ? swGlyph('tick') : '') + '</span><span class="dd-txt"><span class="nm">' + dockEsc(it.name) + (it.em ? '<em>' + dockEsc(it.em) + '</em>' : '') + '</span>' +
          (it.sub ? '<small>' + dockEsc(it.sub) + '</small>' : '') + '</span></button>';
      }
    }
    h += '</div>';
  }
  if (host._h === h) return;   /* unchanged: keep the button (a click may be under way) */
  host._h = h;
  host.innerHTML = h;
  if (open) {
    ddPlace(host);
    var o = host.querySelector('.dd-opt.on'); if (o && o.scrollIntoView) o.scrollIntoView({ block: 'nearest' });
  }
}
/* The menu is fixed to the viewport, above its button (or below when there
   is more room there), so the drawer may scroll without clipping it. */
function ddPlace(host) {
  var menu = host.querySelector('.dd-menu'), btn = host.querySelector('.dd-btn');
  if (!menu || !btn) return;
  var r = btn.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  var w = Math.min(Math.max(r.width, Math.min(menu.scrollWidth + 2, 420)), vw - 24);
  var above = r.top - 12, below = vh - r.bottom - 12, up = above >= Math.min(340, below) || above > below;
  menu.style.width = w + 'px';
  menu.style.left = Math.max(12, Math.min(vw - w - 12, host.classList.contains('dd-r') ? r.right - w : r.left)) + 'px';
  menu.style.maxHeight = Math.max(120, Math.min(340, up ? above : below)) + 'px';
  if (up) { menu.style.bottom = (vh - r.top + 6) + 'px'; menu.style.top = 'auto'; }
  else { menu.style.top = (r.bottom + 6) + 'px'; menu.style.bottom = 'auto'; }
}
function toggleDd(key, ev) {
  if (ev) ev.stopPropagation();
  var was = DD_OPEN === key;
  closeDropdowns();
  if (!was) { DD_OPEN = key; renderDd(key); }
}
function closeDropdowns() {
  if (!DD_OPEN) return;
  var k = DD_OPEN;
  DD_OPEN = null;
  renderDd(k);
}
function pickDd(key, v, ev) {
  if (ev) ev.stopPropagation();
  DD_OPEN = null;
  if (key === 'domain') pxSet('domainSel', v, 'change');          /* onDomainChange() */
  else if (key === 'material') pxSet('materialSel', v, 'change');  /* onMaterialChange() */
  else pxSet('r' + key.slice(2, 3) + 'metric', v, 'change');      /* updateRankActiveState() */
  pxAfter();
}

/* ── cell scale ────────────────────────────────────────────────── */
var SC_AX = ['X', 'Y', 'Z'];
var SC_MIN = 10, SC_MAX = 500;   /* the bar's log span, % of nominal */
function scVals() {
  return SC_AX.map(function (a) { return [pxNum('scale' + a + 'lo'), pxNum('scale' + a + 'hi')]; });
}
function scLinked() {
  if (typeof DOCK_STATE.link === 'boolean') return DOCK_STATE.link;
  var v = scVals();
  return v[0][0] === v[1][0] && v[1][0] === v[2][0] && v[0][1] === v[1][1] && v[1][1] === v[2][1];
}
function scPos(v) {
  var t = (Math.log(Math.max(SC_MIN, Math.min(SC_MAX, v))) - Math.log(SC_MIN)) / (Math.log(SC_MAX) - Math.log(SC_MIN));
  return (t * 100).toFixed(2) + '%';
}
function scFromPos(t) {
  var v = Math.exp(Math.log(SC_MIN) + Math.max(0, Math.min(1, t)) * (Math.log(SC_MAX) - Math.log(SC_MIN)));
  return v >= 20 ? Math.round(v / 5) * 5 : Math.round(v);
}
/* write one end of one axis (or all three when linked) */
function scWrite(ax, end, v) {
  var axes = ax === 'all' ? SC_AX : [ax];
  axes.forEach(function (a) { pxSet('scale' + a + end, v, 'input'); });   /* updateScalePreview() */
}
function scRowsHtml(linked) {
  var rows = linked ? [['all', '<span class="ax all"><i class="x">X</i><i class="y">Y</i><i class="z">Z</i></span>']]
                    : SC_AX.map(function (a) { return [a, '<span class="ax ' + a.toLowerCase() + '">' + a + '</span>']; });
  return rows.map(function (r) {
    return '<div class="sc-row" data-ax="' + r[0] + '">' + r[1] +
      '<span class="num-u"><input class="num" data-px="sc" data-ax="' + r[0] + '" data-end="lo" type="number" min="1" max="500" step="5" aria-label="' + (r[0] === 'all' ? 'X, Y and Z' : r[0]) + ' minimum, % of nominal"><i>%</i></span>' +
      '<div class="sc-bar" data-ax="' + r[0] + '" title="Drag the ends · log scale, 10 – 500 %"><span class="trk"></span><span class="nom" style="left:' + scPos(100) + '"></span><span class="band"></span><span class="h lo"></span><span class="h hi"></span></div>' +
      '<span class="num-u"><input class="num" data-px="sc" data-ax="' + r[0] + '" data-end="hi" type="number" min="1" max="500" step="5" aria-label="' + (r[0] === 'all' ? 'X, Y and Z' : r[0]) + ' maximum, % of nominal"><i>%</i></span>' +
      '</div>';
  }).join('');
}
function pxToggleLink() {
  var linked = !scLinked();
  if (linked) {   /* one range: X's range for all three */
    var v = scVals();
    scWrite('all', 'lo', v[0][0]);
    scWrite('all', 'hi', v[0][1]);
  }
  DOCK_STATE.link = linked;
  dockSave();
  pxAfter();
}
function paintScale() {
  var host = pxEl('pxScale'), linked = scLinked();
  if (host.dataset.mode !== (linked ? 'one' : 'axes')) { host.innerHTML = scRowsHtml(linked); host.dataset.mode = linked ? 'one' : 'axes'; }
  var v = scVals();
  host.querySelectorAll('.sc-row').forEach(function (row) {
    var ax = row.dataset.ax, i = ax === 'all' ? 0 : SC_AX.indexOf(ax), lo = v[i][0], hi = v[i][1];
    row.querySelectorAll('input.num').forEach(function (inp) { if (document.activeElement !== inp) inp.value = inp.dataset.end === 'lo' ? lo : hi; });
    var bar = row.querySelector('.sc-bar');
    bar.querySelector('.band').style.left = scPos(Math.min(lo, hi));
    bar.querySelector('.band').style.right = (100 - parseFloat(scPos(Math.max(lo, hi)))).toFixed(2) + '%';
    bar.querySelector('.h.lo').style.left = scPos(lo);
    bar.querySelector('.h.hi').style.left = scPos(hi);
    row.classList.toggle('bad', !(lo > 0 && hi >= lo));
  });
  scViz(v, linked);
  var link = pxEl('pxLink');
  pxHtml(link, swGlyph(linked ? 'link' : 'unlink') + '<span>' + (linked ? 'One range' : 'Per axis') + '</span>');
  link.classList.toggle('on', linked);
  link.setAttribute('aria-pressed', linked ? 'true' : 'false');
  /* absolute values + hint */
  var fam = pxFam(), f = pxEl('fScale'), abs = pxEl('scAbs'), hint = pxEl('hScale');
  var na = !!(fam && !fam.usesCellScale);
  f.classList.toggle('na', na);
  link.disabled = na;
  if (na) {
    abs.innerHTML = '';
    hint.textContent = fam.label + ' recipes have no cell scale — their own field settings are swept instead.';
    return;
  }
  if (fam && typeof baseRecipe !== 'undefined' && baseRecipe) {
    var nom = fam.nominalScale(baseRecipe), unit = baseFamily === 'beam' ? ' mm' : '';
    var fmt = function (p) { return +(nom * p / 100).toFixed(3); };
    abs.innerHTML = linked
      ? '<span class="lbl">Cell</span>' + fmt(v[0][0]) + swGlyph('next', 'sep') + fmt(v[0][1]) + unit + '<span class="t3">nominal ' + (+nom.toFixed(4)) + unit + '</span>'
      : SC_AX.map(function (a, i) { return '<span class="ax ' + a.toLowerCase() + '">' + a + '</span>' + fmt(v[i][0]) + swGlyph('next', 'sep') + fmt(v[i][1]); }).join('<span class="gap"></span>') + unit;
  } else abs.innerHTML = '';
  hint.textContent = (linked
    ? 'One range for X, Y and Z — each axis still draws its own scale, so cells stretch.'
    : 'Each axis draws its scale from its own range.') +
    (baseFamily === 'beam' ? ' Beams: the strut radius uses the same range.' : '');
}

/* The cells a sweep can draw, to scale (front view, X across, Y up): the
   smallest, the recipe's own, the largest and the most stretched. */
function scViz(v, linked) {
  var svg = pxEl('scViz');
  if (!svg) return;
  var fam = pxFam();
  if (fam && !fam.usesCellScale) { svg.innerHTML = ''; svg.style.display = 'none'; return; }
  svg.style.display = '';
  var lo = v.map(function (a) { return Math.max(1, Math.min(a[0], a[1])); }), hi = v.map(function (a) { return Math.max(a[0], a[1], 1); });
  /* most stretched: the longest high over the shortest low on two different axes */
  var best = { r: 1, a: 0, b: 1 };
  for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) if (a !== b && hi[a] / lo[b] > best.r) best = { r: hi[a] / lo[b], a: a, b: b };
  var big = Math.max(hi[0], hi[1], 100), H = 52, k = H / big;
  var cells = [
    { w: lo[0], h: lo[1], t: 'smallest' },
    { w: 100, h: 100, t: 'recipe', nom: true },
    { w: hi[0], h: hi[1], t: 'largest' },
    { w: hi[best.a], h: lo[best.b], t: (best.r >= 9.95 ? Math.round(best.r) : +best.r.toFixed(1)) + ' : 1', st: true, ax: 'XYZ'[best.a] + '/' + 'XYZ'[best.b] }
  ];
  var x = 0, gap = 18, h = '';
  cells.forEach(function (c) {
    var w = Math.max(2, c.w * k), hh = Math.max(2, c.h * k), cx = x + Math.max(w, 34) / 2;
    h += '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + (H - hh + 1).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="1.5" class="' + (c.nom ? 'nom' : c.st ? 'st' : 'c') + '"/>';
    h += '<text x="' + cx.toFixed(1) + '" y="' + (H + 14) + '" text-anchor="middle"' + (c.st ? ' class="stt"' : '') + '>' + c.t + '</text>';
    if (c.st && !linked) h += '<text x="' + cx.toFixed(1) + '" y="' + (H + 25) + '" text-anchor="middle" class="ax2">' + c.ax + '</text>';
    x += Math.max(w, 34) + gap;
  });
  svg.setAttribute('viewBox', '0 0 ' + Math.max(1, x - gap) + ' ' + (H + (linked ? 18 : 28)));
  svg.setAttribute('width', Math.max(1, x - gap));
  svg.setAttribute('height', H + (linked ? 18 : 28));
  svg.innerHTML = h;
}

/* drag the ends of a range bar */
function scDrag(ev) {
  var bar = ev.target.closest && ev.target.closest('.sc-bar');
  if (!bar || pxEl('fScale').classList.contains('na')) return;
  ev.preventDefault();
  var ax = bar.dataset.ax, i = ax === 'all' ? 0 : SC_AX.indexOf(ax);
  var rect = bar.getBoundingClientRect();
  var t0 = (ev.clientX - rect.left) / rect.width, v = scVals()[i];
  var pl = parseFloat(scPos(v[0])) / 100, ph = parseFloat(scPos(v[1])) / 100;
  var end = Math.abs(t0 - pl) <= Math.abs(t0 - ph) ? 'lo' : 'hi';
  if (pl === ph) end = t0 < pl ? 'lo' : 'hi';
  bar.classList.add('drag');
  var move = function (e) {
    var t = (e.clientX - rect.left) / rect.width, val = scFromPos(t), cur = scVals()[i];
    if (end === 'lo') val = Math.min(val, cur[1]); else val = Math.max(val, cur[0]);
    if (val !== cur[end === 'lo' ? 0 : 1]) { scWrite(ax, end, val); pxAfter(); }
  };
  var up = function () { bar.classList.remove('drag'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  move(ev);
}

/* ── segmented buttons ─────────────────────────────────────────── */
function paintSeg(group, value, disabled) {
  var g = document.querySelector('#setPane .seg[data-seg="' + group + '"]');
  if (!g) return;
  g.querySelectorAll('button').forEach(function (b) {
    var on = b.dataset.v === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.disabled = !!(disabled && disabled(b.dataset.v));
  });
}
function onSeg(btn) {
  var group = btn.parentNode.dataset.seg, v = btn.dataset.v;
  if (group === 'n') pxSet('samplesSlider', v, 'input');
  else if (group === 'samp') pxSet('samplingMethod', v, 'change');
  else if (group === 'prec') setPrecisionUI(v);
  else if (group === 'grid') setResolutionUI(+v);
  else if (/^dir\d$/.test(group)) setDirBtn(+group.slice(3), v);
  pxAfter();
}

/* ── number fields ─────────────────────────────────────────────── */
function onNum(inp, commit) {
  var k = inp.dataset.px, raw = inp.value, v = parseFloat(raw);
  if (k === 'n') {
    if (!commit || !isFinite(v)) return;
    v = Math.max(10, Math.min(1000, Math.round(v / 10) * 10));
    pxSet('samplesSlider', v, 'input');
    inp.value = dockVal('samplesSlider');
  } else if (k === 'sc') {
    if (!isFinite(v) || v <= 0) return;
    if (commit) { v = Math.max(1, Math.min(500, v)); inp.value = v; }
    scWrite(inp.dataset.ax, inp.dataset.end, v);
  } else if (k === 'sigma') { if (isFinite(v) && v > 0) pxSet('sigmaRef', raw, 'input'); }
  else if (k === 'cell') { if (isFinite(v) && v > 0) pxSet('cellSize', raw, 'input'); }
  else if (k === 'keep2' || k === 'keep3') {
    if (raw !== '' && (!isFinite(v) || v < 1 || v > 100)) { if (!commit) return; v = Math.max(1, Math.min(100, Math.round(v) || 100)); inp.value = v; raw = String(v); }
    pxSet('r' + k.slice(4) + 'keep', raw, 'input');
  }
  pxAfter();
}

/* ── paint: native state → every control here ──────────────────── */
function pxVal(id, v) { var e = pxEl(id); if (e && document.activeElement !== e) e.value = v; }
function paintSettings() {
  if (!pxEl('setPane')) return;
  var fam = pxFam();
  /* sweep */
  var loaded = pxEl('recipeCard') && pxEl('recipeCard').classList.contains('loaded');
  pxEl('drRecipeName').textContent = loaded ? pxEl('fileName').textContent : 'No recipe loaded';
  pxEl('drRecipeMeta').textContent = loaded ? pxEl('fileMeta').textContent : 'Drop a JSON anywhere on the page';
  var n = dockVal('samplesSlider');
  paintSeg('n', n);
  pxVal('pxN', n);
  var samp = dockVal('samplingMethod');
  paintSeg('samp', samp);
  pxEl('hSamp').textContent = samp === 'uniform' ? 'Independent uniform draws.' : 'Low-discrepancy: even coverage, best at small counts.';
  /* cell scale */
  paintScale();
  /* material */
  renderDd('domain');
  renderDd('material');
  var matOn = pxEl('materialGroup').style.display !== 'none', dom = dockVal('domainSel');
  var m = matOn ? MATERIALS[dockVal('materialSel')] : null;
  pxEl('hMat').textContent = m ? matSub(m) : 'General keeps the solid normalized (E from the recipe, k = 1) — pick a domain for a real material.';
  var sigOn = pxEl('sigmaRefGroup').style.display !== 'none';
  pxEl('fSigma').classList.toggle('na', !sigOn);
  pxEl('pxSigma').disabled = !sigOn;
  pxVal('pxSigma', sigOn ? dockVal('sigmaRef') : '');
  pxEl('pxSigma').placeholder = sigOn ? '' : '—';
  pxVal('pxCell', dockVal('cellSize'));
  pxEl('hRef').textContent = (sigOn ? 'Stress drives the strain metrics; '
    : dom === 'thermal' ? 'Thermal needs no load; ' : 'General is normalized, no stress; ') + 'cell size gives pores in µm.';
  /* solver */
  var st = (typeof gpuSolverStatus === 'function') ? gpuSolverStatus() : { gpu: null, text: '' };
  var box = pxEl('pxSolver');
  box.className = 'st-box' + (st.gpu === true ? ' ok' : st.gpu === false ? ' cpu' : '');
  box.querySelector('.st-txt').textContent = st.text ? st.text.replace(/^Solver:\s*/, '') : 'Checking for a GPU…';
  box.title = st.text || '';
  pxEl('hSolver').textContent = st.gpu === true
    ? 'F13LD.lab\'s solver: full 6 × 6 stiffness + thermal. ?gpu=0 forces the CPU.'
    : st.gpu === false ? 'Normal stiffness + thermal. Shear and 64³ need a GPU.' : '';
  var prec = getPrecisionMode(), N = getSolverN();
  paintSeg('prec', prec);
  paintSeg('grid', N, function (v) { return v === '64' && st.gpu !== true; });
  var g64 = document.querySelector('#setPane .seg[data-seg="grid"] button[data-v="64"]');
  if (g64) g64.title = st.gpu === true ? '64 voxels per cell edge (GPU)' : '64³ needs the GPU solver';
  pxEl('hPrec').textContent = st.gpu === true
    ? (prec === 'fast' ? 'Pores 1e-3 of the solid, CG 1e-3, metrics 48³; propped-up axes are flagged.'
                       : 'F13LD.lab\'s sweep settings: pores 1e-6, CG 1e-4. Slower.')
    : (prec === 'fast' ? 'Pores 1e-3 of the solid; about 3× faster, rankings hold.'
                       : 'Pores 1e-4 of the solid, for absolute stiffness values.');
  pxEl('hGrid').textContent = (N === 16 ? 'Fastest.' : N === 32 ? 'Resolves thin walls; several times slower.' : 'Fine walls and struts; GPU only.') +
    ' PI-TPMS and beams use 32³ or finer.';
  /* ranks */
  for (var r = 1; r <= 3; r++) {
    renderDd('rk' + r);
    var off = (dockVal('r' + r + 'metric') || 'none') === 'none';
    paintSeg('dir' + r, (typeof directions !== 'undefined' && directions[r]) || 'max', function () { return off; });
    if (r > 1) {
      var kp = pxEl('pxKeep' + r);
      kp.disabled = off;
      pxVal('pxKeep' + r, dockVal('r' + r + 'keep'));
      kp.parentNode.classList.toggle('na', off);
    }
  }
}

/* called from initDock (23-dock.js) */
function initSettings() {
  var pane = pxEl('setPane');
  if (!pane) return;
  pane.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.seg button');
    if (b && !b.disabled && pane.contains(b)) onSeg(b);
  });
  pane.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('input.num[data-px]')) onNum(e.target, false); });
  pane.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('input.num[data-px]')) onNum(e.target, true); });
  pane.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.num[data-px]')) e.target.blur(); });
  pane.addEventListener('pointerdown', scDrag);
  document.addEventListener('click', function (e) { if (DD_OPEN && !(e.target.closest && e.target.closest('.dd'))) closeDropdowns(); });
  pxEl('cfgDrawer').addEventListener('scroll', function (e) { if (DD_OPEN && !(e.target.closest && e.target.closest('.dd-menu'))) closeDropdowns(); }, true);
  window.addEventListener('resize', closeDropdowns);
  paintSettings();
}
