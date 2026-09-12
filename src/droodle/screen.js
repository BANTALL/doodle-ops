// The impact frame.
//
// Six drawings, one per animation step, painted straight onto the HUD's 2D canvas - which
// is sized to the device's real pixels, so these are drawn at full resolution rather than
// blown up out of a texture.
//
// The sequence is built the way a hand-drawn one is: frame 0 is the hit, frame 1 is the
// same picture inverted (the trick every animator reaches for, because a single black
// frame reads as a bang and costs nothing), and from frame 2 on the burst is coming apart
// while a ring races out ahead of it and leaves the screen. Every frame is a *different*
// drawing - different spike count, different angles, a silhouette that never repeats -
// because the eye forgives a rough drawing and never forgives the same drawing twice.

import { Rng, clamp, TAU } from '../math.js';

const INK = '#1c1a24';
const PAPER = '#f6f3ea';
const FIRE = '#e8871f';
const HOT = '#ffe9a8';

export const IMPACT_FRAMES = 6;
export const MUZZLE_FRAMES = 3;

// ---------------------------------------------------------------- pen

/** A ragged closed shape, drawn with curves so it reads as ink and not as a polygon. */
function blobPath(g, cx, cy, r, rng, { n = 22, ragged = 0.16, lobes = 3, lobeAmt = 0.18, phase = 0 } = {}) {
  const pts = [];
  const w1 = rng.range(0, TAU), w2 = rng.range(0, TAU);
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * TAU;
    const bulge = 1 + lobeAmt * Math.sin(a * lobes + w1) + lobeAmt * 0.5 * Math.sin(a * (lobes * 2 + 1) + w2);
    const rr = r * bulge * (1 + rng.range(-ragged, ragged));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  g.beginPath();
  const mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
  const m0 = mid(n - 1, 0);
  g.moveTo(m0[0], m0[1]);
  for (let k = 0; k < n; k++) {
    const m1 = mid(k, (k + 1) % n);
    g.quadraticCurveTo(pts[k][0], pts[k][1], m1[0], m1[1]);
  }
  g.closePath();
}

/** The starburst. Alternating long and short points, none of them the same length. */
function burstPath(g, cx, cy, rOut, rIn, spikes, rng, skew = 0.55) {
  g.beginPath();
  for (let k = 0; k < spikes * 2; k++) {
    const a = (k / (spikes * 2)) * TAU + rng.range(-0.06, 0.06);
    const out = k % 2 === 0;
    const r = out ? rOut * rng.range(1 - skew * 0.45, 1.0) : rIn * rng.range(0.72, 1.22);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/** A ring with a chewed edge, as a filled band. */
function ringPath(g, cx, cy, r, w, rng, n = 40) {
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * TAU;
    const rr = (r + w * 0.5) * (1 + rng.range(-0.035, 0.035));
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  for (let k = n; k >= 0; k--) {
    const a = (k / n) * TAU;
    const rr = Math.max(1, (r - w * 0.5) * (1 + rng.range(-0.045, 0.045)));
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Lines shooting away from the middle. The cheapest way to draw "outward, fast". */
function speedLines(g, cx, cy, rng, { count = 26, r0, r1, color = INK, width = 3, taper = true }) {
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    const a = (k / count) * TAU + rng.range(-0.08, 0.08);
    const s = r0 * rng.range(0.75, 1.15);
    const e = r1 * rng.range(0.7, 1.25);
    g.lineWidth = width * (taper ? rng.range(0.4, 1.4) : 1);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
    const bow = rng.range(-0.09, 0.09);
    const mr = (s + e) * 0.5;
    g.quadraticCurveTo(cx + Math.cos(a + bow) * mr, cy + Math.sin(a + bow) * mr,
      cx + Math.cos(a) * e, cy + Math.sin(a) * e);
    g.stroke();
  }
}

/** Ink flecks - the grit thrown out of the middle of the picture. */
function flecks(g, cx, cy, rng, { count = 30, r0, r1, color = INK, size = 5 }) {
  g.fillStyle = color;
  for (let k = 0; k < count; k++) {
    const a = rng.range(0, TAU);
    const d = r0 + (r1 - r0) * rng.range(0, 1) ** 0.6;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const s = size * rng.range(0.35, 1.4);
    g.save();
    g.translate(x, y);
    g.rotate(rng.range(0, TAU));
    g.beginPath();
    g.moveTo(-s, 0);
    g.quadraticCurveTo(0, -s * rng.range(0.4, 1.1), s * rng.range(1, 2.4), 0);
    g.quadraticCurveTo(0, s * rng.range(0.4, 1.1), -s, 0);
    g.fill();
    g.restore();
  }
}

/** Long curved smears, the drawn equivalent of motion blur. */
function smears(g, cx, cy, rng, { count = 7, r0, r1, color = INK, width = 10 }) {
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    const a = rng.range(0, TAU);
    const sweep = rng.range(0.25, 0.9) * (rng.next() < 0.5 ? -1 : 1);
    const r = rng.range(r0, r1);
    g.lineWidth = width * rng.range(0.3, 1.1);
    g.beginPath();
    const steps = 8;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const aa = a + sweep * u;
      const rr = r * (1 + u * rng.range(0.15, 0.5));
      const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr;
      if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Pencil hatching in a corner, for the frames where the page itself is under strain. */
function hatchCorner(g, x, y, w, h, rng, color, step = 9) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  for (let i = -h; i < w; i += step) {
    g.beginPath();
    g.moveTo(x + i + rng.range(-2, 2), y);
    g.lineTo(x + i + h + rng.range(-2, 2), y + h);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------- the sequence

export class ScreenFX {
  constructor() {
    this.impact = null;      // { frame0, x, y, seed }
    this.muzzle = null;      // { frame0, x, y, seed }
  }

  clear() { this.impact = null; this.muzzle = null; }

  /** The big one: six frames, fired when the charged shot goes off. */
  hit(frame, x, y) {
    this.impact = { frame0: frame, x, y, seed: (Math.random() * 1e6) | 0 };
  }

  /** The small one: three frames of fire licking in at the muzzle when a round leaves. */
  blast(frame, x, y) {
    this.muzzle = { frame0: frame, x, y, seed: (Math.random() * 1e6) | 0 };
  }

  /**
   * Called after the HUD has drawn itself. The context is already scaled by the device
   * pixel ratio, so everything below is in CSS pixels and comes out at native resolution.
   */
  draw(hud, animFrame) {
    if (this.muzzle) this._drawMuzzle(hud, animFrame);
    if (this.impact) this._drawImpact(hud, animFrame);
  }

  _drawMuzzle(hud, animFrame) {
    const k = animFrame - this.muzzle.frame0;
    if (k < 0 || k >= MUZZLE_FRAMES) { if (k >= MUZZLE_FRAMES) this.muzzle = null; return; }
    const g = hud.ctx;
    const W = hud.w, H = hud.h;
    const rng = new Rng(this.muzzle.seed + k * 977);
    const cx = this.muzzle.x, cy = this.muzzle.y;
    const diag = Math.hypot(W, H);
    const t = k / MUZZLE_FRAMES;

    g.save();
    // Small on purpose. The fireball at the mouth is drawn in 3D with the weapon; this is
    // only the flare that reaches the page, and a big one here blinds you every 0.92s.
    g.globalAlpha = (1 - t * 0.5) * 0.8;
    g.fillStyle = k === 0 ? HOT : FIRE;
    burstPath(g, cx, cy, diag * (0.048 + k * 0.024), diag * (0.017 + k * 0.010), 9 + k * 2, rng);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.6;
    g.lineJoin = 'round';
    g.stroke();
    // ...and a couple of licks thrown clear of it.
    g.globalAlpha = (1 - t) * 0.6;
    speedLines(g, cx, cy, rng, { count: 7 + k * 2, r0: diag * 0.045, r1: diag * (0.080 + k * 0.045), color: FIRE, width: 4 });
    flecks(g, cx, cy, rng, { count: 7, r0: diag * 0.04, r1: diag * (0.09 + k * 0.05), color: INK, size: 3 });
    g.restore();
  }

  _drawImpact(hud, animFrame) {
    const k = animFrame - this.impact.frame0;
    if (k < 0) return;
    if (k >= IMPACT_FRAMES) { this.impact = null; return; }

    const g = hud.ctx;
    const W = hud.w, H = hud.h;
    const cx = clamp(this.impact.x, W * 0.12, W * 0.88);
    const cy = clamp(this.impact.y, H * 0.12, H * 0.88);
    const diag = Math.hypot(W, H);
    const rng = new Rng(this.impact.seed + k * 7919);

    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';

    if (k === 0) {
      // The hit. The page goes white and something black is torn out of the middle of it.
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);
      g.fillStyle = INK;
      burstPath(g, cx, cy, diag * 0.62, diag * 0.20, 17, rng, 0.7);
      g.fill();
      blobPath(g, cx, cy, diag * 0.15, rng, { n: 18, ragged: 0.22, lobes: 4, lobeAmt: 0.3 });
      g.fill();
      speedLines(g, cx, cy, rng, { count: 34, r0: diag * 0.30, r1: diag * 1.05, color: INK, width: 7 });
      flecks(g, cx, cy, rng, { count: 40, r0: diag * 0.18, r1: diag * 0.75, color: INK, size: 7 });
      // A hole of white punched back through the middle, so it isn't a solid blot.
      g.fillStyle = PAPER;
      blobPath(g, cx, cy, diag * 0.055, rng, { n: 12, ragged: 0.3, lobes: 3, lobeAmt: 0.35 });
      g.fill();
    } else if (k === 1) {
      // Inverted. One frame, and it does most of the work.
      g.fillStyle = INK;
      g.fillRect(0, 0, W, H);
      g.fillStyle = PAPER;
      burstPath(g, cx, cy, diag * 0.85, diag * 0.30, 21, rng, 0.6);
      g.fill();
      g.fillStyle = HOT;
      burstPath(g, cx, cy, diag * 0.42, diag * 0.15, 13, rng, 0.5);
      g.fill();
      g.fillStyle = PAPER;
      blobPath(g, cx, cy, diag * 0.13, rng, { n: 16, ragged: 0.2, lobes: 3, lobeAmt: 0.25 });
      g.fill();
      speedLines(g, cx, cy, rng, { count: 30, r0: diag * 0.40, r1: diag * 1.2, color: PAPER, width: 9 });
    } else if (k === 2) {
      // The page comes back and the fireball is on it, already breaking up.
      g.globalAlpha = 0.92;
      g.fillStyle = FIRE;
      blobPath(g, cx, cy, diag * 0.40, rng, { n: 24, ragged: 0.20, lobes: 3, lobeAmt: 0.26 });
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 5; g.stroke();
      g.fillStyle = HOT;
      blobPath(g, cx, cy, diag * 0.24, rng, { n: 18, ragged: 0.24, lobes: 4, lobeAmt: 0.3 });
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = PAPER;
      ringPath(g, cx, cy, diag * 0.60, diag * 0.045, rng);
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 3.2; g.stroke();
      smears(g, cx, cy, rng, { count: 9, r0: diag * 0.30, r1: diag * 0.62, color: INK, width: 12 });
      flecks(g, cx, cy, rng, { count: 34, r0: diag * 0.35, r1: diag * 0.95, color: INK, size: 6 });
    } else if (k === 3) {
      // The ring outruns everything.
      g.globalAlpha = 0.8;
      g.fillStyle = FIRE;
      blobPath(g, cx, cy, diag * 0.26, rng, { n: 20, ragged: 0.30, lobes: 5, lobeAmt: 0.34 });
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 3.6; g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = PAPER;
      ringPath(g, cx, cy, diag * 0.92, diag * 0.030, rng);
      g.fill();
      g.strokeStyle = INK; g.lineWidth = 2.6; g.stroke();
      smears(g, cx, cy, rng, { count: 7, r0: diag * 0.45, r1: diag * 0.85, color: INK, width: 9 });
      flecks(g, cx, cy, rng, { count: 30, r0: diag * 0.45, r1: diag * 1.05, color: INK, size: 5 });
      hatchCorner(g, 0, 0, W * 0.20, H * 0.28, rng, 'rgba(28,26,36,0.35)');
      hatchCorner(g, W * 0.80, H * 0.72, W * 0.20, H * 0.28, rng, 'rgba(28,26,36,0.35)');
    } else if (k === 4) {
      g.globalAlpha = 0.62;
      g.fillStyle = 'rgba(60,56,66,0.55)';
      for (let s = 0; s < 5; s++) {
        const a = rng.range(0, TAU), d = diag * rng.range(0.10, 0.34);
        blobPath(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, diag * rng.range(0.05, 0.11), rng,
          { n: 14, ragged: 0.3, lobes: 3, lobeAmt: 0.3 });
        g.fill();
      }
      g.globalAlpha = 0.85;
      g.strokeStyle = INK; g.lineWidth = 2.2;
      ringPath(g, cx, cy, diag * 1.20, diag * 0.020, rng);
      g.stroke();
      flecks(g, cx, cy, rng, { count: 22, r0: diag * 0.30, r1: diag * 1.0, color: 'rgba(28,26,36,0.7)', size: 4 });
    } else {
      // What is left on the page a twelfth of a second later.
      g.globalAlpha = 0.4;
      flecks(g, cx, cy, rng, { count: 16, r0: diag * 0.15, r1: diag * 0.8, color: 'rgba(28,26,36,0.6)', size: 3.5 });
      g.globalAlpha = 0.28;
      g.fillStyle = 'rgba(70,64,74,0.5)';
      for (let s = 0; s < 3; s++) {
        const a = rng.range(0, TAU), d = diag * rng.range(0.05, 0.25);
        blobPath(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, diag * rng.range(0.06, 0.13), rng,
          { n: 12, ragged: 0.32, lobes: 3, lobeAmt: 0.3 });
        g.fill();
      }
    }

    g.restore();
  }
}
