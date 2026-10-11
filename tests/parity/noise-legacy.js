#!/usr/bin/env node
// Noise revision check (v0.30.0): recipes exported before F13LD.noise v0.12.0 carry no
// surface.noise_rev and must keep building exactly the voxels they always built, in Sweep,
// Lab and Mesh. Fixed-noise recipes (noise_rev 2) must agree across the same three tools.
//
//   node tests/parity/noise-legacy.js --record     # write tests/parity/noise-legacy.json (old build)
//   node tests/parity/noise-legacy.js              # compare the current build against it
//
// The legacy recipes are the noise entries of tests/parity/fixtures.json as they were exported
// by F13LD.noise v0.11.0 (copied into noise-legacy.json on --record, so later fixture refreshes
// cannot move the baseline). Node built-ins only. Exit 1 on any difference.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const N = 32;
const BASE = path.join(__dirname, 'noise-legacy.json');
const RECORD = process.argv.includes('--record');
const sweep = require('./lib/sweep'), lab = require('./lib/lab'), mesh = require('./lib/mesh');
const { vf, diff } = require('./lib/env');

const h = m => crypto.createHash('sha1').update(Buffer.from(m.buffer || m)).digest('hex').slice(0, 12);
function build(json) {
  const s = sweep.voxels(sweep.complete(json), N), l = lab.voxels(json, N), m = mesh.voxels('noise', json, N);
  return { s, l, m };
}

let recipes;
if (RECORD) {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf8'));
  recipes = {};
  for (const [k, v] of Object.entries(fx)) if (v && v.surface && v.surface.type === 'noise') recipes[k] = v;
} else {
  recipes = JSON.parse(fs.readFileSync(BASE, 'utf8')).recipes;
}

const out = {}; let bad = 0;
console.log(`noise legacy check — ${Object.keys(recipes).length} pre-v0.12 recipes, N=${N}³`);
for (const [name, json] of Object.entries(recipes)) {
  if (json.surface.noise_rev != null) { console.log('  skip  ' + name + ' (carries noise_rev)'); continue; }
  const { s, l, m } = build(json);
  if (l.error) { console.log('  FAIL  ' + name + ' lab: ' + l.error); bad++; continue; }
  const row = { sweep: h(s.mask), lab: h(l.mask), mesh: h(m.mask), vf: +(100 * vf(s.mask)).toFixed(2) };
  out[name] = row;
  if (!RECORD) {
    const was = JSON.parse(fs.readFileSync(BASE, 'utf8')).hashes[name];
    const same = was && was.sweep === row.sweep && was.lab === row.lab && was.mesh === row.mesh;
    if (!same) bad++;
    console.log(`  ${same ? 'same' : 'DIFF'}  ${name.padEnd(30)} VF ${row.vf}%`);
  }
}
if (RECORD) {
  fs.writeFileSync(BASE, JSON.stringify({ note: 'F13LD.noise v0.11.0 exports (no noise_rev) and their voxel hashes in Sweep / Lab / Mesh at N=32, recorded before the noise revision change.', recipes, hashes: out }, null, 1) + '\n');
  console.log('recorded ' + Object.keys(out).length + ' recipes → ' + path.relative(process.cwd(), BASE));
  process.exit(0);
}

/* Fixed noise: the same recipes stamped noise_rev 2, with the normalization range recomputed the way
   an export writes it (Sweep's stampNoiseRange = the tool's 32³ prepass), must agree Sweep ≡ Lab
   exactly and Sweep ~ Mesh ≤ 0.5 %. */
console.log('\nnoise rev 2 — the same settings on fixed noise');
for (const [name, json0] of Object.entries(recipes)) {
  const json = JSON.parse(JSON.stringify(json0));
  json.surface.noise_rev = 2; delete json.surface.norm_for;
  json.surface = JSON.parse(JSON.stringify(sweep.ctx.stampNoiseRange(json.surface)));
  const { s, l, m } = build(json);
  if (l.error) { console.log('  FAIL  ' + name + ' lab: ' + l.error); bad++; continue; }
  const sl = diff(s.mask, l.mask), sm = diff(s.mask, m.mask) / s.mask.length;
  const ok = sl === 0 && sm <= 0.005; if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} VF ${(100 * vf(s.mask)).toFixed(2).padStart(6)}%  (was ${String(out[name] && out[name].vf).padStart(6)}%)  S~L ${sl}  S~M ${(100 * sm).toFixed(2)}%`);
}
console.log(bad ? `\nFAIL — ${bad} problem(s)` : '\nPASS — legacy recipes unchanged; fixed noise agrees across Sweep, Lab and Mesh');
process.exit(bad ? 1 : 0);
