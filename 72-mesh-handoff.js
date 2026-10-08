/* ============================================================
   F13LD.sweep · 72-mesh-handoff.js
   Row push buttons: open a design in F13LD.lab (full solve) or
   F13LD.mesh (print). Both read the design recipe from #r=<JSON>.
   ============================================================ */

// The recipe is the exact one the solver built (designRecipeOut,
// 70-export.js). The hash never reaches a server, so it has no length
// limit; past ~2 MB the JSON is copied to the clipboard instead.
const MESH_URL = 'https://mshomper.github.io/f13ld.mesh/';
const LAB_URL  = 'https://mshomper.github.io/f13ld.lab/';
const HANDOFF_URL_MAX_BYTES = 2000000;

function buildMeshRecipe(d) {
  if (!d || !d.recipe) return null;
  return designRecipeOut(d, 'mesh-handoff');
}

/* F13LD.lab reads its cell size (mm) from geometry.cell_size_mm (default
   5 mm) and the material from homogenization.E_solid_GPa / poisson, which
   designRecipeOut already carries. Beam recipes size their cell in mm. */
function buildLabRecipe(d) {
  if (!d || !d.recipe) return null;
  const r = designRecipeOut(d, 'lab-handoff');
  const fam = d.family || baseFamily;
  const ctx = r.meta && r.meta.context;
  r.geometry = r.geometry || {};
  if (fam !== 'beam' && r.geometry.cell_size_mm == null && r.geometry.cellSizeMm == null &&
      ctx && ctx.cellSize_mm > 0) r.geometry.cell_size_mm = ctx.cellSize_mm;
  r.title = `Sweep #${d.id}` + (d.filterRank ? ` · rank ${d.filterRank}` : '') +
            ` · ${(baseRecipe && baseRecipe.meta && baseRecipe.meta.preset) || fam}`;
  return r;
}

function openHandoff(designId, btn, tool) {
  const d = currentFiltered.find(x => x.id === designId);
  if (!d) return;
  if (sweptRecipeId !== recipeLoadId) {
    log('warn', 'Recipe was changed after the last sweep — re-run the sweep first.');
    return;
  }
  const isLab = tool === 'lab';
  const name = isLab ? 'F13LD.lab' : 'F13LD.mesh';
  const recipe = isLab ? buildLabRecipe(d) : buildMeshRecipe(d);
  if (!recipe) { log('warn', 'No recipe available — load a base recipe first'); return; }

  const fullUrl = `${isLab ? LAB_URL : MESH_URL}#r=${encodeURIComponent(JSON.stringify(recipe))}`;
  if (fullUrl.length > HANDOFF_URL_MAX_BYTES) {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)).then(() => {
      log('warn', `Recipe for design #${designId} too large for a link (${fullUrl.length} bytes) — copied JSON to clipboard instead. Drop the JSON into ${name}.`);
      if (btn) flashBtn(btn, '⎘', 'var(--warn)');
    }).catch(() => log('warn', `Recipe for design #${designId} too large for a link, and the clipboard is blocked — use Export Design.`));
    return;
  }
  window.open(fullUrl, '_blank', 'noopener,noreferrer');
  log('accent', `Design #${designId} → ${name} (${fullUrl.length} bytes encoded)`);
  if (btn) flashBtn(btn, '✓', 'var(--success)');
}

function openInMesh(designId, btn) { openHandoff(designId, btn, 'mesh'); }
function openInLab(designId, btn)  { openHandoff(designId, btn, 'lab'); }

function flashBtn(btn, glyph, color) {
  const orig = btn.textContent;
  btn.textContent = glyph;
  btn.style.color = color;
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 900);
}
