// The Mobile Controls mod.
//
// This is a mod like any other - the launcher runs it through the same script
// hook a player's zip would use. It happens to be built in and to live in the
// repo rather than in IndexedDB, which is the only thing that makes it different.
//
// Turning it off gives you the game exactly as upstream ships it: the on-screen
// buttons go, the settings button in the lobby goes with them, the input patches
// are unwound, and pointer lock goes back to being pointer lock.

import { mountTouchLayer } from './touch.js';
import { mountSettingsPanel } from './settings.js';
import { prefs, reloadPrefs, touchActive } from '../../launcher/js/prefs.js';

const M = window.DoodleMods;
const ID = 'mobile-controls';

M.onReady((game) => {
  // The game lives in its own frame, so this module has its own copy of the
  // prefs. Re-read them in case they were changed from another tab.
  reloadPrefs();

  const undo = [];
  let layer = null;

  // The settings live in the game's own lobby, not the launcher, and they exist
  // whether or not the touch layer is currently up - otherwise someone on a
  // desktop could never switch it on to try it.
  try {
    undo.push(mountSettingsPanel());
  } catch (err) {
    console.error('[mobile-controls] panel pengaturan gagal dibuat', err);
  }

  // The game draws its own weapon strip with a "scroll to switch" hint, which is
  // both wrong on a phone and sits exactly under the fire button. The touch layer
  // already shows the same two slots, so silence that one method.
  //
  // Wrapping one method beats shipping a whole copy of hud.js: if upstream
  // renames or moves it, the guard below just leaves the HUD alone.
  if (game.hud && typeof game.hud._weaponSlots === 'function') {
    undo.push(M.wrap(game.hud, '_weaponSlots', (original) => function (...args) {
      if (layer && prefs.hideDesktopHud) return;      // drawn by the touch layer
      return original.apply(this, args);
    }));
  }

  undo.push(fixPauseMenuScrolling());

  // Switching the touch layer on and off from the settings panel takes effect
  // immediately, including handing pointer lock back when it goes.
  function syncLayer() {
    const want = touchActive();
    if (want && !layer) {
      try {
        layer = mountTouchLayer(game, prefs);
        M.touch = layer;
        M.log('Mobile Controls aktif.');
      } catch (err) {
        console.error('[mobile-controls] gagal dipasang', err);
        layer = null;
      }
    } else if (!want && layer) {
      layer.destroy();
      layer = null;
      M.touch = null;
      M.log('Kontrol sentuh dimatikan — kembali ke keyboard dan mouse.');
    }
  }

  const onPrefs = (e) => { if (!e.detail || e.detail.key === 'touchMode' || e.detail.key === '*') syncLayer(); };
  window.addEventListener('dops:prefs', onPrefs);
  undo.push(() => window.removeEventListener('dops:prefs', onPrefs));
  undo.push(() => { if (layer) { layer.destroy(); layer = null; M.touch = null; } });

  syncLayer();

  // Everything this mod touched, in one place, for when it gets switched off.
  M.onTeardown(ID, () => { while (undo.length) undo.pop()(); });
});

/**
 * The pause menu resumes the match when you press the paper rather than a
 * control - fine with a mouse, broken with a thumb: dragging to scroll the
 * settings list synthesises a mousedown on the sheet and the menu shuts
 * instantly, before you have read a single option.
 *
 * The fix is to keep that mousedown from reaching the game's handler, but only
 * for presses that land on the sheet's own dead space. Interactive controls are
 * left alone so sliders and checkboxes still drag, and a press on the backdrop
 * outside the sheet still resumes, exactly as upstream intended.
 *
 * @returns {() => void} how to put it back
 */
function fixPauseMenuScrolling() {
  const block = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('#overlay .sheet')) return;             // backdrop: leave it be
    if (t.closest('button, input, select, textarea, label, a')) return;
    e.stopPropagation();
  };
  document.addEventListener('mousedown', block, true);
  return () => document.removeEventListener('mousedown', block, true);
}
