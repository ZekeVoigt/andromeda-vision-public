#!/usr/bin/env python3
"""A visual made from real code: modules -> files -> functions, with the real imports and calls between them.

    code.py PATH [PATH ...] [--depth 2] [--title T] [--out SCENE.json]

Each PATH (a folder or a file) is a module: a solid block whose height follows its lines of code. Double-click
(or zoom into) a module and it opens into its files, standing as buildings on its plinth; a file opens into its
functions. Arcs are real: a file's imports of another file, a function's calls to another. Every part carries
`file: "path:line"`, so the canvas can open it in the editor. Languages: Python (ast), JS/TS (import/require,
functions), Rust (mod/use/fn). Prints a short summary; writes the scene (default: stdout).
"""
import ast, json, math, os, pathlib, re, sys

LANGS = {".py": "py", ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js", ".jsx": "js", ".rs": "rs"}
SKIP = {".git", "node_modules", "target", "__pycache__", ".venv", "venv", "dist", "build", ".next", "vendor"}
MAX_FILES = 160


# ---------------------------------------------------------------- reading code
def functions_py(src):
    out = []
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return out, set()
    imports = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imports |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module:
            imports.add(("." * n.level) + n.module)
        elif isinstance(n, ast.ImportFrom):
            imports |= {"." * n.level + a.name for a in n.names}

    def calls(node):
        c = set()
        for x in ast.walk(node):
            if isinstance(x, ast.Call):
                f = x.func
                c.add(f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else "")
        return c - {""}

    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append({"name": n.name, "line": n.lineno, "end": getattr(n, "end_lineno", n.lineno), "calls": calls(n), "kind": "fn"})
        elif isinstance(n, ast.ClassDef):
            out.append({"name": n.name, "line": n.lineno, "end": getattr(n, "end_lineno", n.lineno), "calls": calls(n), "kind": "class"})
    return out, imports


JS_FN = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|"
                   r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)|"
                   r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)", re.M)
JS_IMP = re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]""", re.M)
RS_FN = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+\"[^\"]*\"\s+)?fn\s+([A-Za-z_]\w*)|"
                   r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)", re.M)
RS_USE = re.compile(r"^\s*(?:pub\s+)?use\s+([\w:]+)", re.M)
RS_MOD = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;", re.M)
CALL = re.compile(r"\b([A-Za-z_$][\w$]*)\s*(?:::<[^>]*>)?\s*\(")


def functions_regex(src, lang):
    pat = JS_FN if lang == "js" else RS_FN
    hits = []
    for m in pat.finditer(src):
        name = next(g for g in m.groups() if g)
        line = src.count("\n", 0, m.start()) + 1
        kind = "class" if (lang == "js" and m.group(3)) or (lang == "rs" and m.group(2)) else "fn"
        hits.append((line, name, kind))
    lines = src.split("\n")
    out = []
    for i, (line, name, kind) in enumerate(hits):  # a function runs until the next one (or a closing brace at its indent)
        end = hits[i + 1][0] - 1 if i + 1 < len(hits) else len(lines)
        body = "\n".join(lines[line - 1:end])
        out.append({"name": name, "line": line, "end": max(line, end), "calls": set(CALL.findall(body)) - {name}, "kind": kind})
    if lang == "js":
        imports = set(JS_IMP.findall(src))
    else:
        imports = {"mod:" + m for m in RS_MOD.findall(src)} | set(RS_USE.findall(src))
    return out, imports


def read_file(p):
    lang = LANGS.get(p.suffix)
    try:
        src = p.read_text(errors="replace")
    except OSError:
        return None
    fns, imps = functions_py(src) if lang == "py" else functions_regex(src, lang)
    return {"path": p, "lang": lang, "loc": sum(1 for l in src.split("\n") if l.strip()), "fns": fns, "imports": imps}


def files_under(root):
    if root.is_file():
        return [root] if root.suffix in LANGS else []
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP and not d.startswith("."))
        out += [pathlib.Path(dp) / f for f in sorted(fns) if pathlib.Path(f).suffix in LANGS]
    return out[:MAX_FILES]


def resolve(imp, frm, by_stem, by_path):
    """An import string -> a known file, or None."""
    lang = LANGS.get(frm.suffix)
    if lang == "js" and imp.startswith("."):
        base = (frm.parent / imp).resolve()
        for cand in [base] + [base.with_suffix(s) for s in (".js", ".ts", ".tsx", ".mjs", ".jsx")] + [base / ("index" + s) for s in (".js", ".ts")]:
            if str(cand) in by_path:
                return by_path[str(cand)]
        return None
    if lang == "rs":
        if imp.startswith("mod:"):
            n = imp[4:]
            for cand in (frm.parent / (n + ".rs"), frm.parent / n / "mod.rs", frm.parent / frm.stem / (n + ".rs")):
                if str(cand.resolve()) in by_path:
                    return by_path[str(cand.resolve())]
            return None
        parts = [x for x in imp.split("::") if x not in ("crate", "self", "super", "")]
        for name in reversed(parts):
            if name in by_stem and len(by_stem[name]) == 1:
                return by_stem[name][0]
        return None
    if lang == "py":
        name = imp.lstrip(".").split(".")
        for k in range(len(name), 0, -1):
            stem = name[k - 1]
            if stem in by_stem:
                c = by_stem[stem]
                return c[0] if len(c) == 1 else next((f for f in c if f["path"].parent == frm.parent), c[0])
        return None
    return None


# ---------------------------------------------------------------- building the scene
def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower() or "x"


def pack(items, gap):
    """Shelf-pack squares (item["w"]) into a near-square block; returns (width, depth) and sets item["x"], item["z"]."""
    items = sorted(items, key=lambda it: -it["w"])
    total = sum((it["w"] + gap) ** 2 for it in items)
    row_w = max(math.sqrt(total) * 1.1, max(it["w"] for it in items) + gap)
    x = z = 0.0
    shelf = 0.0
    W = 0.0
    for it in items:
        if x + it["w"] > row_w and x > 0:
            z += shelf + gap
            x, shelf = 0.0, 0.0
        it["x"], it["z"] = x + it["w"] / 2, z + it["w"] / 2
        x += it["w"] + gap
        shelf = max(shelf, it["w"])
        W = max(W, x - gap)
    D = z + shelf
    for it in items:
        it["x"] -= W / 2
        it["z"] -= D / 2
    return W, D


def arc(a, b, lift, rad, tone=-0.35, idv=None, rel=None):
    mid = [(a[0] + b[0]) / 2, max(a[1], b[1]) + lift, (a[2] + b[2]) / 2]
    n = {"type": "curve", "path": [a, mid, b], "radius": rad, "tone": tone}
    if rel:  # faint until one end is hovered or selected, then lit
        n.update(rel=rel, quiet=True)
    if idv:
        n["id"] = idv
    return n


def rel(p, root):
    try:
        return str(p.relative_to(root))
    except ValueError:
        return str(p)


def build(paths, depth, title):
    roots = [pathlib.Path(p).resolve() for p in paths]
    common = pathlib.Path(os.path.commonpath([str(r if r.is_dir() else r.parent) for r in roots]))
    repo = common
    while repo != repo.parent and not (repo / ".git").exists():
        repo = repo.parent
    if not (repo / ".git").exists():
        repo = common
    mods = []
    for r in roots:
        files = [f for f in (read_file(p) for p in files_under(r)) if f and f["loc"] > 0]
        if files:
            name = f"{r.parent.name}/{r.name}" if r.name in ("src", "lib", "app", "source", "pkg") else r.name
            mods.append({"root": r, "name": name, "files": files, "loc": sum(f["loc"] for f in files)})
    if not mods:
        raise SystemExit("no Python, JS/TS or Rust files under " + ", ".join(paths))
    allf = [f for m in mods for f in m["files"]]
    by_stem, by_path = {}, {}
    for m in mods:
        for f in m["files"]:
            f["mod"] = m
            stem = f["path"].stem if f["path"].stem not in ("mod", "index", "__init__", "lib", "main") else f["path"].parent.name
            by_stem.setdefault(stem, []).append(f)
            by_path[str(f["path"])] = f
    for f in allf:
        f["deps"] = {d["path"] for d in (resolve(i, f["path"], by_stem, by_path) for i in f["imports"] if not i.startswith("mod:")) if d and d is not f}

    # sizes: footprint area follows lines of code, heights a gentle log so small things stay visible
    U = 1.0
    for m in mods:
        m["id"] = "mod-" + slug(m["name"])
        for f in m["files"]:
            f["id"] = f"{m['id']}--{slug(rel(f['path'], m['root']) if m['root'].is_dir() else f['path'].name)}"
            f["w"] = max(0.45, f["loc"] ** 0.4 * 0.12) * U    # bigger file, bigger building: footprint and height both grow
            f["h"] = (0.2 + f["loc"] ** 0.45 * 0.055) * U
        fw, fd = pack(m["files"], 0.38 * U)
        m["fw"], m["fd"] = fw, fd
        m["w"] = max(fw, fd) + 0.5 * U
        m["h"] = (0.5 + math.log10(1 + m["loc"]) * 0.55) * U
    W, D = pack(mods, 1.6 * U) if len(mods) > 1 else (mods[0]["w"], mods[0]["w"])
    if len(mods) == 1:
        mods[0]["x"] = mods[0]["z"] = 0.0

    world = [{"type": "box", "id": "ground", "size": [W + 3 * U, 0.06 * U, D + 3 * U], "at": [0, -0.03 * U, 0], "quiet": True, "round": 0.03}]
    links, nfn = [], 0
    for m in mods:
        mx, mz = m["x"], m["z"]
        top = m["h"]
        closed = [{"type": "box", "size": [m["w"], m["h"], m["w"]], "at": [0, m["h"] / 2, 0], "round": 0.06 * U},
                  {"type": "note", "text": f"{m['name']}\n{len(m['files'])} files · {m['loc']:,} lines", "size": 0.16 * U,
                   "at": [0, m["h"] + 0.01, 0], "rot": [-90, 0, 0], "weight": "bold"}]
        inside = [{"type": "box", "size": [m["w"], 0.12 * U, m["w"]], "at": [0, 0.06 * U, 0], "round": 0.04 * U, "quiet": True}]
        for f in m["files"]:
            fx, fz = f["x"], f["z"]
            name = f["path"].name
            fclosed = [{"type": "box", "size": [f["w"], f["h"], f["w"]], "at": [0, f["h"] / 2, 0], "round": 0.03 * U},
                       {"type": "note", "text": name, "size": min(0.12, f["w"] / max(4, len(name)) * 1.6) * U, "at": [0, f["h"] + 0.005, 0], "rot": [-90, 0, 0]}]
            node = {"type": "group", "id": f["id"], "label": name, "file": f"{rel(f['path'], repo)}:1", "at": [fx, 0.12 * U, fz], "parts": fclosed, "zoomAt": 0.55}
            if depth >= 3 and f["fns"]:
                fins = [{"type": "box", "size": [f["w"], 0.05 * U, f["w"]], "at": [0, 0.025 * U, 0], "quiet": True}]
                cells = []
                for fn in f["fns"]:
                    n = max(1, fn["end"] - fn["line"] + 1)
                    cells.append({"fn": fn, "w": max(0.12, math.sqrt(n) * 0.03) * U, "h": (0.12 + math.log10(1 + n) * 0.3) * U})
                cw, cd = pack(cells, 0.06 * U)
                s = min(1.0, (f["w"] - 0.1 * U) / max(cw, cd, 1e-6))
                idx = {}
                for c in cells:
                    fn = c["fn"]; w = c["w"] * s
                    fid = f"{f['id']}--{slug(fn['name'])}-{fn['line']}"
                    idx[fn["name"]] = (fid, [c["x"] * s, 0.05 * U + c["h"], c["z"] * s])
                    fins.append({"type": "box", "id": fid, "label": fn["name"] + ("()" if fn["kind"] == "fn" else ""), "file": f"{rel(f['path'], repo)}:{fn['line']}",
                                 "size": [w, c["h"], w], "at": [c["x"] * s, 0.05 * U + c["h"] / 2, c["z"] * s], "round": 0.01 * U,
                                 "tone": 0.2 if fn["kind"] == "class" else 0})
                    nfn += 1
                for fn in f["fns"]:  # calls inside the file
                    a = idx[fn["name"]]
                    for cname in sorted(fn["calls"]):
                        if cname in idx and cname != fn["name"]:
                            b = idx[cname]
                            fins.append(arc(a[1], b[1], 0.06 * U + 0.08 * math.dist(a[1], b[1]), 0.006 * U, -0.2, rel=[a[0], b[0]]))
                node["zoom"] = fins
            inside.append(node)
        # imports between files of this module
        for f in m["files"]:
            for d in sorted(f["deps"]):
                g = by_path[str(d)]
                if g["mod"] is m:
                    a, b = [f["x"], 0.12 * U + f["h"], f["z"]], [g["x"], 0.12 * U + g["h"], g["z"]]
                    inside.append(arc(a, b, 0.25 * U + 0.25 * math.dist(a, b), 0.01 * U, -0.6, rel=[f["id"], g["id"]]))
        if len(mods) == 1:  # one module: show its files straight away (a single closed block says nothing)
            world.append({"type": "group", "id": m["id"], "label": m["name"], "file": rel(m["root"], repo), "at": [mx, 0, mz], "parts": inside})
        else:
            world.append({"type": "group", "id": m["id"], "label": m["name"], "file": rel(m["root"], repo), "at": [mx, 0, mz],
                          "parts": closed, "zoom": inside, "zoomAt": 0.62})
        # imports between modules: one arc per pair, as thick as how many imports
    pairs = {}
    for f in allf:
        for d in f["deps"]:
            g = by_path[str(d)]
            if g["mod"] is not f["mod"]:
                k = (f["mod"]["id"], g["mod"]["id"])
                pairs[k] = pairs.get(k, 0) + 1
    byid = {m["id"]: m for m in mods}
    for (a, b), n in sorted(pairs.items()):
        A, B = byid[a], byid[b]
        pa, pb = [A["x"], A["h"], A["z"]], [B["x"], B["h"], B["z"]]
        links.append(arc(pa, pb, 0.6 * U + 0.3 * math.dist(pa, pb), (0.02 + 0.01 * min(6, n)) * U, 0.1, f"dep-{a}-{b}"))
    world += links
    t = title or (" + ".join(m["name"] for m in mods) if len(mods) <= 3 else f"{len(mods)} modules")
    stops = [{"caption": t, "view": {"yaw": 30, "pitch": 34}}]
    scene = {"title": t, "kind": "code", "detail": "max", "world": world, "stops": stops,
             "summary": f"{len(mods)} module(s), {len(allf)} files, {sum(m['loc'] for m in mods):,} lines" + (f", {nfn} functions" if nfn else "") +
                        ". Heights follow lines of code; arcs are real imports and calls."}
    summary = f"{t}: {len(mods)} module(s), {len(allf)} files, {sum(m['loc'] for m in mods):,} lines, {nfn} functions, {len(pairs)} module dependencies"
    return scene, summary


def main(argv):
    args = list(argv)
    def flag(n, d=None):
        if n in args:
            i = args.index(n); v = args[i + 1]; del args[i:i + 2]; return v
        return d
    depth, title, out = int(flag("--depth", "3")), flag("--title"), flag("--out")
    if not args:
        print(__doc__.strip(), file=sys.stderr); return 2
    scene, summary = build(args, depth, title)
    text = json.dumps(scene, ensure_ascii=False)
    if out:
        pathlib.Path(out).write_text(text); print(summary)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
