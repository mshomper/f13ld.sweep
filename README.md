# F13LD.sweep

A browser-based design space explorer for implicit metamaterials. Sweep hundreds of geometric configurations in parallel, rank them by mechanical or thermal performance, and export the best candidates for validation.

**[Open the Sweep Tool](https://mshomper.github.io/f13ld.sweep)**

Companion to the [F13LD Suite](https://f13ld.app) 

<img width="1688" height="1252" alt="F13LD sweep screenshot" src="https://github.com/user-attachments/assets/ebada980-4da3-4ec8-bde3-074d3e299112" />

---

## What It Does

f13ld.sweep takes an implicit recipe (exported from other [f13ld](f13ld.app) tools) and explores the surrounding design space — varying multiple parameters depending on the type and surface modes. Each candidate design is evaluated using a browser-based FFT-CG homogenization solver that computes effective elastic stiffness, anisotropy, connectivity, pore geometry, and optional thermal conductivity. Results are ranked, visualized in a 3D design space explorer, and exportable as JSON for downstream GPU validation.

### How designs are drawn (v0.26.0)

- **Density is an axis.** Each design is drawn a volume fraction from the density window (Auto: the recipe's own density ± Spread) and its thickness setting — wall, offset, pipe radius, half-width or iso, strut radius — is set to hit it. Designs cover the window evenly instead of being thrown away when they land outside it, and designs can be compared at matched density.
- **Neighbourhood (default)** keeps the design's identity — surface terms and phases, field type and seed, topology, node treatment — and moves its other settings ± Spread around the recipe's own values. **Explore** redraws more widely (TPMS terms and frequencies, fresh random seeds, noise octaves, beam nodes); designs can stop resembling the recipe.
- **Design #0 is the recipe itself**, solved as it is and marked "ref", so every design can be read against it.

---

## Workflow

1. Design a surface in any [f13ld](f13ld.app) tool and export a recipe JSON
2. Drop the JSON into the sweep tool
3. Select your application domain and material
4. Set your filtration ranks and target metrics
5. Run the sweep — results populate in real time
6. Hover rows to preview surface geometry; click a row to see every metric of that design
7. Push a design to [F13LD.lab](https://mshomper.github.io/f13ld.lab) for a full solve, or to [F13LD.mesh](https://mshomper.github.io/f13ld.mesh) to print it — Lab / Mesh buttons on each row
8. Export results JSON for F13LD.ingest

---

## Computed Metrics

| Symbol | Metric | Description |
|--------|--------|-------------|
| α | Anisotropy ratio | Strongest vs. weakest stiffness axis |
| E/ρ | Stiffness / Density | Mean stiffness per unit material volume |
| α/ρ | Anisotropy efficiency | Directional bias per unit material |
| Ξ | Axial dominance | Peak axis vs. the other two combined |
| Ω | Orthotropic contrast | Spread across all three stiffness axes |
| λ | Load path efficiency | Peak E / (ρ × E_solid) — pure geometry efficiency |
| κ | Connectivity index | Geometric fraction of axes that span periodically (0, 0.33, 0.67, or 1.0) |
| Ex / Ey / Ez | Directional stiffness | Effective Young's modulus per axis (GPa) |
| kx / ky / kz | Thermal conductivity | Effective conductivity per axis (W/m·K) |
| kα | Thermal anisotropy | Max vs. min directional conductivity |
| k/ρ | Thermal / Density | Mean conductivity per unit material volume |
| U | Strain energy density | Mean strain energy under reference stress (kJ/m³) |
| με | Microstrain | Strain per axis under reference load |
| φ | Mean pore size | Inscribed sphere diameter (µm) |
| φt | Throat diameter | Narrowest pore connection (µm) |
| perc | Void percolation | Fraction of axes with open pore channels |

---

## Application Domains

Selecting a domain picks the table's columns (at most 8: volume fraction, the rank metrics, then the domain's key metrics — every metric is still computed, exported, and listed in the row detail panel), sets domain-appropriate rank defaults, and constrains the material selector to relevant alloys and polymers.

| Domain | Default Material Options | Primary Rank Default |
|--------|--------------------------|----------------------|
| General | — (agnostic) | User defined |
| Biomedical | Ti6Al4V, PEEK, SS316L, HA Ceramic | Microstrain → pore size → throat size |
| Aerospace | Ti6Al4V, Al 7075, Inconel 718, CFRP | Load path efficiency → anisotropy → VF |
| Oil & Gas | SS316L, Inconel 625, Tool Steel | Connectivity → isotropy → stiffness density |
| Automotive | Al 6061, HSLA Steel, Nylon PA12 | Ortho contrast → stiffness density → VF |
| Thermal | Copper, Al 6061, Ti6Al4V | Thermal/density → thermal anisotropy → connectivity |

---

## Filtration System

Three sequential rank filters narrow the design space:

- **Rank 1** — Sorts all sampled designs by the chosen metric (MAX or MIN). No designs are eliminated at this stage.
- **Rank 2** — Keeps the top N% of Rank 1 survivors by a second metric. Default: top 50%.
- **Rank 3** — Keeps the top N% of Rank 2 survivors by a third metric. Default: top 25%.

After sequential filtering, remaining designs are ranked by one of two modes:

- **Ideal Corner** — Euclidean distance from the theoretically perfect corner of the 3D design space (closest = Rank 1).
- **Outlier** — KNN-based isolation score (k=5). Surfaces far from the cluster center — unusual, potentially novel configurations.

---

## 3D Design Space Explorer

The canvas in the upper right plots all surviving designs as a 3D scatter. Axes map to the three rank filter metrics. Click and drag to rotate. Hover a point to preview its surface and highlight the corresponding table row. Click to select for export.

Color modes:
- **Rank** — Teal / blue / purple for top 3; grey for the rest.
- **Terms** — K-means cluster coloring (k=6) based on surface term composition.

---

## Solver

Since v0.24.0 Sweep solves on the GPU with **F13LD.lab's own WebGPU solver** whenever the browser has WebGPU, and falls back to its older CPU solver otherwise. The sidebar's Solver line says which one is running (GPU and adapter name, or CPU and why).

### GPU solver (v0.24.0)

- **Same code as F13LD.lab.** `solver/lab/` holds Lab's solver files byte-for-byte (FFT, the fast elastic path, the thermal solver; `tests/parity/solversync.js` checks them). They run in their own worker (`solver/gpu-worker.js`), so the page stays responsive.
- **Elastic:** full 6 × 6 Voigt stiffness from six load cases, so Ex/Ey/Ez are proper Young's moduli (shear and Poisson coupling included) and the shear moduli Gyz, Gxz, Gxy, Poisson's ratios and the Zener ratio are reported. Stiffness reads lower than the CPU solver's normal-only numbers — expected.
- **Thermal:** Lab's GPU conductivity solver (three load cases at once), in every domain.
- **Same voxels as Lab:** partial-volume voxels (each surface voxel carries its solid fraction) and Lab's island trim (floating islands removed, beams never trimmed).
- **Stretched cells:** a cell with unequal edges (TPMS `cell_scale_x/y/z`, beam `scale_xyz`) is solved as stretched — the voxel spacing differs per axis in the Green operator and the thermal operator. Before v0.24.0 cell scale did not change the physics. (F13LD.lab still solves cubic cells; it will take this up later.)
- **Speed:** CPU workers prepare designs (geometry, gates, pores, curvature, tortuosity) while the GPU solves; several designs are in flight on the GPU at once. Fast precision uses void stiffness 1e-3 and CG tolerance 1e-3 (within ~0.1–0.3 % of a tight solve at a fraction of the iterations); Rigorous uses Lab's sweep settings (void 1e-6, tolerance 1e-4) so its numbers can be checked against Lab. N = 64 is offered on the GPU only.
- **Switch off:** add `?gpu=0` to the URL for the CPU solver.
- **Checks on your machine:** `tests/bench.html` (solver checks and a CPU-vs-GPU speed bench on real sweeps).

### CPU solver

The fallback is a browser-native FFT-CG (Fast Fourier Transform – Conjugate Gradient) solver based on the Lippmann-Schwinger formulation. It computes effective elastic stiffness by solving three independent normal load cases on a voxelized unit cell, extracting Ex, Ey, Ez from the compliance tensor inverse.

### Grid resolution

- **FFT-CG solver:** N=32³ for PI-TPMS, N=16³ for solid and shell modes. Power-of-2 sizing for radix-2 FFT.
- **Hi-res analysis pass:** N=96³ for PI-TPMS designs, used to compute volume fraction, connectivity, and pore metrics independently of the solver grid. This decoupling matters because PI-TPMS pipes at typical radii (`r ≈ 0.1` cell units) are roughly one voxel wide at N=32 — the solver still produces stable stiffness values at that resolution, but binary voxel counting for volume fraction is alignment-noise dominated. Hi-res sampling resolves pipes with ~3 voxels across, giving reliable geometric measurements without paying the ~10× cost of running the FFT-CG itself at higher N.

### Parallelism

Sweeps run on a Web Worker pool sized to `min(8, navigator.hardwareConcurrency − 1)` — leaves one core for the UI, caps at 8 to avoid thermal throttling on laptops. The pool persists across sweep runs in the same tab session, so subsequent sweeps don't pay worker startup latency.

Each worker loads `worker/sweep-worker.js`, which pulls in the same family, solver and metrics files the page uses (`importScripts`), so every worker has its own copy of the solver, workspace and Gamma cache. (Before v0.20.0 the worker source was assembled at runtime from `Function.prototype.toString()`.)

Sample generation (Sobol low-discrepancy: dimension 0 the density, 1–3 the cell scale, then each family's most influential settings; a seeded random stream for the rest) stays on the main thread; the worker solves each design's density knob first (`41-density.js`) and sends the solved recipe back — workers receive fully-realized design specs and dispatch results back via `attemptIdx`. Final result IDs are assigned by sorting on `attemptIdx` after the sweep completes, so results are deterministic across runs with the same Sobol seed regardless of worker completion order.

### Connectivity

Connectivity (κ) is computed geometrically via breadth-first search through solid voxels with periodic boundary conditions. Each voxel records the image offset at which it was first reached; when BFS revisits a voxel via a different image, the difference vector is recorded as a span vector. An axis counts as connected if any span vector has a nonzero component along that axis. This replaces the prior stiffness-threshold proxy, which incorrectly reported κ=1 for any design that produced nonzero Ex/Ey/Ez under periodic boundaries — including disconnected fragments coupled only through their image.

### Coefficient normalization

After random sampling, all per-term coefficients are normalized to `max(|c|) = 1`. This decouples the geometric parameters (pipe_radius, wall_thickness, offset) from the random coefficient scale, so a given pipe radius means the same physical thing across every sample draw. Without normalization, large coefficient ratios produce field magnitudes ~10–15, making typical pipe radii hair-thin slices of field space and pushing most attempts into degenerate-VF rejection.

### Caching

The Green operator Γ is precomputed once per worker per (N, Es, ν) triple and held for the duration of the sweep. Workers also reuse a pre-allocated `SolverWorkspace` (FFT line buffers, CG residual/direction arrays) across all designs they handle, avoiding per-sample Float32Array allocation churn.

### Thermal

Optional scalar FFT-CG thermal solve (three flux load cases) activates only in the Thermal domain. Reuses the elastic solve's voxel field — no additional voxelization cost.

### Numeric format

All hot-path arrays (stress, strain, residual, search direction) are Float32. Γ and FFT line buffers stay Float64 for spectral accuracy. End-to-end drift versus pure Float64 is on the order of 10⁻⁶ relative, well below the rounding precision of reported metrics.

---

## PI-TPMS Sampling

The sweep samples PI-TPMS phase shifts from discrete eighths along each axis, excluding the trivial `(0, 0, 0)` shift (which collapses the two surfaces into one and produces a sheet rather than a pipe network). Other shifts that may be degenerate for specific surface families — e.g. `(0.5, 0.5, 0.5)` for surfaces with frequency-2 term structure — are not currently filtered. If a degenerate combination produces a near-empty design, the volume-fraction threshold catches it as a regular discard. A formal degenerate-shift library, indexed by surface family, is on the roadmap.

---

## Project structure

Since v0.20.0 the tool is split into numbered classic scripts, like F13LD.lab and F13LD.mesh. They share one global scope and load in numeric order. No build step; serve over http(s) (GitHub Pages does) — `file://` can't start workers.

| File | Contents |
|---|---|
| `index.html` · `sweep.css` | Markup · all styles |
| `00-config.js` | Tool version (`F13LD_SWEEP_VERSION`) |
| `01-f13-shade.js` | Shared F13LD-SHADE / F13LD-VIEW blocks (byte-identical across F13LD tools) |
| `05-log.js` · `10-state.js` | Run log · global sweep state |
| `11-rank.js` · `12-target-profile.js` | Rank filters, KNN outliers, k-means colouring, final ranking · target-aware sampling |
| `20-recipe-load.js` · `21-materials-domain.js` · `22-controls.js` · `23-dock.js` · `24-drawer.js` | Recipe loading, presets · materials, domains, pickers · sweep controls · icons, dock + drawer shell, inspector, results funnel, column tooltips · the drawer's Settings panel (drives the hidden legacy controls) (v0.25.0) |
| `families/fam-index.js` · `fam-tpms.js` · `fam-noise.js` · `fam-grain.js` · `fam-beam.js` · `fam-foam.js` · `fam-wave.js` | How each family's recipe is varied (Neighbourhood / Explore, Spread) and summarized |
| `geom/` | Recipe → field → voxels, byte-identical with F13LD.lab (`tests/parity/geomsync.js`) |
| `40-design.js` · `41-density.js` | Designs are recipes: geometry, voxels, margin field · the density solve (each design's thickness knob set to its drawn volume fraction) |
| `42-fft.js` · `43-elastic-solver.js` · `44-solver-config.js` · `45-homogenize.js` | FFT · Green operator + CG · solver constants and caches · elastic / thermal homogenization |
| `50-hires-field.js` · `51-transport.js` · `52-geometry-metrics.js` · `53-pores.js` | Hi-res field · throat / percolation / tortuosity · curvature / topology · pore analysis |
| `54-estimate.js` | Per-design pipeline: `prepareDesign` → solve → `finishDesign`; `estimateHomogenization` = the CPU path |
| `55-estimate-gpu.js` | GPU path: `prepareDesignGpu` (worker: partial volume, island trim, cell edges) · `finishDesignGpu` (page: moduli from the 6 × 6) · GPU precision settings |
| `60-solver-pool.js` · `61-sobol.js` · `62-run-sweep.js` | Worker pool, GPU solver client, per-design routing (`computeDesign`) · Sobol sampler · sweep runner |
| `70-export.js` · `71-results-table.js` · `72-mesh-handoff.js` | Results export · table and per-domain columns · F13LD.lab / F13LD.mesh handoff |
| `80-preview-glsl.js` · `81-preview-gl.js` · `82-design-select.js` · `85-scatter-plot.js` | Preview shader builders · WebGL preview · design select / export · 3D scatter |
| `99-init.js` | Page init |
| `worker/sweep-worker.js` | CPU worker (loads `families/`, `40`–`55`): whole designs on the CPU path, design preparation on the GPU path |
| `solver/` | **PolyForm Noncommercial** (`solver/LICENSE.md`, `solver/NOTICE`). `lab/` = F13LD.lab's solver files, unchanged · `gpu-worker.js` = the GPU worker · `sweep-gpu-kernels.js` = Sweep's additions (stretched-cell Green operator and thermal scaling) |
| `tests/` | Dev: old-vs-new regression (`harness.js`, CPU path), load-order check (`loadorder.js`), GPU bench (`bench.html`), stretched-cell CPU check (`gpu/stretch-check.js`), Lab sync checks (`parity/geomsync.js`, `parity/solversync.js`), density landing (`density.js`), jitter → density → solve without a browser (`smoke-jitter.js`) |
| `docs/` | `REFACTOR.md` (plan, decisions, phases) · `AUDIT_v0.19.0.md` (findings) |

---

## Export Format

The exported JSON contains the full sweep metadata, base recipe parameters, and per-design records including browser FFT-CG estimates and complete term definitions for downstream ingestion into [field.vault](https://mshomper.github.io/f13ld.vault).

---

## Roadmap

### Path E — Other field families (Grain, Noise)

The current sweep tool consumes TPMS recipes only. The next major arc factors the field math into a unified `FieldKernel` interface that any f13ld field family can plug into. The solver, worker pool, hi-res analysis, and ranking infrastructure are all family-agnostic — the only additions needed are field-evaluation kernels for each new family.

| Stage | Scope |
|-------|-------|
| **E1** | Extract TPMS field math into a unified `FieldKernel` module. Sweep tool consumes the kernel through the same interface that future families will use. |
| **E2** | Add Grain SDF kernel (spinodoid VMF, Gaussian random field, hyperuniform kernel convolution). [f13ld.grain](https://mshomper.github.io/f13ld.grain) recipes become valid sweep inputs. |
| **E3** | Add Noise SDF kernel (seven noise types from [f13ld.noise](https://mshomper.github.io/f13ld.noise)). Noise recipes load and sweep. |
| **E4** | Family-aware sidebar — sweep parameter UI swaps based on the loaded recipe's family (e.g., grain wavevector parameters replace TPMS pipe radius for spinodoids). |


### Refactor and GPU (in progress)

v0.20.0 split the tool into modules; v0.21.0 builds every design exactly as F13LD.lab and F13LD.mesh do; v0.22.0 fixed the audit's quick items; v0.23.0 refreshed the UI; v0.24.0 moved the solver onto the GPU (F13LD.lab's solver, full 6 × 6 with shear, stretched cells, Lab's thermal). Next: the CPU fallback with the same physics, then the UI session. See `docs/NEXT_STEPS.md` and `docs/REFACTOR.md`.

### Smaller items on the queue

- True throat-width metric via 3D distance-transform on the void with saddle-point detection. The current `throat_size` measures local surface curvature length scale, which is a useful proxy but not the geometric narrowest-channel width.
- `surface_complexity` field correction for PI-TPMS mode. The current implementation evaluates the wrong implicit (TPMS solid condition rather than PI-TPMS pipe condition) when counting isosurface faces.
- Surface-family-indexed degenerate shift library for PI-TPMS sampling.

---

## License

MIT (`LICENSE`), except the `solver/` folder: F13LD.lab's solver and the code built on it are under the PolyForm Noncommercial License 1.0.0 with F13LD.lab's permission to reproduce published results (`solver/LICENSE.md`, `solver/NOTICE`).
