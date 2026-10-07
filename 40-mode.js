/* ============================================================
   F13LD.sweep · 40-mode.js
   KERNELS registry and the mode wrappers (scalar field -> solid / void).
   ============================================================ */


// Family registry — kernel lookup by recipe.family (defaults to 'tpms')
const KERNELS = { tpms: TpmsKernel, noise: NoiseKernel, grain: GrainKernel, beam: BeamKernel };

// ─── Mode wrapper — scalar field → solid/void threshold ──────────────────────
// Family-agnostic: solid/shell/PI-TPMS threshold logic that turns a scalar
// field evaluator into a binary mask. Sweep families plug in their own
// kernel.evaluate; this layer applies the mode-specific test on top.
//
// modeArgs:
//   { offset }                                          — solid mode
//   { offset, wt, shellNormalize? }                     — shell mode (also accepts nWeights for anisotropic shells; nWeights is applied at the buildVoxels level since it needs gradient access)
//   { pipeR, dx, dy, dz, piNormalize? }                 — pi-tpms mode (dx/dy/dz are pre-multiplied by 2π)
//
// Returns: 1 if the point is inside the solid, 0 if void.
//
// PI-TPMS needs two field evaluations per point (phase-shifted pair), so the
// applyMode signature accepts an evalFn closure rather than a single value.
//
// Normalization (matches F13LD.tpms ground truth — same FD step 0.012,
// gradient floor 0.08, cos clamp ±0.95):
//   shellNormalize=true  → |φ−offset|/|∇φ| < wt
//   piNormalize=true     → angle-corrected perpendicular distance to
//                          intersection curve {φ_A=0 ∩ φ_B=0} < pipeR
function applyMode(evalFn, x, y, z, mode, modeArgs) {
  if (mode === 'pi-tpms') {
    const vA = evalFn(x, y, z);
    const vB = evalFn(x + modeArgs.dx, y + modeArgs.dy, z + modeArgs.dz);
    if (modeArgs.piNormalize) {
      // Full angle-corrected distance to intersection curve. Mirror of
      // F13LD.tpms isSolid() PI-normalize branch (tpms 1137–1155).
      const e = 0.012, EPS = 0.08, COSCLAMP = 0.95;
      const inv2e = 1 / (2 * e);
      const gAx = (evalFn(x+e,y,z) - evalFn(x-e,y,z)) * inv2e;
      const gAy = (evalFn(x,y+e,z) - evalFn(x,y-e,z)) * inv2e;
      const gAz = (evalFn(x,y,z+e) - evalFn(x,y,z-e)) * inv2e;
      const magA = Math.max(Math.sqrt(gAx*gAx + gAy*gAy + gAz*gAz), EPS);
      const xB = x + modeArgs.dx, yB = y + modeArgs.dy, zB = z + modeArgs.dz;
      const gBx = (evalFn(xB+e,yB,zB) - evalFn(xB-e,yB,zB)) * inv2e;
      const gBy = (evalFn(xB,yB+e,zB) - evalFn(xB,yB-e,zB)) * inv2e;
      const gBz = (evalFn(xB,yB,zB+e) - evalFn(xB,yB,zB-e)) * inv2e;
      const magB = Math.max(Math.sqrt(gBx*gBx + gBy*gBy + gBz*gBz), EPS);
      const dA = vA / magA;
      const dB = vB / magB;
      let cosA = (gAx*gBx + gAy*gBy + gAz*gBz) / (magA * magB);
      if (cosA >  COSCLAMP) cosA =  COSCLAMP;
      if (cosA < -COSCLAMP) cosA = -COSCLAMP;
      const sin2 = 1 - cosA * cosA;
      const num  = dA*dA - 2*cosA*dA*dB + dB*dB;
      return Math.sqrt(Math.max(num, 0) / sin2) < modeArgs.pipeR ? 1 : 0;
    }
    return Math.max(Math.abs(vA), Math.abs(vB)) < modeArgs.pipeR ? 1 : 0;
  }
  if (mode === 'shell') {
    const v = evalFn(x, y, z);
    if (modeArgs.shellNormalize) {
      // |φ−offset|/|∇φ| < wt. Mirror of F13LD.tpms isSolid() shell-normalize
      // branch (tpms 1161–1168). FD step 0.012; ε-floor 0.08 on |∇φ|.
      const e = 0.012, EPS = 0.08;
      const inv2e = 1 / (2 * e);
      const gx = (evalFn(x+e,y,z) - evalFn(x-e,y,z)) * inv2e;
      const gy = (evalFn(x,y+e,z) - evalFn(x,y-e,z)) * inv2e;
      const gz = (evalFn(x,y,z+e) - evalFn(x,y,z-e)) * inv2e;
      const g = Math.max(Math.sqrt(gx*gx + gy*gy + gz*gz), EPS);
      return Math.abs(v - modeArgs.offset) / g < modeArgs.wt ? 1 : 0;
    }
    return Math.abs(v - modeArgs.offset) < modeArgs.wt ? 1 : 0;
  }
  // ─── Noise modes (E2) ────────────────────────────────────────────────────
  // Noise kernels apply per-recipe normalization inside evaluate(), so
  // evalFn(x,y,z) returns the already-normalized field value in roughly [-1,1].
  // halfInvert flips noise-half's solid side; defaults to false.
  if (mode === 'noise-sheet') {
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) < modeArgs.halfWidth ? 1 : 0;
  }
  if (mode === 'noise-half') {
    const v = evalFn(x, y, z);
    return modeArgs.halfInvert
      ? (v < modeArgs.isoLevel ? 1 : 0)
      : (v > modeArgs.isoLevel ? 1 : 0);
  }
  if (mode === 'noise-solid') {
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) > modeArgs.halfWidth ? 1 : 0;
  }
  // ─── Grain modes (E3) ────────────────────────────────────────────────────
  // Grain kernels return RAW field values (not normalized to [-1,1] like
  // noise) — see GrainKernel header. isoLevel/halfWidth are in raw scale.
  // The threshold math is identical to the noise branch; only the prefix
  // differs.
  if (mode === 'grain-sheet') {
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) < modeArgs.halfWidth ? 1 : 0;
  }
  if (mode === 'grain-half') {
    const v = evalFn(x, y, z);
    return modeArgs.halfInvert
      ? (v < modeArgs.isoLevel ? 1 : 0)
      : (v > modeArgs.isoLevel ? 1 : 0);
  }
  if (mode === 'grain-solid') {
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) > modeArgs.halfWidth ? 1 : 0;
  }
  // ─── Beam mode (E4) ──────────────────────────────────────────────────────
  // Beam kernel returns a real SDF in local cell units (positive-outside).
  // Solid where SDF < 0. No offset / isoLevel — the radius is baked into
  // the SDF via per-strut r_eff (set by jitterParams).
  if (mode === 'beam-solid') {
    return evalFn(x, y, z) < 0 ? 1 : 0;
  }
  // solid (default — TPMS)
  return (evalFn(x, y, z) - modeArgs.offset) < 0 ? 1 : 0;
}

// Raw field — same threshold logic but returns the signed scalar used by
// pore analysis (raw > 0 in void, raw <= 0 in solid). Used by buildHiResField
// and analyzePores.
function applyModeRaw(evalFn, x, y, z, mode, modeArgs) {
  if (mode === 'pi-tpms') {
    const vA = evalFn(x, y, z);
    const vB = evalFn(x + modeArgs.dx, y + modeArgs.dy, z + modeArgs.dz);
    if (modeArgs.piNormalize) {
      // piField − pipeR (signed). Same math as applyMode's PI-normalize branch.
      const e = 0.012, EPS = 0.08, COSCLAMP = 0.95;
      const inv2e = 1 / (2 * e);
      const gAx = (evalFn(x+e,y,z) - evalFn(x-e,y,z)) * inv2e;
      const gAy = (evalFn(x,y+e,z) - evalFn(x,y-e,z)) * inv2e;
      const gAz = (evalFn(x,y,z+e) - evalFn(x,y,z-e)) * inv2e;
      const magA = Math.max(Math.sqrt(gAx*gAx + gAy*gAy + gAz*gAz), EPS);
      const xB = x + modeArgs.dx, yB = y + modeArgs.dy, zB = z + modeArgs.dz;
      const gBx = (evalFn(xB+e,yB,zB) - evalFn(xB-e,yB,zB)) * inv2e;
      const gBy = (evalFn(xB,yB+e,zB) - evalFn(xB,yB-e,zB)) * inv2e;
      const gBz = (evalFn(xB,yB,zB+e) - evalFn(xB,yB,zB-e)) * inv2e;
      const magB = Math.max(Math.sqrt(gBx*gBx + gBy*gBy + gBz*gBz), EPS);
      const dA = vA / magA;
      const dB = vB / magB;
      let cosA = (gAx*gBx + gAy*gBy + gAz*gBz) / (magA * magB);
      if (cosA >  COSCLAMP) cosA =  COSCLAMP;
      if (cosA < -COSCLAMP) cosA = -COSCLAMP;
      const sin2 = 1 - cosA * cosA;
      const num  = dA*dA - 2*cosA*dA*dB + dB*dB;
      return Math.sqrt(Math.max(num, 0) / sin2) - modeArgs.pipeR;
    }
    return Math.max(Math.abs(vA), Math.abs(vB)) - modeArgs.pipeR;
  }
  if (mode === 'shell') {
    const v = evalFn(x, y, z);
    if (modeArgs.shellNormalize) {
      // |φ−offset|/|∇φ| − wt (signed). Same math as applyMode's shell-normalize branch.
      const e = 0.012, EPS = 0.08;
      const inv2e = 1 / (2 * e);
      const gx = (evalFn(x+e,y,z) - evalFn(x-e,y,z)) * inv2e;
      const gy = (evalFn(x,y+e,z) - evalFn(x,y-e,z)) * inv2e;
      const gz = (evalFn(x,y,z+e) - evalFn(x,y,z-e)) * inv2e;
      const g = Math.max(Math.sqrt(gx*gx + gy*gy + gz*gz), EPS);
      return Math.abs(v - modeArgs.offset) / g - modeArgs.wt;
    }
    return Math.abs(v - modeArgs.offset) - modeArgs.wt;
  }
  // ─── Noise modes (E2) ────────────────────────────────────────────────────
  // Sign convention: raw > 0 in void, raw <= 0 in solid. Match applyMode's
  // boolean test with the inverse-sign continuous version.
  if (mode === 'noise-sheet') {
    // Solid where |v - iso| < halfWidth → raw = |v - iso| - halfWidth
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) - modeArgs.halfWidth;
  }
  if (mode === 'noise-half') {
    const v = evalFn(x, y, z);
    // halfInvert=false: solid where v > iso → raw = iso - v
    // halfInvert=true:  solid where v < iso → raw = v - iso
    return modeArgs.halfInvert ? (v - modeArgs.isoLevel) : (modeArgs.isoLevel - v);
  }
  if (mode === 'noise-solid') {
    // Solid where |v - iso| > halfWidth → raw = halfWidth - |v - iso|
    return modeArgs.halfWidth - Math.abs(evalFn(x, y, z) - modeArgs.isoLevel);
  }
  // ─── Grain modes (E3) ────────────────────────────────────────────────────
  // Same sign convention as noise (raw>0 void, raw<=0 solid). isoLevel and
  // halfWidth are in the kernel's RAW field scale, not normalized.
  if (mode === 'grain-sheet') {
    return Math.abs(evalFn(x, y, z) - modeArgs.isoLevel) - modeArgs.halfWidth;
  }
  if (mode === 'grain-half') {
    const v = evalFn(x, y, z);
    return modeArgs.halfInvert ? (v - modeArgs.isoLevel) : (modeArgs.isoLevel - v);
  }
  if (mode === 'grain-solid') {
    return modeArgs.halfWidth - Math.abs(evalFn(x, y, z) - modeArgs.isoLevel);
  }
  // ─── Beam mode (E4) ──────────────────────────────────────────────────────
  // SDF already in the right sign convention (raw > 0 in void, raw ≤ 0 in
  // solid). Return as-is.
  if (mode === 'beam-solid') {
    return evalFn(x, y, z);
  }
  // solid (default — TPMS)
  return evalFn(x, y, z) - modeArgs.offset;
}

// ═════════════════════════════════════════════════════════════════════════════
