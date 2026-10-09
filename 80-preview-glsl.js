/* ============================================================
   F13LD.sweep · 80-preview-glsl.js
   Preview shader: one program for every family.

   The preview shows the design's own geometry: its margin field
   (solid ⟺ m > 0, from the shared geom/ code — the same test the solver
   voxelizes) is baked to a 3D texture in a worker (bakePreviewField) and
   raymarched here. There is no per-family GLSL to keep in sync with the
   solver any more.

   Box: one cell, [-uHalf, uHalf] — uHalf is the cell's physical aspect
   (largest edge = 1). uLip: largest slope of the margin per world unit,
   so −m / uLip never overstates the distance to the surface.
   ============================================================ */

const PREVIEW_VERT = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

const PREVIEW_FRAG = [
  '#version 300 es',
  'precision highp float;precision highp sampler3D;',
  'out vec4 fragColor;',
  'uniform vec2 res;uniform mat3 rot;uniform float zoom;',
  'uniform sampler3D uField;uniform float uLip;uniform vec3 uHalf;uniform vec3 uColor;uniform float uStep;',
  'float fieldAt(vec3 p){return texture(uField,p/uHalf*0.5+0.5).r;}',
  'float boxSDF(vec3 p){vec3 d=abs(p)-uHalf;return length(max(d,0.0))+min(max(d.x,max(d.y,d.z)),0.0);}',
  'float implicitD(vec3 p){return -fieldAt(p)/uLip;}',
  'float sceneSDF(vec3 p){return max(implicitD(p),boxSDF(p));}',
  'float f13Map(vec3 p){return sceneSDF(p);}',
  F13_SHADE_GLSL,
  'vec3 nrm(vec3 p,float e){return normalize(vec3(sceneSDF(p+vec3(e,0,0))-sceneSDF(p-vec3(e,0,0)),sceneSDF(p+vec3(0,e,0))-sceneSDF(p-vec3(0,e,0)),sceneSDF(p+vec3(0,0,e))-sceneSDF(p-vec3(0,0,e))));}',
  'void main(){',
  '  vec2 uv=(gl_FragCoord.xy-res*0.5)/min(res.x,res.y);',
  '  vec3 ro=rot*vec3(0.0,0.0,zoom);',
  '  vec3 rd=normalize(rot*vec3(uv.x,uv.y,-1.6));',
  '  float r=clamp(length(uv)*1.1,0.0,1.0);',
  '  vec3 bgCol=mix(vec3(0.07),vec3(0.03),r*r);vec4 bg=vec4(bgCol,1.0);',
  '  vec3 iv=vec3(1.0)/rd;',
  '  vec3 tb=(-uHalf-ro)*iv,tt=(uHalf-ro)*iv;',
  '  vec3 tmi=min(tb,tt),tma=max(tb,tt);',
  '  float tEn=max(max(tmi.x,tmi.y),tmi.z);float tEx=min(min(tma.x,tma.y),tma.z);',
  '  if(tEn>tEx||tEx<0.0){fragColor=bg;return;}',
  '  float t=max(tEn,0.001);bool hit=false;float thr=uStep*0.15;',
  '  for(int i=0;i<320;i++){',
  '    vec3 p=ro+rd*t;float d=sceneSDF(p);',
  '    if(d<thr){hit=true;break;}',
  '    if(t>tEx+0.01)break;',
  '    t+=clamp(d,uStep*0.25,uStep*3.0);',
  '  }',
  '  if(!hit){',
  '    if(tEn>=0.0){',
  '      vec3 pc=ro+rd*tEn,ep=abs(pc)/uHalf;',
  '      vec2 fp;if(ep.x>ep.y&&ep.x>ep.z)fp=ep.yz;else if(ep.y>ep.z)fp=ep.xz;else fp=ep.xy;',
  '      float ed=min(1.0-fp.x,1.0-fp.y);',
  '      if(ed<0.04){float w=smoothstep(0.04,0.005,ed);fragColor=mix(bg,vec4(0.78,0.96,0.26,1.0),w*0.4);return;}',
  '    }',
  '    fragColor=bg;return;',
  '  }',
  '  vec3 pos=ro+rd*t;',
  '  vec3 n=nrm(pos,uStep*0.5);',
  '  if(dot(n,-rd)<0.0)n=-n;',
  '  bool isCut=implicitD(pos)<sceneSDF(pos)-1e-4;',
  '  vec3 col=f13Shade(uColor,pos,n,rd,rot,isCut,2.0,uStep*0.5,1.6);',
  '  col=mix(bgCol,col,exp(-t*0.010));',
  '  fragColor=vec4(clamp(col,0.0,1.0),1.0);',
  '}'
].join('\n');

/* Body colour per family (same as F13LD.mesh). */
const PREVIEW_FAMILY_COLOR = {
  tpms:  [0.369, 0.792, 0.647],
  noise: [0.918, 0.439, 0.314],
  grain: [0.659, 0.647, 0.604],
  beam:  [0.722, 0.812, 0.314],
  foam:  [0.910, 0.831, 0.635],   /* #E8D4A2 */
  wave:  [0.851, 0.467, 0.024],   /* #D97706 */
  bundle:[0.482, 0.310, 0.620]    /* #7B4F9E */
};
