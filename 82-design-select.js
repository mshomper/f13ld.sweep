/* ============================================================
   F13LD.sweep · 82-design-select.js
   Row click -> select, single-design export.
   ============================================================ */

// ─── Select a design: row click / Enter, or plot click ──────────────────────
let selectedDesign = null;

function selectDesign(design, opts) {
  opts = opts || {};
  if (!design) return;
  selectedDesign = design;
  document.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  const row = document.querySelector(`tr[data-design-id="${design.id}"]`);
  if (row) { row.classList.add('selected-row'); if (opts.scroll) row.scrollIntoView({ block: 'nearest' }); }
  document.getElementById('exportDesignBtn').disabled = false;
  const lbl = document.getElementById('selectedLabel');
  lbl.textContent = `design #${design.id} selected`;
  lbl.style.color = 'var(--accent)';
  renderDetailPanel(design);
  if (typeof showPreview === 'function') showPreview(design);   /* v0.25.0 — the inspector follows the selection */
}

function clearSelection() {
  selectedDesign = null;
  document.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  document.getElementById('exportDesignBtn').disabled = true;
  const lbl = document.getElementById('selectedLabel');
  lbl.textContent = 'click a row to select';
  lbl.style.color = '';
  document.getElementById('detailPanel').classList.remove('open');
}

/* Detail panel: every metric of the selected design (the table shows the
   domain's key columns only). Wraps on narrow screens — no side scrolling. */
const DETAIL_SKIP = new Set(['id', 'filterRank', 'attemptIdx', 'recipe', 'terms', 'family']);

/* v0.25.0 — every metric of the selected design opens on request (the
   inspector beside the plot shows the key numbers), so the table keeps its
   room. "All metrics" in the inspector header toggles it. */
let detailOpen = false;
function toggleDetails(on) {
  detailOpen = (on == null) ? !detailOpen : !!on;
  const panel = document.getElementById('detailPanel');
  if (detailOpen && selectedDesign) renderDetailPanel(selectedDesign);
  else panel.classList.remove('open');
  const b = document.getElementById('detailsBtn');
  if (b) { b.classList.toggle('on', detailOpen); b.setAttribute('aria-pressed', detailOpen ? 'true' : 'false'); }
}
function renderDetailPanel(d) {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  const shown = new Set(tableColumnKeys().keys);
  const item = (k, label, title) => {
    const v = d[k];
    const txt = typeof v === 'boolean' ? (v ? 'yes' : 'no') : formatMetric(k, v);
    return `<div class="dp-item${shown.has(k) ? ' shown' : ''}" title="${escapeLog(title || k)}"><span class="k">${escapeLog(label)}</span><span class="v">${escapeLog(txt)}</span></div>`;
  };
  const main = METRIC_INFO_LIST.filter(e => e.key in d).map(e => item(e.key, `${e.sym} ${e.name}`, `${e.name} — ${e.desc}`));
  const rest = Object.keys(d).filter(k => !DETAIL_SKIP.has(k) && !k.startsWith('_') && !METRIC_INFO[k] &&
      (d[k] === null || ['number', 'string', 'boolean'].includes(typeof d[k])))
    .map(k => item(k, k));
  const fam = SWEEP_FAMILIES[d.family || baseFamily];
  let sub = '';
  try { sub = fam && d.recipe ? fam.summary(d.recipe) : ''; } catch (e) { sub = ''; }
  panel.innerHTML = `
    <div class="dp-head">
      <span class="dp-title">Design #${d.id}${d.filterRank ? ` · rank ${d.filterRank}` : ''}</span>
      <span class="dp-sub">${escapeLog((d.family || baseFamily || '') + (sub ? ' · ' + sub : ''))}</span>
      <button class="pill-btn ghost" onclick="toggleDetails(false)" title="Hide all metrics" aria-label="Hide all metrics">✕</button>
    </div>
    <div class="dp-grid">${main.join('')}${rest.length ? '<div class="dp-sep">design &amp; solver</div>' + rest.join('') : ''}</div>`;
  panel.classList.toggle('open', detailOpen);
}

(function wireTableSelection() {
  const wrap = document.getElementById('tableWrap');
  wrap.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const row = e.target.closest('tr');
    if (!row || !row.dataset.designId) return;
    const id = parseInt(row.dataset.designId);
    selectDesign(currentFiltered.find(d => d.id === id));
  });
  // Keyboard: Enter / Space selects, ↑ ↓ move between rows
  wrap.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('tbody tr');
    if (!row || e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = parseInt(row.dataset.designId);
      selectDesign(currentFiltered.find(d => d.id === id));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next) next.focus();
    }
  });
})();

function exportSelectedDesign() {
  if (!selectedDesign || !baseRecipe) return;

  // v0.12.1: same identity check as exportResults — refuse export if the
  // recipe was changed since the sweep that produced selectedDesign.
  if (sweptRecipeId !== recipeLoadId) {
    log('warn', 'Recipe was changed after the last sweep — re-run sweep before exporting.');
    return;
  }

  // The exact recipe the solver built for this design (designRecipeOut).
  const d = selectedDesign;
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  const preset = String((baseRecipe.meta && baseRecipe.meta.preset) || 'custom').replace(/[^A-Za-z0-9_.-]+/g, '_');
  const family = d.family || baseFamily;
  const exportData = designRecipeOut(d, 'design-export');
  exportData.meta.preset = `${preset}_sweep_${d.id}`;
  const filenamePrefix = family;

  const json = JSON.stringify(exportData, null, 2);
  const filename = `${filenamePrefix}_${preset}_sweep${d.id}_${ts}.json`;

  // Attempt file download
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('success', `Downloaded: ${filename}`);
  } catch(e) {
    log('warn', `Download blocked in this context — copying to clipboard instead`);
  }

  // Always copy to clipboard as well — useful when running outside Docker
  navigator.clipboard.writeText(json).then(() => {
    log('success', `JSON copied to clipboard — paste into a .json file`);
  }).catch(() => {
    // Last resort: dump to log so user can copy manually
    log('info', `Clipboard unavailable. JSON output:`);
    log('info', json);
  });

  const anisoLogStr = (d.anisotropy === null || d.anisotropy === undefined)
    ? '—' : d.anisotropy.toFixed(2);
  log('info', `Scale ${d.scaleX}·${d.scaleY}·${d.scaleZ} · aniso ${anisoLogStr}× · vol ${d.volume_fraction}%`);

  // Flash confirmation
  const btn = document.getElementById('exportDesignBtn');
  const orig = btn.textContent;
  btn.textContent = '✓ Downloaded';
  btn.style.color = 'var(--success)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
}
