/* ============================================================
   F13LD.sweep · families/fam-index.js
   Sweep-side family modules: how each family's recipe is varied
   (jitter) and summarized. The geometry itself — recipe → field →
   voxels — is the shared geom/ code; nothing here builds geometry.

   Each families/fam-<name>.js registers
     SWEEP_FAMILIES.<name> = {
       label,                       short name for logs
       usesCellScale,               true → the sweep draws a per-axis cell scale
       nominalScale(recipe),        the base cell scale the % ranges multiply
       describe(recipe),            one-line summary for the recipe card / log
       summary(recipe),             short table text for one design
       jitter(base, draw, ctx)      → a NEW design recipe (design-tool format)
     }
   ctx = { mode, scale:[sx,sy,sz] (when usesCellScale), axialShift:[ax,ay,az],
           radiusFrac:{x:[lo,hi],y:[lo,hi],z:[lo,hi]} (beam), targetHints }
   draw.u(i) is the Sobol sample for dimension i; Math.random covers the rest.
   ============================================================ */

const SWEEP_FAMILIES = {};

/* Shared helpers for the family modules */
const jitterUtil = {
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
  /* multiplicative jitter around base: base × (M[0] + r·(M[1]−M[0])), clamped */
  mul(base, clamp, r, M) { const v = base * (M[0] + r * (M[1] - M[0])); return Math.max(clamp[0], Math.min(clamp[1], v)); },
  round(v, d) { return +v.toFixed(d); }
};
