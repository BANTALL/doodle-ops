// Draw-list renderer. Callers queue meshes during the frame; we run them in three grouped
// passes (fills, ink, transparent quads) so programs and state change a handful of times
// per frame instead of once per object.

import { createGL, Program, RenderTarget, ShadowTarget, textureFromCanvas } from './gl.js';
import { unitQuadMesh, QUAD_LAYOUT } from './geom.js';
import * as S from './shaders.js';
import { M3, M4, V, clamp } from './math.js';
import { Frustum } from './frustum.js';
import { makePaperTexture, makeHatchTexture, makeCrayonTexture, makeSplatAtlas, makeFlashTexture, makeSmudgeTexture, makeStreakTexture, makePuffTexture, makeShieldTexture } from './textures.js';

export const MAT = {
  WALL: 0, FLOOR: 1, CEIL: 2, LIGHT: 3, CRATE: 4, TRIM: 5,
  METAL: 6, RED: 7, BLUE: 8, GREEN: 9, PURPLE: 10, ORANGE: 11, SKIN: 12, DARK: 13,
};

const PALETTE = new Float32Array([
  0.91, 0.77, 0.34,   // 0 wall - backrooms mustard
  0.74, 0.58, 0.27,   // 1 carpet
  0.90, 0.88, 0.80,   // 2 ceiling
  1.00, 0.97, 0.82,   // 3 light (emissive path)
  0.82, 0.62, 0.36,   // 4 cardboard
  0.80, 0.65, 0.28,   // 5 trim
  0.50, 0.51, 0.56,   // 6 metal
  0.86, 0.30, 0.26,   // 7 red
  0.33, 0.50, 0.82,   // 8 blue
  0.38, 0.68, 0.40,   // 9 green
  0.60, 0.42, 0.76,   // 10 purple
  0.93, 0.57, 0.22,   // 11 orange
  0.98, 0.85, 0.71,   // 12 skin
  0.31, 0.30, 0.34,   // 13 dark
]);

// The front of the depth range, kept for the viewmodel so it can win every depth test
// without wiping the world's depth. See endFrame.
const VM_DEPTH_SLICE = 0.02;

const SHADOW_SIZE = 1024;
const SHADOW_HALF = 26;   // world units covered either side of the player

export const PAPER_RGB = [0.968, 0.958, 0.918];
export const INK_RGB = [0.135, 0.125, 0.170];

class CmdPool {
  constructor(make) { this.make = make; this.items = []; this.len = 0; }
  next() {
    if (this.len === this.items.length) this.items.push(this.make());
    return this.items[this.len++];
  }
  reset() { this.len = 0; }
  *[Symbol.iterator]() { for (let i = 0; i < this.len; i++) yield this.items[i]; }
}

const makeMeshCmd = () => ({
  mesh: null, model: M4.create(), nrm: M3.create(),
  override: [0, 0, 0, 0], objSeed: 0, widthScale: 1, alpha: 1, colorAmt: -1,
});
const makeQuadCmd = () => ({
  tex: null, model: M4.create(), tint: [0, 0, 0, 1],
  uvOff: [0, 0], uvScale: [1, 1], depth: 0,
});

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = createGL(canvas);

    this.progFill = new Program(gl, S.FILL_VS, S.FILL_FS, 'fill');
    this.progInk = new Program(gl, S.INK_VS, S.INK_FS, 'ink');
    this.progQuad = new Program(gl, S.QUAD_VS, S.QUAD_FS, 'quad');
    this.progPost = new Program(gl, S.POST_VS, S.POST_FS, 'post');
    this.progShadow = new Program(gl, S.SHADOW_VS, S.SHADOW_FS, 'shadow');
    this.progBlur = new Program(gl, S.POST_VS, S.BLUR_FS, 'blur');
    this.progCopy = new Program(gl, S.POST_VS, S.COPY_FS, 'copy');

    this.texPaper = textureFromCanvas(gl, makePaperTexture(512), { mipmap: false });
    this.texHatch = textureFromCanvas(gl, makeHatchTexture(256), { mipmap: false });
    this.texCrayon = textureFromCanvas(gl, makeCrayonTexture(256), { mipmap: true });
    this.texSplat = textureFromCanvas(gl, makeSplatAtlas(256), { wrap: 'clamp', mipmap: true });
    this.texFlash = textureFromCanvas(gl, makeFlashTexture(256), { wrap: 'clamp', mipmap: true });
    this.texSmudge = textureFromCanvas(gl, makeSmudgeTexture(128), { wrap: 'clamp', mipmap: true });
    this.texStreak = textureFromCanvas(gl, makeStreakTexture(256, 64), { wrap: 'clamp', mipmap: true });
    this.texPuff = textureFromCanvas(gl, makePuffTexture(128), { wrap: 'clamp', mipmap: true });
    this.texShield = textureFromCanvas(gl, makeShieldTexture(256), { wrap: 'clamp', mipmap: true });

    this.quadMesh = unitQuadMesh(gl);
    this.emptyVao = gl.createVertexArray();

    this.rt = new RenderTarget(gl, 2, 2, 4, true);
    this.shadowMap = new ShadowTarget(gl, SHADOW_SIZE);
    this.blurA = new RenderTarget(gl, 2, 2, 0);
    this.blurB = new RenderTarget(gl, 2, 2, 0);

    // Fancy pipeline: shadow map, lamp falloff, bloom, depth of field, saturation balance.
    this.fancy = false;
    this.lightVP = M4.create();
    this._lightView = M4.create();
    this._lightProj = M4.create();
    this.lights = new Float32Array(8 * 4);
    this.lightCount = 0;

    this.shadowCasters = new CmdPool(makeMeshCmd);
    this.fills = new CmdPool(makeMeshCmd);
    this.inks = new CmdPool(makeMeshCmd);
    this.quads = new CmdPool(makeQuadCmd);
    this.vmFills = new CmdPool(makeMeshCmd);
    this.vmInks = new CmdPool(makeMeshCmd);

    this.view = M4.create();
    this.proj = M4.create();
    this.viewProj = M4.create();
    this.projVM = M4.create();
    this.identity = M4.identity(M4.create());
    this.identity3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    this.width = 1; this.height = 1;
    this.rtWidth = 1; this.rtHeight = 1;
    this.pixelRatio = 1;
    this.resolutionScale = 1;
    this.inkAmount = 1;

    // Colour-sweep parameters; the map fills these in once it knows its bounds.
    this.colorOrigin = [0, 0];
    this.colorDir = [0.82, 0.57];
    this.colorSlope = 0.05;

    this.frustum = new Frustum();
    this.stats = { chunks: 0, chunksDrawn: 0, actors: 0, actorsDrawn: 0, props: 0, propsDrawn: 0, inkLod: 0 };

    this.eye = V.make();
    this.seed = 0;
    this.fogK = 0.0040;
    this.ceilH = 3.2;
    this._tmpProj = { x: 0, y: 0, w: 0 };
  }

  setColorSweep(origin, dir, slope) {
    const l = Math.hypot(dir[0], dir[1]) || 1;
    this.colorOrigin = origin;
    this.colorDir = [dir[0] / l, dir[1] / l];
    this.colorSlope = slope;
  }

  resize(cssWidth, cssHeight, pixelRatio, resolutionScale) {
    this.width = Math.max(1, Math.round(cssWidth));
    this.height = Math.max(1, Math.round(cssHeight));
    this.pixelRatio = pixelRatio;
    this.resolutionScale = resolutionScale;
    const dw = Math.round(this.width * pixelRatio);
    const dh = Math.round(this.height * pixelRatio);
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }
    this.rtWidth = Math.max(2, Math.round(dw * resolutionScale));
    this.rtHeight = Math.max(2, Math.round(dh * resolutionScale));
    this.rt.resize(this.rtWidth, this.rtHeight);
    this.blurA.resize(Math.max(2, this.rtWidth >> 1), Math.max(2, this.rtHeight >> 1));
    this.blurB.resize(Math.max(2, this.rtWidth >> 1), Math.max(2, this.rtHeight >> 1));
  }

  /** camera: {pos, yaw, pitch, roll, fov(deg)}. animSeed advances once per 12fps step. */
  beginFrame(camera, animSeed) {
    const aspect = this.rtWidth / this.rtHeight;
    M4.perspective(this.proj, camera.fov * Math.PI / 180, aspect, 0.05, 400);
    M4.fpsView(this.view, camera.pos, camera.yaw, camera.pitch, camera.roll || 0);
    M4.mul(this.viewProj, this.proj, this.view);
    // Viewmodel gets its own tighter frustum so the gun never pokes through walls.
    M4.perspective(this.projVM, 62 * Math.PI / 180, aspect, 0.012, 12);
    this.frustum.fromMatrix(this.viewProj);
    V.copy(this.eye, camera.pos);
    this.seed = animSeed;
    this.stats.chunks = this.stats.chunksDrawn = 0;
    this.stats.actors = this.stats.actorsDrawn = 0;
    this.stats.props = this.stats.propsDrawn = 0;
    this.stats.inkLod = 0;

    this.fills.reset(); this.inks.reset(); this.quads.reset();
    this.vmFills.reset(); this.vmInks.reset(); this.shadowCasters.reset();
    this.rt.blitDepth = this.fancy;
    if (this.fancy) this._updateShadowMatrix(camera);
  }

  /**
   * Shadow camera: an orthographic box looking down the average direction of a ceiling
   * full of light panels, following the player. Its centre is snapped to a coarse grid so
   * the shadows don't crawl as you walk.
   */
  _updateShadowMatrix(camera) {
    // Tilted further off vertical than a ceiling grid really is, so shadows fall beside
    // objects instead of hiding directly underneath them.
    const dx = 0.46, dy = -1, dz = 0.32;
    const l = Math.hypot(dx, dy, dz);
    const d = { x: dx / l, y: dy / l, z: dz / l };
    const snap = 0.25;
    const c = {
      x: Math.round(camera.pos.x / snap) * snap,
      y: 1.2,
      z: Math.round(camera.pos.z / snap) * snap,
    };
    const dist = 30;
    const eye = { x: c.x - d.x * dist, y: c.y - d.y * dist, z: c.z - d.z * dist };
    M4.lookAt(this._lightView, eye, c, { x: 0, y: 0, z: -1 });
    // The near plane starts just below the ceiling. Without this the ceiling is the first
    // thing the light hits and the entire building sits in its shadow - which is true, and
    // useless: the panels are *in* the ceiling, so it should not occlude them.
    const near = Math.max(0.5, (eye.y - (this.ceilH - 0.25)) / Math.max(0.2, -d.y));
    M4.ortho(this._lightProj, -SHADOW_HALF, SHADOW_HALF, -SHADOW_HALF, SHADOW_HALF, near, near + 42);
    M4.mul(this.lightVP, this._lightProj, this._lightView);
  }

  /** Up to 8 nearby ceiling panels, as xyz + reach. */
  setLights(list, count) {
    this.lightCount = Math.min(8, count);
    for (let i = 0; i < this.lightCount; i++) {
      this.lights[i * 4] = list[i * 4];
      this.lights[i * 4 + 1] = list[i * 4 + 1];
      this.lights[i * 4 + 2] = list[i * 4 + 2];
      this.lights[i * 4 + 3] = list[i * 4 + 3];
    }
  }

  /** Queue geometry that should cast a shadow. Only position is read. */
  shadow(mesh, model, opts) { if (this.fancy) this._pushMesh(this.shadowCasters, mesh, model, opts); }

  _pushMesh(pool, mesh, model, opts) {
    if (!mesh || mesh.count === 0) return;
    const c = pool.next();
    c.mesh = mesh;
    if (model) c.model.set(model); else c.model.set(this.identity);
    M4.normalMat3(c.nrm, c.model);
    const o = opts?.color;
    if (o) { c.override[0] = o[0]; c.override[1] = o[1]; c.override[2] = o[2]; c.override[3] = 1; }
    else c.override[3] = 0;
    c.objSeed = opts?.objSeed ?? 0;
    c.widthScale = opts?.widthScale ?? 1;
    c.alpha = opts?.alpha ?? 1;
    c.colorAmt = opts?.colorAmt ?? -1;
  }

  fill(mesh, model, opts) { this._pushMesh(this.fills, mesh, model, opts); }
  ink(mesh, model, opts) { this._pushMesh(this.inks, mesh, model, opts); }
  /** Same, but drawn after a depth clear with the viewmodel frustum (models in eye space). */
  vmFill(mesh, model, opts) { this._pushMesh(this.vmFills, mesh, model, opts); }
  vmInk(mesh, model, opts) { this._pushMesh(this.vmInks, mesh, model, opts); }

  quad(tex, model, tint, uvOff = [0, 0], uvScale = [1, 1]) {
    const c = this.quads.next();
    c.tex = tex;
    c.model.set(model);
    c.tint[0] = tint[0]; c.tint[1] = tint[1]; c.tint[2] = tint[2]; c.tint[3] = tint[3];
    c.uvOff[0] = uvOff[0]; c.uvOff[1] = uvOff[1];
    c.uvScale[0] = uvScale[0]; c.uvScale[1] = uvScale[1];
    const dx = c.model[12] - this.eye.x, dy = c.model[13] - this.eye.y, dz = c.model[14] - this.eye.z;
    c.depth = dx * dx + dy * dy + dz * dz;
  }

  /** Project a world point to CSS pixels. Returns null when behind the camera. */
  worldToScreen(p, out = { x: 0, y: 0 }) {
    const r = M4.projectPoint(this.viewProj, p, this._tmpProj);
    if (r.w <= 0.001) return null;
    out.x = (r.x * 0.5 + 0.5) * this.width;
    out.y = (0.5 - r.y * 0.5) * this.height;
    return out;
  }

  _setFillFrameUniforms(p, viewProj, maskOffset, aoEnable, eye, forceColor = 0) {
    p.setMat4('uViewProj', viewProj)
      .set2f('uRes', this.rtWidth, this.rtHeight)
      .set1f('uSeed', this.seed)
      .set1f('uWobble', 0.9 * this.inkAmount)
      .set3fv('uMatColor', PALETTE)
      .set3f('uInkColor', INK_RGB[0], INK_RGB[1], INK_RGB[2])
      .set3f('uPaperColor', PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2])
      .set3f('uLightDir', 0.36, 0.86, 0.36)
      .set1f('uHatchScale', 256 * Math.max(0.75, this.pixelRatio * this.resolutionScale))
      .set1f('uCeilH', this.ceilH)
      .set1f('uFogK', this.fogK)
      .set1f('uAoEnable', aoEnable)
      .set1f('uForceColor', forceColor)
      .set1f('uFancy', this.fancy ? 1 : 0)
      .setMat4('uShadowMat', this.lightVP)
      .set1i('uLightCount', this.fancy ? this.lightCount : 0)
      .set3f('uEye', eye.x, eye.y, eye.z)
      .set3f('uMaskOffset', maskOffset[0], maskOffset[1], maskOffset[2])
      .set2f('uColorOrigin', this.colorOrigin[0], this.colorOrigin[1])
      .set2f('uColorDir', this.colorDir[0], this.colorDir[1])
      .set1f('uColorSlope', this.colorSlope)
      .setTex('uHatch', this.texHatch, 0)
      .setTex('uCrayon', this.texCrayon, 1);
    const l = p.loc('uLights');
    if (l && this.fancy) this.gl.uniform4fv(l, this.lights);
    p.setTex('uShadowMap', this.shadowMap.tex, 2);
  }

  _runFills(pool, p) {
    const gl = this.gl;
    let lastColor = -999;
    for (const c of pool) {
      if (c.colorAmt !== lastColor) { p.set1f('uEntityColor', c.colorAmt); lastColor = c.colorAmt; }
      p.setMat4('uModel', c.model).setMat3('uNormalMat', c.nrm)
        .set4f('uOverride', c.override[0], c.override[1], c.override[2], c.override[3])
        .set1f('uObjSeed', c.objSeed);
      c.mesh.draw(gl.TRIANGLES);
    }
    p.set1f('uEntityColor', -1);
  }

  _setInkFrameUniforms(p, view, proj, depthBias) {
    p.setMat4('uView', view).setMat4('uProj', proj)
      .set2f('uRes', this.rtWidth, this.rtHeight)
      .set1f('uSeed', this.seed)
      .set1f('uWobble', 1.15 * this.inkAmount)
      .set1f('uDepthBias', depthBias)
      .set3f('uInkColor', INK_RGB[0], INK_RGB[1], INK_RGB[2]);
  }

  _runInks(pool, p, baseScale) {
    const gl = this.gl;
    let lastAlpha = -1;
    for (const c of pool) {
      // Per-draw alpha is what smear ghosts ride on: the same outline drawn a few times
      // along the motion, each fainter than the last.
      if (c.alpha !== lastAlpha) { p.set1f('uInkAlpha', 0.94 * c.alpha); lastAlpha = c.alpha; }
      p.setMat4('uModel', c.model).set1f('uObjSeed', c.objSeed)
        .set1f('uInkScale', baseScale * c.widthScale);
      c.mesh.draw(gl.TRIANGLES);
    }
  }

  endFrame(post) {
    const gl = this.gl;

    // --- shadow map, before anything else touches the main target
    if (this.fancy && this.shadowCasters.len) {
      this.shadowMap.bind();
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      // Front-face culling pushes shadow acne to the back of geometry, where it's hidden.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const ps = this.progShadow.use();
      ps.setMat4('uLightViewProj', this.lightVP);
      for (const c of this.shadowCasters) {
        ps.setMat4('uModel', c.model);
        c.mesh.draw(gl.TRIANGLES);
      }
      gl.cullFace(gl.BACK);
    }

    this.rt.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.clearColor(PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const inkScale = this.pixelRatio * this.resolutionScale * this.inkAmount;

    // --- world fills
    const pf = this.progFill.use();
    this._setFillFrameUniforms(pf, this.viewProj, [0, 0, 0], 1, this.eye);
    this._runFills(this.fills, pf);

    // --- world ink
    const pi = this.progInk.use();
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this._setInkFrameUniforms(pi, this.view, this.proj, 0.9965);
    this._runInks(this.inks, pi, inkScale);

    // --- transparent quads (decals, muzzle flashes, ground smudges), far to near
    const list = [];
    for (const c of this.quads) list.push(c);
    list.sort((a, b) => b.depth - a.depth);
    if (list.length) {
      const pq = this.progQuad.use();
      pq.setMat4('uViewProj', this.viewProj)
        .set1f('uFogK', this.fogK)
        .set3f('uEye', this.eye.x, this.eye.y, this.eye.z)
        .set3f('uPaperColor', PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2]);
      for (const c of list) {
        pq.setMat4('uModel', c.model)
          .set4f('uTint', c.tint[0], c.tint[1], c.tint[2], c.tint[3])
          .set2f('uUvOffset', c.uvOff[0], c.uvOff[1])
          .set2f('uUvScale', c.uvScale[0], c.uvScale[1])
          .setTex('uTex', c.tex, 0);
        this.quadMesh.draw(gl.TRIANGLES);
      }
    }

    // --- viewmodel in a reserved slice at the front of the depth range
    if (this.vmFills.len || this.vmInks.len) {
      // This used to clear the depth buffer so walls couldn't cut through the hands. It
      // worked, and it also threw away the world's depth before it was resolved into the
      // texture depth of field reads - so DoF saw depth 1.0 everywhere, linearised that to
      // the far plane, and blurred the entire frame. Fancy mode was a permanent soft focus.
      //
      // Reserving the front of the depth range does the same job without the collateral.
      // Under the world's projection (near 0.05) everything it draws lands above 0.9, so
      // the viewmodel at 0..0.02 still wins every depth test and still occludes itself,
      // while the world's depth survives - and the hands linearise to about the near plane,
      // which is exactly where they should be for DoF.
      gl.depthMask(true);
      gl.depthRange(0, VM_DEPTH_SLICE);
      const origin = V.make(0, 0, 0);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      const pf2 = this.progFill.use();
      const wasFancy = this.fancy;
      this.fancy = false;
      this._setFillFrameUniforms(pf2, this.projVM, [this.eye.x, this.eye.y, this.eye.z], 0, origin, 0);
      this.fancy = wasFancy;
      this._runFills(this.vmFills, pf2);

      const pi2 = this.progInk.use();
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      this._setInkFrameUniforms(pi2, this.identity, this.projVM, 0.995);
      this._runInks(this.vmInks, pi2, inkScale * 1.3);
      gl.depthRange(0, 1);
    }

    // --- resolve, then the blur chain that feeds both bloom and depth of field
    this.rt.resolve();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(this.emptyVao);

    if (this.fancy) {
      const bw = this.blurA.width, bh = this.blurA.height;
      this.blurA.bind();
      this.progCopy.use().setTex('uTex', this.rt.tex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const pb = this.progBlur.use();
      this.blurB.bind();
      pb.setTex('uTex', this.blurA.tex, 0).set2f('uTexel', 1 / bw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.blurA.bind();
      pb.setTex('uTex', this.blurB.tex, 0).set2f('uTexel', 0, 1 / bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    const pp = this.progPost.use();
    pp.setTex('uScene', this.rt.tex, 0)
      .setTex('uPaper', this.texPaper, 1)
      .set2f('uRes', this.canvas.width, this.canvas.height)
      .set1f('uSeed', this.seed)
      .set1f('uScope', post?.scope ?? 0)
      .set1f('uScopeR', post?.scopeRadius ?? 0.34)
      .set1f('uDamage', clamp(post?.damage ?? 0, 0, 1))
      .set1f('uDeath', clamp(post?.death ?? 0, 0, 1))
      .set1f('uImpact', clamp(post?.impact ?? 0, 0, 1))
      .set2f('uImpactUv', post?.impactUv?.[0] ?? 0.5, post?.impactUv?.[1] ?? 0.5)
      .set1f('uImpactR', post?.impactR ?? 0.1)
      .set1f('uImpactWave', post?.impactWave ?? 0)
      .set1f('uImpactWaveR', post?.impactWaveR ?? 0.1)
      .set1f('uImpactWaveW', post?.impactWaveW ?? 0.05)
      .set1f('uFancy', this.fancy ? 1 : 0)
      .set1f('uNear', 0.05).set1f('uFar', 400)
      .set1f('uFocus', 11).set1f('uBloom', 0.16).set1f('uSaturation', 1.08)
      .setTex('uBlur', this.blurA.tex, 2)
      .setTex('uDepth', this.rt.depthTex, 3)
      .set3f('uPaperColor', PAPER_RGB[0], PAPER_RGB[1], PAPER_RGB[2]);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

export { QUAD_LAYOUT };
