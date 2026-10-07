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
      this.i++;
      for (let j = 0; j < this.d; j++) out[j] = 0.5 * this.scale;  // tiny offset to avoid zero
      return out;
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
function makeSampler(method, dims) {
  if (method === 'sobol') {
    const sobol = new SobolSeq(dims);
    const buf = new Float64Array(sobol.d);
    return {
      method: 'sobol',
      next: () => {
        sobol.next(buf);
        return {
          // Sobol samples for first 8 dims; rest fall through to Math.random()
          u: (i) => i < sobol.d ? buf[i] : Math.random()
        };
      }
    };
  }
  return {
    method: 'uniform',
    next: () => ({ u: () => Math.random() })
  };
}
