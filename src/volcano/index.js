// The VOLCANO GREATBLADE, wired into the game.
//
// The weapon is in weapon.js, its swing sheet in frames.js and everything it leaves in the
// world in fire.js. This is the part that knows *when*: the game calls in at a handful of
// named points and this decides what the blade does about it.
//
// Three things happen around a swing that do not happen around any other melee weapon:
//
//   carrying it   lays fire under whoever is holding it, but only while they move. Two
//                 seconds a patch, twenty a second to stand in. It burns everyone except
//                 the person who lit it, which makes retreating through your own trail a
//                 real option rather than a mistake.
//
//   killing with it  leaves the body standing, in lava colours. One per killer: taking a
//                 new one blows the one you had.
//
//   that figure   goes off when anyone but its owner comes within five metres, for fifty
//                 in the same five. It is not in `game.actors`, so nothing in the AI can
//                 see it or shoot it - it is scenery that happens to be a mine.

import { V, clamp } from '../math.js';
import { Sfx } from '../audio.js';
import { ID, DEF, registerWeapon } from './weapon.js';
import { buildVolcanoFrames } from './frames.js';
import { VolcanoFX, DECOY_SENSE, DECOY_BLAST, DECOY_DAMAGE, BURN_DPS } from './fire.js';

export { ID as VOLCANO_ID, DEF as VOLCANO_DEF };

/**
 * One crate in this many hands over a greatblade. The hammer is 0.17 of whatever is left
 * after the cannon takes its cut, so this has to sit well under that to be "rarer than the
 * hammer" rather than just "also uncommon".
 */
const DROP_CHANCE = 0.055;

/** How often the burn ticks. Damage is per second either way - this is just granularity. */
const BURN_TICK = 0.25;

export class VolcanoBlade {
  constructor(game) {
    this.game = game;
    this.fx = new VolcanoFX(game.gl);
    this.frames = buildVolcanoFrames(game.gl);
    this._burnAcc = 0;
    registerWeapon(game);
  }

  /** Lazily-made per-holder state. Bots carry it too, and get the trail for free. */
  stateOf(actor) {
    let s = actor._volcano;
    if (!s) { s = { trailDist: 0 }; actor._volcano = s; }
    return s;
  }

  newMatch() {
    this.fx.clear();
    this._burnAcc = 0;
    for (const a of this.game.actors) if (a._volcano) a._volcano.trailDist = 0;
  }

  // ------------------------------------------------------------ per frame

  update(dt) {
    const g = this.game;

    // Fire under anyone carrying it and moving. `isMelee` matters: the trail comes off the
    // blade, so slinging it and running with the gun out stops laying it.
    for (const a of g.actors) {
      if (!a.alive) continue;
      const lo = a.loadout;
      if (lo.melee !== ID || !lo.isMelee) continue;
      this.fx.trail(a, this.stateOf(a), dt);
    }

    this.fx.update(dt);

    // Burning, on its own tick. Rolled up rather than applied every frame so that a hit
    // lands as a visible chunk of health - one point of damage a frame reads as the HUD
    // being broken rather than as being on fire.
    this._burnAcc += dt;
    if (this._burnAcc >= BURN_TICK) {
      const tick = this._burnAcc;
      this._burnAcc = 0;
      this.fx.burn(tick, g.actors, (victim, amount, owner) => {
        g.applyDamage(victim, amount, owner && owner !== victim ? owner : null, false, DEF);
      });
    }

    this._senseDecoys(dt);
  }

  /**
   * Figures look for company. Anyone alive who is not the owner and is inside five metres
   * starts the fuse; when it runs out the thing goes off.
   *
   * Line of sight is deliberately *not* checked. It is a body lying in wait, not a camera:
   * walking past a wall it is behind should still set it off, and the five metres is short
   * enough that "behind a wall" and "right next to it" are nearly the same place.
   */
  _senseDecoys(dt) {
    const g = this.game;
    for (const d of this.fx.decoys.values()) {
      if (!d.alive) continue;
      if (!d.tripped) {
        if (!d.armed) continue;
        let near = false;
        for (const a of g.actors) {
          if (!a.alive || a === d.owner) continue;
          const dx = a.pos.x - d.pos.x, dy = a.pos.y - d.pos.y, dz = a.pos.z - d.pos.z;
          if (dx * dx + dy * dy + dz * dz <= DECOY_SENSE * DECOY_SENSE) { near = true; break; }
        }
        if (near && d.trip()) {
          Sfx.volcanoArm(V.dist(d.pos, g.player.pos));
          if (d.owner?.isPlayer) g.toast('THE BODY HAS SEEN SOMEONE');
        }
        continue;
      }
      if (d.due) this._blow(d);
    }
  }

  /** Detonate one figure: the fireball, the sound, and fifty to everyone but its owner. */
  _blow(d) {
    const g = this.game;
    const owner = d.owner;
    const at = this.fx.detonate(d);
    if (!at) return;
    Sfx.volcanoBlast(V.dist(at, g.player.pos));
    g.makeNoise(d.pos, 80, owner);
    for (const a of g.actors) {
      if (!a.alive || a === owner) continue;
      const dx = a.pos.x - d.pos.x, dy = (a.pos.y + 0.9) - (d.pos.y + 0.9), dz = a.pos.z - d.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > DECOY_BLAST) continue;
      // Full damage at the middle, tailing to two thirds at the rim. Not to zero: a blast
      // you can stand at the edge of for nothing is one nobody respects.
      const falloff = 1 - clamp(dist / DECOY_BLAST, 0, 1) * 0.34;
      g.applyDamage(a, Math.round(DECOY_DAMAGE * falloff), owner ?? null, false, DEF);
    }
    g.entities.addBurst(at, 1.5, 3);
    g.entities.addShards(at, 9, 3.0);
  }

  animStep() { this.fx.animStep(); }

  // ------------------------------------------------------------ hooks

  /**
   * Someone died. If the greatblade did it, their body stays up - in lava - and the one the
   * killer had before it goes off where it stands.
   *
   * The corpse is a *copy*: the actor itself respawns on the usual timer and is untouched by
   * any of this.
   */
  onKill(victim, killer) {
    if (!killer || killer === victim) return;
    if (killer.loadout?.id !== ID) return;
    const g = this.game;
    const at = V.make(victim.pos.x, victim.pos.y, victim.pos.z);
    // Face the figure back at whoever made it, which is the pose that reads as a warning.
    const yaw = Math.atan2(-(killer.pos.x - at.x), -(killer.pos.z - at.z));
    this.fx.plant(killer, at, yaw, (old) => {
      if (old.owner?.isPlayer) g.toast('THE LAST ONE GOES UP');
    });
    Sfx.volcanoPlant(killer.isPlayer ? 0 : V.dist(at, g.player.pos));
    if (killer.isPlayer) g.toast('A BURNING COPY STAYS BEHIND');
  }

  /** A crate that would have coughed up a gun coughs up this instead, now and then. */
  crateDrop(crate) {
    const g = this.game;
    if (!g.rng.chance(DROP_CHANCE)) return false;
    Sfx.crateBreak(V.dist(crate.pos, g.player.pos));
    const p = V.make(crate.pos.x, crate.pos.y + 0.2, crate.pos.z);
    g.entities.spawnPickup(ID, p, undefined, undefined, true, true);
    if (g.rng.chance(0.75)) g.entities.spawnHeart(p);
    g.entities.addBurst(p, 0.8, 3);
    this.fx.addEmbers(p, 9, 2.8, 0.12);
    if (V.dist(crate.pos, g.player.pos) < 14) g.toast('CRATE DROPPED A VOLCANO GREATBLADE');
    return true;
  }

  renderWorld(r, cam) { this.fx.render(r, cam); }
}

export { BURN_DPS, DECOY_DAMAGE, DECOY_SENSE };
