# F13LD.sweep — instructions for Claude

## Commits and pull requests
- Do not add session links (e.g. `Claude-Session: https://claude.ai/...`) to commit messages, pull request descriptions or any file in this repo.
- `Co-Authored-By: Claude …` trailers are fine.
- Ask Matt before pushing to `main`.

## Code layout
- Numbered classic scripts share one global scope and load in numeric order (see README → Project structure). Top-level code that runs at load time may only use things defined in the same or a lower-numbered file. Check with `node tests/loadorder.js`.
- `worker/sweep-worker.js` loads a subset of the same files with `importScripts`; those files must not touch the DOM at load time.
- Bump `F13LD_SWEEP_VERSION` in `00-config.js` and the header label in `index.html` (`.fh-ver`) on every release.
- `01-f13-shade.js` holds the shared F13LD-SHADE / F13LD-VIEW blocks — keep them byte-identical with the other F13LD tools.
- Solver files taken from F13LD.lab keep Lab's licence (PolyForm Noncommercial); everything else is MIT. They live in `solver/` (own `LICENSE.md` + `NOTICE`): `solver/lab/` is Lab's files byte-for-byte (never edit; refresh with `node tests/parity/solversync.js ../f13ld.lab --write`), Sweep's additions go in `solver/sweep-gpu-kernels.js` / `solver/gpu-worker.js`.
- GPU checks run on Matt's machine (`tests/bench.html`); don't spend session time on long headless GPU runs. Headless SwiftShader works for quick small-N checks only.
- Serve over http(s) to test; `file://` does not work (workers).

## Testing
- Before merging, run `node tests/harness.js <old build> <new build>` (see `tests/README.md`). It runs the CPU solver path (`window.SWEEP_GPU = false`). Changes that are not meant to move numbers must come out identical.
- v0.29.x: wave (`families/fam-wave.js`, `geom/wave.js` = Lab's `F13LD-GEOM-WAVE` block), cell stretch for wave (`field.stretch`) and noise via the Cell scale ranges; every family's geometry metrics on a metrics grid with per-axis cell edges (`metricWeights`, 54-estimate.js).
- v0.28.0 targets: `13-target.js` (maths; metric names = F13LD.vault's columns — keep in step with Vault's `23-reach.js` `SWEEP_TARGET_KEYS`) and `63-auto-target.js` (link, Run, rounds). `runSweep()` with no options must stay exactly as before. `node tests/target.js` checks the maths.
- A headless Chromium exists in the cloud VM (`/opt/google/chrome/chrome`): with `playwright-core` installed somewhere on `NODE_PATH`, the harness can run here on CPU for quick checks (point `chromium.launch` at it with a small `-r` shim). GPU checks stay on Matt's machine.
- Latest plan: `docs/FAMILIES_AND_JITTER_PLAN.md` (v0.26.0 jitter overhaul, then Foam / Wave / Bundle, Ingest / Vault). Session recaps: `docs/SESSION_RECAP_2026-10-10.md` (latest — Wave, stretch, every-family metrics), `docs/SESSION_RECAP_2026-10-09.md`, `docs/SESSION_RECAP_2026-10-08_gpu.md`, `docs/SESSION_RECAP_2026-10-08.md`; what's next: `docs/NEXT_STEPS.md`. Refactor plan, decisions and phase status: `docs/REFACTOR.md`. v0.19.0 findings: `docs/AUDIT_v0.19.0.md`.
- Cross-tool geometry check: `node tests/parity/parity.js --quick` (needs the other F13LD repos as siblings).
- Density solve and jitter without a browser (v0.26.0): `node tests/density.js`, `node tests/smoke-jitter.js` (both slow on grain / noise — filter to a case). `bench.html` (WebGPU) runs on Matt's machine; full harness runs too, but a few cases on CPU here are fine.
