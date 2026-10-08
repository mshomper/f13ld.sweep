/* ============================================================
   F13LD.sweep · 71-results-table.js
   Results table: per-domain columns, renderTable, sortBy.

   v0.23.0: the table shows at most 8 metric columns — volume fraction,
   the active rank metrics, then the domain's key metrics
   (DOMAIN_COLUMNS). Every metric is still computed and exported; the
   selected design's detail panel (82-design-select.js) lists them all.
   Every row is rendered (no 200-row cap), so the table and the
   design-space plot always show the same designs. Each row has Lab and
   Mesh push buttons (72-mesh-handoff.js).
   ============================================================ */

// Every metric the table can show, in display order.
const COLUMNS = [
  { label: 'α',      key: 'anisotropy' },
  { label: 'Ex',     key: 'Ex_GPa',             cls: 'td-group-start' },
  { label: 'Ey',     key: 'Ey_GPa',             cls: 'td-group-mid' },
  { label: 'Ez',     key: 'Ez_GPa',             cls: 'td-group-end' },
  { label: 'Gyz',    key: 'Gyz_GPa',            cls: 'td-group-start' },
  { label: 'Gxz',    key: 'Gxz_GPa',            cls: 'td-group-mid' },
  { label: 'Gxy',    key: 'Gxy_GPa',            cls: 'td-group-end' },
  { label: 'E/ρ',    key: 'stiffness_density' },
  { label: 'α/ρ',    key: 'aniso_efficiency' },
  { label: 'Ψ',      key: 'directionality' },
  { label: 'Ω',      key: 'ortho_contrast' },
  { label: 'ax',     key: 'stiff_axis' },
  { label: 'κ',      key: 'connect_idx' },
  { label: 'kx',     key: 'keff_x',             cls: 'td-group-start' },
  { label: 'ky',     key: 'keff_y',             cls: 'td-group-mid' },
  { label: 'kz',     key: 'keff_z',             cls: 'td-group-end' },
  { label: 'kα',     key: 'thermal_anisotropy' },
  { label: 'k/ρ',    key: 'k_density' },
  { label: 'U',      key: 'U_strain',           cls: 'td-group-start' },
  { label: 'με·X',   key: 'microstrain_x',      cls: 'td-group-mid' },
  { label: 'με·Y',   key: 'microstrain_y',      cls: 'td-group-mid' },
  { label: 'με·Z',   key: 'microstrain_z',      cls: 'td-group-end' },
  { label: 'με̄',    key: 'microstrain_avg' },
  { label: 'φ',      key: 'pore_size',          cls: 'td-group-start' },
  { label: 'φt',     key: 'throat_size',        cls: 'td-group-mid' },
  { label: 'φt/c',   key: 'throat_ratio' },
  { label: 'perc',   key: 'perc_idx' },
  { label: 'SA',     key: 'surface_complexity' },
  { label: 'ρ%',     key: 'volume_fraction' },
];

// Key metrics per domain, in priority order. An array is a group that is
// shown whole or not at all (Ex/Ey/Ez, kx/ky/kz).
const TABLE_MAX_METRICS = 8;
const DOMAIN_COLUMNS = {
  general:    [['Ex_GPa','Ey_GPa','Ez_GPa'], 'anisotropy', 'stiffness_density', 'connect_idx'],
  biomedical: [['Ex_GPa','Ey_GPa','Ez_GPa'], 'microstrain_avg', 'pore_size', 'throat_size', 'perc_idx'],
  aerospace:  [['Ex_GPa','Ey_GPa','Ez_GPa'], 'stiffness_density', 'directionality', 'anisotropy'],
  oilgas:     ['connect_idx', 'pore_size', 'throat_size', 'perc_idx', 'anisotropy'],
  automotive: [['Ex_GPa','Ey_GPa','Ez_GPa'], 'ortho_contrast', 'stiffness_density'],
  thermal:    [['keff_x','keff_y','keff_z'], 'thermal_anisotropy', 'k_density', 'connect_idx'],
};

function activeRankKeys() {
  return ['r1metric', 'r2metric', 'r3metric']
    .map(id => { const el = document.getElementById(id); return el ? el.value : null; })
    .map(k => (k && k !== 'none') ? k : null);
}

// → { keys: [...metric keys in display order], rankOf: {key: 1|2|3} }
function tableColumnKeys() {
  const domainEl = document.getElementById('domainSel');
  const domain = (domainEl && domainEl.value) || 'general';
  const ranks = activeRankKeys();
  const rankOf = {};
  ranks.forEach((k, i) => { if (k && !rankOf[k]) rankOf[k] = i + 1; });

  const chosen = new Set(['volume_fraction']);
  const fits = add => chosen.size + add.length <= TABLE_MAX_METRICS;
  ranks.forEach(k => { if (k && !chosen.has(k) && fits([k])) chosen.add(k); });
  (DOMAIN_COLUMNS[domain] || DOMAIN_COLUMNS.general).forEach(g => {
    const add = (Array.isArray(g) ? g : [g]).filter(k => !chosen.has(k));
    if (add.length && fits(add)) add.forEach(k => chosen.add(k));
  });

  const order = COLUMNS.map(c => c.key);
  const keys = [...chosen].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return { keys, rankOf };
}

function columnFor(key) {
  return COLUMNS.find(c => c.key === key) || { label: (METRIC_INFO[key] && METRIC_INFO[key].sym) || key, key };
}

// Per-key number formatting (shared with the detail panel)
const METRIC_FMT = {
  anisotropy: v => v.toFixed(3),
  Ex_GPa: v => v.toFixed(2), Ey_GPa: v => v.toFixed(2), Ez_GPa: v => v.toFixed(2),
  Gyz_GPa: v => v.toFixed(2), Gxz_GPa: v => v.toFixed(2), Gxy_GPa: v => v.toFixed(2),
  nu_xy: v => v.toFixed(3), nu_xz: v => v.toFixed(3), nu_yz: v => v.toFixed(3), zener_A: v => v.toFixed(2),
  stiffness_density: v => v.toFixed(2), aniso_efficiency: v => v.toFixed(2),
  directionality: v => v.toFixed(3), ortho_contrast: v => v.toFixed(3),
  connect_idx: v => v.toFixed(2),
  keff_x: v => v.toFixed(3), keff_y: v => v.toFixed(3), keff_z: v => v.toFixed(3),
  thermal_anisotropy: v => v.toFixed(2), k_density: v => v.toFixed(3),
  U_strain: v => v.toFixed(1),
  microstrain_x: v => Math.round(v).toString(),
  microstrain_y: v => Math.round(v).toString(),
  microstrain_z: v => Math.round(v).toString(),
  microstrain_avg: v => Math.round(v).toString(),
  pore_size:   v => Math.round(v).toString(),
  throat_size: v => Math.round(v).toString(),
  throat_ratio: v => v.toFixed(4),
  perc_idx:    v => v.toFixed(2),
  surface_complexity: v => v.toFixed(3), volume_fraction: v => v.toFixed(1),
};
function formatMetric(key, v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(' × ');
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '—';
  return METRIC_FMT[key] ? METRIC_FMT[key](v) : (Math.abs(v) >= 1000 ? Math.round(v).toString() : +v.toPrecision(4) + '');
}

const COL_COLORS = {
  anisotropy:'var(--rank1)', Ex_GPa:'#5fb5b5', Ey_GPa:'#c794d4', Ez_GPa:'#d4b04a',
  Gyz_GPa:'#5fb5b5', Gxz_GPa:'#c794d4', Gxy_GPa:'#d4b04a',
  stiffness_density:'var(--accent3)', aniso_efficiency:'var(--rank1)',
  directionality:'var(--accent2)', ortho_contrast:'var(--warn)',
  connect_idx:'var(--accent2)',
  keff_x:'#5fb5b5', keff_y:'#c794d4', keff_z:'#d4b04a',
  thermal_anisotropy:'var(--accent3)', k_density:'var(--success)',
  U_strain:'var(--warn)', microstrain_x:'#5fb5b5', microstrain_y:'#c794d4', microstrain_z:'#d4b04a',
  microstrain_avg:'var(--rank1)',
  pore_size:'var(--success)', throat_size:'var(--accent2)', throat_ratio:'var(--accent3)', perc_idx:'var(--rank1)',
  volume_fraction:'var(--warn)', surface_complexity:'var(--muted)',
};
const RANK_COLORS = { 1: 'var(--rank1)', 2: 'var(--rank2)', 3: 'var(--rank3)' };

function renderTable(data) {
  currentFiltered = data;
  if (typeof selectedDesign !== 'undefined' && selectedDesign && !data.includes(selectedDesign)) clearSelection();
  document.getElementById('resultsBadge').textContent = `${data.length} designs`;
  const wrap = document.getElementById('tableWrap');

  if (data.length === 0) {
    wrap.innerHTML = `<div class="empty-state">${swEmptyIcon()}<div class="empty-title">No designs passed all filters</div><div class="empty-sub">Try relaxing your filter thresholds</div></div>`;
    return;
  }

  let sorted = [...data];
  if (sortState.col) {
    const k = sortState.col, asc = sortState.dir === 'asc';
    sorted.sort((a, b) => {
      const av = a[k], bv = b[k];
      const an = av === null || av === undefined || (typeof av === 'number' && !Number.isFinite(av));
      const bn = bv === null || bv === undefined || (typeof bv === 'number' && !Number.isFinite(bv));
      if (an || bn) return an === bn ? 0 : an ? 1 : -1;          // missing values always last
      if (typeof av === 'string') return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      return asc ? av - bv : bv - av;
    });
  }

  const { keys, rankOf } = tableColumnKeys();
  const cols = keys.map(columnFor);

  const range = {};
  keys.forEach(k => {
    const vals = sorted.map(d => d[k]).filter(v => typeof v === 'number' && Number.isFinite(v));
    range[k] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  });

  const dash = `<span style="color:var(--muted);opacity:0.5">—</span>`;
  // Color-intensity cell: bright = high value, dim = low value.
  const cell = (val, key, suffix = '') => {
    if (val === null || val === undefined || (typeof val === 'number' && !Number.isFinite(val))) return dash;
    const color = COL_COLORS[key] || 'var(--text)';
    const [mn, mx] = range[key];
    const t = typeof val === 'number' ? (val - mn) / ((mx - mn) || 1) : 0;
    const alpha = 0.35 + t * 0.65;
    return `<span style="color:${color};opacity:${alpha.toFixed(2)};font-variant-numeric:tabular-nums">${formatMetric(key, val)}${suffix}</span>`;
  };

  const colClass = col => {
    const c = [];
    if (col.cls) c.push(col.cls);
    if (!rankOf[col.key] && col.key !== 'volume_fraction') c.push('col-opt');   // hidden on phones
    return c.length ? ` class="${c.join(' ')}"` : '';
  };

  const rows = sorted.map((d) => {
    const fr = d.filterRank || 999;
    const badge = fr <= 3
      ? `<div class="rank-badge r${fr}">${fr}</div>`
      : `<span style="color:var(--muted);font-family:var(--mono);font-size:11px">${fr}</span>`;

    const tds = cols.map(col => {
      const cls = colClass(col);
      const v = d[col.key];
      if (col.key === 'stiff_axis') {
        if (v === null || v === undefined) return `<td${cls}>${dash}</td>`;
        const axisColor = v === 'X' ? '#5fb5b5' : v === 'Y' ? '#c794d4' : '#d4b04a';
        return `<td${cls}><span style="color:${axisColor};font-weight:600">${escapeLog(v)}</span></td>`;
      }
      // microstrain_avg — Frost mechanostat zone pill
      if (col.key === 'microstrain_avg') {
        if (v === null || v === undefined || !Number.isFinite(v)) return `<td${cls}>${dash}</td>`;
        const [bgColor, textColor, zone] =
            v < 200   ? ['#2d3748','#a0aec0','disuse']
          : v < 1500  ? ['#2d2a1a','#d69e2e','sub-thresh']
          : v <= 3000 ? ['#1a2e1a','#68d391','osteogenic']
          :             ['#2d1a0a','#ed8936','overload'];
        return `<td${cls}><span style="background:${bgColor};color:${textColor};font-weight:600;font-variant-numeric:tabular-nums;font-size:10px;padding:1px 5px;border-radius:4px;white-space:nowrap" title="Frost (1987): ${zone} · <200 disuse · 200–1500 sub-threshold · 1500–3000 osteogenic · >3000 overload">${Math.round(v).toLocaleString()}</span></td>`;
      }
      const suffix = col.key === 'volume_fraction' ? '%' : col.key === 'anisotropy' ? '×' : '';
      /* v0.24.0 — a modulus the pores' stand-in stiffness props up */
      const ax = { Ex_GPa: 'x', Ey_GPa: 'y', Ez_GPa: 'z' }[col.key];
      if (ax && d.void_limited_axes && d.void_limited_axes.includes(ax))
        return `<td${cls}><span class="sflag-val" title="Reads high: the pores' stand-in stiffness is over 10 % of this modulus">${cell(v, col.key, suffix)}</span></td>`;
      return `<td${cls}>${cell(v, col.key, suffix)}</td>`;
    }).join('');

    const actions = `<td class="td-actions">` +
      `<button class="row-btn lab" onclick="event.stopPropagation();openInLab(${d.id},this)" title="Open design #${d.id} in F13LD.lab">Lab</button>` +
      `<button class="row-btn mesh" onclick="event.stopPropagation();openInMesh(${d.id},this)" title="Open design #${d.id} in F13LD.mesh">Mesh</button></td>`;
    const sel = (typeof selectedDesign !== 'undefined' && selectedDesign && selectedDesign.id === d.id) ? ' class="selected-row"' : '';
    const flag = d.stiffness_flag ? `<span class="sflag" title="Stiffness may read high: ${escapeLog(d.stiffness_flag_reasons || '')}"></span>` : '';
    return `<tr data-design-id="${d.id}" tabindex="0"${sel} style="cursor:pointer"><td class="td-rank">${badge}${flag}</td>${tds}${actions}</tr>`;
  }).join('');

  const headers = cols.map((col) => {
    const isActive = sortState.col === col.key;
    const cls = [
      isActive ? (sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '',
      col.cls || '',
      (!rankOf[col.key] && col.key !== 'volume_fraction') ? 'col-opt' : ''
    ].join(' ').trim();
    const arrow = swGlyph(isActive ? (sortState.dir === 'asc' ? 'up' : 'dn') : 'updn');
    const info = METRIC_INFO[col.key];
    const title = (info ? `${info.name} — ${info.desc}` : col.key) + (rankOf[col.key] ? ` · rank ${rankOf[col.key]} metric` : '');
    const pip = rankOf[col.key] ? `<span class="rank-pip" style="display:inline-block;width:6px;height:6px;margin-right:4px;vertical-align:1px;background:${RANK_COLORS[rankOf[col.key]]}"></span>` : '';
    return `<th class="${cls}" data-col="${col.key}" tabindex="0" title="${escapeLog(title)}" aria-sort="${isActive ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"
      onclick="sortBy('${col.key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sortBy('${col.key}')}">${pip}${col.label}<span class="sort-indicator">${arrow}</span></th>`;
  }).join('');

  if (typeof renderMetricKey === 'function') renderMetricKey(keys);
  wrap.innerHTML = `<table>
    <thead><tr><th class="th-rank" title="Rank after filters">#</th>${headers}<th class="th-actions" title="Open the design in F13LD.lab (full solve) or F13LD.mesh (print)">Open in</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function sortBy(col) {
  if (sortState.col === col) {
    sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
  } else {
    sortState.col = col;
    sortState.dir = 'desc';
  }
  renderTable(currentFiltered);
  const th = document.querySelector(`th[data-col="${col}"]`);
  if (th) th.focus();
}
