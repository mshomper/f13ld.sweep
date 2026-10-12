# F13LD.sweep — session recap, 2026-10-11 · v0.31.0 Preflight

Matt's idea: check whether the solver settings can hold the thinnest designs a sweep will draw, before a long sweep ends up full of flags and inflated stiffness.

## Matt's decisions
- Runs on its own after a recipe loads, without freezing the window; works out the fixes in the background, but shows nothing until Run.
- On Run with issues: a popup ("Preflight found issues with your solver settings…") with its own drawn icon; Apply or Ignore. It must be answered — no close button, Escape does nothing.
- Every run gets it, target runs from Vault too.
- Density floor is the default fix — the grid was likely picked for how fast the user wants to run.
- Not in the export: the stiffness flags and solver grid already there are enough to filter by.
- Plain wording in the popup (no "knobs").

## How it works (`64-preflight.js`)
- **When**: `preflightOnRecipe()` after `loadRecipe`; after that, ~0.9 s after any input / change / click, if the settings signature changed (recipe, grid, Fast / Rigorous, material, density window, variation, spread, cell scale ranges, cell size). Never while a sweep or target run is going.
- **Test designs**: the recipe at the bottom of the density window, built by the family's own jitter (seeded) with the varied settings at the middle of Spread, alternating ends one way, and the other way; plus the most stretched cell scale corner when the ranges allow it (≥ 1.15× the middle's stretch). Alternating ends matters: one value for every setting only rescales a TPMS (coefficients and normal weights are normalised) — the first version's three probes were the same design.
- **Same pipeline as the sweep**: `computeDesign` on the sweep's pool and GPU, the run's grid, precision and material. A probe is flagged when `stiffnessFlags` would flag it, **or** when an axis the recipe's own design carries load on (the recipe solved once on the finest grid: 64 GPU / 32 CPU) reads zero stiffness — a broken load path. The sweep keeps such designs without a flag (found here: a 2–5 % gyroid sheet on 16³ connects on no axis, E = 0, `stiffness_flag` false).
- **Fixes**, only when a probe flags: the density floor by bisection (top of the window first; 4 steps; rounded up to 0.5 %) at the current grid, then the first finer grid (16 → 32 → 64, 64 on GPU only) where the flagged probes clear, with how much longer they took to solve. A probe that can't be built at a density counts as clear there (the sweep would discard it); a worker error never does.
- **Run** (`runClick` → `preflightGate`): clear → runs; still checking → the Run button reads "Preflight"; issues → popup. Apply sets the floor (window switches to Set) or the grid and runs; Ignore runs and isn't asked again for the same settings. With no fix: "Back to settings" or "Ignore and run".
- **Target runs**: a floor Preflight set also holds in the rounds (`tgtSetWindow` clamps to `preflightFloor()`). It clears on a new recipe, when other settings change, or when the window is set below it by hand.
- **Thumbnails**: probes ask for `wantSlice`; the worker (CPU, binary voxels) or the GPU path (partial-volume `phi`) returns the mid-cell slice with the least solid (`voxelMidSliceThin`, 54-estimate.js). Solid light, partly filled amber, pores dark.
- **Log**: one line per check ("Preflight: 4 test designs … clear on 32³ Fast" / "… would be flagged … fix ready …") and one for the choice.
- Off switch: `window.SWEEP_PREFLIGHT = false` or `?preflight=0`. The harness and vault-push tests set it; bench.html loads the app with `?preflight=0`.

## Not changed
- `runSweep()` itself, the export shape, Ingest / Vault, `solver/lab/`.
- The worker and `computeDesign` only add a `slice` when a probe asks (`wantSlice`).

## Checks
- `node tests/loadorder.js` OK.
- `node tests/harness.js <main> .` (CPU): see the result in the merge note.
- Headless CPU smoke (cloud VM, one worker): gyroid sheet on Auto (21 %) → 4 probes clear, Run pressed mid-check shows "Preflight" then runs, no popup. Same recipe with the floor at 4 % → 4 of 4 flagged ("Load path breaks on x, y, z at 16³"), floor fix 20 %, no grid fix; popup at 1280 and 390 px with no horizontal scroll; Escape leaves it open; Apply raises the floor and the sweep starts.

## For Matt to check on the GPU
- Load a thin recipe (e.g. a sheet near the bottom of its density range) with the floor dragged low, wait a few seconds, then in the console: `PF.result.probes.map(p => [p.key, p.res.flagged, p.res.issues, Math.round(p.res.ms)])` and `PF.result.floorFix`, `PF.result.gridFix`.
- Press Run: the popup, its slices (partial voxels show amber on the GPU path), Apply and Ignore.
- How long the check takes at 32³ / 64³ Fast — the reference design is solved once at 64³.

## Next
- Bundle moves to v0.32.0 (`docs/NEXT_STEPS.md`).
