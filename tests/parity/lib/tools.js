// The design tools (F13LD.tpms / .noise / .grain / .beam): their own export code and,
// where they have one, their own CPU voxelizer — extracted from index.html into vm
// contexts and driven through stubbed DOM inputs. Nothing in the tools is modified.
'use strict';
const path = require('path');
const { DIRS, read, context, run, elStub, grid, clone } = require('./env');

const FIXED_DATE = `globalThis.Date = (function (D) {
  function FD() { return arguments.length ? new (Function.prototype.bind.apply(D, [null].concat([].slice.call(arguments))))() : new D('2026-10-08T00:00:00.000Z'); }
  FD.now = function () { return D.parse('2026-10-08T00:00:00.000Z'); }; FD.parse = D.parse; FD.UTC = D.UTC; FD.prototype = D.prototype;
  return FD; })(Date);`;

/* Source of a top-level declaration, from its start to the matching close brace. */
function grabFrom(html, re, label) {
  const m = re.exec(html); if (!m) throw new Error(label + ': not found ' + re);
  let i = html.indexOf('{', m.index), d = 0;
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(m.index, i + 1) + (html[i + 1] === ';' ? ';' : '');
}
function lineStarting(html, prefix, label) {
  const l = html.split('\n').find(s => s.startsWith(prefix));
  if (!l) throw new Error(label + ': line not found: ' + prefix);
  return l;
}
function sliceBetween(html, a, b, label) {
  const i = html.indexOf(a); if (i < 0) throw new Error(label + ': marker not found: ' + a);
  const j = html.indexOf(b, i); if (j < 0) throw new Error(label + ': end marker not found: ' + b);
  return html.slice(i, j);
}

/* ───────────────────────────── F13LD.tpms ───────────────────────────── */
const tpms = (() => {
  const html = read(DIRS.tpms, 'index.html'), g = re => grabFrom(html, re, 'tpms'), L = p => lineStarting(html, p, 'tpms');
  const ctx = context({ document: { getElementById: id => id === 'presetSel' ? ctx.__presetSel : elStub() } });
  ctx.__presetSel = { value: 'gyroid' };
  run(ctx, FIXED_DATE);
  run(ctx, [
    g(/function toFloat\(/), g(/function jsTrig\(/),
    L('let terms=[],tid=0;'), g(/function mkF\(/), g(/function mk\(/), g(/const PRESETS=\{/), L('let rawPresetFn=null;'),
    L('let fieldB={'), L('let fieldBAmp=1;'), L('let piFnB=null;'), g(/function fieldA\(/), g(/function fieldBResolved\(/),
    g(/function cloneTerms\(/), g(/function compileField\(/), g(/function fieldRMS\(/), g(/function computeFieldBAmp\(/),
    L('const TWO_PI=2*Math.PI;'), L('let piShift={'), L('let piNormalize='), L('let shellNormalize='), g(/function piShiftRad\(/),
    g(/function makeFnB\(/), L('const PI_E=0.012'), g(/function piGeom\(/), L('let shellMode=false,piMode=false'),
    g(/function isSolid\(/), L('let lastHomogResult=null;'), g(/function buildExportJSON\(/),
    /* Set the tool state the way its UI handlers do (loadPreset, the field-B menu, sliders). */
    `function __setState(st) {
      if (st.termsA) { rawPresetFn = null; terms = st.termsA.map(function (t) { var o = mk(t.factors.map(function (f) { return mkF(f.trig, f.fx, f.fy, f.fz); }), t.coef); o.on = t.on; return o; }); }
      else { var p = PRESETS[st.preset]; if (p._fn) { rawPresetFn = { fn: p._fn, glsl: p._glsl, label: p._label }; terms = []; } else { rawPresetFn = null; terms = cloneTerms(p); } }
      piMode = st.mode === 'pi-tpms'; shellMode = st.mode === 'shell';
      offsetVal = st.offset != null ? st.offset : 0; wallVal = st.wall != null ? st.wall : 0.3; pipeRVal = st.pipe != null ? st.pipe : 0.18;
      cellMult = st.cell != null ? st.cell : 1; shellNormalize = st.norm != null ? st.norm : true; piNormalize = st.norm != null ? st.norm : true;
      piShift = st.shift ? { x: st.shift.x, y: st.shift.y, z: st.shift.z } : { x: 0, y: 0.125, z: 0.5 };
      fieldB = { src: 'same', presetKey: 'gyroid', terms: [], raw: null, freq: st.k || 1 };
      if (st.b) { var q = PRESETS[st.b]; fieldB.src = 'set'; fieldB.presetKey = st.b;
        if (q._fn) { fieldB.raw = { fn: q._fn, glsl: q._glsl, label: q._label }; fieldB.terms = []; } else { fieldB.raw = null; fieldB.terms = cloneTerms(q); } }
      fieldBAmp = computeFieldBAmp(); piFnB = null; lastHomogResult = null;
    }
    function __export() { return JSON.stringify(buildExportJSON()); }
    function __inside() { var fA = compileField(fieldA()); piFnB = piMode ? makeFnB() : null; return function (x, y, z) { return isSolid(fA, x, y, z); }; }`,
  ].join('\n'));
  return {
    /* st: { preset | termsA, mode, offset, cell, wall, norm, pipe, shift, k, b } */
    exportRecipe(st) { ctx.__presetSel.value = st.termsA ? 'custom' : st.preset; ctx.__setState(st); return JSON.parse(ctx.__export()); },
    voxels(st, N) { ctx.__presetSel.value = st.termsA ? 'custom' : st.preset; ctx.__setState(st); return grid(N, ctx.__inside()); },
  };
})();

/* ───────────────────────────── F13LD.noise ───────────────────────────── */
const noise = (() => {
  const html = read(DIRS.noise, 'index.html'), S = (a, b) => sliceBetween(html, a, b, 'noise');
  const ctx = context();
  run(ctx, FIXED_DATE);
  ctx.Raymarcher = function () {}; ctx.setNoiseStatus = () => {};
  run(ctx, [
    S('var DeterministicNoise = (function() {', '// ── Raymarcher'),
    S('Raymarcher.prototype._runPrepass=function(params){', 'Raymarcher.prototype._buildFrag'),
    S('function seedToOffset(s){', 'function updateControlVisibility'),
    S('function homoPrepass(params){', 'function computeMIL'),
    S('function buildExportJSON(){', 'function openInMesh'),
  ].join('\n'));
  const DEF = { noiseType: 'simplex', frequency: 0.30, isoLevel: 0, thickness: 0.15, smoothing: 0, octaves: 4, lacunarity: 2.0,
    gain: 0.5, warpStrength: 1.0, distanceMetric: 'euclidean', curlStep: 0.10, potentialScale: 1.0, veinTurb: 3.0, veinFreq: 3.0,
    jitter: 0.6, seed: 0, scaleX: 1, scaleY: 1, scaleZ: 1, holeFreq: 1, holeRadius: 0.3 };
  function setUI(ui) {
    const v = Object.assign({}, DEF, ui);
    ctx.document = { getElementById: id => ({ value: String(v[id]), checked: false }) };
    ctx.topoMode = v.topoMode || 'sheet'; ctx.halfInvert = !!v.halfInvert;
    ctx.voidEnabled = false; ctx.voidType = 'spherical'; ctx.currentQuality = 'high'; ctx.lastHomogResult = null;
    const params = run(ctx, 'getParams()');
    const rm = new ctx.Raymarcher(); rm.running = false;
    ctx.Raymarcher.prototype._runPrepass.call(rm, params);     // the preview prepass → norm_min / norm_max
    ctx.raymarcher = rm;
    return { params, rm };
  }
  const prepassed = new Map();     /* ui → { params, rm }: the 32³ prepass runs once per recipe */
  return {
    exportRecipe(ui) { const r = setUI(ui); prepassed.set(JSON.stringify(ui), r); return JSON.parse(JSON.stringify(run(ctx, 'buildExportJSON()'))); },
    /* the tool's own voxelizer (homogenization path), [-π,π]³ voxel centres */
    voxels(ui, N) {
      const { params, rm } = prepassed.get(JSON.stringify(ui)) || setUI(ui);
      return Uint8Array.from(ctx.voxelizeNoise(params, rm.noiseMin, rm.noiseMax, N).vox, v => v ? 1 : 0);
    },
  };
})();

/* ───────────────────────────── F13LD.grain ───────────────────────────── */
const grain = (() => {
  const html = read(DIRS.grain, 'index.html');
  const grab = name => {
    const i = html.search(new RegExp('\\nfunction ' + name + '\\s*\\('));
    if (i < 0) throw new Error('grain: function ' + name + ' not found');
    let j = html.indexOf('{', i), d = 0;
    for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); }
  };
  const ctx = context();
  run(ctx, FIXED_DATE);
  run(ctx, 'var rdGrid=null,rdGridN=0,HU_NREF=100;\n' + lineStarting(html, "var topoMode='sheet',halfInvert=false,dirMode=", 'grain') + '\n' +
    ['mulberry32', 'sampleVMF', 'rotateTo', 'buildSpinodoidWaves', 'buildGRFWaves', 'jitteredGrid3D', 'buildHUKernels', 'clampCell',
      'buildHUAccel', 'evalHUField', 'evalRDField', 'buildWaves', 'evalField', 'voxelizeField', 'huEffectiveWidth', 'getParams',
      'buildExportJSON'].map(grab).join('\n') +
    `\nfunction __set(ui) { topoMode = ui.topoMode || 'sheet'; halfInvert = !!ui.halfInvert; dirMode = ui.dirMode || 'single'; currentQuality = 'high'; lastHomogResult = null; }`);
  /* UI inputs in slider units (huBlend, huEll are the slider positions, as in the tool) */
  const DEF = { fieldType: 'spinodoid', kappa: 6, nWaves: 48, frequency: 0.45, rngSeed: 42, dirTheta: 0, dirPhi: 0,
    wX: 0.33, wY: 0.33, wZ: 0.34, isoLevel: 0, thickness: 0.15, smoothing: 0, grfSigma: 0.45, huAspect: 4, huWidth: 0.04, huN: 30,
    huCross: 2, huSharp: 1, huBlend: 0, huEll: 0, rdSystem: 'grayscott', rdDu: 0.14, rdDv: 16, rdF: 0.030, rdK: 0.057, rdTile: 1, rdSteps: 3000 };
  function setUI(ui) {
    const v = Object.assign({}, DEF, ui);
    ctx.document = { getElementById: id => id === 'huLockScale' ? { checked: false } : ({ value: String(v[id]) }) };
    ctx.__set(v);
    return run(ctx, 'getParams()');
  }
  return {
    exportRecipe(ui) { setUI(ui); return JSON.parse(JSON.stringify(run(ctx, 'buildExportJSON()'))); },
    voxels(ui, N) { const p = setUI(ui); ctx.__p = p; return Uint8Array.from(run(ctx, `voxelizeField(__p, ${N})`).vox); },
  };
})();

/* ───────────────────────────── F13LD.beam ───────────────────────────── */
const beam = (() => {
  const html = read(DIRS.beam, 'index.html'), g = re => grabFrom(html, re, 'beam');
  const ctx = context();
  run(ctx, FIXED_DATE);
  run(ctx, [lineStarting(html, 'var BEAM_CATALOGS = ', 'beam'), g(/\nfunction getParams\(/), g(/\nfunction beamSharingFactor\(/),
    g(/\nfunction computeMetrics\(/), g(/\nfunction buildExportJSON\(/), g(/\nfunction bldBuildExportData\(/),
    /* homogenization (DSM) does not touch geometry; stubbed */
    'function buildHomogJSON() { return null; } var currentTile = 1, currentQuality = "high", Builder = { beams: [], radius: 0.1 };'].join('\n'));
  return {
    catalog: () => JSON.parse(JSON.stringify(ctx.BEAM_CATALOGS)),
    /* preset export: topology from the catalog, radius (cell-local), cell (mm) */
    exportRecipe(topology, radius, cell) {
      const v = { topology, radius, cell };
      ctx.document = { getElementById: id => ({ value: String(v[id]) }) };
      return JSON.parse(JSON.stringify(run(ctx, 'buildExportJSON()')));
    },
    /* Beam Builder export (custom cell, cell fixed at 1.5) */
    exportBuilder(name, beams, radius) {
      ctx.document = { getElementById: id => ({ value: id === 'bldCellName' ? name : '' }) };
      ctx.Builder.beams = clone(beams); ctx.Builder.radius = radius;
      return JSON.parse(JSON.stringify(run(ctx, 'bldBuildExportData()')));
    },
  };
})();

/* ── F13LD.wave (v0.29.0): buildExportJSON with the tool's State (no metrics / homogenization) ── */
const wave = (() => {
  const html = read(DIRS.wave, 'index.html'), g = re => grabFrom(html, re, 'wave');
  const ctx = context();
  run(ctx, FIXED_DATE);
  run(ctx, [lineStarting(html, "const symLabels = ", 'wave').replace(/^const /, 'var '), g(/\nfunction buildExportJSON\(/),
    'var lastMetrics = null, lastHomog = null, State = {};'].join('\n'));
  return {
    /* st: { sym, modes [{n,m,p,A,phi}], sheet, thickness, iso, cellScale, time, signFlip } */
    exportRecipe(st) {
      ctx.State = { symmetry: st.sym || 0, modes: clone(st.modes), sheetMode: !!st.sheet, thickness: st.thickness != null ? st.thickness : 0.2,
        iso: st.iso || 0, cellScale: st.cellScale || 1, time: st.time || 0, signFlip: st.signFlip ? 1 : 0,
        stretchX: (st.stretch || [1, 1, 1])[0], stretchY: (st.stretch || [1, 1, 1])[1], stretchZ: (st.stretch || [1, 1, 1])[2] };
      return JSON.parse(JSON.stringify(run(ctx, 'buildExportJSON()')));
    },
  };
})();

module.exports = { tpms, noise, grain, beam, wave };
