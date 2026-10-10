# Session recap — 2026-10-10 (evening): Push to Vault (v0.29.2)

Part of the direct-push work across the suite — full recap in F13LD.ingest `docs/SESSION_RECAP_2026-10-10.md`, plan in `docs/F13LD_VAULT_PUSH_PLAN.md` there.

## What shipped (merged to `main` after Matt's click-test)

- **Push to Vault** pill in the header (primary spot; Export results became a ghost pill). Off before a run and during auto-target rounds, on after a final run — same rules as Export results.
- `exportResults()` split into `buildResultsPayload(action)` (the export object, or `null` with the same log lines) and the download. The exported file is unchanged — harness SAME on tpms-gyroid-sheet, beam-bcc, foam-open-lloyd, wave-schwarzp-solid.
- `pushResultsToVault()` sends `JSON.parse(JSON.stringify(payload))` (the file round trip, so hashes and rows equal an exported file) to F13LD.ingest's `f13ld-vault-push.js`, loaded on demand from `VAULT_PUSH_JS` (`00-config.js`; `?push=<url>` for raw.githack / GitHub Pages / localhost copies), and opens its push window: counts, failure reasons, already-in-Vault list, contributor (remembered), domain (from the run), CC0 tick (once per browser session). Rows are `provenance_kind = 'sweep'`. If the push file can't load, the log points to Export results + Ingest.
- `vault` glyph in `SWEEP_GLYPHS` (23-dock.js).

## Checks

- `tests/vault-push.js <f13ld.ingest>` (new): seeded sweep → Push to Vault → push window → the POSTed rows equal the rows Ingest builds from the run's exported file; design #1 "already in Vault" in the mock is skipped; rows marked `sweep`; header fits at 390 / 900 / 1280 px with no horizontal scroll. Passed on TPMS, foam, wave and beam. The clock is frozen as in the harness because `exported_at` is the time the payload is built.
- `node tests/loadorder.js .` OK.

## Found along the way

- The push window first sat in the top-left corner inside Sweep: its classes used `f13v-`, and `.f13v` is the shared F13LD-VIEW block in `01-f13-shade.js`. Fixed in the push file (prefix `f13vp-`, Ingest v0.10.1). Any shared UI injected into the design tools needs a prefix that isn't `f13v`.
- The beam test recipe has no `topology` block, so Sweep's reference design #0 exports without one and Ingest rejects it; jittered designs carry it. Not changed — decide whether Sweep fills `topology` on the reference design.

## Next

1. Matt wipes and re-seeds F13LD.vault through Push to Vault (reseed workbook from the session).
2. Bundle family (v0.30.0) — plan in `FAMILIES_AND_JITTER_PLAN.md` §2.
3. The beam reference-design topology question.
4. F13LD.lab will load Sweep's per-design pipeline (`estimateHomogenization`, 54-estimate.js) from Sweep's site to compute Sweep's metrics for designs it pushes that aren't in Vault (Phase 4) — keep `estimateHomogenization(recipe, opts)` callable on its own and its output shape stable.
