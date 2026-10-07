/* ============================================================
   F13LD.sweep · 52-geometry-metrics.js
   Narrow-band curvature and topology (Euler characteristic, genus).
   ============================================================ */

// ─── v0.12 Phase 1: Narrow-band curvature analysis ───────────────────────────
// Computes mean curvature H, Gaussian curvature K, and integral curvature
// stats by central differences on the SDF, evaluated only on voxels within
// 1 voxel of the iso-surface (narrow band ~5% of grid).
//
// For an SDF φ with |∇φ| = 1:
//   H = -½ ∇·(∇φ/|∇φ|) = -½ Δφ                         (mean curvature)
//   K = (φx²(φyy φzz - φyz²) + ...) / |∇φ|⁴            (Gaussian curvature)
//
// Sign convention: φ > 0 in solid (NOTE: rawField uses raw>0 in VOID per
// applyModeRaw; we negate below to convert to standard "positive-inside-solid"
// SDF before differentiating, so H > 0 means convex-outward into void).
//
// Returns:
//   H_mean              — area-weighted mean of |H| (mm⁻¹), surface smoothness
//   K_gauss_mean        — area-weighted mean of K (mm⁻²), saddleness vs sphericality
//   curvature_uniformity ∈ [0,1] — 1 - σ_H/⟨|H|⟩, normalized stddev of mean curvature
//   MIH                 — Mean Integrated Curvature in mm⁻¹·mm² (raw integral of H)
function computeCurvatureMetrics(rawField, voidMask, solidMask, cellSizeMm, N) {
  const NN = N * N;
  const N3 = N * N * N;
  const idx_ = (i,j,k) => i*NN + j*N + k;
  // Voxel size in mm — for unit conversion of curvatures
  const h_mm = cellSizeMm / N;

  // Identify narrow-band voxels: solid voxels with at least one void neighbor,
  // OR void voxels with at least one solid neighbor. These straddle the
  // surface; differentiating away from this band wastes work.
  const narrow = new Uint8Array(N3);
  for (let i = 1; i < N-1; i++) {
    for (let j = 1; j < N-1; j++) {
      const baseRow = i*NN + j*N;
      for (let k = 1; k < N-1; k++) {
        const id = baseRow + k;
        const here = solidMask[id];
        // Check 6 neighbors for opposite phase
        const opp = (
          solidMask[idx_(i-1,j,k)] !== here || solidMask[idx_(i+1,j,k)] !== here ||
          solidMask[idx_(i,j-1,k)] !== here || solidMask[idx_(i,j+1,k)] !== here ||
          solidMask[idx_(i,j,k-1)] !== here || solidMask[idx_(i,j,k+1)] !== here
        );
        if (opp) narrow[id] = 1;
      }
    }
  }

  // Sample H and K on narrow band via central differences on -rawField
  // (so positive-inside-solid SDF). Skip degenerate voxels where |∇φ| ≈ 0.
  const Hvals = [];
  const Kvals = [];
  const eps = 1e-6;

  for (let i = 1; i < N-1; i++) {
    for (let j = 1; j < N-1; j++) {
      const baseRow = i*NN + j*N;
      for (let k = 1; k < N-1; k++) {
        const id = baseRow + k;
        if (!narrow[id]) continue;

        // SDF with positive-inside-solid convention (raw field is positive in void)
        const phi = (id_) => -rawField[id_];

        const px = phi(idx_(i+1,j,k)), mx = phi(idx_(i-1,j,k));
        const py = phi(idx_(i,j+1,k)), my = phi(idx_(i,j-1,k));
        const pz = phi(idx_(i,j,k+1)), mz = phi(idx_(i,j,k-1));
        const c = phi(id);

        // First derivatives (per-voxel units, divide by h_mm at end)
        const fx = (px - mx) * 0.5;
        const fy = (py - my) * 0.5;
        const fz = (pz - mz) * 0.5;

        const grad2 = fx*fx + fy*fy + fz*fz;
        if (grad2 < eps) continue;

        // Second derivatives — pure axial
        const fxx = px - 2*c + mx;
        const fyy = py - 2*c + my;
        const fzz = pz - 2*c + mz;

        // Mixed second derivatives (4-point stencil)
        const fxy = (phi(idx_(i+1,j+1,k)) - phi(idx_(i+1,j-1,k))
                   - phi(idx_(i-1,j+1,k)) + phi(idx_(i-1,j-1,k))) * 0.25;
        const fxz = (phi(idx_(i+1,j,k+1)) - phi(idx_(i+1,j,k-1))
                   - phi(idx_(i-1,j,k+1)) + phi(idx_(i-1,j,k-1))) * 0.25;
        const fyz = (phi(idx_(i,j+1,k+1)) - phi(idx_(i,j+1,k-1))
                   - phi(idx_(i,j-1,k+1)) + phi(idx_(i,j-1,k-1))) * 0.25;

        const gradMag = Math.sqrt(grad2);

        // Mean curvature: H = ½ ∇·(∇φ/|∇φ|)
        // = (Δφ |∇φ|² - (∇φ)ᵀ H_φ (∇φ)) / (2 |∇φ|³)
        const lap = fxx + fyy + fzz;
        const quad = fx*fx*fxx + fy*fy*fyy + fz*fz*fzz
                   + 2*(fx*fy*fxy + fx*fz*fxz + fy*fz*fyz);
        const H = (lap * grad2 - quad) / (2 * Math.pow(grad2, 1.5));

        // Gaussian curvature: K = (∇φ)ᵀ adj(H_φ) (∇φ) / |∇φ|⁴
        const m11 = fyy*fzz - fyz*fyz;
        const m22 = fxx*fzz - fxz*fxz;
        const m33 = fxx*fyy - fxy*fxy;
        const m12 = fxz*fyz - fxy*fzz;
        const m13 = fxy*fyz - fxz*fyy;
        const m23 = fxy*fxz - fxx*fyz;
        const Knum = fx*fx*m11 + fy*fy*m22 + fz*fz*m33
                   + 2*(fx*fy*m12 + fx*fz*m13 + fy*fz*m23);
        const K = Knum / (grad2 * grad2);

        // Convert to physical units: H is in (voxel)⁻¹ → divide by h_mm
        // K is in (voxel)⁻² → divide by h_mm²
        Hvals.push(H / h_mm);
        Kvals.push(K / (h_mm * h_mm));
      }
    }
  }

  if (Hvals.length === 0) {
    return {
      H_mean: 0, H_mean_abs: 0, H_std: 0,
      K_gauss_mean: 0, curvature_uniformity: 0, MIH: 0
    };
  }

  // Aggregate (uniform weights — narrow band is roughly area-proportional)
  let sumAbsH = 0, sumH = 0, sumK = 0, sumH2 = 0;
  for (let i = 0; i < Hvals.length; i++) {
    sumAbsH += Math.abs(Hvals[i]);
    sumH += Hvals[i];
    sumK += Kvals[i];
    sumH2 += Hvals[i] * Hvals[i];
  }
  const n = Hvals.length;
  const meanAbsH = sumAbsH / n;
  const meanK = sumK / n;
  const meanH = sumH / n;
  const varH = sumH2 / n - meanH * meanH;
  const stdH = Math.sqrt(Math.max(0, varH));

  // v0.13: curvature_uniformity now uses 1/(1 + σ/⟨|H|⟩) instead of
  // max(0, 1 - σ/⟨|H|⟩). Smooth, bounded (0,1], never floors. Approaches
  // 1 as σ → 0 (perfectly uniform curvature, e.g. CMC surfaces); approaches
  // 0 as σ → ∞ (highly variable). The old form clamped to 0 whenever σ
  // exceeded ⟨|H|⟩, losing information for ~⅔ of designs in real sweeps.
  const uniformity = meanAbsH > eps
    ? 1 / (1 + stdH / meanAbsH)
    : 0;

  // MIH: integral of H over surface. Approximated as ⟨H⟩ × surface area;
  // surface area ≈ narrow-band voxel count × h². Reported per cell.
  // Uses signed sum so MIH carries net convex/concave information.
  const A_per_voxel = h_mm * h_mm;
  const MIH = sumH * A_per_voxel;

  // v0.13 schema:
  //   H_mean      — SIGNED ⟨H⟩. Net convex-outward (>0) / concave-inward (<0)
  //                 bias. We negate the raw H sum here because the underlying
  //                 SDF math (positive-inside-solid, inward-pointing normal)
  //                 gives H < 0 for convex bulges into void; flipping makes
  //                 the sign match the intuitive "convex out → positive"
  //                 convention. Was magnitude in v0.12.
  //   H_mean_abs  — magnitude ⟨|H|⟩. Direction-agnostic, always positive.
  //   H_std       — σ(H) raw on signed H values. Lets vault compose any
  //                 uniformity formula it wants without sweep-side clamping.
  return {
    H_mean:               +(-meanH).toFixed(4),
    H_mean_abs:           +meanAbsH.toFixed(4),
    H_std:                +stdH.toFixed(4),
    K_gauss_mean:         +meanK.toFixed(4),
    curvature_uniformity: +uniformity.toFixed(3),
    MIH:                  +(-MIH).toFixed(4)
  };
}

// ─── v0.12 Phase 1: Topology — Euler characteristic and genus ────────────────
// Computes Euler characteristic χ of the BOUNDARY SURFACE of the solid,
// not the solid volume itself. Boundary χ is the right invariant for
// "genus of the surface" — for a topological ball the surface is a sphere
// with χ=2 and g=0; for a torus solid, surface χ=0 and g=1; for a triply-
// periodic minimal surface like gyroid, the surface χ < 0 and g > 1.
//
// Algorithm: for each solid voxel, enumerate its 6 cube faces. A face is on
// the boundary iff its other side is void (or out-of-grid). Each boundary
// face contributes its 4 vertices, 4 edges, and 1 face-cell to the surface
// complex. We use sets keyed by (i,j,k) coordinates to dedupe shared
// vertices/edges between adjacent boundary faces.
//
// Boundary V/E/F counts → χ = V - E + F. For a closed orientable surface
// with n_components, χ = 2(n_components - g_total). For typical scaffolds
// with one connected component, g = 1 - χ/2.
//
// Returns:
//   euler_char    — Euler characteristic of the boundary surface
//   genus         — g = max(0, n_components - χ/2)
//   genus_per_cell — genus normalized by cell volume (per cm³)
function computeTopology(solidMask, cellSizeMm, N) {
  const NN = N * N;
  const idx_ = (i,j,k) => i*NN + j*N + k;

  // For boundary-face enumeration we use a (N+1)³-keyed encoding for vertex
  // dedupe and per-axis edge keys. Each boundary face contributes:
  //   1 face (with its specific orientation, 6 possible orientations per
  //     voxel collapse into 3 axis-pair planes: face axis = ±x, ±y, ±z
  //     keyed by (axis_dir, position))
  //   4 edges (axis-aligned, on the boundary of that face)
  //   4 vertices
  //
  // We represent positions in vertex-grid coordinates: a voxel at (i,j,k)
  // has its 8 corners at {i+a, j+b, k+c} for a,b,c ∈ {0,1}.
  // The face normal to +x at voxel (i,j,k) is at vertex-x = i+1; to -x at
  // vertex-x = i. The 4 corners are (vx, j+a, k+b) for a,b ∈ {0,1}.

  const stride = N + 2;  // safe encoding stride
  const enc = (a, b, c) => a * stride * stride + b * stride + c;

  const verts = new Set();
  const edgesX = new Set();  // axis-x edges keyed at vertex-coord origin
  const edgesY = new Set();
  const edgesZ = new Set();
  const facesYZ = new Set(); // faces normal to x-axis (in y-z plane)
  const facesXZ = new Set(); // faces normal to y-axis
  const facesXY = new Set(); // faces normal to z-axis

  const isSolidAt = (i, j, k) => {
    if (i < 0 || i >= N || j < 0 || j >= N || k < 0 || k >= N) return 0;
    return solidMask[idx_(i, j, k)];
  };

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        if (!solidMask[idx_(i, j, k)]) continue;

        // Six neighbor checks; each face whose neighbor is void/out is a
        // boundary face. Add its vertices/edges/face to the surface complex.
        // Notation: face at "x = vx" plane has corners (vx, j+a, k+b).

        // -x face (between voxels (i-1,j,k) and (i,j,k))
        if (!isSolidAt(i-1, j, k)) {
          const vx = i;
          facesYZ.add(enc(vx, j, k));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(vx, j+a, k+b));
          edgesY.add(enc(vx, j, k));     edgesY.add(enc(vx, j, k+1));
          edgesZ.add(enc(vx, j, k));     edgesZ.add(enc(vx, j+1, k));
        }
        // +x face
        if (!isSolidAt(i+1, j, k)) {
          const vx = i + 1;
          facesYZ.add(enc(vx, j, k));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(vx, j+a, k+b));
          edgesY.add(enc(vx, j, k));     edgesY.add(enc(vx, j, k+1));
          edgesZ.add(enc(vx, j, k));     edgesZ.add(enc(vx, j+1, k));
        }
        // -y face
        if (!isSolidAt(i, j-1, k)) {
          const vy = j;
          facesXZ.add(enc(i, vy, k));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(i+a, vy, k+b));
          edgesX.add(enc(i, vy, k));     edgesX.add(enc(i, vy, k+1));
          edgesZ.add(enc(i, vy, k));     edgesZ.add(enc(i+1, vy, k));
        }
        // +y face
        if (!isSolidAt(i, j+1, k)) {
          const vy = j + 1;
          facesXZ.add(enc(i, vy, k));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(i+a, vy, k+b));
          edgesX.add(enc(i, vy, k));     edgesX.add(enc(i, vy, k+1));
          edgesZ.add(enc(i, vy, k));     edgesZ.add(enc(i+1, vy, k));
        }
        // -z face
        if (!isSolidAt(i, j, k-1)) {
          const vz = k;
          facesXY.add(enc(i, j, vz));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(i+a, j+b, vz));
          edgesX.add(enc(i, j, vz));     edgesX.add(enc(i, j+1, vz));
          edgesY.add(enc(i, j, vz));     edgesY.add(enc(i+1, j, vz));
        }
        // +z face
        if (!isSolidAt(i, j, k+1)) {
          const vz = k + 1;
          facesXY.add(enc(i, j, vz));
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++)
            verts.add(enc(i+a, j+b, vz));
          edgesX.add(enc(i, j, vz));     edgesX.add(enc(i, j+1, vz));
          edgesY.add(enc(i, j, vz));     edgesY.add(enc(i+1, j, vz));
        }
      }
    }
  }

  const V = verts.size;
  const E = edgesX.size + edgesY.size + edgesZ.size;
  const F = facesXY.size + facesXZ.size + facesYZ.size;
  const euler_char = V - E + F;

  // Number of connected components of the solid via BFS on solidMask.
  let nComp = 0;
  const N3 = N * N * N;
  const visited = new Uint8Array(N3);
  const queue = new Int32Array(N3);
  for (let start = 0; start < N3; start++) {
    if (!solidMask[start] || visited[start]) continue;
    nComp++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const id_ = queue[head++];
      const i = (id_ / NN) | 0;
      const j = ((id_ - i*NN) / N) | 0;
      const k = id_ - i*NN - j*N;
      const enq = (ni, nj, nk) => {
        if (ni < 0 || ni >= N || nj < 0 || nj >= N || nk < 0 || nk >= N) return;
        const nIdx = idx_(ni, nj, nk);
        if (solidMask[nIdx] && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      };
      enq(i-1,j,k); enq(i+1,j,k);
      enq(i,j-1,k); enq(i,j+1,k);
      enq(i,j,k-1); enq(i,j,k+1);
    }
  }

  // For closed orientable surface(s): χ = 2(nComp - g_total) → g = nComp - χ/2.
  // Topological ball: surface=sphere, χ=2, g=0. Torus: χ=0, g=1.
  // Two disjoint balls: χ=4 (two spheres), nComp=2, g = 2 - 2 = 0. ✓
  const genus_raw = nComp - euler_char / 2;
  const genus = Math.max(0, Math.round(genus_raw));

  const cellVol_cm3 = Math.pow(cellSizeMm / 10, 3);
  const genus_per_cell = cellVol_cm3 > 0
    ? +(genus / cellVol_cm3).toFixed(3)
    : 0;

  return { euler_char, genus, genus_per_cell };
}
