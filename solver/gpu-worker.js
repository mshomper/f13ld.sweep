/* ============================================================
   F13LD.sweep · solver/gpu-worker.js
   Licence: PolyForm Noncommercial 1.0.0 (solver/LICENSE.md, solver/NOTICE)

   The GPU solver worker.  Runs F13LD.lab's own WebGPU solver files
   (solver/lab/, byte-identical with F13LD.lab, tests/parity/solversync.js)
   in a worker of its own, so their globals never meet Sweep's and the page
   stays responsive while designs solve.

   Per design (message 'solve'):
     elastic — F13LD.lab's fast path (16i ElasticFastSolver): full 6×6
               Voigt stiffness from six load cases, GPU-resident CG, packed
               spectral operator.  Cubic cells use Lab's cached Γ̂
               (elasticFastGamma); stretched cells build theirs on the GPU
               (sweep-gpu-kernels.js).
     thermal — F13LD.lab's GPU conductivity solver (17b ThermalGPUSolver),
               three load cases at once, with the stretched-cell scaling
               (sweep-gpu-kernels.js).
   Speed: several designs are in flight at once ("lanes", each with its
   own solver buffers; the FFT plan and the cubic Γ̂ are shared; 6 lanes at
   N ≤ 16, 4 at 32, 2 at 64).  While one lane waits on a readback the
   others keep the GPU queue full.

   Messages in:
     { type: 'init' }
     { type: 'solve', id, N, phi (Float32Array N³, solid fraction, solver
       order), edges [ex, ey, ez] (relative cell edges), elastic: { Es, nu,
       voidRatio, tol, maxiter } | null, thermal: { kS, kF, tol, maxiter } | null }
   Messages out:
     { type: 'ready', ok, adapter, reason }
     { type: 'solved', id, elastic, thermal, t_ms }
     { type: 'failed', id, message, fatal }
   ============================================================ */

self.window = self;   /* Lab files read a few window.* switches */
importScripts(
  'lab/10-hardware.js',
  'lab/11-webgpu-device.js',
  'lab/12-fft-plan.js',
  'lab/16a-elastic-cpu-ref-full.js',
  'lab/16b-elastic-solver-full.js',
  'lab/16g-nonlinear-solver.js',
  'lab/16i-elastic-fast.js',
  'lab/17b-thermal-solver.js',
  'sweep-gpu-kernels.js'
);
/* Lab paints its header pills from these; there is no DOM here. */
self.paintHardwarePill = function () {};
self.paintSolverPill = function () {};

/* Isotropic stiffness, Voigt 6×6 (as F13LD.lab 14-rasterizer isoC). */
function sweepIsoC(E, nu) {
  var lam = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu)), C = new Float64Array(36);
  C[0] = C[7] = C[14] = lam + 2 * mu;
  C[1] = C[2] = C[6] = C[8] = C[12] = C[13] = lam;
  C[21] = C[28] = C[35] = mu;
  return C;
}

var GW = { lanes: [], N: 0, queue: [], dead: false };

/* Designs in flight per grid: small grids are readback-latency bound, so
   more lanes; big grids fill the GPU on their own.  Keep equal to
   gpuLanesFor in 55-estimate-gpu.js. */
function gwLaneCount(N) { return N <= 16 ? 6 : N <= 32 ? 4 : 2; }

async function gwInit() {
  if (!self.navigator || !navigator.gpu) return { ok: false, reason: 'WebGPU is not available in this browser' };
  var adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ok: false, reason: 'no GPU adapter' };
  HW.webgpu_available = true; HW.adapter = adapter;
  var info = adapter.info || {};
  HW.adapter_name = [info.vendor, info.architecture || info.device].filter(Boolean).join(' · ') || info.description || 'GPU';
  await ensureDevice();
  WGPU.device.lost.then(function () { GW.dead = true; });
  return { ok: true, adapter: HW.adapter_name };
}

function Lane(N, idx) {
  this.N = N; this.idx = idx; this.busy = false;
  this.ef = new ElasticFastSolver(N, elasticFastPlan(N));   /* FFT plan shared */
  this.th = sweepPatchThermal(new ThermalGPUSolver(N));
  this.gb = null;   /* stretched Γ̂, built on first need */
}
Lane.prototype.destroy = function () {
  try { this.ef.destroy(); } catch (e) {}
  try { this.th.destroy(); } catch (e) {}
  if (this.gb) this.gb.destroy();
};

function gwLanesFor(N) {
  if (GW.N !== N) {
    GW.lanes.forEach(function (l) { l.destroy(); });
    GW.lanes = [];
    GW.N = N;
  }
  while (GW.lanes.length < gwLaneCount(N)) GW.lanes.push(new Lane(N, GW.lanes.length));
  return GW.lanes;
}

function gwCubic(e) { return Math.abs(e[0] - e[1]) <= 1e-9 * e[0] && Math.abs(e[0] - e[2]) <= 1e-9 * e[0]; }

async function gwSolve(lane, job) {
  var t0 = performance.now(), out = { elastic: null, thermal: null };
  var N = job.N, e = job.edges || [1, 1, 1];
  /* relative spacing, geometric mean 1 (keeps the f32 numbers near 1) */
  var gm = Math.cbrt(e[0] * e[1] * e[2]), h = [e[0] / gm, e[1] / gm, e[2] / gm];
  if (job.elastic) {
    var E = job.elastic, C_s = sweepIsoC(E.Es, E.nu), C_v = sweepIsoC(E.Es * E.voidRatio, E.nu), C_0 = C_s;
    var g;
    if (gwCubic(e)) g = elasticFastGamma(N, C_0[21], C_0[1], {});
    else {
      if (!lane.gb) lane.gb = new SweepGammaBuilder(N);
      g = lane.gb.build(C_0[21], C_0[1], [1 / h[0], 1 / h[1], 1 / h[2]]);
    }
    if (!g) throw new Error('the GPU cannot hold the Green operator at N = ' + N);
    lane.ef.upload(job.phi, g, C_s, C_v, C_0);
    var hom = await lane.ef.homogenize(E.tol, E.maxiter, []);
    out.elastic = {
      valid: !!hom.valid, reject_reason: hom.reject_reason || null,
      C: Array.from(hom.C_eff), S: hom.S ? Array.from(hom.S) : null,
      iters: hom.totalIters, converged: !!hom.allConverged,
      perLC: (hom.perLC || []).map(function (p) { return { axis: p.axis, iters: p.iters, converged: p.converged, residual: p.finalResidual }; })
    };
  }
  if (job.thermal) {
    var T = job.thermal, ry = (h[0] / h[1]) * (h[0] / h[1]), rz = (h[0] / h[2]) * (h[0] / h[2]);
    sweepThermalUploadPhi(lane.th, job.phi);
    sweepThermalStretch(lane.th, ry, rz);
    var R = await lane.th.solve(T.kS, T.kF, { tol: T.tol, maxiter: T.maxiter });
    var K = sweepThermalUnstretch(R.K, ry, rz);
    out.thermal = {
      K: K, iters: Math.max.apply(null, R.perLC.map(function (p) { return p.iters; })),
      converged: R.perLC.every(function (p) { return p.converged; })
    };
  }
  out.t_ms = performance.now() - t0;
  return out;
}

function gwPump() {
  if (!GW.queue.length) return;
  var lanes;
  try { lanes = gwLanesFor(GW.queue[0].N); }
  catch (err) { gwFailAll(err, true); return; }
  for (var i = 0; i < lanes.length && GW.queue.length; i++) {
    var lane = lanes[i];
    if (lane.busy) continue;
    if (GW.queue[0].N !== GW.N) break;   /* grid change: wait for the lanes to drain */
    var job = GW.queue.shift();
    gwRun(lane, job);
  }
  /* grid change and every lane idle → rebuild for the new grid */
  if (GW.queue.length && GW.queue[0].N !== GW.N && GW.lanes.every(function (l) { return !l.busy; })) gwPump();
}

function gwRun(lane, job) {
  lane.busy = true;
  gwSolve(lane, job).then(function (r) {
    self.postMessage({ type: 'solved', id: job.id, elastic: r.elastic, thermal: r.thermal, t_ms: r.t_ms });
  }).catch(function (err) {
    var fatal = GW.dead || !WGPU.device;
    self.postMessage({ type: 'failed', id: job.id, message: (err && err.message) || String(err), fatal: fatal });
    if (fatal) { gwFailAll(err, true); return; }
  }).then(function () {
    lane.busy = false;
    if (!GW.dead) gwPump();
  });
}

function gwFailAll(err, fatal) {
  GW.dead = GW.dead || fatal;
  var q = GW.queue; GW.queue = [];
  q.forEach(function (job) { self.postMessage({ type: 'failed', id: job.id, message: (err && err.message) || String(err), fatal: fatal }); });
}

self.addEventListener('message', function (e) {
  var m = e.data;
  if (m.type === 'init') {
    gwInit(m.lanes).then(function (r) { self.postMessage(Object.assign({ type: 'ready' }, r)); })
      .catch(function (err) { self.postMessage({ type: 'ready', ok: false, reason: (err && err.message) || String(err) }); });
  } else if (m.type === 'solve') {
    if (GW.dead) { self.postMessage({ type: 'failed', id: m.id, message: 'GPU device lost', fatal: true }); return; }
    GW.queue.push(m);
    gwPump();
  }
});
