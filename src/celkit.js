// The pieces every hand-drawn swing sheet is built out of.
//
// A smear frame is not a pose - it is a mark, and the marks are the same marks whichever
// weapon made them: a ragged band swept about the pivot the arms turn around, and tapered
// slivers flicking off the fast end of it. The hammer sheet and the greatblade sheet are
// completely different drawings that share nothing but these, which is exactly why they
// live here instead of in either one of them.
//
// Everything is authored in the flat XY card the viewmodel parks in front of the camera:
// x is right, y is up, and one unit is about half a metre at the card's depth.

import { pushShape } from './geom.js';
import { MAT } from './renderer.js';

/** Deterministic noise, so the ragged edges are drawn the same way every match. */
export function rand(seed) {
  let s = seed * 16807 % 2147483647;
  return () => ((s = s * 16807 % 2147483647) / 2147483647) * 2 - 1;
}

/**
 * A ring/ribbon between two point runs: filled as a strip, outlined only along its two
 * long edges. Doing it this way instead of pushing each quad as its own shape is what
 * keeps a smear looking like one swept mark rather than a ladder of boxes.
 */
export function pushStrip(f, i, outer, inner, mat, iw, thickness = 0.02) {
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
export function arc(f, i, { cx, cy, r, a0, a1, thick, steps = 10, mat = MAT.METAL, iw = 2.2, seed = 7, rag = 0.03 }) {
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
export function streak(f, i, x0, y0, x1, y1, w0, w1, mat = MAT.METAL, iw = 1.8) {
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
