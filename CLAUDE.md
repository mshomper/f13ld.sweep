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
- Solver files taken from F13LD.lab keep Lab's licence (PolyForm Noncommercial); everything else is MIT.
- Serve over http(s) to test; `file://` does not work (workers).

## Testing
- Before merging, run `node tests/harness.js <old build> <new build>` (see `tests/README.md`). Changes that are not meant to move numbers must come out identical.
- Refactor plan, decisions and phase status: `docs/REFACTOR.md`. v0.19.0 findings: `docs/AUDIT_v0.19.0.md`.
