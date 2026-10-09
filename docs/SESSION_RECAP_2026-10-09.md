# Session recap — 2026-10-09

Plan: [`FAMILIES_AND_JITTER_PLAN.md`](FAMILIES_AND_JITTER_PLAN.md) · per-version notes: [`REFACTOR.md`](REFACTOR.md) (v0.26.0, v0.27.0).

## Shipped (all checked by Matt on his GPU, merged to `main`)
- **Sweep v0.26.0** — density as a sampled axis (`41-density.js`), Neighbourhood / Explore, one Spread, reference design #0, shear gating on per-piece percolation, Auto | Set density window, solved-density VF gate, partial-volume VF on the GPU path.
- **Sweep v0.27.0** — Foam family (`geom/foam.js` = Lab's whole foam kernel, `families/fam-foam.js`), Sobol digital shift, bracketed log-space density refine (wet foam, PI-TPMS).
- **Ingest v0.9.0** — foam / wave / bundle accepted with per-family checks; ref tag and flag dot in the preview.
- **Vault v0.4.0** — new families, Shear metric group (from metrics_extended), Stiffness flag chip row and card dot, ref tag, N = 64 chip, `#r=` Mesh links.
- **Supabase** — insert policy now allows tpms, noise, grain, beam, foam, wave, bundle; backup table `f13ld_designs_backup_20261009`. Matt is wiping and re-seeding (run list: PDF handed over in chat — General domain, rank 1 off, GPU 32³ Rigorous, Neighbourhood 25 %, Auto density, ~200 + 100 designs × 16 recipes).

## Next session
- **Wave in Sweep (v0.28.0)** per plan §2: geometry from Lab's `WaveKernel` (13b-kernels-new.js — needs a shared-block marker or a whole-file copy), keep symmetry and mode integers in Neighbourhood, amplitudes / phases × (1 ± spread), iso or sheet thickness as the density knob (iso scaled by field RMS), Explore nudges mode integers. Wave is cubic in Mesh — no per-axis cell scale.
- Then **Bundle (v0.29.0)**: true repeat Kx·Pxy × Ky·Pxy × Lz (Mesh `43-bundle-cells.js`), Sweep-only sampling wrapper, aspect guard, refuse non-commensurate warps.

## Open, waiting on Matt
- **Lab:** elastic cards should use per-piece percolation (normal modulus needs a piece spanning that axis, shear one piece spanning both; "no load path" instead of the void's number) and the face-match non-periodic check for every recipe family (bundle with a non-cubic repeat gets through today).
- **Ingest:** re-check rows when contributor / domain are filled in after a file drop (today the drop-time values stick).
