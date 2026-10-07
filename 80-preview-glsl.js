/* ============================================================
   F13LD.sweep · 80-preview-glsl.js
   Preview shader source builders (GLSL per family).
   ============================================================ */


function toFloat(v){const s=parseFloat(parseFloat(v).toFixed(6)).toString();return s.includes('.')?s:s+'.0';}

function glslTrig(t,fx,fy,fz){
  if(t==='sin(x)')return'sin('+fx+'*gx)';if(t==='cos(x)')return'cos('+fx+'*gx)';
  if(t==='sin(y)')return'sin('+fy+'*gy)';if(t==='cos(y)')return'cos('+fy+'*gy)';
  if(t==='sin(z)')return'sin('+fz+'*gz)';if(t==='cos(z)')return'cos('+fz+'*gz)';
  return'1.0';
}

// buildFrag — unified SDF renderer supporting solid, shell, and PI-TPMS modes
// mode: 'solid' | 'shell' | 'pi-tpms'
//
// Migrated to match the F13LD.TPMS render schema (F13LD Brand Guidelines v1.0):
//   - GLSL ES 3.00 for WebGL2 (#version 300 es, in/out, fragColor) with WebGL1 fallback
//   - Olive/green palette: vec3(0.55,0.57,0.42) + vec3(0.43,0.42,0.30) — warm desaturated tones
//   - Monochrome warm-dark background gradient
//   - F13LD neon (#c8f542 = vec3(0.784,0.961,0.259)) used for edge highlight and rim/spec accent
//   - Medium-quality ray march (192 steps) — matches TPMS default
function buildFrag(family, params, mode, offsetVal, wallVal, cellMult, pipeR, phaseShift, piNorm, shellNorm) {
  // Field GLSL — supplied by the kernel. Returns { fns, exprFn[, bakedField] }.
  // For TPMS, fns is a single `float fieldEval(vec3 p, float H){...}` and
  // exprFn is 'fieldEval'. The mode wrapper below composes calls to it.
  // Per E1 design note: this is NOT byte-equal to v0.8's evalA/evalB pair —
  // PI-TPMS now phase-shifts by passing a shifted vector to the same fn.
  //
  // bakedField (P2c): if the kernel needs a sampler3D upload (currently only
  // GrainKernel), it returns a {data, N, fieldMin, fieldMax, mid, halfRange}
  // object alongside the GLSL. buildFrag forwards this on the return value
  // so buildPreviewShader can upload it. TPMS/Noise kernels don't return
  // bakedField, so they keep working unchanged.
  const kernel = KERNELS[family || 'tpms'];
  const emitted = kernel.emitGLSLField(params);
  const { fns: fieldFuncs, exprFn } = emitted;

  const isPi = mode === 'pi-tpms';
  const isShell = mode === 'shell';
  const isBeam = mode === 'beam-solid';
  // Beam preview renders EXACTLY ONE unit cell. (See emitGLSLField docstring
  // for why: tiling is F13LD.mesh's job; sweep's preview is "what cell did
  // this design find?" optimized for fast hover across 200+ results.)
  //
  // Phase 1.3 follow-up: the cube extent communicates scale comparison.
  // Each beam design's cube is sized to (mean cell scale) / (max mean
  // scale across the current sweep). Largest design fills the cube;
  // smaller designs leave visible margin proportional to their scale,
  // so the eye can compare cell volumes at a glance. Anisotropy within
  // a single design isn't reflected here (the cube is always isotropic);
  // the scaleX/Y/Z values are still printed in the info text below the
  // preview for users who care about per-axis numbers.
  //
  // Fallback: if beamCubeMaxScale is 0 or undefined (shouldn't happen but
  // defends against future load-order issues), use cellMult directly,
  // which reproduces the previous "always fill the cube" behavior.
  let cubeCellMult;
  if (isBeam) {
    // Phase 1.4: cube extent = ±(cell half-extent + pad). pad is global
    // across the sweep so every design frames identically. The cell
    // boundary itself sits at ±1 in cell-local units (= ±π in solver
    // coords) and gets drawn as a wireframe overlay; geometry living
    // between ±1 and ±(1+pad) is the strut endcap / ball portion that
    // would extend into a neighbor cell if tiled. No clipping.
    const pad = (typeof beamCubePadGlobal === 'number' && beamCubePadGlobal > 0)
      ? beamCubePadGlobal : 0.15;
    cubeCellMult = 1.0 + pad;
  } else {
    cubeCellMult = cellMult;
  }
  const H = toFloat(Math.PI * cubeCellMult);
  const isNoiseSheet = mode === 'noise-sheet';
  const isNoiseHalf  = mode === 'noise-half';
  const isNoiseSolid = mode === 'noise-solid';
  const isNoise = isNoiseSheet || isNoiseHalf || isNoiseSolid;
  const isGrainSheet = mode === 'grain-sheet';
  const isGrainHalf  = mode === 'grain-half';
  const isGrainSolid = mode === 'grain-solid';
  const isGrain = isGrainSheet || isGrainHalf || isGrainSolid;
  // Field-threshold mode flags: noise + grain share identical mode-wrapper
  // math. Both kernels emit a scalar field, then this function applies
  // sheet/half/solid threshold using the recipe's iso/halfWidth. The two
  // families differ only in field scale (noise normalizes inside its
  // evaluate(); grain returns raw values), but iso/hw are stored in the
  // matching scale so the wrapper math is identical.
  const isFieldSheet = isNoiseSheet || isGrainSheet;
  const isFieldHalf  = isNoiseHalf  || isGrainHalf;
  const isFieldSolid = isNoiseSolid || isGrainSolid;
  const isField      = isNoise      || isGrain;

  let implicitExpr, featureSizeVal;

  // GLSL helpers emitted only when a normalize flag is on. Concatenated onto
  // fieldFuncs below so they sit between the kernel-emitted field eval and
  // the `implicit()` wrapper. Mirrors F13LD.tpms shader (tpms 896–924, 942–950).
  let normFuncs = '';

  if (isPi) {
    const TWO_PI = 2 * Math.PI;
    const dxS = toFloat((phaseShift?.x || 0) * TWO_PI);
    const dyS = toFloat((phaseShift?.y || 0) * TWO_PI);
    const dzS = toFloat((phaseShift?.z || 0) * TWO_PI);
    const pipeRS = toFloat(pipeR || 0.1);
    if (piNorm) {
      // Angle-corrected distance to intersection curve {φ_A=0 ∩ φ_B=0}.
      // FD step 0.012; ε-floor 0.08 on |∇φ|; cos α clamped to ±0.95 to bound
      // 1/sin²α ≤ ~10. Match of F13LD.tpms shader piField (tpms 911–924).
      const FE = exprFn;
      normFuncs +=
        'vec3 gradFieldA(vec3 p,float H){float e=0.012;' +
          'float dx=' + FE + '(p+vec3(e,0.0,0.0),H)-' + FE + '(p-vec3(e,0.0,0.0),H);' +
          'float dy=' + FE + '(p+vec3(0.0,e,0.0),H)-' + FE + '(p-vec3(0.0,e,0.0),H);' +
          'float dz=' + FE + '(p+vec3(0.0,0.0,e),H)-' + FE + '(p-vec3(0.0,0.0,e),H);' +
          'return vec3(dx,dy,dz)/(2.0*e);}\n' +
        'vec3 gradFieldB(vec3 p,float H){float e=0.012;' +
          'vec3 sh=vec3(' + dxS + ',' + dyS + ',' + dzS + ');' +
          'float dx=' + FE + '(p+sh+vec3(e,0.0,0.0),H)-' + FE + '(p+sh-vec3(e,0.0,0.0),H);' +
          'float dy=' + FE + '(p+sh+vec3(0.0,e,0.0),H)-' + FE + '(p+sh-vec3(0.0,e,0.0),H);' +
          'float dz=' + FE + '(p+sh+vec3(0.0,0.0,e),H)-' + FE + '(p+sh-vec3(0.0,0.0,e),H);' +
          'return vec3(dx,dy,dz)/(2.0*e);}\n' +
        'float piField(vec3 p,float H){' +
          'vec3 sh=vec3(' + dxS + ',' + dyS + ',' + dzS + ');' +
          'vec3 gA=gradFieldA(p,H);vec3 gB=gradFieldB(p,H);' +
          'float magA=max(length(gA),0.08);float magB=max(length(gB),0.08);' +
          'float dA=' + FE + '(p,H)/magA;float dB=' + FE + '(p+sh,H)/magB;' +
          'float cosA=clamp(dot(gA,gB)/(magA*magB),-0.95,0.95);' +
          'float sin2=1.0-cosA*cosA;' +
          'float num=dA*dA-2.0*cosA*dA*dB+dB*dB;' +
          'return sqrt(max(num,0.0)/sin2);}\n';
      implicitExpr = 'piField(p,H)-' + pipeRS;
    } else {
      // Raw PI: max(|φ_A|, |φ_B|) - pipeR. Single fieldEval — phase shift at call site.
      implicitExpr = 'max(abs(' + exprFn + '(p,H)),abs(' + exprFn + '(p+vec3(' + dxS + ',' + dyS + ',' + dzS + '),H)))-' + pipeRS;
    }
    featureSizeVal = toFloat(pipeR || 0.1);
  } else if (isField) {
    // Noise + grain — fieldEval returns a scalar (noise normalized to
    // roughly [-1,1]; grain in raw scale). isoLevel/halfWidth come from
    // params.* and are stored in the same scale as the emitted field.
    const isoS = toFloat(params.isoLevel || 0);
    const hwS  = toFloat(params.halfWidth || 0.15);
    if (isFieldSheet) {
      implicitExpr = 'abs(' + exprFn + '(p,H)-(' + isoS + '))-' + hwS;
      featureSizeVal = hwS;
    } else if (isFieldSolid) {
      implicitExpr = '(' + hwS + ')-abs(' + exprFn + '(p,H)-(' + isoS + '))';
      featureSizeVal = hwS;
    } else {
      // ── half-mode preview sign convention (P2e — final) ────────────────
      // F13LD.grain's preview shader (line 745) computes adj = raw - iso
      // and returns (halfInvert ? adj : -adj), where SDF<0 means solid.
      // For halfInvert=false: returns -adj, solid where -(raw-iso)<0,
      //   i.e. solid where raw > iso. This matches the voxelizer (line 792).
      // For halfInvert=true:  returns adj, solid where raw < iso.
      //
      // The grain shader's sampleF returns RAW values (not normalized),
      // and our P2e fieldEval likewise returns raw — so iso/halfWidth
      // from the recipe land in the same scale grain calibrated them in.
      //
      // History: P2c had this direction correct but coupled to a spurious
      // normalization; P2d flipped this in a wrong attempt to fix a bug
      // that was actually in the normalization step. P2e drops the
      // normalization (kernel side) and reverts the direction (this site).
      // Pre-flight verified all 4 sample recipes match recipe homog VF.
      const inv = !!params.halfInvert;
      implicitExpr = inv
        ? exprFn + '(p,H)-(' + isoS + ')'        // halfInvert: solid where raw < iso
        : '(' + isoS + ')-' + exprFn + '(p,H)';  // normal:     solid where raw > iso
      // No half-width for half mode — use a feature size derived from cell scale
      featureSizeVal = toFloat(Math.PI * cellMult * 0.1);
    }
  } else if (isBeam) {
    // Beam: fieldEval returns the strut-union SDF in local cell units,
    // positive-outside. Solid where SDF < 0. No offset, no wall thickness.
    //
    // featureSize tuning: the capsule SDF is approximately 1-Lipschitz,
    // so the marcher CAN take large steps in open void. The cube is
    // ±H = ±π in local frame (cubeCellMult=1 for beam — single-cell
    // preview). Default maxStep = featureSize × 0.25 × camScale, and a
    // ray needs to traverse ~2H worst case. We use π × 0.5, giving
    // maxStep ≈ 0.39 × camScale — about 16 steps to cross the cube in
    // pure void, with the SDF-distance multiplier kicking in
    // (clamp(d·0.9, …)) to make most steps even larger. The earlier
    // 0.15 value made the page sluggish even with the fragment-cost
    // optimization to face-only halo, because the marcher was running
    // ~120 steps per ray in void before hitting either a strut or the
    // far box face.
    implicitExpr = exprFn + '(p,H)';
    featureSizeVal = toFloat(Math.PI * cubeCellMult * 0.5);
  } else {
    const offS = toFloat(offsetVal);
    const wallS = toFloat(wallVal);
    if (isShell && shellNorm) {
      // Divide |φ−offset| by |∇φ| → uniform perpendicular wall thickness.
      // Match of F13LD.tpms shader gradMagBase (tpms 942–950). FD step 0.012;
      // ε-floor 0.08.
      const FE = exprFn;
      normFuncs +=
        'float gradMagField(vec3 p,float H){float e=0.012;' +
          'float dx=' + FE + '(p+vec3(e,0.0,0.0),H)-' + FE + '(p-vec3(e,0.0,0.0),H);' +
          'float dy=' + FE + '(p+vec3(0.0,e,0.0),H)-' + FE + '(p-vec3(0.0,e,0.0),H);' +
          'float dz=' + FE + '(p+vec3(0.0,0.0,e),H)-' + FE + '(p-vec3(0.0,0.0,e),H);' +
          'return max(sqrt(dx*dx+dy*dy+dz*dz)/(2.0*e),0.08);}\n';
      implicitExpr = 'abs(' + exprFn + '(p,H)-(' + offS + '))/gradMagField(p,H)-' + wallS;
    } else {
      implicitExpr = isShell
        ? 'abs(' + exprFn + '(p,H)-(' + offS + '))-' + wallS
        : exprFn + '(p,H)-(' + offS + ')';
    }
    featureSizeVal = isShell ? wallS : toFloat(Math.PI * cellMult * 0.25);
  }

  // GLSL version-aware boilerplate — WebGL2 prefers 3.00 ES, WebGL1 falls back to 1.00
  const versionLine = isWebGL2 ? '#version 300 es' : '';
  const fragOutDecl = isWebGL2 ? 'out vec4 fragColor;' : '';
  const fragWrite   = isWebGL2 ? 'fragColor' : 'gl_FragColor';

  const lines_ = [
    versionLine,
    'precision highp float;',
    fragOutDecl,
    'uniform vec2 res;uniform mat3 rot;uniform float zoom;',
    fieldFuncs,
    normFuncs,
    'float implicit(vec3 p,float H){return ' + implicitExpr + ';}',
    // Box SDF — intersection clips geometry to solid cube
    'float boxSDF(vec3 p,float H){vec3 d=abs(p)-H;return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0);}',
    'float sceneSDF(vec3 p,float H){return max(implicit(p,H),boxSDF(p,H));}',
    // Normal FD step scales with featureSize for sharpness across all modes
    'vec3 nrm(vec3 p,float H,float e){return normalize(vec3(sceneSDF(p+vec3(e,0,0),H)-sceneSDF(p-vec3(e,0,0),H),sceneSDF(p+vec3(0,e,0),H)-sceneSDF(p-vec3(0,e,0),H),sceneSDF(p+vec3(0,0,e),H)-sceneSDF(p-vec3(0,0,e),H)));}',
    // Box-face axis-aligned normal — for noise box-face cap rendering when ray
    // exits the cube while inside solid material. Returns the outward normal
    // of whichever box face the point is closest to.
    'vec3 boxNormal(vec3 pos,float H){vec3 ap=abs(pos)/H;if(ap.x>ap.y&&ap.x>ap.z)return vec3(sign(pos.x),0.0,0.0);if(ap.y>ap.z)return vec3(0.0,sign(pos.y),0.0);return vec3(0.0,0.0,sign(pos.z));}',
    // F13LD shared viewer shading. Raw fields overstate distance, so lighting
    // rays step at 0.6× the scene SDF.
    'float f13Map(vec3 p){return 0.6*sceneSDF(p,' + H + ');}',
    F13_SHADE_GLSL,
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-res*0.5)/min(res.x,res.y);',
    '  vec3 ro=rot*vec3(0.0,0.0,zoom);',
    '  vec3 rd=normalize(rot*vec3(uv.x,uv.y,-1.6));',
    '  float H=' + H + ';',
    '  float r=clamp(length(uv)*1.1,0.0,1.0);',
    // Monochrome warm-dark background — matches TPMS / F13LD chrome
    '  vec3 bgCentre=vec3(0.07,0.07,0.07);vec3 bgEdge=vec3(0.03,0.03,0.03);',
    '  vec3 bgCol=mix(bgCentre,bgEdge,r*r);vec4 bg=vec4(bgCol,1.0);',
    // featureSize baked as constant — drives thresh, maxStep, normal e
    '  float featureSize=' + featureSizeVal + ';',
    '  float camScale=clamp(zoom/' + toFloat(Math.PI * cellMult * 5.1) + ',0.15,1.0);',
    '  float thresh=featureSize*0.008*camScale;',
    // maxStep — for TPMS, fixed at featureSize*0.25*camScale (small, safe).
    // For field-threshold modes (noise + grain), the cube can be large
    // (cellMult=3.333 gives H≈10.5) and thin shells (featureSize=halfWidth
    // ~0.03–0.15) make TPMS's tight maxStep run out of marcher budget before
    // crossing the cube. Cap maxStep to H/6.0 (~16% of half-cube) so rays
    // can traverse efficiently. featureSize*0.5 still bounds step from above
    // to avoid stepping over thin shells in the near field.
    (isField
      ? '  float maxStep=min(featureSize*0.5,' + toFloat(Math.PI * cellMult / 6.0) + ');'
      : '  float maxStep=featureSize*0.25*camScale;'),
    '  float nrmE=featureSize*0.06*camScale;',
    // SDF marcher with box entry/exit
    '  vec3 iv=vec3(1.0)/rd;',
    '  vec3 tb=(-vec3(H,H,H)-ro)*iv,tt=(vec3(H,H,H)-ro)*iv;',
    '  vec3 tmi=min(tb,tt),tma=max(tb,tt);',
    '  float tEn=max(max(tmi.x,tmi.y),tmi.z);float tEx=min(min(tma.x,tma.y),tma.z);',
    '  if(tEn>tEx||tEx<0.0){' + fragWrite + '=bg;return;}',
    '  float t=max(tEn,0.001);bool hit=false;bool boxCap=false;',
    // March iter count: 192 for TPMS (cube is small ±π), 384 for field-
    // threshold modes (noise/grain — cube can be ~3.3× larger, needs more
    // steps to traverse). Each extra step is ~one fieldEval call; for grain
    // that's ~48 cosines (spinodoid/GRF) or ~115 anisotropic exps (HU).
    // Cost is paid only on rays still searching for the surface — hits
    // early-exit.
    (isField
      ? '  for(int i=0;i<384;i++){'
      : '  for(int i=0;i<192;i++){'),
    '    vec3 p=ro+rd*t;float d=sceneSDF(p,H);',
    '    if(d<thresh){hit=true;break;}',
    '    if(t>tEx+0.01)break;',
    '    t+=clamp(d*0.9,thresh*0.5,maxStep);',
    '  }',
    // Field box-face cap: when the marcher misses the implicit surface but
    // the ray exits the cube *inside* solid material (implicit < 0 at tEx),
    // render the cube exit face. This is what gives the noise/grain preview
    // their "see-through cavity to back wall" look — without it, sheet-mode
    // designs render as opaque shells with black voids instead of cavities
    // through which the back wall is visible. Implicit is the raw scaffold
    // SDF without the box clip; sceneSDF wouldn't work here because it's
    // already constrained to the box.
    (isField
      ? '  if(!hit){if(implicit(ro+rd*tEx,H)<0.0){boxCap=true;hit=true;t=tEx;}}'
      : ''),
    '  if(!hit){',
    '    if(tEn>=0.0){',
    '      vec3 pc=ro+rd*tEn,ep=abs(pc)/H;',
    '      vec2 fp;if(ep.x>ep.y&&ep.x>ep.z)fp=ep.yz;else if(ep.y>ep.z)fp=ep.xz;else fp=ep.xy;',
    '      float ed=min(1.0-fp.x,1.0-fp.y);',
    // Box-edge highlight on miss-rays — F13LD neon (#c8f542) at low opacity.
    // Skipped for beam mode: the bounding cube sits at ±(1+pad) which is
    // NOT the cell boundary (which sits at ±1 and is drawn separately as
    // the cell-boundary wireframe in fieldEval). Drawing both produced
    // the "two wireframes" issue — outer = camera box, inner = cell.
    // Beam wants only the inner wireframe.
    (isBeam
      ? ''
      : '      if(ed<0.04){float w=smoothstep(0.04,0.005,ed);' + fragWrite + '=mix(bg,vec4(0.78,0.96,0.26,1.0),w*0.4);return;}'),
    '    }',
    '    ' + fragWrite + '=bg;return;',
    '  }',
    '  vec3 pos=ro+rd*t;',
    // Phase 1.4 wireframe override (beam only): query lattice vs wireframe
    // SDFs at the hit point and color the wireframe as flat F13LD neon
    // (matches the cube-edge highlight on miss-rays at line 8589, so the
    // cell-boundary cube reads as a coherent visual element). The query
    // is just ~12 GPU ops per fragment AFTER the marcher hit — negligible
    // vs the marcher's 192 × capsule loop.
    (isBeam
      ? '  if (fieldWire(pos,H) < fieldLattice(pos,H)) {\n' +
        '    vec3 wireCol = vec3(0.784, 0.961, 0.259);\n' +
        // Slight depth fade so wireframe at the back of the cube doesn't
        // compete with foreground struts. exp(-t*0.05) at typical zoom
        // ranges leaves front edges at ~0.95 and back edges at ~0.6.
        '    wireCol = mix(bgCol, wireCol, exp(-t*0.05));\n' +
        '    ' + fragWrite + '=vec4(clamp(wireCol,0.0,1.0),1.0); return;\n' +
        '  }'
      : ''),
    // Box cap normal vs surface normal — box cap faces are flat, no FD needed.
    (isNoise
      ? '  vec3 n=boxCap?boxNormal(pos,H):nrm(pos,H,nrmE);'
      : '  vec3 n=nrm(pos,H,nrmE);'),
    '  if(dot(n,-rd)<0.0)n=-n;',
    // Cut face = the cube is the visible surface (or a noise box cap).
    '  bool isCut=' + (isNoise ? 'boxCap||' : '') + 'implicit(pos,H)<sceneSDF(pos,H)-1e-5;',
    // Body color = the design's family color (same as F13LD.mesh).
    '  vec3 col=f13Shade(' + ({ tpms:'vec3(0.369,0.792,0.647)', noise:'vec3(0.918,0.439,0.314)', grain:'vec3(0.659,0.647,0.604)', beam:'vec3(0.722,0.812,0.314)' }[family || 'tpms'] || 'vec3(0.369,0.792,0.647)') + ',pos,n,rd,rot,isCut,min(6.2832,H),nrmE,1.6*H);',
    '  col=mix(bgCol,col,exp(-t*0.010));',
    '  ' + fragWrite + '=vec4(clamp(col,0.0,1.0),1.0);',
    '}'
  ];
  // Drop the version line if empty (WebGL1 path)
  const frag = lines_.filter(s => s !== '').join('\n');
  // Forward kernel sidecars so buildPreviewShader can upload them as uniforms.
  // - bakedField: grain's R8 sampler3D upload (existing P2c path)
  // - beamData:   beam's uniform-array upload (added in Phase 1.2 after the
  //               unrolled-shader version froze the page on the 50-strut
  //               custom cell). Carries beamA/beamB/beamR/beamCount/beamRMax.
  // For TPMS/Noise kernels, neither sidecar is present and the return shape
  // stays backward-compatible at the caller (destructure with fallback).
  return {
    frag,
    bakedField: emitted.bakedField || null,
    beamData:   emitted.beamData   || null
  };
}
