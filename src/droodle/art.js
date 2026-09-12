// Every drawing the mod needs, baked once at boot.
//
// The rule the base game plays by is that a fast thing is a *different drawing*, not the
// same drawing scaled - twelve authored cels of an axe swing beat one stretched mesh,
// because the eye recognises a shape it has already seen and refuses to read it as speed.
// So the explosion here is eight cels with different silhouettes, the beam is four, and
// the fire trailing the round is three. They are generated rather than hand-plotted, but
// each one is struck from its own seed and then frozen, so it is a drawing that holds
// still between animation steps rather than noise that re-rolls every frame.

import { FillBuilder, InkBuilder, pushOrientedBox } from '../geom.js';
import { MAT } from '../renderer.js';
import { Rng, TAU } from '../math.js';

/**
 * A filled radial shape, fanned from its own centre and drawn on both sides. `pushShape`
 * in the base game fans from the first *vertex*, which is right for a crescent and wrong
 * for a blob: a lobed rim is star-shaped about the middle, not about a point on its edge.
 */
export function pushBlob(f, i, rim, mat, inkWidth = 2.2, z = 0, thickness = 0.012, ink = true) {
  const half = thickness * 0.5;
  for (const zz of [z + half, z - half]) {
    const nz = zz > z ? 1 : -1;
    const c = f.vertex(0, 0, zz, 0, 0, nz, 0, 0, mat);
    const base = f.n;
    for (const p of rim) f.vertex(p[0], p[1], zz, 0, 0, nz, p[0], p[1], mat);
    for (let k = 0; k < rim.length; k++) {
      const a = base + k, b = base + ((k + 1) % rim.length);
      if (nz > 0) f.i.push(c, a, b); else f.i.push(c, b, a);
    }
  }
  if (!ink) return;
  for (let k = 0; k < rim.length; k++) {
    const a = rim[k], b = rim[(k + 1) % rim.length];
    i.edge([a[0], a[1], z + half], [b[0], b[1], z + half], inkWidth);
  }
}

/** A flat quad strip between two rims - the band of a shock ring. */
function pushBand(f, i, inner, outer, mat, inkWidth, z, ink = true) {
  const n = inner.length;
  const base = f.n;
  for (let k = 0; k < n; k++) {
    f.vertex(inner[k][0], inner[k][1], z, 0, 0, 1, inner[k][0], inner[k][1], mat);
    f.vertex(outer[k][0], outer[k][1], z, 0, 0, 1, outer[k][0], outer[k][1], mat);
  }
  for (let k = 0; k < n; k++) {
    const a = base + k * 2, b = a + 1;
    const c = base + ((k + 1) % n) * 2, d = c + 1;
    f.i.push(a, b, d, a, d, c);
    f.i.push(a, d, b, a, c, d);   // back face, so the ring survives being seen from behind
  }
  if (!ink) return;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    i.edge([outer[k][0], outer[k][1], z], [outer[k2][0], outer[k2][1], z], inkWidth);
    i.edge([inner[k][0], inner[k][1], z], [inner[k2][0], inner[k2][1], z], inkWidth * 0.7);
  }
}

/**
 * A lobed rim. `lobes` gives it a few big bulges so it has a silhouette rather than a
 * circumference, and `ragged` chews the edge up on top of that.
 */
function lobedRim(rng, n, radius, ragged = 0.2, lobes = 3, lobeAmt = 0.22, phase = 0) {
  const pts = [];
  const w1 = rng.range(0, TAU), w2 = rng.range(0, TAU);
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * TAU;
    const bulge = 1 + lobeAmt * Math.sin(a * lobes + w1) + lobeAmt * 0.45 * Math.sin(a * (lobes * 2 + 1) + w2);
    const r = radius * bulge * (1 + rng.range(-ragged, ragged));
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

// ---------------------------------------------------------------- explosion cels

/**
 * Eight frames of a drawn explosion, played one per animation step.
 *
 * The shape of the sequence matters more than any single frame: a white-hot core that is
 * biggest on frame 0 and gone by frame 3, an orange body that keeps growing after the
 * core has died, spikes thrown out at angles that change frame to frame, and a shock ring
 * that outruns all of it and is the only thing left at the end. Growth is fast then slow,
 * so frames 0-2 cover most of the distance - which is what makes it read as a detonation
 * instead of an inflating balloon.
 */
export function buildExplosionCels(gl, count = 8, opts = {}) {
  const { seed = 7717, ragged = 1, spikes = 1 } = opts;
  const cels = [];
  for (let k = 0; k < count; k++) {
    const rng = new Rng(seed + k * 9173);
    const t = k / (count - 1);
    const f = new FillBuilder(), i = new InkBuilder();

    // Fast out, then coasting.
    const grow = 0.34 + 0.78 * (1 - (1 - t) ** 2.4);
    const chew = (0.10 + t * 0.26) * ragged;
    const fade = 1 - t * 0.15;

    // Smoke lobes, only once the fire has started to come apart. Drawn first so they sit
    // behind everything else.
    if (t > 0.35) {
      for (let s = 0; s < 4; s++) {
        const a = rng.range(0, TAU);
        const d = grow * rng.range(0.55, 0.95);
        const r = grow * rng.range(0.26, 0.42) * (0.5 + t);
        const rim = lobedRim(rng, 9, r, chew * 1.4, 2, 0.3)
          .map(([x, y]) => [x + Math.cos(a) * d, y + Math.sin(a) * d]);
        pushBlob(f, i, rim, MAT.DARK, 1.7, -0.030, 0.010);
      }
    }

    // The body of the fireball.
    pushBlob(f, i, lobedRim(rng, 20, grow * fade, chew, 3, 0.24), MAT.ORANGE, 2.6, -0.014, 0.016);
    // A yellow shoulder inside it, always smaller and always a different silhouette.
    pushBlob(f, i, lobedRim(rng, 16, grow * (0.74 - t * 0.30), chew * 0.8, 4, 0.20), MAT.WALL, 2.0, 0.0, 0.014);
    // White-hot core: biggest at the start, gone by the middle.
    if (t < 0.42) {
      const cr = grow * (0.46 - t * 0.90);
      if (cr > 0.02) pushBlob(f, i, lobedRim(rng, 12, cr, 0.09, 3, 0.12), MAT.LIGHT, 1.6, 0.014, 0.012);
    }

    // Spikes. Thrown at fresh angles every frame, which is most of why the sequence reads
    // as one violent thing rather than eight pictures of a ball.
    const nSpike = Math.round((9 - k * 0.7) * spikes);
    for (let s = 0; s < nSpike; s++) {
      const a = rng.range(0, TAU);
      const r0 = grow * rng.range(0.45, 0.80);
      const r1 = r0 + grow * rng.range(0.35, 1.05) * (0.45 + t * 0.9);
      const w = grow * rng.range(0.045, 0.115) * (1 - t * 0.5);
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
      const tri = [
        [ca * r0 + nx * w, sa * r0 + ny * w],
        [ca * r1, sa * r1],
        [ca * r0 - nx * w, sa * r0 - ny * w],
      ];
      pushBlob(f, i, tri, s % 3 === 0 ? MAT.WALL : MAT.ORANGE, 1.9, 0.006, 0.010);
    }

    // The ring, running ahead of the fire and outliving it.
    if (k >= 1) {
      const rr = 0.55 + 1.55 * ((k - 1) / Math.max(1, count - 2)) ** 0.62;
      const wgt = 0.075 * (1 - (k - 1) / count);
      const inner = lobedRim(rng, 22, rr - wgt, 0.045, 5, 0.05);
      const outer = lobedRim(rng, 22, rr + wgt, 0.055, 5, 0.05);
      pushBand(f, i, inner, outer, MAT.LIGHT, 2.1, 0.020);
    }

    cels.push({ fill: f.toMesh(gl), ink: i.toMesh(gl) });
  }
  return cels;
}

// ---------------------------------------------------------------- the round

/**
 * The round you can actually see: three crossed discs so it is a ball from any angle, a
 * ragged orange shell around a white core, and no sphere mesh anywhere - a drawn ball is
 * three circles, and that is what this is.
 */
export function buildBoltMesh(gl, seed = 4001) {
  const rng = new Rng(seed);
  const f = new FillBuilder(), i = new InkBuilder();
  const planes = [
    { map: (x, y) => [x, y, 0], nrm: [0, 0, 1] },
    { map: (x, y) => [x, 0, y], nrm: [0, 1, 0] },
    { map: (x, y) => [0, x, y], nrm: [1, 0, 0] },
  ];
  for (let p = 0; p < 3; p++) {
    const rim = lobedRim(rng, 14, 1.0, 0.075, 3, 0.10);
    const { map, nrm } = planes[p];
    const c = f.vertex(0, 0, 0, nrm[0], nrm[1], nrm[2], 0, 0, MAT.ORANGE);
    const base = f.n;
    for (const [x, y] of rim) {
      const v = map(x, y);
      f.vertex(v[0], v[1], v[2], nrm[0], nrm[1], nrm[2], x, y, MAT.ORANGE);
    }
    for (let k = 0; k < rim.length; k++) {
      const a = base + k, b = base + ((k + 1) % rim.length);
      f.i.push(c, a, b);
      f.i.push(c, b, a);
    }
    for (let k = 0; k < rim.length; k++) {
      const a = map(rim[k][0], rim[k][1]);
      const b = map(rim[(k + 1) % rim.length][0], rim[(k + 1) % rim.length][1]);
      i.edge(a, b, 2.4);
    }
    // Core, drawn a touch smaller and without ink so it stays a glow and not a second ball.
    const cr = 0.52;
    const c2 = f.vertex(0, 0, 0, nrm[0], nrm[1], nrm[2], 0, 0, MAT.LIGHT);
    const base2 = f.n;
    for (const [x, y] of rim) {
      const v = map(x * cr, y * cr);
      f.vertex(v[0], v[1], v[2], nrm[0], nrm[1], nrm[2], x, y, MAT.LIGHT);
    }
    for (let k = 0; k < rim.length; k++) {
      const a = base2 + k, b = base2 + ((k + 1) % rim.length);
      f.i.push(c2, a, b);
      f.i.push(c2, b, a);
    }
  }
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/**
 * Three fire tongues for the trail behind the round, cycled on the animation clock so the
 * flame boils instead of sitting there. Drawn pointing up +Y from the origin; the caller
 * aims that at wherever the round came from.
 */
export function buildFlameCels(gl, count = 3, seed = 5500) {
  const cels = [];
  for (let k = 0; k < count; k++) {
    const rng = new Rng(seed + k * 613);
    const f = new FillBuilder(), i = new InkBuilder();
    for (const [scale, mat, w] of [[1.0, MAT.ORANGE, 2.2], [0.62, MAT.WALL, 1.7], [0.30, MAT.LIGHT, 1.3]]) {
      const pts = [];
      const N = 9;
      // Up one side, back down the other, with a lick that flicks off to a random side.
      const lean = rng.range(-0.35, 0.35);
      for (let s = 0; s <= N; s++) {
        const u = s / N;
        const wid = Math.sin(Math.PI * u ** 0.62) * 0.42 * (1 + rng.range(-0.16, 0.16));
        pts.push([wid * scale + lean * u * u * 0.5, u * 1.35 * scale]);
      }
      for (let s = N; s >= 0; s--) {
        const u = s / N;
        const wid = Math.sin(Math.PI * u ** 0.62) * 0.42 * (1 + rng.range(-0.16, 0.16));
        pts.push([-wid * scale + lean * u * u * 0.5, u * 1.35 * scale]);
      }
      pushBlob(f, i, pts, mat, w, 0.004 * scale, 0.008, scale > 0.5);
    }
    cels.push({ fill: f.toMesh(gl), ink: i.toMesh(gl) });
  }
  return cels;
}

// ---------------------------------------------------------------- the beam

/**
 * Four takes on the beam, one metre long down -Z and one unit across, so a draw can scale
 * it to whatever it hit. Each is an octagonal prism whose edges are jittered differently,
 * and swapping between them on the animation clock is what makes the laser crackle rather
 * than sit on screen like a drawn cylinder.
 */
export function buildBeamCels(gl, count = 4, seed = 8800) {
  const cels = [];
  const SEGS = 14;
  const SIDES = 8;
  for (let k = 0; k < count; k++) {
    const rng = new Rng(seed + k * 1231);
    const f = new FillBuilder(), i = new InkBuilder();

    for (const [rad, mat, inkOn] of [[1.0, MAT.ORANGE, true], [0.60, MAT.WALL, false], [0.26, MAT.LIGHT, false]]) {
      const ring = [];
      for (let s = 0; s <= SEGS; s++) {
        const z = -s / SEGS;
        const swell = 1 + 0.16 * Math.sin(s * 1.9 + k) + rng.range(-0.10, 0.10);
        // Pinched at the muzzle, flared where it lands.
        const taper = 0.55 + 0.45 * (s / SEGS) ** 0.5;
        const r = rad * swell * taper;
        const pts = [];
        for (let a = 0; a < SIDES; a++) {
          const ang = (a / SIDES) * TAU;
          const rr = r * (1 + rng.range(-0.09, 0.09));
          pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr, z]);
        }
        ring.push(pts);
      }
      for (let s = 0; s < SEGS; s++) {
        for (let a = 0; a < SIDES; a++) {
          const a2 = (a + 1) % SIDES;
          const p0 = ring[s][a], p1 = ring[s][a2], p2 = ring[s + 1][a2], p3 = ring[s + 1][a];
          f.quad(p0, p1, p2, p3, [p0[0], p0[1], 0], mat, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          f.quad(p3, p2, p1, p0, [-p0[0], -p0[1], 0], mat, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
      }
      if (inkOn) {
        // Only four of the eight ridges get outlined, or the beam turns into a cage.
        for (let a = 0; a < SIDES; a += 2) {
          for (let s = 0; s < SEGS; s++) i.edge(ring[s][a], ring[s + 1][a], 2.3);
        }
      }
    }

    // Rings running down the beam, so the length reads as travel.
    for (let s = 2; s < SEGS; s += 3) {
      const z = -s / SEGS + rng.range(-0.02, 0.02);
      const r = 1.18 * (0.55 + 0.45 * (s / SEGS) ** 0.5);
      const rim = lobedRim(rng, 10, r, 0.10, 2, 0.10).map(([x, y]) => [x, y]);
      for (let a = 0; a < rim.length; a++) {
        const b = (a + 1) % rim.length;
        i.edge([rim[a][0], rim[a][1], z], [rim[b][0], rim[b][1], z], 1.8);
      }
    }

    cels.push({ fill: f.toMesh(gl), ink: i.toMesh(gl) });
  }
  return cels;
}

// ---------------------------------------------------------------- small stuff

/** Four-point sparkle for the energy being pulled into the mouth while it charges. */
export function buildSparkMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const r = k % 2 === 0 ? 1.0 : 0.20;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pushBlob(f, i, pts, MAT.LIGHT, 1.5, 0, 0.006);
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/**
 * The glint that runs across the weapon as it charges - a long thin lozenge, drawn flat,
 * swept across the model by the caller. This is the "kilapan" the passive is meant to
 * show: a highlight travelling over metal, not a light being turned on.
 */
export function buildGlintMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  const pts = [];
  const N = 10;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    pts.push([(u - 0.5) * 2.0, Math.sin(Math.PI * u) * 0.16]);
  }
  for (let k = N; k >= 0; k--) {
    const u = k / N;
    pts.push([(u - 0.5) * 2.0, -Math.sin(Math.PI * u) * 0.16]);
  }
  pushBlob(f, i, pts, MAT.LIGHT, 1.2, 0, 0.006, false);
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/** A ring that expands out of the muzzle while it charges, and off it when it fires. */
export function buildRingCels(gl, count = 3, seed = 3300) {
  const cels = [];
  for (let k = 0; k < count; k++) {
    const rng = new Rng(seed + k * 727);
    const f = new FillBuilder(), i = new InkBuilder();
    const inner = lobedRim(rng, 18, 0.86, 0.05, 3, 0.07);
    const outer = lobedRim(rng, 18, 1.0, 0.06, 3, 0.07);
    pushBand(f, i, inner, outer, MAT.LIGHT, 2.0, 0);
    cels.push({ fill: f.toMesh(gl), ink: i.toMesh(gl) });
  }
  return cels;
}

/** Ink-only forks of energy crawling over the weapon while it winds up. */
export function buildArcCels(gl, count = 4, seed = 2100) {
  const cels = [];
  for (let k = 0; k < count; k++) {
    const rng = new Rng(seed + k * 379);
    const f = new FillBuilder(), i = new InkBuilder();
    for (let b = 0; b < 3; b++) {
      let x = rng.range(-0.4, 0.4), y = rng.range(-0.4, 0.4), z = rng.range(0.1, 0.9);
      const pts = [[x, y, z]];
      for (let s = 0; s < 5; s++) {
        x += rng.range(-0.28, 0.28);
        y += rng.range(-0.28, 0.28);
        z -= rng.range(0.10, 0.24);
        pts.push([x, y, z]);
      }
      i.polyline(pts, 2.2);
      // A short fork off the middle.
      const m = pts[2];
      i.polyline([m, [m[0] + rng.range(-0.3, 0.3), m[1] + rng.range(-0.3, 0.3), m[2] - 0.2]], 1.6);
    }
    cels.push({ fill: f.toMesh(gl), ink: i.toMesh(gl) });
  }
  return cels;
}

/** Scorch mark left where the beam or a round touched a wall. */
export function buildScorchMesh(gl) {
  const rng = new Rng(6161);
  const f = new FillBuilder(), i = new InkBuilder();
  pushBlob(f, i, lobedRim(rng, 16, 1.0, 0.22, 3, 0.26), MAT.DARK, 2.2, 0, 0.006);
  pushBlob(f, i, lobedRim(rng, 12, 0.52, 0.20, 4, 0.20), MAT.ORANGE, 1.6, 0.004, 0.005, false);
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/** Burning debris thrown out of an explosion. */
export function buildEmberMesh(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  pushOrientedBox(f, i, { pos: [0, 0, 0], size: [1, 0.7, 0.16], mat: MAT.ORANGE, inkWidth: 2.0 });
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

export { lobedRim };
