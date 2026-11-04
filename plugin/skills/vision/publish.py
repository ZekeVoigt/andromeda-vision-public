#!/usr/bin/env python3
"""Publish a /vision scene to the control plane: the pane beside the chat (the see-pane mod).

    python3 $VISION_SKILL/publish.py SCENE.json [--wait SECONDS] [--session SID [--say TEXT] [--form image|steps|spec]]

Builds the page into ~/.claude/vision/, captures every stop's 3D view in headless Chrome, keeps each
picture small enough for the pane, and writes ~/.claude/vision/control/now.json, which the pane
follows. Prints the page's path and the pictures' folder (look at them before replying).

With --session SID the world goes to that session's channel instead (~/.claude/vision/sessions/SID/,
shown live with a talk dock by the see-live VS Code extension), with a line in its talk.jsonl
naming it (and --say TEXT beside it); the shared now.json is left alone. A session page is a bare
canvas (vision's skin.html): --form image (one stop, the default for one), steps (the default for
more) or spec (steps with each stop's points).
"""
import datetime, json, os, pathlib, re, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
SEE = pathlib.Path.home() / ".claude" / "vision"
CONTROL = SEE / "control"

def panel_file(name):
    """The Vision panel's own file (skin.html, dock.html): $VISION_PANEL_DIR, ~/.claude/mods/vision, or the
    installed extension in VS Code, Cursor or Windsurf."""
    import glob, os
    home = pathlib.Path.home()
    dirs = [os.environ.get("VISION_PANEL_DIR", ""), str(home / ".claude/mods/vision")]
    for ed in (".vscode", ".cursor", ".windsurf", ".vscode-insiders"):
        dirs += sorted(glob.glob(str(home / ed / "extensions" / "*.vision-*")), reverse=True)
    for d in dirs:
        if d and (pathlib.Path(d) / name).exists():
            return pathlib.Path(d) / name
    return pathlib.Path("/nonexistent") / name
LIMIT = 92_000  # bytes of JPEG: under the pane's 131072-character SVG once base64'd


def jpeg(png, out, width=920):
    for w in (width, 820, 720, 620):
        for q in (4, 6, 8, 11, 15, 20):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(png), "-vf", f"scale={w}:-2",
                            "-q:v", str(q), str(out)], check=True)
            if out.stat().st_size <= LIMIT:
                probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                        "stream=width,height", "-of", "csv=p=0", str(out)], capture_output=True, text=True)
                pw, ph = (int(v) for v in probe.stdout.strip().split(","))
                return pw, ph
    raise SystemExit(f"{png}: could not get a picture under {LIMIT} bytes")


def main(argv):
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    scene_path = pathlib.Path(argv[0]).resolve()
    wait = argv[argv.index("--wait") + 1] if "--wait" in argv else "9"
    session = argv[argv.index("--session") + 1] if "--session" in argv else None
    said = argv[argv.index("--say") + 1] if "--say" in argv else ""
    form = argv[argv.index("--form") + 1] if "--form" in argv else ""
    if form not in ("", "image", "steps", "spec"):
        raise SystemExit(f"--form {form}: image, steps or spec")
    scene = json.loads(scene_path.read_text())
    stops = scene.get("stops") or scene.get("steps") or []
    slug = re.sub(r"[^a-z0-9]+", "-", str(scene.get("title", "scene")).lower()).strip("-")[:48] or "scene"
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    page = SEE / f"{stamp}-{slug}.html"
    subprocess.run([sys.executable, str(HERE / "build.py"), str(scene_path), "--out", str(page), "--no-open"], check=True,
                   stdout=subprocess.DEVNULL)
    skin = panel_file("skin.html")
    if session and skin.exists():  # a session's pages: pictures first (vision)
        html = page.read_text()
        at = html.rfind("</body>")
        head, _, tail = skin.read_text().replace("{{FORM}}", form or "{{FORM}}").partition("<!--BODY-->")
        html = html[:at] + tail + html[at:]
        h = html.find("</head>")  # the skin's style first, so the viewer measures the real canvas
        page.write_text(html[:h] + head + html[h:])
    shots = CONTROL / stamp
    shots.mkdir(parents=True, exist_ok=True)
    scratch = pathlib.Path(tempfile.mkdtemp(prefix="see-publish-"))
    env = dict(os.environ, VISION_CLIP="1", VISION_SCRATCH=str(scratch))
    # a session's canvas is live: capture only what I check (first and last stop), not every stop
    picks = [1, len(stops)] if session and len(stops) > 1 else [1] if session else list(range(1, len(stops) + 1))
    numbers = ",".join(str(i) for i in sorted(set(picks)))
    subprocess.run(["node", str(HERE / "capture.mjs"), str(page), str(scratch / "stop"), numbers, wait, "1500", "950"],
                   check=True, env=env, stdout=subprocess.DEVNULL)
    out = []
    for i, s in enumerate(stops, 1):
        pic = shots / f"stop-{i}.jpg"
        if not (scratch / f"stop-{i}.png").exists():
            out.append({"caption": s.get("caption", ""), "detail": s.get("detail", ""), "points": s.get("points", []), "image": "", "width": 0, "height": 0})
            continue
        w, h = jpeg(scratch / f"stop-{i}.png", pic)
        out.append({"caption": s.get("caption", ""), "detail": s.get("detail", ""), "points": s.get("points", []),
                    "image": str(pic), "width": w, "height": h})
    shutil.rmtree(scratch, ignore_errors=True)
    now = {"title": scene.get("title", ""), "html": str(page), "updated": stamp, "stops": out}
    home = SEE / "sessions" / session if session else CONTROL
    home.mkdir(parents=True, exist_ok=True)
    tmp = home / "now.json.tmp"
    tmp.write_text(json.dumps(now, ensure_ascii=False))
    tmp.replace(home / "now.json")  # one rename: the pane never reads half a file
    if session:
        sys.path.insert(0, str(HERE))
        from say import say
        say(session, said, world=now["title"], html=str(page))
    print(page)
    print(shots)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
