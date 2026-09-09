// Runs inside the game page. The service worker splices a script tag for this
// file into index.html at request time, so the game's own HTML on disk stays
// byte-identical to upstream.
//
// One job: wait for the game to exist, then run the entry scripts of every
// enabled mod. There is no list of known mods here and no special case for the
// touch controls - those are just a mod that happens to ship with the repo, and
// this file cannot tell the difference.

import { prefs } from '../js/prefs.js';

const ROOT = new URL('../../', import.meta.url);   // repo root, whatever it is deployed under

// The service worker splices this in, and the launcher also injects it by hand
// when there is no worker. Whichever gets there first wins; the second one idles.
const ALREADY_RUNNING = !!window.__dopsRuntime;
window.__dopsRuntime = true;

/* ------------------------------------------------------------------ mod API */

const listeners = { ready: [], frame: [] };

const api = {
  version: 1,
  root: ROOT.href,
  game: null,
  prefs,
  touch: null,

  /** Run cb once the game object exists (or immediately, if it already does). */
  onReady(cb) {
    if (api.game) { safely(cb, api.game); return; }
    listeners.ready.push(cb);
  },

  /** Called once per animation frame with (game, dt). */
  onFrame(cb) { listeners.frame.push(cb); },

  /**
   * Register how to undo what this mod did. Called when the mod is switched off
   * while the game is running, so a mod that patches the game can put it back.
   */
  onTeardown(modId, fn) { api._teardowns.set(modId, fn); },
  _teardowns: new Map(),

  /**
   * Wrap a method on a prototype or object. The common case for a small mod:
   *   DoodleMods.wrap(game.player, 'useSkill', (orig) => function () { ... });
   */
  wrap(target, name, factory) {
    const original = target[name];
    if (typeof original !== 'function') {
      throw new Error('DoodleMods.wrap: "' + name + '" is not a function on that object');
    }
    target[name] = factory(original);
    return () => { target[name] = original; };
  },

  /** Read a file the mod shipped, by its repo-relative path. */
  async asset(path) {
    const res = await fetch(new URL(path, ROOT).href);
    if (!res.ok) throw new Error('DoodleMods.asset: ' + path + ' -> HTTP ' + res.status);
    return res;
  },

  log(...args) { console.log('%c[mod]', 'color:#c0392f', ...args); },
};

window.DoodleMods = api;

function safely(fn, ...args) {
  try { fn(...args); } catch (err) { console.error('[dops] mod callback failed', err); }
}

/* --------------------------------------------------------------- boot order */

if (!ALREADY_RUNNING) boot();

async function boot() {
  const game = await waitForGame();
  if (!game) return;
  api.game = game;

  for (const cb of listeners.ready.splice(0)) safely(cb, game);

  // Mod entry scripts run once window.DoodleMods and game.player are both real.
  // Built-ins sort first, so an installed mod always gets the last word.
  await runModScripts();

  startFrameLoop(game);
  listenForModChanges();
  window.dispatchEvent(new CustomEvent('dops:ready', { detail: { game, api } }));
}

/**
 * Turning a mod off has to actually undo it, not wait for a reload. Anything a
 * mod mounted registers a teardown here; the launcher pings the frame whenever
 * the mod list changes, and whatever is no longer enabled is taken back down.
 *
 * Switching a mod back on still needs a reload - a module that has already been
 * imported will not re-execute - so the launcher reloads the frame for that case.
 */
function listenForModChanges() {
  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || !e.data || e.data.type !== 'dops:mods-changed') return;
    let on;
    try { on = new Set((await enabledMods()).map((m) => m.id)); } catch { return; }
    for (const [id, teardown] of api._teardowns) {
      if (on.has(id)) continue;
      api._teardowns.delete(id);
      safely(teardown);
      api.log('mod "' + id + '" dimatikan dan dilepas.');
    }
  });
}

function waitForGame() {
  return new Promise((resolve) => {
    // main.js sets window.__game right before game.start().
    if (window.__game) return resolve(window.__game);
    const started = performance.now();
    const poll = () => {
      if (window.__game) return resolve(window.__game);
      if (performance.now() - started > 20000) {
        // The game's own error screen is already up; leave it alone.
        console.warn('[dops] game object never appeared - touch controls are off');
        return resolve(null);
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

function startFrameLoop(game) {
  let last = performance.now();
  const step = (now) => {
    requestAnimationFrame(step);
    const dt = (now - last) / 1000;
    last = now;
    if (!listeners.frame.length) return;   // nothing registered: cost is one branch
    for (const cb of listeners.frame) safely(cb, game, dt);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------- mod scripts */

// Read the enabled mods straight out of IndexedDB. The scripts themselves are
// fetched as normal URLs, which the service worker answers from mod storage.
async function runModScripts() {
  for (const mod of await enabledMods()) {
    for (const path of mod.scripts || []) {
      const url = new URL(path, ROOT).href;
      try {
        await import(/* @vite-ignore */ url);
        api.log('ran ' + mod.name + ' -> ' + path);
      } catch (err) {
        console.error('[dops] mod "' + mod.name + '" script ' + path + ' failed', err);
      }
    }
  }
}

/** The mods that should run, in load order. Nothing else decides this. */
async function enabledMods() {
  let rows;
  try { rows = await allMods(); } catch { rows = []; }
  return rows.filter((m) => m.enabled).sort((a, b) => (a.priority || 0) - (b.priority || 0));
}

/** Every stored mod row. An empty list means no mods, and that is not a problem. */
function allMods() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('doodleops-launcher', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const dbh = req.result;
      if (!dbh.objectStoreNames.contains('mods')) return resolve([]);
      const q = dbh.transaction('mods', 'readonly').objectStore('mods').getAll();
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    };
    // Never create the database from here - if it does not exist there are no mods.
    req.onupgradeneeded = () => { req.transaction.abort(); resolve([]); };
  });
}
