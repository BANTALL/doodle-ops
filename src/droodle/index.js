// The DROODLE CANNON, wired into the game.
//
// The weapon itself is in weapon.js, its drawings in art.js, its world effects in fx.js
// and its screen effects in screen.js. This is the part that knows *when* any of that
// happens: it owns the per-holder state, the charge timer and the beam, and the game calls
// into it at a handful of named points rather than the other way round.
//
// Two things make it different from the three guns already in the game.
//
// The round is not a bullet. It is a fireball you can see crossing the room, so the hitscan
// still decides everything up front - what it hits, for how much - and then the delivery is
// held back until the drawing arrives. And because it is a fireball rather than a bullet,
// it is measured against a body three times as wide.
//
// Every third pull of the trigger fires nothing. It winds the cannon up for nine animation
// frames and then lets go on its own: a straight beam to the first wall that takes 75 off
// everything standing in it.

import { V, M4, clamp, hash01, dirFrom } from '../math.js';
import { BODY_RADIUS, BODY_HEIGHT, HEAD_Y, HEAD_R } from '../combat.js';
import { rayCharacter } from '../entities.js';
import { WEAPONS } from '../weapons.js';
import { Sfx } from '../audio.js';

import { ID, DEF, MUZZLE_POINT, CHARGE_FRAMES, LASER_FRAMES, registerWeapon } from './weapon.js';
import { DroodleFX } from './fx.js';
import { ScreenFX } from './screen.js';

export { ID as DROODLE_ID, DEF as DROODLE_DEF };

/** One crate in this many hands over a cannon instead of whatever it was going to drop. */
const DROP_CHANCE = 0.13;
/** Animation frames the weapon spends recovering from a shot. */
const RECOIL_FRAMES = 4;
/** How many are lying on the floor at the start of a match, so it's findable. */
const SEEDED = 2;

export class DroodleCannon {
  constructor(game) {
    this.game = game;
    this.fx = new DroodleFX(game.gl);
    this.screen = new ScreenFX();
    this.suppressTracer = false;
    this.blackFrameOff = false;
    this._fatPos = V.make();
    this._vmMat = M4.create();
    this._ghosts = [{}, {}, {}, {}];
    registerWeapon(game);
  }

  /** Lazily-made per-holder state. Bots get one too - they fire the rounds, not the beam. */
  stateOf(actor) {
    let s = actor._droodle;
    if (!s) {
      s = { shots: 0, charging: false, chargeFrame0: -999, fireFrame: -999, laserFrame: -999 };
      actor._droodle = s;
    }
    return s;
  }

  /** Charge progress 0..1 at a given animation frame - a pure function of the frame. */
  chargeAt(st, frame) {
    if (!st.charging) return 0;
    return clamp((frame - st.chargeFrame0) / CHARGE_FRAMES, 0, 1);
  }

  /** How much recoil is left at a given animation frame. Same deal. */
  recoilAt(st, frame) {
    const k = frame - st.fireFrame;
    if (k < 0 || k >= RECOIL_FRAMES) return 0;
    return 1 - k / RECOIL_FRAMES;
  }

  // ------------------------------------------------------------ the round

  /**
   * Re-test a shot against bodies three times as wide as the ones the hitscan used.
   *
   * The hitscan has already run by the time this is reached, so rather than duplicating it
   * this widens the one part that needs widening. A fatter capsule can only ever find a
   * body at or nearer than whatever the shot already stopped on, so the existing distance
   * is a safe ceiling: a round that stopped on a wall at thirty metres still cannot reach
   * somebody standing thirty-one metres behind it.
   */
  _fatten(shooter, origin, dir, hit, def) {
    const mult = def.hitboxMult || 1;
    if (mult <= 1) return hit;
    const game = this.game;
    const limit = hit.kind === 'none' ? def.range : hit.dist;
    const pad = def.hitboxPad || 0;
    let best = null, bestD = limit, head = false;
    for (const a of game.actors) {
      if (a === shooter || !a.alive) continue;
      // Dropped by `pad` and grown by twice it, so the extra reach is above the head and
      // under the feet rather than all at one end.
      this._fatPos.x = a.pos.x; this._fatPos.y = a.pos.y - pad; this._fatPos.z = a.pos.z;
      const h = rayCharacter(origin, dir, this._fatPos, BODY_RADIUS * mult, BODY_HEIGHT + pad * 2,
        HEAD_Y + pad, HEAD_R * mult, bestD);
      if (h && h.dist < bestD) { bestD = h.dist; best = a; head = h.head; }
    }
    if (!best || (hit.kind === 'actor' && best === hit.target)) return hit;

    hit.kind = 'actor';
    hit.target = best;
    hit.head = head;
    hit.dist = bestD;
    hit.normal = { x: -dir.x, y: -dir.y, z: -dir.z };
    hit.point = V.make(origin.x + dir.x * bestD, origin.y + dir.y * bestD, origin.z + dir.z * bestD);
    // The same falloff combat.js applies: full damage to 26m, tapering to 74% by 90m.
    const t = clamp((bestD - 26) / (90 - 26), 0, 1);
    hit.damage = Math.round(def.damage * (head ? def.headMult : 1) * (1 - t * 0.26));
    return hit;
  }

  /** `hit` is a scratch object the shooter reuses, so the bolt has to carry a copy. */
  static _snapshot(hit) {
    return {
      kind: hit.kind, target: hit.target, head: hit.head, dist: hit.dist, damage: hit.damage,
      normal: V.clone(hit.normal), point: V.clone(hit.point),
    };
  }

  /**
   * A cannon round was fired. Returns true when it took the shot over, in which case the
   * caller must not do its own tracer-and-damage - `deliver` replays that on arrival.
   */
  onShot(shooter, origin, dir, hit, def, deliver) {
    if (!def || def.id !== ID) return false;
    const game = this.game;
    const isPlayer = shooter.isPlayer;
    const st = this.stateOf(shooter);
    st.fireFrame = game.animFrame;

    // The mouth of the thing, far enough forward that the fireball isn't born in the camera.
    const lead = isPlayer ? 0.90 : 0.55;
    const from = V.make(
      origin.x + dir.x * lead,
      origin.y + dir.y * lead - (isPlayer ? 0.10 : 0.18),
      origin.z + dir.z * lead);

    const snap = DroodleCannon._snapshot(this._fatten(shooter, origin, dir, hit, def));
    const dist = Math.max(0.35, V.dist(from, snap.point));
    this.fx.addBolt(from, dir, dist, DEF.boltSpeed, () => {
      // Deliver what the hitscan already decided, minus the tracer - the round you watched
      // cross the room *is* the tracer.
      this.suppressTracer = true;
      try { deliver(snap); } finally { this.suppressTracer = false; }
      const d = V.dist(snap.point, game.player.pos);
      this.fx.addBlast(snap.point, snap.kind === 'actor' ? 0.80 : 1.00, false);
      this.fx.addEmbers(snap.point, 9, 4.4, 0.13);
      if (snap.kind === 'world') this.fx.addScorch(snap.point, snap.normal, 1.05);
      Sfx.droodleImpact(d);
    });

    // An explosion at the muzzle, because it is a cannon. For anybody but you that's a
    // world-space fireball; yours is drawn in the viewmodel pass instead, because the
    // viewmodel owns the front of the depth range and a world blast a metre out would end
    // up behind the gun that made it.
    if (!isPlayer) this.fx.addBlast(from, 0.52, false);
    this.fx.addEmbers(from, isPlayer ? 3 : 5, 2.6, 0.09);
    Sfx.droodleFire(isPlayer ? 0 : V.dist(shooter.pos, game.player.pos));
    if (isPlayer) {
      this.screen.blast(game.animFrame, game.renderer.width * 0.60, game.renderer.height * 0.62);
      shooter.punchVelP += 5.5;
    }
    return true;
  }

  // ------------------------------------------------------------ the passive

  /**
   * The player pulled the trigger with the cannon in hand. Returns true when this pull
   * winds it up instead of firing, so the caller skips its own shot.
   */
  onPlayerFire(player, def) {
    if (!def || def.id !== ID) return false;
    const st = this.stateOf(player);
    st.shots++;
    if (st.shots < DEF.chargeEvery) return false;
    st.shots = 0;
    this._beginCharge(player);
    return true;
  }

  _beginCharge(player) {
    const st = this.stateOf(player);
    st.charging = true;
    st.chargeFrame0 = this.game.animFrame;
    // Nothing else happens until the beam is out. The round was spent by tryFire, so the
    // charge costs exactly one shot, the same as firing would have.
    player.loadout.cooldown = CHARGE_FRAMES / 12 + DEF.rate * 0.55;
    player.vm.kick = 0.4;
    Sfx.droodleCharge();
    this.game.toast('DROODLE CANNON CHARGING');
  }

  _cancelCharge(player) {
    const st = this.stateOf(player);
    if (!st.charging) return;
    st.charging = false;
    Sfx.droodleCancelCharge();
  }

  /**
   * The discharge. The beam runs to the first wall and stops there; anything standing
   * inside it takes the 75 once, whether that's one bot or four.
   */
  _fireLaser(player) {
    const game = this.game;
    const st = this.stateOf(player);
    st.charging = false;
    st.fireFrame = game.animFrame;
    st.laserFrame = game.animFrame;
    Sfx.droodleCancelCharge();

    const eye = player.eye;
    const dir = player.aimDir ? player.aimDir(V.make()) : dirFrom(player.yaw, player.pitch, V.make());
    const wall = game.map.raycast(eye, dir, DEF.laserRange, {});
    const reach = wall.kind === 'none' ? DEF.laserRange : wall.dist;

    const from = V.make(eye.x + dir.x * 0.85, eye.y + dir.y * 0.85 - 0.10, eye.z + dir.z * 0.85);
    const end = V.make(eye.x + dir.x * reach, eye.y + dir.y * reach, eye.z + dir.z * reach);
    const len = Math.max(0.5, V.dist(from, end));

    this.fx.addBeam(from, dir, len, DEF.laserRadius, LASER_FRAMES);

    // Everything inside the cylinder, once each. Distance along the beam decides whether
    // it's in range; distance across it decides whether it's in the beam.
    const R = DEF.laserRadius + BODY_RADIUS * (DEF.laserHitboxMult || 1);
    for (const a of game.actors) {
      if (a === player || !a.alive) continue;
      const cx = a.pos.x - eye.x, cy = (a.pos.y + HEAD_Y * 0.55) - eye.y, cz = a.pos.z - eye.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along < 0 || along > reach) continue;
      const px = cx - dir.x * along, py = cy - dir.y * along, pz = cz - dir.z * along;
      if (Math.hypot(px, py, pz) > R) continue;
      game.applyDamage(a, DEF.laserDamage, player, false, DEF);
      const at = V.make(eye.x + dir.x * along, a.pos.y + 1.05, eye.z + dir.z * along);
      this.fx.addBlast(at, 0.7, false);
      this.fx.addEmbers(at, 5, 3.2, 0.10);
    }

    // Crates in the way get chewed, but don't stop it.
    for (const c of game.entities.crates) {
      if (!c.alive) continue;
      const cx = c.pos.x - eye.x, cy = c.pos.y - eye.y, cz = c.pos.z - eye.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along < 0 || along > reach) continue;
      const px = cx - dir.x * along, py = cy - dir.y * along, pz = cz - dir.z * along;
      if (Math.hypot(px, py, pz) > DEF.laserRadius + c.size * 0.6) continue;
      game.entities.damageCrate(c, DEF.laserDamage, (cc) => game.onCrateBroken(cc));
    }

    // Shields block hitscan everywhere else in the game, so they eat this too - they just
    // don't stop the beam reaching what's behind them.
    for (const sh of game.shields) {
      if (!sh.alive || sh.owner === player) continue;
      const t = sh.rayHit(eye, dir, reach, player);
      if (t === null) continue;
      if (sh.takeDamage(DEF.laserDamage)) {
        game.entities.addShards(V.make(eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t), 10, 2.4);
      }
    }

    // Where it lands.
    this.fx.addBlast(end, 1.7, true);
    this.fx.addEmbers(end, 24, 7.0, 0.19);
    if (wall.kind !== 'none') this.fx.addScorch(end, { x: wall.nx, y: wall.ny, z: wall.nz }, 2.4);

    const s = game.renderer.worldToScreen(end);
    this.screen.hit(game.animFrame, s ? s.x : game.renderer.width * 0.5, s ? s.y : game.renderer.height * 0.5);

    // The engine's own shock wave, which shoves the picture outward as it passes. The black
    // frame that normally rides with it is suppressed - there's already a black frame in the
    // drawn sequence, and two is a strobe.
    game.impact.t = game.impact.dur;
    V.copy(game.impact.point, end);
    this.blackFrameOff = true;

    if (player.isPlayer) {
      player.punchVelP += 17;
      player.punchVelY += (Math.random() < 0.5 ? -1 : 1) * 7.5;
    }
    player.loadout.cooldown = Math.max(player.loadout.cooldown, DEF.rate * 1.15);
    Sfx.droodleLaser(player.isPlayer ? 0 : V.dist(player.pos, game.player.pos));
    game.makeNoise(player.pos, 125, player);
    if (player.isPlayer) game.toast('DROODLE CANNON UNLEASHED');
  }

  // ------------------------------------------------------------ the clocks

  animStep() {
    const game = this.game;
    this.fx.animStep(game.map);
    if (game.impact.t <= 0) this.blackFrameOff = false;

    const p = game.player;
    const st = this.stateOf(p);
    if (st.charging) {
      if (!p.alive || p.loadout.id !== ID || p.loadout.drawT > 0) this._cancelCharge(p);
      else if (game.animFrame - st.chargeFrame0 >= CHARGE_FRAMES) this._fireLaser(p);
    }
    // Swapping away resets the count, so you never come back to a cannon that is secretly
    // one pull from a beam.
    if (p.loadout.id !== ID && st.shots !== 0) st.shots = 0;
  }

  newMatch() {
    this.fx.clear();
    this.screen.clear();
    const p = this.game.player;
    if (p._droodle) { p._droodle.shots = 0; p._droodle.charging = false; }
    this.seed(SEEDED);
  }

  /** Put a couple on the floor, so it's findable without waiting on the crates. */
  seed(count) {
    const g = this.game;
    for (let k = 0; k < count; k++) {
      const c = g.map.randomOpenCell(g.rng, 2);
      const p = g.map.worldOfCell(c);
      p.y = 0.24;
      g.entities.spawnPickup(ID, p, undefined, undefined, false, true);
    }
  }

  /** A crate that would have coughed up a gun coughs up this instead, now and then. */
  crateDrop(crate) {
    const g = this.game;
    if (!g.rng.chance(DROP_CHANCE)) return false;
    Sfx.crateBreak(V.dist(crate.pos, g.player.pos));
    const p = V.make(crate.pos.x, crate.pos.y + 0.2, crate.pos.z);
    g.entities.spawnPickup(ID, p, undefined, undefined, true, true);
    if (g.rng.chance(0.75)) g.entities.spawnHeart(p);
    g.entities.addBurst(p, 0.75, 3);
    this.fx.addEmbers(p, 7, 2.6, 0.11);
    if (V.dist(crate.pos, g.player.pos) < 14) g.toast('CRATE DROPPED A DROODLE CANNON');
    return true;
  }

  // ------------------------------------------------------------ drawing

  renderWorld(r, cam) { this.fx.render(r, cam); }

  drawHud(hud, animFrame) { this.screen.draw(hud, animFrame); }

  /** Keep the shock wave, drop the black frame. */
  patchImpact(post) {
    if (!this.blackFrameOff) return post;
    post.impact = 0;
    post.impactWave = Math.min(1, (post.impactWave ?? 0) * 1.25);
    return post;
  }

  /**
   * The charge shake and the recoil, added to a pose.
   *
   * Keyed off the animation frame rather than off wall-clock time, so rewinding `back` for
   * a smear ghost rewinds these too and the ghosts land where they belong.
   */
  posePatch(player, back, pose) {
    if (pose.id !== ID) return pose;
    const st = this.stateOf(player);
    const frame = this.game.animFrame - Math.round(back * 12);
    const c = this.chargeAt(st, frame);
    const k = this.recoilAt(st, frame);

    if (c > 0) {
      // Reared back and shaking, worse as it fills. The jitter is a hash of the frame
      // number, so it's a different drawing every twelfth of a second and the same one in
      // between - which is what keeps it on twelves.
      const j = 0.006 + c * 0.014;
      pose.px += (hash01(frame, 11) - 0.5) * 2 * j;
      pose.py += (hash01(frame, 23) - 0.5) * 2 * j + c * 0.024;
      pose.pz += c * 0.062;
      pose.rx -= c * 0.28;
      pose.ry += (hash01(frame, 31) - 0.5) * c * 0.07;
      pose.rz += (hash01(frame, 47) - 0.5) * c * 0.10;
      pose.handRx -= c * 0.22;
      pose.smear = Math.max(pose.smear, c * 0.55);
    }
    if (k > 0) {
      const e = k * k;
      pose.pz += e * 0.215;
      pose.py += e * 0.050;
      pose.rx -= e * 0.66;
      pose.ry += e * 0.11;
      pose.rz -= e * 0.09;
      pose.handRx -= e * 0.52;
      pose.smear = Math.max(pose.smear, k * 0.95);
    }
    return pose;
  }

  /**
   * Ghost outlines dragged behind the cannon while it's moving fast. The knife is the only
   * other thing in the game that earns these; a cannon coming back off a shot qualifies.
   */
  drawGhosts(r, player) {
    if (player.loadout.id !== ID) return;
    const lag = this.game.animLag;
    const main = player._vmPose(lag, this._ghosts[0]);
    if (main.smear <= 0.06) return;
    const n = main.smear > 0.6 ? 3 : 2;
    for (let k = n; k >= 1; k--) {
      const ghost = player._vmPose(lag + k * (1 / 12) * 0.55, this._ghosts[k]);
      if (ghost.id === ID) player._drawWeapon(r, ghost, clamp(main.smear, 0, 1) * (0.32 / k), true, null);
    }
  }

  /**
   * Everything that comes out of the mouth, drawn over the weapon in the viewmodel pass:
   * the charge, the muzzle blast, and the first couple of metres of the beam.
   */
  drawMuzzle(r, player, pose) {
    if (pose.id !== ID) return;
    const st = this.stateOf(player);
    const frame = this.game.animFrame;
    const c = this.chargeAt(st, frame);
    const kLaser = frame - st.laserFrame;
    const kShot = frame - st.fireFrame;
    if (c <= 0 && !(kLaser >= 0 && kLaser < LASER_FRAMES) && !(kShot >= 0 && kShot < 3)) return;

    const s = pose.scale;
    M4.compose(this._vmMat, { x: pose.px, y: pose.py, z: pose.pz }, pose.ry, pose.rx, pose.rz, s, s, s);
    if (c > 0) this.fx.renderCharge(r, this._vmMat, MUZZLE_POINT, c, frame, player.colorAmt);
    if (kLaser >= 0 && kLaser < LASER_FRAMES) {
      this.fx.renderBeamStub(r, this._vmMat, MUZZLE_POINT, kLaser, LASER_FRAMES, player.colorAmt);
      this.fx.renderMuzzle(r, this._vmMat, MUZZLE_POINT, kLaser, player.colorAmt, true);
    } else if (kShot >= 0 && kShot < 3) {
      this.fx.renderMuzzle(r, this._vmMat, MUZZLE_POINT, kShot, player.colorAmt, false);
    }
  }

  /**
   * The weapon strip in the corner gives each slot 104px, and "DROODLE CANNON" runs off the
   * edge of the screen there. Only that readout uses the short form; the ammo panel and the
   * pickup prompt size themselves and get the real name.
   */
  static shortName(id) {
    const def = WEAPONS[id];
    return def && def.hudName ? def.hudName : (def ? def.name : id);
  }
}
