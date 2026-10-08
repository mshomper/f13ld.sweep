/* F13LD.sweep · tests/gpu/stretch-check.js  (dev only; PolyForm like solver/)
   CPU checks of the stretched-cell Green operator (solver/sweep-gpu-kernels.js)
   using F13LD.lab's own CPU reference CG (solver/lab/16a, Float64):
     1. sweepGammaPackedCPU with equal spacing = Lab's buildGammaFull.
     2. Known answer: a gyroid sheet in a stretched cell (edges 0.5, 0.5, 1)
        solved on N³ vs the same structure as a 2×2×1 supercell in a cube on
        (2N)³ (uniform voxels, Lab's cubic operator).  Same continuum
        structure, so the moduli must agree to discretization (a few %).
     3. Tolerance study: CG tol 1e-3 vs 1e-5 (Sweep Fast vs tight).
   Run: node tests/gpu/stretch-check.js [N=8]          (~1–3 min at N = 8) */
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const ctx = { console, Math, Float64Array, Float32Array, Int32Array, Uint8Array, Array, performance: { now: () => Date.now() } };
ctx.self = ctx.window = ctx; vm.createContext(ctx);
for (const f of ['solver/lab/12b-fft-cpu.js', 'solver/lab/16a-elastic-cpu-ref-full.js', 'solver/sweep-gpu-kernels.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const N = +(process.argv[2] || 8);
const isoC = (E, nu) => { const l = E * nu / ((1 + nu) * (1 - 2 * nu)), m = E / (2 * (1 + nu)), C = new Float64Array(36);
  C[0] = C[7] = C[14] = l + 2 * m; C[1] = C[2] = C[6] = C[8] = C[12] = C[13] = l; C[21] = C[28] = C[35] = m; return C; };
const Es = 110, nu = 0.3, C_s = isoC(Es, nu);
const sym = (P, Q) => { if (P > Q) [P, Q] = [Q, P]; return 6 * P - (P * (P - 1)) / 2 + (Q - P); };
function unpack(G, M) { const M3 = M * M * M, out = []; for (let P = 0; P < 6; P++) { out.push([]); for (let Q = 0; Q < 6; Q++) out[P].push(Float64Array.from(G.subarray(sym(P, Q) * M3, (sym(P, Q) + 1) * M3))); } return out; }

/* 1 */
{
  const M = N, ref = ctx.buildGammaFull(M, C_s[21], C_s[1]), mine = ctx.sweepGammaPackedCPU(M, C_s[21], C_s[1], [1, 1, 1]);
  let md = 0, mx = 0; const M3 = M * M * M;
  for (let P = 0; P < 6; P++) for (let Q = P; Q < 6; Q++) for (let i = 0; i < M3; i++) { md = Math.max(md, Math.abs(ref[P][Q][i] - mine[sym(P, Q) * M3 + i])); mx = Math.max(mx, Math.abs(ref[P][Q][i])); }
  console.log(`1. cubic Γ vs Lab buildGammaFull: max |diff| / max |Γ| = ${(md / mx).toExponential(2)}  ${md / mx < 1e-6 ? 'PASS' : 'FAIL'}`);
}

/* gyroid sheet, partial volume by 4³ sub-samples */
const gyr = (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
function phiGrid(M, cells, t) {
  const M3 = M * M * M, out = new Float32Array(M3), s = 4, TP = 2 * Math.PI;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) {
    let n = 0;
    for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) for (let c = 0; c < s; c++) {
      const x = (i + (a + 0.5) / s) / M * cells[0] * TP, y = (j + (b + 0.5) / s) / M * cells[1] * TP, z = (k + (c + 0.5) / s) / M * cells[2] * TP;
      if (Math.abs(gyr(x, y, z)) < t) n++;
    }
    out[i * M * M + j * M + k] = n / (s * s * s);
  }
  return out;
}
function solve(phi, M, Gamma, voidRatio, tol) {
  const C_v = isoC(Es * voidRatio, nu), C = new Float64Array(36);
  let it = 0;
  for (let lc = 0; lc < 6; lc++) {
    const e = [0, 0, 0, 0, 0, 0]; e[lc] = 1;
    const r = ctx.cgSolveFullCPU(phi, C_s, C_v, C_s, Gamma, M, e, tol, 2000);
    it += r.iters;
    for (let P = 0; P < 6; P++) C[P * 6 + lc] = r.sigma[P];
  }
  for (let P = 0; P < 6; P++) for (let Q = P + 1; Q < 6; Q++) { const a = 0.5 * (C[P * 6 + Q] + C[Q * 6 + P]); C[P * 6 + Q] = C[Q * 6 + P] = a; }
  const S = ctx.invert6x6(C);
  return { E: [1 / S[0], 1 / S[7], 1 / S[14]], G: [1 / S[21], 1 / S[28], 1 / S[35]], it };
}
const fmt = r => `E ${r.E.map(v => v.toFixed(3)).join(' ')} · G ${r.G.map(v => v.toFixed(3)).join(' ')} (${r.it} it)`;
const pct = (a, b) => ((a - b) / b * 100).toFixed(2) + '%';

/* 2 */
{
  const t = 0.4, tol = +(process.env.TOL || 1e-5), vr = 1e-3;
  const sN = Date.now();
  const phiS = phiGrid(N, [1, 1, 1], t);
  const GS = unpack(ctx.sweepGammaPackedCPU(N, C_s[21], C_s[1], [1 / 0.5, 1 / 0.5, 1 / 1]), N);
  const rS = solve(phiS, N, GS, vr, tol);
  const M = 2 * N, phiC = phiGrid(M, [2, 2, 1], t);
  const rC = solve(phiC, M, ctx.buildGammaFull(M, C_s[21], C_s[1]), vr, tol);
  const rU = solve(phiS, N, ctx.buildGammaFull(N, C_s[21], C_s[1]), vr, tol);   /* same voxels, cubic operator (old behaviour) */
  console.log(`2. stretched cell (0.5, 0.5, 1) at N=${N}:  ${fmt(rS)}`);
  console.log(`   2×2×1 supercell, cube, N=${M}:      ${fmt(rC)}`);
  console.log(`   same voxels as a cube (pre-v0.24):   ${fmt(rU)}`);
  const dE = rS.E.map((v, i) => pct(v, rC.E[i])), dG = rS.G.map((v, i) => pct(v, rC.G[i]));
  const dEu = rU.E.map((v, i) => pct(v, rC.E[i]));
  console.log(`   stretched vs supercell: E ${dE.join(' ')} · G ${dG.join(' ')}`);
  console.log(`   cube-voxel vs supercell: E ${dEu.join(' ')}   (${((Date.now() - sN) / 1000).toFixed(0)} s)`);
}

/* 3 */
{
  const phi = phiGrid(N, [1, 1, 1], 0.4), G = ctx.buildGammaFull(N, C_s[21], C_s[1]);
  const a = solve(phi, N, G, 1e-3, 1e-3), b = solve(phi, N, G, 1e-3, 1e-5);
  console.log(`3. tol 1e-3: ${fmt(a)}\n   tol 1e-5: ${fmt(b)}\n   diff E ${a.E.map((v, i) => pct(v, b.E[i])).join(' ')} · G ${a.G.map((v, i) => pct(v, b.G[i])).join(' ')}`);
}
