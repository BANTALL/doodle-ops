// The axe once it has left your hand.
//
// Three states, and it is never in more than one: in flight, buried in whatever stopped
// it, or on its way back to you. Attacking with the axe while it is away is the recall -
// there is no pickup prompt, because the whole point is that you call it back rather than
// walk to it.
//
// It moves on the animation clock like everything else that flip-books, but each step
// resolves as a raycast over the segment it just crossed rather than a point test at the
// new position: even at a walking pace a twelfth of a second is wide enough to step
// straight through a bot, and the first version threw at thirty metres a second, which
// crossed a room in three frames and was over before you saw it leave.

import { WEAPONS } from './weapons.js';
import { rayCharacter } from './entities.js';
import { BODY_RADIUS, BODY_HEIGHT, HEAD_Y, HEAD_R } from './combat.js';
import { M4, V } from './math.js';
import { Sfx } from './audio.js';

const ANIM_DT = 1 / 12;
const GRAVITY = 3.2;        // barely any: a thrown axe should read as flat and fast
// How far it tumbles per animation step. Anything much past a radian and consecutive
// frames stop looking like the same object turning and start looking like noise.
const SPIN_PER_STEP = 0.92;
const RECALL_SPIN_PER_STEP = -0.80;

export class ThrownAxe {
  constructor(owner, origin, dir) {
    const def = WEAPONS.axe;
    this.owner = owner;
    this.def = def;
    this.pos = V.clone(origin);
    this.prevPos = V.clone(origin);
    this.dir = V.clone(dir);
    this.vel = V.make(dir.x * def.throwSpeed, dir.y * def.throwSpeed, dir.z * def.throwSpeed);
    this.travelled = 0;
    this.state = 'flight';
    this.spin = 0;
    this.yaw = Math.atan2(dir.x, dir.z);
    this.stuckPitch = 0;
    this.done = false;
    this.hitActors = new Set();
    this.trail = [V.clone(origin), V.clone(origin)];
  }

  get recallable() { return this.state === 'stuck'; }

  /** Start the trip home. The axe ignores everything on the way back. */
  recall() {
    if (this.state === 'returning') return false;
    this.state = 'returning';
    this.travelled = 0;
    Sfx.swing();
    return true;
  }

  /** One animation step. `game` supplies the map, actors and damage plumbing. */
  animStep(game) {
    if (this.done) return;
    V.copy(this.prevPos, this.pos);

    if (this.state === 'returning') {
      const hand = this._handPoint(game);
      const dx = hand.x - this.pos.x, dy = hand.y - this.pos.y, dz = hand.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1e-4;
      const step = this.def.recallSpeed * ANIM_DT;
      this.spin += RECALL_SPIN_PER_STEP;
      this.yaw = Math.atan2(dx, dz);
      if (d <= step) {
        // Home. The owner decides what that means - the player catches it, a dead owner
        // just drops it out of existence.
        V.copy(this.pos, hand);
        this.done = true;
        game.onAxeReturned(this);
        return;
      }
      V.set(this.pos, this.pos.x + (dx / d) * step, this.pos.y + (dy / d) * step, this.pos.z + (dz / d) * step);
      this._pushTrail();
      return;
    }

    if (this.state !== 'flight') return;

    this.vel.y -= GRAVITY * ANIM_DT;
    const step = V.make(this.vel.x * ANIM_DT, this.vel.y * ANIM_DT, this.vel.z * ANIM_DT);
    let len = Math.hypot(step.x, step.y, step.z);
    if (len < 1e-5) { this._embed(game, this.pos, { x: 0, y: 1, z: 0 }); return; }

    // Don't overshoot the throw range - clip this step to whatever is left of it.
    const left = this.def.throwRange - this.travelled;
    if (len > left) { const k = left / len; step.x *= k; step.y *= k; step.z *= k; len = left; }
    const dir = V.make(step.x / len, step.y / len, step.z / len);
    V.copy(this.dir, dir);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.spin += SPIN_PER_STEP;              // end over end, about a fifth of a turn a frame

    const hit = this._sweep(game, this.pos, dir, len);
    if (hit) {
      V.set(this.pos, this.pos.x + dir.x * hit.dist, this.pos.y + dir.y * hit.dist, this.pos.z + dir.z * hit.dist);
      this.travelled += hit.dist;
      this._pushTrail();
      if (hit.kind === 'actor') {
        game.onAxeHitActor(this, hit.target, hit.head);
        // Buries itself in them and drops at their feet, rather than carrying on through.
        this._embed(game, this.pos, { x: -dir.x, y: 0, z: -dir.z }, true);
      } else if (hit.kind === 'crate') {
        game.onAxeHitCrate(this, hit.target);
        this._embed(game, this.pos, hit.normal);
      } else {
        this._embed(game, this.pos, hit.normal);
      }
      return;
    }

    V.set(this.pos, this.pos.x + step.x, this.pos.y + step.y, this.pos.z + step.z);
    this.travelled += len;
    this._pushTrail();
    if (this.travelled >= this.def.throwRange - 1e-4) {
      // Out of range with nothing to bite: it drops and buries itself in the floor.
      this._embed(game, this.pos, { x: 0, y: 1, z: 0 }, true);
    }
  }

  /** Nearest thing along the segment: wall, crate or body. */
  _sweep(game, origin, dir, len) {
    const map = game.map;
    let best = null;
    const wall = map.raycast(origin, dir, len, this._ray || (this._ray = {}));
    if (wall.kind !== 'none' && wall.dist <= len) {
      best = { kind: 'world', dist: wall.dist, target: null, normal: { x: wall.nx, y: wall.ny, z: wall.nz } };
    }
    // The floor is not part of the wall raycast, so test the ground plane separately.
    if (dir.y < -1e-5) {
      const t = (0.12 - origin.y) / dir.y;
      if (t >= 0 && t <= len && (!best || t < best.dist)) {
        best = { kind: 'world', dist: t, target: null, normal: { x: 0, y: 1, z: 0 } };
      }
    }
    const crate = game.entities.raycastCrates(origin, dir, best ? best.dist : len);
    if (crate) {
      best = { kind: 'crate', dist: crate.dist, target: crate.crate, normal: { x: -dir.x, y: 0, z: -dir.z } };
    }
    for (const a of game.world.actors) {
      if (!a.alive || a === this.owner || this.hitActors.has(a)) continue;
      const h = rayCharacter(origin, dir, a.pos, BODY_RADIUS * 1.25, BODY_HEIGHT, HEAD_Y, HEAD_R * 1.2,
        best ? best.dist : len);
      if (h && (!best || h.dist < best.dist)) {
        best = { kind: 'actor', dist: h.dist, target: a, head: h.head, normal: { x: -dir.x, y: 0, z: -dir.z } };
      }
    }
    return best;
  }

  /** Plant it. `drop` means slide it down to the floor first, blade-first. */
  _embed(game, at, normal, drop = false) {
    this.state = 'stuck';
    this.stuckNormal = { x: normal.x, y: normal.y, z: normal.z };
    if (drop) {
      V.set(this.pos, at.x, 0.20, at.z);
      this.stuckPitch = -1.15;                       // head down, haft up out of the floor
    } else if (Math.abs(normal.y) > 0.5) {
      V.set(this.pos, at.x, at.y + 0.14, at.z);
      this.stuckPitch = -1.15;
    } else {
      // In a wall: pushed a little out of the surface so it isn't half swallowed.
      V.set(this.pos, at.x + normal.x * 0.16, at.y, at.z + normal.z * 0.16);
      this.stuckPitch = 0.28;
      this.yaw = Math.atan2(-normal.x, -normal.z);
    }
    this.spin = 0;
    game.onAxeStuck(this);
  }

  _handPoint(game) {
    const o = this.owner;
    const eye = o.eye ?? { x: o.pos.x, y: o.pos.y + 1.5, z: o.pos.z };
    return { x: eye.x, y: eye.y - 0.25, z: eye.z };
  }

  _pushTrail() {
    this.trail[1] = V.clone(this.trail[0]);
    this.trail[0] = V.clone(this.prevPos);
  }

  /**
   * Drawn with two ghosts strung back along the path it crossed this step. At twelve
   * frames a second the axe teleports two metres between frames; without the ghosts that
   * reads as a bug rather than as a weapon travelling fast.
   */
  render(r, model, lag) {
    if (this.done || !model) return;
    const m = this._m || (this._m = M4.create());
    const flying = this.state !== 'stuck';
    const step = this.state === 'returning' ? RECALL_SPIN_PER_STEP : SPIN_PER_STEP;
    const spin = flying ? this.spin + lag * step * 12 : 0;
    const pitch = flying ? spin : this.stuckPitch;

    if (flying) {
      // Two ghosts, at the positions and rotations the axe actually had on the last two
      // steps - not arbitrary offsets, or they read as a wireframe tangle instead of a
      // trail. Filled as well as outlined, faintly, so they smear rather than scribble.
      const ghosts = [
        { p: this.prevPos, a: 0.34, back: 1 },
        { p: this.trail[0], a: 0.16, back: 2 },
      ];
      for (const g of ghosts) {
        if (!g.p) continue;
        M4.compose(m, g.p, this.yaw, pitch - g.back * step, 0, 1, 1, 1);
        r.fill(model.body.fill, m, { objSeed: 5.5, alpha: g.a });
        r.ink(model.body.ink, m, { objSeed: 5.5 + g.back, alpha: g.a * 0.9, widthScale: 1.2 });
      }
    }

    M4.compose(m, this.pos, this.yaw, pitch, 0, 1, 1, 1);
    const opts = { objSeed: 5.5, colorAmt: -1 };
    r.fill(model.body.fill, m, opts);
    r.ink(model.body.ink, m, { objSeed: 5.5 });
  }
}
