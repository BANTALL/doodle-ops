// Canvas2D HUD, drawn to look like it was scribbled in the margin. Every shape is a
// wobbled approximation of itself, and the wobble is reseeded on the 12fps animation
// clock so the interface flip-books along with the world.

import { clamp, hash01, TAU } from './math.js';
import { WEAPONS } from './weapons.js';

const INK = '#22202b';
const INK_SOFT = 'rgba(34,32,43,0.55)';
const RED = '#c0392f';
const PAPER = '#f5f2e9';
export const FONT = '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Bradley Hand", cursive';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this.frame = 0;
    this.hitMarkers = [];
    this.damageMarks = [];
    this.killFeed = [];
    this.toasts = [];
    this.showScores = false;
    this.visible = true;
  }

  /** Toggle the overlay layer. Only touches the DOM when the state actually changes. */
  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.canvas.style.visibility = v ? 'visible' : 'hidden';
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // ---- events ------------------------------------------------------------

  addHitMarker(head) { this.hitMarkers.push({ t: 0, head }); }
  addDamageMark(angle) { this.damageMarks.push({ angle, t: 0 }); }
  addKill(killer, victim, weaponId, isPlayer) {
    this.killFeed.unshift({ killer, victim, weaponId, t: 0, isPlayer });
    if (this.killFeed.length > 5) this.killFeed.pop();
  }
  addToast(text) { this.toasts.push({ text, t: 0 }); if (this.toasts.length > 3) this.toasts.shift(); }

  update(dt) {
    for (const a of [this.hitMarkers, this.damageMarks, this.killFeed, this.toasts]) {
      for (let i = a.length - 1; i >= 0; i--) { a[i].t += dt; }
    }
    this.hitMarkers = this.hitMarkers.filter((m) => m.t < 0.4);
    this.damageMarks = this.damageMarks.filter((m) => m.t < 1.6);
    this.killFeed = this.killFeed.filter((m) => m.t < 6);
    this.toasts = this.toasts.filter((m) => m.t < 2.4);
  }

  // ---- sketch primitives -------------------------------------------------

  _n(seed, i = 0) { return (hash01(Math.round(seed * 977) + i * 31, this.frame) - 0.5) * 2; }

  line(x1, y1, x2, y2, lw = 2, seed = 0, color = INK) {
    const g = this.ctx;
    const j = 1.4;
    const mx = (x1 + x2) / 2 + this._n(seed, 3) * j * 2.2;
    const my = (y1 + y2) / 2 + this._n(seed, 4) * j * 2.2;
    g.strokeStyle = color;
    g.lineWidth = lw * (0.85 + Math.abs(this._n(seed, 5)) * 0.3);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x1 + this._n(seed, 1) * j, y1 + this._n(seed, 2) * j);
    g.quadraticCurveTo(mx, my, x2 + this._n(seed, 6) * j, y2 + this._n(seed, 7) * j);
    g.stroke();
  }

  rect(x, y, w, h, lw = 2, seed = 0, color = INK) {
    this.line(x, y, x + w, y, lw, seed + 1, color);
    this.line(x + w, y, x + w, y + h, lw, seed + 2, color);
    this.line(x + w, y + h, x, y + h, lw, seed + 3, color);
    this.line(x, y + h, x, y, lw, seed + 4, color);
  }

  circle(cx, cy, r, lw = 2, seed = 0, color = INK) {
    const g = this.ctx;
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const rr = r * (1 + this._n(seed, i) * 0.022);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.stroke();
  }

  /** Panel with a paper-ish wash behind it so text stays legible over the world. */
  panel(x, y, w, h, seed, alpha = 0.66) {
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = PAPER;
    g.beginPath();
    const j = 2.2;
    g.moveTo(x + this._n(seed, 1) * j, y + this._n(seed, 2) * j);
    g.lineTo(x + w + this._n(seed, 3) * j, y + this._n(seed, 4) * j);
    g.lineTo(x + w + this._n(seed, 5) * j, y + h + this._n(seed, 6) * j);
    g.lineTo(x + this._n(seed, 7) * j, y + h + this._n(seed, 8) * j);
    g.closePath();
    g.fill();
    g.restore();
    this.rect(x, y, w, h, 2, seed);
  }

  /** Diagonal pencil hatching inside a rect, used for filled bars. */
  hatch(x, y, w, h, seed, color = INK, spacing = 6, lw = 1.6) {
    const g = this.ctx;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineCap = 'round';
    for (let i = -h; i < w + h; i += spacing) {
      const jj = this._n(seed, i) * 1.6;
      g.beginPath();
      g.moveTo(x + i + jj, y + h);
      g.lineTo(x + i + h + jj, y);
      g.stroke();
    }
    g.restore();
  }

  text(str, x, y, size, align = 'left', color = INK, weight = 'bold') {
    const g = this.ctx;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillStyle = color;
    g.fillText(str, x, y);
  }

  textOutlined(str, x, y, size, align = 'left', color = INK) {
    const g = this.ctx;
    g.font = `bold ${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.lineWidth = size * 0.16;
    g.strokeStyle = 'rgba(245,242,233,0.85)';
    g.lineJoin = 'round';
    g.strokeText(str, x, y);
    g.fillStyle = color;
    g.fillText(str, x, y);
  }

  /** Wipe the overlay - used while a menu is up. Resets the transform first, since draw()
   *  leaves a dpr scale on the context. */
  clear() {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.setVisible(false);
  }

  // ---- main draw ---------------------------------------------------------

  draw(game) {
    const g = this.ctx;
    this.setVisible(true);
    this.frame = game.animFrame;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    const p = game.player;
    const cx = this.w / 2, cy = this.h / 2;

    if (p.loadout.scopeT > 0.9 && p.alive) this._scope(cx, cy);
    else if (p.alive) this._crosshair(game, cx, cy);

    this._damageMarks(cx, cy);
    this._hitMarkers(cx, cy);
    this._health(game);
    this._ammo(game);
    this._weaponSlots(game);
    this._pickupPrompt(game);
    this._killFeed();
    this._toasts();
    this._matchState(game);
    if (this.showScores) this._scoreboard(game);
    if (!p.alive) this._deathOverlay(game);
    if (game.showFps) this._fps(game);
  }

  _crosshair(game, cx, cy) {
    const p = game.player;
    const lo = p.loadout;
    const def = lo.def;
    const moveFactor = clamp(Math.hypot(p.vel.x, p.vel.z) / 5.15, 0, 1) * (p.onGround ? 1 : 1.7);
    const spread = def.kind === 'melee' ? 1.2 : lo.spreadDeg(moveFactor);
    // Convert the cone to a pixel radius using the current vertical FOV.
    const fovRad = game.camera.fov * Math.PI / 180;
    const pxPerRad = this.h / (2 * Math.tan(fovRad / 2));
    const gap = clamp(spread * Math.PI / 180 * pxPerRad, 5, this.h * 0.28);
    const len = 9;

    if (def.kind === 'melee') {
      // Knife gets a little scratchy chevron instead of a cross.
      this.line(cx - 9, cy - 9, cx, cy, 2.4, 21);
      this.line(cx, cy, cx + 9, cy - 9, 2.4, 22);
      this.line(cx, cy - 2, cx, cy + 9, 2.2, 23);
      return;
    }
    this.line(cx - gap - len, cy, cx - gap, cy, 2.4, 1);
    this.line(cx + gap, cy, cx + gap + len, cy, 2.4, 2);
    this.line(cx, cy - gap - len, cx, cy - gap, 2.4, 3);
    this.line(cx, cy + gap, cx, cy + gap + len, 2.4, 4);
    const g = this.ctx;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(cx + this._n(5) * 0.8, cy + this._n(6) * 0.8, 1.7, 0, TAU);
    g.fill();
  }

  _scope(cx, cy) {
    const r = Math.min(this.w, this.h) * 0.34;
    this.circle(cx, cy, r, 3.2, 30);
    this.circle(cx, cy, r * 0.985, 1.4, 31, INK_SOFT);
    // Cross hairs with a gap in the middle and range ticks down the vertical.
    this.line(cx - r, cy, cx - 16, cy, 2.2, 32);
    this.line(cx + 16, cy, cx + r, cy, 2.2, 33);
    this.line(cx, cy - r, cx, cy - 16, 2.2, 34);
    this.line(cx, cy + 16, cx, cy + r, 2.2, 35);
    for (let i = 1; i <= 4; i++) {
      const y = cy + i * r * 0.16;
      const wdt = 10 - i * 1.4;
      this.line(cx - wdt, y, cx + wdt, y, 1.8, 40 + i);
    }
    for (let i = 1; i <= 3; i++) {
      const x = cx + i * r * 0.2;
      this.line(x, cy - 6, x, cy + 6, 1.6, 50 + i);
      this.line(cx - i * r * 0.2, cy - 6, cx - i * r * 0.2, cy + 6, 1.6, 60 + i);
    }
    const g = this.ctx;
    g.fillStyle = RED;
    g.beginPath(); g.arc(cx, cy, 2.2, 0, TAU); g.fill();
  }

  _hitMarkers(cx, cy) {
    for (const m of this.hitMarkers) {
      const a = 1 - m.t / 0.4;
      const s = 10 + m.t * 26;
      const g = this.ctx;
      g.save();
      g.globalAlpha = a;
      const col = m.head ? RED : INK;
      this.line(cx - s, cy - s, cx - s * 0.45, cy - s * 0.45, 3, 70, col);
      this.line(cx + s, cy - s, cx + s * 0.45, cy - s * 0.45, 3, 71, col);
      this.line(cx - s, cy + s, cx - s * 0.45, cy + s * 0.45, 3, 72, col);
      this.line(cx + s, cy + s, cx + s * 0.45, cy + s * 0.45, 3, 73, col);
      g.restore();
    }
  }

  _damageMarks(cx, cy) {
    const g = this.ctx;
    for (const m of this.damageMarks) {
      const a = clamp(1 - m.t / 1.6, 0, 1);
      g.save();
      g.globalAlpha = a * 0.9;
      g.translate(cx, cy);
      g.rotate(m.angle);
      const r = 92;
      this.line(-24, -r, 0, -r - 16, 4, 80, RED);
      this.line(0, -r - 16, 24, -r, 4, 81, RED);
      g.restore();
    }
  }

  _health(game) {
    const p = game.player;
    const x = 30, y = this.h - 58, w = 190, hgt = 26;
    this.panel(x - 12, y - 30, w + 26, 62, 90, 0.5);
    const frac = clamp(p.health / 100, 0, 1);
    this.rect(x, y, w, hgt, 2.6, 91);
    if (frac > 0) {
      this.hatch(x + 2, y + 2, (w - 4) * frac, hgt - 4, 92, p.health > 35 ? INK : RED, 7, 2.0);
    }
    this.text('HP', x, y - 8, 17, 'left', INK);
    this.text(`${Math.ceil(p.health)}`, x + w, y - 8, 20, 'right', p.health > 35 ? INK : RED);
  }

  _ammo(game) {
    const p = game.player;
    const lo = p.loadout;
    const def = lo.def;
    const x = this.w - 30, y = this.h - 42;
    this.panel(x - 210, y - 62, 222, 78, 100, 0.5);
    this.text(def.name, x, y - 44, 19, 'right', INK);

    if (def.kind === 'melee') {
      this.text('∞', x, y, 38, 'right', INK);
    } else {
      const low = lo.ammo <= Math.max(1, Math.floor(def.mag * 0.25));
      this.text(`${lo.ammo}`, x - 58, y, 40, 'right', low ? RED : INK);
      this.text(`/ ${lo.reserve}`, x, y - 2, 22, 'right', INK_SOFT);
      if (lo.reloadT > 0) {
        const t = 1 - lo.reloadT / def.reload;
        const bw = 180;
        this.rect(x - bw, y + 8, bw, 8, 2, 101);
        this.hatch(x - bw + 2, y + 10, (bw - 4) * t, 4, 102, INK, 6, 1.6);
        this.text('RELOADING', x - bw, y - 44, 15, 'left', RED);
      } else if (lo.ammo === 0) {
        this.text('PRESS R', x - 200, y - 44, 15, 'left', RED);
      }
    }
  }

  _weaponSlots(game) {
    const lo = game.player.loadout;
    const y = this.h - 116;
    const items = [
      { key: '1', label: 'KNIFE', active: lo.isMelee },
      { key: '2', label: lo.gun ? WEAPONS[lo.gun].name : '—', active: !lo.isMelee },
    ];
    let x = this.w - 236;
    for (const it of items) {
      const w = 104;
      if (it.active) {
        this.panel(x, y - 20, w, 30, 110 + x, 0.72);
        this.rect(x - 3, y - 23, w + 6, 36, 2.4, 111 + x);
      }
      this.text(`${it.key}`, x + 8, y, 15, 'left', INK_SOFT);
      this.text(it.label, x + 26, y, 16, 'left', it.active ? INK : INK_SOFT);
      x += w + 14;
    }
    this.text('scroll to switch', this.w - 30, this.h - 128, 13, 'right', INK_SOFT, 'normal');
  }

  _pickupPrompt(game) {
    const p = game.player.highlighted;
    if (!p || !game.player.alive) return;
    const s = game.renderer.worldToScreen(p.pos);
    if (!s) return;
    const def = WEAPONS[p.gunId];
    const label = `[E] ${def.name}`;
    const g = this.ctx;
    g.font = `bold 19px ${FONT}`;
    const wdt = g.measureText(label).width + 26;
    const x = s.x - wdt / 2, y = s.y - 54;
    this.panel(x, y - 24, wdt, 32, 120, 0.8);
    this.text(label, s.x, y, 19, 'center', INK);
    // A little arrow pointing down at the thing.
    this.line(s.x, y + 10, s.x, y + 24, 2.4, 121);
    this.line(s.x - 5, y + 17, s.x, y + 24, 2.4, 122);
    this.line(s.x + 5, y + 17, s.x, y + 24, 2.4, 123);
    const same = game.player.loadout.gun === p.gunId;
    this.text(same ? 'take ammo' : 'swaps your gun', s.x, y + 40, 13, 'center', INK_SOFT, 'normal');
  }

  _killFeed() {
    let y = 44;
    for (const k of this.killFeed) {
      const a = clamp((6 - k.t) / 1.2, 0, 1);
      const g = this.ctx;
      g.save();
      g.globalAlpha = a;
      const wname = WEAPONS[k.weaponId]?.name ?? '';
      const label = `${k.killer}   ${wname}   ${k.victim}`;
      g.font = `bold 16px ${FONT}`;
      const wdt = g.measureText(label).width + 28;
      this.panel(this.w - wdt - 24, y - 20, wdt, 28, 130 + y, 0.62);
      this.text(k.killer, this.w - wdt - 10, y, 16, 'left', k.isPlayer ? RED : INK);
      this.text(`${wname}`, this.w - 24 - g.measureText(k.victim).width - 26, y, 14, 'right', INK_SOFT);
      this.text(k.victim, this.w - 34, y, 16, 'right', INK);
      g.restore();
      y += 34;
    }
  }

  _toasts() {
    let y = this.h - 190;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      const a = clamp((2.4 - t.t) / 0.6, 0, 1) * clamp(t.t / 0.12, 0, 1);
      const g = this.ctx;
      g.save();
      g.globalAlpha = a;
      this.textOutlined(t.text, this.w / 2, y, 20, 'center', INK);
      g.restore();
      y -= 30;
    }
  }

  _matchState(game) {
    const label = `FIRST TO ${game.killLimit}`;
    this.text(label, this.w / 2, 32, 15, 'center', INK_SOFT, 'normal');
    const you = game.player.kills;
    const lead = Math.max(0, ...game.bots.map((b) => b.kills));
    this.text(`YOU ${you}`, this.w / 2 - 60, 58, 22, 'right', INK);
    this.text('—', this.w / 2, 58, 20, 'center', INK_SOFT);
    this.text(`${lead} BEST BOT`, this.w / 2 + 60, 58, 22, 'left', INK);
  }

  _scoreboard(game) {
    const rows = [game.player, ...game.bots]
      .map((a) => ({ name: a.name, kills: a.kills, deaths: a.deaths, me: a.isPlayer, alive: a.alive }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const w = 460, h = 88 + rows.length * 34;
    const x = (this.w - w) / 2, y = (this.h - h) / 2;
    this.panel(x, y, w, h, 200, 0.93);
    this.text('SCOREBOARD', x + w / 2, y + 40, 26, 'center', INK);
    this.line(x + 24, y + 54, x + w - 24, y + 54, 2, 201);
    this.text('KILLS', x + w - 130, y + 76, 15, 'center', INK_SOFT);
    this.text('DEATHS', x + w - 54, y + 76, 15, 'center', INK_SOFT);
    let ry = y + 106;
    for (const r of rows) {
      this.text(r.name, x + 30, ry, 19, 'left', r.me ? RED : INK);
      if (!r.alive) this.text('(down)', x + 30 + this.ctx.measureText(r.name).width + 44, ry, 13, 'left', INK_SOFT, 'normal');
      this.text(`${r.kills}`, x + w - 130, ry, 20, 'center', INK);
      this.text(`${r.deaths}`, x + w - 54, ry, 20, 'center', INK_SOFT);
      ry += 34;
    }
  }

  _deathOverlay(game) {
    const p = game.player;
    const wait = Math.max(0, p.respawnAt - game.time);
    const cx = this.w / 2, cy = this.h / 2;
    this.textOutlined('YOU GOT SCRIBBLED OUT', cx, cy - 40, 40, 'center', RED);
    const by = p.lastAttacker ? `by ${p.lastAttacker.name}` : '';
    this.textOutlined(by, cx, cy + 4, 22, 'center', INK);
    this.textOutlined(wait > 0.05 ? `redrawn in ${wait.toFixed(1)}` : 'redrawing...', cx, cy + 50, 24, 'center', INK);
  }

  _fps(game) {
    this.text(`${Math.round(game.fps)} fps`, this.w - 18, 24, 15, 'right', INK_SOFT, 'normal');
    this.text(`anim ${game.animFps.toFixed(0)}`, this.w - 18, 44, 13, 'right', INK_SOFT, 'normal');
  }
}
