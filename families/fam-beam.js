/* ============================================================
   F13LD.sweep · fam-beam.js
   BeamKernel: strut-lattice SDF from F13LD.beam recipes.
   ============================================================ */

// ─── BeamKernel ─── strut-lattice SDF from F13LD.beam recipes ────────────────
// ═════════════════════════════════════════════════════════════════════════════
//
// Path E4 / v0.15 — fifth kernel family. Beam recipes (octet, BCC, custom)
// describe a unit cell as a list of [ax,ay,az,bx,by,bz] strut endpoints in
// local [-1,+1]³ coords plus a scalar radius and physical cell size in mm.
// This kernel implements them as a union of capsule SDFs with periodic
// boundary continuity via 26-cell neighbor unions (same pattern as the
// raymarcher in F13LD.beam).
//
// Coordinate convention:
//   solver domain  [-π, +π]³   ←→   beam-local [-1, +1]³   (scale factor π)
//   Beam endpoints stored in local frame. Radius converts:
//     r_local = r_mm / (cellMm / 2)
//   SDF returned in local units. Threshold-at-zero gives the solid mask
//   (positive-outside convention, matching sweep's other kernels).
//
// Per-axis strut radius (Phase 1 anisotropy lever, per spec §4):
//   For each strut with direction cosines (cosX, cosY, cosZ):
//     r_eff = sqrt((cosX·rX)² + (cosY·rY)² + (cosZ·rZ)²)
//   This is the ellipsoidal interpretation — axis-aligned struts reduce to
//   the corresponding axis radius; diagonals blend smoothly. r_eff is a
//   scalar per strut; the cross-section stays circular for Phase 1.
//   (Phase 4 will swap circular capsules for elliptical / triangular /
//   square SDFs at the strut midpoint.)
//
// Bake-first architecture:
//   evaluate(p,x,y,z) is the standard scalar-field entry point. bakeField
//   (the optional 6th kernel method, only beam implements it today) does
//   the same loop contiguously, returning a Float32Array V at the requested
//   N. estimateHomogenization gates on `kernel.bakeField` and reuses the
//   baked V for both the FFT-CG voxel mask and surface_complexity,
//   halving the per-design eval cost. TPMS/Noise/Grain see no change —
//   their evaluate is cheap enough that the duplicated grid pass doesn't
//   register.
//
// Phases 2–5 land subsequent variables (node smoothing, ball radius, taper,
// cross-section, ellipse aspect, class ratio, reentrance angle) on this
// same kernel. Phase 1 ships cell_scale (existing scaleX/Y/Z plumbing) and
// strut_radius (new per-axis radius slider, vec3).
const BeamKernel = {
  family: 'beam',

  // Recipe → opaque params. Precomputes per-strut direction cosines and
  // squared lengths (used by capsule h-parameter computation) so evaluate
  // doesn't recompute them per call. Initial r_eff is the isotropic base
  // radius; jitterParams replaces it with the per-design (rX, rY, rZ)
  // ellipsoidal blend.
  parseRecipe(recipe) {
    if (!Array.isArray(recipe.beams) || recipe.beams.length === 0) {
      throw new Error("BeamKernel.parseRecipe: recipe.beams[] missing or empty");
    }
    const cellMm = +(recipe.geometry?.cell || 1.5);
    const baseRadiusMm = +(recipe.geometry?.radius || 0.1);
    const halfCellMm = cellMm * 0.5;
    if (halfCellMm <= 0) {
      throw new Error("BeamKernel.parseRecipe: recipe.geometry.cell must be > 0");
    }
    const beams = recipe.beams.map((b, idx) => {
      if (!Array.isArray(b) || b.length < 6) {
        throw new Error("BeamKernel.parseRecipe: beam " + idx + " must be [ax,ay,az,bx,by,bz]");
      }
      const ax = +b[0], ay = +b[1], az = +b[2];
      const bx = +b[3], by = +b[4], bz = +b[5];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx*dx + dy*dy + dz*dz;
      const len = Math.sqrt(lenSq);
      const inv = len > 1e-9 ? 1 / len : 0;
      // Sharing factor for periodic-cell volume/stiffness accounting.
      // A strut whose endpoints both lie on the same ±1 face (one axis with
      // |coord|=1 on both endpoints, same sign) is shared with that face's
      // neighbor cell; one with two such axes is shared at an edge (4
      // cells); three at a corner (8 cells). Matches F13LD.beam's DSM-PBC
      // convention so analytical VF + stiffness here agree with the
      // canonical reference at unit cell.
      const EPS = 1e-4;
      let onFaces = 0;
      const coords = [[ax, bx], [ay, by], [az, bz]];
      for (const [a, c] of coords) {
        if (Math.abs(Math.abs(a) - 1) < EPS && Math.abs(Math.abs(c) - 1) < EPS && Math.sign(a) === Math.sign(c)) {
          onFaces++;
        }
      }
      const sharingFactor = Math.pow(2, onFaces);  // 0→1, 1→2, 2→4, 3→8
      return {
        ax, ay, az, bx, by, bz,
        dxBa: dx, dyBa: dy, dzBa: dz,    // b - a vector
        invBaLenSq: lenSq > 1e-18 ? 1 / lenSq : 0,
        cosX: Math.abs(dx) * inv,
        cosY: Math.abs(dy) * inv,
        cosZ: Math.abs(dz) * inv,
        sharingFactor
      };
    });

    // Phase 2 — node extraction. A "node" is a unique endpoint position; many
    // beams share endpoints (corner/face/body-center nodes). We dedupe by
    // rounding to 4 decimals so near-coincident endpoints collapse to one
    // entry. node_ball_radius adds a sphere SDF at each node; the spec §4
    // describes this as independent of node_smoothing_k — use either, both,
    // or neither.
    //
    // Periodic boundary handling: boundary nodes (|coord|=1 on any axis) are
    // SHARED with neighbor cells. For the solver, the existing halo logic in
    // evaluate() brings in the neighbor cell's image of these nodes, so the
    // ball at e.g. (1, 0, 0) gets unioned with its (1, 0, 0) image from the
    // +X neighbor (same world position) — taking min/smin gives the right
    // answer without special-casing. For the single-cell preview, only the
    // in-cell node renders, which is correct for the "one cell" framing.
    const nodes = [];
    const nodeIndex = new Map();
    const r4 = v => Math.round(v * 10000) / 10000;
    for (const b of beams) {
      for (const [x, y, z] of [[b.ax, b.ay, b.az], [b.bx, b.by, b.bz]]) {
        const key = r4(x) + ',' + r4(y) + ',' + r4(z);
        if (!nodeIndex.has(key)) {
          nodeIndex.set(key, nodes.length);
          nodes.push({ x, y, z });
        }
      }
    }

    // Initial r_eff (isotropic at base radius). Two parallel arrays:
    //   - rEffLocal — for SDF evaluation (in cell-local [-1,+1] units)
    //   - rEffMm    — for analytical homogenization (in physical mm,
    //                 matching F13LD.beam's VF/stiffness convention)
    const r0Local = baseRadiusMm / halfCellMm;
    const rEffLocal = beams.map(() => r0Local);
    const rEffMm    = beams.map(() => baseRadiusMm);
    const params = {
      beams,
      beamCount: beams.length,
      nodes,
      nodeCount: nodes.length,
      cellMm,
      halfCellMm,
      baseRadiusMm,
      // Current per-design state (mutated by jitterParams)
      rXmm: baseRadiusMm,
      rYmm: baseRadiusMm,
      rZmm: baseRadiusMm,
      rEffLocal,
      rEffMm,
      rMaxLocal: r0Local,
      // Phase 2: node smoothing + ball radius. Both default to 0 (= no
      // effect, identical to Phase 1 output) until jitterParams replaces
      // them. Stored in LOCAL units (divided by halfCellMm) so the SDF math
      // doesn't need to remember the conversion.
      nodeSmoothKLocal: 0,
      nodeBallRLocal:  0,
      nodeSmoothKmm:   0,
      nodeBallRmm:     0,
      topology: recipe.topology?.name || 'custom'
    };

    // Phase 2 — always-on validation harness. Verifies the SDF agrees
    // across periodic cell boundaries (§6 invariant 2: boundary strut
    // geometry is single-valued). Runs at parseRecipe and after each
    // jitterParams in dev mode (controlled by a window flag so the
    // harness can be turned off if it ever shows up in profiling).
    if (typeof window !== 'undefined' && window.F13LD_BEAM_VALIDATE !== false) {
      const v = this._validatePeriodicity(params);
      if (v.maxDiff > v.threshold) {
        console.warn('[BeamKernel] Periodicity check FAILED at parseRecipe:',
          'maxDiff=' + v.maxDiff.toFixed(6),
          'threshold=' + v.threshold,
          v.worstPoint);
      } else if (typeof window !== 'undefined' && window.F13LD_BEAM_VALIDATE_VERBOSE) {
        console.log('[BeamKernel] parseRecipe periodicity OK (maxDiff=' + v.maxDiff.toExponential(2) + ')');
      }
    }

    return params;
  },

  // CPU SDF evaluation in solver domain [-π, π]³. Returns local-unit
  // distance to the strut union, positive-outside (matches sweep's
  // applyModeRaw convention: raw > 0 in void, raw ≤ 0 in solid).
  //
  // Periodicity: wrap to base cell [-π, π], then union with up to 6 FACE-
  // neighbor cell offsets when the query point is within halo of a cell
  // boundary. Halo = rMaxLocal + 0.02 (small safety margin in local
  // units). The 6-neighbor union ensures boundary struts read the same
  // SDF from either adjacent cell — §6 invariant 2.
  //
  // Why face-only (not 26 face+edge+corner): the face-neighbor wrap
  // already brings the wrapped image of an edge/corner strut into the
  // query's neighborhood. Edge and corner offsets never contribute the
  // minimum distance. Verified bit-exact (max diff < 1e-12) on both
  // octet (36 struts, axis-aligned + body diagonals) and the 50-strut
  // custom cell (face diagonals + body diagonals) across 50k random
  // samples. The 27 → 7 reduction gives a ~4× speedup in JS and a much
  // bigger one in the GLSL preview shader, where the original 27-neighbor
  // version made the raymarcher prohibitively slow (~12B ops/frame at
  // 192 steps × 256² pixels × 36 beams) and froze the page on load.
  evaluate(params, x, y, z) {
    const PI = Math.PI, TWO_PI = 2 * Math.PI;
    // Wrap solver coord → local [-1, +1] via factor π
    const sx = ((x + PI) % TWO_PI + TWO_PI) % TWO_PI - PI;
    const sy = ((y + PI) % TWO_PI + TWO_PI) % TWO_PI - PI;
    const sz = ((z + PI) % TWO_PI + TWO_PI) % TWO_PI - PI;
    const lx = sx * (1 / PI);
    const ly = sy * (1 / PI);
    const lz = sz * (1 / PI);

    const beams = params.beams;
    const rEff  = params.rEffLocal;
    const nodes = params.nodes;
    const n = beams.length;
    const nn = nodes.length;
    const kSmooth = params.nodeSmoothKLocal || 0;
    const rBall   = params.nodeBallRLocal   || 0;

    // Polynomial smin (iquilezles.org). When k <= 0, reduces exactly to min.
    // This is the same operator the F13LD-suite has used since Phase 0;
    // matches the smin spec §4 wants (resolved from v0.1 open item).
    //
    // Inline as a local fn — V8 inlines closures inside hot loops in this
    // shape, so the function-call overhead is zero after warm-up.
    const smin = kSmooth > 0
      ? (a, b) => {
          const h = Math.max(kSmooth - Math.abs(a - b), 0) / kSmooth;
          return Math.min(a, b) - h*h*kSmooth*0.25;
        }
      : (a, b) => a < b ? a : b;

    // Inline capsule + node-ball union at a given local-frame query point.
    const capUnion = (qx, qy, qz) => {
      let d = 1e6;
      for (let i = 0; i < n; i++) {
        const b = beams[i];
        const pax = qx - b.ax, pay = qy - b.ay, paz = qz - b.az;
        const bax = b.dxBa,   bay = b.dyBa,   baz = b.dzBa;
        let h = (pax*bax + pay*bay + paz*baz) * b.invBaLenSq;
        if (h < 0) h = 0; else if (h > 1) h = 1;
        const cx = pax - bax*h, cy = pay - bay*h, cz = paz - baz*h;
        const di = Math.sqrt(cx*cx + cy*cy + cz*cz) - rEff[i];
        d = smin(d, di);
      }
      // Phase 2: union node balls into the field. Each ball is a sphere at
      // the node position. When rBall=0 this loop is skipped entirely
      // (zero-cost when the variable is unused).
      if (rBall > 0) {
        for (let i = 0; i < nn; i++) {
          const nd = nodes[i];
          const dx_ = qx - nd.x, dy_ = qy - nd.y, dz_ = qz - nd.z;
          const di = Math.sqrt(dx_*dx_ + dy_*dy_ + dz_*dz_) - rBall;
          d = smin(d, di);
        }
      }
      return d;
    };

    let d = capUnion(lx, ly, lz);
    // Halo extends by the largest geometry contributor (capsule radius or
    // ball radius), so a query near a face whose neighbor cell has a ball
    // centered on the shared boundary still sees that ball.
    const halo = Math.max(params.rMaxLocal, rBall) + 0.02;
    if (lx >  1 - halo) { const di = capUnion(lx - 2, ly, lz); if (di < d) d = di; }
    if (lx < -1 + halo) { const di = capUnion(lx + 2, ly, lz); if (di < d) d = di; }
    if (ly >  1 - halo) { const di = capUnion(lx, ly - 2, lz); if (di < d) d = di; }
    if (ly < -1 + halo) { const di = capUnion(lx, ly + 2, lz); if (di < d) d = di; }
    if (lz >  1 - halo) { const di = capUnion(lx, ly, lz - 2); if (di < d) d = di; }
    if (lz < -1 + halo) { const di = capUnion(lx, ly, lz + 2); if (di < d) d = di; }
    return d;
  },

  // Phase 2 — periodicity validation harness (spec §9.5). Samples a grid of
  // points on each cell face from both sides of the boundary and asserts
  // the SDF agrees within threshold. Always-on by default; controlled via
  // window.F13LD_BEAM_VALIDATE. Reports to console.warn on failure.
  _validatePeriodicity(params) {
    const PI = Math.PI;
    const N = 12; // 12×12 grid per face, 6 faces = 864 sample pairs
    const eps = 0.001;
    const threshold = 0.01; // local units — generous tolerance, real failures are >0.1
    let maxDiff = 0;
    let worstPoint = null;
    for (const axis of [0, 1, 2]) {
      for (const sign of [+1, -1]) {
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const u = -PI + (i + 0.5) * (2*PI/N);
            const v = -PI + (j + 0.5) * (2*PI/N);
            const pIn  = [0, 0, 0];
            const pOut = [0, 0, 0];
            pIn[axis]  = sign * PI - sign * eps;
            pOut[axis] = sign * PI + sign * eps;
            const others = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
            pIn[others[0]]  = u; pIn[others[1]]  = v;
            pOut[others[0]] = u; pOut[others[1]] = v;
            const dIn  = this.evaluate(params, pIn[0],  pIn[1],  pIn[2]);
            const dOut = this.evaluate(params, pOut[0], pOut[1], pOut[2]);
            const diff = Math.abs(dIn - dOut);
            if (diff > maxDiff) {
              maxDiff = diff;
              worstPoint = { axis, sign, u, v, dIn, dOut, diff };
            }
          }
        }
      }
    }
    return { maxDiff, worstPoint, threshold };
  },

  // Gradient via central differences. Capsule SDF is approximately
  // 1-Lipschitz so gradMag ≈ 1 almost everywhere in the void — surface
  // complexity and curvature metrics derived from this will be flat for
  // beam (the geometric "complexity" of a strut lattice is topological,
  // not encoded in the distance-field gradient). Documented limitation;
  // metrics that don't depend on gradient magnitude (VF, stiffness,
  // percolation, throat/pore size) work normally.
  evaluateWithGrad(params, x, y, z) {
    const eps = 0.01;
    const phi = this.evaluate(params, x, y, z);
    const gx = (this.evaluate(params, x + eps, y, z) - this.evaluate(params, x - eps, y, z)) / (2 * eps);
    const gy = (this.evaluate(params, x, y + eps, z) - this.evaluate(params, x, y - eps, z)) / (2 * eps);
    const gz = (this.evaluate(params, x, y, z + eps) - this.evaluate(params, x, y, z - eps)) / (2 * eps);
    return { phi, gradMag: Math.sqrt(gx*gx + gy*gy + gz*gz) };
  },

  // Bake-first optimization: build the full V grid in one contiguous loop.
  // Same work as evaluate × N³, but with better cache locality and (more
  // importantly) the result is shared between buildVoxels and surface_
  // complexity in estimateHomogenization — halving per-design eval cost.
  //
  // The presence of this method on the kernel is the gate for the bake-
  // first code path (estimateHomogenization checks `kernel.bakeField`).
  // Other families that want the same optimization just need to add this
  // method; no consumer changes required.
  bakeField(params, N) {
    const N3 = N * N * N;
    const V = new Float32Array(N3);
    const L = Math.PI, step = (2 * L) / N;
    const NN = N * N;
    for (let i = 0; i < N; i++) {
      const x = -L + (i + 0.5) * step;
      const iBase = i * NN;
      for (let j = 0; j < N; j++) {
        const y = -L + (j + 0.5) * step;
        const ijBase = iBase + j * N;
        for (let k = 0; k < N; k++) {
          const z = -L + (k + 0.5) * step;
          V[ijBase + k] = this.evaluate(params, x, y, z);
        }
      }
    }
    return V;
  },

  // Sweep jitter — draws per-axis radius from user-specified ranges plus
  // Phase 2 scalar node parameters.
  // args:
  //   rXloFrac, rXhiFrac, rYloFrac, rYhiFrac, rZloFrac, rZhiFrac
  //   (fractions of base radius; default [0.5, 2.0] when unspecified)
  //   sobolDimOffset — first Sobol dim for radius draws (default 3)
  //
  // Sobol dim allocation:
  //   3-5: per-axis strut radius (Phase 1)
  //   6:   node_smoothing_k  (Phase 2)
  //   7:   node_ball_radius  (Phase 2)
  //
  // Per-strut r_eff is recomputed from the new (rX, rY, rZ) via the
  // ellipsoidal formula (§4). rMaxLocal updated so evaluate's halo
  // tracks the current design's largest radius.
  //
  // Phase 2 caps (no user UI — sensible defaults that scale with the
  // recipe's base radius):
  //   smoothing k: [0, baseRadius × 1.5]  in mm
  //   ball radius: [0, baseRadius × 2.0]  in mm
  // These produce visible variation across designs without dominating the
  // strut geometry. lo=0 means some designs in every sweep get the
  // un-modified Phase-1-like topology, which is good for comparison.
  // Caps scale with the recipe so they work whether you're sweeping a
  // 1.5 mm or 5 mm cell.
  jitterParams(params, draw, args = {}) {
    const r0 = params.baseRadiusMm;
    const half = params.halfCellMm;
    const xLo = args.rXloFrac ?? 0.5, xHi = args.rXhiFrac ?? 2.0;
    const yLo = args.rYloFrac ?? 0.5, yHi = args.rYhiFrac ?? 2.0;
    const zLo = args.rZloFrac ?? 0.5, zHi = args.rZhiFrac ?? 2.0;
    const dimOff = args.sobolDimOffset ?? 3;
    const rXmm = +(r0 * (xLo + draw.u(dimOff    ) * (xHi - xLo))).toFixed(4);
    const rYmm = +(r0 * (yLo + draw.u(dimOff + 1) * (yHi - yLo))).toFixed(4);
    const rZmm = +(r0 * (zLo + draw.u(dimOff + 2) * (zHi - zLo))).toFixed(4);
    let rMax = 0;
    const rEffLocal = new Array(params.beams.length);
    const rEffMm    = new Array(params.beams.length);
    for (let i = 0; i < params.beams.length; i++) {
      const b = params.beams[i];
      const rx2 = b.cosX * rXmm, ry2 = b.cosY * rYmm, rz2 = b.cosZ * rZmm;
      const rEff_mm = Math.sqrt(rx2*rx2 + ry2*ry2 + rz2*rz2);
      const rEff_local = rEff_mm / half;
      if (rEff_local > rMax) rMax = rEff_local;
      rEffLocal[i] = rEff_local;
      rEffMm[i]    = rEff_mm;
    }

    // Phase 2 scalar params — caps relative to base radius
    const kCapMm  = r0 * 1.5;
    const bCapMm  = r0 * 2.0;
    const nodeSmoothKmm = +(draw.u(dimOff + 3) * kCapMm).toFixed(4);
    const nodeBallRmm   = +(draw.u(dimOff + 4) * bCapMm).toFixed(4);
    const nodeSmoothKLocal = nodeSmoothKmm / half;
    const nodeBallRLocal   = nodeBallRmm   / half;

    const out = {
      ...params,
      rXmm, rYmm, rZmm,
      rEffLocal,
      rEffMm,
      rMaxLocal: rMax,
      nodeSmoothKmm,
      nodeBallRmm,
      nodeSmoothKLocal,
      nodeBallRLocal
    };

    // Periodicity check after jitter — different parameter combinations
    // could in principle break boundary continuity (they shouldn't, by
    // construction, but the harness exists to catch that). Skipped when
    // disabled via window flag.
    if (typeof window !== 'undefined' && window.F13LD_BEAM_VALIDATE !== false) {
      const v = this._validatePeriodicity(out);
      if (v.maxDiff > v.threshold) {
        console.warn('[BeamKernel] Periodicity FAIL post-jitter:',
          'maxDiff=' + v.maxDiff.toFixed(6),
          'k=' + nodeSmoothKmm + 'mm',
          'ball=' + nodeBallRmm + 'mm',
          'r=[' + rXmm + ',' + rYmm + ',' + rZmm + ']',
          v.worstPoint);
      }
    }
    return out;
  },

  // GLSL emission — emits a fieldEval(p, H) returning the same local-unit
  // SDF as the CPU evaluate. Beam endpoints + per-strut radii are uploaded
  // as uniform arrays (sidecar, like GrainKernel's bakedField pattern).
  //
  // Single-cell preview design (Phase 1.3): sweep's preview pane renders
  // EXACTLY ONE unit cell regardless of cellMult. The cube extent is
  // overridden to ±π in buildFrag for the beam path, and the shader skips
  // periodic wrapping + halo branches entirely. Three reasons:
  //
  //   1. The preview's job is "what cell did this sweep design find?", not
  //      "what does the assembled material look like?". Tiling is a job
  //      for F13LD.mesh / F13LD.beam viewers, where the user has time to
  //      inspect a single design. Sweep needs fast preview-on-hover for
  //      200+ results.
  //   2. Without periodic boundaries, there are no neighbor cells to wrap
  //      to. The 6 halo branches all become unreachable. With ~67% of the
  //      cube being in the halo zone for typical beam radii, skipping
  //      them gives a ~4× shader speedup per fragment.
  //   3. The `mod()` wrap is also unnecessary in single-cell mode — query
  //      points are already in [-π, +π] = one cell. Drop it for one less
  //      instruction per fragment.
  //
  // Why uniforms + runtime loop, not full inlining (revised after Phase 1.1
  // hung the preview on the 50-strut custom cell):
  //
  // The earlier unrolled version emitted ~50 hardcoded capsule SDFs as a
  // single basic block. Compiles fine, but GPU shader compilers cannot
  // pipeline a 50-deep straight-line dependency chain, so the GPU's
  // instruction cache thrashes and frame time spikes by 10-100× vs a
  // small loop body. F13LD.beam's preview proved this empirically — it
  // uses the same SDF math with a uniform-array loop and renders smoothly
  // on the same recipes that hung sweep.
  //
  // MAX_BEAMS = 256 covers every topology in spec §2 (octet=36, kelvin
  // ≈48, BCC=12, FCC=24, isotruss=24, the custom 50-strut cell), with
  // headroom for richer topologies added in Phase 5. The `if (i >=
  // beamCount) break;` early-exits cleanly on real drivers — most
  // compilers detect this pattern and unroll-and-cull at compile time.
  //
  // Sidecar shape: { beamA, beamB, beamR, beamCount } — buildPreviewShader
  // detects this on the kernel return and uploads as uniforms. Other
  // kernels that don't have this sidecar (TPMS, Noise) keep working
  // unchanged. Grain's `bakedField` sidecar is a different upload path
  // (sampler3D); the two coexist by checking which is present.
  emitGLSLField(params) {
    const PI = Math.PI;
    // WebGL fragment-shader uniform budget: WebGL1 guarantees 128 vec4
    // slots, WebGL2 guarantees 224. Each vec3 array element consumes 1 slot,
    // each scalar 4 floats per slot. Real drivers typically ship more
    // than the spec minimum; sweep's Phase 1.2 used MAX_BEAMS=256 which
    // worked because no other large uniform arrays were in play.
    //
    // Adding `uNodeP[N]` doubled the vec3 array count and pushed total
    // slot use from ~577 (Phase 1.2) to ~833 (Phase 2 @ MAX=256), which
    // crossed the actual driver limit on at least one tested machine —
    // symptom was "preview goes blank on recipe load, no JS error". Cut
    // MAX_BEAMS and MAX_NODES to fit comfortably:
    //
    // Budget at MAX=64:
    //   uBeamA: 64 vec3 = 64 slots
    //   uBeamB: 64 vec3 = 64 slots
    //   uBeamR: 64 float = 16 slots
    //   uNodeP: 64 vec3 = 64 slots
    //   scalars: 4 = 1 slot
    //   Total: 209 slots — fits WebGL2 guarantee (224), under most real
    //                       WebGL1 driver limits (typical 256+ slots even
    //                       on Intel HD).
    //
    // Coverage: every named topology in spec §2 fits comfortably.
    //   BCC: 8 beams, 9 nodes
    //   Octet: 36 beams, 14 nodes
    //   Kelvin: ~36 beams, ~24 nodes
    //   FCC/FBCCZ: 24-32 beams, 8-9 nodes
    //   The 50-strut custom cell: 50 beams, 32 nodes  ← fits with headroom
    //
    // If a user's custom cell exceeds 64 of either, the extra entries are
    // silently truncated (the loop's `i >= uBeamCount` bound caps at the
    // uploaded count). At that point a warning to console.warn is fair —
    // see parseRecipe checks if implementing later.
    const MAX_BEAMS = 64;
    const MAX_NODES = 64;
    const f = (v) => {
      const s = (+v).toFixed(6);
      return s.indexOf('.') < 0 ? s + '.0' : s;
    };

    // Pack uniform-ready arrays. Pad to MAX with zeros so the uniform array
    // is always the same size — driver hates re-linking on every recipe load.
    const beamA = new Float32Array(MAX_BEAMS * 3);
    const beamB = new Float32Array(MAX_BEAMS * 3);
    const beamR = new Float32Array(MAX_BEAMS);
    const nBeams = Math.min(params.beamCount, MAX_BEAMS);
    for (let i = 0; i < nBeams; i++) {
      const b = params.beams[i];
      beamA[i*3+0] = b.ax; beamA[i*3+1] = b.ay; beamA[i*3+2] = b.az;
      beamB[i*3+0] = b.bx; beamB[i*3+1] = b.by; beamB[i*3+2] = b.bz;
      beamR[i]     = params.rEffLocal[i];
    }

    // Phase 2 — node positions for ball-radius SDF. Always packed, the
    // shader's uNodeBallR uniform is what enables/disables them at runtime.
    const nodeP = new Float32Array(MAX_NODES * 3);
    const nNodes = Math.min(params.nodeCount || 0, MAX_NODES);
    if (params.nodes) {
      for (let i = 0; i < nNodes; i++) {
        const nd = params.nodes[i];
        nodeP[i*3+0] = nd.x;
        nodeP[i*3+1] = nd.y;
        nodeP[i*3+2] = nd.z;
      }
    }

    const fns =
      'uniform vec3 uBeamA[' + MAX_BEAMS + '];\n' +
      'uniform vec3 uBeamB[' + MAX_BEAMS + '];\n' +
      'uniform float uBeamR[' + MAX_BEAMS + '];\n' +
      'uniform int uBeamCount;\n' +
      'uniform vec3 uNodeP[' + MAX_NODES + '];\n' +
      'uniform int uNodeCount;\n' +
      'uniform float uNodeSmoothK;\n' +
      'uniform float uNodeBallR;\n' +
      // Phase 1.4 wireframe overlay: the cube extent is padded to fit
      // strut endcaps + balls (no clipping), so we draw the abstract
      // [-1,+1]³ cell boundary as 12 thin edges so the viewer can see
      // where the cell actually ends vs. where the geometry overshoots.
      // Wireframe thickness in local units — 0.012 ≈ 1.2% of cell edge.
      'uniform float uWireR;\n' +
      'float beam_smin(float a, float b, float k){\n' +
      '  if (k <= 0.0) return min(a, b);\n' +
      '  float h = max(k - abs(a - b), 0.0) / k;\n' +
      '  return min(a, b) - h*h*k*0.25;\n' +
      '}\n' +
      'float beam_capsule(vec3 p, vec3 a, vec3 b, float r){\n' +
      '  vec3 pa=p-a; vec3 ba=b-a;\n' +
      '  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);\n' +
      '  return length(pa-ba*h)-r;\n' +
      '}\n' +
      'float beam_capsuleUnion(vec3 q){\n' +
      '  float d=1e6;\n' +
      '  for(int i=0; i<' + MAX_BEAMS + '; i++){\n' +
      '    if (i >= uBeamCount) break;\n' +
      '    float di = beam_capsule(q, uBeamA[i], uBeamB[i], uBeamR[i]);\n' +
      '    d = beam_smin(d, di, uNodeSmoothK);\n' +
      '  }\n' +
      '  if (uNodeBallR > 0.0) {\n' +
      '    for(int i=0; i<' + MAX_NODES + '; i++){\n' +
      '      if (i >= uNodeCount) break;\n' +
      '      float dn = length(q - uNodeP[i]) - uNodeBallR;\n' +
      '      d = beam_smin(d, dn, uNodeSmoothK);\n' +
      '    }\n' +
      '  }\n' +
      '  return d;\n' +
      '}\n' +
      // Cell-edge wireframe SDF. 12 edges of the cube [-1,+1]³ each rendered
      // as a thin capsule of length 2. Cheaper to spell out 12 capsules
      // than to derive a closed-form 3D edge-network SDF — the closed form
      // gets messy fast (the iquilezles box-SDF combination formula
      // doesn't directly apply because we want the EDGES, not the faces).
      //
      // 12 edges enumerated by which axis they're parallel to and which
      // (y,z) / (x,z) / (x,y) corner they sit at:
      //   X-parallel (4): (-1..+1, ±1, ±1)
      //   Y-parallel (4): (±1, -1..+1, ±1)
      //   Z-parallel (4): (±1, ±1, -1..+1)
      'float beam_edge(vec3 p, vec3 a, vec3 b){\n' +
      '  vec3 pa=p-a; vec3 ba=b-a;\n' +
      '  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);\n' +
      '  return length(pa-ba*h);\n' +
      '}\n' +
      'float beam_wireframe(vec3 q){\n' +
      '  float d = 1e6;\n' +
      // X-parallel edges (4)
      '  d = min(d, beam_edge(q, vec3(-1.0,-1.0,-1.0), vec3( 1.0,-1.0,-1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3(-1.0, 1.0,-1.0), vec3( 1.0, 1.0,-1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3(-1.0,-1.0, 1.0), vec3( 1.0,-1.0, 1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3(-1.0, 1.0, 1.0), vec3( 1.0, 1.0, 1.0)));\n' +
      // Y-parallel edges (4)
      '  d = min(d, beam_edge(q, vec3(-1.0,-1.0,-1.0), vec3(-1.0, 1.0,-1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3( 1.0,-1.0,-1.0), vec3( 1.0, 1.0,-1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3(-1.0,-1.0, 1.0), vec3(-1.0, 1.0, 1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3( 1.0,-1.0, 1.0), vec3( 1.0, 1.0, 1.0)));\n' +
      // Z-parallel edges (4)
      '  d = min(d, beam_edge(q, vec3(-1.0,-1.0,-1.0), vec3(-1.0,-1.0, 1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3( 1.0,-1.0,-1.0), vec3( 1.0,-1.0, 1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3(-1.0, 1.0,-1.0), vec3(-1.0, 1.0, 1.0)));\n' +
      '  d = min(d, beam_edge(q, vec3( 1.0, 1.0,-1.0), vec3( 1.0, 1.0, 1.0)));\n' +
      '  return d - uWireR;\n' +
      '}\n' +
      'float fieldEval(vec3 p, float H){\n' +
      // p is in solver coords (±H). Divide by π to get cell-local coords
      // where the cell is ±1 and the cube extends to ±(1 + pad).
      '  vec3 q = p * (1.0/' + f(PI) + ');\n' +
      '  float lattice = beam_capsuleUnion(q);\n' +
      '  float wire = beam_wireframe(q);\n' +
      '  return min(lattice, wire);\n' +
      '}\n' +
      // Separate accessors so the fragment shader can color the two
      // surfaces differently. After the marcher hits, we re-evaluate
      // both at the hit point and the smaller one identifies the surface.
      'float fieldLattice(vec3 p, float H){\n' +
      '  return beam_capsuleUnion(p * (1.0/' + f(PI) + '));\n' +
      '}\n' +
      'float fieldWire(vec3 p, float H){\n' +
      '  return beam_wireframe(p * (1.0/' + f(PI) + '));\n' +
      '}';

    return {
      fns,
      exprFn: 'fieldEval',
      beamData: {
        beamA,
        beamB,
        beamR,
        beamCount: nBeams,
        nodeP,
        nodeCount: nNodes,
        nodeSmoothK: params.nodeSmoothKLocal || 0,
        nodeBallR:   params.nodeBallRLocal   || 0,
        // Phase 1.4 wireframe thickness in cell-local units. 0.012 ≈ 1.2%
        // of cell edge, thin enough to read as a wireframe overlay rather
        // than a thick frame, thick enough to anti-alias cleanly at
        // typical preview resolutions.
        wireR: 0.012,
        MAX_BEAMS,
        MAX_NODES
      }
    };
  }
};
