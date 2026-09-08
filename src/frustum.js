// View frustum extracted from a view-projection matrix, for culling.
// Planes are stored as (a,b,c,d) with the normal pointing into the volume, so a point is
// inside when a*x + b*y + c*z + d >= 0.

export class Frustum {
  constructor() { this.p = new Float32Array(24); }

  /** m is a column-major view-projection matrix. */
  fromMatrix(m) {
    const p = this.p;
    // Rows of the matrix.
    const r0x = m[0], r0y = m[4], r0z = m[8],  r0w = m[12];
    const r1x = m[1], r1y = m[5], r1z = m[9],  r1w = m[13];
    const r2x = m[2], r2y = m[6], r2z = m[10], r2w = m[14];
    const r3x = m[3], r3y = m[7], r3z = m[11], r3w = m[15];
    const set = (i, a, b, c, d) => {
      const l = Math.hypot(a, b, c) || 1;
      p[i] = a / l; p[i + 1] = b / l; p[i + 2] = c / l; p[i + 3] = d / l;
    };
    set(0,  r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w);  // left
    set(4,  r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w);  // right
    set(8,  r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w);  // bottom
    set(12, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w);  // top
    set(16, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w);  // near
    set(20, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w);  // far
    return this;
  }

  /** Conservative AABB test using the positive vertex of each plane. */
  aabb(x0, y0, z0, x1, y1, z1) {
    const p = this.p;
    for (let i = 0; i < 24; i += 4) {
      const a = p[i], b = p[i + 1], c = p[i + 2], d = p[i + 3];
      // Farthest corner along the plane normal - if even that is behind, the box is out.
      const px = a >= 0 ? x1 : x0;
      const py = b >= 0 ? y1 : y0;
      const pz = c >= 0 ? z1 : z0;
      if (a * px + b * py + c * pz + d < 0) return false;
    }
    return true;
  }

  sphere(x, y, z, r) {
    const p = this.p;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * x + p[i + 1] * y + p[i + 2] * z + p[i + 3] < -r) return false;
    }
    return true;
  }
}
