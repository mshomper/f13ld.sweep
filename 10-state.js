/* ============================================================
   F13LD.sweep · 10-state.js
   Global sweep state.
   ============================================================ */

// ─── State ───────────────────────────────────────────────────────────────────
// The loaded recipe, completed (40-design.js completeRecipe) — every design
// of a sweep is varied from it. baseFamily: tpms | noise | grain | beam.
let baseRecipe = null;
let baseFamily = null;
let results = [];
let directions = { 1: 'max', 2: 'max', 3: 'max' };
// v0.18.0: target profile snapshot from last sweep — populated by runSweep,
// read by buildAnalysisContext/export. null when no rank metrics were
// selected at the time of the last sweep (or no sweep has run yet).
let lastSweepTargetProfile = null;
// Settings the last sweep ran with (context, precision, grid) — exports
// record these, not whatever the page shows at export time.
let lastSweepSettings = null;
let currentFiltered = [];
let sortState = { col: null, dir: 'desc' };
// v0.12.1: recipe-load identity token. loadFile increments recipeLoadId on
// every successful load; runSweep snapshots it into sweptRecipeId on success;
// exportResults refuses to export when these mismatch — preventing stale
// per-design data (e.g. from a previous family's sweep) from being exported
// under a newly-loaded recipe's meta/base block. See README for the
// load-A → sweep → load-B → export bug this guards against.
let recipeLoadId = 0;
let sweptRecipeId = -1;
let rankMode = 'ideal';   // 'ideal' | 'outlier'
let colorMode = 'rank';   // 'rank'  | 'terms'
