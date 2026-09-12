// Everything the DROODLE CANNON puts into the world: the round in flight, the fireballs, the
// beam, the debris, the scorch marks, and the energy crawling over the weapon while it
// winds up.
//
// There is one clock in here and it ticks twelve times a second. Nothing in this file
// looks at the real frame rate or at `animLag`, which is the whole point: the round jumps
// three and a half metres between frames and holds perfectly still in between, and the
// smear is what carries your eye across the gap. That is how the rest of the game is
// drawn, and a mod that moved smoothly would be the one thing on screen that looked wrong.

import { M4, V, Rng, clamp, TAU } from '../math.js';
import {
  buildExplosionCels, buildBoltMesh, buildFlameCels, buildBeamCels,
  buildSparkMesh, buildGlintMesh, buildRingCels, buildArcCels,
  buildScorchMesh, buildEmberMesh,
} from './art.js';

const ANIM_DT = 1 / 12;

export const EXPLOSION_FRAMES = 8;

// ---------------------------------------------------------------- matrix helpers

/** Camera-facing quad. Same construction the base game uses for its own billboards. */
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

/** A beam mesh (one unit long down -Z) laid from `from` along `dir` for `len` metres. */
function beamMatrix(out, from, dir, len, rad, spin = 0) {
  const up = Math.abs(dir.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let rx = up.y * dir.z - up.z * dir.y;
  let ry = up.z * dir.x - up.x * dir.z;
  let rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = dir.y * rz - dir.z * ry, uy = dir.z * rx - dir.x * rz, uz = dir.x * ry - dir.y * rx;
  const c = Math.cos(spin), s = Math.sin(spin);
  out[0] = (rx * c + ux * s) * rad; out[1] = (ry * c + uy * s) * rad; out[2] = (rz * c + uz * s) * rad; out[3] = 0;
  out[4] = (-rx * s + ux * c) * rad; out[5] = (-ry * s + uy * c) * rad; out[6] = (-rz * s + uz * c) * rad; out[7] = 0;
  out[8] = -dir.x * len; out[9] = -dir.y * len; out[10] = -dir.z * len; out[11] = 0;
  out[12] = from.x; out[13] = from.y; out[14] = from.z; out[15] = 1;
  return out;
}

/** Flat against a surface. */
function decalMatrix(out, pos, normal, size, roll) {
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

/** Aim a flame tongue (drawn pointing up +Y) back down the direction it came from. */
function tongueMatrix(out, pos, back, size, camFwd) {
  // up = the direction the flame streams (backwards along travel)
  const ux = back.x, uy = back.y, uz = back.z;
  let rx = uy * camFwd.z - uz * camFwd.y;
  let ry = uz * camFwd.x - ux * camFwd.z;
  let rz = ux * camFwd.y - uy * camFwd.x;
  let rl = Math.hypot(rx, ry, rz);
  // Straight at or away from the camera: any perpendicular will do, since a tongue seen
  // exactly end-on has no readable width anyway.
  if (rl < 1e-4) {
    rx = Math.abs(ux) > 0.9 ? 0 : 1; ry = Math.abs(ux) > 0.9 ? 1 : 0; rz = 0;
    rl = 1;
  }
  rx /= rl; ry /= rl; rz /= rl;
  out[0] = rx * size; out[1] = ry * size; out[2] = rz * size; out[3] = 0;
  out[4] = ux * size; out[5] = uy * size; out[6] = uz * size; out[7] = 0;
  out[8] = camFwd.x; out[9] = camFwd.y; out[10] = camFwd.z; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

// ---------------------------------------------------------------- the system

export class DroodleFX {
  constructor(gl) {
    this.gl = gl;
    this.cels = buildExplosionCels(gl, EXPLOSION_FRAMES, { seed: 7717 });
    this.celsBig = buildExplosionCels(gl, EXPLOSION_FRAMES, { seed: 4242, ragged: 1.35, spikes: 1.4 });
    this.bolt = buildBoltMesh(gl);
    this.flames = buildFlameCels(gl, 3);
    this.beamCels = buildBeamCels(gl, 4);
    this.spark = buildSparkMesh(gl);
    this.glint = buildGlintMesh(gl);
    this.ringCels = buildRingCels(gl, 3);
    this.arcCels = buildArcCels(gl, 4);
    this.scorchMesh = buildScorchMesh(gl);
    this.emberMesh = buildEmberMesh(gl);

    this.bolts = [];
    this.blasts = [];
    this.beams = [];
    this.embers = [];
    this.scorches = [];

    this.frame = 0;
    this.rng = new Rng(0xD5701);
    this._m = M4.create();
    this._m2 = M4.create();
    this._v = V.make();
    this._v2 = V.make();
  }

  dispose() {
    const all = [
      ...this.cels, ...this.celsBig, ...this.flames, ...this.beamCels,
      ...this.ringCels, ...this.arcCels,
      this.bolt, this.spark, this.glint, this.scorchMesh, this.emberMesh,
    ];
    for (const m of all) { m.fill?.dispose?.(); m.ink?.dispose?.(); }
    this.clear();
  }

  clear() {
    this.bolts.length = 0;
    this.blasts.length = 0;
    this.beams.length = 0;
    this.embers.length = 0;
    this.scorches.length = 0;
  }

  // ------------------------------------------------------------ spawning

  /**
   * A round on its way to somewhere.
   *
   * Where it ends up was already decided by the game's own hitscan when the trigger came
   * down - this only carries the result there and hands it over on arrival. It is a
   * projectile you can watch and a hitscan you can trust, and it means a bot firing one of
   * these is worth exactly what a bot firing a pistol is worth.
   */
  addBolt(from, dir, dist, speed, onArrive) {
    this.bolts.push({
      pos: V.clone(from),
      prev: V.clone(from),
      dir: V.clone(dir),
      travelled: 0,
      dist,
      speed,
      onArrive,
      born: this.frame,
      seed: this.rng.range(0, TAU),
    });
    if (this.bolts.length > 24) this.bolts.shift();
  }

  /** A fireball. `big` swaps in the rougher cel sheet with more spikes on it. */
  addBlast(pos, size, big = false) {
    this.blasts.push({
      pos: V.clone(pos),
      size,
      big,
      frame0: this.frame,
      roll: this.rng.range(0, TAU),
      spin: this.rng.range(-0.22, 0.22),
    });
    if (this.blasts.length > 14) this.blasts.shift();
  }

  /** The beam. Lives for `frames` animation steps and then it is simply gone. */
  addBeam(from, dir, len, radius, frames) {
    this.beams.push({
      from: V.clone(from), dir: V.clone(dir), len, radius, frames,
      frame0: this.frame,
      seed: this.rng.int(0, 3),
    });
  }

  addEmbers(pos, count, spread = 4.0, size = 0.14) {
    for (let k = 0; k < count; k++) {
      if (this.embers.length > 80) break;
      this.embers.push({
        pos: V.make(pos.x + this.rng.range(-0.2, 0.2), pos.y + this.rng.range(-0.2, 0.2), pos.z + this.rng.range(-0.2, 0.2)),
        vel: V.make(this.rng.range(-spread, spread), this.rng.range(1.0, spread + 1.4), this.rng.range(-spread, spread)),
        size: size * this.rng.range(0.6, 1.5),
        rot: [this.rng.range(0, TAU), this.rng.range(0, TAU), this.rng.range(0, TAU)],
        spin: [this.rng.range(-12, 12), this.rng.range(-12, 12), this.rng.range(-12, 12)],
        life: this.rng.range(0.7, 1.5),
      });
    }
  }

  addScorch(pos, normal, size) {
    this.scorches.push({
      pos: V.make(pos.x + normal.x * 0.014, pos.y + normal.y * 0.014, pos.z + normal.z * 0.014),
      normal: V.clone(normal),
      size,
      roll: this.rng.range(0, TAU),
      life: 24,
    });
    if (this.scorches.length > 40) this.scorches.shift();
  }

  // ------------------------------------------------------------ the 12fps step

  animStep(map) {
    this.frame++;

    // Rounds. One step is one jump; nothing is interpolated.
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      V.copy(b.prev, b.pos);
      const step = Math.min(b.speed * ANIM_DT, b.dist - b.travelled);
      b.travelled += step;
      b.pos.x += b.dir.x * step;
      b.pos.y += b.dir.y * step;
      b.pos.z += b.dir.z * step;
      if (b.travelled >= b.dist - 1e-4) {
        this.bolts.splice(k, 1);
        b.onArrive?.(b);
      }
    }

    for (let k = this.blasts.length - 1; k >= 0; k--) {
      if (this.frame - this.blasts[k].frame0 >= EXPLOSION_FRAMES) this.blasts.splice(k, 1);
    }
    for (let k = this.beams.length - 1; k >= 0; k--) {
      if (this.frame - this.beams[k].frame0 >= this.beams[k].frames) this.beams.splice(k, 1);
    }
    for (let k = this.scorches.length - 1; k >= 0; k--) {
      if (--this.scorches[k].life <= 0) this.scorches.splice(k, 1);
    }

    for (let k = this.embers.length - 1; k >= 0; k--) {
      const e = this.embers[k];
      e.vel.y -= 15.5 * ANIM_DT;
      e.pos.x += e.vel.x * ANIM_DT;
      e.pos.y += e.vel.y * ANIM_DT;
      e.pos.z += e.vel.z * ANIM_DT;
      if (e.pos.y < e.size * 0.4) { e.pos.y = e.size * 0.4; e.vel.y *= -0.30; e.vel.x *= 0.55; e.vel.z *= 0.55; }
      if (map?.solidAt(e.pos.x, e.pos.z)) {
        e.pos.x -= e.vel.x * ANIM_DT; e.pos.z -= e.vel.z * ANIM_DT;
        e.vel.x *= -0.35; e.vel.z *= -0.35;
      }
      e.rot[0] += e.spin[0] * ANIM_DT; e.rot[1] += e.spin[1] * ANIM_DT; e.rot[2] += e.spin[2] * ANIM_DT;
      e.life -= ANIM_DT;
      if (e.life <= 0) this.embers.splice(k, 1);
    }
  }

  // ------------------------------------------------------------ drawing

  render(r, cam) {
    const m = this._m;
    const fr = r.frustum;
    const frame = this.frame;

    // ---- scorch marks, first, so everything else lands on top of them
    for (const s of this.scorches) {
      if (!fr.sphere(s.pos.x, s.pos.y, s.pos.z, s.size)) continue;
      const fade = clamp(s.life / 8, 0, 1);
      decalMatrix(m, s.pos, s.normal, s.size, s.roll);
      r.fill(this.scorchMesh.fill, m, { objSeed: s.roll * 3.3, alpha: fade });
      r.ink(this.scorchMesh.ink, m, { objSeed: s.roll * 3.3, alpha: fade });
    }

    // ---- embers
    for (const e of this.embers) {
      if (!fr.sphere(e.pos.x, e.pos.y, e.pos.z, e.size * 2)) continue;
      const fade = clamp(e.life / 0.5, 0, 1);
      M4.compose(m, e.pos, e.rot[1], e.rot[0], e.rot[2], e.size, e.size, e.size);
      // A tumbling ember is moving fast enough to smear, exactly like the paper shards.
      let mm = m;
      const sp = Math.hypot(e.vel.x, e.vel.y, e.vel.z);
      if (sp > 2.5) {
        const along = 1 + Math.min((sp - 2.5) * 0.20, 1.6);
        mm = M4.stretchAbout(this._m2, m, [e.pos.x, e.pos.y, e.pos.z],
          [e.vel.x / sp, e.vel.y / sp, e.vel.z / sp], along, 1 / Math.sqrt(along));
      }
      r.fill(this.emberMesh.fill, mm, { objSeed: e.spin[0], alpha: fade });
      r.ink(this.emberMesh.ink, mm, { objSeed: e.spin[0], alpha: fade });
    }

    // ---- rounds in flight
    for (const b of this.bolts) this._drawBolt(r, cam, b);

    // ---- the beam
    for (const bm of this.beams) this._drawBeam(r, cam, bm, frame);

    // ---- fireballs, last, because they are the brightest thing in the frame
    for (const bl of this.blasts) {
      const k = frame - bl.frame0;
      if (k < 0 || k >= EXPLOSION_FRAMES) continue;
      if (!fr.sphere(bl.pos.x, bl.pos.y, bl.pos.z, bl.size * 2.4)) continue;
      const cel = (bl.big ? this.celsBig : this.cels)[k];
      const s = bl.size * (bl.big ? 1.25 : 1);
      billboard(m, bl.pos, s, cam.right, cam.up, cam.fwd, bl.roll + k * bl.spin);
      const opts = { objSeed: bl.roll * 4.7 + k, alpha: 1 - (k / EXPLOSION_FRAMES) * 0.35 };
      r.fill(cel.fill, m, opts);
      r.ink(cel.ink, m, { ...opts, widthScale: 1.15 });
    }
  }

  /**
   * One round, drawn as a multiple exposure.
   *
   * The ball itself is at the head. Behind it, four copies of the same ball spaced back
   * along the metres it covered this step, each stretched along the direction of travel,
   * squashed across it, and fainter than the last - which is the difference between a
   * projectile that jumps and a projectile that streaks. A fire tongue rides the tail.
   */
  _drawBolt(r, cam, b) {
    // Not on the frame it was born. It has travelled nothing yet, so it would be drawn as
    // a fireball a hand's width from the camera - which is a wall of orange, not a shot.
    // One animation step from now it is five metres downrange and worth looking at.
    if (b.born === this.frame) return;
    const fr = r.frustum;
    const step = V.dist(b.pos, b.prev);
    const size = 0.165;
    const m = this._m, m2 = this._m2;
    const dir = [b.dir.x, b.dir.y, b.dir.z];
    const ghosts = 4;

    for (let k = ghosts; k >= 0; k--) {
      const back = (k / ghosts) * step * 0.92;
      const p = V.set(this._v, b.pos.x - b.dir.x * back, b.pos.y - b.dir.y * back, b.pos.z - b.dir.z * back);
      if (!fr.sphere(p.x, p.y, p.z, size * 4)) continue;
      const head = k === 0;
      const alpha = head ? 1 : 0.62 / k;
      const along = head ? 1.9 : 4.6;
      const s = size * (head ? 1 : 0.92 - k * 0.06);
      M4.compose(m, p, 0, 0, b.seed + k, s, s, s);
      const mm = M4.stretchAbout(m2, m, [p.x, p.y, p.z], dir, along, 1 / Math.sqrt(along));
      const opts = { objSeed: b.seed * 3 + k, alpha };
      r.fill(this.bolt.fill, mm, opts);
      if (head || k === 1) r.ink(this.bolt.ink, mm, { ...opts, widthScale: head ? 1.25 : 1 });
    }

    // The flame streaming off the back of it.
    const tailAt = V.set(this._v2,
      b.pos.x - b.dir.x * step * 0.55,
      b.pos.y - b.dir.y * step * 0.55,
      b.pos.z - b.dir.z * step * 0.55);
    if (fr.sphere(tailAt.x, tailAt.y, tailAt.z, step)) {
      const back = V.set(V.make(), -b.dir.x, -b.dir.y, -b.dir.z);
      const cel = this.flames[this.frame % this.flames.length];
      const len = clamp(step * 0.85, 0.5, 3.4);
      tongueMatrix(m, tailAt, back, len, cam.fwd);
      const opts = { objSeed: b.seed * 7, alpha: 0.85 };
      r.fill(cel.fill, m, opts);
      r.ink(cel.ink, m, opts);
    }
  }

  _drawBeam(r, cam, bm, frame) {
    const k = frame - bm.frame0;
    const t = k / Math.max(1, bm.frames - 1);
    const m = this._m;
    // Fattest on the first frame, thinning as it dies, with a per-frame flicker so it
    // never holds the same width twice.
    const flick = 1 + ((k * 7919) % 5 - 2) * 0.045;
    const rad = bm.radius * (1.25 - t * 0.75) * flick;
    const mid = V.set(this._v,
      bm.from.x + bm.dir.x * bm.len * 0.5,
      bm.from.y + bm.dir.y * bm.len * 0.5,
      bm.from.z + bm.dir.z * bm.len * 0.5);
    if (!r.frustum.sphere(mid.x, mid.y, mid.z, bm.len * 0.5 + rad * 2)) return;

    const cel = this.beamCels[(bm.seed + k) % this.beamCels.length];
    beamMatrix(m, bm.from, bm.dir, bm.len, rad, k * 0.7);
    const opts = { objSeed: bm.seed * 5 + k, alpha: 1 - t * 0.45 };
    r.fill(cel.fill, m, opts);
    r.ink(cel.ink, m, { ...opts, widthScale: 1.2 });

    // Rings peeling off the beam and running down it - the thing that reads as "this is
    // pouring out", rather than "this is a cylinder someone drew".
    const ringCel = this.ringCels[k % this.ringCels.length];
    for (let s = 0; s < 3; s++) {
      const u = ((k * 0.34 + s * 0.34) % 1);
      const d = u * bm.len;
      const p = V.set(this._v, bm.from.x + bm.dir.x * d, bm.from.y + bm.dir.y * d, bm.from.z + bm.dir.z * d);
      const rr = rad * (1.5 + u * 2.6);
      beamMatrix(this._m2, p, bm.dir, 0.02, rr, u * 4.0);
      r.fill(ringCel.fill, this._m2, { objSeed: s + k, alpha: (1 - u) * (1 - t) * 0.8 });
      r.ink(ringCel.ink, this._m2, { objSeed: s + k, alpha: (1 - u) * (1 - t) * 0.8 });
    }
  }

  // ------------------------------------------------------------ viewmodel extras

  /**
   * The charge, drawn in the viewmodel pass so the weapon cannot hide any of it.
   *
   * `weaponMat` is the model matrix of the weapon this frame; every piece here is placed
   * relative to it, so the energy shakes with the gun instead of floating beside it.
   * `t` is charge progress, 0..1, sampled on the animation clock like everything else.
   */
  renderCharge(r, weaponMat, muzzle, t, frame, colorAmt) {
    const m = this._m;
    const mz = applyMat(weaponMat, muzzle);
    const at = V.set(this._v, mz[0], mz[1], mz[2]);
    const ease = t * t;

    // Motes spiralling into the mouth. Eight of them on staggered phases, each one
    // starting further out than the last, all arriving together.
    for (let k = 0; k < 8; k++) {
      const phase = clamp((t * 1.35) - k * 0.055, 0, 1);
      if (phase <= 0) continue;
      const a = k * 2.399 + frame * 0.62;            // golden angle, so they never line up
      const rad = (1 - phase) * (0.135 + (k % 3) * 0.032);
      const s = 0.013 + phase * 0.016;
      V.set(this._v2,
        at.x + Math.cos(a) * rad,
        at.y + Math.sin(a) * rad * 0.8,
        at.z + (1 - phase) * 0.075);
      M4.compose(m, this._v2, 0, 0, a, s, s, s);
      const opts = { objSeed: k * 3.1 + frame, alpha: 0.35 + phase * 0.65, colorAmt };
      r.vmFill(this.spark.fill, m, opts);
      r.vmInk(this.spark.ink, m, opts);
    }

    // The core building behind the teeth.
    const core = 0.020 + ease * 0.052 + ((frame % 2) ? 0.006 : 0);
    M4.compose(m, at, 0, 0, frame * 1.1, core, core, core);
    r.vmFill(this.spark.fill, m, { objSeed: 9.1 + frame, alpha: 0.55 + ease * 0.45, colorAmt });

    // Rings collapsing onto the muzzle.
    for (let k = 0; k < 2; k++) {
      const u = ((t * 2.2 + k * 0.5) % 1);
      const rr = 0.125 * (1 - u) + 0.022;
      const dir = V.set(this._v2, 0, 0, -1);
      beamMatrix(m, V.make(at.x, at.y, at.z + u * 0.10), dir, 0.01, rr, u * 3.0);
      const cel = this.ringCels[(frame + k) % this.ringCels.length];
      r.vmFill(cel.fill, m, { objSeed: k + frame, alpha: (1 - u) * ease * 0.9, colorAmt });
      r.vmInk(cel.ink, m, { objSeed: k + frame, alpha: (1 - u) * ease * 0.9 });
    }

    // Energy crawling over the body. Ink only - it is a drawn crackle, not a light.
    if (t > 0.18) {
      const arc = this.arcCels[frame % this.arcCels.length];
      r.vmInk(arc.ink, weaponMat, { objSeed: frame * 2.7, alpha: clamp((t - 0.18) * 1.6, 0, 1) * 0.9, widthScale: 1.2 });
    }

    // The glint: a highlight running the length of the weapon, twice over the charge.
    const gl = ((t * 2.0) % 1);
    if (gl < 0.72) {
      const u = gl / 0.72;
      const gz = 0.26 - u * 0.62;
      const local = M4.compose(this._m2, { x: 0, y: 0.02, z: gz }, 0, 0, 1.15, 0.085, 0.085, 0.085);
      M4.mul(m, weaponMat, local);
      r.vmFill(this.glint.fill, m, { objSeed: 5.5, alpha: Math.sin(u * Math.PI) * 0.85, colorAmt });
    }
  }

  /**
   * The blast at the mouth, drawn in the viewmodel pass.
   *
   * It has to be here rather than in the world: the renderer clears the depth buffer
   * before it draws the weapon, so a fireball placed a metre in front of the camera ends
   * up *behind* the gun that produced it. Everything the player sees come out of the
   * muzzle is drawn in the same pass as the muzzle.
   *
   * @param k  animation frames since the shot
   */
  renderMuzzle(r, weaponMat, muzzle, k, colorAmt, laser = false) {
    const cels = laser ? this.celsBig : this.cels;
    if (k < 0 || k >= (laser ? 5 : 3)) return;
    const m = this._m;
    const mz = applyMat(weaponMat, muzzle);
    const at = V.set(this._v, mz[0], mz[1], mz[2]);
    // Eye-space units, and the mouth is under a metre away, so these are much smaller
    // numbers than the world-space blasts: at this range 0.3 fills half the screen.
    const size = (laser ? 0.28 : 0.100) * (1 + k * 0.34);
    const spin = (k * 2.399) + (laser ? 0.9 : 0);

    // The cel, flat to the camera, sitting on the mouth.
    M4.compose(m, at, 0, 0, spin, size, size, size);
    const opts = { objSeed: 12.3 + k * 3, alpha: 1 - k * 0.22, colorAmt };
    r.vmFill(cels[k].fill, m, opts);
    r.vmInk(cels[k].ink, m, { ...opts, widthScale: 1.2 });

    // The jet of fire thrown forward out of it. A flat tongue is useless here - it is
    // pointing straight at the camera and would be edge-on - so this is the beam prism,
    // short and flared, which is exactly the shape of a muzzle jet seen down the barrel.
    const jet = this.beamCels[k % this.beamCels.length];
    const fwd = V.set(this._v2, 0, 0, -1);
    const len = (laser ? 0.80 : 0.34) * (1 - k * 0.20);
    const rad = (laser ? 0.062 : 0.030) * (1 + k * 0.55);
    beamMatrix(m, at, fwd, len, rad, k * 1.1);
    r.vmFill(jet.fill, m, { objSeed: 4.4 + k, alpha: 0.92 - k * 0.28, colorAmt });
    r.vmInk(jet.ink, m, { objSeed: 4.4 + k, alpha: 0.92 - k * 0.28 });
  }

  /**
   * The first metre of the beam, in the viewmodel pass, so the laser visibly leaves the
   * dragon's mouth instead of appearing from behind the gun.
   */
  renderBeamStub(r, weaponMat, muzzle, k, frames, colorAmt) {
    if (k < 0 || k >= frames) return;
    const t = k / Math.max(1, frames - 1);
    const mz = applyMat(weaponMat, muzzle);
    const at = V.set(this._v, mz[0], mz[1], mz[2]);
    const dir = V.set(this._v2, 0, 0, -1);
    const rad = 0.055 * (1.25 - t * 0.75);
    const cel = this.beamCels[k % this.beamCels.length];
    beamMatrix(this._m, at, dir, 1.6, rad, k * 0.7);
    const opts = { objSeed: 21.7 + k, alpha: 1 - t * 0.4, colorAmt };
    r.vmFill(cel.fill, this._m, opts);
    r.vmInk(cel.ink, this._m, { ...opts, widthScale: 1.1 });
  }
}

/** Transform a local point by a mat4. */
export function applyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export { billboard, beamMatrix, decalMatrix };
