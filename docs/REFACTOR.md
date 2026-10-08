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

## v0.22.0 — quick audit fixes (2026-10-08)
From `docs/AUDIT_v0.19.0.md`. Numbers move on purpose (seeded sampling, periodic metrics).
- Seeded sweeps: `sweepSettings.seed` → mulberry32 drives Sobol scramble, bias draws and every family's jitter (`ctx.rand`). Exported as `meta.solver.sweep_seed`; same seed + same settings = same designs.
- Sobol skips its first point (all-0.5 corner); bias window is linear `[max(0,shift), min(1,1+shift)]`.
- Results trimmed to the requested sample count; a warning when the attempt limit stops a sweep short.
- Hi-res volume-fraction gate before the solve; coarse VF bounds skipped when the hi-res grid already checked them.
- Transport / topology now periodic: EDT and throats (`throat_x/y/z`), solid percolation, 26-neighbour tortuosity (`tortuosity_nonperc` flags axes that don't percolate), curvature area, genus per cell.
- Ranking: KNN / k-means skip missing metrics; keep-% clamped to 1–100. U-strain target bias sign fixed. Hidden σ_ref field ignored.
- Solver pool: jobs tracked per worker; a crashed worker rejects its own job and is replaced.
- Export adds `throat_x/y/z`, `tortuosity_nonperc` per design (additive; shape unchanged).

## v0.23.0 — UI pass (2026-10-08)
No numbers move; export shape unchanged.
- Styling follows F13LD.lab: Exo 2 + JetBrains Mono, Lab's panel / line / ink tokens, Lab's pill buttons. Sweep's own accent (`--sweep` #E39B4A on dark, `--sweep-deep` #633806, `--sweep-tile` #FAEEDA) replaces neon for active marks; neon / green / lavender stay as rank colours.
- Results table: at most 8 metric columns — volume fraction, the active rank metrics (marked with their rank colour), then the domain's key metrics (`DOMAIN_COLUMNS` in 71-results-table.js). Ex/Ey/Ez and kx/ky/kz show whole or not at all. The metric key follows the table.
- Clicking a row (or Enter on it) opens a detail panel with every metric and design parameter, plus Open in Lab / Mesh.
- Every row is rendered (the 200-row cap is gone), so the table and the design-space plot always show the same designs.
- Each row has Lab and Mesh push buttons. Lab gets the same `#r=` recipe as Mesh, plus `geometry.cell_size_mm` from the sweep context (non-beam) and a title.
- No horizontal scrolling: fixed table layout; under 760 px the page is one column and only rank, rank-metric, VF and action columns stay.
- Keyboard: rows and headers are focusable; Enter / Space selects or sorts; ↑ ↓ move between rows; focus previews like hover.
- Fixed: duplicate `nominalLabel` id; loading a recipe reset the k-means map to an array (crashed Terms colouring on the next sweep); missing values sort last.
