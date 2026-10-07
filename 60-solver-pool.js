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
    this.queue = [];                 // pending design specs awaiting an idle worker
    this.pending = new Map();        // attemptIdx → { resolve, reject }
    this.terminated = false;

    this.workerUrl = SWEEP_WORKER_URL;

    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(this.workerUrl);
      w._idx = i;
      w.addEventListener('message', e => this._onMessage(w, e.data));
      w.addEventListener('error', e => this._onError(w, e));
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  // Returns a Promise resolving with { attemptIdx, hom } or rejecting on error.
  dispatch(spec) {
    if (this.terminated) return Promise.reject(new Error('pool terminated'));
    return new Promise((resolve, reject) => {
      this.pending.set(spec.attemptIdx, { resolve, reject });
      const worker = this.idle.pop();
      if (worker) {
        worker.postMessage(spec);
      } else {
        this.queue.push(spec);
      }
    });
  }

  _onMessage(worker, msg) {
    if (msg.type === 'result' || msg.type === 'error') {
      const p = this.pending.get(msg.attemptIdx);
      if (p) {
        this.pending.delete(msg.attemptIdx);
        if (msg.type === 'result') p.resolve(msg);
        else p.reject(new Error(msg.message + (msg.stack ? '\n' + msg.stack : '')));
      }
      // Worker is now free — give it queued work or mark idle
      const next = this.queue.shift();
      if (next) worker.postMessage(next);
      else this.idle.push(worker);
    }
  }

  _onError(worker, e) {
    console.error(`[SolverPool] worker ${worker._idx} error:`, e.message, e);
    // Reject any pending designs assigned to this worker (we don't track which,
    // so reject the most recent one as a heuristic — rare path)
  }

  // Stop all workers. Pending promises are rejected.
  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('pool terminated'));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending.clear();
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
