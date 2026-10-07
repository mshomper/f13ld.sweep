/* ============================================================
   F13LD.sweep · 20-recipe-load.js
   Recipe file input / drop zone, TPMS preset terms, loadFile.
   ============================================================ */

// ─── File loading ─────────────────────────────────────────────────────────────
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

// Fischer-Koch, Lidinoid, Split-P, F-RD use double-frequency terms not in the
// standard factor model. We approximate them with their closest standard-term
// equivalents so the sweep engine can vary coefficients and frequencies.
// For rendering, the GLSL path uses the exact formula anyway.
function resolveRawPreset(preset) {
  const mk = (factors, coef) => ({ on: true, coef, factors });
  const f  = (trig, fx=1, fy=1, fz=1) => ({ trig, fx, fy, fz });
  switch (preset) {
    case 'fks': // Fischer-Koch S: cos(2x)sin(y)cos(z) + cyclic
      return [
        mk([f('cos(x)',2,1,1), f('sin(y)'), f('cos(z)')], 1),
        mk([f('cos(y)',1,2,1), f('sin(z)'), f('cos(x)')], 1),
        mk([f('cos(z)',1,1,2), f('sin(x)'), f('cos(y)')], 1),
      ];
    case 'lidinoid': // Lidinoid: 1.1*(sin2x cosy sinz + ...) - 0.2*(cos2x cos2y + ...) - 0.4*(cos2x + ...)
      return [
        mk([f('sin(x)',2,1,1), f('cos(y)'), f('sin(z)')],  1.1),
        mk([f('sin(y)',1,2,1), f('cos(z)'), f('sin(x)')],  1.1),
        mk([f('sin(z)',1,1,2), f('cos(x)'), f('sin(y)')],  1.1),
        mk([f('cos(x)',2,1,1), f('cos(y)',1,2,1)],         -0.2),
        mk([f('cos(y)',1,2,1), f('cos(z)',1,1,2)],         -0.2),
        mk([f('cos(z)',1,1,2), f('cos(x)',2,1,1)],         -0.2),
        mk([f('cos(x)',2,1,1)],                            -0.4),
        mk([f('cos(y)',1,2,1)],                            -0.4),
        mk([f('cos(z)',1,1,2)],                            -0.4),
      ];
    case 'splitP': // Split-P: sin(x)sin(y)cos(z) + cyclic - 0.3
      return [
        mk([f('sin(x)'), f('sin(y)'), f('cos(z)')], 1),
        mk([f('sin(y)'), f('sin(z)'), f('cos(x)')], 1),
        mk([f('sin(z)'), f('sin(x)'), f('cos(y)')], 1),
      ];
    case 'frd': // F-RD approximation via dominant terms
      return [
        mk([f('sin(x)',2,1,1), f('cos(y)'), f('sin(z)')],  1),
        mk([f('sin(y)',1,2,1), f('cos(z)'), f('sin(x)')],  1),
        mk([f('sin(z)',1,1,2), f('cos(x)'), f('sin(y)')],  1),
        mk([f('cos(x)',2,1,1), f('cos(y)',1,2,1)],         -1),
        mk([f('cos(y)',1,2,1), f('cos(z)',1,1,2)],         -1),
        mk([f('cos(z)',1,1,2), f('cos(x)',2,1,1)],         -1),
      ];
    default:
      return null;
  }
}

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      baseRecipe = JSON.parse(e.target.result.replace(/^\uFEFF/, '').trim());

      // v0.12.1: clear any stale sweep state from a previous recipe.
      // Without this, exportResults would happily emit the *previous*
      // sweep's per-design data under the newly-loaded recipe's meta/base
      // block — see the load-Grain → load-TPMS → export bug. recipeLoadId
      // is incremented so runSweep/exportResults can detect mismatch.
      results = [];
      currentFiltered = [];
      recipeLoadId++;
      // sweptRecipeId stays at its previous value — until the next runSweep
      // succeeds against THIS recipeLoadId, exportResults will refuse.
      // Clear the results table UI and disable downstream buttons.
      const tableWrapEl = document.getElementById('tableWrap');
      if (tableWrapEl) {
        tableWrapEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⬡</div>'
          + '<div>Recipe loaded — click Run Sweep to populate results</div></div>';
      }
      const badgeEl = document.getElementById('resultsBadge');
      if (badgeEl) badgeEl.textContent = '0 designs';
      const validateBtnEl = document.getElementById('validateBtn');
      if (validateBtnEl) {
        validateBtnEl.disabled = true;
        validateBtnEl.style.opacity = '0.5';
        validateBtnEl.style.cursor = 'not-allowed';
      }
      const exportDesignBtnEl = document.getElementById('exportDesignBtn');
      if (exportDesignBtnEl) {
        exportDesignBtnEl.disabled = true;
        exportDesignBtnEl.style.opacity = '0.5';
        exportDesignBtnEl.style.cursor = 'not-allowed';
      }

      // Family resolution — explicit recipe.family wins; otherwise infer from
      // surface.type ('noise' → noise) or field.type ('spinodoid' / 'gaussian'
      // / 'hyperuniform' → grain) and fall back to 'tpms'. Tool exports today
      // don't include a recipe.family field, so this inference is what makes
      // existing exports loadable. Once parseRecipe runs, it injects
      // recipe.family for downstream stability.
      //
      // Reaction-diffusion (grain RD) recipes are routed to family='grain' so
      // GrainKernel.parseRecipe fires its deferred-feature error (rather than
      // misrouting to 'tpms' and producing a confusing 'missing terms' error).
      let family = baseRecipe.family;
      if (!family) {
        const stype = baseRecipe.surface && baseRecipe.surface.type;
        const ftype = baseRecipe.field && baseRecipe.field.type;
        if      (Array.isArray(baseRecipe.beams))                  family = 'beam';
        else if (stype === 'noise')                                family = 'noise';
        else if (stype === 'terms' || stype === 'raw_preset')      family = 'tpms';
        else if (ftype === 'spinodoid' || ftype === 'gaussian'
              || ftype === 'hyperuniform')                         family = 'grain';
        else if (ftype === 'reactiondiffusion')                    family = 'grain';
        else                                                       family = 'tpms';
      }
      const kernel = KERNELS[family];
      if (!kernel) {
        log('warn', `Unknown family "${family}" — only [${Object.keys(KERNELS).join(', ')}] supported`);
        document.getElementById('runBtn').disabled = true;
        return;
      }

      // parseRecipe absorbs raw_preset resolution and any family-specific
      // recipe-shape normalisation. Throws if the recipe is malformed.
      let baseParams;
      try {
        baseParams = kernel.parseRecipe(baseRecipe);
      } catch (err) {
        log('warn', err.message + ' — sweep disabled');
        document.getElementById('runBtn').disabled = true;
        return;
      }
      // Stash resolved params on the recipe — runSweep reads this to avoid
      // a second parseRecipe call. Family-agnostic, opaque to consumers.
      baseRecipe._params = baseParams;

      // TPMS field-normalization flags (round-tripped from F13LD.tpms exports).
      //   shell_normalize=true → |φ−offset|/|∇φ|  (uniform perpendicular wall thickness)
      //   pi_normalize=true    → angle-corrected distance to intersection curve
      //                          (true cylindrical pipes, r in spatial units)
      // Default both to false so older recipes (pre-flag) reproduce their
      // existing un-normalized geometry bit-for-bit. New F13LD.tpms exports
      // always carry the flag explicit. Beam/noise/grain families ignore.
      if (family === 'tpms') {
        baseRecipe.geometry = baseRecipe.geometry || {};
        if (baseRecipe.geometry.pi_normalize    == null) baseRecipe.geometry.pi_normalize    = false;
        if (baseRecipe.geometry.shell_normalize == null) baseRecipe.geometry.shell_normalize = false;
      }
      // TPMS-only legacy: stash terms on surface for downstream TPMS-shaped
      // consumers (table preview format, F13LD.mesh export). Noise recipes
      // skip this — their consumers read from baseDesign.params instead.
      if (family === 'tpms' && baseParams.terms) {
        baseRecipe.surface.terms = baseParams.terms;
      }

      document.getElementById('fileName').textContent = file.name;
      // fileMeta — family-aware summary string
      let metaSummary;
      if (family === 'noise') {
        const s = baseRecipe.surface;
        metaSummary = `family: noise · type: ${s.noise_type} · freq ${s.frequency} · scales [${s.scale_x},${s.scale_y},${s.scale_z}]`;
      } else if (family === 'grain') {
        const f = baseRecipe.field || {};
        const g = baseRecipe.geometry || {};
        if (f.type === 'spinodoid') {
          metaSummary = `family: grain · type: spinodoid · N=${f.n_waves} κ=${f.kappa} f=${f.frequency} · iso=${g.center} hw=${g.half_width}`;
        } else if (f.type === 'gaussian') {
          metaSummary = `family: grain · type: GRF · σ=${f.grf_sigma} N=${f.n_waves} f=${f.frequency} · iso=${g.center} hw=${g.half_width}`;
        } else if (f.type === 'hyperuniform') {
          metaSummary = `family: grain · type: hyperuniform · N=${f.hu_n} aspect=${f.hu_aspect} w=${f.hu_width} · iso=${g.center} hw=${g.half_width}`;
        } else {
          metaSummary = `family: grain · type: ${f.type}`;
        }
      } else if (family === 'beam') {
        const t = baseRecipe.topology?.name || 'custom';
        const g = baseRecipe.geometry || {};
        const nBeams = baseRecipe.beams.length;
        metaSummary = `family: beam · topology: ${t} · ${nBeams} struts · radius ${g.radius}mm · cell ${g.cell}mm`;
      } else {
        const g = baseRecipe.geometry || {};
        const m = g.mode || 'solid';
        let normTag = '';
        if (m === 'pi-tpms')   normTag = ` · pi_normalize: ${g.pi_normalize    ? 'on' : 'off'}`;
        else if (m === 'shell') normTag = ` · shell_normalize: ${g.shell_normalize ? 'on' : 'off'}`;
        metaSummary = `family: ${family} · preset: ${baseRecipe.meta?.preset || '?'} · ${baseRecipe.surface.terms.length} terms${normTag}`;
      }
      document.getElementById('fileMeta').textContent = metaSummary;
      // Beam recipes carry cell size as geometry.cell (mm); TPMS/noise/grain
      // use geometry.cell_scale. Normalize so the nominal label and downstream
      // scale-preview math see a consistent value regardless of family.
      const nominalCell = (family === 'beam')
        ? (baseRecipe.geometry?.cell || 1.5)
        : (baseRecipe.geometry?.cell_scale || 1.0);
      document.getElementById('nominalLabel').textContent = `nominal scale: ${nominalCell}`;
      // Mirror the cell into geometry.cell_scale so updateScalePreview and
      // runSweep (which both read geometry.cell_scale) work for beam too.
      // Idempotent — re-assigning to itself if cell_scale was already set.
      if (family === 'beam' && baseRecipe.geometry) {
        baseRecipe.geometry.cell_scale = nominalCell;
      }
      document.getElementById('recipeEmpty').style.display = 'none';
      document.getElementById('recipeLoaded').style.display = 'block';
      document.getElementById('recipeCard').classList.add('loaded');
      document.getElementById('runBtn').disabled = false;
      // Phase 1.3 follow-up: seed the beam preview cube-extent reference
      // from the base recipe's nominal cell scale. After a sweep completes,
      // this gets re-set to the max mean-scale across results so all designs
      // render at proportional sizes. Until then, the base recipe preview
      // sees beamCubeMaxScale === its own scale → cube extent = π → fills
      // the canvas, which is the right framing for a single recipe with no
      // peers to compare against.
      if (family === 'beam') {
        beamCubeMaxScale = nominalCell;
        // Phase 1.4: seed cube pad from base recipe. The pad must accommodate
        // strut radius + node ball radius in LOCAL units (where the cell is
        // ±1). At load we don't yet know what jittered radii a sweep will
        // produce, so use the base radius scaled up by the maximum jitter
        // hi (2.0× by default) as the conservative envelope. After a sweep,
        // beamCubePadGlobal gets re-set to the actual max observed.
        const baseRLocal = (baseRecipe.geometry?.radius || 0.1) / (nominalCell * 0.5);
        beamCubePadGlobal = Math.max(0.10, baseRLocal * 2.0 + 0.05);
      }
      updateScalePreview();
      // Show preview of the base recipe immediately on load — family-aware.
      // TPMS exposes termObjects (the legacy shape consumers expect); noise
      // exposes params directly so showPreview can rebuild whatever it needs.
      const baseDesign = {
        family,
        params: baseParams,
        offset: baseRecipe.geometry.offset || 0,
        scaleX: nominalCell,
        scaleY: nominalCell,
        scaleZ: nominalCell,
        // homogenization.anisotropy is a scalar number for TPMS/noise/grain
        // recipes but an OBJECT for beam recipes (the DSM-PBC export carries
        // {axial_ratio, zener_A, zener_label, E_max_MPa}). Normalize to a
        // scalar here so showPreview's .toFixed(2) doesn't trip on the
        // object. Prefer zener_A — the standard single-scalar anisotropy
        // metric — falling back to axial_ratio, then 1.0 (isotropic).
        anisotropy: (() => {
          const a = baseRecipe.homogenization?.anisotropy;
          if (a === null || a === undefined) return 1.0;
          if (typeof a === 'number') return a;
          if (typeof a === 'object') return a.zener_A ?? a.axial_ratio ?? 1.0;
          return 1.0;
        })()
      };
      if (family === 'tpms') {
        baseDesign.termObjects = baseRecipe.surface.terms.map(t => ({...t, factors: t.factors.map(f => ({...f}))}));
      }
      showPreview(baseDesign);
      log('info', `Loaded: ${file.name}`);
      // Load detail line — noise/tpms carry offset+cell_scale on geometry;
      // grain carries center+half_width+topology instead; beam carries
      // radius+cell. Print the right ones.
      if (family === 'grain') {
        const g = baseRecipe.geometry || {};
        log('accent', metaSummary + ` · topology ${g.topology || 'sheet'}${g.half_invert ? ' (inverted)' : ''}`);
      } else if (family === 'beam') {
        const g = baseRecipe.geometry || {};
        log('accent', metaSummary + ` · radius ${g.radius}mm · cell ${g.cell}mm`);
        // "CAD vision" check: F13LD.beam can render a 0.1mm strut on a
        // 100mm cell because its raymarcher is continuous — the visual
        // fidelity is unbounded. The FFT solver isn't continuous; it sees
        // a voxelized mask at FFT_N_BEAM=32. Sub-voxel struts vanish or
        // fragment, and even 2-3 voxel struts give noise-dominated
        // stiffness. Without a warning, a recipe authored under CAD
        // vision will silently produce flat-line sweep results — the
        // user blames the sweep tool, not the underlying resolution
        // mismatch. So we surface the ratio explicitly at ingest.
        checkBeamResolution(baseRecipe);
      } else {
        log('accent', metaSummary + ` · offset ${baseRecipe.geometry.offset} · nominal scale ${baseRecipe.geometry.cell_scale}`);
      }
    } catch(err) {
      log('warn', `Failed to parse JSON: ${err.message}`);
      log('warn', 'Check file was exported directly from a F13LD design tool');
    }
  };
  reader.readAsText(file);
}
