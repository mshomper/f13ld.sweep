/* ============================================================
   F13LD.sweep · 22-controls.js
   Direction toggles, sliders, beam resolution warning, cell scale preview.
   ============================================================ */

// ─── Direction toggles ────────────────────────────────────────────────────────
function setDir(rank, dir, btn) {
  directions[rank] = dir;
  const siblings = btn.parentElement.querySelectorAll('button');
  siblings.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ─── Sliders ──────────────────────────────────────────────────────────────────
const samplesSlider = document.getElementById('samplesSlider');
samplesSlider.addEventListener('input', () => {
  document.getElementById('samplesVal').textContent = samplesSlider.value;
});

[document.getElementById('scaleXlo'), document.getElementById('scaleXhi'),
 document.getElementById('scaleYlo'), document.getElementById('scaleYhi'),
 document.getElementById('scaleZlo'), document.getElementById('scaleZhi')].forEach(el => {
  el.addEventListener('input', updateScalePreview);
});

// ─── Beam resolution check — "CAD vision" warning ────────────────────────────
// F13LD.beam's raymarcher renders continuous SDFs, so a 0.05mm strut on a
// 5mm cell looks perfect on screen. The FFT-CG solver in sweep voxelizes
// at FFT_N_BEAM=32 — sub-voxel struts vanish or fragment, and even
// 2-3-voxel struts give noise-dominated stiffness. This helper reports the
// strut-diameter-in-voxels for the base recipe (at ingest) and for the
// jittered low end (at sweep start), so the user sees the actual resolution
// regime they're working in before sweep results come back flat.
//
// Thresholds (empirically chosen, FFT-CG behavior at N=32):
//   < 1.5 voxels  REFUSE     — struts will be sub-voxel and disappear from
//                              the mask. Sweep would produce noise. Block.
//   < 2.5 voxels  WARN HEAVY — struts fragment, percolation may fail per
//                              axis, stiffness numbers are noise.
//   < 3.5 voxels  WARN LIGHT — borderline, stiffness usable for ranking but
//                              absolute values shouldn't be trusted.
//   ≥ 3.5 voxels  OK         — clean resolution, no warning emitted.
//
// Two call sites:
//   loadFile        → uses base recipe radius only (no jitter context yet)
//   runSweep start  → uses jitter low-end (worst-case strut diameter)
//
// Returns { ok, blocking, voxels, message } so callers can also gate
// downstream behavior (e.g. disable Run Sweep when blocking=true).
function checkBeamResolution(recipe, jitterLoFrac = null, label = null) {
  if (!recipe || !recipe.geometry) return { ok: true, voxels: Infinity };
  /* Thinnest strut in one cell, as the solver samples it (cell-local radius;
     the cell spans N voxels over 2 cell-local units). */
  let rMin;
  try {
    const p = designGeometry(recipe).params;
    rMin = Infinity;
    for (let i = 0; i < p.N; i++) rMin = Math.min(rMin, p.rStrut[i]);
  } catch (e) { return { ok: true, voxels: Infinity }; }
  const effR = jitterLoFrac != null ? rMin * jitterLoFrac : rMin;
  const N = (typeof FFT_N_BEAM !== 'undefined' ? FFT_N_BEAM : 32);
  const strutVoxels = effR * N;
  const d = SWEEP_FAMILIES.beam.baseDims(recipe);
  const baseR = Math.min(...d.radius).toFixed(3), cell = d.cell.toFixed(3);
  const ctx = label || (jitterLoFrac != null
    ? `at jitter low (${(jitterLoFrac*100).toFixed(0)}% of base)`
    : 'at base radius');

  if (strutVoxels < 1.5) {
    log('warn', `Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Sub-voxel — solver will see broken/missing struts. Sweep results will not be physically meaningful.`);
    log('warn', `  Try: increase recipe radius (currently ${baseR}mm), reduce cell size (currently ${cell}mm), or use F13LD.beam's homogenization directly.`);
    return { ok: false, blocking: true, voxels: strutVoxels,
             message: 'Strut too thin for solver resolution' };
  }
  if (strutVoxels < 2.5) {
    log('warn', strutVoxels < 2
      ? `Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Borderline — the thinnest designs may break up on this grid and their stiffness is noise-dominated.`
      : `Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Borderline — the thinnest designs' stiffness is approximate; a finer grid resolves them.`);
    return { ok: false, blocking: false, voxels: strutVoxels,
             message: 'Strut diameter borderline' };
  }
  if (strutVoxels < 3.5) {
    log('info', `Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Coarse but usable for ranking; absolute stiffness values approximate.`);
    return { ok: true, blocking: false, voxels: strutVoxels,
             message: 'Strut diameter coarse' };
  }
  // ≥ 3.5 voxels — clean. No log needed; silence is the OK signal.
  return { ok: true, blocking: false, voxels: strutVoxels };
}

function updateScalePreview() {
  if (!baseRecipe) return;
  const fam = SWEEP_FAMILIES[baseFamily];
  if (!fam.usesCellScale) {
    document.getElementById('scaleRangePreview').textContent = `not used — ${fam.label} recipes have no cell scale`;
    return;
  }
  const nom = fam.nominalScale(baseRecipe);
  const get = id => parseFloat(document.getElementById(id).value) || 0;
  // lo/hi are % of nominal: 50 means 0.5× nominal, 200 means 2.0× nominal
  const xlo = +(nom * get('scaleXlo') / 100).toFixed(3);
  const xhi = +(nom * get('scaleXhi') / 100).toFixed(3);
  const ylo = +(nom * get('scaleYlo') / 100).toFixed(3);
  const yhi = +(nom * get('scaleYhi') / 100).toFixed(3);
  const zlo = +(nom * get('scaleZlo') / 100).toFixed(3);
  const zhi = +(nom * get('scaleZhi') / 100).toFixed(3);
  document.getElementById('scaleRangePreview').innerHTML =
    `<span style="color:#5fb5b5">X</span> ${xlo} → ${xhi} &nbsp;` +
    `<span style="color:#c794d4">Y</span> ${ylo} → ${yhi} &nbsp;` +
    `<span style="color:#d4b04a">Z</span> ${zlo} → ${zhi}`;
}

// ─── v0.26.0 — variation and the density window ─────────────────────────────
// Read by runSweep. The window is a volume fraction range; Auto keeps it at
// the recipe's own density ± spread, inside the solver's bounds for the
// design's mode (44-solver-config.js RHO_MIN_* / resolveRhoMax).
function getVariation() {
  const mode = document.getElementById('variationMode').value === 'explore' ? 'explore' : 'neighbourhood';
  let sp = parseFloat(document.getElementById('spreadPct').value);
  if (!isFinite(sp)) sp = 25;
  return { mode, spread: Math.max(0.01, Math.min(0.9, sp / 100)) };
}
function densityBounds() {
  if (!baseRecipe) return { lo: 0.03, hi: 0.75 };
  const mode = designGeometry(baseRecipe).sweepMode;
  const lo = mode === 'pi-tpms' ? RHO_MIN_PI : mode.startsWith('noise') ? RHO_MIN_NOISE : mode.startsWith('grain') ? RHO_MIN_GRAIN
           : mode === 'beam-solid' ? RHO_MIN_BEAM : RHO_MIN_STD;
  return { lo, hi: resolveRhoMax(mode) };
}
function densityAutoWindow() {
  const b = densityBounds(), sp = getVariation().spread;
  if (baseDensity == null) return b;
  let lo = Math.max(b.lo, baseDensity * (1 - sp)), hi = Math.min(b.hi, baseDensity * (1 + sp));
  if (hi - lo < 0.01) {   /* the recipe sits at (or past) a bound: a window that still has width */
    const c = Math.max(b.lo, Math.min(b.hi, baseDensity)), w = Math.max(0.01, c * sp);
    lo = Math.max(b.lo, c - w); hi = Math.min(b.hi, c + w);
  }
  return { lo, hi };
}
/* Refresh the window when it follows the recipe (Auto). */
function updateDensityAuto() {
  if (document.getElementById('vfAuto').value !== '1') return;
  const w = densityAutoWindow();
  document.getElementById('vfLo').value = (w.lo * 100).toFixed(1);
  document.getElementById('vfHi').value = (w.hi * 100).toFixed(1);
}
function getDensityWindow() {
  const b = densityBounds();
  let lo = parseFloat(document.getElementById('vfLo').value) / 100, hi = parseFloat(document.getElementById('vfHi').value) / 100;
  const auto = document.getElementById('vfAuto').value === '1';
  if (!(isFinite(lo) && isFinite(hi) && hi >= lo)) { const w = densityAutoWindow(); lo = w.lo; hi = w.hi; }
  lo = Math.max(b.lo, Math.min(b.hi, lo)); hi = Math.max(lo, Math.min(b.hi, hi));
  return { lo, hi, auto };
}

// ═════════════════════════════════════════════════════════════════════════════
