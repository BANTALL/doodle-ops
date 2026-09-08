// The player: movement, look, weapon handling and the viewmodel. Movement and camera run
// at the full frame rate so aiming feels immediate; the viewmodel is posed only on 12fps
// animation steps, which is what gives the hands that flip-book snap.

import { Loadout, spreadDir, resolveShot, resolveMelee, EYE_HEIGHT, BODY_RADIUS } from './combat.js';
import { WEAPONS, HOLD, ADS, MUZZLE, CYCLE } from './weapons.js';
import { M4, V, Rng, clamp, lerp, damp, smoothstep, dirFrom, DEG, TAU } from './math.js';
import { settings } from './settings.js';
import { getDoodler } from './doodlers.js';
import { SHIELD_MAX_HP, SHIELD_PATCH_BELOW } from './skills.js';
import { Sfx } from './audio.js';
import { FillBuilder, InkBuilder } from './geom.js';
import { MAT } from './renderer.js';

const WALK_SPEED = 5.15;
const ACCEL = 62;
const AIR_ACCEL = 14;
const FRICTION = 9.5;
const GRAVITY = 18.5;
const JUMP_VEL = 6.35;
const PICKUP_RANGE = 3.1;

// Running momentum. Keep moving forward and you wind up; anything that interrupts a clean
// run - reversing, a wall, stopping - dumps it entirely. The ceiling is per-doodler.
const MOMENTUM_RAMP = 4.2;          // seconds of clean running to reach the top
const MOMENTUM_MIN_SPEED = 2.6;     // below this you aren't running, you're shuffling
const STRAFE_BLEED = 0.10;          // fraction of the *boost* a sidestep costs
const STRAFE_BLEED_EVERY = 0.4;     // ...applied this often while you hold it
const STRAFE_FAST = 4.2;            // only counts once you're actually moving

// Knife idle: stand still this long and you spin it, for this long, then rest and repeat.
const IDLE_TWIRL_AFTER = 3.0;
const TWIRL_DURATION = 2.0;
const TWIRL_TURNS = 2;              // whole turns per trick, so it lands where it started

/** Matrix at `from` whose +Z axis points at `toward`. Used to aim the forearms. */
function aimMatrix(out, from, toward) {
  let fx = toward[0] - from[0], fy = toward[1] - from[1], fz = toward[2] - from[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = up x forward, with world up = (0,1,0)
  let rx = fz, ry = 0, rz = -fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
  out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
  out[4] = -ux; out[5] = -uy; out[6] = -uz; out[7] = 0;
  out[8] = fx; out[9] = fy; out[10] = fz; out[11] = 0;
  out[12] = from[0]; out[13] = from[1]; out[14] = from[2]; out[15] = 1;
  return out;
}

/** Comic starburst as real geometry, so the player's muzzle flash gets an ink outline. */
function buildFlashMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  const rng = new Rng(4242);
  const pts = [];
  const spikes = 9;
  for (let k = 0; k < spikes * 2; k++) {
    const a = (k / (spikes * 2)) * TAU;
    const r = k % 2 === 0 ? rng.range(0.42, 0.5) : rng.range(0.16, 0.22);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const base = f.n;
  for (const p of pts) f.vertex(p[0], p[1], 0, 0, 0, 1, p[0], p[1], MAT.LIGHT);
  for (let k = 1; k < pts.length - 1; k++) f.i.push(base, base + k, base + k + 1);
  const base2 = f.n;
  for (const p of pts) f.vertex(p[0], p[1], -0.004, 0, 0, -1, p[0], p[1], MAT.LIGHT);
  for (let k = 1; k < pts.length - 1; k++) f.i.push(base2, base2 + k + 1, base2 + k);
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    i.edge([a[0], a[1], 0], [b[0], b[1], 0], 2.0);
  }
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

export class Player {
  constructor(game) {
    this.game = game;
    this.name = 'YOU';
    this.isPlayer = true;
    this.pos = V.make(0, 0, 0);
    this.vel = V.make(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.doodler = getDoodler(settings.doodler);
    this.maxHealth = this.doodler.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.skillCooldown = 0;
    this.skillCharges = this.doodler.skill?.charges ?? 0;
    this.slideT = 0;
    this.slideDip = 0;
    this.kills = 0;
    this.deaths = 0;
    this.onGround = true;
    this.loadout = new Loadout('pistol');
    this.rng = new Rng(1337);

    this.punchPitch = 0; this.punchYaw = 0;
    this.punchVelP = 0; this.punchVelY = 0;
    this.bobPhase = 0;
    this.viewBob = 0;
    this.landDip = 0;
    this.roll = 0;
    this.damageFlash = 0;
    this.deathTimer = 0;
    this.respawnAt = 0;
    this.footDist = 0;
    this.lastAttacker = null;
    this.momentum = 0;
    this.strafeBleedT = 0;
    // Eased toward the map's colour mask, exactly like the bots: your own hands and gun
    // drain of colour as you cross into the uncoloured half, over about a second.
    this.colorAmt = 1;
    this.idleTimer = 0;
    this.twirlActive = false;
    this.twirlBlend = 0;
    this.twirlT = 0;

    // viewmodel animation state, only touched on animation steps
    this.vm = {
      swayX: 0, swayY: 0, swayTargetX: 0, swayTargetY: 0,
      bob: 0, bobPhase: 0, kick: 0, kickRot: 0, cycle: 0,
      lastFrameFired: -99, moveAmt: 0, jumpOff: 0,
    };
    this.lookDeltaAccum = { x: 0, y: 0 };
    this.flashFrames = 0;

    this.highlighted = null;
    this._m = M4.create();
    this._m2 = M4.create();
    this._m3 = M4.create();
    this._poseScratch = [makePose(), makePose(), makePose(), makePose()];
    this._dir = V.make();
    this._hit = {};
    this.flashMesh = null;
  }

  ensureMeshes(gl) { if (!this.flashMesh) this.flashMesh = buildFlashMesh(gl); }

  get eye() {
    return V.make(this.pos.x, this.pos.y + EYE_HEIGHT + this.viewBob - this.landDip - this.slideDip, this.pos.z);
  }

  /** Camera angles including recoil punch. */
  get aimYaw() { return this.yaw + this.punchYaw; }
  get aimPitch() { return clamp(this.pitch + this.punchPitch, -1.553, 1.553); }

  aimDir(out = V.make()) { return dirFrom(this.aimYaw, this.aimPitch, out); }

  get fovScale() {
    const def = this.loadout.def;
    if (def.scope) return lerp(1, def.scopeFov / settings.fov, this.loadout.scopeT);
    return 1;
  }

  respawn(pos) {
    V.copy(this.pos, pos);
    V.set(this.vel, 0, 0, 0);
    this.maxHealth = this.doodler.health;
    this.health = this.maxHealth;
    this.alive = true;
    this.deathTimer = 0;
    this.punchPitch = this.punchYaw = 0;
    this.damageFlash = 0;
    this.loadout = new Loadout('pistol');
    this.pitch = 0;
    this.momentum = 0;
    this.skillCooldown = 0;
    this.skillCharges = this.doodler.skill?.charges ?? 0;
    this.slideT = 0;
    this.slideDip = 0;
    this.idleTimer = 0;
    this.twirlActive = false;
    this.twirlBlend = 0;
    this.twirlT = 0;
  }

  /** Speed multiplier from running momentum. */
  get momentumMult() { return 1 + this.doodler.momentumMax * this.momentum; }

  /** Swap class. Takes effect immediately - callers respawn afterwards for a clean start. */
  applyDoodler(id) {
    this.doodler = getDoodler(id);
    this.maxHealth = this.doodler.health;
    this.health = Math.min(this.health, this.maxHealth);
    this.skillCooldown = 0;
    this.skillCharges = this.doodler.skill?.charges ?? 0;
  }

  // ------------------------------------------------------------ input

  applyLook(dx, dy) {
    const scoped = this.loadout.scopeT;
    const sens = lerp(settings.sensitivity, settings.scopedSensitivity, scoped) * 0.0009;
    this.yaw -= dx * sens;
    this.pitch += (settings.invertY ? dy : -dy) * sens;
    this.pitch = clamp(this.pitch, -1.553, 1.553);
    if (this.yaw > Math.PI) this.yaw -= TAU; else if (this.yaw < -Math.PI) this.yaw += TAU;
    this.lookDeltaAccum.x += dx;
    this.lookDeltaAccum.y += dy;
  }

  update(dt, input, now) {
    const game = this.game;
    if (!this.alive) {
      this.deathTimer += dt;
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
      return;
    }

    // --- look
    if (input.locked && (input.mouseDX || input.mouseDY)) this.applyLook(input.mouseDX, input.mouseDY);

    // Recoil punch: springs back toward zero.
    const spring = 46, damping = 11;
    this.punchVelP += (-this.punchPitch * spring - this.punchVelP * damping) * dt;
    this.punchVelY += (-this.punchYaw * spring - this.punchVelY * damping) * dt;
    this.punchPitch += this.punchVelP * dt;
    this.punchYaw += this.punchVelY * dt;

    // --- movement intent
    let fwd = 0, side = 0;
    if (input.down('KeyW')) fwd += 1;
    if (input.down('KeyS')) fwd -= 1;
    if (input.down('KeyD')) side += 1;
    if (input.down('KeyA')) side -= 1;
    const mag = Math.hypot(fwd, side);
    let wx = 0, wz = 0;
    if (mag > 0) {
      fwd /= mag; side /= mag;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      wx = (-sy * fwd) + (cy * side);
      wz = (-cy * fwd) + (-sy * side);
    }

    const def = this.loadout.def;
    const scopePenalty = lerp(1, 0.45, this.loadout.scopeT);
    const maxSpeed = WALK_SPEED * this.doodler.speedMult * (def.moveMult ?? 1) * scopePenalty * this.momentumMult;

    const accel = this.onGround ? ACCEL : AIR_ACCEL;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;

    if (this.onGround && mag === 0) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0) {
        const drop = Math.max(0, sp - Math.max(sp * FRICTION * dt, 0.6 * dt * FRICTION));
        const k = drop / sp;
        this.vel.x *= k; this.vel.z *= k;
      }
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > maxSpeed && this.slideT <= 0) { const k = maxSpeed / sp; this.vel.x *= k; this.vel.z *= k; }

    if (this.slideT > 0) {
      this.slideT -= dt;
      // Bleed the burst off rather than cutting it, and duck for the duration.
      this.vel.x *= 1 - 1.4 * dt;
      this.vel.z *= 1 - 1.4 * dt;
    }
    this.slideDip = damp(this.slideDip, this.slideT > 0 ? 0.34 : 0, 12, dt);

    // --- jump
    if (input.down('Space') && this.onGround) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
      Sfx.jump();
    }

    this.vel.y -= GRAVITY * dt;

    // --- integrate + collide
    const wasAir = !this.onGround;
    const blocked = game.moveActor(this, dt);
    this._updateMomentum(dt, fwd, side, mag, blocked);
    if (wasAir && this.onGround) {
      this.landDip = Math.min(0.22, Math.abs(this.vel.y) * 0.012 + 0.06);
      Sfx.land();
    }

    // --- footsteps + bob
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed > 0.6) {
      this.footDist += speed * dt;
      if (this.footDist > 2.05) { this.footDist = 0; Sfx.step(); game.makeNoise(this.pos, 12, this); }
    }
    this.bobPhase += speed * dt * 1.9;
    const bobTarget = this.onGround ? Math.sin(this.bobPhase * 2) * 0.026 * clamp(speed / WALK_SPEED, 0, 1) : 0;
    this.viewBob = damp(this.viewBob, bobTarget, 14, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
    const strafeLean = clamp((this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) / WALK_SPEED, -1, 1);
    this.roll = damp(this.roll, -strafeLean * 0.021, 8, dt);

    // --- weapons
    // --- skills
    if (this.skillCooldown > 0) {
      this.skillCooldown = Math.max(0, this.skillCooldown - dt);
      if (this.skillCooldown === 0) this.skillCharges = this.doodler.skill?.charges ?? 0;
    }
    if (input.hit('KeyQ')) this.useSkill();

    this.loadout.update(dt);
    this._updateWeaponInput(dt, input, now);

    // --- interaction highlight
    this._updateHighlight(input);

    this.colorAmt = damp(this.colorAmt, game.map.colorAmountAt(this.pos.x, this.pos.z), 1.8, dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.9);
  }

  /**
   * Momentum bookkeeping. Built by running forward, spent by everything else: reversing,
   * stopping, or putting a shoulder into a wall clears it outright, and sidestepping at
   * speed shaves a tenth off the boost each time it ticks.
   */
  _updateMomentum(dt, fwd, side, mag, blocked) {
    const speed = Math.hypot(this.vel.x, this.vel.z);

    if (blocked || fwd < -0.05 || mag === 0 || speed < 1.4) {
      this.momentum = 0;
      this.strafeBleedT = 0;
      return;
    }

    const strafing = Math.abs(side) > 0.4 && speed > STRAFE_FAST;

    // Building and bleeding at full rate would cancel out and you'd never feel the cost of
    // a sidestep, so a fast strafe throttles the build as well as taking its cut. Holding a
    // diagonal settles at roughly a third of the boost instead of pinning at the top.
    if (fwd > 0.3 && speed > MOMENTUM_MIN_SPEED) {
      this.momentum = Math.min(1, this.momentum + dt / MOMENTUM_RAMP * (strafing ? 0.35 : 1));
    }

    if (strafing) {
      this.strafeBleedT += dt;
      while (this.strafeBleedT >= STRAFE_BLEED_EVERY) {
        this.strafeBleedT -= STRAFE_BLEED_EVERY;
        this.momentum *= 1 - STRAFE_BLEED;
      }
    } else {
      this.strafeBleedT = 0;
    }
  }

  _updateWeaponInput(dt, input, now) {
    const lo = this.loadout;
    const def = lo.def;
    const game = this.game;

    // Scroll toggles between knife and gun.
    if (input.wheel !== 0) { if (lo.toggle()) Sfx.reload('in'); }
    if (input.hit('Digit1') && lo.switchTo('melee')) Sfx.reload('in');
    if (input.hit('Digit2') && lo.switchTo('gun')) Sfx.reload('in');


    // Sniper scope: right mouse must be held, releasing cancels it.
    if (def.scope && !lo.busy && lo.ammo > 0) {
      const want = input.buttons[2];
      if (want !== lo.scoped) { lo.scoped = want; Sfx.scope(want); }
    } else if (lo.scoped) {
      lo.scoped = false;
    }

    if (input.hit('KeyR')) { if (lo.startReload()) Sfx.reload('out'); }

    // Melee swings land a beat after the button, matching the animation.
    if (lo.pendingMelee > 0) {
      lo.pendingMelee -= dt;
      if (lo.pendingMelee <= 0) this._meleeHit();
    }

    // Idle knife play: stand still holding the knife and every few seconds you flip it
    // over in your hand, then let it rest again. One trick, then a pause - a knife that
    // never stops rotating reads as a broken animation, not as fidgeting.
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const idleOk = lo.isMelee && lo.cooldown <= 0 && lo.drawT <= 0 && speed < 1.2 && !input.buttons[0];
    if (idleOk) this.idleTimer += dt; else this.idleTimer = 0;
    const period = IDLE_TWIRL_AFTER + TWIRL_DURATION;
    const cyc = this.idleTimer % period;
    this.twirlActive = idleOk && this.idleTimer >= IDLE_TWIRL_AFTER && cyc >= IDLE_TWIRL_AFTER;
    this.twirlT = this.twirlActive ? (cyc - IDLE_TWIRL_AFTER) / TWIRL_DURATION : 0;
    this.twirlBlend = damp(this.twirlBlend, this.twirlActive ? 1 : 0, 12, dt);

    const wantFire = def.auto ? input.buttons[0] : input.buttonPressed[0];
    if (wantFire) {
      if (def.kind === 'gun' && lo.ammo <= 0 && lo.reloadT <= 0 && !lo.drawT) {
        if (lo.reserve > 0) { if (lo.startReload()) Sfx.reload('out'); }
        else if (input.buttonPressed[0]) Sfx.uiClick();
      } else if (lo.tryFire(now)) {
        if (def.kind === 'melee') { Sfx.swing(); this.vm.kick = 1; this.vm.lastFrameFired = game.animFrame; }
        else this._fireGun(def);
      }
    }
  }

  /**
   * Q. Each doodler's skill is a different shape, so this is a small switch rather than a
   * generic system - there are four of them and they share almost nothing.
   */
  useSkill() {
    const skill = this.doodler.skill;
    if (!skill || !this.alive) return false;
    const game = this.game;

    if (skill.id === 'shield') {
      const sh = game.shieldOf(this);
      // Only patchable once it's nearly gone - you can't top it up after every graze.
      if (sh && sh.alive && sh.hp >= SHIELD_PATCH_BELOW) {
        game.toast(`SHIELD STILL HOLDING (${Math.ceil(sh.hp)})`);
        return false;
      }
      if (this.skillCooldown > 0) return false;
      if (!sh || !sh.alive) game.spawnShield(this);
      else sh.reset(SHIELD_MAX_HP);
      this.skillCooldown = skill.cooldown;
      Sfx.pickup();
      game.toast('SHIELD REDRAWN');
      return true;
    }

    if (skill.id === 'turret') {
      if (this.skillCharges <= 0) return false;
      if (!game.placeTurret(this)) return false;
      this.skillCharges--;
      if (this.skillCharges <= 0) this.skillCooldown = skill.cooldown;
      Sfx.reload('in');
      game.toast(`TURRET DOWN (${this.skillCharges} left)`);
      return true;
    }

    if (skill.id === 'slide') {
      if (this.skillCooldown > 0 || !this.onGround) return false;
      const dir = dirFrom(this.yaw, 0, this._dir);
      const burst = WALK_SPEED * this.doodler.speedMult * this.momentumMult * 2.1;
      this.vel.x = dir.x * burst;
      this.vel.z = dir.z * burst;
      this.slideT = 0.45;
      this.skillCooldown = skill.cooldown;
      Sfx.swing();
      return true;
    }
    return false;
  }

  _fireGun(def) {
    const game = this.game;
    const eye = this.eye;
    const dir = this.aimDir(this._dir);
    const moveFactor = clamp(Math.hypot(this.vel.x, this.vel.z) / WALK_SPEED, 0, 1) * (this.onGround ? 1 : 1.7);
    const spread = this.loadout.spreadDeg(moveFactor);
    const shotDir = spreadDir(dir, spread, this.rng, V.make());

    const hit = resolveShot(game.world, this, eye, shotDir, def, this._hit);
    game.registerShot(this, eye, shotDir, hit, def);

    // Recoil: up, plus a sideways nudge that alternates so sprays snake.
    this.punchVelP += def.recoil * DEG * 26;
    this.punchVelY += (this.rng.next() < 0.5 ? -1 : 1) * def.recoilSide * DEG * 22;
    this.vm.kick = 1;
    this.vm.cycle = 1;
    this.vm.lastFrameFired = game.animFrame;
    this.flashFrames = 2;
    Sfx.shoot(def.id);
    game.makeNoise(this.pos, def.id === 'sniper' ? 95 : 62, this);
  }

  _meleeHit() {
    const game = this.game;
    const def = WEAPONS.knife;
    const eye = this.eye;
    const dir = this.aimDir(this._dir);
    const res = resolveMelee(game.world, this, eye, dir, def);
    game.registerMelee(this, eye, dir, res, def);
  }

  _updateHighlight(input) {
    const game = this.game;
    const eye = this.eye;
    const dir = this.aimDir(this._dir);
    let best = null, bestScore = 0.955;   // ~17 degrees off-centre
    for (const p of game.entities.pickups) {
      if (p.kind === 'heart') continue;   // hearts are walked over, not prompted for
      const dx = p.pos.x - eye.x, dy = p.pos.y - eye.y, dz = p.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > PICKUP_RANGE) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < bestScore) continue;
      if (!game.map.lineOfSight(eye, p.pos)) continue;
      bestScore = dot; best = p;
    }
    this.highlighted = best;
    if (best) {
      best.highlight = 1;
      if (input.hit('KeyE')) this.pickUp(best);
    }
  }

  pickUp(p) {
    const game = this.game;
    const lo = this.loadout;
    if (lo.gun === p.gunId) {
      // Same gun: just top up the ammo rather than juggling identical weapons.
      const def = WEAPONS[p.gunId];
      const gained = p.ammo + p.reserve;
      if (lo.reserve >= def.reserve) return;
      lo.reserve = Math.min(def.reserve, lo.reserve + gained);
      game.entities.removePickup(p);
      Sfx.pickup();
      game.toast(`+${gained} ${def.name} AMMO`);
      return;
    }
    const dropped = lo.takeGun(p.gunId, p.ammo, p.reserve);
    game.entities.removePickup(p);
    if (dropped) {
      const drop = V.make(this.pos.x, this.pos.y + 0.9, this.pos.z);
      game.entities.spawnPickup(dropped.gunId, drop, dropped.ammo, dropped.reserve);
      Sfx.drop();
    }
    Sfx.pickup();
    game.toast(`PICKED UP ${WEAPONS[p.gunId].name}`);
  }

  /** Drop whatever gun is carried - called on death. */
  dropGun() {
    const lo = this.loadout;
    if (!lo.gun) return;
    const drop = V.make(this.pos.x, this.pos.y + 0.9, this.pos.z);
    this.game.entities.spawnPickup(lo.gun, drop, lo.ammo, lo.reserve);
    lo.gun = null;
    lo.slot = 'melee';
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return;
    this.health -= amount;
    this.damageFlash = Math.min(1, this.damageFlash + amount / 55);
    this.lastAttacker = attacker;
    Sfx.hurt();
    // A hit rocks the view a little, so you feel where it came from.
    if (attacker) {
      const dx = attacker.pos.x - this.pos.x, dz = attacker.pos.z - this.pos.z;
      const rel = Math.atan2(-dx, -dz) - this.yaw;
      this.punchVelY += Math.sin(rel) * 0.9;
      this.punchVelP += 0.7;
    }
    if (this.health <= 0) { this.health = 0; this.game.killActor(this, attacker); }
  }

  // ------------------------------------------------------------ animation

  /** Called once per 12fps step. */
  animStep(dtAnim) {
    const vm = this.vm;
    const lo = this.loadout;

    // Sway lags the mouse, then eases back - the gun "catches up" to where you look.
    vm.swayTargetX = clamp(-this.lookDeltaAccum.x * 0.00042, -0.05, 0.05);
    vm.swayTargetY = clamp(this.lookDeltaAccum.y * 0.00042, -0.05, 0.05);
    this.lookDeltaAccum.x = 0; this.lookDeltaAccum.y = 0;
    vm.swayX = lerp(vm.swayX, vm.swayTargetX, 0.45);
    vm.swayY = lerp(vm.swayY, vm.swayTargetY, 0.45);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    vm.moveAmt = lerp(vm.moveAmt, this.onGround ? clamp(speed / WALK_SPEED, 0, 1) : 0, 0.4);
    vm.bobPhase += dtAnim * (2.0 + speed * 1.5);
    vm.jumpOff = lerp(vm.jumpOff, this.onGround ? 0 : clamp(-this.vel.y * 0.012, -0.05, 0.05), 0.4);

    vm.kick = Math.max(0, vm.kick - dtAnim * (lo.def.kind === 'melee' ? 3.2 : 6.5));
    const cyc = CYCLE[lo.id];
    vm.cycle = Math.max(0, vm.cycle - dtAnim / (cyc ? cyc.time : 0.1));
    if (this.flashFrames > 0) this.flashFrames--;
  }

  // ---- viewmodel pose ----------------------------------------------------
  //
  // The pose is a pure function of the weapon timers, which is what makes smear frames
  // possible: ask for the same pose a few milliseconds "ago" and draw its outline faintly
  // behind the real one. Fast moves - a slash, a swap twirl - trail; slow ones don't.

  /**
   * @param back  seconds to rewind the fast timers by (0 for the pose you actually see)
   */
  _vmPose(back, out) {
    const lo = this.loadout;
    const curDef = lo.def;
    const vm = this.vm;

    const drawTime = curDef.drawTime;
    const drawT = lo.drawT > 0 ? Math.min(drawTime, lo.drawT + back) : 0;
    const reloadT = lo.reloadT > 0 ? Math.min(curDef.reload, lo.reloadT + back) : 0;
    const swapping = drawT > 0 && !!lo.swapFrom;
    const swapP = swapping ? 1 - drawT / drawTime : 1;

    // Halfway through the twirl the old weapon becomes the new one - that swap happens
    // while it's spinning fastest, so you read it as the knife *turning into* the gun.
    const id = swapping && swapP < 0.5 ? lo.swapFrom : lo.id;
    const def = WEAPONS[id];
    const hold = HOLD[id];

    const scope = curDef.scope ? lo.scopeT : 0;
    const bobX = Math.sin(vm.bobPhase) * 0.020 * vm.moveAmt;
    const bobY = -Math.abs(Math.cos(vm.bobPhase)) * 0.018 * vm.moveAmt;
    const reload = reloadT > 0 ? 1 - Math.abs(1 - 2 * (1 - reloadT / curDef.reload)) : 0;
    const kick = vm.kick;

    let px = hold.pos[0] + vm.swayX + bobX;
    let py = hold.pos[1] + vm.swayY + bobY + vm.jumpOff - reload * 0.11;
    let pz = hold.pos[2] + kick * 0.055;
    let rx = hold.rot[0] - kick * 0.16 - reload * 0.5 + vm.swayY * 2.2;
    let ry = hold.rot[1] + vm.swayX * 2.6 - reload * 0.35;
    let rz = hold.rot[2] + Math.sin(vm.bobPhase) * 0.02 * vm.moveAmt + reload * 0.4;
    let scale = 1;
    let hands = true;
    let smear = 0;

    if (swapping) {
      // Two full tumbles across the draw. The weapon is pulled *in front of you* and held
      // a little further out rather than dropped out of frame - the point of the move is
      // that you watch the knife turn into the gun mid-spin.
      const dip = Math.sin(swapP * Math.PI);
      rx += swapP * TAU * 2;
      ry += Math.sin(swapP * TAU) * 0.35;
      px = lerp(px, 0.10, dip);
      py = lerp(py, -0.085, dip);
      pz = lerp(pz, -0.54, dip);
      scale = 1 - dip * 0.10;
      hands = dip < 0.30;             // you let go of it while it spins
      smear = Math.max(smear, dip);
    } else {
      py -= drawT / drawTime * 0.32;  // plain draw-up when there's nothing to swap from
      rx -= drawT / drawTime * 0.55;
    }

    // ---- knife slash: wind up, cut fast, recover ----
    if (def.kind === 'melee' && !swapping) {
      const cd = lo.cooldown > 0 ? Math.min(def.rate, lo.cooldown + back) : 0;
      if (cd > 0) {
        const t = 1 - cd / def.rate;
        const dir = lo.slashDir;
        const WIND = 0.24, CUT = 0.46;
        let ax, ay, az, arx, ary, arz;
        // Kept shallow vertically: a big drop on the follow-through reads as the knife
        // falling out of the bottom of the screen rather than as a cut.
        if (t < WIND) {
          const e = smoothstep(0, 1, t / WIND);
          ax = dir * 0.13 * e; ay = 0.055 * e; az = 0.06 * e;
          arx = -0.34 * e; ary = dir * 0.46 * e; arz = dir * 1.00 * e;
        } else if (t < CUT) {
          // The cut itself, accelerating - this is the part that smears.
          const u = (t - WIND) / (CUT - WIND);
          const e = u * u;
          ax = lerp(dir * 0.13, -dir * 0.30, e);
          ay = lerp(0.055, -0.010, e);
          az = lerp(0.06, -0.15, e);
          arx = lerp(-0.34, 0.50, e);
          ary = lerp(dir * 0.46, -dir * 0.70, e);
          arz = lerp(dir * 1.00, -dir * 2.10, e);
          smear = Math.max(smear, 0.45 + Math.sin(u * Math.PI) * 0.75);
        } else {
          const e = 1 - (1 - (t - CUT) / (1 - CUT)) ** 2;
          ax = lerp(-dir * 0.30, 0, e); ay = lerp(-0.010, 0, e); az = lerp(-0.15, 0, e);
          arx = lerp(0.50, 0, e); ary = lerp(-dir * 0.70, 0, e); arz = lerp(-dir * 2.10, 0, e);
        }
        px += ax; py += ay; pz += az; rx += arx; ry += ary; rz += arz;
      }
    }

    // ---- idle: flipping the knife over in your hand ----
    let spinAdd = 0;
    if (this.twirlBlend > 0.001 && def.kind === 'melee' && !swapping && lo.cooldown <= 0) {
      const tw = this.twirlBlend;
      // Rewind the trick's own progress for smear ghosts.
      const t = clamp(this.twirlT - back / TWIRL_DURATION, 0, 1);
      // Eased so it winds up, whips round and is caught - and it lands on a whole number
      // of turns, so the knife finishes exactly where it started instead of snapping back.
      const e = smoothstep(0, 1, t);
      spinAdd = e * TAU * TWIRL_TURNS * tw;
      const swell = Math.sin(t * Math.PI);       // peaks mid-trick
      // Held out and back a little while it goes round, so the trick is legible without
      // the hand taking over a third of the screen.
      px = lerp(px, 0.205, tw);
      py = lerp(py, -0.105, tw) + swell * 0.028 * tw;
      pz = lerp(pz, -0.62, tw);
      ry += 0.30 * tw;
      rz += (0.20 + Math.sin(t * TAU) * 0.16) * tw;
      smear = Math.max(smear, swell * 0.5 * tw);
    }
    const handRx = rx;      // the hand holds still; only the knife goes round
    rx += spinAdd;

    if (scope > 0 && !swapping) {
      const ads = ADS[id] ?? { pos: hold.pos, rot: hold.rot };
      px = lerp(px, ads.pos[0], scope);
      py = lerp(py, ads.pos[1], scope);
      pz = lerp(pz, ads.pos[2] + kick * 0.06, scope);
      rx = lerp(rx, ads.rot[0] - kick * 0.1, scope);
      ry = lerp(ry, ads.rot[1], scope);
      rz = lerp(rz, ads.rot[2], scope);
    }

    out.id = id; out.def = def; out.hold = hold;
    out.px = px; out.py = py; out.pz = pz;
    out.rx = rx; out.ry = ry; out.rz = rz;
    out.scale = scale; out.hands = hands; out.smear = smear;
    out.handRx = handRx;
    out.reload = reload; out.scope = scope;
    return out;
  }

  /** Queue the viewmodel for this frame, plus smear ghosts when it's moving fast. */
  renderViewmodel(r) {
    if (!this.alive) return;
    const lo = this.loadout;
    if (lo.def.scope && lo.scopeT > 0.93) return;   // fully scoped: the reticle takes over

    // Everything here is sampled at the last 12fps step, never at the current instant.
    // The knife swing in particular was running at the display rate, which made it the
    // one thing on screen that didn't move on twelves.
    const lag = this.game.animLag;
    const scratch = this._poseScratch;
    const main = this._vmPose(lag, scratch[0]);
    if (!this.game.weapons.models[main.id]) return;

    // Ghost outlines trail the real weapon along its own motion. Hand-drawn animation
    // does exactly this on a fast action, and it's the only honest way to sell speed
    // when the thing is only being drawn twelve times a second.
    if (main.smear > 0.06) {
      const ghosts = main.smear > 0.65 ? 3 : 2;
      for (let k = ghosts; k >= 1; k--) {
        const g = this._vmPose(lag + k * (1 / 12) * 0.33, scratch[k]);
        if (this.game.weapons.models[g.id]) {
          this._drawWeapon(r, g, clamp(main.smear, 0, 1) * (0.34 / k), true);
        }
      }
    }
    this._drawWeapon(r, main, 1, false);
  }

  _drawWeapon(r, pose, alpha, inkOnly) {
    const model = this.game.weapons.models[pose.id];
    const s = pose.scale;
    const m = this._m;
    M4.compose(m, { x: pose.px, y: pose.py, z: pose.pz }, pose.ry, pose.rx, pose.rz, s, s, s);
    const opts = { objSeed: 3.7, alpha, colorAmt: this.colorAmt };

    if (!inkOnly) r.vmFill(model.body.fill, m, opts);
    r.vmInk(model.body.ink, m, opts);

    if (model.moving) {
      const cyc = CYCLE[pose.id] ?? { travel: 0.04 };
      const m2 = this._m2;
      const back = this.vm.cycle * cyc.travel;
      const magDrop = pose.reload * (pose.id === 'm4' || pose.id === 'sniper' ? 0.16 : 0.12);
      M4.compose(m2, { x: pose.px, y: pose.py - magDrop, z: pose.pz + back }, pose.ry, pose.rx, pose.rz, s, s, s);
      if (!inkOnly) r.vmFill(model.moving.fill, m2, opts);
      r.vmInk(model.moving.ink, m2, opts);
    }

    if (inkOnly) return;

    // --- hands and forearms
    if (pose.hands) {
      const hands = this.game.weapons;
      const local = this._m3;
      // Hands are placed from a matrix without the idle spin in it, so the knife turns
      // inside a steady hand rather than the whole fist cartwheeling with it.
      const mHand = M4.compose(this._m4 ?? (this._m4 = M4.create()),
        { x: pose.px, y: pose.py, z: pose.pz }, pose.ry, pose.handRx, pose.rz, s, s, s);
      const gripWorld = applyMat(mHand, pose.hold.grip);
      M4.compose(local, { x: gripWorld[0], y: gripWorld[1], z: gripWorld[2] }, pose.ry, pose.handRx + 0.35, pose.rz, 1, 1, 1);
      r.vmFill(hands.hand.fill, local, opts);
      r.vmInk(hands.hand.ink, local, opts);
      this._drawArm(r, hands, gripWorld, [0.30, -0.62, 0.22]);

      if (pose.hold.support && pose.scope < 0.8) {
        const sw = applyMat(mHand, pose.hold.support);
        M4.compose(local, { x: sw[0], y: sw[1], z: sw[2] }, pose.ry - 0.3, pose.handRx + 0.5, pose.rz, 1, 1, 1);
        r.vmFill(hands.hand.fill, local, opts);
        r.vmInk(hands.hand.ink, local, opts);
        this._drawArm(r, hands, sw, [-0.34, -0.62, 0.22]);
      }
    }

    // --- muzzle flash, drawn in the viewmodel pass so the gun can't hide it
    if (this.flashFrames > 0 && pose.def.kind === 'gun' && this.flashMesh) {
      const mz = applyMat(m, MUZZLE[pose.id]);
      const size = (pose.def.id === 'sniper' ? 0.5 : pose.def.id === 'm4' ? 0.34 : 0.30) * (0.85 + this.rng.next() * 0.4);
      M4.compose(this._m3, { x: mz[0], y: mz[1], z: mz[2] }, pose.ry, pose.rx, this.game.animFrame * 1.7, size, size, size);
      r.vmFill(this.flashMesh.fill, this._m3, opts);
      r.vmInk(this.flashMesh.ink, this._m3, opts);
    }
  }

  _drawArm(r, hands, handWorld, shoulder) {
    const m = M4.create();
    aimMatrix(m, handWorld, shoulder);
    r.vmFill(hands.arm.fill, m, { objSeed: 8.1, colorAmt: this.colorAmt });
    r.vmInk(hands.arm.ink, m, { objSeed: 8.1 });
  }
}

function makePose() {
  return {
    id: 'pistol', def: null, hold: null,
    px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0,
    scale: 1, hands: true, smear: 0, reload: 0, scope: 0, handRx: 0,
  };
}

/** Transform a local point by a mat4, returning a plain array. */
function applyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export { applyMat, WALK_SPEED, BODY_RADIUS };
