// worker_threads entry: loads every tool once, then runs parity jobs sent by parity.js.
'use strict';
const { parentPort, workerData } = require('worker_threads');
for (const [k, v] of Object.entries(workerData.env || {})) process.env[k] = v;
const { runJob } = require('./runner');
parentPort.on('message', job => {
  let row;
  try { row = runJob(job, workerData.N, workerData.tol); }
  catch (e) { row = { section: job.kind, name: job.name || job.base, family: job.family, error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
  parentPort.postMessage({ idx: job.idx, row });
});
