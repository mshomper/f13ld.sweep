/* ============================================================
   F13LD.sweep · geom/wave.js
   Wave field: cymatic standing-wave modes under five symmetries (F13LD.wave / F13LD.mesh).

   Shared with F13LD.lab: the F13LD-GEOM blocks below are copied
   byte-for-byte from F13LD.lab (13b-kernels-new.js).
   Never edit them here — change F13LD.lab, then run
     node tests/parity/geomsync.js <F13LD.lab> --write
   ============================================================ */

/* ==== F13LD-GEOM-WAVE v1 · shared geometry (Lab ↔ Sweep). Keep byte-identical; check with f13ld.sweep tests/parity/geomsync.js ==== */
/* ════════════════════════════════════════════════════════════
   WaveKernel — cymatic standing-wave field (F13LD.wave)
   Sum of cosine modes under one of five symmetry operators.
   Transcribed verbatim from mesh buildWaveSDF / f13ldWaveEvalRaw.
   ════════════════════════════════════════════════════════════ */
var WaveKernel = {
  family: 'wave',

  /* symmetry name → operator id (mesh SYM table) */
  _SYM: { pure: 0, anti: 1, antisym: 1, chladni: 1, cubic: 2, chiral: 3, schoen: 4 },

  parseRecipe: function (recipe) {
    var f = recipe.field || {};
    var sym = (typeof f.symmetryId === 'number') ? f.symmetryId
            : (typeof f.symmetry === 'string' ? (this._SYM[f.symmetry.toLowerCase()] != null
                                                  ? this._SYM[f.symmetry.toLowerCase()] : 0) : 0);
    var params = {
      modes:     Array.isArray(f.modes) ? f.modes : [],
      sym:       sym,
      iso:       (typeof f.iso === 'number') ? f.iso : 0,
      sheet:     (f.mode === 'sheet'),
      thickness: (typeof f.thickness === 'number') ? f.thickness : 0.2,
      signFlip:  !!f.signFlip,
      t:         (typeof f.phaseTime === 'number') ? f.phaseTime : 0
    };
    if (!recipe.family) recipe.family = 'wave';
    return params;
  },

  /* Raw mode sum at q (== Lab solver coord, since q = world·π/5 and
     world = solver·5/π cancel).  Verbatim mesh evalRaw. */
  _evalRaw: function (p, qx, qy, qz) {
    var modes = p.modes, sym = p.sym, t = p.t, acc = 0;
    for (var i = 0; i < modes.length; i++) {
      var mm = modes[i];
      var n = mm.n, m = mm.m, pp = mm.p, A = (mm.A != null ? mm.A : 1);
      var cphi = Math.cos((mm.phi || 0) + t);
      var cnX = Math.cos(n * qx), cmX = Math.cos(m * qx), cpX = Math.cos(pp * qx);
      var cnY = Math.cos(n * qy), cmY = Math.cos(m * qy), cpY = Math.cos(pp * qy);
      var cnZ = Math.cos(n * qz), cmZ = Math.cos(m * qz), cpZ = Math.cos(pp * qz);
      var v;
      if (sym === 1)      { v = cnX*cmY*cpZ + cnY*cmZ*cpX + cnZ*cmX*cpY - cnY*cmX*cpZ - cnX*cmZ*cpY - cnZ*cmY*cpX; }
      else if (sym === 2) { v = cnX*cmY*cpZ + cnY*cmZ*cpX + cnZ*cmX*cpY + cnY*cmX*cpZ + cnX*cmZ*cpY + cnZ*cmY*cpX; }
      else if (sym === 3) { v = cnX*cmY*cpZ + cnY*cmZ*cpX + cnZ*cmX*cpY; }
      else if (sym === 4) { var snX = Math.sin(n*qx), snY = Math.sin(n*qy), snZ = Math.sin(n*qz);
                            v = snX*cmY*cpZ + snY*cmZ*cpX + snZ*cmX*cpY; }
      else                { v = cnX*cmY*cpZ; }
      acc += A * v * cphi;
    }
    return acc;
  },

  /* NEGATIVE-INSIDE SDF in solver space. mesh worldScale (π/5) and
     Lab solver→world (5/π) cancel, so q = solver coord directly. */
  evaluate: function (params, x, y, z) {
    var fr = this._evalRaw(params, x, y, z);
    var cym = params.sheet ? (Math.abs(params.iso - fr) - params.thickness)
                           : (params.iso - fr);
    return params.signFlip ? -cym : cym;
  }
};
/* ==== /F13LD-GEOM-WAVE ==== */
