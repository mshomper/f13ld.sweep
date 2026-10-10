#!/usr/bin/env node
/* F13LD.sweep — v0.28.0 target maths (13-target.js), no browser.
   node tests/target.js   → exit 0 when every check passes.
   Checks: distance and ranking, the density trend fit and its prediction,
   the Voigt-bound physics check, strain scaling, and the #r=…&t=… link. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '13-target.js'), 'utf8');
const ctx = { console, Math, JSON, Number, Object, Array, String, isFinite, parseFloat, encodeURIComponent, decodeURIComponent };
vm.createContext(ctx);
/* `let` / `const` at the top level stay in the script scope; expose what the checks use */
vm.runInContext(src + '\n;this.__t = { TGT_METRICS, tgtRelErr, tgtOff, tgtStamp, tgtCompare, tgtBest, tgtFitTrend, tgtPredictDensity, tgtPhysics, tgtParseHash, tgtFromLink, tgtValue, tgtFmt };', ctx);
const T = ctx.__t;

let fails = 0, n = 0;
function ok(cond, msg) { n++; if (!cond) { fails++; console.log('FAIL  ' + msg); } else console.log('ok    ' + msg); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* designs on a power law E = 0.3 φ² (Gibson–Ashby bending), φ 10–40 % */
function design(vf, extra) {
  const p = vf / 100, E = 0.3 * p * p;
  return Object.assign({ volume_fraction: vf, Ex_norm: E, Ey_norm: E * 0.9, Ez_norm: E * 0.8, Gyz_norm: E * 0.3, Gxz_norm: E * 0.3, Gxy_norm: E * 0.3 }, extra || {});
}
const ds = [10, 13, 16, 20, 24, 28, 33, 40].map(v => design(v));

/* distance */
ok(near(T.tgtRelErr(1.05, 1), 0.05, 1e-12), 'relative error 5 %');
ok(T.tgtRelErr(null, 1) === Infinity, 'missing value is infinitely far');
const tgt = { metrics: [{ key: '_emax', value: 0.3 * 0.25 * 0.25 }, { key: 'volume_fraction', value: 25 }], tol: 0.05 };
const on = design(25);
ok(T.tgtOff(on, tgt).off < 1e-9, 'a design on the target is 0 % off');
ok(near(T.tgtOff(design(24), tgt).off, 1 - (0.24 * 0.24) / (0.25 * 0.25), 1e-9), 'off = the worst metric (stiffness here)');
const list = T.tgtStamp(ds.concat([on]), tgt).slice().sort(T.tgtCompare);
ok(list[0] === on, 'ranking puts the on-target design first');
const flagged = Object.assign(design(25), { stiffness_flag: true });
T.tgtStamp([flagged], tgt);
ok(T.tgtBest([flagged, design(24)].map(d => (T.tgtStamp([d], tgt), d))).volume_fraction === 24, 'best skips a flagged design when an unflagged one exists');

/* trend fit */
const fit = T.tgtFitTrend(ds, { key: '_emax' });
ok(fit && near(fit.b, 2, 1e-9) && near(Math.exp(fit.a), 0.3, 1e-9), 'trend fit recovers E = 0.3 φ² (slope ' + (fit && fit.b.toFixed(4)) + ')');
const fv = T.tgtFitTrend(ds, { key: 'volume_fraction' });
ok(fv && near(fv.b, 1, 1e-9), 'volume fraction fits with slope 1');
const pred = T.tgtPredictDensity(ds, { metrics: [{ key: '_emax', value: 0.03 }] });
ok(pred && near(pred.phi, Math.sqrt(0.1), 1e-9) && pred.residual < 1e-9, 'density for E* = 0.03 is √0.1 = 31.6 % (' + (pred && (pred.phi * 100).toFixed(2)) + ' %)');
const pred2 = T.tgtPredictDensity(ds, { metrics: [{ key: '_emax', value: 0.03 }, { key: 'volume_fraction', value: 20 }] });
ok(pred2 && pred2.phi > 0.2 && pred2.phi < 0.316 && pred2.residual > 0.1, 'a target off the trend lands between and reports a residual (' + (pred2 && (pred2.residual * 100).toFixed(0)) + ' %)');
const pred3 = T.tgtPredictDensity(ds, { metrics: [{ key: 'volume_fraction', value: 32 }, { key: '_emax', value: 0.09 }] });
ok(pred3 && near(pred3.phi, 0.4367, 0.002) && near(pred3.residual, 0.365, 0.003), 'minimax: equal worst errors on both metrics (ρ ' + (pred3 && (pred3.phi * 100).toFixed(1)) + ' %, ' + (pred3 && (pred3.residual * 100).toFixed(1)) + ' % off)');
const pred4 = T.tgtPredictDensity(ds, { metrics: [{ key: '_emax', value: 0.03 }] }, 0.05, 0.25);
ok(pred4 && near(pred4.phi, 0.25, 1e-3), 'the search stays inside the density bounds');
ok(T.tgtFitTrend(ds.slice(0, 4), { key: '_emax' }) === null, 'fewer than 6 designs: no fit');
ok(T.tgtFitTrend(ds.map(d => Object.assign({}, d, { volume_fraction: 20 })), { key: '_emax' }) === null, 'no density spread: no fit');

/* physics */
const w1 = T.tgtPhysics({ metrics: [{ key: 'ex_norm', value: 0.4 }, { key: 'volume_fraction', value: 30 }] }, 0.75);
ok(w1.length === 1 && /past the theoretical maximum/.test(w1[0].text), 'Ex/Es 0.4 at 30 % solid is past Voigt (' + (w1[0] && w1[0].text) + ')');
const w2 = T.tgtPhysics({ metrics: [{ key: 'ex_norm', value: 0.8 }] }, 0.75);
ok(w2.length === 1 && /needs at least 80/.test(w2[0].text), 'Ex/Es 0.8 needs ≥ 80 % solid (' + (w2[0] && w2[0].text) + ')');
ok(T.tgtPhysics({ metrics: [{ key: 'ex_norm', value: 0.05 }, { key: 'volume_fraction', value: 30 }] }, 0.75).length === 0, 'a reachable target raises nothing');
const w3 = T.tgtPhysics({ metrics: [{ key: 'microstrain_avg_per_gpa', value: 100, scale: 0.1 }, { key: 'volume_fraction', value: 50 }] }, 0.75);
ok(w3.length === 1 && /minimum/.test(w3[0].text), 'strain below the stiffest possible structure warns');

/* bounds that fall with density (diffusivity ≤ 1 − φ) */
ok(T.tgtPhysics({ metrics: [{ key: 'd_eff_max_norm', value: 0.9 }] }, 0.75, 0.03).length === 0, 'D_eff 0.9 is reachable below 10 % solid (no warning)');
const w4 = T.tgtPhysics({ metrics: [{ key: 'd_eff_max_norm', value: 0.99 }] }, 0.75, 0.03);
ok(w4.length === 1 && /at most 1 %/.test(w4[0].text), 'D_eff 0.99 needs at most 1 % solid (' + (w4[0] && w4[0].text) + ')');
ok(T.tgtPhysics({ metrics: [{ key: 'd_eff_max_norm', value: 0.6 }, { key: 'volume_fraction', value: 50 }] }, 0.75, 0.03).length === 1, 'D_eff 0.6 at 50 % solid is past 1 − φ');
ok(T.tgtFromLink({ metrics: [{ key: '_emax', value: null }, { key: 'volume_fraction', value: '' }] }) === null, 'empty link values are not read as 0');

/* strain scaling: με = 1000 / E × σ/Es */
const st = T.tgtValue(design(20), { key: 'microstrain_x_per_gpa', scale: 10 / 110 });
ok(near(st, 1000 / (0.3 * 0.04) * 10 / 110, 1e-6), 'strain X uses the link\'s load scale');

/* link */
const recipe = { surface: { preset: 'gyroid' }, geometry: { mode: 'sheet' } };
const t = { v: 1, metrics: [{ key: '_emax', value: 0.02 }, { key: 'volume_fraction', value: 18 }, { key: 'nope', value: 1 }], seed: { id: 'abc', name: 'Gyroid', reason: 'reach' }, density: { lo: 15, hi: 21, predicted: 18 }, spread: 0.2, tol: 0.05 };
const hash = '#r=' + encodeURIComponent(JSON.stringify(recipe)) + '&t=' + encodeURIComponent(JSON.stringify(t));
const L = T.tgtParseHash(hash);
ok(L.recipe && L.recipe.surface.preset === 'gyroid' && L.target && L.target.density.lo === 15, 'link round-trips the recipe and target');
const TT = T.tgtFromLink(L.target);
ok(TT && TT.metrics.length === 2 && TT.source.id === 'abc' && TT.tol === 0.05 && TT.cap === 6 && TT.roundSize === 25, 'unknown metrics are dropped; defaults 6 × 25');
ok(T.tgtParseHash('#r=%7Bbad').error, 'bad JSON is reported');
ok(T.tgtParseHash('#r=' + encodeURIComponent('{"a":1}')).target === null, 'recipe-only link has no target');

/* every metric reads (or is null) without throwing */
let threw = 0;
Object.keys(T.TGT_METRICS).forEach(k => { try { T.tgtValue(design(20), { key: k, scale: 1 }); } catch (e) { threw++; console.log('  ' + k + ': ' + e.message); } });
ok(threw === 0, 'all ' + Object.keys(T.TGT_METRICS).length + ' target metrics read without throwing');

console.log(`\n${n - fails} / ${n} checks passed`);
process.exit(fails ? 1 : 0);
