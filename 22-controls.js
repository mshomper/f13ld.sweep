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
function checkBeamResolution(recipe, jitterLoFrac = null) {
  if (!recipe || !recipe.geometry) return { ok: true, voxels: Infinity };
  const cell = recipe.geometry.cell || recipe.geometry.cell_scale || 1.5;
  const baseR = recipe.geometry.radius || 0.1;
  // At sweep time, the worst-case radius is jitterLoFrac × baseR (e.g. 0.5 ×
  // base when the lo input is 50%). At ingest, just use baseR — the lo is
  // unknown until the user runs the sweep.
  const effR = jitterLoFrac != null ? baseR * jitterLoFrac : baseR;
  const N = (typeof FFT_N_BEAM !== 'undefined' ? FFT_N_BEAM : 32);
  const voxelMm = cell / N;
  const strutVoxels = (2 * effR) / voxelMm;
  const ctx = jitterLoFrac != null
    ? `at jitter low (${(jitterLoFrac*100).toFixed(0)}% of base)`
    : 'at base radius';

  if (strutVoxels < 1.5) {
    log('warn', `⚠ Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Sub-voxel — solver will see broken/missing struts. Sweep results will not be physically meaningful.`);
    log('warn', `  Try: increase recipe radius (currently ${baseR}mm), reduce cell size (currently ${cell}mm), or use F13LD.beam's homogenization directly.`);
    return { ok: false, blocking: true, voxels: strutVoxels,
             message: 'Strut too thin for solver resolution' };
  }
  if (strutVoxels < 2.5) {
    log('warn', `⚠ Strut diameter ${ctx}: ${strutVoxels.toFixed(2)} voxels (N=${N}). Borderline — many designs will fail percolation and stiffness will be noise-dominated.`);
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
  const nom = baseRecipe.geometry.cell_scale || 1.0;
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

// ═════════════════════════════════════════════════════════════════════════════
