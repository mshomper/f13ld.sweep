# F13LD.sweep — session recap, 2026-10-11 · v0.29.4 noise revision 2

**Main:** v0.29.4 (on top of v0.29.3, the design-space rebuild that landed the same day). One release across F13LD.noise v0.12.0, F13LD.mesh v0.9.9, F13LD.lab v0.26.2, F13LD.vault v0.8.1 and F13LD.ingest v0.11.0. The spec and the checks: `f13ld.noise/docs/NOISE_REV2.md`.

## Why
The noise math lived in four copies: F13LD.noise's CPU code, its GLSL preview, Mesh's worker, and Lab's `F13LD-GEOM-NOISE` block (= `geom/noise.js` here). The CPU copy had a simplex lattice error (truncated 1/7 for the gradient index; the fold test `h <= 0` flips with rounding on 7 of 49 gradients), and Sweep, Lab and Mesh had copied it. They agreed with each other but not with the tool's 3D preview. A default simplex sheet came out 86 % solid instead of about 29 %.

## What shipped (v0.29.4)
- `geom/noise.js` regenerated from F13LD.lab (`geomsync.js --write`). `surface.noise_rev` picks the math: revision 1 (absent) builds exactly as before; revision 2 is the fixed field — integer lattice, PCG3D Worley seeds, warp displacement from min(octaves, 2) octaves. `fam-noise.js` jitter clones the surface, so designs keep their base recipe's revision.
- `tests/parity/lib/tools.js` follows F13LD.noise v0.12.0's layout (`noisePrepass`, `noiseFieldKeyOf`; no smoothing or perforation inputs).
- `tests/parity/fixtures.json` refreshed — noise entries only (they now carry `noise_rev: 2`).
- New `tests/parity/noise-legacy.js` + `noise-legacy.json`: the 19 v0.11.0 exports keep their voxels in Sweep, Lab and Mesh; the same settings as revision 2 agree across the three.

## Checks
- `tests/harness.js <main> <branch> noise-simplex-sheet,noise-ridged-half`: identical (both are revision-1 recipes).
- `tests/parity/parity.js` (all families): PASS — 77 recipes + 96 designs.
- `tests/parity/noise-legacy.js`: PASS.
- `tests/vault-push.js ../f13ld.ingest`, `tests/loadorder.js`, `tests/target.js`: PASS.
- After rebasing onto v0.29.3: `geomsync`, `loadorder`, `parity.js --quick`: PASS.

## Next
- Vault reseed: noise designs must start from an F13LD.noise v0.12.0+ export (revision 2). Revision-1 noise is refused by Ingest's push rule and the database policy.
- Then Bundle (v0.30.0), as planned in `NEXT_STEPS.md`.
