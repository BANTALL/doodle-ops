// Launcher shell: screen routing, service worker, the mods screen, the touch
// settings screen, and starting the game in a frame.

import { prefs, hasTouch, touchActive } from './prefs.js';
import { listMods, installMod, setEnabled, removeMod, reorder, setAllEnabled,
         conflictMap, formatBytes, ModError } from './modstore.js';
import { installBundled, removedBundled, restoreAll } from './bundled.js';
import { estimateStorage, db } from './db.js';
import { templateZip } from './template.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const GAME_URL = new URL('../index.html', location.href);
const SW_URL = new URL('../sw.js', location.href);
const SW_SCOPE = new URL('../', location.href);

const sw = { supported: 'serviceWorker' in navigator, registration: null, error: null };

/* ------------------------------------------------------------------ routing */

let current = 'home';

function show(name) {
  current = name;
  for (const el of $$('[data-screen]')) {
    el.classList.toggle('hidden', el.dataset.screen !== name);
  }
  if (name !== 'play') stopPlaying();
  if (name === 'mods') renderMods();
  if (name === 'about') renderAbout();
  window.scrollTo(0, 0);
  history.replaceState(null, '', '#' + name);
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  const target = go.dataset.go;
  if (target === 'play') startPlaying();
  else show(target);
});

window.addEventListener('popstate', () => {
  if (current === 'play') show('home');
});

/* ----------------------------------------------------------- service worker */

async function registerWorker() {
  const status = $('#home-status');
  if (!sw.supported) {
    sw.error = 'Browser ini tidak mendukung service worker.';
    status.textContent = 'Mod tidak bisa dipakai di browser ini. Kontrol sentuh tetap jalan.';
    status.className = 'status warn';
    return;
  }
  if (location.protocol === 'file:') {
    sw.error = 'Halaman dibuka lewat file://.';
    status.textContent = 'Buka lewat http(s) — mod butuh service worker, yang tidak jalan di file://.';
    status.className = 'status warn';
    return;
  }
  try {
    sw.registration = await navigator.serviceWorker.register(SW_URL.href, { scope: SW_SCOPE.href });
    await navigator.serviceWorker.ready;
    status.textContent = 'siap';
    status.className = 'status ok';
  } catch (err) {
    sw.error = String(err && err.message ? err.message : err);
    status.textContent = 'Service worker gagal: ' + sw.error + ' — mod dimatikan.';
    status.className = 'status warn';
  }
}

/* --------------------------------------------------------------------- mods */

// The pill counts installed mods; the built-in controls are always there and
// would just read as a permanent "1". Their settings live inside the game, so
// there is nothing else for the home screen to show.
async function refreshHome() {
  const mods = await listMods();

  const extra = mods.filter((m) => m.source !== 'bundled' && m.enabled);
  const pill = $('#mod-count');
  pill.textContent = String(extra.length);
  pill.style.display = extra.length ? '' : 'none';

  return mods.filter((m) => m.enabled).length;
}

async function renderMods() {
  const list = $('#mod-list');
  const mods = await listMods();
  const owners = await conflictMap();

  list.textContent = '';
  mods.forEach((m, i) => list.appendChild(modCard(m, i, mods.length, owners)));
  if (!mods.some((m) => m.source !== 'bundled')) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Belum ada mod tambahan. Ambil contoh .zip di atas untuk melihat bentuknya.';
    list.appendChild(empty);
  }

  const est = await estimateStorage();
  $('#storage-note').textContent = est && est.usage
    ? 'Terpakai ' + formatBytes(est.usage) +
      (est.quota ? ' dari sekitar ' + formatBytes(est.quota) + ' yang tersedia.' : '')
    : '';

  refreshHome();
}

function modCard(m, index, total, owners) {
  const card = document.createElement('div');
  const bundled = m.source === 'bundled';
  card.className = 'mod' + (m.enabled ? '' : ' off') + (bundled ? ' builtin' : '');

  const head = document.createElement('div');
  head.className = 'mod-head';

  const title = document.createElement('div');
  title.style.flex = '1';
  const h = document.createElement('h3');
  h.textContent = m.name;
  if (bundled) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'BAWAAN';
    h.title = 'Ikut dengan repo. Sama seperti mod lain - bisa dimatikan, diurutkan, ditimpa, dihapus.';
    h.appendChild(badge);
  }
  const meta = document.createElement('div');
  meta.className = 'mod-meta';
  meta.textContent = 'v' + m.version + ' · ' + m.author + ' · ' +
    (m.files.length ? m.files.length + ' file · ' + formatBytes(m.size) + ' · ' : '') +
    (m.scripts && m.scripts.length ? m.scripts.length + ' skrip · ' : '') +
    'urutan ' + (index + 1);
  title.append(h, meta);

  const toggle = document.createElement('button');
  toggle.className = 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(!!m.enabled));
  toggle.setAttribute('aria-label', (m.enabled ? 'Matikan ' : 'Nyalakan ') + m.name);
  toggle.addEventListener('click', async () => {
    await setEnabled(m.id, !m.enabled);
    notifyGame();     // undo it live if the game happens to be open...
    reloadGame();     // ...and reload anyway, so every patch is provably gone
    renderMods();
  });

  head.append(title, toggle);
  card.appendChild(head);

  if (m.description) {
    const d = document.createElement('p');
    d.className = 'mod-desc';
    d.textContent = m.description;
    card.appendChild(d);
  }

  // File list, with the ones another enabled mod also claims marked in red.
  const details = document.createElement('details');
  details.className = 'mod-files';
  const summary = document.createElement('summary');
  const clashes = m.enabled
    ? m.files.filter((p) => (owners.get(p) || []).length > 1).length
    : 0;
  const added = new Set(m.added || []);
  summary.textContent = 'File yang dibawa mod ini · ' + m.files.length +
    (added.size ? ' (' + added.size + ' file baru)' : '') +
    (clashes ? ' · ' + clashes + ' bentrok' : '');
  const ul = document.createElement('ul');
  for (const p of m.files) {
    const li = document.createElement('li');
    const winners = owners.get(p) || [];
    const loses = m.enabled && winners.length > 1 && winners[winners.length - 1].id !== m.id;
    li.textContent = p;
    const tag = document.createElement('span');
    tag.className = 'tag ' + (added.has(p) ? 'new' : 'over');
    tag.textContent = added.has(p) ? 'baru' : 'ganti';
    li.appendChild(tag);
    if (loses) {
      const s = document.createElement('span');
      s.className = 'clash';
      s.textContent = ' — dikalahkan oleh ' + winners[winners.length - 1].name;
      li.appendChild(s);
    }
    ul.appendChild(li);
  }
  details.append(summary, ul);
  card.appendChild(details);

  const actions = document.createElement('div');
  actions.className = 'mod-actions';
  actions.append(
    chip('↑ NAIK', index === 0, async () => { await reorder(m.id, -1); renderMods(); }),
    chip('↓ TURUN', index === total - 1, async () => { await reorder(m.id, 1); renderMods(); }),
  );
  actions.append(chip('HAPUS', false, async () => {
    const extra = bundled
      ? '\n\nIni mod bawaan repo. Ia tidak akan dipasang ulang sampai kamu menekan PULIHKAN MOD BAWAAN.'
      : '';
    if (!confirm('Hapus "' + m.name + '"? File modnya dibuang dari perangkat ini.' + extra)) return;
    await removeMod(m.id);
    notifyGame();
    reloadGame();
    renderMods();
  }));
  card.appendChild(actions);
  return card;
}

function chip(text, disabled, onClick) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = text;
  b.disabled = !!disabled;
  if (disabled) b.style.opacity = '0.4';
  else b.addEventListener('click', onClick);
  return b;
}

function message(text, kind) {
  const el = $('#mod-msg');
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

async function handleFiles(files) {
  const zips = Array.from(files).filter((f) => /\.zip$/i.test(f.name) || f.type === 'application/zip');
  if (!zips.length) { message('Pilih file .zip.', 'err'); return; }

  const done = [];
  for (const f of zips) {
    try {
      const { record, replaced } = await installMod(f);
      done.push(record.name + (replaced ? ' (diperbarui)' : ''));
    } catch (err) {
      const why = err instanceof ModError ? err.message : String(err && err.message ? err.message : err);
      message('Gagal memasang ' + f.name + ': ' + why, 'err');
      await renderMods();
      return;
    }
  }
  message('Terpasang: ' + done.join(', ') + '. Mulai ulang game agar mod termuat.', 'ok');
  await renderMods();
}

/* ---------------------------------------------------------------- mods wiring */

$('#btn-pick').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});

const dz = $('#dropzone');
for (const type of ['dragenter', 'dragover']) {
  dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.remove('over'); });
}
dz.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

$('#btn-restore').addEventListener('click', async () => {
  restoreAll();
  const done = await installBundled(installMod, listMods);
  message(done.length ? 'Dipulihkan: ' + done.join(', ') + '.' : 'Tidak ada mod bawaan yang perlu dipulihkan.', 'ok');
  renderMods();
});

$('#btn-all-on').addEventListener('click', async () => { await setAllEnabled(true); renderMods(); });
$('#btn-all-off').addEventListener('click', async () => { await setAllEnabled(false); renderMods(); });

$('#btn-template').addEventListener('click', () => {
  const url = URL.createObjectURL(templateZip());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'contoh-mod.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

/* --------------------------------------------------------------------- about */

async function renderAbout() {
  const mods = await listMods();
  const est = await estimateStorage();
  let dbOk = 'ya';
  try { await db(); } catch (err) { dbOk = 'tidak — ' + err.message; }

  const rows = [
    ['Game', GAME_URL.href],
    ['Service worker', sw.registration ? 'aktif (' + SW_SCOPE.pathname + ')' : 'tidak aktif' + (sw.error ? ' — ' + sw.error : '')],
    ['Mengendalikan halaman', (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'ya' : 'belum (muat ulang sekali)'],
    ['Penyimpanan mod', dbOk],
    ['Mod terpasang', mods.length + ' (' + mods.filter((m) => m.enabled).length + ' aktif)'],
    ['Ruang terpakai', est && est.usage ? formatBytes(est.usage) : 'tidak diketahui'],
    ['Layar sentuh terdeteksi', hasTouch() ? 'ya' : 'tidak'],
    ['Kontrol sentuh', touchActive() ? 'nyala' : 'mati'],
    ['Upstream', 'github.com/osnailcyargta-ctrl/fps'],
    ['Fork ini', 'github.com/bantall/doodle-ops'],
  ];
  const dl = $('#about-status');
  dl.textContent = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

$('#btn-update-sw').addEventListener('click', async () => {
  if (!sw.registration) { alert('Service worker belum aktif.'); return; }
  await sw.registration.update();
  alert('Dicek. Muat ulang halaman untuk memakai versi baru.');
});

$('#btn-open-raw').addEventListener('click', () => {
  window.open(GAME_URL.href, '_blank', 'noopener');
});

$('#btn-wipe').addEventListener('click', async () => {
  if (!confirm('Hapus SEMUA mod dari perangkat ini? Tidak bisa dibatalkan.')) return;
  for (const m of await listMods()) await removeMod(m.id);
  await renderAbout();
  await refreshHome();
  alert('Semua mod dihapus.');
});

/* --------------------------------------------------------------------- play */

const frame = $('#game-frame');
let wakeLock = null;

async function startPlaying() {
  show('play');

  if (prefs.autoFullscreen) {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* denied or unsupported */ }
  }
  if (prefs.lockLandscape && screen.orientation && screen.orientation.lock) {
    try { await screen.orientation.lock('landscape'); } catch { /* desktop, or the browser says no */ }
  }
  if (prefs.keepAwake && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not granted */ }
  }

  // A fresh URL every time, so toggling a mod and pressing MAIN reloads the game
  // with the new set of overrides instead of a cached module graph.
  const url = new URL(GAME_URL);
  url.searchParams.set('dops', '1');
  url.searchParams.set('t', String(Date.now()));
  frame.src = url.href;
}

// Without a service worker the game still gets its touch controls - the launcher
// injects the same runtime by hand, since the frame is same-origin. Mods do need
// the worker, because only it can answer the game's own file requests.
frame.addEventListener('load', () => {
  try {
    const d = frame.contentDocument;
    if (!d || d.getElementById('dops-injected')) return;
    if (frame.contentWindow.__dopsRuntime) return;   // the worker already did it

    const base = new URL('../', location.href).href;
    const link = d.createElement('link');
    link.rel = 'stylesheet';
    link.href = base + 'launcher/runtime/touch.css';
    const script = d.createElement('script');
    script.id = 'dops-injected';
    script.type = 'module';
    script.src = base + 'launcher/runtime/inject.js';
    d.head.appendChild(link);
    d.body.appendChild(script);
  } catch (err) {
    console.warn('[dops] could not inject the runtime by hand', err);
  }
});

/** Tell a running game that the mod list changed, so it can unwind what is off. */
function notifyGame() {
  if (!frame.getAttribute('src') || !frame.contentWindow) return;
  try { frame.contentWindow.postMessage({ type: 'dops:mods-changed' }, location.origin); }
  catch { /* frame is gone or cross-origin, nothing to tell */ }
}

/** A mod that was just switched on can only take effect on a fresh load. */
function reloadGame() {
  if (!frame.getAttribute('src') || !frame.contentWindow) return;
  try { frame.contentWindow.location.reload(); } catch { /* frame is gone */ }
}

function stopPlaying() {
  if (frame.src) frame.removeAttribute('src');
  if (wakeLock) { try { wakeLock.release(); } catch { /* already gone */ } wakeLock = null; }
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch { /* ignore */ }
  }
}

$('#btn-back').addEventListener('click', () => show('home'));

document.addEventListener('visibilitychange', async () => {
  // A screen wake lock is dropped when the tab is hidden; take it again on return.
  if (document.visibilityState === 'visible' && current === 'play' && prefs.keepAwake &&
      navigator.wakeLock && !wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not granted */ }
  }
});

/* --------------------------------------------------------------------- boot */

registerWorker();

// Mods that ship with the repo are installed through the same code path as a
// player's .zip, so from here on there is only one kind of mod.
installBundled(installMod, listMods)
  .catch((err) => console.warn('[dops] could not install the bundled mods', err))
  .finally(() => {
    refreshHome();
    if (current === 'mods') renderMods();
  });

const start = (location.hash || '#home').slice(1);
show(['home', 'mods', 'about'].includes(start) ? start : 'home');
