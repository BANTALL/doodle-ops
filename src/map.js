// Backrooms-style level: mostly open floorplate chopped up by random wall runs, which is
// what actually gives that "endless office nobody finished" feeling. Also owns collision,
// raycasting and the nav grid the bots think with.

import { Rng, V, clamp, smoothstep } from './math.js';
import { FillBuilder, InkBuilder } from './geom.js';
import { MAT } from './renderer.js';

export const CELL = 3.6;
export const WALL_H = 3.15;
/** Cells per render chunk. Chunks are the unit of frustum and occlusion culling. */
export const CHUNK = 6;

const WALL = 1, OPEN = 0;

// --- ports of the shader's noise, so JS and GLSL agree on where the colouring stops ---
const fract = (v) => v - Math.floor(v);

function hash21(x, y) {
  let px = fract(x * 0.1031), py = fract(y * 0.1030), pz = fract(x * 0.0973);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px = fract(px + d); py = fract(py + d); pz = fract(pz + d);
  return fract((px + py) * pz);
}

function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash21(xi, yi), b = hash21(xi + 1, yi);
  const c = hash21(xi, yi + 1), d = hash21(xi + 1, yi + 1);
  const top = a + (b - a) * ux, bot = c + (d - c) * ux;
  return top + (bot - top) * uy;
}

function fbm2(x, y) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < 4; i++) {
    s += vnoise(x, y) * a;
    n += a; a *= 0.5;
    x = x * 2.03 + 17.1; y = y * 2.03 + 17.1;
  }
  return s / n;
}

export class GameMap {
  constructor(seed = 1, w = 30, h = 30) {
    this.rng = new Rng(seed);
    this.w = w; this.h = h;
    this.cells = new Uint8Array(w * h).fill(WALL);
    this.sizeX = w * CELL;
    this.sizeZ = h * CELL;
    this.wallH = WALL_H;
    this.openCells = [];
    this.lights = [];
    this._generate();
    this._collectOpen();
    this._buildDistanceToWall();

    // The colouring sweep runs across the map on a diagonal through its centre.
    const a = this.rng.range(0, Math.PI * 2);
    this.colorOrigin = [this.sizeX * 0.5, this.sizeZ * 0.5];
    this.colorDir = [Math.cos(a), Math.sin(a)];
    this.colorSlope = 0.040;
  }

  idx(i, j) { return j * this.w + i; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  isWall(i, j) { return !this.inside(i, j) || this.cells[this.idx(i, j)] === WALL; }
  isOpen(i, j) { return this.inside(i, j) && this.cells[this.idx(i, j)] === OPEN; }

  cellOf(x, z) { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }
  cellCenter(i, j, out = V.make()) { return V.set(out, (i + 0.5) * CELL, 0, (j + 0.5) * CELL); }

  /** Solid at a world XZ position (used by collision and by bots when nudging around). */
  solidAt(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    return this.isWall(i, j);
  }

  // ------------------------------------------------------------ generation

  _generate() {
    const { w, h, rng, cells } = this;
    cells.fill(OPEN);

    // Solid border.
    for (let i = 0; i < w; i++) { cells[this.idx(i, 0)] = WALL; cells[this.idx(i, h - 1)] = WALL; }
    for (let j = 0; j < h; j++) { cells[this.idx(0, j)] = WALL; cells[this.idx(w - 1, j)] = WALL; }

    // Partition the floorplate into rooms with doorways. This is what makes it read as an
    // office that goes on forever rather than one big hall with obstacles in it.
    this._partition(1, 1, w - 1, h - 1, 0);

    // Loose wall runs on top of the partitions: half-built stud walls, jutting corners,
    // the bits that make the layout feel wrong.
    const runs = Math.round(w * h * 0.035);
    for (let r = 0; r < runs; r++) {
      let i = rng.int(2, w - 3), j = rng.int(2, h - 3);
      let dx = 0, dz = 0;
      if (rng.chance(0.5)) dx = rng.sign(); else dz = rng.sign();
      const len = rng.int(2, 7);
      for (let s = 0; s < len; s++) {
        if (!this.inside(i, j)) break;
        cells[this.idx(i, j)] = WALL;
        i += dx; j += dz;
      }
    }

    // Free-standing pillars and small blocks.
    const blocks = Math.round(w * h * 0.02);
    for (let b = 0; b < blocks; b++) {
      const bi = rng.int(2, w - 4), bj = rng.int(2, h - 4);
      const bw = rng.int(1, 2), bh = rng.int(1, 2);
      for (let i = bi; i < bi + bw; i++) for (let j = bj; j < bj + bh; j++) {
        if (this.inside(i, j)) cells[this.idx(i, j)] = WALL;
      }
    }

    // Punch extra doorways so no run seals a room off.
    for (let k = 0; k < Math.round(runs * 2.2); k++) {
      const i = rng.int(1, w - 2), j = rng.int(1, h - 2);
      if (!this.isWall(i, j)) continue;
      const horiz = this.isWall(i - 1, j) && this.isWall(i + 1, j) && this.isOpen(i, j - 1) && this.isOpen(i, j + 1);
      const vert = this.isWall(i, j - 1) && this.isWall(i, j + 1) && this.isOpen(i - 1, j) && this.isOpen(i + 1, j);
      if (horiz || vert) cells[this.idx(i, j)] = OPEN;
    }

    this._carveAlcoves();
    this._ensureConnected();
    this._removeNooks();
    this._placeLights();
  }

  /** Recursive split with doorways. Stops once a room is small enough to fight in. */
  _partition(x0, z0, x1, z1, depth) {
    const { rng, cells } = this;
    const w = x1 - x0, h = z1 - z0;
    const MIN = 4;
    if (depth > 6 || (w < MIN * 2 + 1 && h < MIN * 2 + 1)) return;

    let vertical;
    if (w >= MIN * 2 + 1 && h >= MIN * 2 + 1) vertical = w === h ? rng.chance(0.5) : w > h;
    else vertical = w >= MIN * 2 + 1;

    if (vertical) {
      const sx = rng.int(x0 + MIN, x1 - MIN - 1);
      for (let j = z0; j < z1; j++) cells[this.idx(sx, j)] = WALL;
      const doors = rng.int(1, 2);
      for (let d = 0; d < doors; d++) {
        const dj = rng.int(z0, z1 - 1);
        cells[this.idx(sx, dj)] = OPEN;
        if (rng.chance(0.35) && dj + 1 < z1) cells[this.idx(sx, dj + 1)] = OPEN;
      }
      this._partition(x0, z0, sx, z1, depth + 1);
      this._partition(sx + 1, z0, x1, z1, depth + 1);
    } else {
      const sz = rng.int(z0 + MIN, z1 - MIN - 1);
      for (let i = x0; i < x1; i++) cells[this.idx(i, sz)] = WALL;
      const doors = rng.int(1, 2);
      for (let d = 0; d < doors; d++) {
        const di = rng.int(x0, x1 - 1);
        cells[this.idx(di, sz)] = OPEN;
        if (rng.chance(0.35) && di + 1 < x1) cells[this.idx(di + 1, sz)] = OPEN;
      }
      this._partition(x0, z0, x1, sz, depth + 1);
      this._partition(x0, sz + 1, x1, z1, depth + 1);
    }
  }

  /** Small dead-end rooms hanging off the main space - good places to find a gun. */
  _carveAlcoves() {
    const { rng } = this;
    const n = Math.round(this.w * this.h * 0.006);
    for (let k = 0; k < n; k++) {
      const ci = rng.int(3, this.w - 5), cj = rng.int(3, this.h - 5);
      const rw = rng.int(2, 3), rh = rng.int(2, 3);
      for (let i = ci; i < ci + rw; i++) for (let j = cj; j < cj + rh; j++) {
        if (i > 0 && j > 0 && i < this.w - 1 && j < this.h - 1) this.cells[this.idx(i, j)] = OPEN;
      }
    }
  }

  /**
   * Flood from the biggest open region across every cell (walls cost extra), then walk the
   * parent chain back from each stranded pocket, opening cells as we go. One pass, and the
   * whole level is guaranteed reachable.
   */
  _ensureConnected() {
    const { w, h } = this;
    const region = new Int32Array(w * h).fill(-1);
    let best = -1, bestSize = 0, regionCount = 0;
    const queue = new Int32Array(w * h);

    for (let s = 0; s < w * h; s++) {
      if (this.cells[s] === WALL || region[s] !== -1) continue;
      let head = 0, tail = 0, size = 0;
      queue[tail++] = s; region[s] = regionCount;
      while (head < tail) {
        const c = queue[head++]; size++;
        const ci = c % w, cj = (c / w) | 0;
        const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
        for (const [ni, nj] of nb) {
          if (!this.inside(ni, nj)) continue;
          const n = this.idx(ni, nj);
          if (this.cells[n] === WALL || region[n] !== -1) continue;
          region[n] = regionCount; queue[tail++] = n;
        }
      }
      if (size > bestSize) { bestSize = size; best = regionCount; }
      regionCount++;
    }
    if (regionCount <= 1) return;

    // BFS across everything from the main region, remembering how we got there.
    const parent = new Int32Array(w * h).fill(-2);
    let head = 0, tail = 0;
    for (let s = 0; s < w * h; s++) if (region[s] === best) { parent[s] = -1; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++];
      const ci = c % w, cj = (c / w) | 0;
      const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
      for (const [ni, nj] of nb) {
        if (ni <= 0 || nj <= 0 || ni >= w - 1 || nj >= h - 1) continue;
        const n = this.idx(ni, nj);
        if (parent[n] !== -2) continue;
        parent[n] = c; queue[tail++] = n;
      }
    }
    for (let s = 0; s < w * h; s++) {
      if (this.cells[s] === WALL || region[s] === best || region[s] === -1) continue;
      let c = s;
      let guard = 0;
      while (c >= 0 && parent[c] !== -1 && guard++ < w * h) { this.cells[c] = OPEN; c = parent[c]; }
    }
  }

  /** Fill single-cell holes that a player would just get stuck in. */
  _removeNooks() {
    const toFill = [];
    for (let j = 1; j < this.h - 1; j++) {
      for (let i = 1; i < this.w - 1; i++) {
        if (!this.isOpen(i, j)) continue;
        let walls = 0;
        if (this.isWall(i - 1, j)) walls++;
        if (this.isWall(i + 1, j)) walls++;
        if (this.isWall(i, j - 1)) walls++;
        if (this.isWall(i, j + 1)) walls++;
        if (walls === 4) toFill.push(this.idx(i, j));
      }
    }
    for (const c of toFill) this.cells[c] = WALL;
  }

  _placeLights() {
    for (let j = 2; j < this.h - 2; j += 3) {
      for (let i = 2; i < this.w - 2; i += 3) {
        if (!this.isOpen(i, j)) continue;
        // Only where there is a bit of room, so panels don't hang inside a doorway.
        let open = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (this.isOpen(i + a, j + b)) open++;
        if (open < 6) continue;
        this.lights.push({ i, j });
      }
    }
  }

  _collectOpen() {
    this.openCells.length = 0;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) if (this.isOpen(i, j)) this.openCells.push(this.idx(i, j));
    }
  }

  /** Chebyshev-ish distance from every open cell to the nearest wall - used to pick spawns
   *  and item spots that aren't jammed in a corner. */
  _buildDistanceToWall() {
    const { w, h } = this;
    this.distWall = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (let s = 0; s < w * h; s++) {
      if (this.cells[s] === WALL) { this.distWall[s] = 0; queue[tail++] = s; }
      else this.distWall[s] = 255;
    }
    while (head < tail) {
      const c = queue[head++];
      const ci = c % w, cj = (c / w) | 0;
      const d = this.distWall[c];
      const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
      for (const [ni, nj] of nb) {
        if (!this.inside(ni, nj)) continue;
        const n = this.idx(ni, nj);
        if (this.distWall[n] > d + 1) { this.distWall[n] = d + 1; queue[tail++] = n; }
      }
    }
  }

  // ------------------------------------------------------------ queries

  /** Circle-vs-grid resolution. Moves `pos` by (dx,dz), sliding along walls. */
  moveCircle(pos, dx, dz, radius) {
    let hit = false;
    if (dx !== 0) { const nx = pos.x + dx; if (this._circleFree(nx, pos.z, radius)) pos.x = nx; else hit = true; }
    if (dz !== 0) { const nz = pos.z + dz; if (this._circleFree(pos.x, nz, radius)) pos.z = nz; else hit = true; }
    return hit;
  }

  _circleFree(x, z, r) {
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.isWall(i, j)) continue;
        const cx = clamp(x, i * CELL, (i + 1) * CELL);
        const cz = clamp(z, j * CELL, (j + 1) * CELL);
        const ddx = x - cx, ddz = z - cz;
        if (ddx * ddx + ddz * ddz < r * r) return false;
      }
    }
    return true;
  }

  /**
   * DDA raycast against walls, floor and ceiling.
   * Returns { dist, nx, ny, nz, kind } where kind is 'wall' | 'floor' | 'ceil' | 'none'.
   */
  raycast(origin, dir, maxDist, out = {}) {
    out.kind = 'none'; out.dist = maxDist;
    out.nx = 0; out.ny = 0; out.nz = 0;

    // Floor / ceiling first: they cap how far a wall hit can matter.
    let vertT = Infinity, vertN = 0;
    if (dir.y < -1e-6) { const t = (0 - origin.y) / dir.y; if (t > 0) { vertT = t; vertN = 1; } }
    else if (dir.y > 1e-6) { const t = (this.wallH - origin.y) / dir.y; if (t > 0) { vertT = t; vertN = -1; } }

    let i = Math.floor(origin.x / CELL), j = Math.floor(origin.z / CELL);
    if (this.isWall(i, j)) { out.kind = 'wall'; out.dist = 0; out.nx = -dir.x; out.nz = -dir.z; return out; }

    const stepI = dir.x > 0 ? 1 : -1, stepJ = dir.z > 0 ? 1 : -1;
    const invX = dir.x !== 0 ? 1 / Math.abs(dir.x) : Infinity;
    const invZ = dir.z !== 0 ? 1 / Math.abs(dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? ((dir.x > 0 ? (i + 1) * CELL - origin.x : origin.x - i * CELL)) * invX : Infinity;
    let tMaxZ = dir.z !== 0 ? ((dir.z > 0 ? (j + 1) * CELL - origin.z : origin.z - j * CELL)) * invZ : Infinity;
    const tDeltaX = CELL * invX, tDeltaZ = CELL * invZ;

    let t = 0, axis = 0;
    const limit = Math.min(maxDist, vertT);
    let guard = 0;
    while (t <= limit && guard++ < 4096) {
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; i += stepI; axis = 0; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; j += stepJ; axis = 1; }
      if (t > limit) break;
      if (this.isWall(i, j)) {
        out.kind = 'wall'; out.dist = t;
        if (axis === 0) { out.nx = -stepI; out.nz = 0; } else { out.nx = 0; out.nz = -stepJ; }
        out.ny = 0;
        return out;
      }
    }

    if (vertT <= maxDist) {
      out.kind = vertN > 0 ? 'floor' : 'ceil';
      out.dist = vertT; out.ny = vertN;
      return out;
    }
    return out;
  }

  /** True if nothing solid sits between two points (eye-height line of sight). */
  lineOfSight(a, b, maxDist = 200) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    if (d > maxDist) return false;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    const hit = this.raycast(a, dir, d - 0.05, this._losOut || (this._losOut = {}));
    return hit.kind === 'none' || hit.dist >= d - 0.06;
  }

  // ------------------------------------------------------------ nav

  /**
   * Breadth-first distance field toward a goal cell. Bots descend it, which gives proper
   * corner-hugging paths for free and costs almost nothing to rebuild.
   */
  buildFlow(goalIdx, field = null) {
    const n = this.w * this.h;
    const f = field && field.length === n ? field : new Uint16Array(n);
    f.fill(65535);
    if (this.cells[goalIdx] === WALL) {
      // Snap to the nearest open cell so a goal inside a wall still works.
      let best = -1, bestD = Infinity;
      const gi = goalIdx % this.w, gj = (goalIdx / this.w) | 0;
      for (const c of this.openCells) {
        const ci = c % this.w, cj = (c / this.w) | 0;
        const d = (ci - gi) ** 2 + (cj - gj) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best < 0) return f;
      goalIdx = best;
    }
    const queue = this._navQueue || (this._navQueue = new Int32Array(n));
    let head = 0, tail = 0;
    f[goalIdx] = 0; queue[tail++] = goalIdx;
    while (head < tail) {
      const c = queue[head++];
      const d = f[c] + 1;
      const ci = c % this.w, cj = (c / this.w) | 0;
      if (ci > 0) { const k = c - 1; if (this.cells[k] === OPEN && f[k] > d) { f[k] = d; queue[tail++] = k; } }
      if (ci < this.w - 1) { const k = c + 1; if (this.cells[k] === OPEN && f[k] > d) { f[k] = d; queue[tail++] = k; } }
      if (cj > 0) { const k = c - this.w; if (this.cells[k] === OPEN && f[k] > d) { f[k] = d; queue[tail++] = k; } }
      if (cj < this.h - 1) { const k = c + this.w; if (this.cells[k] === OPEN && f[k] > d) { f[k] = d; queue[tail++] = k; } }
    }
    return f;
  }

  /** Next waypoint (world position) when standing at `pos` and descending `field`. */
  flowStep(field, pos, out = V.make()) {
    const [ci, cj] = this.cellOf(pos.x, pos.z);
    if (!this.inside(ci, cj)) return null;
    let bestI = -1, bestJ = -1, best = field[this.idx(ci, cj)];
    if (best === 0) return null;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        if (a === 0 && b === 0) continue;
        const ni = ci + a, nj = cj + b;
        if (!this.isOpen(ni, nj)) continue;
        // Refuse diagonals that cut a corner.
        if (a !== 0 && b !== 0 && (!this.isOpen(ci + a, cj) || !this.isOpen(ci, cj + b))) continue;
        const v = field[this.idx(ni, nj)];
        if (v < best) { best = v; bestI = ni; bestJ = nj; }
      }
    }
    if (bestI < 0) return null;
    return this.cellCenter(bestI, bestJ, out);
  }

  randomOpenCell(rng, minClearance = 2) {
    for (let tries = 0; tries < 400; tries++) {
      const c = rng.pick(this.openCells);
      if (this.distWall[c] >= minClearance) return c;
    }
    return rng.pick(this.openCells);
  }

  worldOfCell(c, out = V.make()) {
    const i = c % this.w, j = (c / this.w) | 0;
    return this.cellCenter(i, j, out);
  }

  // ------------------------------------------------------------ geometry

  /**
   * Static level geometry, split into chunks. A chunk is one CHUNK x CHUNK block of cells
   * with its own fill and ink mesh plus an AABB, which is what makes culling possible:
   * a single map-sized mesh can only ever be drawn whole.
   */
  build(gl) {
    const { w, h } = this;
    const H = this.wallH;
    this.chunksX = Math.ceil(w / CHUNK);
    this.chunksZ = Math.ceil(h / CHUNK);

    const chunks = [];
    for (let cz = 0; cz < this.chunksZ; cz++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        const i0 = cx * CHUNK, j0 = cz * CHUNK;
        const i1 = Math.min(w, i0 + CHUNK), j1 = Math.min(h, j0 + CHUNK);
        chunks.push({
          index: cz * this.chunksX + cx,
          cx, cz, i0, j0, i1, j1,
          fillB: new FillBuilder(), inkB: new InkBuilder(),
          min: [i0 * CELL, 0, j0 * CELL],
          max: [i1 * CELL, H, j1 * CELL],
          fill: null, ink: null,
        });
      }
    }
    const chunkAt = (i, j) => chunks[
      Math.min(this.chunksZ - 1, Math.max(0, Math.floor(j / CHUNK))) * this.chunksX +
      Math.min(this.chunksX - 1, Math.max(0, Math.floor(i / CHUNK)))];

    // Floor and ceiling, one slab per chunk so they cull with everything else.
    for (const c of chunks) {
      const x0 = c.i0 * CELL, x1 = c.i1 * CELL, z0 = c.j0 * CELL, z1 = c.j1 * CELL;
      c.fillB.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0],
        [0, 1, 0], MAT.FLOOR, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]);
      c.fillB.quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1],
        [0, -1, 0], MAT.CEIL, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    }

    // Greedy-merge wall cells into boxes, but never across a chunk border - a box that
    // straddles two chunks would have to be drawn whenever either one is visible.
    const used = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = this.idx(i, j);
        if (this.cells[c] !== WALL || used[c]) continue;
        const iMax = Math.min(w, (Math.floor(i / CHUNK) + 1) * CHUNK);
        const jMax = Math.min(h, (Math.floor(j / CHUNK) + 1) * CHUNK);
        let rw = 1;
        while (i + rw < iMax && this.cells[this.idx(i + rw, j)] === WALL && !used[this.idx(i + rw, j)]) rw++;
        let rh = 1;
        outer: while (j + rh < jMax) {
          for (let k = 0; k < rw; k++) {
            const cc = this.idx(i + k, j + rh);
            if (this.cells[cc] !== WALL || used[cc]) break outer;
          }
          rh++;
        }
        for (let b = 0; b < rh; b++) for (let a = 0; a < rw; a++) used[this.idx(i + a, j + b)] = 1;
        const isPillar = rw <= 2 && rh <= 2;
        chunkAt(i, j).fillB.box([i * CELL, 0, j * CELL], [(i + rw) * CELL, H, (j + rh) * CELL],
          isPillar ? MAT.TRIM : MAT.WALL, 0x3f, 1);
      }
    }

    this._buildWallInk(chunkAt);

    for (const L of this.lights) {
      const x0 = L.i * CELL + CELL * 0.22, x1 = (L.i + 1) * CELL - CELL * 0.22;
      const z0 = L.j * CELL + CELL * 0.22, z1 = (L.j + 1) * CELL - CELL * 0.22;
      const c = chunkAt(L.i, L.j);
      c.fillB.box([x0, H - 0.09, z0], [x1, H, z1], MAT.LIGHT, 0x3f, 1);
      c.inkB.box([x0, H - 0.09, z0], [x1, H - 0.02, z1], 1.9);
    }

    for (const c of chunks) {
      c.fill = c.fillB.toMesh(gl);
      c.ink = c.inkB.toMesh(gl);
      c.fillB = null; c.inkB = null;
    }
    this.chunks = chunks;
    return { chunks, chunksX: this.chunksX, chunksZ: this.chunksZ };
  }

  _buildWallInk(chunkAt) {
    const { w, h } = this;
    const H = this.wallH;
    const LINE = 2.9;

    // --- boundary lines between open floor and wall, merged into long runs then split
    //     at chunk borders so each piece belongs to exactly one chunk.
    const emitRunX = (j, a, b) => {
      const z = j * CELL;
      for (let s = a; s < b;) {
        const e = Math.min(b, (Math.floor(s / CHUNK) + 1) * CHUNK);
        const ink = chunkAt(s, Math.min(h - 1, j)).inkB;
        ink.edge([s * CELL, 0, z], [e * CELL, 0, z], LINE);
        ink.edge([s * CELL, H, z], [e * CELL, H, z], LINE * 0.9);
        s = e;
      }
    };
    const emitRunZ = (i, a, b) => {
      const x = i * CELL;
      for (let s = a; s < b;) {
        const e = Math.min(b, (Math.floor(s / CHUNK) + 1) * CHUNK);
        const ink = chunkAt(Math.min(w - 1, i), s).inkB;
        ink.edge([x, 0, s * CELL], [x, 0, e * CELL], LINE);
        ink.edge([x, H, s * CELL], [x, H, e * CELL], LINE * 0.9);
        s = e;
      }
    };

    for (let j = 0; j <= h; j++) {
      let runStart = -1;
      for (let i = 0; i <= w; i++) {
        const solid = i < w && (this.isWall(i, j - 1) !== this.isWall(i, j));
        if (solid && runStart < 0) runStart = i;
        else if (!solid && runStart >= 0) { emitRunX(j, runStart, i); runStart = -1; }
      }
    }
    for (let i = 0; i <= w; i++) {
      let runStart = -1;
      for (let j = 0; j <= h; j++) {
        const solid = j < h && (this.isWall(i - 1, j) !== this.isWall(i, j));
        if (solid && runStart < 0) runStart = j;
        else if (!solid && runStart >= 0) { emitRunZ(i, runStart, j); runStart = -1; }
      }
    }

    // --- vertical corner posts ---------------------------------------------------------
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const a = this.isWall(i - 1, j - 1), b = this.isWall(i, j - 1);
        const c = this.isWall(i - 1, j), d = this.isWall(i, j);
        const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
        // 1 or 3 walls = an outer/inner corner. 2 walls only counts when they're diagonal
        // (a pinch point); two side-by-side walls is just a flat surface running through.
        const diagonal = n === 2 && ((a && d && !b && !c) || (b && c && !a && !d));
        if (n === 1 || n === 3 || diagonal) {
          chunkAt(Math.min(w - 1, i), Math.min(h - 1, j)).inkB
            .edge([i * CELL, 0, j * CELL], [i * CELL, H, j * CELL], LINE);
        }
      }
    }
  }

  // ------------------------------------------------------------ colouring

  /**
   * JS mirror of colorMask() in the fill shader: 0 = left as line art, 1 = coloured in.
   *
   * Characters sample this once at their feet and ease toward it, so a fighter crossing
   * the border drains of colour over about a second instead of switching per-pixel as
   * their body passes through the boundary.
   */
  colorAmountAt(x, z) {
    const d = ((x - this.colorOrigin[0]) * this.colorDir[0] +
               (z - this.colorOrigin[1]) * this.colorDir[1]) * this.colorSlope;
    const n = fbm2(x * 0.055, z * 0.055) - 0.5;
    const fine = fbm2(x * 0.23, z * 0.23) - 0.5;
    const m = d + n * 1.45 + fine * 0.30;
    return smoothstep(-0.13, 0.13, m);
  }

  // ------------------------------------------------------------ culling

  /**
   * Which chunks can the camera actually see?
   *
   * Frustum culling alone still draws every room behind the wall you're facing, so this
   * also floods outward from the camera's cell through *open* cells only, the way a
   * portal-based renderer walks a level. A wall stops the flood dead, so rooms with no
   * line of sight are never reached. Walls next to reached cells are marked too, otherwise
   * the room you're standing in would have no walls.
   *
   * Conservative in the safe direction: it can mark a chunk you can't quite see, but it
   * cannot miss one you can.
   */
  computeVisibleChunks(camPos, frustum, outMask) {
    const { w, h } = this;
    const H = this.wallH;
    const nx = this.chunksX, nz = this.chunksZ;
    if (!outMask || outMask.length !== nx * nz) outMask = new Uint8Array(nx * nz);
    outMask.fill(0);

    const seen = this._visSeen && this._visSeen.length === w * h ? this._visSeen : (this._visSeen = new Int32Array(w * h));
    const queue = this._visQueue && this._visQueue.length === w * h ? this._visQueue : (this._visQueue = new Int32Array(w * h));
    const stamp = (this._visStamp = (this._visStamp || 0) + 1);

    const markCell = (i, j) => {
      // Mark the cell's chunk plus its diagonal neighbours' chunks. Geometry that sits
      // exactly on a chunk border is filed under one side or the other; this halo means
      // we never drop a line because it landed in the neighbour.
      for (let dj = -1; dj <= 1; dj += 2) {
        for (let di = -1; di <= 1; di += 2) {
          const ci = Math.min(nx - 1, Math.max(0, Math.floor((i + di) / CHUNK)));
          const cj = Math.min(nz - 1, Math.max(0, Math.floor((j + dj) / CHUNK)));
          outMask[cj * nx + ci] = 1;
        }
      }
      outMask[Math.min(nz - 1, Math.max(0, Math.floor(j / CHUNK))) * nx +
              Math.min(nx - 1, Math.max(0, Math.floor(i / CHUNK)))] = 1;
    };

    let [si, sj] = this.cellOf(camPos.x, camPos.z);
    si = Math.min(w - 1, Math.max(0, si));
    sj = Math.min(h - 1, Math.max(0, sj));
    if (!this.isOpen(si, sj)) {
      // Camera clipped into geometry - fall back to the nearest open cell.
      let best = -1, bestD = Infinity;
      for (const c of this.openCells) {
        const ci = c % w, cj = (c / w) | 0;
        const d = (ci - si) ** 2 + (cj - sj) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best < 0) { outMask.fill(1); return outMask; }
      si = best % w; sj = (best / w) | 0;
    }

    let head = 0, tail = 0;
    const start = this.idx(si, sj);
    seen[start] = stamp; queue[tail++] = start;
    markCell(si, sj);

    // The frustum test is inflated by most of a cell: a staircase BFS path can bulge a
    // little off the straight sight line, and clipping it there would pop whole rooms.
    const pad = CELL * 0.8;

    while (head < tail) {
      const c = queue[head++];
      const i = c % w, j = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const nj = j + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = this.idx(ni, nj);
        if (seen[n] === stamp) continue;
        seen[n] = stamp;
        if (!frustum.aabb(ni * CELL - pad, -pad, nj * CELL - pad,
                          (ni + 1) * CELL + pad, H + pad, (nj + 1) * CELL + pad)) continue;
        markCell(ni, nj);
        if (this.cells[n] === OPEN) queue[tail++] = n;   // walls are marked, never crossed
      }
    }
    return outMask;
  }
}
