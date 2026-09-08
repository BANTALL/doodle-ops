// Everything in the world that isn't a wall or a fighter: crates, dropped guns, bullet
// holes, tracers, muzzle flashes, paper shards. Cosmetic motion is stepped on the 12fps
// animation clock so it flip-books along with the characters.

import { FillBuilder, InkBuilder, pushOrientedBox } from './geom.js';
import { MAT } from './renderer.js';
import { M4, V, clamp, TAU } from './math.js';
import { WEAPONS } from './weapons.js';

const GRAVITY = 15.5;
const ANIM_DT = 1 / 12;
const PICKUP_TTL = 24;      // seconds a dropped gun lies around before it fades off the page
const PICKUP_BLINK = 4;     // last few seconds, it flickers like it's being erased

function buildCrateMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  pushOrientedBox(f, i, { pos: [0, 0, 0], size: [1, 1, 1], mat: MAT.CRATE, inkWidth: 2.3, uvScale: 1 });
  // Packing tape: a cross on top and a band around the middle.
  pushOrientedBox(f, i, { pos: [0, 0.505, 0], size: [0.16, 0.02, 1.005], mat: MAT.TRIM, inkWidth: 1.3 });
  pushOrientedBox(f, i, { pos: [0, 0.505, 0], size: [1.005, 0.02, 0.16], mat: MAT.TRIM, inkWidth: 1.3 });
  for (const [dx, dz, sx, sz] of [[0.505, 0, 0.02, 1.005], [-0.505, 0, 0.02, 1.005], [0, 0.505, 1.005, 0.02], [0, -0.505, 1.005, 0.02]]) {
    pushOrientedBox(f, i, { pos: [dx, 0.06, dz], size: [sx, 0.16, sz], mat: MAT.TRIM, inkWidth: 1.3 });
  }
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

function buildShardMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  pushOrientedBox(f, i, { pos: [0, 0, 0], size: [1, 1, 0.14], mat: MAT.CRATE, inkWidth: 2.0 });
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/** Camera-facing quad matrix. */
function billboard(out, pos, size, camRight, camUp, camFwd, roll = 0) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rx = camRight.x * cr + camUp.x * sr, ry = camRight.y * cr + camUp.y * sr, rz = camRight.z * cr + camUp.z * sr;
  const ux = -camRight.x * sr + camUp.x * cr, uy = -camRight.y * sr + camUp.y * cr, uz = -camRight.z * sr + camUp.z * cr;
  out[0] = rx * size; out[1] = ry * size; out[2] = rz * size; out[3] = 0;
  out[4] = ux * size; out[5] = uy * size; out[6] = uz * size; out[7] = 0;
  out[8] = camFwd.x; out[9] = camFwd.y; out[10] = camFwd.z; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

/** Quad stretched between two points, rolled to face the camera. */
function segmentBillboard(out, a, b, eye, width) {
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  dx /= len; dy /= len; dz /= len;
  const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5, mz = (a.z + b.z) * 0.5;
  let vx = eye.x - mx, vy = eye.y - my, vz = eye.z - mz;
  const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
  // up = dir x toEye, renormalised (degenerates when looking straight down the tracer)
  let ux = dy * vz - dz * vy, uy = dz * vx - dx * vz, uz = dx * vy - dy * vx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-4) { ux = 0; uy = 1; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  const nx = dy * uz - dz * uy, ny = dz * ux - dx * uz, nz = dx * uy - dy * ux;
  out[0] = dx * len; out[1] = dy * len; out[2] = dz * len; out[3] = 0;
  out[4] = ux * width; out[5] = uy * width; out[6] = uz * width; out[7] = 0;
  out[8] = nx; out[9] = ny; out[10] = nz; out[11] = 0;
  out[12] = mx; out[13] = my; out[14] = mz; out[15] = 1;
  return out;
}

/** Quad laid flat against a surface with the given normal. */
function decalMatrix(out, pos, normal, size, roll) {
  // Any vector not parallel to the normal works as a seed for the tangent frame.
  const up = Math.abs(normal.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let tx = up.y * normal.z - up.z * normal.y;
  let ty = up.z * normal.x - up.x * normal.z;
  let tz = up.x * normal.y - up.y * normal.x;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = normal.y * tz - normal.z * ty;
  const by = normal.z * tx - normal.x * tz;
  const bz = normal.x * ty - normal.y * tx;
  const c = Math.cos(roll), s = Math.sin(roll);
  out[0] = (tx * c + bx * s) * size; out[1] = (ty * c + by * s) * size; out[2] = (tz * c + bz * s) * size; out[3] = 0;
  out[4] = (-tx * s + bx * c) * size; out[5] = (-ty * s + by * c) * size; out[6] = (-tz * s + bz * c) * size; out[7] = 0;
  out[8] = normal.x; out[9] = normal.y; out[10] = normal.z; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

export class Entities {
  constructor(gl, map, rng, weaponModels) {
    this.gl = gl;
    this.map = map;
    this.rng = rng;
    this.models = weaponModels;
    this.crateMesh = buildCrateMesh(gl);
    this.shardMesh = buildShardMesh(gl);

    this.crates = [];
    this.pickups = [];
    this.decals = [];
    this.tracers = [];
    this.flashes = [];
    this.shards = [];
    this.puffs = [];

    this.animFrame = 0;
    this._m = M4.create();
    this._tmp = V.make();
    this.maxDecals = 90;
  }

  // ------------------------------------------------------------ spawning

  spawnCrates(count) {
    const { map, rng } = this;
    const placed = [];
    for (let n = 0; n < count; n++) {
      let pos = null;
      for (let t = 0; t < 60; t++) {
        const c = map.randomOpenCell(rng, 1);
        const p = map.worldOfCell(c);
        p.x += rng.range(-0.9, 0.9);
        p.z += rng.range(-0.9, 0.9);
        if (!map._circleFree(p.x, p.z, 0.75)) continue;
        if (placed.some((q) => V.distXZ(q, p) < 2.6)) continue;
        pos = p; break;
      }
      if (!pos) continue;
      placed.push(pos);
      const size = rng.range(0.82, 1.06);
      this.crates.push({
        pos: V.make(pos.x, size * 0.5, pos.z),
        size, hp: 42, maxHp: 42,
        yaw: rng.range(0, TAU),
        alive: true,
        shake: 0,
      });
    }
  }

  /**
   * Drop a gun on the floor. Guns that fall off a corpse rot away after a while; guns that
   * came out of a crate (or seeded the map) stay put. Without that, a long match turns the
   * floor into a weapon buffet and there's no reason to shoot a crate again.
   */
  spawnPickup(gunId, pos, ammo, reserve, kick = true, permanent = false) {
    const p = V.clone(pos);
    p.y = Math.max(0.22, p.y);
    this.pickups.push({
      gunId, pos: p,
      vel: kick ? V.make(this.rng.range(-1.6, 1.6), this.rng.range(1.2, 2.6), this.rng.range(-1.6, 1.6)) : V.make(0, 0, 0),
      ammo: ammo ?? WEAPONS[gunId].mag,
      reserve: reserve ?? Math.round(WEAPONS[gunId].reserve * 0.35),
      grounded: false,
      spin: this.rng.range(0, TAU),
      ttl: permanent ? Infinity : PICKUP_TTL,
      highlight: 0,
    });
    if (this.pickups.length > 18) {
      // Evict the oldest perishable drop rather than whatever happens to be first.
      const i = this.pickups.findIndex((q) => q.ttl !== Infinity);
      this.pickups.splice(i >= 0 ? i : 0, 1);
    }
  }

  addDecal(pos, normal, size = 0.34) {
    const idx = this.rng.int(0, 3);
    this.decals.push({
      pos: V.make(pos.x + normal.x * 0.012, pos.y + normal.y * 0.012, pos.z + normal.z * 0.012),
      normal: V.clone(normal), size, roll: this.rng.range(0, TAU),
      uvOff: [(idx % 2) * 0.5, Math.floor(idx / 2) * 0.5],
      life: 26,
    });
    if (this.decals.length > this.maxDecals) this.decals.shift();
  }

  addTracer(from, to, width = 0.05) {
    this.tracers.push({ from: V.clone(from), to: V.clone(to), width, frames: 2 });
  }

  addFlash(pos, size = 0.42) {
    this.flashes.push({ pos: V.clone(pos), size, frames: 2, roll: this.rng.range(0, TAU) });
  }

  addPuff(pos, size = 0.3) {
    this.puffs.push({ pos: V.clone(pos), size, frames: 3, age: 0, roll: this.rng.range(0, TAU) });
  }

  addShards(pos, count, spread = 3.2) {
    for (let i = 0; i < count; i++) {
      if (this.shards.length > 90) break;
      this.shards.push({
        pos: V.make(pos.x + this.rng.range(-0.3, 0.3), pos.y + this.rng.range(-0.3, 0.3), pos.z + this.rng.range(-0.3, 0.3)),
        vel: V.make(this.rng.range(-spread, spread), this.rng.range(1.5, spread + 1.5), this.rng.range(-spread, spread)),
        size: this.rng.range(0.10, 0.26),
        rot: [this.rng.range(0, TAU), this.rng.range(0, TAU), this.rng.range(0, TAU)],
        spin: [this.rng.range(-9, 9), this.rng.range(-9, 9), this.rng.range(-9, 9)],
        life: this.rng.range(1.6, 2.8),
      });
    }
  }

  // ------------------------------------------------------------ interaction

  /** Ray vs crates. Returns the nearest hit within maxDist, or null. */
  raycastCrates(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const c of this.crates) {
      if (!c.alive) continue;
      const h = c.size * 0.5;
      const t = rayBox(origin, dir, c.pos, h, h, h, bestT);
      if (t !== null && t < bestT) { bestT = t; best = c; }
    }
    return best ? { crate: best, dist: bestT } : null;
  }

  /** Crates block movement too - they're cover, not decoration. */
  blocksCircle(x, z, r) {
    for (const c of this.crates) {
      if (!c.alive) continue;
      const h = c.size * 0.5;
      const cx = clamp(x, c.pos.x - h, c.pos.x + h);
      const cz = clamp(z, c.pos.z - h, c.pos.z + h);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return c;
    }
    return null;
  }

  damageCrate(crate, amount, onBreak) {
    if (!crate.alive) return;
    crate.hp -= amount;
    crate.shake = 0.22;
    if (crate.hp <= 0) {
      crate.alive = false;
      this.addShards(crate.pos, 16, 3.4);
      this.addPuff(crate.pos, crate.size * 1.5);
      onBreak?.(crate);
    }
  }

  nearestPickup(pos, radius) {
    let best = null, bestD = radius * radius;
    for (const p of this.pickups) {
      const d = V.dist2(p.pos, pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  removePickup(p) {
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  // ------------------------------------------------------------ update

  /** Real-time bookkeeping (shake decay, highlight fade). */
  update(dt) {
    for (const c of this.crates) if (c.shake > 0) c.shake = Math.max(0, c.shake - dt * 1.6);
    for (const p of this.pickups) p.highlight = Math.max(0, p.highlight - dt * 6);
  }

  /** Stop-motion step: everything cosmetic moves here, twelve times a second. */
  animStep() {
    this.animFrame++;
    const dt = ANIM_DT;

    for (let i = this.tracers.length - 1; i >= 0; i--) if (--this.tracers[i].frames <= 0) this.tracers.splice(i, 1);
    for (let i = this.flashes.length - 1; i >= 0; i--) if (--this.flashes[i].frames <= 0) this.flashes.splice(i, 1);
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age++; p.size *= 1.35; p.pos.y += 0.05;
      if (--p.frames <= 0) this.puffs.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) if (--this.decals[i].life <= 0) this.decals.splice(i, 1);

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.vel.y -= GRAVITY * dt;
      s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;
      if (s.pos.y < s.size * 0.4) { s.pos.y = s.size * 0.4; s.vel.y *= -0.32; s.vel.x *= 0.6; s.vel.z *= 0.6; s.spin[0] *= 0.5; s.spin[2] *= 0.5; }
      if (this.map.solidAt(s.pos.x, s.pos.z)) { s.vel.x *= -0.4; s.vel.z *= -0.4; s.pos.x -= s.vel.x * dt; s.pos.z -= s.vel.z * dt; }
      s.rot[0] += s.spin[0] * dt; s.rot[1] += s.spin[1] * dt; s.rot[2] += s.spin[2] * dt;
      s.life -= dt;
      if (s.life <= 0) this.shards.splice(i, 1);
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.ttl -= dt;
      if (p.ttl <= 0) this.pickups.splice(i, 1);
    }

    for (const p of this.pickups) {
      if (p.grounded) continue;
      p.vel.y -= GRAVITY * dt;
      const nx = p.pos.x + p.vel.x * dt, nz = p.pos.z + p.vel.z * dt;
      if (!this.map.solidAt(nx, p.pos.z)) p.pos.x = nx; else p.vel.x *= -0.3;
      if (!this.map.solidAt(p.pos.x, nz)) p.pos.z = nz; else p.vel.z *= -0.3;
      p.pos.y += p.vel.y * dt;
      if (p.pos.y <= 0.24) { p.pos.y = 0.24; p.vel.x = p.vel.z = 0; p.vel.y = 0; p.grounded = true; }
    }
  }

  // ------------------------------------------------------------ render

  render(r, cam) {
    const m = this._m;
    const frame = this.animFrame;
    const fr = r.frustum;

    // Crates. A hit makes them jolt for a couple of animation frames.
    for (const c of this.crates) {
      if (!c.alive) continue;
      r.stats.props++;
      if (!fr.sphere(c.pos.x, c.pos.y, c.pos.z, c.size)) continue;
      r.stats.propsDrawn++;
      const sh = c.shake > 0 ? Math.sin(frame * 2.7 + c.pos.x) * c.shake * 0.09 : 0;
      const p = this._tmp;
      V.set(p, c.pos.x + sh, c.pos.y, c.pos.z + sh * 0.6);
      M4.compose(m, p, c.yaw + sh * 0.3, 0, 0, c.size, c.size, c.size);
      const opts = { objSeed: (c.pos.x * 3.1 + c.pos.z * 7.7) % 64 };
      r.fill(this.crateMesh.fill, m, opts);
      r.ink(this.crateMesh.ink, m, opts);
    }

    // Dropped weapons: hover, turn, and lean in a way that reads as "pick me up".
    for (const p of this.pickups) {
      const model = this.models.models[p.gunId];
      if (!model) continue;
      r.stats.props++;
      if (!fr.sphere(p.pos.x, p.pos.y + 0.15, p.pos.z, 1.1)) continue;
      r.stats.propsDrawn++;
      // Flicker out at the end of its life, one animation frame on, one off.
      if (p.ttl < PICKUP_BLINK && (frame & 1)) continue;
      const bobT = frame / 12 + p.spin;
      const y = p.pos.y + (p.grounded ? 0.10 + Math.sin(bobT * 2.2) * 0.055 : 0);
      const yaw = p.grounded ? bobT * 1.15 : p.spin;
      V.set(this._tmp, p.pos.x, y, p.pos.z);
      M4.compose(m, this._tmp, yaw, 0.22, 0.12, 1, 1, 1);
      const hi = p.highlight;
      const opts = { objSeed: p.spin * 9.3, widthScale: 1 + hi * 1.6 };
      r.fill(model.body.fill, m, opts);
      r.ink(model.body.ink, m, opts);
      if (model.moving) { r.fill(model.moving.fill, m, opts); r.ink(model.moving.ink, m, opts); }
      // Pencil smudge on the floor so the item is grounded in the drawing.
      V.set(this._tmp, p.pos.x, 0.012, p.pos.z);
      decalMatrix(m, this._tmp, { x: 0, y: 1, z: 0 }, 0.85 + hi * 0.25, p.spin);
      r.quad(r.texSmudge, m, [0.35, 0.33, 0.30, 0.22 + hi * 0.35]);
    }

    // Paper shards.
    for (const s of this.shards) {
      if (!fr.sphere(s.pos.x, s.pos.y, s.pos.z, s.size)) continue;
      const fade = clamp(s.life / 0.6, 0, 1);
      M4.compose(m, s.pos, s.rot[1], s.rot[0], s.rot[2], s.size, s.size * 1.2, s.size);
      const opts = { objSeed: s.spin[0] * 3.7 };
      if (fade > 0.15) { r.fill(this.shardMesh.fill, m, opts); r.ink(this.shardMesh.ink, m, opts); }
    }

    // Bullet holes.
    for (const d of this.decals) {
      if (!fr.sphere(d.pos.x, d.pos.y, d.pos.z, d.size)) continue;
      decalMatrix(m, d.pos, d.normal, d.size, d.roll);
      const fade = clamp(d.life / 8, 0, 1);
      r.quad(r.texSplat, m, [0.16, 0.15, 0.19, 0.85 * fade], d.uvOff, [0.5, 0.5]);
    }

    // Tracers + flashes + puffs.
    for (const t of this.tracers) {
      const mx = (t.from.x + t.to.x) * 0.5, my = (t.from.y + t.to.y) * 0.5, mz = (t.from.z + t.to.z) * 0.5;
      if (!fr.sphere(mx, my, mz, V.dist(t.from, t.to) * 0.5 + 0.2)) continue;
      segmentBillboard(m, t.from, t.to, cam.pos, t.width);
      r.quad(r.texStreak, m, [0.18, 0.17, 0.22, 0.78]);
    }
    for (const f of this.flashes) {
      if (!fr.sphere(f.pos.x, f.pos.y, f.pos.z, f.size)) continue;
      billboard(m, f.pos, f.size, cam.right, cam.up, cam.fwd, f.roll);
      r.quad(r.texFlash, m, [1.0, 0.93, 0.62, 0.95]);
    }
    for (const p of this.puffs) {
      if (!fr.sphere(p.pos.x, p.pos.y, p.pos.z, p.size)) continue;
      billboard(m, p.pos, p.size, cam.right, cam.up, cam.fwd, p.roll);
      r.quad(r.texPuff, m, [0.42, 0.40, 0.38, 0.55 / (1 + p.age)]);
    }
  }
}

/** Slab-method ray/AABB. Returns entry distance or null. */
export function rayBox(o, d, center, hx, hy, hz, maxDist) {
  let tmin = 0, tmax = maxDist;
  const lo = [center.x - hx, center.y - hy, center.z - hz];
  const hi = [center.x + hx, center.y + hy, center.z + hz];
  const op = [o.x, o.y, o.z], dp = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dp[a]) < 1e-7) {
      if (op[a] < lo[a] || op[a] > hi[a]) return null;
      continue;
    }
    const inv = 1 / dp[a];
    let t1 = (lo[a] - op[a]) * inv, t2 = (hi[a] - op[a]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Ray vs upright capsule, used for hitting characters. Returns {dist, head} or null. */
export function rayCharacter(o, d, pos, radius, height, headY, headR, maxDist) {
  // Body: vertical cylinder from pos.y to pos.y+height.
  const dx = o.x - pos.x, dz = o.z - pos.z;
  const a = d.x * d.x + d.z * d.z;
  let bodyT = null;
  if (a > 1e-9) {
    const b = 2 * (dx * d.x + dz * d.z);
    const c = dx * dx + dz * dz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0 || t > maxDist) continue;
        const y = o.y + d.y * t;
        if (y >= pos.y && y <= pos.y + height) { bodyT = t; break; }
      }
    }
  }
  // Head: a sphere sitting on top, worth extra damage.
  let headT = null;
  const hy = pos.y + headY;
  const ox = o.x - pos.x, oy = o.y - hy, oz = o.z - pos.z;
  const hb = 2 * (ox * d.x + oy * d.y + oz * d.z);
  const hc = ox * ox + oy * oy + oz * oz - headR * headR;
  const hdisc = hb * hb - 4 * hc;
  if (hdisc >= 0) {
    const sq = Math.sqrt(hdisc);
    for (const t of [(-hb - sq) / 2, (-hb + sq) / 2]) {
      if (t >= 0 && t <= maxDist) { headT = t; break; }
    }
  }
  if (headT !== null && (bodyT === null || headT <= bodyT + 0.02)) return { dist: headT, head: true };
  if (bodyT !== null) return { dist: bodyT, head: false };
  return null;
}

