// The player: movement, look, weapon handling and the viewmodel. Movement and camera run
// at the full frame rate so aiming feels immediate; the viewmodel is posed only on 12fps
// animation steps, which is what gives the hands that flip-book snap.

import { Loadout, spreadDir, resolveShot, resolveMelee, EYE_HEIGHT, BODY_RADIUS } from './combat.js';
import { WEAPONS, HOLD, ADS, MUZZLE, CYCLE } from './weapons.js';
import { M4, V, Rng, clamp, lerp, damp, dirFrom, DEG, TAU } from './math.js';
import { settings } from './settings.js';
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
    this.health = 100;
    this.alive = true;
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
    this._dir = V.make();
    this._hit = {};
    this.flashMesh = null;
  }

  ensureMeshes(gl) { if (!this.flashMesh) this.flashMesh = buildFlashMesh(gl); }

  get eye() {
    return V.make(this.pos.x, this.pos.y + EYE_HEIGHT + this.viewBob - this.landDip, this.pos.z);
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
    this.health = 100;
    this.alive = true;
    this.deathTimer = 0;
    this.punchPitch = this.punchYaw = 0;
    this.damageFlash = 0;
    this.loadout = new Loadout('pistol');
    this.pitch = 0;
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
    const maxSpeed = WALK_SPEED * (def.moveMult ?? 1) * scopePenalty;

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
    if (sp > maxSpeed) { const k = maxSpeed / sp; this.vel.x *= k; this.vel.z *= k; }

    // --- jump
    if (input.down('Space') && this.onGround) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
      Sfx.jump();
    }

    this.vel.y -= GRAVITY * dt;

    // --- integrate + collide
    const wasAir = !this.onGround;
    game.moveActor(this, dt);
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
    this.loadout.update(dt);
    this._updateWeaponInput(dt, input, now);

    // --- interaction highlight
    this._updateHighlight(input);

    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.9);
  }

  _updateWeaponInput(dt, input, now) {
    const lo = this.loadout;
    const def = lo.def;
    const game = this.game;

    // Scroll toggles between knife and gun.
    if (input.wheel !== 0) { if (lo.toggle()) Sfx.reload('in'); }
    if (input.hit('Digit1') && lo.switchTo('melee')) Sfx.reload('in');
    if (input.hit('Digit2') && lo.switchTo('gun')) Sfx.reload('in');
    if (input.hit('KeyQ')) { if (lo.toggle()) Sfx.reload('in'); }

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

  /** Queue the viewmodel for this frame. All poses are read from the 12fps state. */
  renderViewmodel(r) {
    if (!this.alive) return;
    const lo = this.loadout;
    const id = lo.id;
    const model = this.game.weapons.models[id];
    if (!model) return;
    const hold = HOLD[id];
    const vm = this.vm;
    const def = lo.def;

    const scope = def.scope ? lo.scopeT : 0;
    if (scope > 0.93) return;   // fully scoped: the reticle takes over

    // --- assemble the pose
    const bobX = Math.sin(vm.bobPhase) * 0.020 * vm.moveAmt;
    const bobY = -Math.abs(Math.cos(vm.bobPhase)) * 0.018 * vm.moveAmt;
    const drawT = lo.drawT > 0 ? lo.drawT / def.drawTime : 0;
    const reload = lo.reloadT > 0 ? 1 - Math.abs(1 - 2 * (1 - lo.reloadT / def.reload)) : 0;
    const meleeSwing = def.kind === 'melee' && lo.cooldown > 0 ? 1 - lo.cooldown / def.rate : 0;
    const kick = vm.kick;

    let px = hold.pos[0] + vm.swayX + bobX;
    let py = hold.pos[1] + vm.swayY + bobY + vm.jumpOff - drawT * 0.32 - reload * 0.11;
    let pz = hold.pos[2] + kick * 0.055;
    let rotX = hold.rot[0] - kick * 0.16 - drawT * 0.55 - reload * 0.5 + vm.swayY * 2.2;
    let rotY = hold.rot[1] + vm.swayX * 2.6 - reload * 0.35;
    let rotZ = hold.rot[2] + Math.sin(vm.bobPhase) * 0.02 * vm.moveAmt + reload * 0.4;

    if (meleeSwing > 0) {
      // Wind up, slash across, recover.
      const s = meleeSwing;
      const arc = Math.sin(s * Math.PI);
      px += -0.10 * arc + 0.16 * Math.sin(s * Math.PI * 2) * 0.5;
      py += 0.08 * arc;
      pz += -0.12 * arc;
      rotZ += -1.5 * arc;
      rotX += 0.85 * arc;
      rotY += 0.5 * arc;
    }

    if (scope > 0) {
      const ads = ADS[id] ?? { pos: hold.pos, rot: hold.rot };
      px = lerp(px, ads.pos[0], scope);
      py = lerp(py, ads.pos[1], scope);
      pz = lerp(pz, ads.pos[2] + kick * 0.06, scope);
      rotX = lerp(rotX, ads.rot[0] - kick * 0.1, scope);
      rotY = lerp(rotY, ads.rot[1], scope);
      rotZ = lerp(rotZ, ads.rot[2], scope);
    }

    const m = this._m;
    M4.compose(m, { x: px, y: py, z: pz }, rotY, rotX, rotZ, 1, 1, 1);
    const opts = { objSeed: 3.7 };
    r.vmFill(model.body.fill, m, opts);
    r.vmInk(model.body.ink, m, opts);

    // Moving part: slide/bolt travels back on firing, and the magazine drops on reload.
    if (model.moving) {
      const cyc = CYCLE[id] ?? { travel: 0.04 };
      const m2 = this._m2;
      const back = vm.cycle * cyc.travel;
      const magDrop = reload * (id === 'm4' || id === 'sniper' ? 0.16 : 0.12);
      M4.compose(m2, { x: px, y: py - magDrop, z: pz + back }, rotY, rotX, rotZ, 1, 1, 1);
      r.vmFill(model.moving.fill, m2, opts);
      r.vmInk(model.moving.ink, m2, opts);
    }

    // --- hands and forearms
    const hands = this.game.weapons;
    const local = this._m2;
    const gripWorld = applyMat(m, hold.grip);
    M4.compose(local, { x: gripWorld[0], y: gripWorld[1], z: gripWorld[2] }, rotY, rotX + 0.35, rotZ, 1, 1, 1);
    r.vmFill(hands.hand.fill, local, opts);
    r.vmInk(hands.hand.ink, local, opts);
    this._drawArm(r, hands, gripWorld, [0.30, -0.62, 0.22]);

    if (hold.support && scope < 0.8) {
      const sw = applyMat(m, hold.support);
      M4.compose(local, { x: sw[0], y: sw[1], z: sw[2] }, rotY - 0.3, rotX + 0.5, rotZ, 1, 1, 1);
      r.vmFill(hands.hand.fill, local, opts);
      r.vmInk(hands.hand.ink, local, opts);
      this._drawArm(r, hands, sw, [-0.34, -0.62, 0.22]);
    }

    // --- muzzle flash, drawn in the viewmodel pass so the gun can't hide it
    if (this.flashFrames > 0 && def.kind === 'gun' && this.flashMesh) {
      const mz = applyMat(m, MUZZLE[id]);
      const s = (def.id === 'sniper' ? 0.5 : def.id === 'm4' ? 0.34 : 0.30) * (0.85 + this.rng.next() * 0.4);
      M4.compose(local, { x: mz[0], y: mz[1], z: mz[2] }, rotY, rotX, this.game.animFrame * 1.7, s, s, s);
      r.vmFill(this.flashMesh.fill, local, opts);
      r.vmInk(this.flashMesh.ink, local, opts);
    }
  }

  _drawArm(r, hands, handWorld, shoulder) {
    const m = M4.create();
    aimMatrix(m, handWorld, shoulder);
    r.vmFill(hands.arm.fill, m, { objSeed: 8.1 });
    r.vmInk(hands.arm.ink, m, { objSeed: 8.1 });
  }
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
