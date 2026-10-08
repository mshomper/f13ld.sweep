/* ============================================================
   F13LD.sweep · worker/sweep-worker.js
   Solver worker. Loads the shared geometry (geom/), the design layer and
   the solver / metrics files the page uses, then answers
     compute_design  { recipe, opts }  → estimateHomogenization result
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
  '../geom/voxels.js',
  '../geom/recipe.js',
  '../40-design.js',
  '../42-fft.js',
  '../43-elastic-solver.js',
  '../44-solver-config.js',
  '../45-homogenize.js',
  '../50-hires-field.js',
  '../51-transport.js',
  '../52-geometry-metrics.js',
  '../53-pores.js',
  '../54-estimate.js'
);

self.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'compute_design') {
    try {
      const hom = estimateHomogenization(msg.recipe, msg.opts);
      self.postMessage({ type: 'result', attemptIdx: msg.attemptIdx, hom });
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
