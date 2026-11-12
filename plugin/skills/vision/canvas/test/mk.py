import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from pack import page
out = pathlib.Path(sys.argv[1]); items = []
for a in sys.argv[2:]:
    k, _, f = a.partition('=')
    items.append({"key": k, "scene": json.loads(pathlib.Path(f).read_text())})
out.write_text(page({"visuals": items}))
