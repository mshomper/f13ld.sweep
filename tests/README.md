# F13LD.sweep — dev tests

Dev-only. Nothing here is loaded by the app.

## Setup

```
npm install playwright-core acorn
npx playwright install chromium     # or point PLAYWRIGHT_BROWSERS_PATH at an existing install
```

## Scripts

| Script | What it checks |
|---|---|
| `harness.js <old> <new> [case,…]` | Runs the same seeded sweep for every case in `recipes.json` in both builds (headless Chromium, one solver worker, `Math.random` seeded, clock frozen) and compares the results array, results table, stats bar, run log, exported results JSON, the F13LD.mesh handoff recipe and preview errors. `tool_version` is ignored. Exit 0 = identical. Writes `harness-last.json` (`HARNESS_OUT` sets the folder). |
| `loadorder.js [build]` | Static check: no load-time code uses something from a later-numbered file; worker files don't touch the DOM at load; worker only loads files the page loads. |

Each build is a plain folder: e.g. `git worktree add ../sweep-old v0.19.0` for the old one. The v0.19.0 single file works as the old build too.

`recipes.json` cases come from `f13ld.mesh/tests/recipes.json`; `samples` is the valid-design count per case. A full run takes about 10 minutes on two cores.
