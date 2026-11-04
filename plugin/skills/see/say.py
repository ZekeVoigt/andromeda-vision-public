#!/usr/bin/env python3
"""Say a line to the user through a session's See panel (the see-live VS Code extension).

    python3 $SEE_SKILL/say.py --session SID "text"           # a reply
    python3 $SEE_SKILL/say.py --session SID --status "text"  # what I'm doing; the next line replaces it
    python3 $SEE_SKILL/say.py --session SID "Which one?" --buttons "Tower|House|Bridge"
    python3 $SEE_SKILL/say.py --session SID "One thing first." --ask ask.json
--point JSON: my cursor goes there: {"id": "part", "rel": [x,y,z] (-1..1 on it), "zoom": 0.5, "tag": "label"}
Text: short sentences, "- " bullets on their own lines. Buttons send their label back as the user's line.
--ask FILE: a question card, like Claude Code's clarify prompt:
  {"q": "Which way?", "multi": false, "options": [{"label": "A", "description": "...", "recommended": true}, ...]}
  The answer comes back as the user's line (labels joined by ", ", or their own "Other" text).

The channel is ~/.claude/see/sessions/<SID>/talk.jsonl. The user's lines arrive there as
{"who": "you", ...}; watch it with `tail -n0 -F talk.jsonl | grep --line-buffered '"who": *"you"'`.
"""
import datetime, json, pathlib, sys

CHANNELS = pathlib.Path.home() / ".claude" / "see" / "sessions"


def say(sid, text, **extra):
    d = CHANNELS / sid
    d.mkdir(parents=True, exist_ok=True)
    line = {"who": "claude", "text": text, "at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), **extra}
    with open(d / "talk.jsonl", "a") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def main(argv):
    if "--session" not in argv:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    i = argv.index("--session")
    sid = argv[i + 1]
    rest = argv[:i] + argv[i + 2:]
    buttons = ""
    if "--buttons" in rest:
        j = rest.index("--buttons"); buttons = rest[j + 1]; rest = rest[:j] + rest[j + 2:]
    point = ""
    if "--point" in rest:  # my cursor: {"id", "rel", "at", "zoom", "tag"}
        j = rest.index("--point"); point = rest[j + 1]; rest = rest[:j] + rest[j + 2:]
        json.loads(point)
    ask = ""
    if "--ask" in rest:
        j = rest.index("--ask"); ask = pathlib.Path(rest[j + 1]).read_text(); rest = rest[:j] + rest[j + 2:]
        json.loads(ask)  # refuse a broken card here, not in the panel
    status = "--status" in rest
    rest = [a for a in rest if a != "--status"]
    text = " ".join(rest).strip()
    if not text:
        print("nothing to say", file=sys.stderr)
        return 2
    if point:
        text += "\n[[cur:" + json.dumps(json.loads(point), ensure_ascii=False) + "]]"
    if ask:
        text += "\n[[ask:" + json.dumps(json.loads(ask), ensure_ascii=False) + "]]"
    elif buttons:
        text += "\n[[" + buttons + "]]"
    say(sid, text, **({"kind": "status"} if status else {}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
