/* ============================================================
   F13LD.sweep · 60-solver-pool.js
   Web Worker pool (workers load worker/sweep-worker.js).
   ============================================================ */

// ─── Solver Worker Pool ──────────────────────────────────────────────────────
// Path B from the v0.1 review: move the FFT-CG solver off the main thread.
// Main thread stays responsive (UI, render, hover), and we get parallel design
// solves on multicore — typical 4-8× wall-clock speedup over single-threaded.
//
// Architecture:
//   - v0.20.0: workers load worker/sweep-worker.js, which importScripts the
//     same family / solver / metrics files the page uses (single source of
//     truth). Replaces the v0.19 Function.toString() Blob bundle.
//   - Pool holds N workers, where N = navigator.hardwareConcurrency - 1
//     (leave one core for UI), capped at 8.
//   - Each worker has its own SolverWorkspace and Gamma cache. First design
//     each worker handles pays the Gamma build cost; subsequent designs are free.
//   - Continuous dispatch: each result triggers the next sample, keeping all
//     workers busy until validCount target or cancellation.
//   - Sample generation (Sobol + Math.random) stays on main thread for
//     deterministic Sobol sequence regardless of completion order.

// Worker entry point. Relative to index.html; needs http(s) (file:// blocks workers).
const SWEEP_WORKER_URL = 'worker/sweep-worker.js';

class SolverPool {
  constructor(nWorkers) {
    this.nWorkers = nWorkers;
    this.workers = [];
    this.idle = [];
    this.queue = [];                 // pending jobs awaiting an idle worker
    this.jobs = new Set();           // every job not yet settled
    this.terminated = false;
    this.workerUrl = SWEEP_WORKER_URL;
    for (let i = 0; i < nWorkers; i++) this._spawn(i);
  }

  _spawn(idx) {
    const w = new Worker(this.workerUrl);
    w._idx = idx;
    w._job = null;                   // the job this worker is solving (one at a time)
    w.addEventListener('message', e => this._onMessage(w, e.data));
    w.addEventListener('error', e => this._onError(w, e));
    this.workers.push(w);
    this.idle.push(w);
    return w;
  }

  // Returns a Promise resolving with { attemptIdx, hom } or rejecting on error.
  // Jobs are tracked per worker, so equal attemptIdx values can't collide and
  // a crashed worker rejects exactly the job it was running.
  dispatch(spec) {
    if (this.terminated) return Promise.reject(new Error('pool terminated'));
    return new Promise((resolve, reject) => {
      const job = { spec, resolve, reject };
      this.jobs.add(job);
      const worker = this.idle.pop();
      if (worker) this._run(worker, job);
      else this.queue.push(job);
    });
  }

  _run(worker, job) {
    worker._job = job;
    worker.postMessage(job.spec);
  }

  _next(worker) {
    const job = this.queue.shift();
    if (job) this._run(worker, job);
    else this.idle.push(worker);
  }

  _onMessage(worker, msg) {
    if (msg.type !== 'result' && msg.type !== 'error') return;
    const job = worker._job;
    worker._job = null;
    if (job) {
      this.jobs.delete(job);
      if (msg.type === 'result') job.resolve(msg);
      else job.reject(new Error(msg.message + (msg.stack ? '\n' + msg.stack : '')));
    }
    this._next(worker);
  }

  // Uncaught error / crash: reject that worker's job, replace the worker.
  _onError(worker, e) {
    console.error(`[SolverPool] worker ${worker._idx} error:`, e && e.message, e);
    if (e && e.preventDefault) e.preventDefault();
    if (this.terminated) return;
    const job = worker._job;
    worker._job = null;
    try { worker.terminate(); } catch (_) {}
    this.workers = this.workers.filter(w => w !== worker);
    this.idle = this.idle.filter(w => w !== worker);
    if (job) {
      this.jobs.delete(job);
      job.reject(new Error(`solver worker crashed: ${(e && e.message) || 'unknown error'}`));
    }
    const fresh = this._spawn(worker._idx);
    this.idle = this.idle.filter(w => w !== fresh);
    this._next(fresh);
  }

  // Stop all workers. Pending promises are rejected.
  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    for (const w of this.workers) w.terminate();
    for (const job of this.jobs) job.reject(new Error('pool terminated'));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs.clear();
  }
}

// Module-scope singleton — created lazily, reused across sweeps.
// Avoids worker startup latency on every sweep run.
let _solverPool = null;
function getSolverPool() {
  if (!_solverPool || _solverPool.terminated) {
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    _solverPool = new SolverPool(n);
  }
  return _solverPool;
}

// ─── GPU solver (v0.24.0) ────────────────────────────────────────────────────
// One dedicated worker (solver/gpu-worker.js) runs F13LD.lab's WebGPU solver.
// The CPU workers above prepare each design (geometry, gates, metrics,
// partial-volume voxels); the GPU worker solves elastic + thermal; the page
// finishes the metrics (finishDesignGpu). Several designs are in flight on
// the GPU at once (lanes).
//   window.SWEEP_GPU = false or ?gpu=0 in the URL → CPU solver only (the
//   pre-v0.24 physics).
const SWEEP_GPU_WORKER_URL = 'solver/gpu-worker.js';

class GpuSolverClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ok = false;
    this.dead = false;
    this.adapter = null;
    this.reason = null;
  }
  init() {
    if (this._init) return this._init;
    this._init = new Promise(resolve => {
      let w;
      try { w = new Worker(SWEEP_GPU_WORKER_URL); }
      catch (e) { this.reason = 'GPU worker failed to start: ' + e.message; return resolve(false); }
      this.worker = w;
      const timer = setTimeout(() => { this.reason = 'GPU did not start in time'; resolve(false); }, 20000);
      w.addEventListener('message', e => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.ok = !!m.ok; this.adapter = m.adapter || null; this.reason = m.reason || null;
          resolve(this.ok);
        } else if (m.type === 'solved' || m.type === 'failed') {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.type === 'solved') p.resolve(m);
          else {
            if (m.fatal) this.dead = true;
            p.reject(Object.assign(new Error(m.message), { fatal: !!m.fatal }));
          }
        }
      });
      w.addEventListener('error', e => {
        clearTimeout(timer);
        console.error('[gpu] worker error:', e && e.message);
        if (e && e.preventDefault) e.preventDefault();
        this.dead = true; this.reason = (e && e.message) || 'GPU worker error';
        for (const p of this.pending.values()) p.reject(Object.assign(new Error(this.reason), { fatal: true }));
        this.pending.clear();
        resolve(false);
      });
      w.postMessage({ type: 'init' });
    });
    return this._init;
  }
  get usable() { return this.ok && !this.dead; }
  // job: { N, phi, edges, elastic, thermal } → { elastic, thermal, t_ms }
  solve(job) {
    if (!this.usable) return Promise.reject(Object.assign(new Error('GPU solver unavailable'), { fatal: true }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(Object.assign({ type: 'solve', id }, job), [job.phi.buffer]);
    });
  }
}

let _gpuSolver = null;
// Resolves to the GPU client when it can be used, else null (CPU solver).
function gpuSwitchedOff() {
  if (typeof window === 'undefined') return true;
  if (window.SWEEP_GPU === false) return true;
  try { return new URLSearchParams(location.search).get('gpu') === '0'; } catch (e) { return false; }
}
async function getGpuSolver() {
  if (gpuSwitchedOff()) return null;
  if (!_gpuSolver) _gpuSolver = new GpuSolverClient();
  const ok = await _gpuSolver.init();
  return ok && _gpuSolver.usable ? _gpuSolver : null;
}
// What the solver line in the sidebar shows.
function gpuSolverStatus() {
  if (gpuSwitchedOff()) return { gpu: false, text: 'CPU solver (GPU switched off)' };
  if (!_gpuSolver || !_gpuSolver._init) return { gpu: null, text: 'Solver: checking for a GPU…' };
  if (_gpuSolver.usable) return { gpu: true, text: 'GPU · ' + (_gpuSolver.adapter || 'WebGPU') };
  return { gpu: false, text: 'CPU solver · ' + (_gpuSolver.reason || 'no WebGPU') };
}

// One design through the pipeline. CPU: the worker does everything.
// GPU: worker prepares → GPU solves → page finishes. Resolves { attemptIdx, hom }.
async function computeDesign(pool, gpu, spec, gpuPrec) {
  if (!gpu || !gpu.usable) return pool.dispatch(spec);
  const msg = await pool.dispatch(Object.assign({}, spec, { type: 'prepare_design' }));
  const prep = msg.prep;
  if (prep.reject) return { attemptIdx: spec.attemptIdx, hom: prep.reject };
  const o = spec.opts, P = prep.P;
  const anyAxis = P.connectGate.x || P.connectGate.y || P.connectGate.z;
  const sol = await gpu.solve({
    N: P.N, phi: prep.phi, edges: prep.edges,
    elastic: anyAxis ? { Es: o.Es, nu: o.nu, voidRatio: gpuPrec.voidRatio, tol: gpuPrec.tol, maxiter: gpuPrec.maxiter } : null,
    thermal: { kS: o.ks || 1.0, kF: (o.ks || 1.0) * 0.0003, tol: gpuPrec.thTol, maxiter: gpuPrec.thMaxiter }
  });
  return { attemptIdx: spec.attemptIdx, hom: finishDesignGpu(prep, sol, o, gpuPrec) };
}
