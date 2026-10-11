# F13LD.sweep — session recap, 2026-10-11 · v0.30.0 metrics (Vault metrics audit)

Goes with F13LD.vault v0.9.0. Both ship before the Vault wipe and reseed, so the new rows carry the new fields.

## What changed
- **`specific_surface`** (new export field, `52-geometry-metrics.js`): interface area ÷ V^(2/3), from the curvature pass's Crofton area integral (= W / N²; a stretched cell's voxel volumes multiply to 1). Replaces Vault's use of the voxel-face `surface_complexity` (≈1.5× high). Checked: gyroid sheet 5.94 against two gyroid surfaces of ≈3.09 each. It lands in Vault's `metrics_extended` through F13LD.ingest unchanged (not a first-class column — no schema change).
- **`throat_ratio`** is now throat ÷ pore (both inscribed diameters, µm) — the constriction ratio its label always gave. Up to v0.29 it was throat ÷ cell, the same number as `throat_size_norm`. Not ÷ P50: P50 is the distance field's median over every void voxel, about half the pore size, so throat ÷ P50 read ≈2 for open cells. Labels: `φt/φ`.
- **Targets** (`13-target.js`): `_beff` (Voigt efficiency, stiffest axis), `_tp` (throat ÷ pore) and `_keff` (conductivity efficiency), matching Vault v0.9.0's derived columns so Aim Sweep works on Vault's new presets. `stiffness_density_norm` is named Voigt efficiency (mean axis).

## Checks
- `node tests/harness.js <main> . tpms-gyroid-sheet,beam-bcc` (CPU): the only differences are `throat_ratio` (expected) — every other number identical.
- `node tests/target.js` 28/28 · `node tests/loadorder.js` OK · `node tests/vault-push.js ../f13ld.ingest` PASS.
