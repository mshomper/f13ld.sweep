# Session recap — 2026-10-08, GPU solver (Sweep v0.24.0)

**Branch:** `v0.24.0-gpu`, **merged to `main` 2026-10-08** after Matt's GPU checks and speed bench. **Before merging:** Matt's GPU checks — [`NEXT_STEPS.md`](NEXT_STEPS.md) §2.

Try it without installing anything:
- App: `https://raw.githack.com/mshomper/f13ld.sweep/v0.24.0-gpu/index.html` (add `?gpu=0` for the CPU solver)
- Bench: `https://raw.githack.com/mshomper/f13ld.sweep/v0.24.0-gpu/tests/bench.html`

## Goal

Move Sweep's solver onto the GPU using F13LD.lab's solver (steps A–C of the plan: Lab's WebGPU stack, stretched cells, shear moduli), keeping Sweep fast.

## Matt's decisions

| Decision |
|---|
| This session is the GPU solver. |
| Pull in F13LD.lab's solvers, thermal included (thermal is now live in Lab). |
| Steps A–C in one go — Lab's solver is robust and battle-tested. |
| Sweep is supposed to be fast; accuracy can be traded for speed. |

## What was built

| Part | Where | What |
|---|---|---|
| Lab's solver | `solver/lab/` | F13LD.lab v0.26.0 files byte-for-byte (device, FFT, fast elastic path, GPU thermal, connectivity, CPU reference). PolyForm Noncommercial (`solver/LICENSE.md`, `solver/NOTICE`). `tests/parity/solversync.js` checks them. |
| GPU worker | `solver/gpu-worker.js` | Runs Lab's files in a worker of their own. Elastic (full 6 × 6, six load cases) + thermal per design; several designs in flight ("lanes": 6 / 4 / 2 at N = 16 / 32 / 64). |
| Stretched cells | `solver/sweep-gpu-kernels.js` | Elastic: Green operator with per-axis voxel spacing, built on the GPU in Lab's packed layout. Thermal: the stretched cell mapped onto unit voxels through Lab's own kernels (scaled voxel tensor, weighted preconditioner). |
| Pipeline | `54-estimate.js`, `55-estimate-gpu.js`, `60-solver-pool.js`, `62-run-sweep.js` | `prepareDesign` → solve → `finishDesign`. GPU path: CPU workers prepare (geometry, gates, metrics, partial-volume voxels, island trim, cell edges) → GPU solves → page finishes. CPU path unchanged. |
| Settings | `55-estimate-gpu.js` | Fast: void 1e-3, CG tol 1e-3, thermal tol 1e-3. Rigorous: Lab's sweep settings (void 1e-6, tol 1e-4, thermal 1e-5). |
| Results | export, detail panel, ranks | Shear moduli Gyz / Gxz / Gxy, Poisson's ratios, Zener ratio, 6 × 6 stiffness, cell aspect, island trim, solve time, solver version. All additive; CPU exports unchanged. |
| UI | sidebar | Solver line (GPU + adapter, or CPU + reason); N = 64 button (GPU only); shear moduli selectable as rank metrics. `?gpu=0` forces CPU. |
| Checks | `tests/bench.html`, `tests/gpu/stretch-check.js` | GPU checks + speed bench for Matt's machine; CPU check of the stretched operator. |

Version 0.24.0 (`00-config.js`, header).

## How it works now

Each design: the CPU worker builds it from its recipe and runs everything that isn't a solve (VF / connectivity gates, pores, curvature, topology, tortuosity — as before), then makes the solver voxels the way Lab does (partial volume, floating islands removed) and the cell's edge lengths. The GPU worker solves elastic (Lab's fast path) and thermal (Lab's GPU thermal) for it. The page turns the 6 × 6 into Ex/Ey/Ez (1/S diagonal), shear moduli and Poisson's ratios, then runs the same derived-metrics code as the CPU path.

Two Sweep rules on top of Lab's:
- **Disconnected axes** still report 0 (Sweep's connectivity gate, as before).
- **Island trim cap:** if the trim would remove more than 10 % of the solid, it is skipped — that is a thin design shattered by a coarse grid (a PI-TPMS pipe at N = 32), not loose pieces. Without the cap, one PI-TPMS design lost 95 % of its solid.

## Checks run (this VM; no real GPU here)

| Check | Result |
|---|---|
| `tests/harness.js` main vs v0.24.0 (CPU path, 11 cases) | **PASS — all 11 identical** |
| `tests/loadorder.js` | OK |
| `tests/parity/solversync.js` | PASS, 10 files identical to Lab |
| `tests/gpu/stretch-check.js` N = 8 / 16 (Lab's Float64 CPU CG) | cubic operator = Lab's `buildGammaFull` (3.9e-8). Gyroid sheet in a 0.5 × 0.5 × 1 cell vs a 2×2×1 supercell of cubic voxels: E +27 / +27 / +2.4 % at N = 8 → **+5.1 / +5.1 / +1.0 % at N = 16**; G +7 / +7 / +22 % → **−1.4 / −1.4 / +6.9 %**. Cubic voxels (the old physics) stay +66 / +66 / −37 %. |
| CG tolerance 1e-3 vs 1e-5 | 0.3 % (N = 8), **0.07 % (N = 16)**, with 3–40× fewer iterations → Fast uses 1e-3 |
| `tests/bench.html` checks, headless SwiftShader, N = 8 | **All pass:** GPU operator = CPU formula (1.6e-7); cubic stiffness with Sweep's operator = with Lab's (3e-5 of C11); three designs in flight = each alone (exact); thermal patch on a cubic cell = Lab's thermal (exact); stretched elastic 2.7× and thermal 3.2× closer to the supercell than cubic voxels |
| End-to-end GPU sweep, SwiftShader (gyroid sheet, N = 16) | Runs; results, table, export filled. Timing meaningless on SwiftShader. |
| GPU path with a stand-in GPU (4 families) + F13LD.ingest `validateDesign` on the export | PASS (after fixing the issues below) |

Fixed while checking: Lab's sweep "no load" threshold (20 × void stiffness) zeroed real moduli at Fast's void 1e-3 → removed (connectivity decides, as before); the island trim gutting thin designs → 10 % cap.

**Matt's GPU, `tests/bench.html` checks at N = 32 — all PASS:** GPU operator = CPU formula (≤ 3.2e-7); cubic stiffness with Sweep's operator = Lab's (1.2e-7 of C11); three designs in flight = each alone (exact, 446 ms for all three); thermal patch = Lab's thermal (exact). Stretched cell vs 2×2×1 supercell (N = 64): E +1.2 / +1.2 / +0.1 %, G −0.6 / −0.6 / +1.5 % — cubic voxels (old physics) +62 / +62 / −40 %, G −9 / −9 / +26 %. Thermal: +0.1 / +0.1 / −0.3 % vs cubic voxels +18 / +18 / −19 %. GPU solves in the app finish.

Fixed after Matt's first speed-bench run: the bench read the app's `results` through the frame's window, where a top-level `let` is not visible → now `win.eval('results')`.

**Not checked yet:** speed on a real GPU (Matt's speed bench).

## Known limits

- CPU fallback is still the old solver (normal stiffness only). Step E.
- F13LD.lab solves stretched designs as cubic until Lab takes up stretched cells.
- Thermal pore filler is Sweep's k_void = 0.0003 k_solid, not Lab's air / water / tissue.
- If the GPU idles, the CPU preparation is the limit (PI-TPMS, noise and grain build 64–96³ metric grids per design).

## After Matt's speed bench (same day)

| Case, N = 32, 24 designs | CPU s | GPU s | Speed-up | GPU had work |
|---|---|---|---|---|
| Gyroid sheet | 68.9 | 13.5 | 5.1× | 58 % |
| Spinodoid | 74.9 | 10.3 | 7.3× | 66 % |
| Beam BCC | 70.0 | 2.9 | 24.5× | 89 % |

CPU preparation limits the GPU. Added (decisions in `REFACTOR.md`): stiffness flags (pore-stiffness-limited axes, under-resolved), Fast metrics grid 48³ for PI-TPMS / noise / grain, threads − 2 workers with the GPU. Harness identical on all 11 cases (flags excluded). Flags reach Sweep's export only; Ingest / Vault later.

## UI session (same day) — v0.25.0, branch `v0.25.0-ui`

Mockups of three layouts (`docs/mockups/sweep-ui-v0.25.html`); Matt picked A. Built: dock + Configure drawer replacing the sidebar, design space + inspector over the full-width table, funnel line replacing the stat cards, log as a dock chip, recipe chip and exports in the header, column-header tooltips, neon active controls. Harness identical on the CPU path. Details in `REFACTOR.md` → v0.25.0.

Second pass: Run closes the drawer; the drawer is now one Settings panel (Sweep · Cell scale · Material · Solver · Ranks) in Lab's control kit — design-count presets, one-range / per-axis cell scale with draggable log bars and the drawn cells to scale, grouped drop-downs — plus Log and Metric key tabs; every emoji / glyph icon replaced by SVG icons in Lab's style. Then: every setting remembered per browser with Reset to defaults (as Lab; the harness and bench opt out with `?fresh=1`), and the cell-scale visual is Matt's pick from five mockups — an isometric wireframe of the most stretched cell over the recipe's cell. Harness identical on all 11 cases. **Merged to `main` 2026-10-08** with Matt's go-ahead.

### Open after this session
- Should picking General reset the rank metrics; plot hover / depth / ideal-corner nits (audit U10).
- CPU fallback with the GPU's physics (step E); flags into Ingest / Vault; stretched cells in Lab; thermal pore filler; grid floors for grain / noise — see `NEXT_STEPS.md`.
