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

   v0.26.0 — how a design is varied (Matt, 2026-10-09):
     · Density is not the family's job. The sweep draws a target volume
       fraction for every design and 41-density.js sets the family's
       thickness knob (wall, offset, pipe radius, iso / half-width, strut
       radius) to hit it, so jitter leaves that knob as the recipe has it.
     · Neighbourhood (default): the design keeps its identity — term
       layout, frequencies, trig functions, phases, field type, seed,
       topology, node treatment — and its continuous settings move around
       the recipe's own values by ± ctx.spread (one Spread control for
       every family, default 25 %).
     · Explore: the wider redraw (TPMS terms and frequencies, fresh random
       seeds, noise octaves / metric, beam nodes) — what Sweep did before.

   ctx = { mode, scale:[sx,sy,sz] (when usesCellScale), axialShift:[ax,ay,az],
           spread, explore, u() (the next Sobol dimension — call it for the
           family's most influential settings first), rand (seeded),
           targetHints }
   Sobol dimension 0 is the density draw, 1–3 the cell scale (families
   with one); ctx.u() hands out the rest in order, then the seeded random
   stream.
   ============================================================ */

const SWEEP_FAMILIES = {};

/* Shared helpers for the family modules */
const jitterUtil = {
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
  /* multiplicative jitter around base: base × (M[0] + r·(M[1]−M[0])), clamped */
  mul(base, clamp, r, M) { const v = base * (M[0] + r * (M[1] - M[0])); return Math.max(clamp[0], Math.min(clamp[1], v)); },
  /* the Spread window around 1: [1 − s, 1 + s] */
  spreadMult(ctx) { const s = ctx.spread != null ? ctx.spread : 0.25; return [Math.max(0.01, 1 - s), 1 + s]; },
  /* an additive shift of ± range at the default spread (25 %), scaled with Spread */
  shift(ctx, r, range) { const s = ctx.spread != null ? ctx.spread : 0.25; return (r * 2 - 1) * range * (s / 0.25); },
  round(v, d) { return +v.toFixed(d); }
};
