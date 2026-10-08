/* ============================================================
   F13LD.sweep · 55-estimate-gpu.js
   The GPU path of the per-design pipeline (v0.24.0):

     worker   prepareDesignGpu   prepareDesign (54) + what the GPU solve
                                 needs: islands trimmed, partial-volume
                                 voxels, the cell's edge lengths
     GPU      solver/gpu-worker.js — F13LD.lab's solver (elastic 6×6 +
                                 thermal), stretched cells
     page     finishDesignGpu    engineering constants from the 6×6, then
                                 finishDesign (54) for every other metric

   Same voxels as Lab: partial volume on (each surface voxel carries its
   solid fraction, 4³ samples — geom/voxels.js, shared with Lab), floating
   islands removed (Lab's default "networks" rule; beams are never
   trimmed; skipped when it would remove over 10 % of the solid — see
   sweepTrimIslands).  Sweep's own VF / connectivity gates and its metrics grids are
   unchanged.
   ============================================================ */

/* GPU solver settings per precision mode.  Fast trades a little absolute
   accuracy for speed (Sweep compares designs; Lab verifies them):
   void stiffness 1e-3 of the solid and CG tolerance 1e-3 (gyroid sheet,
   N = 8: moduli within 0.3 % of tolerance 1e-5, at 1/40 of the iterations —
   tests/gpu/stretch-check.js).  Rigorous is
   F13LD.lab's own sweep setting (void 1e-6, tolerance 1e-4), so its numbers
   can be checked against Lab directly. */
const GPU_PRECISION = {
  fast:     { voidRatio: 1e-3, tol: 1e-3, maxiter: 800,  thTol: 1e-3, thMaxiter: 1500 },
  rigorous: { voidRatio: 1e-6, tol: 1e-4, maxiter: 1000, thTol: 1e-5, thMaxiter: 3000 }
};
const SOLVER_VERSION_GPU = 'sweep-gpu v1 — F13LD.lab v0.26.0 solver (elastic ef-1 full 6x6, thermal tg-1), partial volume, island trim, stretched cells';

/* GPU designs in flight per grid (= gwLaneCount in solver/gpu-worker.js). */
function gpuLanesFor(N) { return N <= 16 ? 6 : N <= 32 ? 4 : 2; }

/* Physical cell edges, relative: TPMS cell_scale is cells per unit (a bigger
   number is a shorter cell), beam scale_xyz is the edge in mm; noise and
   grain cells are cubes. */
function designCellEdges(recipe, family) {
  const s = recipeCellScale(recipe, family);
  if (family === 'tpms') return s.map(v => 1 / v);
  if (family === 'beam') return s.slice();
  return [1, 1, 1];
}

/* Lab's default connectivity rule ("networks", 14a pruneToNetworks): keep
   every component that spans the periodic cell, drop floating islands; if
   nothing spans, keep the largest. Beams are never trimmed. Silent (Lab's
   version logs every call). Returns { kept, removed, skipped } (voxels).
   Sweep's limit: when the trim would remove more than ISLAND_TRIM_MAX of
   the solid, the "islands" are a thin design shattered by a coarse grid
   (a PI-TPMS pipe at N = 32, a thin noise sheet), not loose pieces — the
   trim is skipped and the partial-volume voxels keep the pieces joined. */
const ISLAND_TRIM_MAX = 0.10;
function sweepTrimIslands(raw, N, family) {
  if (family === 'beam' || typeof periodicComponents !== 'function') return { kept: raw, removed: 0, skipped: 0 };
  const pc = periodicComponents(raw, N);
  if (pc.count === 0 || (pc.count === 1 && pc.wraps[1])) return { kept: raw, removed: 0 };
  const keep = [];
  let nNet = 0;
  for (let c = 1; c <= pc.count; c++) { keep[c] = !!pc.wraps[c]; if (keep[c]) nNet++; }
  if (!nNet) { let best = 1; for (let c = 2; c <= pc.count; c++) if (pc.sizes[c] > pc.sizes[best]) best = c; keep[best] = true; }
  let removed = 0, total = 0;
  const out = raw.slice();
  for (let i = 0; i < out.length; i++) if (out[i]) { total++; if (!keep[pc.label[i]]) { out[i] = 0; removed++; } }
  if (removed > ISLAND_TRIM_MAX * total) return { kept: raw, removed: 0, skipped: removed };
  return { kept: removed ? out : raw, removed, skipped: 0 };
}

/* Worker side. → { reject } | { P, phi (Float32Array N³), edges, trim } */
function prepareDesignGpu(recipe, opts) {
  const P = prepareDesign(recipe, opts);
  if (P.reject) return { reject: P.reject };
  const { N, mode, geo, solverGridSolid: raw } = P;
  /* fftHomogenize's own VF check (non-hi-res families), kept on this path */
  if (!P._hiRes) {
    const rhoMin = mode === 'pi-tpms' ? RHO_MIN_PI : P.isNoise ? RHO_MIN_NOISE : P.isGrain ? RHO_MIN_GRAIN : P.isBeam ? RHO_MIN_BEAM : RHO_MIN_STD;
    const rhoMax = resolveRhoMax(mode);
    if (P.rho_pregate < rhoMin) return { reject: P.rejectFn('vf_low', P.rho_pregate) };
    if (P.rho_pregate > rhoMax) return { reject: P.rejectFn('vf_high', P.rho_pregate) };
  }
  const t = sweepTrimIslands(raw, N, geo.family);
  const mg = buildVoxelMargin(geo.family, geo.params, geo.offset, N, geo.mode, geo.wt, geo.nWeights, geo.pipeR, geo.phaseShift);
  const phi = voxelFractionsFromMargin(mg, N, t.kept, raw, 4);
  let nRaw = 0;
  for (let i = 0; i < raw.length; i++) nRaw += raw[i];
  const edges = designCellEdges(recipe, geo.family);
  /* what crosses back to the page: no functions, no big arrays */
  const lite = Object.assign({}, P);
  delete lite.geo; delete lite.solverGridSolid; delete lite.rejectFn;
  return { P: lite, phi, edges, trim: nRaw > 0 ? t.removed / nRaw : 0, trimSkipped: nRaw > 0 ? t.skipped / nRaw : 0 };
}

/* Page side. prep = prepareDesignGpu's result, sol = the GPU worker's
   { elastic, thermal, t_ms }, o = the design's opts, g = GPU_PRECISION entry. */
function finishDesignGpu(prep, sol, o, g) {
  const P = prep.P, Es = o.Es;
  const conn = [!!P.connectGate.x, !!P.connectGate.y, !!P.connectGate.z];
  const nConnect = conn.filter(Boolean).length;
  const solver_validity = nConnect === 3 ? 'valid' : nConnect > 0 ? 'partial' : 'invalid';
  let E = [0, 0, 0], G = [0, 0, 0], nus = [null, null, null], zener = null, C = null;
  let cg_iters = 0, cg_converged = nConnect === 0;
  const el = sol.elastic;
  if (el && el.valid && el.S) {
    const S = el.S;
    /* Disconnected axes (Sweep's connectivity gate, as before) report 0;
       anything non-finite, negative or stiffer than the solid is a solve
       that did not settle — 0 too. Small values are kept as solved (with
       Fast's void stiffness 1e-3 a sparse lattice can sit near it). */
    const ok = v => isFinite(v) && v > 0 && v <= Es * 1.05;
    E = [1 / S[0], 1 / S[7], 1 / S[14]].map((v, i) => conn[i] && ok(v) ? v : 0);
    G = [1 / S[21], 1 / S[28], 1 / S[35]].map(v => ok(v) ? v : 0);   /* yz, xz, xy */
    if (E[0] && E[1]) nus[0] = -S[1] / S[0];   /* ν_xy */
    if (E[0] && E[2]) nus[1] = -S[2] / S[0];   /* ν_xz */
    if (E[1] && E[2]) nus[2] = -S[8] / S[7];   /* ν_yz */
    const c = el.C, d = c[0] - c[1];
    if (nConnect === 3 && d > 1e-30) zener = 2 * c[21] / d;
    C = [];
    for (let r = 0; r < 6; r++) C.push(c.slice(r * 6, r * 6 + 6).map(v => +v.toPrecision(4)));
    cg_iters = el.iters; cg_converged = el.converged;
  }
  let kx = 0, ky = 0, kz = 0, thConv = null;
  if (sol.thermal) { kx = sol.thermal.K[0]; ky = sol.thermal.K[4]; kz = sol.thermal.K[8]; thConv = sol.thermal.converged; }
  const e = prep.edges, em = Math.max(e[0], e[1], e[2]);
  const r3 = v => v == null ? null : +v.toFixed(3);
  const extra = {
    Gyz_GPa: +G[0].toFixed(3), Gxz_GPa: +G[1].toFixed(3), Gxy_GPa: +G[2].toFixed(3),
    Gyz_norm: +(G[0] / (Es + 1e-9)).toFixed(4), Gxz_norm: +(G[1] / (Es + 1e-9)).toFixed(4), Gxy_norm: +(G[2] / (Es + 1e-9)).toFixed(4),
    nu_xy: r3(nus[0]), nu_xz: r3(nus[1]), nu_yz: r3(nus[2]),
    zener_A: r3(zener),
    C_GPa: C,
    cell_aspect: e.map(v => +(v / em).toFixed(3)),
    island_trim_pct: +(prep.trim * 100).toFixed(2),
    island_trim_skipped_pct: prep.trimSkipped ? +(prep.trimSkipped * 100).toFixed(2) : 0,
    thermal_converged: thConv,
    solver_version: SOLVER_VERSION_GPU,
    solve_ms: Math.round(sol.t_ms || 0)
  };
  return finishDesign(P, {
    Ex: E[0], Ey: E[1], Ez: E[2], cg_iters, cg_converged, solver_validity,
    kx, ky, kz, ks_val: o.ks || 1.0, extra
  }, o);
}
