// A hand with a hand's anatomy in it.
//
// The game ships one hand mesh: a palm slab, a finger slab and a thumb slab. Three boxes.
// That is the right drawing for a mitten wrapped round a grip and seen for a tenth of a
// second, and it is the wrong drawing for something held up in front of the camera and
// looked at - which is what a fist guard and a boxing jab both are.
//
// So this builds the real thing, in the game's own language of chunky boxes:
//
//   wrist -> palm (metacarpals) -> four digits of three phalanges each -> a two-phalanx
//   thumb hung off a thenar pad
//
// with the proportions a hand actually has: the middle finger longest, the little finger
// shortest and set back, the knuckle line arched rather than straight, every segment
// narrower than the one before it, and the whole set converging slightly as it closes.
//
// One `curl` parameter runs the whole chain from flat to clenched, which is what lets the
// same builder produce the fist, the relaxed hand and the hand wrapped round a gun grip -
// and means all three have the same anatomy rather than being three unrelated drawings.

import { FillBuilder, InkBuilder, pushOrientedBox } from './geom.js';
import { MAT } from './renderer.js';

// Local space, matching the game's own hand: -Z is the way the fingers point, +Y is the
// back of the hand, +X is the thumb side of a right hand.

/** Index, middle, ring, little. Lengths and widths in metres, at the game's chunky scale. */
const DIGITS = [
  { x: 0.0335, z: -0.0640, arch: 0.0020, yaw: -0.075, lens: [0.0400, 0.0262, 0.0196], w: 0.0250 },
  { x: 0.0108, z: -0.0685, arch: 0.0045, yaw: -0.022, lens: [0.0442, 0.0292, 0.0212], w: 0.0258 },
  { x: -0.0122, z: -0.0660, arch: 0.0035, yaw: 0.030, lens: [0.0408, 0.0272, 0.0200], w: 0.0244 },
  { x: -0.0335, z: -0.0595, arch: 0.0000, yaw: 0.085, lens: [0.0322, 0.0214, 0.0172], w: 0.0212 },
];

// How far each joint folds at full curl, in radians.
//
// These are deliberately short of what a real hand does. A hand folds through about 250
// degrees across the three joints, and a chain of boxes bent that far spirals back inside
// the palm it started from - anatomically right, and on screen a featureless lump with the
// fingers hidden inside the hand. Stopping around 200 leaves the folded fingers sitting in
// front of and below the knuckles, where they can be seen, which is what the drawing needs
// even though the skeleton would disagree.
const JOINT = [1.25, 1.45, 0.85];
// ...and how far they splay when the hand is open.
const SPREAD = 0.16;

/**
 * One finger: a chain of boxes, each stepped off the end of the last and bent a little
 * further round. Same trick the dragon's horns use, which is the only way to get a curve
 * out of a renderer that draws boxes.
 */
function digit(f, i, base, yaw0, lens, width, curl, mat, iw, S) {
  // Only the first bone of each finger is outlined.
  //
  // This is the other half of the shimmer. Three boxes in a chain share two joints, and at
  // each joint the end cap of one box and the start cap of the next sit on top of each
  // other - two outlines, a millimetre apart, re-wobbled independently twelve times a
  // second. Four fingers of that is sixteen pairs of duelling lines inside an object two
  // centimetres across, and it reads as the hand buzzing. The proximal bone carries the
  // silhouette; the two beyond it are inside the fist's outline anyway, so they are filled
  // and left unlined.
  let [x, y, z] = base;
  let pitch = 0;
  const yaw = yaw0;
  for (let k = 0; k < lens.length; k++) {
    // Negative pitch is "toward the palm": the local +Z axis carries -sin(pitch) in y, and
    // the finger walks along -Z, so a negative angle bends the tip downward.
    pitch -= JOINT[k] * curl;
    const L = lens[k];
    const W = width * (1 - k * 0.13);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    // Unit vector along -Z of this segment's own frame.
    const dx = -sy * cp, dy = sp, dz = -cy * cp;
    pushOrientedBox(f, k === 0 ? i : null, {
      pos: [(x + dx * L * 0.5) * S, y + dy * L * 0.5, z + dz * L * 0.5],
      size: [W, W * 0.94, L],
      rot: [pitch, yaw * S, 0],
      mat, inkWidth: iw * 0.82,
    });
    x += dx * L; y += dy * L; z += dz * L;
    // A knuckle bead over each joint except the last, so the chain reads as jointed
    // rather than as three boxes that happen to touch.
    if (k < lens.length - 1) {
      pushOrientedBox(f, null, {
        pos: [x * S, y, z], size: [W * 1.06, W * 1.02, W * 0.80],
        rot: [pitch, yaw * S, 0], mat,
      });
    }
  }
  return [x, y, z];
}

/**
 * @param {number} curl  0 = flat and open, 1 = clenched
 * @param {string} side  'left' or 'right'
 */
export function buildHand(gl, { side = 'right', curl = 0, mat = MAT.SKIN, inkWidth = 1.55 } = {}) {
  const f = new FillBuilder(), i = new InkBuilder();
  const S = side === 'left' ? -1 : 1;
  const c = Math.max(0, Math.min(1, curl));
  // Only the boxes that make the silhouette get an outline.
  //
  // The ink pass re-jitters every endpoint on each animation step. On a three-box mitten
  // that is the boil the whole game is drawn with; on a hand built from twenty-five boxes
  // it is two hundred edges, most of them buried inside other boxes and lying within a
  // millimetre of each other, each wobbling independently - and a dozen near-coincident
  // lines shivering out of phase reads as the hand vibrating rather than as pencil. So the
  // interior boxes are filled and not outlined: same volume, a quarter of the lines, and
  // the wobble goes back to looking drawn.
  const box = (pos, size, o = {}) => pushOrientedBox(f, o.noInk ? null : i, {
    pos: [pos[0] * S, pos[1], pos[2]],
    size,
    rot: o.rot ? [o.rot[0], (o.rot[1] || 0) * S, (o.rot[2] || 0) * S] : [0, 0, 0],
    mat: o.mat ?? mat,
    inkWidth: o.iw ?? inkWidth,
  });

  // Wrist and the back of the hand. The palm is two boxes rather than one because a hand
  // is wider across the knuckles than it is at the wrist, and one box cannot taper.
  // The wrist stops at the origin rather than straddling it: the sleeve is drawn from the
  // hand's own position back toward the shoulder, so anything behind z = 0 here is
  // geometry sitting inside the sleeve.
  box([0, 0, 0.046], [0.0700, 0.0520, 0.0520], { iw: inkWidth * 0.9 });
  box([0, 0.002, 0.008], [0.0860, 0.0460, 0.0560], { noInk: true });
  box([0.002, 0.006, -0.038], [0.0960, 0.0430, 0.0560]);

  // The two muscle pads that give a palm its shape: the thumb side and the little-finger
  // side. Without them the hand is a plank with fingers on it.
  box([0.0400, -0.0140, -0.0020], [0.0420, 0.0400, 0.0700], { rot: [0, 0, 0.16], noInk: true });
  box([-0.0390, -0.0100, -0.0040], [0.0290, 0.0350, 0.0740], { rot: [0, 0, -0.10], noInk: true });

  // Knuckle heads, on an arch - the middle two sit proudest, which is the line you read a
  // fist by.
  for (let k = 0; k < DIGITS.length; k++) {
    const d = DIGITS[k];
    // Proud of the back of the hand, so the knuckle line is the first thing the eye gets.
    box([d.x, 0.010 + d.arch, d.z + 0.008], [d.w * 1.14, d.w * 1.10, d.w * 1.10], { noInk: true });
  }

  // The four fingers.
  for (const d of DIGITS) {
    const spread = (1 - c) * SPREAD * (d.x >= 0 ? 1 : -1) * 0.5;
    digit(f, i, [d.x, 0.002 + d.arch, d.z - 0.004], d.yaw + spread, d.lens, d.w, c, mat, inkWidth, S);
  }

  // Thumb. Two phalanges off the thenar pad, splayed wide when the hand is open and
  // folded across the front of the fingers when it closes - which is what a fist does with
  // a thumb, and the single detail that stops a clenched hand reading as a lump.
  {
    let x = 0.0480, y = -0.0160, z = -0.0220;
    // Open, the thumb points out to the side. Closed, it comes forward and then the second
    // phalanx folds back across the front of the curled fingers - which is the one detail
    // that separates a fist from a rock.
    let yaw = 0.95 - c * 0.62;
    let pitch = -0.16 - c * 0.42;
    const lens = [0.0400, 0.0320];
    const widths = [0.0272, 0.0240];
    for (let k = 0; k < 2; k++) {
      if (k === 1) { yaw -= 0.30 + c * 1.15; pitch -= 0.40 + c * 0.30; }
      const L = lens[k], W = widths[k];
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const dx = -sy * cp, dy = sp, dz = -cy * cp;
      box([x + dx * L * 0.5, y + dy * L * 0.5, z + dz * L * 0.5],
        [W, W * 0.94, L], { rot: [pitch, yaw, 0], iw: inkWidth * 0.85, noInk: k === 1 });
      x += dx * L; y += dy * L; z += dz * L;
      if (k === 0) box([x, y, z], [W * 1.06, W * 1.02, W * 0.80], { rot: [pitch, yaw, 0], noInk: true });
    }
  }

  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/**
 * The set this mod uses.
 *
 * `fist` is fully clenched, for punching and for the boxing guard. `grip` is the same hand
 * closed about three-quarters of the way, which is what a hand round a pistol grip or a
 * haft actually looks like - and it replaces the game's mitten everywhere, so every weapon
 * in the game gets the better hand for as long as this mod is on.
 */
export function buildHandSet(gl) {
  return {
    fistRight: buildHand(gl, { side: 'right', curl: 1.0 }),
    fistLeft: buildHand(gl, { side: 'left', curl: 1.0 }),
    gripRight: buildHand(gl, { side: 'right', curl: 0.72 }),
    gripLeft: buildHand(gl, { side: 'left', curl: 0.72 }),
  };
}

export function disposeHandSet(set) {
  if (!set) return;
  for (const h of Object.values(set)) { h.fill?.dispose?.(); h.ink?.dispose?.(); }
}

/**
 * Put the grip hand behind the game's own `weapons.hand`, correctly handed.
 *
 * `_drawWeapon` reads `hands.hand.fill` then `hands.hand.ink` for the hand on the grip,
 * and then the same pair again for the hand on the support point - the first is always the
 * right hand, the second always the left. A mitten is symmetric so upstream can serve one
 * mesh for both; an anatomical hand is not, so this hands back a different mesh on the
 * second read.
 *
 * The counter is reset from the `_drawWeapon` wrap before each call, so a frame that draws
 * only one hand cannot leave the next frame starting on the wrong one.
 */
