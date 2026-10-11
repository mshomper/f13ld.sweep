/* ============================================================
   F13LD.sweep · 84-points-gl.js   (v0.29.3)
   WebGL point renderer for the 3D design space, adapted from F13LD.vault's
   30-points-gl.js so both tools' design spaces look and move alike.
   Every design is one point; three passes draw it:
     dim   — the auto-target trail (lit = 0): small, faint, grey
     glow  — additive halo in the colour of the design
     core  — a round disc, depth-faded
   Camera maths (yaw, pitch, light perspective) match 85-scatter-plot.js's
   plotProject() exactly, so picking and the overlay line up with the points.
   Top-level code only defines things (loads after the sweep code).
   ============================================================ */

var SWPT_FLOATS = 9;   /* pos3 · col3 · size · alpha · lit */

var SWPT_VS = [
  'attribute vec3 aPos;attribute vec3 aCol;attribute float aSize;attribute float aAlpha;attribute float aM;',
  'uniform vec2 uRes;uniform float uDpr;uniform vec3 uC;uniform float uYaw;uniform float uPitch;uniform float uS0;uniform float uDst;uniform vec2 uCxy;',
  'uniform mediump float uPass;',
  'varying vec3 vCol;varying float vA;varying float vDepth;',
  'void main(){',
  '  bool want=(uPass<0.5)?(aM<0.5):(aM>0.5);',
  '  if(!want){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=1.0;return;}',
  '  vec3 p=aPos-uC;float cy=cos(uYaw),sy=sin(-uYaw),cp=cos(uPitch),sq=sin(-uPitch);',
  '  float x1=p.x*cy+p.z*sy;float z1=-p.x*sy+p.z*cy;float y2=p.y*cp-z1*sq;float z2=p.y*sq+z1*cp;',
  '  float pp=uDst/(uDst-z2);vec2 sp=vec2(uCxy.x+x1*uS0*pp,uCxy.y-y2*uS0*pp);',
  '  vec2 ndc=vec2(sp.x/uRes.x*2.0-1.0,1.0-sp.y/uRes.y*2.0);',
  '  gl_Position=vec4(ndc,clamp(-z2*0.2,-0.99,0.99),1.0);',
  '  float s=aSize*sqrt(pp);',
  '  float mul=uPass<0.5?0.8:(uPass<1.5?4.2:1.0);',
  '  gl_PointSize=max(1.0,s*mul*uDpr);',
  '  vCol=aCol;vA=aAlpha;vDepth=clamp((z2+1.7)/3.4,0.0,1.0);',
  '}'].join('\n');
var SWPT_FS = [
  'precision mediump float;',
  'uniform mediump float uPass;uniform mediump float uGlow;varying vec3 vCol;varying float vA;varying float vDepth;',
  'void main(){',
  '  vec2 q=gl_PointCoord*2.0-1.0;float r2=dot(q,q);',
  '  if(uPass<0.5){if(r2>1.0)discard;float a0=vA*(0.55+0.45*vDepth);gl_FragColor=vec4(vec3(0.50,0.53,0.66)*a0,a0);return;}',
  '  if(uPass<1.5){float r=sqrt(r2);if(r>1.0)discard;float g=exp(-r2*5.0)*(1.0-r);float k=g*vA*uGlow;gl_FragColor=vec4(vCol*k,k*0.85);return;}',
  '  if(r2>1.0)discard;',
  '  float edge=1.0-smoothstep(0.72,1.0,r2);',          /* soft rim: no jaggies at small sizes */
  '  float a1=vA*(0.6+0.4*vDepth)*edge;gl_FragColor=vec4(vCol*a1,a1);',
  '}'].join('\n');

function SweepPointLayer(canvas) {
  this.cv = canvas; this.ok = false; this.lost = false; this.data = null; this.n = 0; this.lit = 0;
  var self = this;
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; self.ok = false; });
  canvas.addEventListener('webglcontextrestored', function () { self.lost = false; self.init(); if (typeof drawPlot === 'function') drawPlot(); });
  this.init();
}
SweepPointLayer.prototype.init = function () {
  var gl = null;
  try { gl = this.cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true }); } catch (e) { gl = null; }
  if (!gl) { this.ok = false; return; }
  function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[F13LD.sweep] point shader:', gl.getShaderInfoLog(s)); return null; } return s; }
  var vs = sh(gl.VERTEX_SHADER, SWPT_VS), fs = sh(gl.FRAGMENT_SHADER, SWPT_FS); if (!vs || !fs) return;
  var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[F13LD.sweep] point link:', gl.getProgramInfoLog(p)); return; }
  this.gl = gl; this.prog = p; this.buf = gl.createBuffer();
  this.a = {}; ['aPos', 'aCol', 'aSize', 'aAlpha', 'aM'].forEach(function (n) { this.a[n] = gl.getAttribLocation(p, n); }, this);
  this.u = {}; ['uRes', 'uDpr', 'uC', 'uYaw', 'uPitch', 'uS0', 'uDst', 'uCxy', 'uPass', 'uGlow'].forEach(function (n) { this.u[n] = gl.getUniformLocation(p, n); }, this);
  this.ok = true;
};
/* items: [{ p:[x,y,z] in the [-1,1] cube, c:[r,g,b] 0–1, s: size px, a: alpha, lit: bool }] */
SweepPointLayer.prototype.fill = function (items) {
  var N = items.length;
  if (!this.data || this.data.length < N * SWPT_FLOATS) this.data = new Float32Array(Math.max(64, N) * SWPT_FLOATS);
  var a = this.data, lit = 0;
  for (var i = 0; i < N; i++) {
    var it = items[i], o = i * SWPT_FLOATS;
    a[o] = it.p[0]; a[o + 1] = it.p[1]; a[o + 2] = it.p[2];
    a[o + 3] = it.c[0]; a[o + 4] = it.c[1]; a[o + 5] = it.c[2];
    a[o + 6] = it.s; a[o + 7] = it.a; a[o + 8] = it.lit ? 1 : 0;
    if (it.lit) lit++;
  }
  this.n = N; this.lit = lit;
};
SweepPointLayer.prototype.clear = function () {
  if (!this.ok || this.lost) return;
  var gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
};
/* U: { dpr, c, yaw, pitch, S0, dst, cx, cy } (CSS pixels) */
SweepPointLayer.prototype.draw = function (U) {
  if (!this.ok || this.lost) return;
  var gl = this.gl, cv = this.cv, dpr = U.dpr;
  var W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!this.n) return;
  gl.useProgram(this.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
  gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * SWPT_FLOATS), gl.DYNAMIC_DRAW);
  var st = SWPT_FLOATS * 4, a = this.a;
  gl.enableVertexAttribArray(a.aPos); gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(a.aCol); gl.vertexAttribPointer(a.aCol, 3, gl.FLOAT, false, st, 12);
  gl.enableVertexAttribArray(a.aSize); gl.vertexAttribPointer(a.aSize, 1, gl.FLOAT, false, st, 24);
  gl.enableVertexAttribArray(a.aAlpha); gl.vertexAttribPointer(a.aAlpha, 1, gl.FLOAT, false, st, 28);
  gl.enableVertexAttribArray(a.aM); gl.vertexAttribPointer(a.aM, 1, gl.FLOAT, false, st, 32);
  var u = this.u;
  gl.uniform2f(u.uRes, cv.clientWidth, cv.clientHeight); gl.uniform1f(u.uDpr, dpr);
  gl.uniform3f(u.uC, U.c[0], U.c[1], U.c[2]); gl.uniform1f(u.uYaw, U.yaw); gl.uniform1f(u.uPitch, U.pitch);
  gl.uniform1f(u.uS0, U.S0); gl.uniform1f(u.uDst, U.dst); gl.uniform2f(u.uCxy, U.cx, U.cy);
  /* glow strength falls with point density, so a crowded cloud keeps its colours instead of burning to white (as Vault) */
  var area = Math.pow(2.4 * U.S0, 2), lit = Math.max(1, this.lit);
  gl.uniform1f(u.uGlow, Math.min(0.85, Math.max(0.3, area / (lit * 361) * 0.9)));
  gl.enable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  /* premultiplied output throughout: "over" for dim and core, additive light for the glow */
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uPass, 0); gl.drawArrays(gl.POINTS, 0, this.n);
  gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(u.uPass, 1); gl.drawArrays(gl.POINTS, 0, this.n);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.uniform1f(u.uPass, 2); gl.drawArrays(gl.POINTS, 0, this.n);
  gl.disable(gl.DEPTH_TEST);
};
