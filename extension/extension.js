// See (talk): a session channel, ~/.claude/see/sessions/<sid>/, is how one Claude session talks to you:
//   now.json names its latest world, talk.jsonl is the conversation. The panel runs the world
//   with a dock under it. What you type, or a click on a part, is appended to talk.jsonl as
//   {"who": "you", ...}, and the session, which watches that file, answers through it.
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SEE = path.join(os.homedir(), '.claude', 'see')
const SESSIONS = path.join(SEE, 'sessions')
// the dock and skin are read fresh from the mod's own folder each time a page loads, so a change to
// either reaches the panel without reinstalling (the copies beside this file are the fallback)
const MOD = path.join(os.homedir(), '.claude', 'mods', 'see-talk')
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

const BLANK = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#111;--ink:#ececea;--soft:#b5b5b2;--muted:#64645f;--line:#2a2a28;--accent:#ff7a4d}
@media (prefers-color-scheme: light){:root{--bg:#f5f5f4;--ink:#151515;--soft:#5f5f5c;--muted:#a3a3a0;--line:#e3e3e0;--accent:#e4572e}}
html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,-apple-system,system-ui,sans-serif}
main{padding:40px 24px;color:var(--muted)}</style></head><body><main>No world yet. Say something below.</main></body></html>`

function withDock(page, form) {
  let html = page
  { // always the latest skin: drop one baked in at publish time, then put the fresh one in
    const s0 = html.indexOf('<!-- see-talk skin'), s1 = s0 < 0 ? -1 : html.indexOf('</style>', s0)
    if (s1 > 0) html = html.slice(0, s0) + html.slice(s1 + 8)
    const b0 = html.indexOf('<canvas id="see-bg">'), b1 = html.lastIndexOf('</body>')
    if (b0 > 0 && b1 > b0) html = html.slice(0, b0) + html.slice(b1)
    const [head, tail] = fresh('skin.html').replace('{{FORM}}', form || '{{FORM}}').split('<!--BODY-->')
    const h = html.indexOf('</head>'); html = h < 0 ? head + html : html.slice(0, h) + head + html.slice(h)
    const b = html.lastIndexOf('</body>'); html = b < 0 ? html + tail : html.slice(0, b) + tail + html.slice(b)
  }
  const dock = fresh('dock.html'), at = html.lastIndexOf('</body>')
  return at < 0 ? html + dock : html.slice(0, at) + dock + html.slice(at)
}

// ---- a session channel ----
const channels = new Map() // sid -> { panel, world, worldAt, talkAt, sent }

function openChannel(sid, ch) {
  const panel = vscode.window.createWebviewPanel(
    'seeTalk', 'See', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] })
  ch.panel = panel
  panel.onDidDispose(() => { ch.panel = undefined })
  panel.webview.onDidReceiveMessage(m => {
    const dir = path.join(SESSIONS, sid)
    if (m.type === 'ready') {
      const lines = talkLines(path.join(dir, 'talk.jsonl'))
      ch.sent = lines.length
      panel.webview.postMessage({ type: 'talk', lines })
    } else if (m.type === 'say' && typeof m.text === 'string' && m.text.trim()) {
      const line = { who: 'you', text: m.text.trim(), at: new Date().toISOString() }
      if (m.kind === 'click') Object.assign(line, { kind: 'click', part: m.part, stop: m.stop })
      fs.appendFileSync(path.join(dir, 'talk.jsonl'), JSON.stringify(line) + '\n')
    }
  })
}

function loadWorld(sid, ch) {
  const now = json(path.join(SESSIONS, sid, 'now.json'))
  const page = now && now.html ? read(now.html) : undefined
  ch.world = now && now.html
  ch.panel.title = `See · ${(now && now.title) || 'talk'}`
  ch.sent = 0 // the reloaded page asks for the whole transcript
  ch.panel.webview.html = withDock(page || BLANK, now && now.stops && now.stops.length > 1 ? 'steps' : 'image')
  ch.skinAt = mtime(path.join(MOD, 'skin.html'))
}

function tickSession(sid) {
  const dir = path.join(SESSIONS, sid)
  const worldAt = mtime(path.join(dir, 'now.json')), talkAt = mtime(path.join(dir, 'talk.jsonl'))
  let ch = channels.get(sid)
  if (!ch) { // first sight: open only if it changed since the window started
    ch = { worldAt, talkAt, sent: 0, started: Date.now() }
    channels.set(sid, ch)
    if (Math.max(worldAt, talkAt) < STARTED) return
    openChannel(sid, ch); loadWorld(sid, ch); return
  }
  if (ch.panel && ch.skinAt && mtime(path.join(MOD, 'skin.html')) !== ch.skinAt) { loadWorld(sid, ch); return } // the skin changed
  const worldChanged = worldAt !== ch.worldAt, talkChanged = talkAt !== ch.talkAt
  if (!worldChanged && !talkChanged) return
  ch.worldAt = worldAt; ch.talkAt = talkAt
  if (!ch.panel) { openChannel(sid, ch); loadWorld(sid, ch); return }
  if (worldChanged) {
    const now = json(path.join(dir, 'now.json'))
    if (now && now.html !== ch.world) { loadWorld(sid, ch); ch.panel.reveal(undefined, true); return }
  }
  if (talkChanged && ch.sent > 0) {
    const lines = talkLines(path.join(dir, 'talk.jsonl'))
    if (lines.length > ch.sent) {
      ch.panel.webview.postMessage({ type: 'append', lines: lines.slice(ch.sent) })
      ch.sent = lines.length
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
    vscode.commands.registerCommand('seeTalk.open', async () => {
      let sids = []
      try { sids = fs.readdirSync(SESSIONS).filter(s => !s.startsWith('.')) } catch { }
      sids.sort((a, b) => mtime(path.join(SESSIONS, b, 'talk.jsonl')) - mtime(path.join(SESSIONS, a, 'talk.jsonl')))
      const sid = sids.length > 1 ? await vscode.window.showQuickPick(sids, { placeHolder: 'Which session?' }) : sids[0]
      if (!sid) return
      let ch = channels.get(sid)
      if (!ch) { ch = { worldAt: 0, talkAt: 0, sent: 0 }; channels.set(sid, ch) }
      ch.worldAt = mtime(path.join(SESSIONS, sid, 'now.json')); ch.talkAt = mtime(path.join(SESSIONS, sid, 'talk.jsonl'))
      if (!ch.panel) openChannel(sid, ch)
      loadWorld(sid, ch)
      ch.panel.reveal()
    })
  )
  const timer = setInterval(tick, 700)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
}

function deactivate() {}

module.exports = { activate, deactivate }
