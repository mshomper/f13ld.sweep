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
  /* hint */
  var fam = pxFam(), f = pxEl('fScale'), hint = pxEl('hScale');
  var na = !!(fam && !fam.usesCellScale);
  f.classList.toggle('na', na);
  link.disabled = na;
  if (na) { hint.textContent = fam.label + ' recipes have no cell scale — their own field settings are swept instead.'; return; }
  hint.textContent = (linked
    ? 'One range for X, Y and Z — each axis still draws its own scale, so cells stretch.'
    : 'Each axis draws its scale from its own range.') +
    (baseFamily === 'beam' ? ' Beams: the strut radius follows the density.' : '') +
    (baseFamily === 'foam' ? ' Foam: the tile stays a cube — these ranges stretch the cells inside it.' : '');
}

/* The most stretched cell the sweep can draw, as a small isometric wireframe
   (edges in the axis colours) over the recipe's own cell (dashed), redrawn on
   every change. Most stretched = the longest high end over the shortest low
   end on two different axes — also the voxel aspect the solver sees, as the
   grid stays N × N × N. */
function scIso(d, k, ox, oy) {
  var c = Math.cos(Math.PI / 6);
  var P = function (x, y, z) { return [ox + (x - y) * c * k, oy + (x + y) * 0.5 * k - z * k]; };
  var X = d[0], Y = d[1], Z = d[2];
  return { o: P(0, 0, 0), x: P(X, 0, 0), y: P(0, Y, 0), xy: P(X, Y, 0), z: P(0, 0, Z), xz: P(X, 0, Z), yz: P(0, Y, Z), xyz: P(X, Y, Z) };
}
function scCuboid(d, k, ox, oy, nom) {
  var v = scIso(d, k, ox, oy), h = '';
  var ln = function (a, b, cls) { return '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" class="' + cls + '"/>'; };
  var cx = nom ? 'n' : 'ex', cy = nom ? 'n' : 'ey', cz = nom ? 'n' : 'ez';
  /* the nine edges seen from +x +y, above */
  h += ln(v.y, v.xy, cx) + ln(v.yz, v.xyz, cx) + ln(v.z, v.xz, cx);
  h += ln(v.x, v.xy, cy) + ln(v.xz, v.xyz, cy) + ln(v.z, v.yz, cy);
  h += ln(v.x, v.xz, cz) + ln(v.y, v.yz, cz) + ln(v.xy, v.xyz, cz);
  if (!nom) h = '<path class="top" d="M' + v.z + ' L' + v.xz + ' L' + v.xyz + ' L' + v.yz + ' Z"/>' + h;
  return h;
}
function scViz(v, linked) {
  var svg = pxEl('scViz'), txt = pxEl('scVizTxt'), box = pxEl('scVz');
  if (!svg) return;
  var fam = pxFam();
  if (fam && !fam.usesCellScale) { box.style.display = 'none'; return; }
  box.style.display = '';
  var lo = v.map(function (a) { return Math.max(1, Math.min(a[0], a[1])); }), hi = v.map(function (a) { return Math.max(a[0], a[1], 1); });
  var best = { r: 1, a: 0, b: 1 };
  for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) if (a !== b && hi[a] / lo[b] > best.r) best = { r: hi[a] / lo[b], a: a, b: b };
  var third = 3 - best.a - best.b, d = [0, 0, 0];
  d[best.a] = hi[best.a]; d[best.b] = lo[best.b]; d[third] = lo[third];
  /* fit both cells (sharing the back-bottom corner) into the box */
  var W = 96, H = 64, pad = 3, pts = [];
  [d, [100, 100, 100]].forEach(function (q) { var p = scIso(q, 1, 0, 0); for (var key in p) pts.push(p[key]); });
  var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
  var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  var k = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
  var ox = pad - minX * k + ((W - 2 * pad) - (maxX - minX) * k) / 2, oy = pad - minY * k + ((H - 2 * pad) - (maxY - minY) * k) / 2;
  pxHtml(svg, scCuboid([100, 100, 100], k, ox, oy, true) + scCuboid(d, k, ox, oy, false));
  /* sizes: the recipe's units when one is loaded (beams in mm), else % */
  var nom = null, unit = ' %';
  if (fam && typeof baseRecipe !== 'undefined' && baseRecipe) { nom = fam.nominalScale(baseRecipe); unit = baseFamily === 'beam' ? ' mm' : ''; }
  var sz = function (p) { return nom == null ? String(Math.round(p)) : String(+(nom * p / 100).toFixed(3)); };
  var rt = best.r >= 9.95 ? Math.round(best.r) : +best.r.toFixed(1);
  pxHtml(txt, SC_AX.map(function (ax, i) { return '<span class="ax ' + ax.toLowerCase() + '">' + ax + '</span> ' + sz(d[i]); }).join('<span class="gap"></span>') + unit +
    '<br><span class="t3">most stretched</span> <b>' + rt + ' : 1</b>' + (linked ? '' : ' <span class="t3">' + 'XYZ'[best.a] + ' over ' + 'XYZ'[best.b] + '</span>') +
    '<br><span class="t3">dashed = the recipe\'s cell' + (nom == null ? '' : ' (' + (+nom.toFixed(4)) + unit + ')') + '</span>');
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
  else if (group === 'vary') pxSet('variationMode', v, 'change');
  else if (group === 'spread') { pxSet('spreadPct', v, 'input'); updateDensityAuto(); }
  else if (group === 'dens') { pxSet('vfAuto', v === 'auto' ? '1' : '0', 'input'); if (v === 'auto') updateDensityAuto(); }
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
  } else if (k === 'spread') {
    if (!isFinite(v) || v <= 0) return;
    if (commit) { v = Math.max(1, Math.min(90, Math.round(v))); inp.value = v; }
    pxSet('spreadPct', v, 'input');
    updateDensityAuto();
  } else if (k === 'vflo' || k === 'vfhi') {
    if (!isFinite(v) || v <= 0) return;
    var b = densityBounds();
    if (commit) { v = Math.max(b.lo * 100, Math.min(b.hi * 100, v)); inp.value = +v.toFixed(1); }
    pxSet('vfAuto', '0', 'input');
    pxSet(k === 'vflo' ? 'vfLo' : 'vfHi', +v.toFixed(1), 'input');
    if (commit) {   /* keep the ends in order */
      var lo = parseFloat(dockVal('vfLo')), hi = parseFloat(dockVal('vfHi'));
      if (lo > hi) pxSet(k === 'vflo' ? 'vfHi' : 'vfLo', +v.toFixed(1), 'input');
    }
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
  /* v0.26.0 — variation, spread, density window */
  var vary = dockVal('variationMode') === 'explore' ? 'explore' : 'neighbourhood';
  paintSeg('vary', vary);
  pxEl('hVary').textContent = vary === 'explore'
    ? 'Wider redraw: TPMS terms and frequencies, fresh random seeds, noise octaves, beam nodes. Designs can stop looking like the recipe.'
    : 'The recipe keeps its identity — terms, phases, seed, topology — and its settings move around their own values.';
  var sp = dockVal('spreadPct');
  paintSeg('spread', sp);
  pxVal('pxSpread', sp);
  var dAuto = dockVal('vfAuto') === '1';
  pxVal('pxVfLo', dockVal('vfLo'));
  pxVal('pxVfHi', dockVal('vfHi'));
  paintSeg('dens', dAuto ? 'auto' : 'set');
  var db = (typeof baseRecipe !== 'undefined' && baseRecipe) ? densityBounds() : null;
  pxEl('fDens').classList.toggle('na', !db);
  pxEl('hDens').textContent = !db ? 'Load a recipe to set the density window.'
    : 'Solid % drawn for each design; its ' + ((densityKnob(baseRecipe) || { name: 'thickness' }).name.replace(' ×', '').replace('_', ' ')) + ' is set to hit it. ' +
      (baseDensity != null ? 'Recipe ' + (baseDensity * 100).toFixed(1) + ' %' + (dAuto ? ' ± spread' : '') + ' · ' : '') +
      'solver range ' + Math.round(db.lo * 100) + '–' + Math.round(db.hi * 100) + ' %.';
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
  /* v0.26.0 — only a real keystroke in a density field switches the window to Set */
  var numEv = function (e, commit) {
    if (!(e.target.matches && e.target.matches('input.num[data-px]'))) return;
    if (!e.isTrusted && (e.target.dataset.px === 'vflo' || e.target.dataset.px === 'vfhi')) return;
    onNum(e.target, commit);
  };
  pane.addEventListener('input', function (e) { numEv(e, false); });
  pane.addEventListener('change', function (e) { numEv(e, true); });
  pane.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.num[data-px]')) e.target.blur(); });
  pane.addEventListener('pointerdown', scDrag);
  document.addEventListener('click', function (e) { if (DD_OPEN && !(e.target.closest && e.target.closest('.dd'))) closeDropdowns(); });
  pxEl('cfgDrawer').addEventListener('scroll', function (e) { if (DD_OPEN && !(e.target.closest && e.target.closest('.dd-menu'))) closeDropdowns(); }, true);
  window.addEventListener('resize', closeDropdowns);
  paintSettings();
}

/* ── settings remembered per browser (as F13LD.lab v0.24.0) ─────────
   Everything in the Settings panel: designs, sampling, variation and spread
   (v0.26.0 — not the density window: it follows the recipe), cell-scale ranges and
   the one-range / per-axis choice, domain, material, reference stress, cell
   size, precision, grid, ranks (metric, direction, keep top %). Saved on
   every change; nothing saved (new browser, cleared data, private window) →
   the page's defaults. Reset puts the defaults back and forgets the saved
   copy. ?fresh=1 (or window.SWEEP_SETTINGS = false, used by the test harness
   and bench) skips both loading and saving. */
var SW_SETTINGS_KEY = 'f13ld.sweep.settings.v1';
var SW_SETTINGS = { loaded: false, defaults: null, pending64: false };
function swSettingsOff() { return window.SWEEP_SETTINGS === false || /[?&]fresh=1\b/.test(location.search); }
function swHasOpt(id, v) { var e = pxEl(id); if (!e) return false; for (var i = 0; i < e.options.length; i++) if (e.options[i].value === v) return true; return false; }
function swSnapshot() {
  return {
    n: +dockVal('samplesSlider'), samp: dockVal('samplingMethod'),
    vary: dockVal('variationMode'), spread: +dockVal('spreadPct'),
    scale: SC_AX.map(function (a) { return [pxNum('scale' + a + 'lo'), pxNum('scale' + a + 'hi')]; }),
    link: typeof DOCK_STATE.link === 'boolean' ? DOCK_STATE.link : null,
    domain: dockVal('domainSel'), material: pxEl('materialGroup').style.display !== 'none' ? dockVal('materialSel') : '', sigma: dockVal('sigmaRef'), cell: dockVal('cellSize'),
    prec: getPrecisionMode(), grid: SW_SETTINGS.pending64 ? 64 : getSolverN(),
    ranks: [1, 2, 3].map(function (r) { return { m: dockVal('r' + r + 'metric'), dir: directions[r] || 'max', keep: r > 1 ? dockVal('r' + r + 'keep') : null }; })
  };
}
function swApply(s) {
  if (!s || typeof s !== 'object') return;
  var ok = function (v, lo, hi) { v = parseFloat(v); return isFinite(v) && v >= lo && v <= hi; };
  if (ok(s.n, 1, 100000)) pxSet('samplesSlider', Math.max(10, Math.min(1000, Math.round(s.n / 10) * 10)), 'input');
  if (s.samp === 'sobol' || s.samp === 'uniform') pxSet('samplingMethod', s.samp, 'change');
  if (s.vary === 'neighbourhood' || s.vary === 'explore') pxSet('variationMode', s.vary, 'change');
  if (ok(s.spread, 1, 90)) { pxSet('spreadPct', Math.round(s.spread), 'input'); if (typeof baseRecipe !== 'undefined' && baseRecipe) updateDensityAuto(); }
  if (Array.isArray(s.scale) && s.scale.length === 3) s.scale.forEach(function (r, i) {
    if (Array.isArray(r) && ok(r[0], 1, 500) && ok(r[1], 1, 500) && +r[0] <= +r[1]) { pxSet('scale' + SC_AX[i] + 'lo', +r[0], 'input'); pxSet('scale' + SC_AX[i] + 'hi', +r[1], 'input'); }
  });
  DOCK_STATE.link = typeof s.link === 'boolean' ? s.link : null;
  /* the domain first: it resets the material, the reference stress and the ranks */
  if (swHasOpt('domainSel', s.domain)) pxSet('domainSel', s.domain, 'change');
  if (swHasOpt('materialSel', s.material)) pxSet('materialSel', s.material, 'change');
  if (ok(s.sigma, 0.01, 10000)) pxEl('sigmaRef').value = s.sigma;
  if (ok(s.cell, 0.1, 100)) pxEl('cellSize').value = s.cell;
  if (s.prec === 'fast' || s.prec === 'rigorous') setPrecisionUI(s.prec);
  SW_SETTINGS.pending64 = false;
  if (s.grid === 16 || s.grid === 32) setResolutionUI(s.grid);
  else if (s.grid === 64) {   /* GPU only: applied once a GPU is found (swSettingsGpu) */
    var st = (typeof gpuSolverStatus === 'function') ? gpuSolverStatus() : { gpu: null };
    if (st.gpu === true) setResolutionUI(64); else if (st.gpu !== false) SW_SETTINGS.pending64 = true;
  }
  if (Array.isArray(s.ranks)) s.ranks.slice(0, 3).forEach(function (k, i) {
    var r = i + 1;
    if (!k || typeof k !== 'object') return;
    if (swHasOpt('r' + r + 'metric', k.m)) pxSet('r' + r + 'metric', k.m, 'change');
    if (k.dir === 'max' || k.dir === 'min') setDirBtn(r, k.dir);
    if (r > 1 && (k.keep === '' || ok(k.keep, 1, 100))) pxSet('r' + r + 'keep', k.keep, 'input');
  });
}
/* called from initDock before the first paint */
function swLoadSettings() {
  if (!SW_SETTINGS.defaults) SW_SETTINGS.defaults = JSON.parse(JSON.stringify(swSnapshot()));
  if (swSettingsOff()) return;
  try { swApply(JSON.parse(localStorage.getItem(SW_SETTINGS_KEY) || 'null')); } catch (e) {}
  SW_SETTINGS.loaded = true;
}
/* called from updateDock — every change goes through it */
function swSaveSettings() {
  if (!SW_SETTINGS.loaded) return;
  try { localStorage.setItem(SW_SETTINGS_KEY, JSON.stringify(swSnapshot())); } catch (e) {}
}
function swResetSettings() {
  try { localStorage.removeItem(SW_SETTINGS_KEY); } catch (e) {}
  if (SW_SETTINGS.defaults) swApply(JSON.parse(JSON.stringify(SW_SETTINGS.defaults)));
  closeDropdowns();
  pxAfter();
  var b = pxEl('drReset');
  if (b) { b.classList.add('done'); setTimeout(function () { b.classList.remove('done'); }, 900); }
}
/* the saved 64³ grid waits for the GPU; without one the grid stays as it is */
function swSettingsGpu(st) {
  if (!SW_SETTINGS.pending64 || st.gpu == null) return;
  SW_SETTINGS.pending64 = false;
  if (st.gpu === true) setResolutionUI(64);
}
