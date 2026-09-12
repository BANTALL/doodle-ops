// Touch controls, laid out for two thumbs on a phone held in landscape.
//
// ---------------------------------------------------------------------------
// Where the buttons go, and why
//
// Held in landscape, each thumb pivots at the bottom corner on its side and sweeps an arc.
// How far it reaches is a physical distance - about 50-60mm for most hands - so it has to
// be measured against the screen's *short* edge, which is the one that maps to real
// millimetres the same way on every phone. A typical landscape phone is around 68mm tall,
// so:
//
//   within 0.70h of the corner   comfortable: the thumb gets there without regripping
//   within 0.90h                 reachable: fine for something you press now and then
//   beyond that                  a regrip, which in a firefight means you don't press it
//
// Everything is therefore positioned in units of h from the bottom corner on its side, and
// sized in units of h too, so a button is the same number of millimetres across whether the
// phone is 2:1 or 21:9. Laying them out in fractions of the *width* is the usual mistake: on
// a 21:9 screen "x = 0.7" is a completely different reach from "x = 0.7" on a tablet.
//
// Frequency decides which band each one lands in:
//
//   FIRE     constant        r 0.40   the core of the arc, and the biggest target
//   JUMP     frequent        r 0.57   up the right edge, where the thumb already is
//   RELOAD   frequent        r 0.66   left of fire
//   SWAP     frequent        r 0.72   above fire
//   SCOPE    sniper only     r 0.79   reachable band - a deliberate hold, not a reflex
//   PICK UP  contextual      left thumb, and you've stopped moving to do it anyway
//   SKILL    once a minute   r 0.87   up the right edge, above jump
//   MENU     rare            top *left*, deliberately outside both arcs so it can't be
//                            hit by accident mid-fight
//
// The look area is everything on the right that isn't a button, and the stick re-centres
// wherever your left thumb lands rather than sitting in one spot - both of which are what
// make a phone shooter feel like it fits your hands instead of the other way round.

import { settings } from './settings.js';
import { clamp } from './math.js';

/** Buttons, in units of the short edge, measured from the bottom corner on their own side. */
const LAYOUT = {
  //                 side     dx     dy     r      label      key
  fire:    { side: 'right', dx: 0.30, dy: 0.26, r: 0.165, label: 'FIRE' },
  jump:    { side: 'right', dx: 0.12, dy: 0.56, r: 0.105, label: 'JUMP', key: 'Space' },
  swap:    { side: 'right', dx: 0.34, dy: 0.64, r: 0.105, label: 'SWAP' },
  reload:  { side: 'right', dx: 0.62, dy: 0.22, r: 0.095, label: 'RELOAD', key: 'KeyR' },
  scope:   { side: 'right', dx: 0.60, dy: 0.52, r: 0.095, label: 'SCOPE' },
  skill:   { side: 'right', dx: 0.15, dy: 0.86, r: 0.100, label: 'SKILL', key: 'KeyQ' },
  pickup:  { side: 'left',  dx: 0.52, dy: 0.62, r: 0.095, label: 'PICK UP', key: 'KeyE' },
};

/** The stick's resting home, also in short-edge units from the bottom-left. */
const STICK = { dx: 0.42, dy: 0.30, base: 0.20, knob: 0.085, dead: 0.16 };

/** Top-corner controls, outside the thumb arcs on purpose. */
const TOP = { r: 0.070, pad: 0.055 };

/** Degrees of look per short-edge of drag, before the sensitivity setting. */
const LOOK_GAIN = 150;

export class TouchPad {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.enabled = false;
    this.w = 1; this.h = 1; this.u = 1;

    // Live state the HUD draws from.
    this.stick = { active: false, cx: 0, cy: 0, kx: 0, ky: 0, x: 0, y: 0 };
    this.held = new Set();          // ids of buttons currently pressed
    this.flash = new Map();         // id -> frames left, so a tap is visible at 12fps
    this.pointers = new Map();      // pointerId -> { role, id, lx, ly }
    this.showPickup = false;
    this.showScope = false;
    // While a menu is up the pad isn't drawn, so it mustn't accept presses either - a
    // finger landing on the canvas behind a dialog would otherwise fire an invisible gun.
    this.suspended = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  /** Is this worth offering? A coarse pointer means a finger rather than a mouse. */
  static likelyTouchDevice() {
    if (typeof window === 'undefined') return false;
    return (window.matchMedia?.('(pointer: coarse)').matches ?? false) ||
      (navigator.maxTouchPoints ?? 0) > 0;
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.canvas.addEventListener('pointerdown', this._onDown, { passive: false });
      window.addEventListener('pointermove', this._onMove, { passive: false });
      window.addEventListener('pointerup', this._onUp, { passive: false });
      window.addEventListener('pointercancel', this._onUp, { passive: false });
      this.canvas.style.touchAction = 'none';
    } else {
      this.canvas.removeEventListener('pointerdown', this._onDown);
      window.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      window.removeEventListener('pointercancel', this._onUp);
      this.canvas.style.touchAction = '';
      this.releaseAll();
    }
  }

  resize(w, h) {
    this.w = w; this.h = h;
    // The short edge is the one that maps to millimetres consistently, so it is the unit
    // everything is measured in. In landscape that is the height; hold the phone upright
    // and it becomes the width, which is also when the layout stops being reachable - but
    // it at least stays the right physical size.
    this.u = Math.min(w, h);
    this.stick.cx = STICK.dx * this.u;
    this.stick.cy = h - STICK.dy * this.u;
  }

  /** Screen position of a button, resolved against the current size. */
  spot(id) {
    const b = LAYOUT[id];
    if (!b) return null;
    const x = b.side === 'right' ? this.w - b.dx * this.u : b.dx * this.u;
    return { x, y: this.h - b.dy * this.u, r: b.r * this.u, label: b.label, id };
  }

  /**
   * Menu and scoreboard, top *left*. Rare presses, and putting them outside both thumb arcs
   * is the point - you should not be able to pause the game by fumbling a reload. The right
   * edge is left entirely to the action column.
   */
  topSpot(which) {
    const r = TOP.r * this.u, pad = TOP.pad * this.u;
    const x = which === 'menu' ? pad + r : pad * 2 + r * 3;
    return { x, y: pad + r, r, id: which };
  }

  /** Every button that should accept a press right now. */
  *_targets() {
    for (const id of Object.keys(LAYOUT)) {
      if (id === 'pickup' && !this.showPickup) continue;
      if (id === 'scope' && !this.showScope) continue;
      yield this.spot(id);
    }
    yield this.topSpot('menu');
    yield this.topSpot('scores');
  }

  _hitTest(x, y) {
    for (const s of this._targets()) {
      // A generous ring around the drawn circle: fingers are wide and the drawn edge is
      // where people aim, not where they land.
      const rr = s.r * 1.28;
      if ((x - s.x) ** 2 + (y - s.y) ** 2 <= rr * rr) return s;
    }
    return null;
  }

  _local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onDown(e) {
    if (!this.enabled || this.suspended) return;
    e.preventDefault();
    const { x, y } = this._local(e);
    const hit = this._hitTest(x, y);
    if (hit) {
      this.pointers.set(e.pointerId, { role: 'button', id: hit.id });
      this._press(hit.id, true);
      return;
    }
    // The left half drives the stick, wherever in it you happen to land - a stick that
    // appears under your thumb beats one you have to find.
    if (x < this.w * 0.42 && !this._stickPointer()) {
      this.stick.active = true;
      this.stick.cx = x; this.stick.cy = y;
      this.stick.kx = x; this.stick.ky = y;
      this.stick.x = 0; this.stick.y = 0;
      this.pointers.set(e.pointerId, { role: 'stick' });
      return;
    }
    // Anything else on the right is the look area.
    this.pointers.set(e.pointerId, { role: 'look', lx: x, ly: y });
  }

  _stickPointer() {
    for (const p of this.pointers.values()) if (p.role === 'stick') return true;
    return false;
  }

  _onMove(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const { x, y } = this._local(e);
    if (p.role === 'stick') {
      const max = STICK.base * this.u;
      let dx = x - this.stick.cx, dy = y - this.stick.cy;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      this.stick.kx = this.stick.cx + dx;
      this.stick.ky = this.stick.cy + dy;
      // Dead zone, then a square-law ramp: fine control near the middle, full tilt at the
      // rim. A linear stick makes walking slowly almost impossible with a thumb.
      const t = clamp((Math.hypot(dx, dy) / max - STICK.dead) / (1 - STICK.dead), 0, 1);
      const k = t * t * (d > 0 ? 1 : 0);
      this.stick.x = d > 0 ? (dx / d) * k : 0;
      this.stick.y = d > 0 ? (dy / d) * k : 0;
    } else if (p.role === 'look') {
      const gain = LOOK_GAIN * (settings.sensitivity / 2.4) / this.u;
      this.input.mouseDX += (x - p.lx) * gain;
      this.input.mouseDY += (y - p.ly) * gain;
      p.lx = x; p.ly = y;
    }
  }

  _onUp(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'stick') {
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      this.stick.cx = STICK.dx * this.u;
      this.stick.cy = this.h - STICK.dy * this.u;
      this.stick.kx = this.stick.cx; this.stick.ky = this.stick.cy;
    } else if (p.role === 'button') {
      this._press(p.id, false);
    }
  }

  /** Push a button press into the Input the rest of the game already reads. */
  _press(id, down) {
    const input = this.input;
    if (down) { this.held.add(id); this.flash.set(id, 2); } else this.held.delete(id);

    if (id === 'fire') {
      input.buttons[0] = down;
      if (down) input.buttonPressed[0] = true; else input.buttonReleased[0] = true;
      return;
    }
    if (id === 'scope') {
      input.buttons[2] = down;
      if (down) input.buttonPressed[2] = true; else input.buttonReleased[2] = true;
      return;
    }
    if (id === 'swap') { if (down) input.wheel += 1; return; }
    if (id === 'menu') { if (down) this.onMenu?.(); return; }
    if (id === 'scores') { if (down) input.keys.add('Tab'); else input.keys.delete('Tab'); return; }

    const key = LAYOUT[id]?.key;
    if (!key) return;
    if (down) { input.keys.add(key); input.pressed.add(key); }
    else { input.keys.delete(key); input.released.add(key); }
  }

  releaseAll() {
    for (const id of [...this.held]) this._press(id, false);
    this.held.clear();
    this.pointers.clear();
    this.stick.active = false;
    this.stick.x = this.stick.y = 0;
  }

  /** Called once per frame with what the HUD should be offering right now. */
  sync(game) {
    if (!this.enabled) return;
    const p = game.player;
    this.showPickup = !!p.highlighted;
    this.showScope = !!(p.loadout.def && p.loadout.def.scope);
    if (!p.alive) this.releaseAll();
  }

  /** Fold the stick into the movement axes the player reads. */
  moveAxis(out) {
    out.fwd = -this.stick.y;
    out.side = this.stick.x;
    return out;
  }

  animStep() {
    for (const [id, n] of this.flash) {
      if (n <= 1) this.flash.delete(id); else this.flash.set(id, n - 1);
    }
  }
}
