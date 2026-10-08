/* ============================================================
   F13LD.sweep · geom/tpms.js
   TPMS field: raw-preset expansion table, terms evaluation, field-pair PI-TPMS.

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (60-add-design.js, 13-kernels.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-TPMS-PRESETS v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ----------------------------------------------------------
   F13LD.tpms raw_preset expansion table.
   F13LD.tpms exports 9 named TPMS surfaces as `surface.type =
   'raw_preset'` with just a preset key, because the source tool
   stores them as JS function expressions rather than the
   multiplicative-trig terms array used by lab's TpmsKernel.
   This table maps each preset name to an equivalent terms array
   plus an additive constant (extracted to geometry.offset
   because lab's "solid where F < offset" convention places
   constants there rather than in the surface).

   Each expansion has been verified bit-exact (within FP64
   roundoff) against the source JS function in F13LD.tpms.
   See preset-test.js for the verification harness.

   Source: index_-_TPMS.html PRESETS table (lines 393-416).
   ---------------------------------------------------------- */
function _tpmsTpmsF(trig, fx, fy, fz){
  return { trig: trig, fx: fx != null ? fx : 1, fy: fy != null ? fy : 1, fz: fz != null ? fz : 1 };
}
function _tpmsTerm(coef){
  var factors = Array.prototype.slice.call(arguments, 1);
  return { on: true, coef: coef, factors: factors };
}

var TPMS_RAW_PRESET_TABLE = {
  fks: {
    label: 'Fischer-Koch S',
    constant: 0,
    terms: [
      _tpmsTerm(1, _tpmsTpmsF('cos(x)', 2, 1, 1), _tpmsTpmsF('sin(y)'), _tpmsTpmsF('cos(z)')),
      _tpmsTerm(1, _tpmsTpmsF('cos(y)', 1, 2, 1), _tpmsTpmsF('sin(z)'), _tpmsTpmsF('cos(x)')),
      _tpmsTerm(1, _tpmsTpmsF('cos(z)', 1, 1, 2), _tpmsTpmsF('sin(x)'), _tpmsTpmsF('cos(y)'))
    ]
  },
  splitP: {
    label: 'split-P',
    constant: -0.3,
    terms: [
      _tpmsTerm(1, _tpmsTpmsF('sin(x)'), _tpmsTpmsF('sin(y)'), _tpmsTpmsF('cos(z)')),
      _tpmsTerm(1, _tpmsTpmsF('sin(y)'), _tpmsTpmsF('sin(z)'), _tpmsTpmsF('cos(x)')),
      _tpmsTerm(1, _tpmsTpmsF('sin(z)'), _tpmsTpmsF('sin(x)'), _tpmsTpmsF('cos(y)'))
    ]
  },
  frd: {
    label: 'F-RD',
    constant: 0.3,
    terms: [
      _tpmsTerm(1,  _tpmsTpmsF('sin(x)', 2, 1, 1), _tpmsTpmsF('cos(y)'), _tpmsTpmsF('sin(z)')),
      _tpmsTerm(1,  _tpmsTpmsF('sin(x)'), _tpmsTpmsF('sin(y)', 1, 2, 1), _tpmsTpmsF('cos(z)')),
      _tpmsTerm(1,  _tpmsTpmsF('cos(x)'), _tpmsTpmsF('sin(y)'), _tpmsTpmsF('sin(z)', 1, 1, 2)),
      _tpmsTerm(-1, _tpmsTpmsF('cos(x)', 2, 1, 1), _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(-1, _tpmsTpmsF('cos(y)', 1, 2, 1), _tpmsTpmsF('cos(z)', 1, 1, 2)),
      _tpmsTerm(-1, _tpmsTpmsF('cos(z)', 1, 1, 2), _tpmsTpmsF('cos(x)', 2, 1, 1))
    ]
  },
  gyroidHarmonic: {
    label: 'gyroid-harmonic',
    constant: 0,
    terms: [
      _tpmsTerm(1,   _tpmsTpmsF('sin(x)'), _tpmsTpmsF('cos(y)')),
      _tpmsTerm(1,   _tpmsTpmsF('sin(y)'), _tpmsTpmsF('cos(z)')),
      _tpmsTerm(1,   _tpmsTpmsF('sin(z)'), _tpmsTpmsF('cos(x)')),
      _tpmsTerm(0.3, _tpmsTpmsF('sin(x)', 2, 1, 1), _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(0.3, _tpmsTpmsF('sin(y)', 1, 2, 1), _tpmsTpmsF('cos(z)', 1, 1, 2)),
      _tpmsTerm(0.3, _tpmsTpmsF('sin(z)', 1, 1, 2), _tpmsTpmsF('cos(x)', 2, 1, 1))
    ]
  },
  primitiveC: {
    label: 'primitive-C (G6)',
    constant: 0,
    terms: [
      _tpmsTerm(2,  _tpmsTpmsF('cos(x)')),
      _tpmsTerm(2,  _tpmsTpmsF('cos(y)')),
      _tpmsTerm(2,  _tpmsTpmsF('cos(z)')),
      _tpmsTerm(-1, _tpmsTpmsF('cos(x)', 2, 1, 1)),
      _tpmsTerm(-1, _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(-1, _tpmsTpmsF('cos(z)', 1, 1, 2))
    ]
  },
  octo: {
    label: 'octo (G8)',
    constant: 0,
    terms: [
      _tpmsTerm(1,    _tpmsTpmsF('cos(x)')),
      _tpmsTerm(1,    _tpmsTpmsF('cos(y)')),
      _tpmsTerm(1,    _tpmsTpmsF('cos(z)')),
      _tpmsTerm(-0.5, _tpmsTpmsF('cos(x)', 2, 1, 1), _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(-0.5, _tpmsTpmsF('cos(y)', 1, 2, 1), _tpmsTpmsF('cos(z)', 1, 1, 2)),
      _tpmsTerm(-0.5, _tpmsTpmsF('cos(z)', 1, 1, 2), _tpmsTpmsF('cos(x)', 2, 1, 1))
    ]
  },
  pHarmonic: {
    label: 'P-harmonic',
    constant: 0,
    terms: [
      _tpmsTerm(1,    _tpmsTpmsF('cos(x)')),
      _tpmsTerm(1,    _tpmsTpmsF('cos(y)')),
      _tpmsTerm(1,    _tpmsTpmsF('cos(z)')),
      _tpmsTerm(0.25, _tpmsTpmsF('cos(x)', 2, 1, 1)),
      _tpmsTerm(0.25, _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(0.25, _tpmsTpmsF('cos(z)', 1, 1, 2))
    ]
  },
  lidinoid: {
    label: 'lidinoid',
    constant: 0,
    terms: [
      _tpmsTerm(1.1,  _tpmsTpmsF('sin(x)', 2, 1, 1), _tpmsTpmsF('cos(y)'), _tpmsTpmsF('sin(z)')),
      _tpmsTerm(1.1,  _tpmsTpmsF('sin(x)'), _tpmsTpmsF('sin(y)', 1, 2, 1), _tpmsTpmsF('cos(z)')),
      _tpmsTerm(1.1,  _tpmsTpmsF('cos(x)'), _tpmsTpmsF('sin(y)'), _tpmsTpmsF('sin(z)', 1, 1, 2)),
      _tpmsTerm(-0.2, _tpmsTpmsF('cos(x)', 2, 1, 1), _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(-0.2, _tpmsTpmsF('cos(y)', 1, 2, 1), _tpmsTpmsF('cos(z)', 1, 1, 2)),
      _tpmsTerm(-0.2, _tpmsTpmsF('cos(z)', 1, 1, 2), _tpmsTpmsF('cos(x)', 2, 1, 1)),
      _tpmsTerm(-0.4, _tpmsTpmsF('cos(x)', 2, 1, 1)),
      _tpmsTerm(-0.4, _tpmsTpmsF('cos(y)', 1, 2, 1)),
      _tpmsTerm(-0.4, _tpmsTpmsF('cos(z)', 1, 1, 2))
    ]
  }
};
/* ==== /F13LD-GEOM-TPMS-PRESETS ==== */


/* ==== F13LD-GEOM-TPMS v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ============================================================
   resolveRawPreset — TPMS preset names → term arrays.
   Sweep ships these four; lab inherits the same set so any
   recipe with a `surface.preset` name resolves identically.
   ============================================================ */
function resolveRawPreset(preset) {
  var mk = function (factors, coef) { return { on: true, coef: coef, factors: factors }; };
  var f  = function (trig, fx, fy, fz) {
    return { trig: trig, fx: (fx == null ? 1 : fx), fy: (fy == null ? 1 : fy), fz: (fz == null ? 1 : fz) };
  };
  switch (preset) {
    case 'fks':       // Fischer-Koch S
      return [
        mk([f('cos(x)',2,1,1), f('sin(y)'), f('cos(z)')], 1),
        mk([f('cos(y)',1,2,1), f('sin(z)'), f('cos(x)')], 1),
        mk([f('cos(z)',1,1,2), f('sin(x)'), f('cos(y)')], 1)
      ];
    case 'lidinoid':
      return [
        mk([f('sin(x)',2,1,1), f('cos(y)'), f('sin(z)')],  1.1),
        mk([f('sin(y)',1,2,1), f('cos(z)'), f('sin(x)')],  1.1),
        mk([f('sin(z)',1,1,2), f('cos(x)'), f('sin(y)')],  1.1),
        mk([f('cos(x)',2,1,1), f('cos(y)',1,2,1)],         -0.2),
        mk([f('cos(y)',1,2,1), f('cos(z)',1,1,2)],         -0.2),
        mk([f('cos(z)',1,1,2), f('cos(x)',2,1,1)],         -0.2),
        mk([f('cos(x)',2,1,1)],                            -0.4),
        mk([f('cos(y)',1,2,1)],                            -0.4),
        mk([f('cos(z)',1,1,2)],                            -0.4)
      ];
    case 'splitP':
      return [
        mk([f('sin(x)'), f('sin(y)'), f('cos(z)')], 1),
        mk([f('sin(y)'), f('sin(z)'), f('cos(x)')], 1),
        mk([f('sin(z)'), f('sin(x)'), f('cos(y)')], 1)
      ];
    case 'frd':
      return [
        mk([f('sin(x)',2,1,1), f('cos(y)'), f('sin(z)')],  1),
        mk([f('sin(y)',1,2,1), f('cos(z)'), f('sin(x)')],  1),
        mk([f('sin(z)',1,1,2), f('cos(x)'), f('sin(y)')],  1),
        mk([f('cos(x)',2,1,1), f('cos(y)',1,2,1)],         -1),
        mk([f('cos(y)',1,2,1), f('cos(z)',1,1,2)],         -1),
        mk([f('cos(z)',1,1,2), f('cos(x)',2,1,1)],         -1)
      ];
    default:
      return null;
  }
}

/* ============================================================
   evaluateTpms — TPMS field at a point.
   Verbatim port. Per-term phase shift handled by adding ps to
   each axis before applying the term's trig factors.
   ============================================================ */
function evaluateTpms(terms, x, y, z) {
  var result = 0;
  for (var i = 0; i < terms.length; i++) {
    var term = terms[i];
    if (!term.on) continue;
    var ps = term.phase_shift || { x: 0, y: 0, z: 0 };
    var xs = x + ps.x, ys = y + ps.y, zs = z + ps.z;
    var product = term.coef;
    for (var fi = 0; fi < term.factors.length; fi++) {
      var fac = term.factors[fi];
      var trig = fac.trig;
      if      (trig === 'sin(x)') product *= Math.sin(fac.fx * xs);
      else if (trig === 'cos(x)') product *= Math.cos(fac.fx * xs);
      else if (trig === 'sin(y)') product *= Math.sin(fac.fy * ys);
      else if (trig === 'cos(y)') product *= Math.cos(fac.fy * ys);
      else if (trig === 'sin(z)') product *= Math.sin(fac.fz * zs);
      else if (trig === 'cos(z)') product *= Math.cos(fac.fz * zs);
    }
    result += product;
  }
  return result;
}


/* ════════════════════════════════════════════════════════════
   TpmsKernel
   ════════════════════════════════════════════════════════════ */
var TpmsKernel = {
  family: 'tpms',

  parseRecipe: function (recipe) {
    var terms;
    var s = recipe.surface || {};
    if (s.type === 'raw_preset' || !s.terms) {
      var preset = s.preset || (recipe.meta && recipe.meta.preset);
      terms = resolveRawPreset(preset);
      if (!terms) throw new Error('TpmsKernel: raw preset "' + preset + '" could not be resolved');
    } else {
      terms = s.terms;
    }
    /* Normalization flags (mesh shell_normalize / pi_normalize).
       Per the alignment session: a recipe now carries these in its
       geometry block.  When ABSENT (older recipe), default to OFF —
       no normalization — and respect an explicit true/false otherwise.
       buildVoxels reads these off params (no call-site signature change). */
    var g = recipe.geometry || {};
    return {
      terms:     terms,
      shellNorm: (g.shell_normalize !== undefined) ? !!g.shell_normalize : false,
      piNorm:    (g.pi_normalize    !== undefined) ? !!g.pi_normalize    : false,
      pair:      tpmsResolvePair(recipe, terms),
      /* v0.26.0 — per-axis cell scale [x,y,z] (null = cubic).  Only the
         anisotropic shell wall reads it (shellWeightFactor, 14-rasterizer.js):
         F13LD.mesh takes that wall's surface normal in world space. */
      cellScale: Array.isArray(g.cellScale) ? g.cellScale : null
    };
  },

  evaluate: function (params, x, y, z) {
    return evaluateTpms(params.terms, x, y, z);
  }
};


/* ════════════════════════════════════════════════════════════
   Field-pair PI-TPMS (v0.13.0 — F13LD.tpms v1.1.0 / F13LD.mesh v0.7.1)

   PI-TPMS pipes trace where field A and field B cross.  Classic PI-TPMS
   uses B = A shifted by δ.  Field-pair recipes add:
     surface_b                independent field B (null/absent → B is A)
     geometry.fieldBFreq      whole-number frequency multiple of A
       (field_b_freq)         (keeps one A cell periodic)
     geometry.fieldBScale     amplitude match rms(A)/rms(B)
       (field_b_scale)        (recomputed on the TPMS/mesh 16³ grid if absent)
   As used:  φB_eff(p) = amp · φB(k·p + δ).

   pair is null for a plain self-pair (no surface_b, k = 1), so every
   existing recipe takes exactly the old code path.

   Constants: lab moves a raw preset's additive constant into
   geometry.offset (solid where F < offset).  In pi-tpms mode that offset
   therefore holds field A's constant; field B carries its own constant
   inside its terms (60-add-design.js appends it as a zero-factor term).
   ════════════════════════════════════════════════════════════ */
function tpmsFieldRMS(fn) {
  var M = 16, H = Math.PI, st = 2 * H / M, acc = 0;
  for (var i = 0; i < M; i++) { var x = -H + (i + 0.5) * st;
    for (var j = 0; j < M; j++) { var y = -H + (j + 0.5) * st;
      for (var k = 0; k < M; k++) { var z = -H + (k + 0.5) * st; var v = fn(x, y, z); acc += v * v; } } }
  return Math.sqrt(acc / (M * M * M));
}

/* Preset key → terms, with any additive constant appended as a zero-factor
   term (evaluateTpms returns coef for a term with no factors). */
function tpmsPresetTermsWithConstant(preset) {
  if (typeof TPMS_RAW_PRESET_TABLE !== 'undefined' && TPMS_RAW_PRESET_TABLE[preset]) {
    var e = TPMS_RAW_PRESET_TABLE[preset];
    var t = JSON.parse(JSON.stringify(e.terms));
    if (e.constant) t.push({ on: true, coef: e.constant, factors: [] });
    return t;
  }
  return resolveRawPreset(preset);
}

function tpmsResolvePair(recipe, termsA) {
  var g = recipe.geometry || {};
  if ((g.mode || 'solid') !== 'pi-tpms') return null;
  var sB = recipe.surface_b || null;
  var kRaw = g.fieldBFreq != null ? g.fieldBFreq : g.field_b_freq;
  var k = Math.max(1, Math.round(+kRaw || 1));
  if (!sB && k === 1) return null;                       /* classic self-pair */
  var offA = g.offset != null ? g.offset : 0;            /* field A's constant (negated) */
  var termsB, offB;
  if (!sB) { termsB = termsA; offB = offA; }             /* A at k× frequency */
  else {
    termsB = (sB.type === 'raw_preset' || !sB.terms) ? tpmsPresetTermsWithConstant(sB.preset) : sB.terms;
    if (!termsB) throw new Error('TpmsKernel: field B preset "' + sB.preset + '" could not be resolved');
    offB = 0;
  }
  var scl = g.fieldBScale != null ? g.fieldBScale : g.field_b_scale;
  var amp = 1;
  if (typeof scl === 'number' && isFinite(scl) && scl > 0) amp = scl;
  else if (sB) {
    var ra = tpmsFieldRMS(function (x, y, z) { return evaluateTpms(termsA, x, y, z) - offA; });
    var rb = tpmsFieldRMS(function (x, y, z) { return evaluateTpms(termsB, x, y, z) - offB; });
    if (ra > 1e-9 && rb > 1e-9) amp = ra / rb;
  }
  return { terms: termsB, offset: offB, k: k, amp: amp };
}

/* Field B for a pair at point p, shifted by δ = (dx,dy,dz) radians in B's
   own coordinates.  Constant (offset) already applied. */
function tpmsPairB(pair, x, y, z, dx, dy, dz) {
  return pair.amp * (evaluateTpms(pair.terms, pair.k * x + dx, pair.k * y + dy, pair.k * z + dz) - pair.offset);
}
/* ==== /F13LD-GEOM-TPMS ==== */
