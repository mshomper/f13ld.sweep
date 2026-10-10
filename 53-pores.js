/* ============================================================
   F13LD.sweep · 53-pores.js
   Pore-size percentiles and pore analysis from a design's signed field.
   ============================================================ */

// ─── v0.12 Phase 1: Pore-size distribution percentiles ───────────────────────
// Replaces the single-mean pore_size with a distribution profile. Critical
// for biomedical (bone-ingrowth wants p10 > 100µm, p90 < 600µm) and
// filtration (sieve cutoff is a percentile, not a mean).
//
// Operates on the same normalised-distance values dVals that analyzePores
// uses for its mean — passed in from caller to avoid duplicate computation.
//
// Returns p10/p50/p90 in µm and cv (coefficient of variation, dimensionless).
function computePorePercentiles(dVals_sorted, gradNorm, umPerUnit) {
  const n = dVals_sorted.length;
  if (n === 0) return { pore_size_p10: 0, pore_size_p50: 0, pore_size_p90: 0, pore_size_cv: 0 };

  const valAt = (frac) => {
    const idx_ = Math.max(0, Math.min(n - 1, Math.floor(n * frac)));
    return dVals_sorted[idx_] * 2 * umPerUnit;
  };

  const p10 = Math.round(valAt(0.10));
  const p50 = Math.round(valAt(0.50));
  const p90 = Math.round(valAt(0.90));

  // Coefficient of variation = σ/μ across full distribution
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const v = dVals_sorted[i] * 2 * umPerUnit;
    sum += v;
    sum2 += v * v;
  }
  const mean = sum / n;
  const variance = Math.max(0, sum2 / n - mean * mean);
  const cv = mean > 0 ? +(Math.sqrt(variance) / mean).toFixed(3) : 0;

  return {
    pore_size_p10: p10,
    pore_size_p50: p50,
    pore_size_p90: p90,
    pore_size_cv: cv
  };
}

// analyzePoresFromField — pore size (mean of the widest 10 % of void
// distances), percentiles, throat and void percolation from a design's
// signed field (buildGeomField). Distances are rawField / g, g the mean
// |∇rawField| over the near-surface void (periodic central differences of
// the grid): |∇φ| for the raw modes, ≈ 1 where rawField already is a
// distance (normalized TPMS) — so pores are no longer divided twice there.
/* v0.29.1 — w: a stretched cell's voxel edges (geometric mean 1); the
   gradient is taken per physical length so distances are real distances. */
function analyzePoresFromField(rawField, voidMask, cellSizeMm, N, w) {
  const N3 = N * N * N, NN = N * N;
  const step = (2 * Math.PI) / N;
  const W = w || [1, 1, 1];
  const sx = 2 * step * W[0], sy = 2 * step * W[1], sz = 2 * step * W[2];
  const umPerUnit = (cellSizeMm * 1000) / (2 * Math.PI);

  let gradSum = 0, gradCount = 0;
  for (let i = 0; i < N; i++) {
    const ip = ((i + 1) % N) * NN, im = ((i + N - 1) % N) * NN, ii = i * NN;
    for (let j = 0; j < N; j++) {
      const jp = ((j + 1) % N) * N, jm = ((j + N - 1) % N) * N, jj = j * N;
      for (let k = 0; k < N; k++) {
        const id = ii + jj + k;
        if (!voidMask[id] || rawField[id] >= 0.3) continue;
        const kp = (k + 1) % N, km = (k + N - 1) % N;
        const gx = (rawField[ip + jj + k] - rawField[im + jj + k]) / sx;
        const gy = (rawField[ii + jp + k] - rawField[ii + jm + k]) / sy;
        const gz = (rawField[ii + jj + kp] - rawField[ii + jj + km]) / sz;
        gradSum += Math.sqrt(gx * gx + gy * gy + gz * gz);
        gradCount++;
      }
    }
  }
  const gradNorm = gradCount > 0 && gradSum > 0 ? gradSum / gradCount : 1.0;

  const dVals = [];
  for (let i = 0; i < N3; i++) if (voidMask[i]) dVals.push(rawField[i] / gradNorm);
  if (dVals.length === 0) return { pore_size: 0, throat_size: 0, perc_idx: 0, perc_x: 0, perc_y: 0, perc_z: 0,
    pore_size_p10: 0, pore_size_p50: 0, pore_size_p90: 0, pore_size_cv: 0 };
  dVals.sort((a, b) => a - b);
  const topVals = dVals.slice(Math.floor(dVals.length * 0.90));
  const meanTop = topVals.reduce((s, v) => s + v, 0) / topVals.length;
  const pore_size = Math.round(meanTop * 2 * umPerUnit);

  const tp = computeThroatAndPerc(voidMask, cellSizeMm, N, w && !(w[0] === 1 && w[1] === 1 && w[2] === 1) ? w : null);
  const pct = computePorePercentiles(dVals, gradNorm, umPerUnit);
  return { pore_size,
           throat_size: tp.throat_size,
           throat_x: tp.throat_x, throat_y: tp.throat_y, throat_z: tp.throat_z,
           perc_idx:    tp.perc_idx,
           perc_x:      tp.perc_x, perc_y: tp.perc_y, perc_z: tp.perc_z,
           ...pct };
}
