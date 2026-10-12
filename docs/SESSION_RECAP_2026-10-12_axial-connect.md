# Session recap — 2026-10-12 · v0.32.0 straight-reach load gate

## The problem (Matt)
Reseeding Vault, several designs that don't connect along one or more axes scored anisotropy 99: the solver ran on axes with no load path and returned a stiffness near the pore-material floor (small, never zero), so stiff ÷ floor hit the cap.

## Causes found
1. **The connection test counted diagonal reach.** A piece "connected along x" if it met its own periodic copy in any image whose x offset differed. A sheet tilted 45° meets its copy one cell over on x *and* y, so it read connected on both — yet pulled along x, tilted sheets slide past each other. Diagonal fibres read connected on all three axes. The harness case `wave-gyroid-stretched` design 4 (single Schoen mode (1,1,1), stretched) is a real example: one piece whose copies all lie in the (111) plane — stacked layers — which read 1/1/1 and 16.4 GPa on every axis on the CPU path (its 3 × 3 normal block can't let layers slide). Now 0/0/0, invalid.
2. **Gate on the wrong grid.** PI-TPMS / noise / grain were gated on the finer metrics grid; when the coarser solver grid broke an axis the solve still ran there (flagged under-resolved, anisotropy still 99).
3. **Failed solves in the anisotropy.** A connected axis whose GPU solve came back non-finite or negative read E = 0 but stayed in max ÷ min → 99.

## What changed
- `51-transport.js`: `trPeriodicComponents` records each piece's wrap vectors (a reduced basis, ≤ 3) → `axial` / `axialBits`: the axes a piece reaches straight along. `computeSolidPercolation` connect_x/y/z use it; the shear gates keep any reach (tilted sheets do carry in-plane shear); void percolation and thermal are untouched (heat and fluid follow a tilted sheet).
- `54-estimate.js`: the gate is metrics grid AND solver grid. `finishDesign` computes anisotropy over gated axes with E > 0 that are not at the pore-material level. Safety net (Matt: it was in the old solver code; users should know about one or two dead axes): `voidLevelAxes` — pore material carries over half of E — left out of anisotropy and named in the flag reasons ("no real load path on z …").
- Preflight: an axis the coarse grid breaks now reads E = 0 on the solver grid, so `pfJudge`'s broken-load-path check catches it directly.
- `SOLVER_VERSION_GPU` → `sweep-gpu v2`. Export shape unchanged (no new fields).
- F13LD.lab v0.27.0: same `axial` in `periodicComponents` + `loadBearingAxes` (14a); the sweep's spans (14d) are the straight reach, with `reach` kept; a design that only reaches diagonally is solved with a "no straight load path" warning, not skipped (thermal still applies); STL import spanning uses the straight reach; design cards replace the Zener ratio with "carries load on … only" and the Stiffness ⊕ readout drops the anisotropy when not all three axes carry load. `solver/lab/` resynced.

## Numbers that move (CPU harness, 4 cases)
- `tpms-gyroid-sheet`, `beam-bcc`: identical.
- `grain-spinodoid`: two designs whose 16³ solver grid breaks z / x now read 0 there (still flagged under-resolved), anisotropy over the remaining axes; ranking order shifts.
- `wave-gyroid-stretched`: the (111)-layered design reads 0 / invalid.

## Checks for Matt (GPU)
`tests/bench.html` on the branch, then a Fast sweep of a recipe that gave 99s; designs that previously scored 99 should show a dash for anisotropy or a value over the axes that carry load, with the dead axes named in the stiffness flag.
