# Session recap — 2026-10-07 / 08 (Sweep v0.19.0 → v0.23.0)

**On `main`:** v0.21.0 (`7d15735`). **On branch `v0.22.0-audit`:** v0.22.0 + v0.23.0 (`8b6d3a0`), waiting for Matt's click-through before merging. **Next session:** GPU solver — [`NEXT_STEPS.md`](NEXT_STEPS.md) §2.

Preview the branch without installing anything: <https://raw.githack.com/mshomper/f13ld.sweep/v0.22.0-audit/index.html> (the live site shows `main`).

Also changed in this session: **F13LD.lab v0.26.0** and **F13LD.mesh v0.9.7** (both on their `main`). Each repo has its own recap: Lab `docs/SESSION_RECAP_2026-10-08_sweep-parity.md`, Mesh `docs/SESSION_RECAP_2026-10-08.md`.

## Goal

Sweep was one 11,079-line `index.html` (v0.19.0). The aim: split it into modules like Lab and Mesh, fix its bugs, make it build every design exactly as Lab and Mesh do, refresh the UI, then move the solver to the GPU. Sweep is for quick comparative exploration of a design space; Lab does the full solves and verification.

## Matt's decisions

| Date | Decision |
|---|---|
| 10-07 | Solver files taken from Lab keep Lab's licence (PolyForm Noncommercial). Everything else in Sweep is MIT, so the solver can't be carried off with the rest of the code. |
| 10-07 | The solver must handle stretched (non-cubic) cells; Lab will take that up later. |
| 10-07 | Exports carry the solver version. Stiffness dropping once the solver includes shear is fine. Shear moduli wanted. |
| 10-07 | Beam uses the real voxel solve, like every other family. |
| 10-08 | Mesh switches to F13LD.grain's random generator. Noise fixes and TPMS shell weights go into Lab too. Parity fixes come before solver work. |
| 10-08 | Export shape must stay as it is, so F13LD.ingest's validator doesn't throw and Ingest needs no big changes. Vault will be wiped and reseeded once Sweep is updated. |
| 10-08 | No shared F13LD header in Sweep. Add a Lab push button next to Mesh on each row. Take Lab's UI as the style reference. Fewer columns, chosen by domain. |
| 10-08 | GPU solver gets its own session. Matt runs all GPU checks on his machine. |

## What shipped

| Version | Where | Contents |
|---|---|---|
| v0.20.0 | `main` | **Module split.** CSS file, numbered classic scripts, `families/`, worker loads the same files (`worker/sweep-worker.js`, `importScripts`) instead of a stringified bundle, one version constant. Harness: 11 of 11 cases identical to v0.19.0. |
| v0.21.0 | `main` | **Recipe parity with Lab and Mesh.** `geom/` holds Lab's recipe → voxel code byte-for-byte. Every design is a recipe in the design tool's own format, built the way Lab imports it; the export, Export Design and the Mesh link all write that same recipe. Beam uses the voxel solve. One preview shader on a field baked in a worker. Export provenance (`solver_version`, `geometry_version`). |
| v0.22.0 | branch | **Quick audit fixes.** Seeded sweeps (`sweep_seed`), Sobol first point skipped, bias window fixed, results cut to the sample count, attempt-limit warning, hi-res volume-fraction gate, periodic pore / percolation / tortuosity / topology metrics, per-axis throats, ranking null handling, crash-safe worker pool. |
| v0.23.0 | branch | **UI pass.** Lab fonts, colours and buttons with Sweep's amber; at most 8 metric columns chosen by domain and rank metrics; detail panel with every metric; every row shown; Lab + Mesh buttons per row; no horizontal scrolling; phone layout; keyboard access. |

Full per-version notes: [`REFACTOR.md`](REFACTOR.md).

## How it works now

**Files.** Numbered scripts share one global scope and load in order (`tests/loadorder.js` checks it). `geom/` = shared with Lab (never edit by hand). `families/fam-*.js` = how each family varies a recipe (`jitter`). `40-design.js` = recipe → geometry for the solver. `54-estimate.js` = one design's full analysis. `60-solver-pool.js` = workers. `70-export.js` = all exports go through `designRecipeOut`. `71-results-table.js` = table and per-domain columns. `72-mesh-handoff.js` = Lab and Mesh buttons.

**A design's life.** The loaded recipe is completed with Mesh's defaults → the family's `jitter` draws a new recipe from the seeded Sobol sampler → the worker builds it with Lab's code and solves it → the result row keeps the recipe → export, Export Design, Lab and Mesh links all send that recipe.

**Seeds.** One seed per sweep drives everything random (Sobol scramble, bias, each family's jitter). Same seed and settings give the same designs. It is recorded as `meta.solver.sweep_seed`.

**Export.** Shape unchanged for Ingest. Added fields only: `meta.solver.{version, geometry, sweep_seed}`, per-design `solver_version`, `geometry_version`, `throat_x/y/z`, `tortuosity_nonperc`. `schema_version` 0.18.0.

**Table.** Volume fraction + rank metrics (marked with the rank colour) + the domain's key metrics, at most 8 (`DOMAIN_COLUMNS`). Click or Enter on a row opens the detail panel with everything. Under 760 px wide the page is one column and only rank, rank-metric, volume-fraction and button columns stay.

## Checks run

| Check | Result |
|---|---|
| v0.19.0 vs v0.20.0, `tests/harness.js`, 11 cases | identical (only `tool_version` differs) |
| Sweep ↔ Lab geometry, `tests/parity/geomsync.js` | byte-identical blocks |
| Lab ↔ Mesh per family, 48³ | TPMS and beam 0 %, grain 0.000 %, noise ≤ 0.4 % (same as the noise tool vs Mesh) |
| Lab old vs new, 57 recipes | only noise and anisotropic shells change (intended) |
| F13LD.ingest `validateDesign` on every family's export | pass |
| v0.22.0 seeded smoke, 4 families, run twice | identical, no errors |
| v0.23.0 headless at 1440 px and 390 px | no errors, no horizontal scroll; Lab and Mesh links carry the recipe |
| Matt | v0.21.0 click-test ("seems fine, if a little slow"); v0.23.0 "looks pretty good" |
| `tests/parity/parity.js --quick` (10-08, end of session) | PASS in 30 s: 9 design-tool recipes + 8 jittered Sweep designs, all families. Sweep = Lab 0 voxels; Sweep vs Mesh 0.00 %. One stretched beam design has no Lab column (Lab samples a stretched beam differently — Lab item). The grain tool's own hyperuniform voxelizer is 1.8 % off Mesh (tool side, not Sweep). |

**Not checked:** a full (non-quick) parity run; Lab's `normal_weights` shells against Mesh beyond the parity rows; v0.22.0 results against v0.21.0 (they differ on purpose: seeded sampling, periodic metrics).

## Known limits right now

- The solver is still the old CPU one: normal stiffness only (no shear, stiffness reads high), basic thermal iteration, cubic cell (cell scale doesn't change the physics for TPMS, noise and grain). All three are the GPU session.
- Beam is slower than before (voxel solve on the CPU) until the GPU solver.
- Plenty of empty space in the layout — saved for a dedicated UI session.
- In the General domain, the rank metrics carry over from the last domain picked (old behaviour).
