// The twelve drawn frames of an axe swing, baked once at load and played one per
// animation step.
//
// This is the thing a velocity stretch cannot fake. A smear frame is not the object seen
// through a bad lens - it is a *different drawing*, made by a person who decided that on
// this frame the axe is not an axe any more. Frames 4 to 8 here have no haft, no head and
// no hand in them; they are crescents of ink with ragged edges, and one of them is two
// crescents with a hole where the axe should be. That reads as speed. Scaling the same
// mesh never will, because the eye recognises the shape and knows it is the same object.
//
// The swing goes right to left across the screen. Frames 1-3 wind up and commit, 4-8 are
// the cut, 9-12 recover and hand back to the real 3D axe.
//
// Everything lives in a flat XY card that the viewmodel parks in front of the camera, so
// x is right, y is up, and one unit is about half a metre at the card's depth.

import { FillBuilder, InkBuilder, pushShape } from './geom.js';
import { MAT } from './renderer.js';

export const AXE_FRAMES = 12;
export const AXE_THROW_FRAMES = 12;
// The cel the axe actually leaves the hand on. Frames after this one have no axe in them,
// because by then there is a real one out in the world.
export const AXE_THROW_RELEASE = 6;

// ---------------------------------------------------------------- primitives

/** Deterministic noise, so the ragged edges are drawn the same way every match. */
function rand(seed) {
  let s = seed * 16807 % 2147483647;
  return () => ((s = s * 16807 % 2147483647) / 2147483647) * 2 - 1;
}

/**
 * A ring/ribbon between two point runs: filled as a strip, outlined only along its two
 * long edges. Doing it this way instead of pushing each quad as its own shape is what
 * keeps a smear looking like one swept mark rather than a ladder of boxes.
 */
function pushStrip(f, i, outer, inner, mat, iw, thickness = 0.02) {
  const half = thickness * 0.5;
  for (let k = 0; k < outer.length - 1; k++) {
    const a = outer[k], b = outer[k + 1], c = inner[k + 1], d = inner[k];
    for (const z of [half, -half]) {
      const nz = z > 0 ? 1 : -1;
      const base = f.n;
      const quad = nz > 0 ? [a, b, c, d] : [a, d, c, b];
      for (const p of quad) f.vertex(p[0], p[1], z, 0, 0, nz, p[0], p[1], mat);
      f.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const outline = outer.map((p) => [p[0], p[1], half]);
  const back = inner.slice().reverse().map((p) => [p[0], p[1], half]);
  i.polyline(outline, iw);
  i.polyline(back, iw);
  i.edge(outline[outline.length - 1], back[0], iw);
  i.edge(back[back.length - 1], outline[0], iw);
}

/**
 * An arc of ink swept about (cx, cy). `thick(t)` gives the band's width along the sweep and
 * `rag(t)` pushes the outer edge in and out, which is what stops a smear reading as a
 * clean geometric ring.
 */
function arc(f, i, { cx, cy, r, a0, a1, thick, steps = 10, mat = MAT.METAL, iw = 2.2, seed = 7, rag = 0.03 }) {
  const nz = rand(seed);
  const outer = [], inner = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const a = a0 + (a1 - a0) * t;
    const th = thick(t);
    if (th <= 0.001) continue;
    const ca = Math.cos(a), sa = Math.sin(a);
    const jo = nz() * rag, ji = nz() * rag * 0.6;
    outer.push([cx + ca * (r + th * 0.5 + jo), cy + sa * (r + th * 0.5 + jo)]);
    inner.push([cx + ca * (r - th * 0.5 + ji), cy + sa * (r - th * 0.5 + ji)]);
  }
  if (outer.length > 1) pushStrip(f, i, outer, inner, mat, iw);
}

/** A tapered sliver - the flick lines that trail off a fast mark. */
function streak(f, i, x0, y0, x1, y1, w0, w1, mat = MAT.METAL, iw = 1.8) {
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  pushShape(f, i, [
    [x0 + nx * w0, y0 + ny * w0],
    [x1 + nx * w1, y1 + ny * w1],
    [x1 - nx * w1, y1 - ny * w1],
    [x0 - nx * w0, y0 - ny * w0],
  ], mat, iw);
}

// Where the hands are. Every pose and every smear in the sheet is measured from this one
// point, which is what keeps the twelve frames reading as one continuous swing instead of
// twelve drawings that happen to be in sequence.
const PIVOT = [0.10, -0.62];
const ARC_R = 0.88;          // how far the head travels from the hands

/**
 * The axe posed on the swing, at angle `th` around the pivot. Angles run anticlockwise
 * from screen-right, so the cut goes from a small angle to a large one - right to left.
 * `hold` is how far out along the haft the drawing sits, and px/py shove the pivot itself
 * for the follow-through frames, where the whole body has moved.
 */
function onSwing(f, i, { th, hold = 0.45, px = 0, py = 0, ...rest }) {
  axeAt(f, i, {
    x: PIVOT[0] + px + Math.cos(th) * hold,
    y: PIVOT[1] + py + Math.sin(th) * hold,
    a: th - Math.PI / 2,        // local +Y runs out along the haft, away from the hands
    ...rest,
  });
}

/** An arc of the swing, struck about the same pivot the axe turns around. */
function swingArc(f, i, opts) {
  arc(f, i, { cx: PIVOT[0], cy: PIVOT[1], r: ARC_R, ...opts });
}

/**
 * The axe itself, as a drawing. `a` rotates it, `sx`/`sy` squash and stretch it, which is
 * how the recovery frames overshoot without becoming a different object.
 */
function axeAt(f, i, { x, y, a, s = 1, sx = 1, sy = 1, hand = true, iw = 2.3 }) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const put = (poly, mat, w) => pushShape(f, i, poly.map(([px, py]) => {
    const qx = px * sx * s, qy = py * sy * s;
    return [x + qx * ca - qy * sa, y + qx * sa + qy * ca];
  }), mat, w);

  put([[-0.038, -0.44], [0.038, -0.44], [0.038, 0.09], [-0.038, 0.09]], MAT.CRATE, iw);          // haft
  put([[-0.060, -0.50], [0.060, -0.50], [0.060, -0.42], [-0.060, -0.42]], MAT.DARK, iw * 0.8);   // pommel
  put([[-0.078, 0.02], [0.078, 0.02], [0.078, 0.16], [-0.078, 0.16]], MAT.DARK, iw * 0.85);      // collar
  put([[-0.115, 0.13], [0.085, 0.05], [0.305, 0.14], [0.335, 0.31], [0.165, 0.42], [-0.095, 0.33]], MAT.METAL, iw); // head
  put([[-0.235, 0.17], [-0.100, 0.15], [-0.100, 0.31], [-0.225, 0.29]], MAT.METAL, iw * 0.9);    // poll
  if (hand) {
    put([[-0.10, -0.28], [0.10, -0.28], [0.13, -0.19], [0.08, -0.10], [-0.08, -0.10], [-0.13, -0.19]], MAT.SKIN, iw * 0.95);
    put([[-0.11, -0.44], [0.11, -0.44], [0.11, -0.27], [-0.11, -0.27]], MAT.GREEN, iw * 0.9);    // cuff
  }
}

/** The hand on its own, for the frames after the axe has gone. */
function handAt(f, i, { x, y, a = 0, s = 1, open = false, iw = 2.2 }) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const put = (poly, mat, w) => pushShape(f, i, poly.map(([px, py]) => {
    const qx = px * s, qy = py * s;
    return [x + qx * ca - qy * sa, y + qx * sa + qy * ca];
  }), mat, w);
  put([[-0.11, -0.17], [0.11, -0.17], [0.11, 0.00], [-0.11, 0.00]], MAT.GREEN, iw * 0.9);   // cuff
  if (open) {
    // Fingers spread, the shape a hand makes a frame after it lets go of something.
    put([[-0.10, -0.02], [0.10, -0.02], [0.12, 0.07], [-0.12, 0.07]], MAT.SKIN, iw * 0.95);
    for (const [dx, dy, len] of [[-0.085, 0.06, 0.115], [-0.028, 0.06, 0.145], [0.030, 0.06, 0.140], [0.086, 0.05, 0.110]]) {
      put([[dx - 0.022, dy], [dx + 0.022, dy], [dx + 0.016, dy + len], [dx - 0.016, dy + len]], MAT.SKIN, iw * 0.8);
    }
  } else {
    put([[-0.10, -0.01], [0.10, -0.01], [0.13, 0.08], [0.08, 0.17], [-0.08, 0.17], [-0.13, 0.08]], MAT.SKIN, iw * 0.95);
  }
}

// ---------------------------------------------------------------- the cels

/**
 * Each entry draws one frame. They are written as drawings, not as a parameterised pose:
 * the point of the middle five is that no single transform of the axe produces them.
 */
const CELS = [
  // 1 - settle into the wind-up. Still plainly an axe, cocked back over the right shoulder.
  (f, i) => {
    onSwing(f, i, { th: 1.06, hold: 0.52, s: 1.0 });
  },

  // 2 - anticipation: pulled further back and drawn a touch larger, leaning out of frame.
  (f, i) => {
    onSwing(f, i, { th: 0.72, hold: 0.56, s: 1.08, sy: 1.05 });
    streak(f, i, 0.92, -0.10, 1.14, 0.14, 0.020, 0.004, MAT.METAL, 1.5);
  },

  // 3 - committed. The head has begun to pull ahead of the haft and grown a short tail.
  (f, i) => {
    onSwing(f, i, { th: 1.34, hold: 0.52, s: 1.04, sx: 1.12, sy: 0.94 });
    swingArc(f, i, { a0: 1.08, a1: 1.54, steps: 9, seed: 3, rag: 0.012,
      thick: (t) => 0.075 * Math.sin(Math.PI * t * 0.7) });
  },

  // 4 - the axe stops being an axe. A thick crescent leading the swing, one stub of haft
  //     left behind it, and the hand smeared into a streak rather than drawn.
  (f, i) => {
    swingArc(f, i, { a0: 0.90, a1: 1.90, steps: 16, seed: 11, rag: 0.022,
      thick: (t) => 0.145 * Math.sin(Math.PI * (0.18 + t * 0.78)) });
    streak(f, i, 0.52, -0.44, 0.86, -0.14, 0.055, 0.012, MAT.CRATE, 2.0);      // haft, half gone
    streak(f, i, 0.34, -0.60, 0.62, -0.44, 0.070, 0.020, MAT.GREEN, 1.9);      // sleeve, smeared
    streak(f, i, 0.30, 0.30, 0.62, 0.44, 0.026, 0.004, MAT.METAL, 1.5);
  },

  // 5 - fastest. One long crescent right across the view, thick in the middle and ragged
  //     on both edges. Nothing here is the axe; it is the mark the axe made.
  (f, i) => {
    swingArc(f, i, { a0: 0.76, a1: 2.48, steps: 26, seed: 23, rag: 0.026,
      thick: (t) => 0.175 * Math.sin(Math.PI * t) ** 0.65 });
    streak(f, i, 0.62, -0.44, 0.98, -0.22, 0.048, 0.006, MAT.METAL, 1.6);
    streak(f, i, 0.44, -0.60, 0.76, -0.50, 0.036, 0.006, MAT.CRATE, 1.6);
  },

  // 6 - the break. The mark tears in two with a hole where the weapon ought to be, which
  //     is the frame that sells the speed: for one twelfth of a second there is no object.
  (f, i) => {
    swingArc(f, i, { a0: 1.72, a1: 2.64, steps: 14, seed: 31, rag: 0.024,
      thick: (t) => 0.150 * Math.sin(Math.PI * t) });
    swingArc(f, i, { a0: 0.70, a1: 1.32, steps: 10, seed: 37, rag: 0.020,
      thick: (t) => 0.085 * Math.sin(Math.PI * t) });
    streak(f, i, 0.66, -0.50, 1.00, -0.30, 0.040, 0.005, MAT.METAL, 1.6);
    streak(f, i, -0.62, -0.26, -0.86, -0.40, 0.024, 0.004, MAT.METAL, 1.4);
  },

  // 7 - thinning out on the left, with flick lines still catching up from the right.
  (f, i) => {
    swingArc(f, i, { a0: 2.04, a1: 3.04, steps: 16, seed: 43, rag: 0.018,
      thick: (t) => 0.095 * Math.sin(Math.PI * t) });
    streak(f, i, 0.10, 0.24, 0.52, 0.12, 0.030, 0.004, MAT.METAL, 1.5);
    streak(f, i, 0.34, -0.06, 0.74, -0.20, 0.022, 0.004, MAT.METAL, 1.4);
    streak(f, i, -0.30, -0.44, 0.10, -0.56, 0.026, 0.004, MAT.CRATE, 1.5);
  },

  // 8 - reassembling on the left, stretched along the direction it was travelling: an axe
  //     again, but not yet a shape you would draw standing still.
  (f, i) => {
    onSwing(f, i, { th: 2.86, hold: 0.54, px: -0.20, py: 0.30, s: 1.02, sx: 1.30, sy: 0.80, hand: false });
    streak(f, i, -0.16, -0.10, 0.44, -0.30, 0.055, 0.006, MAT.METAL, 1.8);
    streak(f, i, -0.40, 0.20, 0.14, 0.06, 0.030, 0.005, MAT.CRATE, 1.6);
  },

  // 9 - full extension, over-rotated past where the arm can actually go.
  (f, i) => {
    onSwing(f, i, { th: 3.02, hold: 0.50, px: 0.02, py: 0.30, s: 1.0, sx: 1.10, sy: 0.94 });
  },

  // 10 - the weight drags it back toward centre.
  (f, i) => {
    onSwing(f, i, { th: 2.44, hold: 0.52, px: -0.12, py: 0.16, s: 0.98 });
  },

  // 11 - almost home, slightly past the rest pose so it settles rather than stops dead.
  (f, i) => {
    onSwing(f, i, { th: 1.84, hold: 0.52, px: -0.02, py: 0.06, s: 0.98, sy: 1.03 });
  },

  // 12 - the rest pose, which is also where the real 3D axe takes back over.
  (f, i) => {
    onSwing(f, i, { th: 1.00, hold: 0.52, s: 1.0 });
  },
];

/**
 * The throw. A different animation from the swing, not a variation on it: the axe goes back
 * over the shoulder, comes over the top, and *leaves*, which means it travels away from the
 * camera rather than across it. So the drawing shrinks toward the middle of the view instead
 * of sweeping to one side, and after frame six the hand is empty and stays empty - there is
 * a real axe out in the world by then, and two of them would be one too many.
 */
const THROW_CELS = [
  // 1 - the axe comes up. Same weapon, new intention.
  (f, i) => { onSwing(f, i, { th: 0.98, hold: 0.56, s: 1.06 }); },

  // 2 - back past the shoulder, drawn larger as it comes toward the camera on the way back.
  (f, i) => {
    onSwing(f, i, { th: 0.70, hold: 0.62, py: 0.10, s: 1.16, sy: 1.06 });
    streak(f, i, 0.98, -0.06, 1.20, 0.20, 0.022, 0.004, MAT.METAL, 1.5);
  },

  // 3 - deepest wind-up, coiled and half out of frame.
  (f, i) => {
    onSwing(f, i, { th: 0.44, hold: 0.66, py: 0.20, s: 1.24, sx: 1.06 });
    streak(f, i, 0.86, 0.24, 1.16, 0.46, 0.026, 0.004, MAT.METAL, 1.5);
  },

  // 4 - the snap. It comes over the top and starts to stop being an axe.
  (f, i) => {
    onSwing(f, i, { th: 1.42, hold: 0.60, py: 0.16, s: 1.02, sx: 1.24, sy: 0.86 });
    swingArc(f, i, { a0: 0.52, a1: 1.34, steps: 12, seed: 61, rag: 0.022,
      thick: (t) => 0.135 * Math.sin(Math.PI * t) });
  },

  // 5 - gone from the hand's frame of reference: a mark heading up and away, with the arm
  //     still following it. Nothing here is an axe.
  (f, i) => {
    swingArc(f, i, { a0: 1.16, a1: 2.06, steps: 14, seed: 67, rag: 0.03,
      thick: (t) => 0.155 * Math.sin(Math.PI * t) });
    streak(f, i, 0.22, -0.34, 0.10, 0.42, 0.075, 0.014, MAT.METAL, 1.9);
    streak(f, i, 0.44, -0.52, 0.30, -0.14, 0.060, 0.016, MAT.CRATE, 1.8);
    handAt(f, i, { x: 0.24, y: -0.50, a: -0.55, s: 1.02 });
  },

  // 6 - release. The axe is a small shape already well up the view and shrinking, with the
  //     hand open under it. This is the last frame that has an axe in it.
  (f, i) => {
    axeAt(f, i, { x: 0.02, y: 0.34, a: 1.30, s: 0.56, sx: 1.20, sy: 0.86, hand: false });
    streak(f, i, 0.20, -0.20, 0.04, 0.26, 0.055, 0.012, MAT.METAL, 1.7);
    streak(f, i, 0.34, -0.34, 0.16, 0.06, 0.030, 0.006, MAT.CRATE, 1.5);
    handAt(f, i, { x: 0.20, y: -0.44, a: -0.30, s: 1.04, open: true });
  },

  // 7 - empty, at the top of the follow-through, with the lines it left behind.
  (f, i) => {
    handAt(f, i, { x: 0.12, y: -0.34, a: -0.12, s: 1.06, open: true });
    streak(f, i, 0.06, 0.10, -0.02, 0.52, 0.020, 0.004, MAT.METAL, 1.4);
    streak(f, i, 0.20, 0.04, 0.14, 0.40, 0.016, 0.004, MAT.METAL, 1.3);
    streak(f, i, -0.08, 0.06, -0.16, 0.38, 0.014, 0.004, MAT.METAL, 1.3);
  },

  // 8-12 - the arm comes down empty and settles. It lands where the 3D empty hand takes
  // over, over on the right, so the handover at the end of the sheet doesn't jump.
  (f, i) => { handAt(f, i, { x: 0.22, y: -0.30, a: 0.10, s: 1.04, open: true }); },
  (f, i) => { handAt(f, i, { x: 0.32, y: -0.38, a: 0.24, s: 1.02, open: true }); },
  (f, i) => { handAt(f, i, { x: 0.40, y: -0.44, a: 0.30, s: 1.0 }); },
  (f, i) => { handAt(f, i, { x: 0.43, y: -0.40, a: 0.26, s: 1.0 }); },
  (f, i) => { handAt(f, i, { x: 0.42, y: -0.42, a: 0.28, s: 1.0 }); },
];

function bakeCels(gl, cels) {
  return cels.map((draw) => {
    const f = new FillBuilder(), i = new InkBuilder();
    draw(f, i);
    return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
  });
}

/** Bake every cel into its own mesh pair. Called once, at load. */
export function buildAxeFrames(gl) { return bakeCels(gl, CELS); }
export function buildAxeThrowFrames(gl) { return bakeCels(gl, THROW_CELS); }
