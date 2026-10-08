/* ============================================================
   F13LD.sweep · solver/sweep-gpu-kernels.js
   Licence: PolyForm Noncommercial 1.0.0 (solver/LICENSE.md, solver/NOTICE)
   — built on F13LD.lab's solver (solver/lab/), like the rest of solver/.

   Sweep's additions to F13LD.lab's GPU solver, kept out of the Lab files
   (which stay byte-identical, tests/parity/solversync.js):

   1. Stretched cells, elastic.  F13LD.lab's packed Green operator
      (16i elasticFastGamma) is built for cubic voxels.  For a cell whose
      edges differ (TPMS cell_scale_x/y/z, beam scale_xyz) the voxel grid
      stays N³ but the voxel spacing differs per axis, h = (hx, hy, hz).
      Willot's rotated discrete frequency then reads
          ξ_α = (1/h_α) · sin(πk_α/N) · Π_{β≠α} cos(πk_β/N)
      and only the unit direction n = ξ/|ξ| enters Γ̂, so the per-axis
      spacing is the only change.  Γ̂ stays real, even and symmetric, so
      16i's packed operator is still exact.  sweepGammaKernel builds the 21
      symmetric planes on the GPU (one thread per Fourier mode) in the
      exact layout 16i reads.  With hx = hy = hz it equals buildGammaFull.

   2. Stretched cells, thermal.  Mapping the stretched cell onto unit voxels
      (ξ_a = x_a / h_a) turns ∇·(k∇T) = 0 into the same problem with the
      voxel conductivity k̃ = H⁻¹ k H⁻¹, and the effective conductivity
      maps back as K = H K̃ H (H = diag(h)).  Normalized by s_x² so the
      factors fit F13LD.lab's existing uniform pads:
          k̂_ab = k_ab · s_a s_b / s_x²,  s = 1/h,
          ry = (hx/hy)², rz = (hx/hz)²   (TP.pad0, TP.pad1)
          K_ab = K̂_ab · s_x² / (s_a s_b)
      sweepPatchThermal rebuilds four of a ThermalGPUSolver's pipelines from
      Lab's own WGSL with the voxel tensor scaled (ktenS) and the FFT
      preconditioner's symbol weighted per axis (still SPD; with ry = rz = 1
      it is Lab's operator exactly).

   3. sweepGammaPackedCPU — the same stretched Γ on the CPU (Float64 →
      Float32), for the self-check (bench.html) only.

   Index order is Lab's: idx = i·N² + j·N + k, x on i (buildGammaFull).
   ============================================================ */

var SWEEP_GPU_KERNELS_VERSION = 'sgk-1';

/* ── 1. Stretched packed Γ̂ on the GPU ─────────────────────────── */
function sweepGammaWGSL() {
  var IJ = [[0, 0], [1, 1], [2, 2], [1, 2], [0, 2], [0, 1]], F = [1, 1, 1, 2, 2, 2];
  var L = [];
  L.push('struct SG { N: u32, N3: u32, p0: u32, p1: u32, a: f32, b: f32, ix: f32, iy: f32, iz: f32, q0: f32, q1: f32, q2: f32 }');
  L.push('@group(0) @binding(0) var<storage, read_write> G: array<f32>;');
  L.push('@group(0) @binding(1) var<uniform> U: SG;');
  /* sin / cos of πk/N per index, computed in Float64 on the CPU (cos is
     exactly 0 at the Nyquist index, as Willot's scheme needs) */
  L.push('@group(0) @binding(2) var<storage, read> SC: array<vec2<f32>>;');
  L.push('@compute @workgroup_size(64)');
  L.push('fn sweep_gamma(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {');
  L.push('  let p = gid.x + gid.y * nw.x * 64u;');
  L.push('  if (p >= U.N3) { return; }');
  L.push('  let N = U.N; let T = U.N3;');
  L.push('  let i = p / (N * N); let j = (p / N) % N; let k = p % N;');
  L.push('  var n = vec3<f32>(0.0);');
  L.push('  var live = !(i == 0u && j == 0u && k == 0u);');
  L.push('  if (live) {');
  L.push('    let a = SC[i]; let b = SC[j]; let c = SC[k];');
  L.push('    let w = vec3<f32>(a.x * b.y * c.y * U.ix, a.y * b.x * c.y * U.iy, a.y * b.y * c.x * U.iz);');
  L.push('    let wsq = dot(w, w);');
  L.push('    if (wsq > 0.0) { n = w / sqrt(wsq); } else { live = false; }');
  L.push('  }');
  for (var P = 0; P < 6; P++) for (var Q = P; Q < 6; Q++) {
    var iP = IJ[P][0], jP = IJ[P][1], kQ = IJ[Q][0], lQ = IJ[Q][1], t = [];
    if (iP === kQ) t.push('n[' + lQ + '] * n[' + jP + ']');
    if (iP === lQ) t.push('n[' + kQ + '] * n[' + jP + ']');
    if (jP === kQ) t.push('n[' + lQ + '] * n[' + iP + ']');
    if (jP === lQ) t.push('n[' + kQ + '] * n[' + iP + ']');
    var part1 = t.length ? '(U.a * 0.25) * (' + t.join(' + ') + ')' : '0.0';
    var part2 = 'U.b * n[' + iP + '] * n[' + jP + '] * n[' + kQ + '] * n[' + lQ + ']';
    var s = 6 * P - (P * (P - 1)) / 2 + (Q - P);   /* nlGammaSymIdx(P, Q) */
    L.push('  G[' + s + 'u * T + p] = select(0.0, ' + (F[P] * F[Q]) + '.0 * (' + part1 + ' + ' + part2 + '), live);');
  }
  L.push('}');
  return L.join('\n');
}
/* sin(πk/N), cos(πk/N) with k the signed frequency of index n (Float64) */
function sweepGammaTable(N) {
  var t = new Float32Array(2 * N);
  for (var n = 0; n < N; n++) {
    var kf = n <= N / 2 ? n : n - N;
    t[2 * n] = Math.sin(Math.PI * kf / N);
    t[2 * n + 1] = (2 * n === N) ? 0 : Math.cos(Math.PI * kf / N);
  }
  return t;
}

/* A per-lane stretched Γ: one 21·N³ buffer reused for every design the
   lane solves, rebuilt by one dispatch. */
function SweepGammaBuilder(N) {
  var d = WGPU.device;
  this.N = N; this.N3 = N * N * N;
  this.buf = d.createBuffer({ size: 21 * this.N3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  this.uni = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  this.tab = d.createBuffer({ size: Math.max(16, 8 * N), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  d.queue.writeBuffer(this.tab, 0, sweepGammaTable(N));
  this.pipe = sweepGammaPipeline();
  this.bg = d.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.buf } }, { binding: 1, resource: { buffer: this.uni } }, { binding: 2, resource: { buffer: this.tab } }] });
  var maxWG = (d.limits && d.limits.maxComputeWorkgroupsPerDimension) || 65535, wg = Math.ceil(this.N3 / 64);
  this.wg = [Math.min(wg, maxWG), Math.ceil(wg / Math.min(wg, maxWG))];
  this.key = null;
  this.entry = { key: null, N: N, G: this.buf };
}
var _sweepGammaPipe = null, _sweepGammaPipeDevice = null;
function sweepGammaPipeline() {
  var d = WGPU.device;
  if (_sweepGammaPipe && _sweepGammaPipeDevice === d) return _sweepGammaPipe;
  _sweepGammaPipe = d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: sweepGammaWGSL() }), entryPoint: 'sweep_gamma' } });
  _sweepGammaPipeDevice = d;
  return _sweepGammaPipe;
}
/* invH = [1/hx, 1/hy, 1/hz] (any common scale). Returns a Γ entry for
   ElasticFastSolver.upload. */
SweepGammaBuilder.prototype.build = function (mu0, lam0, invH) {
  var key = mu0 + ':' + lam0 + ':' + invH.join(',');
  if (key === this.key) return this.entry;
  var d = WGPU.device, ab = new ArrayBuffer(48);
  new Uint32Array(ab, 0, 2).set([this.N, this.N3]);
  new Float32Array(ab, 16, 5).set([1.0 / mu0, -(lam0 + mu0) / (mu0 * (lam0 + 2 * mu0)), invH[0], invH[1], invH[2]]);
  d.queue.writeBuffer(this.uni, 0, ab);
  var enc = d.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(this.pipe); pass.setBindGroup(0, this.bg); pass.dispatchWorkgroups(this.wg[0], this.wg[1], 1); pass.end();
  d.queue.submit([enc.finish()]);
  this.key = key; this.entry.key = 'stretch:' + key;
  return this.entry;
};
SweepGammaBuilder.prototype.destroy = function () {
  try { this.buf.destroy(); } catch (e) {}
  try { this.tab.destroy(); } catch (e) {}
  try { this.uni.destroy(); } catch (e) {}
};

/* ── 2. Stretched thermal: patch a ThermalGPUSolver ────────────────── */
var SWEEP_KTENS_WGSL = [
'fn ktenS(v: vec4<f32>, kF: f32) -> KT {',
'  let K = kten(v, kF);',
'  let ry = P.pad0; let rz = P.pad1; let qy = sqrt(ry); let qz = sqrt(rz);',
'  return KT(K.xx, K.yy * ry, K.zz * rz, K.xy * qy, K.xz * qz, K.yz * qy * qz);',
'}',
''
].join('\n');
function sweepThermalWGSL(src) {
  /* Lab's kernels read the voxel tensor through kten(vox[…], P.kF) */
  var out = src.split('kten(vox[').join('ktenS(vox[');
  if (out === src) throw new Error('sweep thermal patch: kten call not found (F13LD.lab thermal kernel changed?)');
  return out + '\n' + SWEEP_KTENS_WGSL;
}
function sweepSymbolWGSL(inPlace) {
  var src = thSymbolWGSL(inPlace);
  var from = 'let lam = 0.25 * (sn2(a, N) * cb * cc + sn2(b, N) * ca * cc + sn2(c, N) * ca * cb);';
  /* a ↔ z (fastest), b ↔ y, c ↔ x (slowest), as the elastic Γ index */
  var to = 'let lam = 0.25 * (bitcast<f32>(Y.pad1) * sn2(a, N) * cb * cc + bitcast<f32>(Y.pad0) * sn2(b, N) * ca * cc + sn2(c, N) * ca * cb);';
  if (src.indexOf(from) < 0) throw new Error('sweep thermal patch: symbol not found (F13LD.lab thermal kernel changed?)');
  return src.replace(from, to);
}
function sweepPatchThermal(S) {
  var d = S.device;
  var pipe = function (code, entry) { return d.createComputePipeline({ layout: 'auto', compute: { module: d.createShaderModule({ code: code }), entryPoint: entry } }); };
  S.pApply = pipe(sweepThermalWGSL(TH_APPLY_WGSL), 'th_apply');
  S.pStats = pipe(sweepThermalWGSL(TH_STATS_WGSL), 'th_stats');
  S.pQmag = pipe(sweepThermalWGSL(TH_QMAG_WGSL), 'th_qmag');
  S.pSym = pipe(sweepSymbolWGSL(S.inPlace), 'th_symbol');
  S.bg = {};
  S._sweepR = null;
  sweepThermalStretch(S, 1, 1);
  return S;
}
/* ry = (hx/hy)², rz = (hx/hz)² */
function sweepThermalStretch(S, ry, rz) {
  var key = ry + ':' + rz;
  if (S._sweepR === key) return;
  var d = S.device, f = new Float32Array([ry, rz]);
  [S.uApply, S.uRhs, S.uStats, S.uStats0].forEach(function (b) { d.queue.writeBuffer(b, 24, f); });
  d.queue.writeBuffer(S.uY, 8, f);
  S._sweepR = key;
}
/* Solid fraction per voxel (normal 0: the isotropic blend Lab uses where a
   wall normal is undefined). */
function sweepThermalUploadPhi(S, phi) {
  var N3 = S.N3, a = S._sweepVox || (S._sweepVox = new Float32Array(4 * N3));
  for (var p = 0; p < N3; p++) a[4 * p] = phi[p];
  S.device.queue.writeBuffer(S.vox, 0, a);
}
/* K̂ (row-major 3×3, from solve) → physical K for the stretch (ry, rz). */
function sweepThermalUnstretch(K, ry, rz) {
  var s = [1, Math.sqrt(ry), Math.sqrt(rz)], out = new Array(9);
  for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) out[a * 3 + b] = K[a * 3 + b] / (s[a] * s[b]);
  return out;
}

/* ── 3. CPU reference (self-check only) ─────────────────────────────── */
function sweepGammaPackedCPU(N, mu0, lam0, invH) {
  var N3 = N * N * N, out = new Float32Array(21 * N3);
  var IJ = [[0, 0], [1, 1], [2, 2], [1, 2], [0, 2], [0, 1]], F = [1, 1, 1, 2, 2, 2];
  var a = 1.0 / mu0, b = -(lam0 + mu0) / (mu0 * (lam0 + 2 * mu0)), PI_N = Math.PI / N;
  for (var i = 0; i < N; i++) { var ki = i <= N / 2 ? i : i - N;
    for (var j = 0; j < N; j++) { var kj = j <= N / 2 ? j : j - N;
      for (var k = 0; k < N; k++) { var kk = k <= N / 2 ? k : k - N;
        if (ki === 0 && kj === 0 && kk === 0) continue;
        var idx = i * N * N + j * N + k;
        var sx = Math.sin(PI_N * ki), cx = 2 * i === N ? 0 : Math.cos(PI_N * ki);
        var sy = Math.sin(PI_N * kj), cy = 2 * j === N ? 0 : Math.cos(PI_N * kj);
        var sz = Math.sin(PI_N * kk), cz = 2 * k === N ? 0 : Math.cos(PI_N * kk);
        var w = [sx * cy * cz * invH[0], cx * sy * cz * invH[1], cx * cy * sz * invH[2]];
        var wsq = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
        if (!(wsq > 1e-30)) continue;
        var rw = 1 / Math.sqrt(wsq), n = [w[0] * rw, w[1] * rw, w[2] * rw];
        for (var P = 0; P < 6; P++) for (var Q = P; Q < 6; Q++) {
          var iP = IJ[P][0], jP = IJ[P][1], kQ = IJ[Q][0], lQ = IJ[Q][1];
          var p1 = (a * 0.25) * ((iP === kQ ? n[lQ] * n[jP] : 0) + (iP === lQ ? n[kQ] * n[jP] : 0) + (jP === kQ ? n[lQ] * n[iP] : 0) + (jP === lQ ? n[kQ] * n[iP] : 0));
          var s = 6 * P - (P * (P - 1)) / 2 + (Q - P);
          out[s * N3 + idx] = F[P] * F[Q] * (p1 + b * n[iP] * n[jP] * n[kQ] * n[lQ]);
        }
      } } }
  return out;
}
