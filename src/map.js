// Backrooms-style level: mostly open floorplate chopped up by random wall runs, which is
// what actually gives that "endless office nobody finished" feeling. Also owns collision,
// raycasting and the nav grid the bots think with.

import { Rng, V, clamp } from './math.js';
import { FillBuilder, InkBuilder } from './geom.js';
import { MAT } from './renderer.js';

export const CELL = 3.6;
export const WALL_H = 3.15;

const WALL = 1, OPEN = 0;

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
   * Static level geometry. Walls merge into big boxes for the fills; the ink is generated
   * from the grid itself so only real silhouette edges get drawn - no pen marks stranded
   * in the middle of a flat wall.
   */
  build(gl) {
    const f = new FillBuilder();
    const ink = new InkBuilder();
    const { w, h } = this;
    const H = this.wallH;

    // Floor + ceiling as single slabs; the fragment shader handles their surface detail.
    f.quad([0, 0, this.sizeZ], [this.sizeX, 0, this.sizeZ], [this.sizeX, 0, 0], [0, 0, 0],
      [0, 1, 0], MAT.FLOOR, [[0, this.sizeZ], [this.sizeX, this.sizeZ], [this.sizeX, 0], [0, 0]]);
    f.quad([0, H, 0], [this.sizeX, H, 0], [this.sizeX, H, this.sizeZ], [0, H, this.sizeZ],
      [0, -1, 0], MAT.CEIL, [[0, 0], [this.sizeX, 0], [this.sizeX, this.sizeZ], [0, this.sizeZ]]);

    // Greedy-merge wall cells into rectangles.
    const used = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = this.idx(i, j);
        if (this.cells[c] !== WALL || used[c]) continue;
        let rw = 1;
        while (i + rw < w && this.cells[this.idx(i + rw, j)] === WALL && !used[this.idx(i + rw, j)]) rw++;
        let rh = 1;
        outer: while (j + rh < h) {
          for (let k = 0; k < rw; k++) {
            const cc = this.idx(i + k, j + rh);
            if (this.cells[cc] !== WALL || used[cc]) break outer;
          }
          rh++;
        }
        for (let b = 0; b < rh; b++) for (let a = 0; a < rw; a++) used[this.idx(i + a, j + b)] = 1;
        const isPillar = rw <= 2 && rh <= 2;
        f.box([i * CELL, 0, j * CELL], [(i + rw) * CELL, H, (j + rh) * CELL],
          isPillar ? MAT.TRIM : MAT.WALL, 0x3f, 1);
      }
    }

    this._buildWallInk(ink);

    // Recessed ceiling panels.
    for (const L of this.lights) {
      const x0 = L.i * CELL + CELL * 0.22, x1 = (L.i + 1) * CELL - CELL * 0.22;
      const z0 = L.j * CELL + CELL * 0.22, z1 = (L.j + 1) * CELL - CELL * 0.22;
      f.box([x0, H - 0.09, z0], [x1, H, z1], MAT.LIGHT, 0x3f, 1);
      ink.box([x0, H - 0.09, z0], [x1, H - 0.02, z1], 1.9);
    }

    return {
      fill: f.toMesh(gl),
      ink: ink.toMesh(gl),
    };
  }

  _buildWallInk(ink) {
    const { w, h } = this;
    const H = this.wallH;
    const LINE = 2.9;

    // --- boundary lines between open floor and wall, merged into long runs -------------
    const vertRuns = new Map(); // key: grid line i -> list of [jStart, jEnd]
    const horizRuns = new Map();

    const addRun = (map, key, a) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    };

    for (let j = 0; j < h; j++) {
      let runStart = -1;
      for (let i = 0; i <= w; i++) {
        // Horizontal boundary along grid line z = j*CELL, spanning cells in x.
        const solid = i < w && (this.isWall(i, j - 1) !== this.isWall(i, j));
        if (solid && runStart < 0) runStart = i;
        else if (!solid && runStart >= 0) { addRun(horizRuns, j, [runStart, i]); runStart = -1; }
      }
    }
    for (let i = 0; i < w; i++) {
      let runStart = -1;
      for (let j = 0; j <= h; j++) {
        const solid = j < h && (this.isWall(i - 1, j) !== this.isWall(i, j));
        if (solid && runStart < 0) runStart = j;
        else if (!solid && runStart >= 0) { addRun(vertRuns, i, [runStart, j]); runStart = -1; }
      }
    }

    for (const [j, runs] of horizRuns) {
      for (const [a, b] of runs) {
        const z = j * CELL;
        ink.edge([a * CELL, 0, z], [b * CELL, 0, z], LINE);
        ink.edge([a * CELL, H, z], [b * CELL, H, z], LINE * 0.9);
      }
    }
    for (const [i, runs] of vertRuns) {
      for (const [a, b] of runs) {
        const x = i * CELL;
        ink.edge([x, 0, a * CELL], [x, 0, b * CELL], LINE);
        ink.edge([x, H, a * CELL], [x, H, b * CELL], LINE * 0.9);
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
          ink.edge([i * CELL, 0, j * CELL], [i * CELL, H, j * CELL], LINE);
        }
      }
    }
  }
}
