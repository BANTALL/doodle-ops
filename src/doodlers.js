// Doodlers: the class you pick before a match. Each one trades statline for a skill on Q.
//
// The numbers are deliberately readable rather than balanced to three decimal places -
// you should be able to tell what you gave up the moment you start moving.

export const DOODLERS = {
  normies: {
    id: 'normies', name: 'NORMIE', tag: 'no gimmick',
    blurb: 'Baseline everything. No skill, nothing taken away.',
    health: 100, speedMult: 1.0, momentumMax: 0.55,
    skill: null,
    lines: ['100 HP', 'normal speed', 'boost caps at +55%'],
  },
  guardian: {
    id: 'guardian', name: 'GUARDIAN', tag: 'brings a wall',
    blurb: 'A paper shield hangs in front of you, half a second behind everything you do. '
      + 'It eats 50 damage from anyone but you. Q patches it up, but only once it is nearly gone.',
    health: 100, speedMult: 0.90, momentumMax: 0.40,
    skill: { id: 'shield', name: 'PATCH SHIELD', cooldown: 55, charges: 1 },
    lines: ['100 HP', '-10% speed', 'boost caps at +40%', 'shield: 50 dmg, 0.5s lag'],
  },
  mechanist: {
    id: 'mechanist', name: 'MECHANIST', tag: 'brings friends',
    blurb: 'Q drops a scribbled turret: 100 rounds at 5 damage, gone after a minute. '
      + 'Two of them before the cooldown starts.',
    health: 85, speedMult: 1.0, momentumMax: 0.55,
    skill: { id: 'turret', name: 'TURRET', cooldown: 55, charges: 2 },
    lines: ['85 HP', 'normal speed', 'boost caps at +55%', '2 turrets per cooldown'],
  },
  runner: {
    id: 'runner', name: 'RUNNER', tag: 'never stops',
    blurb: 'Faster off the mark, winds up higher, and Q throws you into a slide. '
      + 'Thin, though - one sniper round and you are a smudge.',
    health: 90, speedMult: 1.10, momentumMax: 0.70,
    skill: { id: 'slide', name: 'SLIDE', cooldown: 4, charges: 1 },
    lines: ['90 HP', '+10% speed', 'boost caps at +70%', 'slide every 4s'],
  },
};

export const DOODLER_IDS = ['normies', 'guardian', 'mechanist', 'runner'];

export function getDoodler(id) { return DOODLERS[id] ?? DOODLERS.normies; }
