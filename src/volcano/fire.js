// Everything the greatblade leaves behind it: the fire trail, and the burning figure.
//
// Both are on the twelve-frames-a-second clock like the rest of the drawing. The *damage*
// is not - it ticks on real time, because a fire that burned for an eighth of a second less
// on a slow machine would be a different weapon on a slow machine.
//
// The flame, ember and scorch drawings are the ones the droodle cannon already uses. They
// are plain mesh builders with nothing cannon-specific in them, and a second set of
// hand-drawn fire that looked almost but not quite like the first set would be worse than
// sharing one.

import { M4, V, Rng, clamp, TAU } from '../math.js';
import { MAT } from '../renderer.js';
import { CharacterRig } from '../actors.js';
import {
  buildFlameCels, buildEmberMesh, buildScorchMesh, buildExplosionCels,
} from '../droodle/art.js';

// ---- the trail ------------------------------------------------------------

/** How long a patch of fire burns for. The brief's two seconds, exactly. */
export const PATCH_LIFE = 2.0;
/** Damage a second to anyone standing in it. Also the brief's. */
export const BURN_DPS = 20;
/** How far apart patches are laid, in metres of travel. */
const PATCH_STEP = 0.55;
/** How wide a patch burns. A little under a body, so you have to actually be in it. */
const PATCH_R = 0.72;
/** Below this you are not moving, and a weapon that burns the floor you stand on is a trap. */
const MOVE_SPEED = 1.4;
const MAX_PATCHES = 42;

// ---- the figure -----------------------------------------------------------

/** How close an enemy has to get. Five blocks, as asked. */
export const DECOY_SENSE = 5.0;
/** And how far the blast reaches, which is the same five. */
export const DECOY_BLAST = 5.0;
export const DECOY_DAMAGE = 50;
/**
 * Two beats between spotting someone and going off. Without it the figure detonates on the
 * frame it notices, which from the victim's side is indistinguishable from taking fifty
 * damage for no reason - the swell is the only warning anybody gets.
 */
const FUSE = 0.34;
/** And a moment after it is planted before it can trigger at all. */
const ARM_DELAY = 0.55;
/** How solid the figure is drawn. Half - it is a ghost of the body, not the body. */
const DECOY_ALPHA = 0.5;
const EXPLOSION_FRAMES = 8;

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

function decalMatrix(out, pos, size, roll) {
  // Always laid flat on the floor, so the tangent frame is just a rotation in XZ.
  const c = Math.cos(roll), s = Math.sin(roll);
  out[0] = c * size; out[1] = 0; out[2] = s * size; out[3] = 0;
  out[4] = -s * size; out[5] = 0; out[6] = c * size; out[7] = 0;
  out[8] = 0; out[9] = 1; out[10] = 0; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

/**
 * The burning figure. It is a drawing of the thing you killed, in the colours of the thing
 * that killed it, and it does exactly two things: stand there, and go off.
 *
 * It is deliberately *not* an actor. It has no entry in `game.actors`, so nothing in the bot
 * AI can see it, target it, shoot it or path around it - which is what "undetectable" has to
 * mean if it is going to mean anything. Bots walk into it none the wiser, which is the whole
 * idea.
 */
export class Decoy {
  constructor(gl, owner, pos, yaw, rng) {
    this.owner = owner;
    this.pos = V.clone(pos);
    this.yaw = yaw;
    this.alive = true;
    this.age = 0;
    // Tripped is its own flag rather than a sentinel value in `fuse`. A fuse that ticks a
    // fraction past zero is negative, and a negative fuse used to be indistinguishable from
    // "never tripped" - so it re-armed itself on the next frame, every frame, and the thing
    // stood there being about to go off for the rest of the match.
    this.tripped = false;
    this.fuse = 0;
    this.frame0 = 0;
    this.seed = rng.range(0, TAU);
    // Its own rig, in a lava palette: red shirt, orange legs, molten head. Posed once,
    // standing, and never touched again - it does not move, so it never needs rebuilding.
    this.rig = new CharacterRig(gl, MAT.RED, { pants: MAT.ORANGE, skin: MAT.LAVA });
    this.rig.rebuild({
      walkPhase: 0, walkAmt: 0, aimAmt: 0.35, aimPitch: 0,
      crouch: 0, hurt: 0, dead: false, deadT: 0, deadRoll: 0,
      firing: 0, reloadT: 0, meleeT: 0,
    });
    this._m = M4.create();
  }

  dispose() { this.rig.dispose(); }

  /** Trip the fuse. Returns true the first time, so callers can fire the sound once. */
  trip() {
    if (this.tripped) return false;
    this.tripped = true;
    this.fuse = FUSE;
    return true;
  }

  get armed() { return this.age >= ARM_DELAY; }
  get due() { return this.tripped && this.fuse <= 0; }
  get swell() { return this.tripped ? 1 - clamp(this.fuse / FUSE, 0, 1) : 0; }
}

/**
 * The fire the greatblade puts into the world, and the one figure its owner has standing at
 * any moment. One of these per match; the controller owns it.
 */
export class VolcanoFX {
  constructor(gl) {
    this.gl = gl;
    this.rng = new Rng(90210);
    this.patches = [];
    this.decoys = new Map();     // owner -> Decoy. One each, so bots can carry it too.
    this.blasts = [];
    this.embers = [];
    this.frame = 0;

    this.flameCels = buildFlameCels(gl, 4, 4400);
    this.emberMesh = buildEmberMesh(gl);
    this.scorchMesh = buildScorchMesh(gl);
    this.blastCels = buildExplosionCels(gl, EXPLOSION_FRAMES, { seed: 5150, ragged: 1.15, spikes: 1.2 });

    this._m = M4.create();
    this._m2 = M4.create();
    this._tmp = V.make();
  }

  clear() {
    this.patches.length = 0;
    this.blasts.length = 0;
    this.embers.length = 0;
    for (const d of this.decoys.values()) d.dispose();
    this.decoys.clear();
  }

  // ------------------------------------------------------------ the trail

  /**
   * Lay fire under a carrier who is moving. `state` is the per-actor scratch the controller
   * keeps; it holds the distance travelled since the last patch, which is what makes the
   * spacing depend on ground covered rather than on time - sprint and you get the same trail
   * as a walk, just laid faster.
   */
  trail(actor, state, dt) {
    const sp = Math.hypot(actor.vel.x, actor.vel.z);
    if (sp < MOVE_SPEED) { state.trailDist = Math.min(state.trailDist, PATCH_STEP * 0.5); return; }
    state.trailDist += sp * dt;
    if (state.trailDist < PATCH_STEP) return;
    state.trailDist = 0;
    if (this.patches.length >= MAX_PATCHES) this.patches.shift();
    this.patches.push({
      pos: V.make(actor.pos.x, actor.pos.y + 0.02, actor.pos.z),
      owner: actor,
      r: PATCH_R * this.rng.range(0.88, 1.12),
      life: PATCH_LIFE,
      roll: this.rng.range(0, TAU),
      cel: this.rng.int(0, this.flameCels.length - 1),
      lean: this.rng.range(-0.30, 0.30),
    });
  }

  /**
   * Burn whoever is standing in it. Damage is applied once per actor per tick no matter how
   * many patches they are in: three overlapping patches are still one fire, and sixty a
   * second would turn a trail you walked over into an instant kill.
   */
  burn(dt, actors, hurt) {
    if (!this.patches.length) return;
    for (const a of actors) {
      if (!a.alive) continue;
      let lit = null;
      for (const p of this.patches) {
        if (p.owner === a) continue;                       // your own fire does not burn you
        if (Math.abs(a.pos.y - p.pos.y) > 1.4) continue;   // a floor below is not this floor
        const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
        if (dx * dx + dz * dz > p.r * p.r) continue;
        lit = p;
        break;
      }
      if (lit) hurt(a, BURN_DPS * dt, lit.owner);
    }
  }

  // ------------------------------------------------------------ the figure

  /** Plant a new one, blowing the owner's previous one where it stands. */
  plant(owner, pos, yaw, onOldBlown) {
    const old = this.decoys.get(owner);
    if (old && old.alive) {
      // "Self destruct" taken literally: the one you are replacing goes off, it does not
      // just vanish. It is the same blast as any other, so it is worth putting the last one
      // somewhere you would not mind it happening.
      onOldBlown?.(old);
      this.detonate(old);
    }
    const d = new Decoy(this.gl, owner, pos, yaw, this.rng);
    this.decoys.set(owner, d);
    return d;
  }

  decoyOf(owner) {
    const d = this.decoys.get(owner);
    return d && d.alive ? d : null;
  }

  /** Kill a figure and put a fireball where it was standing. Returns its position. */
  detonate(d) {
    if (!d.alive) return null;
    d.alive = false;
    d.frame0 = this.frame;
    const at = V.make(d.pos.x, d.pos.y + 0.95, d.pos.z);
    this.blasts.push({ pos: at, frame0: this.frame, size: DECOY_BLAST * 0.42, roll: d.seed, spin: 0.09 });
    this.addEmbers(at, 14, 4.4, 0.15);
    return at;
  }

  addEmbers(pos, count, spread, size) {
    for (let k = 0; k < count; k++) {
      if (this.embers.length > 90) break;
      this.embers.push({
        pos: V.make(pos.x + this.rng.range(-0.25, 0.25), pos.y + this.rng.range(-0.25, 0.25), pos.z + this.rng.range(-0.25, 0.25)),
        vel: V.make(this.rng.range(-spread, spread), this.rng.range(1.2, spread + 1.6), this.rng.range(-spread, spread)),
        size: size * this.rng.range(0.6, 1.5),
        rot: [this.rng.range(0, TAU), this.rng.range(0, TAU), this.rng.range(0, TAU)],
        spin: [this.rng.range(-12, 12), this.rng.range(-12, 12), this.rng.range(-12, 12)],
        life: this.rng.range(0.6, 1.4),
      });
    }
  }

  // ------------------------------------------------------------ clocks

  /** Real time: lifetimes and fuses, so they are the same on every machine. */
  update(dt) {
    for (let k = this.patches.length - 1; k >= 0; k--) {
      const p = this.patches[k];
      p.life -= dt;
      if (p.life <= 0) this.patches.splice(k, 1);
    }
    for (const d of this.decoys.values()) {
      if (!d.alive) continue;
      d.age += dt;
      if (d.tripped && d.fuse > 0) d.fuse = Math.max(0, d.fuse - dt);
    }
    for (let k = this.embers.length - 1; k >= 0; k--) {
      const e = this.embers[k];
      e.life -= dt;
      if (e.life <= 0) { this.embers.splice(k, 1); continue; }
      e.vel.y -= 11 * dt;
      e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt;
      if (e.pos.y < 0.06) { e.pos.y = 0.06; e.vel.y *= -0.32; e.vel.x *= 0.6; e.vel.z *= 0.6; }
    }
  }

  /** Twelve a second: the only clock the drawing looks at. */
  animStep() {
    this.frame++;
    for (const p of this.patches) p.cel = (p.cel + 1) % this.flameCels.length;
    for (let k = this.blasts.length - 1; k >= 0; k--) {
      if (this.frame - this.blasts[k].frame0 >= EXPLOSION_FRAMES) this.blasts.splice(k, 1);
    }
    // Drop figures that have gone off, once their fireball has finished playing.
    for (const [owner, d] of this.decoys) {
      if (!d.alive && this.frame - d.frame0 > EXPLOSION_FRAMES + 2) { d.dispose(); this.decoys.delete(owner); }
    }
  }

  // ------------------------------------------------------------ drawing

  render(r, cam) {
    const m = this._m;
    const fr = r.frustum;
    const frame = this.frame;

    // Scorch first, so the flames land on top of it.
    for (const p of this.patches) {
      if (!fr.sphere(p.pos.x, p.pos.y, p.pos.z, p.r * 1.6)) continue;
      const t = clamp(p.life / PATCH_LIFE, 0, 1);
      decalMatrix(m, p.pos, p.r * (1.25 - t * 0.15), p.roll);
      const opts = { objSeed: p.roll * 3.3, alpha: 0.30 + t * 0.45, colorAmt: 1 };
      r.fill(this.scorchMesh.fill, m, opts);
      r.ink(this.scorchMesh.ink, m, opts);
    }

    // Then the tongues. Two per patch at different sizes, leaning apart, which is the
    // cheapest thing that stops a patch reading as one flame on a stick.
    for (const p of this.patches) {
      if (!fr.sphere(p.pos.x, p.pos.y + 0.4, p.pos.z, p.r * 2.2)) continue;
      const t = clamp(p.life / PATCH_LIFE, 0, 1);
      // Burns down rather than fading out: a fire that goes transparent reads as a bug.
      const h = p.r * (0.40 + t * 0.52);
      for (const [k, dx, dz, sc] of [[0, 0.18, -0.12, 1.0], [1, -0.24, 0.16, 0.76], [2, 0.02, 0.26, 0.58]]) {
        const cel = this.flameCels[(p.cel + k) % this.flameCels.length];
        V.set(this._tmp, p.pos.x + dx * p.r, p.pos.y + h * 0.52, p.pos.z + dz * p.r);
        billboard(m, this._tmp, h * sc, cam.right, cam.up, cam.fwd, p.lean * 0.3);
        // colorAmt forced: the map fades to bare pencil the further you get from the colour
        // origin, and a fire that goes grey halfway across the level stops reading as fire.
        const opts = { objSeed: p.roll * 5.1 + k + frame, alpha: clamp(t * 2.2, 0, 1), colorAmt: 1 };
        r.fill(cel.fill, m, opts);
        r.ink(cel.ink, m, { ...opts, widthScale: 1.1 });
      }
    }

    // The figures.
    for (const d of this.decoys.values()) {
      if (!d.alive) continue;
      if (!fr.sphere(d.pos.x, d.pos.y + 0.9, d.pos.z, 1.6)) continue;
      // While the fuse burns it swells, on the animation clock rather than smoothly, so the
      // warning flip-books like everything else does.
      const sw = d.swell > 0 ? 1 + Math.round(d.swell * 4) * 0.055 : 1;
      M4.compose(m, d.pos, d.yaw, 0, 0, sw, sw, sw);
      // Half transparent, so at a glance it is plainly not a person. It is a copy of one -
      // you should be able to tell that across a room without having to shoot at it first.
      const opts = { objSeed: d.seed * 2.7, colorAmt: 1, alpha: DECOY_ALPHA };
      r.fill(d.rig.fill, m, opts);
      r.ink(d.rig.ink, m, { objSeed: d.seed * 2.7, widthScale: 1 + d.swell * 0.8, alpha: DECOY_ALPHA });
      // Scorched ground and a couple of tongues at its feet, so it is obviously not just
      // another fighter standing very still. A flat disc of colour was the first try and it
      // read as a puddle of paint - the same fire the trail uses reads as heat.
      V.set(this._tmp, d.pos.x, d.pos.y + 0.02, d.pos.z);
      decalMatrix(m, this._tmp, 0.85 + d.swell * 0.35, d.seed);
      r.fill(this.scorchMesh.fill, m, { objSeed: d.seed, alpha: 0.7, colorAmt: 1 });
      r.ink(this.scorchMesh.ink, m, { objSeed: d.seed, alpha: 0.7 });
      for (const [k, dx, dz, sc] of [[0, 0.26, -0.10, 1.0], [1, -0.24, 0.16, 0.78]]) {
        const cel = this.flameCels[(frame + k) % this.flameCels.length];
        const h = 0.46 + d.swell * 0.3;
        V.set(this._tmp, d.pos.x + dx, d.pos.y + h * 0.5, d.pos.z + dz);
        billboard(m, this._tmp, h * sc, cam.right, cam.up, cam.fwd, 0);
        const fo = { objSeed: d.seed * 3.9 + k + frame, alpha: 0.9, colorAmt: 1 };
        r.fill(cel.fill, m, fo);
        r.ink(cel.ink, m, fo);
      }
    }

    // Embers.
    for (const e of this.embers) {
      if (!fr.sphere(e.pos.x, e.pos.y, e.pos.z, e.size * 2)) continue;
      const fade = clamp(e.life / 0.5, 0, 1);
      M4.compose(m, e.pos, e.rot[1], e.rot[0], e.rot[2], e.size, e.size, e.size);
      let mm = m;
      const sp = Math.hypot(e.vel.x, e.vel.y, e.vel.z);
      if (sp > 2.5) {
        const along = 1 + Math.min((sp - 2.5) * 0.20, 1.6);
        mm = M4.stretchAbout(this._m2, m, [e.pos.x, e.pos.y, e.pos.z],
          [e.vel.x / sp, e.vel.y / sp, e.vel.z / sp], along, 1 / Math.sqrt(along));
      }
      r.fill(this.emberMesh.fill, mm, { objSeed: e.spin[0], alpha: fade, colorAmt: 1 });
      r.ink(this.emberMesh.ink, mm, { objSeed: e.spin[0], alpha: fade });
    }

    // Fireballs last, because they are the brightest thing in the frame.
    for (const b of this.blasts) {
      const k = frame - b.frame0;
      if (k < 0 || k >= EXPLOSION_FRAMES) continue;
      if (!fr.sphere(b.pos.x, b.pos.y, b.pos.z, b.size * 3)) continue;
      const cel = this.blastCels[k];
      billboard(m, b.pos, b.size * 2.2, cam.right, cam.up, cam.fwd, b.roll + k * b.spin);
      const opts = { objSeed: b.roll * 4.7 + k, alpha: 1 - (k / EXPLOSION_FRAMES) * 0.3, colorAmt: 1 };
      r.fill(cel.fill, m, opts);
      r.ink(cel.ink, m, { ...opts, widthScale: 1.15 });
    }
  }
}
