# Session recap — 2026-10-13 · v0.33.0 principal-curvature profile

**Branch:** `v0.33.0-curvature` (not merged — waiting on Matt's GPU bench and the grid decision below). Ships with F13LD.vault v0.11.0 (`v0.11.0-curvature`) and F13LD.ingest v0.11.1 (`v0.11.1-aniso-check`, push file 1.1.1). Bundle moves to v0.34.0.

## Why
Matt (2026-10-13, his notes "Surface curvature as a ranking metric for F13LD.vault", after Callens et al. 2023, Nat Commun 14:855, and Xiao, Schilling & Wang 2024): rank scaffolds by how much of their surface bone cells prefer — where the smaller principal curvature κ₂ < 0. Never store a signed mean of K (fixed by topology through Gauss–Bonnet); store area fractions and moments, dimensionless (κ × cell size), from one estimator on one support scale.

## What changed
- `52-geometry-metrics.js`: `computeCurvatureMetrics` takes an optional `collect` array (each interface crossing: area weight, H in the exported sign, K — voxel units). New `computeCurvatureProfile(crossings, N, chi)` → `curv_f_neg` (area with κ̃₂ < −0.5), `curv_f_sad` (K̃ < −0.25), `curv_k2_mean`, `curv_k2_sd`, `curv_k2_neg_med` (area-weighted median over the concave area), `curv_k_neg_int` (∫ min(K̃,0) dA ÷ A), `curv_gb_resid` ((∫K dA − 2πχ) ÷ 2π) and `curv_flag` (|resid| > max(0.5, 0.1·|χ|)). κ̃₁, κ̃₂ clamped to ±N/2 (radius two voxels) for moments, median, K̃⁻ and the Gauss–Bonnet integral.
- `50-hires-field.js`: `buildMarginField(geo, N)` — the margin field alone, solid = margin > 0, one pass.
- `54-estimate.js`: `CURV_N` (fixed curvature grid). Every curvature value — H, |H|, σ(H), K, uniformity, MIH, specific surface and the profile — now comes from it; the metrics grid is reused when it already is `CURV_N`. Topology, pores and tortuosity stay on the metrics grid. `finishDesign` passes the `curv_*` fields and `curv_N`.
- `70-export.js`: `curvDesignFields` in both per-design blocks; `meta.solver.curvature` (grid, estimator, flat band, tail clamp, flag rule); `schema_version` 0.21.0. Additive — F13LD.ingest puts the new fields in `metrics_extended` (checked).
- `tests/curvature.js`: calibration (ball / pore ±2π/R, rod 0, channel, gyroid network and sheet saddle everywhere, Gauss–Bonnet passing on smooth shapes and flagging sharp beam nodes) and every family through `prepareDesign`.

## Calibration (64³)
| Shape | expected κ̃₂ | measured | concave | saddle | GB resid |
|---|---|---|---|---|---|
| ball R 1.5 | +4.19 | +4.185 | 0 | 0 | 0.001 |
| pore R 1.5 | −4.19 | −4.189 | 1 | 0 | 0.001 |
| channel R 1.2 | −5.24 | −5.22 | 1 | 0 | 0 |
| gyroid network | — | median −4.23 | 0.99 | 0.99 | 0.015 |
| gyroid sheet | — | median −4.88 | 1.00 | 0.99 | 0.09 |
| cubic beam, sharp nodes | — | — | — | — | 5.2 (flagged) |

## Open: the grid (Matt to decide before merging)
Concave area fraction against the curvature grid (VM, CPU):

| Recipe | 32³ | 48³ | 64³ | 96³ |
|---|---|---|---|---|
| tpms-gyroid-sheet | 1.000 | 0.996 | 0.996 | 0.995 |
| grain-spinodoid | 0.577 | 0.745 | 0.827 | 0.896 |
| foam-open-lloyd (3.5 %) | 0.049 | 0.132 | 0.239 | 0.515 |
| tpms-pi-fieldpair (2 %) | 0.375 | 0.580 | 0.538 | 0.479 |
| beam-bcc (sharp nodes) | 0.352 | 0.225 | 0.083 | 0.055 |

Smooth, well-resolved designs settle by 48³; thin and multi-scale ones are still moving at 96³ and the Gauss–Bonnet flag catches them (most foam, grain, noise and low-density PI-TPMS will carry it). Extra field build on the VM: gyroid sheet ~1.4 s at 48³, ~3.6 s at 64³. Claude's recommendation: `CURV_N = 48` — same values where they can be trusted, ~2.5× cheaper, and GPU Fast's noise / grain / PI designs reuse the 48³ field they already build. One constant (`54-estimate.js`). The voxel topology (genus, χ) of thin designs also swings with the grid.

## Checks for Matt (GPU)
1. `tests/bench.html` on the branch (raw.githack) → *Run speed bench*, against `main`: Fast and Rigorous on TPMS shell, beam, foam, wave. The curvature field is CPU-side, in the workers.
2. A Fast sweep of a gyroid sheet and a foam: Export → the `curv_*` fields per design and `meta.solver.curvature`.
3. Push to Vault with Ingest's branch push file (`?push=` override) → open Vault's branch on the same rows.

## Tests run here
`tests/curvature.js`, `tests/axial-connect.js`, `tests/target.js`, `tests/preflight-fixes.js`, `tests/loadorder.js`, `tests/vault-push.js` (against Ingest's branch) — all pass.
