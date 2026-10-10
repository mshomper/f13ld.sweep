/* ============================================================
   F13LD.sweep · 20-recipe-load.js
   Recipe file input / drop zone and loading.

   A loaded recipe goes through the same translation F13LD.lab uses
   (geom/recipe.js) to find its family, is completed with F13LD.mesh's
   defaults for anything it leaves out (40-design.js completeRecipe), and
   becomes baseRecipe — the recipe every design of the sweep varies.
   ============================================================ */

document.getElementById('fileInput').addEventListener('change', e => {
  loadFile(e.target.files[0]);
});

const dz = document.getElementById('recipeCard');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
dz.addEventListener('dragleave', () => dz.style.borderColor = '');
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.style.borderColor = '';
  loadFile(e.dataTransfer.files[0]);
});

function sweepIsRunning() {
  const c = document.getElementById('cancelBtn');
  return !!(c && c.style.display === 'block');
}

function loadFile(file) {
  if (!file) return;
  if (sweepIsRunning()) { log('warn', 'Finish or cancel the running sweep before loading another recipe.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    let json;
    try { json = JSON.parse(e.target.result.replace(/^﻿/, '').trim()); }
    catch (err) { log('warn', `Not a JSON file: ${escapeLog(err.message)}`); return; }
    loadRecipe(json, file.name);
  };
  reader.readAsText(file);
}

/* → true when the recipe loaded (v0.28.0) */
function loadRecipe(json, name) {
  /* Clear any previous sweep: exportResults refuses to mix a previous
     recipe's results with this one (recipeLoadId vs sweptRecipeId). */
  results = [];
  currentFiltered = [];
  plotData = [];
  clusterAssignments = new Map();
  lastSweepTargetProfile = null;
  recipeLoadId++;
  const tableWrapEl = document.getElementById('tableWrap');
  if (tableWrapEl) {
    tableWrapEl.innerHTML = '<div class="empty-state">' + swEmptyIcon()
      + '<div>Recipe loaded — click Run Sweep to populate results</div></div>';
  }
  const badgeEl = document.getElementById('resultsBadge');
  if (badgeEl) badgeEl.textContent = '0 designs';
  for (const id of ['validateBtn', 'exportDesignBtn']) {
    const b = document.getElementById(id);
    if (b) b.disabled = true;            /* look comes from .pill-btn:disabled */
  }
  if (typeof clearSelection === 'function') clearSelection();
  if (typeof drawPlot === 'function') drawPlot();
  document.getElementById('runBtn').disabled = true;

  let family, completed;
  try {
    family = labRecipeInfo(json).family;
    if (!SWEEP_FAMILIES[family]) {
      log('warn', `${escapeLog(name)}: family "${escapeLog(family)}" is not swept (supported: ${SWEEP_FAMILY_LIST.join(', ')}) — sweep disabled`);
      return false;
    }
    completed = completeRecipe(json);
    designGeometry(completed);                 /* throws if the recipe can't be built */
    /* v0.29.0 — a family can refuse a recipe it can't sweep (wave: fractional indices, a zero field) */
    const why = SWEEP_FAMILIES[family].loadProblem ? SWEEP_FAMILIES[family].loadProblem(completed) : null;
    if (why) throw new Error(why);
  } catch (err) {
    log('warn', `${escapeLog(name)}: ${escapeLog(err.message)} — sweep disabled`);
    return false;
  }
  /* v0.28.0 — a target from Vault named the design it came from (63-auto-target.js) */
  if (typeof tgtOnNewRecipe === 'function') tgtOnNewRecipe();
  baseRecipe = completed;
  baseFamily = family;
  const fam = SWEEP_FAMILIES[family];
  /* v0.26.0 — the recipe's density, the centre of the automatic window */
  try { baseDensity = densityOf(completed); } catch (e) { baseDensity = null; }
  /* a window set by hand belongs to the recipe it was set for: a new recipe
     starts on Auto (Matt, 2026-10-09 — three recipes ran on the first one's window) */
  document.getElementById('vfAuto').value = '1';
  if (typeof updateDensityAuto === 'function') updateDensityAuto();

  document.getElementById('fileName').textContent = name;
  const summary = fam.describe(completed);
  document.getElementById('fileMeta').textContent = summary;
  const nominal = fam.nominalScale(completed);
  document.getElementById('nominalLabel').textContent = fam.usesCellScale
    ? `nominal cell scale: ${+nominal.toFixed(4)}${family === 'beam' ? ' mm' : ''}`
    : 'cell scale: not used by this family';
  document.getElementById('recipeEmpty').style.display = 'none';
  document.getElementById('recipeLoaded').style.display = 'block';
  document.getElementById('recipeCard').classList.add('loaded');
  document.getElementById('runBtn').disabled = false;
  if (typeof updateDock === 'function') updateDock();

  log('info', `Loaded: ${escapeLog(name)}`);
  log('accent', escapeLog(summary));
  if (baseDensity != null) log('info', `Recipe density ${(baseDensity * 100).toFixed(1)} % — every design is drawn a density and its ${(densityKnob(completed) || { name: 'shape' }).name.replace(' ×', '')} is set to hit it`);
  /* Say what was filled in, so a recipe without explicit flags isn't read
     differently without notice (F13LD.mesh's defaults; Lab's import differs). */
  const g0 = json.geometry || {}, g1 = completed.geometry || {};
  const filled = [];
  for (const k of ['mode', 'shell_normalize', 'pi_normalize', 'pipe_radius', 'wall_thickness']) {
    if (family === 'tpms' && g1[k] != null && g0[k] !== g1[k]) filled.push(`${k} = ${g1[k]}${g0[k] != null ? ' (was ' + escapeLog(g0[k]) + ')' : ''}`);
  }
  if (family === 'noise' && (json.surface || {}).norm_min == null) filled.push('normalization range (F13LD.noise 32³ scan)');
  if (filled.length) log('info', `Not in the recipe, set as F13LD.mesh reads it: ${filled.join(' · ')}`);
  if (family === 'beam') checkBeamResolution(baseRecipe);
  if (family === 'foam') {   /* v0.27.0 */
    const tile = (completed.geometry || {}).tile_mm, cell = parseFloat((document.getElementById('cellSize') || {}).value);
    log('info', `Foam: the tile is one solver cell and stays a cube; the Cell scale ranges stretch the foam's cells inside it (anisotropy).${tile > 0 && Math.abs(tile - cell) > 1e-6 ? ` The recipe's tile is ${tile} mm — set Cell size to ${tile} mm in Configure for pore sizes in µm at that scale.` : ''}`);
  }

  if (fam.prefersExplore && fam.prefersExplore(completed) && typeof pxSet === 'function' &&
      document.getElementById('variationMode').value !== 'explore') {   /* v0.29.0 */
    pxSet('variationMode', 'explore', 'change');
    log('info', `Single-mode wave: Variation set to Explore so the mode indices can move — in Neighbourhood ${(completed.field || {}).mode === 'sheet' ? 'only the iso shift, phase and density move' : 'only the density moves (the iso level is the density knob)'}. You can switch back in the dock.`);
  }

  if (family === 'wave' && waveEqualAxes(completed)) {   /* v0.29.0 */
    const sym = (completed.field || {}).symmetry || 'cubic';
    log('info', `Wave, ${sym} symmetry: every mode is summed over the axis swaps, so on a cube Ex = Ey = Ez whatever the modes, phases or amplitudes. Only the cell stretch (the Cell scale ranges) makes the axes differ — keep the ranges open to rank on anisotropy or directionality.`);
  }

  updateScalePreview();
  const sc = recipeCellScale(completed, family);
  showPreview({ id: 'base', family, recipe: completed, scaleX: sc[0], scaleY: sc[1], scaleZ: sc[2],
                anisotropy: (completed.homogenization && typeof completed.homogenization.anisotropy === 'number') ? completed.homogenization.anisotropy : null });
  return true;   /* v0.28.0 — the link loader checks it */
}
