// The DROODLE CANNON itself: the numbers, the pose, and the drawing.
//
// Nothing here replaces a game file. `WEAPONS`, `HOLD`, `MUZZLE` and `CYCLE` are plain
// exported objects, and a mod script is imported from the same origin as the game, so it
// gets the *same module instances* the game is already using. Adding a key to them is all
// it takes for the existing machinery - the viewmodel, pickups, the HUD, bot loadouts,
// crate drops - to know about a weapon that was not there when the page loaded.
//
// Weapon local space, same as every other gun in the game: the barrel points down -Z, up
// is +Y, and the hand sits near the origin.

import { WEAPONS, HOLD, MUZZLE, CYCLE } from '../weapons.js';
import { FillBuilder, InkBuilder, pushOrientedBox, pushShape } from '../geom.js';
import { MAT } from '../renderer.js';

export const ID = 'droodlecannon';

/** How many animation frames each stage of the passive lasts. Everything runs on twelves. */
export const CHARGE_FRAMES = 9;      // 0.75s of winding up
export const LASER_FRAMES = 6;       // 0.50s of beam on screen

/**
 * The drawing below is authored at a comfortable size and then shrunk to fit the hand.
 * Every number in buildHead/buildBody/buildBreech is in those authored units.
 *
 * Two knobs, not one. SCALE decides how much of the screen the thing eats; SQUASH is
 * applied on top of it along Z only, which shortens the weapon without thinning it. A
 * stubby cannon and a small cannon are different shapes, and in first person the one you
 * want is stubby: the length is what sits between you and the room, the girth is what
 * makes it read as a cannon.
 *
 * Both apply to the meshes, to the grips and to the muzzle, so they cannot drift apart.
 */
export const SCALE = 0.55;
export const SQUASH = 0.72;

const scaled = (p) => [p[0] * SCALE, p[1] * SCALE, p[2] * SCALE * SQUASH];

export const DEF = {
  id: ID,
  name: 'DROODLE CANNON',
  // The weapon strip in the corner is 104px wide and "DROODLE CANNON" runs off the end of
  // the screen there. Only that one readout uses the short form.
  hudName: 'D.CANNON',
  kind: 'gun', slot: 'gun',

  damage: 25, headMult: 1.8,
  rate: 0.92,                        // deliberately slow - it is a cannon on your arm
  mag: 9, reserve: 36, reload: 2.35,
  spread: 0.85, moveSpread: 3.0,
  recoil: 3.1, recoilSide: 0.62,
  auto: false,
  range: 95, moveMult: 0.90, drawTime: 0.58, bulletsPerShot: 1,
  color: [0.86, 0.66, 0.18],

  // ---- the passive -------------------------------------------------------
  // Every third pull of the trigger does not fire a round. It winds the thing up for
  // CHARGE_FRAMES, and when the last cel of the charge lands the laser goes off on its
  // own - you do not get to hold it.
  chargeEvery: 3,
  // Everything this weapon fires is a fireball, not a bullet, so it is measured against a
  // much larger body: three times the radius, and half a metre of reach added above the
  // head and below the feet as well, because a shot that sails over a shoulder looks
  // exactly as much like a hit as one that goes through a hip. It applies to whoever is
  // holding it, player or bot.
  hitboxMult: 3.0,
  hitboxPad: 0.5,
  // The beam is different: it is a volume you can see, so its reach stays tied to what is
  // actually drawn. Hitting somebody standing plainly outside the laser reads as a bug.
  laserHitboxMult: 2.0,
  laserDamage: 75,
  laserRange: 70,                    // far enough to reach the wall in any room here
  laserRadius: 0.95,                 // half-width of the volume that takes the 75
  boltSpeed: 62,                     // metres a second, for the round you can actually see
};

/**
 * Where the hands go, and how the whole thing hangs in front of the camera.
 *
 * The right hand is the one it is *bolted* to: it closes on the grip under the tube and
 * the forearm runs on through the collar behind it, which is what makes this a gauntlet
 * rather than something you happen to be carrying. The left comes over the top of the
 * barrel onto the foregrip - it has to, because a cannon this short recoils straight back
 * into your face if you only have one hand on it.
 */
export const POSE = {
  pos: [0.198, -0.196, -0.400],
  rot: [0.020, 0.118, -0.048],
  grip: scaled([0, -0.118, 0.115]),
  support: scaled([0, -0.120, -0.235]),
};

/** The mouth. Flashes, the round, the beam and the charge all start here. */
export const MUZZLE_POINT = scaled([0, 0.010, -0.760]);

/** The breech kicks back a long way and takes its time coming home. */
export const RECOIL = { travel: 0.105 * SCALE * SQUASH, time: 0.26 };

// ---------------------------------------------------------------- the drawing

const GOLD = MAT.WALL;      // the mustard in the palette is the gold in the reference
const GOLD_DEEP = MAT.TRIM;
// The body. Orange rather than the reference's navy, which puts it in the same family as
// the fire it throws - so the dark rings and the ink between the panels are doing the
// separating, not a colour clash.
const BODY = MAT.ORANGE;
const SHADE = MAT.DARK;
const IW = 1.55;

/**
 * A tapering horn: a short chain of boxes, each smaller than the last and bent a little
 * further round, so it reads as a curve without a curved mesh anywhere in it.
 */
function horn(f, i, root, dir, segs, len, thick, bend, mat) {
  let [x, y, z] = root;
  let pitch = dir[0], yaw = dir[1], roll = dir[2];
  for (let k = 0; k < segs; k++) {
    const u = k / segs;
    const l = len * (1 - u * 0.45);
    const t = thick * (1 - u * 0.62);
    pushOrientedBox(f, i, { pos: [x, y, z], size: [t, t * 1.15, l], rot: [pitch, yaw, roll], mat, inkWidth: IW * (1 - u * 0.25) });
    // Step to the far end of the segment we just placed, then bend for the next one.
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    x += sy * cp * l * 0.86;
    y += -sp * l * 0.86;
    z += cy * cp * l * 0.86;
    pitch += bend[0]; yaw += bend[1]; roll += bend[2];
  }
}

/**
 * The head. Gold, angular, and slightly too big for the barrel it is wrapped around -
 * the reference is a carnival dragon bolted to a launcher, not an anatomy study.
 */
function buildHead(f, i) {
  // Skull and snout.
  pushOrientedBox(f, i, { pos: [0, 0.012, -0.430], size: [0.218, 0.196, 0.245], mat: GOLD, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, 0.036, -0.590], size: [0.180, 0.142, 0.155], rot: [0.06, 0, 0], mat: GOLD, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, 0.048, -0.694], size: [0.140, 0.100, 0.092], rot: [0.14, 0, 0], mat: GOLD, inkWidth: IW * 0.9 });
  // Brow. There is deliberately no crest behind it: a ridge running back over the crown
  // and down the spine turned the silhouette into a cockerel from every angle you
  // actually hold the thing at. The horns carry the head on their own.
  pushOrientedBox(f, i, { pos: [0, 0.108, -0.470], size: [0.195, 0.052, 0.190], rot: [-0.10, 0, 0], mat: GOLD_DEEP, inkWidth: IW });

  // Lower jaw, hung open a crack. The bore lives between the jaws.
  pushOrientedBox(f, i, { pos: [0, -0.078, -0.585], size: [0.150, 0.070, 0.215], rot: [-0.20, 0, 0], mat: GOLD_DEEP, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, -0.100, -0.700], size: [0.105, 0.048, 0.075], rot: [-0.34, 0, 0], mat: GOLD_DEEP, inkWidth: IW * 0.85 });

  // Teeth. Four up, three down, all slightly different, none of them straight.
  for (let k = 0; k < 4; k++) {
    const x = -0.052 + k * 0.035;
    pushOrientedBox(f, i, { pos: [x, -0.012, -0.700], size: [0.020, 0.046, 0.020], rot: [0.1, 0, (k - 1.5) * 0.09], mat: MAT.LIGHT, inkWidth: IW * 0.7 });
  }
  for (let k = 0; k < 3; k++) {
    const x = -0.038 + k * 0.038;
    pushOrientedBox(f, i, { pos: [x, -0.062, -0.695], size: [0.019, 0.038, 0.019], rot: [-0.1, 0, (k - 1) * 0.11], mat: MAT.LIGHT, inkWidth: IW * 0.7 });
  }

  // Eyes: a red slit set into a dark socket, so it still reads once the outlines drop
  // at distance.
  for (const s of [-1, 1]) {
    pushOrientedBox(f, i, { pos: [s * 0.093, 0.058, -0.520], size: [0.030, 0.050, 0.062], rot: [0, s * 0.20, s * 0.28], mat: SHADE, inkWidth: IW * 0.8 });
    pushOrientedBox(f, i, { pos: [s * 0.100, 0.058, -0.532], size: [0.024, 0.026, 0.040], rot: [0, s * 0.20, s * 0.30], mat: MAT.RED, inkWidth: IW * 0.65 });
  }

  // Nostrils.
  for (const s of [-1, 1]) {
    pushOrientedBox(f, i, { pos: [s * 0.042, 0.070, -0.676], size: [0.026, 0.022, 0.026], rot: [0, 0, s * 0.3], mat: SHADE, inkWidth: IW * 0.6 });
  }

  // Horns sweeping back off the crown, and a smaller pair off the cheeks.
  for (const s of [-1, 1]) {
    horn(f, i, [s * 0.082, 0.122, -0.400], [-0.30, s * 0.30, 0], 3, 0.096, 0.058, [-0.13, s * 0.11, 0], GOLD_DEEP);
    horn(f, i, [s * 0.105, -0.020, -0.470], [0.10, s * 0.62, 0], 3, 0.080, 0.044, [-0.10, s * 0.14, 0], GOLD);
  }

  // Cheek fins - flat gold plates flaring off the sides, the ones that read as "dragon"
  // from any angle where the horns are hidden.
  for (const s of [-1, 1]) {
    pushShape(f, i, [
      [0.00, -0.075], [0.115, -0.115], [0.170, -0.010], [0.140, 0.092], [0.048, 0.070], [0.00, 0.045],
    ].map(([a, b]) => [s * a, b]), GOLD, IW * 0.9, 0.030, -0.400);
  }

  // The barbels along the jaw, from the reference. Thin, gold, and drooping.
  for (const s of [-1, 1]) {
    horn(f, i, [s * 0.078, -0.060, -0.560], [0.55, s * 0.34, 0], 3, 0.070, 0.030, [0.14, s * 0.08, 0], GOLD);
  }

  // Bore: a dark ring in the mouth with an ember sitting behind it, so the thing looks
  // loaded even when it is not.
  pushOrientedBox(f, i, { pos: [0, -0.008, -0.735], size: [0.092, 0.092, 0.045], mat: SHADE, inkWidth: IW * 0.9 });
  pushOrientedBox(f, i, { pos: [0, -0.008, -0.752], size: [0.058, 0.058, 0.020], mat: MAT.ORANGE, inkWidth: IW * 0.6 });
}

/** Barrel shroud, forearm collar, grip and the hooked carry handle over the top. */
function buildBody(f, i) {
  // Main tube.
  pushOrientedBox(f, i, { pos: [0, 0.000, -0.130], size: [0.178, 0.178, 0.470], mat: BODY, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, 0.000, 0.170], size: [0.158, 0.158, 0.150], mat: BODY, inkWidth: IW });

  // Gold bands round it.
  for (const z of [-0.330, -0.170, 0.010, 0.120]) {
    pushOrientedBox(f, i, { pos: [0, 0, z], size: [0.196, 0.196, 0.030], mat: GOLD_DEEP, inkWidth: IW * 0.8 });
  }
  // Vents down the sides. Three short louvres rather than one long panel: a single slab
  // that size reads as a hole cut in the weapon, and three read as vents.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      pushOrientedBox(f, i, { pos: [s * 0.096, -0.006, -0.190 + k * 0.088], size: [0.026, 0.076, 0.052], rot: [0, 0, s * 0.10], mat: SHADE, inkWidth: IW * 0.7 });
    }
  }

  // No carry handle over the back. The reference has a hooked one there, and drawn as a
  // chain of dark boxes it read as a cockscomb sitting on the weapon from every angle in
  // first person - which is worse than not having it.

  // Foregrip, under the barrel. The left hand comes over the top of the tube onto this;
  // without something drawn here the support hand is a mitten floating in mid-air.
  pushOrientedBox(f, i, { pos: [0, -0.132, -0.235], size: [0.072, 0.135, 0.098], rot: [-0.16, 0, 0], mat: SHADE, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, -0.198, -0.250], size: [0.086, 0.034, 0.104], rot: [-0.16, 0, 0], mat: GOLD_DEEP, inkWidth: IW * 0.8 });

  // Grip under the tube - this is where the hand actually closes.
  pushOrientedBox(f, i, { pos: [0, -0.128, 0.115], size: [0.062, 0.155, 0.092], rot: [0.26, 0, 0], mat: SHADE, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, -0.190, 0.140], size: [0.070, 0.036, 0.100], rot: [0.26, 0, 0], mat: GOLD_DEEP, inkWidth: IW * 0.8 });
  pushOrientedBox(f, i, { pos: [0, -0.070, 0.060], size: [0.024, 0.040, 0.018], mat: MAT.METAL, inkWidth: IW * 0.7 }); // trigger
  pushOrientedBox(f, i, { pos: [0, -0.092, 0.075], size: [0.028, 0.014, 0.080], mat: MAT.METAL, inkWidth: IW * 0.7 });  // guard

  // Forearm collar. The bit that makes it a gauntlet rather than a gun: a ring the arm
  // goes through, with a strap over it. Kept deliberately small - it is the part closest
  // to the camera, so every millimetre here costs several on screen.
  pushOrientedBox(f, i, { pos: [0, -0.026, 0.262], size: [0.214, 0.198, 0.084], mat: SHADE, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, -0.026, 0.262], size: [0.232, 0.066, 0.096], mat: GOLD_DEEP, inkWidth: IW * 0.8 });
  pushOrientedBox(f, i, { pos: [0, -0.114, 0.226], size: [0.140, 0.052, 0.172], rot: [0.08, 0, 0], mat: SHADE, inkWidth: IW * 0.85 });
}

/** The breech: everything that slams backwards when it goes off. */
function buildBreech(f, i) {
  pushOrientedBox(f, i, { pos: [0, 0.010, 0.324], size: [0.144, 0.144, 0.134], mat: MAT.RED, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, 0.010, 0.400], size: [0.166, 0.166, 0.036], mat: SHADE, inkWidth: IW * 0.85 });
  pushOrientedBox(f, i, { pos: [0, 0.010, 0.258], size: [0.162, 0.162, 0.030], mat: GOLD_DEEP, inkWidth: IW * 0.8 });
  // Two little exhaust stubs that vent past your elbow.
  for (const s of [-1, 1]) {
    pushOrientedBox(f, i, { pos: [s * 0.084, 0.068, 0.344], size: [0.038, 0.038, 0.104], rot: [0.22, s * 0.24, 0], mat: MAT.METAL, inkWidth: IW * 0.75 });
  }
}

/**
 * Shrink a built pair in place. Scaling the vertices beats scaling the model matrix,
 * because the ink pass expands its quads in *screen* space from the two endpoints it is
 * handed - a matrix scale would move the line, and a stroke on a small weapon would come
 * out the same weight as one on a large one either way.
 */
function shrink(f, i, s, sz) {
  for (let k = 0; k < f.v.length; k += 9) { f.v[k] *= s; f.v[k + 1] *= s; f.v[k + 2] *= sz; }
  for (let k = 0; k < i.v.length; k += 10) {
    i.v[k] *= s; i.v[k + 1] *= s; i.v[k + 2] *= sz;
    i.v[k + 3] *= s; i.v[k + 4] *= s; i.v[k + 5] *= sz;
  }
}

export function buildModel(gl) {
  const bf = new FillBuilder(), bi = new InkBuilder();
  buildBody(bf, bi);
  buildHead(bf, bi);
  const mf = new FillBuilder(), mi = new InkBuilder();
  buildBreech(mf, mi);
  shrink(bf, bi, SCALE, SCALE * SQUASH);
  shrink(mf, mi, SCALE, SCALE * SQUASH);
  return {
    body: { fill: bf.toMesh(gl), ink: bi.toMesh(gl) },
    moving: { fill: mf.toMesh(gl), ink: mi.toMesh(gl) },
    inkWidth: IW,
  };
}

// ---------------------------------------------------------------- registration

/**
 * Splice the weapon into the tables the game already reads, and hand back a function that
 * takes it all out again. Turning the mod off mid-match has to leave the game exactly as
 * upstream ships it, which means these four keys have to go.
 */
export function registerWeapon(game) {
  WEAPONS[ID] = DEF;
  HOLD[ID] = POSE;
  MUZZLE[ID] = MUZZLE_POINT;
  CYCLE[ID] = RECOIL;
  game.weapons.models[ID] = buildModel(game.gl);
}
