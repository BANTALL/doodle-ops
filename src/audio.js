// Fully procedural WebAudio SFX - no asset files, so the whole game stays a static drop-in.
// Everything is synthesised from noise bursts + filtered oscillators, which suits the
// scratchy paper aesthetic better than clean samples would.

import { settings } from './settings.js';
import { clamp } from './math.js';

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 1.2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) { if (master) master.gain.value = clamp(v, 0, 1); }

/** Distance attenuation + slight low-pass for far sounds. `dist` in world units. */
function spatial(dist, maxDist) {
  const g = clamp(1 - dist / maxDist, 0, 1);
  return g * g;
}

function noiseSource(dur, playbackRate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = playbackRate;
  s.loop = true;
  return s;
}

function env(node, t0, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  node.connect(g);
  return g;
}

/** One-shot: filtered noise burst with a pitched thump underneath. */
function bang(t0, { level = 0.5, bright = 2200, decay = 0.16, thump = 90, thumpLevel = 0.5, q = 0.8 }) {
  const n = noiseSource();
  const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass'; bp.frequency.setValueAtTime(bright, t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(180, bright * 0.15), t0 + decay);
  bp.Q.value = q;
  n.connect(bp);
  const g = env(bp, t0, level, 0.002, decay);
  g.connect(master);
  n.start(t0); n.stop(t0 + decay + 0.05);

  if (thumpLevel > 0) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(thump, t0);
    o.frequency.exponentialRampToValueAtTime(thump * 0.4, t0 + decay);
    const og = env(o, t0, level * thumpLevel, 0.003, decay * 0.9);
    og.connect(master);
    o.start(t0); o.stop(t0 + decay + 0.05);
  }
}

function tone(t0, freq, { level = 0.2, dur = 0.1, type = 'square', slideTo = null }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = env(o, t0, level, 0.005, dur);
  g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

/** Public API. `dist` (optional) attenuates for bots firing across the map. */
export const Sfx = {
  shoot(kind, dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const a = spatial(dist, 60);
    if (dist > 0 && a <= 0.001) return;
    const g = dist > 0 ? a : 1;
    if (kind === 'pistol')      bang(t, { level: 0.42 * g, bright: 2600, decay: 0.15, thump: 120, thumpLevel: 0.5 });
    else if (kind === 'm4')     bang(t, { level: 0.30 * g, bright: 3400, decay: 0.09, thump: 150, thumpLevel: 0.35 });
    else if (kind === 'sniper') bang(t, { level: 0.60 * g, bright: 1700, decay: 0.42, thump: 70,  thumpLevel: 0.8 });
  },
  swing(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = noiseSource(0.2, 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2800, t + 0.13);
    n.connect(bp);
    const g = env(bp, t, 0.22 * (dist ? spatial(dist, 25) : 1), 0.01, 0.14);
    g.connect(master);
    n.start(t); n.stop(t + 0.25);
  },
  stab(dist = 0) { if (ctx) bang(ctx.currentTime, { level: 0.3 * (dist ? spatial(dist, 25) : 1), bright: 900, decay: 0.1, thump: 60, thumpLevel: 0.9 }); },
  hitMarker() { if (ctx) tone(ctx.currentTime, 1500, { level: 0.13, dur: 0.05, type: 'square', slideTo: 2100 }); },
  hurt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    bang(t, { level: 0.34, bright: 900, decay: 0.2, thump: 55, thumpLevel: 1.1 });
    tone(t, 260, { level: 0.1, dur: 0.18, type: 'sawtooth', slideTo: 150 });
  },
  crateBreak(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = dist ? spatial(dist, 45) : 1;
    bang(t, { level: 0.4 * g, bright: 3000, decay: 0.28, thump: 80, thumpLevel: 0.5, q: 1.4 });
    for (let i = 0; i < 4; i++) bang(t + 0.04 + i * 0.045, { level: 0.12 * g, bright: 2400, decay: 0.09, thumpLevel: 0 });
  },
  pickup() { if (!ctx) return; const t = ctx.currentTime; tone(t, 620, { level: 0.14, dur: 0.07, type: 'triangle' }); tone(t + 0.07, 980, { level: 0.14, dur: 0.1, type: 'triangle' }); },
  drop() { if (ctx) tone(ctx.currentTime, 420, { level: 0.1, dur: 0.1, type: 'triangle', slideTo: 240 }); },
  reload(stage) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (stage === 'out') bang(t, { level: 0.18, bright: 1600, decay: 0.07, thump: 190, thumpLevel: 0.4 });
    else bang(t, { level: 0.24, bright: 2000, decay: 0.08, thump: 240, thumpLevel: 0.6 });
  },
  scope(on) { if (ctx) tone(ctx.currentTime, on ? 700 : 500, { level: 0.09, dur: 0.06, type: 'sine', slideTo: on ? 1000 : 360 }); },
  step(dist = 0) {
    if (!ctx) return;
    bang(ctx.currentTime, { level: 0.075 * (dist ? spatial(dist, 22) : 1), bright: 700, decay: 0.07, thump: 95, thumpLevel: 0.55 });
  },
  jump() { if (ctx) tone(ctx.currentTime, 380, { level: 0.07, dur: 0.09, type: 'sine', slideTo: 620 }); },
  land() { if (ctx) bang(ctx.currentTime, { level: 0.16, bright: 600, decay: 0.11, thump: 70, thumpLevel: 0.9 }); },
  death(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = dist ? spatial(dist, 50) : 1;
    tone(t, 340, { level: 0.16 * g, dur: 0.45, type: 'sawtooth', slideTo: 90 });
    bang(t + 0.05, { level: 0.22 * g, bright: 800, decay: 0.3, thump: 60, thumpLevel: 0.8 });
  },
  kill() { if (!ctx) return; const t = ctx.currentTime; [880, 1180, 1560].forEach((f, i) => tone(t + i * 0.06, f, { level: 0.12, dur: 0.09, type: 'triangle' })); },
  ricochet(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    tone(t, 1800 + Math.random() * 900, { level: 0.08 * (dist ? spatial(dist, 30) : 1), dur: 0.12, type: 'square', slideTo: 420 });
  },
  uiClick() { if (ctx) tone(ctx.currentTime, 760, { level: 0.09, dur: 0.04, type: 'square' }); },
  win() { if (!ctx) return; const t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.12, f, { level: 0.16, dur: 0.22, type: 'triangle' })); },
  lose() { if (!ctx) return; const t = ctx.currentTime; [523, 440, 349, 262].forEach((f, i) => tone(t + i * 0.14, f, { level: 0.16, dur: 0.26, type: 'triangle' })); },
};
