---
name: see
description: The Vision canvas beside the chat -- a 3D workspace that keeps several visuals between turns. Each turn, choose the form -- just talk, one picture, a step-by-step tour (only for a real process), a living world (when the user wants to have something that works), or an edit to what is already there -- and talk on the canvas while you point at its parts. Codebase visuals are built from the real code (code.py). Use for anything with structure: how something works, a plan, a comparison, what changed, a part of the code.
argument-hint: "[what to show; empty = the thing just discussed]"
---

# /vision -- the Vision canvas

The canvas is a **workspace**, not a slideshow. It holds several visuals at once and keeps them between
turns; the user turns, zooms (about 10x, down to one part) and pans it, hovers to identify, clicks to
select, double-clicks to open a part into its insides, drags a selected visual to move it, right-clicks
for actions, and talks to you on it. Everything is real 3D: triangle meshes drawn every frame with a
halftone look on top -- solid at every angle and zoom, at 60 fps.

**What to show:** `$ARGUMENTS` (empty: what the user most likely did not understand, or the thing just discussed).
If the subject is in their files, read enough of it first to be right.

Every command takes `--session SID` (the plugin's SessionStart note names this session's id and `$VISION_SKILL`, this skill's folder; `SEE_SESSION` works too).

## 1. Choose the form (every turn)

Decide before building anything. The chat always carries a real answer; the canvas adds what words can't.

| The turn is... | Form | How |
|---|---|---|
| a yes/no, a fact, a quick confirmation | **just talk** -- chat only | nothing on the canvas |
| an explanation with no shape to it | **just talk**; a card on the canvas only if it is open and the user is looking there | `canvas.py say` |
| "what is X", "how is X built", a thing, a structure, a design | **one picture** -- one visual, no stops | `canvas.py add` |
| a process whose order *is* the point (a request's path, a build pipeline, a migration plan) | **a tour** -- stops, 3+ real steps, never for a static structure | `add` a scene with `stops` |
| "make me X", "let me play with X", "a simulator of..." | **a living world** -- the real thing, running | `add` a scene with `live` |
| a follow-up about what is already there ("what's that", "show its inside", "and the other one?") | **an edit** -- point, highlight, open, patch; never a new visual | `point` / `highlight` / `expand` / `patch` |
| "show src/x next to src/y", "compare A and B" | **arrange** -- add both, side by side, then point at the differences | `code` / `add` + `arrange row` |
| a part of the codebase | **a code visual** from the real code -- never hand-drawn | `canvas.py code` |
| a real object (a puppy, a jet engine, a heart) | **one picture** with a summoned model (section 5) | `summon.py` + `add` |

Rules:
- Never a multi-stop tour for something that is not a sequence. A system is one picture you then talk through by pointing.
- Prefer editing what is on the canvas to adding: `canvas.py state` tells you what is there and what the user selected.
- Remove what no longer helps (`remove KEY`) so the workspace stays legible; keep what the user is comparing.
- Keep a visual's key stable (`auth-flow`, `src-x`) so later turns can point at it.

## 2. Talk on the canvas while you answer

The chat gives the real answer, in full. **Never write "look at the canvas"** -- say what is true, and on the
canvas point at the parts as you name them. A `say` line can carry ops that play in order as it is shown:

```bash
C="python3 $VISION_SKILL/canvas.py --session $SID"
$C add auth ~/scratch/see-auth.json                      # a visual (scene file, section 4)
$C code core src/core                         # a visual made from real code
$C arrange row                                            # side by side (stacked in a tall panel)
$C say "Tokens are checked in **gate.rs** before any write." --do '[
  {"op": "point", "key": "core", "ids": ["mod-core--gate-rs"], "tag": "the gate", "wait": 1.2},
  {"op": "expand", "key": "core", "id": "mod-core--gate-rs"}]'
$C highlight core <id> ...  /  --off                      # light parts orange (stays until turned off)
$C patch auth '{"cache": {"glow": 0.8, "move": [0, 0.3, 0]}}'  # live values on parts: tone glow hide move width
$C focus core <id>   |   focus --all                      # fly the camera
$C stop KEY N  |  expand KEY ID  |  collapse KEY ID  |  select KEY ID  |  remove KEY  |  clear
$C status "reading gate.rs"                               # a working line under my card; the next line replaces it
$C state                                                  # what is on the canvas, the layout, the user's selection
$C look --out DIR                                         # the panel as the user sees it, wide + tall PNGs: READ them
```

Ops (in `--do`): `add` (`scene_file`, or after `add` a `key`), `remove`, `clear`, `arrange` (`layout`, `order`),
`focus` (`key`, `ids`), `point` (`key`, `ids`, `tag`), `highlight` (`ids`, `on`), `patch` (`set`), `stop` (`k`),
`expand`/`collapse`/`select` (`id`), `app` (to a living world), `view` (`yaw`, `pitch`). Any op may carry `"wait": s`.

**The user talks on the canvas too.** Their lines arrive in `talk.jsonl` as `{"who": "you", "kind": ...}`:
`chat`, `ask` (about a selected part: `visual`, `part`, `id`, `file`), `explain`, `expand` (a part with no
precomputed insides: build them and `add`/`patch`, or `replace` the visual with more detail), `compare`
(`other`), `live`. Wait for them with `run_in_background` on `canvas.py --session SID wait` (it exits on the
next line; re-arm after each). Answer **on the canvas** (`say` + ops) when they asked there, and in the chat
when they asked in the chat.

`hook.py` already writes a status line per tool call while you work, so the user sees you are busy.

## 3. Code visuals: from the real code

```bash
$C code KEY PATH [PATH ...] [--depth 3] [--title T]
```
`code.py` reads Python (ast), JS/TS (import/require, functions) and Rust (mod/use/fn). Each PATH is a module:
a block whose size follows its lines of code; it opens (double-click, or zoom in) into its files standing as
buildings on a plinth, and a file opens into its functions. Arcs are the real imports and calls -- faint until
an end is hovered or selected, then lit. Every part carries `file: "path:line"`: "Open file" opens it in the
editor. Ids: `mod-<module>--<file-with-dashes>` and `...--<function>-<line>` (`canvas.py state`, or the scene
file in `sessions/SID/visuals/`, lists them). The panel watches the paths and refreshes the visual when a file
changes (`canvas.py refresh KEY` does it by hand); what existed stays, what is new assembles in.

- One module per path: `code x src/x` and `code y src/y` side by side, or one visual with both paths (`code both src/x src/y`) to see the imports between them.
- After adding, point at what the answer is about, and open the file that matters.

## 4. Building a scene (pictures, tours, living worlds)

Write a JSON scene to the scratchpad (`see-<slug>.json`); generate anything with many regular parts with a
short Python script. `canvas.py add` validates it (every problem listed), embeds models and pictures, and
puts it on the canvas.

```json
{ "title": "How a request is authorized", "view": {"yaw": 30, "pitch": 24},
  "world": [ {"type": "group", "id": "gate", "label": "gate", "file": "src/gate.rs:40", "parts": [ ... ],
              "expand": [ ...its insides, shown on double-click... ]} ],
  "stops": [ {"caption": "..."} ] }
```

**Solid, not flat.** The user's bar: objects with volume and depth that read at a glance.
- Build abstract systems as **solid 3D structures on a ground**: services as blocks with real depth (`box` with `round`),
  data stores as cylinders, queues as rows of small blocks, layers stacked in height, flows as arcs or tubes running
  over the ground between them. Never a set of thin cards standing in one plane.
- Give each kind of thing its own silhouette; size by what matters (load, lines, cost).
- Lay out on the ground (x-z), height for emphasis; leave air between parts so outlines read.
- Labels name things (`label`, 1-3 words); the canvas places them so they never overlap each other or cover what
  they name. Sentences go in `note`s lying on a face, or in what you `say`.
- `rel: [idA, idB]` on a link or curve marks it as a relation between two parts: faint until either end is hovered or selected.
- `expand` (or `zoom`) on a node: its insides, shown when the user double-clicks it or zooms in on it. The closed
  form is the simple silhouette; the open form the real parts in the same place.
- `file: "path:line"` on any node: the user can open it in the editor.
- `quiet: true` for background; `tone` -1..1 for less/more ink; `highlight` for one small thing.

**A tour** (only for a real sequence) has `stops`, each `{caption, detail, points, focus, highlight, hide, animate, dim, labels, view}`:
the camera frames the focus, the rest dims, and the user steps with the arrows or ← →. A one-stop scene is a picture.
The `steps` form (each step its own `shape`) still works for a metaphor sequence.

**A living world** carries a `live` program (`{"file": "program.js"}`) -- the real computation, running. Same API
as before: `see.world`, `see.set(id, {tone, glow, hide, width, move, flat})`, `see.get`, `see.clear`, `see.text(id, s)`,
`see.loop((dt, t) => ...)`, `see.on('click'|'drag'|'claude'|'stop', [id], h => ...)` (`h.at`, `h.normal` in the scene's
coordinates; a drag's `h.at` slides along the grabbed surface), `see.rebuild()`, `see.control({type, label, ...})`
(button, toggle, slider, select -- shown in the world's box), `see.status(md)`, `see.say(text, state)`, `see.find(id)`, `see.view()`.
It keeps running while the user selects, moves and compares other visuals. Send it values with `canvas.py app KEY '{...}'`.
References: `live/neural-network.*`, `live/rocket-booster.*`, `live/quantum-computer.*`.

### Shapes

Build with the front facing +z and y up. Every node takes `at` [x,y,z], `rot` [x,y,z] degrees, `scale`
(a number or [x,y,z]), `id`, `label`, `tone`, `quiet`, `highlight`, `animate` (`{"type": "flow"|"pulse"|"glow", "period", "delay", "strength", "reverse"}`), `style`, `file`, `rel`, `zoom`/`expand`, `zoomAt` (0.45).

### Solids
| type | fields (defaults) |
|---|---|
| `box` | `size` [w,h,d] ([1,1,1]), `round` corner radius (0) |
| `sphere` | `radius` (0.5) |
| `dome` | `radius` (0.5) -- a half sphere, flat side down |
| `cylinder` | `radius` (0.5), `radius2` top radius (= radius; makes a tapered cylinder), `height` (1), `open` (no caps: a cup, a pipe) |
| `cone` | `radius` (0.5), `height` (1), tip at +y |
| `capsule` | `radius` (0.25), `height` (0.5) of the straight middle, along y |
| `torus` | `radius` (0.5), `tube` (0.3×radius), `arc` degrees (360; 180 = an arch, a handle, a smile). Lies in x–z; `"rot": [90,0,0]` stands it up facing +z. A partial ring runs from +x: with `"rot": [-90,0,0]` it arches over the top (a shackle, a handle), with `[90,0,0]` it hangs below (a smile) |

### Tools for any form
| type | what it makes | fields |
|---|---|---|
| `tube` / `arrow` | a rod / a rod with a head, between two points | `from`, `to`, `radius` (0.05) |
| `curve` | a smooth tube along a path: cables, tails, limbs, coils, return paths | `path` [[x,y,z]…], `radius` (one number, or one per point to taper), `smooth` (true), `closed` |
| `extrude` | any outline given thickness: logos, leaves, gears, signs, keys | `points` [[x,y]…] in x–y, `holes` [[[x,y]…]…], `depth` (0.2), `smooth` |
| `lathe` | a profile spun around y: vases, bottles, bells, chess pieces | `profile` [[radius, y]…] bottom to top (start and end at radius 0 to close it), `smooth` |
| `surface` | a math surface over u, v in 0..1: loss landscapes, waves, shells, terrain | `x`, `y`, `z` as expressions (`sin cos sqrt pow abs exp log atan2 pi …`) |
| `note` | **words in the world**: real text, sharp at any zoom, sized in world units, readable once the camera is close enough | `text` (`\n` for lines), `size` line height (0.08), `width` (wraps; 0 = no wrap), `align` (`center`, `left`), `weight` (`bold`) |
| `text` | 3D letters, as a shape | `text`, `size` height (1), `depth` (0.2), `font` (CSS, e.g. `"700 96px Georgia"`) |
| `glyph` | an emoji or symbol as a relief tile | `char` (e.g. `"Σ"`, `"🐙"`), `size` (1), `depth`, `relief` |
| `image` | a picture file as a relief | `src` path, `size` (1), `relief` (0.08), `mask` (`auto`, `alpha`, `dark`, `light`, `all`), `contrast` (1) |
| `mesh` | a real 3D model | `src` (.glb .gltf .obj .stl), `size` (fits 1 unit), `twoSided` |
| `link` | an arrow from one id's box to another's, edge to edge: data flow, calls, dependencies, a funnel | `from` id, `to` id, `radius` (from their sizes), `bend` (0; ±0.2 curves it), `head` (true) |

### Composition
| type | fields |
|---|---|
| `group` | `parts` [...] -- moves, turns, scales, tones and labels them as one |
| `repeat` | `count`, `offset` [x,y,z] added per copy, `turn` [x,y,z] degrees added per copy, `part` or `parts` |
| `mirror` | `axis` (`x`), `parts` -- the parts plus their reflection |
| `stack` | `parts` laid out by their real sizes: `axis` `y` (a column, top to bottom; the default), `x` (a row), `z`; `gap` (0.1); `align` `center` / `start` / `end` |
| `grid` | `parts` in rows of `cols` (√n), each cell sized to its row and column; `gap` (number or [x, y]); `align` |

`stack` and `grid` are what make plans, pages, specs and dashboards easy: build each section as a
group (a `box` panel plus `note`s), then stack the sections. Never compute their positions by hand.


## 5. Real things: summon a real model

Never build a real-world object out of primitives.

```bash
python3 $VISION_SKILL/summon.py "puppy" --sheet <scratchpad>/sheet   # numbered thumbnails: READ sheet.jpg, pick the real thing
python3 $VISION_SKILL/summon.py "puppy" --pick 2                     # -> .glb path + credit line
```
Then a node `{"type": "mesh", "src": <path>, "size": 3}` (it sits on its `at`; `"rest": false` centers it; fix a
model lying wrong with `rot`). Models keep their colors (the dots are tinted). Credit CC-BY models in what you say.
No candidate fits: say so; `summon.py --make "prompt"` (Meshy, the user's key) or build from shapes as a last resort.

## 6. Look before you answer

```bash
python3 $VISION_SKILL/canvas.py --session $SID look --out <scratchpad>/look   # wide.png + tall.png
```
Read both. Fix what is cramped, hidden, flooded orange, unreadable, or flat; then say your line. `--js` runs
code on the page first (`SEE.setView({yaw: 90, zoom: 4})`, `SEE.ui.select(...)`) to check another state.
Standalone pages still build: `build.py SCENE.json [--out PAGE.html]` (the same canvas, one visual).

## 7. The renderer, in one paragraph (when something looks wrong)

`canvas/` holds the canvas: `shapes.js` (every shape as triangles), `scene.js` (the node tree -> one merged mesh
per visual + a part table), `core.js` (pass A: meshes into color/id/normal/tone buffers every frame; pass B: a
screen-space halftone, one dot per cell, crisp outlines where parts, depth or surfaces change; notes drawn sharp
on top), `app.js` (workspace, camera, labels, zoom levels, stops), `live.js` (living worlds), `ui.js` (talk, hover,
selection, menu, ops). `pack.py` inlines them with three.js (vendor/, pinned) into `~/.claude/vision/canvas.html`,
which the Vision panel loads once. `check-coverage.mjs` fails on any gap: run it after renderer changes.

## 8. Reply

The chat answer is complete on its own. When a visual helps, it is on the canvas too and the answer names its
parts as you point at them. No "see the canvas" lines, no list of what you built.
