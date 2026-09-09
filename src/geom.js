// Geometry builders. Two parallel streams for everything we draw: filled triangles and
// the ink strokes that outline them.

import { Mesh } from './gl.js';

export const FILL_LAYOUT = [3, 3, 2, 1];   // pos, normal, uv, material
export const INK_LAYOUT = [3, 3, 2, 2];    // p0, p1, (side,t), (width,capFlags)
export const QUAD_LAYOUT = [3, 2];         // pos, uv

/** Longest ink segment before we subdivide. Shorter segments = more places to wobble. */
const INK_SEG = 1.1;
const INK_MAX_SEGS = 10;

export class FillBuilder {
  constructor() { this.v = []; this.i = []; this.n = 0; }

  /** Reuse the builder across frames instead of reallocating its arrays. */
  reset() { this.v.length = 0; this.i.length = 0; this.n = 0; return this; }

  vertex(x, y, z, nx, ny, nz, u, vv, mat) {
    this.v.push(x, y, z, nx, ny, nz, u, vv, mat);
    return this.n++;
  }

  /** Quad wound a->b->c->d (counter-clockwise seen from the normal side). */
  quad(a, b, c, d, nrm, mat, uv) {
    const base = this.n;
    const pts = [a, b, c, d];
    for (let k = 0; k < 4; k++) {
      this.vertex(pts[k][0], pts[k][1], pts[k][2], nrm[0], nrm[1], nrm[2], uv[k][0], uv[k][1], mat);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Axis-aligned box from min/max. `faces` masks out sides we never see
   * (bit order: +X -X +Y -Y +Z -Z). UVs run in world units so texture detail
   * stays a consistent size regardless of the box.
   */
  box(min, max, mat, faces = 0x3f, uvScale = 1) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const s = uvScale;
    const P = (x, y, z) => [x, y, z];
    if (faces & 1) this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [1, 0, 0], mat,
      [[z1 * s, y0 * s], [z0 * s, y0 * s], [z0 * s, y1 * s], [z1 * s, y1 * s]]);
    if (faces & 2) this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [-1, 0, 0], mat,
      [[z0 * s, y0 * s], [z1 * s, y0 * s], [z1 * s, y1 * s], [z0 * s, y1 * s]]);
    if (faces & 4) this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [0, 1, 0], mat,
      [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]]);
    if (faces & 8) this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0], mat,
      [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]]);
    if (faces & 16) this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1], mat,
      [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]]);
    if (faces & 32) this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [0, 0, -1], mat,
      [[x1 * s, y0 * s], [x0 * s, y0 * s], [x0 * s, y1 * s], [x1 * s, y1 * s]]);
  }

  get empty() { return this.i.length === 0; }

  toMesh(gl, dynamic = false) {
    return new Mesh(gl, FILL_LAYOUT, new Float32Array(this.v), new Uint32Array(this.i), dynamic);
  }
}

export class InkBuilder {
  constructor() { this.v = []; this.i = []; this.n = 0; }

  reset() { this.v.length = 0; this.i.length = 0; this.n = 0; return this; }

  _seg(ax, ay, az, bx, by, bz, width, capFlags) {
    const base = this.n;
    // side/t corners: (-1,0) (1,0) (1,1) (-1,1)
    const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (const [side, t] of corners) {
      this.v.push(ax, ay, az, bx, by, bz, side, t, width, capFlags);
      this.n++;
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** One drawn line, split into wobble-able pieces. Only the true ends get overshoot. */
  edge(a, b, width = 2.0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const segs = Math.max(1, Math.min(INK_MAX_SEGS, Math.round(len / INK_SEG)));
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const cap = (s === 0 ? 1 : 0) + (s === segs - 1 ? 2 : 0);
      this._seg(
        a[0] + dx * t0, a[1] + dy * t0, a[2] + dz * t0,
        a[0] + dx * t1, a[1] + dy * t1, a[2] + dz * t1,
        width, cap);
    }
  }

  /** Outline the 12 edges of an axis-aligned box. `edgeMask` skips edges buried in walls. */
  box(min, max, width = 2.0, edgeMask = 0xfff) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const c = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const E = [
      [0, 1], [1, 2], [2, 3], [3, 0],   // bottom ring
      [4, 5], [5, 6], [6, 7], [7, 4],   // top ring
      [0, 4], [1, 5], [2, 6], [3, 7],   // uprights
    ];
    for (let k = 0; k < 12; k++) {
      if (edgeMask & (1 << k)) this.edge(c[E[k][0]], c[E[k][1]], width);
    }
  }

  polyline(points, width = 2.0, closed = false) {
    for (let k = 0; k < points.length - 1; k++) this.edge(points[k], points[k + 1], width);
    if (closed && points.length > 2) this.edge(points[points.length - 1], points[0], width);
  }

  get empty() { return this.i.length === 0; }

  toMesh(gl, dynamic = false) {
    return new Mesh(gl, INK_LAYOUT, new Float32Array(this.v), new Uint32Array(this.i), dynamic);
  }
}

/** Unit cube centred on the origin - the workhorse for bots, crates, guns and shards. */
export function unitBoxMeshes(gl, inkWidth = 2.2) {
  const f = new FillBuilder();
  f.box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], 0, 0x3f, 1);
  const i = new InkBuilder();
  i.box([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], inkWidth);
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/** Unit quad in the XY plane, centred, for billboards and decals. */
export function unitQuadMesh(gl) {
  const v = new Float32Array([
    -0.5, -0.5, 0, 0, 0,
     0.5, -0.5, 0, 1, 0,
     0.5,  0.5, 0, 1, 1,
    -0.5,  0.5, 0, 0, 1,
  ]);
  return new Mesh(gl, QUAD_LAYOUT, v, new Uint32Array([0, 1, 2, 0, 2, 3]));
}

/**
 * A flat "cut-out" shape: a filled polygon in the XY plane plus its outline. Used for
 * cartoon props (gun silhouettes, knife blade) that read better as drawn shapes than boxes.
 */
export function shapeMeshes(gl, polygon, mat = 0, inkWidth = 2.2, thickness = 0.02) {
  const f = new FillBuilder();
  const i = new InkBuilder();
  const n = polygon.length;
  const half = thickness * 0.5;
  for (const z of [half, -half]) {
    const nz = z > 0 ? 1 : -1;
    const base = f.n;
    for (const p of polygon) f.vertex(p[0], p[1], z, 0, 0, nz, p[0], p[1], mat);
    for (let k = 1; k < n - 1; k++) {
      if (nz > 0) f.i.push(base, base + k, base + k + 1);
      else f.i.push(base, base + k + 1, base + k);
    }
  }
  // Rim so the shape has some body when seen edge-on.
  for (let k = 0; k < n; k++) {
    const a = polygon[k], b = polygon[(k + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey) || 1;
    f.quad([a[0], a[1], -half], [b[0], b[1], -half], [b[0], b[1], half], [a[0], a[1], half],
      [ey / L, -ex / L, 0], mat, [[0, 0], [L, 0], [L, thickness], [0, thickness]]);
    i.edge([a[0], a[1], half], [b[0], b[1], half], inkWidth);
    i.edge([a[0], a[1], -half], [b[0], b[1], -half], inkWidth * 0.75);
  }
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/**
 * Box placed with an arbitrary position/rotation/size, baked straight into the builders.
 * Weapons are assembled from a few dozen of these at load time so each one ends up as a
 * single draw call.
 */
export function pushOrientedBox(fill, ink, opts) {
  const {
    pos = [0, 0, 0], size = [1, 1, 1], rot = [0, 0, 0],
    mat = 0, inkWidth = 1.6, faces = 0x3f, edgeMask = 0xfff, uvScale = 1,
  } = opts;
  const [rx, ry, rz] = rot;
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);
  // Ry * Rx * Rz, matching M4.compose so animated and baked parts agree.
  const m00 = cy * cz + syr * sxr * szr, m01 = -cy * szr + syr * sxr * cz, m02 = syr * cx;
  const m10 = cx * szr,                  m11 = cx * cz,                    m12 = -sxr;
  const m20 = -syr * cz + cy * sxr * szr, m21 = syr * szr + cy * sxr * cz, m22 = cy * cx;
  const tx = (x, y, z) => [
    m00 * x + m01 * y + m02 * z + pos[0],
    m10 * x + m11 * y + m12 * z + pos[1],
    m20 * x + m21 * y + m22 * z + pos[2],
  ];
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const c = [
    tx(-hx, -hy, -hz), tx(hx, -hy, -hz), tx(hx, -hy, hz), tx(-hx, -hy, hz),
    tx(-hx, hy, -hz), tx(hx, hy, -hz), tx(hx, hy, hz), tx(-hx, hy, hz),
  ];
  const nrm = (x, y, z) => [m00 * x + m01 * y + m02 * z, m10 * x + m11 * y + m12 * z, m20 * x + m21 * y + m22 * z];
  const s = uvScale;
  const uvQ = (a, b) => [[0, 0], [a * s, 0], [a * s, b * s], [0, b * s]];

  if (fill) {
    if (faces & 1)  fill.quad(c[2], c[1], c[5], c[6], nrm(1, 0, 0), mat, uvQ(size[2], size[1]));
    if (faces & 2)  fill.quad(c[0], c[3], c[7], c[4], nrm(-1, 0, 0), mat, uvQ(size[2], size[1]));
    if (faces & 4)  fill.quad(c[7], c[6], c[5], c[4], nrm(0, 1, 0), mat, uvQ(size[0], size[2]));
    if (faces & 8)  fill.quad(c[0], c[1], c[2], c[3], nrm(0, -1, 0), mat, uvQ(size[0], size[2]));
    if (faces & 16) fill.quad(c[3], c[2], c[6], c[7], nrm(0, 0, 1), mat, uvQ(size[0], size[1]));
    if (faces & 32) fill.quad(c[1], c[0], c[4], c[5], nrm(0, 0, -1), mat, uvQ(size[0], size[1]));
  }
  if (ink) {
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (let k = 0; k < 12; k++) if (edgeMask & (1 << k)) ink.edge(c[E[k][0]], c[E[k][1]], inkWidth);
  }
}

/**
 * A flat cut-out bounded by two edges running the same direction (a "ribbon"): the top
 * edge and the bottom edge, triangulated as a strip between them. Unlike shapeMeshes it
 * makes no assumption about the polygon being star-shaped, so a silhouette with jagged
 * spikes and a trailing tail triangulates correctly.
 *
 * Used for hand-drawn animation cels, where each frame is a genuinely different outline.
 */
export function ribbon(fill, ink, top, bot, mat, inkWidth = 2.4, thickness = 0.02) {
  const n = Math.min(top.length, bot.length);
  if (n < 2) return;
  const h = thickness * 0.5;

  for (const z of [h, -h]) {
    const front = z > 0;
    const base = fill.n;
    for (let i = 0; i < n; i++) {
      fill.vertex(top[i][0], top[i][1], z, 0, 0, front ? 1 : -1, top[i][0], top[i][1], mat);
      fill.vertex(bot[i][0], bot[i][1], z, 0, 0, front ? 1 : -1, bot[i][0], bot[i][1], mat);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (front) fill.i.push(a, b, c, b, d, c);
      else fill.i.push(a, c, b, b, c, d);
    }
  }

  // Rim, so the cut-out has a little body when the view catches it edge-on.
  const rimQuad = (p, q, nx, ny) => fill.quad(
    [p[0], p[1], -h], [q[0], q[1], -h], [q[0], q[1], h], [p[0], p[1], h],
    [nx, ny, 0], mat, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let i = 0; i < n - 1; i++) {
    for (const edge of [top, bot]) {
      const p = edge[i], q = edge[i + 1];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const L = Math.hypot(ex, ey) || 1;
      rimQuad(p, q, ey / L, -ex / L);
    }
  }

  if (ink) {
    for (const edge of [top, bot]) {
      for (let i = 0; i < n - 1; i++) {
        ink.edge([edge[i][0], edge[i][1], h], [edge[i + 1][0], edge[i + 1][1], h], inkWidth);
      }
    }
    ink.edge([top[0][0], top[0][1], h], [bot[0][0], bot[0][1], h], inkWidth);
    ink.edge([top[n - 1][0], top[n - 1][1], h], [bot[n - 1][0], bot[n - 1][1], h], inkWidth);
  }
}
