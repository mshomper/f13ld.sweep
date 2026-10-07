# F13LD.sweep v0.19.0 audit (2026-10-07)

Audit of the single-file v0.19.0 build (`index.html` @ `762c31d`) before the module split. Line numbers refer to that file. Severity: **H** wrong results · **M** wrong in edge cases / fragile · **L** cleanup.

Nothing here was changed in v0.20.0 (split only). Fixes land in v0.21.0+ — see `REFACTOR.md`.

## Solver

| # | Sev | Lines | Finding |
|---|---|---|---|
| S1 | H | 5222–5466 | Elastic FFT-CG keeps only the 3×3 normal block of Γ and of the strain field. Local shear strain is held at zero, which over-constrains the cell; stiffness reads high (most for bending-dominated and sheet designs). Ex/Ey/Ez come from inverting that 3×3 block, so Poisson coupling is partial; no shear moduli. |
| S2 | H | 5768–5855 | Thermal "CG" is a 40-step basic fixed-point iteration with the solid as reference. At near-zero void conductivity it barely contracts, so k reads high. Allocates new arrays every iteration. |
| S3 | H | 7088, 7337, 8416 | Cell scale has no effect on any computed number for TPMS, noise and grain: voxelization always uses the fixed cube. Scale draws, axial bias and the anisotropy pre-gate steer a variable the solver never sees. |
| S4 | H | 7240, 7446–7465 | Beam runs the full elastic CG (~37 s/design in Node) then overwrites Ex/Ey/Ez and VF with analytical values, which mix mm radius with cell-local strut length — correct only at a 2 mm cell, off by (cell/2)² otherwise. Analytical E also ignores the percolation gate. |
| S5 | M-H | 7152 vs 5682 | Pre-gate relaxes VF bounds for PI/noise/grain (hi-res mask is canonical), but `fftHomogenize` re-applies strict bounds to the coarse-grid VF: the relaxation does nothing and those designs pay for the hi-res build before rejection. |
| S6 | M | 7524, 7226 | Surface complexity and solid/shell pore analysis re-evaluate the field without the anisotropic shell weights, and pores are hard-coded to N=16. |

## Geometry and metrics

| # | Sev | Lines | Finding |
|---|---|---|---|
| G1 | H | 6345–6399, 6161–6331, 6413–6483 | Connectivity, percolation, throat and tortuosity are face-to-face searches with hard walls — not periodic. Wrapping channels read as blocked; pieces touching both faces without meeting their own image read as connected. EDT treats out-of-grid as void (throats near faces inflated). Lab has periodic versions (`periodicComponents`, `periodicEdt3d`). |
| G2 | H | 6908, 6999 | Pore sizes divided by the mean gradient a second time when PI/shell normalization is on (field is already a distance). |
| G3 | H | 4726–4750, 4816–4840, 4994–5053, 2251–2265 | PI-TPMS ignores the iso offset; split-P and F-RD presets have no constant term. Lab fixed both. |
| G4 | H | 5004–5022, 5124–5139, 5069–5078 | Normalization gradients taken on the coarse solver grid (~20% low on frequency-3 terms); field B uses the fine step, field A the coarse one; the hi-res path uses the fine step everywhere — solver and hi-res metrics describe different geometry. Lab fixed this. |
| G5 | H | 3843–3847 | Every grain design in a sweep gets the same RNG seed — seed diversity never explored. |
| G6 | H | 3597–3646, 3733 | Hyperuniform kernels not wrapped periodically (starved faces). Lab fixed this. |
| G7 | M | 4291–4297 | Beam halo uses 6 face neighbours and ignores the smoothing k (lab: 26 neighbours, r + k + ball). |
| G8 | M | 4253–4256 | Beam smooth-min is quadratic; mesh and lab use cubic — node fillets differ from the exported part. |
| G9 | M | 6679–6825 | Topology treats the grid edge as void (not periodic); 6-connected components vs a face complex that joins edge neighbours; `genus_per_cell` is per cm³. |
| G10 | M | 6632–6636 | MIH area ≈2× high (two-layer band counted as area). |
| G11 | M | 6413–6476 | Tortuosity uses a Manhattan path (up to √3 high on diagonal channels); promised non-percolating flag not returned. |
| G12 | M | 6315 | "Min throat diameter" is the max over axes. |
| G13 | M | 2747–2813 | TPMS jitter redraws frequencies/coefficients from scratch; PI mode forces every frequency to 1 — double-frequency presets lose their identity. |
| G14 | M | 3449–3456 | Grain RNG is xorshift32 (not mulberry32); seed 0 sticks at 0. Lab has the same issue. |
| G15 | L | 3980 | Grain preview half-texel offset. |
| G16 | L | 4436, 4549 | Beam pad seed ignores node balls; preview silently drops struts past 64. |

## Sampling and runner

| # | Sev | Lines | Finding |
|---|---|---|---|
| R1 | M-H | 8569–8575, 9121, 9127 | Precision and grid N re-read per design (toggle mid-sweep mixes settings) and again at export time. |
| R2 | M | 8917–8951 | Export `context` read from the page at export time: rank metrics come from domain defaults, not the user's picks; `sigma_ref` null when blank though the solver used Es×1e-4; material/cell changes after a sweep are recorded wrong. |
| R3 | M | 2419, 8232 | Loading a recipe mid-sweep re-enables Run; a second sweep resets the cancel flag, old chains keep pushing into the new results, attempt numbers collide in the pool. |
| R4 | M | 8079 | Worker crash neither rejects the pending promise nor frees the worker — sweep hangs silently. |
| R5 | M | 8599–8608 | In-flight designs complete after the target, so results exceed the sample count by up to workers−1 (timing-dependent). |
| R6 | M | 8415 | Bias draws clamped to the range bound — ~25% of tier-3 draws on the edge; breaks Sobol stratification. |
| R7 | M | 1817 | `U_strain` biases ρ the wrong way (should match microstrain). |
| R8 | M | 2212–2216, 2072 | Hidden stress input still feeds the solver after a domain switch. |
| R9 | L | many | "Deterministic per Sobol seed" claim is false: trig swap, phase, iso, half width, PI shift use unseeded `Math.random`. First Sobol point is all ~0. Discard breakdown omits `aniso_insufficient`. No warning at the attempt cap. |
| R10 | L | 9427–9428 | Rank filter: keep 0% means 100%; ties to the earlier attempt; nulls kept when too few numeric. |
| R11 | L | 1551, 1589 | Null metrics scored as 0 in KNN/k-means; ≤5 rows → every outlier score Infinity. |

## Export and handoff

| # | Sev | Lines | Finding |
|---|---|---|---|
| E1 | H | 9367–9372, 9599, 10645, 10366 | Shell designs export / hand off / preview the base wall thickness, not the jittered value the solver used. Per-design scaleX/Y/Z missing from TPMS/noise/grain exports. |
| E2 | H | 10638–10658 | Export Design omits `pi_normalize` / `shell_normalize`; mesh then defaults them on. |
| E3 | H | 9594–9597 | Mesh handoff sends `scale_xyz`; mesh reads `cell_scale_x/y/z` — every handoff opens isotropic. |
| E4 | M | 9594–9609 | Noise handoff omits `half_invert` and the stored range; defaults mode to solid (Export Design: sheet). |
| E5 | M | 8869 | Grain export writes `ortho_weights: null`. |
| E6 | M | 9626, 9630 | Handoff uses `?r=` (URL-length limited) — mesh also reads `#r=`. Clipboard fallback has no `.catch`. |
| E7 | L | — | Version strings: exports said 0.18.1 while the header said 0.19.0 (fixed in v0.20.0 — one constant); handoff `meta.tool: 'sweep'` vs export `'f13ld.sweep'`. |

## UI

| # | Sev | Lines | Finding |
|---|---|---|---|
| U1 | M | 10174–10217 | Shaders never deleted (two leak per hover); failed link leaks the program and keeps drawing the old one under the new badge. |
| U2 | M | 10419–10428 | Hover recompiles the shader on every cell crossing within a row; grain re-bakes its 32³ field each time. |
| U3 | M | 10009–10026 | Preview ignores anisotropic shell weights. |
| U4 | M | 10066, 10077 | Beam preview march step scales with 1/cell mm — holes at large cells. |
| U5 | M | 9723 vs 10971 | Table shows 200 rows; plot shows all — selections beyond 200 invisible. |
| U6 | M | 52–59, 380–436 | No `@media` rules; unusable on phones. |
| U7 | L | 9662–9666, 9717, 9762 | Sort treats null as 0; formatting table computed but unused; re-sort drops highlight. |
| U8 | L | 11070, 10703 | `log()` inserts HTML; a crafted preset name in a recipe can inject markup. |
| U9 | L | 10146, 10151 | Grain cube faces shaded with the noise normal path. |
| U10 | L | 10987–11039 | Plot hover from outside the canvas; no depth priority; ideal-corner marker follows disabled ranks. |
| U11 | L | 959/968 | Duplicate id `nominalLabel`. |
| U12 | L | — | No keyboard access to sortable headers, rows, ↗ button, term toggles; preview hover-only. Older header markup (no Queue / Mesh / Lab pills). |

## Dead / duplicated code

`computeAxisConnectivity` (only bundled into the worker), several unused variables, `analyzePoresFromField` vs `analyzePores` duplicate, and three diverging copies of the mode thresholds (`applyMode`, `applyModeRaw`, `buildVoxels` branches).

## Cost per design (Node 22, one thread, 3-term gyroid)

| Mode | Total | Elastic CG | Thermal | Rest |
|---|---|---|---|---|
| Solid, N=16 | 7.7 s | 6.6 s (86%) | 1.0 s | <0.1 s |
| Shell, N=16 | 5.6 s | 4.5 s | 1.0 s | <0.1 s |
| PI, N=32 + 96³ | 54.6 s | 43.9 s (80%) | 6.5 s | ≈4 s |
| Beam, N=32 | 36.9 s | all — then discarded | — | — |

## Lab cross-note

Lab's grain kernel stores hyperuniform shape scalars as properties on the kernels *array* (`13-kernels.js` 614–616, 717); structured clone drops them when sent to a worker. Sweep keeps them on `params` and is right. Worth fixing in Lab.
