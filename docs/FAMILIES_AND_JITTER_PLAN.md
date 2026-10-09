# F13LD.sweep — new families (Foam, Wave, Bundle) and the jitter review

**2026-10-09 · proposal for approval — no code written yet.**
Based on `main` of sweep (v0.25.0), ingest (2026-05-18), vault (2026-05-25), lab (v0.24+), mesh (v0.9.7), foam (v0.8.1), wave (v0.5), bundle (v0.4.0).

---

## 1. Is the current jitter still sound?

Short answer: **Noise and Beam are mostly sound. Grain has a seed-policy conflict. TPMS is not doing what a comparison sweep needs.** And one cross-cutting change (density as a sampled axis) would fix the biggest inefficiency in every family, including the three new ones.

### Per family

| Family | What the jitter does today | Verdict |
|---|---|---|
| **TPMS** | Every term's coefficient is redrawn from scratch (0.05–5, then normalised); every factor's frequency is redrawn from {1, 2, 3}; 20 % trig swap per factor; 15 % chance each term is switched off; 20 % sign flip; a fresh random phase per term per axis (solid / shell). Shell normal-weights ignore the recipe's own weights. PI-TPMS phase shift is redrawn in eighths, ignoring the recipe's. | **Not sound for comparison.** For a gyroid, the chance a design keeps all six frequencies at 1 is (1/3)⁶ ≈ 0.14 %; with the swaps, term drops, random coefficients and per-term phases, effectively no design in a "gyroid sweep" is a gyroid. It is a random trig-surface explorer seeded by the term layout. Audit G13 flagged this; it was never decided. |
| **Grain** | Fresh random seed per design (v0.21, from audit G5); frequency, iso ±0.40, half-width, direction (vMF), wave count, κ, σ, hyperuniform settings × [0.75, 1.25]. | **Seed policy conflicts with your 2026-10-09 Lab decision** ("spinodoid seed stays constant — it fundamentally changes the surface"). With a fresh seed per design, the realisation-to-realisation scatter is mixed into every parameter effect, so a sweep of 100 can't separate "κ went up" from "different random field". |
| **Noise** | Seed kept; frequency, scale x/y/z, iso, half-width, octave settings × [0.75, 1.25]; cellular metric flips categorically. | Mostly sound. Frequency and the three scales multiply together, so four draws only control three effective numbers (one wasted dimension). Cellular metric flip changes the field's character — better as a kept setting. |
| **Beam** | Per-axis cell edges and strut radii from the % ranges; node smoothing and node ball drawn 0–1.5× / 0–2× radius. | Mostly sound. Node smoothing and node balls are added to **every** design even when the recipe has none — so the sweep never contains the recipe's own node treatment. Radius reuses the cell-scale % sliders, which is surprising. |

### Cross-cutting problems

1. **Density is a by-product, so most of the budget is spent on rejections and uneven coverage.** The shape settings are drawn first, density lands wherever it lands, and designs outside the volume-fraction window are thrown away (vf_low / vf_high). Inside the window, density coverage is lumpy, and most comparisons end up mixing "different architecture" with "different density".
2. **Sobol is spent on the wrong dimensions for half the families.** Sobol dimensions 0–2 are the cell-scale draws; grain and noise don't use cell scale, so their best-distributed dimensions are wasted and their key settings sit on dims 4–7 or on plain random numbers. TPMS shell wall thickness — the strongest density knob — is a plain random draw, not Sobol.
3. **Spread isn't user-controlled for grain / noise.** They are fixed at ±25 % regardless of the range sliders.
4. **The loaded design itself is never in the results.** There is no reference row to compare the neighbours against.

### Proposed jitter strategy (applies to all seven families)

**A. Density as a sampled axis (the main change).** Sobol dim 0 becomes relative density, drawn evenly across the volume-fraction window. Each family names its one "thickness knob", and that knob is solved to hit the drawn density on a coarse grid (24³) before voxelising. For most families this is a single sort, not an iteration — the solid fraction is just a quantile of one field pass:

| Family | Thickness knob solved for density |
|---|---|
| TPMS solid / shell / PI-TPMS | offset / wall thickness / pipe radius |
| Noise, Grain | iso level (solid, half) or half-width (sheet) |
| Beam | strut radius (per-axis ratios kept) |
| Foam | wall / strut thickness |
| Wave | iso (solid) or sheet thickness |
| Bundle | iso offset (solid) or sheet width |

Smooth blends (beam node smoothing, bundle blend) make the quantile approximate; one correction step closes it. Expected landing accuracy ±1–2 % VF after partial-volume voxels. Rejections remain only for connectivity / singular solves. Target-aware ρ pressure then just narrows or shifts the density window instead of nudging wall multipliers.

**B. Anchored neighbourhoods by default, explore as an explicit mode.** "Neighbourhood" keeps the design's identity (term layout, frequencies, trig functions, symmetry, structure type, seed mode, topology) and varies its continuous settings around the recipe's own values with one **Spread** control (default ±25 %, shared by every family). "Explore" keeps today's TPMS-style redraw for anyone who wants it, labelled as such.
- TPMS neighbourhood: coefficients × (1 ± spread), recipe phases kept (PI-TPMS phase shift kept), normal-weights perturbed around the recipe's, cell aspect from the ranges, density from A.
- Beam: node smoothing / ball perturbed around the recipe's values (0 stays 0 unless Explore).
- Noise: cellular metric kept; one overall frequency draw instead of frequency + 3 scales (scales keep their ratios, perturbed separately only when the recipe is anisotropic).

**C. Seed policy: hold the seed by default (common random numbers).** Grain and Foam keep the recipe's seed for every design, so differences between designs come only from the settings. A **Realisations** option (1 by default; 2–4 cycles a small fixed set of seeds) gives you the realisation scatter when you want it, as a separate, labelled source of variance.

**D. Sobol dimension plan.** Dim 0 = density; dims 1–7 = each family's most influential settings in order (declared by the family module, not by fixed slot numbers); everything else on the seeded random stream.

**E. Reference row.** Design #0 is the loaded recipe itself (density untouched), flagged as the reference in the table, plot and export.

This changes numbers on purpose, so `tests/harness.js` old-vs-new will differ; the harness gets a "reference row is identical to a Lab solve of the base recipe" check instead.

---

## 2. Adding Foam, Wave and Bundle to Sweep

All three already exist as kernels in F13LD.lab (`13d-foam-kernel.js`, `13b-kernels-new.js` WaveKernel / BundleKernel) and in F13LD.mesh, and Sweep's `geom/recipe.js` already routes all three families. What's missing is the Sweep side: geometry blocks, family modules, and the solve setup.

### Shared plumbing (once, first family)
- Mark `F13LD-GEOM-WAVE`, `-BUNDLE` and `-FOAM` blocks in Lab (comment markers only — no Lab code change), add them to `tests/parity/geomsync.js`, generate `geom/wave.js`, `geom/bundle.js`, `geom/foam.js`.
- `KERNELS` / `SWEEP_FAMILY_LIST`, worker `importScripts`, preview colours (Mesh's), periodic preview wrap, results-table summary, export, parity fixtures from real design-tool exports.
- A new family hook `cellBox(recipe)` → per-axis edge of the true periodic cell, used by the stretched-cell solver (TPMS / beam keep using the drawn cell scale).

### Foam (v0.27.0)
- **Kept:** seed mode, topology (open / closed / plateau / wet), periodic (non-periodic foams refused at load, as Lab and Mesh do), FoamSeeds version.
- **Varied:** cell count, regularity, Lloyd iterations, two-size ratio / large fraction, lattice jitter, anisotropy stretch x/y/z (the foam's anisotropy knob — the tile stays cubic), plateau k, fillet, node size, wet border / edge minimum. Thickness from density (A).
- **Seed:** held (C). Seed positions are dropped from jittered recipes; F13LD.mesh and Lab regenerate them from the generator settings (same FoamSeeds code), so exports stay small.
- **Risk — speed:** the exact distance field is the costliest kernel in the suite, and Sweep builds 64–96³ metric grids per design. I'll time foam preparation per design in node at the start of the phase (a few seconds, small grids), and if needed foam uses a 48³ metric grid in Fast mode.

### Wave (v0.28.0)
- **Kept:** symmetry, mode list (the integer n, m, p of every mode), solid / sheet, phase (A/B).
- **Varied:** mode amplitudes × (1 ± spread), mode phases (small shift), phase time. Iso / thickness from density (A); iso is scaled with the field's RMS so it means the same thing as amplitudes move.
- **Explore mode:** also nudges each mode's integers to a neighbour (±1, kept ≥ 0, and the mode list kept non-degenerate).
- **Cell:** wave is cubic in Mesh (one `cellScale`), so no per-axis cell scale. Anisotropy comes only from the mode content.

### Bundle (v0.29.0)
- **Kept:** structure (bundle / helicoid / braid / weave), topology, beam shape, beams per side, strand count, starts, handedness flags, twist / warp modes.
- **Varied:** each structure's continuous geometry (radius, spacing, gap, twist rate, pitch, inner / outer radius, braid radius, fibre radius, weave pitch / amplitude / layer gap, blend). Iso / sheet width from density (A).
- **The cell is not a cube.** Bundle's true repeat is (Kx·Pxy) × (Ky·Pxy) × Lz — a 2×2 super-cell for weaves, checker steps and alternating handedness, and Lz set by twist / pitch (F13LD.mesh `43-bundle-cells.js`). Sweep's stretched-cell solver can solve that box directly; a Sweep-only sampling wrapper (like beam's one-cell rule in `40-design.js`) maps the solver cube onto it, so the shared Lab block stays untouched.
- **Guards:** cells with Lz / Pxy beyond 4:1 (or below 1:4) are rejected as under-resolved; warped bundles whose twist and warp don't share a period are refused (they don't tile — Mesh bakes them as non-periodic).
- **Lab finding:** F13LD.lab samples bundle on a Pxy³ cube, so any bundle whose Lz ≠ Pxy, or that needs the 2×2 super-cell, is homogenised on a non-periodic box today. Sweep and Lab will disagree on those bundles until Lab takes stretched cells. I'd add a warning in Lab (separate, small, your call).

---

## 3. F13LD.ingest and F13LD.vault

**Ingest**
- `KNOWN_FAMILIES` += foam, wave, bundle; family pills in Mesh's colours.
- Per-family structure checks: foam → seeds block, periodic, FoamSeeds generator stamp; wave → non-empty `field.modes`; bundle → `surface.structure` and a cell box the solver used.
- The Supabase row policy (RLS WITH CHECK) also lists the allowed families — that needs an SQL change you run in the Supabase dashboard; I'll write the exact statement.

**Vault**
- Family colours, legend order, card and detail-panel summaries, compare view for the three families.
- **Bug for foam:** Vault's "Open in Mesh" sends the recipe with `?r=`; foam recipes can be long, and Mesh reads `#r=` for every family — switch Vault to `#r=`.
- Fits your plan to wipe and reseed once the new Sweep exports exist.

---

## 4. Proposed order

| Version | What | Check |
|---|---|---|
| v0.26.0 | Jitter overhaul (A–E) for the four current families | harness, parity `--quick`, your sweep side-by-side |
| v0.27.0 | Foam + shared plumbing | parity (Sweep vs Lab vs Mesh voxels), foam timing |
| — | Ingest + Vault for all three families, Supabase policy SQL | load a foam export end to end |
| v0.28.0 | Wave | parity |
| v0.29.0 | Bundle (cell box, guards) | parity against Mesh's cell box |

Jitter first, so the new families are built once on the new framework rather than twice. Each version waits for your approval before it goes to `main`.
