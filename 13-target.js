/* ============================================================
   F13LD.sweep · 13-target.js   (v0.28.0)
   Point targets: aim a sweep at a pair (or three) of metric values instead
   of a "maximise / minimise" corner — usually a white space F13LD.vault
   found in its 2D plot.

   The metric names are F13LD.vault's column names, so a target travels from
   Vault to Sweep unchanged (Vault's ex_norm is Sweep's Ex_norm, Vault's
   _emax is the stiffest axis, and so on). Every value is in Vault's units:
   stiffness and conductivity as a fraction of the solid, volume fraction in
   %, pores as a fraction of the cell, strain in real microstrain under the
   load Vault was given (the link carries that load as `scale`).

   This file holds the maths only — getters, distance, the density trend
   fit, the physics check, the link format — plus the TARGET state. The
   auto rounds live in 63-auto-target.js and the Settings controls in
   24-drawer.js. Top-level code only defines things.
   ============================================================ */

/* The active target, or null. {
     metrics: [{ key, value, scale? }],   1–3 entries, Vault column names
     tol:     0.05,                       "on target" when every metric is this close
     auto:    true,                       Run does auto rounds, then a final run
     cap:     6, roundSize: 25,           at most cap rounds of roundSize Fast designs
     source:  { tool, id, name, reason, residual } | null    where it came from
   } */
let TARGET = null;
/* The last auto-target run: rounds, the faded trail on the plot, status line. */
let TARGET_RUN = { running: false, rounds: [], trail: [], status: '', best: null, reason: null };

const TGT_DEFAULTS = { tol: 0.05, auto: true, cap: 6, roundSize: 25 };
const TGT_NU = 0.3;   /* Poisson's ratio for the shear bound (the solid's G = E / 2(1 + ν)) */

/* ── helpers ───────────────────────────────────────────────────── */
function tgtNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function tgtAll3(d, a, b, c) { return tgtNum(d[a]) && tgtNum(d[b]) && tgtNum(d[c]) ? [d[a], d[b], d[c]] : null; }
function tgtMax3(d, a, b, c) { const v = tgtAll3(d, a, b, c); return v ? Math.max(...v) : null; }
function tgtMin3(d, a, b, c) { const v = tgtAll3(d, a, b, c); return v ? Math.min(...v) : null; }
function tgtAvg3(d, a, b, c) { const v = tgtAll3(d, a, b, c); return v ? (v[0] + v[1] + v[2]) / 3 : null; }
function tgtFinite(list) { return list.filter(tgtNum); }
/* the cell edge in µm (Configure → Cell size), for pores as a fraction of the cell */
function tgtCellUm() {
  const el = typeof document !== 'undefined' ? document.getElementById('cellSize') : null;
  const mm = el ? parseFloat(el.value) : NaN;
  return mm > 0 ? mm * 1000 : null;
}
/* strain coefficient on one axis: 1000 / (E / Es), as F13LD.vault 11-data.js builds it */
function tgtStrainCoef(e) { return tgtNum(e) && e > 0 ? 1000 / e : null; }

/* ── the metrics a target can name ─────────────────────────────────
   get(d, m): the design's value in Vault's units (m = the target entry,
   for the strain scale). bound: the theoretical limit as a function of the
   solid fraction φ (0–1) — Voigt's upper bound, a hard limit for any
   two-phase solid / void structure — with kind 'max' (the metric can't go
   above it) or 'min' (can't go below). */
const TGT_GROUPS = ['Stiffness', 'Shear', 'Thermal', 'Strain', 'Geometry', 'Pores', 'Transport'];
const TGT_METRICS = {
  volume_fraction:        { group: 'Geometry',  name: 'Volume fraction',              sym: 'ρ',     unit: '%', get: d => d.volume_fraction },
  _emax:                  { group: 'Stiffness', name: 'Peak stiffness E* / Es',       sym: 'E*',    get: d => tgtMax3(d, 'Ex_norm', 'Ey_norm', 'Ez_norm'), bound: { kind: 'max', f: p => p } },
  ex_norm:                { group: 'Stiffness', name: 'Stiffness Ex / Es',            sym: 'Ex',    get: d => d.Ex_norm, bound: { kind: 'max', f: p => p } },
  ey_norm:                { group: 'Stiffness', name: 'Stiffness Ey / Es',            sym: 'Ey',    get: d => d.Ey_norm, bound: { kind: 'max', f: p => p } },
  ez_norm:                { group: 'Stiffness', name: 'Stiffness Ez / Es',            sym: 'Ez',    get: d => d.Ez_norm, bound: { kind: 'max', f: p => p } },
  stiffness_density_norm: { group: 'Stiffness', name: 'Stiffness density E/ρ',        sym: 'E/ρ',   get: d => d.stiffness_density_norm, bound: { kind: 'max', f: () => 1 } },
  _perf:                  { group: 'Stiffness', name: 'Stiffness efficiency |E|/VF',  sym: '|E|/VF', get: d => { const v = tgtAll3(d, 'Ex_norm', 'Ey_norm', 'Ez_norm'); return v && tgtNum(d.volume_fraction) && d.volume_fraction > 0 ? Math.hypot(v[0], v[1], v[2]) / (d.volume_fraction / 100) : null; }, bound: { kind: 'max', f: () => Math.sqrt(3) } },
  _gmean:                 { group: 'Shear',     name: 'Mean shear G / Es',            sym: 'G*',    get: d => tgtAvg3(d, 'Gyz_norm', 'Gxz_norm', 'Gxy_norm'), bound: { kind: 'max', f: p => p / (2 * (1 + TGT_NU)) } },
  gyz_norm:               { group: 'Shear',     name: 'Shear Gyz / Es',               sym: 'Gyz',   get: d => d.Gyz_norm, bound: { kind: 'max', f: p => p / (2 * (1 + TGT_NU)) } },
  gxz_norm:               { group: 'Shear',     name: 'Shear Gxz / Es',               sym: 'Gxz',   get: d => d.Gxz_norm, bound: { kind: 'max', f: p => p / (2 * (1 + TGT_NU)) } },
  gxy_norm:               { group: 'Shear',     name: 'Shear Gxy / Es',               sym: 'Gxy',   get: d => d.Gxy_norm, bound: { kind: 'max', f: p => p / (2 * (1 + TGT_NU)) } },
  keff_max_norm:          { group: 'Thermal',   name: 'Thermal cond. (best axis) / ks', sym: 'k*',  get: d => tgtMax3(d, 'keff_x_norm', 'keff_y_norm', 'keff_z_norm'), bound: { kind: 'max', f: p => p + (1 - p) * 0.001 } },
  keff_avg_norm:          { group: 'Thermal',   name: 'Thermal cond. (mean) / ks',    sym: 'k̄',    get: d => tgtAvg3(d, 'keff_x_norm', 'keff_y_norm', 'keff_z_norm'), bound: { kind: 'max', f: p => p + (1 - p) * 0.001 } },
  keff_x_norm:            { group: 'Thermal',   name: 'Thermal cond. kx / ks',        sym: 'kx',    get: d => d.keff_x_norm, bound: { kind: 'max', f: p => p + (1 - p) * 0.001 } },
  keff_y_norm:            { group: 'Thermal',   name: 'Thermal cond. ky / ks',        sym: 'ky',    get: d => d.keff_y_norm, bound: { kind: 'max', f: p => p + (1 - p) * 0.001 } },
  keff_z_norm:            { group: 'Thermal',   name: 'Thermal cond. kz / ks',        sym: 'kz',    get: d => d.keff_z_norm, bound: { kind: 'max', f: p => p + (1 - p) * 0.001 } },
  thermal_anisotropy:     { group: 'Thermal',   name: 'Thermal anisotropy',           sym: 'kα',    get: d => d.thermal_anisotropy },
  microstrain_avg_per_gpa:{ group: 'Strain',    name: 'Mean strain',                  sym: 'με̄',   unit: 'με', strain: true, get: (d, m) => { const c = tgtFinite(['Ex_norm', 'Ey_norm', 'Ez_norm'].map(k => tgtStrainCoef(d[k]))); return c.length ? c.reduce((a, b) => a + b, 0) / c.length * (m && m.scale || 1) : null; }, bound: { kind: 'min', f: (p, m) => 1000 / p * (m && m.scale || 1) } },
  microstrain_x_per_gpa:  { group: 'Strain',    name: 'Strain X',                     sym: 'με·X',  unit: 'με', strain: true, get: (d, m) => { const c = tgtStrainCoef(d.Ex_norm); return c == null ? null : c * (m && m.scale || 1); }, bound: { kind: 'min', f: (p, m) => 1000 / p * (m && m.scale || 1) } },
  microstrain_y_per_gpa:  { group: 'Strain',    name: 'Strain Y',                     sym: 'με·Y',  unit: 'με', strain: true, get: (d, m) => { const c = tgtStrainCoef(d.Ey_norm); return c == null ? null : c * (m && m.scale || 1); }, bound: { kind: 'min', f: (p, m) => 1000 / p * (m && m.scale || 1) } },
  microstrain_z_per_gpa:  { group: 'Strain',    name: 'Strain Z',                     sym: 'με·Z',  unit: 'με', strain: true, get: (d, m) => { const c = tgtStrainCoef(d.Ez_norm); return c == null ? null : c * (m && m.scale || 1); }, bound: { kind: 'min', f: (p, m) => 1000 / p * (m && m.scale || 1) } },
  anisotropy:             { group: 'Geometry',  name: 'Anisotropy ratio',             sym: 'α',     get: d => d.anisotropy },
  directionality:         { group: 'Geometry',  name: 'Directionality Ψ',             sym: 'Ψ',     get: d => d.directionality },
  ortho_contrast:         { group: 'Geometry',  name: 'Ortho contrast Ω',             sym: 'Ω',     get: d => d.ortho_contrast },
  aniso_efficiency:       { group: 'Geometry',  name: 'Aniso efficiency α/ρ',         sym: 'α/ρ',   get: d => d.aniso_efficiency },
  connect_idx:            { group: 'Geometry',  name: 'Solid connectivity κ',         sym: 'κ',     get: d => d.connect_idx },
  perc_idx:               { group: 'Geometry',  name: 'Void percolation',             sym: 'perc',  get: d => d.perc_idx },
  pore_size_p50_norm:     { group: 'Pores',     name: 'Pore P50 / cell',              sym: 'φ50',   get: d => { const c = tgtCellUm(); return c && tgtNum(d.pore_size_p50) ? d.pore_size_p50 / c : null; } },
  pore_size_p10_norm:     { group: 'Pores',     name: 'Pore P10 / cell',              sym: 'φ10',   get: d => { const c = tgtCellUm(); return c && tgtNum(d.pore_size_p10) ? d.pore_size_p10 / c : null; } },
  pore_size_p90_norm:     { group: 'Pores',     name: 'Pore P90 / cell',              sym: 'φ90',   get: d => { const c = tgtCellUm(); return c && tgtNum(d.pore_size_p90) ? d.pore_size_p90 / c : null; } },
  pore_size_norm:         { group: 'Pores',     name: 'Pore size / cell',             sym: 'φ',     get: d => d.pore_size_norm },
  throat_size_norm:       { group: 'Pores',     name: 'Throat size / cell',           sym: 'φt',    get: d => d.throat_size_norm },
  throat_ratio:           { group: 'Pores',     name: 'Throat / pore ratio',          sym: 'φt/φ',  get: d => d.throat_ratio },
  tortuosity_min:         { group: 'Transport', name: 'Tortuosity (min axis)',        sym: 'τ',     get: d => tgtMin3(d, 'tortuosity_x', 'tortuosity_y', 'tortuosity_z'), bound: { kind: 'min', f: () => 1 } },
  tortuosity_avg:         { group: 'Transport', name: 'Tortuosity (mean)',            sym: 'τ̄',    get: d => tgtAvg3(d, 'tortuosity_x', 'tortuosity_y', 'tortuosity_z'), bound: { kind: 'min', f: () => 1 } },
  d_eff_max_norm:         { group: 'Transport', name: 'D_eff (max axis) / D₀',        sym: 'D*',    get: d => tgtMax3(d, 'D_eff_x_norm', 'D_eff_y_norm', 'D_eff_z_norm'), bound: { kind: 'max', f: p => 1 - p } },
  d_eff_avg_norm:         { group: 'Transport', name: 'D_eff (mean) / D₀',            sym: 'D̄',    get: d => tgtAvg3(d, 'D_eff_x_norm', 'D_eff_y_norm', 'D_eff_z_norm'), bound: { kind: 'max', f: p => 1 - p } },
  curvature_uniformity:   { group: 'Geometry',  name: 'Curvature uniformity',         sym: 'CU',    get: d => d.curvature_uniformity },
  genus_per_cell:         { group: 'Geometry',  name: 'Genus per cell',               sym: 'g',     get: d => d.genus_per_cell }
};

function tgtInfo(key) { return TGT_METRICS[key] || null; }
function tgtValue(d, m) {
  const info = TGT_METRICS[m.key];
  if (!info || !d) return null;
  const v = info.get(d, m);
  return tgtNum(v) ? v : null;
}
/* how a value reads in the UI and the log */
function tgtFmt(key, v) {
  if (!tgtNum(v)) return '—';
  const info = TGT_METRICS[key] || {};
  if (info.unit === '%') return (+v.toFixed(1)) + ' %';
  if (info.unit === 'με') return Math.round(v).toLocaleString('en-US') + ' με';
  const a = Math.abs(v);
  return a !== 0 && (a < 0.001 || a >= 10000) ? v.toExponential(2) : String(+v.toPrecision(3));
}
function tgtLabel(m) { const i = TGT_METRICS[m.key]; return i ? i.sym : m.key; }
function tgtSummary(T) {
  T = T || TARGET;
  return T ? T.metrics.map(m => tgtLabel(m) + ' ' + tgtFmt(m.key, m.value)).join(' · ') : '';
}

/* ── distance to the target ────────────────────────────────────────
   Relative error per metric, |v / t − 1| (absolute when the target is 0);
   a design is "off" by its worst metric, so "within 5 %" means every
   metric is within 5 %. The mean squared log-ratio breaks ties. */
function tgtRelErr(v, t) {
  if (!tgtNum(v) || !tgtNum(t)) return Infinity;
  if (Math.abs(t) < 1e-12) return Math.abs(v - t);
  return Math.abs(v / t - 1);
}
function tgtOff(d, T) {
  T = T || TARGET;
  if (!T || !T.metrics.length) return { off: Infinity, rms: Infinity };
  let off = 0, s = 0, n = 0;
  for (const m of T.metrics) {
    const v = tgtValue(d, m), e = tgtRelErr(v, m.value);
    if (!Number.isFinite(e)) return { off: Infinity, rms: Infinity };
    off = Math.max(off, e);
    const lr = v > 0 && m.value > 0 ? Math.log(v / m.value) : e;
    s += lr * lr; n++;
  }
  return { off, rms: Math.sqrt(s / n) };
}
/* Stamp every design with its target values (tgt_0 … for the table and the
   plot) and its distance (tgt_off), and sort closest first. */
function tgtStamp(list, T) {
  T = T || TARGET;
  if (!T) return list;
  for (const d of list) {
    T.metrics.forEach((m, i) => { d['tgt_' + i] = tgtValue(d, m); });
    const o = tgtOff(d, T);
    d.tgt_off = Number.isFinite(o.off) ? o.off : null;
    d._tgtRms = o.rms;
  }
  return list;
}
function tgtCompare(a, b) {
  const ao = a.tgt_off == null ? Infinity : a.tgt_off, bo = b.tgt_off == null ? Infinity : b.tgt_off;
  if (ao !== bo) return ao - bo;
  return (a._tgtRms || Infinity) - (b._tgtRms || Infinity);
}
/* The closest design to re-centre on: unflagged first (a flagged design's
   stiffness may read high, so its place in the plot may be wrong). */
function tgtBest(list) {
  const ok = list.filter(d => d.tgt_off != null);
  if (!ok.length) return null;
  const clean = ok.filter(d => !d.stiffness_flag);
  return (clean.length ? clean : ok).slice().sort(tgtCompare)[0];
}

/* ── the density trend ─────────────────────────────────────────────
   For each metric, a straight line through ln(value) against ln(solid
   fraction) — the power law (E ∝ ρⁿ and its relatives) that density
   dominates. Volume fraction itself fits exactly (slope 1). Metrics that
   can be zero or negative, or that don't follow density, get slope 0. */
function tgtFitTrend(designs, m) {
  const pts = [];
  for (const d of designs) {
    const v = tgtValue(d, m), vf = d.volume_fraction;
    if (tgtNum(v) && v > 0 && tgtNum(vf) && vf > 0) pts.push([Math.log(vf / 100), Math.log(v)]);
  }
  const n = pts.length;
  if (n < 6) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (sxx / n < 0.02 * 0.02) return null;   /* the designs barely differ in density */
  const b = sxy / sxx, a = my - b * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  return { a, b, r2, n };
}
/* The solid fraction (0–1) the trends say lands closest to the target, and
   how far off it still is there (residual: the worst metric's relative
   error). "Closest" is the same measure the ranking uses — the worst
   metric — so the prediction trades metrics the way the ranking judges
   them (a least-squares fit on the logs favoured the steeper metric and
   walked a volume-fraction target away, Sweep v0.28.0 test run). Searched
   over [lo, hi] (defaults: 0.3–95 %). A large residual means density alone
   can't reach the target and the shape has to change. null when no metric
   follows density. */
function tgtPredictDensity(designs, T, lo, hi) {
  T = T || TARGET;
  const fits = T.metrics.map(m => {
    const f = tgtFitTrend(designs, m);
    return { m, fit: f && m.value > 0 && Math.abs(f.b) >= 0.05 && f.r2 >= 0.3 ? f : null };
  });
  if (!fits.some(x => x.fit)) return null;
  const worst = lp => {
    let w = 0;
    for (const { m, fit } of fits) if (fit) w = Math.max(w, tgtRelErr(Math.exp(fit.a + fit.b * lp), m.value));
    return w;
  };
  let a = Math.log(Math.max(1e-3, lo || 0.003)), b = Math.log(Math.min(0.99, hi || 0.95));
  if (!(b > a)) b = a + 1e-3;
  /* coarse grid, then golden-section on the bracket around the best point */
  const N = 240;
  let bi = 0, bw = Infinity;
  for (let i = 0; i <= N; i++) { const w = worst(a + (b - a) * i / N); if (w < bw) { bw = w; bi = i; } }
  let L = a + (b - a) * Math.max(0, bi - 1) / N, R = a + (b - a) * Math.min(N, bi + 1) / N;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40; k++) {
    const c = R - g * (R - L), d = L + g * (R - L);
    if (worst(c) < worst(d)) R = d; else L = c;
  }
  const lp = (L + R) / 2;
  return { phi: Math.exp(lp), residual: worst(lp), fits };
}

/* ── the physics check ─────────────────────────────────────────────
   Voigt's bound: no solid / void structure is stiffer (or conducts better)
   along an axis than the same solid fraction of fully dense material. A
   target past it can't be reached; warned, never blocked.
   hiPhi: the densest design Sweep can make for this recipe (0–1). */
/* Where along φ the bound admits t. b.f is monotonic in φ; a bound that
   rises with density (stiffness) admits t from some φ up, one that falls
   (diffusivity, 1 − φ) up to some φ. → { side: 'min' | 'max', phi } or
   null when no density admits it. */
function tgtInvertBound(b, m, t) {
  const ok = p => b.kind === 'max' ? b.f(p, m) >= t : b.f(p, m) <= t;
  const P0 = 1e-4, P1 = 1;
  const okLo = ok(P0), okHi = ok(P1);
  if (!okLo && !okHi) return null;
  if (okLo && okHi) return { side: 'min', phi: P0 };   /* every density admits it */
  let lo = P0, hi = P1;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (ok(mid) === okHi) hi = mid; else lo = mid; }
  return okHi ? { side: 'min', phi: hi } : { side: 'max', phi: lo };
}
function tgtPhysics(T, hiPhi, loPhi) {
  T = T || TARGET;
  const out = [];
  if (!T) return out;
  const vfm = T.metrics.find(m => m.key === 'volume_fraction');
  for (const m of T.metrics) {
    const info = TGT_METRICS[m.key];
    if (!info || !info.bound || !tgtNum(m.value)) continue;
    const b = info.bound, name = info.name;
    if (vfm) {
      const p = vfm.value / 100, lim = b.f(p, m);
      const past = b.kind === 'max' ? m.value > lim : m.value < lim;
      if (past) out.push({ key: m.key, limit: lim, text: name + ' ' + tgtFmt(m.key, m.value) + ' is past the theoretical ' + (b.kind === 'max' ? 'maximum' : 'minimum') + ' at ' + tgtFmt('volume_fraction', vfm.value) + ' solid (' + tgtFmt(m.key, lim) + ').' });
      continue;
    }
    const need = tgtInvertBound(b, m, m.value);
    if (need == null) out.push({ key: m.key, text: name + ' ' + tgtFmt(m.key, m.value) + ' is past the theoretical limit at any density.' });
    else if (need.side === 'min' && hiPhi != null && need.phi > hiPhi) out.push({ key: m.key, needPhi: need.phi, text: name + ' ' + tgtFmt(m.key, m.value) + ' needs at least ' + tgtFmt('volume_fraction', need.phi * 100) + ' solid; Sweep goes up to ' + tgtFmt('volume_fraction', hiPhi * 100) + ' for this recipe.' });
    else if (need.side === 'max' && loPhi != null && need.phi < loPhi) out.push({ key: m.key, needPhi: need.phi, text: name + ' ' + tgtFmt(m.key, m.value) + ' needs at most ' + tgtFmt('volume_fraction', need.phi * 100) + ' solid; Sweep goes down to ' + tgtFmt('volume_fraction', loPhi * 100) + ' for this recipe.' });
  }
  return out;
}
/* Is this design pressed against a limit the target is past? (stops the rounds) */
function tgtAtLimit(d, T, warnings) {
  if (!d || !warnings || !warnings.length) return false;
  const p = tgtNum(d.volume_fraction) ? d.volume_fraction / 100 : null;
  if (p == null) return false;
  return warnings.some(w => {
    const m = T.metrics.find(x => x.key === w.key), info = TGT_METRICS[w.key];
    if (!m || !info || !info.bound) return false;
    const v = tgtValue(d, m), lim = info.bound.f(p, m);
    if (!tgtNum(v) || !(lim > 0)) return false;
    return info.bound.kind === 'max' ? v >= 0.9 * lim : v <= 1.1 * lim;
  });
}

/* ── the link from F13LD.vault ─────────────────────────────────────
   #r=<recipe JSON>&t=<target JSON>, each encodeURIComponent'd (Mesh and Lab
   read the same #r=). t = {
     v: 1, metrics: [{ key, value, scale? }],
     seed:    { id, name, family, reason: 'reach' | 'nearest', residual },
     density: { lo, hi, predicted } in %, spread (0–1), variation,
     cell_size_mm, tol
   } — every part optional except metrics. */
function tgtParseHash(hash) {
  const out = { recipe: null, target: null, error: null };
  if (!hash || hash.length < 4) return out;
  const parts = hash.replace(/^#/, '').split('&');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq), raw = p.slice(eq + 1);
    if (k !== 'r' && k !== 't') continue;
    try {
      const v = JSON.parse(decodeURIComponent(raw));
      if (k === 'r') out.recipe = v; else out.target = v;
    } catch (e) { out.error = (k === 'r' ? 'recipe' : 'target') + ' in the link is not valid JSON'; }
  }
  return out;
}
/* A target from the link, checked: known metrics with finite values only. */
function tgtFromLink(t) {
  if (!t || !Array.isArray(t.metrics)) return null;
  const metrics = t.metrics.filter(m => m && TGT_METRICS[m.key] && m.value != null && m.value !== '' && typeof m.value !== 'boolean' && tgtNum(+m.value)).slice(0, 3)
    .map(m => { const o = { key: m.key, value: +m.value }; if (tgtNum(+m.scale) && +m.scale > 0) o.scale = +m.scale; return o; });
  if (!metrics.length) return null;
  const tol = tgtNum(+t.tol) && +t.tol > 0 && +t.tol < 1 ? +t.tol : TGT_DEFAULTS.tol;
  const s = t.seed || {};
  return Object.assign({}, TGT_DEFAULTS, {
    metrics, tol,
    source: { tool: 'f13ld.vault', id: s.id != null ? String(s.id) : null, name: s.name || null, reason: s.reason || null, residual: tgtNum(s.residual) ? s.residual : null }
  });
}
