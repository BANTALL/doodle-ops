// Installing, listing, ordering and removing mods.
//
// A mod is a .zip whose paths mirror the repo. Drop src/player.js in the zip and
// the game loads your player.js instead of the one on GitHub. There is no list of
// moddable files anywhere in this codebase - whatever path you put in the zip is
// the path that gets replaced, which is what makes the system open-ended.

import { all, get, put, putMany, del, deleteByMod } from './db.js';
import { unzip, ZipError } from './unzip.js';
import { markRemoved } from './bundled.js';

/** Files inside the zip that are metadata or junk rather than overrides. */
const IGNORED = [
  /^__MACOSX\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/,
  /(^|\/)\._/,
];

/** Paths a mod is not allowed to take over, because it would lock the player out. */
const PROTECTED = [
  /^sw\.js$/,
  /^launcher\//,
];

export class ModError extends Error {}

/* ------------------------------------------------------------------ reading */

export async function listMods() {
  const mods = await all('mods');
  return mods.sort((a, b) => (a.priority || 0) - (b.priority || 0));
}

export async function getMod(id) { return get('mods', id); }

export async function readModFile(modId, path) {
  const rec = await get('files', modId + ' ' + path);
  return rec ? rec.data : null;
}

/** path -> mod that currently wins it. Drives the conflict badges in the UI. */
export async function conflictMap() {
  const mods = (await listMods()).filter((m) => m.enabled);
  const owners = new Map();
  for (const m of mods) {
    for (const p of m.files) {
      if (!owners.has(p)) owners.set(p, []);
      owners.get(p).push(m);
    }
  }
  return owners;
}

/* --------------------------------------------------------------- installing */

/**
 * @param {File|Blob} file  the .zip the player picked
 * @returns {Promise<object>} the installed mod record
 */
export async function installMod(file, options = {}) {
  const buf = await file.arrayBuffer();

  let entries;
  try {
    entries = await unzip(buf);
  } catch (err) {
    throw new ModError(err instanceof ZipError ? err.message : 'Could not read that zip: ' + err.message);
  }

  const files = entries.filter((e) => !e.dir && !IGNORED.some((re) => re.test(e.name)));
  if (!files.length) throw new ModError('That zip is empty once the junk files are dropped.');

  const prefix = commonPrefix(files.map((e) => e.name));
  const stripped = files.map((e) => ({ ...e, path: normalise(e.name.slice(prefix.length)) }))
    .filter((e) => e.path);

  // ---- manifest
  const manifestEntry = stripped.find((e) => e.path === 'mod.json');
  let manifest = {};
  if (manifestEntry) {
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
    } catch (err) {
      throw new ModError('mod.json is not valid JSON: ' + err.message);
    }
  }

  const fallbackName = (file.name || 'mod').replace(/\.zip$/i, '');
  const name = String(manifest.name || fallbackName).trim() || fallbackName;
  const id = slug(manifest.id || name);
  if (!id) throw new ModError('Could not work out a name for this mod. Add "name" to mod.json.');

  // ---- overrides
  const overrides = stripped.filter((e) => e.path !== 'mod.json');
  const blocked = overrides.filter((e) => PROTECTED.some((re) => re.test(e.path)));
  if (blocked.length) {
    throw new ModError('This mod tries to replace the launcher itself (' +
      blocked.map((e) => e.path).join(', ') + '). Refusing to install it - ' +
      'that would leave you with no way to turn it back off.');
  }
  if (!overrides.length) {
    throw new ModError('This mod has a mod.json but no files to override. ' +
      'Put the files you want to change in the zip, at the same paths they have in the repo ' +
      '(for example src/player.js).');
  }

  // Scripts named in the manifest are run after the game boots. They are also
  // stored as normal overrides, so they can equally well replace a real file.
  const scripts = Array.isArray(manifest.scripts)
    ? manifest.scripts.map(normalise).filter(Boolean)
    : [];
  for (const s of scripts) {
    if (!overrides.some((e) => e.path === s)) {
      throw new ModError('mod.json lists the script "' + s + '" but the zip does not contain it.');
    }
  }

  const existing = await get('mods', id);
  const size = overrides.reduce((n, e) => n + e.data.byteLength, 0);
  const added = await detectNewFiles(overrides.map((e) => e.path));

  const record = {
    id,
    name,
    version: String(manifest.version || '1.0.0'),
    author: String(manifest.author || 'unknown'),
    description: String(manifest.description || ''),
    scripts,
    files: overrides.map((e) => e.path).sort(),
    added,                    // paths that do not exist upstream: brand-new files
    size,
    zipName: file.name || (id + '.zip'),
    // Where it came from. Purely informational - nothing branches on it.
    source: options.source || 'file',
    installedAt: Date.now(),
    // Reinstalling keeps where the mod sat in the load order and whether it was on.
    enabled: existing ? existing.enabled : true,
    priority: existing ? existing.priority : await nextPriority(),
  };

  if (existing) await deleteByMod(id);
  await putMany('files', overrides.map((e) => ({
    key: id + ' ' + e.path,
    modId: id,
    path: e.path,
    data: e.data,
  })));
  await put('mods', record);
  await invalidate();
  return { record, replaced: !!existing };
}

async function nextPriority() {
  const mods = await all('mods');
  return mods.reduce((n, m) => Math.max(n, m.priority || 0), 0) + 1;
}

/* ----------------------------------------------------------------- mutating */

export async function setEnabled(id, enabled) {
  const m = await get('mods', id);
  if (!m) return;
  m.enabled = !!enabled;
  await put('mods', m);
  await invalidate();
}

export async function removeMod(id) {
  const mod = await get('mods', id);
  await deleteByMod(id);
  await del('mods', id);
  // A mod that shipped with the repo would otherwise be reinstalled on the next
  // boot, so remember that this one was deleted on purpose.
  if (mod && mod.source === 'bundled') markRemoved(id);
  await invalidate();
}

/** Move a mod up or down the load order. Later = wins conflicts. */
export async function reorder(id, direction) {
  const mods = await listMods();
  const i = mods.findIndex((m) => m.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= mods.length) return;
  [mods[i], mods[j]] = [mods[j], mods[i]];
  for (let k = 0; k < mods.length; k++) mods[k].priority = k + 1;
  await putMany('mods', mods);
  await invalidate();
}

export async function setAllEnabled(enabled) {
  const mods = await listMods();
  for (const m of mods) m.enabled = !!enabled;
  await putMany('mods', mods);
  await invalidate();
}

/* ------------------------------------------------------------------ helpers */

const REPO_ROOT = new URL('../../', import.meta.url);
const PROBE_LIMIT = 80;       // a mod with hundreds of files is not worth 300 HEADs

/**
 * Which of these paths are files the mod *adds* rather than replaces?
 *
 * A mod is not limited to overwriting what upstream ships - any path it puts in
 * the zip is served, existing or not, so it can bring new modules, new textures,
 * new audio, whatever its own code asks for. This works out which is which purely
 * so the UI can say so.
 *
 * The launcher page is deliberately not marked with ?dops=1, so these requests
 * pass straight through the service worker to the real files on the server.
 */
async function detectNewFiles(paths) {
  if (typeof fetch !== 'function' || paths.length > PROBE_LIMIT) return [];
  const results = await Promise.all(paths.map(async (p) => {
    try {
      const res = await fetch(new URL(p, REPO_ROOT).href, { method: 'HEAD', cache: 'no-store' });
      return res.ok ? null : p;
    } catch {
      return null;             // offline or blocked: assume it replaces something
    }
  }));
  return results.filter(Boolean);
}

/** Tell the service worker its override map is stale. */
export async function invalidate() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const target = (reg && (reg.active || reg.waiting)) || navigator.serviceWorker.controller;
    if (target) target.postMessage({ type: 'dops:invalidate' });
  } catch { /* no worker yet, nothing to invalidate */ }
}

/** Zipping a folder usually nests everything under it. Peel that wrapper off. */
function commonPrefix(names) {
  if (names.length === 0) return '';
  const first = names[0];
  const slash = first.indexOf('/');
  if (slash < 0) return '';
  const candidate = first.slice(0, slash + 1);
  return names.every((n) => n.startsWith(candidate)) ? candidate : '';
}

/** Repo-relative, forward slashes, no leading ./ or ../ escapes. */
function normalise(path) {
  const parts = String(path).replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

function slug(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
}
