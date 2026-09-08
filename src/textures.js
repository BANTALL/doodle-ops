// Every texture in the game is generated at boot: paper fibre, pencil hatching,
// crayon coverage, ink splats, muzzle starbursts. No binary assets, no network.

import { Rng, lerp, sat, TAU } from './math.js';

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d', { willReadFrequently: true }) };
}

// ---- tileable value noise -------------------------------------------------

function lattice(n, rng) {
  const a = new Float32Array(n * n);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
}

function vnoise(lat, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const at = (i, j) => lat[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
}

function fbm(lat, n, x, y, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(lat, n, x * f, y * f) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

// ---- textures -------------------------------------------------------------

/** Sketchbook paper: warm off-white, visible fibre, faint blotching. */
export function makePaperTexture(size = 512, seed = 7) {
  const rng = new Rng(seed);
  const lat = lattice(16, rng);
  const lat2 = lattice(64, rng);
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 16, v = (y / size) * 16;
      const blotch = fbm(lat, 16, u, v, 4);
      const fibre = vnoise(lat2, 64, (x / size) * 64, (y / size) * 64);
      const grain = rng.next();
      // Warm paper white, pushed around by large blotches and per-pixel tooth.
      let l = 0.955 + (blotch - 0.5) * 0.055 + (fibre - 0.5) * 0.05 + (grain - 0.5) * 0.035;
      l = sat(l);
      const i = (y * size + x) * 4;
      d[i] = Math.round(255 * l);
      d[i + 1] = Math.round(255 * l * 0.992);
      d[i + 2] = Math.round(255 * l * 0.955);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Pencil hatching packed into three channels, light -> heavy:
 *  R = sparse single hatch, G = tighter hatch, B = cross-hatch.
 * Sampled in screen space so shading reads as strokes on the page, not as shading on a model.
 */
export function makeHatchTexture(size = 256, seed = 21) {
  const rng = new Rng(seed);
  const wob = lattice(8, rng);
  const wob2 = lattice(8, rng);
  const tooth = lattice(32, rng);
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const d = img.data;

  // Stripe helper: 45-degree bands, wobbled by tileable noise so the strokes wander.
  const band = (x, y, period, width, dirNoise, dirSign) => {
    const w = (fbm(dirNoise, 8, (x / size) * 8, (y / size) * 8, 3) - 0.5) * period * 0.7;
    const s = (dirSign > 0 ? x + y : x - y) + w;
    const m = ((s % period) + period) % period;
    const dist = Math.min(m, period - m);
    // Strokes taper and break up: the tooth of the paper eats the line.
    const t = sat((width - dist) / Math.max(0.6, width * 0.55));
    const gap = vnoise(tooth, 32, (x / size) * 32, (y / size) * 32);
    return sat(t * (0.55 + gap * 0.75));
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = band(x, y, 17, 1.45, wob, 1);
      const gg = Math.max(band(x, y, 9, 1.5, wob, 1), band(x, y, 17, 1.45, wob, 1) * 0.6);
      const b = Math.max(gg, band(x, y, 11, 1.6, wob2, -1));
      const i = (y * size + x) * 4;
      d[i] = Math.round(255 * r);
      d[i + 1] = Math.round(255 * gg);
      d[i + 2] = Math.round(255 * b);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Crayon coverage mask. Streaky, patchy, with obvious stroke direction - used both to
 * texture the coloured fills and to break up the border where the colouring stops.
 */
export function makeCrayonTexture(size = 256, seed = 33) {
  const rng = new Rng(seed);
  const streak = lattice(32, rng);
  const blob = lattice(8, rng);
  const fine = lattice(64, rng);
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Stretched along one axis -> reads as strokes rather than clouds.
      const s = fbm(streak, 32, u * 32, v * 6, 3);
      const large = fbm(blob, 8, u * 8, v * 8, 3);
      const grit = vnoise(fine, 64, u * 64, v * 64);
      const cover = sat(0.42 + (s - 0.5) * 0.85 + (large - 0.5) * 0.7 + (grit - 0.5) * 0.32);
      const i = (y * size + x) * 4;
      d[i] = Math.round(255 * cover);          // coverage
      d[i + 1] = Math.round(255 * sat(large)); // slow variation, for hue drift
      d[i + 2] = Math.round(255 * grit);       // tooth
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** 2x2 atlas of hand-drawn ink splats, used for bullet holes. Alpha in every channel. */
export function makeSplatAtlas(size = 256, seed = 91) {
  const rng = new Rng(seed);
  const { c, g } = canvas2d(size);
  g.clearRect(0, 0, size, size);
  const cell = size / 2;
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * cell + cell / 2;
    const oy = Math.floor(k / 2) * cell + cell / 2;
    g.save();
    g.translate(ox, oy);
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    // Core blob with a ragged outline.
    const R = cell * 0.24;
    g.beginPath();
    const pts = 22;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * TAU;
      const r = R * (0.62 + rng.next() * 0.55 + 0.25 * Math.sin(a * 3 + k));
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    // Radiating scratch marks + satellite dots: reads as ink hitting paper.
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, TAU);
      const r0 = R * rng.range(0.7, 1.0);
      const r1 = R * rng.range(1.2, 2.1);
      g.lineWidth = rng.range(0.8, 2.6);
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.quadraticCurveTo(
        Math.cos(a + 0.2) * (r0 + r1) * 0.5, Math.sin(a + 0.2) * (r0 + r1) * 0.5,
        Math.cos(a) * r1, Math.sin(a) * r1);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), r = R * rng.range(1.1, 2.4);
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.6, 2.4), 0, TAU);
      g.fill();
    }
    g.restore();
  }
  // Move coverage into all channels so the shader can read .r as alpha.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = a; }
  g.putImageData(img, 0, 0);
  return c;
}

/** Comic starburst for muzzle flashes: white core, heavy ink outline. */
export function makeFlashTexture(size = 256, seed = 5) {
  const rng = new Rng(seed);
  const { c, g } = canvas2d(size);
  g.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const spikes = 11;
  const path = new Path2D();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
    const outer = i % 2 === 0;
    const r = (outer ? size * 0.46 * rng.range(0.82, 1.0) : size * 0.19 * rng.range(0.8, 1.15));
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
  }
  path.closePath();
  g.fillStyle = 'rgba(255,252,225,0.96)';
  g.fill(path);
  g.lineJoin = 'round';
  g.lineWidth = size * 0.028;
  g.strokeStyle = 'rgba(28,26,34,0.95)';
  g.stroke(path);
  // A couple of inner accent strokes.
  g.lineWidth = size * 0.016;
  g.strokeStyle = 'rgba(232,150,40,0.8)';
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, TAU);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * size * 0.07, cy + Math.sin(a) * size * 0.07);
    g.lineTo(cx + Math.cos(a) * size * 0.24, cy + Math.sin(a) * size * 0.24);
    g.stroke();
  }
  return c;
}

/** Soft round smudge used for pencil-shadow blobs under entities. */
export function makeSmudgeTexture(size = 128, seed = 3) {
  const rng = new Rng(seed);
  const lat = lattice(8, rng);
  const { c, g } = canvas2d(size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
      const r = Math.hypot(dx, dy);
      const n = fbm(lat, 8, (x / size) * 8, (y / size) * 8, 3);
      const a = sat((1 - r) * 1.35) * (0.45 + n * 0.75);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * sat(a * a));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Tapered pen streak used for bullet tracers. Horizontal, fading toward both ends. */
export function makeStreakTexture(w = 256, h = 64, seed = 61) {
  const rng = new Rng(seed);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  // A few overlapping strokes with slightly different bows: a scribbled line, not a laser.
  for (let s = 0; s < 3; s++) {
    g.lineWidth = h * (0.30 - s * 0.07);
    g.globalAlpha = 0.55 + s * 0.2;
    g.beginPath();
    g.moveTo(w * 0.02, h * 0.5 + rng.range(-2, 2));
    g.quadraticCurveTo(w * 0.5, h * 0.5 + rng.range(-h * 0.16, h * 0.16), w * 0.98, h * 0.5 + rng.range(-2, 2));
    g.stroke();
  }
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let x = 0; x < w; x++) {
    // Taper the ends so the streak reads as motion rather than a stick.
    const t = x / (w - 1);
    const taper = Math.min(1, Math.sin(t * Math.PI) * 1.6);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(d[i + 3] * taper);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Soft round puff for impact dust. */
export function makePuffTexture(size = 128, seed = 71) {
  const rng = new Rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.strokeStyle = '#000';
  g.lineWidth = size * 0.035;
  g.lineJoin = 'round';
  // Cartoon puff: a ring of overlapping loops.
  const lobes = 7;
  g.beginPath();
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * TAU;
    const r = size * (0.26 + rng.next() * 0.08);
    const px = size / 2 + Math.cos(a) * r;
    const py = size / 2 + Math.sin(a) * r;
    g.arc(px, py, size * 0.11, 0, TAU);
  }
  g.closePath();
  g.stroke();
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }
  g.putImageData(img, 0, 0);
  return c;
}

/** Translucent paper shield: a washed panel with a heavy drawn border and cross-hatching. */
export function makeShieldTexture(size = 256, seed = 17) {
  const rng = new Rng(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);

  // Shield outline: a rounded slab that tapers to a point at the bottom.
  const path = new Path2D();
  const w = size * 0.40, top = size * 0.10, bot = size * 0.94;
  path.moveTo(size / 2 - w, top + size * 0.06);
  path.quadraticCurveTo(size / 2, top - size * 0.03, size / 2 + w, top + size * 0.06);
  path.lineTo(size / 2 + w * 0.96, size * 0.58);
  path.quadraticCurveTo(size / 2 + w * 0.72, size * 0.84, size / 2, bot);
  path.quadraticCurveTo(size / 2 - w * 0.72, size * 0.84, size / 2 - w * 0.96, size * 0.58);
  path.closePath();

  g.save();
  g.clip(path);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, size, size);
  // Cross-hatch so it reads as drawn glass rather than a flat alpha rectangle.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    const dir = pass === 0 ? 1 : -1;
    g.lineWidth = size * 0.006;
    for (let i = -size; i < size * 2; i += size * 0.055) {
      g.beginPath();
      g.moveTo(i + rng.range(-3, 3), 0);
      g.lineTo(i + dir * size + rng.range(-3, 3), size);
      g.stroke();
    }
  }
  g.restore();

  // Border, drawn twice at slightly different weights like a pen gone round again.
  g.lineJoin = 'round';
  for (let k = 0; k < 2; k++) {
    g.lineWidth = size * (k === 0 ? 0.028 : 0.012);
    g.strokeStyle = k === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
    g.save();
    g.translate(rng.range(-2, 2), rng.range(-2, 2));
    g.stroke(path);
    g.restore();
  }
  return c;
}
