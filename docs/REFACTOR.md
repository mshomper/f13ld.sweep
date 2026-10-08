# F13LD.sweep refactor (v0.20 → v0.23)

Started 2026-10-07. Sweep is for quickly exploring a parameter space as a comparison; F13LD.lab is for full solves and verification. The refactor splits the single file into modules (like Lab and Mesh), fixes the v0.19.0 findings (`AUDIT_v0.19.0.md`) and moves the solver onto the GPU.

## Decisions (Matt, 2026-10-07)

- **Licence.** Solver files taken from F13LD.lab keep Lab's licence (PolyForm Noncommercial 1.0.0 + the reproduce/verify permission) inside this repo; everything else stays MIT.
- **Stretched cells.** The solver will handle non-cubic (stretched) cells, so cell scale becomes real physics for TPMS, noise and grain. Lab will incorporate it later.
- **Provenance.** Exports carry a solver version in their provenance; stiffness dropping once shear is solved is expected and fine.
- **Shear.** Report shear moduli (and the full stiffness) from the full 6×6 solve.
- **Beam.** Real voxel solve, like every other family, so all families are consistent.
- **Phases** approved in this order; Phase 1 approved to start.

## Phases

| Phase | Version | Scope | Check |
|---|---|---|---|
| 1 | v0.20.0 | Split only: CSS file, numbered classic scripts, `families/`, worker loads the same files (`importScripts`) instead of the `Function.toString()` Blob bundle; one version constant. | `tests/harness.js` (old vs new, seeded, headless Chromium): identical results, table, log, export, mesh handoff. `tests/loadorder.js`. |
| 2 | v0.21.0 | Correctness: full 6×6 Voigt solver (CPU, from Lab), stretched cells, real beam voxel solve, thermal CG, periodic connectivity / transport, the H/M items in the audit, export provenance + schema bump, single recipe builder for export / mesh / lab. | Changelog with before/after per fix; known-answer checks against Lab. |
| 3 | v0.22.0 | GPU: Lab's WebGPU device + FFT + batched multi-design full-Voigt elastic (D designs × 6 load cases per CG), thermal CG on the same FFT, GPU voxelize / hi-res field; CPU fallback = the same physics. | `tests/bench.html` on Matt's machine: GPU vs CPU agreement and wall time. |
| 4 | v0.23.0 | UI: shared F13LD header (Queue / Mesh / Lab pills), Open in F13LD.lab per design, `#r=` mesh handoff, full table, phone layout, keyboard access. | Click-test desktop + Claude mobile app. |

## Phase 1 notes (v0.20.0)

- The split is mechanical: every statement of the v0.19.0 script is in exactly one module, in the original order, except a few function declarations moved to a better home (`applyFinalRanking`, `applyRankFilter` → `11-rank.js`; `resolveRawPreset`, `loadFile` → `20-recipe-load.js`; `renderTable`, `sortBy` → `71-results-table.js`; preview GLSL builders → `80-preview-glsl.js`; `log` → `05-log.js`). Function declarations don't run at load, so moving them changes nothing as long as no load-time code needs a later file (`tests/loadorder.js`).
- Intended code changes: `buildSolverWorkerSource` removed; `SolverPool` creates `new Worker('worker/sweep-worker.js')`; `F13LD_SWEEP_VERSION` replaces the hard-coded `'0.18.1'` tool_version.
- The worker loads the families, mode, rasterizer, FFT, solver, metrics and pipeline files (no DOM at load time). It now has every kernel method, including the main-thread-only ones the old bundle stripped; none of the worker code paths reads them, and the harness confirms identical numbers.
- Needs http(s): workers can't load from `file://`. GitHub Pages serves it as before.

### Phase 1 result (2026-10-07)

- `tests/harness.js <v0.19.0> <v0.20.0>`: **PASS, 11 of 11 cases identical** — TPMS sheet, split-P solid, PI-TPMS field pair, noise sheet and half, grain spinodoid and hyperuniform, grain reaction-diffusion (rejected on load, same message), beam BCC, TPMS in the Thermal domain at grid 32 / Rigorous, grain in the Biomedical domain. Results, table, stats, log, export JSON and mesh handoff match exactly (only `tool_version` differs: 0.18.1 → 0.20.0).
- Click-path smoke (cancel mid-sweep, full run, sort, row hover / select, Export Design, ↗ mesh, plot drag, colour mode): no errors in either build, same output.
- `tests/loadorder.js`: no forward references; worker files DOM-free.

### Noticed while testing (for Phase 2)

- Export Design for a sheet design writes `wall_thickness: null` and `homogenization.grid: 48` with the picker at 16 — part of audit E1 / R1 (geometry and grid recorded from the wrong source).

## v0.21.0 — recipe parity (2026-10-08)

Matt's decisions: Mesh switches to F13LD.grain's random generator; solver files stay PolyForm (Lab's licence), the rest of Sweep MIT; noise fixes and TPMS shell weights go into Lab too; parity fixes before the solver work.

- **Shared geometry.** `geom/` holds F13LD.lab's recipe → voxel code byte-for-byte (`F13LD-GEOM-*` blocks, Lab v0.26.0). `tests/parity/geomsync.js <F13LD.lab>` checks them; `--write` regenerates them. Never edit `geom/` directly.
- **Designs are recipes.** `families/` vary the loaded recipe and write a new recipe in the design tool's own format (`40-design.js`). The worker builds geometry from it exactly as Lab imports a recipe (`designGeometry`); the results export, Export Design and the Mesh link (`#r=`) write that same recipe. Beams are sampled as one periodic cell.
- **Fixes this brings:** split-P / F-RD constants, all 13 TPMS presets, field-pair PI-TPMS, normalized-shell gradients, noise (range, seed, hash, foam / strut / veined), grain seed per design and hyperuniform wrap, beam radius units / smooth-min / per-axis cell, anisotropic shell walls, pores no longer double-scaled on normalized modes, export geometry = solved geometry.
- **Beams** use the voxel solve (analytic estimate removed). Slower on the CPU until the GPU phase.
- **Preview**: one shader; the design's margin field is baked in a worker and raymarched.
- **Export shape** kept for F13LD.ingest (validated with its `validateDesign` on every family); `meta.schema_version` 0.18.0, `meta.solver.version` / `geometry` and per-design `solver_version` / `geometry_version` added.
- Lab v0.26.0 (noise kernel, `normal_weights`, shared blocks) and Mesh v0.9.7 (grain generator, warp strength 0) ship with it.

Not yet done: a local parity script comparing Sweep-generated designs against Mesh voxel by voxel (Sweep ↔ Lab is identical by construction; Lab ↔ Mesh verified per family). Lab samples a stretched beam over Mesh's world cube rather than one cell — a Lab item.
