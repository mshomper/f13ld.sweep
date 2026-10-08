/* ============================================================
   F13LD.sweep · 50-hires-field.js
   A design's voxels and signed field at any grid N, for the geometry
   metrics (connectivity, pores, curvature, topology, tortuosity).

   Both come from the shared geometry (geom/voxels.js), so the metrics
   describe exactly the voxels the solver sees and Mesh prints:
     solidMask   buildVoxels — the solid test itself
     rawField    −margin at the voxel centres: > 0 in void, ≤ 0 in solid,
                 in field units (a distance for the normalized TPMS modes)
   PI-TPMS, noise and grain use a finer grid for these metrics than for
   the solve (thin pipes and sheets are under-resolved at 16–32).
   ============================================================ */

function buildGeomField(geo, N) {
  const N3 = N * N * N, NN = N * N;
  const L = Math.PI, step = (2 * L) / N;
  const solidMask = designVoxels(geo, N);
  const margin = designMarginFn(geo);
  const rawField = new Float32Array(N3);
  const voidMask = new Uint8Array(N3);
  for (let i = 0; i < N; i++) {
    const x = -L + (i + 0.5) * step;
    for (let j = 0; j < N; j++) {
      const y = -L + (j + 0.5) * step;
      for (let k = 0; k < N; k++) {
        const id = i * NN + j * N + k;
        rawField[id] = -margin(x, y, -L + (k + 0.5) * step);
        voidMask[id] = solidMask[id] > 0.5 ? 0 : 1;
      }
    }
  }
  return { solidMask, voidMask, rawField, N };
}

/* Preview bake: the design's margin (solid ⟺ m > 0) at the N³ voxel
   centres, stored x-fastest (WebGL texImage3D order), plus the largest
   finite-difference slope |∇m| per unit of the [-1,1] preview box — the
   raymarcher divides by it to step safely on a field that is not a
   distance. Runs in a worker (60-solver-pool.js previewBake). */
function bakePreviewField(recipe, N) {
  const geo = designGeometry(recipe);
  const m = designMarginFn(geo);
  const L = Math.PI, step = (2 * L) / N;
  const data = new Float32Array(N * N * N);
  for (let iz = 0; iz < N; iz++) {
    const z = -L + (iz + 0.5) * step;
    for (let iy = 0; iy < N; iy++) {
      const y = -L + (iy + 0.5) * step;
      for (let ix = 0; ix < N; ix++) data[(iz * N + iy) * N + ix] = m(-L + (ix + 0.5) * step, y, z);
    }
  }
  let g = 0;
  const h = 2 / N;                                   /* voxel edge in preview-box units */
  for (let iz = 0; iz < N - 1; iz++) for (let iy = 0; iy < N - 1; iy++) for (let ix = 0; ix < N - 1; ix++) {
    const id = (iz * N + iy) * N + ix, v = data[id];
    const dx = Math.abs(data[id + 1] - v);
    const dy = Math.abs(data[id + N] - v);
    const dz = Math.abs(data[id + N * N] - v);
    const s = Math.sqrt(dx * dx + dy * dy + dz * dz) / h;
    if (s > g && isFinite(s)) g = s;
  }
  return { N, data, lip: g > 0 ? g : 1, family: geo.family };
}
