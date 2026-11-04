# Vision — make Claude Code visual

Claude Code answers in 3D. Ask how something works, what changed, or what the plan is, and a
halftone world opens beside the chat. You walk it with ← →; Claude's notes sit in the margin and
point at each part. Click any part to ask about it. Double-click empty space to message Claude.

Why: [From text to visual: agents should show, not tell](https://ai-andromeda.com/reports/text-to-visual/).

![A Vision world beside the chat](https://ai-andromeda.com/reports/text-to-visual/overview.webp)

## Install

**1. The plugin** (Claude Code):

```
/plugin marketplace add ZekeVoigt/andromeda-vision-public
/plugin install vision@andromeda-vision
```

**2. The panel** (VS Code, Cursor, Windsurf): download `vision-0.3.0.vsix` from the
[latest release](https://github.com/ZekeVoigt/andromeda-vision-public/releases/latest), then run
**Extensions: Install from VSIX…** from the command palette. Or build it:
`cd extension && npx @vscode/vsce package`.

**3. Optional — make it the default.** Add to your `CLAUDE.md`:

```
For any reply with structure (a plan, what changed, how something works), use /vision and publish it
to the Vision panel. Keep the chat reply to one line.
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
| the skill | `plugin/skills/vision/` | builds a world (`build.py` + `viewer.html`), checks it (`capture.mjs`), publishes it (`publish.py`), talks on the canvas (`say.py`) |
| the hooks | `plugin/hooks/hooks.json` | tell Claude its session id, and tell the panel when Claude is working |
| the panel | `extension/` | shows the session's world beside the chat (`skin.html`, `dock.html`) |

Everything a session shows lives in `~/.claude/vision/sessions/<session id>/`.

## License

MIT. Downloaded models keep their own licenses; Vision prints each one's credit.
