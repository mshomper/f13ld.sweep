/* ============================================================
   F13LD.sweep · 42-fft.js
   Radix-2 complex 1-D / 3-D FFT (CPU).
   ============================================================ */

// ── Real 3D FFT (Cooley-Tukey, in-place, power-of-2 only) ────────────────────
// FFT grid N=16 for TPMS / N=32 for PI-TPMS: power-of-2 for radix-2 FFT,
// sufficient accuracy for sweep ranking. PI-TPMS needs higher resolution
// because of its r² volume-fraction scaling at small pipe radii.

// Cooley-Tukey FFT — operates on interleaved [re, im, re, im, ...] Float64Array
// n must be a power of 2, x.length = 2*n
function fft1d(x, inverse) {
  const n = x.length >> 1;
  // bit-reverse permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = x[2*i]; x[2*i] = x[2*j]; x[2*j] = t;
      t = x[2*i+1]; x[2*i+1] = x[2*j+1]; x[2*j+1] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = sign * 2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < (len >> 1); j++) {
        const uRe = x[2*(i+j)],         uIm = x[2*(i+j)+1];
        const vRe = x[2*(i+j+len/2)],   vIm = x[2*(i+j+len/2)+1];
        const tvRe = curRe*vRe - curIm*vIm;
        const tvIm = curRe*vIm + curIm*vRe;
        x[2*(i+j)]         = uRe + tvRe;
        x[2*(i+j)+1]       = uIm + tvIm;
        x[2*(i+j+len/2)]   = uRe - tvRe;
        x[2*(i+j+len/2)+1] = uIm - tvIm;
        const newRe = curRe*wRe - curIm*wIm;
        curIm = curRe*wIm + curIm*wRe;
        curRe = newRe;
      }
    }
  }
  if (inverse) for (let i = 0; i < x.length; i++) x[i] /= n;
}

// 3D FFT on a flat N³ complex array (interleaved re/im), N must be power of 2.
// Optional pre-allocated lineBuf (Float64Array of length 2*N) avoids per-call
// allocation — pass one in from the solver workspace for hot-path use.
function fft3d(data, N, inverse, lineBuf) {
  const buf = lineBuf || new Float64Array(2 * N);
  // along X
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) { buf[2*i] = data[2*(i*N*N+j*N+k)]; buf[2*i+1] = data[2*(i*N*N+j*N+k)+1]; }
    fft1d(buf, inverse);
    for (let i = 0; i < N; i++) { data[2*(i*N*N+j*N+k)] = buf[2*i]; data[2*(i*N*N+j*N+k)+1] = buf[2*i+1]; }
  }
  // along Y
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) { buf[2*j] = data[2*(i*N*N+j*N+k)]; buf[2*j+1] = data[2*(i*N*N+j*N+k)+1]; }
    fft1d(buf, inverse);
    for (let j = 0; j < N; j++) { data[2*(i*N*N+j*N+k)] = buf[2*j]; data[2*(i*N*N+j*N+k)+1] = buf[2*j+1]; }
  }
  // along Z
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    for (let k = 0; k < N; k++) { buf[2*k] = data[2*(i*N*N+j*N+k)]; buf[2*k+1] = data[2*(i*N*N+j*N+k)+1]; }
    fft1d(buf, inverse);
    for (let k = 0; k < N; k++) { data[2*(i*N*N+j*N+k)] = buf[2*k]; data[2*(i*N*N+j*N+k)+1] = buf[2*k+1]; }
  }
}
