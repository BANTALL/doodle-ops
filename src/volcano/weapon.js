// The VOLCANO GREATBLADE: its numbers, its pose, and the drawing of it.
//
// It is the hammer's opposite number. Same reach, same three seconds between swings, but it
// hits for two hundred instead of a hundred and thirty and it does not come back if you
// throw it - because you cannot. What you get instead is everything that happens *around*
// the swing: fire off your boots while you carry it, and a burning figure left standing
// wherever you killed someone with it.
//
// Weapon local space, same as every other weapon in the game: the blade points down -Z, up
// is +Y, and the hands sit near the origin.

import { WEAPONS, HOLD, MUZZLE, MELEE_IDS } from '../weapons.js';
import { FillBuilder, InkBuilder, pushOrientedBox } from '../geom.js';
import { MAT } from '../renderer.js';

export const ID = 'volcano';

export const DEF = {
  id: ID,
  name: 'VOLCANO GREATBLADE',
  // The weapon strip in the corner is 104px wide, so only that readout uses the short form.
  hudName: 'VOLCANO',
  kind: 'melee', slot: 'melee',

  damage: 200,
  // Barely any back bonus. Two hundred already kills everything in the game outright; the
  // multiplier only exists so `resolveMelee` has one to read.
  headMult: 1.05,
  rate: 3.0,             // one swing every three seconds, same as the hammer
  range: 5.25,           // and the same reach
  auto: false,
  moveMult: 0.88,        // heavier than the hammer, and you are carrying a fire hazard
  drawTime: 0.62,
  hitDelay: 0.50,        // lands late in the swing: the blade takes its time coming over
  swingFrames: 12,       // one drawn cel per animation step, see frames.js
};

/**
 * Resting pose. Held out to the right and angled across, for the same reason the hammer is:
 * a blade a metre long parked where a knife goes sits on the crosshair, and you notice that
 * every time you line up the gun you are about to swap to.
 */
export const POSE = {
  pos: [0.255, -0.320, -0.400],
  // Rolled almost flat-on rather than held edge-up. A blade seen edge-on is a line, and the
  // crack down the middle - the only thing that says this is not a very large knife - is
  // exactly what you lose when you can't see the flat of it.
  rot: [0.22, -0.26, 0.82],
  grip: [0, -0.01, 0.145],
  support: [0, -0.01, 0.290],
};

/** Where sparks and the fire come off. The tip, not the hand. */
export const MUZZLE_POINT = [0, 0.02, -0.78];

/**
 * The blade. A slab, not a sword: the whole point of a greatblade is that it is too much
 * metal for one person, so the silhouette has to be closer to a plank than to a rapier.
 *
 * The lava is drawn as a channel down the middle in three bands - red at the edges, orange
 * inside it, yellow at the core - because a single hot stripe reads as a painted line and a
 * ramp reads as something glowing through a crack.
 */
function buildModel(gl) {
  const IW = 1.9;
  const f = new FillBuilder(), i = new InkBuilder();

  // Grip: long enough for two hands, which is most of what says "greatsword".
  pushOrientedBox(f, i, { pos: [0, -0.010, 0.200], size: [0.052, 0.058, 0.340], mat: MAT.DARK, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, -0.010, 0.385], size: [0.092, 0.095, 0.075], mat: MAT.RED, inkWidth: IW });   // pommel
  // Crossguard, swept forward so it reads as a guard and not as a second handle.
  pushOrientedBox(f, i, { pos: [0, 0.000, 0.010], size: [0.430, 0.070, 0.085], mat: MAT.DARK, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0.190, 0.000, -0.048], size: [0.085, 0.062, 0.090], rot: [0, 0, 0.30], mat: MAT.ORANGE, inkWidth: IW * 0.9 });
  pushOrientedBox(f, i, { pos: [-0.190, 0.000, -0.048], size: [0.085, 0.062, 0.090], rot: [0, 0, -0.30], mat: MAT.ORANGE, inkWidth: IW * 0.9 });

  // Blade: a wide flat slab. Shorter than a greatblade really is - a metre and a quarter of
  // drawn steel at arm's length covers a third of the screen and never gets out of the way
  // of the room, which is a problem no amount of posing solves.
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.450], size: [0.250, 0.052, 0.790], mat: MAT.METAL, inkWidth: IW });
  // Tip, narrowed in two steps rather than one so it still reads as blunt force.
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.885], size: [0.175, 0.046, 0.090], mat: MAT.METAL, inkWidth: IW * 0.9 });
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.955], size: [0.085, 0.040, 0.065], mat: MAT.METAL, inkWidth: IW * 0.85 });

  // The crack down the middle, hottest at the core.
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.450], size: [0.118, 0.056, 0.755], mat: MAT.RED, inkWidth: IW * 0.7 });
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.450], size: [0.070, 0.058, 0.725], mat: MAT.ORANGE, inkWidth: IW * 0.55 });
  pushOrientedBox(f, i, { pos: [0, 0.005, -0.450], size: [0.032, 0.060, 0.690], mat: MAT.LAVA, inkWidth: 0 });
  // Three vents across the flat, so the heat reads as coming out of the metal rather than
  // being painted along it.
  for (const z of [-0.210, -0.460, -0.710]) {
    pushOrientedBox(f, i, { pos: [0, 0.008, z], size: [0.228, 0.056, 0.040], mat: MAT.ORANGE, inkWidth: IW * 0.6 });
  }

  return { body: { fill: f.toMesh(gl), ink: i.toMesh(gl) }, moving: null, inkWidth: IW };
}

/**
 * Add the greatblade to the tables the rest of the game already reads. Everything that
 * handles a melee weapon - pickups, crate drops, bot loadouts, the viewmodel, the HUD -
 * finds it from here without knowing this file exists.
 */
export function registerWeapon(game) {
  WEAPONS[ID] = DEF;
  HOLD[ID] = POSE;
  MUZZLE[ID] = MUZZLE_POINT;
  if (!MELEE_IDS.includes(ID)) MELEE_IDS.push(ID);
  game.weapons.models[ID] = buildModel(game.gl);
}
