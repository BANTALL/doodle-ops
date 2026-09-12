// Icons for the touch buttons.
//
// A word on a phone button is the wrong unit. Under a thumb the label is covered by the
// thumb, and in the half-second before you press it you are reading five letters instead of
// recognising a shape. Every button that changes what it does - the trigger, the skill, the
// swap - gets a drawing instead, so the state is legible at a glance and legible while your
// hand is on top of it.
//
// The drawings are pencil, same as everything else in the HUD: they go through the HUD's own
// wobbled `line`/`circle`, so they boil on the 12fps clock along with the rest of the page.
//
// Everything is authored in a unit box centred on the button: x runs right, y runs *down*
// (canvas convention), and ±1 is the button's radius. `ICON_R` keeps the drawing inside the
// ring rather than touching it, because a doodled circle wanders and a glyph that fits
// exactly will clip on some frames.

const ICON_R = 0.62;

/**
 * A tiny drawing API bound to one button. All coordinates are in the unit box; widths are
 * multiples of a base stroke that scales with the button, with a floor so an icon on a small
 * phone does not thin out into invisibility.
 */
function brush(hud, x, y, r, seed, color) {
  const s = r * ICON_R;
  const base = Math.max(1.7, r * 0.062);
  let k = seed;
  const X = (u) => x + u * s, Y = (v) => y + v * s;
  return {
    /** A straight-ish stroke. */
    l(x1, y1, x2, y2, w = 1) { hud.line(X(x1), Y(y1), X(x2), Y(y2), base * w, k++, color); },
    /** A run of strokes through the given points. */
    path(pts, w = 1, close = false) {
      for (let i = 0; i < pts.length - 1; i++) this.l(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w);
      if (close && pts.length > 2) this.l(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], w);
    },
    circ(cx, cy, rad, w = 1) { hud.circle(X(cx), Y(cy), rad * s, base * w, k++, color); },
    /** Solid ink. Used sparingly - a doodle is mostly outline, and a filled shape reads as heavy. */
    fill(pts) {
      const g = hud.ctx;
      g.fillStyle = color;
      g.beginPath();
      pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v))));
      g.closePath();
      g.fill();
    },
    dot(cx, cy, rad) {
      const g = hud.ctx;
      g.fillStyle = color;
      g.beginPath(); g.arc(X(cx), Y(cy), rad * s, 0, Math.PI * 2); g.fill();
    },
    /** An outlined box, the workhorse of every weapon silhouette. */
    box(cx, cy, w, h, lw = 1) {
      this.path([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], lw, true);
    },
  };
}

// ---------------------------------------------------------------- the glyphs

/**
 * Shooting: a barrel with the flash going off the end of it. Outline for the gun, solid ink
 * for the flash - the contrast is what makes the star read as light rather than as more gun.
 */
function iconFire(b) {
  b.path([[-0.94, 0.30], [-0.06, 0.30], [-0.06, 0.02], [-0.94, 0.02]], 1, true);   // slide
  b.path([[-0.94, 0.30], [-0.70, 0.84], [-0.34, 0.84], [-0.34, 0.30]], 0.9, true); // grip
  // The flash. Authored by hand rather than generated: a ring of even spikes reads as a star
  // sticker, and what makes a muzzle flash a muzzle flash is that it is anchored at the
  // muzzle, opens away from the gun, and no two spikes are the same length.
  b.fill([
    [-0.06, 0.02], [0.30, -0.16], [0.22, 0.07], [0.64, -0.03], [0.43, 0.17],
    [0.88, 0.27], [0.42, 0.33], [0.60, 0.60], [0.25, 0.39], [0.16, 0.64],
    [0.05, 0.37], [-0.06, 0.30],
  ]);
}

/**
 * Melee: three claw strokes, curved and tapered to a point. Straight bars of even width read
 * as tally marks; what makes a mark read as a swipe is that it is thick where the swing was
 * fast and gone where it left the surface.
 */
function iconHit(b) {
  const slash = (cx, cy, len, thick, bow) => {
    const outer = [], inner = [];
    const N = 7;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const y = cy + (t - 0.5) * len;
      // Fat in the middle, nothing at either end - the taper is the whole read.
      const w = thick * Math.sin(t * Math.PI) ** 0.7;
      const x = cx + bow * (t - 0.5) * (t - 0.5) * 4 - bow;
      outer.push([x - w, y]);
      inner.push([x + w, y]);
    }
    b.fill([...outer, ...inner.reverse()]);
  };
  slash(-0.44, -0.04, 1.44, 0.11, 0.26);
  slash(0.04, 0.02, 1.62, 0.13, 0.30);
  slash(0.52, -0.02, 1.36, 0.10, 0.24);
}

/** Guardian: a shield with a patch stitched across it. */
function iconShield(b) {
  b.path([[-0.72, -0.78], [0.72, -0.78], [0.72, 0.06], [0.00, 0.92], [-0.72, 0.06]], 1.1, true);
  b.l(-0.34, -0.34, 0.34, 0.28, 0.9);
  b.l(0.34, -0.34, -0.34, 0.28, 0.9);
  for (const t of [-0.2, 0.1, 0.4]) b.l(-0.44, t, -0.18, t - 0.16, 0.7);   // stitches
}

/** Mechanist: a tripod with a barrel on it. */
function iconTurret(b) {
  b.box(0.00, -0.20, 0.86, 0.50, 1.1);                 // body
  b.path([[0.43, -0.32], [0.98, -0.32], [0.98, -0.14], [0.43, -0.14]], 0.9);  // barrel
  b.l(-0.30, 0.05, -0.62, 0.86, 1);
  b.l(0.30, 0.05, 0.62, 0.86, 1);
  b.l(0.00, 0.05, 0.00, 0.86, 1);
  b.l(-0.62, 0.86, 0.62, 0.86, 0.7);
  b.dot(0.00, -0.52, 0.10);                            // sensor
}

/** Runner: a body leaning into the slide, with the ground rushing past. */
function iconSlide(b) {
  b.circ(0.34, -0.60, 0.24, 1);                                            // head
  b.path([[0.16, -0.34], [-0.34, 0.10], [-0.86, 0.16]], 1.3);              // torso, thrown flat
  b.path([[-0.30, 0.14], [0.22, 0.34], [0.70, 0.16]], 1.1);                // trailing leg
  b.l(-0.92, 0.62, 0.92, 0.62, 0.8);                                       // floor
  for (const [x0, y0] of [[0.30, -0.16], [0.46, 0.08], [0.24, 0.44]]) b.l(x0, y0, x0 + 0.56, y0, 0.7);
}

// ---------------------------------------------------------------- weapons

function iconPistol(b) {
  b.path([[-0.86, -0.30], [0.62, -0.30], [0.62, 0.02], [-0.30, 0.02]], 1, false);
  b.path([[-0.30, 0.02], [-0.12, 0.78], [-0.60, 0.78], [-0.86, 0.02], [-0.86, -0.30]], 1, false);
  b.l(0.18, 0.02, 0.18, 0.22, 0.8);                    // trigger guard hint
  b.l(-0.40, 0.22, 0.18, 0.22, 0.8);
}

function iconRifle(b) {
  b.path([[-0.98, -0.20], [0.92, -0.20], [0.92, 0.02], [-0.98, 0.02]], 1, true);   // receiver + barrel
  b.path([[-0.98, 0.02], [-0.72, 0.02], [-0.62, 0.52], [-0.86, 0.52]], 0.9, true); // grip
  b.path([[-0.34, 0.02], [-0.06, 0.02], [-0.02, 0.62], [-0.34, 0.62]], 0.9, true); // magazine
  b.l(0.24, -0.20, 0.24, -0.44, 0.8);                                              // front sight
}

function iconSniper(b) {
  // What says "sniper" at thumb size is the scope and the length, so the barrel runs the full
  // width and everything else stays out of its way. The bipod that used to be here turned the
  // whole glyph into a sawhorse.
  b.path([[-0.62, -0.10], [0.98, -0.10], [0.98, 0.06], [-0.62, 0.06]], 1, true);   // barrel
  b.path([[-0.98, -0.14], [-0.62, -0.14], [-0.62, 0.14], [-0.98, 0.14]], 1, true); // receiver
  b.path([[-0.30, -0.46], [0.36, -0.46], [0.36, -0.22], [-0.30, -0.22]], 1, true); // scope
  b.l(-0.14, -0.22, -0.14, -0.10, 0.7);                                            // scope mounts
  b.l(0.22, -0.22, 0.22, -0.10, 0.7);
  b.path([[-0.98, 0.14], [-0.74, 0.14], [-0.66, 0.60], [-0.92, 0.60]], 0.9, true); // grip
  b.l(-0.98, 0.00, -1.00, 0.42, 0.9);                                              // stock
}

function iconCannon(b) {
  // A funnel that gets fatter toward the muzzle, with the charge arc across it.
  b.path([[-0.80, -0.18], [0.46, -0.60], [0.90, -0.60], [0.90, 0.42], [0.46, 0.42], [-0.80, 0.16]], 1.1, true);
  b.path([[0.52, -0.44], [0.28, -0.02], [0.62, -0.02], [0.36, 0.34]], 1.1);        // bolt
  b.path([[-0.94, -0.10], [-0.80, -0.18], [-0.80, 0.16], [-0.94, 0.10]], 0.8, true);
}

function iconKnife(b) {
  b.path([[-0.86, 0.52], [0.34, -0.70], [0.52, -0.44], [-0.60, 0.74]], 1.1, true); // blade
  b.l(-0.74, 0.34, -0.40, 0.72, 0.9);                                              // guard
  b.path([[-0.62, 0.58], [-0.44, 0.76], [-0.72, 1.00], [-0.90, 0.82]], 0.9, true); // handle
}

/** The hammer, drawn as the same rectangle the 3D one is: square ends, standing tall. */
function iconHammer(b) {
  b.box(0.00, -0.44, 0.62, 0.86, 1.1);                 // head
  b.l(-0.31, -0.86, -0.31, -0.02, 0.8);                // end bands
  b.l(0.31, -0.86, 0.31, -0.02, 0.8);
  b.path([[-0.12, -0.02], [0.12, -0.02], [0.12, 0.92], [-0.12, 0.92]], 1, true);   // haft
  b.l(-0.20, 0.92, 0.20, 0.92, 0.9);                                               // pommel
}

function iconFist(b) {
  b.path([[-0.62, -0.28], [0.46, -0.44], [0.70, 0.10], [0.42, 0.70], [-0.52, 0.62], [-0.72, 0.14]], 1.1, true);
  for (const y0 of [-0.30, -0.06, 0.18, 0.42]) b.l(0.30, y0, 0.58, y0 + 0.02, 0.7); // knuckles
  b.path([[-0.72, 0.14], [-0.96, 0.40], [-0.70, 0.58]], 0.9);                        // thumb
}

/**
 * The greatblade: a broad blade with the fire coming off both edges. The blade is wide on
 * purpose - narrow it and the glyph turns into a longsword, which is the one weapon the game
 * does not have. The flames are solid, because an outlined flame at thumb size is a leaf.
 */
function iconVolcano(b) {
  b.path([[-0.24, 0.52], [-0.24, -0.56], [0.00, -0.96], [0.24, -0.56], [0.24, 0.52]], 1.1, true); // blade
  b.l(-0.14, -0.44, -0.14, 0.44, 0.6);                                                            // the crack
  b.l(0.14, -0.44, 0.14, 0.44, 0.6);
  b.path([[-0.52, 0.52], [0.52, 0.52], [0.52, 0.66], [-0.52, 0.66]], 1, true);                    // crossguard
  b.path([[-0.09, 0.66], [0.09, 0.66], [0.09, 1.00], [-0.09, 1.00]], 0.9, true);                  // grip
  b.fill([[-0.24, 0.34], [-0.52, 0.00], [-0.36, -0.04], [-0.62, -0.44], [-0.40, -0.34], [-0.30, -0.52], [-0.24, -0.10]]);
  b.fill([[0.24, 0.42], [0.48, 0.14], [0.34, 0.10], [0.56, -0.24], [0.36, -0.16], [0.29, -0.32], [0.24, 0.02]]);
}

/** Nothing in the slot. An empty hand rather than a dash, so it still reads as a weapon button. */
function iconEmpty(b) {
  b.circ(0, 0, 0.72, 1);
  b.l(-0.44, -0.44, 0.44, 0.44, 1);
}

const WEAPON_ICONS = {
  pistol: iconPistol,
  m4: iconRifle,
  sniper: iconSniper,
  droodlecannon: iconCannon,
  knife: iconKnife,
  hammer: iconHammer,
  volcano: iconVolcano,
  fist: iconFist,
};

const SKILL_ICONS = {
  shield: iconShield,
  turret: iconTurret,
  slide: iconSlide,
};

/** Draw the icon for a weapon id. Returns false if there is nothing sensible to draw. */
export function drawWeaponIcon(hud, id, x, y, r, color) {
  const fn = WEAPON_ICONS[id] || (id ? null : iconEmpty);
  if (!fn) return false;
  fn(brush(hud, x, y, r, (x + y * 3) | 0, color));
  return true;
}

/** Draw the icon for a doodler's skill id. Returns false for a doodler with no skill. */
export function drawSkillIcon(hud, id, x, y, r, color) {
  const fn = SKILL_ICONS[id];
  if (!fn) return false;
  fn(brush(hud, x, y, r, (x + y * 3) | 0, color));
  return true;
}

/** The trigger, which is a different button depending on what is in your hands. */
export function drawFireIcon(hud, melee, x, y, r, color) {
  (melee ? iconHit : iconFire)(brush(hud, x, y, r, (x + y * 3) | 0, color));
}
