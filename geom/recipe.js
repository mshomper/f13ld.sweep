/* ============================================================
   F13LD.sweep · geom/recipe.js
   External F13LD recipe → lab recipe (family, mode, geometry translation).

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (60-add-design.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-RECIPE v1 · shared recipe translation (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ----------------------------------------------------------
   External F13LD recipe → lab recipe, with no DOM or lab state, so
   F13LD.sweep builds every design through exactly this code too.
     labRecipeInfo(json)                 family, mode, topology, cell size
     labRecipeFromJson(json, title, info) the lab recipe (or null + note)
   normalizeDesignJson below adds the card metadata around it.
   ---------------------------------------------------------- */
function labRecipeInfo(json){
  /* ── 1. Family inference ─────────────────────────────────── */
  var family = json.family || json.tool || null;
  if (!family){
    /* New SDF families first — mirror mesh routeRecipe precedence so a
       flag-less legacy export still routes correctly.  wave is probed
       before grain (both use a `field` block) by requiring field.modes[]. */
    if (json.meta && json.meta.tool === 'f13ld.foam') family = 'foam';   /* v0.14.0 — pre-v0.3.0 foam exports */
    else if (json.meta && (json.meta.tool === 'beam' || json.meta.tool === 'beam-builder')) family = 'beam';
    else if (Array.isArray(json.beams) && json.beams.length &&
             Array.isArray(json.beams[0]) && json.beams[0].length >= 6) family = 'beam';
    else if (json.surface && (json.surface.structure || json.surface.type === 'ihb')) family = 'bundle';
    else if (json.field && Array.isArray(json.field.modes)) family = 'wave';
    else if (json.meta && json.meta.tool === 'grain') family = 'grain';
    else if (json.meta && json.meta.tool === 'noise-scaffold-explorer') family = 'noise';
    else if (json.field && typeof json.field === 'object') family = 'grain';
    else if (json.surface && json.surface.type === 'noise') family = 'noise';
    else if (json.surface && (json.surface.type === 'terms' || json.surface.type === 'raw_preset')) family = 'tpms';
    else family = 'unknown';
  }

  /* ── 3. Topology / mode (external uses bare strings) ─────── */
  /* TPMS and Noise put the mode under `geometry.mode`.
     Grain puts it under `geometry.topology` instead.
     Some old recipes also have a top-level `topology` key.
     Probe all three so all three families work. */
  var rawMode = (json.geometry && (json.geometry.mode || json.geometry.topology)) ||
                json.topology || null;
  /* Add family prefix where lab requires it.  TPMS modes (solid/shell/pi-tpms)
     don't take a prefix; Noise/Grain bare 'half'/'sheet'/'solid' need one. */
  var topology = rawMode || 'sheet';
  var labMode = rawMode;
  if (rawMode && (family === 'noise' || family === 'grain')){
    if (rawMode === 'half')  labMode = family + '-half';
    else if (rawMode === 'sheet') labMode = family + '-sheet';
    else if (rawMode === 'solid') labMode = family + '-solid';
    /* F13LD.noise exports its sheet topology as 'shell'.  v0.26.0: map it to
       noise-sheet (|field − center| < half_width) — before, it ran the TPMS
       shell branch on offset / wall_thickness, which agreed only because the
       tool writes offset = center and wall_thickness = half_width, and a
       half-width sweep then changed nothing. */
    else if (rawMode === 'shell' && family === 'noise') labMode = 'noise-sheet';
    /* else: rawMode is already prefixed or is something else */
  }

  /* ── 4. Cell size — external uses dimensionless cell_scale, lab uses cellSizeMm.
        For visualization the kernel works in [-π, π] regardless, so cell size only
        matters for permeability calc.  Use cellSizeMm if given (lab dialect),
        otherwise default to 5 mm.  cell_scale from external recipes is preserved
        in the geometry block but not consumed by lab solvers. */
  var cellSizeMm = (json.geometry && (json.geometry.cellSizeMm || json.geometry.cell_size_mm)) || 5.0;
  /* v0.14.0 — a foam tile is one lab cell; tile_mm is its edge at the tool's cell size */
  if (family === 'foam' && json.geometry && json.geometry.tile_mm > 0) cellSizeMm = json.geometry.tile_mm;

  return { family: family, rawMode: rawMode, labMode: labMode, topology: topology, cellSizeMm: cellSizeMm };
}

function labRecipeFromJson(json, title, info){
  info = info || labRecipeInfo(json);
  var family = info.family, labMode = info.labMode, cellSizeMm = info.cellSizeMm;

  /* ── 6. Build a renderable lab recipe ─────────────────────── */
  var recipe = null;
  var recipeNote = '';
  var DEFAULT_MATERIAL = (typeof MATERIAL_TI64_BONE !== 'undefined') ? MATERIAL_TI64_BONE
    : { Es_MPa: 110000, nu: 0.34, ks_WmK: 6.7, muFluid_PaS: 0.001 };

  /* Translate external geometry → lab geometry */
  function buildLabGeometry(extG, defaultMode){
    extG = extG || {};
    var labG = {
      mode:       labMode || defaultMode,
      cellSizeMm: cellSizeMm,
      cellMult:   1.0
    };
    /* offset (TPMS, noise iso threshold).  null means lab uses 0. */
    if (extG.offset != null) labG.offset = extG.offset;
    /* Wall thickness — snake_case → camelCase */
    var wt = extG.wall_thickness != null ? extG.wall_thickness : extG.wallThickness;
    if (wt != null) labG.wallThickness = wt;
    /* Pipe radius — snake_case → camelCase */
    var pr = extG.pipe_radius != null ? extG.pipe_radius : extG.pipeR;
    if (pr != null) labG.pipeR = pr;
    /* Phase shift — snake_case → camelCase */
    var ps = extG.phase_shift != null ? extG.phase_shift : extG.phaseShift;
    if (ps != null) labG.phaseShift = ps;
    /* v0.13.0 — field-pair PI-TPMS: field B frequency multiple + amplitude match */
    var fbf = extG.field_b_freq != null ? extG.field_b_freq : extG.fieldBFreq;
    if (fbf != null) labG.fieldBFreq = fbf;
    var fbs = extG.field_b_scale != null ? extG.field_b_scale : extG.fieldBScale;
    if (fbs != null) labG.fieldBScale = fbs;
    /* v0.8.2 — gradient-normalization flags from F13LD.tpms / F13LD.mesh
       (pi_normalize: cylindrical PI-TPMS pipes, radius in distance units;
       shell_normalize: constant-thickness walls).  Were dropped here, so every
       imported recipe ran un-normalized (≈10 % less material on a gyroid
       PI-TPMS).  Only an explicit true/false is carried; null or absent stays
       absent, and TpmsKernel.parseRecipe then defaults to OFF (older recipes
       keep their previous results). */
    if (extG.pi_normalize === true || extG.pi_normalize === false) labG.pi_normalize = extG.pi_normalize;
    if (extG.shell_normalize === true || extG.shell_normalize === false) labG.shell_normalize = extG.shell_normalize;
    /* v0.26.0 — anisotropic shell wall (F13LD.sweep exports, read by F13LD.mesh):
       normal_weights {wx,wy,wz} → nWeights.  Mesh takes the surface normal in
       world space, so the per-axis cell scale rides along (cellScale) for it. */
    var nw = extG.normal_weights != null ? extG.normal_weights : extG.nWeights;
    if (nw != null) labG.nWeights = nw;
    var csD = extG.cell_scale != null ? extG.cell_scale : 1;
    var csX = extG.cell_scale_x != null ? extG.cell_scale_x : csD;
    var csY = extG.cell_scale_y != null ? extG.cell_scale_y : csD;
    var csZ = extG.cell_scale_z != null ? extG.cell_scale_z : csD;
    if (Array.isArray(extG.cellScale)) labG.cellScale = extG.cellScale.slice();
    else if (csX !== csD || csY !== csD || csZ !== csD) labG.cellScale = [csX, csY, csZ];
    /* half_invert — already matches */
    if (extG.half_invert != null) labG.half_invert = extG.half_invert;
    /* center / half_width — used by NoiseKernel.parseRecipe via surface block,
       but Grain reads from geometry.  Pass through verbatim. */
    if (extG.center != null) labG.center = extG.center;
    if (extG.half_width != null) labG.half_width = extG.half_width;
    if (extG.smoothing != null) labG.smoothing = extG.smoothing;
    return labG;
  }

  /* Field B of a field-pair PI-TPMS recipe → lab terms.  A preset's additive
     constant stays INSIDE field B's terms (zero-factor term) — the shared
     geometry.offset already holds field A's constant. */
  function labSurfaceB(sb){
    if (!sb) return null;
    if (sb.type === 'raw_preset'){
      if (!TPMS_RAW_PRESET_TABLE[sb.preset]) throw new Error('Field B preset "' + sb.preset + '" is not in the expansion table');
      return { type: 'terms', preset: sb.preset, label: TPMS_RAW_PRESET_TABLE[sb.preset].label,
               terms: tpmsPresetTermsWithConstant(sb.preset) };
    }
    if (Array.isArray(sb.terms)) return { type: 'terms', preset: sb.preset || 'custom', terms: sb.terms };
    throw new Error('Field B (surface_b) has neither terms nor a preset');
  }

  if (typeof KERNELS !== 'undefined' && KERNELS[family]){
    if (family === 'tpms'){
      if (json.surface && json.surface.type === 'terms' && Array.isArray(json.surface.terms)){
        recipe = {
          family: 'tpms',
          name: title,
          surface: json.surface,
          geometry: buildLabGeometry(json.geometry, 'solid'),
          material: json.material || DEFAULT_MATERIAL
        };
        if (json.surface_b) recipe.surface_b = labSurfaceB(json.surface_b);
        recipeNote = 'TPMS recipe (terms surface) accepted';
      } else if (json.surface && json.surface.type === 'raw_preset'){
        /* Expand named preset to lab terms via the embedded preset table.
           Most presets have a built-in additive constant (e.g. split-P's −0.3)
           which shifts the iso level — we extract that into geometry.offset
           because lab's "solid where F < offset" convention places constants
           there rather than in the surface. */
        var presetKey = json.surface.preset;
        var preset = TPMS_RAW_PRESET_TABLE[presetKey];
        if (preset){
          var baseGeom = buildLabGeometry(json.geometry, 'solid');
          /* Shift offset by -constant so that (F_terms < offset_lab) matches
             (F_terms + constant < offset_external).  Lab's resolved offset
             default is 0, external recipes typically have offset=0 too. */
          baseGeom.offset = (baseGeom.offset != null ? baseGeom.offset : 0) - preset.constant;
          recipe = {
            family: 'tpms',
            name: title,
            surface: {
              type: 'terms',
              preset: presetKey,
              terms: preset.terms
            },
            geometry: baseGeom,
            material: json.material || DEFAULT_MATERIAL
          };
          if (json.surface_b) recipe.surface_b = labSurfaceB(json.surface_b);
          recipeNote = 'TPMS preset "' + (preset.label || presetKey) + '" expanded to terms';
        } else {
          recipeNote = 'TPMS preset "' + (json.surface.label || presetKey) +
                       '" not in expansion table — falling back to SVG mock';
        }
      } else {
        recipeNote = 'TPMS recipe missing surface.terms — falling back to SVG mock';
      }
    } else if (family === 'noise'){
      /* Lab NoiseKernel.parseRecipe expects the surface block (with type='noise')
         and reads geometry.half_invert.  External recipes match this shape, just
         need our remapped geometry. */
      if (json.surface && json.surface.type === 'noise'){
        /* The tool's norm_min/norm_max belong to the exported settings:
           stamp them (norm_for) so NoiseKernel recomputes the range once a
           sweep changes the field (see the NoiseKernel header, 13-kernels.js).
           noiseNormKey throws on an unknown noise type, so a bad recipe is
           refused here, on import. */
        var nSurf = {}; for (var kN in json.surface) nSurf[kN] = json.surface[kN];
        var nKey = noiseNormKey(nSurf);
        if (nSurf.norm_for == null && nSurf.norm_min != null && nSurf.norm_max != null) nSurf.norm_for = nKey;
        recipe = {
          family: 'noise',
          name: title,
          surface: nSurf,
          geometry: buildLabGeometry(json.geometry, 'noise-sheet'),
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Noise recipe accepted';
      } else {
        recipeNote = 'Noise recipe missing surface block (type="noise") — falling back to SVG mock';
      }
    } else if (family === 'grain'){
      /* Lab GrainKernel.parseRecipe reads from field block; external matches. */
      if (json.field && typeof json.field === 'object'){
        recipe = {
          family: 'grain',
          name: title,
          field: json.field,
          geometry: buildLabGeometry(json.geometry, 'grain-sheet'),
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Grain recipe accepted';
      } else {
        recipeNote = 'Grain recipe missing field block — falling back to SVG mock';
      }
    } else if (family === 'beam'){
      /* BeamKernel.parseRecipe reads recipe.beams + recipe.geometry (snake_case
         fields: cell_scale | scale_xyz+cell, radius | radius_x/y/z, node_*).
         Rasterizer mode 'solid' → default SDF branch (negative-inside < 0). */
      if (Array.isArray(json.beams) && json.beams.length){
        var gBeam = {}; for (var kB in (json.geometry || {})) gBeam[kB] = json.geometry[kB];
        gBeam.mode = 'solid'; gBeam.cellSizeMm = cellSizeMm; gBeam.cellMult = 1.0;
        recipe = {
          family: 'beam', name: title,
          beams: json.beams, geometry: gBeam,
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Beam recipe accepted (' + json.beams.length + ' strut(s))';
      } else {
        recipeNote = 'Beam recipe missing beams[] — falling back to SVG mock';
      }
    } else if (family === 'bundle'){
      /* BundleKernel.parseRecipe → _bundleParamsFromJSON reads recipe.surface
         (+ recipe.meta.preset fallback) and recipe.geometry.  Pass geometry
         through verbatim (snake_case) and tag rasterizer mode 'solid'. */
      if (json.surface && typeof json.surface === 'object'){
        var gBun = {}; for (var kU in (json.geometry || {})) gBun[kU] = json.geometry[kU];
        gBun.mode = 'solid'; gBun.cellSizeMm = cellSizeMm; gBun.cellMult = 1.0;
        recipe = {
          family: 'bundle', name: title,
          surface: json.surface, geometry: gBun, meta: json.meta || null,
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Bundle recipe accepted (' + (json.surface.structure || 'bundle') + ')';
      } else {
        recipeNote = 'Bundle recipe missing surface block — falling back to SVG mock';
      }
    } else if (family === 'foam'){
      /* v0.14.0 — FoamKernel (13d) runs mesh's buildFoamSDF on the foam
         tool's own blocks.  Its geometry block (mode open|closed|plateau,
         thickness, plateau_k, organic, normalize) moves to recipe.foam so
         recipe.geometry.mode can carry the rasterizer's 'solid'. */
      if (json.domain && json.domain.periodic === false){
        throw new Error('This foam isn\u2019t periodic, so it isn\u2019t a valid unit cell: opposite faces of the cube ' +
          'must match for the lab to homogenize it.\n\nIn F13LD.foam, turn periodic on and export again.');
      }
      if (json.seeds && (Array.isArray(json.seeds.positions) || json.seeds.mode)){
        var fSeeds = {}; for (var kS in json.seeds) fSeeds[kS] = json.seeds[kS];
        if (Array.isArray(fSeeds.positions)) fSeeds.positions_for = foamSeedKey(fSeeds);
        var fGeo = {}; for (var kF in (json.geometry || {})) fGeo[kF] = json.geometry[kF];
        var an = json.anisotropy || {};
        /* stretch off ≡ stretch 1,1,1 (identical field), so a sweep can turn it on by value alone */
        var fAniso = (an.enabled && Array.isArray(an.stretch) && an.stretch.length === 3)
          ? { enabled: true, stretch: an.stretch.slice() } : { enabled: true, stretch: [1, 1, 1] };
        recipe = {
          family: 'foam', name: title,
          seeds: fSeeds, anisotropy: fAniso, foam: fGeo,
          geometry: { mode: 'solid', cellSizeMm: cellSizeMm, cellMult: 1.0 },
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Foam recipe accepted (' + (fGeo.mode || 'plateau') + ', ' +
                     (Array.isArray(fSeeds.positions) ? (fSeeds.positions.length / 3) + ' stored seeds' : 'seeds regenerated') + ')';
      } else {
        recipeNote = 'Foam recipe missing its seeds block — falling back to SVG mock';
      }
    } else if (family === 'wave'){
      /* WaveKernel.parseRecipe reads recipe.field (modes[], symmetry, iso,
         mode='sheet'|'solid', thickness, signFlip).  No geometry needed
         beyond the rasterizer 'solid' tag (topology lives in evaluate). */
      if (json.field && Array.isArray(json.field.modes)){
        recipe = {
          family: 'wave', name: title,
          field: json.field,
          geometry: { mode: 'solid', cellSizeMm: cellSizeMm, cellMult: 1.0 },
          material: json.material || DEFAULT_MATERIAL
        };
        recipeNote = 'Wave recipe accepted (' + json.field.modes.length + ' mode(s), ' +
                     (json.field.symmetry || 'pure') + ')';
      } else {
        recipeNote = 'Wave recipe missing field.modes[] — falling back to SVG mock';
      }
    }
  } else if (family === 'unknown'){
    recipeNote = 'family could not be inferred from JSON — falling back to SVG mock';
  } else {
    recipeNote = 'family "' + family + '" not in KERNELS — falling back to SVG mock';
  }
  return { recipe: recipe, recipeNote: recipeNote };
}
/* ==== /F13LD-GEOM-RECIPE ==== */
