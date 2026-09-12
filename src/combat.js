// Shared weapon handling. Player and bots run the exact same loadout state machine and
// the exact same hitscan resolution, so a bot's shot is worth exactly what yours is.

import { WEAPONS, START_MELEE } from './weapons.js';
import { rayCharacter } from './entities.js';
import { V, clamp, lerp, approach, DEG } from './math.js';

export const EYE_HEIGHT = 1.62;
export const BODY_RADIUS = 0.40;
export const BODY_HEIGHT = 1.78;
export const HEAD_Y = 1.60;
export const HEAD_R = 0.24;

/** One fighter's weapons: one melee weapon they always have, plus at most one gun. */
export class Loadout {
  constructor(gunId = 'pistol', meleeId = START_MELEE) {
    this.gun = gunId;                 // null when unarmed
    this.melee = meleeId;             // fists, knife or axe - never empty
    this.meleeOut = false;            // the axe is away: in flight, or stuck in something
    this.meleeSwings = 0;             // swings since the axe was last in hand
    this.pendingThrow = 0;            // time until a throw swing actually lets go
    this.slot = gunId ? 'gun' : 'melee';
    const def = gunId ? WEAPONS[gunId] : null;
    this.ammo = def ? def.mag : 0;
    this.reserve = def ? Math.round(def.reserve * 0.4) : 0;
    this.cooldown = 0;
    this.reloadT = 0;
    this.drawT = 0;
    this.scoped = false;
    this.scopeT = 0;
    this.bloom = 0;                   // grows while spraying, decays when you stop
    this.pendingMelee = 0;            // time until a swing actually connects
    this.lastFire = -99;
    this.wantAuto = false;
    this.swapFrom = null;             // weapon we're spinning away from, during a draw
    this.slashDir = 1;                // knife swings alternate sides
    this.throwing = false;            // the swing in progress is a throw, not a cut
  }

  get id() { return this.slot === 'melee' ? this.melee : this.gun; }
  get def() { return WEAPONS[this.id]; }
  get isMelee() { return this.slot === 'melee'; }
  get hasGun() { return !!this.gun; }
  get busy() { return this.drawT > 0 || this.reloadT > 0; }
  get needsReload() { const d = this.def; return d.kind === 'gun' && this.ammo <= 0; }
  get canReload() { const d = this.def; return d.kind === 'gun' && this.ammo < d.mag && this.reserve > 0 && this.reloadT <= 0 && this.drawT <= 0; }

  switchTo(slot) {
    if (slot === 'gun' && !this.gun) return false;
    if (slot === this.slot) return false;
    this.swapFrom = this.id;
    this.slot = slot;
    this.drawT = this.def.drawTime;
    this.reloadT = 0;
    this.scoped = false;
    this.bloom = 0;
    return true;
  }

  toggle() { return this.switchTo(this.slot === 'gun' ? 'melee' : 'gun'); }

  /**
   * Swap in a different melee weapon, handing back the one being replaced so it can be
   * dropped. You always have exactly one, so this never leaves the slot empty.
   */
  takeMelee(meleeId) {
    if (meleeId === this.melee) return null;
    const old = this.melee;
    this.swapFrom = this.id;
    this.melee = meleeId;
    this.meleeOut = false;
    this.meleeSwings = 0;
    this.pendingThrow = 0;
    this.pendingMelee = 0;
    if (this.slot === 'melee') { this.drawT = this.def.drawTime; this.cooldown = 0; }
    return old;
  }

  /** Swap in a new gun, handing back what was being carried so it can be dropped. */
  takeGun(gunId, ammo, reserve) {
    const old = this.gun ? { gunId: this.gun, ammo: this.ammo, reserve: this.reserve } : null;
    this.swapFrom = this.id;
    this.gun = gunId;
    const def = WEAPONS[gunId];
    this.ammo = ammo ?? def.mag;
    this.reserve = reserve ?? Math.round(def.reserve * 0.4);
    this.slot = 'gun';
    this.drawT = def.drawTime;
    this.reloadT = 0;
    this.scoped = false;
    this.bloom = 0;
    return old;
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloadT = this.def.reload;
    this.scoped = false;
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.drawT > 0) {
      this.drawT = Math.max(0, this.drawT - dt);
      if (this.drawT === 0) this.swapFrom = null;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const def = this.def;
        const need = def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
    this.bloom = Math.max(0, this.bloom - dt * 3.2);
    // approach(), not a signed step: stepping by +/-rate every frame makes the blend
    // jitter around the target instead of settling on it.
    const target = this.scoped ? 1 : 0;
    const rate = this.def.scopeTime ? dt / this.def.scopeTime : dt * 8;
    this.scopeT = clamp(approach(this.scopeT, target, rate), 0, 1);
  }

  /**
   * Is the next swing the one that lets go? Decided before the swing rather than after, so
   * the animation can be a throw from its first frame instead of a slash that turns into
   * one. Counted in swings, not hits: you shouldn't have to connect to throw.
   */
  get nextSwingThrows() {
    const def = this.def;
    return !!def.throwEvery && !this.meleeOut && this.meleeSwings + 1 >= def.throwEvery;
  }

  /** True when the trigger pull produces a shot right now. */
  tryFire(now) {
    if (this.busy || this.cooldown > 0) return false;
    const def = this.def;
    if (def.kind === 'melee') {
      if (this.meleeOut) return false;  // nothing in your hand to swing - callers recall instead
      const throwing = this.nextSwingThrows;
      this.cooldown = def.rate;
      this.meleeSwings++;
      // A throw is a throw all the way through: it doesn't also cut whatever is in front
      // of you on the way past.
      if (throwing) { this.pendingThrow = def.throwRelease; this.pendingMelee = 0; }
      else { this.pendingMelee = def.hitDelay; this.pendingThrow = 0; }
      this.throwing = throwing;
      this.lastFire = now;
      this.slashDir = -this.slashDir;   // alternate the swing side
      return true;
    }
    if (this.ammo <= 0) return false;
    this.ammo--;
    this.cooldown = def.rate;
    this.bloom = Math.min(2.6, this.bloom + (def.auto ? 0.42 : 0.9));
    this.lastFire = now;
    if (def.scope && this.scoped) this.scoped = false; // bolt cycles, scope drops
    return true;
  }

  /** Cone half-angle in degrees for the next shot. */
  spreadDeg(moveFactor) {
    const def = this.def;
    if (def.kind === 'melee') return 0;
    if (def.scope && this.scopeT > 0.9) return def.scopedSpread;
    const base = def.spread + def.moveSpread * moveFactor;
    return base + this.bloom * (def.auto ? 0.55 : 0.35);
  }
}

/** Random direction inside a cone of half-angle `deg` around `dir`. */
export function spreadDir(dir, deg, rng, out = V.make()) {
  if (deg <= 0.0001) return V.copy(out, dir);
  // Build a basis around dir.
  const up = Math.abs(dir.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const rx = up.y * dir.z - up.z * dir.y;
  const ry = up.z * dir.x - up.x * dir.z;
  const rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  const ux = dir.y * (rz / rl) - dir.z * (ry / rl);
  const uy = dir.z * (rx / rl) - dir.x * (rz / rl);
  const uz = dir.x * (ry / rl) - dir.y * (rx / rl);
  // Gaussian-ish inside the cone: most shots land near the middle, a few stray.
  const ang = deg * DEG;
  const a = rng.range(0, Math.PI * 2);
  const r = Math.abs(rng.gauss()) * 0.5 * ang;
  const sx = Math.cos(a) * r, sy = Math.sin(a) * r;
  out.x = dir.x + (rx / rl) * sx + ux * sy;
  out.y = dir.y + (ry / rl) * sx + uy * sy;
  out.z = dir.z + (rz / rl) * sx + uz * sy;
  return V.norm(out, out);
}

const DAMAGE_FALLOFF_START = 26;
const DAMAGE_FALLOFF_END = 90;

function falloff(def, dist) {
  if (def.id === 'sniper') return 1;
  const t = clamp((dist - DAMAGE_FALLOFF_START) / (DAMAGE_FALLOFF_END - DAMAGE_FALLOFF_START), 0, 1);
  return lerp(1, def.id === 'm4' ? 0.62 : 0.74, t);
}

/**
 * Trace one bullet. `world` supplies { map, entities, actors }. Returns a description of
 * what it hit so the caller can play the right sound and feedback.
 */
export function resolveShot(world, shooter, origin, dir, def, hitOut = {}) {
  const { map, entities, actors } = world;
  const maxDist = def.range;

  const wall = map.raycast(origin, dir, maxDist, world._rayScratch || (world._rayScratch = {}));
  let bestDist = wall.kind === 'none' ? maxDist : wall.dist;
  let kind = wall.kind === 'none' ? 'none' : 'world';
  let target = null, head = false;
  let normal = { x: wall.nx, y: wall.ny, z: wall.nz };

  const crateHit = entities.raycastCrates(origin, dir, bestDist);
  if (crateHit) {
    bestDist = crateHit.dist; kind = 'crate'; target = crateHit.crate;
    // Approximate the face normal by which axis the entry point sits on.
    const p = { x: origin.x + dir.x * bestDist, y: origin.y + dir.y * bestDist, z: origin.z + dir.z * bestDist };
    const c = crateHit.crate;
    const dx = (p.x - c.pos.x) / (c.size * 0.5), dy = (p.y - c.pos.y) / (c.size * 0.5), dz = (p.z - c.pos.z) / (c.size * 0.5);
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    normal = ax > ay && ax > az ? { x: Math.sign(dx), y: 0, z: 0 }
      : ay > az ? { x: 0, y: Math.sign(dy), z: 0 } : { x: 0, y: 0, z: Math.sign(dz) };
  }

  // Shields are checked before bodies, and bestDist carries forward, so anyone standing
  // behind one is protected for free.
  if (world.shields) {
    for (const sh of world.shields) {
      const t = sh.rayHit(origin, dir, bestDist, shooter);
      if (t !== null && t < bestDist) {
        bestDist = t; kind = 'shield'; target = sh; head = false;
        normal = sh.normal();
      }
    }
  }

  for (const a of actors) {
    if (a === shooter || !a.alive) continue;
    const hit = rayCharacter(origin, dir, a.pos, BODY_RADIUS, BODY_HEIGHT, HEAD_Y, HEAD_R, bestDist);
    if (hit && hit.dist < bestDist) {
      bestDist = hit.dist; kind = 'actor'; target = a; head = hit.head;
      normal = { x: -dir.x, y: -dir.y, z: -dir.z };
    }
  }

  hitOut.kind = kind;
  hitOut.target = target;
  hitOut.head = head;
  hitOut.dist = bestDist;
  hitOut.normal = normal;
  hitOut.point = V.make(origin.x + dir.x * bestDist, origin.y + dir.y * bestDist, origin.z + dir.z * bestDist);
  hitOut.damage = kind === 'actor'
    ? Math.round(def.damage * (head ? def.headMult : 1) * falloff(def, bestDist))
    : def.damage;
  return hitOut;
}

/** Melee sweep: nearest actor inside the arc in front of the swinger. */
export function resolveMelee(world, shooter, origin, dir, def) {
  const { actors, entities } = world;
  let best = null, bestD = def.range;
  for (const a of actors) {
    if (a === shooter || !a.alive) continue;
    const dx = a.pos.x - origin.x, dz = a.pos.z - origin.z;
    const dy = (a.pos.y + HEAD_Y * 0.6) - origin.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > bestD + BODY_RADIUS) continue;
    const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
    if (dot < 0.55) continue;         // roughly a 110-degree swing arc
    if (!world.map.lineOfSight(origin, { x: a.pos.x, y: a.pos.y + 1.0, z: a.pos.z })) continue;
    bestD = Math.max(0, d - BODY_RADIUS);
    best = a;
  }
  if (best) {
    const behind = V.dot({ x: Math.sin(best.yaw), y: 0, z: Math.cos(best.yaw) }, { x: dir.x, y: 0, z: dir.z });
    return { kind: 'actor', target: best, head: false, damage: Math.round(def.damage * (behind > 0.45 ? def.headMult : 1)), dist: bestD };
  }
  // Otherwise see if the swing connects with a crate.
  const crate = entities.raycastCrates(origin, dir, def.range);
  if (crate) return { kind: 'crate', target: crate.crate, damage: def.damage * 1.6, dist: crate.dist };
  return { kind: 'none' };
}

export { WEAPONS };
