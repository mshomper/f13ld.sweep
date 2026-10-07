/* ============================================================
   F13LD.sweep · 51-transport.js
   Throat / percolation, solid-phase percolation, tortuosity.
   ============================================================ */

// ── computeThroatAndPerc ─ family-agnostic geometric throat measurement ─────
// Operates purely on a void mask. Computes:
//   1. 3D Euclidean distance transform via Saito-Toriwaki two-pass
//   2. Per-axis max-min path (widest path) via Dijkstra-style relaxation
// Returns { throat_size, perc_idx } with throat in µm and perc_idx in [0,1].
//
// Replaces the v0.8 surfParam/maxSurfGrad heuristic which measured local
// surface curvature rather than physical throat width — anti-correlated
// with the quantity we actually want. This formulation works identically
// for TPMS, PI-TPMS, and noise modes since it operates on the voxel mask
// downstream of the field/mode threshold.
//
// Cost: ~3×N³ for EDT, ~N³ log N³ per axis for Dijkstra. At N=16 that's
// ~12K + 3×~50K ops; at N=64, 800K + 3×~5M. Sub-millisecond either way.
function computeThroatAndPerc(voidMask, cellSizeMm, N) {
  const NN = N * N;
  const N3 = N * N * N;
  const idx = (i,j,k) => i*NN + j*N + k;

  // ── 1. Squared 3D EDT ────────────────────────────────────────────────────
  // Output: dt2[id] = squared distance (in voxel units) from voxel to nearest
  // solid. Solid voxels (voidMask=0) get dt2 = 0.
  const dt2 = new Int32Array(N3);
  const INF = (N + 1) * (N + 1) * 3;

  // Pass 1: x-direction 1D EDT — for each (j,k) row, two-sweep linear
  // distance from solid; squared at end of pass.
  for (let j = 0; j < N; j++) {
    for (let k = 0; k < N; k++) {
      let prev = INF;
      for (let i = 0; i < N; i++) {
        const id_ = idx(i, j, k);
        prev = voidMask[id_] ? prev + 1 : 0;
        dt2[id_] = prev;
      }
      prev = INF;
      for (let i = N - 1; i >= 0; i--) {
        const id_ = idx(i, j, k);
        prev = voidMask[id_] ? prev + 1 : 0;
        const linear = Math.min(dt2[id_], prev);
        dt2[id_] = linear * linear;
      }
    }
  }

  // Pass 2: y-direction reduction — dt2[i,j,k] = min over j' of dt2[i,j',k] + (j-j')².
  const tmp = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) tmp[j] = dt2[idx(i, j, k)];
      for (let j = 0; j < N; j++) {
        let best = INF;
        for (let jp = 0; jp < N; jp++) {
          const d = j - jp;
          const v = tmp[jp] + d * d;
          if (v < best) best = v;
        }
        dt2[idx(i, j, k)] = best;
      }
    }
  }

  // Pass 3: z-direction reduction.
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) tmp[k] = dt2[idx(i, j, k)];
      for (let k = 0; k < N; k++) {
        let best = INF;
        for (let kp = 0; kp < N; kp++) {
          const d = k - kp;
          const v = tmp[kp] + d * d;
          if (v < best) best = v;
        }
        dt2[idx(i, j, k)] = best;
      }
    }
  }

  // ── 2. Widest path (max-min Dijkstra) per axis ───────────────────────────
  // Returns largest min-dt² achievable on any path from start face to end.
  function widestPath(axis) {
    const best = new Int32Array(N3);
    const heap = [];
    function push(id, key) {
      heap.push([-key, id]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] > heap[i][0]) {
          const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
          i = p;
        } else break;
      }
    }
    function pop() {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        const n = heap.length;
        while (true) {
          const l = 2*i+1, r = 2*i+2;
          let s = i;
          if (l < n && heap[l][0] < heap[s][0]) s = l;
          if (r < n && heap[r][0] < heap[s][0]) s = r;
          if (s === i) break;
          const t = heap[s]; heap[s] = heap[i]; heap[i] = t;
          i = s;
        }
      }
      return top;
    }

    // Seed start face — each void voxel contributes its own dt2.
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      let si, sj, sk;
      if (axis===0)      { si=0; sj=a; sk=b; }
      else if (axis===1) { si=a; sj=0; sk=b; }
      else               { si=a; sj=b; sk=0; }
      const id_ = idx(si,sj,sk);
      if (voidMask[id_]) {
        best[id_] = dt2[id_];
        push(id_, dt2[id_]);
      }
    }

    let foundBest = 0;
    while (heap.length > 0) {
      const [negKey, id_] = pop();
      const key = -negKey;
      if (key < best[id_]) continue;
      if (key <= foundBest) continue;

      const i = (id_ / NN) | 0;
      const j = ((id_ - i*NN) / N) | 0;
      const k = id_ - i*NN - j*N;

      const isEnd = (axis===0 && i===N-1) ||
                    (axis===1 && j===N-1) ||
                    (axis===2 && k===N-1);
      if (isEnd) {
        if (key > foundBest) foundBest = key;
        continue;
      }

      const relax = (ni) => {
        if (!voidMask[ni]) return;
        const newKey = Math.min(key, dt2[ni]);
        if (newKey > best[ni]) {
          best[ni] = newKey;
          push(ni, newKey);
        }
      };
      if (i>0)   relax(idx(i-1,j,k));
      if (i<N-1) relax(idx(i+1,j,k));
      if (j>0)   relax(idx(i,j-1,k));
      if (j<N-1) relax(idx(i,j+1,k));
      if (k>0)   relax(idx(i,j,k-1));
      if (k<N-1) relax(idx(i,j,k+1));
    }

    return foundBest;
  }

  const w0 = widestPath(0);
  const w1 = widestPath(1);
  const w2 = widestPath(2);
  const widestSq = Math.max(w0, w1, w2);
  const voxelSize_um = (cellSizeMm * 1000) / N;
  const throat_size = widestSq > 0
    ? Math.round(2 * Math.sqrt(widestSq) * voxelSize_um)
    : 0;

  // perc_idx: any axis with widestPath > 0 percolates.
  // v0.12: also expose per-axis booleans for the multiphysics expansion;
  // Phase 3 Stokes pre-flight needs them axis-by-axis to skip non-percolating
  // axes early.
  const px = w0 > 0 ? 1 : 0;
  const py = w1 > 0 ? 1 : 0;
  const pz = w2 > 0 ? 1 : 0;
  const perc_idx = +((px + py + pz) / 3).toFixed(2);

  return { throat_size, perc_idx, perc_x: px, perc_y: py, perc_z: pz };
}

// ─── v0.12 Phase 1: Solid-phase face-to-face percolation ─────────────────────
// Per-axis BFS through the solid mask, asking "does a connected solid path
// reach from the start face to the opposite face?". Replaces the loop-based
// computeAxisConnectivity for the connect_idx metric — answers the actual
// engineering question (can load transmit?) rather than the proxy question
// (does the structure form periodic loops?).
//
// Returns { connect_idx, connect_x, connect_y, connect_z } where the per-axis
// fields are 0/1 booleans and connect_idx is the mean.
//
// Cost: 3× BFS at most, each at O(N³) worst case. At N=64, ~800K ops total.
// Sub-millisecond.
function computeSolidPercolation(solidMask, N) {
  const NN = N * N;
  const N3 = N * N * N;
  const idx = (i,j,k) => i*NN + j*N + k;

  function bfsSpansAxis(axis) {
    const visited = new Uint8Array(N3);
    const queue = new Int32Array(N3);
    let head = 0, tail = 0;

    // Seed start face
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      let si, sj, sk;
      if (axis === 0)      { si = 0; sj = a; sk = b; }
      else if (axis === 1) { si = a; sj = 0; sk = b; }
      else                 { si = a; sj = b; sk = 0; }
      const id_ = idx(si, sj, sk);
      if (solidMask[id_] && !visited[id_]) {
        visited[id_] = 1;
        queue[tail++] = id_;
      }
    }

    while (head < tail) {
      const id_ = queue[head++];
      const i = (id_ / NN) | 0;
      const j = ((id_ - i*NN) / N) | 0;
      const k = id_ - i*NN - j*N;

      // Reached the opposite face?
      if ((axis === 0 && i === N-1) ||
          (axis === 1 && j === N-1) ||
          (axis === 2 && k === N-1)) return 1;

      const enq = (ni, nj, nk) => {
        if (ni < 0 || ni >= N || nj < 0 || nj >= N || nk < 0 || nk >= N) return;
        const nIdx = idx(ni, nj, nk);
        if (solidMask[nIdx] && !visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      };
      enq(i-1, j, k); enq(i+1, j, k);
      enq(i, j-1, k); enq(i, j+1, k);
      enq(i, j, k-1); enq(i, j, k+1);
    }
    return 0;
  }

  const cx = bfsSpansAxis(0);
  const cy = bfsSpansAxis(1);
  const cz = bfsSpansAxis(2);
  const connect_idx = +((cx + cy + cz) / 3).toFixed(2);
  return { connect_idx, connect_x: cx, connect_y: cy, connect_z: cz };
}

// ─── v0.12 Phase 1: Geometric tortuosity ─────────────────────────────────────
// Per-axis shortest-path length through the void phase, normalized by the
// straight-line cell length. τ = path_length / N. Bounded [1, ∞), capped at 10
// for vault sanity (τ > 10 means pathological tortuous geometry that's
// effectively impermeable anyway).
//
// Used standalone as a transport metric AND as the input to the Bruggeman
// diffusivity estimate D_eff/D_bulk = ε / τ². When Phase 3 ships the FFT-CG
// Stokes solve, hydraulic tortuosity will land alongside this geometric one.
//
// If an axis doesn't percolate (no path exists), τ = ∞ → reported as the cap
// value 10 with a flag bit.
function computeTortuosity(voidMask, N) {
  const NN = N * N;
  const N3 = N * N * N;
  const idx = (i,j,k) => i*NN + j*N + k;
  const TAU_CAP = 10.0;

  function bfsShortest(axis) {
    // Multi-source BFS from start face, returns shortest path length to any
    // voxel on opposite face (in voxel units). 0 if no path exists.
    const dist = new Int32Array(N3);  // 0 = unvisited
    const queue = new Int32Array(N3);
    let head = 0, tail = 0;

    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      let si, sj, sk;
      if (axis === 0)      { si = 0; sj = a; sk = b; }
      else if (axis === 1) { si = a; sj = 0; sk = b; }
      else                 { si = a; sj = b; sk = 0; }
      const id_ = idx(si, sj, sk);
      if (voidMask[id_]) {
        dist[id_] = 1;  // distance 1 at the start face (will subtract at end)
        queue[tail++] = id_;
      }
    }

    let bestEnd = 0;
    while (head < tail) {
      const id_ = queue[head++];
      const d = dist[id_];
      const i = (id_ / NN) | 0;
      const j = ((id_ - i*NN) / N) | 0;
      const k = id_ - i*NN - j*N;

      if ((axis === 0 && i === N-1) ||
          (axis === 1 && j === N-1) ||
          (axis === 2 && k === N-1)) {
        if (bestEnd === 0 || d < bestEnd) bestEnd = d;
        // Don't return immediately — need shortest among all start seeds,
        // but BFS guarantees first-reached is shortest, so we can return now.
        return d - 1;
      }

      const enq = (ni, nj, nk) => {
        if (ni < 0 || ni >= N || nj < 0 || nj >= N || nk < 0 || nk >= N) return;
        const nIdx = idx(ni, nj, nk);
        if (voidMask[nIdx] && dist[nIdx] === 0) {
          dist[nIdx] = d + 1;
          queue[tail++] = nIdx;
        }
      };
      enq(i-1, j, k); enq(i+1, j, k);
      enq(i, j-1, k); enq(i, j+1, k);
      enq(i, j, k-1); enq(i, j, k+1);
    }
    return 0;  // no path found
  }

  const ax = (axis) => {
    const path = bfsShortest(axis);
    if (path === 0) return TAU_CAP;
    // BFS path is in voxel-step count. Straight-line is N-1 voxels.
    const tau = path / (N - 1);
    return Math.min(tau, TAU_CAP);
  };

  return {
    tortuosity_x: +ax(0).toFixed(3),
    tortuosity_y: +ax(1).toFixed(3),
    tortuosity_z: +ax(2).toFixed(3)
  };
}
