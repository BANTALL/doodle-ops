# DOODLE OPS

A hand-drawn first-person shooter set in a paper backrooms. You against five bots, in a
level where somebody got halfway through colouring it in and stopped. You start with your
fists; everything else is on the floor or inside a crate.

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

### On a phone

There's an **On-screen controls** toggle on the start screen — off by default, and offered
pre-ticked the first time you open the game on something with a finger rather than a mouse.
With it on there's no pointer lock to lose, so the game stops treating "not locked" as
"paused".

Left thumb moves, and the stick appears wherever your thumb lands in the left half rather
than sitting in one spot. Drag anywhere on the right that isn't a button to look. The rest
is laid out by how far a thumb actually reaches:

Each thumb pivots at the bottom corner on its side and sweeps an arc. How far it gets is a
*physical* distance — about 50-60mm — so it has to be measured against the screen's short
edge, which is the one that means the same number of millimetres on every phone. Within
0.70 of that edge is comfortable; within 0.90 is fine for something you press now and then;
past that is a regrip, which in a firefight means you don't press it at all. Laying a pad
out in fractions of the *width* is the usual mistake: on a 21:9 screen "x = 0.7" is a
completely different reach from "x = 0.7" on a tablet.

So frequency decides the band:

| | reach | |
|---|---|---|
| **FIRE** | 0.40 | constant, so it's the core of the arc and the biggest target (22mm) |
| **JUMP** | 0.57 | up the right edge, where the thumb already is |
| **RELOAD** | 0.66 | left of fire |
| **SWAP** | 0.72 | above fire — it draws what you'd swap *to* |
| **SCOPE** | 0.79 | sniper only, and a deliberate hold rather than a reflex |
| **SKILL** | 0.87 | the doodler's own glyph; hidden entirely for the normie, who has no skill |
| **TAKE** | left thumb | contextual, and you've stopped moving to do it anyway |
| **menu, scores** | top *left* | deliberately outside both arcs, so you can't pause the game by fumbling a reload |

The three buttons that change what they do are **drawings, not words** (`src/touchicons.js`,
inked through the HUD's own wobbled primitives so they boil along with everything else). A
word on a phone button is the wrong unit: your thumb is covering the label at the moment you
press it, and in the half-second before that you're reading five letters instead of
recognising a shape. So the trigger is a muzzle flash with a gun in hand and a claw swipe
with a blade; SWAP is a silhouette of the weapon you'd get, with its name underneath; and
SKILL is the shield, the turret or the slide, with the remaining cooldown in place of its
name.

The readouts move too: health and the doodler go top-left under the menu buttons, ammo
drops into the dead strip along the bottom-centre that no thumb crosses, and the weapon
strip disappears entirely because the SWAP button already draws what's in the other hand.
The stick's dead zone is followed by a square-law ramp, so a thumb can walk as well as
sprint — a linear stick makes moving slowly almost impossible.

## Weapons

You carry **one** melee weapon plus **one** gun. Picking either up drops the one it
replaces. Everybody opens with bare fists, which is what turns the first thirty seconds of
a match into a scramble for a crate instead of a knife fight everyone had already won.

| | damage | rate of fire | magazine | notes |
|---|---|---|---|---|
| **Fists** | 25 | fast | — | what you start with; short reach, but you move well with nothing in your hands |
| **Knife** | 42 | fast | — | long reach, 1.6× from behind, and you move quicker holding it |
| **Hammer** | 130 | one swing per 3s | — | two metres more reach than the knife, and it throws (below) |
| **Volcano Greatblade** | 200 | one swing per 3s | — | the hammer's reach, and it burns the floor behind you (below) |
| **Pistol** | 26 | slow | 12 | the reliable middle |
| **M4** | 14 | very fast | 50 | high volume, falls off hard at range |
| **Sniper** | 88 | very slow | 1 | hold right mouse to scope — **a scoped shot that connects kills outright** |
| **Droodle Cannon** | 25 / 75 | slow | 9 | a fireball you can watch, and every third pull is a beam (below) |

Crates are scattered through the level. Break one and it coughs up a random gun — or about
one time in five a melee weapon instead, which is the only way an hammer enters a match, one
time in eight a DROODLE CANNON, or one time in eighteen a VOLCANO GREATBLADE. Either way a heart comes with it 75% of the time (worth
5 HP, walked over rather than prompted for, by bots as well as you). Guns dropped by the
dead fade off the page after about twenty seconds, so the crates stay worth opening; what a
crate gave you stays put.

**Anyone who dies scatters five hearts.** It pays for the kill without handing the health
straight over — you have to walk into the middle of where the fight just was, which is also
where whoever shoots you next is looking. Bots want them: below two thirds health they'll
take one that's on the way, and below a third they'll cross the map for it and break off a
fight they aren't being watched in.

Your gun resets to a pistol when you respawn. Your melee weapon doesn't: once you've found
the hammer it's yours until somebody makes you trade it.

Fists have no mesh. The viewmodel for them is the two hands, posed like a boxer with
alternating straight punches, so they take the draw over from the normal weapon path, which
can only put one hand on a grip and a second on a support point. The hands are anatomical
and handed now, which also means a gripped weapon gets a right hand on the grip and a left
on the foregrip instead of the same mitten twice.

### The hammer

It kills anything it touches, and the cost is that you get one swing every three seconds and
the swing itself takes a full second of that.

**Every third swing is a throw**, whether the first two connected or not — you shouldn't have
to land a hit to throw a weapon. The third one gets its own animation: back over the shoulder,
over the top, and the hammer leaves your hand on the sixth drawn frame with the hand open under
it. It flies at a pace you can actually watch — a couple of seconds to cross a big room — and
buries itself in whatever stops it: a body (for the full 130), a crate, a wall, or the floor
when it runs out of range. Your hand is empty until you **attack again**, which whistles it
back rather than making you walk over and pick it up. The three notches next to the ammo
counter are the throw meter, and they fill on swings, not hits.

Bots pick hammers up and swing them, and will cross a room for one. They never throw — the
throw is yours.

### The Volcano Greatblade

The hammer's opposite number: the same reach and the same three seconds, but it hits for
**200** and it never leaves your hand. What you get instead is everything that happens
around the swing.

**It burns the ground behind you.** Carry it with the blade out and moving lays a patch of
fire every half-metre of travel. Each one burns for **two seconds** and does **20 a second**
to anyone standing in it — anyone but the person who lit it, so backing through your own
trail is a real option rather than a mistake. Standing in three patches at once is still 20
a second: it is one fire, not three.

**A kill with it leaves the body standing.** Not the actual body — that respawns on the
usual timer — but a burning copy of it, half transparent and in lava colours, facing back
at whoever made it. It is scenery that happens to be a mine: it is not in the actor list, so
nothing in the bot AI can see it, target it or shoot at it. Anyone but its owner coming
within **five metres** starts a short fuse (the figure swells, and there is a sound — that
is the only warning anybody gets) and then it goes off for **50** in the same five metres,
falling off to two thirds at the rim. Its owner is never caught in it.

You only ever have one. Killing again with the blade detonates the one you had, where it
stands, and plants a new one at the new kill — so it is worth thinking about where you leave
the last one.

The swing is its own sheet of twelve cels (`src/volcano/frames.js`) and it is a different
animation from the hammer's, not a variation on it. The hammer cuts sideways; this one lifts,
**hangs for one frame with nothing happening**, and then falls down a diagonal. That hang is
the whole read: a heavy weapon does not look heavy because it moves slowly, it looks heavy
because it takes a beat to get going and then arrives all at once. Cels 5–8 have no blade in
them at all — they are three nested bands of red, orange and yellow, so the smear *is* the
fire rather than having fire added to it.

Bots carry it, swing it and get the trail for free; they want it more than the hammer.

### The Droodle Cannon

A dragon-head cannon bolted to your right hand, with the left on a foregrip. Two on the
floor at map load, one crate in eight.

Its round is not a bullet — it's a fireball you watch cross the room. The hitscan still runs
up front and decides everything; the delivery is held back until the drawing arrives, and
the tracer is suppressed, because the round you watched *was* the tracer. And because it's a
fireball rather than a bullet it's measured against a body three times as wide, with half a
metre added above the head and below the feet: a shot that sails over a shoulder looks
exactly as much like a hit as one through a hip.

Every third pull fires nothing. It winds up for nine animation frames — reared back and
shaking, the jitter hashed off the frame number so it's a different drawing every twelfth of
a second and the same one in between — and then lets go on its own: a straight beam to the
first wall, **75 to everything standing in it**, chewing crates and shields on the way
without being stopped by them.

Dying drops it like any other gun.

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
  drawn: it picks up cross-hatching of its own. The depth bias is slope-scaled, because a
  constant one cannot win — large enough to stop acne on a surface facing the light, it
  lifts the shadow clean off its caster on one that's edge on, which is what turned cast
  shadows into hard grey slabs floating next to things.
- **Light panel falloff**, from the eight nearest panels to the camera, so standing under
  one is brighter than standing between them. Capped at paper white — paper can't get
  brighter than paper, so the contrast comes from darkening what the panels don't reach.
- **Bloom and depth of field**, sharing one half-resolution blur (two chains would look
  marginally better and cost twice as much for a game drawn in pencil). Depth comes from a
  sampleable depth texture blitted out of the multisampled buffer, so MSAA survives.
- **A grade**, rather than a balance: exposure, a Reinhard shoulder normalised so white
  stays white, saturation around luma, contrast pivoting on the paper tone instead of mid
  grey, and a few percent of split tone so the greys don't read as dead flat.

### The depth-of-field bug this used to have

Worth writing down, because the symptom and the cause were nowhere near each other.

The viewmodel is drawn last, and it used to clear the depth buffer first so that walls
couldn't cut through the player's hands. That clear happened *before* the multisampled
depth was resolved into the texture depth of field reads — so the DoF pass saw depth 1.0
everywhere, linearised that to the far plane, and blended in maximum blur across the entire
frame. Fancy mode was a permanent soft-focus filter, and the hands went soft the moment you
looked at anything far away.

The fix isn't to stop clearing: it's to not need to. The viewmodel now draws into a
reserved slice at the front of the depth range (`glDepthRange(0, 0.02)`). Under the world's
own projection, with its near plane at 0.05, everything the world draws lands above 0.9 —
so the viewmodel still wins every depth test and still occludes itself, while the world's
depth survives into the texture and the hands linearise to roughly the near plane, which is
exactly where DoF wants them.

Measured down a 45m sightline, mean |laplacian| over the frame: **8.55 before, 15.76 after**,
against 13.57 with fancy off. Over the hands: **13.47 before, 19.71 after**, within 2% of
unblurred.

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

**Smear frames** come in two kinds, because the two kinds of weapon want different things.

The knife *trails*. Its pose is a pure function of the weapon timers, so the same pose can be
asked for a fraction of a step ago and drawn faintly behind the real blade, and the cut leaves
a wake instead of teleporting between frames. The swap twirl, the idle knife trick and a
thrown hammer in flight all work this way, keyed off how fast the move is going. Paper shards get
a velocity stretch instead, since a tumbling scrap has no rest shape to distort away from.

The hammer and the greatblade are *drawn*. The hammer has two sheets of twelve authored cels in `hammerframes.js`, one for the
cut and one for the throw, played one per animation step; for that second the viewmodel **is**
the cel — no 3D hammer, no 3D hands. The throw sheet is a different animation rather than a
variant of the cut: the hammer travels *away* from the camera, so the drawing shrinks toward the
middle of the view instead of sweeping to one side, and the last six frames are an empty hand
coming down, because by then there is a real hammer out in the world and two of them would be one
too many.
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
  input.js      pointer lock, keys, mouse, analog move axis
  touch.js      the on-screen pad, and the thumb-reach layout behind it
  fist.js       fists as a weapon, and the boxing viewmodel
  hands.js      anatomical hand meshes, fist and grip
  settings.js   persisted settings
  hammerframes.js  the twelve drawn frames of an hammer swing
  thrownhammer.js  the hammer once it has left your hand
  frustum.js    view frustum planes for culling
  droodle/      the Droodle Cannon: stats and model, world FX, screen FX, and the
                controller that decides when any of it happens
  math.js       vectors, matrices, RNG
```

Needs a browser with WebGL2 — any current Chrome, Edge, Firefox or Safari.

---

## Credits

Twelve recorded sounds live in `assets/audio/`. Everything else you hear is synthesised at
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
| `punch.mp3` | a bare fist landing | from the Essential mod |
| `droodle-fire.mp3` | the cannon firing | from the Droodle mod |
| `droodle-impact.mp3` | where its round lands | from the Droodle mod |
| `droodle-charge.mp3` | the cannon winding up | from the Droodle mod |
| `droodle-laser.mp3` | the beam | from the Droodle mod |
| `droodle-reload.mp3` | the cannon reloading | from the Droodle mod |

**Licences are not sorted out here.** The Freesound clip carries whatever licence its
uploader chose — check it on the sound's page and keep attribution as that licence requires.
Everything else arrived without provenance, so before publishing this anywhere, confirm you
have the right to redistribute it; the two music tracks in particular are the kind of thing
a rights holder notices on a public page.

## Where three of these features came from

The fists, the Droodle Cannon and the fancy-shader fixes started as three mods, and are
native features now rather than a mod loader and three zips. Left out of Essential on
request: wall run, parry/guard, and its own momentum and slide (the game keeps the ones it
had). The energy orb went with the guard, since a guard break was the only thing that ever
threw one. Two deliberate changes against the mods: the Droodle Cannon does **not** survive
death — dying drops it like any other gun — and Essential's kill-heal is replaced by the
five hearts a body scatters.
