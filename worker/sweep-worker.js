/* ============================================================
   F13LD.sweep · worker/sweep-worker.js
   Solver worker. Loads the shared geometry (geom/), the design layer and
   the solver / metrics files the page uses, then answers
     compute_design  { recipe, opts }  → estimateHomogenization result (CPU solve)
     prepare_design  { recipe, opts }  → prepareDesignGpu result (the GPU
                                         solver, solver/gpu-worker.js, does
                                         the solve; the page finishes it)
   v0.26.0 — both first set the design's density knob for opts.targetVF
   (41-density.js) and send the solved recipe back with the result.
     bake            { recipe, N }     → preview field (bakePreviewField)
   Each worker keeps its own solver workspace and Gamma caches
   (44-solver-config.js), reused across designs.

   Only files with no load-time DOM access may be listed here.
   ============================================================ */

importScripts(
  '../geom/tpms.js',
  '../geom/noise.js',
  '../geom/grain.js',
  '../geom/beam.js',
  '../geom/foam.js',
  '../geom/wave.js',
  '../geom/voxels.js',
  '../geom/recipe.js',
  '../40-design.js',
  '../41-density.js',
  '../42-fft.js',
  '../43-elastic-solver.js',
  '../44-solver-config.js',
  '../45-homogenize.js',
  '../50-hires-field.js',
  '../51-transport.js',
  '../52-geometry-metrics.js',
  '../53-pores.js',
  '../54-estimate.js',
  '../solver/lab/14a-connectivity.js',
  '../55-estimate-gpu.js'
);

/* The solved density rides along so the VF gate uses it (54 prepareDesign). */
function solvedOpts(opts, dn) {
  return (dn && dn.ok && dn.sampled_vf != null) ? Object.assign({}, opts, { solvedVF: dn.sampled_vf }) : opts;
}

/* A design whose density the knob can't reach (41-density.js). */
function densityReject(dn) {
  return { volume_fraction: dn.sampled_vf != null ? +(dn.sampled_vf * 100).toFixed(2) : 0, Ex_GPa: 0, Ey_GPa: 0, Ez_GPa: 0,
           solver_validity: 'invalid', degenerate: true, reject_reason: 'density_unreachable' };
}

self.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'compute_design') {
    try {
      const d = applyDensityTarget(msg.recipe, msg.opts);
      const hom = (d.density && !d.density.ok) ? densityReject(d.density) : estimateHomogenization(d.recipe, solvedOpts(msg.opts, d.density));
      self.postMessage({ type: 'result', attemptIdx: msg.attemptIdx, hom, recipe: d.recipe, density: d.density });
    } catch (err) {
      self.postMessage({ type: 'error', attemptIdx: msg.attemptIdx, message: err.message || String(err), stack: err.stack || '' });
    }
  } else if (msg.type === 'prepare_design') {
    try {
      const d = applyDensityTarget(msg.recipe, msg.opts);
      const prep = (d.density && !d.density.ok) ? { reject: densityReject(d.density) } : prepareDesignGpu(d.recipe, solvedOpts(msg.opts, d.density));
      self.postMessage({ type: 'result', attemptIdx: msg.attemptIdx, prep, recipe: d.recipe, density: d.density }, prep.phi ? [prep.phi.buffer] : []);
    } catch (err) {
      self.postMessage({ type: 'error', attemptIdx: msg.attemptIdx, message: err.message || String(err), stack: err.stack || '' });
    }
  } else if (msg.type === 'bake') {
    try {
      const b = bakePreviewField(msg.recipe, msg.N);
      self.postMessage({ type: 'baked', key: msg.key, N: b.N, data: b.data, lip: b.lip, family: b.family }, [b.data.buffer]);
    } catch (err) {
      self.postMessage({ type: 'bake_error', key: msg.key, message: err.message || String(err) });
    }
  } else if (msg.type === 'invalidate_caches') {
    invalidateSolverCaches();
    self.postMessage({ type: 'caches_invalidated' });
  }
});
