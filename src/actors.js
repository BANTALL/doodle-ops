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
    // Weapon arm swings up to the aim line; the off hand comes across to support it.
    const aim = clamp(pose.aimAmt ?? 0, 0, 1) * (1 - collapse);
    const pitch = pose.aimPitch ?? 0;
    const armSwing = dead ? 0 : -Math.sin(walk) * 0.5 * amt * (1 - aim);
    const melee = pose.meleeT ?? 0;
    const reload = pose.reloadT ?? 0;

    for (const side of [-1, 1]) {
      const shoulder = add([0, hipY, 0], rot([side * 0.27, 0.50, 0], spineRx, 0, torsoRz));
      const isGunArm = side > 0;
      let upRx, upRz, foreRx;
      if (collapse > 0) {
        upRx = 0.4 + collapse * 0.9; upRz = side * (0.5 + collapse * 0.6); foreRx = 0.5;
      } else if (isGunArm) {
        // Raised toward the target, elbow tucked.
        upRx = lerp(armSwing, 1.42 + pitch * 0.75, aim);
        upRz = lerp(0.10 * side, 0.16 * side, aim);
        foreRx = lerp(0.35, -0.55 - pitch * 0.2, aim);
        if (melee > 0) { upRx = 1.1 + Math.sin(melee * Math.PI) * 1.7; foreRx = -1.0 + Math.sin(melee * Math.PI) * 0.9; }
        if (reload > 0) { upRx = lerp(upRx, 0.75, reload); foreRx = lerp(foreRx, -0.2, reload); }
      } else {
        upRx = lerp(-armSwing, 1.25 + pitch * 0.6, aim);
        upRz = lerp(-0.10, -0.42, aim);
        foreRx = lerp(0.35, -0.85, aim);
        if (reload > 0) { upRx = lerp(upRx, 1.9, reload); upRz = lerp(upRz, -0.15, reload); foreRx = lerp(foreRx, -1.5, reload); }
      }
      const elbow = limb(f, i, shoulder, 0.30, 0.125, upRx + spineRx, upRz, shirt);
      const hand = limb(f, i, elbow, 0.28, 0.11, upRx + foreRx + spineRx, upRz * 0.5, skin);
      pushOrientedBox(f, i, {
        pos: hand, size: [0.13, 0.13, 0.13],
        rot: [upRx + foreRx, 0, 0], mat: skin, inkWidth: IW * 0.85,
      });
      if (isGunArm) this.gunHand = hand;
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

