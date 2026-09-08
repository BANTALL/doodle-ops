// Doodle humanoid rig. The pose is only ever recomputed on a 12fps animation step, and
// when it is we re-bake the whole body into two meshes - so a bot costs two draw calls
// and the stop-motion cadence falls out of the update schedule rather than being faked.

import { FillBuilder, InkBuilder, pushOrientedBox } from './geom.js';
import { MAT } from './renderer.js';
import { M4, V, clamp, lerp } from './math.js';

export const SHIRT_MATS = [MAT.RED, MAT.BLUE, MAT.GREEN, MAT.PURPLE, MAT.ORANGE];

export const BOT_NAMES = ['SCRIBBLE', 'BLOTCH', 'SMUDGE', 'DOODLE', 'INKY', 'SKETCH', 'CRAYON', 'ERASER'];

const IW = 1.9; // ink width for characters - a bit heavier than the walls

/** Rotate a local offset by an euler triple matching M4.compose's Ry*Rx*Rz order. */
function rot(p, rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz,                m11 = cx * cz,                 m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
  return [
    m00 * p[0] + m01 * p[1] + m02 * p[2],
    m10 * p[0] + m11 * p[1] + m12 * p[2],
    m20 * p[0] + m21 * p[1] + m22 * p[2],
  ];
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Box spanning two points. Solves the euler pair that maps the box's local -Y onto the
 * a -> b direction, matching the rotation order pushOrientedBox uses.
 */
function boneTo(f, i, a, b, thick, mat) {
  const d = sub(b, a);
  const L = len3(d);
  if (L < 1e-4) return b;
  const u = mul(d, 1 / L);
  const rx = Math.acos(clamp(-u[1], -1, 1));
  const sx = Math.sqrt(Math.max(1e-6, 1 - u[1] * u[1]));
  const ry = Math.atan2(-u[0] / sx, -u[2] / sx);
  pushOrientedBox(f, i, {
    pos: mul(add(a, b), 0.5), size: [thick, L, thick * 0.92],
    rot: [rx, ry, 0], mat, inkWidth: IW,
  });
  return b;
}

/**
 * Two-bone IK. Returns the elbow that puts the hand on `target`, bent toward `pole`.
 * This is what stops the bots tucking a rifle under one armpit: instead of posing the
 * arms and hoping the gun lands somewhere sensible, the gun's grip is decided first and
 * the arms are solved to reach it - the same way the player's hands are placed.
 */
function ikElbow(shoulder, target, upperLen, lowerLen, pole) {
  let d = sub(target, shoulder);
  let L = len3(d);
  const maxL = (upperLen + lowerLen) * 0.995;
  if (L > maxL) { d = mul(d, maxL / L); L = maxL; }
  if (L < 1e-4) { d = [0, -1e-4, 0]; L = 1e-4; }
  const dir = mul(d, 1 / L);
  const cosA = clamp((upperLen * upperLen + L * L - lowerLen * lowerLen) / (2 * upperLen * L), -1, 1);
  const a = Math.acos(cosA);
  let perp = sub(pole, mul(dir, dot3(pole, dir)));
  if (len3(perp) < 1e-4) perp = sub([0, -1, 0], mul(dir, dot3([0, -1, 0], dir)));
  if (len3(perp) < 1e-4) perp = [1, 0, 0];
  perp = norm3(perp);
  return add(shoulder, add(mul(dir, upperLen * Math.cos(a)), mul(perp, upperLen * Math.sin(a))));
}

/**
 * Where the weapon's grip sits in character space. Shared by the rig (as the IK target)
 * and by the bot renderer (as the weapon's transform), so hands and gun cannot disagree.
 */
export function gripTarget(hipY, spineRx, torsoRz, aimPitch, aimAmt) {
  const chest = add([0, hipY, 0], rot([0, 0.30, 0], spineRx, 0, torsoRz));
  const p = aimPitch;
  const fwd = [0, Math.sin(p), -Math.cos(p)];
  // Up at the shoulder when aiming, down by the hip when not.
  const aimed = add(chest, add([0.11, 0.10, 0], mul(fwd, 0.36)));
  const lowered = add(chest, [0.24, -0.30, -0.14]);
  const t = clamp(aimAmt, 0, 1);
  return { pos: [
    lerp(lowered[0], aimed[0], t),
    lerp(lowered[1], aimed[1], t),
    lerp(lowered[2], aimed[2], t),
  ], pitch: lerp(-0.55, p, t), fwd };
}

/**
 * A limb segment hinged at `anchor`: the box hangs `len` along the segment's own -Y,
 * so rotating it swings the far end the way a real joint would. Returns the far end so
 * the next segment down the chain can attach to it.
 */
function limb(f, i, anchor, len, thick, rx, rz, mat, ry = 0) {
  const mid = rot([0, -len / 2, 0], rx, ry, rz);
  pushOrientedBox(f, i, {
    pos: add(anchor, mid), size: [thick, len, thick * 0.92],
    rot: [rx, ry, rz], mat, inkWidth: IW,
  });
  return add(anchor, rot([0, -len, 0], rx, ry, rz));
}

export class CharacterRig {
  constructor(gl, shirtMat = MAT.BLUE) {
    this.gl = gl;
    this.shirtMat = shirtMat;
    this.fill = null;
    this.ink = null;
    this.dirty = true;
    // Persistent builders and staging buffers. The part list never changes, so after the
    // first build the topology is fixed and only vertex data has to reach the GPU.
    this._fb = new FillBuilder();
    this._ib = new InkBuilder();
    this._fv = null;
    this._iv = null;
  }

  dispose() { this.fill?.dispose(); this.ink?.dispose(); }

  /**
   * pose: {
   *   walkPhase, walkAmt, aimAmt, aimPitch, crouch, hurt,
   *   dead, deadT, deadRoll, firing, reloadT, meleeT
   * }
   * Everything is in character space: origin between the feet, facing -Z.
   */
  rebuild(pose) {
    const f = this._fb.reset(), i = this._ib.reset();
    const shirt = this.shirtMat;
    const pants = MAT.DARK;
    const skin = MAT.SKIN;

    const walk = pose.walkPhase;
    const amt = pose.walkAmt;
    const dead = pose.dead ? 1 : 0;

    // Sinking + splaying as the drawing "falls over".
    const deadT = clamp(pose.deadT ?? 0, 0, 1);
    const collapse = dead ? deadT : 0;
    const crouch = (pose.crouch ?? 0) * 0.18;

    const bob = dead ? 0 : Math.sin(walk * 2) * 0.035 * amt;
    const hipY = 0.86 - crouch - collapse * 0.42 + bob;
    const lean = dead ? 0 : Math.sin(walk) * 0.05 * amt;

    // ---- legs ----
    const legSwing = dead ? 0 : Math.sin(walk) * 0.62 * amt;
    const kneeBase = dead ? 0.9 : 0.18 + Math.max(0, Math.sin(walk + 1.2)) * 0.55 * amt;
    for (const side of [-1, 1]) {
      const swing = side > 0 ? legSwing : -legSwing;
      const hip = [side * 0.115, hipY, 0];
      const thighRx = swing + collapse * (side > 0 ? 0.9 : 0.5);
      const knee = limb(f, i, hip, 0.42, 0.155, thighRx, collapse * side * 0.5, pants);
      const shinRx = thighRx - (kneeBase * (0.5 + 0.5 * Math.max(0, -swing * 1.6)));
      const ankle = limb(f, i, knee, 0.40, 0.135, shinRx, 0, pants);
      // Foot, kept flat-ish to the floor.
      pushOrientedBox(f, i, {
        pos: add(ankle, [0, -0.045, -0.055]), size: [0.145, 0.09, 0.25],
        rot: [collapse * 0.6, 0, 0], mat: MAT.DARK, inkWidth: IW,
      });
    }

    // ---- torso ----
    const spineRx = lean + collapse * 1.35 + (pose.hurt ?? 0) * 0.12;
    const torsoRz = (dead ? (pose.deadRoll ?? 0) * collapse : Math.sin(walk) * 0.04 * amt);
    const chest = add([0, hipY, 0], rot([0, 0.30, 0], spineRx, 0, torsoRz));

    pushOrientedBox(f, i, {
      pos: add([0, hipY, 0], rot([0, 0.10, 0], spineRx, 0, torsoRz)),
      size: [0.36, 0.22, 0.25], rot: [spineRx, 0, torsoRz], mat: pants, inkWidth: IW,
    });
    pushOrientedBox(f, i, {
      pos: chest, size: [0.44, 0.48, 0.27],
      rot: [spineRx, 0, torsoRz], mat: shirt, inkWidth: IW,
    });

    // ---- head ----
    const neck = add([0, hipY, 0], rot([0, 0.60, 0], spineRx, 0, torsoRz));
    const headPitch = spineRx * 0.4 + (pose.aimPitch ?? 0) * 0.55 * (1 - collapse);
    const headPos = add(neck, rot([0, 0.20, 0], headPitch, 0, torsoRz));
    pushOrientedBox(f, i, { pos: headPos, size: [0.32, 0.33, 0.31], rot: [headPitch, 0, torsoRz], mat: skin, inkWidth: IW });
    pushOrientedBox(f, i, {
      pos: add(headPos, rot([0, 0.185, 0.01], headPitch, 0, torsoRz)),
      size: [0.335, 0.075, 0.325], rot: [headPitch, 0, torsoRz], mat: shirt, inkWidth: IW * 0.85,
    });
    // Two dot eyes on the front face - the whole personality of the thing.
    for (const side of [-1, 1]) {
      pushOrientedBox(f, i, {
        pos: add(headPos, rot([side * 0.075, 0.025, -0.155], headPitch, 0, torsoRz)),
        size: [0.05, 0.065, 0.02], rot: [headPitch, 0, torsoRz], mat: MAT.DARK, inkWidth: IW * 0.7,
      });
    }

    // ---- arms ----
    // The weapon's grip is decided first, then both arms are solved to reach it.
    const aim = clamp(pose.aimAmt ?? 0, 0, 1) * (1 - collapse);
    const pitch = pose.aimPitch ?? 0;
    const armSwing = dead ? 0 : -Math.sin(walk) * 0.5 * amt * (1 - aim);
    const melee = pose.meleeT ?? 0;
    const reload = pose.reloadT ?? 0;

    const grip = gripTarget(hipY, spineRx, torsoRz, pitch, aim);
    this.grip = grip.pos;
    this.gripPitch = grip.pitch;

    const UPPER = 0.30, LOWER = 0.28;
    for (const side of [-1, 1]) {
      const shoulder = add([0, hipY, 0], rot([side * 0.27, 0.50, 0], spineRx, 0, torsoRz));
      const isGunArm = side > 0;

      let target, pole;
      if (collapse > 0) {
        // Splayed on the floor.
        target = add(shoulder, [side * 0.42, -0.10 - collapse * 0.1, 0.26]);
        pole = [side, -0.4, 0.2];
      } else if (isGunArm) {
        target = grip.pos;
        pole = [0.55, -1, 0.15];
        if (melee > 0) {
          // Slash: the hand swings across the body instead of holding a stance.
          const arc = Math.sin(melee * Math.PI);
          target = add(shoulder, [0.30 - arc * 0.62, 0.06 + arc * 0.24, -0.30 - arc * 0.22]);
          pole = [0.8, -0.7, 0.1];
        } else if (reload > 0) {
          target = add(grip.pos, [0, -0.10 * reload, 0.06 * reload]);
        }
      } else if (pose.twoHanded && melee <= 0) {
        // Support hand forward on the handguard.
        target = add(grip.pos, add(mul(grip.fwd, 0.22), [-0.17, -0.02, 0]));
        pole = [-0.75, -1, 0.15];
        if (reload > 0) target = add(shoulder, [-0.12, -0.26, -0.16]);   // reaching for a mag
      } else {
        // Free arm: ordinary walk swing, expressed as a hand position so the same IK runs.
        const sw = armSwing;
        target = add(shoulder, [side * 0.20, -0.50 + Math.abs(sw) * 0.06, -sw * 0.42]);
        pole = [side * 0.9, -1, 0.1];
      }

      const elbow = ikElbow(shoulder, target, UPPER, LOWER, pole);
      boneTo(f, i, shoulder, elbow, 0.125, shirt);
      boneTo(f, i, elbow, target, 0.11, skin);
      pushOrientedBox(f, i, {
        pos: target, size: [0.13, 0.13, 0.13],
        rot: [pitch * aim, 0, 0], mat: skin, inkWidth: IW * 0.85,
      });
      if (isGunArm) this.gunHand = target;
    }

    const gl = this.gl;
    if (!this.fill) {
      this.fill = f.toMesh(gl, true);
      this.ink = i.toMesh(gl, true);
      this._fv = new Float32Array(f.v.length);
      this._iv = new Float32Array(i.v.length);
      return;
    }
    // Same pose structure every time, so vertex counts are stable and the index buffers
    // uploaded on the first build stay valid.
    const fv = this._fv, iv = this._iv;
    for (let k = 0; k < fv.length; k++) fv[k] = f.v[k];
    for (let k = 0; k < iv.length; k++) iv[k] = i.v[k];
    this.fill.setVertices(fv);
    this.ink.setVertices(iv);
  }
}

/**
 * Where a character's weapon sits in world space. Derived from the aim line rather than
 * from the baked hand, so the muzzle always agrees with where the bot is actually shooting.
 */
export function weaponTransform(out, pos, yaw, pitch, holdDist = 0.42, height = 1.42, sideOff = 0.16) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const fx = -sy * Math.cos(pitch), fy = Math.sin(pitch), fz = -cy * Math.cos(pitch);
  const rx = cy, rz = -sy;
  const p = V.make(
    pos.x + fx * holdDist + rx * sideOff,
    pos.y + height + fy * holdDist,
    pos.z + fz * holdDist + rz * sideOff,
  );
  return M4.compose(out, p, yaw, pitch, 0, 1, 1, 1);
}

