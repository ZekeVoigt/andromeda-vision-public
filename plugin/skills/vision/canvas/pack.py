#!/usr/bin/env python3
"""Pack the /vision canvas into one self-contained HTML page.

    python3 pack.py OUT.html [--data WORKSPACE.json]

The page inlines three.js (vendor/, pinned), the canvas code (shapes, scene, core, app, ui) and, with
--data, a workspace to open with: {"visuals": [{"key": ..., "scene": {...compiled by build.py...}}], "layout": "row"}.
"""
import json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
THREE = HERE.parent / "vendor" / "three-0.170.0.module.min.js"
MODULES = ["shapes.js", "scene.js", "core.js", "app.js", "live.js", "ui.js"]


def page(data=None):
    html = (HERE / "canvas.html").read_text()
    code = "\n".join((HERE / m).read_text() for m in MODULES if (HERE / m).exists())
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/") if data is not None else "null"
    html = html.replace("/*__THREE__*/", THREE.read_text().replace("</script", "<\\/script"), 1)
    html = html.replace("/*__CODE__*/", code.replace("</script", "<\\/script"), 1)
    html = html.replace("/*__UI__*/", "if (typeof makeUI === 'function') makeUI(SEE);", 1)
    html = html.replace("/*__DATA__*/null", blob, 1)
    return html


def main(argv):
    if not argv:
        print(__doc__.strip(), file=sys.stderr); return 2
    out = pathlib.Path(argv[0])
    data = json.loads(pathlib.Path(argv[argv.index("--data") + 1]).read_text()) if "--data" in argv else None
    out.write_text(page(data))
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
