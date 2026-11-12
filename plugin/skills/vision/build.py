#!/usr/bin/env python3
"""Turn a /vision scene (JSON) into one self-contained HTML page and open it.

    python3 $VISION_SKILL/build.py SCENE.json [--out PAGE.html] [--no-open]

Model files (.obj .stl .glb .gltf) and images (.png .jpg .jpeg .gif .webp .svg) named by a
shape's `src` are read relative to the scene file and embedded, so the page stays one file.
Prints the page's path. A scene that would not draw is refused with every problem listed.
"""
import array
import base64
import datetime
import json
import math
import pathlib
import re
import struct
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = pathlib.Path.home() / ".claude" / "vision"

SHAPES = {"box", "sphere", "dome", "cylinder", "cone", "capsule", "torus", "tube", "arrow", "curve",
          "extrude", "lathe", "surface", "text", "glyph", "image", "mesh", "note", "link"}
CONTAINERS = {"group", "repeat", "mirror", "stack", "grid"}
NUMS = {"radius", "radius2", "height", "tube", "tone", "round", "arc", "depth", "relief",
        "contrast", "resolution", "count", "zoomAt", "cols", "width", "bend"}
VECS = {"size", "at", "rot", "from", "to", "offset", "turn"}
OTHER = {"rest", "type", "label", "scale", "open", "smooth", "closed", "points", "holes", "profile", "path",
         "x", "y", "z", "text", "char", "font", "src", "mask", "parts", "part", "axis", "twoSided",
         "animate", "highlight", "style", "id", "zoom", "gap", "align", "weight", "head", "quiet",
         "file", "expand", "rel"}  # rel: [id, id] a relation (an import, a call): lit when either end is hovered or selected  # file: "path[:line]" a part opens in the editor; expand: like zoom, opened by a double-click
KNOWN = NUMS | VECS | OTHER
NEEDS = {"tube": ("from", "to"), "arrow": ("from", "to"), "curve": ("path",), "extrude": ("points",),
         "lathe": ("profile",), "surface": ("x", "y", "z"), "text": ("text",), "glyph": ("char",),
         "image": ("src",), "mesh": ("src",), "repeat": ("count",), "note": ("text",), "link": ("from", "to")}
VIEWS = {"three-quarter", "front", "side", "back", "top", "below"}
MAX_PARTS = 1500          # one step's object
MAX_WORLD_PARTS = 60000   # a whole world, every zoom level counted
MAX_TRIS = 300_000
MAX_BYTES = 14_000_000
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
               ".webp": "image/webp", ".svg": "image/svg+xml"}
MODEL_TYPES = {".obj", ".stl", ".glb", ".gltf"}


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def pts2(v, n=2):
    return isinstance(v, list) and len(v) >= 2 and all(
        isinstance(q, list) and len(q) == n and all(is_num(x) for x in q) for q in v)


def check_node(p, at, out, count, ids=None, refs=None):
    if not isinstance(p, dict):
        out.append(f"{at}: must be an object")
        return 0
    t = p.get("type")
    if t not in SHAPES | CONTAINERS:
        out.append(f"{at}: `type` {t!r} is not one of {sorted(SHAPES | CONTAINERS)}")
        return 0
    for k in NEEDS.get(t, ()):
        if k not in p:
            out.append(f"{at}: a {t} needs `{k}`")
    for k, v in p.items():
        if (k == "radius" and t == "curve" and isinstance(v, list)) or (
                k == "size" and t in ("text", "glyph", "image", "mesh", "note")):
            continue  # a curve's radius may taper per point; these sizes are one number, checked below
        if k not in KNOWN:
            out.append(f"{at}: unknown field `{k}`")
        elif k in NUMS and not is_num(v):
            out.append(f"{at}: `{k}` must be a number")
        elif k in ("from", "to") and t == "link":
            if not isinstance(v, str) or not v:
                out.append(f"{at}: a link's `{k}` is the `id` of a node")
            elif refs is not None:
                refs.append((at, k, v))
        elif k in VECS and not (isinstance(v, list) and len(v) == 3 and all(is_num(x) for x in v)):
            out.append(f"{at}: `{k}` must be [x, y, z]")
    for k in ("radius", "height", "tube", "depth", "count"):
        if is_num(p.get(k)) and p[k] <= 0:
            out.append(f"{at}: `{k}` must be > 0")
    sc = p.get("scale")
    if sc is not None and not (is_num(sc) and sc != 0) and not (
            isinstance(sc, list) and len(sc) == 3 and all(is_num(x) and x != 0 for x in sc)):
        out.append(f"{at}: `scale` must be a non-zero number or [x, y, z]")
    if isinstance(p.get("size"), list) and t == "box" and any(is_num(x) and x <= 0 for x in p["size"]):
        out.append(f"{at}: every `size` must be > 0")
    if t in ("text", "glyph", "image", "mesh", "note") and "size" in p and not is_num(p["size"]):
        out.append(f"{at}: a {t}'s `size` is one number (its height, or for a mesh its largest side)")
    if t in ("tube", "arrow") and p.get("from") == p.get("to"):
        out.append(f"{at}: `from` and `to` are the same point")
    if t == "curve":
        if not pts2(p.get("path"), 3):
            out.append(f"{at}: `path` must be a list of at least 2 [x, y, z] points")
        rad = p.get("radius")
        if isinstance(rad, list) and not (rad and all(is_num(x) and x > 0 for x in rad)):
            out.append(f"{at}: `radius` as a list must be positive numbers, one per path point")
    if t == "extrude":
        if not (pts2(p.get("points")) and len(p["points"]) >= 3):
            out.append(f"{at}: `points` must be at least 3 [x, y] points")
        for h in p.get("holes", []) or []:
            if not (pts2(h) and len(h) >= 3):
                out.append(f"{at}: each hole must be at least 3 [x, y] points")
    if t == "lathe" and not (pts2(p.get("profile")) and all(q[0] >= 0 for q in p["profile"])):
        out.append(f"{at}: `profile` must be at least 2 [radius, y] points with radius >= 0")
    if t == "surface":
        for k in "xyz":
            if not isinstance(p.get(k), str) or not p[k].strip():
                out.append(f"{at}: `{k}` must be an expression in u and v, as a string")
            elif re.search(r"[;{}]|=>|\bfunction\b|\bdocument\b|\bwindow\b|\bfetch\b|\bimport\b", p[k]):
                out.append(f"{at}: `{k}` must be one math expression (Math functions, u, v, numbers)")
    a = p.get("animate")
    if a is not None:
        if not isinstance(a, dict) or a.get("type") not in ("glow", "pulse", "flow"):
            out.append(f"{at}: `animate` must be {{\"type\": \"glow\" | \"pulse\" | \"flow\", ...}}")
        else:
            for k, v in a.items():
                if k not in ("type", "period", "delay", "strength", "reverse"):
                    out.append(f"{at}: `animate` has an unknown field `{k}`")
                elif k in ("period", "delay", "strength") and not is_num(v):
                    out.append(f"{at}: `animate.{k}` must be a number")
    if "style" in p and p["style"] not in ("line", "solid"):
        out.append(f"{at}: `style` must be \"line\" or \"solid\"")
    if "quiet" in p and not isinstance(p["quiet"], bool):
        out.append(f"{at}: `quiet` must be true or false")
    if "highlight" in p and not isinstance(p["highlight"], bool):
        out.append(f"{at}: `highlight` must be true or false")
    if t in ("mirror", "stack") and p.get("axis", "x") not in ("x", "y", "z"):
        out.append(f"{at}: `axis` must be x, y or z")
    if "id" in p:
        if not isinstance(p["id"], str) or not p["id"]:
            out.append(f"{at}: `id` must be a non-empty string")
        elif ids is not None:
            if p["id"] in ids:
                out.append(f"{at}: `id` {p['id']!r} is used twice (also at {ids[p['id']]}); ids must be unique")
            else:
                ids[p["id"]] = at
    g = p.get("gap")
    if g is not None and not (is_num(g) or (isinstance(g, list) and len(g) == 2 and all(is_num(x) for x in g))):
        out.append(f"{at}: `gap` must be a number or [x, y]")
    if "align" in p and p["align"] not in (("left", "center") if t == "note" else ("start", "center", "end")):
        out.append(f"{at}: `align` must be " + ('"left" or "center"' if t == "note" else '"start", "center" or "end"'))
    if t == "note" and "weight" in p and p["weight"] not in ("bold", "normal"):
        out.append(f"{at}: `weight` must be \"bold\" or \"normal\"")
    if t == "note" and "text" in p and not str(p["text"]).strip():
        out.append(f"{at}: a note's `text` is empty")
    if t == "link" and p.get("from") == p.get("to") and p.get("from"):
        out.append(f"{at}: a link's `from` and `to` are the same id")
    sub = lambda q, i, where: check_node(q, f"{where} > {q.get('type', '?') if isinstance(q, dict) else '?'} {i}", out, count, ids, refs)
    zoomed = 0
    if "zoom" in p:
        z = p["zoom"]
        if not isinstance(z, list) or not z:
            out.append(f"{at}: `zoom` must be a non-empty list of nodes (shown instead of this one up close)")
        else:
            if t in ("note", "link"):
                out.append(f"{at}: a {t} cannot have `zoom`")
            zoomed = sum(sub(q, i, at + " zoom") for i, q in enumerate(z, 1))
    if t in CONTAINERS:
        kids = p.get("parts") or ([p["part"]] if isinstance(p.get("part"), dict) else [])
        if not kids and not zoomed:
            out.append(f"{at}: a {t} needs `parts` (a list) or `part`")
        times = {"group": 1, "mirror": 2, "stack": 1, "grid": 1}.get(t, max(1, min(200, int(p.get("count", 1) or 1))))
        return sum(sub(q, i, at) for i, q in enumerate(kids, 1)) * times + zoomed
    return 1 + zoomed


def check_view(v, where, out):
    if v is not None and not (isinstance(v, str) and v in VIEWS) and not (
            isinstance(v, dict) and set(v) <= {"yaw", "pitch"} and all(is_num(x) for x in v.values())):
        out.append(f"{where}: `view` must be one of {sorted(VIEWS)} or {{\"yaw\": deg, \"pitch\": deg}}")


def check_anim(a, where, out):
    if not isinstance(a, dict) or a.get("type") not in ("glow", "pulse", "flow"):
        out.append(f"{where} must be {{\"type\": \"glow\" | \"pulse\" | \"flow\", ...}}")
        return
    for k, v in a.items():
        if k not in ("type", "period", "delay", "strength", "reverse"):
            out.append(f"{where} has an unknown field `{k}`")
        elif k in ("period", "delay", "strength") and not is_num(v):
            out.append(f"{where}.{k} must be a number")


def problems(scene):
    out = []
    if not isinstance(scene, dict):
        return ["the scene must be a JSON object"]
    if scene.get("detail", "normal") not in ("normal", "high", "max", "ultra"):
        out.append("`detail` must be \"normal\", \"high\", \"max\" or \"ultra\" (one object, finest dots)")
    world = scene.get("world")
    ids, refs = {}, []
    if world is not None:
        if "steps" in scene:
            out.append("a world scene has `stops`, not `steps`")
        if not isinstance(world, list) or not world:
            return out + ["`world` must be a non-empty list of shapes"]
        n = sum(check_node(p, f"world, shape {j}", out, None, ids, refs) for j, p in enumerate(world, 1))
        if n > MAX_WORLD_PARTS:
            out.append(f"world: {n} shapes once groups/repeats/zooms expand; keep it under {MAX_WORLD_PARTS}")
        check_view(scene.get("view"), "world", out)
        steps, kind = scene.get("stops"), "stop"
        if not isinstance(steps, list) or not 1 <= len(steps) <= 30:
            return out + ["`stops` must be a list of 1 to 30 stops"]
    else:
        steps, kind = scene.get("steps"), "step"
        if not isinstance(steps, list) or not 1 <= len(steps) <= 20:
            return out + ["`steps` must be a list of 1 to 20 steps (or give a `world` and `stops`)"]
    for at, k, v in refs:
        if v not in ids:
            out.append(f"{at}: link `{k}` names {v!r}, which no node in the world has as its `id`")
    for i, step in enumerate(steps, 1):
        where = f"{kind} {i}"
        if not isinstance(step, dict):
            out.append(f"{where}: must be an object")
            continue
        known = {"caption", "detail", "points", "view", "spin", "shape", "focus", "highlight", "hide", "animate", "dim", "labels"}
        for k in step:
            if k not in known:
                out.append(f"{where}: unknown field `{k}`")
        if not str(step.get("caption", "")).strip():
            out.append(f"{where}: needs a `caption`")
        pts = step.get("points")
        if pts is not None and not (isinstance(pts, list) and all(isinstance(x, str) for x in pts)):
            out.append(f"{where}: `points` must be a list of short strings")
        check_view(step.get("view"), where, out)
        shape = step.get("shape")
        own = {}
        if shape is not None or world is None:
            if not isinstance(shape, list) or not shape:
                out.append(f"{where}: `shape` must be a non-empty list of shapes")
                continue
            srefs = []
            n = sum(check_node(p, f"{where}, shape {j}", out, None, own, srefs) for j, p in enumerate(shape, 1))
            if n > MAX_PARTS:
                out.append(f"{where}: {n} shapes once groups/repeats/mirrors expand; keep it under {MAX_PARTS}")
            for at, k, v in srefs:
                if v not in own:
                    out.append(f"{at}: link `{k}` names {v!r}, which no node in this step has as its `id`")
        names = own if shape is not None else ids
        def known_id(v, what):
            if not isinstance(v, str) or v not in names:
                out.append(f"{where}: `{what}` names {v!r}, which no node {'in this step' if shape is not None else 'in the world'} has as its `id`")
        f = step.get("focus")
        if isinstance(f, dict):
            if not (set(f) <= {"at", "radius"} and isinstance(f.get("at"), list) and len(f["at"]) == 3
                    and all(is_num(x) for x in f["at"]) and is_num(f.get("radius", 1)) and f.get("radius", 1) > 0):
                out.append(f"{where}: `focus` as a region must be {{\"at\": [x, y, z], \"radius\": r}}")
        elif f is not None:
            for v in f if isinstance(f, list) else [f]:
                known_id(v, "focus")
        for key in ("highlight", "hide", "labels"):
            v = step.get(key)
            if v is not None:
                for x in v if isinstance(v, list) else [v]:
                    known_id(x, key)
        a = step.get("animate")
        if a is not None:
            if not isinstance(a, dict):
                out.append(f"{where}: `animate` must map ids to animations: {{\"id\": {{\"type\": \"flow\"}}}}")
            else:
                for k, v in a.items():
                    known_id(k, "animate")
                    check_anim(v, f"{where}: `animate.{k}`", out)
        if "dim" in step and not isinstance(step["dim"], bool):
            out.append(f"{where}: `dim` must be true or false")
        if "spin" in step and not isinstance(step["spin"], bool):
            out.append(f"{where}: `spin` must be true or false")
    return out


# ---------- model files -> one welded, normalized triangle list ----------
def read_obj(path):
    verts, tris = [], []
    for line in path.read_text(errors="replace").splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v" and len(parts) >= 4:
            verts.append(tuple(float(x) for x in parts[1:4]))
        elif parts[0] == "f" and len(parts) >= 4:
            idx = []
            for tok in parts[1:]:
                k = int(tok.split("/")[0])
                idx.append(k - 1 if k > 0 else len(verts) + k)
            for j in range(1, len(idx) - 1):
                tris.append((idx[0], idx[j], idx[j + 1]))
    return verts, tris


def read_stl(path):
    data = path.read_bytes()
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if len(data) == 84 + 50 * n:
            verts = []
            for t in range(n):
                v = struct.unpack_from("<9f", data, 84 + 50 * t + 12)
                verts += [v[0:3], v[3:6], v[6:9]]
            return verts, [(3 * t, 3 * t + 1, 3 * t + 2) for t in range(n)]
    verts = [tuple(float(x) for x in m.groups())
             for m in re.finditer(rb"vertex\s+(\S+)\s+(\S+)\s+(\S+)", data)]
    return verts, [(i, i + 1, i + 2) for i in range(0, len(verts) - 2, 3)]


def _qmat(q):
    x, y, z, w = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def _node_matrix(node):
    if "matrix" in node:
        m = node["matrix"]  # column-major
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]], [m[2], m[6], m[10], m[14]], [0, 0, 0, 1]]
    t = node.get("translation", [0, 0, 0])
    r = _qmat(node.get("rotation", [0, 0, 0, 1]))
    s = node.get("scale", [1, 1, 1])
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def read_gltf(path):
    raw = path.read_bytes()
    bins = []
    if raw[:4] == b"glTF":
        off, doc = 12, None
        while off < len(raw):
            ln, kind = struct.unpack_from("<II", raw, off)
            chunk = raw[off + 8: off + 8 + ln]
            if kind == 0x4E4F534A:
                doc = json.loads(chunk)
            elif kind == 0x004E4942:
                bins.append(chunk)
            off += 8 + ln
    else:
        doc = json.loads(raw)
    buffers = []
    for i, b in enumerate(doc.get("buffers", [])):
        uri = b.get("uri")
        if uri is None:
            buffers.append(bins[0] if bins else b"")
        elif uri.startswith("data:"):
            buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            buffers.append((path.parent / uri).read_bytes())
    for ext in doc.get("extensionsRequired", []):
        if ext in ("KHR_draco_mesh_compression", "EXT_meshopt_compression"):
            raise ValueError(f"{path.name} is compressed ({ext}); decompress it first, e.g. "
                             f"`npx -y @gltf-transform/cli copy {path.name} plain.glb`")
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}

    def accessor(i):
        a = doc["accessors"][i]
        bv = doc["bufferViews"][a["bufferView"]]
        buf = buffers[bv["buffer"]]
        f, w, n = fmt[a["componentType"]], width[a["type"]], a["count"]
        size = struct.calcsize(f)
        stride = bv.get("byteStride") or size * w
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        out = [struct.unpack_from("<" + f * w, buf, base + k * stride) for k in range(n)]
        if a.get("normalized") and f != "f":
            top = float((1 << (8 * size - (1 if f.islower() else 0))) - 1)
            out = [tuple(max(-1.0, x / top) for x in v) for v in out]
        return out

    verts, tris = [], []
    uvs, cols, tmat, tpart, parts = [], [], [], [], []
    has_uv = has_col = False

    def visit(ni, parent):
        node = doc["nodes"][ni]
        m = _mat_mul(parent, _node_matrix(node))
        if "mesh" in node:
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) not in (4, 5, 6) or "POSITION" not in prim["attributes"]:
                    continue
                nonlocal has_uv, has_col
                pos = accessor(prim["attributes"]["POSITION"])
                base = len(verts)
                for v in pos:
                    verts.append(tuple(m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] + m[i][3] for i in range(3)))
                at = prim["attributes"]
                if "TEXCOORD_0" in at:
                    uvs.extend(tuple(t[:2]) for t in accessor(at["TEXCOORD_0"])); has_uv = True
                else:
                    uvs.extend([(0.0, 0.0)] * len(pos))
                if "COLOR_0" in at:
                    raw_c = accessor(at["COLOR_0"])
                    if raw_c and max(max(c[:3]) for c in raw_c) > 1.5:  # unnormalized integers
                        top = 65535.0 if max(max(c[:3]) for c in raw_c) > 255 else 255.0
                        raw_c = [tuple(x / top for x in c) for c in raw_c]
                    cols.extend(tuple(c[:3]) for c in raw_c); has_col = True
                else:
                    cols.extend([(1.0, 1.0, 1.0)] * len(pos))
                name = node.get("name") or doc["meshes"][node["mesh"]].get("name") or f"part {len(parts) + 1}"
                if name not in parts:
                    parts.append(name)
                pi, mi = parts.index(name), prim.get("material", -1)
                t0 = len(tris)
                idx = [k[0] for k in accessor(prim["indices"])] if "indices" in prim else list(range(len(pos)))
                mode = prim.get("mode", 4)
                if mode == 4:
                    tris.extend((base + idx[k], base + idx[k + 1], base + idx[k + 2]) for k in range(0, len(idx) - 2, 3))
                elif mode == 5:
                    tris.extend((base + idx[k], base + idx[k + 1 + k % 2], base + idx[k + 2 - k % 2]) for k in range(len(idx) - 2))
                else:
                    tris.extend((base + idx[0], base + idx[k], base + idx[k + 1]) for k in range(1, len(idx) - 1))
                tmat.extend([mi] * (len(tris) - t0)); tpart.extend([pi] * (len(tris) - t0))
        for c in node.get("children", []):
            visit(c, m)

    eye = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    scenes = doc.get("scenes") or [{"nodes": list(range(len(doc.get("nodes", []))))}]
    for ni in scenes[doc.get("scene", 0)].get("nodes", []):
        visit(ni, eye)
    # materials: base color factor and texture (decoded and shrunk by ffmpeg, embedded as raw rgb)
    mats, tex, tex_of = [], [], {}
    used = sorted({m for m in tmat if m >= 0})
    textured = [m for m in used if (doc["materials"][m].get("pbrMetallicRoughness", {}).get("baseColorTexture"))]
    side = 512 if len(textured) <= 2 else 256 if len(textured) <= 6 else 128
    for mi, mat in enumerate(doc.get("materials", [])):
        pbr = mat.get("pbrMetallicRoughness", {})
        entry = {"f": [round(x, 4) for x in pbr.get("baseColorFactor", [1, 1, 1, 1])[:3]]}
        bt = pbr.get("baseColorTexture")
        if bt and mi in used and has_uv:
            try:
                img = doc["textures"][bt["index"]].get("source")
                if img is None:
                    for ext in doc["textures"][bt["index"]].get("extensions", {}).values():
                        img = ext.get("source", img)
                if img not in tex_of:
                    im = doc["images"][img]
                    if "bufferView" in im:
                        bv = doc["bufferViews"][im["bufferView"]]
                        data = buffers[bv["buffer"]][bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
                    elif im.get("uri", "").startswith("data:"):
                        data = base64.b64decode(im["uri"].split(",", 1)[1])
                    else:
                        data = (path.parent / im["uri"]).read_bytes()
                    rgb = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-vf", f"scale={side}:{side}",
                                          "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], input=data, capture_output=True, check=True).stdout
                    if len(rgb) != side * side * 3:
                        raise ValueError("texture did not decode")
                    tex_of[img] = len(tex)
                    tex.append({"w": side, "h": side, "d": base64.b64encode(rgb).decode()})
                entry["t"] = tex_of[img]
            except Exception:
                pass  # a texture that won't decode: the factor alone
        mats.append(entry)
    extra = {"uv": uvs if has_uv else None, "col": cols if has_col else None, "tmat": tmat, "tpart": tpart,
             "parts": parts, "mats": mats, "tex": tex}
    return verts, tris, extra


def load_model(path):
    ext = path.suffix.lower()
    got = {".obj": read_obj, ".stl": read_stl}.get(ext, read_gltf)(path)
    verts, tris = got[0], got[1]
    extra = got[2] if len(got) > 2 else {}
    if not tris:
        raise ValueError(f"{path.name} has no triangles")
    if len(tris) > MAX_TRIS:
        raise ValueError(f"{path.name} has {len(tris):,} triangles; simplify it under {MAX_TRIS:,} first "
                         f"(e.g. `npx -y @gltf-transform/cli simplify in.glb out.glb --ratio 0.2`)")
    lo = [min(v[a] for v in verts) for a in range(3)]
    hi = [max(v[a] for v in verts) for a in range(3)]
    c = [(lo[a] + hi[a]) / 2 for a in range(3)]
    s = 1.0 / (max(hi[a] - lo[a] for a in range(3)) or 1.0)
    weld, out_v, remap = {}, array.array("f"), []
    for v in verts:  # shared corners make smooth shading possible
        key = tuple(round((v[a] - c[a]) * s, 5) for a in range(3))
        if key not in weld:
            weld[key] = len(weld)
            out_v.extend(key)
        remap.append(weld[key])
    out_f = array.array("I")
    uv_c, vc_c, tm_c, tp_c = array.array("f"), array.array("B"), array.array("H"), array.array("H")
    UV, COL, TM, TP = extra.get("uv"), extra.get("col"), extra.get("tmat"), extra.get("tpart")
    for k, t in enumerate(tris):
        a, b, d = remap[t[0]], remap[t[1]], remap[t[2]]
        if a != b and b != d and a != d:
            out_f.extend((a, b, d))
            if UV:  # per corner, so texture seams survive the weld
                for c in t: uv_c.extend(UV[c])
            if COL:
                for c in t: vc_c.extend(max(0, min(255, int(round(x * 255)))) for x in COL[c])
            if TM: tm_c.append(max(0, TM[k]) if TM[k] >= 0 and extra.get("mats") else 65535)
            if TP: tp_c.append(TP[k])
    if sys.byteorder != "little":
        out_v.byteswap()
        out_f.byteswap()
    dims = [round((hi[a] - lo[a]) * s, 5) for a in range(3)]
    b64 = lambda arr: base64.b64encode(arr.tobytes()).decode()
    out = {"kind": "mesh", "dims": dims, "v": b64(out_v), "f": b64(out_f), "tris": len(out_f) // 3}
    mats = extra.get("mats") or []
    if mats and len(tm_c) and any(m.get("t") is not None or m["f"] != [1, 1, 1] for m in mats):
        out.update(tm=b64(tm_c), mats=mats, tex=extra.get("tex") or [])
        if len(uv_c): out["uv"] = b64(uv_c)
    if len(vc_c): out["vc"] = b64(vc_c)
    if len(tp_c) and len(extra.get("parts") or []) > 1:
        out.update(tp=b64(tp_c), parts=extra["parts"])
    return out


def embed_assets(scene, base):
    assets, errs, seen = {}, [], {}

    def walk(nodes, where):
        for i, p in enumerate(nodes or [], 1):
            if not isinstance(p, dict):
                continue
            here = f"{where}, shape {i}"
            if p.get("type") in ("mesh", "image") and isinstance(p.get("src"), str):
                src = pathlib.Path(p["src"]).expanduser()
                src = src if src.is_absolute() else base / src
                if str(src) not in seen:
                    ext = src.suffix.lower()
                    try:
                        if not src.is_file():
                            raise ValueError(f"no such file: {src}")
                        if p["type"] == "mesh":
                            if ext not in MODEL_TYPES:
                                raise ValueError(f"a mesh must be one of {sorted(MODEL_TYPES)}, not {ext!r}")
                            a = load_model(src)
                        else:
                            if ext not in IMAGE_TYPES:
                                raise ValueError(f"an image must be one of {sorted(IMAGE_TYPES)}, not {ext!r}")
                            a = {"kind": "image", "data": f"data:{IMAGE_TYPES[ext]};base64,"
                                 + base64.b64encode(src.read_bytes()).decode()}
                    except Exception as e:  # report every bad file, not just the first
                        errs.append(f"{here}: {e}")
                        seen[str(src)] = None
                        continue
                    key = f"a{len(assets)}"
                    a["id"] = key
                    assets[key] = a
                    seen[str(src)] = key
                if seen[str(src)]:
                    p["src"] = seen[str(src)]
                    if p.pop("rest", True) and p["type"] == "mesh":  # sits on `at` (its base), unless "rest": false
                        at = list(p.get("at", [0, 0, 0]))
                        sz = p.get("size", 1)
                        at[1] += assets[p["src"]]["dims"][1] * sz / 2
                        p["at"] = at
            walk(p.get("parts"), here)
            walk(p.get("zoom"), here)
            if isinstance(p.get("part"), dict):
                walk([p["part"]], here)

    if isinstance(scene.get("world"), list):
        walk(scene["world"], "world")
    for i, step in enumerate(scene.get("steps") or scene.get("stops") or [], 1):
        walk(step.get("shape"), f"step {i}")
    if assets:
        scene["assets"] = assets
    return errs


def _footprint(p, assets):
    """A top-level node's box in x-z (and its height), for the models and plain solids we can size."""
    at = list(p.get("at", [0, 0, 0])) + [0, 0, 0]
    sc = p.get("scale", 1)
    sc = sc if isinstance(sc, list) else [sc, sc, sc]
    t = p.get("type")
    if t == "mesh" and isinstance(p.get("src"), str) and p["src"] in assets:
        d = [x * p.get("size", 1) for x in assets[p["src"]]["dims"]]
    elif t == "box":
        d = list(p.get("size", [1, 1, 1]))
    elif t in ("cylinder", "sphere", "dome", "cone"):
        r = p.get("radius", 0.5); d = [2 * r, p.get("height", 2 * r), 2 * r]
    else:
        return None
    d = [d[i] * sc[i] for i in range(3)]
    yaw = abs((p.get("rot", [0, 0, 0]) + [0, 0, 0])[1]) % 180
    if 45 < yaw < 135:
        d[0], d[2] = d[2], d[0]
    return {"x": at[0], "z": at[2], "y": at[1], "w": d[0], "h": d[1], "d": d[2]}


def arrange(scene):
    """Placement on its own: models that overlap on the ground are pushed apart (what moved is
    reported), and a straight link that runs through a third object is reported, to be routed."""
    world, assets = scene.get("world"), scene.get("assets", {})
    if not isinstance(world, list):
        return []
    notes, items = [], []
    for p in world:
        if isinstance(p, dict) and p.get("type") == "mesh":
            f = _footprint(p, assets)
            if f:
                items.append((p, f))
    for _ in range(40):  # relax: each overlapping pair moves apart along the line between them
        moved = False
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (pa, a), (pb, b) = items[i], items[j]
                if abs(a["y"] - b["y"]) > max(a["h"], b["h"]):  # one is above the other (on a desk)
                    continue
                ox = (a["w"] + b["w"]) / 2 * 1.08 - abs(a["x"] - b["x"])
                oz = (a["d"] + b["d"]) / 2 * 1.08 - abs(a["z"] - b["z"])
                if ox > 0 and oz > 0:
                    if ox < oz:
                        s_ = 1 if a["x"] >= b["x"] else -1; a["x"] += s_ * ox / 2; b["x"] -= s_ * ox / 2
                    else:
                        s_ = 1 if a["z"] >= b["z"] else -1; a["z"] += s_ * oz / 2; b["z"] -= s_ * oz / 2
                    moved = True
        if not moved:
            break
    for p, f in items:
        at = list(p.get("at", [0, 0, 0])) + [0, 0, 0]
        if abs(at[0] - f["x"]) > 1e-3 or abs(at[2] - f["z"]) > 1e-3:
            notes.append(f"moved {p.get('id', p.get('type'))} to x={f['x']:.2f}, z={f['z']:.2f} so it no longer overlaps")
            p["at"] = [round(f["x"], 4), at[1], round(f["z"], 4)]
    # links through things
    boxes = {}
    for p in world:
        if isinstance(p, dict) and p.get("id") is not None:
            f = _footprint(p, assets)
            if f:
                boxes[str(p["id"])] = f
    for p in world:
        if not (isinstance(p, dict) and p.get("type") == "link" and not p.get("bend")):
            continue
        a, b = boxes.get(str(p.get("from"))), boxes.get(str(p.get("to")))
        if not a or not b:
            continue
        for k, o in boxes.items():
            if k in (str(p["from"]), str(p["to"])):
                continue
            hit = any(abs(a["x"] + (b["x"] - a["x"]) * t - o["x"]) < o["w"] / 2 and abs(a["z"] + (b["z"] - a["z"]) * t - o["z"]) < o["d"] / 2
                      for t in [i / 20 for i in range(1, 20)])
            if hit:
                notes.append(f"link {p.get('id', '')} {p['from']} -> {p['to']} runs through {k}: give it a `bend`, or route a curve around it")
                break
    return notes


def live_problems(scene, base):
    """A live world's program: `live` is JS source, or {"file": "x.js"} (inlined here). Syntax-checked with node."""
    live = scene.get("live")
    if live is None:
        return []
    if isinstance(live, dict) and isinstance(live.get("file"), str):
        f = (base / live["file"]).expanduser()
        try:
            live = scene["live"] = f.read_text()
        except OSError as e:
            return [f"live: cannot read {f}: {e}"]
    if not isinstance(live, str) or not live.strip():
        return ["`live` must be the program's JS source, or {\"file\": \"program.js\"}"]
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t:
        t.write("(function (see) {\n" + live + "\n});\n")
    r = subprocess.run(["node", "--check", t.name], capture_output=True, text=True)
    pathlib.Path(t.name).unlink(missing_ok=True)
    if r.returncode != 0:
        msg = (r.stderr or r.stdout).strip().splitlines()
        return ["live: the program does not parse:\n    " + "\n    ".join(msg[:8])]
    return []


def prepare(src):
    """A scene file -> (scene ready for the canvas: checked, models/pictures embedded, live program inlined), problems, placement notes."""
    src = pathlib.Path(src)
    try:
        scene = json.loads(src.read_text())
    except (OSError, json.JSONDecodeError) as e:
        return None, [f"cannot read {src}: {e}"], []
    def alias(nodes):  # `expand` is `zoom` by another name: the insides a double-click opens
        for n in nodes or []:
            if isinstance(n, dict):
                if "expand" in n and "zoom" not in n:
                    n["zoom"] = n.pop("expand")
                alias(n.get("parts")); alias(n.get("zoom"))
                if isinstance(n.get("part"), dict): alias([n["part"]])
    alias(scene.get("world")) if isinstance(scene, dict) else None
    for st in (scene.get("steps") or []) if isinstance(scene, dict) else []:
        if isinstance(st, dict): alias(st.get("shape"))
    bad = problems(scene) + live_problems(scene, src.resolve().parent)
    if not bad:
        bad = embed_assets(scene, src.resolve().parent)
    notes = arrange(scene) if not bad else []
    return scene, bad, notes


def main(argv):
    args, i = [], 0
    while i < len(argv):
        if argv[i] == "--out":
            i += 2
            continue
        if not argv[i].startswith("--"):
            args.append(argv[i])
        i += 1
    if not args:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src = pathlib.Path(args[0])
    scene, bad, notes = prepare(src)
    for note in notes:
        print("placement: " + note, file=sys.stderr)
    if bad:
        print("scene refused:\n  " + "\n  ".join(bad), file=sys.stderr)
        return 1

    if "--out" in argv:
        out = pathlib.Path(argv[argv.index("--out") + 1])
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", str(scene.get("title", "scene")).lower()).strip("-")[:48] or "scene"
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        out = OUT_DIR / f"{stamp}-{slug}.html"
    out.parent.mkdir(parents=True, exist_ok=True)

    blob = json.dumps(scene, ensure_ascii=False).replace("</", "<\\/")
    if "--legacy" not in argv:  # the canvas: real meshes, a workspace that holds this scene as its first visual
        if len(blob) > MAX_BYTES:
            print(f"scene refused:\n  the page would be {len(blob) / 1e6:.1f} MB", file=sys.stderr)
            return 1
        sys.path.insert(0, str(HERE / "canvas"))
        from pack import page as canvas_page
        slug = re.sub(r"[^a-z0-9]+", "-", str(scene.get("title", "scene")).lower()).strip("-")[:48] or "scene"
        html = canvas_page({"visuals": [{"key": slug, "scene": scene}]})
        title = re.sub(r"[<>&]", "", str(scene.get("title", "Vision")))[:60] or "Vision"
        out.write_text(html.replace("<title>Vision</title>", f"<title>{title}</title>", 1))
        print(out)
        if "--no-open" not in argv:
            subprocess.run(["open", str(out)], check=False)
        return 0
    page = (HERE / "viewer.html").read_text()
    if len(blob) > MAX_BYTES:
        print(f"scene refused:\n  the page would be {len(blob) / 1e6:.1f} MB; keep models and images "
              f"under {MAX_BYTES / 1e6:.0f} MB in all (simplify the model, shrink the image)", file=sys.stderr)
        return 1
    page = page.replace("/*__SCENE__*/null", blob, 1)
    title = re.sub(r"[<>&]", "", str(scene.get("title", "See")))[:60] or "See"
    page = page.replace("<title>Vision</title>", f"<title>{title}</title>", 1)
    out.write_text(page)
    print(out)

    if "--no-open" not in argv:
        subprocess.run(["open", str(out)], check=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
