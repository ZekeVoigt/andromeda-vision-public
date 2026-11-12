// Vision: a Claude session's canvas beside the chat. A session channel, ~/.claude/vision/sessions/<sid>/, holds
//   workspace.json  what the canvas holds (visuals and where they are), written by canvas.py and by this panel
//   visuals/*.json  each visual's compiled scene
//   talk.jsonl      the conversation both ways; Claude's lines may carry ops the canvas plays live
// The canvas page (~/.claude/vision/canvas.html, packed by canvas.py) loads once per panel and stays: new visuals,
// edits and pointing arrive as messages, so nothing reloads and nothing is lost between turns.
// Sessions from before (now.json only) still open the old way.
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const SEE = path.join(os.homedir(), '.claude', 'vision')
const SESSIONS = path.join(SEE, 'sessions')
const CANVAS = path.join(SEE, 'canvas.html')
const SKILL = () => { try { return JSON.parse(fs.readFileSync(path.join(SEE, 'skill.json'), 'utf8')).dir } catch { return path.join(os.homedir(), '.claude', 'skills', 'vision') } }
const PACK = () => path.join(SKILL(), 'canvas', 'pack.py')
const MOD = path.join(os.homedir(), '.claude', 'mods', 'vision')
const fresh = name => { try { return fs.readFileSync(path.join(MOD, name), 'utf8') } catch { return fs.readFileSync(path.join(__dirname, name), 'utf8') } }

const read = f => { try { return fs.readFileSync(f, 'utf8') } catch { return undefined } }
const mtime = f => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }
const json = f => { try { return JSON.parse(read(f)) } catch { return undefined } }

function talkLines(file) {
  const out = []
  for (const line of (read(file) || '').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a half-written last line: the next tick reads it */ }
  }
  return out
}
function writeJSON(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, file) }

// ---- the canvas page ----
function canvasPage() {
  if (!fs.existsSync(CANVAS)) { try { cp.execFileSync('python3', [PACK(), CANVAS], { timeout: 20000 }) } catch (e) { console.error('vision: pack', e) } }
  return read(CANVAS) || '<!doctype html><body style="background:#111;color:#999;font:14px sans-serif;padding:40px">The canvas page is missing: run canvas.py once.</body>'
}
// a visual's scene, attached to an op or a workspace entry
function withScene(item) {
  if (!item || !item.file || item.scene) return item
  const scene = json(item.file)
  return scene ? Object.assign({}, item, { scene }) : item
}
function workspaceOf(dir) {
  const ws = json(path.join(dir, 'workspace.json')) || { layout: 'row', visuals: [] }
  return Object.assign({}, ws, { visuals: (ws.visuals || []).map(withScene).filter(v => v.scene) })
}
function shipLines(lines) {
  return lines.map(l => (l.ops ? Object.assign({}, l, { ops: l.ops.map(o => (o.op === 'add' || o.op === 'replace' ? withScene(o) : o)) }) : l))
}

// ---- the old way (a session with only now.json): the page with a dock ----
const BLANK = `<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#111;color:#666;font:15px sans-serif;padding:40px">No world yet.</body></html>`
function withDock(page, form) {
  let html = page
  {
    const s0 = html.indexOf('<!-- vision skin'), s1 = s0 < 0 ? -1 : html.indexOf('</style>', s0)
    if (s1 > 0) html = html.slice(0, s0) + html.slice(s1 + 8)
    const b0 = html.indexOf('<canvas id="see-bg">'), b1 = html.lastIndexOf('</body>')
    if (b0 > 0 && b1 > b0) html = html.slice(0, b0) + html.slice(b1)
    const [head, tail] = fresh('skin.html').split('{{FORM}}').join(form || '{{FORM}}').split('<!--BODY-->')
    const h = html.indexOf('</head>'); html = h < 0 ? head + html : html.slice(0, h) + head + html.slice(h)
    const b = html.lastIndexOf('</body>'); html = b < 0 ? html + tail : html.slice(0, b) + tail + html.slice(b)
  }
  const dock = fresh('dock.html'), at = html.lastIndexOf('</body>')
  return at < 0 ? html + dock : html.slice(0, at) + dock + html.slice(at)
}

// ---- a session channel ----
const channels = new Map() // sid -> { panel, mode, sent, worldAt, talkAt, canvasAt }

function openChannel(sid, ch) {
  const panel = vscode.window.createWebviewPanel(
    'vision', 'Vision', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] })
  ch.panel = panel
  panel.onDidDispose(() => { ch.panel = undefined })
  panel.webview.onDidReceiveMessage(m => onMessage(sid, ch, m))
}

function onMessage(sid, ch, m) {
  const dir = path.join(SESSIONS, sid)
  if (m.type === 'ready') {
    const lines = talkLines(path.join(dir, 'talk.jsonl'))
    ch.sent = lines.length
    if (ch.mode === 'canvas') ch.panel.webview.postMessage({ type: 'init', workspace: workspaceOf(dir), talk: shipLines(lines.slice(-200)) })
    else ch.panel.webview.postMessage({ type: 'talk', lines })
  } else if (m.type === 'say' && typeof m.text === 'string' && m.text.trim()) {
    const line = { who: 'you', text: m.text.trim(), at: new Date().toISOString() }
    for (const k of ['kind', 'visual', 'part', 'id', 'file', 'stop', 'other', 'quiet']) if (m[k] != null) line[k] = m[k]
    fs.appendFileSync(path.join(dir, 'talk.jsonl'), JSON.stringify(line) + '\n')
  } else if (m.type === 'state' && m.state) { // the user's changes: layout, where things are, what is open, what they removed
    const file = path.join(dir, 'workspace.json'), ws = json(file) || { visuals: [] }, st = m.state
    const removed = new Set(st.removed || [])
    ws.visuals = (ws.visuals || []).filter(v => !removed.has(v.key))
    for (const v of ws.visuals) { const s = (st.visuals || []).find(x => x.key === v.key); if (s) Object.assign(v, { stop: s.stop, pos: s.pos, opened: s.opened, hidden: s.hidden }) }
    const order = (st.visuals || []).map(v => v.key); ws.visuals.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99))
    ws.layout = st.layout; ws.focus = st.focus; ws.selection = st.selection; ws.seen = new Date().toISOString()
    try { writeJSON(file, ws) } catch (e) { console.error('vision: state', e) }
  } else if (m.type === 'open' && m.file) openFile(m.file)
}

async function openFile(spec) {
  const mm = /^(.*?)(?::(\d+))?$/.exec(spec), rel = mm[1], line = mm[2] ? +mm[2] - 1 : 0
  let p = rel.startsWith('~') ? path.join(os.homedir(), rel.slice(1)) : rel
  if (!path.isAbsolute(p)) for (const f of vscode.workspace.workspaceFolders || []) { const q = path.join(f.uri.fsPath, rel); if (fs.existsSync(q)) { p = q; break } }
  try {
    const doc = await vscode.workspace.openTextDocument(p)
    const pos = new vscode.Position(line, 0)
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(pos, pos), preview: true })
  } catch (e) { vscode.window.showWarningMessage('Vision: cannot open ' + spec) }
}

function load(sid, ch) {
  const dir = path.join(SESSIONS, sid)
  ch.mode = fs.existsSync(path.join(dir, 'workspace.json')) || !fs.existsSync(path.join(dir, 'now.json')) ? 'canvas' : 'legacy'
  ch.sent = 0
  if (ch.mode === 'canvas') {
    ch.panel.title = 'Vision'
    ch.panel.webview.html = canvasPage()
    ch.canvasAt = mtime(CANVAS)
    watchCode(sid)
  } else {
    const now = json(path.join(dir, 'now.json')), page = now && now.html ? read(now.html) : undefined
    ch.world = now && now.html
    ch.panel.title = `Vision · ${(now && now.title) || 'talk'}`
    ch.panel.webview.html = withDock(page || BLANK, now && now.stops && now.stops.length > 1 ? 'steps' : 'image')
  }
}

// ---- live data: a code visual follows its files (canvas.py refresh) ----
const CANVAS_PY = () => path.join(SKILL(), 'canvas.py')
const watchers = new Map() // sid:key -> { paths, watchers, timer }
function watchCode(sid) {
  const ws = json(path.join(SESSIONS, sid, 'workspace.json')) || { visuals: [] }
  const want = new Map((ws.visuals || []).filter(v => v.code && v.code.paths).map(v => [sid + ':' + v.key, v]))
  for (const [k, w] of watchers) if (k.startsWith(sid + ':') && !want.has(k)) { w.watchers.forEach(x => x.close()); watchers.delete(k) }
  for (const [k, v] of want) {
    const sig = v.code.paths.join('|')
    if (watchers.has(k) && watchers.get(k).sig === sig) continue
    if (watchers.has(k)) watchers.get(k).watchers.forEach(x => x.close())
    const w = { sig, watchers: [], timer: 0 }
    const fire = (ev, name) => {
      if (name && !/\.(py|js|mjs|cjs|ts|tsx|jsx|rs)$/.test(String(name))) return
      clearTimeout(w.timer)
      w.timer = setTimeout(() => cp.execFile('python3', [CANVAS_PY(), '--session', sid, 'refresh', v.key], { timeout: 60000 }, err => { if (err) console.error('vision: refresh', v.key, err.message) }), 1200)
    }
    for (const p of v.code.paths) { try { w.watchers.push(fs.watch(p, { recursive: fs.statSync(p).isDirectory() }, fire)) } catch (e) { console.error('vision: watch', p, e.message) } }
    watchers.set(k, w)
  }
}

function tickSession(sid) {
  const dir = path.join(SESSIONS, sid)
  const worldAt = Math.max(mtime(path.join(dir, 'now.json')), mtime(path.join(dir, 'workspace.json'))), talkAt = mtime(path.join(dir, 'talk.jsonl'))
  let ch = channels.get(sid)
  if (!ch) { // first sight: open only if it changed since the window started
    ch = { worldAt, talkAt, sent: 0 }
    channels.set(sid, ch)
    if (Math.max(worldAt, talkAt) < STARTED) return
    openChannel(sid, ch); load(sid, ch); return
  }
  const changed = worldAt !== ch.worldAt || talkAt !== ch.talkAt
  if (worldAt !== ch.worldAt && ch.panel && ch.mode === 'canvas') watchCode(sid)
  ch.worldAt = worldAt; ch.talkAt = talkAt
  if (ch.panel && ch.mode === 'canvas' && mtime(CANVAS) !== ch.canvasAt) { load(sid, ch); return } // the canvas code changed
  if (!changed) return
  if (!ch.panel) { if (talkAt > (ch.closedAt || 0)) { openChannel(sid, ch); load(sid, ch) } return }
  if (ch.mode === 'legacy') {
    if (fs.existsSync(path.join(dir, 'workspace.json'))) { load(sid, ch); return }
    const now = json(path.join(dir, 'now.json'))
    if (now && now.html !== ch.world) { load(sid, ch); ch.panel.reveal(undefined, true); return }
  }
  if (ch.sent > 0) {
    const lines = talkLines(path.join(dir, 'talk.jsonl'))
    if (lines.length > ch.sent) {
      const news = lines.slice(ch.sent)
      ch.panel.webview.postMessage(ch.mode === 'canvas' ? { type: 'talk', lines: shipLines(news) } : { type: 'append', lines: news })
      ch.sent = lines.length
      if (news.some(l => l.who === 'claude' && l.ops && l.ops.some(o => o.op === 'add'))) ch.panel.reveal(undefined, true)
    }
  }
}

const STARTED = Date.now()
function tick() {
  let sids = []
  try { sids = fs.readdirSync(SESSIONS).filter(s => !s.startsWith('.')) } catch { }
  for (const sid of sids) tickSession(sid)
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('vision.open', async () => {
      let sids = []
      try { sids = fs.readdirSync(SESSIONS).filter(s => !s.startsWith('.')) } catch { }
      sids.sort((a, b) => mtime(path.join(SESSIONS, b, 'talk.jsonl')) - mtime(path.join(SESSIONS, a, 'talk.jsonl')))
      const sid = sids.length > 1 ? await vscode.window.showQuickPick(sids, { placeHolder: 'Which session?' }) : sids[0]
      if (!sid) return
      let ch = channels.get(sid)
      if (!ch) { ch = { worldAt: 0, talkAt: 0, sent: 0 }; channels.set(sid, ch) }
      if (!ch.panel) openChannel(sid, ch)
      load(sid, ch)
      ch.panel.reveal()
    })
  )
  const timer = setInterval(tick, 400)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
}
function deactivate() {}
module.exports = { activate, deactivate }
