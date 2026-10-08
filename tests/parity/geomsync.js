// Shared geometry blocks: F13LD.lab ↔ F13LD.sweep.
//
// The recipe → voxel code is written once, in F13LD.lab, between markers
//   /* ==== F13LD-GEOM-<NAME> v<n> · … ==== */  …  /* ==== /F13LD-GEOM-<NAME> ==== */
// and copied byte-for-byte into F13LD.sweep's geom/ folder. This script checks
// that every block is identical in both repos (exit 1 if not), or, with
// --write, regenerates Sweep's geom/ files from the Lab checkout.
//
//   node tests/parity/geomsync.js [labDir] [sweepDir] [--write]
//
// labDir defaults to ../f13ld.lab next to this repo (env LAB_DIR overrides).
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const WRITE = process.argv.includes('--write');
const SWEEP = path.resolve(args[1] || path.join(__dirname, '..', '..'));
const LAB = path.resolve(args[0] || process.env.LAB_DIR || path.join(SWEEP, '..', 'f13ld.lab'));

// Where each block lives in Lab, and which Sweep geom/ file carries it (in order).
const BLOCKS = [
  { name: 'TPMS-PRESETS', lab: '60-add-design.js',   sweep: 'geom/tpms.js' },
  { name: 'TPMS',         lab: '13-kernels.js',      sweep: 'geom/tpms.js' },
  { name: 'NOISE',        lab: '13-kernels.js',      sweep: 'geom/noise.js' },
  { name: 'GRAIN',        lab: '13-kernels.js',      sweep: 'geom/grain.js' },
  { name: 'BEAM',         lab: '13b-kernels-new.js', sweep: 'geom/beam.js' },
  { name: 'VOXELS',       lab: '14-rasterizer.js',   sweep: 'geom/voxels.js' },
  { name: 'BUILDARGS',    lab: '14-rasterizer.js',   sweep: 'geom/voxels.js' },
  { name: 'RECIPE',       lab: '60-add-design.js',   sweep: 'geom/recipe.js' },
];
const HEADER = {
  'geom/tpms.js':   'TPMS field: raw-preset expansion table, terms evaluation, field-pair PI-TPMS.',
  'geom/noise.js':  'Noise field: the ten F13LD.noise types, seed, stored normalization range.',
  'geom/grain.js':  'Grain field: spinodoid, Gaussian random field, hyperuniform.',
  'geom/beam.js':   'Beam field: periodic capsule lattice (F13LD.beam / F13LD.mesh).',
  'geom/voxels.js': 'Recipe geometry → voxel mask, margin field, raw field; build arguments.',
  'geom/recipe.js': 'External F13LD recipe → lab recipe (family, mode, geometry translation).',
};

function blocks(text) {
  const out = {}, re = /\/\* ==== F13LD-GEOM-([A-Z][A-Z-]*) v(\d+) [^\n]*\n[\s\S]*?\/\* ==== \/F13LD-GEOM-\1 ==== \*\/\n/g;
  let m;
  while ((m = re.exec(text))) {
    if (out[m[1]]) throw new Error('duplicate block ' + m[1]);
    out[m[1]] = m[0];
  }
  return out;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

const labBlocks = {};
for (const b of BLOCKS) {
  const all = blocks(read(LAB, b.lab));
  if (!all[b.name]) { console.error(`F13LD.lab ${b.lab}: block ${b.name} not found`); process.exit(2); }
  labBlocks[b.name] = all[b.name];
}

if (WRITE) {
  const files = {};
  for (const b of BLOCKS) (files[b.sweep] = files[b.sweep] || []).push(b.name);
  for (const [f, names] of Object.entries(files)) {
    const head =
      '/* ============================================================\n' +
      '   F13LD.sweep · ' + f + '\n' +
      '   ' + HEADER[f] + '\n\n' +
      '   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied\n' +
      '   byte-for-byte from F13LD.lab (' + [...new Set(BLOCKS.filter(b => b.sweep === f).map(b => b.lab))].join(', ') + ').\n' +
      '   Never edit them here — change F13LD.lab, then run\n' +
      '     node tests/parity/geomsync.js <F13LD.lab> --write\n' +
      '   ============================================================ */\n\n';
    fs.mkdirSync(path.dirname(path.join(SWEEP, f)), { recursive: true });
    fs.writeFileSync(path.join(SWEEP, f), head + names.map(n => labBlocks[n]).join('\n\n'));
    console.log('wrote ' + f + ' (' + names.join(', ') + ')');
  }
}

let bad = 0;
for (const b of BLOCKS) {
  const p = path.join(SWEEP, b.sweep);
  const sw = fs.existsSync(p) ? blocks(fs.readFileSync(p, 'utf8'))[b.name] : null;
  if (!sw) { bad++; console.log(`MISSING  ${b.name.padEnd(13)} ${b.sweep}`); continue; }
  if (sw !== labBlocks[b.name]) {
    bad++;
    const a = sw.split('\n'), c = labBlocks[b.name].split('\n');
    let i = 0; while (i < a.length && a[i] === c[i]) i++;
    console.log(`DIFFERS  ${b.name.padEnd(13)} ${b.sweep} vs lab ${b.lab} — first difference at block line ${i + 1}`);
  } else console.log(`same     ${b.name.padEnd(13)} ${b.sweep} = lab ${b.lab}`);
}
console.log(bad ? `FAIL: ${bad} block(s) out of sync (lab: ${LAB})` : `OK: ${BLOCKS.length} shared blocks identical (lab: ${LAB})`);
process.exit(bad ? 1 : 0);
