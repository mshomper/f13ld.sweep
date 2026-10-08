/* ============================================================
   F13LD.sweep · 81-preview-gl.js
   WebGL2 preview: one program, a baked field texture per design.

   showPreview(design) asks a dedicated worker (the solver worker file,
   message 'bake') for the design's margin field at PREVIEW_N³, caches
   the last few, uploads the texture and keeps the tumbling render loop
   going. Hovering the same row again does nothing; hovering fast only
   bakes the row the pointer settles on.
   ============================================================ */

const previewCanvas = document.getElementById('previewCanvas');
const gl = previewCanvas.getContext('webgl2');
const f13View = f13ViewInit({ tool: 'sweep', host: previewCanvas.parentElement, canvas: previewCanvas, css: 'top:8px;left:8px' });
const PREVIEW_N = 48;
let previewProg = null, previewQuadBuf = null, previewTex = null, previewU = null;
let previewRot = [1,0,0,0,1,0,0,0,1];
let previewAnimId = null;
let previewActive = false;
let previewShown = null;          /* { key, half, lip, color } of the uploaded field */
let previewWanted = null;         /* key of the design the user is looking at */
let previewWantedMeta = null;     /* { key, half } — its cell aspect */
let previewWorker = null;
const previewCache = new Map();   /* key → baked field (most recent last) */

function mat3Mul(A,B){const r=new Array(9);for(let c=0;c<3;c++)for(let row=0;row<3;row++)r[c*3+row]=A[0*3+row]*B[c*3+0]+A[1*3+row]*B[c*3+1]+A[2*3+row]*B[c*3+2];return r;}
function rotAxisAngle(ax,ay,az,angle){const c=Math.cos(angle),s=Math.sin(angle),t2=1-c;const l=Math.sqrt(ax*ax+ay*ay+az*az)||1;ax/=l;ay/=l;az/=l;return[t2*ax*ax+c,t2*ax*ay+s*az,t2*ax*az-s*ay,t2*ax*ay-s*az,t2*ay*ay+c,t2*ay*az+s*ax,t2*ax*az+s*ay,t2*ay*az-s*ax,t2*az*az+c];}
// Isometric view: 45° around Y, then 35.26° tilt
previewRot = mat3Mul(rotAxisAngle(0,1,0, Math.PI/4), rotAxisAngle(1,0,0, Math.atan(1/Math.sqrt(2))));

function previewInitGL() {
  if (!gl || previewProg) return !!previewProg;
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[preview] shader:', gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; }
    return s;
  };
  const vs = mk(gl.VERTEX_SHADER, PREVIEW_VERT), fs = mk(gl.FRAGMENT_SHADER, PREVIEW_FRAG);
  if (!vs || !fs) return false;
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[preview] link:', gl.getProgramInfoLog(p)); gl.deleteProgram(p); return false; }
  previewProg = p;
  gl.useProgram(p);
  previewQuadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, previewQuadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  previewU = {};
  ['res', 'rot', 'zoom', 'uField', 'uLip', 'uHalf', 'uColor', 'uStep'].forEach(n => { previewU[n] = gl.getUniformLocation(p, n); });
  previewTex = gl.createTexture();
  return true;
}

function previewGetWorker() {
  if (previewWorker) return previewWorker;
  previewWorker = new Worker(SWEEP_WORKER_URL);
  previewWorker.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'baked') {
      previewCache.set(m.key, { N: m.N, data: m.data, lip: m.lip, family: m.family });
      while (previewCache.size > 24) previewCache.delete(previewCache.keys().next().value);
      if (m.key === previewWanted) previewUpload(m.key);
    } else if (m.type === 'bake_error') {
      console.warn('[preview] bake failed:', m.message);
      if (m.key === previewWanted) log('warn', `Preview failed: ${escapeLog(m.message)}`);
    }
  });
  previewWorker.addEventListener('error', e => console.error('[preview] worker error:', e.message));
  return previewWorker;
}

function previewUpload(key) {
  const b = previewCache.get(key);
  if (!b || !previewInitGL()) return;
  const want = previewWantedMeta;
  gl.useProgram(previewProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, previewTex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, b.N, b.N, b.N, 0, gl.RED, gl.FLOAT, b.data);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  /* TPMS and beam cells are periodic: interpolate across the faces. */
  const wrap = (b.family === 'tpms' || b.family === 'beam') ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, wrap);
  const half = want && want.key === key ? want.half : [1, 1, 1];
  const minHalf = Math.min(half[0], half[1], half[2]);
  previewShown = { key, half, lip: b.lip / minHalf, color: PREVIEW_FAMILY_COLOR[b.family] || PREVIEW_FAMILY_COLOR.tpms, step: 2 * minHalf / b.N };
  previewActive = true;
  previewCanvas.classList.add('visible');
  document.getElementById('previewEmpty').classList.add('hidden');
  if (previewAnimId) cancelAnimationFrame(previewAnimId);
  renderPreviewFrame();
}

function resizePreview() {
  const rect = previewCanvas.parentElement.getBoundingClientRect();
  previewCanvas.width = rect.width;
  previewCanvas.height = rect.height || 220;
  if (gl) gl.viewport(0, 0, previewCanvas.width, previewCanvas.height);
}

function renderPreviewFrame() {
  if (!gl || !previewProg || !previewActive || !previewShown) return;
  const wy = 0.003, wx = wy / 1.6180339887;   /* golden-ratio tumble, never repeats */
  previewRot = mat3Mul(rotAxisAngle(0,1,0, wy), previewRot);
  previewRot = mat3Mul(rotAxisAngle(1,0,0, wx), previewRot);
  gl.useProgram(previewProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, previewTex);
  const s = previewShown;
  gl.uniform2f(previewU.res, previewCanvas.width, previewCanvas.height);
  gl.uniformMatrix3fv(previewU.rot, false, previewRot);
  gl.uniform1f(previewU.zoom, 5.1);
  gl.uniform1i(previewU.uField, 0);
  gl.uniform1f(previewU.uLip, s.lip);
  gl.uniform3f(previewU.uHalf, s.half[0], s.half[1], s.half[2]);
  gl.uniform3f(previewU.uColor, s.color[0], s.color[1], s.color[2]);
  gl.uniform1f(previewU.uStep, s.step);
  if (f13View) f13View.apply(gl, previewProg);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  previewAnimId = requestAnimationFrame(renderPreviewFrame);
}


function showPreview(design) {
  if (!design || !design.recipe) return;
  const info = document.getElementById('previewInfo');
  const aniso = design.anisotropy;
  const anisoStr = (typeof aniso === 'number' && isFinite(aniso)) ? aniso.toFixed(2) : '—';
  const fam = design.family || baseFamily;
  const scaleStr = (SWEEP_FAMILIES[fam] && SWEEP_FAMILIES[fam].usesCellScale) ? `Sx ${+(+design.scaleX).toFixed(3)} · Sy ${+(+design.scaleY).toFixed(3)} · Sz ${+(+design.scaleZ).toFixed(3)} · ` : '';
  info.textContent = `${scaleStr}aniso ${anisoStr}×`;
  info.classList.add('visible');
  document.getElementById('previewBadge').textContent = design.id === 'base' ? 'loaded recipe' : `design #${design.id}`;
  if (!gl) {
    document.getElementById('previewEmpty').textContent = 'Preview needs WebGL2';
    return;
  }
  resizePreview();
  const key = JSON.stringify(design.recipe);
  if (previewShown && previewShown.key === key) return;
  previewWanted = key;
  previewWantedMeta = { key, half: recipeCellAspect(design.recipe, fam) };
  if (previewCache.has(key)) { previewUpload(key); return; }
  previewGetWorker().postMessage({ type: 'bake', key, recipe: design.recipe, N: PREVIEW_N });
}

/* Hover a row → preview it (after the pointer settles for a moment). */
let previewHoverT = 0;
const previewRowHandler = e => {
  const row = e.target.closest('tr');
  if (!row || !row.dataset.designId) return;
  const id = parseInt(row.dataset.designId);
  clearTimeout(previewHoverT);
  previewHoverT = setTimeout(() => {
    const design = currentFiltered.find(d => d.id === id);
    if (design) showPreview(design);
  }, 80);
};
document.getElementById('tableWrap').addEventListener('mouseover', previewRowHandler);
document.getElementById('tableWrap').addEventListener('focusin', previewRowHandler);   /* keyboard */
