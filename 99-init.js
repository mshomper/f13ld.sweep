/* ============================================================
   F13LD.sweep · 99-init.js
   Page init.
   ============================================================ */


// Init — populate metric key for default (general) domain
renderMetricKey();
updateRankActiveState();

/* v0.24.0 — start the GPU solver early so the first sweep doesn't wait */
getGpuSolver().then(updateSolverStatusUI, updateSolverStatusUI);
