/* ============================================================
   F13LD.sweep · 52-geometry-metrics.js
   Narrow-band curvature and topology (Euler characteristic, genus).
   Both work on ONE periodic unit cell (N³ voxel centres over [-π,π]³,
   index i·N²+j·N+k): every stencil and neighbour wraps across the cell
   faces.  Masks may be Float32Array or Uint8Array; > 0.5 is "in".
   ============================================================ */

// ─── Narrow-band curvature analysis ──────────────────────────────────────────
// Mean curvature H and Gaussian curvature K by central differences on the
// field, evaluated at voxels next to the solid/void interface, then
// integrated over the interface with a Crofton-style area estimate.
//
// For a level set φ (any scale — the formulas normalise by |∇φ|):
//   H = ½ ∇·(∇φ/|∇φ|) = (Δφ |∇φ|² − ∇φᵀ Hφ ∇φ) / (2 |∇φ|³)
//   K = ∇φᵀ adj(Hφ) ∇φ / |∇φ|⁴
//
// Sign convention: φ > 0 in solid (rawField is > 0 in VOID per applyModeRaw,
// so we differentiate −rawField); outputs are negated at the end so that
// H > 0 means convex-outward into void.
//
// Area / integration: each periodic face-pair (p, p+e_a) whose two voxels
// are in different phases is one interface crossing along axis a.  A surface
// element with unit normal n̂ is crossed |n̂_a|/h² times per unit area by grid
// lines along a, so weighting each crossing by |n̂_a| gives
//   Σ_a Σ_crossings |n̂_a| · h² = Σ_a n̂_a² · A = A      (exact for planes)
// and ∫ f dA ≈ h² Σ |n̂_a| f.  n̂, H, K at a crossing are the mean of the two
// voxels' values (one-sided if the other has |∇φ| ≈ 0).  This replaces the
// v0.19 two-layer band count, which counted every patch of surface ~2×.
//
// Returns (all area-weighted over the interface of one cell):
//   H_mean               — signed ⟨H⟩ (mm⁻¹), convex-out (>0) / concave (<0) bias
//   H_mean_abs           — ⟨|H|⟩ (mm⁻¹)
//   H_std                — σ(H) (mm⁻¹)
//   K_gauss_mean         — ⟨K⟩ (mm⁻²), saddle (<0) vs spherical (>0)
//   curvature_uniformity — 1 / (1 + σ_H/⟨|H|⟩) ∈ (0,1]
//   MIH                  — ∫ H dA over the cell's interface (mm)
function computeCurvatureMetrics(rawField, voidMask, solidMask, cellSizeMm, N) {
  const NN = N * N;
  const N3 = NN * N;
  const h_mm = cellSizeMm / N;
  const eps = 1e-6;
  const prevT = new Int32Array(N), nextT = new Int32Array(N);
  for (let t = 0; t < N; t++) { prevT[t] = (t + N - 1) % N; nextT[t] = (t + 1) % N; }
  const S = new Uint8Array(N3);
  for (let i = 0; i < N3; i++) S[i] = solidMask[i] > 0.5 ? 1 : 0;

  // Band: voxels with a 6-neighbour (periodic) in the other phase.
  // Per band voxel: H, K (voxel units) and |n̂_x|,|n̂_y|,|n̂_z|; valid = 0 if |∇φ|≈0.
  const slot = new Int32Array(N3).fill(-1);
  const Hs = [], Ks = [], Nx = [], Ny = [], Nz = [];
  const phi = (id) => -rawField[id];
  for (let i = 0; i < N; i++) {
    const im = prevT[i], ip = nextT[i];
    for (let j = 0; j < N; j++) {
      const jm = prevT[j], jp = nextT[j];
      for (let k = 0; k < N; k++) {
        const km = prevT[k], kp = nextT[k];
        const id = i*NN + j*N + k, here = S[id];
        if (S[ip*NN + j*N + k] === here && S[im*NN + j*N + k] === here &&
            S[i*NN + jp*N + k] === here && S[i*NN + jm*N + k] === here &&
            S[i*NN + j*N + kp] === here && S[i*NN + j*N + km] === here) continue;

        const c = phi(id);
        const px = phi(ip*NN + j*N + k), mx = phi(im*NN + j*N + k);
        const py = phi(i*NN + jp*N + k), my = phi(i*NN + jm*N + k);
        const pz = phi(i*NN + j*N + kp), mz = phi(i*NN + j*N + km);
        const fx = (px - mx) * 0.5, fy = (py - my) * 0.5, fz = (pz - mz) * 0.5;
        const grad2 = fx*fx + fy*fy + fz*fz;
        slot[id] = Hs.length;
        if (grad2 < eps) { Hs.push(NaN); Ks.push(NaN); Nx.push(0); Ny.push(0); Nz.push(0); continue; }

        const fxx = px - 2*c + mx, fyy = py - 2*c + my, fzz = pz - 2*c + mz;
        const fxy = (phi(ip*NN + jp*N + k) - phi(ip*NN + jm*N + k)
                   - phi(im*NN + jp*N + k) + phi(im*NN + jm*N + k)) * 0.25;
        const fxz = (phi(ip*NN + j*N + kp) - phi(ip*NN + j*N + km)
                   - phi(im*NN + j*N + kp) + phi(im*NN + j*N + km)) * 0.25;
        const fyz = (phi(i*NN + jp*N + kp) - phi(i*NN + jp*N + km)
                   - phi(i*NN + jm*N + kp) + phi(i*NN + jm*N + km)) * 0.25;

        const lap = fxx + fyy + fzz;
        const quad = fx*fx*fxx + fy*fy*fyy + fz*fz*fzz + 2*(fx*fy*fxy + fx*fz*fxz + fy*fz*fyz);
        const H = (lap * grad2 - quad) / (2 * Math.pow(grad2, 1.5));
        const m11 = fyy*fzz - fyz*fyz, m22 = fxx*fzz - fxz*fxz, m33 = fxx*fyy - fxy*fxy;
        const m12 = fxz*fyz - fxy*fzz, m13 = fxy*fyz - fxz*fyy, m23 = fxy*fxz - fxx*fyz;
        const K = (fx*fx*m11 + fy*fy*m22 + fz*fz*m33 + 2*(fx*fy*m12 + fx*fz*m13 + fy*fz*m23)) / (grad2 * grad2);
        const g = Math.sqrt(grad2);
        Hs.push(H); Ks.push(K); Nx.push(Math.abs(fx) / g); Ny.push(Math.abs(fy) / g); Nz.push(Math.abs(fz) / g);
      }
    }
  }

  // Integrate over interface crossings (each periodic face pair counted once).
  let W = 0, sumH = 0, sumAbsH = 0, sumH2 = 0, sumK = 0;
  const NA = [Nx, Ny, Nz];
  const cross = (a, b, axis) => {
    const sa = slot[a], sb = slot[b], NAx = NA[axis];
    const va = !Number.isNaN(Hs[sa]), vb = !Number.isNaN(Hs[sb]);
    if (!va && !vb) return;
    let w, H, K;
    if (va && vb) { w = 0.5 * (NAx[sa] + NAx[sb]); H = 0.5 * (Hs[sa] + Hs[sb]); K = 0.5 * (Ks[sa] + Ks[sb]); }
    else if (va)  { w = NAx[sa]; H = Hs[sa]; K = Ks[sa]; }
    else          { w = NAx[sb]; H = Hs[sb]; K = Ks[sb]; }
    W += w; sumH += w * H; sumAbsH += w * Math.abs(H); sumH2 += w * H * H; sumK += w * K;
  };
  for (let i = 0; i < N; i++) {
    const ip = nextT[i];
    for (let j = 0; j < N; j++) {
      const jp = nextT[j];
      for (let k = 0; k < N; k++) {
        const id = i*NN + j*N + k, here = S[id];
        let nb = ip*NN + j*N + k;      if (S[nb] !== here) cross(id, nb, 0);
        nb = i*NN + jp*N + k;          if (S[nb] !== here) cross(id, nb, 1);
        nb = i*NN + j*N + nextT[k];    if (S[nb] !== here) cross(id, nb, 2);
      }
    }
  }

  if (W <= 0) {
    return {
      H_mean: 0, H_mean_abs: 0, H_std: 0,
      K_gauss_mean: 0, curvature_uniformity: 0, MIH: 0
    };
  }

  // Area-weighted moments; voxel units → mm (H / h, K / h², area × h²).
  const meanH = sumH / W / h_mm;
  const meanAbsH = sumAbsH / W / h_mm;
  const meanK = sumK / W / (h_mm * h_mm);
  const varH = sumH2 / W / (h_mm * h_mm) - meanH * meanH;
  const stdH = Math.sqrt(Math.max(0, varH));

  // v0.13: curvature_uniformity = 1/(1 + σ/⟨|H|⟩): smooth, bounded (0,1].
  const uniformity = meanAbsH > eps ? 1 / (1 + stdH / meanAbsH) : 0;

  // MIH = ∫ H dA = Σ w·H(voxel⁻¹)·h²(area) / h  → mm.
  const MIH = sumH * h_mm;

  // v0.13 schema: H_mean / MIH negated so convex-out → positive (the
  // positive-inside-solid SDF math gives H < 0 for bulges into void).
  return {
    H_mean:               +(-meanH).toFixed(4),
    H_mean_abs:           +meanAbsH.toFixed(4),
    H_std:                +stdH.toFixed(4),
    K_gauss_mean:         +meanK.toFixed(4),
    curvature_uniformity: +uniformity.toFixed(3),
    MIH:                  +(-MIH).toFixed(4)
  };
}

// ─── Topology — Euler characteristic and genus of one periodic cell ──────────
// The solid is taken with 6-connectivity and the void with 26-connectivity
// (the complementary pair, so the two never cross through each other at a
// diagonal pinch).  Both live on the 3-torus T³ = one periodic cell.
//
// χ(solid): the 6-connected solid is homotopy-equivalent to its dual cubical
// complex on the periodic grid — vertices = solid voxels, edges = face-
// adjacent solid pairs, squares = 2×2 all-solid blocks, cubes = 2×2×2
// all-solid blocks (all with periodic wrap):
//     χ(solid) = n0 − n1 + n2 − n3
// (checks: one voxel → 1; full cell → N³−3N³+3N³−N³ = 0 = χ(T³)).
//
// Interface surface ∂: for a compact 3-manifold M, χ(∂M) = 2χ(M); applied to
// a regular neighbourhood of the dual complex, χ(∂) = 2χ(solid).  For a
// closed orientable surface with c components, total genus g = c − χ(∂)/2.
// c is taken as n_solid + n_void − 1 (components of each phase on T³): exact
// whenever the phase-adjacency graph is a tree, which holds for 3D networks,
// sheets, struts and isolated inclusions; a stack of slab layers (a phase
// that does not wrap in all three directions) is the exception, and there
// genus_per_cell is still right but genus is counted per layer pair.
//
// Returns:
//   euler_char     — χ of the solid/void interface in one periodic cell
//                    (= 2χ(solid)).  P network: −4 (the classic TPMS value per
//                    cubic cell); G −8, D −16 per cubic cell [-π,π]³.
//   genus          — total interface genus in one periodic cell, summed over
//                    interface sheets: c − χ/2.
//   genus_per_cell — genus of ONE interface sheet in one periodic cell
//                    (genus / c).  Network and sheet variants of the same TPMS
//                    agree: P 3; G 5 and D 9 for the cubic cell sampled here
//                    (the cubic cell holds 2 resp. 4 primitive cells of
//                    genus 3: g_cubic − 1 = n·(3 − 1)).  Sphere 0, straight
//                    strut 1.
function computeTopology(solidMask, cellSizeMm, N) {
  const NN = N * N, N3 = NN * N;
  const S = new Uint8Array(N3);
  for (let i = 0; i < N3; i++) S[i] = solidMask[i] > 0.5 ? 1 : 0;
  const nextT = new Int32Array(N);
  for (let t = 0; t < N; t++) nextT[t] = (t + 1) % N;

  // ── χ(solid) on the periodic dual complex ────────────────────────────────
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
  for (let i = 0; i < N; i++) {
    const I0 = i*NN, I1 = nextT[i]*NN;
    for (let j = 0; j < N; j++) {
      const J0 = j*N, J1 = nextT[j]*N;
      for (let k = 0; k < N; k++) {
        const K0 = k, K1 = nextT[k];
        if (!S[I0 + J0 + K0]) continue;
        n0++;
        const x = S[I1 + J0 + K0], y = S[I0 + J1 + K0], z = S[I0 + J0 + K1];
        n1 += x + y + z;
        const xy = x && y && S[I1 + J1 + K0];
        const xz = x && z && S[I1 + J0 + K1];
        const yz = y && z && S[I0 + J1 + K1];
        n2 += (xy ? 1 : 0) + (xz ? 1 : 0) + (yz ? 1 : 0);
        if (xy && xz && yz && S[I1 + J1 + K1]) n3++;
      }
    }
  }
  const chiSolid = n0 - n1 + n2 - n3;
  const euler_char = 2 * chiSolid;

  // ── Periodic component counts: solid 6-connected, void 26-connected ──────
  const label = new Uint8Array(N3);
  const stack = new Int32Array(N3);
  const prevT = new Int32Array(N);
  for (let t = 0; t < N; t++) prevT[t] = (t + N - 1) % N;
  const countComponents = (phase, full) => {
    let comps = 0;
    for (let seed = 0; seed < N3; seed++) {
      if (S[seed] !== phase || label[seed]) continue;
      comps++;
      let top = 0; stack[top++] = seed; label[seed] = 1;
      while (top > 0) {
        const id = stack[--top];
        const i = (id / NN) | 0, rem = id - i*NN, j = (rem / N) | 0, k = rem - j*N;
        const xs = [prevT[i], i, nextT[i]], ys = [prevT[j], j, nextT[j]], zs = [prevT[k], k, nextT[k]];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
          const off = (a !== 1) + (b !== 1) + (c !== 1);
          if (off === 0 || (!full && off > 1)) continue;
          const nb = xs[a]*NN + ys[b]*N + zs[c];
          if (S[nb] === phase && !label[nb]) { label[nb] = 1; stack[top++] = nb; }
        }
      }
    }
    return comps;
  };
  const nSolid = countComponents(1, false);
  const nVoid = countComponents(0, true);

  const c = (nSolid > 0 && nVoid > 0) ? nSolid + nVoid - 1 : 0;   // interface sheets
  const genus = c > 0 ? Math.max(0, Math.round(c - euler_char / 2)) : 0;
  const genus_per_cell = c > 0 ? +(genus / c).toFixed(3) : 0;

  return { euler_char, genus, genus_per_cell };
}
