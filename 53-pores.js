/* ============================================================
   F13LD.sweep · 53-pores.js
   Pore-size percentiles and pore analysis.
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

function analyzePoresFromField(rawField, voidMask, family, params, offset, mode, wt, pipeR, phaseShift, cellSizeMm, N, piNorm, shellNorm) {
  const isPi    = mode === 'pi-tpms';
  const N3 = N * N * N;
  const L = Math.PI;
  const step = (2 * L) / N;
  const NN = N * N;
  const umPerUnit = (cellSizeMm * 1000) / (2 * Math.PI);
  const pr = pipeR || 0.1;
  const wtV = wt || 0.3;
  const kernel = KERNELS[family || 'tpms'];

  // Single near-surface pass: collects gradNorm for pore_size normalisation.
  // (v0.8 also collected maxSurfGrad here for the throat formula; that
  // formula is gone, replaced with EDT-based widest-path. maxSurfGrad
  // collection removed — saves nothing because we still need gradNorm,
  // but documents the change.)
  let gradSum = 0, gradCount = 0;
  for (let i = 0; i < N; i++) {
    const x = -L + (i + 0.5) * step;
    for (let j = 0; j < N; j++) {
      const y = -L + (j + 0.5) * step;
      const baseIdx = i * NN + j * N;
      for (let k = 0; k < N; k++) {
        const id = baseIdx + k;
        if (!voidMask[id]) continue;
        const r = rawField[id];
        if (r >= 0.3) continue;
        const z = -L + (k + 0.5) * step;
        const { gradMag } = kernel.evaluateWithGrad(params, x, y, z);
        gradSum += gradMag;
        gradCount++;
      }
    }
  }

  // Pore size — top 10% of normalised void distance values × 2 × µm/unit
  const gradNorm = gradCount > 0 ? gradSum / gradCount : 1.0;
  const dVals = [];
  for (let i = 0; i < N3; i++) {
    if (voidMask[i]) dVals.push(rawField[i] / gradNorm);
  }
  if (dVals.length === 0) return { pore_size: 0, throat_size: 0, perc_idx: 0, perc_x: 0, perc_y: 0, perc_z: 0,
    pore_size_p10: 0, pore_size_p50: 0, pore_size_p90: 0, pore_size_cv: 0 };
  dVals.sort((a, b) => a - b);
  const topVals = dVals.slice(Math.floor(dVals.length * 0.90));
  const meanTop = topVals.reduce((s, v) => s + v, 0) / topVals.length;
  const pore_size = Math.round(meanTop * 2 * umPerUnit);

  // ── Throat + percolation via geometric EDT (computeThroatAndPerc) ──────
  // See helper definition above for algorithm details. Pulls field-type-
  // independent throat width from voxel mask + cell size.
  const tp = computeThroatAndPerc(voidMask, cellSizeMm, N);

  // v0.12: pore-size distribution percentiles (p10/p50/p90/cv) from same dVals
  const pct = computePorePercentiles(dVals, gradNorm, umPerUnit);

  return { pore_size,
           throat_size: tp.throat_size,
           perc_idx:    tp.perc_idx,
           perc_x:      tp.perc_x, perc_y: tp.perc_y, perc_z: tp.perc_z,
           ...pct };
}

function analyzePores(family, params, offset, mode, wallT, pipeR, phaseShift, cellMult, cellSizeMm, N, piNorm, shellNorm) {
  const isPi    = mode === 'pi-tpms';
  const N3 = N * N * N;
  const L    = Math.PI; // solver domain always [-π, π]³ regardless of cellMult
  const step = 2 * L / N;
  const kernel = KERNELS[family || 'tpms'];
  const evalFn = (x, y, z) => kernel.evaluate(params, x, y, z);

  // µm per unit of normalised distance — cell spans 2π field units = cellSizeMm mm
  const umPerUnit = (cellSizeMm * 1000) / (2 * Math.PI);

  // PI-TPMS phase shift in radians
  const TWO_PI = 2 * Math.PI;
  const pr = pipeR || 0.1;
  const wt = wallT || 0.3;
  const modeArgs = {
    offset, wt, pipeR: pr,
    dx: isPi ? (phaseShift?.x || 0) * TWO_PI : 0,
    dy: isPi ? (phaseShift?.y || 0) * TWO_PI : 0,
    dz: isPi ? (phaseShift?.z || 0) * TWO_PI : 0,
    // TPMS field-normalization flags — read by applyModeRaw (no-op for non-TPMS modes)
    piNormalize:    !!piNorm,
    shellNormalize: !!shellNorm,
    // Noise mode fields — see buildHiResField for rationale
    isoLevel: params.isoLevel,
    halfWidth: params.halfWidth,
    halfInvert: !!params.halfInvert,
  };

  // ── 1. Main grid pass — build void mask and collect surface-band gradients ─
  const dField   = new Float32Array(N3);
  const voidMask = new Uint8Array(N3);
  let gradSum = 0, gradCount = 0;

  for (let i = 0; i < N; i++) {
    const x = -L + (i + 0.5) * step;
    for (let j = 0; j < N; j++) {
      const y = -L + (j + 0.5) * step;
      for (let k = 0; k < N; k++) {
        const z = -L + (k + 0.5) * step;
        const raw = applyModeRaw(evalFn, x, y, z, mode, modeArgs);
        const id  = i*N*N + j*N + k;
        if (raw > 0) {
          dField[id]   = raw;
          voidMask[id] = 1;
          // Collect gradient magnitude only in near-surface band (raw < 0.3 field units)
          // This gives a stable normalization factor that corrects for coefficient scaling
          // without dividing by near-zero gradients deep in the pore
          if (raw < 0.3) {
            const { gradMag } = kernel.evaluateWithGrad(params, x, y, z);
            gradSum += gradMag;
            gradCount++;
          }
        } else {
          dField[id]   = 0;
          voidMask[id] = 0;
        }
      }
    }
  }

  // Single normalization factor — mean gradient at the surface
  const gradNorm = gradCount > 0 ? gradSum / gradCount : 1.0;

  // ── 2. Collect normalised void d values ──────────────────────────────────
  const dVals = [];
  for (let i = 0; i < N3; i++) {
    if (voidMask[i]) dVals.push(dField[i] / gradNorm);
  }
  if (dVals.length === 0) return { pore_size: 0, throat_size: 0, perc_idx: 0, perc_x: 0, perc_y: 0, perc_z: 0,
    pore_size_p10: 0, pore_size_p50: 0, pore_size_p90: 0, pore_size_cv: 0 };

  dVals.sort((a, b) => a - b);
  const n = dVals.length;

  // Pore size: mean of top 10% normalised d × 2 × umPerUnit
  const topVals = dVals.slice(Math.floor(n * 0.90));
  const meanTop = topVals.reduce((s, v) => s + v, 0) / topVals.length;
  const pore_size = Math.round(meanTop * 2 * umPerUnit);

  // ── Throat + percolation via geometric EDT (computeThroatAndPerc) ──────
  // See helper definition above for algorithm details. Pulls field-type-
  // independent throat width from voxel mask + cell size. Replaces the
  // v0.8 surfParam/maxSurfGrad heuristic and the standalone percolation
  // BFS — both now derive from the same EDT pass.
  const tp = computeThroatAndPerc(voidMask, cellSizeMm, N);

  // v0.12: pore-size distribution percentiles
  const pct = computePorePercentiles(dVals, gradNorm, umPerUnit);

  return { pore_size,
           throat_size: tp.throat_size,
           perc_idx:    tp.perc_idx,
           perc_x:      tp.perc_x, perc_y: tp.perc_y, perc_z: tp.perc_z,
           ...pct };
}
