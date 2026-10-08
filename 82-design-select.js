/* ============================================================
   F13LD.sweep · 82-design-select.js
   Row click -> select, single-design export.
   ============================================================ */

// ─── Row click → select for export ───────────────────────────────────────────
let selectedDesign = null;

document.getElementById('tableWrap').addEventListener('click', e => {
  const row = e.target.closest('tr');
  if (!row || !row.dataset.designId) return;
  const id = parseInt(row.dataset.designId);
  const design = currentFiltered.find(d => d.id === id);
  if (!design) return;

  // deselect previous
  document.querySelectorAll('tr.selected-row').forEach(r => r.classList.remove('selected-row'));
  row.classList.add('selected-row');
  selectedDesign = design;

  const btn = document.getElementById('exportDesignBtn');
  btn.disabled = false;
  btn.style.color = 'var(--accent)';
  btn.style.borderColor = 'rgba(200,245,66,0.4)';
  btn.style.cursor = 'pointer';
  document.getElementById('selectedLabel').textContent = `design #${design.id} selected`;
  document.getElementById('selectedLabel').style.color = 'var(--accent)';
});

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
  btn.style.borderColor = 'var(--success)';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.color = 'var(--accent)';
    btn.style.borderColor = 'rgba(200,245,66,0.4)';
  }, 2000);
}
