// Twelve hand-drawn frames of a knife swing, played one per animation step.
//
// This is what a smear frame actually is: frame 5 is not frame 4 stretched, it is a
// different drawing. The blade grows a jagged trailing edge, loses its taper, runs off
// the side of the view and stops being recognisable as a knife for three frames, then
// reassembles on the other side. Scaling one mesh around can never do that - it always
// looks like the same object seen through a bad lens.

import { FillBuilder, InkBuilder, ribbon } from './geom.js';
import { MAT } from './renderer.js';
import { TAU } from './math.js';

export const SWING_FRAME_COUNT = 12;
export const SWING_FPS = 12;
export const SWING_DURATION = SWING_FRAME_COUNT / SWING_FPS;   // exactly one second

/**
 * ang    blade direction in the view plane (rad; 0 = right, +ve = up)
 * len/w  blade length and half-width at the guard
 * curve  how far the spine bows off straight
 * spike  amplitude of the jagged trailing edge - 0 on readable frames, large on smears
 * seed   shifts where the jags fall, so no two smear frames share an outline
 * px/py  where the shape sits in the view, in metres at the cut-out plane
 * ring   [x, y, radius] of the hand loop, or null while the hand is buried in the smear
 * grip   length of the handle behind the guard
 */
const FRAMES = [
  // --- wind up (2 frames): a readable knife, cocked back and high on the right
  { ang: 1.05, len: 0.40, w: 0.032, curve: 0.010, spike: 0.000, seed: 0.0, px: 0.235, py: -0.150, grip: 0.13, ring: [0.295, -0.212, 0.048] },
  { ang: 1.52, len: 0.42, w: 0.033, curve: 0.018, spike: 0.000, seed: 3.1, px: 0.220, py: -0.095, grip: 0.13, ring: [0.265, -0.162, 0.048] },

  // --- the cut: elongating, edge starting to break up
  { ang: 0.92, len: 0.52, w: 0.038, curve: 0.045, spike: 0.010, seed: 4.4, px: 0.145, py: -0.045, grip: 0.12, ring: [0.212, -0.124, 0.046] },
  { ang: 0.34, len: 0.70, w: 0.048, curve: 0.075, spike: 0.026, seed: 5.9, px: 0.015, py: -0.012, grip: 0.10, ring: [0.092, -0.070, 0.043] },

  // --- three frames that are not a knife: a jagged streak running off the view
  { ang: -0.06, len: 0.92, w: 0.036, curve: 0.100, spike: 0.105, seed: 7.3, px: -0.145, py: -0.010, grip: 0.07, ring: null },
  { ang: -0.34, len: 1.00, w: 0.042, curve: 0.120, spike: 0.135, seed: 8.8, px: -0.240, py: -0.045, grip: 0.05, ring: null },
  { ang: -0.66, len: 0.84, w: 0.034, curve: 0.088, spike: 0.092, seed: 10.2, px: -0.235, py: -0.095, grip: 0.06, ring: null },

  // --- reassembling low and left
  { ang: -0.98, len: 0.60, w: 0.042, curve: 0.048, spike: 0.016, seed: 11.6, px: -0.175, py: -0.135, grip: 0.10, ring: [-0.215, -0.085, 0.045] },
  { ang: -1.24, len: 0.48, w: 0.036, curve: 0.022, spike: 0.003, seed: 13.0, px: -0.100, py: -0.160, grip: 0.12, ring: [-0.138, -0.112, 0.047] },

  // --- recovery back toward the resting hold
  { ang: -1.05, len: 0.43, w: 0.034, curve: 0.014, spike: 0.000, seed: 14.5, px: 0.020, py: -0.170, grip: 0.13, ring: [-0.016, -0.120, 0.048] },
  { ang: -0.45, len: 0.41, w: 0.033, curve: 0.010, spike: 0.000, seed: 15.9, px: 0.150, py: -0.160, grip: 0.13, ring: [0.116, -0.118, 0.048] },
  { ang: -0.05, len: 0.40, w: 0.032, curve: 0.008, spike: 0.000, seed: 17.2, px: 0.214, py: -0.148, grip: 0.13, ring: [0.188, -0.112, 0.048] },
];

/** Blade silhouette: a tapered spine, with spikes thrown only onto the trailing edge. */
function bladeEdges(f) {
  const N = 18;
  const top = [], bot = [];
  const c = Math.cos(f.ang), s = Math.sin(f.ang);
  const nx = -s, ny = c;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const bow = Math.sin(t * Math.PI) * f.curve;
    const cx = f.px + c * f.len * t + nx * bow;
    const cy = f.py + s * f.len * t + ny * bow;
    // Roughly parallel-sided, then tapering to a point over the last third - a blade
    // profile rather than a cone. Smear frames hold their width for longer, which is a
    // large part of why they stop reading as a knife.
    const taper = Math.min(1, (1 - t) * (f.spike > 0.02 ? 3.6 : 2.6));
    const w = f.w * taper + 0.0030;
    // Two harmonics, so the trailing edge is a row of uneven teeth rather than a wave.
    const jag = f.spike * Math.sin(t * Math.PI)
      * (Math.sin(t * 21.0 + f.seed) * 0.68 + Math.sin(t * 9.0 + f.seed * 1.7) * 0.42);
    top.push([cx + nx * (w + Math.max(0, jag)), cy + ny * (w + Math.max(0, jag))]);
    bot.push([cx - nx * (w + Math.max(0, -jag)), cy - ny * (w + Math.max(0, -jag))]);
  }
  return { top, bot };
}

/** Handle: a stubby bar running back from the guard. */
function gripEdges(f) {
  const N = 4;
  const top = [], bot = [];
  const c = Math.cos(f.ang), s = Math.sin(f.ang);
  const nx = -s, ny = c;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cx = f.px - c * f.grip * t;
    const cy = f.py - s * f.grip * t;
    const w = 0.026 + 0.010 * Math.sin(t * Math.PI);
    top.push([cx + nx * w, cy + ny * w]);
    bot.push([cx - nx * w, cy - ny * w]);
  }
  return { top, bot };
}

/** Hand loop, as an annulus between an outer and an inner circle. */
function ringEdges(cx, cy, r) {
  const N = 20;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    top.push([cx + ca * r, cy + sa * r * 0.92]);
    bot.push([cx + ca * (r * 0.62), cy + sa * (r * 0.62) * 0.92]);
  }
  return { top, bot };
}

/** Bake all twelve frames. Each is one mesh pair, drawn flat in the view plane. */
export function buildSwingFrames(gl) {
  return FRAMES.map((f) => {
    const fb = new FillBuilder(), ib = new InkBuilder();
    const blade = bladeEdges(f);
    ribbon(fb, ib, blade.top, blade.bot, MAT.METAL, 2.6, 0.018);
    const grip = gripEdges(f);
    ribbon(fb, ib, grip.top, grip.bot, MAT.CRATE, 2.4, 0.022);
    if (f.ring) {
      const ring = ringEdges(f.ring[0], f.ring[1], f.ring[2]);
      ribbon(fb, ib, ring.top, ring.bot, MAT.SKIN, 2.4, 0.024);
    }
    return { fill: fb.toMesh(gl), ink: ib.toMesh(gl) };
  });
}

/** Depth the cut-out sits at in eye space. */
export const SWING_PLANE_Z = -0.52;
