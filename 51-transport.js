/* ============================================================
   F13LD.sweep · 51-transport.js
   Throat / percolation, solid-phase percolation, tortuosity.

   All three work on ONE periodic unit cell (N³ voxel centres over
   [-π,π]³, index i·N²+j·N+k) that tiles space.  Nothing here treats the
   cell faces as walls: neighbours wrap, and a phase "percolates along
   axis a" iff some connected component (6-connectivity, periodic) wraps
   across a — its unwrapped copy meets its own periodic image shifted by
   one cell (or more) along a.  Same definition as F13LD.lab
   periodicComponents (14a-connectivity.js).  Masks may be Float32Array
   or Uint8Array; > 0.5 is "in the phase".
   ============================================================ */

// ── Shared periodic helpers ──────────────────────────────────────────────────

/* Mask → Uint8Array 0/1 (> 0.5 is in the phase). */
function trBinaryMask(mask, N3) {
  const m = new Uint8Array(N3);
  for (let i = 0; i < N3; i++) m[i] = mask[i] > 0.5 ? 1 : 0;
  return m;
}

/* Periodic 6-connected components with wrap bits (port of F13LD.lab
   periodicComponents).  Each voxel stores the periodic image it was reached
   in; meeting an already-labelled voxel in a different image means the
   component reconnects to its own image → wraps along the axes where the
   images differ.  Returns { label, count, wraps:[0, bits…], bits } with
   bits 1 = x (i), 2 = y (j), 4 = z (k); `bits` is the OR over components. */
function trPeriodicComponents(m, N) {
  const N3 = N * N * N, SA = N * N, SB = N, Nm1 = N - 1;
  const label = new Int32Array(N3), stack = new Int32Array(N3);
  const ox = new Int8Array(N3), oy = new Int8Array(N3), oz = new Int8Array(N3);
  const wraps = [0];
  let comp = 0, top = 0, all = 0;
  const visit = (nb, cx, cy, cz) => {
    if (!m[nb]) return;
    if (!label[nb]) { label[nb] = comp; ox[nb] = cx; oy[nb] = cy; oz[nb] = cz; stack[top++] = nb; return; }
    let w = 0;
    if (ox[nb] !== ((cx << 24) >> 24)) w |= 1;   // compare as int8 (typed-array wrap)
    if (oy[nb] !== ((cy << 24) >> 24)) w |= 2;
    if (oz[nb] !== ((cz << 24) >> 24)) w |= 4;
    if (w) wraps[comp] |= w;
  };
  for (let seed = 0; seed < N3; seed++) {
    if (!m[seed] || label[seed]) continue;
    comp++; wraps.push(0);
    top = 0; stack[top++] = seed; label[seed] = comp; ox[seed] = 0; oy[seed] = 0; oz[seed] = 0;
    while (top > 0) {
      const id = stack[--top];
      const a = (id / SA) | 0, rem = id - a * SA, b = (rem / SB) | 0, c = rem - b * SB;
      const X = ox[id], Y = oy[id], Z = oz[id];
      // crossing a cell face moves to the neighbouring periodic image (offset ±1)
      visit((a === 0 ? Nm1 : a - 1) * SA + b * SB + c, a === 0 ? X - 1 : X, Y, Z);
      visit((a === Nm1 ? 0 : a + 1) * SA + b * SB + c, a === Nm1 ? X + 1 : X, Y, Z);
      visit(a * SA + (b === 0 ? Nm1 : b - 1) * SB + c, X, b === 0 ? Y - 1 : Y, Z);
      visit(a * SA + (b === Nm1 ? 0 : b + 1) * SB + c, X, b === Nm1 ? Y + 1 : Y, Z);
      visit(a * SA + b * SB + (c === 0 ? Nm1 : c - 1), X, Y, c === 0 ? Z - 1 : Z);
      visit(a * SA + b * SB + (c === Nm1 ? 0 : c + 1), X, Y, c === Nm1 ? Z + 1 : Z);
    }
    all |= wraps[comp];
  }
  return { label, count: comp, wraps, bits: all };
}

/* Periodic exact squared EDT (Felzenszwalb–Huttenlocher), port of F13LD.lab
   periodicEdt3d (14c-stl-import.js).  In place on A (Float64Array N³):
   0 at features, TR_EDT_INF elsewhere.  Each 1D pass runs on the line padded
   by N/2 wrapped samples per side — enough, because the periodic distance
   along one axis never exceeds N/2.  Voxel-centre distances, so a voxel
   face-adjacent to a feature gets 1. */
const TR_EDT_INF = 1e20;
/* v0.29.1 — w = [wx, wy, wz]: voxel edge per axis (a stretched cell), in
   units of the mean edge; omitted = a cube (the original, unchanged). The
   1-D pass measures (w·Δq)² — Felzenszwalb–Huttenlocher with a scaled axis. */
function trPeriodicEdt2(A, N, w) {
  const h = N >> 1, E = 2 * N, NN = N * N;
  const f = new Float64Array(E), d = new Float64Array(E), v = new Int32Array(E), z = new Float64Array(E + 1);
  const wrap = new Int32Array(E), off = new Int32Array(E);
  for (let t = 0; t < E; t++) wrap[t] = ((t - h) % N + N) % N;
  let a2 = 1;   /* the current pass's squared edge */
  const edt1d = () => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < E; q++) {
      let s = ((f[q] + a2 * q * q) - (f[v[k]] + a2 * v[k] * v[k])) / (a2 * (2 * q - 2 * v[k]));
      while (s <= z[k]) { k--; s = ((f[q] + a2 * q * q) - (f[v[k]] + a2 * v[k] * v[k])) / (a2 * (2 * q - 2 * v[k])); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < E; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = a2 * dq * dq + f[v[k]];
    }
  };
  const W = w || [1, 1, 1];
  const pass = (stride, baseOf, wa) => {
    a2 = wa * wa;
    for (let t = 0; t < E; t++) off[t] = wrap[t] * stride;
    for (let p = 0; p < NN; p++) {
      const base = baseOf(p);
      let any = false;
      for (let t = 0; t < E; t++) { const val = A[base + off[t]]; f[t] = val; if (val < TR_EDT_INF) any = true; }
      if (!any) continue;
      edt1d();
      for (let q = 0; q < N; q++) A[base + q * stride] = Math.min(d[q + h], TR_EDT_INF);
    }
  };
  pass(1,  (p) => ((p / N) | 0) * NN + (p % N) * N, W[2]);   // along k (z)
  pass(N,  (p) => ((p / N) | 0) * NN + (p % N), W[1]);       // along j (y)
  pass(NN, (p) => p, W[0]);                                  // along i (x)
  return A;
}

// ── computeThroatAndPerc ─ family-agnostic geometric throat measurement ─────
// Operates purely on a void mask, on the periodic cell:
//   1. Squared periodic EDT of the void (distance from each void voxel centre
//      to the nearest solid voxel centre, wrapping across the cell faces).
//   2. Per-axis widest-path bottleneck on the periodic domain: the largest t
//      such that the void voxels with dt² ≥ t still contain a component that
//      wraps along that axis.  Computed for all three axes at once by adding
//      void voxels in decreasing dt² order into a union-find that tracks each
//      voxel's periodic image offset (Kruskal on the max-min path); the dt² at
//      which an axis first wraps is that axis's bottleneck.
//
// Returns (µm, voxel-centre convention: diameter = 2·√dt²·voxel):
//   throat_x/y/z — per-axis bottleneck diameter (0 if the void does not
//                  percolate along that axis)
//   throat_size  — WIDEST bottleneck over the percolating axes, i.e.
//                  max(throat_x, throat_y, throat_z): the largest sphere that
//                  can pass through the tiled structure along its easiest
//                  axis.  (Not the minimum throat — see throat_x/y/z.)
//   perc_x/y/z   — 0/1, void percolates (wraps) along that axis
//   perc_idx     — fraction of axes that percolate (0, 0.33, 0.67, 1)
//
// Cost: EDT ~3·2N per line × 3N² lines (O(N³)); counting sort + union-find
// ~6·N³·α.  ~0.1–0.2 s at N=96.
function computeThroatAndPerc(voidMask, cellSizeMm, N, w) {
  const NN = N * N, N3 = NN * N, Nm1 = N - 1;
  const m = trBinaryMask(voidMask, N3);
  /* v0.29.1 — a stretched cell (w) measures distance per axis; its squared
     distances are no longer whole numbers, so the sort keys keep 1/16 voxel² */
  const cube = !w || (w[0] === 1 && w[1] === 1 && w[2] === 1);
  const KS = cube ? 1 : 16, wMax = cube ? 1 : Math.max(w[0], w[1], w[2]);

  // ── 1. Squared periodic EDT (features = solid voxels) ────────────────────
  const A = new Float64Array(N3);
  let nVoid = 0;
  for (let i = 0; i < N3; i++) { if (m[i]) { A[i] = TR_EDT_INF; nVoid++; } else A[i] = 0; }
  trPeriodicEdt2(A, N, cube ? null : w);
  // No solid at all → every line stays at INF; cap at the largest periodic
  // distance a cell can hold.
  const maxKey = Math.ceil(KS * (3 * (N >> 1) * (N >> 1) * wMax * wMax + 3));
  const key = new Int32Array(N3);
  for (let i = 0; i < N3; i++) key[i] = m[i] ? Math.min(Math.max(1, Math.round(A[i] * KS)), maxKey) : 0;

  // ── 2. Kruskal widest-path with periodic image offsets ───────────────────
  // Counting sort of void voxels by dt², descending.
  const cnt = new Int32Array(maxKey + 2);
  for (let i = 0; i < N3; i++) if (m[i]) cnt[key[i]]++;
  const start = new Int32Array(maxKey + 2);
  for (let k = maxKey, s = 0; k >= 0; k--) { start[k] = s; s += cnt[k]; }
  const order = new Int32Array(nVoid);
  for (let i = 0; i < N3; i++) if (m[i]) order[start[key[i]]++] = i;

  const parent = new Int32Array(N3).fill(-1);   // -1 = not yet added
  const size = new Int32Array(N3);
  const off = new Int32Array(3 * N3);           // image offset relative to parent
  let fx = 0, fy = 0, fz = 0;                   // offset of the last find() arg to its root
  const find = (x) => {
    let r = x, sx = 0, sy = 0, sz = 0;
    while (parent[r] !== r) { sx += off[3*r]; sy += off[3*r+1]; sz += off[3*r+2]; r = parent[r]; }
    // path compression: point every node on the path at r with its full offset
    let cur = x, rx = sx, ry = sy, rz = sz;
    while (cur !== r) {
      const nxt = parent[cur], ax = off[3*cur], ay = off[3*cur+1], az = off[3*cur+2];
      parent[cur] = r; off[3*cur] = rx; off[3*cur+1] = ry; off[3*cur+2] = rz;
      rx -= ax; ry -= ay; rz -= az; cur = nxt;
    }
    fx = sx; fy = sy; fz = sz;
    return r;
  };

  const wrapSq = [0, 0, 0];   // bottleneck dt² per axis (0 = never wraps)
  let found = 0;              // bits of axes already wrapped
  const link = (u, v, ex, ey, ez) => {   // v's image = u's image + e
    if (parent[v] < 0) return 0;
    const ru = find(u); const ux = fx, uy = fy, uz = fz;
    const rv = find(v); const vx = fx, vy = fy, vz = fz;
    if (ru === rv) {
      let w = 0;
      if (ux + ex !== vx) w |= 1;
      if (uy + ey !== vy) w |= 2;
      if (uz + ez !== vz) w |= 4;
      return w;
    }
    // attach smaller root under larger; o(ru wrt rv) = o(v) − e − o(u)
    let dx = vx - ex - ux, dy = vy - ey - uy, dz = vz - ez - uz;
    if (size[ru] <= size[rv]) {
      parent[ru] = rv; size[rv] += size[ru];
      off[3*ru] = dx; off[3*ru+1] = dy; off[3*ru+2] = dz;
    } else {
      parent[rv] = ru; size[ru] += size[rv];
      off[3*rv] = -dx; off[3*rv+1] = -dy; off[3*rv+2] = -dz;
    }
    return 0;
  };

  for (let n = 0; n < nVoid && found !== 7; n++) {
    const id = order[n];
    parent[id] = id; size[id] = 1;
    const i = (id / NN) | 0, rem = id - i * NN, j = (rem / N) | 0, k = rem - j * N;
    let w = 0;
    w |= link(id, (i === 0 ? Nm1 : i - 1) * NN + rem, i === 0 ? -1 : 0, 0, 0);
    w |= link(id, (i === Nm1 ? 0 : i + 1) * NN + rem, i === Nm1 ? 1 : 0, 0, 0);
    w |= link(id, i * NN + (j === 0 ? Nm1 : j - 1) * N + k, 0, j === 0 ? -1 : 0, 0);
    w |= link(id, i * NN + (j === Nm1 ? 0 : j + 1) * N + k, 0, j === Nm1 ? 1 : 0, 0);
    w |= link(id, i * NN + j * N + (k === 0 ? Nm1 : k - 1), 0, 0, k === 0 ? -1 : 0);
    w |= link(id, i * NN + j * N + (k === Nm1 ? 0 : k + 1), 0, 0, k === Nm1 ? 1 : 0);
    const fresh = w & ~found;
    if (fresh) {
      for (let a = 0; a < 3; a++) if (fresh & (1 << a)) wrapSq[a] = key[id];
      found |= fresh;
    }
  }

  const voxelSize_um = (cellSizeMm * 1000) / N;
  const diam = (sq) => sq > 0 ? Math.round(2 * Math.sqrt(sq / KS) * voxelSize_um) : 0;
  const throat_x = diam(wrapSq[0]), throat_y = diam(wrapSq[1]), throat_z = diam(wrapSq[2]);
  // Widest bottleneck over the percolating axes (see header).
  const throat_size = Math.max(throat_x, throat_y, throat_z);

  // v0.12 per-axis booleans (Phase 3 Stokes pre-flight skips non-percolating
  // axes); every void voxel has dt² ≥ 1, so wrapSq > 0 ⇔ the axis wraps.
  const px = wrapSq[0] > 0 ? 1 : 0;
  const py = wrapSq[1] > 0 ? 1 : 0;
  const pz = wrapSq[2] > 0 ? 1 : 0;
  const perc_idx = +((px + py + pz) / 3).toFixed(2);

  return { throat_size, throat_x, throat_y, throat_z, perc_idx, perc_x: px, perc_y: py, perc_z: pz };
}

// ─── Solid-phase percolation (periodic) ──────────────────────────────────────
// "Can load transmit along axis a through the tiled structure?" — true iff
// some 6-connected solid component wraps along a (meets its own periodic
// image).  A piece that touches both x faces without meeting its own image
// (e.g. an isolated sphere of diameter ≥ cell) is a floating island once
// tiled and does NOT count.
//
// Returns { connect_idx, connect_x, connect_y, connect_z }: per-axis 0/1 and
// their mean (0, 0.33, 0.67, 1).
//
// Cost: one periodic labelling pass, O(N³).
function computeSolidPercolation(solidMask, N) {
  const N3 = N * N * N;
  const pc = trPeriodicComponents(trBinaryMask(solidMask, N3), N), bits = pc.bits;
  const cx = bits & 1 ? 1 : 0;
  const cy = bits & 2 ? 1 : 0;
  const cz = bits & 4 ? 1 : 0;
  const connect_idx = +((cx + cy + cz) / 3).toFixed(2);
  /* v0.26.0 — shear in a plane needs ONE piece that runs through the cell
     along both of its axes: loose X fibres woven past loose Z fibres carry
     no XZ shear; a plate in the XZ plane does. */
  const both = m => { for (let c = 1; c <= pc.count; c++) if ((pc.wraps[c] & m) === m) return 1; return 0; };
  return { connect_idx, connect_x: cx, connect_y: cy, connect_z: cz, shear_yz: both(6), shear_xz: both(5), shear_xy: both(3) };
}

// ─── Geometric tortuosity (periodic) ─────────────────────────────────────────
// Per axis a: geometric length of the shortest void path per cell advanced
// along a in the tiled structure, divided by the cell length: τ = L / N ≥ 1.
//
// The cell is unrolled along a (a strip from slice a=0 to its image a=N; the
// two lateral axes wrap freely) and a Dijkstra runs through the void.  Moves
// are 26-connected with Euclidean step lengths 1, √2, √3; a diagonal move is
// allowed only if it can be replaced by face-steps through void inside its
// 2×2(×2) block, so a path never squeezes between two solid voxels that
// touch along an edge or corner — the reachable set is exactly the
// 6-connected one used for perc_x/y/z.  With only three step lengths,
// Dijkstra uses one FIFO per length (each stays sorted): O(E), no heap.
//
// A single slice-to-slice crossing with a free exit point under-reads τ: a
// path can cut across a slanted channel because it never has to continue
// into the next cell.  So two cells are chained: cell 1 runs from every void
// voxel on slice 0 and records the arrival length at every exit voxel; cell 2
// starts from those arrivals; τ = (L₂ − L₁) / N, the length of one more cell
// once the path is committed to a route that repeats.  Exact for straight
// and diagonal channels (τ = 1, √2, √3 up to voxelisation).
//
// Used standalone AND as the Bruggeman input D_eff/D_bulk = ε / τ².
//
// Non-percolating axis: τ reported as the cap value 10 and its bit set in
// tortuosity_nonperc (1 = x, 2 = y, 4 = z).  τ > 10 on a percolating axis is
// also capped at 10 but its bit is NOT set.
/* v0.29.1 — w = [wx, wy, wz] (a stretched cell): each move costs its real
   length √Σ(d_a·w_a)², and τ = path ÷ the straight route N·w_axis. Moves of
   equal length share a FIFO (each FIFO adds one constant, so it stays
   sorted); a cube keeps the original three (1, √2, √3). */
function computeTortuosity(voidMask, N, w) {
  const NN = N * N, N3 = NN * N;
  const W = w || [1, 1, 1];
  const TAU_CAP = 10.0;
  const m = trBinaryMask(voidMask, N3);
  const prevT = new Int32Array(N), nextT = new Int32Array(N);
  for (let t = 0; t < N; t++) { prevT[t] = (t + N - 1) % N; nextT[t] = (t + 1) % N; }

  // 26 moves with the corner-cutting rule (see header), as flat tables.
  // Neighbourhood slot of offset (dx,dy,dz) = (dx+1)·9 + (dy+1)·3 + (dz+1).
  // Edge move: allowed if face intermediate f0 or f1 is void.  Vertex move:
  // allowed if some face fA and an edge containing it (eAB / eAC) are void.
  const slotOf = (dx, dy, dz) => (dx + 1) * 9 + (dy + 1) * 3 + (dz + 1);
  const MT = [], MN = [], MW = [], MD = [[], [], []], MF = [], ME = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const d = [dx, dy, dz], n = (dx !== 0) + (dy !== 0) + (dz !== 0);
    if (n === 0) continue;
    MT.push(slotOf(dx, dy, dz)); MN.push(n);
    MW.push(w ? Math.sqrt((dx * W[0]) ** 2 + (dy * W[1]) ** 2 + (dz * W[2]) ** 2) : (n === 1 ? 1 : n === 2 ? Math.SQRT2 : Math.sqrt(3)));
    for (let a = 0; a < 3; a++) MD[a].push(d[a]);
    const face = (a) => { const q = [0, 0, 0]; q[a] = d[a]; return slotOf(q[0], q[1], q[2]); };
    const edge = (drop) => { const q = d.slice(); q[drop] = 0; return slotOf(q[0], q[1], q[2]); };
    if (n === 2) { const ax = [0, 1, 2].filter((a) => d[a]); MF.push([face(ax[0]), face(ax[1]), 13]); ME.push([13, 13, 13]); }
    else if (n === 3) { MF.push([face(0), face(1), face(2)]); ME.push([edge(2), edge(1), edge(0)]); } // e01, e02, e12
    else { MF.push([13, 13, 13]); ME.push([13, 13, 13]); }
  }
  const mT = Int32Array.from(MT), mN = Int32Array.from(MN), mW = Float64Array.from(MW);
  /* one FIFO per distinct move length, shortest first; seeds in the last */
  const lens = Array.from(new Set(MW.map(v => +v.toPrecision(12)))).sort((a, b) => a - b);
  const mQ = Int32Array.from(MW.map(v => lens.indexOf(+v.toPrecision(12))));
  const NQ = lens.length;
  const mD = MD.map((x) => Int32Array.from(x));
  const mF0 = Int32Array.from(MF.map((x) => x[0])), mF1 = Int32Array.from(MF.map((x) => x[1])), mF2 = Int32Array.from(MF.map((x) => x[2]));
  const mE01 = Int32Array.from(ME.map((x) => x[0])), mE02 = Int32Array.from(ME.map((x) => x[1])), mE12 = Int32Array.from(ME.map((x) => x[2]));

  // Growable FIFO per step length: parallel arrays of node id and key.
  const mkQ = () => ({ id: new Int32Array(1 << 16), key: new Float64Array(1 << 16), h: 0, t: 0 });
  const qPush = (q, id, k) => {
    if (q.t === q.id.length) {
      if (q.h > (q.t >> 1)) {           // compact
        q.id.copyWithin(0, q.h, q.t); q.key.copyWithin(0, q.h, q.t); q.t -= q.h; q.h = 0;
      } else {
        const ni = new Int32Array(q.id.length * 2); ni.set(q.id); q.id = ni;
        const nk = new Float64Array(q.key.length * 2); nk.set(q.key); q.key = nk;
      }
    }
    q.id[q.t] = id; q.key[q.t] = k; q.t++;
  };

  // Allowed-move bitmask per void voxel (bit mi = move mi passes the void and
  // corner-cutting tests).  Built once, shared by the 3 axes × 2 runs.
  const allow = new Int32Array(N3);
  {
    const nb = new Uint8Array(27);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const id = i * NN + j * N + k;
      if (!m[id]) continue;
      let t = 0;
      for (let a = 0; a < 3; a++) {
        const xb = (a === 0 ? prevT[i] : a === 1 ? i : nextT[i]) * NN;
        for (let b = 0; b < 3; b++) {
          const yb = xb + (b === 0 ? prevT[j] : b === 1 ? j : nextT[j]) * N;
          nb[t++] = m[yb + prevT[k]]; nb[t++] = m[yb + k]; nb[t++] = m[yb + nextT[k]];
        }
      }
      let bits = 0;
      for (let mi = 0; mi < 26; mi++) {
        if (!nb[mT[mi]]) continue;
        const n = mN[mi];
        if (n === 2) {
          if (!nb[mF0[mi]] && !nb[mF1[mi]]) continue;
        } else if (n === 3) {
          const e01 = nb[mE01[mi]], e02 = nb[mE02[mi]], e12 = nb[mE12[mi]];
          if (!((nb[mF0[mi]] && (e01 || e02)) || (nb[mF1[mi]] && (e01 || e12)) || (nb[mF2[mi]] && (e02 || e12)))) continue;
        }
        bits |= 1 << mi;
      }
      allow[id] = bits;
    }
  }
  // Flat index step per move for voxels away from the cell faces.
  const mOff = new Int32Array(26);
  for (let mi = 0; mi < 26; mi++) mOff[mi] = mD[0][mi] * NN + mD[1][mi] * N + mD[2][mi];
  const dist = new Float64Array(N3);

  // seed: null → every void voxel on slice 0 starts at 0; else per-voxel start
  // keys (slice-0 ids).  arrive: null → stop at the first arrival on slice N
  // and return it; else run to exhaustion, write each slice-N arrival into
  // arrive[slice-0 id] and return the minimum.
  function shortest(axis, seed, arrive) {
    dist.fill(Infinity);
    const Q = [];   // one FIFO per move length (cube: 1, √2, √3), then the seeds (sorted)
    for (let qi = 0; qi <= NQ; qi++) Q.push(mkQ());
    const seeds = [];
    for (let p = 0; p < NN; p++) {
      const u = (p / N) | 0, v = p % N;     // slice coord[axis] = 0
      const id = axis === 0 ? u * N + v : axis === 1 ? u * NN + v : u * NN + v * N;
      if (!m[id]) continue;
      const k0 = seed ? seed[id] : 0;
      if (k0 < Infinity) { dist[id] = k0; seeds.push(id); }
    }
    if (seed) seeds.sort((a, b) => seed[a] - seed[b]);
    for (const id of seeds) qPush(Q[NQ], id, dist[id]);
    const mDa = mD[axis];
    const straight = N * W[axis];   /* the shortest possible route through the cell */
    let lowMask = 0;                                    // moves with no step down along axis
    for (let mi = 0; mi < 26; mi++) if (mDa[mi] >= 0) lowMask |= 1 << mi;
    let best = Infinity, bestSeen = Infinity;
    while (true) {
      // pop the smallest head among the four FIFOs
      let q = null, kmin = Infinity;
      for (let qi = 0; qi <= NQ; qi++) { const Qi = Q[qi]; if (Qi.h < Qi.t && Qi.key[Qi.h] < kmin) { kmin = Qi.key[Qi.h]; q = Qi; } }
      if (q === null || kmin >= best) break;
      // Exhaustive (arrive) run: a straight route (L = N) already gives τ = 1,
      // the minimum possible — no need to finish or chain a second cell.
      if (arrive && kmin >= bestSeen && bestSeen <= straight + 1e-9) break;
      const id = q.id[q.h++];
      if (kmin > dist[id]) continue;   // stale
      const i = (id / NN) | 0, rem = id - i * NN, j = (rem / N) | 0, k = rem - j * N;
      const at = axis === 0 ? i : axis === 1 ? j : k;
      const interior = i > 0 && i < N - 1 && j > 0 && j < N - 1 && k > 0 && k < N - 1;
      let bits = allow[id];
      if (at === 0) bits &= lowMask;                    // never step below the start slice
      while (bits) {
        const mi = 31 - Math.clz32(bits & -bits);
        bits &= bits - 1;
        const nd = kmin + mW[mi];
        let nid;
        if (interior) nid = id + mOff[mi];
        else {
          const dx = mD[0][mi], dy = mD[1][mi], dz = mD[2][mi];
          nid = (dx < 0 ? prevT[i] : dx > 0 ? nextT[i] : i) * NN
              + (dy < 0 ? prevT[j] : dy > 0 ? nextT[j] : j) * N
              + (dz < 0 ? prevT[k] : dz > 0 ? nextT[k] : k);
        }
        if (at === N - 1 && mDa[mi] > 0) {              // arrives on slice N (image of slice 0)
          if (arrive) { if (nd < arrive[nid]) arrive[nid] = nd; if (nd < bestSeen) bestSeen = nd; }
          else if (nd < best) best = nd;
          continue;
        }
        if (nd < dist[nid]) { dist[nid] = nd; qPush(Q[mQ[mi]], nid, nd); }
      }
    }
    return arrive ? bestSeen : best;
  }

  let nonperc = 0;
  const arrive = new Float64Array(N3);
  const ax = (axis) => {
    arrive.fill(Infinity);
    const L1 = shortest(axis, null, arrive);          // cell 1: from slice 0
    if (!isFinite(L1)) { nonperc |= 1 << axis; return TAU_CAP; }
    const Ls = N * W[axis];
    if (L1 <= Ls + 1e-9) return 1;                    // straight route: τ = 1 exactly
    const L2 = shortest(axis, arrive, null);          // cell 2: continue from cell-1 arrivals
    return Math.min(Math.max(1, (L2 - L1) / Ls), TAU_CAP);
  };
  const tx = ax(0), ty = ax(1), tz = ax(2);

  return {
    tortuosity_x: +tx.toFixed(3),
    tortuosity_y: +ty.toFixed(3),
    tortuosity_z: +tz.toFixed(3),
    tortuosity_nonperc: nonperc
  };
}
