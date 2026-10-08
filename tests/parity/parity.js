#!/usr/bin/env node
// Cross-tool geometry parity: one recipe → the same voxels in F13LD.sweep, F13LD.lab and F13LD.mesh.
//
//   node tests/parity/parity.js [--N 32] [--family tpms,noise,grain,beam] [--quick] [--json out.json]
//                               [--designs 6] [--jobs <cores>] [--write-fixtures]
//
// Step 0  geomsync: Sweep's geom/ blocks are byte-identical to F13LD.lab's.
// A       design-tool recipes (built by each tool's own export code): Sweep vs Lab, Sweep vs Mesh,
//         and the tool's own voxelizer vs Mesh where the tool has one.
// B       Sweep designs: SWEEP_FAMILIES[f].jitter(completeRecipe(base), draw, ctx) with seeded
//         randomness; each design recipe vs Lab and vs Mesh.
// Pass:   Sweep vs Lab exactly 0 differing voxels wherever comparable; Sweep vs Mesh ≤ 0.5 %.
//
// Repos default to siblings of this Sweep checkout (../f13ld.lab, ../f13ld.mesh, ../f13ld.tpms,
// ../f13ld.noise, ../f13ld.grain, ../f13ld.beam); override with LAB_DIR, MESH_DIR, TPMS_DIR,
// NOISE_DIR, GRAIN_DIR, BEAM_DIR. Node built-ins only. Exit 1 on any failure.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const N = +opt('--N', 32);
const QUICK = argv.includes('--quick');
const WRITE_FIX = argv.includes('--write-fixtures');
const ALL_FAMILIES = ['tpms', 'noise', 'grain', 'beam'];
const FAMILIES = opt('--family', ALL_FAMILIES.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const JSON_OUT = opt('--json', null);
const N_DESIGNS = +opt('--designs', QUICK ? 2 : 6);
const JOBS = Math.max(1, +opt('--jobs', Math.min(os.cpus().length, 8)));
const SM_TOL = 0.005;                       // Sweep vs Mesh tolerance (fraction of voxels)
const t0 = Date.now();

const { DIRS } = require('./lib/env');
for (const f of FAMILIES) if (!ALL_FAMILIES.includes(f)) { console.error('unknown family ' + f); process.exit(2); }

console.log(`F13LD cross-tool geometry parity — N=${N}³ voxel centres, one periodic cell${QUICK ? ' (quick)' : ''}, ${JOBS} job(s)`);
for (const [k, d] of Object.entries(DIRS)) console.log(`  ${k.padEnd(6)} ${d}${fs.existsSync(d) ? '' : '   (MISSING)'}`);
const missing = Object.entries(DIRS).filter(([, d]) => !fs.existsSync(d));
if (missing.length) { console.error('\nFAIL: missing checkout(s): ' + missing.map(([k]) => k).join(', ')); process.exit(2); }

/* ── Step 0: geomsync ── */
console.log('\n── Step 0: shared F13LD-GEOM blocks (tests/parity/geomsync.js)');
const gs = spawnSync(process.execPath, [path.join(__dirname, 'geomsync.js'), DIRS.lab, DIRS.sweep], { encoding: 'utf8' });
process.stdout.write((gs.stdout || '').replace(/^(?=.)/gm, '  ') + (gs.stderr || ''));
const geomsyncOK = gs.status === 0;

/* ── jobs ── */
const { CASES, SECTION_B } = require('./lib/recipes');
const fullA = WRITE_FIX || (!QUICK && FAMILIES.length === ALL_FAMILIES.length);
const jobs = [];
for (const c of CASES) if (WRITE_FIX || (FAMILIES.includes(c.family) && (!QUICK || c.quick))) jobs.push({ kind: 'A', name: c.name, family: c.family });
for (const fam of FAMILIES) for (const base of (QUICK ? SECTION_B[fam].slice(0, 1) : SECTION_B[fam]))
  for (let i = 0; i < N_DESIGNS; i++) jobs.push({ kind: 'B', family: fam, base, i });
jobs.forEach((j, idx) => { j.idx = idx; });

function runAll() {
  const rows = new Array(jobs.length);
  if (JOBS === 1) {
    const { runJob } = require('./lib/runner');
    jobs.forEach(j => { rows[j.idx] = runJob(j, N, SM_TOL); process.stderr.write('.'); });
    process.stderr.write('\n');
    return Promise.resolve(rows);
  }
  /* slow families first, so the pool drains evenly */
  const cost = j => (j.family === 'noise' ? 3 : j.family === 'tpms' ? 1 : 2) * (j.kind === 'B' ? 1.5 : 1);
  const queue = jobs.slice().sort((a, b) => cost(b) - cost(a));
  let done = 0;
  return new Promise((resolve, reject) => {
    const pool = [];
    const n = Math.min(JOBS, queue.length);
    if (!n) return resolve(rows);
    for (let w = 0; w < n; w++) {
      const wk = new Worker(path.join(__dirname, 'lib', 'worker.js'), { workerData: { N, tol: SM_TOL, env: {
        LAB_DIR: DIRS.lab, MESH_DIR: DIRS.mesh, TPMS_DIR: DIRS.tpms, NOISE_DIR: DIRS.noise, GRAIN_DIR: DIRS.grain, BEAM_DIR: DIRS.beam } } });
      pool.push(wk);
      const next = () => { const j = queue.shift(); if (j) wk.postMessage(j); else wk.terminate(); };
      wk.on('message', ({ idx, row }) => {
        rows[idx] = row; done++;
        process.stderr.write(done % 10 ? '.' : String(done));
        if (done === jobs.length) { process.stderr.write('\n'); pool.forEach(p => p.terminate()); resolve(rows); }
        else next();
      });
      wk.on('error', reject);
      next();
    }
  });
}

const pct = x => x == null ? '—' : (100 * x).toFixed(2);
function judge(r) {
  const why = [];
  if (r.error) why.push('exception: ' + r.error);
  if (r.labError) why.push('Lab error: ' + r.labError);
  if (r.sl > 0) why.push(`Sweep~Lab ${r.sl} voxel(s)`);
  if (r.sm > SM_TOL) why.push(`Sweep~Mesh ${pct(r.sm)} %`);
  r.pass = why.length === 0; r.why = why.join('; ');
}
function table(title, rows) {
  console.log('\n' + title);
  const W = [40, 7, 7, 7, 7, 8, 7, 7, 5, 0];
  const line = c => c.map((s, i) => String(s).padEnd(W[i])).join(' ');
  console.log(line(['recipe', 'VF swp', 'VF lab', 'VF mesh', 'VF tool', 'S~L vox', 'S~M %', 'T~M %', '', 'note']));
  for (const r of rows) {
    const note = [r.error ? 'ERROR ' + r.error.slice(0, 100) : '', r.labError ? 'lab: ' + r.labError.slice(0, 60) : '',
      r.labMode ? `lab mode ${r.labMode} vs sweep ${r.mode}` : '', r.meshNote || '', r.tm > SM_TOL ? 'tool~mesh > 0.5 %' : '',
      typeof r.lab === 'string' ? r.lab : '', r.scaleNote || ''].filter(Boolean).join('; ');
    console.log(line([r.name.slice(0, 40), pct(r.vfSweep), pct(r.vfLab), pct(r.vfMesh), pct(r.vfTool),
      typeof r.lab === 'string' ? 'n/a' : (r.sl == null ? '—' : r.sl), pct(r.sm), pct(r.tm), r.pass ? 'ok' : 'FAIL', note]));
  }
}

runAll().then(rows => {
  rows.forEach(judge);
  const rowsA = rows.filter(r => r.section === 'A' && (FAMILIES.includes(r.family) && (!QUICK || CASES.find(c => c.name === r.name).quick)));
  const rowsB = rows.filter(r => r.section === 'B');
  const failures = [];
  if (!geomsyncOK) failures.push({ section: '0', name: 'geomsync', why: 'shared geometry blocks out of sync' });
  for (const r of rowsA.concat(rowsB)) if (!r.pass) failures.push({ section: r.section, name: r.name, why: r.why, slFirst: r.slFirst, smFirst: r.smFirst });

  /* fixtures.json: every section-A recipe exactly as its tool exported it */
  const fixPath = path.join(__dirname, 'fixtures.json');
  if (fullA) {
    const fixtures = {}; for (const r of rows.filter(r => r.section === 'A')) fixtures[r.name] = r.json;
    const text = JSON.stringify(fixtures, null, 1) + '\n';
    if (WRITE_FIX) { fs.writeFileSync(fixPath, text); console.log(`\nwrote tests/parity/fixtures.json (${Object.keys(fixtures).length} recipes)`); }
    else if (!fs.existsSync(fixPath)) console.log('\nnote: tests/parity/fixtures.json not found — run with --write-fixtures');
    else if (fs.readFileSync(fixPath, 'utf8') !== text) {
      const old = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
      const ch = Object.keys(fixtures).filter(k => JSON.stringify(old[k]) !== JSON.stringify(fixtures[k]));
      console.log(`\nnote: fixtures.json differs from what the tools export now (${ch.length} recipe(s)${ch.length ? ': ' + ch.slice(0, 4).join(', ') + (ch.length > 4 ? ' …' : '') : ''}) — rerun with --write-fixtures if intended`);
    }
  }

  table(`── Section A: design-tool recipes (${rowsA.length}) — Sweep = designGeometry(completeRecipe(json)); Lab, Mesh and the tool get the export as is`, rowsA);
  table(`── Section B: Sweep designs (${rowsB.length}) — jitter(completeRecipe(base)); Sweep, Lab and Mesh all get the design recipe`, rowsB);

  console.log('\n── Summary (max over rows; S~L in voxels, S~M / T~M in % of voxels)');
  console.log('family  sec  rows  max S~L  max S~M %  max T~M %  Lab n/a');
  const summary = [];
  for (const fam of FAMILIES) for (const [sec, rs0] of [['A', rowsA], ['B', rowsB]]) {
    const rs = rs0.filter(r => r.family === fam); if (!rs.length) continue;
    const mx = k => rs.reduce((m, r) => r[k] != null && r[k] > m ? r[k] : m, 0);
    const s = { family: fam, section: sec, rows: rs.length, maxSL: mx('sl'), maxSM: mx('sm'),
      maxTM: rs.some(r => r.tm != null) ? mx('tm') : null, labNA: rs.filter(r => typeof r.lab === 'string').length };
    summary.push(s);
    console.log(`${fam.padEnd(7)} ${sec.padEnd(4)} ${String(s.rows).padEnd(5)} ${String(s.maxSL).padEnd(8)} ${pct(s.maxSM).padEnd(10)} ${pct(s.maxTM).padEnd(10)} ${s.labNA}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (failures.length) {
    console.log(`\nFAIL — ${failures.length} failure(s):`);
    for (const f of failures) console.log(`  [${f.section}] ${f.name}: ${f.why}` +
      (f.slFirst ? `  first S~L voxel ${JSON.stringify(f.slFirst)}` : '') + (f.smFirst ? `  first S~M voxel ${JSON.stringify(f.smFirst)}` : ''));
  } else console.log(`\nPASS — geomsync ok; ${rowsA.length} recipes + ${rowsB.length} designs: Sweep ≡ Lab (0 voxels) wherever comparable, Sweep ~ Mesh ≤ ${100 * SM_TOL} %`);
  console.log(`runtime ${secs} s`);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ N, quick: QUICK, families: FAMILIES, geomsync: { ok: geomsyncOK, output: gs.stdout },
    sectionA: rowsA, sectionB: rowsB, summary, failures, runtimeSec: +secs }, null, 1));
  process.exit(failures.length ? 1 : 0);
}).catch(e => { console.error('parity: ' + (e && e.stack || e)); process.exit(2); });
