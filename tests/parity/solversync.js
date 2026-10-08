// Solver files: F13LD.lab → F13LD.sweep solver/lab/.
//
// Sweep runs F13LD.lab's GPU solver files unchanged (solver/gpu-worker.js
// loads them; PolyForm Noncommercial, solver/LICENSE.md). This script checks
// every file in solver/lab/ is byte-identical to the Lab checkout (exit 1 if
// not), or, with --write, copies them from Lab again. Sweep's own additions
// live in solver/sweep-gpu-kernels.js and solver/gpu-worker.js, never in
// solver/lab/.
//
//   node tests/parity/solversync.js [labDir] [sweepDir] [--write]
//
// labDir defaults to ../f13ld.lab next to this repo (env LAB_DIR overrides).
// After --write, run tests/bench.html on a GPU before merging.
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const WRITE = process.argv.includes('--write');
const SWEEP = path.resolve(args[1] || path.join(__dirname, '..', '..'));
const LAB = path.resolve(args[0] || process.env.LAB_DIR || path.join(SWEEP, '..', 'f13ld.lab'));
const DIR = path.join(SWEEP, 'solver', 'lab');

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
let bad = 0;
for (const f of files) {
  const labFile = path.join(LAB, f);
  if (!fs.existsSync(labFile)) { console.log(`MISSING in Lab: ${f}`); bad++; continue; }
  const a = fs.readFileSync(labFile), b = fs.readFileSync(path.join(DIR, f));
  if (a.equals(b)) { console.log(`same   ${f}`); continue; }
  if (WRITE) { fs.writeFileSync(path.join(DIR, f), a); console.log(`copied ${f}`); }
  else { console.log(`DIFF   ${f}`); bad++; }
}
for (const f of ['LICENSE.md', 'NOTICE']) {
  const a = path.join(LAB, f), b = path.join(SWEEP, 'solver', f);
  if (fs.existsSync(a) && fs.existsSync(b) && !fs.readFileSync(a).equals(fs.readFileSync(b))) {
    if (WRITE) { fs.copyFileSync(a, b); console.log(`copied solver/${f}`); }
    else { console.log(`DIFF   solver/${f}`); bad++; }
  }
}
console.log(bad ? `FAIL: ${bad} file(s) differ from ${LAB}` : `PASS: ${files.length} solver files identical to ${LAB}`);
process.exitCode = bad ? 1 : 0;
