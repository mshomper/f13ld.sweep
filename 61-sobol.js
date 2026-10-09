/* ============================================================
   F13LD.sweep · 61-sobol.js
   Sobol low-discrepancy sequence and sampler factory.
   ============================================================ */

// ─── Sobol low-discrepancy sequence ──────────────────────────────────────────
// Drop-in replacement for Math.random() that gives much better space coverage
// at small sample counts. For 200 samples in 6+ dimensions, Sobol typically
// has ~3× lower star-discrepancy than uniform random — meaning fewer "clumps"
// and fewer "holes" in the sampled parameter space.
//
// Dimensions are assigned in order of importance:
//   dim 0-2: scaleX, scaleY, scaleZ      (always — most impactful axes)
//   dim 3:   offset / pipe_radius / nWeight_x  (mode-dependent primary)
//   dim 4-7: per-term coefficients
//   dim 8+:  high-frequency jitter — falls through to Math.random()
//
// Direction numbers (Joe-Kuo "new-joe-kuo-6.21201" short table) for d≤8.
// Reference: http://web.maths.unsw.edu.au/~fkuo/sobol/
class SobolSeq {
  constructor(d) {
    this.d = Math.min(d, 8);
    this.nbits = 30;  // 2^30 ≈ 1B points — far more than any sweep needs
    this.scale = 1.0 / (1 << this.nbits);

    // Joe-Kuo polynomials and m-values for dims 1..8
    // Format: { s: degree of primitive polynomial, a: poly coefficient bits, m: initial direction values }
    const polys = [
      { s: 0, a: 0,  m: [] },               // dim 1 — Van der Corput (special)
      { s: 1, a: 0,  m: [1] },              // dim 2
      { s: 2, a: 1,  m: [1, 3] },           // dim 3
      { s: 3, a: 1,  m: [1, 3, 1] },        // dim 4
      { s: 3, a: 2,  m: [1, 1, 1] },        // dim 5
      { s: 4, a: 1,  m: [1, 1, 3, 3] },     // dim 6
      { s: 4, a: 4,  m: [1, 3, 5, 13] },    // dim 7
      { s: 5, a: 2,  m: [1, 1, 5, 5, 17] }, // dim 8
    ];

    this.V = [];  // direction numbers V[j][k] for dim j, bit position k
    for (let j = 0; j < this.d; j++) {
      const Vj = new Uint32Array(this.nbits);
      const { s, a, m } = polys[j];

      if (j === 0) {
        // First dimension: V[k] = 2^(nbits-1-k) — gives Van der Corput sequence
        for (let k = 0; k < this.nbits; k++) Vj[k] = 1 << (this.nbits - 1 - k);
      } else {
        // Initialize from m values
        for (let k = 0; k < s; k++) Vj[k] = m[k] << (this.nbits - 1 - k);
        // Recurrence for k >= s, using primitive polynomial coefficients in 'a'
        for (let k = s; k < this.nbits; k++) {
          let val = Vj[k-s] ^ (Vj[k-s] >>> s);
          for (let i = 1; i < s; i++) {
            if ((a >>> (s - 1 - i)) & 1) val ^= Vj[k-i];
          }
          Vj[k] = val >>> 0;
        }
      }
      this.V.push(Vj);
    }

    this.X = new Uint32Array(this.d);
    this.i = 0;
  }

  // Returns the next d-dimensional point as Float64Array values in [0, 1).
  // Index advances every call — allocate once and reuse if calling often.
  next(out) {
    if (!out) out = new Float64Array(this.d);
    if (this.i === 0) {
      /* the first Sobol point is the all-zero corner — skip it, so the
         first design isn't at the low end of every range */
      this.i++;
      return this.next(out);
    }
    // Position of lowest 0-bit in (i - 1) — drives which V to XOR
    let c = 0, m = this.i - 1;
    while (m & 1) { c++; m >>>= 1; }
    for (let j = 0; j < this.d; j++) {
      this.X[j] = (this.X[j] ^ this.V[j][c]) >>> 0;
      out[j] = this.X[j] * this.scale;
    }
    this.i++;
    return out;
  }

  reset() {
    this.X.fill(0);
    this.i = 0;
  }
}

// Sampler facade — switches between uniform random and Sobol per user choice.
// Returns a fresh sample object each call. Sobol advances internal state every
// call (including discarded designs) — drift across runs is deterministic.
/* Seeded uniform random numbers (mulberry32): a sweep with the same seed
   draws the same designs. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSampler(method, dims, rand) {
  rand = rand || Math.random;
  if (method === 'sobol') {
    const sobol = new SobolSeq(dims);
    const buf = new Float64Array(sobol.d);
    /* v0.27.0 — a random digital shift per dimension (XOR with a seeded
       30-bit word; keeps the low-discrepancy net). Unshifted, the early
       Sobol points share their value across dimensions ≥ 1 (0.5, 0.25,
       0.75 …): the first designs of a sweep drew the same cell scale on
       X, Y and Z — the three "near-isotropic scale" discards in every run,
       and foam stretches of [1, 1, 1]. */
    const shift = new Uint32Array(sobol.d);
    for (let j = 0; j < sobol.d; j++) shift[j] = Math.floor(rand() * (1 << sobol.nbits)) >>> 0;
    return {
      method: 'sobol',
      next: () => {
        sobol.next(buf);
        for (let j = 0; j < sobol.d; j++) buf[j] = ((sobol.X[j] ^ shift[j]) >>> 0) * sobol.scale;
        return {
          // Sobol samples for first 8 dims; rest fall through to Math.random()
          u: (i) => i < sobol.d ? buf[i] : rand()
        };
      }
    };
  }
  return {
    method: 'uniform',
    next: () => ({ u: () => rand() })
  };
}
