// Mods that ship with the repo.
//
// The launcher knows exactly one thing about them: which folders to look in.
// Everything else - name, version, what files it has, what it does - comes out
// of that mod's own mod.json, and it is installed by zipping those files in
// memory and handing the result to the same installMod() a player's .zip goes
// through. So a bundled mod is not a special kind of mod. It is a mod that
// happens to already be on the server, and once installed it is an ordinary row
// in the database: toggleable, reorderable, overridable, deletable.
//
// That matters beyond tidiness. Every special case for "the built-in one" is a
// branch that can disagree with the normal path, and the first version of this
// file was exactly that - a hardcoded list the runtime fell back to, which
// happily resurrected a mod the player had just switched off.

import { zipStore } from './zipwrite.js';

/** Folders under the repo root that contain a mod.json. */
export const BUNDLED = ['mods/mobile-controls'];

const REPO_ROOT = new URL('../../', import.meta.url);
const REMOVED_KEY = 'dops.bundled.removed';

/** Bundled mods the player deleted on purpose. Deleting must mean deleting. */
export function removedBundled() {
  try { return new Set(JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveRemoved(set) {
  try { localStorage.setItem(REMOVED_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
}

export function markRemoved(id) {
  const set = removedBundled();
  set.add(id);
  saveRemoved(set);
}

export function restoreAll() { saveRemoved(new Set()); }

/**
 * Install or update every bundled mod that is missing or out of date.
 *
 * @param {(file: File, opts?: object) => Promise<any>} installMod
 * @param {() => Promise<Array>} listMods
 * @returns {Promise<string[]>} names of the mods that were installed or updated
 */
export async function installBundled(installMod, listMods) {
  const installed = await listMods();
  const byId = new Map(installed.map((m) => [m.id, m]));
  const skip = removedBundled();
  const done = [];

  for (const dir of BUNDLED) {
    try {
      const root = new URL(dir + '/', REPO_ROOT);
      const res = await fetch(new URL('mod.json', root).href, { cache: 'no-store' });
      if (!res.ok) throw new Error('mod.json -> HTTP ' + res.status);
      const manifestText = await res.text();
      const manifest = JSON.parse(manifestText);

      if (skip.has(manifest.id)) continue;
      const existing = byId.get(manifest.id);
      if (existing && existing.version === manifest.version) continue;

      const entries = [{ name: 'mod.json', data: new TextEncoder().encode(manifestText) }];
      for (const path of manifest.files || []) {
        const f = await fetch(new URL(path, REPO_ROOT).href, { cache: 'no-store' });
        if (!f.ok) throw new Error(path + ' -> HTTP ' + f.status);
        entries.push({ name: path, data: new Uint8Array(await f.arrayBuffer()) });
      }

      const zip = zipStore(entries);
      await installMod(new File([zip], manifest.id + '.zip', { type: 'application/zip' }),
        { source: 'bundled' });
      done.push(manifest.name || manifest.id);
    } catch (err) {
      // A bundled mod that will not install must not take the launcher with it.
      console.warn('[dops] bundled mod "' + dir + '" could not be installed', err);
    }
  }
  return done;
}
