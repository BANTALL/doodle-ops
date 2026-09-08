// Keyboard / mouse plumbing with pointer lock. Exposes edge-triggered state the
// game loop consumes once per frame.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // keys that went down this frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;               // accumulated notches, sign = direction
    this.buttons = [false, false, false];
    this.buttonPressed = [false, false, false];
    this.buttonReleased = [false, false, false];
    this.locked = false;
    this.onLockChange = null;
    this.enabled = true;

    this._bind();
  }

  _bind() {
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F5'].includes(c) && this.locked) e.preventDefault();
      this.keys.add(c);
      this.pressed.add(c);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.buttons.fill(false); }
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // movementX/Y can spike on some browsers; clamp to keep the camera sane.
      this.mouseDX += Math.max(-400, Math.min(400, e.movementX || 0));
      this.mouseDY += Math.max(-400, Math.min(400, e.movementY || 0));
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      stop(e);
      if (e.button < 3) { this.buttons[e.button] = true; this.buttonPressed[e.button] = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) { this.buttons[e.button] = false; this.buttonReleased[e.button] = true; }
    });
    this.canvas.addEventListener('contextmenu', stop);

    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    // Chrome returns a promise when unadjustedMovement is requested; fall back if unsupported.
    if (p && typeof p.catch === 'function') p.catch(() => this.canvas.requestPointerLock());
  }

  exitLock() { if (this.locked) document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttonPressed[0] = this.buttonPressed[1] = this.buttonPressed[2] = false;
    this.buttonReleased[0] = this.buttonReleased[1] = this.buttonReleased[2] = false;
  }
}
