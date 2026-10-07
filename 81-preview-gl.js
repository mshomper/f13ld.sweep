/* ============================================================
   F13LD.sweep · 81-preview-gl.js
   WebGL preview: canvas, shader compile, render loop, showPreview, row hover.
   ============================================================ */

// ─── WebGL Preview Renderer ───────────────────────────────────────────────────
// Migrated to WebGL2 (GLSL ES 3.00) to match the rest of the F13LD tool suite.
// Falls back to WebGL1 with GLSL 1.00 syntax if WebGL2 unavailable.
const previewCanvas = document.getElementById('previewCanvas');
const gl = previewCanvas.getContext('webgl2') || previewCanvas.getContext('webgl');
const isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined') && (gl instanceof WebGL2RenderingContext);
let previewProg = null, previewQuadBuf = null;
const f13View = f13ViewInit({ tool: 'sweep', host: previewCanvas.parentElement, canvas: previewCanvas, css: 'top:8px;left:8px' });
let previewRot = [1,0,0,0,1,0,0,0,1];
let previewAnimId = null;
let previewActive = false;
let previewCellScale = 1.0;

// Init rotation to a nice angle
function mat3Mul(A,B){const r=new Array(9);for(let c=0;c<3;c++)for(let row=0;row<3;row++)r[c*3+row]=A[0*3+row]*B[c*3+0]+A[1*3+row]*B[c*3+1]+A[2*3+row]*B[c*3+2];return r;}
function rotAxisAngle(ax,ay,az,angle){const c=Math.cos(angle),s=Math.sin(angle),t2=1-c;const l=Math.sqrt(ax*ax+ay*ay+az*az)||1;ax/=l;ay/=l;az/=l;return[t2*ax*ax+c,t2*ax*ay+s*az,t2*ax*az-s*ay,t2*ax*ay-s*az,t2*ay*ay+c,t2*ay*az+s*ax,t2*ax*az+s*ay,t2*ay*az-s*ax,t2*az*az+c];}
// Isometric view: 45° around Y, then 35.26° tilt (true isometric angles)
previewRot = mat3Mul(rotAxisAngle(0,1,0, Math.PI/4), rotAxisAngle(1,0,0, Math.atan(1/Math.sqrt(2))));

function mkShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}

const VERT = isWebGL2
  ? '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'
  : 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

// Module-scope state for the field-bake texture (P2c). Created lazily on first
// grain preview, reused across designs (one allocation, repeated texImage3D
// re-uploads). Cleared when previewProg is rebuilt for a non-grain family.
let fieldTexture = null;

function buildPreviewShader(family, params, offset, cellScale, mode, wallThickness, pipeR, phaseShift, piNorm, shellNorm) {
  if (!gl) return;

  // P2c: grain previews require WebGL2 (sampler3D). Surface a clear message
  // on WebGL1 rather than silently failing to compile.
  if (family === 'grain' && !isWebGL2) {
    console.warn('[F13LD.sweep] Grain previews require WebGL2 (sampler3D unavailable on WebGL1). Preview disabled for this design.');
    if (previewProg) { gl.deleteProgram(previewProg); previewProg = null; }
    return;
  }

  // buildFrag now returns { frag, bakedField, beamData } — sidecars are
  // family-specific GPU-state uploads. Currently:
  //   bakedField → grain (R8 sampler3D)
  //   beamData   → beam (vec3 uniform arrays)
  // Both can be null; the if-blocks below skip the upload cleanly.
  const built = buildFrag(family, params, mode || 'solid', offset, wallThickness || 0.3, cellScale, pipeR, phaseShift, piNorm, shellNorm);
  const frag = built.frag;
  const bakedField = built.bakedField;
  const beamData = built.beamData;

  const p = gl.createProgram();
  gl.attachShader(p, mkShader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return; }
  if (previewProg) gl.deleteProgram(previewProg);
  previewProg = p;
  gl.useProgram(previewProg);
  if (!previewQuadBuf) {
    previewQuadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, previewQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, previewQuadBuf);
  }
  const loc = gl.getAttribLocation(previewProg, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // P2c: upload baked field texture for kernels that need it.
  // Texture matches F13LD.grain's R8 convention — 8-bit quantized, 256
  // levels across [fieldMin, fieldMax]. The shader recovers raw via
  // raw = byte/255 * (max-min) + min, then normalizes to [-1,1] using
  // mid/halfRange so iso/halfWidth from the recipe land in the same scale
  // F13LD.grain calibrated them in.
  if (bakedField) {
    if (!fieldTexture) fieldTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, fieldTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.R8,
      bakedField.N, bakedField.N, bakedField.N,
      0, gl.RED, gl.UNSIGNED_BYTE, bakedField.data
    );
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // Bind sampler + recovery uniforms. Sampler is on texture unit 0.
    // P2e: uFieldMid / uFieldHalfRange dropped — the shader returns raw
    // values directly, no normalization.
    const uField    = gl.getUniformLocation(previewProg, 'uField');
    const uMin      = gl.getUniformLocation(previewProg, 'uFieldMin');
    const uMax      = gl.getUniformLocation(previewProg, 'uFieldMax');
    if (uField   !== null) gl.uniform1i(uField, 0);
    if (uMin     !== null) gl.uniform1f(uMin, bakedField.fieldMin);
    if (uMax     !== null) gl.uniform1f(uMax, bakedField.fieldMax);
  }

  // Beam uniform-array upload (Phase 1.2/1.3). Uploaded once per recipe
  // load / per-design selection — the same buffer is reused across
  // animation frames because previewProg + uniforms persist until the next
  // shader rebuild. uniform3fv accepts the flat (count×3) Float32Array
  // directly, no per-element loop. The early-exit `if (i >= uBeamCount)
  // break` in the shader ensures the unused tail of the 256-slot array is
  // never touched, so we don't have to zero it on every recipe.
  //
  // 1.3 simplification: uBeamRMax dropped — the single-cell shader no
  // longer needs the halo branches, so rMax is unused.
  if (beamData) {
    const uA = gl.getUniformLocation(previewProg, 'uBeamA');
    const uB = gl.getUniformLocation(previewProg, 'uBeamB');
    const uR = gl.getUniformLocation(previewProg, 'uBeamR');
    const uN = gl.getUniformLocation(previewProg, 'uBeamCount');
    if (uA !== null) gl.uniform3fv(uA, beamData.beamA);
    if (uB !== null) gl.uniform3fv(uB, beamData.beamB);
    if (uR !== null) gl.uniform1fv(uR, beamData.beamR);
    if (uN !== null) gl.uniform1i(uN, beamData.beamCount);
    // Phase 2: node positions + scalar smoothing/ball uniforms. All four
    // are always uploaded (the shader's branches on uNodeBallR > 0 and
    // uNodeSmoothK > 0 disable them per-fragment when the design has the
    // variable at 0).
    const uNP   = gl.getUniformLocation(previewProg, 'uNodeP');
    const uNC   = gl.getUniformLocation(previewProg, 'uNodeCount');
    const uNSK  = gl.getUniformLocation(previewProg, 'uNodeSmoothK');
    const uNBR  = gl.getUniformLocation(previewProg, 'uNodeBallR');
    if (uNP  !== null && beamData.nodeP) gl.uniform3fv(uNP, beamData.nodeP);
    if (uNC  !== null) gl.uniform1i(uNC, beamData.nodeCount || 0);
    if (uNSK !== null) gl.uniform1f(uNSK, beamData.nodeSmoothK || 0);
    if (uNBR !== null) gl.uniform1f(uNBR, beamData.nodeBallR   || 0);
    // Phase 1.4: wireframe overlay thickness uniform
    const uWR = gl.getUniformLocation(previewProg, 'uWireR');
    if (uWR  !== null) gl.uniform1f(uWR, beamData.wireR || 0.012);
  }
}

function resizePreview() {
  const rect = previewCanvas.parentElement.getBoundingClientRect();
  previewCanvas.width = rect.width;
  previewCanvas.height = rect.height || 220;
  if (gl) gl.viewport(0, 0, previewCanvas.width, previewCanvas.height);
}

function renderPreviewFrame() {
  if (!gl || !previewProg || !previewActive) return;
  // Lissajous tumble: Y and X at irrational ratio so it never repeats
  // Y spins at base speed, X nods at φ⁻¹ × base (golden ratio — maximally non-repeating)
  const wy = 0.003;
  const wx = wy / 1.6180339887; // golden ratio denominator
  previewRot = mat3Mul(rotAxisAngle(0,1,0, wy), previewRot);
  previewRot = mat3Mul(rotAxisAngle(1,0,0, wx), previewRot);
  gl.useProgram(previewProg);
  const uRes = gl.getUniformLocation(previewProg, 'res');
  const uRot = gl.getUniformLocation(previewProg, 'rot');
  const uZoom = gl.getUniformLocation(previewProg, 'zoom');
  gl.uniform2f(uRes, previewCanvas.width, previewCanvas.height);
  gl.uniformMatrix3fv(uRot, false, previewRot);
  gl.uniform1f(uZoom, Math.PI * previewCellScale * 5.1);
  if (f13View) f13View.apply(gl, previewProg);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  previewAnimId = requestAnimationFrame(renderPreviewFrame);
}

function showPreview(design) {
  if (!gl) return;
  resizePreview();
  // Family-aware param reconstitution. design.params is always present in
  // E2+; design.termObjects is TPMS-only legacy (used by the F13LD.mesh
  // export path). Prefer design.params; fall back to building from termObjects
  // for any callsite that pre-dates this change.
  const family = design.family || baseRecipe?.family || 'tpms';
  const params = design.params
    ? design.params
    : { terms: design.termObjects };
  const geom = baseRecipe?.geometry || {};
  // Family-aware mode resolution — must mirror runSweep's logic at line
  // ~4969. Grain recipes use geometry.topology (not geometry.mode) and need
  // a 'grain-' prefix so buildFrag dispatches the field-threshold mode-
  // wrapper instead of falling through to TPMS solid mode.
  //
  // Bug fixed in P2f: previously this site only handled noise, so grain
  // recipes silently fell through to mode='solid' (TPMS interpretation),
  // producing the complement of the recipe's expected solid set in the
  // preview only. The half-mode sign discussion in P2c-P2e was a chase of
  // the wrong bug — the half-mode branch in buildFrag never executed for
  // the preview at all because the mode argument never carried 'grain-half'.
  let mode = (family === 'grain')
    ? (geom.topology || 'sheet')
    : (family === 'beam')
    ? 'beam-solid'
    : (geom.mode || 'solid');
  // Same noise-mode prefix that runSweep applies — keeps applyMode dispatch
  // and buildFrag mode branches in sync. Noise tool exports 'shell' as a
  // synonym for 'sheet' in some legacy paths, so map both to noise-sheet.
  if (family === 'noise') {
    if      (mode === 'sheet' || mode === 'shell') mode = 'noise-sheet';
    else if (mode === 'half')                      mode = 'noise-half';
    else if (mode === 'solid')                     mode = 'noise-solid';
  } else if (family === 'grain') {
    if      (mode === 'sheet')  mode = 'grain-sheet';
    else if (mode === 'half')   mode = 'grain-half';
    else if (mode === 'solid')  mode = 'grain-solid';
  }
  const wallThickness = geom.wall_thickness || 0.3;
  // Per-design first, base recipe as fallback. PI-TPMS sweeps jitter pipe_radius
  // (spec.sweepPipeR) and randomize phase_shift (spec.sweepPhaseShift from
  // EIGHTHS) per design, then store them on the result row (line ~7677). Reading
  // from baseRecipe.geometry instead — as this site did pre-fix — forced every
  // preview to show the same base topology regardless of what the sweep actually
  // computed, which also made the preview disagree with F13LD.mesh (whose export
  // path correctly uses d.pipe_radius / d.phase_shift).
  const pipeR      = (design.pipe_radius != null) ? design.pipe_radius : (geom.pipe_radius || 0.1);
  const phaseShift = design.phase_shift || geom.phase_shift || { x: 0.25, y: 0.25, z: 0 };
  // TPMS field-normalization flags from the recipe geometry. Defaulted at
  // ingest time, so safe to read directly. No-op for non-TPMS families.
  const piNorm    = !!geom.pi_normalize;
  const shellNorm = !!geom.shell_normalize;
  buildPreviewShader(family, params, design.offset, (design.scaleX + design.scaleY + design.scaleZ) / 3, mode, wallThickness, pipeR, phaseShift, piNorm, shellNorm);
  // Camera zoom — driven by previewCellScale, which becomes the cube-size
  // term in the renderer's frustum equation. For TPMS/noise/grain, the
  // cube extent in the shader is proportional to cellMult, so we set
  // previewCellScale = mean cell scale so bigger swept cells frame at
  // consistent visual weight (cell always fills the canvas).
  //
  // For beam (Phase 1.3 single-cell + proportional cube): the cube is
  // sized as `meanScale / beamCubeMaxScale` of one unit cell. To keep
  // the camera framing the SAME bounding box across all designs (so the
  // biggest cell fills the canvas, smaller cells sit inside proportionally),
  // we pin previewCellScale = 1.0 — the camera frames a unit cube, and
  // each design draws its cell inside that cube at its proportional size.
  previewCellScale = (family === 'beam')
    ? 1.0
    : (design.scaleX + design.scaleY + design.scaleZ) / 3;
  previewActive = true;
  if (previewAnimId) cancelAnimationFrame(previewAnimId);
  previewCanvas.classList.add('visible');
  document.getElementById('previewEmpty').classList.add('hidden');
  const info = document.getElementById('previewInfo');
  // E4: defensive type check — anisotropy is a scalar number for TPMS/noise/
  // grain and most sweep results, but beam base recipes pass through the
  // DSM-PBC anisotropy block as an object ({axial_ratio, zener_A, …}).
  // loadFile normalizes it before calling showPreview, but a third-party
  // caller (or a future code path that bypasses loadFile) could re-introduce
  // the bad shape. Guard the toFixed call so a bad value renders as '—'
  // instead of throwing and tripping loadFile's catch with a misleading
  // "Failed to parse JSON" message.
  const aniso = design.anisotropy;
  const anisoStr = (aniso === null || aniso === undefined || typeof aniso !== 'number' || !isFinite(aniso))
    ? '—' : aniso.toFixed(2);
  info.textContent = `Sx ${design.scaleX} · Sy ${design.scaleY} · Sz ${design.scaleZ} · aniso ${anisoStr}×`;
  info.classList.add('visible');
  document.getElementById('previewBadge').textContent = `design #${design.id}`;
  renderPreviewFrame();
}

// Wire hover to table rows — delegated on tableWrap
document.getElementById('tableWrap').addEventListener('mouseover', e => {
  const row = e.target.closest('tr');
  if (!row || !row.dataset.designId) return;
  const id = parseInt(row.dataset.designId);
  const design = currentFiltered.find(d => d.id === id);
  // Accept any design that has either params (E2+ all families) or termObjects
  // (legacy TPMS pre-E2). The original guard was termObjects-only and silently
  // dropped noise rows.
  if (design && (design.params || design.termObjects)) showPreview(design);
});
