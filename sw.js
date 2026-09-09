/* =============================================================================
 * DOODLE OPS — Launcher Service Worker
 * -----------------------------------------------------------------------------
 * This is the whole trick behind the mod system. It sits between the game and
 * the network and answers requests out of IndexedDB whenever an enabled mod
 * ships a file at that path. Nothing in the game's own source is touched, and
 * nothing is hardcoded: a mod can replace src/player.js, styles.css, an mp3 in
 * assets/, or index.html itself, purely by including a file with that path.
 *
 * It is a classic (non-module) worker on purpose - module workers are still not
 * universal on mobile Safari, and this file has to work everywhere the game does.
 * ========================================================================== */

const DB_NAME = 'doodleops-launcher';
const DB_VERSION = 1;
const MARKER = 'dops';          // ?dops=1 marks a page the launcher owns

/* --------------------------------------------------------------- lifecycle */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'dops:invalidate') { cache.map = null; cache.at = 0; }
  if (msg.type === 'dops:ping') e.source && e.source.postMessage({ type: 'dops:pong', version: 1 });
});

/* ----------------------------------------------------------------- indexeddb */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('mods')) db.createObjectStore('mods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'key' });
        s.createIndex('modId', 'modId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getOne(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------- override map */

// path -> { modId, modName } for the winning mod. Rebuilt whenever the launcher
// says something changed, and at most once a second otherwise.
const cache = { map: null, at: 0 };

async function overrideMap() {
  const now = Date.now();
  if (cache.map && now - cache.at < 1000) return cache.map;
  const map = new Map();
  try {
    const db = await openDb();
    const mods = (await getAll(db, 'mods'))
      .filter((m) => m.enabled)
      // Lower priority number is applied first, so a later mod wins a conflict.
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    for (const m of mods) {
      for (const p of m.files || []) map.set(p, { modId: m.id, modName: m.name });
    }
  } catch (err) {
    // A broken database must never take the game down - just serve it unmodded.
    console.warn('[dops-sw] mod lookup failed', err);
  }
  cache.map = map; cache.at = now;
  return map;
}

/* ------------------------------------------------------------------- helpers */

const MIME = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  webm: 'video/webm', mp4: 'video/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  glsl: 'text/plain; charset=utf-8', frag: 'text/plain; charset=utf-8',
  vert: 'text/plain; charset=utf-8', wasm: 'application/wasm',
};

function mimeFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function scopePath() {
  return new URL(self.registration.scope).pathname;   // e.g. "/doodle-ops/"
}

/** Is the page that asked for this a launcher-managed page? */
async function isLauncherRequest(event) {
  const req = event.request;
  if (req.mode === 'navigate') {
    return new URL(req.url).searchParams.get(MARKER) === '1';
  }
  const id = event.clientId || event.resultingClientId;
  if (id) {
    try {
      const client = await self.clients.get(id);
      if (client) return new URL(client.url).searchParams.get(MARKER) === '1';
    } catch { /* client already gone */ }
  }
  // Worker / no-client requests fall back to the referrer.
  if (req.referrer) {
    try { return new URL(req.referrer).searchParams.get(MARKER) === '1'; } catch { /* bad referrer */ }
  }
  return false;
}

/* ---------------------------------------------------------------- injection */

// The launcher's runtime is spliced into the game's HTML here rather than being
// committed into index.html. That keeps index.html byte-identical to upstream,
// which is what makes `git merge upstream/main` a no-op forever.
function injectRuntime(html, base) {
  const tags = [
    '',
    '<!-- injected at runtime by the DOODLE OPS launcher service worker -->',
    '<link rel="stylesheet" href="' + base + 'launcher/runtime/touch.css">',
    '<script type="module" src="' + base + 'launcher/runtime/inject.js"></script>',
    '',
  ].join('\n');
  if (html.includes('</body>')) return html.replace('</body>', tags + '</body>');
  return html + tags;
}

/* -------------------------------------------------------------------- fetch */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  const base = scopePath();
  if (!url.pathname.startsWith(base)) return;

  let rel = url.pathname.slice(base.length);
  if (rel === '') rel = 'index.html';

  // The launcher and this worker are never moddable. If a mod could replace the
  // mod manager, one bad mod would lock you out with no way back.
  if (rel === 'sw.js' || rel.startsWith('launcher/')) return;

  event.respondWith(handle(event, req, rel, base));
});

async function handle(event, req, rel, base) {
  let launcher = false;
  try { launcher = await isLauncherRequest(event); } catch { /* treat as vanilla */ }

  // --- the game document: serve upstream HTML with the runtime spliced in.
  if (launcher && (rel === 'index.html' || rel.endsWith('/index.html'))) {
    try {
      const override = (await overrideMap()).get(rel);
      let html = null;
      if (override) {
        const rec = await readFile(override.modId, rel);
        if (rec) html = await asText(rec.data);
      }
      if (html == null) {
        const res = await fetch(new Request(req.url, { cache: 'reload' }));
        if (!res.ok) return res;
        html = await res.text();
      }
      return new Response(injectRuntime(html, base), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      console.warn('[dops-sw] html inject failed', err);
      return fetch(req);
    }
  }

  // --- everything else: swap in a mod file when one claims this path.
  if (launcher) {
    try {
      const hit = (await overrideMap()).get(rel);
      if (hit) {
        const rec = await readFile(hit.modId, rel);
        if (rec) {
          return new Response(rec.data, {
            headers: {
              'Content-Type': mimeFor(rel),
              'Cache-Control': 'no-store',
              'X-Doodle-Mod': hit.modId,
            },
          });
        }
      }
    } catch (err) {
      console.warn('[dops-sw] override failed for', rel, err);
    }
  }

  return fetch(req);
}

async function readFile(modId, path) {
  const db = await openDb();
  return getOne(db, 'files', modId + ' ' + path);
}

async function asText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}
