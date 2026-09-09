// The two skills that put objects in the world: the guardian's shield and the mechanist's
// turret. Both are owned by an actor and live in the game's world so shots can find them.

import { FillBuilder, InkBuilder, pushOrientedBox } from './geom.js';
import { MAT } from './renderer.js';
import { M4, V, clamp, dirFrom, yawOf, TAU } from './math.js';
import { rayBox } from './entities.js';
import { SHIELD_OUTLINE } from './textures.js';
import { resolveShot, spreadDir } from './combat.js';
import { Sfx } from './audio.js';

export const SHIELD_MAX_HP = 50;
export const SHIELD_LAG = 0;            // the shield tracks you immediately
export const SHIELD_PATCH_BELOW = 10;   // you can only patch it once it's nearly gone
const SHIELD_HALF = [0.72, 0.78, 0.06];
const SHIELD_FORWARD = 1.15;            // how far in front of the owner it floats
const SHIELD_HEIGHT = 1.05;

export const TURRET_LIFE = 60;
export const TURRET_AMMO = 100;
export const TURRET_RANGE = 55;

/** Weapon profile the turret shoots with. Reuses the M4's sound and tracer. */
const TURRET_GUN = {
  id: 'm4', name: 'TURRET', kind: 'gun',
  damage: 2, headMult: 1.5, rate: 0.082, range: TURRET_RANGE,
  spread: 1.7, moveSpread: 0, recoil: 0, recoilSide: 0, auto: true,
  mag: TURRET_AMMO, reserve: 0, reload: 1, moveMult: 1, drawTime: 0,
};

export function buildSkillMeshes(gl) {
  // --- shield: the panel is a translucent quad, so all we need is its drawn outline.
  // A box outline would fight the tapered silhouette in the texture, so trace that shape.
  const si = new InkBuilder();
  const W = SHIELD_HALF[0], T = SHIELD_HALF[1];
  si.polyline(SHIELD_OUTLINE.map(([x, y]) => [x * W, y * T, 0]), 3.0, true);

  // --- turret: a squat tripod with a swivelling head
  const bf = new FillBuilder(), bi = new InkBuilder();
  pushOrientedBox(bf, bi, { pos: [0, 0.10, 0], size: [0.46, 0.16, 0.46], mat: MAT.METAL, inkWidth: 2.2 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.4;
    pushOrientedBox(bf, bi, {
      pos: [Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17],
      size: [0.07, 0.30, 0.07], rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4],
      mat: MAT.DARK, inkWidth: 1.8,
    });
  }
  pushOrientedBox(bf, bi, { pos: [0, 0.24, 0], size: [0.14, 0.14, 0.14], mat: MAT.DARK, inkWidth: 1.8 });

  const hf = new FillBuilder(), hi = new InkBuilder();
  pushOrientedBox(hf, hi, { pos: [0, 0, 0], size: [0.30, 0.26, 0.34], mat: MAT.ORANGE, inkWidth: 2.2 });
  pushOrientedBox(hf, hi, { pos: [0, 0.01, -0.30], size: [0.09, 0.09, 0.34], mat: MAT.DARK, inkWidth: 1.8 });
  pushOrientedBox(hf, hi, { pos: [0, 0.01, -0.48], size: [0.13, 0.13, 0.06], mat: MAT.DARK, inkWidth: 1.8 });
  // A single dot eye, so it reads as one of the doodles rather than as hardware.
  pushOrientedBox(hf, hi, { pos: [0, 0.06, -0.175], size: [0.09, 0.09, 0.02], mat: MAT.SKIN, inkWidth: 1.5 });
  pushOrientedBox(hf, hi, { pos: [0, 0.06, -0.185], size: [0.04, 0.04, 0.02], mat: MAT.DARK, inkWidth: 1.2 });

  return {
    shieldInk: si.toMesh(gl),
    turretBase: { fill: bf.toMesh(gl), ink: bi.toMesh(gl) },
    turretHead: { fill: hf.toMesh(gl), ink: hi.toMesh(gl) },
  };
}

/**
 * A slab of paper that floats in front of its owner, half a second behind everything they
 * do. It stops anyone else's bullets; the owner shoots straight through it, because a
 * shield you can't fire past is a punishment rather than a skill.
 */
export class Shield {
  constructor(owner) {
    this.owner = owner;
    this.hp = SHIELD_MAX_HP;
    this.alive = true;
    this.pos = V.make();
    this.yaw = owner.yaw;
    this.hitFlash = 0;
    this.bornAt = 0;
    this._m = M4.create();
    this._o = V.make();
    this._d = V.make();
  }

  reset(hp = SHIELD_MAX_HP) {
    this.hp = hp;
    this.alive = true;
    this.hitFlash = 1;
  }

  update(dt, time) {
    const o = this.owner;
    const dir = dirFrom(o.yaw, 0, this._d);
    V.set(this.pos,
      o.pos.x + dir.x * SHIELD_FORWARD,
      o.pos.y + SHIELD_HEIGHT,
      o.pos.z + dir.z * SHIELD_FORWARD);
    this.yaw = o.yaw;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
  }

  /** Ray vs the shield's oriented box. Returns entry distance, or null. */
  rayHit(origin, dir, maxDist, shooter) {
    if (!this.alive || shooter === this.owner) return null;
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    // Rotate the ray into the shield's frame (yaw only) and use the AABB test there.
    const ox = origin.x - this.pos.x, oz = origin.z - this.pos.z;
    V.set(this._o, ox * c + oz * s, origin.y - this.pos.y, -ox * s + oz * c);
    V.set(this._d, dir.x * c + dir.z * s, dir.y, -dir.x * s + dir.z * c);
    return rayBox(this._o, this._d, { x: 0, y: 0, z: 0 }, SHIELD_HALF[0], SHIELD_HALF[1], SHIELD_HALF[2], maxDist);
  }

  /** Outward normal, for impact effects. */
  normal(out = V.make()) {
    const d = dirFrom(this.yaw, 0, out);
    return V.set(out, -d.x, 0, -d.z);
  }

  takeDamage(amount) {
    this.hp -= amount;
    this.hitFlash = 1;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; return true; }
    return false;
  }

  render(r, meshes) {
    if (!this.alive) return;
    if (!r.frustum.sphere(this.pos.x, this.pos.y, this.pos.z, 1.2)) return;
    const m = this._m;
    // Panel: a translucent quad in the shield's plane.
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const wobble = this.hitFlash * 0.06;
    m[0] = c * SHIELD_HALF[0] * 2; m[1] = 0; m[2] = -s * SHIELD_HALF[0] * 2; m[3] = 0;
    m[4] = 0; m[5] = SHIELD_HALF[1] * 2; m[6] = 0; m[7] = 0;
    m[8] = s; m[9] = 0; m[10] = c; m[11] = 0;
    m[12] = this.pos.x; m[13] = this.pos.y; m[14] = this.pos.z; m[15] = 1;
    const frac = this.hp / SHIELD_MAX_HP;
    const hurt = 1 - frac;
    // Bleeds from paper-blue toward red as it takes damage, so you can read it at a glance.
    const tint = [
      0.62 + hurt * 0.33,
      0.78 - hurt * 0.40,
      0.96 - hurt * 0.55,
      0.35 + this.hitFlash * 0.28,
    ];
    r.quad(r.texShield, m, tint);

    M4.compose(m, this.pos, this.yaw + wobble, 0, wobble, 1, 1, 1);
    r.ink(meshes.shieldInk, m, { objSeed: 21.3, alpha: 0.55 + frac * 0.45 });
  }
}

/**
 * A scribbled turret. Picks the nearest enemy it can see and empties itself into them.
 * Kills are credited to whoever placed it, which also means bots blame the player for it.
 */
export class Turret {
  constructor(owner, pos, rng) {
    this.owner = owner;
    this.pos = V.clone(pos);
    this.rng = rng;
    this.yaw = owner.yaw;
    this.pitch = 0;
    this.ammo = TURRET_AMMO;
    this.life = TURRET_LIFE;
    this.alive = true;
    this.cooldown = 0;
    this.target = null;
    this.scanTimer = 0;
    this.flashFrames = 0;
    this.animYaw = this.yaw;
    this.animPitch = 0;
    this._m = M4.create();
    this._d = V.make();
    this._hit = {};
  }

  get muzzle() {
    const d = dirFrom(this.yaw, this.pitch, this._d);
    return V.make(this.pos.x + d.x * 0.72, this.pos.y + 0.80 + d.y * 0.72, this.pos.z + d.z * 0.72);
  }

  update(dt, game) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0 || this.ammo <= 0) { this.expire(game); return; }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.2;
      this.target = this._findTarget(game);
    }

    const eye = V.make(this.pos.x, this.pos.y + 0.80, this.pos.z);
    if (this.target && this.target.alive) {
      const t = this.target;
      const dx = t.pos.x - eye.x, dy = (t.pos.y + 1.1) - eye.y, dz = t.pos.z - eye.z;
      const horiz = Math.hypot(dx, dz) || 1e-4;
      // Turrets track briskly but not instantly - they still have to swing round.
      this.yaw = approach(this.yaw, yawOf(dx, dz), 4.5 * dt);
      this.pitch = clamp(this.pitch + clamp(Math.atan2(dy, horiz) - this.pitch, -3 * dt, 3 * dt), -0.7, 0.7);

      const fwd = dirFrom(this.yaw, this.pitch, this._d);
      const dl = Math.hypot(dx, dy, dz) || 1;
      const aligned = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dl > Math.cos(7 * Math.PI / 180);
      if (aligned && this.cooldown <= 0) this._fire(game, eye);
    } else {
      // Idle sweep, so it doesn't sit there like a prop.
      this.yaw += dt * 0.6;
      this.pitch = approach(this.pitch, 0, dt * 1.5);
    }
  }

  _findTarget(game) {
    const eye = V.make(this.pos.x, this.pos.y + 0.80, this.pos.z);
    let best = null, bestD = TURRET_RANGE;
    for (const a of game.actors) {
      if (a === this.owner || !a.alive) continue;
      const d = V.distXZ(eye, a.pos);
      if (d > bestD) continue;
      if (!game.map.lineOfSight(eye, { x: a.pos.x, y: a.pos.y + 1.15, z: a.pos.z })) continue;
      bestD = d; best = a;
    }
    return best;
  }

  _fire(game, eye) {
    this.cooldown = TURRET_GUN.rate;
    this.ammo--;
    const dir = dirFrom(this.yaw, this.pitch, V.make());
    const shot = spreadDir(dir, TURRET_GUN.spread, this.rng, V.make());
    // Shot is attributed to the owner: it can't hit them, and its kills are theirs.
    const hit = resolveShot(game.world, this.owner, eye, shot, TURRET_GUN, this._hit);
    game.registerShot(this.owner, eye, shot, hit, TURRET_GUN);
    this.flashFrames = 2;
    game.makeNoise(this.pos, 45, this.owner);
  }

  expire(game) {
    if (!this.alive) return;
    this.alive = false;
    game.entities.addShards(V.make(this.pos.x, this.pos.y + 0.5, this.pos.z), 10, 2.6);
    game.entities.addPuff(V.make(this.pos.x, this.pos.y + 0.5, this.pos.z), 0.6);
    Sfx.crateBreak(V.dist(this.pos, game.player.pos));
  }

  animStep() {
    this.animYaw = this.yaw;
    this.animPitch = this.pitch;
    if (this.flashFrames > 0) this.flashFrames--;
  }

  render(r, meshes, game) {
    if (!this.alive) return;
    if (!r.frustum.sphere(this.pos.x, this.pos.y + 0.4, this.pos.z, 1.0)) return;
    const m = this._m;
    const seed = this.pos.x * 3.3 + this.pos.z * 1.7;
    // Blink out over its last couple of seconds so its death isn't a surprise.
    if (this.life < 2 && (game.animFrame & 1)) return;

    const S = 1.3;
    M4.compose(m, this.pos, 0, 0, 0, S, S, S);
    r.fill(meshes.turretBase.fill, m, { objSeed: seed });
    r.ink(meshes.turretBase.ink, m, { objSeed: seed });

    const head = V.make(this.pos.x, this.pos.y + 0.42 * S, this.pos.z);
    M4.compose(m, head, this.animYaw, this.animPitch, 0, S, S, S);
    r.fill(meshes.turretHead.fill, m, { objSeed: seed + 5 });
    r.ink(meshes.turretHead.ink, m, { objSeed: seed + 5 });

    if (this.flashFrames > 0) game.entities.addFlash(this.muzzle, 0.30);
  }
}

const approach = (a, b, max) => a + clamp(b - a, -max, max);
