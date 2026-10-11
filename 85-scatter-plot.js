/* ============================================================
   F13LD.sweep · 85-scatter-plot.js
   The 3D design space (v0.29.3 — rebuilt on F13LD.vault's hero view).

   Axes are the three rank metrics in their own units (min · mid · max
   ticks); with a target they are the target's metrics. Points are drawn by
   SweepPointLayer (84-points-gl.js, WebGL); this file owns the camera, the
   overlay canvas (cube, axes, ticks, whiskers, markers, rings), picking, the
   axis chips, the tooltip and the empty states.

   Both canvases are sized to the pane × the screen's pixel density on every
   frame, so the plot stays sharp at any pane size (before v0.29.3 it drew
   into the canvas's default 300 × 150 and was stretched).

   Controls (as Vault): drag orbits · Ctrl, right or middle drag pans ·
   wheel zooms · double-click resets · hover previews · click selects.
   Touch: one finger orbits, two pinch-zoom and pan, tap selects.
   Alive (default on) drifts the view slowly when left alone.

   Public: drawPlot() (marks the view for redraw), updatePlot(data),
   plotSetEmpty(kind, info), plotRunState(busy), getPlotAxes(), plotData,
   METRIC_LABELS.
   ============================================================ */

const plotHost = document.getElementById('plotHost');
const plotGL = document.getElementById('plotGL');
const plotCanvas = document.getElementById('plotCanvas');   /* overlay: input + 2D marks */
const pctx = plotCanvas.getContext('2d');
const plotPts = new SweepPointLayer(plotGL);
let plotData = [];
let plotHovered = null;

const PLOT_YAW = -0.62, PLOT_PITCH = -0.36, PLOT_DST = 4.6;
const plotCam = { yaw: PLOT_YAW, pitch: PLOT_PITCH, zoom: 1, zT: 1, c: [0, 0, 0], cT: [0, 0, 0], yawT: null, pitchT: null };
const plotV = { W: 0, H: 0, dpr: 1, S0: 200, cx: 0, cy: 0, safe: [0, 0], small: false };
const PLOT_ALIVE_KEY = 'f13ld.sweep.alive.v1';
let plotAlive = (function () {
  try { const v = localStorage.getItem(PLOT_ALIVE_KEY); if (v === '0') return false; if (v === '1') return true; } catch (e) { /* storage blocked */ }
  try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* old browser */ }
  return true;   /* Matt, 2026-10-11: on by default */
})();
let plotDirty = true, plotLastInt = -1e9, plotLastT = 0, plotDragS = null, plotPinch = null, plotLastUp = -1e9, plotDbl = false;
const plotPtrs = new Map();
let plotProj = [];          /* [{ d, sx, sy, z }] — screen positions for picking */
let plotEmptyKind = 'none'; /* 'none' | 'recipe' | 'filtered' | null (data shown) */
let plotChipSig = '';

const METRIC_LABELS = {
  anisotropy:'α (Aniso)', Ex_GPa:'Ex', Ey_GPa:'Ey', Ez_GPa:'Ez',
  Gyz_GPa:'Gyz', Gxz_GPa:'Gxz', Gxy_GPa:'Gxy',
  stiffness_density:'E/ρ', aniso_efficiency:'α/ρ', directionality:'Ψ (Direct.)',
  ortho_contrast:'Ω (Ortho)', connect_idx:'κ (Connect)',
  stiff_axis:'Stiff Axis', keff_x:'kx', keff_y:'ky', keff_z:'kz',
  thermal_anisotropy:'kα (T.Aniso)', k_density:'k/ρ',
  U_strain:'U (Strain)', microstrain_x:'με·X', microstrain_y:'με·Y', microstrain_z:'με·Z',
  microstrain_avg:'με̄ (avg)', pore_size:'φ (µm)', throat_size:'φt (µm)', throat_ratio:'φt/φ', perc_idx:'perc', surface_complexity:'SA/V', volume_fraction:'ρ%',
};
/* v0.29.3 — units shown on the axis chips (only where the unit is fixed) */
const METRIC_UNITS = {
  Ex_GPa:'GPa', Ey_GPa:'GPa', Ez_GPa:'GPa', Gyz_GPa:'GPa', Gxz_GPa:'GPa', Gxy_GPa:'GPa',
  microstrain_x:'με', microstrain_y:'με', microstrain_z:'με', microstrain_avg:'με',
};

function getPlotAxes() {
  /* v0.28.0 — with a target the plot shows its metrics (13-target.js) */
  if (typeof TARGET !== 'undefined' && TARGET && TARGET.metrics.length) {
    const ks = TARGET.metrics.map(m => m.key), hasVF = ks.indexOf('volume_fraction') >= 0;
    return { x: 'tgt_0', y: ks.length > 1 ? 'tgt_1' : (hasVF ? 'anisotropy' : 'volume_fraction'),
             z: ks.length > 2 ? 'tgt_2' : (hasVF || ks.length < 2 ? 'tgt_off' : 'volume_fraction') };
  }
  return {
    x: document.getElementById('r1metric')?.value === 'none' ? 'anisotropy' : (document.getElementById('r1metric')?.value || 'anisotropy'),   /* v0.27.1: rank 1 can be off */
    y: document.getElementById('r2metric')?.value === 'none' ? 'Ex_GPa' : (document.getElementById('r2metric')?.value || 'Ex_GPa'),
    z: document.getElementById('r3metric')?.value === 'none' ? 'volume_fraction' : (document.getElementById('r3metric')?.value || 'volume_fraction'),
  };
}

/* v0.29.3 — rank r (1–3) switched off in Configure (its axis shows a default metric) */
function plotRankOff(r) { return !plotTargetOn() && document.getElementById('r' + r + 'metric')?.value === 'none'; }
function plotTargetOn() { return typeof TARGET !== 'undefined' && TARGET && TARGET.metrics.length > 0; }
/* v0.28.0 — axis label (target metrics by their symbol) */
function plotAxisLabel(key) {
  if (key === 'tgt_off') return 'off target';
  if (/^tgt_\d$/.test(key) && TARGET && TARGET.metrics[+key.slice(4)]) return tgtLabel(TARGET.metrics[+key.slice(4)]);
  return METRIC_LABELS[key] || key;
}
function plotAxisUnit(key) {
  if (/^tgt_\d$/.test(key) && TARGET && TARGET.metrics[+key.slice(4)]) return METRIC_UNITS[TARGET.metrics[+key.slice(4)].key] || '';
  return METRIC_UNITS[key] || '';
}
/* The value a target puts on an axis (null when the target leaves it free). */
function plotTargetValue(key) {
  if (!plotTargetOn()) return null;
  if (key === 'tgt_off') return 0;
  if (/^tgt_\d$/.test(key)) { const m = TARGET.metrics[+key.slice(4)]; return m && Number.isFinite(m.value) ? m.value : null; }
  return null;
}
/* Axis span over the designs, the auto-target trail and the target itself. */
function plotRange(key) {
  const tOn = plotTargetOn();
  /* without a target: as before v0.28.0 (a missing value counts as 0) */
  const v = tOn ? plotData.map(d => d[key]).filter(x => typeof x === 'number' && Number.isFinite(x)) : plotData.map(d => d[key] || 0);
  if (tOn && TARGET_RUN.trail.length) TARGET_RUN.trail.forEach(t => { const x = t[key]; if (typeof x === 'number' && Number.isFinite(x)) v.push(x); });
  const tv = plotTargetValue(key); if (tv != null) v.push(tv);
  if (!v.length) return { mn: 0, mx: 1, range: 1, flat: true };
  let mn = v[0], mx = v[0];
  for (const x of v) { if (x < mn) mn = x; if (x > mx) mx = x; }
  return { mn, mx, range: mx - mn || 1, flat: mx === mn };
}
/* value → [-1, 1]; an axis where every design is equal sits in the middle */
function plotNorm(v, mm) { return mm.flat ? 0 : (v - mm.mn) / mm.range * 2 - 1; }

/* Numbers on ticks and in the tooltip: digits by magnitude, the axis's unit
   where it reads better attached (%, ×). */
function plotNum(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}
function plotFmt(key, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (key === 'tgt_off') return (v * 100).toFixed(1) + '%';
  if (/^tgt_\d$/.test(key) && TARGET && TARGET.metrics[+key.slice(4)]) return tgtFmt(TARGET.metrics[+key.slice(4)].key, v);
  if (key === 'volume_fraction') return plotNum(v) + '%';
  if (key === 'anisotropy') return plotNum(v) + '×';
  return plotNum(v);
}

/* ── colours ──────────────────────────────────────────────────────── */
function plotRGB(hex) {
  const h = String(hex || '#888888').replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function plotRGBA(hex, a) { const c = plotRGB(hex); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a.toFixed(3)})`; }

/* ── camera ───────────────────────────────────────────────────────── */
function plotProject(x, y, z) {
  const c = plotCam.c; x -= c[0]; y -= c[1]; z -= c[2];
  const cyw = Math.cos(plotCam.yaw), syw = Math.sin(-plotCam.yaw), cp = Math.cos(plotCam.pitch), sp = Math.sin(-plotCam.pitch);
  const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, pp = PLOT_DST / (PLOT_DST - z2);
  return [plotV.cx + x1 * plotV.S0 * pp, plotV.cy - y2 * plotV.S0 * pp, z2, pp];
}
function plotPanBy(c0, dx, dy) {
  const k = 1 / (plotV.S0 || 200), cy = Math.cos(plotCam.yaw), sy = Math.sin(plotCam.yaw), cp = Math.cos(plotCam.pitch), sp = Math.sin(plotCam.pitch);
  const r = [cy, 0, -sy], u = [sp * sy, cp, sp * cy];
  for (let i = 0; i < 3; i++) plotCam.cT[i] = plotCam.c[i] = Math.max(-2.5, Math.min(2.5, c0[i] - (dx * r[i] - dy * u[i]) * k));
}
function plotReset() {
  plotCam.cT = [0, 0, 0]; plotCam.zT = 1;
  const d = ((PLOT_YAW - plotCam.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  plotCam.yawT = plotCam.yaw + d; plotCam.pitchT = PLOT_PITCH; plotDirty = true;
}
function plotStep(now, dt) {
  let busy = false;
  if (plotAlive && !plotDragS && !plotPinch && now - plotLastInt > 2600 && plotCam.yawT === null) { plotCam.yaw += dt * 0.00008; busy = true; }
  if (plotCam.yawT !== null) {
    plotCam.yaw += (plotCam.yawT - plotCam.yaw) * 0.1; plotCam.pitch += (plotCam.pitchT - plotCam.pitch) * 0.1; busy = true;
    if (Math.abs(plotCam.yawT - plotCam.yaw) < 0.002 && Math.abs(plotCam.pitchT - plotCam.pitch) < 0.002) { plotCam.yaw = plotCam.yawT; plotCam.pitch = plotCam.pitchT; plotCam.yawT = plotCam.pitchT = null; }
  }
  for (let k = 0; k < 3; k++) { const dc = plotCam.cT[k] - plotCam.c[k]; if (Math.abs(dc) > 1e-4) { plotCam.c[k] += dc * 0.08; busy = true; } }
  if (Math.abs(plotCam.zT - plotCam.zoom) > 1e-4) { plotCam.zoom += (plotCam.zT - plotCam.zoom) * 0.08; busy = true; }
  return busy;
}

/* ── frame ────────────────────────────────────────────────────────── */
function drawPlot() { plotDirty = true; }
function resizePlot() { plotDirty = true; }   /* kept for older callers */

function plotLayout() {
  const W = plotHost.clientWidth, H = plotHost.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const chips = document.getElementById('plotAxes');
  const top = 16;   /* the view buttons sit in the corner, clear of the centred cube */
  let bot = 22;
  if (chips && chips.offsetParent && chips.childElementCount) bot = Math.max(bot, H - chips.offsetTop + 8);
  const avail = Math.max(120, H - top - bot);
  plotV.W = W; plotV.H = H; plotV.dpr = dpr; plotV.small = W < 480;
  /* the cube with its axis rays spans about 2.4 × S0 on screen: fill the
     pane's height (it is usually wide and short), capped by its width */
  /* phones: a squarer pane, and the Z ray swings toward the chips — a little smaller and higher */
  plotV.S0 = Math.min(W * 0.3, avail * (plotV.small ? 0.3 : 0.34)) * plotCam.zoom * (plotData.length ? 1 : 0.78);   /* the empty cube stays a backdrop behind its card */
  plotV.cx = W / 2; plotV.cy = top + avail * (plotV.small ? 0.42 : 0.48);
  plotV.safe = [4, H - bot + 12];
}

function plotFrame(now) {
  requestAnimationFrame(plotFrame);
  const dt = Math.min(64, now - (plotLastT || now)); plotLastT = now;
  if (!plotHost.offsetWidth || !plotHost.offsetHeight) return;
  const busy = plotStep(now, dt);
  const sel = typeof selectedDesign !== 'undefined' && selectedDesign && plotData.indexOf(selectedDesign) >= 0;
  if (!busy && !plotDirty && !sel) return;
  plotRender(now);
  plotDirty = false;
}

function plotRender(now) {
  plotLayout();
  const { W, H, dpr } = plotV;
  const Wd = Math.round(W * dpr), Hd = Math.round(H * dpr);
  if (plotCanvas.width !== Wd || plotCanvas.height !== Hd) { plotCanvas.width = Wd; plotCanvas.height = Hd; }
  const ctx = pctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

  const has = plotData.length > 0;
  const axes = getPlotAxes();
  plotChips(axes);
  const fade = has ? 1 : 0.8;

  /* floor grid — tinted toward Sweep's amber (Vault's is blue) */
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const t = -1 + i * 0.5;
    ctx.strokeStyle = `rgba(227,155,74,${(0.065 * fade).toFixed(3)})`;
    let a = plotProject(t, -1, -1), b = plotProject(t, -1, 1);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    a = plotProject(-1, -1, t); b = plotProject(1, -1, t);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  /* cube, edges shaded by depth */
  const CN = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p => plotProject(p[0], p[1], p[2]));
  [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(e => {
    const z = (CN[e[0]][2] + CN[e[1]][2]) / 2;
    ctx.strokeStyle = `rgba(154,159,183,${((0.08 + 0.12 * (z + 1.7) / 3.4) * fade).toFixed(3)})`;
    ctx.beginPath(); ctx.moveTo(CN[e[0]][0], CN[e[0]][1]); ctx.lineTo(CN[e[1]][0], CN[e[1]][1]); ctx.stroke();
  });

  /* labels: each goes through place(), skipped if it would collide with one
     already drawn or leave the safe band; dark halo so it reads over points */
  const occ = [], safe = plotV.safe;
  const place = (txt, x, y, font, col) => {
    ctx.font = font; const tw = ctx.measureText(txt).width, b = [x - tw / 2 - 3, y - 8, x + tw / 2 + 3, y + 8];
    if (b[1] < safe[0] || b[3] > safe[1] || b[0] < 4 || b[2] > W - 4) return false;
    for (const o of occ) if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
    occ.push(b); ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(6,8,15,0.9)'; ctx.strokeText(txt, x, y);
    ctx.fillStyle = col; ctx.fillText(txt, x, y); return true;
  };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  /* axis rays from the origin corner */
  [[1,0,0,'X'],[0,1,0,'Y'],[0,0,1,'Z']].forEach(ax => {
    const o = CN[0], e = plotProject(-1 + 2.12 * ax[0], -1 + 2.12 * ax[1], -1 + 2.12 * ax[2]);
    ctx.strokeStyle = `rgba(200,245,66,${has ? 0.4 : 0.2})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    if (has) place(ax[3], e[0], e[1], '700 13px "Exo 2",sans-serif', 'rgba(200,245,66,0.98)');
  });

  if (!has) { plotProj = []; plotPts.clear(); return; }

  const nx = plotRange(axes.x), ny = plotRange(axes.y), nz = plotRange(axes.z);
  const R = { x: nx, y: ny, z: nz };

  /* value ticks: max first (it sits away from the crowded origin corner) */
  if (!plotV.small) {
    [['mx', 0.94], ['mid', 0], ['mn', -0.94]].forEach(tk => {
      ['x', 'y', 'z'].forEach(k => {
        const g = R[k]; if (g.flat && tk[0] !== 'mid') return;
        const v = tk[0] === 'mx' ? g.mx : tk[0] === 'mn' ? g.mn : (g.flat ? g.mn : (g.mn + g.mx) / 2), f = tk[1];
        const q0 = k === 'x' ? plotProject(f, -1, -1) : k === 'y' ? plotProject(-1, f, -1) : plotProject(-1, -1, f);
        const q = k === 'x' ? plotProject(f, -1.16, -1) : k === 'y' ? plotProject(-1.2, f, -1) : plotProject(-1.16, -1, f);
        ctx.fillStyle = 'rgba(200,245,66,0.5)'; ctx.beginPath(); ctx.arc(q0[0], q0[1], 1.6, 0, 6.2832); ctx.fill();
        place(plotFmt(axes[k], v), q[0], q[1], '500 11px "JetBrains Mono",monospace', 'rgba(154,159,183,0.85)');
      });
    });
  }

  /* designs → cube positions */
  const tOn = plotTargetOn();
  const finite3 = d => [axes.x, axes.y, axes.z].every(k => typeof d[k] === 'number' && Number.isFinite(d[k]));
  const shown = plotData.filter(d => !tOn || finite3(d));   /* v0.28.0 — with a target, a design missing an axis value isn't drawn */
  const N = shown.length, items = [];
  plotProj = new Array(N);
  shown.forEach((d, i) => {
    const px = plotNorm(d[axes.x] || 0, nx), py = plotNorm(d[axes.y] || 0, ny), pz = plotNorm(d[axes.z] || 0, nz);
    const fr = d.filterRank || 999, top = colorMode === 'rank' && fr <= 3;
    const pr = plotProject(px, py, pz);
    plotProj[i] = { d, sx: pr[0], sy: pr[1], z: pr[2], pp: pr[3], top };
    items.push({ p: [px, py, pz], c: plotRGB(getPointColor(d, fr, N)), s: top ? 8 : 5.2, a: top ? 1 : 0.9, lit: true });
  });
  /* v0.28.0 — the auto-target rounds, faded (oldest faintest), in the dim pass */
  if (tOn && TARGET_RUN.trail.length) {
    const nR = Math.max(1, ...TARGET_RUN.trail.map(t => t._round || 1));
    TARGET_RUN.trail.forEach(t => {
      const a = t[axes.x], b = t[axes.y], c = t[axes.z];
      if (![a, b, c].every(v => typeof v === 'number' && Number.isFinite(v))) return;
      items.push({ p: [plotNorm(a, nx), plotNorm(b, ny), plotNorm(c, nz)], c: [0.5, 0.53, 0.66], s: 4, a: 0.25 + 0.6 * ((t._round || 1) / nR), lit: false });
    });
  }

  /* ideal corner (or, with a target, the target) */
  /* an axis whose rank is off has no ideal end: the marker sits mid-way along it */
  const idealAt = r => plotRankOff(r) ? 0 : (directions[r] || 'max') === 'max' ? 1 : -1;
  let ix = idealAt(1), iy = idealAt(2), iz = idealAt(3);
  let tgtFree = false;
  if (tOn) {
    const tx = plotTargetValue(axes.x), ty = plotTargetValue(axes.y), tz = plotTargetValue(axes.z);
    ix = tx != null ? plotNorm(tx, nx) : 0; iy = ty != null ? plotNorm(ty, ny) : 0;
    tgtFree = tz == null; iz = tz != null ? plotNorm(tz, nz) : 0;
  }
  const ideal = plotProject(ix, iy, iz);
  if (tOn && tgtFree) {   /* the target leaves this axis free: a column through it */
    const c0 = plotProject(ix, iy, -1), c1 = plotProject(ix, iy, 1), gr = ctx.createLinearGradient(c0[0], c0[1], c1[0], c1[1]);
    gr.addColorStop(0, 'rgba(200,245,66,0.05)'); gr.addColorStop(0.5, 'rgba(200,245,66,0.5)'); gr.addColorStop(1, 'rgba(200,245,66,0.05)');
    ctx.strokeStyle = gr; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.stroke();
  }
  /* whiskers from the ideal to the top three */
  const top3 = plotProj.filter(p => p.top).sort((a, b) => a.d.filterRank - b.d.filterRank);
  top3.forEach(p => {
    const c = getPointColor(p.d, p.d.filterRank, N), g = ctx.createLinearGradient(ideal[0], ideal[1], p.sx, p.sy);
    g.addColorStop(0, plotRGBA(c, 0.05)); g.addColorStop(1, plotRGBA(c, 0.6));
    ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(ideal[0], ideal[1]); ctx.lineTo(p.sx, p.sy); ctx.stroke(); ctx.setLineDash([]);
  });

  /* the points: WebGL when it's there, else a 2D fallback on the overlay */
  plotPts.fill(items);
  if (plotPts.ok && !plotPts.lost) {
    plotPts.draw({ dpr, c: plotCam.c, yaw: plotCam.yaw, pitch: plotCam.pitch, S0: plotV.S0, dst: PLOT_DST, cx: plotV.cx, cy: plotV.cy });
  } else {
    const order = items.map((it, i) => ({ it, pr: plotProject(it.p[0], it.p[1], it.p[2]) })).sort((a, b) => a.pr[2] - b.pr[2]);
    order.forEach(o => {
      const dep = Math.max(0, Math.min(1, (o.pr[2] + 1.7) / 3.4)), r = o.it.s * Math.sqrt(o.pr[3]) / 2;
      const c = o.it.lit ? o.it.c : [0.5, 0.53, 0.66];
      ctx.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${(o.it.a * (o.it.lit ? 0.6 + 0.4 * dep : 0.5)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(o.pr[0], o.pr[1], o.it.lit ? r : r * 0.8, 0, 6.2832); ctx.fill();
    });
  }

  /* rings and rank tags on the top three */
  top3.forEach(p => {
    const c = getPointColor(p.d, p.d.filterRank, N), r = 4.25 * Math.sqrt(p.pp) + 3;
    ctx.strokeStyle = plotRGBA(c, 0.9); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 6.2832); ctx.stroke();
  });
  top3.forEach(p => { const c = getPointColor(p.d, p.d.filterRank, N);
    if (!place('#' + p.d.filterRank, p.sx + 15, p.sy - 13, '600 11px "JetBrains Mono",monospace', c)) place('#' + p.d.filterRank, p.sx - 15, p.sy + 14, '600 11px "JetBrains Mono",monospace', c); });

  /* ideal / target marker on top */
  const cross = (x, y, a, b) => { ctx.beginPath(); [[-b, 0, -a, 0], [a, 0, b, 0], [0, -b, 0, -a], [0, a, 0, b]].forEach(s => { ctx.moveTo(x + s[0], y + s[1]); ctx.lineTo(x + s[2], y + s[3]); }); ctx.stroke(); };
  if (tOn) {   /* v0.28.0 — the target: neon crosshair */
    ctx.strokeStyle = '#c8f542'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(ideal[0], ideal[1], 7, 0, 6.2832); ctx.stroke();
    cross(ideal[0], ideal[1], 4, 13);
    place('target', ideal[0], ideal[1] + 24, '600 11px "JetBrains Mono",monospace', '#c8f542');
  } else {
    ctx.strokeStyle = 'rgba(228,230,242,0.75)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(ideal[0], ideal[1], 5.5, 0, 6.2832); ctx.stroke();
    cross(ideal[0], ideal[1], 3, 10);
    place('ideal', ideal[0], ideal[1] + 20, '500 11px "JetBrains Mono",monospace', 'rgba(228,230,242,0.7)');
  }

  /* selection: Vault's pulse ring (white here — it has to read over amber) */
  const selD = typeof selectedDesign !== 'undefined' ? selectedDesign : null;
  const sp = selD ? plotProj.find(p => p.d === selD) : null;
  if (sp) {
    const ph = (now % 1700) / 1700;
    ctx.strokeStyle = `rgba(242,244,255,${(0.8 * (1 - ph)).toFixed(3)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sp.sx, sp.sy, 8 + ph * 24, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = '#f2f4ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.sx, sp.sy, 9 + 1.2 * Math.sin(now / 260), 0, 6.2832); ctx.stroke();
  }
  const hp = plotHovered ? plotProj.find(p => p.d === plotHovered) : null;
  if (hp && hp !== sp) { ctx.strokeStyle = 'rgba(228,230,242,0.9)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(hp.sx, hp.sy, 8, 0, 6.2832); ctx.stroke(); }
}

/* ── axis chips ───────────────────────────────────────────────────── */
function plotChips(axes) {
  const el = document.getElementById('plotAxes'); if (!el) return;
  const has = plotData.length > 0, tOn = plotTargetOn();
  const sig = has + '|' + tOn + '|' + axes.x + axes.y + axes.z + '|' + directions[1] + directions[2] + directions[3] + [1, 2, 3].map(plotRankOff).join('') + '|' + (tOn ? TARGET.metrics.map(m => m.value).join(',') : '');
  if (sig === plotChipSig) return;
  plotChipSig = sig; plotDirty = true;
  if (!has) { el.innerHTML = ''; el.hidden = true; return; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.hidden = false;
  el.innerHTML = ['x', 'y', 'z'].map((k, i) => {
    const key = axes[k], unit = plotAxisUnit(key);
    let dir;
    if (tOn) { const tv = plotTargetValue(key); dir = key === 'tgt_off' ? 'lower is closer' : tv != null ? 'target ' + plotFmt(key, tv) : 'free'; }
    else dir = plotRankOff(i + 1) ? 'unranked' : (directions[i + 1] || 'max') === 'max' ? 'max' : 'min';
    const tip = tOn ? 'Target axis — set in F13LD.vault or the Target settings' : `Rank ${i + 1} metric — change it in Configure`;
    return `<span class="pchip" title="${esc(tip)}"><b>${k.toUpperCase()}</b><span class="nm">${esc(plotAxisLabel(key))}</span>${unit ? `<span class="u">${esc(unit)}</span>` : ''}<span class="dir">${esc(dir)}</span></span>`;
  }).join('');
}

/* ── empty states ─────────────────────────────────────────────────── */
/* kind: 'none' (no recipe) · 'recipe' (loaded, not run; info = { family, name }) · 'running' · 'filtered' · null (designs shown) */
function plotSetEmpty(kind, info) {
  plotEmptyKind = kind;
  const box = document.getElementById('plotEmpty'), t1 = document.getElementById('plotEmptyT1'), t2 = document.getElementById('plotEmptyT2'), fam = document.getElementById('plotEmptyFam');
  const badge = document.getElementById('plotBadge');
  if (!box) return;
  box.classList.toggle('hidden', !kind);
  plotHost.classList.toggle('has-data', !kind);
  if (kind === 'none') plotRecipeInfo = null;
  if (kind === 'recipe') {
    plotRecipeInfo = info || null;
    t1.textContent = 'Recipe loaded'; t2.textContent = 'Press Run to sample the design space';
    const bits = [info && info.family, info && info.name].filter(Boolean);
    fam.textContent = bits.join(' · '); fam.hidden = !bits.length;
    if (badge) badge.textContent = 'ready to run';
  } else if (kind === 'running') {
    t1.textContent = 'Sweeping'; t2.textContent = 'Designs appear here when the run finishes';
    fam.hidden = !fam.textContent; if (badge) badge.textContent = 'running';
  } else if (kind === 'filtered') {
    t1.textContent = 'No designs pass the filters'; t2.textContent = 'Loosen a filter in Configure to bring designs back';
    fam.hidden = true; if (badge) badge.textContent = '0 designs';
  } else if (kind === 'none') {
    t1.textContent = 'No recipe loaded'; t2.textContent = 'Drop a recipe, pick one from the header, or push one from F13LD.vault';
    fam.hidden = true; if (badge) badge.textContent = 'no recipe';
  }
  plotDirty = true;
}

/* v0.29.3 — the Run button's state (setRunBtn, 23-dock.js) drives the empty card while no designs are shown */
let plotRecipeInfo = null;
function plotRunState(busy) {
  if (plotData.length) return;
  if (busy) plotSetEmpty('running');
  else if (plotEmptyKind === 'running') plotSetEmpty(typeof results !== 'undefined' && results.length ? 'filtered' : (plotRecipeInfo ? 'recipe' : 'none'), plotRecipeInfo);
}

function updatePlot(data) {
  plotData = data;
  if (data.length) {
    plotSetEmpty(null);
    document.getElementById('plotBadge').textContent = `${data.length} designs`;
  } else plotSetEmpty(typeof results !== 'undefined' && results.length ? 'filtered' : 'none');
  // Run clustering whenever data updates so Terms mode is ready
  if (data.length >= 6) runKMeans(data, 6);
  if (plotHovered && data.indexOf(plotHovered) < 0) { plotHovered = null; plotTip(null); }
  plotDirty = true;
}

/* ── picking, tooltip, hover link ─────────────────────────────────── */
function plotPick(x, y, r) {
  let best = null, bd = r * r, bz = -1e9;
  for (const p of plotProj) {
    const dx = p.sx - x, dy = p.sy - y, q = dx * dx + dy * dy;
    if (q < bd || (q < bd * 1.15 && p.z > bz)) { bd = q; best = p.d; bz = p.z; }
  }
  return best;
}
function plotTip(d, x, y) {
  const tip = document.getElementById('plotTip'); if (!tip) return;
  if (!d) { tip.hidden = true; return; }
  const axes = getPlotAxes(), esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const row = (lbl, v) => `<div class="r"><i>${esc(lbl)}</i><span>${esc(v)}</span></div>`;
  let h = `<div class="id">#${esc(d.id)}<span>rank ${d.filterRank || '—'}</span></div>`;
  ['x', 'y', 'z'].forEach(k => { const u = plotAxisUnit(axes[k]); h += row(plotAxisLabel(axes[k]), plotFmt(axes[k], d[axes[k]]) + (u && u !== '%' ? ' ' + u : '')); });
  if (axes.x !== 'anisotropy' && axes.y !== 'anisotropy' && axes.z !== 'anisotropy' && typeof d.anisotropy === 'number') h += row('α (Aniso)', plotFmt('anisotropy', d.anisotropy));
  if (d.stiffness_flag) h += '<div class="fl">stiffness may read high</div>';
  tip.innerHTML = h; tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(6, Math.min(x + 14, plotV.W - tw - 6)) + 'px';
  tip.style.top = Math.max(6, Math.min(y - th - 10, plotV.H - th - 6)) + 'px';
}
function plotSetHover(d) {
  if (d === plotHovered) return;
  plotHovered = d; plotDirty = true;
  if (!d) return;
  showPreview(d);
  // highlight table row
  document.querySelectorAll('tr.hovered-row').forEach(r => r.classList.remove('hovered-row'));
  const row = document.querySelector(`tr[data-design-id="${d.id}"]`);
  if (row) { row.classList.add('hovered-row'); row.scrollIntoView({ block: 'nearest' }); }
}

/* ── input ────────────────────────────────────────────────────────── */
function plotLocal(e) { const r = plotCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
plotCanvas.addEventListener('contextmenu', e => e.preventDefault());
plotCanvas.addEventListener('pointerdown', e => {
  const p = plotLocal(e);
  try { plotCanvas.setPointerCapture(e.pointerId); } catch (x) { /* synthetic events */ }
  plotPtrs.set(e.pointerId, p); plotLastInt = performance.now(); plotCam.yawT = plotCam.pitchT = null;
  if (plotPtrs.size === 2) {
    const q = Array.from(plotPtrs.values());
    plotPinch = { d0: Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]), z0: plotCam.zT, m0: [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], c0: plotCam.cT.slice() };
    plotDragS = null; return;
  }
  const pan = e.ctrlKey || e.metaKey || e.button === 1 || e.button === 2;
  plotDragS = { x0: p[0], y0: p[1], yaw0: plotCam.yaw, pitch0: plotCam.pitch, c0: plotCam.cT.slice(), moved: false, pan, touch: e.pointerType === 'touch' };
  if (pan) e.preventDefault();
});
plotCanvas.addEventListener('pointermove', e => {
  const p = plotLocal(e);
  if (plotPtrs.has(e.pointerId)) plotPtrs.set(e.pointerId, p);
  if (plotPinch && plotPtrs.size === 2) {
    const q = Array.from(plotPtrs.values()), pc = plotPinch, dd = Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]);
    plotCam.zT = plotCam.zoom = Math.max(0.55, Math.min(3, pc.z0 * dd / (pc.d0 || 1)));
    plotPanBy(pc.c0, (q[0][0] + q[1][0]) / 2 - pc.m0[0], (q[0][1] + q[1][1]) / 2 - pc.m0[1]);
    plotLastInt = performance.now(); plotDirty = true; return;
  }
  const g = plotDragS;
  if (!g) {
    if (e.pointerType === 'touch') return;
    const h = plotPick(p[0], p[1], 14);
    plotSetHover(h); plotTip(h, p[0], p[1]);
    plotCanvas.style.cursor = h ? 'pointer' : 'grab';
    return;
  }
  const dx = p[0] - g.x0, dy = p[1] - g.y0;
  if (Math.hypot(dx, dy) > 4) g.moved = true;
  plotLastInt = performance.now(); plotDirty = true;
  if (g.pan) { plotPanBy(g.c0, dx, dy); plotCanvas.style.cursor = 'move'; return; }
  plotCam.yaw = g.yaw0 + dx * 0.008; plotCam.pitch = Math.max(-1.35, Math.min(0.55, g.pitch0 - dy * 0.006));
  if (g.moved && plotHovered) { plotSetHover(null); plotTip(null); }
});
function plotUp(e) {
  plotPtrs.delete(e.pointerId); if (plotPtrs.size < 2) plotPinch = null;
  const g = plotDragS; plotDragS = null; if (!g) return;
  plotCanvas.style.cursor = 'grab';
  const tUp = performance.now(), second = !g.moved && tUp - plotLastUp < 320;   /* 2nd click of a double-click resets, never picks */
  if (!g.moved) plotLastUp = second ? -1e9 : tUp;
  if (!g.moved && !plotDbl && !second) {
    const p = plotLocal(e), d = plotPick(p[0], p[1], g.touch ? 24 : 14);
    if (d) { selectDesign(d, { scroll: true }); if (g.touch) { plotSetHover(d); plotTip(d, p[0], p[1]); } plotDirty = true; }
    else if (g.touch) plotTip(null);
  }
}
plotCanvas.addEventListener('pointerup', plotUp);
plotCanvas.addEventListener('pointercancel', plotUp);
plotCanvas.addEventListener('pointerleave', () => { if (!plotDragS && plotHovered) { plotSetHover(null); plotTip(null); } });
plotCanvas.addEventListener('wheel', e => {
  e.preventDefault(); plotCam.zT = Math.max(0.55, Math.min(3, plotCam.zT * (1 - e.deltaY * 0.0012))); plotLastInt = performance.now(); plotDirty = true;
}, { passive: false });
plotCanvas.addEventListener('dblclick', () => { plotDbl = true; setTimeout(() => { plotDbl = false; }, 300); plotReset(); });

function plotSetAlive(on) {
  plotAlive = !!on;
  const b = document.getElementById('plotAliveBtn');
  if (b) { b.classList.toggle('on', plotAlive); b.setAttribute('aria-pressed', plotAlive ? 'true' : 'false'); }
  try { localStorage.setItem(PLOT_ALIVE_KEY, plotAlive ? '1' : '0'); } catch (e) { /* storage blocked */ }
}
document.getElementById('plotResetBtn')?.addEventListener('click', plotReset);
document.getElementById('plotAliveBtn')?.addEventListener('click', () => plotSetAlive(!plotAlive));
plotSetAlive(plotAlive);

if (typeof ResizeObserver === 'function') new ResizeObserver(() => { plotDirty = true; }).observe(plotHost);
window.addEventListener('resize', () => { plotDirty = true; });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { plotDirty = true; });
plotSetEmpty('none');
requestAnimationFrame(plotFrame);
