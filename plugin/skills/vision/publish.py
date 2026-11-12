#!/usr/bin/env python3
"""Publish a /vision scene to this session's Vision canvas (a wrapper over canvas.py, kept for old habits).

    python3 $VISION_SKILL/publish.py SCENE.json --session SID [--say TEXT] [--key KEY] [--look]

Adds (or replaces) the scene as a visual on the session's canvas, keyed by --key or its title. --look also
captures the panel wide and tall and prints the PNG paths (read them before replying).
Without --session it builds a standalone page instead (build.py) and prints its path.
"""
import json, pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent


def main(argv):
    if not argv:
        print(__doc__.strip(), file=sys.stderr); return 2
    args = list(argv)
    def flag(n, has=True):
        if n not in args: return None
        i = args.index(n)
        if not has: del args[i]; return True
        v = args[i + 1]; del args[i:i + 2]; return v
    sid, said, key, look = flag("--session"), flag("--say") or "", flag("--key"), flag("--look", False)
    flag("--form"); flag("--wait")  # old flags: the canvas decides the form now
    scene = pathlib.Path(args[0])
    if not sid:
        return subprocess.call([sys.executable, str(HERE / "build.py"), str(scene), "--no-open"])
    if not key:
        title = json.loads(scene.read_text()).get("title", scene.stem)
        key = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "visual"
    rc = subprocess.call([sys.executable, str(HERE / "canvas.py"), "--session", sid, "add", key, str(scene), "--say", said])
    if rc == 0 and look:
        rc = subprocess.call([sys.executable, str(HERE / "canvas.py"), "--session", sid, "look"])
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
