/* ============================================================
   F13LD.sweep · fam-tpms.js
   FieldKernel interface + TpmsKernel (TPMS field, jitter, GLSL emit).
   ============================================================ */

// ─── FieldKernel ─── unified scalar-field interface for sweep families ───────
// ═════════════════════════════════════════════════════════════════════════════
//
// Originally introduced in Path E1 to factor scalar-field math behind a uniform
// interface so the sweep engine can drive multiple families without touching
// consumers (buildVoxels, buildFrag, buildDesignSpec, worker bundle).
//
// Pattern: each family supplies a kernel object with the methods below.
// `params` is opaque to consumers — only the owning kernel inspects it.
// Methods are plain functions (not class methods) so the worker bundle can
// stringify them via `f.toString()` the same way solver functions do today.
//
// Implementation history:
//   v0.1+      — TpmsKernel (algebraic terms, raw_preset resolution)
//   E2 / v0.9  — NoiseKernel (DeterministicNoise port, 7 noise types, prepass)
//   E3 / v0.10 — GrainKernel (spinodoid + GRF + hyperuniform; RD deferred).
//                P1  added the kernel.
//                P2a wired consumers (family resolution, applyMode,
//                    fftHomogenize VF floor, exports, worker bundle).
//                P2b shipped initial analytic GLSL emission (inline cos-sum
//                    for waves, anisotropic-Gaussian sum for hyperuniform)
//                    — superseded by P2c due to perf and sign issues.
//                P2c replaced inline analytic shader with baked sampler3D
//                    (matches F13LD.grain's preview convention). Bake at
//                    32³ in [-π,π]³, R8 quantization. Fixed: severe perf
//                    stutter on HU previews. WebGL2-only — sampler3D
//                    unavailable on WebGL1.
//                P2c also INCORRECTLY normalized the field to [-1,1] in
//                    the shader, based on misreading grain's evalGrid path.
//                P2d flipped half-mode preview sign in a wrong attempt to
//                    fix the resulting visual mismatch.
//                P2e dropped the spurious normalization, reverted P2d's
//                    flip. fieldEval now returns raw values (matches grain
//                    sampleF). buildFrag mode-wrappers are now correct.
//                P2f fixed the ACTUAL bug that the P2c-P2e debate was
//                    chasing: showPreview's mode resolution at line
//                    ~6354 only had a noise-mode prefix branch. Grain
//                    recipes carry geometry.topology (not geometry.mode),
//                    so 'geom.mode || "solid"' resolved to 'solid', and
//                    the noise branch didn't fire for family='grain'.
//                    buildFrag received mode='solid' regardless of recipe
//                    topology, dispatching the TPMS solid branch and
//                    rendering the complement of the recipe's expected
//                    solid set. The half-mode formula in buildFrag (which
//                    P2d/P2e debated) was never reached. Fix is one site:
//                    add grain-prefix mapping mirroring runSweep's logic.
//                P2g fixed two export bugs unrelated to preview:
//                    (1) `design.homogenization` in batch exports was a
//                    stale shared reference to baseRecipe.homogenization,
//                    making all designs byte-identical (validator-flagged).
//                    Replaced with per-design block built from solver
//                    results via new perDesignHomogenization() helper.
//                    (2) Material/domain selection wasn't carried through
//                    to exports, breaking reproducibility — same recipe
//                    under different domain/material settings produced
//                    identical exports. Added buildAnalysisContext()
//                    helper that emits {domain, material, sigma_ref_GPa,
//                    rank_metrics} at all three export sites. Material
//                    null-safe — emits material:null explicitly when the
//                    user hasn't picked one. E_solid_GPa/poisson now
//                    prefer currentMaterial over baseRecipe defaults so
//                    emitted reference moduli match what the solver used.
//                P2h expanded export metric coverage. Through P2g, the
//                    `browser:` block emitted only 9 metrics and
//                    `perDesignHomogenization` only 8. The validator
//                    flagged connect_idx specifically, but thermal
//                    (keff_x/y/z, thermal_anisotropy, k_density), all
//                    microstrain (x/y/z/avg + U_strain), pore (pore_size,
//                    throat_size, throat_efficiency, perc_idx),
//                    load_path_eff, stiff_axis, and surface_complexity
//                    were all missing too. P2h emits the full 27-metric
//                    set in both blocks regardless of domain. The
//                    DOMAIN_CONFIG[d].show array still drives UI table
//                    column visibility; exports always carry everything.
//                Reaction-diffusion (texture-based) remains deferred —
//                rejected at GrainKernel.parseRecipe with a clear message.
//                Reaction-diffusion (texture-based) remains deferred —
//                rejected at GrainKernel.parseRecipe with a clear message.
//
// Interface (all kernels):
//   family:                'tpms' | 'noise' | 'grain'
//   parseRecipe(recipe):   recipe → opaque params (resolves raw_preset etc.)
//   evaluate(p,x,y,z):     scalar field value at (x,y,z), domain [-π,π]³
//   evaluateWithGrad(p,..): { phi, gradMag } — used by pore analysis
//   jitterParams(p,draw,a): family-specific perturbation for sweep sampling
//   emitGLSLField(p):      { fns, exprFn } — GLSL source for preview shader

const TpmsKernel = {
  family: 'tpms',

  // Recipe → opaque params object. Subsumes loadFile's raw_preset branch.
  // Throws if the recipe declares a preset that can't be resolved to terms.
  parseRecipe(recipe) {
    let terms;
    if (recipe.surface.type === 'raw_preset' || !recipe.surface.terms) {
      const preset = recipe.surface.preset || recipe.meta?.preset;
      terms = resolveRawPreset(preset);
      if (!terms) throw new Error(`Raw preset "${preset}" could not be resolved to terms`);
    } else {
      terms = recipe.surface.terms;
    }
    return { terms };
  },

  // CPU field evaluation — Pass 1 delegates to the v0.8 entry points.
  // Pass 2 will inline the bodies here and remove the originals.
  evaluate(params, x, y, z) {
    return evaluateTpms(params.terms, x, y, z);
  },

  evaluateWithGrad(params, x, y, z) {
    return evaluateTpmsWithGrad(params.terms, x, y, z);
  },

  // Sweep jitter — v0.13.2 MODE-AWARE TILEABLE ARCHITECTURE.
  //
  // History:
  //   pre-v0.13.1: continuous frequency jitter (±20%) on every factor
  //                broke 2π-periodicity → broken tiling. (See git log.)
  //   v0.13.1:     replaced continuous freq with discrete {1,2,3}, added
  //                per-term phase_shift, term_mask, sign_flip. All
  //                periodic-safe → tiling works. But PI-TPMS sweeps
  //                produced disconnected pipe topologies and "plates" at
  //                xy/yz/xz planes because the broad knob set isn't
  //                appropriate for PI-TPMS's pipe-extraction logic.
  //   v0.13.2:     mode-aware. Solid/shell get the full v0.13.1 knob set
  //                (broad design exploration). PI-TPMS gets a conservative
  //                knob set: freq locked to {1}, no per-term phase shift,
  //                no term mask, no sign flip. This restores the connected,
  //                gyroid-like pipe topologies users want from PI-TPMS
  //                while keeping every output 2π-periodic.
  //
  //                PI-TPMS already has its own discrete phase shift system
  //                (sweepPhaseShift in buildDesignSpec, picked from EIGHTHS)
  //                applied at the SOLVER level — that's what gives PI-TPMS
  //                its variety. Per-term phase shift on top of that adds
  //                no value and degrades pipe coherence.
  //
  // args: {
  //   mode:           'solid' | 'shell' | 'pi-tpms' | other  — drives knob set
  //   trigSwapProb:   default 0.20
  //   coefDimOffset:  default 4
  //   freqCandidates: default [1,2,3] (solid/shell), [1] (pi-tpms)
  //   termMaskProb:   default 0.85   (solid/shell), 1.0 (pi-tpms)
  //   signFlipProb:   default 0.20   (solid/shell), 0   (pi-tpms)
  //   perTermPhase:   default true   (solid/shell), false (pi-tpms)
  // }
  //
  // All output fields are 2π-periodic by construction (regardless of mode):
  //   - integer frequencies → period 2π/freq divides 2π
  //   - phase shifts → coordinate substitution preserves period
  //   - term mask, sign flip → stay within periodic basis
  jitterParams(params, draw, args = {}) {
    const mode = args.mode || 'solid';
    const isPI = (mode === 'pi-tpms');

    const TRIG_SWAP_PROB  = args.trigSwapProb   ?? 0.20;
    const dimOff          = args.coefDimOffset  ?? 4;
    // Mode-aware defaults
    const FREQ_CANDIDATES = args.freqCandidates ?? (isPI ? [1] : [1, 2, 3]);
    const TERM_MASK_PROB  = args.termMaskProb   ?? (isPI ? 1.0 : 0.85);
    const SIGN_FLIP_PROB  = args.signFlipProb   ?? (isPI ? 0.0 : 0.20);
    const PER_TERM_PHASE  = args.perTermPhase   ?? !isPI;
    const TWO_PI_LOCAL    = 2 * Math.PI;

    // Pick an integer frequency from the candidate set
    const pickFreq = () => FREQ_CANDIDATES[Math.floor(Math.random() * FREQ_CANDIDATES.length)];

    const terms = params.terms.map((t, ti) => {
      // Term inclusion mask. PI-TPMS forces all terms on (TERM_MASK_PROB=1.0)
      // since disabling terms makes pipe-zero-loci sparse and disconnects pipes.
      const termOn = Math.random() < TERM_MASK_PROB;

      // Coefficient — Sobol-driven for first 4 terms, Math.random for rest
      let coef = +(0.05 + (ti < 4 ? draw.u(dimOff + ti) : Math.random()) * 4.95).toFixed(3);
      // Sign flip — disabled for PI-TPMS (SIGN_FLIP_PROB=0) to keep pipe-
      // extraction interpretation clean (canceling-sign terms produce flat
      // residuals → plate artifacts).
      if (Math.random() < SIGN_FLIP_PROB) coef = -coef;

      // Per-term phase shift — disabled for PI-TPMS. PI-TPMS already has its
      // own coherent phase-shift mechanism via sweepPhaseShift (the global
      // dx/dy/dz used to compute φB = f(x+dx)). Adding per-term phase shift
      // on top creates incoherent fields that don't trace clean zero-curves,
      // producing the disconnected pipe topologies that motivated v0.13.2.
      const phase_shift = PER_TERM_PHASE
        ? {
            x: +(Math.random() * TWO_PI_LOCAL).toFixed(4),
            y: +(Math.random() * TWO_PI_LOCAL).toFixed(4),
            z: +(Math.random() * TWO_PI_LOCAL).toFixed(4)
          }
        : { x: 0, y: 0, z: 0 };

      return {
        ...t,
        on: termOn,
        coef,
        phase_shift,
        factors: t.factors.map(f => {
          let trig = f.trig;
          if (Math.random() < TRIG_SWAP_PROB) {
            trig = trig.startsWith('sin') ? trig.replace('sin', 'cos') : trig.replace('cos', 'sin');
          }
          // Integer frequencies — periodic by construction
          return { trig, fx: pickFreq(), fy: pickFreq(), fz: pickFreq() };
        })
      };
    });

    // Coefficient normalisation — see v0.8 changelog for empirical motivation
    // (75% PI-TPMS discard rate → ~0% with this normalisation in place).
    // Operates on |coef|; sign is preserved through the rescale.
    const maxAbsCoef = Math.max(...terms.map(t => Math.abs(t.coef)));
    if (maxAbsCoef > 0) {
      terms.forEach(t => { t.coef = +(t.coef / maxAbsCoef).toFixed(3); });
    }

    return { terms };
  },

  // GLSL emission — single fieldEval(vec3 p, float H) function. The mode
  // wrapper (solid / shell / pi-tpms) calls this once or twice (twice for
  // PI-TPMS with a phase-shifted argument: fieldEval(p + vec3(dx,dy,dz), H)).
  // Returns { fns: function definitions, exprFn: name to call }.
  //
  // Per E1 design note: emits ONE function rather than the v0.8 evalA/evalB
  // pair. The mode wrapper handles phase shift by passing a shifted argument.
  // Cleaner than the v0.8 string-replace gymnastics; not byte-equal to v0.8
  // GLSL output (Pass 2 framebuffer-hash test validates render equivalence).
  //
  // v0.13.1: per-term phase_shift applied as coordinate substitution at the
  // term level. Each term gets its own (gx, gy, gz) line that adds the
  // term's phase shift to (p.x, p.y, p.z). All factor calls in that term
  // use the shifted coords. Backwards compatible — terms without
  // phase_shift fall back to (0,0,0) which is a no-op.
  emitGLSLField(params) {
    const active = params.terms.filter(t => t.on && t.factors && t.factors.length);
    const lines = active.map((t, ti) => {
      const ps = t.phase_shift || { x: 0, y: 0, z: 0 };
      const parts = t.factors.map(f =>
        '(' + glslTrig(f.trig, toFloat(f.fx), toFloat(f.fy), toFloat(f.fz)) + ')'
      );
      // Per-term shifted coords. Reassign gx/gy/gz before emitting the
      // term's contribution so glslTrig (which references gx/gy/gz) picks
      // up the shift transparently. Each term's reassignment is overwritten
      // by the next term's; since we emit term N+1 only after term N has
      // contributed to v, the live-coords-during-emission semantics work.
      return '  gx=p.x+' + toFloat(ps.x) + ';gy=p.y+' + toFloat(ps.y) + ';gz=p.z+' + toFloat(ps.z) + ';\n' +
             '  v+=' + toFloat(t.coef) + '*' + parts.join('*') + ';';
    }).join('\n');

    const fns =
      'float fieldEval(vec3 p, float H){' +
        'float v=0.0;' +
        'float gx=p.x,gy=p.y,gz=p.z;\n' +
        lines + '\n' +
        'return v;' +
      '}';

    return { fns, exprFn: 'fieldEval' };
  }
};

// ═════════════════════════════════════════════════════════════════════════════
