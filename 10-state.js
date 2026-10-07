/* ============================================================
   F13LD.sweep · 10-state.js
   Global sweep state.
   ============================================================ */

// ─── State ───────────────────────────────────────────────────────────────────
let baseRecipe = null;
let results = [];
// Phase 1.3 follow-up: beam preview cube extent reference. For beam family,
// the preview renders a single unit cell scaled to a proportional fraction
// of the cube (the cube itself is fixed by the camera frustum). To give a
// visual scale-comparison signal across a sweep's 200 results, every beam
// design's cube extent is computed as `π × meanScale / beamCubeMaxScale`,
// where beamCubeMaxScale is the largest mean cell scale seen in the
// current sweep (or the base recipe's nominal scale before a sweep runs).
//
// Lifecycle:
//   - loadFile: set to base recipe's nominal cell scale (for the base-
//                recipe preview shown immediately on load)
//   - runSweep completion: re-set to max(meanScale) across all results
//   - non-beam families: never read; the value is harmless
//
// Why a global rather than threading through buildPreviewShader: the cube
// extent decision is per-family-policy, not per-design, so it belongs at
// module scope alongside the recipe and results that drive it. Threading
// it through every preview call also means changing the buildFrag
// signature for one family's behavior, which is the kind of cross-cut we
// avoid in the kernel-contract architecture.
let beamCubeMaxScale = 1.0;

// Phase 1.4: beam preview cube pad. Geometry (struts + node balls) extends
// past the unit cell boundary by `r_eff + ball_radius` (in local units, where
// the cell is [-1,+1]³). Clipping that overshoot at the cube faces leaves
// flat circular endcaps that look like rendering artifacts — see the
// "doesn't tell the user anything" screenshot Matt flagged. Fix: pad the
// rendered cube to fit the worst-case (r + ball) across all designs in the
// current sweep, then draw the abstract [-1,+1]³ cell boundary as a
// wireframe overlay so the viewer can see where the cell actually ends.
//
// Computed at sweep completion as max(rMaxLocal + nodeBallRLocal) + 0.05
// safety. Seeded at recipe load from the base recipe's geometry so the
// initial preview frames sensibly before any sweep has run.
let beamCubePadGlobal = 0.15;
let directions = { 1: 'max', 2: 'max', 3: 'max' };
// v0.18.0: target profile snapshot from last sweep — populated by runSweep,
// read by buildAnalysisContext/export. null when no rank metrics were
// selected at the time of the last sweep (or no sweep has run yet).
let lastSweepTargetProfile = null;
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
