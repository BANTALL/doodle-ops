// Touch controls for DOODLE OPS.
//
// The game itself is never edited. This file builds an overlay and then writes
// straight into the live `game.input` object - the same fields the keyboard and
// mouse listeners write - so from the game's point of view a thumb on the
// joystick is indistinguishable from someone leaning on W.
//
// Two things make it behave rather than glitch:
//
//   1. Every control is driven by Pointer Events with `setPointerCapture`, and
//      every element sets `touch-action: none`. That is what fixes the classic
//      "hold A and B stops working" bug - each finger owns its own pointerId and
//      its own element for the whole of its life, and the browser never steals
//      one for scrolling.
//
//   2. Edge-triggered input (a tap, a weapon switch, Q) is queued and replayed
//      from inside a patched `input.endFrame()`. The game clears those flags at
//      the end of every frame, so setting them from a DOM event that lands
//      mid-frame would sometimes be wiped before `update()` ever saw it. Replaying
//      them right after the clear guarantees exactly one frame of visibility.

const HELD_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab'];

/**
 * The mod brings its own stylesheet rather than having the launcher inject one.
 * That is what lets it be an ordinary mod: everything it needs travels with it,
 * and nothing outside this folder has to know it exists.
 */
function addStylesheet(doc) {
  if (doc.querySelector('link[data-dops-touch-css]')) return () => {};
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./touch.css', import.meta.url).href;
  link.dataset.dopsTouchCss = '1';
  doc.head.appendChild(link);
  return () => link.remove();
}

export function mountTouchLayer(game, prefs) {
  const input = game.input;
  const doc = document;
  const removeStylesheet = addStylesheet(doc);

  /* ------------------------------------------------------------------ state */

  const state = {
    move: { x: 0, y: 0 },       // -1..1, y positive = forward
    held: new Set(),            // key codes we are holding down this frame
    fire: false,                // FIRE button held
    scope: false,               // SCOPE button held
    lookX: 0, lookY: 0,         // buffered look delta, flushed once per frame
    edges: [],                  // Array<Set<code>>, one set replayed per frame
    wheel: 0,                   // queued weapon toggles
    pulses: 0,                  // queued one-frame trigger pulls (screen taps)
  };
  const ourKeys = new Set();    // only ever remove keys we put there ourselves

  function queueKey(code) {
    for (const set of state.edges) {
      if (!set.has(code)) { set.add(code); return; }
    }
    state.edges.push(new Set([code]));
  }

  /* ------------------------------------------------------------------- DOM */

  const root = el('div', 'dops-root');
  root.id = 'dops-touch';

  const look = el('div', 'dops-look');
  const zone = el('div', 'dops-zone');
  const stick = el('div', 'dops-stick');
  const knob = el('div', 'dops-knob');
  stick.appendChild(knob);

  const slots = el('div', 'dops-slots');
  const btnMelee = button('slot-melee', 'KNIFE', '1');
  const btnGun = button('slot-gun', 'GUN', '2');
  slots.append(btnMelee, btnGun);

  const cluster = el('div', 'dops-cluster');
  const btnFire = button('fire', 'FIRE', '');
  const btnScope = button('scope', 'SCOPE', 'tahan');
  const btnJump = button('jump', 'JUMP', '');
  const btnReload = button('reload', 'RELOAD', 'R');
  const btnSkill = button('skill', 'Q', 'skill');
  const btnPickup = button('pickup', 'PICK', 'E');
  cluster.append(btnFire, btnScope, btnJump, btnReload, btnSkill, btnPickup);

  const top = el('div', 'dops-top');
  const btnSwap = button('swap', 'SWAP', '');
  const btnScores = button('scores', 'SCORE', '');
  const btnPause = button('pause', 'MENU', '');
  top.append(btnSwap, btnScores, btnPause);

  const hint = el('div', 'dops-hint');

  root.append(look, zone, stick, slots, cluster, top, hint);
  doc.body.appendChild(root);

  /* --------------------------------------------------------------- look zone */

  // pointerId -> pointer bookkeeping. The first one down steers the camera; any
  // extra finger on empty screen can still tap to shoot, which is what makes
  // "hold the scope, tap to fire" work.
  const looks = new Map();
  let cameraPointer = null;

  bindZone(look, {
    down(e) {
      looks.set(e.pointerId, {
        x: e.clientX, y: e.clientY, startT: performance.now(), travel: 0, fired: false,
      });
      if (cameraPointer === null) cameraPointer = e.pointerId;
    },
    move(e) {
      const p = looks.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.travel += Math.hypot(dx, dy);
      if (e.pointerId === cameraPointer) {
        const s = prefs.lookSensitivity;
        state.lookX += dx * s;
        state.lookY += dy * s;
      }
      // Once a finger has clearly moved it is a look, not a tap - and if the
      // player is holding still to auto-fire, moving cancels that too.
      if (p.fired && p.travel > prefs.tapMaxMove) { p.fired = false; state.fire = holdFireWanted(); }
    },
    up(e) {
      const p = looks.get(e.pointerId);
      looks.delete(e.pointerId);
      if (e.pointerId === cameraPointer) {
        cameraPointer = looks.size ? looks.keys().next().value : null;
      }
      if (!p) return;
      if (p.fired) { p.fired = false; state.fire = holdFireWanted(); return; }
      const quick = performance.now() - p.startT <= prefs.tapMaxMs;
      const still = p.travel <= prefs.tapMaxMove;
      if (prefs.tapToShoot && quick && still) {
        state.pulses++;          // one trigger pull on the next frame
        buzz(6);
      }
    },
    cancel(e) {
      const p = looks.get(e.pointerId);
      looks.delete(e.pointerId);
      if (e.pointerId === cameraPointer) cameraPointer = looks.size ? looks.keys().next().value : null;
      if (p && p.fired) state.fire = holdFireWanted();
    },
  });

  function holdFireWanted() {
    if (btnFire.dataset.down === '1') return true;
    for (const p of looks.values()) if (p.fired) return true;
    return false;
  }

  // Optional: rest a finger on empty screen without moving and keep firing.
  // Off by default, because it fights with drag-to-look.
  function pollHoldFire(now) {
    if (!prefs.holdToAutoFire) return;
    for (const p of looks.values()) {
      if (!p.fired && p.travel <= prefs.tapMaxMove && now - p.startT > prefs.tapMaxMs) {
        p.fired = true;
        state.fire = true;
      }
    }
  }

  /* --------------------------------------------------------------- joystick */

  let stickPointer = null;
  let origin = { x: 0, y: 0 };
  let radius = 56;

  function stickGeometry() {
    const r = stick.getBoundingClientRect();
    radius = Math.max(36, r.width * 0.42);
    return r;
  }

  bindZone(zone, {
    down(e) {
      if (stickPointer !== null) return;         // one thumb per stick
      stickPointer = e.pointerId;
      if (prefs.joystickMode === 'floating') {
        placeStick(e.clientX, e.clientY);
        stick.classList.add('live');
      }
      const r = stickGeometry();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      updateStick(e.clientX, e.clientY);
    },
    move(e) {
      if (e.pointerId !== stickPointer) return;
      updateStick(e.clientX, e.clientY);
    },
    up(e) { if (e.pointerId === stickPointer) releaseStick(); },
    cancel(e) { if (e.pointerId === stickPointer) releaseStick(); },
  });

  function placeStick(x, y) {
    const size = stick.offsetWidth || 150;
    stick.style.left = (x - size / 2) + 'px';
    stick.style.top = (y - size / 2) + 'px';
    stick.style.right = 'auto';
    stick.style.bottom = 'auto';
  }

  function releaseStick() {
    stickPointer = null;
    state.move.x = 0; state.move.y = 0;
    knob.style.transform = '';
    stick.classList.remove('live');
    applyMoveKeys();
  }

  function updateStick(x, y) {
    let dx = x - origin.x;
    let dy = y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx = dx / len * radius; dy = dy / len * radius; }
    knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    state.move.x = dx / radius;
    state.move.y = -dy / radius;      // screen down is backwards
    applyMoveKeys();
  }

  // The game moves on four booleans and normalises them, so the stick resolves to
  // eight directions. Separate on/off thresholds give each direction a little
  // hysteresis, otherwise a thumb resting on a diagonal boundary chatters.
  const ON = 0.38, OFF = 0.28;
  function axis(code, value, positive) {
    const v = positive ? value : -value;
    const on = state.held.has(code);
    if (v > (on ? OFF : ON)) state.held.add(code);
    else state.held.delete(code);
  }
  function applyMoveKeys() {
    const dead = Math.hypot(state.move.x, state.move.y) < 0.18;
    if (dead) {
      state.held.delete('KeyW'); state.held.delete('KeyS');
      state.held.delete('KeyA'); state.held.delete('KeyD');
      return;
    }
    axis('KeyW', state.move.y, true);
    axis('KeyS', state.move.y, false);
    axis('KeyD', state.move.x, true);
    axis('KeyA', state.move.x, false);
  }

  /* ----------------------------------------------------------------- buttons */

  hold(btnFire, () => { state.fire = true; queueNothing(); }, () => { state.fire = holdFireWanted(); });
  hold(btnScope, () => { state.scope = true; }, () => { state.scope = false; });
  hold(btnJump, () => state.held.add('Space'), () => state.held.delete('Space'));
  hold(btnScores, () => state.held.add('Tab'), () => state.held.delete('Tab'));

  tap(btnReload, () => queueKey('KeyR'));
  tap(btnSkill, () => queueKey('KeyQ'));
  tap(btnPickup, () => queueKey('KeyE'));
  tap(btnSwap, () => { state.wheel++; });
  tap(btnMelee, () => queueKey('Digit1'));
  tap(btnGun, () => queueKey('Digit2'));
  tap(btnPause, () => game.setPaused(true));

  function queueNothing() { /* FIRE is a held state, nothing to queue */ }

  /* ------------------------------------------------------- input integration */

  // Pointer lock is a desktop idea; on a phone it either fails or fights the
  // browser UI. Keep `locked` permanently true so the look code runs, and make
  // the lock calls no-ops so losing it can never auto-pause the match.
  // Patches are recorded so `destroy()` can leave the input object exactly as it
  // found it - including whether a method was an own property at all, so that
  // switching the mod off really does hand the game back its own plumbing.
  const patches = [];
  function patch(name, value) {
    const own = Object.prototype.hasOwnProperty.call(input, name);
    const before = input[name];
    patches.push(() => { if (own) input[name] = before; else delete input[name]; });
    input[name] = value;
  }

  const wasLocked = input.locked;
  patch('requestLock', function () { this.locked = true; });
  patch('exitLock', function () { /* the touch layer is always "locked" */ });
  input.locked = true;

  const originalEndFrame = input.endFrame.bind(input);
  patch('endFrame', function () {
    originalEndFrame();
    writeInput();
  });

  function writeInput() {
    input.locked = true;

    // held keys - only ever clear the ones we set, so a real keyboard still works
    for (const code of ourKeys) {
      if (!state.held.has(code)) input.keys.delete(code);
    }
    ourKeys.clear();
    for (const code of state.held) {
      if (HELD_CODES.includes(code)) { input.keys.add(code); ourKeys.add(code); }
    }

    // look
    if (state.lookX || state.lookY) {
      input.mouseDX += state.lookX;
      input.mouseDY += state.lookY;
      state.lookX = 0; state.lookY = 0;
    }

    // trigger
    let firing = state.fire;
    if (state.pulses > 0) { state.pulses--; firing = true; }
    input.buttons[0] = firing;
    // Re-arm the edge every frame while held: semi-autos read the edge, so this
    // is what turns a held FIRE button into repeat fire at the weapon's own rate.
    if (firing) input.buttonPressed[0] = true;

    // scope is a plain held right-button
    input.buttons[2] = state.scope;

    // one-shot keys and weapon toggles
    const set = state.edges.shift();
    if (set) for (const code of set) input.pressed.add(code);
    if (state.wheel > 0) { state.wheel--; input.wheel = 1; }
  }

  /* -------------------------------------------------------------- appearance */

  function applyPrefs() {
    root.style.setProperty('--dops-op', String(prefs.opacity));
    root.style.setProperty('--dops-scale', String(prefs.buttonScale));
    root.style.setProperty('--dops-stick', String(prefs.joystickSize));
    root.classList.toggle('mirrored', !!prefs.leftHanded);
    btnFire.style.display = prefs.showFireButton ? '' : 'none';
    btnScope.style.display = prefs.showScopeButton ? '' : 'none';
    slots.style.display = prefs.showSlotChips ? '' : 'none';

    const floating = prefs.joystickMode === 'floating';
    stick.classList.toggle('floating', floating);
    zone.classList.toggle('wide', floating);
    if (!floating) {
      stick.style.left = ''; stick.style.top = '';
      stick.style.right = ''; stick.style.bottom = '';
      syncFixedZone();
    }
  }

  // In fixed mode the hit area is exactly the visible ring; in floating mode CSS
  // stretches it across half the screen.
  function syncFixedZone() {
    if (prefs.joystickMode === 'floating') return;
    const r = stick.getBoundingClientRect();
    zone.style.left = r.left + 'px';
    zone.style.top = r.top + 'px';
    zone.style.width = r.width + 'px';
    zone.style.height = r.height + 'px';
  }

  applyPrefs();
  window.addEventListener('dops:prefs', applyPrefs);
  window.addEventListener('resize', syncFixedZone);
  window.addEventListener('orientationchange', () => setTimeout(syncFixedZone, 250));

  /* --------------------------------------------------------------- live loop */

  const overlay = doc.getElementById('overlay');
  let raf = 0;
  let lastVisible = null;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    pollHoldFire(now);

    const menuUp = !overlay || !overlay.classList.contains('hidden');
    const visible = !menuUp && !game.paused && !game.matchOver;
    if (visible !== lastVisible) {
      lastVisible = visible;
      root.hidden = !visible;
      if (!visible) letGo();
      else syncFixedZone();
    }
    if (!visible) return;

    const player = game.player;
    if (!player) return;
    const lo = player.loadout;
    const def = lo && lo.def;

    if (def) {
      // The axe leaves your hand after a few hits, and then the attack button is
      // what calls it back - so say so rather than showing a swing you cannot do.
      const melee = def.kind === 'melee';
      const empty = melee && lo.meleeOut;
      label(btnFire,
        empty ? 'RECALL' : melee ? 'SWING' : 'FIRE',
        empty ? 'panggil' : melee ? '' : lo.ammo + ' / ' + lo.reserve);
      btnScope.classList.toggle('disabled', !def.scope);
      btnReload.classList.toggle('disabled', melee);
      label(btnSwap, 'SWAP', def.name || '');
      // The melee slot names whatever is actually in it - knife or axe.
      label(btnMelee, lo.melee ? String(lo.melee).toUpperCase() : 'KNIFE',
        lo.meleeOut ? 'lempar' : '1');
      label(btnGun, lo.gun ? String(lo.gun).toUpperCase() : '—', '2');
      btnMelee.classList.toggle('active', !!lo.isMelee);
      btnGun.classList.toggle('active', !lo.isMelee);
      btnGun.classList.toggle('disabled', !lo.hasGun);
    }

    const skill = player.doodler && player.doodler.skill;
    btnSkill.classList.toggle('disabled', !skill);
    btnSkill.classList.toggle('ready', !!skill && player.skillCharges > 0);
    if (skill) {
      label(btnSkill, 'Q', player.skillCharges > 0
        ? skill.name.split(' ')[0].toLowerCase()
        : Math.ceil(player.skillCooldown) + 's');
    }

    // The pickup prompt only means anything when you are looking at something.
    btnPickup.classList.toggle('disabled', !player.highlighted);
  }
  raf = requestAnimationFrame(tick);

  /* ---------------------------------------------------------------- teardown */

  function letGo() {
    state.held.clear();
    state.fire = false;
    state.scope = false;
    state.move.x = state.move.y = 0;
    state.lookX = state.lookY = 0;
    state.edges.length = 0;
    state.wheel = 0;
    state.pulses = 0;
    looks.clear();
    cameraPointer = null;
    releaseStick();
    for (const b of root.querySelectorAll('.dops-btn')) {
      b.classList.remove('pressed');
      b.dataset.down = '0';
    }
  }

  function destroy() {
    cancelAnimationFrame(raf);
    letGo();
    writeInput();                       // flush the released state into the game
    while (patches.length) patches.pop()();
    input.locked = wasLocked;
    window.removeEventListener('dops:prefs', applyPrefs);
    window.removeEventListener('resize', syncFixedZone);
    root.remove();
    removeStylesheet();
  }

  function toast(text, ms = 1600) {
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => hint.classList.remove('show'), ms);
  }

  return { root, destroy, toast, state };

  /* ------------------------------------------------------------------ plumbing */

  function el(tag, cls) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function button(id, text, sub) {
    const b = el('button', 'dops-btn');
    b.id = 'dops-' + id;
    b.type = 'button';
    label(b, text, sub);
    b.dataset.down = '0';
    return b;
  }

  function label(b, text, sub) {
    const want = text + ' ' + (sub || '');
    if (b.dataset.label === want) return;   // don't touch the DOM 60x a second
    b.dataset.label = want;
    b.textContent = text;
    if (sub) {
      const s = doc.createElement('small');
      s.textContent = sub;
      b.appendChild(s);
    }
  }

  function buzz(ms) {
    if (prefs.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* blocked */ } }
  }

  /**
   * Pointer plumbing shared by every control.
   *
   * `setPointerCapture` is the whole point: it pins this pointerId to this
   * element until the finger lifts, so a second finger landing elsewhere gets
   * its own independent stream instead of stealing this one.
   */
  function bindZone(target, handlers) {
    target.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { target.setPointerCapture(e.pointerId); } catch { /* already captured */ }
      handlers.down(e);
    });
    target.addEventListener('pointermove', (e) => {
      e.preventDefault();
      handlers.move(e);
    });
    const end = (e) => {
      e.preventDefault();
      try { target.releasePointerCapture(e.pointerId); } catch { /* gone already */ }
      handlers.up(e);
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', (e) => {
      try { target.releasePointerCapture(e.pointerId); } catch { /* gone already */ }
      (handlers.cancel || handlers.up)(e);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** A button that does something for as long as it is held. */
  function hold(b, onDown, onUp) {
    let owner = null;
    bindZone(b, {
      down(e) {
        if (owner !== null) return;
        if (b.classList.contains('disabled')) return;
        owner = e.pointerId;
        b.dataset.down = '1';
        b.classList.add('pressed');
        buzz(8);
        onDown();
      },
      move() { /* holding is position-independent once captured */ },
      up(e) {
        if (e.pointerId !== owner) return;
        owner = null;
        b.dataset.down = '0';
        b.classList.remove('pressed');
        onUp();
      },
    });
  }

  /** A button that fires once on press. Pressing is instant - waiting for the
   *  lift would add a frame of lag to every reload and skill. */
  function tap(b, onPress) {
    let owner = null;
    bindZone(b, {
      down(e) {
        if (owner !== null) return;
        if (b.classList.contains('disabled')) return;
        owner = e.pointerId;
        b.classList.add('pressed');
        buzz(8);
        onPress();
      },
      move() {},
      up(e) {
        if (e.pointerId !== owner) return;
        owner = null;
        b.classList.remove('pressed');
      },
    });
  }
}
