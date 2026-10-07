/* ============================================================
   F13LD.sweep · 71-results-table.js
   Results table columns, renderTable, sortBy.
   ============================================================ */

// ─── Table ────────────────────────────────────────────────────────────────────
const COLUMNS = [
  { label: '#',      key: null },
  { label: '↗',      key: '_mesh' },
  { label: 'α',      key: 'anisotropy' },
  { label: 'Ex',     key: 'Ex_GPa',             cls: 'td-group-start' },
  { label: 'Ey',     key: 'Ey_GPa',             cls: 'td-group-mid' },
  { label: 'Ez',     key: 'Ez_GPa',             cls: 'td-group-end' },
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
  { label: 'perc',   key: 'perc_idx' },
  { label: 'ρ%',     key: 'volume_fraction' },
];

function renderTable(data) {
  currentFiltered = data;
  document.getElementById('resultsBadge').textContent = `${data.length} designs`;
  const wrap = document.getElementById('tableWrap');

  if (data.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⬡</div><div class="empty-title">No designs passed all filters</div><div class="empty-sub">Try relaxing your filter thresholds</div></div>`;
    return;
  }

  let sorted = [...data];
  if (sortState.col) {
    sorted.sort((a, b) => {
      const av = a[sortState.col], bv = b[sortState.col];
      if (typeof av === 'string') return sortState.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortState.dir === 'asc' ? av - bv : bv - av;
    });
  }

  const allKeys = COLUMNS.filter(c => c.key).map(c => c.key);
  const maxes = Object.fromEntries(allKeys.map(k => [k, Math.max(...sorted.map(d => typeof d[k]==='number' ? d[k] : 0))]));
  const mines = Object.fromEntries(allKeys.map(k => [k, Math.min(...sorted.map(d => typeof d[k]==='number' ? d[k] : 0))]));

  // Per-key formatting rules
  const FMT = {
    anisotropy: v => v.toFixed(3),
    Ex_GPa: v => v.toFixed(2), Ey_GPa: v => v.toFixed(2), Ez_GPa: v => v.toFixed(2),
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
  const COL_COLORS = {
    anisotropy:'var(--rank1)', Ex_GPa:'#5fb5b5', Ey_GPa:'#c794d4', Ez_GPa:'#d4b04a',
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

  // Color-intensity cell: bright = high value, dim = low value.
  // v0.14.0: null-aware — anisotropy and aniso_efficiency can be null when
  // <2 axes percolate (mathematically undefined per Part 1).
  const cell = (val, key, suffix = '') => {
    if (val === null || val === undefined) {
      return `<span style="color:var(--muted);opacity:0.5;font-variant-numeric:tabular-nums">—</span>`;
    }
    const color = COL_COLORS[key] || 'var(--text)';
    const range = (maxes[key] - mines[key]) || 1;
    const t = (typeof val === 'number' ? val - mines[key] : 0) / range;
    const alpha = 0.35 + t * 0.65;
    const display = typeof val === 'number' ? val : '—';
    return `<span style="color:${color};opacity:${alpha.toFixed(2)};font-variant-numeric:tabular-nums">${display}${suffix}</span>`;
  };

  const visibleCols = COLUMNS.filter(c => !c.key || c.key === '_mesh' || activeDomainShow.includes(c.key));

  const rows = sorted.slice(0, 200).map((d) => {
    const fr = d.filterRank || 999;
    const badge = fr <= 3
      ? `<div class="rank-badge r${fr}">${fr}</div>`
      : `<span style="color:var(--muted);font-family:'Azeret Mono',monospace;font-size:11px">${fr}</span>`;

    const tds = visibleCols.map(col => {
      if (!col.key) return `<td style="width:32px;text-align:center">${badge}</td>`;
      // F13LD.mesh handoff button — opens design directly in the mesh tool
      if (col.key === '_mesh') {
        return `<td style="width:28px;text-align:center"><button onclick="openInMesh(${d.id},this)" title="Open design #${d.id} in F13LD.mesh" style="background:transparent;border:0.5px solid var(--border2);color:var(--accent);cursor:pointer;padding:1px 6px;border-radius:4px;font-family:'Azeret Mono',monospace;font-size:11px;line-height:1">↗</button></td>`;
      }
      const cls = col.cls ? ` class="${col.cls}"` : '';
      const v = d[col.key];
      // Special case: stiff_axis is categorical.
      // v0.14.1: null when solver_validity === 'invalid' — render as em-dash.
      if (col.key === 'stiff_axis') {
        if (v === null || v === undefined) {
          return `<td${cls}><span style="color:var(--muted);opacity:0.5;font-family:'Azeret Mono',monospace">—</span></td>`;
        }
        const axisColor = v === 'X' ? '#5fb5b5' : v === 'Y' ? '#c794d4' : '#d4b04a';
        return `<td${cls}><span style="color:${axisColor};font-weight:600;font-family:'Azeret Mono',monospace">${v}</span></td>`;
      }
      // Special case: microstrain_avg — Frost mechanostat zone pill badges
      // Background color makes it visually distinct from neighboring colored columns.
      // v0.14.1: null (no axes percolate) renders as em-dash, not "disuse".
      if (col.key === 'microstrain_avg') {
        if (v === null || v === undefined) {
          return `<td${cls}><span style="color:var(--muted);opacity:0.5;font-family:'Azeret Mono',monospace">—</span></td>`;
        }
        const με = typeof v === 'number' ? v : 0;
        const [bgColor, textColor, zone] =
            με < 200   ? ['#2d3748','#a0aec0','disuse']
          : με < 1500  ? ['#2d2a1a','#d69e2e','sub-thresh']
          : με <= 3000 ? ['#1a2e1a','#68d391','osteogenic']
          :              ['#2d1a0a','#ed8936','overload'];
        const fmt = Math.round(με).toLocaleString();
        return `<td${cls}><span style="background:${bgColor};color:${textColor};font-weight:600;font-family:'Azeret Mono',monospace;font-variant-numeric:tabular-nums;font-size:10px;padding:1px 5px;border-radius:4px;white-space:nowrap" title="Frost (1987): ${zone} · <200 disuse · 200–1500 sub-threshold · 1500–3000 osteogenic ✓ · >3000 overload">${fmt}</span></td>`;
      }
      const fmt = FMT[col.key] ? FMT[col.key](typeof v === 'number' ? v : 0) : (typeof v === 'number' ? v.toFixed(2) : (v ?? '—'));
      const suffix = col.key === 'volume_fraction' ? '%' : col.key === 'anisotropy' ? '×' : '';
      return `<td${cls}>${cell(v, col.key, suffix)}</td>`;
    }).join('');

    return `<tr data-design-id="${d.id}" style="cursor:pointer">${tds}</tr>`;
  }).join('');

  const headers = visibleCols.map((col) => {
    if (!col.key) return `<th style="width:32px;text-align:center">${col.label}</th>`;
    if (col.key === '_mesh') return `<th style="width:28px;text-align:center;font-size:11px" title="Copy recipe JSON for F13LD.mesh">${col.label}</th>`;
    const isActive = sortState.col === col.key;
    const cls = [
      isActive ? (sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc') : '',
      col.cls || ''
    ].join(' ').trim();
    const arrow = isActive ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕';
    return `<th class="${cls}" data-col="${col.key}" onclick="sortBy('${col.key}')">
      ${col.label}<span class="sort-indicator">${arrow}</span>
    </th>`;
  }).join('');

  wrap.innerHTML = `<table>
    <thead><tr>${headers}</tr></thead>
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
}
