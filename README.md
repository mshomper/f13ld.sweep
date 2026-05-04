# F13LD.sweep

A browser-based design space explorer for implicit metamaterials. Sweep hundreds of geometric configurations in parallel, rank them by mechanical or thermal performance, and export the best candidates for validation.

**[Open the Sweep Tool](https://mshomper.github.io/f13ld.sweep)**

Companion to the [F13LD Suite](https://f13ld.app) 

<img width="1688" height="1252" alt="F13LD sweep screenshot" src="https://github.com/user-attachments/assets/ebada980-4da3-4ec8-bde3-074d3e299112" />

---

## What It Does

f13ld.sweep takes an implicit recipe (exported from other [f13ld](f13ld.app) tools) and explores the surrounding design space — varying multiple parameters depending on the type and surface modes. Each candidate design is evaluated using a browser-based FFT-CG homogenization solver that computes effective elastic stiffness, anisotropy, connectivity, pore geometry, and optional thermal conductivity. Results are ranked, visualized in a 3D design space explorer, and exportable as JSON for downstream GPU validation.

---

## Workflow

1. Design a surface in any [f13ld](f13ld.app) tool and export a recipe JSON
2. Drop the JSON into the sweep tool
3. Select your application domain and material
4. Set your filtration ranks and target metrics
5. Run the sweep — results populate in real time
6. Hover rows to preview surface geometry; click to select
7. Export results JSON for ingestion into the [field.vault](https://mshomper.github.io/f13ld.vault)

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

Selecting a domain filters the visible metrics, sets domain-appropriate rank defaults, and constrains the material selector to relevant alloys and polymers.

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

The homogenization engine is a browser-native FFT-CG (Fast Fourier Transform – Conjugate Gradient) solver based on the Lippmann-Schwinger formulation. It computes effective elastic stiffness by solving three independent normal load cases on a voxelized unit cell, extracting Ex, Ey, Ez from the compliance tensor inverse.

### Grid resolution

- **FFT-CG solver:** N=32³ for PI-TPMS, N=16³ for solid and shell modes. Power-of-2 sizing for radix-2 FFT.
- **Hi-res analysis pass:** N=96³ for PI-TPMS designs, used to compute volume fraction, connectivity, and pore metrics independently of the solver grid. This decoupling matters because PI-TPMS pipes at typical radii (`r ≈ 0.1` cell units) are roughly one voxel wide at N=32 — the solver still produces stable stiffness values at that resolution, but binary voxel counting for volume fraction is alignment-noise dominated. Hi-res sampling resolves pipes with ~3 voxels across, giving reliable geometric measurements without paying the ~10× cost of running the FFT-CG itself at higher N.

### Parallelism

Sweeps run on a Web Worker pool sized to `min(8, navigator.hardwareConcurrency − 1)` — leaves one core for the UI, caps at 8 to avoid thermal throttling on laptops. The pool persists across sweep runs in the same tab session, so subsequent sweeps don't pay worker startup latency.

The solver is bundled into the worker source at runtime via `Function.prototype.toString()` over the main-thread function definitions, then assembled into a Blob URL. This preserves the single-file deployment story (no separate `solver.js`) while giving each worker its own isolated copy of the solver, workspace, and Gamma cache.

Sample generation (Sobol low-discrepancy + uniform random for high-dimensional jitter) stays on the main thread — workers receive fully-realized design specs and dispatch results back via `attemptIdx`. Final result IDs are assigned by sorting on `attemptIdx` after the sweep completes, so results are deterministic across runs with the same Sobol seed regardless of worker completion order.

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

## Files

`index.html` is the entire tool. The HTML, CSS, JS module, FFT-CG solver, Web Worker pool, WebGL2 surface preview, and 3D design space plot all ship in one self-contained file per the [F13LD brand guidelines](https://f13ld.app) single-file constraint. Workers are constructed from a runtime-built Blob URL — no separate solver script, no module imports, no build step.

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

The kernel module is bundled into workers via the same runtime stringification pattern used today for the solver, preserving the single-file deployment.

### Path C — GPU acceleration (deferred)

A WebGPU compute backend for the FFT-CG inner loop is the longer-horizon target. Current solver performance with 8 CPU workers is sufficient for typical 100–500 design sweeps; WebGPU becomes worth the implementation cost once sweep sizes scale to thousands or kernel evaluation costs grow with new field families.

### Smaller items on the queue

- True throat-width metric via 3D distance-transform on the void with saddle-point detection. The current `throat_size` measures local surface curvature length scale, which is a useful proxy but not the geometric narrowest-channel width.
- `surface_complexity` field correction for PI-TPMS mode. The current implementation evaluates the wrong implicit (TPMS solid condition rather than PI-TPMS pipe condition) when counting isosurface faces.
- Surface-family-indexed degenerate shift library for PI-TPMS sampling.

---

## License

MIT
