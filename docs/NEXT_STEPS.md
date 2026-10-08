# F13LD.sweep — next steps

**As of 2026-10-08.** `main` = v0.23.0 (branch `v0.22.0-audit` merged after Matt's click-through). What happened so far: [`SESSION_RECAP_2026-10-08.md`](SESSION_RECAP_2026-10-08.md). Design decisions and per-version notes: [`REFACTOR.md`](REFACTOR.md). Original findings: [`AUDIT_v0.19.0.md`](AUDIT_v0.19.0.md).

## 1. Merge v0.22.0 + v0.23.0 — done

Done 2026-10-08. Remaining: run the full parity check (§4), then wipe and reseed Vault from fresh Sweep exports; Ingest needs no changes (shape unchanged, a few added fields).

## 2. GPU solver — next dedicated session (Phase 3)

Elastic CG is 80–90 % of the time per design. Plan from the approved refactor plan:

| Step | What | Check |
|---|---|---|
| A | Copy Lab's WebGPU stack into a PolyForm-licensed folder (`solver/` + its own LICENSE): device, batched FFT, full 6×6 Voigt elastic with **D designs × 6 load cases in one CG**, GPU-resident CG scalars. Wire Sweep to solve a batch of designs at once. | `tests/bench.html` on Matt's machine: GPU vs CPU numbers and wall time. |
| B | **Stretched cells**: non-cubic voxel spacing in Γ (Matt's decision; Lab takes it later). Cell scale then changes the physics for TPMS, noise and grain. | Known answers: a stretched cell vs the same geometry built in a stretched world cube. |
| C | **Shear moduli** and the full stiffness matrix in each result (additive export fields). Stiffness drops vs today — expected. | Lab's own solve on the same recipe. |
| D | **Thermal** by proper CG on the same FFT (today: a basic 40-step iteration that reads high). | Lab's GPU thermal on the same recipe. |
| E | CPU fallback with the same physics; bump `SOLVER_VERSION`; exports say which solver ran. | Harness: CPU fallback = GPU to rounding. |

Keep each step a short, pushed branch; Matt runs the GPU checks.

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
| README roadmap | "Path E" (grain, noise) is done; the "smaller items" list is partly done (throats are now distance-transform based). Rewrite after the GPU session. |
| Test fixtures | `tests/recipes.json` came from Mesh's test set; replace with design-tool exports (one used `mode: "sheet"`). |

## Tools for checking (run on your machine)

| Command | What |
|---|---|
| `node tests/harness.js <old build> <new build> [cases]` | Same seeded sweep in two builds, compares everything. Exit 0 = identical. |
| `node tests/loadorder.js .` | No script uses something from a later-numbered file at load. |
| `node tests/parity/parity.js [--quick]` | Recipe → voxels in Sweep, Lab and Mesh (design-tool recipes and jittered Sweep designs). Needs the other F13LD repos as sibling folders. ~30 s quick. |
| `node tests/parity/geomsync.js ../f13ld.lab [--write]` | `geom/` still byte-identical with Lab (`--write` refreshes it from Lab). Run whenever Lab's geometry changes. |

Setup: `tests/README.md`.
