// Section A recipes: built with each design tool's own export code (lib/tools.js).
// Each case: { name, family, quick?, ui (tool inputs), extra? (keys the tool cannot write,
// added after export — F13LD.sweep / F13LD.mesh schema; marked [x]) }.
// CASES lists them; build(name) runs the tool's export (lazily — the noise export runs its
// 32³ normalization prepass, so a worker only builds what it needs).
'use strict';
const tools = require('./tools');

/* ── F13LD.tpms ── state for tools.tpms (preset | termsA, mode, offset, cell, wall, norm, pipe, shift, k, b) */
const T = (on, coef, ...f) => ({ on, coef, factors: f.map(([trig, fx = 1, fy = 1, fz = 1]) => ({ trig, fx, fy, fz })) });
const CUSTOM = [T(true, 1.5, ['sin(x)', 2, 1, 1], ['cos(y)']), T(true, -0.7, ['cos(z)', 1, 1, 3]), T(false, 2, ['cos(x)']), T(true, 1, ['sin(y)'], ['sin(z)'])];
const TPMS = [
  ['gyroid solid off0',                { preset: 'gyroid', mode: 'solid' }, null, true],
  ['gyroid solid off0.4 cs1.5',        { preset: 'gyroid', mode: 'solid', offset: 0.4, cell: 1.5 }],
  ['P shell norm wt0.3',               { preset: 'schwarzP', mode: 'shell', wall: 0.3, norm: true }],
  ['D shell raw wt0.25 off0.2',        { preset: 'schwarzD', mode: 'shell', wall: 0.25, offset: 0.2, norm: false }],
  ['neovius solid off0.3',             { preset: 'neovius', mode: 'solid', offset: 0.3 }],
  ['IWP shell norm off0.5',            { preset: 'iwp', mode: 'shell', wall: 0.35, offset: 0.5, norm: true }],
  ['custom terms solid (fx2,off-term)',{ termsA: CUSTOM, mode: 'solid', offset: -0.2 }],
  ['splitP raw solid off0.1 cs1.5',    { preset: 'splitP', mode: 'solid', offset: 0.1, cell: 1.5 }, null, true],
  ['F-RD raw shell norm',              { preset: 'frd', mode: 'shell', wall: 0.3, norm: true }],
  ['FKS raw solid',                    { preset: 'fks', mode: 'solid' }],
  ['gyroidHarmonic raw solid off-0.2', { preset: 'gyroidHarmonic', mode: 'solid', offset: -0.2 }],
  ['primitiveC raw solid off0.5',      { preset: 'primitiveC', mode: 'solid', offset: 0.5 }],
  ['octo raw solid',                   { preset: 'octo', mode: 'solid' }],
  ['pHarmonic raw shell raw wt0.4',    { preset: 'pHarmonic', mode: 'shell', wall: 0.4, norm: false }],
  ['lidinoid raw shell norm',          { preset: 'lidinoid', mode: 'shell', wall: 0.3, norm: true }],
  ['gyroid PI norm r.18',              { preset: 'gyroid', mode: 'pi-tpms', pipe: 0.18, norm: true }],
  ['gyroid PI raw r.3 (1/4,1/4,0)',    { preset: 'gyroid', mode: 'pi-tpms', pipe: 0.3, norm: false, shift: { x: 0.25, y: 0.25, z: 0 } }],
  ['gyroid PI self k=2 norm',          { preset: 'gyroid', mode: 'pi-tpms', pipe: 0.18, norm: true, k: 2 }],
  ['P x octo PI k=2 norm r.4',         { preset: 'schwarzP', mode: 'pi-tpms', pipe: 0.4, norm: true, k: 2, shift: { x: 0.5, y: 0, z: 0 }, b: 'octo' }, null, true],
  ['gyroid x D PI k=1 raw r.35',       { preset: 'gyroid', mode: 'pi-tpms', pipe: 0.35, norm: false, shift: { x: 0, y: 0.25, z: 0 }, b: 'schwarzD' }],
  ['splitP raw PI norm r.2',           { preset: 'splitP', mode: 'pi-tpms', pipe: 0.2, norm: true }],
  ['splitP x F-RD PI norm r.25',       { preset: 'splitP', mode: 'pi-tpms', pipe: 0.25, norm: true, shift: { x: 0.125, y: 0.25, z: 0 }, b: 'frd' }],
  ['[x] P shell norm + normal_weights',{ preset: 'schwarzP', mode: 'shell', wall: 0.25, norm: true }, { normal_weights: { wx: 1.4, wy: 0.8, wz: 0.8 } }],
  ['[x] gyroid solid cell_scale_xyz',  { preset: 'gyroid', mode: 'solid', offset: 0.3 }, { cell_scale_x: 1, cell_scale_y: 1.5, cell_scale_z: 0.75 }],
  ['[x] D shell nw + cell_scale_xyz',  { preset: 'schwarzD', mode: 'shell', wall: 0.3, norm: true }, { normal_weights: { wx: 0.7, wy: 1.1, wz: 1.2 }, cell_scale_x: 1.25, cell_scale_y: 0.8, cell_scale_z: 1 }],
];

/* ── F13LD.noise ── UI inputs (ids of the tool's controls) */
const NOISE = [
  ['simplex sheet s0',          { noiseType: 'simplex', topoMode: 'sheet', frequency: 0.3, thickness: 0.15 }, true],
  ['simplex solid s42 scaleY2', { noiseType: 'simplex', topoMode: 'solid', isoLevel: 0.1, thickness: 0.25, seed: 42, scaleY: 2.0 }],
  ['fbm half aniso',            { noiseType: 'fbm', topoMode: 'half', isoLevel: 0.1, scaleX: 1.5, scaleZ: 0.7, octaves: 5 }],
  ['fbm sheet s7 lac2.5',       { noiseType: 'fbm', topoMode: 'sheet', seed: 7, lacunarity: 2.5, gain: 0.6, octaves: 3 }],
  ['ridged half-inv s11',       { noiseType: 'ridged', topoMode: 'half', halfInvert: true, isoLevel: 0.35, frequency: 0.25, seed: 11 }],
  ['billow solid',              { noiseType: 'billow', topoMode: 'solid', isoLevel: -0.2, thickness: 0.3 }],
  ['warp sheet',                { noiseType: 'warp', topoMode: 'sheet', warpStrength: 1.5, thickness: 0.12 }],
  ['warp0 sheet',               { noiseType: 'warp', topoMode: 'sheet', warpStrength: 0, thickness: 0.12 }],
  ['warp half-inv s4',          { noiseType: 'warp', topoMode: 'half', halfInvert: true, warpStrength: 2.5, seed: 4, isoLevel: 0.05 }],
  ['cellular sheet euc j.6',    { noiseType: 'cellular', topoMode: 'sheet', isoLevel: -0.6, thickness: 0.2, frequency: 0.4 }],
  ['cellular half man j1 s5',   { noiseType: 'cellular', topoMode: 'half', distanceMetric: 'manhattan', jitter: 1.0, seed: 5, frequency: 0.4 }],
  ['cellular solid cheb j0',    { noiseType: 'cellular', topoMode: 'solid', distanceMetric: 'chebyshev', jitter: 0.0, isoLevel: -0.4, thickness: 0.2, frequency: 0.5 }],
  ['curl sheet',                { noiseType: 'curl', topoMode: 'sheet', curlStep: 0.15, potentialScale: 1.3, isoLevel: -0.2 }],
  ['foam half',                 { noiseType: 'foam', topoMode: 'half', isoLevel: 0.0, frequency: 0.4 }, true],
  ['foam sheet man j.3 s8',     { noiseType: 'foam', topoMode: 'sheet', distanceMetric: 'manhattan', jitter: 0.3, seed: 8, frequency: 0.45 }],
  ['strut half-inv',            { noiseType: 'strut', topoMode: 'half', halfInvert: true, isoLevel: -0.5, frequency: 0.4 }],
  ['strut solid cheb j.9 s2',   { noiseType: 'strut', topoMode: 'solid', distanceMetric: 'chebyshev', jitter: 0.9, seed: 2, isoLevel: -0.5, thickness: 0.3, frequency: 0.35 }],
  ['veined sheet s2',           { noiseType: 'veined', topoMode: 'sheet', veinTurb: 3, veinFreq: 3, seed: 2 }],
  ['veined half-inv s13 aniso', { noiseType: 'veined', topoMode: 'half', halfInvert: true, veinTurb: 5, veinFreq: 4.5, seed: 13, scaleX: 0.5, octaves: 2 }],
];

/* ── F13LD.grain ── UI inputs (slider units: huBlend / huEll are slider positions) */
const GRAIN = [
  ['spin single sheet',     { rngSeed: 42, kappa: 8, thickness: 0.18 }],
  ['spin tilt half',        { rngSeed: 17, kappa: 6, nWaves: 64, dirTheta: 60, dirPhi: 30, topoMode: 'half', isoLevel: 0.1 }, true],
  ['spin ortho solid',      { rngSeed: 5, kappa: 10, dirMode: 'ortho', wX: 0.6, wY: 0.3, wZ: 0.1, topoMode: 'solid', thickness: 0.25 }],
  ['spin iso sheet',        { rngSeed: 999, kappa: 0, dirMode: 'iso', frequency: 0.3, nWaves: 32 }],
  ['GRF tilt sheet',        { fieldType: 'gaussian', rngSeed: 3, dirTheta: 45, dirPhi: 120, grfSigma: 0.3, thickness: 0.2 }],
  ['GRF ortho half-inv',    { fieldType: 'gaussian', rngSeed: 77, dirMode: 'ortho', wX: 0.2, wY: 0.2, wZ: 0.6, topoMode: 'half', halfInvert: true, isoLevel: -0.05 }],
  ['GRF iso solid',         { fieldType: 'gaussian', rngSeed: 250, dirMode: 'iso', kappa: 0, topoMode: 'solid', thickness: 0.3, frequency: 0.6 }],
  ['HU single half',        { fieldType: 'hyperuniform', rngSeed: 7, kappa: 4, huN: 100, huAspect: 3, huWidth: 0.08, topoMode: 'half', isoLevel: -0.12 }, true],
  ['HU ortho shaped sheet', { fieldType: 'hyperuniform', rngSeed: 11, kappa: 8, dirMode: 'ortho', wX: 0.5, wY: 0.25, wZ: 0.25, huN: 60, huAspect: 5, huWidth: 0.07, huCross: 3.5, huSharp: 2, huBlend: 0.5, huEll: 0.5, isoLevel: 0.05, thickness: 0.12 }],
  ['HU iso solid',          { fieldType: 'hyperuniform', rngSeed: 123, dirMode: 'iso', kappa: 0, huN: 200, huAspect: 6, huWidth: 0.05, topoMode: 'solid', isoLevel: 0.0, thickness: 0.15 }],
];

/* ── F13LD.beam ── preset exports (topology, cell-local radius, cell mm), Builder exports, and [x] per-axis schema */
const BEAM = [
  ['octet r.10 c1.5 (default)',   { topo: 'octet', r: 0.10, cell: 1.5 }, null, true],
  ['octet r.30 c1.5 (thick)',     { topo: 'octet', r: 0.30, cell: 1.5 }],
  ['bcc r.25 c2.0',               { topo: 'bcc', r: 0.25, cell: 2.0 }],
  ['kelvin r.05 c3.0 (thin)',     { topo: 'kelvin', r: 0.05, cell: 3.0 }],
  ['truncated_cube r.15 c0.8',    { topo: 'truncated_cube', r: 0.15, cell: 0.8 }],
  ['fcc_z r.20 c1.0',             { topo: 'fcc_z', r: 0.20, cell: 1.0 }],
  ['tesseract r.08 c2.5',         { topo: 'tesseract', r: 0.08, cell: 2.5 }],
  ['builder diamond r.12',        { builder: 'diamond-ish', from: 'diamond', r: 0.12 }],
  ['builder asym corner strut',   { builder: 'asym', beams: [[1, 1, 1, 0.3, 0.3, 0.3], [0.3, 0.3, 0.3, -1, 0.3, 0.3], [0.3, 0.3, 0.3, 0.3, -1, 0.3], [0.3, 0.3, 0.3, 0.3, 0.3, -1]], r: 0.15 }],
  ['[x] octet per-axis 1.5 k+ball', { topo: 'octet', r: 0.15, cell: 1.5 },
    { scale_xyz: [1.5, 1.5, 1.5], cell: 1.5, radius_x: 0.1, radius_y: 0.12, radius_z: 0.09, node_smoothing_k: 0.08, node_ball_radius: 0.15 }, true],
  ['[x] bcc per-axis 2.0 smooth only', { topo: 'bcc', r: 0.2, cell: 2.0 },
    { scale_xyz: [2, 2, 2], cell: 2, radius_x: 0.2, radius_y: 0.2, radius_z: 0.2, node_smoothing_k: 0.12, node_ball_radius: 0 }],
  ['[x] kelvin per-axis stretched', { topo: 'kelvin', r: 0.1, cell: 1.5 },
    { scale_xyz: [1.2, 1.5, 2.0], cell: 1.5326, radius_x: 0.08, radius_y: 0.08, radius_z: 0.1, node_smoothing_k: 0.03, node_ball_radius: 0.1 }],
];

/* ── F13LD.wave (v0.29.0) — the tool's presets, a few edited the way a user would */
const W = (n, m, p, A = 1, phi = 0) => ({ n, m, p, A, phi });
const WAVE = [
  ['schwarzP pure solid',            { sym: 0, modes: [W(1,0,0), W(0,1,0), W(0,0,1)] }, true],
  ['gyroid schoen sheet iso.3 t.25', { sym: 4, modes: [W(1,1,0)], sheet: true, iso: 0.3, thickness: 0.25 }, true],
  ['chiral321 solid iso.4 B',        { sym: 3, modes: [W(3,2,1)], iso: 0.4, signFlip: true }],
  /* iso 0 on Chladni puts whole voxel planes exactly on the surface (field = 0 on x = y …), where
     Lab's "solid ⟺ field ≥ iso" and Mesh's "SDF < 0" break the tie differently — an off-zero iso */
  ['chladni210 solid iso.05',        { sym: 1, modes: [W(2,1,0)], iso: 0.05 }],
  ['octave pure sheet t1.2 time.6',  { sym: 0, modes: [W(1,0,0), W(0,1,0), W(0,0,1), W(2,0,0,.5), W(0,2,0,.5), W(0,0,2,.5)], sheet: true, thickness: 0.3, time: 0.6, iso: 0.2 }],
  ['triad123 cubic solid',           { sym: 2, modes: [W(1,2,3)], iso: -0.5 }],
  ['diamond pure solid phi',         { sym: 0, modes: [W(1,1,0), W(0,1,1,1,0.4), W(1,0,1,0.8,1.0)], iso: 0.2 }],
  ['harmonic cubic sheet',           { sym: 2, modes: [W(1,0,0,1), W(2,0,0,.5), W(3,0,0,.33)], sheet: true, thickness: 0.4 }],
  ['mesh cubic 2-mode',              { sym: 2, modes: [W(1,1,1,1,0), W(2,1,1,0.4,0.3)] }],
  /* v0.29.0 — the Wave tool's stretch sliders (a box-shaped cell) */
  ['gyroid schoen stretched',        { sym: 4, modes: [W(1,1,0)], iso: 0.2, stretch: [1.6, 1, 0.7] }, true],
  ['cubic sheet stretched y',        { sym: 2, modes: [W(1,0,0)], sheet: true, thickness: 0.3, stretch: [1, 1.5, 1] }],
];

/* Every section-A case, in order: [{ name, family, quick }] — cheap, nothing is built. */
const CASES = [
  ...TPMS.map(([name, st, extra, quick]) => ({ name, family: 'tpms', quick: !!quick, spec: { st, extra } })),
  ...NOISE.map(([name, ui, quick]) => ({ name, family: 'noise', quick: !!quick, spec: { ui } })),
  ...GRAIN.map(([name, ui, quick]) => ({ name, family: 'grain', quick: !!quick, spec: { ui } })),
  ...BEAM.map(([name, st, extra, quick]) => ({ name, family: 'beam', quick: !!quick, spec: { st, extra } })),
  ...WAVE.map(([name, st, quick]) => ({ name, family: 'wave', quick: !!quick, spec: { st } })),
];

/* Build one case with its tool's export code → { name, family, quick, json, tool } (cached).
   json is the recipe exactly as exported (plus [x] extras); tool drives the tool's own
   voxelizer (null for [x] cases and for beams — F13LD.beam has no CPU voxelizer). */
const built = new Map();
function build(name) {
  if (built.has(name)) return built.get(name);
  const c = CASES.find(x => x.name === name);
  if (!c) throw new Error('no section-A case named ' + name);
  let json, tool = null;
  if (c.family === 'tpms') {
    json = tools.tpms.exportRecipe(c.spec.st);
    if (c.spec.extra) Object.assign(json.geometry, c.spec.extra); else tool = { family: 'tpms', ui: c.spec.st };
  } else if (c.family === 'noise' || c.family === 'grain') {
    json = tools[c.family].exportRecipe(c.spec.ui); tool = { family: c.family, ui: c.spec.ui };
  } else if (c.family === 'wave') {
    json = tools.wave.exportRecipe(c.spec.st);   /* F13LD.wave has no CPU voxelizer of its own here */
  } else {
    const st = c.spec.st;
    json = st.builder ? tools.beam.exportBuilder(st.builder, st.beams || tools.beam.catalog()[st.from], st.r) : tools.beam.exportRecipe(st.topo, st.r, st.cell);
    if (c.spec.extra) Object.assign(json.geometry, c.spec.extra);
  }
  const out = { name: c.name, family: c.family, quick: c.quick, json, tool };
  built.set(name, out);
  return out;
}

/* Section B base recipes (names from section A) */
const SECTION_B = {
  tpms:  ['splitP raw solid off0.1 cs1.5', 'P x octo PI k=2 norm r.4', 'P shell norm wt0.3'],
  noise: ['foam half', 'cellular half man j1 s5', 'warp sheet'],
  grain: ['spin tilt half', 'HU single half', 'GRF ortho half-inv'],
  beam:  ['octet r.10 c1.5 (default)', '[x] octet per-axis 1.5 k+ball', 'bcc r.25 c2.0'],
  wave:  ['diamond pure solid phi', 'gyroid schoen sheet iso.3 t.25', 'octave pure sheet t1.2 time.6', 'gyroid schoen stretched'],
};

module.exports = { CASES, build, SECTION_B };
