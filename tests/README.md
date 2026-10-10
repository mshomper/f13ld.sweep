# F13LD.sweep — dev tests

Dev-only. Nothing here is loaded by the app.

## Setup

```
npm install playwright-core acorn
npx playwright install chromium     # or point PLAYWRIGHT_BROWSERS_PATH at an existing install
```

## Scripts

| Script | What it checks |
|---|---|
| `harness.js <old> <new> [case,…]` | Runs the same seeded sweep for every case in `recipes.json` in both builds (headless Chromium, one solver worker, `Math.random` seeded, clock frozen) and compares the results array, results table, stats bar, run log, exported results JSON, the F13LD.mesh handoff recipe and preview errors. `tool_version` is ignored. Exit 0 = identical. Writes `harness-last.json` (`HARNESS_OUT` sets the folder). |
| `parity/geomsync.js <F13LD.lab> [--write]` | The shared geometry blocks in `geom/` are byte-identical to F13LD.lab's; `--write` regenerates them from a Lab checkout. |
| `loadorder.js [build]` | Static check: no load-time code uses something from a later-numbered file; worker files don't touch the DOM at load; worker only loads files the page loads. |
| `parity/solversync.js <F13LD.lab> [--write]` | Every file in `solver/lab/` is byte-identical to F13LD.lab's (plus `solver/LICENSE.md`, `NOTICE`); `--write` copies them from a Lab checkout. |
| `bench.html` (browser, needs WebGPU) | GPU solver checks — stretched Green operator on the GPU vs the CPU formula, Sweep's Γ̂ vs Lab's on a cubic cell, several designs in flight = each alone, thermal patch = Lab's thermal on a cubic cell, stretched cell vs a supercell of cubic voxels (elastic and thermal) — and a CPU-vs-GPU speed bench that runs the app itself on `recipes.json` cases with the same seed. Open over http(s), e.g. `https://raw.githack.com/mshomper/f13ld.sweep/<branch>/tests/bench.html`. |
| `density.js [N] [filter]` (node) | v0.26.0 density solve over `parity/fixtures.json`: for targets 10 / 25 / 40 % and the recipe's own ± 25 %, the sampled solid fraction, the N³ voxel fraction (default 32), evaluations and time. Exit 1 when a reachable target lands more than 2 points off. Thin struts / pipes read a few points low on 32³ binary voxels (the solver's partial-volume voxels don't). Full run ≈ 10 min (most of it the voxel check). |
| `smoke-jitter.js [n] [neighbourhood\|explore] [spread] [filter]` (node) | Draws n designs per `recipes.json` case as `runSweep` does, solves each density in the worker's code path and runs the CPU pipeline at N = 16: drawn → solved density, knob, Ex, reject reason. Grain / noise / PI-TPMS cases take minutes each (CPU metrics grids). |
| `target.js` (node) | v0.28.0 target maths (`13-target.js`): distance and ranking, the density trend fit and minimax prediction, Voigt bounds (rising and falling with density), strain scale, the `#r=…&t=…` link. Instant. |
| `gpu/stretch-check.js [N]` (node) | The stretched-cell Green operator with F13LD.lab's Float64 CPU reference CG: equals `buildGammaFull` when cubic; stretched cell vs a 2×2×1 supercell; CG tolerance 1e-3 vs 1e-5. N = 8 takes ~3 min, N = 16 ~4 min on two cores. |

Each build is a plain folder: e.g. `git worktree add ../sweep-old v0.19.0` for the old one. The v0.19.0 single file works as the old build too.

The harness sets `window.SWEEP_GPU = false`, so it compares the CPU solver path (which v0.24.0 left unchanged). The GPU path's checks are `bench.html` and `gpu/stretch-check.js`.

`recipes.json` cases come from `f13ld.mesh/tests/recipes.json`; `samples` is the valid-design count per case. A full run takes about 10 minutes on two cores.
