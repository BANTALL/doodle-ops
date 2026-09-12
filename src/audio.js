// WebAudio SFX and music. Almost everything is synthesised from noise bursts + filtered
// oscillators, which suits the scratchy paper aesthetic better than clean samples would.
// The exceptions are the recorded clips in assets/audio: the pistol, the crash you hear
// when you die, and the optional scream when you take a hit (see SAMPLES below), plus the
// two music tracks, which stream through <audio> elements rather than being decoded whole.
// Every sample path has a synthesised fallback, so the game still sounds right if the
// files fail to load.

import { settings } from './settings.js';
import { clamp } from './math.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let lastScream = null;   // so a new scream can duck the one still playing

/**
 * Recorded one-shots. `offset` skips leading silence, `tail` is how much of the clip we
 * actually let through before fading - the shot has a long room tail that would stack into
 * mush at the pistol's fire rate.
 */
const SAMPLES = {
  pistolShot:   { url: new URL('../assets/audio/pistol-shot.mp3', import.meta.url).href,   offset: 0.04, tail: 0.85, gain: 1.0, buffer: null },
  pistolReload: { url: new URL('../assets/audio/pistol-reload.mp3', import.meta.url).href, offset: 0,    tail: 1.05, gain: 1.0, buffer: null },
  // Both of these are mostly silence on either side of the bit you want: the crash starts
  // 0.10s in, the scream 0.72s in. Playing them from zero would put a hole where the hit is.
  deathLego:    { url: new URL('../assets/audio/death-lego.mp3', import.meta.url).href,    offset: 0.10, tail: 1.12, gain: 1.0, buffer: null },
  hurtRah:      { url: new URL('../assets/audio/hurt-rah.mp3', import.meta.url).href,      offset: 0.72, tail: 1.36, gain: 1.0, buffer: null },
  punch:        { url: new URL('../assets/audio/punch.mp3', import.meta.url).href,         offset: 0,    tail: 0.60, gain: 1.0, buffer: null },
};

// Fetch straight away: the files are tiny, and starting now means they're usually decoded
// before the first shot. Decoding has to wait for the AudioContext, which can't exist
// until the player clicks something.
const pendingBytes = {};
for (const key of Object.keys(SAMPLES)) {
  pendingBytes[key] = fetch(SAMPLES[key].url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)));
  pendingBytes[key].catch(() => {});  // a missing file is not fatal - we fall back to synthesis
}

function decodeSamples() {
  for (const key of Object.keys(SAMPLES)) {
    const bytes = pendingBytes[key];
    if (!bytes) continue;
    pendingBytes[key] = null;
    bytes
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => { SAMPLES[key].buffer = audio; })
      .catch(() => {});
  }
}

/**
 * Plays a decoded clip. Returns the clip's gain node, or null when the sample isn't
 * available - callers test the result and fall back to synthesis.
 *
 * `rate` repitches the clip, and the tail is divided by it so a slowed-down clip isn't
 * cut off halfway. `dest` swaps the output for a processing chain (the death crash).
 */
function playSample(name, level, { delay = 0, rate = 1, dest = null } = {}) {
  const s = SAMPLES[name];
  if (!ctx || !s || !s.buffer || level <= 0.0005) return null;
  const t0 = ctx.currentTime + delay;
  const tail = s.tail / rate;
  const src = ctx.createBufferSource();
  src.buffer = s.buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level * s.gain, t0);
  g.gain.setValueAtTime(level * s.gain, t0 + tail * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + tail);
  src.connect(g);
  g.connect(dest || master);
  src.start(t0, s.offset);
  src.stop(t0 + tail + 0.02);
  return g;
}

// ---------------------------------------------------------------- death bus
//
// The crash that plays when you die is meant to be twice as loud as anything else and to
// hurt a little. Just multiplying the gain by two would send it past full scale, where the
// hardware squares off the overs and it stops sounding like breaking plastic and starts
// sounding like a broken file. So it goes through its own chain instead: a soft clipper
// that rounds the peaks off while lifting everything underneath them, a high shelf for the
// bite, and a limiter to catch whatever is left.

let deathBus = null;

function getDeathBus() {
  if (deathBus || !ctx) return deathBus;
  const shaper = ctx.createWaveShaper();
  const n = 2048, curve = new Float32Array(n), k = 2.7, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * k) / norm;
  shaper.curve = curve;
  shaper.oversample = '4x';

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 2700;
  shelf.gain.value = 8;             // where the shatter lives - this is the ear-splitting part

  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20;
  limit.attack.value = 0.001; limit.release.value = 0.12;

  const out = ctx.createGain();
  out.gain.value = 0.86;

  shaper.connect(shelf); shelf.connect(limit); limit.connect(out); out.connect(master);
  deathBus = shaper;
  return deathBus;
}

// ---------------------------------------------------------------- music
//
// Two tracks that alternate, each one starting when the last finishes. They stream through
// <audio> elements instead of decodeAudioData: a decoded minute of 44.1kHz stereo is about
// 20MB of float per track, and there is no reason to hold that in memory just to play it
// front to back once.

const MUSIC_TRACKS = [
  new URL('../assets/audio/music-archive-echoes.mp3', import.meta.url).href,
  new URL('../assets/audio/music-archive-echoes-2.mp3', import.meta.url).href,
];
const MUSIC_LEVEL = 0.42;      // sits under the SFX; the volume slider scales both

let musicEls = null;
let musicGain = null;
let musicIndex = 0;
let musicWanted = false;

function buildMusic() {
  if (musicEls) return;
  musicEls = MUSIC_TRACKS.map((url, i) => {
    const el = new Audio();
    el.src = url;
    el.preload = i === 0 ? 'auto' : 'none';
    el.volume = MUSIC_LEVEL;          // only used if we can't route it through the graph
    el.addEventListener('ended', () => { musicIndex = (musicIndex + 1) % musicEls.length; playTrack(); });
    // A track that won't load shouldn't take the other one down with it.
    el.addEventListener('error', () => {
      if (!musicWanted || musicEls[musicIndex] !== el) return;
      musicIndex = (musicIndex + 1) % musicEls.length;
      if (musicEls[musicIndex] !== el) playTrack();
    });
    return el;
  });
}

function wireMusic() {
  if (!ctx || !musicEls) return;
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_LEVEL;
    musicGain.connect(master);
  }
  for (const el of musicEls) {
    if (el._node) continue;
    try {
      el._node = ctx.createMediaElementSource(el);
      el._node.connect(musicGain);
      el.volume = 1;                  // the graph handles level from here
    } catch {
      el._node = null;                // stays on its own volume, which still works
    }
  }
}

function playTrack() {
  if (!musicWanted || !musicEls) return;
  const el = musicEls[musicIndex];
  const next = musicEls[(musicIndex + 1) % musicEls.length];
  if (next !== el && next.preload === 'none') next.preload = 'auto';  // fetch it before we need it
  try { el.currentTime = 0; } catch { /* not seekable yet - it starts at zero anyway */ }
  const pr = el.play();
  // Autoplay can still be refused; resumeAudio() tries again on the next real gesture.
  if (pr && pr.catch) pr.catch(() => {});
}

/** Starts (or resumes) the music. Safe to call repeatedly. */
export function startMusic() {
  musicWanted = true;
  buildMusic();
  wireMusic();
  const el = musicEls[musicIndex];
  if (el.paused) {
    if (el.currentTime > 0 && !el.ended) { const pr = el.play(); if (pr && pr.catch) pr.catch(() => {}); }
    else playTrack();
  }
}

/**
 * Pulls the music down for a moment. The death crash is loud enough that it and the track
 * together can push the output past full scale, where the hardware clips it; ducking keeps
 * the sum in range and makes the crash land harder besides.
 */
function duckMusic(to, hold, release) {
  if (!ctx || !musicGain) return;
  const t = ctx.currentTime;
  const g = musicGain.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(MUSIC_LEVEL * to, t + 0.03);
  g.setValueAtTime(MUSIC_LEVEL * to, t + hold);
  g.linearRampToValueAtTime(MUSIC_LEVEL, t + hold + release);
}

export function stopMusic() {
  musicWanted = false;
  if (musicEls) for (const el of musicEls) el.pause();
}

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

  decodeSamples();
  wireMusic();
  return ctx;
}

export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  startMusic();
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
    if (kind === 'pistol') {
      if (!playSample('pistolShot', 0.60 * g)) bang(t, { level: 0.42 * g, bright: 2600, decay: 0.15, thump: 120, thumpLevel: 0.5 });
    }
    else if (kind === 'm4')     bang(t, { level: 0.30 * g, bright: 3400, decay: 0.09, thump: 150, thumpLevel: 0.35 });
    else if (kind === 'sniper') bang(t, { level: 0.60 * g, bright: 1700, decay: 0.42, thump: 70,  thumpLevel: 0.8 });
  },
  /** A bare fist: a short thump rather than the knife's whistle. */
  punch(dist = 0) {
    if (!ctx) return;
    const g = dist ? spatial(dist, 26) : 1;
    if (playSample('punch', 0.85 * g)) return;
    const t = ctx.currentTime;
    bang(t, { level: 0.26 * g, bright: 1100, decay: 0.11, thump: 110, thumpLevel: 0.8 });
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
  /** The axe: everything the knife does, an octave down and twice as long. */
  axeSwing(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = dist ? spatial(dist, 30) : 1;
    const n = noiseSource(0.4, 0.7);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(1500, t + 0.26);
    n.connect(bp);
    const gn = env(bp, t, 0.30 * g, 0.02, 0.30);
    gn.connect(master);
    n.start(t); n.stop(t + 0.45);
    tone(t, 150, { level: 0.10 * g, dur: 0.28, type: 'sawtooth', slideTo: 62 });
  },
  axeThrow(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = dist ? spatial(dist, 40) : 1;
    // A rising whistle, so a thrown axe is audible as a thing crossing the room.
    tone(t, 420, { level: 0.13 * g, dur: 0.34, type: 'triangle', slideTo: 1150 });
    bang(t, { level: 0.20 * g, bright: 1400, decay: 0.18, thump: 90, thumpLevel: 0.7 });
  },
  axeStick(dist = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = dist ? spatial(dist, 40) : 1;
    bang(t, { level: 0.42 * g, bright: 700, decay: 0.22, thump: 52, thumpLevel: 1.2, q: 1.2 });
    tone(t + 0.02, 190, { level: 0.11 * g, dur: 0.36, type: 'triangle', slideTo: 88 });
  },
  hitMarker() { if (ctx) tone(ctx.currentTime, 1500, { level: 0.13, dur: 0.05, type: 'square', slideTo: 2100 }); },
  hurt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    bang(t, { level: 0.34, bright: 900, decay: 0.2, thump: 55, thumpLevel: 1.1 });
    tone(t, 260, { level: 0.1, dur: 0.18, type: 'sawtooth', slideTo: 150 });
    if (settings.hurtSfx) Sfx.scream();
  },
  /**
   * Off by default. Repitched every time so a burst of hits doesn't sound like the same
   * clip stuttering, and a new one ducks the last one out rather than piling on top: five
   * M4 rounds land inside half a second and five overlapping screams are just noise.
   */
  scream() {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (lastScream) {
      lastScream.gain.cancelScheduledValues(t);
      lastScream.gain.setValueAtTime(lastScream.gain.value, t);
      lastScream.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    }
    lastScream = playSample('hurtRah', 0.9, { rate: 0.74 + Math.random() * 0.86 });
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
  // `kind` is the weapon id, so the pistol can use its recorded clip. Stage 'out' fires at
  // the start of a reload, 'in' is the lighter click used for weapon swaps.
  reload(stage, dist = 0, kind = null) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const a = dist > 0 ? spatial(dist, 45) : 1;
    if (dist > 0 && a <= 0.001) return;
    if (stage === 'out') {
      // Delayed slightly: the clip's magazine-insert lands ~0.52s in, and the pistol's
      // 1.35s reload animation seats the mag around 0.67s.
      if (kind === 'pistol' && playSample('pistolReload', 0.85 * a, { delay: 0.15 })) return;
      bang(t, { level: 0.18 * a, bright: 1600, decay: 0.07, thump: 190, thumpLevel: 0.4 });
    } else {
      bang(t, { level: 0.24 * a, bright: 2000, decay: 0.08, thump: 240, thumpLevel: 0.6 });
    }
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
  /**
   * The player dying. Deliberately the loudest thing in the game - twice the level of a
   * sniper shot, through the drive chain, with a second copy pitched down underneath so
   * the crash has some weight under all that top end instead of being pure glass.
   */
  playerDeath() {
    if (!ctx) return;
    const bus = getDeathBus();
    const played = playSample('deathLego', 2.0, { dest: bus });
    if (played) {
      playSample('deathLego', 1.15, { dest: bus, rate: 0.74, delay: 0.015 });
      duckMusic(0.22, 0.85, 1.1);
      return;
    }
    Sfx.death();
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
