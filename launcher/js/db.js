// IndexedDB wrapper shared by the launcher UI. The service worker opens the same
// database with the same schema (see /sw.js) - keep the two in step.
//
// Why not localStorage: it caps out around 5MB of *strings*, and a mod that
// replaces a texture or an mp3 blows past that immediately. IndexedDB stores the
// bytes as bytes, has no practical size limit, and is readable from a service
// worker, which localStorage is not.

const DB_NAME = 'doodleops-launcher';
const DB_VERSION = 1;

let dbPromise = null;

export function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('mods')) d.createObjectStore('mods', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) {
        const s = d.createObjectStore('files', { keyPath: 'key' });
        s.createIndex('modId', 'modId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Another tab is holding the mod database open. Close it and retry.'));
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all(store) {
  const d = await db();
  return wrap(d.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, key) {
  const d = await db();
  return wrap(d.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function put(store, value) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function del(store, key) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

/** Write many records in one transaction - installing a mod is one atomic step. */
export async function putMany(store, values) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return done(tx);
}

/** Delete every file belonging to one mod. */
export async function deleteByMod(modId) {
  const d = await db();
  const tx = d.transaction('files', 'readwrite');
  const idx = tx.objectStore('files').index('modId');
  const req = idx.openKeyCursor(IDBKeyRange.only(modId));
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    tx.objectStore('files').delete(cur.primaryKey);
    cur.continue();
  };
  return done(tx);
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Rough numbers for the storage bar in the mods screen. */
export async function estimateStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
