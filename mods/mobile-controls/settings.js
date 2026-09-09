// The touch-control settings panel, built inside the game itself.
//
// It belongs here rather than in the launcher for two reasons: you want to
// adjust a button while you can see where it sits, and the panel is part of this
// mod - switch the mod off and the button that opens it is gone with it, which
// is exactly what should happen to settings for something that is not running.
//
// The markup reuses the game's own classes, so it inherits the sketchbook look
// without this mod shipping a stylesheet.

import { prefs, setPref, resetPrefs, DEFAULTS, hasTouch } from '../../launcher/js/prefs.js';

const FIELDS = [
  { key: 'touchMode', label: 'Kontrol sentuh', type: 'select', options: [
    ['auto', 'otomatis (kalau ada layar sentuh)'],
    ['on', 'selalu nyala'],
    ['off', 'mati (keyboard + mouse)'],
  ] },

  { key: 'lookSensitivity', label: 'Sensitivitas geser kamera', min: 0.2, max: 3, step: 0.05 },
  { key: 'buttonScale', label: 'Ukuran tombol', min: 0.7, max: 1.6, step: 0.05 },
  { key: 'joystickSize', label: 'Ukuran joystick', min: 0.7, max: 1.5, step: 0.05 },
  { key: 'opacity', label: 'Ketebalan tampilan tombol', min: 0.2, max: 1, step: 0.05 },

  { key: 'joystickMode', label: 'Mode joystick', type: 'select', options: [
    ['fixed', 'tetap di pojok'],
    ['floating', 'mengambang (muncul di tempat jempol menyentuh)'],
  ] },

  { key: 'tapMaxMs', label: 'Batas ketukan', min: 120, max: 400, step: 10,
    note: 'Lebih lama dari ini dihitung "tahan", bukan "ketuk".' },
  { key: 'tapMaxMove', label: 'Toleransi geser saat mengetuk', min: 6, max: 40, step: 1 },

  { key: 'tapToShoot', label: 'Ketuk layar kosong = tembak / tebas', type: 'toggle' },
  { key: 'holdToAutoFire', label: 'Tahan layar kosong = tembak terus', type: 'toggle',
    note: 'Bentrok dengan geser kamera. Mati secara bawaan.' },
  { key: 'leftHanded', label: 'Layout kidal (joystick ke kanan)', type: 'toggle' },
  { key: 'showFireButton', label: 'Tampilkan tombol FIRE', type: 'toggle' },
  { key: 'showScopeButton', label: 'Tampilkan tombol SCOPE', type: 'toggle' },
  { key: 'showSlotChips', label: 'Tampilkan chip senjata (KNIFE / GUN)', type: 'toggle' },
  { key: 'hideDesktopHud', label: 'Sembunyikan strip senjata bawaan game', type: 'toggle' },
  { key: 'haptics', label: 'Getar saat tombol ditekan', type: 'toggle' },

  { group: 'Launcher', note: 'Berlaku saat berikutnya menekan MAIN di launcher.' },
  { key: 'autoFullscreen', label: 'Layar penuh saat mulai main', type: 'toggle' },
  { key: 'lockLandscape', label: 'Kunci ke mode lanskap', type: 'toggle' },
  { key: 'keepAwake', label: 'Cegah layar mati saat main', type: 'toggle' },
];

function format(key, value) {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (key === 'opacity') return Math.round(value * 100) + '%';
  if (key === 'tapMaxMs') return Math.round(value) + 'ms';
  if (key === 'tapMaxMove') return Math.round(value) + 'px';
  if (typeof value === 'number') return value.toFixed(2) + '×';
  return String(value);
}

/**
 * Adds an "ATUR KONTROL" button to the game's start screen and pause menu, plus
 * the panel they open.
 *
 * @returns {() => void} how to take all of it back off again
 */
export function mountSettingsPanel() {
  const doc = document;
  const outs = new Map();

  /* ------------------------------------------------------------- the panel */

  const modal = doc.createElement('div');
  modal.id = 'dops-settings';
  // Visibility is driven by `display` alone. Setting an inline `display: grid`
  // here and then relying on the `hidden` attribute does not work - an inline
  // style beats the user agent's `[hidden] { display: none }`, so the panel
  // stays on screen while every check of `.hidden` cheerfully reports true.
  Object.assign(modal.style, {
    position: 'fixed', inset: '0', zIndex: '6', display: 'none', placeItems: 'center',
    padding: '16px', overflowY: 'auto', background: 'rgba(34, 32, 43, 0.45)',
  });

  const sheet = doc.createElement('div');
  sheet.className = 'sheet sheet-wide';
  sheet.style.filter = 'none';          // the wobble filter clips a scrolling list
  modal.appendChild(sheet);

  // A back button at the top, where anyone looking for the way out looks first.
  // There is a SELESAI at the bottom too, but a long settings list must never
  // need scrolling to escape.
  const bar = doc.createElement('div');
  Object.assign(bar.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '10px', marginBottom: '6px',
  });

  const back = doc.createElement('button');
  back.type = 'button';
  back.className = 'big-button ghost';
  back.textContent = '‹ KEMBALI';
  // The game's .big-button is a full-width block at 19px; shrink it to a chip so
  // it sits beside the title instead of wrapping it onto two lines.
  Object.assign(back.style, {
    width: 'auto', flex: 'none', fontSize: '13px', letterSpacing: '0.5px',
    padding: '8px 12px', borderWidth: '2px', whiteSpace: 'nowrap',
  });
  back.addEventListener('click', (e) => { e.preventDefault(); close(); });

  const title = doc.createElement('h2');
  title.className = 'title small';
  title.textContent = 'KONTROL SENTUH';
  title.style.margin = '0';
  title.style.flex = '1';
  title.style.whiteSpace = 'nowrap';

  const spacer = doc.createElement('span');
  spacer.style.flex = 'none';
  spacer.style.width = '92px';          // mirrors the button, so the title sits centred

  bar.append(back, title, spacer);
  sheet.appendChild(bar);

  const sub = doc.createElement('p');
  sub.className = 'subtitle';
  sub.textContent = 'semua tombol multitouch · ketuk layar kosong = tembak · geser = kamera';
  sheet.appendChild(sub);

  // "auto" is the source of every "I turned it on and nothing happened" - on a
  // desktop browser there is no touchscreen to detect, so say so plainly and
  // point at the setting that overrides it.
  const detect = doc.createElement('p');
  detect.className = 'note';
  detect.style.marginBottom = '14px';
  sheet.appendChild(detect);

  const list = doc.createElement('div');
  list.className = 'settings';
  sheet.appendChild(list);

  for (const f of FIELDS) list.appendChild(f.group ? groupHeading(f) : field(f));

  const row = doc.createElement('div');
  row.className = 'button-row';
  row.append(
    bigButton('SELESAI', false, close),
    bigButton('RESET', true, () => { resetPrefs(); sync(); }),
  );
  sheet.appendChild(row);

  const help = doc.createElement('p');
  help.className = 'note';
  help.textContent = 'Perubahan langsung terlihat di layar. Kontrol sentuh ini adalah mod bawaan — ' +
    'matikan dari MOD di launcher dan game kembali ke keyboard + mouse.';
  sheet.appendChild(help);

  doc.body.appendChild(modal);

  // Swallow presses so the game's "click the paper to resume" never fires from
  // inside the panel.
  for (const type of ['mousedown', 'pointerdown', 'click']) {
    modal.addEventListener(type, (e) => e.stopPropagation());
  }

  // Pressing the dark area outside the sheet closes it, the way a dialog should.
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Escape closes the panel rather than reaching the game, which would pause it
  // underneath and leave you looking at two menus at once.
  const onKey = (e) => {
    if (!isOpen() || e.code !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  window.addEventListener('keydown', onKey, true);

  /* ---------------------------------------------------------- the entry points */

  const openers = [];

  // On the start screen, right under PLAY.
  const play = doc.getElementById('btn-play');
  if (play && play.parentNode) {
    const b = bigButton('KONTROL SENTUH', true, open);
    b.style.marginTop = '10px';
    play.parentNode.insertBefore(b, play.nextSibling);
    openers.push(b);
  }

  // And in the pause menu, next to RESUME.
  const pauseRow = doc.querySelector('#screen-pause .button-row');
  if (pauseRow) {
    const b = bigButton('KONTROL SENTUH', true, open);
    pauseRow.appendChild(b);
    openers.push(b);
  }

  sync();

  function isOpen() { return modal.style.display !== 'none'; }
  function open() { modal.style.display = 'grid'; sync(); }
  function close() { modal.style.display = 'none'; }

  return () => {
    window.removeEventListener('keydown', onKey, true);
    modal.remove();
    for (const b of openers) b.remove();
  };

  /* ------------------------------------------------------------------ bits */

  function bigButton(text, ghost, onClick) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'big-button' + (ghost ? ' ghost' : '');
    b.textContent = text;
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }

  function groupHeading(f) {
    const wrap = doc.createElement('div');
    wrap.className = 'setting';
    wrap.style.gridTemplateColumns = '1fr';
    wrap.style.marginTop = '10px';
    const h = doc.createElement('strong');
    h.textContent = f.group;
    wrap.appendChild(h);
    if (f.note) {
      const em = doc.createElement('em');
      em.textContent = ' — ' + f.note;
      wrap.appendChild(em);
    }
    return wrap;
  }

  function field(f) {
    const wrap = doc.createElement('div');
    wrap.className = 'setting' + (f.type === 'toggle' ? ' toggle' : '');

    const label = doc.createElement('label');
    label.textContent = f.label;
    if (f.note) {
      const em = doc.createElement('em');
      em.textContent = ' ' + f.note;
      label.appendChild(em);
    }
    wrap.appendChild(label);

    let control;
    if (f.type === 'toggle') {
      control = doc.createElement('input');
      control.type = 'checkbox';
    } else if (f.type === 'select') {
      control = doc.createElement('select');
      for (const [value, text] of f.options) {
        const o = doc.createElement('option');
        o.value = value;
        o.textContent = text;
        control.appendChild(o);
      }
    } else {
      control = doc.createElement('input');
      control.type = 'range';
      control.min = f.min; control.max = f.max; control.step = f.step;
    }
    control.id = 'dops-set-' + f.key;
    label.htmlFor = control.id;
    control.addEventListener('input', () => {
      let value;
      if (control.type === 'checkbox') value = control.checked;
      else if (typeof DEFAULTS[f.key] === 'number') value = parseFloat(control.value);
      else value = control.value;
      setPref(f.key, value);
      sync();
    });
    wrap.appendChild(control);

    if (f.type !== 'toggle') {
      const out = doc.createElement('output');
      wrap.appendChild(out);
      outs.set(f.key, out);
    }
    wrap.dataset.key = f.key;
    return wrap;
  }

  function sync() {
    const touch = hasTouch();
    const live = prefs.touchMode === 'on' || (prefs.touchMode === 'auto' && touch);
    detect.textContent =
      'Layar sentuh terdeteksi: ' + (touch ? 'ya' : 'tidak') + ' · ' +
      'tombol di layar sekarang: ' + (live ? 'tampil' : 'tidak tampil') +
      (!live && prefs.touchMode === 'auto'
        ? ' — di browser desktop tidak ada layar sentuh untuk dideteksi, jadi setel "selalu nyala" untuk memaksanya tampil.'
        : '');

    for (const f of FIELDS) {
      if (f.group) continue;
      const c = doc.getElementById('dops-set-' + f.key);
      if (!c) continue;
      if (c.type === 'checkbox') c.checked = !!prefs[f.key];
      else c.value = prefs[f.key];
      const out = outs.get(f.key);
      if (out) out.textContent = format(f.key, prefs[f.key]);
    }
  }
}
