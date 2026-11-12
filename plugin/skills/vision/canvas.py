#!/usr/bin/env python3
"""The Vision canvas, from Claude's side: a workspace of visuals that stays between turns, and a conversation on it.

    canvas.py --session SID add KEY SCENE.json [--layout row|grid|free] [--no-focus] [--stop N] [--say TEXT]
    canvas.py --session SID code KEY PATH [--depth N] [--title T] [--say TEXT]   # a visual made from real code (code.py)
    canvas.py --session SID refresh KEY               # rebuild a code visual from disk (the panel does this when files change)
    canvas.py --session SID remove KEY | clear
    canvas.py --session SID arrange row|grid|free [--order K1,K2]
    canvas.py --session SID focus KEY [ID ...]        (focus --all: everything)
    canvas.py --session SID point KEY ID [ID ...] [--tag TEXT] [--say TEXT]
    canvas.py --session SID highlight KEY ID [ID ...] [--off]
    canvas.py --session SID patch KEY '{"id": {"tone": 1, "glow": 0.8, "hide": false, "move": [0,1,0]}}'
    canvas.py --session SID stop KEY N | expand KEY ID | collapse KEY ID | select KEY ID
    canvas.py --session SID app KEY '{...}'           # to a living world's program (see.on('claude'))
    canvas.py --session SID say TEXT [--do OPS.json|'[...]'] [--buttons "A|B"]   # a line, with ops played as it is said
    canvas.py --session SID status TEXT               # what I am doing; the next line replaces it
    canvas.py --session SID state                     # what is on the canvas now, and what the user selected
    canvas.py --session SID wait [--timeout S]        # block until the user says something on the canvas; print it
    canvas.py --session SID look [--out DIR] [--js JS]  # what the user sees: the panel replica captured wide and tall (PNGs)

Every command appends one line to sessions/SID/talk.jsonl (the panel plays its ops live) and keeps
sessions/SID/workspace.json (what the canvas holds; the panel loads it on open and writes back the user's changes).
Ops: add remove clear arrange focus point highlight patch stop expand collapse select app view; each may carry
"wait": seconds, to pause before the next one (pointing while talking).
"""
import datetime, json, os, pathlib, re, subprocess, sys, time

HERE = pathlib.Path(__file__).resolve().parent
SEE = pathlib.Path(os.environ.get("SEE_HOME") or pathlib.Path.home() / ".claude" / "vision")  # SEE_HOME: tests, away from the live panel
CANVAS = SEE / "canvas.html"


def stamp():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def home(sid):
    d = SEE / "sessions" / sid
    (d / "visuals").mkdir(parents=True, exist_ok=True)
    return d


def read_ws(d):
    try:
        return json.loads((d / "workspace.json").read_text())
    except (OSError, json.JSONDecodeError):
        return {"layout": "row", "focus": None, "visuals": [], "selection": None}


def write_ws(d, ws):
    ws["updated"] = stamp()
    tmp = d / "workspace.json.tmp"
    tmp.write_text(json.dumps(ws, ensure_ascii=False, indent=1))
    tmp.replace(d / "workspace.json")


def line(d, text="", ops=None, **extra):
    l = {"who": "claude", "text": text, "at": stamp(), **extra}
    if ops:
        l["ops"] = ops
    with open(d / "talk.jsonl", "a") as f:
        f.write(json.dumps(l, ensure_ascii=False) + "\n")


def ensure_page():
    """The panel's page: the canvas packed into one file, rebuilt when its sources change."""
    srcs = list((HERE / "canvas").glob("*.js")) + [HERE / "canvas" / "canvas.html", HERE / "canvas" / "pack.py"]
    newest = max(p.stat().st_mtime for p in srcs if p.exists())
    try:  # where this skill lives, for the panel (it runs canvas.py refresh and pack.py from here)
        (SEE / "skill.json").write_text(json.dumps({"dir": str(HERE)}))
    except OSError:
        pass
    if not CANVAS.exists() or CANVAS.stat().st_mtime < newest:
        sys.path.insert(0, str(HERE / "canvas"))
        from pack import page
        tmp = CANVAS.with_suffix(".tmp")
        tmp.write_text(page(None))
        tmp.replace(CANVAS)


def compile_scene(path):
    sys.path.insert(0, str(HERE))
    from build import prepare
    scene, bad, notes = prepare(path)
    for n in notes:
        print("placement: " + n, file=sys.stderr)
    if bad:
        raise SystemExit("scene refused:\n  " + "\n  ".join(bad))
    return scene


def add_visual(d, key, scene, opts):
    ws = read_ws(d)
    f = d / "visuals" / (re.sub(r"[^A-Za-z0-9._-]+", "-", key) + ".json")
    f.write_text(json.dumps(scene, ensure_ascii=False))
    kind = "living" if scene.get("live") else "tour" if len(scene.get("stops") or scene.get("steps") or []) > 1 else scene.get("kind", "picture")
    entry = {"key": key, "file": str(f), "title": scene.get("title", key), "kind": kind, "stop": opts.get("stop", 0)}
    ws["visuals"] = [v for v in ws["visuals"] if v["key"] != key] + [entry]
    if opts.get("layout"):
        ws["layout"] = opts["layout"]
    if opts.get("focus", True):
        ws["focus"] = key
    write_ws(d, ws)
    op = {"op": "add", "key": key, "file": str(f), "stop": opts.get("stop", 0), "focus": opts.get("focus", True)}
    if opts.get("layout"):
        op["layout"] = opts["layout"]
    return op


def flag(args, name, default=None, has_value=True):
    if name not in args:
        return default
    i = args.index(name)
    if not has_value:
        del args[i]
        return True
    v = args[i + 1]
    del args[i:i + 2]
    return v


def state_text(d):
    ws = read_ws(d)
    out = [f"layout: {ws.get('layout')}   focus: {ws.get('focus')}"]
    for v in ws["visuals"]:
        bits = [f"stop {v.get('stop', 0)}"] if v.get("kind") == "tour" else []
        if v.get("opened"): bits.append("opened " + ", ".join(v["opened"]))
        if v.get("hidden"): bits.append("hidden " + ", ".join(v["hidden"]))
        out.append(f"- {v['key']}: {v.get('title', '')} [{v.get('kind', 'picture')}]" + (" · " + " · ".join(bits) if bits else ""))
    s = ws.get("selection")
    if s:
        out.append(f"selected: {s.get('label') or s.get('id')} in {s.get('key')}" + (f" ({s['file']})" if s.get("file") else ""))
    return "\n".join(out)


def wait_line(d, timeout):
    f = d / "talk.jsonl"
    f.touch()
    pos = f.stat().st_size
    end = time.time() + timeout
    while time.time() < end:
        if f.stat().st_size > pos:
            with open(f) as fh:
                fh.seek(pos)
                chunk = fh.read()
            pos += len(chunk.encode())
            for raw in chunk.splitlines():
                try:
                    l = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if l.get("who") == "you" and not l.get("quiet"):
                    return l
        time.sleep(0.3)
    return None


def main(argv):
    args = list(argv)
    sid = flag(args, "--session") or os.environ.get("SEE_SESSION")
    if not sid or not args:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    d = home(sid)
    ensure_page()
    cmd, rest = args[0], args[1:]
    say = flag(rest, "--say", "")
    if cmd == "add":
        layout, stop = flag(rest, "--layout"), int(flag(rest, "--stop", 0))
        nofocus = flag(rest, "--no-focus", False, False)
        key, path = rest[0], rest[1]
        op = add_visual(d, key, compile_scene(path), {"layout": layout, "stop": stop, "focus": not nofocus})
        line(d, say, [op])
        print(f"added {key}\n" + state_text(d))
    elif cmd == "code":
        depth, title = flag(rest, "--depth", "3"), flag(rest, "--title")
        key, paths = rest[0], rest[1:]
        out = d / "visuals" / f"{key}.scene.json"
        cmdline = [sys.executable, str(HERE / "code.py"), *paths, "--depth", depth, "--out", str(out)] + (["--title", title] if title else [])
        r = subprocess.run(cmdline, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr or r.stdout)
        print(r.stdout.strip())
        op = add_visual(d, key, compile_scene(out), {"focus": True})
        op["watch"] = paths
        ws = read_ws(d)
        for v in ws["visuals"]:
            if v["key"] == key:
                v["code"] = {"paths": [str(pathlib.Path(p).resolve()) for p in paths], "depth": depth, "title": title, "scene": str(out)}
        write_ws(d, ws)
        line(d, say, [op])
        print(state_text(d))
    elif cmd == "refresh":  # a code visual, rebuilt from the files as they are now (the panel calls this when they change)
        key = rest[0]
        ent = next((v for v in read_ws(d)["visuals"] if v["key"] == key and v.get("code")), None)
        if not ent:
            raise SystemExit(f"{key}: not a code visual")
        c = ent["code"]
        cmdline = [sys.executable, str(HERE / "code.py"), *c["paths"], "--depth", str(c.get("depth", 3)), "--out", c["scene"]] + (["--title", c["title"]] if c.get("title") else [])
        r = subprocess.run(cmdline, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr or r.stdout)
        scene = compile_scene(c["scene"])
        pathlib.Path(ent["file"]).write_text(json.dumps(scene, ensure_ascii=False))
        line(d, say, [{"op": "replace", "key": key, "file": ent["file"], "keep": True}], kind="refresh")
        print(r.stdout.strip())
    elif cmd in ("remove", "clear"):
        ws = read_ws(d)
        keys = [v["key"] for v in ws["visuals"]] if cmd == "clear" else rest[:1]
        ws["visuals"] = [v for v in ws["visuals"] if v["key"] not in keys]
        if ws.get("focus") in keys:
            ws["focus"] = None
        write_ws(d, ws)
        line(d, say, [{"op": "clear"}] if cmd == "clear" else [{"op": "remove", "key": rest[0]}])
    elif cmd == "arrange":
        order = flag(rest, "--order")
        ws = read_ws(d); ws["layout"] = rest[0]
        if order:
            o = order.split(","); ws["visuals"].sort(key=lambda v: o.index(v["key"]) if v["key"] in o else 99)
        write_ws(d, ws)
        line(d, say, [{"op": "arrange", "layout": rest[0], **({"order": order.split(",")} if order else {})}])
    elif cmd == "focus":
        if rest and rest[0] == "--all":
            line(d, say, [{"op": "focus", "key": None}])
        else:
            ws = read_ws(d); ws["focus"] = rest[0]; write_ws(d, ws)
            line(d, say, [{"op": "focus", "key": rest[0], "ids": rest[1:]}])
    elif cmd == "point":
        tag = flag(rest, "--tag", "")
        line(d, say, [{"op": "point", "key": rest[0], "ids": rest[1:], "tag": tag}])
    elif cmd == "highlight":
        off = flag(rest, "--off", False, False)
        line(d, say, [{"op": "highlight", "key": rest[0], "ids": rest[1:], "on": not off}])
    elif cmd == "patch":
        line(d, say, [{"op": "patch", "key": rest[0], "set": json.loads(rest[1])}])
    elif cmd in ("stop", "expand", "collapse", "select"):
        op = {"op": cmd, "key": rest[0]}
        if cmd == "stop":
            op["k"] = int(rest[1])
        else:
            op["id"] = rest[1]
        line(d, say, [op])
    elif cmd == "app":
        line(d, say, [{"op": "app", "key": rest[0], "app": json.loads(rest[1])}])
    elif cmd == "say":
        do, buttons = flag(rest, "--do"), flag(rest, "--buttons")
        text = " ".join(rest).replace("\\n", "\n")
        ops = None
        if do:
            ops = json.loads(pathlib.Path(do).read_text() if os.path.exists(do) else do)
            for op in ops:  # a scene file named by an add op is compiled here
                if op.get("op") == "add" and op.get("scene_file"):
                    op.update(add_visual(d, op["key"], compile_scene(op.pop("scene_file")), op))
        if buttons:
            text += "\n[[" + buttons + "]]"
        line(d, text, ops)
    elif cmd == "status":
        line(d, " ".join(rest), kind="status")
    elif cmd == "look":  # the panel as the user sees it, wide (1200x800) and tall (700x900)
        import tempfile
        outdir = pathlib.Path(flag(rest, "--out") or tempfile.mkdtemp(prefix="see-look-"))
        js = flag(rest, "--js")
        outdir.mkdir(parents=True, exist_ok=True)
        page = outdir / "panel.html"
        env = dict(os.environ)
        replica = HERE / "panel.py" if (HERE / "panel.py").exists() else pathlib.Path.home() / ".claude/vision/panel.py"
        subprocess.run([sys.executable, str(replica), sid, str(page)], check=True, env=dict(env, SEE_HOME=str(SEE)), stdout=subprocess.DEVNULL)
        for name, w, h in (("wide", 1200, 800), ("tall", 700, 900)):
            script = [{"wait": 3.5}] + ([{"eval": js}, {"wait": 2}] if js else []) + [{"shot": name}]
            r = subprocess.run(["node", str(HERE / "canvas" / "shoot.mjs"), str(page), str(outdir), str(w), str(h), json.dumps(script)],
                               capture_output=True, text=True, env=dict(env, SEE_SCRATCH=str(outdir)))
            for l in r.stdout.splitlines():
                if not l.startswith("SHOT"):
                    print(l)
            print(outdir / f"{name}.png")
    elif cmd == "state":
        print(state_text(d))
    elif cmd == "wait":
        l = wait_line(d, float(flag(rest, "--timeout", 3600)))
        if not l:
            print("(nothing yet)")
            return 1
        about = f" [about {l['part']} in {l.get('visual')}]" if l.get("part") else ""
        print(f"{l.get('kind', 'chat')}{about}: {l.get('text', '')}")
        if l.get("file"):
            print(f"file: {l['file']}")
        print(state_text(d))
    else:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
