// Match orchestration: the world, the actors, the loop, and the two clocks that run it -
// a full-rate simulation clock and a 12fps animation clock everything is *drawn* on.

import { Renderer } from './renderer.js';
import { GameMap, WALL_H } from './map.js';
import { Entities } from './entities.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { buildWeaponModels, WEAPONS, randomGunId } from './weapons.js';
import { BODY_HEIGHT, BODY_RADIUS } from './combat.js';
import { BOT_NAMES } from './actors.js';
import { settings } from './settings.js';
import { Sfx, resumeAudio } from './audio.js';
import { M4, V, Rng, clamp, lerp, yawOf, dirFrom } from './math.js';

export const ANIM_HZ = 12;
const ANIM_DT = 1 / ANIM_HZ;
const RESPAWN_DELAY = 2.6;
const BOT_RESPAWN_DELAY = 3.2;

export class Game {
  constructor({ glCanvas, hudCanvas, ui }) {
    this.renderer = new Renderer(glCanvas);
    this.gl = this.renderer.gl;
    this.hud = new Hud(hudCanvas);
    this.input = new Input(glCanvas);
    this.ui = ui;

    this.weapons = buildWeaponModels(this.gl);
    this.botNames = [...BOT_NAMES];

    this.time = 0;
    this.animTime = 0;
    this.animFrame = 0;
    this.fps = 60;
    this.animFps = ANIM_HZ;
    this.showFps = settings.showFps;
    this.paused = true;
    this.running = false;
    this.matchOver = false;
    this.killLimit = settings.killLimit;

    this.camera = { pos: V.make(), yaw: 0, pitch: 0, roll: 0, fov: settings.fov, right: V.make(), up: V.make(), fwd: V.make() };
    this._lastNow = 0;
    this._accumAnim = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    this.player = new Player(this);
    this.player.ensureMeshes(this.gl);
    this.bots = [];
    this.actors = [this.player];

    this.map = null;
    this.entities = null;
    this.world = null;
    this.worldMesh = null;

    this._m = M4.create();
    this._v = V.make();

    this.input.onLockChange = (locked) => {
      if (!locked && this.running && !this.matchOver) this.setPaused(true);
    };

    this.newMatch();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------ setup

  newMatch(seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.killLimit = settings.killLimit;
    this.matchOver = false;
    this.winner = null;

    this.worldMesh?.fill.dispose();
    this.worldMesh?.ink.dispose();
    for (const b of this.bots) b.dispose();

    this.map = new GameMap(seed, 30, 30);
    this.renderer.ceilH = this.map.wallH;
    this.renderer.setColorSweep(this.map.colorOrigin, this.map.colorDir, this.map.colorSlope);
    this.worldMesh = this.map.build(this.gl);

    this.entities = new Entities(this.gl, this.map, this.rng, this.weapons);
    this.entities.spawnCrates(26);

    // Seed the floor with a few guns so the first thirty seconds aren't a knife fight.
    for (let i = 0; i < 5; i++) {
      const c = this.map.randomOpenCell(this.rng, 2);
      const p = this.map.worldOfCell(c);
      p.y = 0.24;
      this.entities.spawnPickup(randomGunId(this.rng), p, undefined, undefined, false, true);
    }

    this.bots = [];
    const count = clamp(Math.round(settings.botCount), 1, 8);
    // Shuffle names so the same bot isn't always "SCRIBBLE".
    for (let i = this.botNames.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [this.botNames[i], this.botNames[j]] = [this.botNames[j], this.botNames[i]];
    }
    for (let i = 0; i < count; i++) this.bots.push(new Bot(this, i, seed));

    this.actors = [this.player, ...this.bots];
    this.world = { map: this.map, entities: this.entities, actors: this.actors };

    this.player.kills = 0; this.player.deaths = 0;
    this.player.respawn(this.pickSpawn(null));
    for (const b of this.bots) { b.kills = 0; b.deaths = 0; b.respawn(this.pickSpawn(b)); b.animStep(ANIM_DT); }

    this.hud.killFeed.length = 0;
    this.hud.toasts.length = 0;
    this.time = 0;
    this.animFrame = 0;
    this.toast('FIND A GUN. SMASH THE CRATES.');
  }

  /** Spawn point that maximises distance from everyone currently alive. */
  pickSpawn(forActor) {
    let best = null, bestScore = -1;
    for (let t = 0; t < 60; t++) {
      const c = this.map.randomOpenCell(this.rng, 2);
      const p = this.map.worldOfCell(c);
      let score = Infinity;
      for (const a of this.actors) {
        if (a === forActor || !a.alive) continue;
        score = Math.min(score, V.distXZ(a.pos, p));
      }
      if (score === Infinity) score = 999;
      if (score > bestScore) { bestScore = score; best = p; }
      if (bestScore > 26) break;
    }
    best.y = 0;
    return best;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.inkAmount = settings.inkAmount;
    this.renderer.resize(w, h, dpr, settings.resolutionScale);
    this.hud.resize(w, h, dpr);
  }

  // ------------------------------------------------------------ loop

  start() {
    if (this.running) return;
    this.running = true;
    this._lastNow = performance.now();
    const step = (now) => {
      if (!this.running) return;
      this.frame(now);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setPaused(p) {
    if (this.paused === p) return;
    this.paused = p;
    if (p) { this.input.exitLock(); this.ui.showPause(); }
    else { this.ui.hideAll(); this.input.requestLock(); resumeAudio(); }
  }

  frame(now) {
    const raw = (now - this._lastNow) / 1000;
    this._lastNow = now;
    const dt = clamp(raw, 1 / 400, 1 / 25);

    this._fpsAccum += raw; this._fpsFrames++;
    if (this._fpsAccum > 0.4) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    if (!this.paused && !this.matchOver) {
      this.time += dt;
      this.update(dt);

      // The animation clock. Everything visual is sampled here and nowhere else, which
      // is what makes the world move on twelves while the camera stays at full rate.
      this._accumAnim += dt;
      let steps = 0;
      while (this._accumAnim >= ANIM_DT && steps < 4) {
        this._accumAnim -= ANIM_DT;
        this.animStep();
        steps++;
      }
      if (steps >= 4) this._accumAnim = 0;
    }

    this.hud.update(dt);
    this.render();
    this.input.endFrame();
  }

  update(dt) {
    const now = this.time;
    this.hud.showScores = this.input.down('Tab');

    this.player.update(dt, this.input, now);
    for (const b of this.bots) b.update(dt, now);
    this.entities.update(dt);

    // Respawns.
    if (!this.player.alive && now >= this.player.respawnAt) {
      this.player.respawn(this.pickSpawn(this.player));
      this.toast('BACK IN THE DRAWING');
    }
    for (const b of this.bots) {
      if (!b.alive && now >= b.respawnAt) b.respawn(this.pickSpawn(b));
    }

    if (this.input.hit('Escape')) this.setPaused(true);
    if (this.input.hit('KeyP')) this.setPaused(!this.paused);

    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    const p = this.player;
    const c = this.camera;
    V.copy(c.pos, p.eye);
    c.yaw = p.aimYaw;
    c.pitch = p.aimPitch;
    c.roll = p.roll;
    const targetFov = settings.fov * p.fovScale;
    c.fov = lerp(c.fov, targetFov, clamp(dt * 14, 0, 1));

    // Camera basis, used to orient billboards.
    dirFrom(c.yaw, c.pitch, c.fwd);
    V.set(c.right, Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    V.cross(c.up, c.right, c.fwd);
    V.norm(c.up, c.up);
    V.scale(c.fwd, c.fwd, -1);   // billboards face the camera
  }

  animStep() {
    this.animFrame++;
    this.animTime += ANIM_DT;
    this.player.animStep(ANIM_DT);
    const cam = this.camera;
    for (const b of this.bots) {
      const dx = b.pos.x - cam.pos.x, dz = b.pos.z - cam.pos.z;
      const d = Math.hypot(dx, dz);
      // Generous cone: better to re-bake a bot nobody sees than to catch one popping in.
      const facing = d < 1e-3 ? 1 : (dx * -cam.fwd.x + dz * -cam.fwd.z) / d;
      b.animStep(ANIM_DT, d < 9 || (facing > 0.15 && d < 75));
    }
    this.entities.animStep();
  }

  // ------------------------------------------------------------ world helpers

  /** Ground height at an XZ position, accounting for crates you can stand on. */
  groundHeight(x, z, currentY) {
    let g = 0;
    for (const c of this.entities.crates) {
      if (!c.alive) continue;
      const h = c.size * 0.5;
      if (x > c.pos.x - h - BODY_RADIUS * 0.7 && x < c.pos.x + h + BODY_RADIUS * 0.7 &&
          z > c.pos.z - h - BODY_RADIUS * 0.7 && z < c.pos.z + h + BODY_RADIUS * 0.7) {
        const top = c.pos.y + h;
        if (currentY >= top - 0.3 && top > g) g = top;
      }
    }
    return g;
  }

  /** Shared horizontal+vertical movement for every actor. */
  moveActor(a, dt) {
    const map = this.map;
    const ent = this.entities;
    const feet = a.pos.y;
    const blockCrates = (x, z) => {
      const c = ent.blocksCircle(x, z, BODY_RADIUS);
      if (!c) return false;
      return feet < c.pos.y + c.size * 0.5 - 0.12;   // you can walk over a crate you're on top of
    };
    const free = (x, z) => map._circleFree(x, z, BODY_RADIUS) && !blockCrates(x, z);

    const dx = a.vel.x * dt, dz = a.vel.z * dt;
    const nx = a.pos.x + dx;
    if (free(nx, a.pos.z)) a.pos.x = nx; else a.vel.x *= 0.1;
    const nz = a.pos.z + dz;
    if (free(a.pos.x, nz)) a.pos.z = nz; else a.vel.z *= 0.1;

    a.pos.y += a.vel.y * dt;
    const ground = this.groundHeight(a.pos.x, a.pos.z, a.pos.y);
    if (a.pos.y <= ground) {
      a.pos.y = ground;
      a.vel.y = 0;
      a.onGround = true;
    } else {
      a.onGround = false;
    }
    const headroom = WALL_H - BODY_HEIGHT;
    if (a.pos.y > headroom) { a.pos.y = headroom; if (a.vel.y > 0) a.vel.y = 0; }
  }

  /** Something loud happened. Bots within range go and look. */
  makeNoise(pos, radius, source) {
    for (const b of this.bots) {
      if (b === source || !b.alive) continue;
      if (V.distXZ(b.pos, pos) > radius) continue;
      b.hearNoise(pos, source);
    }
  }

  // ------------------------------------------------------------ combat events

  registerShot(shooter, origin, dir, hit, def) {
    const ent = this.entities;
    const isPlayer = shooter.isPlayer;

    // Tracer starts a little ahead of the eye so it doesn't stab through the camera.
    const start = V.make(
      origin.x + dir.x * (isPlayer ? 0.75 : 0.5),
      origin.y + dir.y * (isPlayer ? 0.75 : 0.5) - (isPlayer ? 0.06 : 0.18),
      origin.z + dir.z * (isPlayer ? 0.75 : 0.5));
    const end = hit.kind === 'none'
      ? V.make(origin.x + dir.x * def.range, origin.y + dir.y * def.range, origin.z + dir.z * def.range)
      : hit.point;
    ent.addTracer(start, end, def.id === 'sniper' ? 0.075 : 0.045);

    if (hit.kind === 'actor') {
      this.applyDamage(hit.target, hit.damage, shooter, hit.head, def);
    } else if (hit.kind === 'crate') {
      ent.addPuff(hit.point, 0.24);
      ent.damageCrate(hit.target, hit.damage, (c) => this.onCrateBroken(c));
      if (isPlayer) this.hud.addHitMarker(false);
    } else if (hit.kind === 'world') {
      ent.addDecal(hit.point, hit.normal, 0.30 + (def.id === 'sniper' ? 0.16 : 0));
      ent.addPuff(hit.point, 0.2);
      Sfx.ricochet(V.dist(hit.point, this.player.pos));
    }
  }

  registerMelee(shooter, origin, dir, res, def) {
    const ent = this.entities;
    if (res.kind === 'actor') {
      Sfx.stab(V.dist(shooter.pos, this.player.pos));
      this.applyDamage(res.target, res.damage, shooter, false, def);
    } else if (res.kind === 'crate') {
      Sfx.stab(V.dist(shooter.pos, this.player.pos));
      ent.damageCrate(res.target, res.damage, (c) => this.onCrateBroken(c));
      if (shooter.isPlayer) this.hud.addHitMarker(false);
    }
  }

  applyDamage(target, amount, attacker, head, def) {
    if (!target.alive) return;
    if (attacker?.isPlayer) {
      this.hud.addHitMarker(head);
      Sfx.hitMarker();
    }
    target.lastWeapon = def?.id ?? 'pistol';
    if (attacker) attacker.lastWeapon = def?.id ?? attacker.lastWeapon;
    target.takeDamage(amount, attacker);

    if (target.isPlayer && attacker) {
      const rel = yawOf(attacker.pos.x - target.pos.x, attacker.pos.z - target.pos.z) - target.yaw;
      this.hud.addDamageMark(-rel);
    }
  }

  onCrateBroken(crate) {
    Sfx.crateBreak(V.dist(crate.pos, this.player.pos));
    const gun = randomGunId(this.rng);
    const p = V.make(crate.pos.x, crate.pos.y + 0.2, crate.pos.z);
    this.entities.spawnPickup(gun, p, undefined, undefined, true, true);
    if (V.dist(crate.pos, this.player.pos) < 14) this.toast(`CRATE DROPPED A ${WEAPONS[gun].name}`);
  }

  killActor(victim, killer) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.dropGun?.();
    if (!victim.isPlayer) {
      // Bots drop whatever they were carrying too.
      const lo = victim.loadout;
      if (lo.gun) {
        this.entities.spawnPickup(lo.gun, V.make(victim.pos.x, victim.pos.y + 0.9, victim.pos.z), lo.ammo, lo.reserve);
        lo.gun = null; lo.slot = 'melee';
      }
      victim.onDeath();
      victim.respawnAt = this.time + BOT_RESPAWN_DELAY;
    } else {
      victim.respawnAt = this.time + RESPAWN_DELAY;
      Sfx.death();
    }
    this.entities.addShards(V.make(victim.pos.x, victim.pos.y + 1.0, victim.pos.z), 8, 2.2);

    const weaponId = killer?.loadout?.id ?? 'pistol';
    if (killer && killer !== victim) {
      killer.kills++;
      this.hud.addKill(killer.name, victim.name, weaponId, killer.isPlayer);
      if (killer.isPlayer) { Sfx.kill(); this.toast(`YOU SCRIBBLED OUT ${victim.name}`); }
    } else {
      this.hud.addKill('—', victim.name, weaponId, false);
    }

    const top = Math.max(...this.actors.map((a) => a.kills));
    if (top >= this.killLimit) this.endMatch();
  }

  endMatch() {
    this.matchOver = true;
    const sorted = [...this.actors].sort((a, b) => b.kills - a.kills);
    this.winner = sorted[0];
    this.input.exitLock();
    if (this.winner.isPlayer) Sfx.win(); else Sfx.lose();
    this.ui.showEnd(this.winner, sorted);
  }

  toast(text) { this.hud.addToast(text); }

  // ------------------------------------------------------------ render

  render() {
    const r = this.renderer;
    r.inkAmount = settings.inkAmount;
    // The wobble seed only changes on an animation step, so lines hold still between them.
    r.beginFrame(this.camera, this.animFrame * 0.7351);

    r.fill(this.worldMesh.fill, null, { objSeed: 0 });
    r.ink(this.worldMesh.ink, null, { objSeed: 0 });

    this.entities.render(r, this.camera);
    for (const b of this.bots) b.render(r, this.camera);
    this.player.renderViewmodel(r);

    const p = this.player;
    r.endFrame({
      scope: p.loadout.def.scope ? p.loadout.scopeT : 0,
      scopeRadius: 0.345,
      damage: p.damageFlash,
      death: p.alive ? 0 : clamp(p.deathTimer * 1.6, 0, 0.8),
    });

    // No HUD behind the menus - the start screen was reading as a pile of overlapping UI.
    if (!this.paused && !this.matchOver) this.hud.draw(this);
    else this.hud.clear();
  }
}

export { settings, WEAPONS };
