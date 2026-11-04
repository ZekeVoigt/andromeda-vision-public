# See — make Claude Code visual

Claude Code answers in 3D. Ask how something works, what changed, or what the plan is, and a
halftone world opens beside the chat. You walk it with ← →; Claude's notes sit in the margin and
point at each part. Click any part to ask about it. Double-click empty space to message Claude.

## Install

**1. The plugin** (Claude Code):

```
/plugin marketplace add ZekeVoigt/andromeda-see-public
/plugin install see@andromeda-see
```

**2. The panel** (VS Code, Cursor, Windsurf): install **See for Claude Code** from the
VS Code Marketplace or Open VSX, or build it: `cd extension && npx @vscode/vsce package`.

**3. Optional — make it the default.** Add to your `CLAUDE.md`:

```
For any reply with structure (a plan, what changed, how something works), use /see and publish it
to the See panel. Keep the chat reply to one line.
```

Then try: `/see how a git rebase works`.

## Needs

- `python3` and `node` (18+)
- Google Chrome, for the captures Claude checks its own work with
- `ffmpeg` (optional), to tile captures
- 3D models are fetched when needed from Sketchfab via Objaverse (free, no key), each with its
  credit. To generate a model nothing fits, set `MESHY_API_KEY` (your own Meshy account).

## How it works

| Piece | Where | What |
|---|---|---|
| the skill | `plugin/skills/see/` | builds a world (`build.py` + `viewer.html`), checks it (`capture.mjs`), publishes it (`publish.py`), talks on the canvas (`say.py`) |
| the hooks | `plugin/hooks/hooks.json` | tell Claude its session id, and tell the panel when Claude is working |
| the panel | `extension/` | shows the session's world beside the chat (`skin.html`, `dock.html`) |

Everything a session shows lives in `~/.claude/see/sessions/<session id>/`.

## License

MIT. Downloaded models keep their own licenses; See prints each one's credit.
