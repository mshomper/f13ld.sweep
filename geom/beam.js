/* ============================================================
   F13LD.sweep · geom/beam.js
   Beam field: periodic capsule lattice (F13LD.beam / F13LD.mesh).

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (13b-kernels-new.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-BEAM v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ════════════════════════════════════════════════════════════
   BeamKernel — periodic capsule lattice (F13LD.beam)
   Verbatim port of mesh buildBeamSDF (non-pruneCtx path).  The
   mesh export-only super-cell / mask-prune path is intentionally
   omitted: lab homogenizes a single periodic cube (option A) and
   handles island removal via 14a-connectivity.
   ════════════════════════════════════════════════════════════ */
var BeamKernel = {
  family: 'beam',

  /* IQ cubic smooth-min — matches mesh's smin (k<=0 → hard min) */
  _smin: function (a, b, k) {
    if (k <= 0) return a < b ? a : b;
    var diff = a > b ? a - b : b - a;
    var h = (k - diff) > 0 ? (k - diff)/k : 0;
    return (a < b ? a : b) - h*h*h*k*(1/6);
  },

  parseRecipe: function (recipe) {
    var beams = recipe.beams || [];
    var geom = recipe.geometry || {};

    /* Schema detection (mesh rc25): scale_xyz OR cell_scale_x/y/z + cell. */
    var sxyz = null;
    if (Array.isArray(geom.scale_xyz) && geom.scale_xyz.length === 3
        && isFinite(geom.scale_xyz[0]) && isFinite(geom.scale_xyz[1]) && isFinite(geom.scale_xyz[2])
        && geom.scale_xyz[0] > 0 && geom.scale_xyz[1] > 0 && geom.scale_xyz[2] > 0) {
      sxyz = geom.scale_xyz;
    } else if (typeof geom.cell_scale_x === 'number' && geom.cell_scale_x > 0
            && typeof geom.cell_scale_y === 'number' && geom.cell_scale_y > 0
            && typeof geom.cell_scale_z === 'number' && geom.cell_scale_z > 0) {
      sxyz = [geom.cell_scale_x, geom.cell_scale_y, geom.cell_scale_z];
    }
    var cellMm = geom.cell;
    var hasScaleXYZ = sxyz !== null;
    var hasCell = (typeof cellMm === 'number') && isFinite(cellMm) && cellMm > 0;
    var isNew = hasScaleXYZ && hasCell;

    var cellScaleX, cellScaleY, cellScaleZ;
    if (isNew) {
      cellScaleX = cellMm / sxyz[0];
      cellScaleY = cellMm / sxyz[1];
      cellScaleZ = cellMm / sxyz[2];
    } else {
      var cs = (typeof geom.cell_scale === 'number' && geom.cell_scale > 0) ? geom.cell_scale : 1;
      cellScaleX = cellScaleY = cellScaleZ = cs;
    }

    var rLocX, rLocY, rLocZ;
    if (isNew && typeof geom.radius_x === 'number' && geom.radius_x >= 0) {
      var rx = geom.radius_x;
      var ry = (typeof geom.radius_y === 'number' && geom.radius_y >= 0) ? geom.radius_y : rx;
      var rz = (typeof geom.radius_z === 'number' && geom.radius_z >= 0) ? geom.radius_z : rx;
      rLocX = 2*rx / sxyz[0]; rLocY = 2*ry / sxyz[1]; rLocZ = 2*rz / sxyz[2];
    } else {
      var r = (typeof geom.radius === 'number' && geom.radius >= 0) ? geom.radius : 0.1;
      rLocX = rLocY = rLocZ = r;
    }

    var sminLocal = (isNew && typeof geom.node_smoothing_k === 'number' && geom.node_smoothing_k > 0)
      ? (2*geom.node_smoothing_k / cellMm) : 0;
    var ballLocal = (isNew && typeof geom.node_ball_radius === 'number' && geom.node_ball_radius > 0)
      ? (2*geom.node_ball_radius / cellMm) : 0;
    var useSmin = sminLocal > 0;
    var useBalls = ballLocal > 0;

    var N = beams.length;
    var ax = new Float64Array(N), ay = new Float64Array(N), az = new Float64Array(N);
    var bx = new Float64Array(N), by = new Float64Array(N), bz = new Float64Array(N);
    var rStrut = new Float64Array(N);
    var maxR = 0;
    for (var i = 0; i < N; i++) {
      var bb = beams[i];
      ax[i] = bb[0]; ay[i] = bb[1]; az[i] = bb[2];
      bx[i] = bb[3]; by[i] = bb[4]; bz[i] = bb[5];
      var ex = bb[3] - bb[0], ey = bb[4] - bb[1], ez = bb[5] - bb[2];
      var elen = Math.sqrt(ex*ex + ey*ey + ez*ez);
      if (elen > 1e-12) {
        var ux = ex/elen, uy = ey/elen, uz = ez/elen;
        rStrut[i] = Math.sqrt(rLocX*rLocX*ux*ux + rLocY*rLocY*uy*uy + rLocZ*rLocZ*uz*uz);
      } else {
        rStrut[i] = Math.sqrt((rLocX*rLocX + rLocY*rLocY + rLocZ*rLocZ)/3);
      }
      if (rStrut[i] > maxR) maxR = rStrut[i];
    }

    var nodeX = null, nodeY = null, nodeZ = null, nodeCount = 0;
    if (useBalls) {
      var TOL = 1e-5, INV_TOL = 1/TOL, seen = {}, tmpX = [], tmpY = [], tmpZ = [];
      for (var j = 0; j < N; j++) {
        var keyA = Math.round(ax[j]*INV_TOL) + ',' + Math.round(ay[j]*INV_TOL) + ',' + Math.round(az[j]*INV_TOL);
        if (!seen[keyA]) { seen[keyA] = 1; tmpX.push(ax[j]); tmpY.push(ay[j]); tmpZ.push(az[j]); }
        var keyB = Math.round(bx[j]*INV_TOL) + ',' + Math.round(by[j]*INV_TOL) + ',' + Math.round(bz[j]*INV_TOL);
        if (!seen[keyB]) { seen[keyB] = 1; tmpX.push(bx[j]); tmpY.push(by[j]); tmpZ.push(bz[j]); }
      }
      nodeX = new Float64Array(tmpX); nodeY = new Float64Array(tmpY); nodeZ = new Float64Array(tmpZ);
      nodeCount = tmpX.length;
    }

    var halo = maxR + sminLocal + ballLocal + 0.02;

    /* per-axis world↔cell-local and geometric-mean cell-local→world scale */
    var L2Wx = 5/cellScaleX, L2Wy = 5/cellScaleY, L2Wz = 5/cellScaleZ;
    var L2Wgeo = Math.cbrt(L2Wx*L2Wy*L2Wz);
    /* Lab solver→cell-local: lx = solver · cellScale/π. Distance back to
       solver units: out = cellLocalDist · L2Wgeo · (π/5). */
    var inX = cellScaleX/Math.PI, inY = cellScaleY/Math.PI, inZ = cellScaleZ/Math.PI;
    var outScale = L2Wgeo * Math.PI / 5;

    if (!recipe.family) recipe.family = 'beam';
    return {
      N: N, ax: ax, ay: ay, az: az, bx: bx, by: by, bz: bz, rStrut: rStrut,
      useSmin: useSmin, sminLocal: sminLocal, useBalls: useBalls, ballLocal: ballLocal,
      nodeX: nodeX, nodeY: nodeY, nodeZ: nodeZ, nodeCount: nodeCount,
      halo: halo, inX: inX, inY: inY, inZ: inZ, outScale: outScale
    };
  },

  /* capsule + node-ball union at a single cell-local query point */
  _capsuleUnion: function (P, qx, qy, qz) {
    var d = 1e6, N = P.N;
    var ax = P.ax, ay = P.ay, az = P.az, bx = P.bx, by = P.by, bz = P.bz, rStrut = P.rStrut;
    var useSmin = P.useSmin, sminLocal = P.sminLocal;
    for (var i = 0; i < N; i++) {
      var dx = qx - ax[i], dy = qy - ay[i], dz = qz - az[i];
      var ex = bx[i] - ax[i], ey = by[i] - ay[i], ez = bz[i] - az[i];
      var ll = ex*ex + ey*ey + ez*ez;
      var h = ll > 1e-12 ? (dx*ex + dy*ey + dz*ez)/ll : 0;
      if (h < 0) h = 0; else if (h > 1) h = 1;
      var px = dx - ex*h, py = dy - ey*h, pz = dz - ez*h;
      var di = Math.sqrt(px*px + py*py + pz*pz) - rStrut[i];
      d = useSmin ? this._smin(d, di, sminLocal) : (di < d ? di : d);
    }
    if (P.useBalls) {
      var nX = P.nodeX, nY = P.nodeY, nZ = P.nodeZ, ballLocal = P.ballLocal;
      for (var n = 0; n < P.nodeCount; n++) {
        var bdx = qx - nX[n], bdy = qy - nY[n], bdz = qz - nZ[n];
        var bdi = Math.sqrt(bdx*bdx + bdy*bdy + bdz*bdz) - ballLocal;
        d = useSmin ? this._smin(d, bdi, sminLocal) : (bdi < d ? bdi : d);
      }
    }
    return d;
  },

  /* NEGATIVE-INSIDE SDF in solver space. Maps solver→cell-local, wraps to
     the [-1,1] unit cell, unions capsules, and adds the 26-neighbour halo
     so struts crossing a cell face are not clipped (single-cube, option A). */
  evaluate: function (params, x, y, z) {
    var lx = x*params.inX, ly = y*params.inY, lz = z*params.inZ;
    var qx = ((lx + 1) - 2*Math.floor((lx + 1)/2)) - 1;
    var qy = ((ly + 1) - 2*Math.floor((ly + 1)/2)) - 1;
    var qz = ((lz + 1) - 2*Math.floor((lz + 1)/2)) - 1;

    var d = this._capsuleUnion(params, qx, qy, qz);
    var halo = params.halo;
    var nx_ = qx > 1 - halo, px_ = qx < -1 + halo;
    var ny_ = qy > 1 - halo, py_ = qy < -1 + halo;
    var nz_ = qz > 1 - halo, pz_ = qz < -1 + halo;

    if (nx_ || px_ || ny_ || py_ || nz_ || pz_) {
      if (nx_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy,   qz));
      if (px_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy,   qz));
      if (ny_) d = Math.min(d, this._capsuleUnion(params, qx,   qy-2, qz));
      if (py_) d = Math.min(d, this._capsuleUnion(params, qx,   qy+2, qz));
      if (nz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy,   qz-2));
      if (pz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy,   qz+2));
      if (nx_&&ny_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy-2, qz));
      if (nx_&&py_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy+2, qz));
      if (px_&&ny_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy-2, qz));
      if (px_&&py_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy+2, qz));
      if (nx_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy,   qz-2));
      if (nx_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy,   qz+2));
      if (px_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy,   qz-2));
      if (px_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy,   qz+2));
      if (ny_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy-2, qz-2));
      if (ny_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy-2, qz+2));
      if (py_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy+2, qz-2));
      if (py_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx,   qy+2, qz+2));
      if (nx_&&ny_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy-2, qz-2));
      if (nx_&&ny_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy-2, qz+2));
      if (nx_&&py_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy+2, qz-2));
      if (nx_&&py_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx-2, qy+2, qz+2));
      if (px_&&ny_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy-2, qz-2));
      if (px_&&ny_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy-2, qz+2));
      if (px_&&py_&&nz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy+2, qz-2));
      if (px_&&py_&&pz_) d = Math.min(d, this._capsuleUnion(params, qx+2, qy+2, qz+2));
    }
    return d * params.outScale;
  }
};

/* ==== /F13LD-GEOM-BEAM ==== */
