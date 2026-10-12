# F13LD.sweep — session recap, 2026-10-11 · v0.31.0 Preflight

Merged to `main` 2026-10-11 after Matt's tests on his phone and machine (branch `v0.31.0-preflight`).

Matt's idea: check whether the solver settings can hold the thinnest designs a sweep will draw, before a long sweep ends up full of flags and inflated stiffness.

## Matt's decisions
- Runs on its own after a recipe loads and after settings change, without freezing the window; shows nothing until Run.
- On Run with issues: a popup ("Preflight found issues with your solver settings…") with its own drawn icon. Apply or Ignore — and a way out: the close mark, Escape and Back to settings close it without running (the first build had no exit; Matt: needed).
- Every run gets it, target runs from Vault too.
- Density floor is the default fix — the grid was likely picked for how fast the user wants to run. Never above the recipe's own density on Auto; with the window set by hand, no higher than its middle (the user may be sweeping that space on purpose); never the top.
- A design that doesn't connect along an axis even on a fine grid is the design itself (bundles connect along one axis only): noted, not flagged.
- Skipping work the flags don't read is fine.
- Not in the export: the stiffness flags and solver grid already there are enough to filter by.
- Plain wording in the popup (no "knobs"); when every test design fails, one row instead of four.

## How it works (`64-preflight.js`)
- **When**: `preflightOnRecipe()` after `loadRecipe`, then ~0.9 s after any input / change / click if the settings signature changed (recipe, effective grid, Fast / Rigorous, material, density window, variation, spread, cell scale ranges, cell size). Never while a sweep or target run is going.
- **Test designs**: the recipe at the bottom of the density window, built by the family's own jitter (seeded), with the varied settings at the middle of Spread, alternating ends one way, and the other way; plus the most stretched cell scale corner when the ranges allow it (≥ 1.15× the middle's stretch). Alternating ends matters: one value for every setting only rescales a TPMS (coefficients and normal weights are normalised).
- **Same pipeline as the sweep**: `computeDesign` on the sweep's pool and GPU, at the run's effective grid, precision and material, with `opts.flagsOnly` — no pores, curvature, topology, tortuosity or thermal solve (none feed a flag; checked identical stiffness, flags and reasons with and without it on six families).
- **Flagged when**: `stiffnessFlags` would flag it, **or** a broken load path — an axis the design's own solved recipe connects on at 64³ (voxels + percolation in a worker, `connectivity` message, no solve) reads zero stiffness on the solver grid. The sweep keeps such designs without a flag. An axis the design doesn't connect on at 64³ shows as Clear with "Doesn't connect on z (the design itself)".
- **Fixes** (`pfFixes`), worked out after the test designs, one solve at a time on the worst flagged design (cheapest exits first), then confirmed on the other flagged designs; 15 s cap:
  - density floor: the top of the allowed range first, then 4 bisection steps, rounded up to 0.5 %;
  - settings matched to the problem: broken load paths / other resolution flags → the next grid up; pores carrying stiffness in Fast → Rigorous; both → one choice ("Use the 64³ grid and Rigorous"), with how much longer it took to solve.
- **Run** (`runClick` → `preflightGate`): clear → runs (logs "Preflight: already checked at … — clear" when it reuses a check); still checking → the Run button reads "Preflight"; issues → the popup, which opens as soon as the test designs are done and fills the fixes in ("Working out a fix…"). Apply sets the floor (window switches to Set) or the grid / precision and runs; Ignore runs and isn't asked again for the same settings; choosing either stops a fix search still going.
- **Target runs**: a floor Preflight set holds in the rounds (`tgtSetWindow` clamps to `preflightFloor()`); it clears on a new recipe, when other settings change, or when the window is set below it by hand.
- **Popup**: one row per test design (mid-cell slice thumbnail: the slice with the most partly filled voxels, else the most solid — `voxelMidSliceThin`, 54-estimate.js; solid light, partly filled amber, pores dark). When every test design that could be built fails: one row with the problems merged, the thinnest slice and the designs named in small print.
- **Log**: when the test designs are done (problems named, time) and when the fixes are (fix or none, time, cap), plus the choice.
- **Grid below the family's minimum**: PI-TPMS and beams run at 32³ minimum. The dock's solver tag and the Configure grid hint show "16 → 32³ (PI-TPMS minimum)" (`swGridEffective`, 23-dock.js) and Run logs it (`runClick`, not `runSweep`, so the harness log is unchanged).
- Off switch: `window.SWEEP_PREFLIGHT = false` or `?preflight=0`. The harness and vault-push tests set it; bench.html loads the app with `?preflight=0`.

## Not changed
- `runSweep()`, the export shape, Ingest / Vault, `solver/lab/`. The worker and `computeDesign` add a `slice` only when a probe asks (`wantSlice`), skip work only under `flagsOnly`, and the worker gained the `connectivity` message.

## What testing found
- A 2–5 % gyroid sheet on 16³ connects on no axis (E = 0) and the sweep doesn't flag it — the broken-load-path check catches it.
- PI-TPMS in Fast: "pores carry about 51 % of the stiffness" — the design is so soft that Fast's pore stiffness (1e-3 of the solid) carries the load. Rigorous clears it; the grid doesn't. A density floor only cured it by stiffening the design (30 %, the top of the window), hence the floor limits.
- Matt's iPhone: the first fix search (sequential, all flagged designs) took over 20 s on PI-TPMS; two parallel rounds made it longer (the phone is limited by total work). The final search: test designs ~4 s, fixes ~6–12 s.

## Checks
- `node tests/loadorder.js` OK at every step.
- `node tests/harness.js <main> .` (CPU): all 20 cases identical on the first build; gyroid sheet, PI-TPMS, closed foam and wave identical after the flags-only pass. Later passes touch Preflight and the dock / drawer text only (not run in the VM — too slow; Matt tested on his machines).
- Matt (phone and machine): popup, exit, collapsed row, PI-TPMS on Fast and Rigorous, grid 16 on PI-TPMS.

## Open
- Should the sweep itself flag a broken load path (zero stiffness on an axis the design connects on at a finer grid), so it shows in the table and can be filtered in Vault? It would add to the export's stiffness flag — its own small version.
