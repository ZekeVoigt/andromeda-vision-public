#!/usr/bin/env python3
"""Claude Code hook: show a session's live work on its Vision canvas.

Wired by the plugin's hooks/hooks.json for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop.
On SessionStart it tells Claude its session id and this skill's folder (the panel is keyed by the id). It writes
only when ~/.claude/vision/sessions/<session_id>/ exists, so only sessions with a canvas are shown.
Never blocks, prints only that SessionStart note: any failure is silent and the tool call goes ahead.
"""
import datetime, json, os, pathlib, sys

CHANNELS = pathlib.Path.home() / ".claude" / "vision" / "sessions"


def target(tool, inp):
    if not isinstance(inp, dict):
        return ""
    if tool == "Bash":
        return inp.get("description") or inp.get("command", "")[:80]
    for k in ("file_path", "notebook_path"):
        if inp.get(k):
            return os.path.basename(inp[k])
    for k in ("pattern", "query", "url", "description", "skill", "prompt", "command"):
        if inp.get(k):
            return str(inp[k])[:80]
    return ""


def clip(text, lines=14, chars=1600):
    text = str(text or "")
    out = "\n".join(text.splitlines()[:lines])
    return out[:chars]


def detail(tool, inp, resp, phase):
    """What the canvas shows of the work itself: an edit's lines, a command and its output."""
    inp = inp if isinstance(inp, dict) else {}
    if phase == "start":
        if tool == "Edit":
            return {"kind": "diff", "file": os.path.basename(inp.get("file_path", "")),
                    "old": clip(inp.get("old_string"), 10, 900), "new": clip(inp.get("new_string"), 14, 1300)}
        if tool == "Write":
            return {"kind": "code", "file": os.path.basename(inp.get("file_path", "")), "text": clip(inp.get("content"))}
        if tool == "Bash":
            return {"kind": "cmd", "text": clip(inp.get("command"), 6, 600)}
        if tool in ("Grep", "Glob"):
            return {"kind": "cmd", "text": f"{tool.lower()} {inp.get('pattern', '')}" + (f"  in {inp['path']}" if inp.get("path") else "")}
        if tool == "Read":
            return {"kind": "cmd", "text": f"read {inp.get('file_path', '')}"}
        if tool in ("WebSearch", "WebFetch"):
            return {"kind": "cmd", "text": inp.get("query") or inp.get("url", "")}
        return None
    # the end: what came back
    if isinstance(resp, dict):
        out = resp.get("stdout") or resp.get("output") or resp.get("content") or ""
        if not out and isinstance(resp.get("file"), dict):
            out = resp["file"].get("content", "")
        err = resp.get("stderr") or ""
        text = (str(out).rstrip() + ("\n" + str(err).rstrip() if err else "")).strip()
    else:
        text = str(resp or "").strip()
    if not text or tool in ("Edit", "Write"):
        return None
    lines = text.splitlines()
    return {"kind": "out", "text": "\n".join(lines[-10:] if tool == "Bash" else lines[:10])[:1400]}


def main():
    try:
        e = json.load(sys.stdin)
        ev = e.get("hook_event_name", "")
        if ev == "SessionStart" and e.get("session_id"):
            here = pathlib.Path(__file__).resolve().parent
            print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext":
                f"Vision: this session's id is {e['session_id']}; VISION_SKILL is {here}. Use canvas.py --session {e['session_id']} (add, code, say, point, look)."}}))
            return
        d = CHANNELS / str(e.get("session_id", ""))
        if not e.get("session_id") or not d.is_dir():
            return
        now = datetime.datetime.now().astimezone().isoformat(timespec="milliseconds")
        if ev == "UserPromptSubmit":
            prompt = str(e.get("prompt", "")).lstrip()
            if prompt.startswith("<") or not prompt:  # a background notice, not the user typing
                return
            line = {"who": "you", "kind": "chat", "text": str(e.get("prompt", ""))[:2000], "at": now}
        elif ev in ("PreToolUse", "PostToolUse"):
            tool = e.get("tool_name", "")
            act = {"phase": "start" if ev == "PreToolUse" else "end", "tool": tool,
                   "target": target(tool, e.get("tool_input")), "id": e.get("tool_use_id", "")}
            r = e.get("tool_response")
            if ev == "PostToolUse":
                act["ok"] = not (isinstance(r, dict) and (r.get("is_error") or r.get("interrupted")))
            try:
                dt = detail(tool, e.get("tool_input"), r, act["phase"])
                if dt:
                    act["detail"] = dt
            except Exception:
                pass
            line = {"who": "claude", "kind": "status", "text": "[[act:" + json.dumps(act, ensure_ascii=False) + "]]", "at": now}
        elif ev == "Stop":
            line = {"who": "claude", "kind": "status", "text": '[[act:{"phase": "idle"}]]', "at": now}
        else:
            return
        with open(d / "talk.jsonl", "a") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    main()
