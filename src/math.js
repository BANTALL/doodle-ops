// Small math toolbox: scalars, vec3 (plain objects for readability), mat4/mat3 (Float32Array, column-major).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** Framerate-independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angleTo = (from, to) => wrapAngle(to - from);
export const approachAngle = (a, b, maxStep) => a + clamp(angleTo(a, b), -maxStep, maxStep);
export const approach = (a, b, maxStep) => a + clamp(b - a, -maxStep, maxStep);

/** Deterministic 32-bit PRNG (mulberry32). Cheap, good enough, reproducible. */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Approximately gaussian (sum of 3 uniforms), clamped to +/-1.5 sigma-ish. */
  gauss() { return (this.next() + this.next() + this.next() - 1.5) * 1.1547; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

export const hash01 = (x, y = 0) => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- vec3

export const V = {
  make: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  set: (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; },
  copy: (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; },
  clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
  add: (o, a, b) => { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; },
  sub: (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; },
  scale: (o, a, s) => { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; },
  addScaled: (o, a, b, s) => { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o; },
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  len: (a) => Math.hypot(a.x, a.y, a.z),
  len2: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  dist2: (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; },
  distXZ: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  norm: (o, a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o; },
  cross: (o, a, b) => {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    o.x = x; o.y = y; o.z = z; return o;
  },
  lerp: (o, a, b, t) => { o.x = lerp(a.x, b.x, t); o.y = lerp(a.y, b.y, t); o.z = lerp(a.z, b.z, t); return o; },
};

/** Unit forward vector for a yaw/pitch pair (yaw 0 looks down -Z). */
export function dirFrom(yaw, pitch, out = V.make()) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** Yaw such that dirFrom(yaw,0) points along (dx,dz). */
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

// ---------------------------------------------------------------- mat4 (column-major)

export const M4 = {
  create: () => new Float32Array(16),

  identity(o) {
    o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o;
  },

  perspective(o, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    o.fill(0);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[15] = 1;
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n);
    return o;
  },

  mul(o, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return o;
  },

  /** First-person view matrix: inverse of T(pos)*Ry(yaw)*Rx(pitch)*Rz(roll). */
  fpsView(o, pos, yaw, pitch, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // Camera basis in world space (columns of the rotation part).
    const rx = cy * cr + sy * sp * sr, ry = cp * sr,  rz = -sy * cr + cy * sp * sr;
    const ux = -cy * sr + sy * sp * cr, uy = cp * cr, uz = sy * sr + cy * sp * cr;
    const fx = sy * cp,                 fy = -sp,     fz = cy * cp; // = -forward
    o[0] = rx; o[4] = ry; o[8]  = rz; o[12] = -(rx * pos.x + ry * pos.y + rz * pos.z);
    o[1] = ux; o[5] = uy; o[9]  = uz; o[13] = -(ux * pos.x + uy * pos.y + uz * pos.z);
    o[2] = fx; o[6] = fy; o[10] = fz; o[14] = -(fx * pos.x + fy * pos.y + fz * pos.z);
    o[3] = 0;  o[7] = 0;  o[11] = 0; o[15] = 1;
    return o;
  },

  /** T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(scale) */
  compose(o, pos, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
    const cy = Math.cos(yaw), syy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // Ry*Rx*Rz
    const m00 = cy * cr + syy * sp * sr, m01 = -cy * sr + syy * sp * cr, m02 = syy * cp;
    const m10 = cp * sr,                 m11 = cp * cr,                  m12 = -sp;
    const m20 = -syy * cr + cy * sp * sr, m21 = syy * sr + cy * sp * cr, m22 = cy * cp;
    o[0] = m00 * sx; o[1] = m10 * sx; o[2] = m20 * sx; o[3] = 0;
    o[4] = m01 * sy; o[5] = m11 * sy; o[6] = m21 * sy; o[7] = 0;
    o[8] = m02 * sz; o[9] = m12 * sz; o[10] = m22 * sz; o[11] = 0;
    o[12] = pos.x; o[13] = pos.y; o[14] = pos.z; o[15] = 1;
    return o;
  },

  /** Transpose of the inverse of the upper-left 3x3, for correct normals under non-uniform scale. */
  normalMat3(o3, m) {
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    let det = a * A + b * B + c * C;
    det = det === 0 ? 0 : 1 / det;
    o3[0] = A * det;                 o3[1] = B * det;                 o3[2] = C * det;
    o3[3] = (c * h - b * i) * det;   o3[4] = (a * i - c * g) * det;   o3[5] = (b * g - a * h) * det;
    o3[6] = (b * f - c * e) * det;   o3[7] = (c * d - a * f) * det;   o3[8] = (a * e - b * d) * det;
    return o3;
  },

  /** Project a world point with a view-projection matrix. Returns {x,y} in NDC plus w. */
  projectPoint(m, p, out = { x: 0, y: 0, w: 0 }) {
    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    out.w = w;
    out.x = (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / (w || 1e-6);
    out.y = (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / (w || 1e-6);
    return out;
  },
};

export const M3 = { create: () => new Float32Array(9) };
