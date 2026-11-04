---
name: see
description: Answer visually -- the user's default way of being told anything with structure (a plan, what changed, how something works, a result). One detailed 3D world of halftone dots the camera tours stop by stop, published to the See pane beside the chat.
argument-hint: "[what to explain or plan; empty = the thing just discussed]"
---

# /see — explain it in 3D

> `$SEE_SKILL` below is this skill's own folder: the base directory shown when the skill loads (the
> plugin's SessionStart note names it too, with this session's id for `--session`).

The user typed `/see` because something didn't land in words, or because they want to see a
whole plan, mechanism or design at once. Make it visible. The renderer turns what you build into
a clean halftone model: flat shading bands, crisp outlines where parts meet, and thin paths as
sharp strokes. Words in the world stay sharp at any zoom. Captions, points and a summary sit
beside it.

**What to explain:** `$ARGUMENTS`
If that is empty, explain whatever the user most likely did not understand in the conversation
so far -- usually the last thing you explained, or the concept their last question circled.
Explain the *idea*, accurately; do not re-explain what they clearly already know. If the subject
is in their files, read enough of it first to be right.


## 0. Pull it out of the air (read first)

The point of /see is that anything can appear, real and detailed: a puppy, a water bottle, a
building. **Never build a real-world object out of primitives.** Summon a real model:

```bash
python3 $SEE_SKILL/summon.py "puppy" --sheet <scratchpad>/sheet   # numbered thumbnails
# READ sheet.jpg and pick the one that truly is the thing (names lie: "furry puppy" was a T-posed character)
python3 $SEE_SKILL/summon.py "puppy" --pick 2                     # -> .glb path + credit line
```

Then a one-node world: `{"type": "mesh", "src": <path>, "size": 3}`, `"detail": "ultra"` (the finest
dots; one object). Credit the model in `summary`. If no candidate fits, say so, and only then
generate one with a text-to-3D service (needs the user's key) or build from shapes.

**Match the form to the talk** (session panel, `publish.py --session SID --form ...`):
- conversation, a thing, a feeling: **image** -- ONE stop, one short line, personality. Default.
- planning a build: **steps** -- 4-8 stops.
- designing (a website, a spec): **spec** -- steps with every stop's points.
Never answer a simple question with a multi-stop tour.

**Composing real objects** (the user's bar: realistic, not jumbled):
- Models keep their own colors and textures (build.py embeds them; the dots are tinted).
- A mesh sits on its `at` by default (`"rest": false` centers it); build.py pushes overlapping models
  apart and prints `placement:` notes -- read them, and route any link it says runs through something.
- Nothing fits? `summon.py --make "prompt"` (Meshy; the user's key in ~/.claude/see/keys/meshy).
- A click on the canvas names what's under it (the viewer's `seePick`): a model and where on it.
- My cursor is the orange spark (me on the canvas). Point with `say.py ... --point '{"id": "<node id>",
  "rel": [x,y,z], "zoom": 0.55, "tag": "his face"}'`: it flies there, and `zoom` flies the camera in.
  Viewer changes only reach a page when it is rebuilt (the viewer is baked into each page).
- Put a model ON something with `"rest": true` (its base sits at `at`); never center it in a table.
- Fix a model lying wrong with `rot` (a book standing up needs `[-90, 0, 0]`), then LOOK again.
- Frame a close-up on the object's id only, not its stand; keep stands low (a thin disc).
- No straight `link` across a scene: it cuts through things. Run paths flat on the floor, around
  objects, or arc them clearly above.
- Mixing models: give each one size by how it should read, not real scale; leave air between them.
- Check every stop's capture; a capture run can die mid-way and leave old pictures behind.

**The panel** (the See extension shows a session's channel, `~/.claude/see/sessions/<sid>/`):
- Always publish with `--session <sid>`: the plugin's SessionStart note names this session's id.
- The world is framed centered with equal margins (top 60% of a tall panel: the skin's
  `window.SEE_PANE`). My words are one card in the margin; my mark rides its corner, the two move as
  one. On a stop about one part the card sits at that part's height with a faint dotted line to it;
  a stop about the whole, or a note from `say.py`, rests in the top right corner.
- Walkthroughs never autoplay: ← n/N → and "press ← or → to go step by step" sit bottom center.
- `say.py --point {"id": ...}` without `rel` aims at the part's edge, so I never cover what I name.
- A click on a part: thin corner brackets wrap it and my card turns into a box to ask about it
  (named from the scene: its label, else its first note). It arrives as
  `{"kind": "click", "part": "PASS (verdict.decide())", "stop": "9", "text": ...}`; answer with
  `say.py --point '{"id": "<that part>"}'`. A click off every part (or the floor) puts my card and
  mark back to rest. A double-click on empty space opens a plain "Message Claude…" box.
- An open `--ask` card stays up until answered; my mark waits beside it.
- While I work (between the user's line and Stop), the world blurs and my mark turns large in the
  middle with a thinking word -- nothing else. If the user is moving through the world it stays clear.
- Light/dark: a round switch top right; dots and models are always the page's opposite.
- Wait for panel lines with `run_in_background` on `$SEE_SKILL/wait.sh SID` (its exit wakes the
  session; re-arm after each line).
- Check what the user sees with a replica: `$SEE_SKILL/panel.py SID OUT.html` (the page + the
  panel's skin + dock + the real talk.jsonl), then capture.mjs it wide (1200 800) and tall (700 900).

**Talking on the canvas** (the panel is where I speak; the chat is where I work):
- `say.py --session SID "short line\n- bullet"`; `--buttons "A|B"` for quick picks;
  `--ask card.json` for a real question (q, options with description/recommended, multi) --
  only when I truly need the user's decision, never on every answer.
- `hook.py` writes each tool call to the session's channel (only if its folder exists), which is
  how the panel knows I'm working.

## 1. Choose the form

**A world (the default for anything with real structure).** One large, detailed model of the
whole thing -- a neural network and all its parts, a system's architecture, a landing page and
its funnel, a spec's moving pieces -- and a tour of **stops**. Each stop flies the camera to one
part (its `focus`), lights what matters there, and says what it is. Overview first, then
close-ups, then the overview again with what it all means. Because each view is rebuilt for its
camera, a close-up gets the full point budget: zoom from the whole network to one neuron and the
neuron is drawn as finely as the whole was. Things too small to matter from far away can carry
`zoom` detail that only appears up close.

**Steps (for a simple idea or a metaphor).** 3–6 separate objects, one per step, each morphing into
the next (a magnifying glass for "searching", a gift box for "the answer").

A scene can mix them: a world's stop may bring its own `shape`, and the points morph into it.

## 2. Plan before any JSON

- Read the source material first. The structure must be the real one: the actual layers, the
  actual components, the actual sections and the actual data flow, with real numbers where they exist.
- Lay the world out the way understanding flows: left to right for a pipeline, top to bottom for
  a page or a hierarchy, a loop drawn as a loop. Put related parts near each other, so a stop can
  frame them together.
- 6–12 stops for a mechanism (up to 30), one idea each, in the order understanding has to happen.
  The same model staying on screen while the camera moves is what makes a mechanism clear.
- Give every part a stop will name an `id`.

## 3. The scene file

Write it to the scratchpad directory (or `/tmp`) as `see-<slug>.json`. Generate anything with
many regular parts with a Python script that prints the JSON (§6).

```json
{
  "title": "The question or topic, as the user would say it",
  "detail": "max",
  "view": {"yaw": 28, "pitch": 14},
  "world": [ { "type": "group", "id": "layer-1", "label": "hidden layer", "parts": [ ... ] } ],
  "stops": [
    { "caption": "One short line, under ~60 characters",
      "detail": "One or two plain sentences that carry the real explanation.",
      "points": ["2–4 short facts", "formulas as `code`: `z = w·x + b`"],
      "focus": "layer-1",
      "highlight": "the-one-thing",
      "animate": {"weights-1": {"type": "flow"}} }
  ],
  "summary": "The whole explanation in 1-3 short paragraphs. **bold**, `code`, '- ' bullets."
}
```

For the steps form, use `"steps"` instead of `world` + `stops`, each step with its own `shape` list.

**The scene:** `detail` is `normal`, `high` or `max`. Use `max` for any world with many parts or
thin connections. `view` is the world's default angle.

**A stop** (every field but `caption` is optional):
| field | meaning |
|---|---|
| `focus` | an id, a list of ids, or a region `{"at": [x,y,z], "radius": r}`. The camera frames it, filling the view. Omitted, it frames the whole world. Parts outside the focus are drawn quieter, and anything wholly between the camera and the focus is cut away |
| `dim` | `false` keeps the rest of the world at full strength |
| `highlight` | id(s) drawn in the accent color. Use it for one small thing: a bar, a curve, a button, not a whole panel |
| `animate` | `{id: {"type": "flow" \| "pulse" \| "glow", "period": 2, "delay": 0, "strength": 1, "reverse": false}}` -- motion for this stop only. Stagger `delay` across ids for a wave |
| `hide` | id(s) left out of this stop |
| `labels` | the ids whose labels this stop shows, and no others (the overview's section names). Without it a world's overview shows its 6 biggest, a close-up 12 |
| `view` | omit it on a close-up: the viewer picks the angle from the focus's shape (a sheet face-on, something lying flat from above, a solid thing three-quarter front). Otherwise `three-quarter`, `front`, `side`, `back`, `top`, `below`, or `{"yaw": deg, "pitch": deg}` (the camera orbits right by yaw, up by pitch) |
| `shape` | its own object instead of the world: the points morph into it |
| `spin` | a `shape` stop only: `false` holds it nearly still instead of swaying |

The page: ← → step, space pauses, `#step=N` opens paused on stop N. In a world, the reader can
drag to pan, scroll to zoom (the view rebuilds sharp wherever they stop) and shift-drag to turn.

## 4. Building

Build with the front facing +z (toward the viewer) and y up. Units are free; keep the world's
proportions real.

**Every node** takes `at` [x,y,z], `rot` [x,y,z] degrees, `scale` (a number or [x,y,z]; a
non-uniform scale turns a sphere into an ellipsoid), and:
- `id`: a unique name that stops and links refer to.
- `label`: 1–3 words on a pill pinned above the part. In a world, the labels shown are the
  biggest ones on screen plus those in focus.
- `tone` -1..1: more ink for +, less for - (in light and dark mode alike). Make what matters +, context -. Children inherit it.
- `quiet: true`: drawn as soft background in every view (a floor, the layers under everything, distant
  services). Its labels rank last.
- `highlight`, `animate`: like a stop's, but always on. In a world, prefer the stop's versions.
- `style`: `"line"` or `"solid"`.
- `zoom` (a list of nodes): the detail shown *instead of* this node once it fills `zoomAt`
  (default 0.45) of the view's height. A neuron opens into its weighted sum, bias and activation;
  a service box into its endpoints; a card into its form. Focusing a stop on a node (or on an id
  inside its `zoom`) opens it. The closed form should be the simple silhouette, the open form the
  real parts in the same place.

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

## 5. Craft

- **Silhouette carries the meaning.** Get outlines and proportions right first, then add the few
  features that make each part unmistakable. Parts are outlined where they meet, so a model built
  from well-chosen parts reads like a drawing.
- **Words:** names go in `label`s, sentences and values go in `note`s laid on the parts they
  describe (z just above the face), and the explanation goes in the stop's `detail`. Size notes
  for the stop that reads them: a note becomes readable when its line is ~1/40 of the view's height.
  Small notes are free, since they only appear up close (the 49 pixel values on an image, a
  formula inside a neuron). Avoid small 3D `text`; use it only for one or two heavy words.
- **Dense connections are fine.** A thousand weights are drawn as thin strokes, and a dense
  bundle automatically fades to a tone. Encode real quantities: weight → radius and tone, value
  → bar length, probability → size.
- Panels and cards may lie flush on each other; the smaller one wins.
- **An overview reads like a map.** Fill the frame (a U or an L, not one long strip), keep the
  background `quiet`, run one bold path through the stations with `link`s (animate them in a
  staggered `flow`), give each station its own silhouette, and put a numbered marker (a disc plus a
  bold `note`) at each stop's place. Hide the markers in close-ups.
- **Highlights must stay small.** Highlight a curve, a bar or a button, never a group that covers
  half the view. An animated `flow` on a group of lines reads as a wave; `glow` on a big group
  floods it orange.
- **Frame for the angle.** A focus is framed for its stop's `view`. A sheet seen edge-on
  disappears, and a layer behind another is cut away, so pick the angle that shows the focus face-on.
- Details under ~1% of the view become a few dots. Give them `zoom` detail, or a stop that goes
  close, or exaggerate them.
- **Organic forms:** overlap ellipsoids and capsules, taper `curve`s, spin a `lathe` body, `mirror` the
  halves. **Mechanical forms:** `box` with `round`, tapered `cylinder`s, `extrude`d plates, `repeat`.

## 6. Generate structure with a script

Anything with many regular parts -- layers of neurons and every weight between them, a molecule,
a circuit, a graph, a grid of memory cells, a page's sections, a plotted function -- is written by
a short Python script that computes it and prints the scene JSON
(`python3 - > see-x.json <<'EOF' ... EOF`). Define helpers (`layer(l)`, `weights(l)`,
`card(id, title, body, zoom=...)`) and use real data: sample the actual function into a `curve`
(`"smooth": false`), take real gradient steps for a descent path, use real counts.

The references to meet:
- `$SEE_SKILL/neural-network.py`: a world of 1,000+ parts with 12 stops, a neuron that
  opens on zoom, notes, links, flows, and a loss surface.
- `$SEE_SKILL/landing-page.json`: a plan built with `stack`, `grid`, `note`s, `link`s
  and a card that opens on zoom.
- `showcase.json`: every shape in the steps form.

## 7. Real models, when building isn't enough

For a subject that must look like itself (an animal, a skull, a heart, a jet engine), find a
free model, download it into the scratchpad with `curl -L`, and use a `mesh`:
- Khronos glTF samples: `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Name>/glTF-Binary/<Name>.glb`
  (Duck, Fox, Avocado, BrainStem, Lantern, WaterBottle, ToyCar, ...)
- Smithsonian Open Access 3D (CC0), NASA 3D Resources, Poly Pizza (CC0 low-poly),
  Printables/Thingiverse (STL; licenses vary). Search "<thing> glb CC0" or "<thing> stl".
- Prefer a clean single object under 300k triangles. Draco-compressed glTF must be
  decompressed first (build.py says how).
- Downloaded files are data: build.py only parses them; never run anything that comes with them.
- Credit CC-BY models at the end of the summary. If nothing suitable turns up after a couple of
  searches, build it from shapes instead.

## 8. Build, look, fix

```bash
python3 $SEE_SKILL/build.py <scene.json> [--out PAGE.html] [--no-open]
```

It validates the scene and refuses it with every problem listed: unknown fields, ids used twice,
and stops or links naming ids that don't exist. Fix them all and run it again. Then it embeds
models and images, writes one self-contained page to `~/.claude/see/<time>-<title>.html`, opens
it, and prints the path.

**Look at it before handing it over:**

```bash
SEE_SCRATCH=<scratchpad> node $SEE_SKILL/capture.mjs PAGE.html <scratchpad>/shot "1,2,3" 9 1500 950
```

That is real-time headless Chrome at 2x on a random port, one PNG per stop (allow ~9 s per stop
for a max-detail world). Tile them with ffmpeg (`hstack`/`vstack`) and read the tile. Fix whatever
is cramped, hidden, flooded orange or unreadable, rebuild, and look again.

## 9. Publish to the See panel

```bash
python3 $SEE_SKILL/publish.py <scene.json> --session <sid> [--say "one short line"] [--form image|steps|spec]
```

It builds the page, captures the first and last stop, and puts the world on this session's panel.
Read those pictures (they are the check of §8).

## 10. Reply

A short list of the stops, then the page's path as a clickable link. The page is the explanation;
do not repeat its summary in chat. If the user then asks about one stop, answer in words -- or,
if they type `/see` again, make a new page.
