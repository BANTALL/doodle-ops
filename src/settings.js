// User settings, persisted to localStorage. Everything the pause menu can tweak lives here.

const KEY = 'doodlefps.settings.v1';

export const DEFAULTS = {
  sensitivity: 2.4,      // deg of yaw per 100px of mouse travel, roughly
  scopedSensitivity: 1.1, // separate sens while the sniper scope is up
  fov: 82,
  invertY: false,
  volume: 0.7,
  resolutionScale: 1.0,  // 0.6 .. 1.0, drops render resolution on weak GPUs
  inkAmount: 1.0,        // thickness multiplier for the ink outlines
  showFps: false,
  botCount: 5,
  killLimit: 20,
  doodler: 'normies',
  fancy: true,
};

export const RANGES = {
  sensitivity: [0.3, 8, 0.05],
  scopedSensitivity: [0.15, 4, 0.05],
  fov: [65, 105, 1],
  volume: [0, 1, 0.05],
  resolutionScale: [0.5, 1, 0.05],
  inkAmount: [0.5, 2, 0.05],
  killLimit: [5, 50, 1],
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof parsed[k] === typeof DEFAULTS[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode, ignore */ }
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  if (typeof DEFAULTS[key] === 'number') {
    const r = RANGES[key];
    if (r) value = Math.min(r[1], Math.max(r[0], value));
    value = Math.round(value * 1000) / 1000;
  }
  settings[key] = value;
  saveSettings();
}

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
}
