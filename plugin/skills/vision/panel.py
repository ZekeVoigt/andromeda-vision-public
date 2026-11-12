#!/usr/bin/env python3
"""panel.py SID OUT.html: the Vision panel as the extension shows it, fed the session's real workspace and talk.jsonl.

The canvas page with a stand-in for the VS Code host: on `ready` it sends the same `init` the extension sends
(workspace.json with each visual's scene, the last 200 talk lines). window.HOST_SEND(lines) plays more lines as if
they had just arrived; window.HOST_OUT holds what the canvas sent back. canvas.py look uses it.
"""
import json, os, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
sid, out = sys.argv[1], pathlib.Path(sys.argv[2])
d = pathlib.Path(os.environ.get("SEE_HOME") or pathlib.Path.home() / ".claude" / "vision") / "sessions" / sid
sys.path.insert(0, str(HERE / "canvas"))
from pack import page
def scene_of(item):
    try: return dict(item, scene=json.loads(pathlib.Path(item["file"]).read_text()))
    except Exception: return item
ws = json.loads((d / "workspace.json").read_text()) if (d / "workspace.json").exists() else {"visuals": []}
ws["visuals"] = [v for v in map(scene_of, ws.get("visuals", [])) if v.get("scene")]
lines = [json.loads(l) for l in (d / "talk.jsonl").read_text().splitlines() if l.strip()][-200:] if (d / "talk.jsonl").exists() else []
for l in lines:
    for o in l.get("ops") or []:
        if o.get("op") in ("add", "replace") and o.get("file"): o.update(scene_of(o))
blob = json.dumps({"type": "init", "workspace": ws, "talk": lines}).replace("</", "<\\/").replace("\u2028", "\\u2028")
fake = ("<script>window.HOST_OUT=[];window.acquireVsCodeApi=()=>({postMessage(m){window.HOST_OUT.push(m);"
        "if(m.type==='ready')setTimeout(()=>postMessage(%s,'*'),30)}});"
        "window.HOST_SEND=lines=>postMessage({type:'talk',lines},'*');</script>") % blob
html = page(None)
h = html.find("<script")
out.write_text(html[:h] + fake + html[h:])
print(out)
