# F13LD.sweep — next steps

**As of 2026-10-11 (late evening).** `main` = **v0.31.0** — Preflight: after a recipe loads, a few test designs at the bottom of the density window are solved on the sweep's own workers and GPU; on Run, a popup offers a fix when the settings can't hold them (a density floor, the next grid up, Rigorous, or grid and Rigorous together). Catches broken load paths the sweep's own flags miss. Export shape unchanged; Ingest / Vault untouched. Merged after Matt's tests on his phone and machine. Recap: [`SESSION_RECAP_2026-10-11_preflight.md`](SESSION_RECAP_2026-10-11_preflight.md).

**Next (reaffirmed 2026-10-11):**
1. **Matt wipes and reseeds F13LD.vault** through Push to Vault (v0.30.0 or later — v0.31.0 exports are identical; noise from F13LD.noise v0.12.0+). Preflight can be used to pick solver settings before each seeding sweep.
2. **Bundle — v0.32.0.** Plan: [`FAMILIES_AND_JITTER_PLAN.md`](FAMILIES_AND_JITTER_PLAN.md) §2. Bundles connect along one axis only; Preflight already treats that as the design, not a flag.
3. **Open question from Preflight:** should the sweep itself flag a broken load path (zero stiffness on an axis the design connects on at a finer grid), so it shows in the table and can be filtered in Vault? It would add to the export's stiffness flag — its own small version, Matt to decide.
4. Later: **local thickness pore size** (§4) — the micro-CT standard, so Vault's pore sizes compare with published scaffold data.
5. Still pinned: density exponent as a target metric; the CPU fallback with the GPU physics (stretched cells).

**As of 2026-10-11 (evening).** `main` = **v0.30.0** — metrics for F13LD.vault v0.9.0's audit: `specific_surface` (true interface area ÷ V^(2/3), from the curvature pass), `throat_ratio` = throat ÷ mean pore (was throat ÷ cell), and Aim targets `_beff` (Voigt efficiency, stiffest axis — the bound-efficiency target pinned on 2026-10-10), `_tp` (throat ÷ pore) and `_keff` (conductivity efficiency). Merged with F13LD.vault v0.9.0; F13LD.ingest unchanged (the new field lands in `metrics_extended`), no database change. Recap: [`SESSION_RECAP_2026-10-11_metrics.md`](SESSION_RECAP_2026-10-11_metrics.md).

**Next:**
1. **Matt wipes and reseeds F13LD.vault** through Push to Vault from v0.30.0 (noise from F13LD.noise v0.12.0+). The reseed fills specific surface, the new throat ratio and the stiffness matrix on every row.
2. **Bundle — now v0.32.0** (planned as v0.30.0, then v0.31.0; those numbers went to the metrics release and Preflight). Plan: [`FAMILIES_AND_JITTER_PLAN.md`](FAMILIES_AND_JITTER_PLAN.md) §2.
3. Later: **local thickness pore size** (see §4) — the micro-CT standard, so Vault's pore sizes compare with published scaffold data.
4. Still pinned: density exponent as a target metric; the CPU fallback with the GPU physics (stretched cells).

**As of 2026-10-11 (afternoon).** `main` = **v0.29.4** — noise revision 2 (`surface.noise_rev`): `geom/noise.js` from F13LD.lab builds the fixed noise F13LD.noise v0.12.0 previews; revision-1 recipes build exactly as before. Shipped with F13LD.noise v0.12.0, F13LD.mesh v0.9.9, F13LD.lab v0.26.2, F13LD.vault v0.8.1, F13LD.ingest v0.11.0 (push 1.1.0). Recap: [`SESSION_RECAP_2026-10-11_noise-rev2.md`](SESSION_RECAP_2026-10-11_noise-rev2.md); spec: `f13ld.noise/docs/NOISE_REV2.md`.

**For the Vault reseed:** noise designs must start from an F13LD.noise v0.12.0+ export (revision 2) — Ingest's push rule and the database policy refuse revision 1.

**As of 2026-10-11.** `main` = **v0.29.3** (merged after Matt's click-test) — UI only: the 3D design space rebuilt on F13LD.vault's hero view. Canvases sized to the pane × pixel density every frame (fixes the stretched 300 × 150 "image" after a recipe import); WebGL glow points (`84-points-gl.js`, adapted from Vault's `30-points-gl.js`); real-value min / mid / max ticks; axis chips (metric, unit, max / min / unranked / target); Vault camera (eased orbit, wheel zoom, right / Ctrl-drag pan, double-click reset, pinch on touch); Alive drift on by default (remembered per browser); HTML tooltip; white pulse ring for the selection; empty states (no recipe / recipe loaded / running / filtered). Rank colours: top three unchanged, the rest on a slate → amber ramp (`RANK_RAMP`, 11-rank.js) as a nod to Sweep vs Vault's blue. An unranked axis puts the ideal marker mid-way along it. Harness: tpms-gyroid-sheet identical to main.

**Checks it went through (Matt, 2026-10-11):** import a recipe (crisp empty cube, "Recipe loaded" card), run, orbit / zoom / pan / reset, hover and click points (table row + preview follow), Terms mode, toggle Alive and reload (remembered), an Aim Sweep link from Vault (target crosshair, trail, free-axis column, chips show target values), phone layout.

**As of 2026-10-10 (late evening).** `main` = **v0.29.2** — Push to Vault (the whole run to F13LD.vault through F13LD.ingest's shared push file; exported file unchanged). Shipped with F13LD.ingest v0.10.1 (push file v1.0.1) and the 2026-10-10 database migration (contact hidden, `provenance_kind`, `f13ld_lab_results`). Recap: [`SESSION_RECAP_2026-10-10_vault-push.md`](SESSION_RECAP_2026-10-10_vault-push.md).

**Next:** Matt wipes and re-seeds F13LD.vault through Push to Vault, then **Bundle (v0.30.0)**. F13LD.lab's Push to Vault (next fresh session) will call Sweep's `estimateHomogenization` — keep its signature and output shape stable. Open question: Sweep's beam reference design without a `topology` block fails Ingest's check.

**As of 2026-10-10 (evening).** `main` = **v0.29.1** — Wave family + cell stretch (v0.29.0) and every family measured on its real cell (v0.29.1), merged after Matt's click-test and speed bench (no slowdown: foam +5 %, the rest unchanged). Shipped with F13LD.mesh v0.9.8, F13LD.wave v0.6, F13LD.lab v0.26.1, F13LD.ingest v0.9.1, F13LD.vault v0.8.0. Recap: [`SESSION_RECAP_2026-10-10.md`](SESSION_RECAP_2026-10-10.md); notes: [`REFACTOR.md`](REFACTOR.md) → v0.29.0, v0.29.1.

**Next:** Matt wipes and re-seeds F13LD.vault from fresh exports, then **Bundle (v0.30.0)** — plan: [`FAMILIES_AND_JITTER_PLAN.md`](FAMILIES_AND_JITTER_PLAN.md) §2. Pinned for later: density exponent and bound efficiency as Sweep target metrics (`13-target.js` + Vault's `23-reach.js`); the CPU fallback with the GPU physics (stretched cells).

## 0c. v0.29.0 / v0.29.1 — merged 2026-10-10 (the checks they went through)
1. Sweep branch: load a multi-mode wave (e.g. Schwarz P 3-mode, or a sheet with the iso off centre) → Neighbourhood sweep, GPU, 32³, 100 designs: density landing, speed, the reference row, the 3D preview tiling.
2. Load a single-mode wave (Gyroid, Chiral 3-2-1): the dock switches to Explore with a log line; switch back to Neighbourhood and run — only phase / iso shift / density move.
3. A recipe with a fractional index (type 1.5 into the Wave tool): refused at load with the note.
4. Open a design in F13LD.mesh and in F13LD.lab: same surface as in Sweep's preview.
5. Export → drop into Ingest (branch): validates. Vault branch (`?mock` is fine): wave cards and inspector render; Aim Sweep on a wave design opens Sweep; plot density exponent / bound efficiency as axes and add them as range filters; turn on the Pareto front (a smooth curve now).
6. Stretch: a cubic-symmetry wave with the Cell scale ranges open — anisotropy now spreads; with them closed — the warning. In F13LD.wave (branch) move the stretch sliders; Open in Mesh (branch) prints the stretched cell; the same design in Lab (branch) shows "stretched cell".
7. Noise: the Cell scale ranges now set its X / Y / Z stretch (default 50–150 %).
8. v0.29.1: `tests/bench.html` speed bench on TPMS shell, beam, foam and wave (Fast and Rigorous) against v0.29.0 — the extra measuring is CPU-side; if Fast slows noticeably, the floor (`METRICS_N_MIN`, 32) or the grid can drop. Genus / curvature now read on every family.

Pinned for later: density exponent and bound efficiency as Sweep target metrics (both lists, `13-target.js` and Vault's `23-reach.js` `SWEEP_TARGET_KEYS`).

**Earlier, 2026-10-10.** `main` = v0.28.0 — target-aware sweeps (F13LD.vault "Aim Sweep" link, point-target ranking, auto rounds), merged after Matt's click-test together with Vault v0.7.0. Notes: [`REFACTOR.md`](REFACTOR.md) → v0.28.0; recap: [`SESSION_RECAP_2026-10-09.md`](SESSION_RECAP_2026-10-09.md) → "Evening".

**Then:** Wave (now **v0.29.0**), Bundle (**v0.30.0**). Matt is holding the Vault re-seed until Wave is ingestable.

**Next session (from 2026-10-10): Wave, v0.29.0.** Vault v0.7.1 (aimed runs, four colour modes) merged 2026-10-10. Pinned to do alongside Wave: density exponent and bound efficiency as Vault plot axes and range filters (and, later, as Sweep target metrics — both lists, `13-target.js` and Vault's `23-reach.js` `SWEEP_TARGET_KEYS`). Details: Vault `docs/SESSION_RECAP_2026-10-09.md` → "Next session".

## 0b. v0.28.0 — merged 2026-10-09/10 (checks it went through)
1. Vault branch (`?mock` is fine): set a target in the 2D plot → **Aim Sweep** on the banner. Sweep (branch build) opens with the recipe, the density window in Set, the spread and the target; the log says which design and why.
2. Run with your normal settings (GPU, 32³ or 64³, 100–200 designs): rounds of 25 Fast designs walk toward the target, then the final run. Watch: the density window following the trend, Explore when stuck, the trail on the plot, the time per round.
3. Export the final run and drop it into Ingest: it should validate as before (`meta.solver.target` is extra).
4. Try a target past a physics limit (e.g. E* above the volume fraction): a warning, still runs, stops at the limit.


**As of 2026-10-09.** `main` = v0.26.0 (merged after Matt's GPU runs: gyroid sheet, spinodoid, beam BCC, gyroid Explore). v0.26.0 = how designs are varied — density as a sampled axis, Neighbourhood / Explore, one Spread, reference design #0, shear gating (`REFACTOR.md` → v0.26.0). Plan for what follows (Foam → Wave → Bundle, then Ingest / Vault with flags and shear, Vault wipe + re-seed): [`FAMILIES_AND_JITTER_PLAN.md`](FAMILIES_AND_JITTER_PLAN.md).

## 0a. v0.27.0 Foam — merged 2026-10-09 after Matt's GPU runs (open and wet Lloyd foam; Mesh round trip matched)
Foam sweeps (Neighbourhood and Explore) on an open Lloyd foam and a wet foam at ~10–25 %; landing, speed, and Mesh round trip of a design (Neighbourhood keeps positions; Explore designs carry none and Mesh rebuilds them). Ingest v0.9.0 / Vault v0.4.0 (foam, wave, bundle, flags, shear) merged the same day; Supabase policy updated; Matt re-seeding Vault. **Next: Wave (v0.28.0), then Bundle (v0.29.0)** — see [`SESSION_RECAP_2026-10-09.md`](SESSION_RECAP_2026-10-09.md).

## 0. v0.26.0 — checked by Matt 2026-10-09 (merged); next: Foam (v0.27.0)
1. Open the branch over http(s), load a gyroid sheet, a spinodoid and a beam: the Sweep column shows Variation / Spread / Density; a sweep logs the density landing ("designs landed a median … points from their drawn density"); row #0 is marked "ref".
2. Explore on a TPMS recipe should look like v0.25's sweeps; Neighbourhood should keep the surface type.
3. `node tests/harness.js <v0.25.0> <branch>` will differ everywhere (new draws) — check it runs without page errors rather than for identical numbers.

Earlier (2026-10-08, evening): v0.24.0 (GPU solver; branch `v0.24.0-gpu` merged after Matt's GPU checks and speed bench). What happened so far: [`SESSION_RECAP_2026-10-08.md`](SESSION_RECAP_2026-10-08.md). Design decisions and per-version notes: [`REFACTOR.md`](REFACTOR.md). Original findings: [`AUDIT_v0.19.0.md`](AUDIT_v0.19.0.md).

## 1. Merge v0.22.0 + v0.23.0 — done

Done 2026-10-08. Remaining: run the full parity check (§4), then wipe and reseed Vault from fresh Sweep exports; Ingest needs no changes (shape unchanged, a few added fields).

## 2. GPU solver — v0.24.0 on `main` (Phase 3, steps A–D; merged 2026-10-08)

Built 2026-10-08 (session recap [`SESSION_RECAP_2026-10-08_gpu.md`](SESSION_RECAP_2026-10-08_gpu.md), notes in [`REFACTOR.md`](REFACTOR.md)): F13LD.lab's solver files in `solver/lab/` (PolyForm), full 6 × 6 elastic with shear, Lab's GPU thermal, partial volume + island trim as Lab, stretched cells (elastic and thermal), designs in flight on the GPU while CPU workers prepare the next ones.

**Before merging — Matt, on your machine:**
1. ~~`tests/bench.html` → *Run checks* at N = 32~~ — **done 2026-10-08, all PASS on Matt's GPU** (stretched cell within 1.5 % of the supercell elastic, 0.34 % thermal; cubic voxels 62 % / 19 % off).
2. `tests/bench.html` → *Run speed bench* (gyroid sheet, spinodoid, beam BCC; 24 designs; N = 32): GPU vs CPU seconds. Try N = 16 and 64 too.
3. The app on the branch: Solver line shows your GPU; a sweep runs; shear moduli in the detail panel; export loads into F13LD.ingest.

**Still open from the GPU plan:**

| Step | What | Notes |
|---|---|---|
| E | CPU fallback with the same physics (6 × 6, partial volume, stretched) | Today the CPU path is the pre-v0.24 solver (normal stiffness only); exports say which ran (`solver_version`). Lab's CPU reference (`solver/lab/16a`, `12b`) can do it, slowly. |
| tune | Lanes and CG block sizes after your bench numbers | 6 / 4 / 2 lanes at N = 16 / 32 / 64 today. If the GPU idles, the CPU preparation is the limit (PI-TPMS, noise and grain build 64–96³ metric grids per design). |
| Lab | Stretched cells in F13LD.lab | Sweep solves stretched cells as stretched; Lab still solves the cubic voxel grid, so a stretched design sent to Lab reads differently there until Lab takes this up. |
| flags → Vault | Map `stiffness_flag`, `void_limited_axes`, `under_resolved` (and the shear moduli) in F13LD.ingest and add the columns + a filter in F13LD.vault (not hiding flagged designs). Matt: later, not now. |
| grids | Spinodoids at N = 16–32 often flag under-resolved (Lab moves 2.5–4.4× from 32 to 64 on one). Consider N = 32 as the GPU floor for grain / noise. |
| thermal | Pore filler | Kept Sweep's k_void = 0.0003 k_solid. Lab offers air / water / tissue; worth matching. |

## 3. UI — v0.25.0 (layout A) — merged to `main` 2026-10-08

Built 2026-10-08, Configure drawer rebuilt the same day as one Settings panel with SVG icons (notes in `REFACTOR.md`). Merged after Matt's review. Open: should picking General reset the rank metrics; plot hover / depth / ideal-corner nits (audit U10).

## 4. Smaller open items
- **Local thickness pore size** (Matt, 2026-10-11 — noted for later): add the micro-CT standard pore size (local thickness, BoneJ / Hildebrand–Rüegsegger: per void voxel, the largest sphere inside the void that contains it; report the mean and distribution) to the pores pass (`53-pores.js`), so Vault's pore sizes compare directly with published scaffold data. Today's `pore_size` (mean of the top inscribed spheres) is close but not identical; P10 / P50 / P90 are distance-to-wall percentiles, not pore diameters. Vault v0.9.0's biomedical pore window scores the mean pore.

| Item | Notes |
|---|---|
| Full parity run | `--quick` passed (2 designs per family). Run the full set once on your machine before reseeding Vault. |
| ~~TPMS jitter (audit G13)~~ | Done in v0.26.0: Neighbourhood keeps frequencies / terms / phases; Explore keeps the old redraw. |
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
