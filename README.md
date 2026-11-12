# Vision — make Claude Code visual

Claude Code gets a canvas beside the chat: a 3D workspace that keeps several visuals between turns.
Ask how something works and a solid halftone model appears; ask for two parts of your code and they
stand side by side, built from the real imports and calls. Turn, zoom (down to one part) and pan --
it stays solid at every angle. Hover to identify, click to select, double-click to open a part into
its insides, drag to move, right-click for actions, and talk to Claude right on the canvas while it
points at what it is explaining. Ask it to *make* something and you get a living world that runs.

Why: [From text to visual: agents should show, not tell](https://ai-andromeda.com/reports/text-to-visual/).

![A Vision world beside the chat](https://ai-andromeda.com/reports/text-to-visual/overview.webp)

## Install

**1. The plugin** (Claude Code):

```
/plugin marketplace add ZekeVoigt/andromeda-vision-public
/plugin install vision@andromeda-vision
```

**2. The panel** (VS Code, Cursor, Windsurf): download `vision-0.4.0.vsix` from the
[latest release](https://github.com/ZekeVoigt/andromeda-vision-public/releases/latest), then run
**Extensions: Install from VSIX…** from the command palette. Or build it:
`cd extension && npx @vscode/vsce package`.

**3. Optional — make it the default.** Add to your `CLAUDE.md`:

```
Answer in the chat, fully. When structure helps (a system, a plan, a comparison, a part of the code),
also put it on the Vision canvas with /vision, and point at its parts while you explain.
```

Then try: `/vision how a git rebase works`.

## Needs

- `python3` and `node` (18+)
- Google Chrome, for the captures Claude checks its own work with
- `ffmpeg` (optional), to tile captures
- 3D models are fetched when needed from Sketchfab via Objaverse (free, no key), each with its
  credit. To generate a model nothing fits, set `MESHY_API_KEY` (your own Meshy account).

## How it works

| Piece | Where | What |
|---|---|---|
| the canvas | `plugin/skills/vision/canvas/` | real triangle meshes every frame with a screen-space halftone on top (three.js, pinned in `vendor/`); the workspace, labels, selection and talk; `check-coverage.mjs` fails on any gap |
| the skill | `plugin/skills/vision/` | `canvas.py` (add, code, say, point, look), `code.py` (visuals from real Python, JS/TS and Rust), `build.py` (checks a scene), `summon.py` (real 3D models) |
| the hooks | `plugin/hooks/hooks.json` | tell Claude its session id, and tell the panel when Claude is working |
| the panel | `extension/` | loads the canvas once and plays what Claude sends; opens files in the editor; refreshes code visuals when files change |

Everything a session shows lives in `~/.claude/vision/sessions/<session id>/`: `workspace.json` (what the
canvas holds), `visuals/`, and `talk.jsonl` (the conversation both ways).

## License

MIT. Downloaded models keep their own licenses; Vision prints each one's credit.
