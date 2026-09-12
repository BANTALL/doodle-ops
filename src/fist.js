// FISTS - what everybody starts a match with now.
//
// The knife stops being free. You open with your hands, and a knife or an hammer is something
// you have to go and find, which turns the first thirty seconds of a match into a scramble
// for a crate instead of a knife fight everybody already won.
//
// There is no weapon mesh here. The viewmodel *is* the two hands, posed like a boxer: a
// guard with both fists up, and alternating straight punches that throw one hand out while
// the other stays home. The base game's `_drawWeapon` cannot express that - it places one
// hand at a grip point and optionally a second at a support point - so for fists the mod
// takes the draw over completely.

import { WEAPONS, HOLD, MUZZLE } from './weapons.js';
import { FillBuilder, InkBuilder } from './geom.js';
import { M4, clamp, lerp, smoothstep } from './math.js';
import { buildHandSet } from './hands.js';

export const ID = 'fist';

export const FIST = {
  id: ID, name: 'FISTS', kind: 'melee', slot: 'melee',
  damage: 25,
  headMult: 1.5,
  rate: 0.46,            // the knife's cadence - "normal", as asked
  range: 2.25,           // a metre shorter than the knife: that is the cost of no blade
  auto: true,
  moveMult: 1.18,        // nothing in your hands, so you move well
  drawTime: 0.26,
  hitDelay: 0.13,
};

/**
 * The stance. `grip` and `support` are never read for fists - the hands are placed by
 * drawFists below - but the base pose still drives sway, bob, jump offset and the draw-up,
 * so it wants to sit where a guard would.
 */
export const FIST_HOLD = {
  pos: [0.020, -0.055, -0.130],
  rot: [0.010, 0.040, 0],
  grip: [0, 0, 0],
  support: null,
};

/** Where a parry burst is drawn from. Between the fists, a little forward. */
export const FIST_MUZZLE = [0, -0.02, -0.34];

let HANDS = null;

/** The hand meshes this mod builds, so the entry script can lend them to every weapon. */
export function getHandSet() { return HANDS; }

// Guard positions, in the pose's local space. The lead hand is slightly forward and
// slightly lower, which is what makes a boxing guard read as a boxing guard.
const GUARD = {
  right: [0.122, -0.112, -0.372],
  left: [-0.110, -0.140, -0.404],
};
// Where a punch finishes: forward, and crossing toward the centre line.
const EXTEND = {
  right: [0.042, -0.100, -0.880],
  left: [-0.030, -0.118, -0.905],
};
const SHOULDER = {
  right: [0.30, -0.62, 0.22],
  left: [-0.34, -0.62, 0.22],
};

/**
 * Where each hand is, and how it is turned, at a given point in a punch.
 *
 * `t` is progress through the weapon's cooldown, 0..1. The three beats are deliberately
 * uneven: a short wind-up, a very fast strike that covers most of the distance in about a
 * fifth of the cycle, and a long recovery. Even beats read as a robot waving.
 */
function punchPose(t, lead) {
  const WIND = 0.18, HIT = 0.42;
  let reach, twist, drop;
  if (t < WIND) {
    // Cocking back. The fist pulls in toward the shoulder and the elbow lifts.
    const e = smoothstep(0, 1, t / WIND);
    reach = -0.22 * e;
    twist = -0.30 * e;
    drop = 0.035 * e;
  } else if (t < HIT) {
    // The strike. Accelerating, so the smear that rides on it is strongest near the end.
    const u = (t - WIND) / (HIT - WIND);
    const e = u * u;
    reach = lerp(-0.22, 1.0, e);
    twist = lerp(-0.30, 1.35, e);
    drop = lerp(0.035, -0.02, e);
  } else {
    // Coming home, and slower than it went out.
    const e = 1 - (1 - (t - HIT) / (1 - HIT)) ** 2;
    reach = lerp(1.0, 0, e);
    twist = lerp(1.35, 0, e);
    drop = lerp(-0.02, 0, e);
  }
  // Smear is worth having only through the strike itself.
  const smear = t >= WIND && t < HIT
    ? 0.35 + Math.sin(((t - WIND) / (HIT - WIND)) * Math.PI) * 0.85
    : 0;
  return { reach, twist, drop, smear, lead };
}

/**
 * Sample the boxing animation for a pose. Stored on the pose object so the draw does not
 * have to reach back into the loadout - which matters for the smear ghosts, since they are
 * the same pose asked for a fraction of a step ago.
 */
export function sampleFist(player, back, pose) {
  const lo = player.loadout;
  const def = WEAPONS[ID];
  if (!def) return null;
  const cd = lo.cooldown > 0 ? Math.min(def.rate, lo.cooldown + back) : 0;
  const t = cd > 0 ? 1 - cd / def.rate : -1;
  // slashDir flips on every swing, so it is already the "which hand" flag.
  const lead = lo.slashDir > 0 ? 'right' : 'left';
  const p = t >= 0 ? punchPose(t, lead) : { reach: 0, twist: 0, drop: 0, smear: 0, lead };
  // A small idle sway so a boxer at rest is not a statue.
  p.idle = Math.sin(player.vm.bobPhase * 0.9) * 0.012;
  pose.smear = Math.max(pose.smear || 0, p.smear);
  return p;
}

/** Draw the two fists and their forearms. */
export function drawFists(r, player, pose, alpha, inkOnly, smear) {
  const fistData = pose.essFist;
  if (!fistData) return;
  const s = pose.scale;
  if (!HANDS) return;
  const m = M4.compose(scratchA, { x: pose.px, y: pose.py, z: pose.pz }, pose.ry, pose.rx, pose.rz, s, s, s);
  const opts = { objSeed: 6.2, alpha, colorAmt: player.colorAmt };
  const pool = smearPool;
  let pi = 0;
  const sm = (mat) => (smear ? M4.mul(pool[pi++ % pool.length], smear, mat) : mat);

  for (const side of ['left', 'right']) {
    const active = fistData.lead === side;
    const reach = active ? fistData.reach : -fistData.reach * 0.22;   // the off hand counter-rocks
    const g = GUARD[side], e = EXTEND[side];
    const k = clamp(reach, -0.35, 1);

    let lx = lerp(g[0], e[0], Math.max(0, k)) + (k < 0 ? -g[0] * k * 0.25 : 0);
    let ly = lerp(g[1], e[1], Math.max(0, k)) + fistData.drop * (active ? 1 : -0.4) + fistData.idle * (side === 'right' ? 1 : -1);
    let lz = lerp(g[2], e[2], Math.max(0, k)) + (k < 0 ? 0.10 * -k : 0);

    const w = applyMat(m, [lx, ly, lz]);

    // Orientation: the hand is aimed down its own forearm, not posed with guessed angles.
    //
    // A hand does not have a rotation of its own - it has the rotation of the arm it is on
    // the end of. Picking yaw and pitch by hand meant they were only ever right for the one
    // pose they were tuned in, and wrong the moment the fist moved: crossed in an X block
    // the forearms run diagonally, and a fist yawed by a fixed amount points somewhere the
    // arm does not. Building the matrix by aiming +Z at the shoulder - which is exactly how
    // the sleeve is already built - means the hand and the sleeve can never disagree, in any
    // pose, because they are derived from the same two points.
    //
    // That leaves roll as the only free angle, which is the one a boxer actually chooses:
    // vertical fist at rest, rolling over to palm-down as the punch lands.
    const ext = clamp(Math.max(0, k), 0, 1);
    const sideSign = side === 'right' ? 1 : -1;
    aimMatrix(scratchB, w, SHOULDER[side]);

    // Roll is solved, not guessed. Aiming down the forearm fixes two of the three angles;
    // the third is "which way is the back of the hand pointing", and that has a different
    // right answer in each pose:
    //
    //   at rest    outward   - the vertical fist of a boxing guard, palms facing each other
    //   extended   upward    - a straight punch lands palm-down
    //
    // rollToFace works out the angle that gets closest to that, whatever direction the arm
    // happens to be pointing. Which is the fix: the old fixed angles were only ever right
    // in the one pose they were tuned in.
    const tx = sideSign * (1 - ext), ty = ext, tz = 0;
    const local = rollZ(scratchB, rollToFace(scratchB, tx, ty, tz));

    const fistMesh = side === 'right' ? HANDS.fistRight : HANDS.fistLeft;
    if (!inkOnly) r.vmFill(fistMesh.fill, sm(local), opts);
    r.vmInk(fistMesh.ink, sm(local), opts);

    // Forearm running off the bottom of the screen, started behind the wrist so the hand
    // sits in front of the cuff instead of through it.
    aimMatrix(scratchC, backOff(w, SHOULDER[side], 0.105), SHOULDER[side]);
    const arm = smear ? M4.mul(scratchD, smear, scratchC) : scratchC;
    const arms = player.game.weapons.arm;
    if (!inkOnly) r.vmFill(arms.fill, arm, { objSeed: 8.4, colorAmt: player.colorAmt, alpha });
    r.vmInk(arms.ink, arm, { objSeed: 8.4, alpha });
  }
}

function rollToFace(m, tx, ty, tz) {
  const a = m[0] * tx + m[1] * ty + m[2] * tz;     // target . X
  const b = m[4] * tx + m[5] * ty + m[6] * tz;     // target . Y
  if (Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6) return 0;
  return Math.atan2(-a, b);
}

/**
 * Spin a matrix about its own Z axis, in place. Post-multiplying by Rz is what lets a
 * matrix built by aiming keep its aim and still be rolled about it.
 */
function rollZ(m, a) {
  if (!a) return m;
  const c = Math.cos(a), s = Math.sin(a);
  const x0 = m[0], y0 = m[1], z0 = m[2];
  const x1 = m[4], y1 = m[5], z1 = m[6];
  m[0] = x0 * c + x1 * s; m[1] = y0 * c + y1 * s; m[2] = z0 * c + z1 * s;
  m[4] = -x0 * s + x1 * c; m[5] = -y0 * s + y1 * c; m[6] = -z0 * s + z1 * c;
  return m;
}

/** Step `d` metres from `from` toward `toward`. Used to start a sleeve behind a wrist. */
function backOff(from, toward, d) {
  const dx = toward[0] - from[0], dy = toward[1] - from[1], dz = toward[2] - from[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  backScratch[0] = from[0] + (dx / l) * d;
  backScratch[1] = from[1] + (dy / l) * d;
  backScratch[2] = from[2] + (dz / l) * d;
  return backScratch;
}
const backScratch = [0, 0, 0];

/** Matrix at `from` whose +Z axis points at `toward`. Same construction player.js uses. */
function aimMatrix(out, from, toward) {
  let fx = toward[0] - from[0], fy = toward[1] - from[1], fz = toward[2] - from[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
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

const scratchA = M4.create();
const scratchB = M4.create();
const scratchC = M4.create();
const scratchD = M4.create();
const smearPool = [M4.create(), M4.create(), M4.create(), M4.create()];

/**
 * Splice the fists into the tables the game already reads, and hand back the undo.
 *
 * The model is a pair of empty meshes on purpose. `renderViewmodel` bails out if there is
 * no model for the weapon it is holding, and the renderer skips any mesh with no indices
 * in it, so an empty entry is exactly "this weapon has no object in it" - which is true.
 */
/**
 * Build the fist "weapon" and file it alongside the real ones. There is no mesh: the
 * viewmodel for fists is the two hands, which drawFists places itself.
 */
export function registerFist(game) {
  const gl = game.gl;
  const empty = () => ({ fill: new FillBuilder().toMesh(gl), ink: new InkBuilder().toMesh(gl) });
  HANDS = buildHandSet(gl);
  WEAPONS[ID] = FIST;
  HOLD[ID] = FIST_HOLD;
  MUZZLE[ID] = FIST_MUZZLE;
  game.weapons.models[ID] = { body: empty(), moving: null, inkWidth: 1.6 };
  return HANDS;
}

/** Transform a local point by a mat4, as a plain array. */
function applyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
