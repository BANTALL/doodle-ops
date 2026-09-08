// Weapon definitions and their hand-drawn models. Each gun bakes down to two meshes -
// a body and one moving part (slide / bolt / blade) - so a whole weapon is two draw calls.

import { FillBuilder, InkBuilder, pushOrientedBox } from './geom.js';
import { MAT } from './renderer.js';

export const KNIFE = 'knife';

/**
 * damage      per body hit (head multiplies it)
 * rate        seconds between shots - "speed" in the brief
 * mag         rounds before a reload
 * spread      cone half-angle in degrees, standing still
 * moveSpread  extra cone while running
 * recoil      vertical kick per shot, degrees
 */
export const WEAPONS = {
  knife: {
    id: 'knife', name: 'KNIFE', kind: 'melee', slot: 'melee',
    damage: 42, headMult: 1.6, rate: 0.46, range: 2.35, auto: true,
    moveMult: 1.14, drawTime: 0.28, hitDelay: 0.11,
  },
  pistol: {
    id: 'pistol', name: 'PISTOL', kind: 'gun', slot: 'gun',
    damage: 26, headMult: 2.0, rate: 0.30, mag: 12, reserve: 60, reload: 1.35,
    spread: 0.55, moveSpread: 2.4, recoil: 1.5, recoilSide: 0.35, auto: false,
    range: 110, moveMult: 1.0, drawTime: 0.34, bulletsPerShot: 1,
    color: [0.42, 0.43, 0.48],
  },
  m4: {
    id: 'm4', name: 'M4', kind: 'gun', slot: 'gun',
    damage: 14, headMult: 2.0, rate: 0.082, mag: 50, reserve: 180, reload: 2.15,
    spread: 0.75, moveSpread: 3.1, recoil: 0.62, recoilSide: 0.28, auto: true,
    range: 130, moveMult: 0.94, drawTime: 0.45, bulletsPerShot: 1,
    color: [0.34, 0.35, 0.38],
  },
  sniper: {
    id: 'sniper', name: 'SNIPER', kind: 'gun', slot: 'gun',
    damage: 88, headMult: 2.2, rate: 1.55, mag: 1, reserve: 16, reload: 1.7,
    spread: 1.9, scopedSpread: 0.06, moveSpread: 5.0, recoil: 3.4, recoilSide: 0.5, auto: false,
    range: 220, moveMult: 0.86, drawTime: 0.6, bulletsPerShot: 1,
    scope: true, scopeFov: 22, scopeTime: 0.16,
    color: [0.30, 0.26, 0.22],
  },
};

export const GUN_IDS = ['pistol', 'm4', 'sniper'];

/** Weighted random gun for crate drops - the sniper stays rare on purpose. */
export function randomGunId(rng) {
  const r = rng.next();
  if (r < 0.44) return 'm4';
  if (r < 0.80) return 'pistol';
  return 'sniper';
}

// ---------------------------------------------------------------- models

function bake(gl, drawBody, drawMoving, inkWidth) {
  const bf = new FillBuilder(), bi = new InkBuilder();
  drawBody(bf, bi);
  const out = { body: { fill: bf.toMesh(gl), ink: bi.toMesh(gl) }, moving: null };
  if (drawMoving) {
    const mf = new FillBuilder(), mi = new InkBuilder();
    drawMoving(mf, mi);
    out.moving = { fill: mf.toMesh(gl), ink: mi.toMesh(gl) };
  }
  out.inkWidth = inkWidth;
  return out;
}

/**
 * Weapon local space: barrel points down -Z, up is +Y, the grip sits near the origin.
 * Everything is drawn chunky and slightly oversized - a doodle of a gun, not a gun.
 */
function buildPistol(gl) {
  const IW = 1.5;
  return bake(gl,
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0, 0.012, -0.10], size: [0.052, 0.052, 0.30], mat: MAT.DARK, inkWidth: IW });       // frame
      pushOrientedBox(f, i, { pos: [0, -0.085, 0.035], size: [0.05, 0.15, 0.085], rot: [0.30, 0, 0], mat: MAT.DARK, inkWidth: IW }); // grip
      pushOrientedBox(f, i, { pos: [0, -0.052, -0.045], size: [0.024, 0.012, 0.075], mat: MAT.METAL, inkWidth: IW * 0.8 }); // trigger guard bar
      pushOrientedBox(f, i, { pos: [0, -0.028, -0.028], size: [0.016, 0.036, 0.016], mat: MAT.METAL, inkWidth: IW * 0.8 }); // trigger
      pushOrientedBox(f, i, { pos: [0, 0.052, -0.245], size: [0.012, 0.020, 0.014], mat: MAT.DARK, inkWidth: IW * 0.8 });   // front sight
    },
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0, 0.052, -0.115], size: [0.058, 0.058, 0.30], mat: MAT.METAL, inkWidth: IW });        // slide
      pushOrientedBox(f, i, { pos: [0, 0.052, -0.268], size: [0.026, 0.026, 0.03], mat: MAT.DARK, inkWidth: IW * 0.8 });   // muzzle
    }, IW);
}

function buildM4(gl) {
  const IW = 1.5;
  return bake(gl,
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0, 0.02, -0.13], size: [0.055, 0.075, 0.40], mat: MAT.METAL, inkWidth: IW });         // receiver
      pushOrientedBox(f, i, { pos: [0, 0.005, -0.45], size: [0.062, 0.062, 0.26], mat: MAT.DARK, inkWidth: IW });         // handguard
      pushOrientedBox(f, i, { pos: [0, 0.012, -0.66], size: [0.024, 0.024, 0.20], mat: MAT.METAL, inkWidth: IW * 0.85 }); // barrel
      pushOrientedBox(f, i, { pos: [0, 0.012, -0.77], size: [0.036, 0.036, 0.055], mat: MAT.DARK, inkWidth: IW * 0.85 }); // flash hider
      pushOrientedBox(f, i, { pos: [0, -0.088, 0.005], size: [0.048, 0.145, 0.075], rot: [0.24, 0, 0], mat: MAT.DARK, inkWidth: IW }); // grip
      pushOrientedBox(f, i, { pos: [0, 0.0, 0.19], size: [0.052, 0.10, 0.24], mat: MAT.DARK, inkWidth: IW });            // stock
      pushOrientedBox(f, i, { pos: [0, 0.072, -0.09], size: [0.022, 0.030, 0.34], mat: MAT.METAL, inkWidth: IW * 0.8 });  // rail
      pushOrientedBox(f, i, { pos: [0, 0.098, -0.55], size: [0.014, 0.042, 0.016], mat: MAT.DARK, inkWidth: IW * 0.8 });  // front post
      pushOrientedBox(f, i, { pos: [0, 0.098, 0.02], size: [0.030, 0.034, 0.03], mat: MAT.DARK, inkWidth: IW * 0.8 });    // rear sight
      pushOrientedBox(f, i, { pos: [0, -0.052, -0.035], size: [0.016, 0.036, 0.016], mat: MAT.METAL, inkWidth: IW * 0.7 }); // trigger
    },
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0, -0.115, -0.115], size: [0.042, 0.185, 0.075], rot: [-0.10, 0, 0], mat: MAT.METAL, inkWidth: IW }); // magazine
      pushOrientedBox(f, i, { pos: [0.04, 0.045, -0.02], size: [0.028, 0.028, 0.05], mat: MAT.METAL, inkWidth: IW * 0.7 });               // charging handle
    }, IW);
}

function buildSniper(gl) {
  const IW = 1.5;
  return bake(gl,
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0, 0.01, -0.16], size: [0.056, 0.078, 0.46], mat: MAT.METAL, inkWidth: IW });         // receiver
      pushOrientedBox(f, i, { pos: [0, 0.005, -0.62], size: [0.030, 0.030, 0.52], mat: MAT.METAL, inkWidth: IW * 0.9 });  // long barrel
      pushOrientedBox(f, i, { pos: [0, 0.005, -0.90], size: [0.044, 0.044, 0.07], mat: MAT.DARK, inkWidth: IW * 0.9 });   // muzzle brake
      pushOrientedBox(f, i, { pos: [0, -0.088, 0.02], size: [0.046, 0.15, 0.072], rot: [0.26, 0, 0], mat: MAT.CRATE, inkWidth: IW });     // grip
      pushOrientedBox(f, i, { pos: [0, -0.01, 0.26], size: [0.056, 0.115, 0.32], rot: [-0.06, 0, 0], mat: MAT.CRATE, inkWidth: IW });     // wooden stock
      pushOrientedBox(f, i, { pos: [0, -0.062, -0.30], size: [0.05, 0.055, 0.19], mat: MAT.CRATE, inkWidth: IW * 0.9 });  // forend
      // Scope: tube plus two rings.
      pushOrientedBox(f, i, { pos: [0, 0.115, -0.20], size: [0.052, 0.052, 0.36], mat: MAT.DARK, inkWidth: IW });
      pushOrientedBox(f, i, { pos: [0, 0.115, -0.40], size: [0.070, 0.070, 0.055], mat: MAT.DARK, inkWidth: IW * 0.9 });  // objective bell
      pushOrientedBox(f, i, { pos: [0, 0.115, -0.02], size: [0.062, 0.062, 0.05], mat: MAT.DARK, inkWidth: IW * 0.9 });   // eyepiece
      pushOrientedBox(f, i, { pos: [0, 0.075, -0.31], size: [0.020, 0.045, 0.022], mat: MAT.METAL, inkWidth: IW * 0.7 }); // mount
      pushOrientedBox(f, i, { pos: [0, 0.075, -0.09], size: [0.020, 0.045, 0.022], mat: MAT.METAL, inkWidth: IW * 0.7 });
      pushOrientedBox(f, i, { pos: [0, -0.055, -0.04], size: [0.016, 0.038, 0.016], mat: MAT.METAL, inkWidth: IW * 0.7 }); // trigger
    },
    (f, i) => {
      pushOrientedBox(f, i, { pos: [0.045, 0.045, 0.02], size: [0.026, 0.026, 0.16], mat: MAT.METAL, inkWidth: IW * 0.8 });                 // bolt
      pushOrientedBox(f, i, { pos: [0.085, 0.030, 0.075], size: [0.024, 0.024, 0.024], rot: [0, 0, 0.5], mat: MAT.METAL, inkWidth: IW * 0.8 }); // bolt handle
      pushOrientedBox(f, i, { pos: [0, -0.088, -0.14], size: [0.036, 0.08, 0.06], mat: MAT.METAL, inkWidth: IW * 0.8 });                    // magazine
    }, IW);
}

function buildKnife(gl) {
  const IW = 1.6;
  const f = new FillBuilder(), i = new InkBuilder();
  // Blade as a flat tapered slab, spine thicker than the edge.
  pushOrientedBox(f, i, { pos: [0, 0.01, -0.19], size: [0.016, 0.062, 0.30], mat: MAT.METAL, inkWidth: IW });
  pushOrientedBox(f, i, { pos: [0, 0.004, -0.37], size: [0.012, 0.038, 0.09], rot: [0, 0, 0], mat: MAT.METAL, inkWidth: IW * 0.85 }); // point
  pushOrientedBox(f, i, { pos: [0, 0.0, -0.02], size: [0.055, 0.020, 0.035], mat: MAT.DARK, inkWidth: IW * 0.9 });                    // guard
  pushOrientedBox(f, i, { pos: [0, -0.005, 0.075], size: [0.038, 0.045, 0.15], mat: MAT.CRATE, inkWidth: IW });                       // handle
  pushOrientedBox(f, i, { pos: [0, -0.005, 0.155], size: [0.046, 0.052, 0.02], mat: MAT.DARK, inkWidth: IW * 0.8 });                  // pommel
  return { body: { fill: f.toMesh(gl), ink: i.toMesh(gl) }, moving: null, inkWidth: IW };
}

/** Cartoon mitten hands. One mesh, instanced twice with different transforms. */
function buildHand(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  pushOrientedBox(f, i, { pos: [0, 0, 0], size: [0.085, 0.075, 0.11], mat: MAT.SKIN, inkWidth: 1.7 });          // palm
  pushOrientedBox(f, i, { pos: [0, 0.012, -0.075], size: [0.078, 0.058, 0.055], mat: MAT.SKIN, inkWidth: 1.5 }); // fingers
  pushOrientedBox(f, i, { pos: [0.045, 0.03, -0.015], size: [0.03, 0.045, 0.06], rot: [0, 0, -0.5], mat: MAT.SKIN, inkWidth: 1.4 }); // thumb
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

/** Sleeve/forearm running off the bottom of the screen, so hands aren't floating. */
function buildArm(gl) {
  const f = new FillBuilder(), i = new InkBuilder();
  pushOrientedBox(f, i, { pos: [0, 0, 0.16], size: [0.10, 0.10, 0.34], mat: MAT.GREEN, inkWidth: 1.7 });
  pushOrientedBox(f, i, { pos: [0, 0, -0.02], size: [0.105, 0.105, 0.05], mat: MAT.DARK, inkWidth: 1.5 }); // cuff
  return { fill: f.toMesh(gl), ink: i.toMesh(gl) };
}

export function buildWeaponModels(gl) {
  return {
    models: {
      pistol: buildPistol(gl),
      m4: buildM4(gl),
      sniper: buildSniper(gl),
      knife: buildKnife(gl),
    },
    hand: buildHand(gl),
    arm: buildArm(gl),
  };
}

/** Where the muzzle sits in weapon-local space - flashes and tracers start here. */
export const MUZZLE = {
  pistol: [0, 0.052, -0.30],
  m4: [0, 0.012, -0.80],
  sniper: [0, 0.005, -0.94],
  knife: [0, 0.0, -0.40],
};

/** Resting pose of the weapon in eye space: [x, y, z] then [pitch, yaw, roll]. */
export const HOLD = {
  pistol: { pos: [0.200, -0.175, -0.430], rot: [0.015, 0.115, -0.055], grip: [0, -0.075, 0.045], support: [-0.045, -0.10, -0.02] },
  m4:     { pos: [0.205, -0.180, -0.345], rot: [0.010, 0.125, -0.075], grip: [0, -0.085, 0.005], support: [0, -0.055, -0.44] },
  sniper: { pos: [0.200, -0.180, -0.300], rot: [0.008, 0.110, -0.065], grip: [0, -0.085, 0.02], support: [0, -0.075, -0.30] },
  knife:  { pos: [0.255, -0.245, -0.360], rot: [-0.34, 0.30, 0.42], grip: [0, -0.01, 0.085], support: null },
};

/** Recoil profile of the moving part: how far it travels and how fast it returns. */
export const CYCLE = {
  pistol: { travel: 0.055, time: 0.09 },
  m4: { travel: 0.030, time: 0.05 },
  sniper: { travel: 0.075, time: 0.55 },
};

/** Aimed-down-sights pose, used when the sniper scope comes up. */
export const ADS = {
  sniper: { pos: [0.0, -0.116, -0.235], rot: [0, 0, 0] },
};

export function makeInventory(gunId = 'pistol') {
  const def = WEAPONS[gunId];
  return {
    gun: gunId,
    ammo: def && def.kind === 'gun' ? def.mag : 0,
    reserve: def && def.kind === 'gun' ? Math.round(def.reserve * 0.45) : 0,
  };
}
