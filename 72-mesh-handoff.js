/* ============================================================
   F13LD.sweep · 72-mesh-handoff.js
   F13LD.mesh handoff: buildMeshRecipe (the design recipe), openInMesh.
   ============================================================ */

// ─── F13LD.mesh handoff ───────────────────────────────────────────────────────
// Opens F13LD.mesh with the design's recipe — the exact recipe the solver
// built (designRecipeOut, 70-export.js) — in the URL hash (#r=…). The hash
// never reaches a server, so it has no length limit; past ~2 MB the JSON
// is copied to the clipboard instead.
const MESH_URL = 'https://mshomper.github.io/f13ld.mesh/';
const MESH_URL_MAX_BYTES = 2000000;

function buildMeshRecipe(d) {
  if (!d || !d.recipe) return null;
  return designRecipeOut(d, 'mesh-handoff');
}

function openInMesh(designId, btn) {
  if (typeof event !== 'undefined' && event) event.stopPropagation();
  const d = currentFiltered.find(x => x.id === designId);
  if (!d) return;
  const recipe = buildMeshRecipe(d);
  if (!recipe) {
    log('warn', 'No recipe available — load a base recipe first');
    return;
  }

  const json = JSON.stringify(recipe);  // compact, not pretty — URL is the consumer
  const encoded = encodeURIComponent(json);
  const fullUrl = `${MESH_URL}#r=${encoded}`;

  // Sanity check URL length — fall back to clipboard for over-large recipes.
  if (fullUrl.length > MESH_URL_MAX_BYTES) {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)).then(() => {
      log('warn', `Recipe for design #${designId} too large for a link (${fullUrl.length} bytes) — copied JSON to clipboard instead. Drop the JSON into F13LD.mesh.`);
      if (btn) flashBtn(btn, '⎘', 'var(--warn)');
    }).catch(() => log('warn', `Recipe for design #${designId} too large for a link, and the clipboard is blocked — use Export Design.`));
    return;
  }

  // Open in new tab with recipe attached
  window.open(fullUrl, '_blank', 'noopener,noreferrer');
  log('accent', `Design #${designId} → F13LD.mesh (${fullUrl.length} bytes encoded)`);
  if (btn) flashBtn(btn, '✓', 'var(--success)');
}

function flashBtn(btn, glyph, color) {
  const orig = btn.textContent;
  btn.textContent = glyph;
  btn.style.color = color;
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 900);
}
