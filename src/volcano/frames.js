// The twelve drawn frames of a greatblade swing.
//
// The hammer cuts sideways. This one does not: it goes *up* first, hangs at the top for a
// frame while nothing happens, and then comes down a diagonal under its own weight. That
// hang is the whole animation. A heavy weapon does not look heavy because it moves slowly -
// it looks heavy because it takes a beat to get going, arrives all at once, and then keeps
// going past where you wanted it to stop.
//
// So: cels 1-4 lift and hold, 5-8 are the drop and are pure mark - there is no blade drawn
// in any of them - and 9-12 are the recovery, where the point is buried low and to the left
// and has to be dragged back up. Nine and ten are deliberately slow to read; that is the
// blade being too heavy to lift, which is the cost you are paying for the two hundred.
//
// The fire is drawn *into* the sheet rather than added as particles on top. On the fast
// cels the smear is three bands nested inside each other - dark red outside, orange inside
// that, yellow down the middle - so the mark itself is the flame.
//
// Same card as every other sheet: x is right, y is up, one unit is about half a metre.

import { FillBuilder, InkBuilder, pushShape } from '../geom.js';
import { MAT } from '../renderer.js';
import { arc, streak, rand } from '../celkit.js';

export const VOLCANO_FRAMES = 12;

// The hands sit high for a viewmodel on purpose. The card is only about 1.4 units tall at
// the scale the sheet plays back at, and the blade is 0.56 of that: hang it straight down
// off a pivot near the bottom edge and the whole recovery happens off-screen.
const PIVOT = [0.06, -0.52];
const ARC_R = 1.02;
/**
 * The blade is authored at a comfortable size and then shrunk to fit the card. The two knobs
 * are separate on purpose: this one only touches the weapon, so it can be made to sit in the
 * hand without also shrinking the sweep, which wants to stay wider than the hammer's.
 */
const BLADE = 0.56;

/** An arc of the swing, struck about the pivot the blade turns around. */
function swingArc(f, i, opts) {
  arc(f, i, { cx: PIVOT[0], cy: PIVOT[1], r: ARC_R, ...opts });
}

/**
 * A hot smear: the same band drawn three times at shrinking thickness in a red-orange-yellow
 * ramp. Drawn outside-in so the core lands on top.
 */
function fireArc(f, i, { thick, ...opts }) {
  const ramp = [[1.00, MAT.RED, 2.4], [0.62, MAT.ORANGE, 1.8], [0.28, MAT.LAVA, 1.2]];
  for (const [k, mat, iw] of ramp) {
    swingArc(f, i, { ...opts, mat, iw, thick: (t) => thick(t) * k });
  }
}

/** Embers thrown off the fast end of the mark. Deterministic, so they don't crawl. */
function embers(f, i, x, y, spread, count, seed) {
  const nz = rand(seed);
  for (let k = 0; k < count; k++) {
    const ex = x + nz() * spread, ey = y + nz() * spread;
    const s = 0.016 + Math.abs(nz()) * 0.022;
    const mat = k % 3 === 0 ? MAT.LAVA : (k % 3 === 1 ? MAT.ORANGE : MAT.RED);
    pushShape(f, i, [[ex - s, ey - s], [ex + s, ey - s * 0.6], [ex + s * 0.7, ey + s], [ex - s * 0.8, ey + s * 0.7]], mat, 1.1);
  }
}

/**
 * The blade as a drawing, at angle `a` with its hilt at (x, y). Local +Y runs out along the
 * blade, away from the hands. `sx`/`sy` squash and stretch it, which is how the recovery
 * cels overshoot without turning into a different object.
 */
function bladeAt(f, i, { x, y, a, s = 1, sx = 1, sy = 1, hands = true, iw = 2.4, hot = 1 }) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const put = (poly, mat, w) => pushShape(f, i, poly.map(([px, py]) => {
    const qx = px * sx * s * BLADE, qy = py * sy * s * BLADE;
    return [x + qx * ca - qy * sa, y + qx * sa + qy * ca];
  }), mat, w);

  put([[-0.045, -0.46], [0.045, -0.46], [0.045, -0.04], [-0.045, -0.04]], MAT.DARK, iw * 0.9);     // grip
  put([[-0.080, -0.56], [0.080, -0.56], [0.080, -0.44], [-0.080, -0.44]], MAT.RED, iw * 0.85);     // pommel
  put([[-0.300, -0.08], [0.300, -0.08], [0.300, 0.02], [-0.300, 0.02]], MAT.DARK, iw);             // crossguard
  put([[-0.330, -0.12], [-0.250, -0.12], [-0.250, 0.05], [-0.330, 0.05]], MAT.ORANGE, iw * 0.8);   // quillon
  put([[0.250, -0.12], [0.330, -0.12], [0.330, 0.05], [0.250, 0.05]], MAT.ORANGE, iw * 0.8);
  // The slab, then the two-step point. Wide enough that it never reads as a longsword.
  put([[-0.160, 0.02], [0.160, 0.02], [0.160, 0.98], [-0.160, 0.98]], MAT.METAL, iw);
  put([[-0.110, 0.98], [0.110, 0.98], [0.075, 1.10], [-0.075, 1.10]], MAT.METAL, iw * 0.9);
  put([[-0.060, 1.10], [0.060, 1.10], [0.000, 1.22], [0.000, 1.22]], MAT.METAL, iw * 0.85);
  if (hot > 0.02) {
    // The crack, three bands wide. It is what makes the blade read as lit from inside.
    put([[-0.072, 0.04], [0.072, 0.04], [0.072, 0.96], [-0.072, 0.96]], MAT.RED, iw * 0.5);
    put([[-0.040, 0.06], [0.040, 0.06], [0.040, 0.94], [-0.040, 0.94]], MAT.ORANGE, iw * 0.4);
    put([[-0.017, 0.08], [0.017, 0.08], [0.017, 0.92], [-0.017, 0.92]], MAT.LAVA, 0);
  }
  if (hands) {
    // Both hands on it, one above the other - that is the read that says two-handed.
    put([[-0.105, -0.24], [0.105, -0.24], [0.130, -0.15], [0.085, -0.05], [-0.085, -0.05], [-0.130, -0.15]], MAT.SKIN, iw * 0.95);
    put([[-0.100, -0.42], [0.100, -0.42], [0.120, -0.34], [0.080, -0.25], [-0.080, -0.25], [-0.120, -0.34]], MAT.SKIN, iw * 0.9);
    put([[-0.115, -0.58], [0.115, -0.58], [0.115, -0.40], [-0.115, -0.40]], MAT.GREEN, iw * 0.9);   // cuff
  }
}

/** The blade posed on the swing, at angle `th` around the pivot. */
function onSwing(f, i, { th, hold = 0.30, px = 0, py = 0, ...rest }) {
  bladeAt(f, i, {
    x: PIVOT[0] + px + Math.cos(th) * hold,
    y: PIVOT[1] + py + Math.sin(th) * hold,
    a: th - Math.PI / 2,
    ...rest,
  });
}

// ---------------------------------------------------------------- the cels

const CELS = [
  // 1 - the lift begins. Blade still low and across, hands taking the weight.
  (f, i) => {
    onSwing(f, i, { th: 0.42, hold: 0.30, s: 1.0 });
  },

  // 2 - coming up the right side. Nothing fast is happening yet, which is the point.
  (f, i) => {
    onSwing(f, i, { th: 0.82, hold: 0.32, py: 0.06, s: 1.02 });
    embers(f, i, 0.62, 0.18, 0.16, 4, 3);
  },

  // 3 - overhead, at full stretch, leaning back into it.
  (f, i) => {
    onSwing(f, i, { th: 1.28, hold: 0.34, py: 0.12, s: 1.06, sy: 1.05 });
    streak(f, i, 0.34, 0.66, 0.50, 0.96, 0.018, 0.004, MAT.ORANGE, 1.4);
    embers(f, i, 0.24, 0.70, 0.24, 6, 11);
  },

  // 4 - the hang. One frame where it has stopped and has not started falling yet. Held a
  //     hair past vertical and drawn a touch bigger, so it reads as loaded rather than as a
  //     repeat of the frame before it.
  (f, i) => {
    onSwing(f, i, { th: 1.50, hold: 0.34, py: 0.14, s: 1.10, sy: 1.02 });
    embers(f, i, 0.10, 0.84, 0.28, 7, 17);
  },

  // 5 - it goes. The blade stops being a blade: one hot band already started over to the
  //     left, with the hilt smeared into a streak behind it.
  //
  //     Angles run anticlockwise from screen-right, so a swing that comes over the top and
  //     down to the left runs *up* from about 1.5 - past pi at the far left - not down
  //     toward zero. Sweeping the other way sends every mark off the right edge of the card.
  (f, i) => {
    fireArc(f, i, { a0: 1.52, a1: 2.26, steps: 18, seed: 23, rag: 0.028,
      thick: (t) => 0.185 * Math.sin(Math.PI * (0.12 + t * 0.82)) });
    streak(f, i, 0.26, -0.36, 0.54, 0.04, 0.062, 0.014, MAT.DARK, 2.0);
    streak(f, i, 0.14, -0.58, 0.36, -0.30, 0.074, 0.022, MAT.GREEN, 1.9);
    embers(f, i, -0.46, 0.28, 0.30, 8, 29);
  },

  // 6 - fastest, and the one with nothing recognisable in it. A single band right across
  //     the view from top right to bottom left, thick in the middle, ragged on both edges.
  (f, i) => {
    fireArc(f, i, { a0: 1.36, a1: 3.52, steps: 28, seed: 41, rag: 0.034,
      thick: (t) => 0.225 * Math.sin(Math.PI * t) ** 0.6 });
    streak(f, i, 0.36, 0.16, 0.70, 0.46, 0.048, 0.006, MAT.ORANGE, 1.6);
    streak(f, i, -0.86, -0.62, -1.10, -0.82, 0.040, 0.006, MAT.LAVA, 1.5);
    embers(f, i, -0.88, -0.56, 0.34, 10, 43);
  },

  // 7 - the break. The mark tears in two with a hole where the blade ought to be. For one
  //     twelfth of a second there is no object at all, and that is what sells the weight.
  (f, i) => {
    fireArc(f, i, { a0: 2.62, a1: 3.80, steps: 16, seed: 53, rag: 0.030,
      thick: (t) => 0.200 * Math.sin(Math.PI * t) });
    fireArc(f, i, { a0: 1.44, a1: 1.92, steps: 8, seed: 59, rag: 0.022,
      thick: (t) => 0.090 * Math.sin(Math.PI * t) });
    streak(f, i, -0.86, -0.86, -1.08, -1.04, 0.036, 0.005, MAT.ORANGE, 1.5);
    embers(f, i, -0.90, -0.80, 0.36, 9, 61);
  },

  // 8 - the bottom. The band has thinned to a tail down at the left and the embers are
  //     still catching up with it from the right.
  (f, i) => {
    fireArc(f, i, { a0: 3.10, a1: 3.96, steps: 14, seed: 67, rag: 0.022,
      thick: (t) => 0.115 * Math.sin(Math.PI * t) });
    streak(f, i, -0.10, -0.24, -0.60, -0.56, 0.034, 0.005, MAT.RED, 1.6);
    streak(f, i, 0.24, -0.06, -0.24, -0.34, 0.024, 0.004, MAT.ORANGE, 1.4);
    embers(f, i, -0.36, -0.40, 0.40, 7, 71);
  },

  // 9 - buried. The blade is a blade again, but stretched along where it was going and
  //     sitting down at the left - a drawing of something that has hit the floor.
  (f, i) => {
    onSwing(f, i, { th: 3.30, hold: 0.34, px: -0.10, py: 0.02, s: 1.02, sx: 1.22, sy: 0.86, hands: false });
    streak(f, i, -0.44, -0.60, 0.10, -0.38, 0.052, 0.008, MAT.DARK, 1.8);
    embers(f, i, -0.88, -0.68, 0.28, 5, 79);
  },

  // 10 - the drag. Hanging straight down off the hands now, on the way round the bottom
  //      rather than back up the way it came - which is what you actually do with something
  //      this heavy, and is noticeably slower to change than anything in the drop was.
  (f, i) => {
    onSwing(f, i, { th: 4.55, hold: 0.24, px: -0.04, py: 0.20, s: 1.0, sx: 1.06 });
  },

  // 11 - coming back up the right, over-rotated past the rest pose so it settles rather
  //      than stopping dead.
  (f, i) => {
    onSwing(f, i, { th: 5.60, hold: 0.28, py: 0.06, s: 0.99, sy: 1.03 });
  },

  // 12 - rest, which is also where the real 3D blade takes back over.
  (f, i) => {
    onSwing(f, i, { th: 0.40, hold: 0.30, s: 1.0 });
  },
];

/** Bake every cel into its own mesh pair. Called once, at load. */
export function buildVolcanoFrames(gl) {
  return CELS.map((draw) => {
    const f = new FillBuilder(), i = new InkBuilder();
    draw(f, i);
    return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
  });
}
