// Launcher preferences: the touch layout, not the game's own settings. Kept in
// localStorage (tiny, and the runtime inside the game frame reads it synchronously).
// The game's own settings stay where upstream put them, untouched.

const KEY = 'dops.launcher.v1';

export const DEFAULTS = {
  // 'auto' turns the touch layer on only where there is a touchscreen.
  touchMode: 'auto',            // auto | on | off

  lookSensitivity: 1.0,         // multiplier on top of the game's own sensitivity
  buttonScale: 1.0,             // 0.7 .. 1.6
  opacity: 0.92,                // 0.2 .. 1
  leftHanded: false,            // mirror the whole layout
  joystickMode: 'fixed',        // fixed | floating
  joystickSize: 1.0,

  tapToShoot: true,             // tap empty screen = shoot / swing
  tapMaxMs: 220,                // longer than this and it was a hold, not a tap
  tapMaxMove: 16,               // CSS px of travel still counted as a tap
  holdToAutoFire: false,        // hold still on empty screen = keep firing

  showFireButton: true,
  showScopeButton: true,
  showSlotChips: true,          // the KNIFE / GUN chips
  hideDesktopHud: true,         // drop the game's own "scroll to switch" slot strip
  haptics: true,

  autoFullscreen: true,
  lockLandscape: true,
  keepAwake: true,
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

export const prefs = load();

export function savePrefs() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

export function setPref(key, value) {
  if (!(key in DEFAULTS)) return;
  prefs[key] = value;
  savePrefs();
  window.dispatchEvent(new CustomEvent('dops:prefs', { detail: { key, value } }));
}

export function resetPrefs() {
  Object.assign(prefs, DEFAULTS);
  savePrefs();
  window.dispatchEvent(new CustomEvent('dops:prefs', { detail: { key: '*', value: null } }));
}

/** Re-read from storage. The game runs in an iframe, so it has its own module copy. */
export function reloadPrefs() {
  Object.assign(prefs, load());
  return prefs;
}

export function hasTouch() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

export function touchActive() {
  if (prefs.touchMode === 'on') return true;
  if (prefs.touchMode === 'off') return false;
  return hasTouch();
}
