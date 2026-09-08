// Boot: build the game, wire the menus to the settings store, keep the two talking.

import { Game } from './game.js';
import { settings, setSetting, resetSettings } from './settings.js';
import { initAudio, resumeAudio, setVolume, Sfx } from './audio.js';

const $ = (sel) => document.querySelector(sel);

const screens = {
  start: $('#screen-start'),
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

function bindSettings(game) {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    el.addEventListener('input', () => {
      const value = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      setSetting(key, value);
      if (key === 'volume') setVolume(settings.volume);
      if (key === 'resolutionScale' || key === 'inkAmount') game.resize();
      if (key === 'showFps') game.showFps = settings.showFps;
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
  game.start();

  const startPlaying = () => {
    initAudio();
    resumeAudio();
    setVolume(settings.volume);
    game.setPaused(false);
  };

  $('#btn-play').addEventListener('click', startPlaying);
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
  overlay.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, label, a')) return;
    if (!screens.error.classList.contains('hidden')) return;
    if (!screens.end.classList.contains('hidden')) return;
    startPlaying();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !game.paused) game.setPaused(true);
  });

  show('start');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
