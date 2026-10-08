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
