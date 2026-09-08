// Match orchestration: the world, the actors, the loop, and the two clocks that run it -
// a full-rate simulation clock and a 12fps animation clock everything is *drawn* on.

import { Renderer } from './renderer.js';
import { GameMap, WALL_H, CELL } from './map.js';
import { Entities } from './entities.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { buildWeaponModels, WEAPONS, randomGunId } from './weapons.js';
import { BODY_HEIGHT, BODY_RADIUS } from './combat.js';
import { BOT_NAMES } from './actors.js';
import { Shield, Turret, buildSkillMeshes } from './skills.js';
import { getDoodler } from './doodlers.js';
import { settings } from './settings.js';
import { Sfx, resumeAudio } from './audio.js';
import { M4, V, Rng, clamp, lerp, smoothstep, yawOf, dirFrom } from './math.js';

export const ANIM_HZ = 12;
const ANIM_DT = 1 / ANIM_HZ;
const RESPAWN_DELAY = 2.6;
const BOT_RESPAWN_DELAY = 3.2;
export const HEART_HEAL = 2;      // a heart is a small top-up, not a medkit

export class Game {
  constructor({ glCanvas, hudCanvas, ui }) {
    this.renderer = new Renderer(glCanvas);
    this.gl = this.renderer.gl;
    this.hud = new Hud(hudCanvas);
    this.input = new Input(glCanvas);
    this.ui = ui;

    this.weapons = buildWeaponModels(this.gl);
    this.skillMeshes = buildSkillMeshes(this.gl);
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
    this.shields = [];
    this.turrets = [];

    this.map = null;
    this.entities = null;
    this.world = null;
    this.worldMesh = null;
    this.chunkMask = null;

    // Sniper impact frame: a single black-and-white frame spliced in on a solid hit.
    this.impact = { t: 0, dur: 0.65, point: V.make(), uv: [0.5, 0.5] };

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

    if (this.worldMesh) for (const c of this.worldMesh.chunks) { c.fill.dispose(); c.ink.dispose(); }
    for (const b of this.bots) b.dispose();

    this.map = new GameMap(seed, 30, 30);
    this.renderer.ceilH = this.map.wallH;
    this.renderer.setColorSweep(this.map.colorOrigin, this.map.colorDir, this.map.colorSlope);
    this.worldMesh = this.map.build(this.gl);
    this.chunkMask = new Uint8Array(this.worldMesh.chunksX * this.worldMesh.chunksZ);

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
    this.shields.length = 0;
    this.turrets.length = 0;
    this.world = { map: this.map, entities: this.entities, actors: this.actors, shields: this.shields };

    this.player.kills = 0; this.player.deaths = 0;
    this.player.applyDoodler(settings.doodler);
    this.player.respawn(this.pickSpawn(null));
    this.onActorSpawned(this.player);
    for (const b of this.bots) { b.kills = 0; b.deaths = 0; b.respawn(this.pickSpawn(b)); b.animStep(ANIM_DT); }

    this.hud.killFeed.length = 0;
    this.hud.toasts.length = 0;
    this.time = 0;
    this.animFrame = 0;
    this.impact.t = 0;
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
    this.collectHearts(this.player);
    for (const b of this.bots) this.collectHearts(b);

    for (let i = this.shields.length - 1; i >= 0; i--) {
      const sh = this.shields[i];
      if (!sh.owner.alive) { this.shields.splice(i, 1); continue; }
      sh.update(dt, this.time);
    }
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      t.update(dt, this);
      if (!t.alive) this.turrets.splice(i, 1);
    }
    if (this.impact.t > 0) this.impact.t = Math.max(0, this.impact.t - dt);

    // Respawns.
    if (!this.player.alive && now >= this.player.respawnAt) {
      this.player.respawn(this.pickSpawn(this.player));
      this.onActorSpawned(this.player);
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
    // A little FOV stretch as the run builds, so speed is felt as well as seen.
    const targetFov = settings.fov * p.fovScale + p.momentum * 7 * (1 - p.loadout.scopeT);
    c.fov = lerp(c.fov, targetFov, clamp(dt * 14, 0, 1));

    // Camera basis, used to orient billboards.
    dirFrom(c.yaw, c.pitch, c.fwd);
    V.set(c.right, Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    V.cross(c.up, c.right, c.fwd);
    V.norm(c.up, c.up);
    V.scale(c.fwd, c.fwd, -1);   // billboards face the camera
  }

  /** Seconds elapsed since the last 12fps animation step. */
  get animLag() { return this._accumAnim; }

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
    for (const t of this.turrets) t.animStep();
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
    let blocked = false;
    const nx = a.pos.x + dx;
    if (free(nx, a.pos.z)) a.pos.x = nx;
    else { if (Math.abs(dx) > 1e-4) blocked = true; a.vel.x *= 0.1; }
    const nz = a.pos.z + dz;
    if (free(a.pos.x, nz)) a.pos.z = nz;
    else { if (Math.abs(dz) > 1e-4) blocked = true; a.vel.z *= 0.1; }

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
    return blocked;
  }

  // ------------------------------------------------------------ skills

  shieldOf(owner) {
    for (const s of this.shields) if (s.owner === owner) return s;
    return null;
  }

  spawnShield(owner) {
    const existing = this.shieldOf(owner);
    if (existing) { existing.reset(); return existing; }
    const sh = new Shield(owner);
    sh.update(0, this.time);
    this.shields.push(sh);
    return sh;
  }

  removeShield(owner) {
    const i = this.shields.findIndex((s) => s.owner === owner);
    if (i >= 0) this.shields.splice(i, 1);
  }

  /** Drop a turret on open floor just in front of its owner. */
  placeTurret(owner) {
    const dir = dirFrom(owner.yaw, 0, this._v);
    for (const dist of [1.9, 1.5, 1.2, 2.4]) {
      const x = owner.pos.x + dir.x * dist;
      const z = owner.pos.z + dir.z * dist;
      if (!this.map._circleFree(x, z, 0.55)) continue;
      if (this.entities.blocksCircle(x, z, 0.55)) continue;
      const pos = V.make(x, this.groundHeight(x, z, owner.pos.y + 0.5), z);
      this.turrets.push(new Turret(owner, pos, this.rng));
      return true;
    }
    this.toast('NO ROOM FOR A TURRET');
    return false;
  }

  /** Give a freshly spawned actor whatever their class starts with. */
  onActorSpawned(a) {
    if (a.doodler?.skill?.id === 'shield') this.spawnShield(a);
  }

  /** Hearts are walked over, not picked up with a key - by anyone, bots included. */
  collectHearts(a) {
    if (!a.alive || a.health >= a.maxHealth) return;
    const list = this.entities.pickups;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.kind !== 'heart') continue;
      if (V.distXZ(a.pos, p.pos) > 1.15 || Math.abs(p.pos.y - a.pos.y) > 1.8) continue;
      a.health = Math.min(a.maxHealth, a.health + HEART_HEAL);
      this.entities.removePickup(p);
      Sfx.pickup(a.isPlayer ? 0 : V.dist(a.pos, this.player.pos));
      if (a.isPlayer) this.toast(`+${HEART_HEAL} HP`);
      return;
    }
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
      // A sniper round connecting is the one moment worth stopping the drawing for.
      if (def.id === 'sniper' && shooter.isPlayer) {
        this.impact.t = this.impact.dur;
        V.copy(this.impact.point, hit.point);
      }
    } else if (hit.kind === 'crate') {
      ent.addPuff(hit.point, 0.24);
      ent.damageCrate(hit.target, hit.damage, (c) => this.onCrateBroken(c));
      if (isPlayer) this.hud.addHitMarker(false);
    } else if (hit.kind === 'shield') {
      const broke = hit.target.takeDamage(hit.damage);
      ent.addPuff(hit.point, 0.22);
      if (isPlayer) this.hud.addHitMarker(false);
      if (broke) {
        ent.addShards(hit.point, 12, 2.4);
        Sfx.crateBreak(V.dist(hit.point, this.player.pos));
        if (hit.target.owner.isPlayer) this.toast('SHIELD BROKE');
      } else {
        Sfx.ricochet(V.dist(hit.point, this.player.pos));
      }
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
    // Most crates also cough up a heart alongside the gun.
    if (this.rng.chance(0.75)) this.entities.spawnHeart(p);
    if (V.dist(crate.pos, this.player.pos) < 14) this.toast(`CRATE DROPPED A ${WEAPONS[gun].name}`);
  }

  killActor(victim, killer) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.deaths++;
    victim.dropGun?.();
    this.removeShield(victim);
    for (const t of this.turrets) if (t.owner === victim) t.expire(this);
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
    // Set the flag directly rather than through setPaused, which would swap the end
    // screen out for the pause menu. Without this, paused is already false when PLAY
    // AGAIN calls setPaused(false), it early-outs, and the popup never goes away.
    this.paused = true;
    const sorted = [...this.actors].sort((a, b) => b.kills - a.kills);
    this.winner = sorted[0];
    this.input.exitLock();
    if (this.winner.isPlayer) Sfx.win(); else Sfx.lose();
    this.ui.showEnd(this.winner, sorted);
  }

  toast(text) { this.hud.addToast(text); }

  /**
   * Impact-frame parameters. Real-time driven, so it lasts 0.65s at any frame rate: a
   * short hold at full strength, then a fade so you get your view back.
   */
  _impactPost(r) {
    const it = this.impact.t;
    if (it <= 0) return { impact: 0 };
    const age = this.impact.dur - it;
    const strength = age < 0.11 ? 1 : 1 - smoothstep(0.11, this.impact.dur, age);
    const s = r.worldToScreen(this.impact.point);
    if (s) this.impact.uv = [s.x / r.width, 1 - s.y / r.height];
    return {
      impact: strength,
      impactUv: this.impact.uv,
      impactR: lerp(0.05, 0.30, clamp(age / 0.16, 0, 1)),
    };
  }

  // ------------------------------------------------------------ render

  /** The eight ceiling panels nearest the player, for the lamp falloff term. */
  _updateLights() {
    const r = this.renderer;
    if (!r.fancy) { r.lightCount = 0; return; }
    const lights = this.map.lights;
    const buf = this._lightBuf || (this._lightBuf = new Float32Array(8 * 4));
    const best = this._lightBest || (this._lightBest = []);
    best.length = 0;
    const px = this.camera.pos.x, pz = this.camera.pos.z;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      const x = (L.i + 0.5) * CELL, z = (L.j + 0.5) * CELL;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d > 26 * 26) continue;
      best.push({ d, x, z });
    }
    best.sort((a, b) => a.d - b.d);
    const n = Math.min(8, best.length);
    for (let i = 0; i < n; i++) {
      buf[i * 4] = best[i].x;
      buf[i * 4 + 1] = this.map.wallH - 0.10;
      buf[i * 4 + 2] = best[i].z;
      buf[i * 4 + 3] = 11.0;               // reach
    }
    r.setLights(buf, n);
  }

  /** Everything that should show up in the shadow map. */
  _queueShadowCasters(r) {
    if (!r.fancy) return;
    const px = this.camera.pos.x, pz = this.camera.pos.z;
    const R = 30;
    for (const c of this.worldMesh.chunks) {
      if (c.max[0] < px - R || c.min[0] > px + R || c.max[2] < pz - R || c.min[2] > pz + R) continue;
      r.shadow(c.fill, null);
    }
    const m = this._m;
    for (const crate of this.entities.crates) {
      if (!crate.alive) continue;
      if (Math.abs(crate.pos.x - px) > R || Math.abs(crate.pos.z - pz) > R) continue;
      M4.compose(m, crate.pos, crate.yaw, 0, 0, crate.size, crate.size, crate.size);
      r.shadow(this.entities.crateMesh.fill, m);
    }
    for (const b of this.bots) {
      if (!b.rig.fill) continue;
      if (Math.abs(b.animPos.x - px) > R || Math.abs(b.animPos.z - pz) > R) continue;
      M4.compose(m, b.animPos, b.animYaw, 0, 0, 1, 1, 1);
      r.shadow(b.rig.fill, m);
    }
    for (const t of this.turrets) {
      if (!t.alive) continue;
      M4.compose(m, t.pos, 0, 0, 0, 1.3, 1.3, 1.3);
      r.shadow(this.skillMeshes.turretBase.fill, m);
    }
  }

  render() {
    const r = this.renderer;
    r.fancy = !!settings.fancy;
    r.inkAmount = settings.inkAmount;
    // The wobble seed only changes on an animation step, so lines hold still between them.
    r.beginFrame(this.camera, this.animFrame * 0.7351);

    // Only submit the chunks the camera can reach and see.
    this.map.computeVisibleChunks(this.camera.pos, r.frustum, this.chunkMask);
    const chunks = this.worldMesh.chunks;
    r.stats.chunks = chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      if (!this.chunkMask[chunks[i].index]) continue;
      r.stats.chunksDrawn++;
      r.fill(chunks[i].fill, null, { objSeed: 0 });
      r.ink(chunks[i].ink, null, { objSeed: 0 });
    }

    this._updateLights();
    this._queueShadowCasters(r);

    this.entities.render(r, this.camera);
    for (const sh of this.shields) sh.render(r, this.skillMeshes);
    for (const t of this.turrets) t.render(r, this.skillMeshes, this);
    for (const b of this.bots) {
      r.stats.actors++;
      // Generous radius: the rig reaches about a metre out from the root in any direction.
      if (!r.frustum.sphere(b.animPos.x, b.animPos.y + 0.9, b.animPos.z, 1.6)) continue;
      r.stats.actorsDrawn++;
      b.render(r, this.camera);
    }
    this.player.renderViewmodel(r);

    const p = this.player;
    r.endFrame({
      scope: p.loadout.def.scope ? p.loadout.scopeT : 0,
      scopeRadius: 0.345,
      damage: p.damageFlash,
      death: p.alive ? 0 : clamp(p.deathTimer * 1.6, 0, 0.8),
      ...this._impactPost(r),
    });

    // No HUD behind the menus - the start screen was reading as a pile of overlapping UI.
    if (!this.paused && !this.matchOver) this.hud.draw(this);
    else this.hud.clear();
  }
}

export { settings, WEAPONS };
