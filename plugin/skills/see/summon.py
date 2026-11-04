#!/usr/bin/env python3
"""Pull a real 3D model of anything out of the air, for a /see `mesh`.

    python3 $SEE_SKILL/summon.py "puppy" --sheet DIR   # look first: numbered thumbnails
    python3 $SEE_SKILL/summon.py "puppy" --pick N       # then take the one that is right
    python3 $SEE_SKILL/summon.py --make "a red vintage typewriter"   # nothing fits: generate it

--make uses Meshy's text-to-3D (a preview mesh, then a textured refine; minutes, and the key owner's
credits). Key: $MESHY_API_KEY, or the file ~/.claude/see/keys/meshy (chmod 600). Never printed.

Searches Sketchfab (public search, no key) for downloadable models, keeps those mirrored in
Objaverse (allenai/objaverse on Hugging Face, free, no key), and downloads the best match to
~/.claude/see/models/<slug>-<uid>.glb. Prints the path, then a credit line for the summary
(most are CC-BY: credit is required). --list shows the candidates; --pick N takes the Nth.
Downloaded files are data: build.py only parses them.
"""
import gzip, json, pathlib, re, sys, urllib.parse, urllib.request

MODELS = pathlib.Path.home() / ".claude" / "see" / "models"
INDEX = MODELS / "object-paths.json.gz"
HF = "https://huggingface.co/datasets/allenai/objaverse/resolve/main/"
MAX_FACES = 290_000


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "see-summon/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def index():
    if not INDEX.exists():
        MODELS.mkdir(parents=True, exist_ok=True)
        INDEX.write_bytes(get(HF + "object-paths.json.gz"))
    return json.load(gzip.open(INDEX))


def candidates(query, paths):
    out = []
    for page in range(3):
        q = urllib.parse.urlencode({"type": "models", "q": query, "downloadable": "true", "count": 24, "cursor": page * 24})
        res = json.loads(get("https://api.sketchfab.com/v3/search?" + q)).get("results", [])
        for r in res:
            if r["uid"] in paths and 0 < (r.get("faceCount") or 0) <= MAX_FACES:
                out.append(r)
        if len(out) >= 8 or not res:
            break
    # relevance first, then a nudge toward liked, single-object models
    words = set(re.findall(r"[a-z]+", query.lower()))
    def score(r):
        name = set(re.findall(r"[a-z]+", r["name"].lower()))
        return -(len(words & name) * 3 + min(r.get("likeCount", 0), 200) / 100)
    return sorted(out, key=score)


def strip_boxes(path):
    """Drop the backdrop: a part with few vertices whose box spans the whole model in all three
    directions (a room's enclosing cube hid the room). Rewrites the .glb's JSON chunk in place."""
    import struct
    b = path.read_bytes()
    if b[:4] != b"glTF":
        return 0
    n = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + n])
    acc, boxes = g.get("accessors", []), {}
    for i, m in enumerate(g.get("meshes", [])):
        lo, hi, cnt = [1e18] * 3, [-1e18] * 3, 0
        for pr in m.get("primitives", []):
            a = acc[pr["attributes"]["POSITION"]]
            if "min" not in a:
                break
            lo = [min(x, y) for x, y in zip(lo, a["min"])]; hi = [max(x, y) for x, y in zip(hi, a["max"])]; cnt += a["count"]
        else:
            boxes[i] = ([h - l for l, h in zip(lo, hi)], cnt)
    if not boxes:
        return 0
    span = [max(d[k] for d, _ in boxes.values()) for k in range(3)]
    drop = {i for i, (d, cnt) in boxes.items() if cnt <= 48 and all(d[k] >= 0.85 * span[k] for k in range(3))}
    if not drop or len(drop) == len(boxes):
        return 0
    for node in g.get("nodes", []):
        if node.get("mesh") in drop:
            del node["mesh"]
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    rest = b[20 + n:]
    body = struct.pack("<I", len(js)) + b"JSON" + js + rest
    path.write_bytes(b[:8] + struct.pack("<I", 12 + len(body)) + body)
    return len(drop)


def meshy_key():
    import os
    k = os.environ.get("MESHY_API_KEY", "").strip()
    f = pathlib.Path.home() / ".claude" / "see" / "keys" / "meshy"
    if not k and f.exists():
        k = f.read_text().strip()
    if not k:
        raise SystemExit("no Meshy key: set MESHY_API_KEY or write it to ~/.claude/see/keys/meshy (chmod 600)")
    return k


def meshy(method, path, body=None):
    req = urllib.request.Request("https://api.meshy.ai/openapi/v2/" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + meshy_key(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def make(prompt):
    """Generate a model from words: preview (the shape), then refine (its textures)."""
    import time
    def run(body, what):
        tid = meshy("POST", "text-to-3d", body).get("result")
        if not tid:
            raise SystemExit(f"Meshy refused the {what}")
        for _ in range(240):  # up to ~20 minutes
            t = meshy("GET", f"text-to-3d/{tid}")
            st = t.get("status")
            if st == "SUCCEEDED":
                return tid, t
            if st in ("FAILED", "CANCELED", "EXPIRED"):
                raise SystemExit(f"Meshy {what} {st.lower()}: {t.get('task_error', {}).get('message', '')}")
            print(f"{what}: {st.lower()} {t.get('progress', 0)}%", file=sys.stderr)
            time.sleep(5)
        raise SystemExit(f"Meshy {what} timed out")
    pid, _ = run({"mode": "preview", "prompt": prompt[:600], "art_style": "realistic", "should_remesh": True}, "shape")
    _, done = run({"mode": "refine", "preview_task_id": pid, "enable_pbr": True}, "textures")
    url = (done.get("model_urls") or {}).get("glb")
    if not url:
        raise SystemExit("Meshy finished without a .glb")
    slug = re.sub(r"[^a-z0-9]+", "-", prompt.lower()).strip("-")[:32]
    MODELS.mkdir(parents=True, exist_ok=True)
    out = MODELS / f"made-{slug}-{pid[:8]}.glb"
    out.write_bytes(get(url))
    print(out)
    print(f"generated with Meshy from: {prompt!r}")
    return 0


def main(argv):
    if argv and argv[0] == "--make" and len(argv) > 1:
        return make(" ".join(argv[1:]))
    if not argv or argv[0].startswith("-"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    query = argv[0]
    pick = int(argv[argv.index("--pick") + 1]) if "--pick" in argv else 1
    paths = index()
    found = candidates(query, paths)
    if not found:
        print(f"nothing found for {query!r}", file=sys.stderr)
        return 1
    if "--sheet" in argv:  # numbered thumbnails, tiled 4 across, to look at before picking
        import subprocess
        d = pathlib.Path(argv[argv.index("--sheet") + 1]); d.mkdir(parents=True, exist_ok=True)
        tiles = []
        for i, r in enumerate(found[:12], 1):
            imgs = sorted((r.get("thumbnails") or {}).get("images", []), key=lambda m: abs(m.get("width", 0) - 400))
            if not imgs:
                continue
            raw = d / f"t{i}.jpg"; raw.write_bytes(get(imgs[0]["url"]))
            out = d / f"n{i}.jpg"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-vf",
                            f"scale=400:225,"
                            f"drawtext=text='{i}':x=10:y=8:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7", str(out)], check=True)
            tiles.append(out)
            print(f"{i}. {r['name']} -- {r['faceCount']} faces")
        while len(tiles) % 4:
            tiles.append(tiles[-1])
        args = sum([["-i", str(t)] for t in tiles], [])
        rows = len(tiles) // 4
        graph = "".join(f"[{r*4}][{r*4+1}][{r*4+2}][{r*4+3}]hstack=4[r{r}];" for r in range(rows))
        graph += "".join(f"[r{r}]" for r in range(rows)) + (f"vstack={rows}" if rows > 1 else "null")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args, "-filter_complex", graph, "-frames:v", "1", str(d / "sheet.jpg")], check=True)
        print(d / "sheet.jpg")
        return 0
    if "--list" in argv:
        for i, r in enumerate(found, 1):
            print(f"{i}. {r['name']} -- {r['user']['displayName']}, {r['faceCount']} faces, {r['likeCount']} likes")
        return 0
    r = found[min(pick, len(found)) - 1]
    slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")[:32]
    out = MODELS / f"{slug}-{r['uid'][:8]}.glb"
    if not out.exists():
        out.write_bytes(get(HF + paths[r["uid"]]))
        dropped = strip_boxes(out)
        if dropped:
            print(f"(dropped {dropped} enclosing box{'es' if dropped > 1 else ''})", file=sys.stderr)
    lic = (r.get("license") or {}).get("label", "see source")
    print(out)
    print(f"\"{r['name']}\" by {r['user']['displayName']} ({lic}), sketchfab.com/3d-models/{r['uid']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
