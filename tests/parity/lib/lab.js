// F13LD.lab side: its own import path, loaded into a separate vm context.
//   d = normalizeDesignJson(json) → KERNELS[f].parseRecipe(d.recipe) → resolveBuildArgs → buildVoxels
'use strict';
const { DIRS, context, load, run, elStub, toBits } = require('./env');

const FILES = ['13-kernels.js', '13b-kernels-new.js', '14-rasterizer.js', '60-add-design.js'];
const ctx = load(context({
  document: { getElementById: elStub, createElement: elStub, querySelector: () => null, querySelectorAll: () => [],
    body: elStub(), addEventListener() {} },
  window: { location: { hash: '', search: '' }, addEventListener() {} },
  LAB_STATE: { designs: [] },
}), DIRS.lab, FILES);
run(ctx, `
  function __labVoxels(s, N) {
    var d = normalizeDesignJson(JSON.parse(s), 'parity.json');
    if (!d.recipe) return { error: d.recipeNote || 'no lab recipe' };
    var r = d.recipe, p = KERNELS[r.family].parseRecipe(r), a = resolveBuildArgs(r);
    return { mask: buildVoxels(r.family, p, a.offset, N, a.mode, a.wt, a.nWeights, a.pipeR, a.phaseShift), mode: a.mode };
  }
`);

module.exports = {
  ctx,
  voxels(json, N) {
    try {
      const r = ctx.__labVoxels(JSON.stringify(json), N);
      if (r.error) return { error: r.error };
      return { mask: toBits(r.mask), mode: r.mode };
    } catch (e) { return { error: String(e && e.message || e) }; }
  },
};
