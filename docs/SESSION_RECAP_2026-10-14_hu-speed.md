# F13LD.sweep — session recap, 2026-10-14 · v0.33.1 hyperuniform speed

**Main:** v0.33.1, merged with F13LD.lab v0.29.2 and F13LD.mesh v0.9.10 after Matt's click-test. Lab's recap has the full story: `f13ld.lab/docs/SESSION_RECAP_2026-10-14_hu-speed.md`.

## Why
Matt found hyperuniform Grain designs ~50× slower than other families in F13LD.lab. The cause is in the shared `F13LD-GEOM-GRAIN` block, so Sweep had it too: `GrainKernel.evaluate` visited every kernel (205 design kernels become 3,149 after the periodic wrap) at every point, while only a handful contribute.

## What shipped
- `geom/grain.js` resynced from Lab (`node tests/parity/geomsync.js ../f13ld.lab . --write`): `_indexHUKernels` bins kernels on a 24³ grid (built on the first `evaluate`); a term is skipped when R^m ≥ 40·max(1, 1/P) — below e^-40 after the blend root — at every point, with or without the index.
- `F13LD_SWEEP_VERSION` and the header label 0.33.1. No other file changed.

## Checks
- `tests/density.js 32 HU` — caught the first version (cut judged before the blend root moved the empty-space plateau of `HU ortho shaped sheet`, which could no longer reach 25 %). With the final rule the output matches v0.33.0 line for line; 135 s → 45 s.
- `tests/harness.js` (CPU, headless Chromium with the `-r` shim): `grain-hyperuniform` identical (old 50 s / new 16 s), `grain-spinodoid` identical.
- `tests/loadorder.js`: OK. `geomsync.js`: all 9 blocks + foam identical.

## Notes for next time
- Numbers did not move, so v0.33.0 and v0.33.1 exports can be mixed in the F13LD.vault reseed.
