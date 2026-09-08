// GLSL ES 3.00 sources. Three passes matter:
//   FILL  - flat crayon/paper fills, pencil hatching for shade, half-coloured world mask
//   INK   - every edge as a screen-space quad, jittered by a seed that only ticks at 12fps
//   POST  - paper grain, vignette, scope, damage
// The "boiling" of hand-drawn animation comes from uSeed being held constant for a whole
// 12fps step: fills and outlines wobble together, then snap to a new wobble on the next step.

const COMMON = /* glsl */`
precision highp float;

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p){ vec3 p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1,0)), c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; i++){ s += vnoise(p) * a; n += a; a *= 0.5; p *= 2.03; p += 17.1; }
  return s / n;
}
`;

const COLOR_MASK = /* glsl */`
uniform vec2  uColorOrigin;
uniform vec2  uColorDir;
uniform float uColorSlope;

// 0 = left as bare line-art, 1 = coloured in. The boundary is a straight sweep across the
// map chewed up by medium-scale noise, so it never reads as a ruled line.
float colorMask(vec2 wp){
  float d = dot(wp - uColorOrigin, uColorDir) * uColorSlope;
  float n = fbm2(wp * 0.055) - 0.5;
  float fine = fbm2(wp * 0.23) - 0.5;
  return smoothstep(-0.13, 0.13, d + n * 1.45 + fine * 0.30);
}
`;

// ---------------------------------------------------------------- fill

export const FILL_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aMat;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform vec2 uRes;
uniform float uSeed;
uniform float uWobble;
uniform float uObjSeed;

out vec3 vWorld;
out vec3 vNrm;
out vec2 vUv;
flat out float vMat;

void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNrm = normalize(uNormalMat * aNrm);
  vUv = aUv;
  vMat = aMat;

  vec4 clip = uViewProj * world;

  // Same hash the ink pass uses, keyed on *local* position so a moving object's wobble
  // travels with it instead of shimmering through a static field.
  vec3 q = floor(aPos * 6.0 + 0.5) + uObjSeed;
  vec2 jitter = vec2(hash31(q + uSeed * 11.7), hash31(q + uSeed * 11.7 + 53.3)) - 0.5;
  clip.xy += jitter * 2.0 * uWobble * clip.w * 2.0 / uRes;

  gl_Position = clip;
}`;

export const FILL_FS = /* glsl */`#version 300 es
${COMMON}
${COLOR_MASK}

in vec3 vWorld;
in vec3 vNrm;
in vec2 vUv;
flat in float vMat;

/**
 * Anti-aliased line grid over p (one line per unit); w is the line half-width in units.
 * Fades to nothing once a cell is close to pixel-sized, which is what stops the pattern
 * from aliasing into streaks at grazing angles.
 */
/** Single-axis version of gridLine, for stripes rather than grids. */
float stripeLine(float p, float widthPx, float fadeAt){
  float d = max(fwidth(p), 1e-6);
  float g = abs(fract(p) - 0.5) / d;
  float v = 1.0 - clamp(g - widthPx * 0.5, 0.0, 1.0);
  return v * (1.0 - smoothstep(fadeAt * 0.4, fadeAt, d));
}

float gridLine(vec2 p, float widthPx, float fadeAt);
float stripeLine(float p, float widthPx, float fadeAt);

/**
 * Hand-drawn grid. The lines wander (a low-frequency warp) and break into strokes (a
 * high-frequency modulation), so floors and ceilings read as ruled by hand rather than
 * printed. Built on gridLine, so it inherits its constant pen weight and distance fade.
 */
float sketchGrid(vec2 p, float widthPx, float fadeAt){
  vec2 w = vec2(fbm2(p * 1.6), fbm2(p * 1.6 + 31.7)) - 0.5;
  float v = gridLine(p + w * 0.10, widthPx, fadeAt);
  return clamp(v * (0.45 + 0.85 * vnoise(p * 8.0)), 0.0, 1.0);
}

/** Same idea for a single-axis stripe. */
float sketchStripe(float p, float widthPx, float fadeAt, float seed){
  float w = (vnoise(vec2(p * 1.3, seed)) - 0.5) * 0.12;
  return stripeLine(p + w, widthPx, fadeAt) * (0.5 + 0.8 * vnoise(vec2(p * 7.0, seed + 4.0)));
}

/**
 * Scattered short pencil dashes, one per cell of p, each at its own angle - the scribbled
 * tooth that keeps a big flat floor from reading as a solid fill.
 */
float dashes(vec2 p, float density){
  vec2 d = max(fwidth(p), vec2(1e-6));
  float fade = 1.0 - smoothstep(0.06, 0.20, max(d.x, d.y));
  if (fade <= 0.001) return 0.0;
  vec2 cell = floor(p);
  if (hash21(cell) > density) return 0.0;
  float a = hash21(cell + 3.0) * 6.2831;
  vec2 dir = vec2(cos(a), sin(a));
  vec2 rel = fract(p) - 0.5 - (vec2(hash21(cell + 7.0), hash21(cell + 13.0)) - 0.5) * 0.45;
  float t = clamp(dot(rel, dir), -0.20, 0.20);
  float px = max(d.x, d.y);
  return (1.0 - smoothstep(px * 0.6, px * 1.9, length(rel - dir * t))) * fade;
}

float gridLine(vec2 p, float widthPx, float fadeAt){
  // Measure the distance to the nearest line in *pixels* rather than in units. A grid
  // drawn in unit space swells into fat bands at grazing angles; this one stays a
  // constant-weight pen line however far away it is, and fades out once the cells get
  // too small to draw honestly.
  vec2 d = max(fwidth(p), vec2(1e-6));
  vec2 g = abs(fract(p) - 0.5) / d;
  float v = 1.0 - clamp(min(g.x, g.y) - widthPx * 0.5, 0.0, 1.0);
  float fade = 1.0 - smoothstep(fadeAt * 0.4, fadeAt, max(d.x, d.y));
  return v * fade;
}

uniform sampler2D uHatch;
uniform sampler2D uCrayon;
uniform vec3 uMatColor[14];
uniform vec4 uOverride;     // rgb tint, a = 1 to replace the palette colour
uniform vec3 uInkColor;
uniform vec3 uPaperColor;
uniform vec3 uLightDir;
uniform float uSeed;
uniform float uHatchScale;
uniform float uCeilH;
uniform float uFogK;
uniform vec3 uEye;
uniform vec3 uMaskOffset;   // lets eye-space geometry (the viewmodel) sample the world's colour mask
uniform float uAoEnable;
uniform float uForceColor;  // 1 = always coloured, regardless of which half of the map we're in
uniform float uEntityColor; // >= 0 overrides the mask with a single value for the whole object
uniform float uFancy;          // 0 = flat look, 1 = shadows and lamp falloff
uniform mat4 uShadowMat;
uniform highp sampler2DShadow uShadowMap;
uniform int uLightCount;
uniform vec4 uLights[8];       // xyz = panel centre, w = reach

out vec4 fragColor;

void main(){
  int mat = int(vMat + 0.5);
  vec3 N = normalize(vNrm);

  // ---- base colour -------------------------------------------------------
  vec3 matCol = uOverride.a > 0.5 ? uOverride.rgb : uMatColor[mat];

  // Crayon coverage, projected on whichever axis the face points along least.
  vec3 an = abs(N);
  vec3 cw = vWorld + uMaskOffset;
  vec2 cuv = an.y > max(an.x, an.z) ? cw.xz : (an.x > an.z ? cw.zy : cw.xy);
  vec3 crayon = texture(uCrayon, cuv * 0.155).rgb;
  float cover = crayon.r;

  // The viewmodel is always coloured in. Letting your own gun go white in the uncoloured
  // half looked lovely and made it impossible to read against the floor.
  // Characters pass a single eased value for their whole body; the world samples the mask
  // per fragment. Fading a body per-pixel as it crosses looked like it was being wiped.
  float colored = uEntityColor >= 0.0
    ? uEntityColor
    : max(colorMask(vWorld.xz + uMaskOffset.xz), uForceColor);
  // Threshold the mask against the crayon coverage: solid colour well inside the region,
  // and a frayed, patchy edge exactly where the colouring stops.
  float colorAmt = smoothstep(cover * 0.62, cover * 0.62 + 0.30, colored);

  // Hue drifts slightly across the surface the way wax does.
  vec3 waxed = matCol * (0.90 + 0.18 * crayon.g) * (0.93 + 0.10 * cover);
  vec3 base = mix(uPaperColor, waxed, colorAmt);

  // ---- surface detail ----------------------------------------------------
  // Every repeating pattern here is derivative-aware and drawn by hand: past the point
  // where one period is about a pixel wide it fades out, which is what stops grazing
  // angles turning the ceiling into moire streaks.
  if (mat == 0 || mat == 5) {
    // Wallpaper: a wandering vertical stripe, plus a skirting line at the floor.
    float stripe = sketchStripe(vUv.x * 1.05, 1.3, 0.34, 2.0);
    base *= 1.0 - stripe * 0.055 * (0.4 + colorAmt);
    float skirt = 1.0 - smoothstep(0.10, 0.16, abs(vWorld.y - 0.13));
    base = mix(base, base * 0.80, skirt * 0.5);
  } else if (mat == 1) {
    // Carpet, drawn: wandering tile seams plus a field of pencil dashes for the pile.
    float stip = vnoise(vUv * 7.0) * 0.6 + vnoise(vUv * 19.0) * 0.4;
    base *= 0.965 + stip * 0.07;
    float seam = sketchGrid(vUv * 0.278, 1.5, 0.30);
    base = mix(base, mix(uInkColor, base * 0.55, 0.45), seam * 0.55);
    float pile = dashes(vUv * 1.7, 0.30);
    base = mix(base, mix(uInkColor, base * 0.6, 0.5), pile * 0.28);
  } else if (mat == 2) {
    // Ceiling tiles, also ruled by hand, with a few stipple marks per panel.
    float grid = sketchGrid(vUv * 0.5, 1.6, 0.30);
    base = mix(base, uInkColor, grid * 0.34);
    float speck = dashes(vUv * 1.1, 0.18);
    base = mix(base, mix(uInkColor, base * 0.6, 0.5), speck * 0.20);
  }

  // ---- light -> pencil hatching -----------------------------------------
  // Flat comic shading: the value of a face comes from which way it points, not from a
  // lambert term. Keeps ceilings light and walls readable, and puts hatching only where a
  // person drawing this would actually have put it.
  vec3 L = normalize(uLightDir);
  float facing = dot(N.xz, L.xz);
  float light = N.y > 0.5 ? 1.0
              : (N.y < -0.5 ? 0.95
              : 0.86 + 0.12 * facing);

  // Contact darkening where walls meet the floor and ceiling. Only walls get it: applying
  // it to a floor or ceiling face just darkens the whole plane, since every point on it
  // sits at the height the term is measuring.
  float ao = abs(N.y) > 0.5
    ? 1.0
    : smoothstep(0.0, 0.9, vWorld.y) * smoothstep(0.0, 1.1, uCeilH - vWorld.y);
  light *= mix(1.0, mix(0.84, 1.0, ao), uAoEnable);

  if (mat == 3) { // light panel: emissive, never hatched
    fragColor = vec4(mix(vec3(0.99, 0.98, 0.93), mix(vec3(0.99,0.98,0.93), vec3(1.0,0.96,0.72), colorAmt), 1.0), 1.0);
    return;
  }

  // Hatching lives in screen space and re-jitters every animation step, so shading looks
  // re-drawn each frame rather than pasted on.
  vec2 hoff = (hash22(vec2(uSeed, uSeed * 3.7)) - 0.5) * 64.0;
  vec2 huv = (gl_FragCoord.xy + hoff) / uHatchScale;
  vec3 hatch = texture(uHatch, huv).rgb;

  // ---- realtime shadows + ceiling panel falloff -------------------------
  // Both are driven by the light panels: the shadow map looks down the average direction
  // of a ceiling full of them, and the falloff term is the nearest few panels themselves,
  // so standing under one is brighter than standing between them.
  float shadow = 1.0;
  if (uFancy > 0.5) {
    vec4 sc = uShadowMat * vec4(vWorld + N * 0.06, 1.0);
    vec3 pc = sc.xyz / sc.w * 0.5 + 0.5;
    if (pc.x > 0.001 && pc.x < 0.999 && pc.y > 0.001 && pc.y < 0.999 && pc.z < 1.0) {
      vec2 texel = vec2(1.0 / 1024.0);
      float sum = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          sum += texture(uShadowMap, vec3(pc.xy + vec2(float(x), float(y)) * texel, pc.z - 0.0016));
        }
      }
      shadow = sum / 9.0;
      // Fade the shadow out at the edge of the map so it doesn't end on a hard line.
      vec2 e = min(pc.xy, 1.0 - pc.xy);
      shadow = mix(1.0, shadow, smoothstep(0.0, 0.06, min(e.x, e.y)));
    }

    float lamp = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uLightCount) break;
      vec3 d = uLights[i].xyz - vWorld;
      float dist = length(d);
      float falloff = max(0.0, 1.0 - dist / uLights[i].w);
      lamp += falloff * falloff * (0.35 + 0.65 * max(dot(N, d / max(dist, 1e-3)), 0.0));
    }
    // Capped at 1: paper cannot get brighter than paper, so the contrast has to come from
    // darkening what the panels don't reach rather than blowing out what they do.
    light *= min(1.0, 0.80 + clamp(lamp, 0.0, 1.0) * 0.24) * mix(0.55, 1.0, shadow);
  }

  float shadeAmt = 1.0 - smoothstep(0.68, 1.0, light);
  float h = 0.0;
  h = max(h, hatch.r * smoothstep(0.16, 0.52, shadeAmt));
  h = max(h, hatch.g * smoothstep(0.50, 0.82, shadeAmt));
  h = max(h, hatch.b * smoothstep(0.80, 1.00, shadeAmt));

  // A cast shadow is drawn, not dimmed: it picks up extra hatching of its own.
  h = max(h, hatch.g * (1.0 - shadow) * 0.85);

  vec3 col = base * mix(1.0, 0.86, shadeAmt);
  col = mix(col, mix(uInkColor, col * 0.6, 0.45), h * 0.30);

  // Paper tooth so flat fills still have life in them.
  float tooth = vnoise(gl_FragCoord.xy * 0.7 + hoff) * 0.5 + crayon.b * 0.5;
  col *= 0.982 + tooth * 0.036;

  // Distance wash: far geometry fades toward the paper, like a lighter pencil pass.
  float dist = length(vWorld - uEye);
  col = mix(col, uPaperColor * 0.99, clamp(dist * uFogK, 0.0, 0.26));

  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- ink

export const INK_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec3 aP0;
layout(location = 1) in vec3 aP1;
layout(location = 2) in vec2 aSideT;   // x = -1/+1 across the stroke, y = 0/1 along it
layout(location = 3) in vec2 aWidthCap; // x = base width, y = cap flags (1 = start end, 2 = finish end)

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uModel;
uniform vec2 uRes;
uniform float uSeed;
uniform float uWobble;
uniform float uInkScale;
uniform float uObjSeed;
uniform float uDepthBias;

out float vSide;
out float vHalfPx;
out float vPressure;

// Jitter is keyed on the endpoint's own position, so strokes that share a vertex keep
// sharing it after wobbling - the outline stays a connected line, it just breathes.
vec2 endJitter(vec3 lp){
  vec3 q = floor(lp * 6.0 + 0.5) + uObjSeed;
  return (vec2(hash31(q + uSeed * 11.7), hash31(q + uSeed * 11.7 + 53.3)) - 0.5) * 2.0;
}

void main(){
  vec3 v0 = (uView * uModel * vec4(aP0, 1.0)).xyz;
  vec3 v1 = (uView * uModel * vec4(aP1, 1.0)).xyz;

  // Clip against the near plane in view space; projecting a point behind the eye would
  // fling the stroke across the screen.
  const float zn = 0.06;
  if (v0.z > -zn && v1.z > -zn) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (v0.z > -zn)      { v0 = mix(v1, v0, (-zn - v1.z) / (v0.z - v1.z)); }
  else if (v1.z > -zn) { v1 = mix(v0, v1, (-zn - v0.z) / (v1.z - v0.z)); }

  // Scaling about the eye slides both points along their view rays: same pixels, nearer
  // depth. Keeps ink on top of its own fill without polygon-offset guesswork.
  v0 *= uDepthBias; v1 *= uDepthBias;

  vec4 c0 = uProj * vec4(v0, 1.0);
  vec4 c1 = uProj * vec4(v1, 1.0);
  vec2 s0 = c0.xy / c0.w * uRes * 0.5;
  vec2 s1 = c1.xy / c1.w * uRes * 0.5;

  vec2 j0 = endJitter(aP0), j1 = endJitter(aP1);
  s0 += j0 * uWobble;
  s1 += j1 * uWobble;

  vec2 d = s1 - s0;
  float len = length(d);
  d = len > 1e-4 ? d / len : vec2(1.0, 0.0);

  // Overshoot only where a stroke genuinely ends: corners get the crossed-over look of a
  // pen that ran past the join, interior joints stay closed.
  float cap = aWidthCap.y;
  float capStart = mod(cap, 2.0) >= 1.0 ? 1.0 : 0.0;
  float capEnd = cap >= 2.0 ? 1.0 : 0.0;
  float over0 = capStart * (1.0 + hash31(floor(aP0 * 6.0) + uSeed) * 4.5);
  float over1 = capEnd  * (1.0 + hash31(floor(aP1 * 6.0) + uSeed + 9.0) * 4.5);
  s0 -= d * over0;
  s1 += d * over1;

  vec2 nor = vec2(-d.y, d.x);
  float t = aSideT.y;
  vec2 basePx = mix(s0, s1, t);

  // Pen pressure: thickness swells and thins along the stroke.
  float pj = mix(hash31(floor(aP0 * 6.0) + uSeed * 3.1), hash31(floor(aP1 * 6.0) + uSeed * 3.1 + 21.0), t);
  float halfPx = aWidthCap.x * uInkScale * (0.66 + 0.62 * pj) * 0.5;
  halfPx = max(halfPx, 0.35);

  vec2 px = basePx + nor * aSideT.x * halfPx;
  vec4 clip = mix(c0, c1, t);
  gl_Position = vec4(px / (uRes * 0.5) * clip.w, clip.z, clip.w);

  vSide = aSideT.x;
  vHalfPx = halfPx;
  vPressure = pj;
}`;

export const INK_FS = /* glsl */`#version 300 es
${COMMON}
in float vSide;
in float vHalfPx;
in float vPressure;

uniform vec3 uInkColor;
uniform float uInkAlpha;

out vec4 fragColor;

void main(){
  // Analytic coverage across the stroke: one clean pixel of falloff at the edges.
  float d = abs(vSide) * vHalfPx;
  float a = clamp(vHalfPx - d + 0.5, 0.0, 1.0);
  a *= uInkAlpha * (0.72 + 0.34 * vPressure);
  if (a < 0.01) discard;
  fragColor = vec4(uInkColor, a);
}`;

// ---------------------------------------------------------------- textured quads (decals, flashes, shadows)

export const QUAD_VS = /* glsl */`#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;

out vec2 vUv;
out vec3 vWorld;

void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vUv = aUv * uUvScale + uUvOffset;
  gl_Position = uViewProj * world;
}`;

export const QUAD_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUv;
in vec3 vWorld;

uniform sampler2D uTex;
uniform vec4 uTint;
uniform float uFogK;
uniform vec3 uEye;
uniform vec3 uPaperColor;

out vec4 fragColor;

void main(){
  vec4 t = texture(uTex, vUv);
  float a = t.a * uTint.a;
  if (a < 0.01) discard;
  vec3 col = mix(t.rgb, uTint.rgb, uTint.a > 0.0 ? 1.0 : 0.0);
  col = uTint.rgb * (0.75 + 0.25 * t.r);
  float dist = length(vWorld - uEye);
  col = mix(col, uPaperColor * 0.99, clamp(dist * uFogK, 0.0, 0.55));
  fragColor = vec4(col, a);
}`;

// ---------------------------------------------------------------- post

export const POST_VS = /* glsl */`#version 300 es
out vec2 vUv;
void main(){
  // Fullscreen triangle, no vertex buffer needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const POST_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uPaper;
uniform vec2 uRes;
uniform float uSeed;
uniform float uScope;      // 0..1 scope blend
uniform float uScopeR;     // scope radius, fraction of min(res)
uniform float uDamage;     // 0..1 red flash
uniform float uDeath;      // 0..1 desaturate + darken on death
uniform float uImpact;     // 0..1 sniper impact frame
uniform vec2  uImpactUv;
uniform float uImpactR;
uniform vec3 uPaperColor;
uniform float uFancy;
uniform sampler2D uBlur;
uniform highp sampler2D uDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uBloom;
uniform float uSaturation;

out vec4 fragColor;

void main(){
  vec2 uv = vUv;
  vec2 px = uv * uRes;
  vec2 centered = (px - uRes * 0.5) / min(uRes.x, uRes.y);

  vec3 col = texture(uScene, uv).rgb;

  if (uFancy > 0.5) {
    vec3 blurred = texture(uBlur, uv).rgb;

    // Depth of field: far things go soft, near things stay sharp. The viewmodel is drawn
    // through a much tighter frustum, so its depths land right at the near plane and it
    // is never blurred - which is what we want anyway.
    float d = texture(uDepth, uv).r * 2.0 - 1.0;
    float linear = (2.0 * uNear * uFar) / (uFar + uNear - d * (uFar - uNear));
    float coc = smoothstep(uFocus, uFocus * 4.0, linear);
    col = mix(col, blurred, clamp(coc, 0.0, 0.72));

    // Bloom, taken off the same blurred image. Thresholded after the blur, which bleeds a
    // little, but the whole page is near-white so a strict bright pass finds nothing.
    vec3 bright = max(blurred - vec3(0.80), vec3(0.0)) / 0.2;
    col += bright * uBloom;

    // Balance: pull the saturation back up that the bloom washed out, and keep the paper
    // from clipping to flat white.
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, uSaturation);
    col = col / (1.0 + max(col - 1.0, vec3(0.0)) * 0.85);
  }

  // Paper stock multiplied over everything, wobbling a touch each animation step so the
  // grain feels re-drawn rather than laminated on.
  vec2 poff = (hash22(vec2(uSeed, uSeed * 2.3)) - 0.5) * 128.0;
  vec3 paper = texture(uPaper, (px + poff) / 512.0).rgb;
  col *= 0.88 + paper * 0.14;

  // Sniper scope: everything outside the eyepiece falls away to dark paper.
  if (uScope > 0.001) {
    float r = length(centered);
    float edge = smoothstep(uScopeR, uScopeR * 1.045, r);
    // Outside the eyepiece the drawing is scribbled over rather than switched off - dark
    // graphite, still with a little of the page showing through.
    vec3 scribble = vec3(0.15, 0.145, 0.17) * (0.82 + 0.36 * vnoise(px * 0.09));
    vec3 outside = mix(col * 0.30, scribble, 0.82);
    col = mix(col, outside, edge * uScope);
    // Slight blue-grey glass tint inside the tube.
    col = mix(col, col * vec3(0.97, 0.99, 1.02), uScope * (1.0 - edge));
  }

  // Vignette, drawn like a smudged pencil border.
  float vig = 1.0 - smoothstep(0.36, 0.86, length(centered) * (1.0 + 0.2 * vnoise(centered * 6.0)));
  col *= mix(0.80, 1.0, vig);

  if (uDamage > 0.001) {
    float r = length(centered);
    float ring = smoothstep(0.22, 0.72, r);
    col = mix(col, vec3(0.78, 0.16, 0.18), ring * uDamage * 0.72);
  }

  if (uDeath > 0.001) {
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(g) * 0.75, uDeath);
  }

  // Impact frame. The page goes black except for a hole blown open at the hit, which
  // reads as a single hand-inked frame spliced into the animation.
  if (uImpact > 0.001) {
    vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
    vec2 rel = (uv - uImpactUv) * aspect;
    float d = length(rel);
    // Ragged rim, redrawn each animation step, so it never looks like a vector circle.
    float ang = atan(rel.y, rel.x);
    float wob = 1.0 + 0.20 * (vnoise(vec2(ang * 2.4, uSeed * 3.1) * 2.0) - 0.5)
                    + 0.10 * (vnoise(vec2(ang * 7.0, uSeed * 1.7) * 3.0) - 0.5);
    float R = uImpactR * wob;
    float inside = 1.0 - smoothstep(R * 0.80, R, d);
    // A few splinters shooting out past the rim.
    float spikes = smoothstep(0.55, 1.0, vnoise(vec2(ang * 5.0, uSeed)));
    inside = max(inside, (1.0 - smoothstep(R * 1.05, R * 1.75, d)) * spikes);
    vec3 frame = mix(vec3(0.02, 0.02, 0.03), vec3(1.0), inside);
    col = mix(col, frame, uImpact);
  }

  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- shadow map

export const SHADOW_VS = /* glsl */`#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightViewProj;
uniform mat4 uModel;
void main(){
  gl_Position = uLightViewProj * uModel * vec4(aPos, 1.0);
}`;

export const SHADOW_FS = /* glsl */`#version 300 es
precision highp float;
void main(){}`;

// ---------------------------------------------------------------- blur chain
// One half-resolution blur serves two jobs: the out-of-focus image for depth of field,
// and (thresholded) the bloom source. Two separate chains would look marginally better
// and cost twice as much for a game drawn in pencil.

export const BLUR_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;      // direction * 1/resolution
out vec4 fragColor;
void main(){
  // 9-tap gaussian, linear-sampled at 5 positions.
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uTexel * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uTexel * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uTexel * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uTexel * 3.2307692308).rgb * 0.0702702703;
  fragColor = vec4(c, 1.0);
}`;

export const COPY_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 fragColor;
void main(){ fragColor = vec4(texture(uTex, vUv).rgb, 1.0); }`;
