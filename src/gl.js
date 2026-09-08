// Thin WebGL2 wrapper: programs with cached uniform locations, interleaved VAO meshes,
// textures from canvases, and a render target. Nothing clever, just less boilerplate.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,       // we run our own resolve-free pipeline; MSAA on the FBO instead
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  return gl;
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
    throw new Error(`Shader compile failed (${label}):\n${log}\n${numbered}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vsSrc, fsSrc, label = 'program') {
    this.gl = gl;
    this.label = label;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program link failed (${label}): ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this.u = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      this.u.set(name, gl.getUniformLocation(p, name));
    }
  }

  use() { this.gl.useProgram(this.p); return this; }
  loc(name) { return this.u.get(name); }

  set1f(n, v) { const l = this.u.get(n); if (l) this.gl.uniform1f(l, v); return this; }
  set1i(n, v) { const l = this.u.get(n); if (l) this.gl.uniform1i(l, v); return this; }
  set2f(n, a, b) { const l = this.u.get(n); if (l) this.gl.uniform2f(l, a, b); return this; }
  set3f(n, a, b, c) { const l = this.u.get(n); if (l) this.gl.uniform3f(l, a, b, c); return this; }
  set4f(n, a, b, c, d) { const l = this.u.get(n); if (l) this.gl.uniform4f(l, a, b, c, d); return this; }
  setMat4(n, m) { const l = this.u.get(n); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  setMat3(n, m) { const l = this.u.get(n); if (l) this.gl.uniformMatrix3fv(l, false, m); return this; }
  set3fv(n, arr) { const l = this.u.get(n); if (l) this.gl.uniform3fv(l, arr); return this; }
  setTex(n, tex, unit) {
    const l = this.u.get(n);
    if (!l) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(l, unit);
    return this;
  }
}

/**
 * Interleaved float mesh. `layout` is an ordered list of component counts; attribute
 * locations match the array index, matching `layout(location=N)` in the shaders.
 */
export class Mesh {
  constructor(gl, layout, vertices, indices = null, dynamic = false) {
    this.gl = gl;
    this.layout = layout;
    this.stride = layout.reduce((a, b) => a + b, 0) * 4;
    this.dynamic = dynamic;
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    this.ibo = null;
    this.count = 0;
    this.indexed = false;
    this.capacity = 0;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    let offset = 0;
    for (let i = 0; i < layout.length; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, layout[i], gl.FLOAT, false, this.stride, offset);
      offset += layout[i] * 4;
    }
    if (vertices) this.setVertices(vertices);
    if (indices) this.setIndices(indices);
    gl.bindVertexArray(null);
  }

  setVertices(data) {
    const gl = this.gl;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (this.dynamic && arr.byteLength <= this.capacity) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, arr, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      this.capacity = arr.byteLength;
    }
    if (!this.indexed) this.count = arr.length / (this.stride / 4);
    gl.bindVertexArray(null);
    return this;
  }

  /** Upload only the first `floatCount` floats of a scratch buffer (for streamed geometry). */
  streamVertices(scratch, floatCount) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const bytes = floatCount * 4;
    if (bytes > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, Math.max(bytes, this.capacity * 2 || bytes), gl.DYNAMIC_DRAW);
      this.capacity = Math.max(bytes, this.capacity);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch, 0, floatCount);
    this.count = floatCount / (this.stride / 4);
    gl.bindVertexArray(null);
    return this;
  }

  setIndices(data) {
    const gl = this.gl;
    const arr = data instanceof Uint32Array ? data : new Uint32Array(data);
    if (!this.ibo) this.ibo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.indexed = true;
    this.count = arr.length;
    gl.bindVertexArray(null);
    return this;
  }

  draw(mode) {
    const gl = this.gl;
    if (this.count === 0) return;
    gl.bindVertexArray(this.vao);
    if (this.indexed) gl.drawElements(mode ?? gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(mode ?? gl.TRIANGLES, 0, this.count);
  }

  /** Draw a subset of an indexed mesh (used to draw one box edge-set out of a shared buffer). */
  drawRange(mode, start, count) {
    const gl = this.gl;
    if (count === 0) return;
    gl.bindVertexArray(this.vao);
    if (this.indexed) gl.drawElements(mode ?? gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4);
    else gl.drawArrays(mode ?? gl.TRIANGLES, start, count);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vbo);
    if (this.ibo) gl.deleteBuffer(this.ibo);
  }
}

export function textureFromCanvas(gl, canvas, { wrap = 'repeat', mipmap = true, filter = 'linear' } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  const w = wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  if (mipmap) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === 'nearest' ? gl.NEAREST_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const max = Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * Depth-only target for the shadow map. Configured for hardware comparison sampling, so
 * the fill shader can use sampler2DShadow and get free PCF on the lookup.
 */
export class ShadowTarget {
  constructor(gl, size) {
    this.gl = gl;
    this.size = size;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
  }
}

/**
 * Offscreen colour+depth target. Uses a multisampled renderbuffer pair that blits into a
 * sampleable texture when MSAA is requested - our ink lines alias badly without it.
 */
export class RenderTarget {
  constructor(gl, width, height, samples = 0, depthTexture = false) {
    this.gl = gl;
    this.samples = samples;
    this.wantDepthTex = depthTexture;
    this.depthTex = depthTexture ? gl.createTexture() : null;
    this.width = 0; this.height = 0;
    this.tex = gl.createTexture();
    this.fboResolve = gl.createFramebuffer();
    this.fboMS = samples > 0 ? gl.createFramebuffer() : null;
    this.rbColor = samples > 0 ? gl.createRenderbuffer() : null;
    this.rbDepth = gl.createRenderbuffer();
    this.resize(width, height);
  }

  get drawFbo() { return this.fboMS ?? this.fboResolve; }

  resize(width, height) {
    width = Math.max(1, width | 0); height = Math.max(1, height | 0);
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboResolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);

    if (this.depthTex) {
      // A sampleable depth buffer, for depth of field. With MSAA on it is filled by
      // blitting the multisampled depth across in resolve().
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboResolve);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    }

    if (this.samples > 0) {
      const maxS = gl.getParameter(gl.MAX_SAMPLES);
      const s = Math.min(this.samples, maxS);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, gl.RGBA8, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboMS);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.rbColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rbDepth);
    } else if (!this.depthTex) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboResolve);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rbDepth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Resolve MSAA into the sampleable texture. No-op when MSAA is off. */
  resolve() {
    if (!this.fboMS) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboMS);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboResolve);
    const bits = gl.COLOR_BUFFER_BIT | (this.depthTex ? gl.DEPTH_BUFFER_BIT : 0);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, bits, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
