# DOODLE OPS

A hand-drawn first-person shooter set in a paper backrooms. You against five bots, three
guns and a knife, in a level where somebody got halfway through colouring it in and
stopped.

**Play it: https://osnailcyargta-ctrl.github.io/fps/**

No engine, no libraries, no build step. Raw WebGL2 and Canvas2D, about 5k lines. Every
texture and model is generated at runtime, and so is most of the audio; the only assets in
the repo are six sound files (see [Credits](#credits)), and the game still runs without
them.

---

## Controls

| | |
|---|---|
| `W A S D` | move |
| `SPACE` | jump |
| `MOUSE 1` | shoot / swing |
| `MOUSE 2` | hold to scope (sniper only — releasing cancels it) |
| `SCROLL` | switch between knife and gun (`1` / `2` / `Q` also work) |
| `E` | pick up the weapon you're looking at |
| `R` | reload |
| `TAB` | scoreboard |
| `ESC` | pause and settings |

Mouse sensitivity, a separate scoped sensitivity, FOV, volume, render scale, ink weight,
bot count and the kill limit all live in the pause menu and persist between sessions.

## Weapons

You carry **one** melee weapon plus **one** gun. Picking either up drops the one it
replaces.

| | damage | rate of fire | magazine | notes |
|---|---|---|---|---|
| **Knife** | 42 | fast | — | long reach, 1.6× from behind, and you move quicker holding it |
| **Axe** | 130 | one swing per 3s | — | two metres more reach than the knife, and it throws (below) |
| **Pistol** | 26 | slow | 12 | the reliable middle |
| **M4** | 14 | very fast | 50 | high volume, falls off hard at range |
| **Sniper** | 88 | very slow | 1 | hold right mouse to scope — **a scoped shot that connects kills outright** |

Crates are scattered through the level. Break one and it coughs up a random gun — or, about
one time in five, a melee weapon instead, which is the only way an axe enters a match. Either
way a heart comes with it 75% of the time (worth 5 HP, walked over rather than prompted for,
by bots as well as you). Guns dropped by the dead fade off the page after about twenty
seconds, so the crates stay worth opening; what a crate gave you stays put.

Your gun resets to a pistol when you respawn. Your melee weapon doesn't: once you've found
the axe it's yours until somebody makes you trade it.

### The axe

It kills anything it touches, and the cost is that you get one swing every three seconds and
the swing itself takes a full second of that. Land **three** hits on people and the third one
carries the axe out of your hand: it flies, tumbling, and buries itself in whatever stops it —
a body, a crate, a wall, the floor when it runs out of range. Your hand is empty until you
**attack again**, which whistles it back to you rather than making you walk over and pick it
up. The three notches next to the ammo counter are the throw meter.

Bots pick axes up and swing them, and will cross a room for one. They never throw — the
throw is yours.

## Doodlers

You pick a class before the match. Skill is on `Q`; weapons stay on scroll and `1`/`2`.

| | statline | skill |
|---|---|---|
| **Normie** | 100 HP, normal speed, +55% boost cap | — |
| **Guardian** | 100 HP, −10% speed, +40% boost cap | a paper shield that floats in front of you |
| **Mechanist** | 85 HP, normal speed, +55% boost cap | scribbled turrets, two per cooldown |
| **Runner** | 90 HP, +10% speed, +70% boost cap | a forward slide every 4s |

The **guardian's** shield tracks you immediately and absorbs 50 damage as a real hitscan
blocker: shots are tested against its
oriented box *before* bodies, so anyone behind it is covered for free. Your own shots pass
straight through, because a shield you can't fire past is a punishment rather than a skill.
`Q` only patches it once it's under 10 — a healthy one refuses, a broken one is replaced, a
damaged one goes back to 50 — on a 55 second cooldown.

A scoped sniper round that finds a body kills whatever it hits, wherever it lands. Bots
have no scope input, so it is the player's alone.

The **mechanist's** turrets carry 100 rounds at 2 damage on an M4 cadence and vanish after
a minute or when empty. Their shots are attributed to whoever placed them, so a turret
can't hit its owner and its kills are theirs — which also means the bots blame you for it.

## Running

Keep running forward and you wind up: momentum builds over about four seconds to a **+55%
speed boost**, and the view stretches a little as it comes on. It is fragile on purpose —
reversing, stopping, or putting a shoulder into a wall dumps all of it, and sidestepping at
speed both throttles the build and shaves 10% off the boost every fifth of a second, so a
held diagonal settles around a third of top speed instead of pinning at the ceiling.

Speed lines scribble in from the edges of the screen once the boost is worth having.

## The bots

They're meant to read as people having a bad day, not as turrets. Three things do most of
that work:

- **They aim by turning, never by snapping.** Where a bot is facing is the only thing that
  decides where its bullets go, and that facing chases you through a wandering error that
  shrinks the longer it holds you. First contact is sloppy; a long duel gets dangerous.
- **Everything costs a delay.** Spotting you, losing you, getting shot in the back — each
  one has to be processed before it changes behaviour. A bot cannot answer a shot it hasn't
  registered yet, which is why you can win a fight by moving first.
- **They move for their own reasons.** Strafing runs on a lazy timer, they back off to
  reload, they push when they think they're ahead. They are not reading your bullets and
  dodging them, and you can feel that they aren't.

Turning has inertia: a bot builds up angular velocity and has to bleed it off again, so it
overshoots a flick and drifts past a target that changes direction. That, more than
anything, is the difference between a person aiming and a turret being pointed.

Over a three-minute soak of roughly 1700 bot shots that lands at:

| range | hit rate |
|---|---|
| under 12 m | 63% |
| 12–30 m | 31% |
| over 30 m | 2% |

Headshots are 0.3% of their hits — they are aiming at you, not at your head. Lethal in a
room, hopeless across the map.

The five of them are rolled with different skill, reaction time, turn speed, aggression and
preferred range, so one is genuinely sharp and one is a liability. They also loot, break
crates for guns, hunt you by sound, and fight each other — it's a free-for-all, not five
bots ganging up on the player.

## Graphics

There's a **Fancy shaders** toggle in the pause menu. Off, you get the flat pencil look.
On, four things switch in:

- **Realtime shadows** from a 1024² shadow map, cast down the average direction of a
  ceiling full of light panels. Its near plane starts just below the ceiling — otherwise
  the ceiling is the first thing the light hits and the whole building sits in its shadow,
  which is true and useless, since the panels are *in* it. A cast shadow isn't dimmed, it's
  drawn: it picks up cross-hatching of its own.
- **Light panel falloff**, from the eight nearest panels to the camera, so standing under
  one is brighter than standing between them. Capped at paper white — paper can't get
  brighter than paper, so the contrast comes from darkening what the panels don't reach.
- **Bloom and depth of field**, sharing one half-resolution blur (two chains would look
  marginally better and cost twice as much for a game drawn in pencil). Depth comes from a
  sampleable depth texture blitted out of the multisampled buffer, so MSAA survives.
- **Saturation balance**, pulling back the colour the bloom washes out and keeping the
  paper off the clipping point.

## The look

**Everything is drawn at 12fps. Everything is *played* at 60.**

There are two clocks. The simulation, the camera and your aim run at the full frame rate,
so the game feels immediate. A separate 12fps clock is the only thing the visuals ever
sample: bot poses, the viewmodel, tracers, muzzle flashes, shards, and — importantly — the
random seed that wobbles every line and every fill. Between animation steps the drawing
holds perfectly still, then snaps to a new wobble. That's the boil you get in hand-drawn
animation, and here it falls out of the update schedule rather than being faked.

Bots are re-baked into fresh geometry on each animation step, which is also why they cost
two draw calls each.

**Smear frames** come in two kinds, because the two weapons want different things.

The knife *trails*. Its pose is a pure function of the weapon timers, so the same pose can be
asked for a fraction of a step ago and drawn faintly behind the real blade, and the cut leaves
a wake instead of teleporting between frames. The swap twirl, the idle knife trick and a
thrown axe in flight all work this way, keyed off how fast the move is going. Paper shards get
a velocity stretch instead, since a tumbling scrap has no rest shape to distort away from.

The axe is *drawn*. Its swing is twelve authored cels in `axeframes.js`, played one per
animation step, and for that second the viewmodel **is** the cel — no 3D axe, no 3D hands.
This is the thing a stretched mesh cannot fake: frames 4 to 8 have no haft, no head and no
hand in them, and frame 6 is two crescents of ink with a hole where the weapon ought to be.
For one twelfth of a second there is no object. That reads as speed; scaling the same mesh
never will, because the eye recognises the shape and knows it's the same thing. All twelve
are struck about one pivot — where the hands are — which is what keeps them reading as a
single continuous swing rather than twelve drawings in a row.

**The whole viewmodel is sampled at the last animation step**, not at the current
instant — otherwise the weapon in your hands is the one thing on screen not moving on
twelves.

**Weapon swaps** twirl. The weapon is pulled in front of you and tumbles twice, and halfway
through — while it's spinning fastest — the old one becomes the new one, so you read it as
the knife *turning into* the gun.

**The knife** has a wind-up, a fast cut that smears, and a recovery, alternating sides each
swing. Stand still holding it for three seconds and it does one trick — winds up, whips
over twice, and is caught — then rests for another three before repeating. The turn count
is whole so it lands exactly where it started, and the hand is posed from a matrix without
the spin in it, so the knife turns inside a steady hand rather than the whole fist
cartwheeling with it.

**Sniper impact frame.** A sniper round that connects blacks out the page except for a
ragged white hole blown open at the point of impact, with a shock ring racing out ahead of
it — the picture is shoved outward as the wavefront passes, and the ring keeps travelling
over the scene after the black frame has faded back. Real-time driven, so it lasts 0.65s at
any frame rate.

**Kill streak.** Twelve drawn frames at twelve frames a second. A drop falls, lengthening
as it goes; the last frame before it lands is a different drawing entirely — a long
speeding streak shedding flecks — then three splat frames with spikes thrown out at angles
that change frame to frame, then it settles into a blot holding your count knocked out of
the ink. A teardrop, a streak and a splat are different paths, not one shape resized. It
resets when you die and when the match is decided.

**Culling.** The level is built as chunks of 6×6 cells, each with its own meshes and
bounding box, because a single map-sized mesh can only ever be drawn whole. Frustum culling
alone still draws every room behind the wall you're facing, so the renderer also floods
outward from the camera's cell through *open* cells only, the way a portal-based renderer
walks a level — a wall stops the flood dead, so rooms with no line of sight are never
reached. It's conservative in the safe direction: it can mark a chunk you can't quite see,
but it cannot miss one you can. Typically 4–12 of 25 chunks survive, taking draw calls from
~126 down to 8–70. Bots, crates, pickups, decals and particles get a sphere test on top.

**Distance detail.** Culling decides what to draw; this decides how badly. It's the Distant
Horizons trade made backwards — that mod draws *more* world by drawing it worse, and here
"worse" has an obvious meaning, because everything on screen is a drawing. Past about 24
metres a wall, a crate or a bot keeps its colour and loses its pencil outline, the way the far
half of a sketch is blocked in but not inked yet. Past 30 the incidental stuff — paper shards,
bullet holes, puffs, impact marks — stops being drawn at all, and past 38 a weapon loses its
moving parts and its floor smudge. Down a 40-metre sightline that takes ink from 22 draws to
5, which is most of the frame: an ink mesh is a quad per line segment, and a chunk is
thousands of them. There is no visible seam, because outlines fading out at distance is what
the rest of the drawing already does.

**Off-camera bots don't animate.** Re-baking a bot's body into fresh geometry is the most
expensive thing an animation step does, so a bot nobody can see doesn't get one — tested
against the same frustum the renderer is about to use, plus the occlusion mask, so a bot
dead ahead but behind a wall is skipped too. Anyone within ten metres is always posed, since
they can enter the view between steps. The frustum for that test is built fresh rather than
reused from the last frame: at twelve frames a second, a fast turn would drop a bot for a
whole twelfth of a second and you'd see them pop.

The rest of the pipeline:

- **Ink pass.** Every outline is a screen-space quad expanded in the vertex shader, so
  lines keep a constant pen weight at any distance. Endpoints are jittered by a hash of
  their own position, which means strokes that share a corner stay joined while they
  wobble. Real stroke ends overshoot the way a pen does; interior joints stay closed.
- **Fill pass.** Flat comic shading keyed to which way a face points, with pencil
  cross-hatching in the shadows sampled in screen space and re-jittered every animation
  step — so shading looks re-drawn each frame instead of pasted on.
- **Characters fade** between coloured and line-art. The shader's mask is ported to JS so
  a fighter samples it once at their feet and eases toward it over about a second; fading
  per-pixel as a body crossed the border looked like it was being wiped. Your own hands and
  weapon do the same in first person — cross into the bare half and your gun becomes an
  outline drawing of a gun.
- **Bots hold weapons** by two-bone IK. The grip position is decided first and both arms
  are solved to reach it, which is the same order the player's hands are placed in — pose
  the arms first and the rifle ends up tucked under an armpit.
- **The half-coloured map.** A straight sweep runs across the level, chewed up by
  medium-scale noise so it never reads as a ruled line. On one side: crayon over the line
  art. On the other: bare pencil on white paper. The colouring is thresholded against a
  crayon-coverage texture, so it's solid well inside the region and frays into patches
  exactly where it stops. Your own gun stays coloured wherever you are, because a white gun
  against a white floor is unreadable.

## Winning

First to the kill limit takes it, but the popup waits two seconds. The bots stand down and
you keep control for those two seconds, so the moment you won on is yours to look at rather
than something a dialog lands on top of.

## Sound

Almost all of it is synthesised at boot — noise bursts through filters, oscillators with
envelopes — which is why the repo has no sample library in it. Four things are recorded.

**The music** is two tracks that alternate, each one starting when the last ends. They
stream through `<audio>` elements rather than `decodeAudioData`: a decoded minute of 44.1kHz
stereo is about 20MB of float per track, and there's no reason to hold that in memory to
play it front to back once. The next track is preloaded while the current one plays, so the
handover doesn't gap. Browsers won't start audio before the page has been interacted with,
so the first click or keypress anywhere unlocks it — captured, so it runs before the button
handler that wants to click at you.

**Dying** is the loudest thing in the game, deliberately: about twice the perceived level of
a sniper shot. Getting there isn't a matter of multiplying the gain by two, which would push
it past full scale where the hardware squares off the peaks and it stops sounding like
breaking plastic and starts sounding like a broken file. It has its own chain instead — a
`tanh` soft clipper that rounds the peaks while lifting everything underneath them, a +8dB
shelf at 2.7kHz for the bite, and a limiter behind that. A second copy of the clip plays
underneath pitched down to 0.74, so there's weight under all that top end. And the music
ducks to 22% for it, which keeps the sum inside full scale and makes the crash land harder
than it would on its own.

**The scream when you take a hit** is off by default; it's in the pause menu. It's repitched
somewhere between 0.74× and 1.6× every time, so a burst of hits doesn't sound like one clip
stuttering, and a new one ducks the last one out rather than piling on — five M4 rounds land
inside half a second, and five overlapping screams are just noise.

Every recorded sound has a synthesised fallback, so a blocked or missing file costs fidelity
and nothing else.

## Running it locally

Any static file server will do — ES modules need `http://`, not `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

The repo is already a working site at its root, so either Pages mode works:

- **GitHub Actions** (what `.github/workflows/pages.yml` is for): Settings → Pages →
  Source → *GitHub Actions*. Pushing to `main` or `claude/doodle-fps-game-bots-vm4ieu`
  publishes automatically.
- **Deploy from a branch**: Settings → Pages → Source → *Deploy from a branch*, pick the
  branch and the `/ (root)` folder. The workflow is then unnecessary.

Every path in the project is relative, so it works fine served from `/fps/`.

## Layout

```
index.html      shell, menus, settings form
styles.css      menu chrome (SVG-displaced borders, so even the UI is wobbly)
src/
  main.js       boot, menu wiring
  game.js       match orchestration, the two clocks, combat events
  renderer.js   draw lists, the three passes
  shaders.js    all GLSL
  gl.js         WebGL2 helpers
  geom.js       fill/ink builders
  textures.js   paper, hatch, crayon, splats, flashes — all procedural
  map.js        backrooms generator, collision, raycasts, nav grid
  bots.js       the AI
  actors.js     the humanoid rig
  player.js     movement, look, viewmodel
  combat.js     weapon state machine, hitscan
  weapons.js    weapon stats and models
  entities.js   crates, pickups, decals, particles
  hud.js        the hand-drawn HUD
  audio.js      WebAudio SFX (synthesised, plus the two pistol samples)
  input.js      pointer lock, keys, mouse
  settings.js   persisted settings
  axeframes.js  the twelve drawn frames of an axe swing
  thrownaxe.js  the axe once it has left your hand
  frustum.js    view frustum planes for culling
  math.js       vectors, matrices, RNG
```

Needs a browser with WebGL2 — any current Chrome, Edge, Firefox or Safari.

---

## Credits

Six recorded sounds live in `assets/audio/`. Everything else you hear is synthesised at
runtime, and if any of these fail to load the game falls back to a synthesised version
without complaining.

| File | Used for | Source |
| --- | --- | --- |
| `pistol-shot.mp3` | the pistol firing | [Freesound](https://freesound.org/) — "gunshots from a distance" (`796391`) |
| `pistol-reload.mp3` | the pistol reload | generated with [ElevenLabs](https://elevenlabs.io/) sound effects |
| `death-lego.mp3` | the crash when you die | supplied |
| `hurt-rah.mp3` | the optional scream on taking damage | supplied |
| `music-archive-echoes.mp3` | theme, track 1 | supplied — *Archive Echoes* |
| `music-archive-echoes-2.mp3` | theme, track 2 | supplied — *Archive Echoes* |

**Licences are not sorted out here.** The Freesound clip carries whatever licence its
uploader chose — check it on the sound's page and keep attribution as that licence requires.
The four supplied files came in without provenance, so before publishing this anywhere,
confirm you have the right to redistribute them; the two music tracks in particular are the
kind of thing a rights holder notices on a public page.
