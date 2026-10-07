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

  // Build a recipe export from the selected design — family-aware.
  // TPMS designs use the legacy term/factor surface shape; noise designs
  // emit a noise-shaped surface block matching the F13LD.noise tool's
  // export schema. Grain designs emit F13LD.grain's `field` block (not
  // `surface`) with grain-shaped geometry. Filename prefix and meta.source
  // also follow family.
  const d = selectedDesign;
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  const preset = baseRecipe.meta?.preset || 'custom';
  const family = d.family || 'tpms';

  const sourceTag = family === 'noise' ? 'f13ld-sweep noise' :
                    family === 'grain' ? 'f13ld-sweep grain' :
                    family === 'beam'  ? 'f13ld-sweep beam'  :
                    'tpms-pipeline sweep';
  const filenamePrefix = family === 'noise' ? 'noise' :
                         family === 'grain' ? 'grain' :
                         family === 'beam'  ? 'beam'  :
                         'tpms';

  // Grain export shape — F13LD.grain uses 'field' (not 'surface') and
  // 'geometry.topology' (not 'geometry.mode'). Sweep adds cell_scale fields
  // on top of the F13LD.grain geometry shape so F13LD.mesh can size the cube.
  let exportData;
  if (family === 'grain') {
    const grainGeom = buildGrainGeometryExport(d.params, baseRecipe);
    grainGeom.cell_scale   = +((d.scaleX + d.scaleY + d.scaleZ) / 3).toFixed(3);
    grainGeom.cell_scale_x = d.scaleX;
    grainGeom.cell_scale_y = d.scaleY;
    grainGeom.cell_scale_z = d.scaleZ;
    grainGeom.gradient     = baseRecipe.geometry?.gradient || { enabled: false };
    exportData = {
      meta: {
        version: baseRecipe.meta?.version || '0.4.0',
        tool: 'f13ld.sweep',
        tool_version: F13LD_SWEEP_VERSION,
        timestamp: new Date().toISOString(),
        preset: `${preset}_sweep_${d.id}`,
        source: sourceTag,
        sweep_rank: d.id,
        context: buildAnalysisContext()
      },
      family,
      field: buildGrainFieldExport(d.params),
      geometry: grainGeom,
      homogenization: perDesignHomogenization(d, baseRecipe.homogenization?.grid || 48, 'pipeline-sweep-estimate')
    };
  } else if (family === 'beam') {
    // Beam export — mirrors F13LD.beam's recipe schema so designs can be
    // re-loaded by F13LD.beam or rendered by F13LD.mesh. The original beam
    // list is carried through verbatim (Phase 1 doesn't permute topology).
    //
    // Per-design state: rXmm/rYmm/rZmm (the jittered per-axis radius vec3)
    // and the scaleX/Y/Z (per-axis cell size jitter, in mm). F13LD.beam
    // today expects scalar geometry.radius + geometry.cell, so we emit the
    // mean as the canonical scalar AND add per-axis fields (radius_x/y/z
    // and cell_scale_x/y/z) for tools that can consume them. Backwards-
    // compatible with the existing schema since unrecognized fields are
    // ignored on load.
    const p = d.params;
    const radiusMean = +((p.rXmm + p.rYmm + p.rZmm) / 3).toFixed(4);
    const cellMean   = +((d.scaleX + d.scaleY + d.scaleZ) / 3).toFixed(3);
    // Recompute analytical relative density at the jittered radius using
    // F13LD.beam's cylinder-sum-with-sharing formula. Voxelized VF from
    // the solver is in d.volume_fraction (carried separately).
    let totalLenLocal = 0;
    for (const b of p.beams) {
      const dx = b.dxBa, dy = b.dyBa, dz = b.dzBa;
      const L = Math.sqrt(dx*dx + dy*dy + dz*dz);
      // Beam endpoints in local frame — recompute sharing (face/edge/corner)
      let onFaces = 0;
      const eps = 1e-4;
      const ax_ = b.ax, ay_ = b.ay, az_ = b.az;
      const bx_ = b.bx, by_ = b.by, bz_ = b.bz;
      if (Math.abs(Math.abs(ax_) - 1) < eps && Math.abs(Math.abs(bx_) - 1) < eps && Math.sign(ax_) === Math.sign(bx_)) onFaces++;
      if (Math.abs(Math.abs(ay_) - 1) < eps && Math.abs(Math.abs(by_) - 1) < eps && Math.sign(ay_) === Math.sign(by_)) onFaces++;
      if (Math.abs(Math.abs(az_) - 1) < eps && Math.abs(Math.abs(bz_) - 1) < eps && Math.sign(az_) === Math.sign(bz_)) onFaces++;
      totalLenLocal += L / Math.pow(2, onFaces);
    }
    // Cylinder VF at radiusMean (assumes isotropic radius — under anisotropy
    // this is an approximation, accurate to the degree rX≈rY≈rZ).
    const rLocalMean = radiusMean / (cellMean * 0.5);
    const analyticalVF = +(Math.PI * rLocalMean * rLocalMean * totalLenLocal / 8 * 100).toFixed(2);

    // Reconstruct the [ax,ay,az,bx,by,bz] tuples that F13LD.beam expects.
    const beamsOut = p.beams.map(b => [b.ax, b.ay, b.az, b.bx, b.by, b.bz]);

    exportData = {
      meta: {
        version: baseRecipe.meta?.version || '0.2.1',
        tool: 'f13ld.sweep',
        tool_version: F13LD_SWEEP_VERSION,
        timestamp: new Date().toISOString(),
        preset: `${preset}_sweep_${d.id}`,
        source: sourceTag,
        sweep_rank: d.id,
        context: buildAnalysisContext()
      },
      family,
      // Carry topology block from the base recipe so F13LD.beam knows
      // whether this came from a named preset (octet, bcc, …) or a custom
      // builder cell. beam_count stays a property of the topology.
      topology: baseRecipe.topology ? { ...baseRecipe.topology } : { name: p.topology, beam_count: p.beamCount },
      geometry: {
        // Scalar fields — backwards compatible with F13LD.beam loader
        radius: radiusMean,
        cell: cellMean,
        // Per-axis state — Phase 1 anisotropy levers. Sweep emits these;
        // consumers that don't recognize the fields ignore them safely.
        radius_x: p.rXmm,
        radius_y: p.rYmm,
        radius_z: p.rZmm,
        cell_scale: cellMean,
        cell_scale_x: d.scaleX,
        cell_scale_y: d.scaleY,
        cell_scale_z: d.scaleZ,
        // Phase 2 node treatment. Both default 0 (= un-modified topology,
        // identical to a Phase 1 export).
        node_smoothing_k: p.nodeSmoothKmm || 0,
        node_ball_radius: p.nodeBallRmm   || 0
      },
      metrics: {
        // Analytical VF using F13LD.beam's cylinder-with-sharing formula at
        // the jittered radiusMean. This is what F13LD.beam would report on
        // re-load. Differs from the voxelized VF the solver uses (carried
        // in homogenization.volume_fraction below).
        relative_density_pct: analyticalVF,
        total_beam_length_local: +totalLenLocal.toFixed(3)
      },
      beams: beamsOut,
      homogenization: perDesignHomogenization(d, baseRecipe.homogenization?.grid || 48, 'pipeline-sweep-estimate')
    };
  } else {

  // Surface block — family-aware
  const surface = (family === 'noise')
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
        preset: preset,
        terms: d.termObjects
      };

  // Geometry — family-specific fields. Noise carries half_invert on the
  // geometry block; TPMS carries normal_weights.
  const geometry = (family === 'noise')
    ? {
        offset: d.offset,
        cell_scale: +((d.scaleX + d.scaleY + d.scaleZ) / 3).toFixed(3),
        cell_scale_x: d.scaleX,
        cell_scale_y: d.scaleY,
        cell_scale_z: d.scaleZ,
        mode: baseRecipe.geometry?.mode || 'sheet',
        half_invert: !!d.params.halfInvert,
        wall_thickness: baseRecipe.geometry?.wall_thickness || null,
        pipe_radius: null, phase_shift: null,
        gradient: baseRecipe.geometry?.gradient || { enabled: false }
      }
    : {
        offset: d.offset,
        cell_scale: +((d.scaleX + d.scaleY + d.scaleZ) / 3).toFixed(3),
        cell_scale_x: d.scaleX,
        cell_scale_y: d.scaleY,
        cell_scale_z: d.scaleZ,
        mode: baseRecipe.geometry?.mode || 'solid',
        wall_thickness: baseRecipe.geometry?.wall_thickness || null,
        // v0.13.2: pipe_radius and phase_shift carry the per-design values
        // the sweep solver actually used. Pre-v0.13.2, the TPMS branch of
        // exportSelectedDesign omitted these entirely (Noise branch already
        // emitted them as null). Result: PI-TPMS designs exported via
        // "Export Selected Design" had no phase_shift, so F13LD.mesh would
        // render the un-shifted field — wrong geometry vs what the sweep
        // characterized. Bug surfaced after v0.13.1's tileability fix,
        // because v0.13.1 exposed the silent mismatch as visible bad tiling.
        pipe_radius: d.pipe_radius || null,
        phase_shift: d.phase_shift || null,
        normal_weights: d.nWeights || null,
        gradient: baseRecipe.geometry?.gradient || { enabled: false }
      };

  exportData = {
    meta: {
      version: baseRecipe.meta?.version || '0.4.0',
      tool: 'f13ld.sweep',
      tool_version: F13LD_SWEEP_VERSION,
      timestamp: new Date().toISOString(),
      preset: `${preset}_sweep_${d.id}`,
      source: sourceTag,
      sweep_rank: d.id,
      context: buildAnalysisContext()
    },
    family,
    surface,
    geometry,
    homogenization: perDesignHomogenization(d, baseRecipe.homogenization?.grid || 48, 'pipeline-sweep-estimate')
  };
  } // close else (non-grain branch)

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
