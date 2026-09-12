// Boot: build the game, wire the menus to the settings store, keep the two talking.

import { Game } from './game.js';
import { settings, setSetting, resetSettings } from './settings.js';
import { initAudio, resumeAudio, setVolume, Sfx } from './audio.js';
import { DOODLERS, DOODLER_IDS } from './doodlers.js';
import { TouchPad } from './touch.js';

const $ = (sel) => document.querySelector(sel);

const screens = {
  start: $('#screen-start'),
  class: $('#screen-class'),
  pause: $('#screen-pause'),
  end: $('#screen-end'),
  error: $('#screen-error'),
};
const overlay = $('#overlay');

function show(name) {
  overlay.classList.remove('hidden');
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
}
function hideAll() {
  overlay.classList.add('hidden');
  for (const el of Object.values(screens)) el.classList.add('hidden');
}

function fail(message) {
  show('error');
  $('#error-text').textContent = message;
}

// ---------------------------------------------------------------- settings UI

function formatSetting(key, value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (key === 'volume') return `${Math.round(value * 100)}%`;
  if (key === 'resolutionScale') return `${Math.round(value * 100)}%`;
  if (key === 'fov') return `${Math.round(value)}°`;
  if (key === 'botCount' || key === 'killLimit') return `${Math.round(value)}`;
  return value.toFixed(2);
}

function syncSettingsUI() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
  }
  for (const out of document.querySelectorAll('[data-out]')) {
    const key = out.dataset.out;
    out.textContent = formatSetting(key, settings[key]);
  }
}

/** The line under PLAY tells you how to start, which isn't the same on a phone. */
function syncFineprint() {
  const el = document.querySelector('#fineprint');
  if (!el) return;
  el.textContent = settings.touch
    ? 'left thumb moves · drag the right to look · needs WebGL2'
    : 'click anywhere to lock the mouse · needs WebGL2';
}

function bindSettings(game) {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    el.addEventListener('input', () => {
      const value = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      setSetting(key, value);
      if (key === 'volume') setVolume(settings.volume);
      if (key === 'resolutionScale' || key === 'inkAmount') game.resize();
      if (key === 'showFps') game.showFps = settings.showFps;
      if (key === 'hurtSfx' && settings.hurtSfx) Sfx.scream();   // let them hear what they turned on
      if (key === 'touch') { game.setTouch(settings.touch); syncFineprint(); }
      if (key === 'killLimit') game.killLimit = settings.killLimit;
      syncSettingsUI();
    });
  }
}

// ---------------------------------------------------------------- boot

function main() {
  const glCanvas = $('#gl');
  const hudCanvas = $('#hud');

  let game;
  const ui = {
    showPause() { show('pause'); syncSettingsUI(); },
    showEnd(winner, sorted) {
      show('end');
      $('#end-title').textContent = winner.isPlayer ? 'YOU WIN' : `${winner.name} WINS`;
      const rows = sorted.map((a) => `
        <tr class="${a.isPlayer ? 'me' : ''}">
          <td>${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td>
        </tr>`).join('');
      $('#end-scores').innerHTML =
        `<thead><tr><th>who</th><th>kills</th><th>deaths</th></tr></thead><tbody>${rows}</tbody>`;
    },
    hideAll,
  };

  try {
    game = new Game({ glCanvas, hudCanvas, ui });
  } catch (err) {
    console.error(err);
    fail(String(err && err.message ? err.message : err) +
      '\n\nThis game needs WebGL2. Try a recent Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is on.');
    return;
  }

  window.__game = game;   // handy for poking at it from the console
  bindSettings(game);
  syncSettingsUI();
  game.showFps = settings.showFps;
  // Offer the pad by default on anything with a finger rather than a mouse, but only the
  // first time - after that the saved setting is the player's own answer.
  if (!localStorage.getItem('doodlefps.touchAsked')) {
    try { localStorage.setItem('doodlefps.touchAsked', '1'); } catch { /* private mode */ }
    if (TouchPad.likelyTouchDevice()) setSetting('touch', true);
    syncSettingsUI();
  }
  game.setTouch(settings.touch);
  syncFineprint();
  game.start();

  const startPlaying = () => {
    initAudio();
    resumeAudio();
    setVolume(settings.volume);
    game.setPaused(false);
  };

  // ---- doodler picker
  const cards = $('#class-cards');
  const renderCards = () => {
    cards.innerHTML = DOODLER_IDS.map((id) => {
      const d = DOODLERS[id];
      const picked = settings.doodler === id;
      return `<button class="class-card" data-doodler="${id}" aria-pressed="${picked}">
        ${picked ? '<span class="current">CURRENT</span>' : ''}
        <h3>${d.name}</h3>
        <span class="tag">${d.tag}</span>
        <ul>${d.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
        <p>${d.blurb}</p>
      </button>`;
    }).join('');
  };
  const pickDoodler = (id) => {
    setSetting('doodler', id);
    renderCards();
    game.player.applyDoodler(id);
    game.player.respawn(game.pickSpawn(game.player));
    game.onActorSpawned(game.player);
    game.toast(`PLAYING AS ${DOODLERS[id].name}`);
  };
  cards.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-doodler]');
    if (!btn) return;
    Sfx.uiClick();
    pickDoodler(btn.dataset.doodler);
    startPlaying();
  });

  $('#btn-play').addEventListener('click', () => { Sfx.uiClick(); renderCards(); show('class'); });
  $('#btn-class').addEventListener('click', () => { Sfx.uiClick(); renderCards(); show('class'); });
  $('#btn-resume').addEventListener('click', () => { Sfx.uiClick(); startPlaying(); });
  $('#btn-restart').addEventListener('click', () => {
    Sfx.uiClick();
    game.newMatch();
    startPlaying();
  });
  $('#btn-again').addEventListener('click', () => {
    Sfx.uiClick();
    hideAll();              // never leave the popup up, whatever setPaused decides to do
    game.matchOver = false;
    game.newMatch();
    startPlaying();
  });
  $('#btn-defaults').addEventListener('click', () => {
    Sfx.uiClick();
    resetSettings();
    syncSettingsUI();
    setVolume(settings.volume);
    game.resize();
    game.showFps = settings.showFps;
  });

  // Clicking the paper (but not a control) resumes, the way every shooter does it.
  // Not on the start, class or end screens, where a click means "choose something".
  overlay.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, label, a')) return;
    for (const name of ['error', 'end', 'class', 'start']) {
      if (!screens[name].classList.contains('hidden')) return;
    }
    startPlaying();
  });

  // The soundtrack is meant to be playing the whole time, menus included, but no browser
  // will start audio before the page has been interacted with. So the first click or key
  // anywhere unlocks it - captured, so it runs before the button handler that wants to
  // click at you.
  const unlock = () => { initAudio(); resumeAudio(); setVolume(settings.volume); };
  window.addEventListener('pointerdown', unlock, { capture: true, once: true });
  window.addEventListener('keydown', unlock, { capture: true, once: true });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !game.paused) game.setPaused(true);
  });

  show('start');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
