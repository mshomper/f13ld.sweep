/* ============================================================
   F13LD.sweep · 85-scatter-plot.js
   3D design-space scatter plot.
   ============================================================ */

// ─── 3D Scatter Plot ──────────────────────────────────────────────────────────
const plotCanvas = document.getElementById('plotCanvas');
const pctx = plotCanvas.getContext('2d');
let plotData = [];
let plotRot = { x: 0.45, y: 0.6 };
let plotDrag = false, plotLx = 0, plotLy = 0;
let plotHovered = null;

const METRIC_LABELS = {
  anisotropy:'α (Aniso)', Ex_GPa:'Ex', Ey_GPa:'Ey', Ez_GPa:'Ez',
  Gyz_GPa:'Gyz', Gxz_GPa:'Gxz', Gxy_GPa:'Gxy',
  stiffness_density:'E/ρ', aniso_efficiency:'α/ρ', directionality:'Ψ (Direct.)',
  ortho_contrast:'Ω (Ortho)', connect_idx:'κ (Connect)',
  stiff_axis:'Stiff Axis', keff_x:'kx', keff_y:'ky', keff_z:'kz',
  thermal_anisotropy:'kα (T.Aniso)', k_density:'k/ρ',
  U_strain:'U (Strain)', microstrain_x:'με·X', microstrain_y:'με·Y', microstrain_z:'με·Z',
  microstrain_avg:'με̄ (avg)', pore_size:'φ (µm)', throat_size:'φt (µm)', throat_ratio:'φt/c', perc_idx:'perc', surface_complexity:'SA/V', volume_fraction:'ρ%',
};

function getPlotAxes() {
  return {
    x: document.getElementById('r1metric')?.value === 'none' ? 'anisotropy' : (document.getElementById('r1metric')?.value || 'anisotropy'),   /* v0.27.1: rank 1 can be off */
    y: document.getElementById('r2metric')?.value === 'none' ? 'Ex_GPa' : (document.getElementById('r2metric')?.value || 'Ex_GPa'),
    z: document.getElementById('r3metric')?.value === 'none' ? 'volume_fraction' : (document.getElementById('r3metric')?.value || 'volume_fraction'),
  };
}

function resizePlot() {
  const rect = plotCanvas.parentElement.getBoundingClientRect();
  plotCanvas.width = rect.width || 280;
  plotCanvas.height = rect.height || 220;
}

function project3D(px, py, pz, cx, cy, rx, ry, scale) {
  // Rotate around Y then X
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  let x1 = px * cosY - pz * sinY;
  let z1 = px * sinY + pz * cosY;
  let y1 = py * cosX - z1 * sinX;
  let z2 = py * sinX + z1 * cosX;
  // Orthographic — no perspective divide, parallel lines stay parallel
  return {
    sx: cx + x1 * scale,
    sy: cy - y1 * scale,
    depth: z2
  };
}

function drawPlot() {
  if (!plotCanvas.width) resizePlot();
  const W = plotCanvas.width, H = plotCanvas.height;
  const cx = W / 2, cy = H / 2;
  const scale = Math.min(W, H) * 0.24;
  pctx.clearRect(0, 0, W, H);

  const axes = getPlotAxes();

  // Helper — project and draw a line segment
  const line = (x0,y0,z0, x1,y1,z1, color, alpha, width=0.5) => {
    const a = project3D(x0,y0,z0, cx,cy, plotRot.x, plotRot.y, scale);
    const b = project3D(x1,y1,z1, cx,cy, plotRot.x, plotRot.y, scale);
    pctx.strokeStyle = color;
    pctx.globalAlpha = alpha;
    pctx.lineWidth = width;
    pctx.beginPath();
    pctx.moveTo(a.sx, a.sy);
    pctx.lineTo(b.sx, b.sy);
    pctx.stroke();
    pctx.globalAlpha = 1;
  };

  // ── Wireframe cube ────────────────────────────────────────────────────────
  // 12 edges of a unit cube from [-1,-1,-1] to [1,1,1]
  const cubeColor = '#2a4a5a';
  const cubeAlpha = 0.5;
  // bottom face
  line(-1,-1,-1,  1,-1,-1, cubeColor, cubeAlpha);
  line( 1,-1,-1,  1,-1, 1, cubeColor, cubeAlpha);
  line( 1,-1, 1, -1,-1, 1, cubeColor, cubeAlpha);
  line(-1,-1, 1, -1,-1,-1, cubeColor, cubeAlpha);
  // top face
  line(-1, 1,-1,  1, 1,-1, cubeColor, cubeAlpha);
  line( 1, 1,-1,  1, 1, 1, cubeColor, cubeAlpha);
  line( 1, 1, 1, -1, 1, 1, cubeColor, cubeAlpha);
  line(-1, 1, 1, -1, 1,-1, cubeColor, cubeAlpha);
  // verticals
  line(-1,-1,-1, -1, 1,-1, cubeColor, cubeAlpha);
  line( 1,-1,-1,  1, 1,-1, cubeColor, cubeAlpha);
  line( 1,-1, 1,  1, 1, 1, cubeColor, cubeAlpha);
  line(-1,-1, 1, -1, 1, 1, cubeColor, cubeAlpha);

  // ── Interior grid lines (3 subdivisions per axis) ─────────────────────────
  const gridColor = '#1a3040';
  const gridAlpha = 0.35;
  const steps = [-0.5, 0, 0.5]; // 3 interior slices per axis
  steps.forEach(t => {
    // XZ plane slices (horizontal bands)
    line(-1, t,-1,  1, t,-1, gridColor, gridAlpha);
    line( 1, t,-1,  1, t, 1, gridColor, gridAlpha);
    line( 1, t, 1, -1, t, 1, gridColor, gridAlpha);
    line(-1, t, 1, -1, t,-1, gridColor, gridAlpha);
    // XY plane slices (front/back)
    line(-1,-1, t,  1,-1, t, gridColor, gridAlpha);
    line( 1,-1, t,  1, 1, t, gridColor, gridAlpha);
    line( 1, 1, t, -1, 1, t, gridColor, gridAlpha);
    line(-1, 1, t, -1,-1, t, gridColor, gridAlpha);
    // YZ plane slices (left/right)
    line( t,-1,-1,  t, 1,-1, gridColor, gridAlpha);
    line( t, 1,-1,  t, 1, 1, gridColor, gridAlpha);
    line( t, 1, 1,  t,-1, 1, gridColor, gridAlpha);
    line( t,-1, 1,  t,-1,-1, gridColor, gridAlpha);
  });

  if (plotData.length === 0) return;

  // Normalize data to [-1, 1] — high values always at +1, low at -1
  const vals = key => plotData.map(d => d[key] || 0);
  const minmax = key => {
    const v = vals(key);
    const mn = Math.min(...v), mx = Math.max(...v);
    return { mn, mx, range: mx - mn || 1 };
  };
  const nx = minmax(axes.x), ny = minmax(axes.y), nz = minmax(axes.z);
  const norm = (v, mm) => (v - mm.mn) / mm.range * 2 - 1;

  // ── Axis labels on cube edges ─────────────────────────────────────────────
  const axesDef = [
    { from: [-1,-1,-1], to: [1,-1,-1], label: (METRIC_LABELS[axes.x] || axes.x).slice(0,11), color: '#5fb5b5' },
    { from: [-1,-1,-1], to: [-1,1,-1], label: (METRIC_LABELS[axes.y] || axes.y).slice(0,11), color: '#c794d4' },
    { from: [-1,-1,-1], to: [-1,-1,1], label: (METRIC_LABELS[axes.z] || axes.z).slice(0,11), color: '#d4b04a' },
  ];

  axesDef.forEach(ax => {
    line(...ax.from, ...ax.to, ax.color, 0.7, 1.5);
    const e = project3D(...ax.to, cx, cy, plotRot.x, plotRot.y, scale);
    const o = project3D(...ax.from, cx, cy, plotRot.x, plotRot.y, scale);
    const lx = e.sx + (e.sx - o.sx) * 0.18;
    const ly = e.sy + (e.sy - o.sy) * 0.18;
    pctx.fillStyle = ax.color;
    pctx.globalAlpha = 0.9;
    pctx.font = `500 8.5px "JetBrains Mono", monospace`;
    pctx.textAlign = 'center';
    pctx.fillText(ax.label, lx, ly);
    pctx.globalAlpha = 1;
  });

  // Build points with depth for painter's sort
  const points = plotData.map(d => {
    const px = norm(d[axes.x] || 0, nx);
    const py = norm(d[axes.y] || 0, ny);
    const pz = norm(d[axes.z] || 0, nz);
    const proj = project3D(px, py, pz, cx, cy, plotRot.x, plotRot.y, scale);
    return { d, proj, px, py, pz };
  });

  // Sort back to front
  points.sort((a, b) => a.proj.depth - b.proj.depth);

  // ── Ideal corner ─────────────────────────────────────────────────────────
  const idealX = (directions[1] || 'max') === 'max' ?  1 : -1;
  const idealY = (directions[2] || 'max') === 'max' ?  1 : -1;
  const idealZ = (directions[3] || 'max') === 'max' ?  1 : -1;
  const idealProj = project3D(idealX, idealY, idealZ, cx, cy, plotRot.x, plotRot.y, scale);

  // Whisker lines from ideal to top 3 — drawn behind points
  const top3 = points.filter(pt => (pt.d.filterRank || 999) <= 3)
    .sort((a, b) => (a.d.filterRank || 999) - (b.d.filterRank || 999));
  const whiskerColors = ['#c8f542', '#1D9E75', '#b598d4'];
  top3.forEach((pt, i) => {
    pctx.strokeStyle = whiskerColors[i];
    pctx.globalAlpha = 0.3;
    pctx.lineWidth = 1;
    pctx.setLineDash([3, 4]);
    pctx.beginPath();
    pctx.moveTo(idealProj.sx, idealProj.sy);
    pctx.lineTo(pt.proj.sx, pt.proj.sy);
    pctx.stroke();
    pctx.setLineDash([]);
    pctx.globalAlpha = 1;
  });

  // Draw points
  points.forEach(pt => {
    const isHovered = plotHovered && plotHovered.id === pt.d.id;
    const isSelected = selectedDesign && selectedDesign.id === pt.d.id;
    const fr = pt.d.filterRank || 999;
    const r = isHovered || isSelected ? 6 : fr <= 3 ? 4.5 : 3;
    const color = getPointColor(pt.d, fr);

    pctx.beginPath();
    pctx.arc(pt.proj.sx, pt.proj.sy, r, 0, Math.PI * 2);
    pctx.fillStyle = color + (isHovered || isSelected ? 'ff' : fr <= 3 ? 'cc' : '88');
    pctx.fill();

    if (isHovered || isSelected || fr <= 3) {
      pctx.strokeStyle = color;
      pctx.lineWidth = fr <= 3 ? 1.5 : 1;
      pctx.globalAlpha = fr <= 3 ? 0.8 : 0.5;
      pctx.stroke();
      pctx.globalAlpha = 1;
    }
  });

  // Draw ideal corner marker on top of everything
  pctx.beginPath();
  pctx.arc(idealProj.sx, idealProj.sy, 5, 0, Math.PI * 2);
  pctx.fillStyle = 'rgba(255,255,255,0.15)';
  pctx.fill();
  pctx.strokeStyle = 'rgba(255,255,255,0.7)';
  pctx.lineWidth = 1.5;
  pctx.stroke();
  pctx.strokeStyle = 'rgba(255,255,255,0.5)';
  pctx.lineWidth = 1;
  pctx.beginPath();
  pctx.moveTo(idealProj.sx - 7, idealProj.sy);
  pctx.lineTo(idealProj.sx + 7, idealProj.sy);
  pctx.moveTo(idealProj.sx, idealProj.sy - 7);
  pctx.lineTo(idealProj.sx, idealProj.sy + 7);
  pctx.stroke();
  pctx.fillStyle = 'rgba(255,255,255,0.45)';
  pctx.font = '400 8px "JetBrains Mono", monospace';
  pctx.textAlign = 'center';
  pctx.fillText('ideal', idealProj.sx, idealProj.sy + 16);

  // Tooltip for hovered point
  if (plotHovered) {
    const pt = points.find(p => p.d.id === plotHovered.id);
    if (pt) {
      const tx = Math.min(pt.proj.sx + 10, W - 120);
      const ty = Math.max(pt.proj.sy - 10, 14);
      pctx.fillStyle = 'rgba(6,8,15,0.9)';
      pctx.beginPath();
      pctx.roundRect(tx, ty - 12, 115, 44, 4);
      pctx.fill();
      pctx.fillStyle = '#c8f542';
      pctx.font = '500 10px "JetBrains Mono", monospace';
      pctx.textAlign = 'left';
      pctx.fillText(`#${plotHovered.id}`, tx + 8, ty + 2);
      pctx.fillStyle = '#7a9ab5';
      pctx.font = '400 9px "JetBrains Mono", monospace';
      pctx.fillText(`${(plotHovered[axes.x]||0).toFixed(2)} · ${(plotHovered[axes.y]||0).toFixed(2)} · ${(plotHovered[axes.z]||0).toFixed(2)}`, tx + 8, ty + 16);
      pctx.fillStyle = '#5a7a5a';
      pctx.fillText(`aniso ${(plotHovered.anisotropy||0).toFixed(2)}×`, tx + 8, ty + 28);
    }
  }
}

function updatePlot(data) {
  plotData = data;
  resizePlot();
  document.getElementById('plotEmpty').classList.add('hidden');
  document.getElementById('plotBadge').textContent = `${data.length} designs`;
  // Run clustering whenever data updates so Terms mode is ready
  if (data.length >= 6) runKMeans(data, 6);
  drawPlot();
}

// Drag to rotate
plotCanvas.addEventListener('mousedown', e => {
  plotDrag = true;
  plotLx = e.clientX;
  plotLy = e.clientY;
});
window.addEventListener('mouseup', () => { plotDrag = false; });
window.addEventListener('mousemove', e => {
  if (plotDrag) {
    plotRot.y += (e.clientX - plotLx) * 0.008;
    plotRot.x += (e.clientY - plotLy) * 0.008;
    plotLx = e.clientX;
    plotLy = e.clientY;
    drawPlot();
    return;
  }
  // Hover detection
  if (plotData.length === 0) return;
  const rect = plotCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const W = plotCanvas.width, H = plotCanvas.height;
  const cx = W / 2, cy = H / 2;
  const scale = Math.min(W, H) * 0.24;
  const axes = getPlotAxes();
  const vals = key => plotData.map(d => d[key] || 0);
  const minmax = key => { const v = vals(key); const mn = Math.min(...v), mx2 = Math.max(...v); return { mn, mx: mx2, range: mx2 - mn || 1 }; };
  const normH = (v, mm) => (v - mm.mn) / mm.range * 2 - 1;
  const nx = minmax(axes.x), ny = minmax(axes.y), nz = minmax(axes.z);

  let closest = null, closestDist = 20;
  plotData.forEach(d => {
    const proj = project3D(
      normH(d[axes.x]||0, nx),
      normH(d[axes.y]||0, ny),
      normH(d[axes.z]||0, nz),
      cx, cy, plotRot.x, plotRot.y, scale);
    const dist = Math.hypot(proj.sx - mx, proj.sy - my);
    if (dist < closestDist) { closestDist = dist; closest = d; }
  });

  if (closest !== plotHovered) {
    plotHovered = closest;
    drawPlot();
    if (closest) {
      showPreview(closest);
      // highlight table row
      document.querySelectorAll('tr.hovered-row').forEach(r => r.classList.remove('hovered-row'));
      const row = document.querySelector(`tr[data-design-id="${closest.id}"]`);
      if (row) { row.classList.add('hovered-row'); row.scrollIntoView({ block: 'nearest' }); }
      const anisoPlotStr = (closest.anisotropy === null || closest.anisotropy === undefined)
        ? '—' : closest.anisotropy.toFixed(2);
      document.getElementById('plotInfo').textContent = `#${closest.id} · aniso ${anisoPlotStr}×`;
      document.getElementById('plotInfo').classList.add('visible');
    } else {
      document.getElementById('plotInfo').classList.remove('visible');
    }
  }
});

// Click to select
plotCanvas.addEventListener('click', () => {
  if (plotHovered) {
    selectDesign(plotHovered, { scroll: true });
    drawPlot();
  }
});

window.addEventListener('resize', () => { resizePlot(); drawPlot(); });
