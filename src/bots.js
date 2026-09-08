// Bot AI.
//
// The goal is a fighter that reads as a person having a bad day, not a turret. Three
// things do most of that work:
//
//  1. They aim by *turning*, never by snapping. Their facing is the only thing that
//     decides where a bullet goes, and it chases the target through a wandering error
//     that shrinks the longer they hold you - so first contact is sloppy and a long
//     duel gets dangerous.
//  2. Everything is on a delay. Spotting, losing you, getting shot in the back: each
//     costs reaction time before it changes behaviour. They cannot answer a shot they
//     have not processed yet.
//  3. They move for their own reasons - strafing on a lazy cadence, backing off to
//     reload, pushing when they think they're winning - rather than reacting to
//     individual bullets. They are not dodging you, and it shows.

import { Loadout, spreadDir, resolveShot, resolveMelee, EYE_HEIGHT } from './combat.js';
import { WEAPONS, MUZZLE, randomGunId } from './weapons.js';
import { CharacterRig, weaponTransform, SHIRT_MATS } from './actors.js';
import { M4, V, Rng, clamp, lerp, damp, dirFrom, yawOf, approachAngle, DEG, TAU } from './math.js';
import { Sfx } from './audio.js';

const CHEST_Y = 1.18;
const HEAD_AIM_Y = 1.58;
const SIGHT_RANGE = 62;
const FOV_COS = Math.cos(58 * DEG);      // ~116 degrees of vision
const MEMORY_TIME = 4.2;
const GRAVITY = 18.5;

const STATE = {
  PATROL: 'patrol',
  COMBAT: 'combat',
  HUNT: 'hunt',
  INVESTIGATE: 'investigate',
  LOOT: 'loot',
  RETREAT: 'retreat',
};

/** How much a bot wants a given gun. Drives looting and crate-smashing priorities. */
function gunScore(id) {
  if (!id) return 0;
  return { m4: 3.0, sniper: 2.4, pistol: 1.8 }[id] ?? 1;
}

export class Bot {
  constructor(game, index, seed) {
    this.game = game;
    this.index = index;
    this.isPlayer = false;
    this.rng = new Rng(seed * 7919 + index * 104729 + 13);
    const r = this.rng;

    this.name = game.botNames[index % game.botNames.length];
    this.shirtMat = SHIRT_MATS[index % SHIRT_MATS.length];
    this.rig = new CharacterRig(game.gl, this.shirtMat);

    // ---- personality -----------------------------------------------------
    // Skill spreads the squad out: one of them is genuinely sharp, one is a liability.
    this.skill = clamp(0.34 + index * 0.09 + r.range(-0.09, 0.09), 0.22, 0.88);
    this.reactionTime = lerp(0.44, 0.19, this.skill) * r.range(0.86, 1.16);
    this.turnSpeed = lerp(3.4, 7.2, this.skill) * r.range(0.9, 1.1);       // rad/s
    this.lockTime = lerp(1.5, 0.62, this.skill);                            // to settle on target
    this.errStart = lerp(8.2, 3.4, this.skill);                             // degrees
    this.errSettled = lerp(2.7, 0.85, this.skill);
    this.aggression = r.range(0.3, 0.92);
    this.strafePeriod = r.range(0.7, 1.7);
    this.headshotBias = lerp(0.05, 0.42, this.skill);
    this.burstLen = Math.round(lerp(9, 5, this.skill) * r.range(0.8, 1.3));
    this.preferredRange = lerp(6, 16, r.next()) * (1.3 - this.aggression * 0.5);
    // Phases for the wandering aim error, so no two bots twitch alike.
    this.wp = [r.range(0, TAU), r.range(0, TAU), r.range(0, TAU), r.range(0, TAU)];
    this.wf = [r.range(1.1, 2.1), r.range(2.6, 4.4), r.range(1.3, 2.4), r.range(2.9, 4.9)];

    // ---- state -----------------------------------------------------------
    this.pos = V.make(0, 0, 0);
    this.vel = V.make(0, 0, 0);
    this.yaw = r.range(-Math.PI, Math.PI);
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.onGround = true;
    this.kills = 0; this.deaths = 0;
    this.loadout = new Loadout(randomGunId(r));

    this.state = STATE.PATROL;
    this.target = null;
    this.targetVisible = false;
    this.timeOnTarget = 0;
    this.timeSinceSeen = 99;
    this.lastKnown = V.make();
    this.alertTimer = 0;          // reaction delay before acting on a new sighting
    this.flinch = 0;
    this.goalCell = -1;
    this.flow = null;
    this.repathTimer = 0;
    this.thinkTimer = r.range(0, 0.25);
    this.perceiveTimer = r.range(0, 0.12);
    this.strafeDir = r.sign();
    this.strafeTimer = r.range(0, this.strafePeriod);
    this.shotsInBurst = 0;
    this.burstPause = 0;
    this.fireDelay = 0;
    this.wantMelee = false;
    this.lootTarget = null;
    this.crateTarget = null;
    this.stuckTimer = 0;
    this.lastPos = V.make();
    this.jumpCooldown = r.range(1, 4);
    this.footDist = 0;
    this.deathTimer = 0;
    this.deadRoll = 0;
    this.respawnAt = 0;
    this.lastAttacker = null;

    // animation
    this.walkPhase = 0;
    this.walkAmt = 0;
    this.aimAmt = 0;
    this.animPos = V.make();
    this.animYaw = 0;
    this.animPitch = 0;
    this.flashFrames = 0;
    this.meleeAnim = 0;
    this.hurtAnim = 0;
    this.rigDirty = true;

    this._m = M4.create();
    this._dir = V.make();
    this._tmp = V.make();
    this._hit = {};
  }

  dispose() { this.rig.dispose(); }

  get eye() { return V.make(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z); }

  respawn(pos) {
    V.copy(this.pos, pos);
    V.set(this.vel, 0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.deathTimer = 0;
    this.state = STATE.PATROL;
    this.target = null;
    this.timeSinceSeen = 99;
    this.loadout = new Loadout(randomGunId(this.rng));
    this.goalCell = -1;
    this.flow = null;
    this.rigDirty = true;
  }

  // ------------------------------------------------------------ perception

  _perceive(dt) {
    const game = this.game;
    const eye = this.eye;
    const fwd = dirFrom(this.yaw, this.pitch, this._dir);

    let best = null, bestD = Infinity;
    for (const a of game.actors) {
      if (a === this || !a.alive) continue;
      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > SIGHT_RANGE) continue;
      const inv = 1 / (d || 1);
      const dot = (dx * inv) * fwd.x + (dz * inv) * fwd.z;
      // Very close enemies register even outside the cone - you feel someone at your elbow.
      if (dot < FOV_COS && d > 3.5) continue;
      const chest = { x: a.pos.x, y: a.pos.y + CHEST_Y, z: a.pos.z };
      if (!game.map.lineOfSight(eye, chest)) continue;
      // Stickiness: don't ditch the enemy you're already fighting for one two metres closer.
      const score = d * (a === this.target ? 0.7 : 1);
      if (score < bestD) { bestD = score; best = a; }
    }

    const hadTarget = this.target;
    if (best) {
      if (best !== this.target || this.timeSinceSeen > 0.6) {
        // Fresh sighting: cost the bot its reaction time before it can act on this.
        this.alertTimer = this.reactionTime * (best === hadTarget ? 0.45 : 1);
        this.timeOnTarget = 0;
      }
      this.target = best;
      this.targetVisible = true;
      this.timeSinceSeen = 0;
      V.set(this.lastKnown, best.pos.x, best.pos.y, best.pos.z);
    } else {
      this.targetVisible = false;
      this.timeSinceSeen += dt;
      if (this.timeSinceSeen > MEMORY_TIME) { this.target = null; this.timeOnTarget = 0; }
    }
  }

  /** A gunshot somewhere. Bots turn up to look, but not with perfect coordinates. */
  hearNoise(pos, source) {
    if (!this.alive) return;
    if (this.state === STATE.COMBAT && this.targetVisible) return;
    const err = lerp(5.5, 1.4, this.skill);
    V.set(this.lastKnown,
      pos.x + this.rng.range(-err, err), pos.y, pos.z + this.rng.range(-err, err));
    this.timeSinceSeen = Math.min(this.timeSinceSeen, MEMORY_TIME * 0.6);
    if (this.state === STATE.PATROL || this.state === STATE.LOOT) {
      this.state = STATE.INVESTIGATE;
      this.alertTimer = this.reactionTime * 1.4;
      this.goalCell = -1;
    }
  }

  // ------------------------------------------------------------ decisions

  _think() {
    const lo = this.loadout;
    const game = this.game;

    // Looting is a standing background want: no gun at all is an emergency, a better gun
    // or a topped-up reserve is a nice-to-have when nobody is shooting.
    const wantGun = !lo.hasGun;
    const wantAmmo = lo.hasGun && lo.ammo + lo.reserve <= WEAPONS[lo.gun].mag * 0.5;

    if (this.target && (this.targetVisible || this.timeSinceSeen < MEMORY_TIME)) {
      const dist = V.distXZ(this.pos, this.target.pos);
      // Reloading with someone in your face is how you die; back off first.
      if (lo.reloadT > 0 && dist < 9 && this.targetVisible) this.state = STATE.RETREAT;
      else if (!lo.hasGun && dist > 7 && !this.targetVisible) this.state = STATE.LOOT;
      else this.state = this.targetVisible ? STATE.COMBAT : STATE.HUNT;
    } else if (wantGun || wantAmmo) {
      this.state = STATE.LOOT;
    } else if (this.state === STATE.INVESTIGATE && this.timeSinceSeen < MEMORY_TIME) {
      // stay investigating
    } else {
      this.state = STATE.PATROL;
    }

    // Knife rush: only when it's actually the sensible play, not as a gimmick.
    const d = this.target ? V.distXZ(this.pos, this.target.pos) : 99;
    this.wantMelee = (!lo.hasGun || (lo.ammo === 0 && lo.reserve === 0)) && d < 12
      || (d < 2.6 && this.aggression > 0.65 && this.targetVisible && lo.ammo === 0);
    if (this.wantMelee && !lo.isMelee) lo.switchTo('melee');
    else if (!this.wantMelee && lo.isMelee && lo.hasGun && lo.ammo > 0) lo.switchTo('gun');

    if (lo.canReload && (!this.targetVisible || this.state === STATE.RETREAT || lo.ammo === 0)) {
      if (lo.startReload()) Sfx.reload('out', V.dist(this.pos, game.player.pos));
    }

    this._pickGoal();
  }

  _pickGoal() {
    const game = this.game, map = game.map;
    let goal = -1;

    if (this.state === STATE.COMBAT && this.target) {
      const dist = V.distXZ(this.pos, this.target.pos);
      const want = this.loadout.isMelee ? 1.4 : this.preferredRange;
      // Close the gap or open it, but only commit when we're clearly off our range.
      if (dist > want * 1.45 || dist < want * 0.55) {
        const t = this.target.pos;
        const dir = dist < want * 0.55 ? -1 : 1;
        const gx = this.pos.x + (t.x - this.pos.x) / (dist || 1) * dir * 6;
        const gz = this.pos.z + (t.z - this.pos.z) / (dist || 1) * dir * 6;
        const [ci, cj] = map.cellOf(gx, gz);
        if (map.isOpen(ci, cj)) goal = map.idx(ci, cj);
      } else {
        goal = -2; // hold position, strafe only
      }
    } else if (this.state === STATE.HUNT || this.state === STATE.INVESTIGATE) {
      const [ci, cj] = map.cellOf(this.lastKnown.x, this.lastKnown.z);
      if (map.inside(ci, cj)) goal = map.idx(ci, cj);
    } else if (this.state === STATE.RETREAT && this.target) {
      const dx = this.pos.x - this.target.pos.x, dz = this.pos.z - this.target.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const [ci, cj] = map.cellOf(this.pos.x + dx / l * 9, this.pos.z + dz / l * 9);
      if (map.isOpen(ci, cj)) goal = map.idx(ci, cj);
      else goal = map.randomOpenCell(this.rng, 1);
    } else if (this.state === STATE.LOOT) {
      const item = this._findLoot();
      if (item) {
        goal = item.cell;
        this.lootTarget = item.pickup ?? null;
        this.crateTarget = item.crate ?? null;
      } else {
        this.state = STATE.PATROL;
      }
    }

    if (goal === -1 && this.state === STATE.PATROL) {
      if (this.goalCell < 0 || this._atGoal()) goal = map.randomOpenCell(this.rng, 1);
      else goal = this.goalCell;
    }

    if (goal >= 0 && goal !== this.goalCell) {
      this.goalCell = goal;
      this.flow = map.buildFlow(goal, this.flow);
    } else if (goal === -2) {
      this.goalCell = -2;
    }
  }

  _atGoal() {
    if (this.goalCell < 0) return true;
    const map = this.game.map;
    const [ci, cj] = map.cellOf(this.pos.x, this.pos.z);
    return map.inside(ci, cj) && map.idx(ci, cj) === this.goalCell;
  }

  /** Nearest worthwhile pickup, or a crate to smash open if nothing is lying around. */
  _findLoot() {
    const game = this.game, map = game.map;
    const mine = gunScore(this.loadout.gun);
    let best = null, bestD = 34;
    for (const p of game.entities.pickups) {
      const score = gunScore(p.gunId);
      const worth = score > mine + 0.01 || (!this.loadout.hasGun) ||
        (p.gunId === this.loadout.gun && this.loadout.reserve < WEAPONS[p.gunId].reserve * 0.3);
      if (!worth) continue;
      const d = V.distXZ(this.pos, p.pos);
      if (d < bestD) { bestD = d; best = { pickup: p, cell: cellIdx(map, p.pos) }; }
    }
    if (best) return best;
    if (mine >= 3 && this.loadout.reserve > 10) return null;
    for (const c of game.entities.crates) {
      if (!c.alive) continue;
      const d = V.distXZ(this.pos, c.pos);
      if (d < bestD) { bestD = d; best = { crate: c, cell: cellIdx(map, c.pos) }; }
    }
    return best;
  }

  // ------------------------------------------------------------ aim

  /**
   * Steer the facing toward where the bot *thinks* the target is. The error is a pair of
   * slow sine waves, so the aim drifts smoothly like a wobbly hand rather than jittering
   * per frame - and it shrinks the longer they keep you in view.
   */
  _aim(dt, time) {
    const t = this.target;
    if (!t) {
      // Idle: look roughly where we're walking.
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.4) {
        const want = yawOf(this.vel.x, this.vel.z);
        this.yaw = approachAngle(this.yaw, want, this.turnSpeed * 0.55 * dt);
      }
      this.pitch = damp(this.pitch, 0, 5, dt);
      this.aimAmt = damp(this.aimAmt, 0, 6, dt);
      return;
    }

    const aimAtHead = this.rng.next() < this.headshotBias;
    const ty = t.pos.y + (aimAtHead ? HEAD_AIM_Y : CHEST_Y);
    // Imperfect leading: they know you're moving but consistently under- or over-shoot it.
    const leadK = lerp(0.15, 0.85, this.skill) * (this.targetVisible ? 1 : 0.4);
    const dist = V.dist(this.pos, t.pos);
    const travel = clamp(dist / 90, 0, 0.28);
    const px = t.pos.x + (t.vel?.x ?? 0) * travel * leadK;
    const pz = t.pos.z + (t.vel?.z ?? 0) * travel * leadK;

    const ex = this.pos.x, ey = this.pos.y + EYE_HEIGHT, ez = this.pos.z;
    const dx = px - ex, dy = ty - ey, dz = pz - ez;
    const horiz = Math.hypot(dx, dz) || 1e-4;
    const wantYaw = yawOf(dx, dz);
    const wantPitch = Math.atan2(dy, horiz);

    // Error amplitude collapses as they settle on you.
    const settle = clamp(this.timeOnTarget / this.lockTime, 0, 1);
    const amp = lerp(this.errStart, this.errSettled, settle * settle) * DEG;
    const w = this.wp, f = this.wf;
    const wanderY = Math.sin(time * f[0] + w[0]) * 0.62 + Math.sin(time * f[1] + w[1]) * 0.38;
    const wanderP = Math.sin(time * f[2] + w[2]) * 0.62 + Math.sin(time * f[3] + w[3]) * 0.38;

    // Flinching from a hit throws the aim off for a moment.
    const flinchAmp = this.flinch > 0 ? this.flinch * 3.4 * DEG : 0;

    const targetYaw = wantYaw + wanderY * amp + (this.rng.next() - 0.5) * flinchAmp;
    const targetPitch = wantPitch + wanderP * amp * 0.6 + (this.rng.next() - 0.5) * flinchAmp;

    // A human flicks fast at first, then tracks slowly. Same here.
    const flick = 1 + 2.4 * Math.exp(-this.timeOnTarget * 3.2);
    const rate = this.turnSpeed * flick * (this.alertTimer > 0 ? 0.25 : 1) * dt;
    this.yaw = approachAngle(this.yaw, targetYaw, rate);
    this.pitch = clamp(approachAngle(this.pitch, targetPitch, rate), -1.4, 1.4);

    if (this.targetVisible && this.alertTimer <= 0) this.timeOnTarget += dt;
    else this.timeOnTarget = Math.max(0, this.timeOnTarget - dt * 0.7);
    this.aimAmt = damp(this.aimAmt, this.targetVisible ? 1 : 0.45, 7, dt);
  }

  // ------------------------------------------------------------ shooting

  _shoot(dt, now) {
    const lo = this.loadout;
    const game = this.game;
    this.fireDelay = Math.max(0, this.fireDelay - dt);
    this.burstPause = Math.max(0, this.burstPause - dt);
    if (lo.pendingMelee > 0) {
      lo.pendingMelee -= dt;
      if (lo.pendingMelee <= 0) this._meleeHit();
    }

    if (this.alertTimer > 0 || lo.busy) return;

    // Crate-smashing has its own little routine.
    if (!this.targetVisible && this.crateTarget && this.crateTarget.alive) {
      const d = V.distXZ(this.pos, this.crateTarget.pos);
      if (d < (lo.isMelee ? 2.1 : 9)) {
        const eye = this.eye;
        const dir = V.norm(this._dir, V.set(this._tmp,
          this.crateTarget.pos.x - eye.x, this.crateTarget.pos.y - eye.y, this.crateTarget.pos.z - eye.z));
        this.yaw = approachAngle(this.yaw, yawOf(dir.x, dir.z), this.turnSpeed * dt);
        this.pitch = approachAngle(this.pitch, Math.asin(clamp(dir.y, -1, 1)), this.turnSpeed * dt);
        if (this.fireDelay <= 0 && lo.tryFire(now)) {
          if (lo.isMelee) { this.meleeAnim = 1; Sfx.swing(V.dist(this.pos, game.player.pos)); }
          else this._fireGun(lo.def);
          this.fireDelay = this.rng.range(0.05, 0.2);
        }
      }
      return;
    }

    const t = this.target;
    if (!t || !t.alive || !this.targetVisible) return;

    const dist = V.distXZ(this.pos, t.pos);
    const def = lo.def;

    if (def.kind === 'melee') {
      if (dist < def.range * 0.92 && this.fireDelay <= 0 && lo.tryFire(now)) {
        this.meleeAnim = 1;
        Sfx.swing(V.dist(this.pos, game.player.pos));
      }
      return;
    }
    if (lo.ammo <= 0) return;
    if (this.burstPause > 0) return;

    // Only pull the trigger when the barrel is roughly on target; otherwise they'd
    // happily unload into a doorframe.
    const fwd = dirFrom(this.yaw, this.pitch, this._dir);
    const dx = t.pos.x - this.pos.x, dy = (t.pos.y + CHEST_Y) - (this.pos.y + EYE_HEIGHT), dz = t.pos.z - this.pos.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / dl;
    const cone = Math.cos(lerp(9, 3.5, this.skill) * DEG);
    if (dot < cone) return;

    // Snipers take a breath before each shot; that's their whole personality.
    if (def.scope && this.timeOnTarget < lerp(1.15, 0.42, this.skill)) return;

    if (this.fireDelay > 0) return;
    if (!lo.tryFire(now)) return;
    this._fireGun(def);

    this.shotsInBurst++;
    if (def.auto) {
      this.fireDelay = 0;
      if (this.shotsInBurst >= this.burstLen) {
        this.shotsInBurst = 0;
        this.burstPause = this.rng.range(0.16, 0.5) * (1.4 - this.skill);
      }
    } else {
      // Deliberate pause between single shots, longer for the low-skill bots.
      this.fireDelay = this.rng.range(0.06, 0.28) * (1.6 - this.skill);
    }
  }

  _fireGun(def) {
    const game = this.game;
    const eye = this.eye;
    const dir = dirFrom(this.yaw, this.pitch, V.make());
    const moveFactor = clamp(Math.hypot(this.vel.x, this.vel.z) / 5.15, 0, 1);
    const spread = this.loadout.spreadDeg(moveFactor * 0.8);
    const shotDir = spreadDir(dir, spread, this.rng, V.make());
    const hit = resolveShot(game.world, this, eye, shotDir, def, this._hit);
    game.registerShot(this, eye, shotDir, hit, def);
    this.flashFrames = 2;
    // Bots eat recoil too - a long spray climbs and starts missing high.
    this.pitch = clamp(this.pitch + def.recoil * DEG * 0.34, -1.4, 1.4);
    this.yaw += (this.rng.next() - 0.5) * def.recoilSide * DEG * 0.8;
    Sfx.shoot(def.id, V.dist(this.pos, game.player.pos));
    game.makeNoise(this.pos, def.id === 'sniper' ? 95 : 62, this);
  }

  _meleeHit() {
    const game = this.game;
    const def = WEAPONS.knife;
    const eye = this.eye;
    const dir = dirFrom(this.yaw, this.pitch, V.make());
    const res = resolveMelee(game.world, this, eye, dir, def);
    game.registerMelee(this, eye, dir, res, def);
  }

  // ------------------------------------------------------------ movement

  _move(dt) {
    const game = this.game, map = game.map;
    const lo = this.loadout;
    let wx = 0, wz = 0;

    if (this.goalCell >= 0 && this.flow) {
      const wp = map.flowStep(this.flow, this.pos, this._tmp);
      if (wp) {
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        wx = dx / l; wz = dz / l;
      }
    }

    // Combat sidestepping. It's on a timer of its own - they are not reading your bullets.
    if (this.state === STATE.COMBAT && this.target) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = this.strafePeriod * this.rng.range(0.6, 1.5);
        if (this.rng.chance(0.72)) this.strafeDir = -this.strafeDir;
      }
      const tx = this.target.pos.x - this.pos.x, tz = this.target.pos.z - this.pos.z;
      const l = Math.hypot(tx, tz) || 1;
      const sx = -tz / l * this.strafeDir, sz = tx / l * this.strafeDir;
      // If the sidestep would walk them into a wall, flip and try the other way.
      if (!map._circleFree(this.pos.x + sx * 0.9, this.pos.z + sz * 0.9, 0.45)) this.strafeDir = -this.strafeDir;
      const strafeWeight = this.goalCell === -2 ? 1.0 : 0.55;
      wx += sx * strafeWeight; wz += sz * strafeWeight;
      // Standing still to shoot is the accurate option and they know it.
      if (lo.def.scope && this.timeOnTarget < 1.2) { wx *= 0.25; wz *= 0.25; }
    }

    const l = Math.hypot(wx, wz);
    if (l > 0.001) { wx /= l; wz /= l; }

    const speed = 5.15 * (lo.def.moveMult ?? 1) * (this.state === STATE.PATROL ? 0.72 : 1);
    const accel = this.onGround ? 46 : 12;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    if (l < 0.001 && this.onGround) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0) { const k = Math.max(0, sp - sp * 9.5 * dt) / sp; this.vel.x *= k; this.vel.z *= k; }
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > speed) { const k = speed / sp; this.vel.x *= k; this.vel.z *= k; }

    // Occasional hop while fighting. Rare enough to look like a person, not a rabbit.
    this.jumpCooldown -= dt;
    if (this.state === STATE.COMBAT && this.onGround && this.jumpCooldown <= 0 && this.rng.chance(0.35 * dt * 60 / 60)) {
      this.jumpCooldown = this.rng.range(2.5, 7);
      if (this.rng.chance(this.aggression * 0.5)) this.vel.y = 6.35;
    }

    this.vel.y -= GRAVITY * dt;
    game.moveActor(this, dt);

    // Unstick: if we've barely moved while trying to, pick a new goal.
    const moved = V.distXZ(this.pos, this.lastPos);
    if (l > 0.1 && moved < 0.012) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.75) {
        this.stuckTimer = 0;
        this.goalCell = map.randomOpenCell(this.rng, 1);
        this.flow = map.buildFlow(this.goalCell, this.flow);
        this.strafeDir = -this.strafeDir;
      }
    } else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    V.copy(this.lastPos, this.pos);

    // Footsteps that the player (and other bots) can hear.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.6) {
      this.footDist += hs * dt;
      if (this.footDist > 2.05) {
        this.footDist = 0;
        Sfx.step(V.dist(this.pos, game.player.pos));
      }
    }
  }

  _tryLoot() {
    const game = this.game;
    if (!this.lootTarget) return;
    const p = this.lootTarget;
    if (game.entities.pickups.indexOf(p) < 0) { this.lootTarget = null; return; }
    if (V.distXZ(this.pos, p.pos) > 1.5 || Math.abs(p.pos.y - this.pos.y) > 2) return;
    const lo = this.loadout;
    if (lo.gun === p.gunId) {
      lo.reserve = Math.min(WEAPONS[p.gunId].reserve, lo.reserve + p.ammo + p.reserve);
    } else {
      const dropped = lo.takeGun(p.gunId, p.ammo, p.reserve);
      if (dropped) game.entities.spawnPickup(dropped.gunId, V.make(this.pos.x, this.pos.y + 0.9, this.pos.z), dropped.ammo, dropped.reserve);
    }
    game.entities.removePickup(p);
    this.lootTarget = null;
    Sfx.pickup(V.dist(this.pos, game.player.pos));
  }

  // ------------------------------------------------------------ tick

  update(dt, now) {
    if (!this.alive) { this.deathTimer += dt; return; }

    this.flinch = Math.max(0, this.flinch - dt * 2.2);
    this.hurtAnim = Math.max(0, this.hurtAnim - dt * 3);
    this.alertTimer = Math.max(0, this.alertTimer - dt);

    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      const step = 0.09;
      this._perceive(this.perceiveTimer + step);
      this.perceiveTimer = step;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.22 + this.rng.next() * 0.12;
      this._think();
    }

    this.loadout.update(dt);
    this._aim(dt, now);
    this._shoot(dt, now);
    this._move(dt);
    this._tryLoot();
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return;
    this.health -= amount;
    this.hurtAnim = 1;
    this.lastAttacker = attacker;
    // Getting hit rattles the aim and, if it came from behind, costs a full reaction
    // before they even start turning around.
    this.flinch = Math.min(1, this.flinch + amount / 70);
    if (attacker && attacker !== this.target) {
      const known = this.target && this.targetVisible;
      if (!known) {
        V.copy(this.lastKnown, attacker.pos);
        this.target = attacker;
        this.targetVisible = false;
        this.timeSinceSeen = 0.4;
        this.timeOnTarget = 0;
        this.alertTimer = Math.max(this.alertTimer, this.reactionTime * 1.35);
        this.state = STATE.HUNT;
        this.goalCell = -1;
      }
    }
    if (this.health <= 0) { this.health = 0; this.game.killActor(this, attacker); }
  }

  onDeath() {
    this.deadRoll = this.rng.range(-1, 1);
    this.deathTimer = 0;
    this.rigDirty = true;
    Sfx.death(V.dist(this.pos, this.game.player.pos));
  }

  // ------------------------------------------------------------ animation

  animStep(dtAnim, poseVisible = true) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += speed * dtAnim * 1.75;
    this.walkAmt = lerp(this.walkAmt, this.onGround ? clamp(speed / 4.2, 0, 1) : 0.3, 0.5);
    if (this.meleeAnim > 0) this.meleeAnim = Math.max(0, this.meleeAnim - dtAnim / 0.42);
    if (this.flashFrames > 0) this.flashFrames--;

    // Snap the rendered transform to this animation step: the bot slides at 60fps under
    // the hood but is *drawn* on twelves, which is where the stop-motion feel comes from.
    V.copy(this.animPos, this.pos);
    this.animYaw = this.yaw;
    this.animPitch = this.pitch;

    // Re-baking the body is the single most expensive thing an animation step does, so
    // skip it for bots nobody can see. They pick the pose back up on the step after they
    // come into view, which at twelve frames a second is invisible.
    if (!poseVisible && this.rig.fill) return;

    this.rig.rebuild({
      walkPhase: this.walkPhase,
      walkAmt: this.walkAmt,
      aimAmt: this.aimAmt,
      aimPitch: clamp(this.pitch, -0.9, 0.9),
      dead: !this.alive,
      deadT: this.alive ? 0 : clamp(this.deathTimer / 0.55, 0, 1),
      deadRoll: this.deadRoll,
      hurt: this.hurtAnim,
      meleeT: this.meleeAnim,
      reloadT: this.loadout.reloadT > 0 ? 1 - Math.abs(1 - 2 * (1 - this.loadout.reloadT / this.loadout.def.reload)) : 0,
      crouch: 0,
    });
  }

  render(r, cam) {
    const m = this._m;
    const seed = this.index * 17.3;
    M4.compose(m, this.animPos, this.animYaw, 0, 0, 1, 1, 1);
    r.fill(this.rig.fill, m, { objSeed: seed });
    r.ink(this.rig.ink, m, { objSeed: seed });

    // Pencil smudge underneath: without it a character reads as pasted onto the page.
    const shadow = M4.create();
    const sy = this.animPos.y + 0.014;
    shadowMatrix(shadow, this.animPos.x, sy, this.animPos.z, 1.35);
    r.quad(r.texSmudge, shadow, [0.32, 0.30, 0.28, this.alive ? 0.30 : 0.20]);

    if (!this.alive) return;

    // Weapon in hand, aimed along the same line the bullets take.
    const lo = this.loadout;
    const model = this.game.weapons.models[lo.id];
    if (model) {
      const held = weaponTransform(m, this.animPos, this.animYaw, this.animPitch * (0.35 + 0.6 * this.aimAmt),
        0.20 + this.aimAmt * 0.14, 1.24 + this.aimAmt * 0.16, 0.21);
      r.fill(model.body.fill, held, { objSeed: seed + 3 });
      r.ink(model.body.ink, held, { objSeed: seed + 3 });
      if (model.moving) { r.fill(model.moving.fill, held, { objSeed: seed + 3 }); r.ink(model.moving.ink, held, { objSeed: seed + 3 }); }

      if (this.flashFrames > 0 && lo.def.kind === 'gun') {
        const mz = MUZZLE[lo.id];
        const wp = V.make(
          held[0] * mz[0] + held[4] * mz[1] + held[8] * mz[2] + held[12],
          held[1] * mz[0] + held[5] * mz[1] + held[9] * mz[2] + held[13],
          held[2] * mz[0] + held[6] * mz[1] + held[10] * mz[2] + held[14]);
        this.game.entities.addFlash(wp, lo.id === 'sniper' ? 0.62 : 0.42);
        this.flashFrames = 0;
      }
    }
  }
}

/** Flat quad on the ground plane, for contact shadows. */
function shadowMatrix(out, x, y, z, size) {
  out.fill(0);
  out[0] = size; out[6] = size; out[9] = 1; out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function cellIdx(map, pos) {
  const [i, j] = map.cellOf(pos.x, pos.z);
  return map.inside(i, j) ? map.idx(i, j) : map.openCells[0];
}

export { STATE };
