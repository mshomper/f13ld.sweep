/* ============================================================
   F13LD.sweep · 11-rank.js
   Rank / colour mode, KNN outlier score, k-means plot colouring, rank filters and final ranking.
   ============================================================ */

function setRankMode(mode, btn) {
  rankMode = mode;
  btn.closest('.mode-toggle-group').querySelectorAll('.mode-toggle-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  if (currentFiltered.length > 0) applyFinalRanking(currentFiltered);
}

function setColorMode(mode, btn) {
  colorMode = mode;
  btn.closest('.mode-toggle-group').querySelectorAll('.mode-toggle-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  if (mode === 'terms' && plotData.length >= 6) runKMeans(plotData, 6);
  drawPlot();
}

// ─── KNN Outlier scoring ──────────────────────────────────────────────────────
function computeOutlierScores(data, k = 5) {
  const axes = getPlotAxes();
  /* nulls (e.g. anisotropy with < 2 percolating axes) sit at the axis
     mean instead of counting as 0 */
  const minmax = key => {
    const v = data.map(d => d[key]).filter(x => typeof x === 'number' && isFinite(x));
    if (!v.length) return { mn: 0, range: 1, mean: 0 };
    const mn = Math.min(...v), mx = Math.max(...v);
    return { mn, range: mx - mn || 1, mean: v.reduce((a, b) => a + b, 0) / v.length };
  };
  const nx = minmax(axes.x), ny = minmax(axes.y), nz = minmax(axes.z);
  const norm = (v, mm) => ((typeof v === 'number' && isFinite(v)) ? v - mm.mn : mm.mean - mm.mn) / mm.range;
  k = Math.max(1, Math.min(k, data.length - 1));
  if (data.length < 2) { data.forEach(d => { d._outlierScore = 0; }); return; }

  data.forEach((d, i) => {
    const px = norm(d[axes.x], nx);
    const py = norm(d[axes.y], ny);
    const pz = norm(d[axes.z], nz);
    // compute distance to all other points, keep k nearest
    const dists = data
      .map((o, j) => {
        if (i === j) return Infinity;
        const ox = norm(o[axes.x], nx);
        const oy = norm(o[axes.y], ny);
        const oz = norm(o[axes.z], nz);
        return Math.sqrt((px-ox)**2 + (py-oy)**2 + (pz-oz)**2);
      })
      .sort((a, b) => a - b)
      .slice(0, k);
    d._outlierScore = dists.reduce((s, v) => s + v, 0) / k;
  });
}

// ─── K-means clustering for plot coloring ────────────────────────────────────
const CLUSTER_COLORS = [
  '#ff6b6b', // coral
  '#ffd166', // amber
  '#ff9f43', // orange
  '#fd79a8', // pink
  '#e17055', // terracotta
  '#fdcb6e', // gold
];

let clusterAssignments = new Map(); // design id → cluster index

function runKMeans(data, k = 6, iterations = 20) {
  const axes = getPlotAxes();
  const vals = key => data.map(d => d[key]).filter(x => typeof x === 'number' && isFinite(x));
  const minmax = key => {
    const v = vals(key);
    const mn = Math.min(...v), mx = Math.max(...v);
    return { mn, range: mx - mn || 1 };
  };
  const nx = minmax(axes.x), ny = minmax(axes.y), nz = minmax(axes.z);
  const norm = (v, mm) => (v - mm.mn) / mm.range;

  // Normalize all points to [0,1]
  const pts = data.map(d => ({
    id: d.id,
    x: norm(typeof d[axes.x] === 'number' ? d[axes.x] : nx.mn + nx.range / 2, nx),
    y: norm(typeof d[axes.y] === 'number' ? d[axes.y] : ny.mn + ny.range / 2, ny),
    z: norm(typeof d[axes.z] === 'number' ? d[axes.z] : nz.mn + nz.range / 2, nz),
  }));

  // Initialize centroids by spreading evenly through sorted data
  let centroids = Array.from({ length: k }, (_, i) =>
    ({ ...pts[Math.floor(i * pts.length / k)] })
  );

  let assignments = new Array(pts.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign each point to nearest centroid
    pts.forEach((p, i) => {
      let minDist = Infinity, best = 0;
      centroids.forEach((c, ci) => {
        const d = Math.sqrt((p.x-c.x)**2 + (p.y-c.y)**2 + (p.z-c.z)**2);
        if (d < minDist) { minDist = d; best = ci; }
      });
      assignments[i] = best;
    });

    // Recompute centroids
    centroids = centroids.map((_, ci) => {
      const members = pts.filter((_, i) => assignments[i] === ci);
      if (members.length === 0) return centroids[ci];
      return {
        x: members.reduce((s, p) => s + p.x, 0) / members.length,
        y: members.reduce((s, p) => s + p.y, 0) / members.length,
        z: members.reduce((s, p) => s + p.z, 0) / members.length,
      };
    });
  }

  // Store assignments
  clusterAssignments.clear();
  pts.forEach((p, i) => clusterAssignments.set(p.id, assignments[i]));
}

function getPointColor(d, fr) {
  if (colorMode === 'terms') {
    const cluster = clusterAssignments.get(d.id) ?? 0;
    return CLUSTER_COLORS[cluster % CLUSTER_COLORS.length];
  }
  return fr === 1 ? '#c8f542' : fr === 2 ? '#1D9E75' : fr === 3 ? '#b598d4' : '#5a7a5a';
}

// ─── Final ranking (called after filters and on mode switch) ──────────────────
function applyFinalRanking(filtered) {
  const activeAxes = [
    { key: document.getElementById('r1metric')?.value, dir: directions[1] || 'max' },
    { key: document.getElementById('r2metric')?.value, dir: directions[2] || 'max' },
    { key: document.getElementById('r3metric')?.value, dir: directions[3] || 'max' },
  ].filter(a => a.key && a.key !== 'none');

  if (rankMode !== 'outlier' && TARGET && TARGET.metrics.length) {
    /* v0.28.0 — a point target (13-target.js): closest first */
    tgtStamp(filtered, TARGET);
    filtered.sort(tgtCompare);
    log('info', `Ranked by distance from the target (${tgtSummary(TARGET)})`);
  } else if (rankMode === 'outlier') {
    computeOutlierScores(filtered);
    filtered.sort((a, b) => b._outlierScore - a._outlierScore);
    log('info', `Ranked by outlier score (KNN k=5) — most isolated designs first`);
  } else {
    // Distance from ideal corner
    if (activeAxes.length > 0) {
      activeAxes.forEach(ax => {
        // v0.14.0: anisotropy + aniso_efficiency can be null when <2 axes
        // percolate. Exclude nulls from min/max range computation; designs
        // with null on this axis get worst-case contribution below.
        const vals = filtered
          .map(d => d[ax.key])
          .filter(v => v !== null && v !== undefined && Number.isFinite(v));
        ax.mn = vals.length ? Math.min(...vals) : 0;
        ax.mx = vals.length ? Math.max(...vals) : 1;
        ax.range = ax.mx - ax.mn || 1;
      });
      filtered.forEach(d => {
        let distSq = 0;
        activeAxes.forEach(ax => {
          const v = d[ax.key];
          if (v === null || v === undefined || !Number.isFinite(v)) {
            // Worst-case distance contribution for this axis — sorts null
            // designs to the bottom regardless of direction.
            distSq += 1;
            return;
          }
          const t = (v - ax.mn) / ax.range;
          const delta = ax.dir === 'max' ? (1 - t) : t;
          distSq += delta * delta;
        });
        d._idealDist = Math.sqrt(distSq);
      });
      filtered.sort((a, b) => a._idealDist - b._idealDist);
      log('info', `Ranked by distance from ideal corner across ${activeAxes.length} metrics`);
    } else log('info', 'No ranks — designs in draw order (sort any column in the table)');
  }

  filtered.forEach((d, i) => { d.filterRank = i + 1; });
  renderTable(filtered);
  updatePlot(filtered);
}

function applyRankFilter(data, metricId, rank, valId, mode) {
  const metric = document.getElementById(metricId)?.value;
  if (!metric || metric === 'none') return data;

  const dir = directions[rank] || 'max';
  const valEl = valId ? document.getElementById(valId) : null;
  const val = valEl?.value ? parseFloat(valEl.value) : null;

  // v0.14.0: anisotropy/aniso_efficiency are nullable. Helper for null-safe
  // numeric checks. JS quirk: `null - 5 === -5` and `null <= 5 === true`
  // because null coerces to 0 in arithmetic — bypasses naive comparisons.
  const isNum = v => v !== null && v !== undefined && Number.isFinite(v);

  let out = [...data];

  if (mode === 'threshold' && val !== null) {
    out = out.filter(d => isNum(d[metric]) && (dir === 'max' ? d[metric] >= val : d[metric] <= val));
  }

  // Sort: null/undefined/non-finite always go to the bottom regardless of direction.
  out.sort((a, b) => {
    const av = a[metric], bv = b[metric];
    const aOk = isNum(av), bOk = isNum(bv);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;   // a is bottom
    if (!bOk) return -1;  // b is bottom
    return dir === 'max' ? bv - av : av - bv;
  });

  if (mode === 'keep') {
    // v0.16.0: defaults bumped from 50/25 → 100 on both ranks. Smaller batches
    // were losing the majority of results to aggressive keep-top filtering;
    // users wanting tighter filtering can still type in any value 1-100.
    const defaultPct = 100;
    const pct = (val !== null && isFinite(val)) ? Math.max(1, Math.min(100, val)) : defaultPct;
    const keepN = Math.max(1, Math.round(out.length * pct / 100));
    out = out.slice(0, keepN);
  }

  return out;
}
