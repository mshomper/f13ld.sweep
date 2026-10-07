/* ============================================================
   F13LD.sweep · worker/sweep-worker.js
   Solver worker. Loads the same family, solver and metrics files the
   page uses, then answers compute_design messages from the pool
   (60-solver-pool.js). Each worker keeps its own solver workspace and
   Gamma caches (44-solver-config.js), reused across designs.

   Only files with no load-time DOM access may be listed here.
   ============================================================ */

importScripts(
  '../families/fam-tpms.js',
  '../families/fam-noise.js',
  '../families/fam-grain.js',
  '../families/fam-beam.js',
  '../40-mode.js',
  '../41-rasterize.js',
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

// Message handler — receives compute_design messages, returns results.
// msg.targetHints flows into estimateHomogenization for the target-aware
// pre-gate (scale similarity + rho-bound tightening).
self.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'compute_design') {
    try {
      const hom = estimateHomogenization(
        msg.family, msg.params, msg.offset,
        msg.scaleX, msg.scaleY, msg.scaleZ,
        msg.Es, msg.nu, msg.baseline, msg.sweepMode, msg.sweepWall,
        msg.nWeights, msg.sweepPipeR, msg.sweepPhaseShift,
        msg.ks, msg.sigma_ref, msg.voxelToUm, msg.cellMult,
        msg.eps_yield_um, msg.linear_cap_kind,
        msg.piNorm, msg.shellNorm,
        msg.contrast, msg.maxiter, msg.gridN,
        msg.targetHints
      );
      self.postMessage({ type: 'result', attemptIdx: msg.attemptIdx, hom });
    } catch (err) {
      self.postMessage({
        type: 'error', attemptIdx: msg.attemptIdx,
        message: err.message || String(err),
        stack: err.stack || ''
      });
    }
  } else if (msg.type === 'invalidate_caches') {
    invalidateSolverCaches();
    self.postMessage({ type: 'caches_invalidated' });
  }
});
