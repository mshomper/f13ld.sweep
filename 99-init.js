/* ============================================================
   F13LD.sweep · 99-init.js
   Page init.
   ============================================================ */


// Init — populate metric key for default (general) domain
renderMetricKey();
updateRankActiveState();
initDock();   /* v0.25.0 — dock + Configure drawer */
/* v0.28.0 — a recipe (and target) handed over in the link: #r=…&t=… (63-auto-target.js) */
tgtLoadFromLink();
window.addEventListener('hashchange', tgtLoadFromLink);

/* v0.24.0 — start the GPU solver early so the first sweep doesn't wait */
getGpuSolver().then(updateSolverStatusUI, updateSolverStatusUI);
