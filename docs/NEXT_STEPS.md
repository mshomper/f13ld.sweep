# F13LD.sweep — next steps

**As of 2026-10-08 (evening).** `main` = v0.23.0. Branch `v0.24.0-gpu` = the GPU solver, waiting for Matt's GPU checks. What happened so far: [`SESSION_RECAP_2026-10-08.md`](SESSION_RECAP_2026-10-08.md). Design decisions and per-version notes: [`REFACTOR.md`](REFACTOR.md). Original findings: [`AUDIT_v0.19.0.md`](AUDIT_v0.19.0.md).

## 1. Merge v0.22.0 + v0.23.0 — done

Done 2026-10-08. Remaining: run the full parity check (§4), then wipe and reseed Vault from fresh Sweep exports; Ingest needs no changes (shape unchanged, a few added fields).

## 2. GPU solver — v0.24.0 on branch `v0.24.0-gpu` (Phase 3, steps A–D)

Built 2026-10-08 (session recap [`SESSION_RECAP_2026-10-08_gpu.md`](SESSION_RECAP_2026-10-08_gpu.md), notes in [`REFACTOR.md`](REFACTOR.md)): F13LD.lab's solver files in `solver/lab/` (PolyForm), full 6 × 6 elastic with shear, Lab's GPU thermal, partial volume + island trim as Lab, stretched cells (elastic and thermal), designs in flight on the GPU while CPU workers prepare the next ones.

**Before merging — Matt, on your machine:**
1. `tests/bench.html` → *Run checks* at N = 32: every line should say PASS.
2. `tests/bench.html` → *Run speed bench* (gyroid sheet, spinodoid, beam BCC; 24 designs; N = 32): GPU vs CPU seconds. Try N = 16 and 64 too.
3. The app on the branch: Solver line shows your GPU; a sweep runs; shear moduli in the detail panel; export loads into F13LD.ingest.

**Still open from the GPU plan:**

| Step | What | Notes |
|---|---|---|
| E | CPU fallback with the same physics (6 × 6, partial volume, stretched) | Today the CPU path is the pre-v0.24 solver (normal stiffness only); exports say which ran (`solver_version`). Lab's CPU reference (`solver/lab/16a`, `12b`) can do it, slowly. |
| tune | Lanes and CG block sizes after your bench numbers | 6 / 4 / 2 lanes at N = 16 / 32 / 64 today. If the GPU idles, the CPU preparation is the limit (PI-TPMS, noise and grain build 64–96³ metric grids per design). |
| Lab | Stretched cells in F13LD.lab | Sweep solves stretched cells as stretched; Lab still solves the cubic voxel grid, so a stretched design sent to Lab reads differently there until Lab takes this up. |
| thermal | Pore filler | Kept Sweep's k_void = 0.0003 k_solid. Lab offers air / water / tissue; worth matching. |

## 3. UI — dedicated session

- Too much empty space (Matt, 2026-10-08): tighten the stats row, log / plot / preview row and sidebar.
- Active controls go back to **neon** (Matt, 2026-10-08). Today `--accent` is Sweep's amber (`sweep.css` `:root`); set it to `--neon` and check the selected-row / button tints that use amber rgba values. Sweep's amber stays for the tool name and header tile.
- Decide: should picking General reset the rank metrics (today they carry over)?
- Plot: hover from outside the canvas, no depth priority, ideal-corner marker follows disabled ranks (audit U10).
- Sidebar on phones is very long before the results; consider collapsing it after a run.

## 4. Smaller open items

| Item | Notes |
|---|---|
| Full parity run | `--quick` passed (2 designs per family). Run the full set once on your machine before reseeding Vault. |
| TPMS jitter (audit G13) | Frequencies and coefficients are redrawn from scratch; PI forces frequency 1, so double-frequency presets lose their identity. Needs a decision on how far a sweep should stray from the loaded design. |
| Grain seed 0 (audit G14) | The grain tool's generator sticks at 0 for seed 0. Fix must go into grain, Lab, Mesh and Sweep together (shared code). |
| Rank filter ties / nulls (audit R10) | Ties go to the earlier attempt; nulls kept when too few numeric values. |
| README roadmap | "Path E" (grain, noise) is done; the "smaller items" list is partly done (throats are now distance-transform based). Solver section rewritten for v0.24.0; the roadmap still needs a pass. |
| Island trim cap | Sweep skips Lab's island trim when it would remove > 10 % of the solid (a thin design shattered by a coarse grid). Lab trims always. Decide whether Lab should get the same cap. |
| Legacy log line | "Run batch_validate.py …" after export points at an old workflow; remove or point at F13LD.lab. |
| Test fixtures | `tests/recipes.json` came from Mesh's test set; replace with design-tool exports (one used `mode: "sheet"`). |

## Tools for checking (run on your machine)

| Command | What |
|---|---|
| `node tests/harness.js <old build> <new build> [cases]` | Same seeded sweep in two builds, compares everything. Exit 0 = identical. |
| `node tests/loadorder.js .` | No script uses something from a later-numbered file at load. |
| `node tests/parity/parity.js [--quick]` | Recipe → voxels in Sweep, Lab and Mesh (design-tool recipes and jittered Sweep designs). Needs the other F13LD repos as sibling folders. ~30 s quick. |
| `node tests/parity/geomsync.js ../f13ld.lab [--write]` | `geom/` still byte-identical with Lab (`--write` refreshes it from Lab). Run whenever Lab's geometry changes. |
| `node tests/parity/solversync.js ../f13ld.lab [--write]` | `solver/lab/` still byte-identical with Lab. After `--write`, run `tests/bench.html`. |
| `tests/bench.html` (browser) | GPU solver checks + CPU-vs-GPU speed bench. |
| `node tests/gpu/stretch-check.js [N]` | Stretched-cell Green operator vs a supercell, on Lab's Float64 CPU reference. |

Setup: `tests/README.md`.
