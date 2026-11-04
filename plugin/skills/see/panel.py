#!/usr/bin/env python3
"""$SEE_SKILL/panel.py SID OUT.html [PAGE.html]: the session panel as see-talk builds it, fed the real talk.jsonl."""
import json, pathlib, sys
sid, out = sys.argv[1], pathlib.Path(sys.argv[2])
home = pathlib.Path.home() / ".claude"
def panel_file(name):
    """The See panel's own file (skin.html, dock.html): $SEE_PANEL_DIR, ~/.claude/mods/see-talk, or the
    installed extension in VS Code, Cursor or Windsurf."""
    import glob, os
    home = pathlib.Path.home()
    dirs = [os.environ.get("SEE_PANEL_DIR", ""), str(home / ".claude/mods/see-talk")]
    for ed in (".vscode", ".cursor", ".windsurf", ".vscode-insiders"):
        dirs += sorted(glob.glob(str(home / ed / "extensions" / "*.see-talk-*")), reverse=True)
    for d in dirs:
        if d and (pathlib.Path(d) / name).exists():
            return pathlib.Path(d) / name
    return pathlib.Path("/nonexistent") / name
d = home / "see/sessions" / sid
now = json.loads((d / "now.json").read_text())
html = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else now["html"]).read_text()
s0 = html.find("<!-- see-talk skin")
if s0 >= 0:
    s1 = html.find("</style>", s0); html = html[:s0] + html[s1 + 8:]
b0, b1 = html.find('<canvas id="see-bg">'), html.rfind("</body>")
if 0 < b0 < b1: html = html[:b0] + html[b1:]
form = "steps" if len(now.get("stops", [])) > 1 else "image"
head, _, tail = panel_file("skin.html").read_text().replace("{{FORM}}", form).partition("<!--BODY-->")
h = html.find("</head>"); html = html[:h] + head + html[h:]
b = html.rfind("</body>"); html = html[:b] + tail + html[b:]
lines = [json.loads(l) for l in (d / "talk.jsonl").read_text().splitlines() if l.strip()]
fake = "<script>window.acquireVsCodeApi=()=>({postMessage(m){if(m.type==='ready')setTimeout(()=>postMessage({type:'talk',lines:%s},'*'),50)}})</script>" % json.dumps(lines).replace("</", "<\\/").replace("\u2028", "\\u2028")
dock = panel_file("dock.html").read_text()
b = html.rfind("</body>"); html = html[:b] + fake + dock + html[b:]
out.write_text(html); print(out)
