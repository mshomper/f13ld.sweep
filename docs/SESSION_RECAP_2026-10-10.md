# Session recap — 2026-10-10 · Wave (v0.29.0) and every-family metrics (v0.29.1)

Merged to `main` after Matt's click-test and speed bench, together with F13LD.mesh v0.9.8, F13LD.wave v0.6, F13LD.lab v0.26.1, F13LD.ingest v0.9.1 and F13LD.vault v0.8.0.

## What shipped
- **Wave family (v0.29.0).** `geom/wave.js` = Lab's `WaveKernel` (new `F13LD-GEOM-WAVE` block). Neighbourhood keeps symmetry, the mode list and indices, solid / sheet and phase A / B; varies amplitudes, each mode's phase and the phase time (never across cos = 0) and, for sheets, the iso shift. Explore also nudges indices (0–8) and may flip a mode. Density knob: iso (solid) or thickness (sheet), exact. Fractional indices and fields that cancel are refused at load; single-mode recipes start in Explore.
- **Cell stretch.** Matt's first wave sweep (cubic, 3 modes) put every design at anisotropy 1.000 — Cubic, Chiral and Schoen force Ex = Ey = Ez on a cube. `field.stretch` (relative cell edges, geometric mean 1) now comes from the Cell scale ranges and is solved as a stretched cell; the Wave tool has stretch sliders, Mesh prints it, Lab tags it. A load note / run warning covers the equal-axes case.
- **Noise** takes its X / Y / Z scale from the Cell scale ranges (was Spread). Default 50–150 %.
- **Every family measured (v0.29.1).** Pores, throats, curvature, topology and tortuosity for TPMS solid / shell, beam, foam and wave too (solver-grid voxels, floor 32); PI-TPMS / noise / grain keep their grids; stretched cells measured with their real edges; `metrics_N` in exports. Speed bench (Matt, GPU Fast 32³, 25 designs): TPMS 7.5 → 7.5 s, beam 2.9 → 2.9 s, grain 7.8 → 8.0 s, foam 6.6 → 6.9 s — no tuning needed.

## Matt's decisions
- Fractional mode indices: refused with a note. Phase time changes the surface (off-centre iso, several modes) — varied. Single-mode waves start in Explore; Neighbourhood allowed.
- Scale cells rather than expand modes into many Pure modes (held: less useful). More than six modes would be acceptable.
- Mesh may change for stretch; the Wave tool gets stretch sliders; Lab warns on every stretched cell until it solves them; noise stretch on the Cell scale ranges.
- Metrics for every family as their own version; numbers moving is fine — Vault is being wiped and re-seeded.
- Vault: density exponent and bound efficiency as axes / filters; the Pareto front as a smooth curve (its shape guides what to explore next).

## Checks run
Parity: wave (11 recipes incl. two stretched, 24 swept designs) and noise — Sweep ≡ Lab 0 voxels, Sweep ~ Mesh ≤ 0.5 %; fixtures rewritten, foam fixtures kept. Harness main → v0.29.0: 15 existing cases identical; wave exports pass Ingest's validator. Harness → v0.29.1: grain identical (+ `metrics_N`), the rest moves as intended; genus gyroid 5, Schwarz P 3, BCC 10. Density solve: 375 solves, none off.

## Known limits
- The CPU fallback solves a cube: a stretched wave's anisotropy shows only on the GPU path (GPU plan step E).
- Lab solves stretched cells as cubes (tagged); a Lab stretched-cell solver is still open.
- Chladni near iso 0: whole voxel planes sit on the surface — a tie in the shared rasterizer (voxel VF can read high).

## Next
1. **Wipe and re-seed F13LD.vault** from fresh Sweep exports (all families, Wave included) — Matt.
2. **Bundle, v0.30.0** — plan in `FAMILIES_AND_JITTER_PLAN.md` §2 (cell box, guards, Lab warning).
3. Later: density exponent and bound efficiency as Sweep target metrics (`13-target.js` and Vault's `23-reach.js` `SWEEP_TARGET_KEYS`); CPU fallback with the GPU physics (stretched cells).
