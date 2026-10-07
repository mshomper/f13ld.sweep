/* ============================================================
   F13LD.sweep · 72-mesh-handoff.js
   F13LD.mesh handoff: buildMeshRecipe, openInMesh.
   ============================================================ */

// ─── F13LD.mesh handoff ───────────────────────────────────────────────────────
// Builds a recipe-shaped JSON for one swept design that matches the format
// f13ld.mesh consumes (see TPMS-builder export shape), then opens f13ld.mesh
// in a new tab with the recipe attached via ?r=<URL-encoded JSON>.
//
// Encoding: F13LD.mesh accepts `?r=<encodeURIComponent(JSON.stringify(recipe))>`
// per its URL ingestion code (no base64, no compression). For typical sweep
// designs this produces ~3–6KB URLs, well within all-browser limits.
//
// NOTE on per-axis scaling: Sweep generates anisotropic cell scales (scaleX,
// scaleY, scaleZ) but the established mesh-tool schema uses a scalar `cell_scale`.
// We populate `cell_scale` with the geometric mean for backward compatibility
// AND attach an extended `scale_xyz` field that f13ld.mesh can consume when
// per-axis support lands. Until then, mesh will treat the design as isotropic
// at the geometric-mean cell size.
//
// To change the F13LD.mesh URL (e.g., custom domain), edit MESH_URL below.
const MESH_URL = 'https://mshomper.github.io/f13ld.mesh/';
// Above some encoded length, browsers (especially mobile Safari) start to choke.
// We fall back to clipboard copy for over-large recipes.
const MESH_URL_MAX_BYTES = 16384;

function buildMeshRecipe(d) {
  if (!baseRecipe) return null;
  const sx = d.scaleX || 1.0, sy = d.scaleY || 1.0, sz = d.scaleZ || 1.0;
  const meanScale = Math.cbrt(sx * sy * sz);

  // Family-aware surface/field block — noise/grain reconstruct the export
  // schema from the design's params; TPMS uses the legacy term-list shape.
  // Grain uses 'field' (not 'surface') and grain-shaped geometry — return
  // early since the rest of this function builds the noise/tpms-shaped
  // geometry object that doesn't apply to grain.
  if (d.family === 'grain') {
    const grainGeom = buildGrainGeometryExport(d.params, baseRecipe);
    // Sweep extensions on top of the F13LD.grain geometry shape — these
    // carry per-design cell scaling so F13LD.mesh can size the cube.
    grainGeom.cell_scale = +meanScale.toFixed(4);
    grainGeom.scale_xyz  = [+sx.toFixed(4), +sy.toFixed(4), +sz.toFixed(4)];
    return {
      meta: {
        version: '0.2.0',
        tool: 'sweep',
        tool_version: F13LD_SWEEP_VERSION,
        timestamp: new Date().toISOString(),
        preset: baseRecipe.meta?.preset || 'grain',
        source_design_id: d.id,
        context: buildAnalysisContext()
      },
      family: d.family,
      field: buildGrainFieldExport(d.params),
      geometry: grainGeom,
      homogenization: perDesignHomogenization(d)
    };
  }

  if (d.family === 'beam') {
    // Beam handoff to F13LD.mesh — round-trips through the F13LD.beam recipe
    // schema (topology + geometry.radius + geometry.cell + beams[]). Per-axis
    // radius vec3 carried as the additional radius_x/y/z fields; the mean
    // goes into the canonical scalar `radius` for downstream consumers that
    // expect the F13LD.beam shape.
    const p = d.params;
    const radiusMean = +((p.rXmm + p.rYmm + p.rZmm) / 3).toFixed(4);
    const beamsOut = p.beams.map(b => [b.ax, b.ay, b.az, b.bx, b.by, b.bz]);
    return {
      meta: {
        version: '0.2.0',
        tool: 'sweep',
        tool_version: F13LD_SWEEP_VERSION,
        timestamp: new Date().toISOString(),
        preset: baseRecipe.meta?.preset || p.topology,
        source_design_id: d.id,
        context: buildAnalysisContext()
      },
      family: d.family,
      topology: baseRecipe.topology ? { ...baseRecipe.topology } : { name: p.topology, beam_count: p.beamCount },
      geometry: {
        radius: radiusMean,
        cell: +meanScale.toFixed(4),
        radius_x: p.rXmm,
        radius_y: p.rYmm,
        radius_z: p.rZmm,
        cell_scale: +meanScale.toFixed(4),
        scale_xyz: [+sx.toFixed(4), +sy.toFixed(4), +sz.toFixed(4)],
        // Phase 2: node treatment. Both default 0 (= un-modified topology).
        node_smoothing_k: p.nodeSmoothKmm || 0,
        node_ball_radius: p.nodeBallRmm || 0
      },
      beams: beamsOut,
      homogenization: perDesignHomogenization(d)
    };
  }

  const surface = (d.family === 'noise')
    ? {
        type: 'noise',
        noise_type: d.params.noiseType,
        frequency: d.params.frequency,
        scale_x: d.params.scaleX, scale_y: d.params.scaleY, scale_z: d.params.scaleZ,
        center: d.params.isoLevel,
        half_width: d.params.halfWidth,
        smoothing: d.params.smoothing || 0,
        topology: baseRecipe.surface?.topology || 'sheet',
        octaves: d.params.octaves || null,
        lacunarity: d.params.lacunarity || null,
        gain: d.params.gain || null,
        warp_strength: d.params.noiseType === 'warp' ? d.params.warpStrength : null,
        distance_metric: d.params.noiseType === 'cellular' ? d.params.distanceMetric : null,
        curl_step: d.params.noiseType === 'curl' ? d.params.curlStep : null,
        potential_scale: d.params.noiseType === 'curl' ? d.params.potentialScale : null,
      }
    : {
        type: 'terms',
        preset: baseRecipe.meta?.preset || 'unknown',
        terms: d.termObjects
      };

  return {
    meta: {
      version: '0.2.0',
      tool: 'sweep',
      tool_version: F13LD_SWEEP_VERSION,
      timestamp: new Date().toISOString(),
      preset: baseRecipe.meta?.preset || 'unknown',
      source_design_id: d.id,
      context: buildAnalysisContext()
    },
    family: d.family,
    surface,
    geometry: {
      offset: d.offset,
      cell_scale: +meanScale.toFixed(4),
      scale_xyz: [+sx.toFixed(4), +sy.toFixed(4), +sz.toFixed(4)],  // sweep extension
      mode: baseRecipe.geometry?.mode || 'solid',
      wall_thickness: baseRecipe.geometry?.wall_thickness || null,
      pipe_radius: d.pipe_radius || null,
      phase_shift: d.phase_shift || null,
      // TPMS field-normalization flags — round-tripped from the source recipe.
      // null when not applicable to the recipe's mode (matches the sweep_results
      // export convention so F13LD.mesh sees the same null-vs-bool semantics).
      pi_normalize:    (baseRecipe.geometry?.mode === 'pi-tpms') ? !!baseRecipe.geometry?.pi_normalize    : null,
      shell_normalize: (baseRecipe.geometry?.mode === 'shell')   ? !!baseRecipe.geometry?.shell_normalize : null,
      normal_weights: d.nWeights || null,
      gradient: { enabled: false }
    },
    homogenization: perDesignHomogenization(d)
  };
}

function openInMesh(designId, btn) {
  if (event) event.stopPropagation();
  const d = currentFiltered.find(x => x.id === designId);
  if (!d) return;
  const recipe = buildMeshRecipe(d);
  if (!recipe) {
    log('warn', 'No recipe available — load a base recipe first');
    return;
  }

  const json = JSON.stringify(recipe);  // compact, not pretty — URL is the consumer
  const encoded = encodeURIComponent(json);
  const fullUrl = `${MESH_URL}?r=${encoded}`;

  // Sanity check URL length — fall back to clipboard for over-large recipes.
  if (fullUrl.length > MESH_URL_MAX_BYTES) {
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)).then(() => {
      log('warn', `Recipe for design #${designId} too large for URL handoff (${fullUrl.length} bytes) — copied JSON to clipboard instead. Drop the JSON into F13LD.mesh manually.`);
      if (btn) flashBtn(btn, '⎘', 'var(--warn)');
    });
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
