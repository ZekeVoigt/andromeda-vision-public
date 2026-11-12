// ui.js -- the conversation and the hands: Claude's card and cursor, the composer, the shelf of visuals, the tour bar,
// hover, selection and its actions, the context menu, double-click to open, drag to move, and the ops Claude sends.
function makeUI(SEE) {
  const THREE = SEE.THREE, ui = document.getElementById('ui'), canvas = document.getElementById('gl');
  const LIVE = SEE.live = makeLive(SEE);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const block = s => { // short lines and "- " bullets
    const out = []; let list = null;
    for (const l of String(s).split('\n')) {
      if (/^\s*[-•]\s+/.test(l)) { if (!list) out.push((list = [])); list.push('<li>' + md(l.replace(/^\s*[-•]\s+/, '')) + '</li>'); }
      else { list = null; if (l.trim()) out.push('<p>' + md(l) + '</p>'); }
    }
    return out.map(x => (Array.isArray(x) ? '<ul>' + x.join('') + '</ul>' : x)).join('');
  };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const stopEv = e => { for (const k of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) e.addEventListener(k, x => x.stopPropagation()); e.addEventListener('keydown', x => x.stopPropagation()); };

  // ---------- the host: the VS Code panel (or nothing, for a page opened on its own) ----------
  const host = (() => { try { const vs = acquireVsCodeApi(); return { post: m => vs.postMessage(m), on: true }; } catch { return { post: () => {}, on: false }; } })();
  document.body.classList.toggle('hosted', host.on);

  // ---------- styles ----------
  document.head.appendChild(el('style', null, `
#ui code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--ink) 10%, transparent); padding: 0 4px; border-radius: 4px; }
.pill { font: 12.5px/1 Inter, -apple-system, system-ui, sans-serif; color: var(--soft); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 6px 11px; cursor: pointer; white-space: nowrap; }
.pill:hover { color: var(--ink); border-color: var(--muted); } .pill.on { color: var(--ink); border-color: var(--accent); }
#shelf { position: absolute; left: 12px; top: 12px; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 90px); align-items: center; }
#shelf .chip { display: inline-flex; gap: 6px; align-items: center; } #shelf .chip .x { opacity: .45; padding: 0 2px; } #shelf .chip .x:hover { opacity: 1; color: var(--accent); }
#shelf .sep { width: 1px; height: 18px; background: var(--line); margin: 0 2px; }
#theme { position: absolute; right: 12px; top: 12px; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; }
#card { position: absolute; width: min(360px, calc(100% - 32px)); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px 12px 34px;
  font-size: 13.5px; color: var(--ink); box-shadow: 0 8px 30px rgba(0,0,0,.18); transition: opacity .25s; opacity: 0; pointer-events: none; }
#card.on { opacity: 1; pointer-events: auto; } #card p { margin: 0 0 6px; } #card p:last-child { margin-bottom: 0; } #card ul { margin: 2px 0 6px; padding-left: 18px; }
#card .you { color: var(--muted); font-size: 12.5px; margin-bottom: 6px; } #card .st { color: var(--muted); font-size: 12px; margin-top: 6px; }
#card .btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; } #card .more { position: absolute; right: 10px; top: 8px; font-size: 11px; color: var(--muted); cursor: pointer; }
#card .hist { max-height: 40vh; overflow: auto; border-top: 1px solid var(--line); margin-top: 8px; padding-top: 6px; display: none; } #card.hist .hist { display: block; }
#card .hist .l { margin: 4px 0; font-size: 12.5px; } #card .hist .l.you { color: var(--muted); text-align: right; }
#mark { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; pointer-events: none; z-index: 3; }
#mark::before { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent); }
#mark.busy::after { content: ''; position: absolute; inset: -5px; border-radius: 50%; border: 1.5px solid var(--accent); border-top-color: transparent; animation: spin 1s linear infinite; }
#mark .tag { position: absolute; left: 16px; top: -4px; font: 600 11.5px Inter, sans-serif; color: var(--accent); white-space: nowrap; }
@keyframes spin { to { transform: rotate(360deg); } }
#tether { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; } #tether path { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 2 4; fill: none; opacity: .8; }
#composer { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); width: min(620px, calc(100% - 24px)); display: none; gap: 6px; flex-direction: column; }
body.hosted #composer { display: flex; }
#composer form { display: flex; gap: 6px; align-items: flex-end; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 6px 6px 6px 12px; }
#composer textarea { flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: var(--ink); font: 13.5px/1.45 Inter, -apple-system, system-ui, sans-serif; padding: 5px 0; max-height: 120px; }
#composer .ctx { align-self: flex-start; } #composer .ctx:empty { display: none; }
#composer button { border: 0; background: var(--accent); color: #fff; border-radius: 10px; width: 30px; height: 30px; cursor: pointer; font-size: 15px; }
#tour { position: absolute; left: 50%; transform: translateX(-50%); bottom: 12px; display: none; align-items: center; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 4px 6px; max-width: calc(100% - 24px); }
body.hosted #tour { bottom: 70px; } #tour.on { display: flex; }
#tour .cap { font-size: 13px; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #tour .n { color: var(--muted); font-size: 12px; }
#tour button { border: 1px solid var(--line); background: none; color: var(--ink); border-radius: 999px; width: 28px; height: 28px; cursor: pointer; }
#tip { position: absolute; pointer-events: none; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; font-size: 12px; opacity: 0; transition: opacity .12s; white-space: nowrap; z-index: 4; }
#tip.on { opacity: 1; } #tip .f { color: var(--muted); font: 11px ui-monospace, Menlo, monospace; }
#sel { position: absolute; background: var(--card); border: 1px solid var(--accent); border-radius: 12px; padding: 8px; display: none; gap: 6px; flex-direction: column; z-index: 4; min-width: 180px; max-width: 280px; }
#sel.on { display: flex; } #sel .t { font-weight: 600; font-size: 13px; padding: 0 4px; } #sel .f { color: var(--muted); font: 11px ui-monospace, Menlo, monospace; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sel .row { display: flex; gap: 4px; flex-wrap: wrap; } #sel .h { color: var(--muted); font-size: 11px; padding: 0 4px; }
#menu { position: absolute; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 4px; display: none; flex-direction: column; min-width: 190px; z-index: 6; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
#menu.on { display: flex; } #menu button { text-align: left; background: none; border: 0; color: var(--ink); font: 13px Inter, sans-serif; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
#menu button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); } #menu .sep { height: 1px; background: var(--line); margin: 4px 2px; } #menu .t { color: var(--muted); font-size: 11.5px; padding: 4px 10px; }
#livebox { position: absolute; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; display: none; flex-direction: column; gap: 6px; font-size: 12.5px; z-index: 3; max-width: 300px; }
#livebox.on { display: flex; } #livebox .ctl { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } #livebox label { display: flex; gap: 6px; align-items: center; color: var(--soft); }
#livebox input[type=range] { width: 110px; accent-color: var(--accent); } #livebox .st { color: var(--soft); } #livebox .ttl { font-weight: 600; }
#hint { position: absolute; left: 12px; bottom: 12px; font-size: 11.5px; color: var(--muted); pointer-events: none; } body.hosted #hint { display: none; }
`));

  // ---------- the DOM ----------
  const shelf = el('div', null); shelf.id = 'shelf';
  const theme = el('button', 'pill', '◐'); theme.id = 'theme'; theme.title = 'Light / dark';
  const tether = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); tether.id = 'tether';
  const card = el('div', null, '<span class="more">history</span><div class="you"></div><div class="say"></div><div class="btns"></div><div class="st"></div><div class="hist"></div>'); card.id = 'card';
  const mark = el('div', null, '<span class="tag"></span>'); mark.id = 'mark';
  const composer = el('div', null, '<span class="ctx pill"></span><form><textarea rows="1" placeholder="Message Claude…"></textarea><button type="submit" title="Send">↑</button></form>'); composer.id = 'composer';
  const tour = el('div', null, '<button class="p">←</button><span class="cap"></span><span class="n"></span><button class="nx">→</button>'); tour.id = 'tour';
  const tip = el('div', null); tip.id = 'tip';
  const sel = el('div', null); sel.id = 'sel';
  const menu = el('div', null); menu.id = 'menu';
  const livebox = el('div', null, '<div class="ttl"></div><div class="ctl"></div><div class="st"></div>'); livebox.id = 'livebox';
  const hint = el('div', null, 'Drag to turn · scroll to zoom · right-drag to pan · click a part · double-click to open it'); hint.id = 'hint';
  ui.append(tether, shelf, theme, card, mark, composer, tour, tip, sel, menu, livebox, hint);
  for (const x of [shelf, theme, card, composer, tour, sel, menu, livebox]) stopEv(x);
  const input = composer.querySelector('textarea'), ctxChip = composer.querySelector('.ctx');

  // ---------- state ----------
  const talk = []; // the conversation, as lines
  let ctx = null;     // what the next message is about: {key, id, label, file}
  let pointing = null; // Claude's cursor target: {key, ids, tag, until}
  let busy = false, status = '';
  const markPos = { x: -50, y: -50 }, markGoal = { x: -50, y: -50 };

  // ---------- theme ----------
  try { const t = localStorage.getItem('see-theme'); if (t) document.documentElement.dataset.theme = t;
    else if (document.body.classList.contains('vscode-light')) document.documentElement.dataset.theme = 'light'; } catch {}
  theme.addEventListener('click', () => {
    const dark = SEE.core.theme.dark, t = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('see-theme', t); } catch {}
    SEE.readTheme();
  });
  SEE.readTheme();

  // ---------- the shelf: what is on the canvas ----------
  function renderShelf() {
    const vs = [...SEE.visuals.values()];
    shelf.innerHTML = '';
    for (const v of vs) {
      const c = el('span', 'pill chip' + (SEE.ws.focus === v.key ? ' on' : ''), `<span>${esc(v.title)}</span><span class="x" title="Remove">×</span>`);
      c.addEventListener('click', e => { if (e.target.classList.contains('x')) { removeVisual(v.key, true); return; } focusVisual(v.key); });
      shelf.appendChild(c);
    }
    if (vs.length > 1) {
      shelf.appendChild(el('span', 'sep'));
      for (const [k, label] of [['row', 'Side by side'], ['grid', 'Grid'], ['free', 'Free']]) {
        const b = el('span', 'pill' + (SEE.ws.layout === k ? ' on' : ''), label);
        b.addEventListener('click', () => { SEE.arrange(k); renderShelf(); saveState(); });
        shelf.appendChild(b);
      }
      const all = el('span', 'pill', 'All'); all.addEventListener('click', () => { SEE.ws.focus = null; SEE.frame(null); renderShelf(); renderTour(); }); shelf.appendChild(all);
    }
  }
  function focusVisual(key, ids) {
    const v = SEE.visuals.get(key); if (!v) return;
    SEE.ws.focus = key;
    if (ids && ids.length) { ids.forEach(id => SEE.openPath(v, id)); SEE.frame({ key, ids }); } else SEE.frame([key]);
    renderShelf(); renderTour(); renderLive();
  }
  function removeVisual(key, mine) {
    SEE.remove(key); SEE.emit('removed', key);
    if (SEE.ws.focus === key) SEE.ws.focus = null;
    if (SEE.ws.selection && SEE.ws.selection.key === key) clearSelection();
    renderShelf(); renderTour(); renderLive();
    if (mine) { removedKeys.add(key); saveState(); host.post({ type: 'say', text: `(removed “${key}” from the canvas)`, kind: 'canvas', visual: key, quiet: true }); }
  }

  // ---------- the tour bar (only for a visual whose stops are real steps) ----------
  function renderTour() {
    const v = SEE.visuals.get(SEE.ws.focus) || (SEE.visuals.size === 1 ? [...SEE.visuals.values()][0] : null);
    const on = !!(v && v.stops.length > 1 && v.kind !== 'living');
    tour.classList.toggle('on', on); if (!on) return;
    const s = v.stops[v.stop] || {};
    tour.querySelector('.cap').textContent = s.caption || '';
    tour.querySelector('.n').textContent = `${v.stop + 1}/${v.stops.length}`;
    tour.dataset.key = v.key;
    if (s.detail || s.points) showCard({ text: [s.detail || '', ...(s.points || []).map(p => '- ' + p)].filter(Boolean).join('\n'), quietYou: true }, { key: v.key, ids: [].concat(s.focus || []).filter(x => typeof x === 'string') });
  }
  const stepTour = d => { const v = SEE.visuals.get(tour.dataset.key); if (!v) return; SEE.applyStop(v, v.stop + d); renderTour(); saveState(); };
  tour.querySelector('.p').addEventListener('click', () => stepTour(-1));
  tour.querySelector('.nx').addEventListener('click', () => stepTour(1));
  addEventListener('keydown', e => {
    if (e.target === input) return;
    if (e.key === 'ArrowRight' && tour.classList.contains('on')) stepTour(1);
    if (e.key === 'ArrowLeft' && tour.classList.contains('on')) stepTour(-1);
    if (e.key === 'Escape') { clearSelection(); closeMenu(); }
  });

  // ---------- Claude's card and cursor ----------
  function showCard(line, target) {
    const said = line.text || '';
    let text = said.replace(/\n?\[\[cur:[\s\S]*?\]\]/g, '').replace(/\n?\[\[ask:[\s\S]*?\]\]/g, '');
    const btn = /\n?\[\[([^\[\]]+)\]\]\s*$/.exec(text); let buttons = [];
    if (btn && !btn[1].startsWith('{')) { buttons = btn[1].split('|'); text = text.slice(0, btn.index); }
    card.querySelector('.say').innerHTML = block(text);
    const lastYou = [...talk].reverse().find(l => l.who === 'you' && !l.quiet);
    card.querySelector('.you').textContent = !line.quietYou && lastYou ? '“' + lastYou.text.slice(0, 140) + (lastYou.text.length > 140 ? '…' : '') + '”' : '';
    const bs = card.querySelector('.btns'); bs.innerHTML = '';
    for (const b of buttons) { const x = el('button', 'pill', esc(b.trim())); x.addEventListener('click', () => send(b.trim())); bs.appendChild(x); }
    card.classList.add('on');
    if (target && target.key) pointAt(target.key, target.ids, null, false);
    else if (!line.keepPoint) pointing = null;
    renderHist();
  }
  card.querySelector('.more').addEventListener('click', () => { card.classList.toggle('hist'); renderHist(); });
  function renderHist() {
    if (!card.classList.contains('hist')) return;
    const h = card.querySelector('.hist');
    h.innerHTML = talk.filter(l => !l.kind || l.kind === 'chat' || l.who === 'you').slice(-30).map(l => `<div class="l ${l.who === 'you' ? 'you' : ''}">${md(String(l.text || '').replace(/\[\[[\s\S]*?\]\]/g, '').slice(0, 400))}</div>`).join('');
    h.scrollTop = h.scrollHeight;
  }
  function pointAt(key, ids, tag, fly = true) {
    const v = SEE.visuals.get(key); if (!v) return;
    ids = (ids || []).filter(id => v.C.ids.has(id));
    pointing = { key, ids, tag: tag || '' };
    mark.querySelector('.tag').textContent = tag || '';
    if (fly && ids.length) { ids.forEach(id => SEE.openPath(v, id)); const sb = targetBox(); if (!sb || sb.w * sb.h < 900) SEE.frame({ key, ids }); }
  }
  function targetBox() { // where Claude's cursor's target is on screen right now
    if (!pointing) return null;
    const v = SEE.visuals.get(pointing.key); if (!v) return null;
    const parts = []; for (const id of pointing.ids) { const e = v.C.ids.get(id); if (e) parts.push(...e.parts); }
    if (!parts.length) { const [W, H] = SEE.core.size(); const b = SEE.screenBox(v.C.bounds.clone().translate(v.pos), W, H); return b && Object.assign(b, { tx: (b.x0 + b.x1) / 2 }); }
    return SEE.partsOnScreen(v, parts);
  }
  function placeCard() { // beside what it talks about, else top right; the cursor at the target, a dotted line between
    const [W, H] = SEE.core.size(), cw = card.offsetWidth, ch = card.offsetHeight, sb = targetBox();
    let x = W - cw - 14, y = 52;
    if (sb) {
      const cx = (sb.x0 + sb.x1) / 2, cy = (sb.y0 + sb.y1) / 2, top = 52, bot = H - (host.on ? 80 : 20) - (tour.classList.contains('on') ? 46 : 0);
      const clampX = v => Math.max(8, Math.min(W - cw - 8, v)), clampY = v => Math.max(top, Math.min(bot - ch, v));
      const spots = [[sb.x1 + 24, clampY(cy - ch / 2)], [sb.x0 - cw - 24, clampY(cy - ch / 2)], [clampX(cx - cw / 2), sb.y1 + 18], [clampX(cx - cw / 2), sb.y0 - ch - 18],
        [W - cw - 8, top], [8, bot - ch], [W - cw - 8, bot - ch]];
      const fits = ([a, b]) => a >= 8 && a + cw <= W - 8 && b >= top && b + ch <= bot;
      const hits = ([a, b]) => !(a + cw < sb.x0 - 6 || a > sb.x1 + 6 || b + ch < sb.y0 - 6 || b > sb.y1 + 6);
      let pick = null, best = 1e9; // the spot that covers the least of anything drawn, never the target
      spots.forEach((s, i) => { if (!fits(s)) return; const c = (hits(s) ? 5 : 0) + SEE.covered({ x0: s[0], y0: s[1], x1: s[0] + cw, y1: s[1] + ch }) * 3 + i * 0.04; if (c < best) { best = c; pick = s; } });
      pick = pick || [W - cw - 8, top];
      [x, y] = pick;
      markGoal.x = Math.max(sb.x0, Math.min(sb.x1, x > cx ? sb.x1 - 6 : sb.x0 + 6)); markGoal.y = Math.max(sb.y0 + 4, Math.min(sb.y1 - 4, (sb.y0 + sb.y1) / 2));
    } else { markGoal.x = x + 17; markGoal.y = y + 20; }
    if (!card.classList.contains('on')) { markGoal.x = W - 30; markGoal.y = H - (host.on ? 100 : 30); }
    card.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    const k = 0.18; markPos.x += (markGoal.x - markPos.x) * k; markPos.y += (markGoal.y - markPos.y) * k;
    mark.style.left = markPos.x + 'px'; mark.style.top = markPos.y + 'px';
    tether.innerHTML = sb && card.classList.contains('on') ? `<path d="M${(x > markPos.x ? x : x + cw).toFixed(0)} ${(y + 20).toFixed(0)} L${markPos.x.toFixed(0)} ${markPos.y.toFixed(0)}"/>` : '';
  }

  // ---------- the composer: talking on the canvas ----------
  function send(text, extra = {}) {
    text = String(text).trim(); if (!text) return;
    const msg = Object.assign({ type: 'say', text, kind: 'chat' }, ctx ? { kind: 'ask', visual: ctx.key, part: ctx.label || ctx.id, id: ctx.id, file: ctx.file || undefined } : {}, extra);
    host.post(msg);
    talk.push({ who: 'you', text, kind: msg.kind, local: true });
    setBusy(true, 'thinking…');
    ctx = null; ctxChip.textContent = '';
  }
  composer.querySelector('form').addEventListener('submit', e => { e.preventDefault(); send(input.value); input.value = ''; input.style.height = ''; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); composer.querySelector('form').requestSubmit(); } if (e.key === 'Escape') { ctx = null; ctxChip.textContent = ''; input.blur(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
  ctxChip.addEventListener('click', () => { ctx = null; ctxChip.textContent = ''; });
  function about(sel) { ctx = sel; ctxChip.textContent = 'about: ' + (sel.label || sel.id) + '  ×'; input.focus(); }
  function setBusy(on, what) { busy = on; status = on ? what || 'working…' : ''; mark.classList.toggle('busy', on); card.querySelector('.st').textContent = status; }
  SEE.on('say', (text, extra) => send(text, extra || {}));

  // ---------- hover: what is under the cursor ----------
  SEE.on('hover', (h, hit) => {
    canvas.classList.toggle('over', !!h);
    if (!h) { tip.classList.remove('on'); return; }
    const v = SEE.visuals.get(h.key), p = hit.info;
    const name = h.label || h.id || p.label || p.id || p.type;
    const file = p.file || fileOf(v, h.id);
    tip.innerHTML = esc(name) + (file ? ` <span class="f">${esc(file)}</span>` : '') + (hasInsides(v, h.id) ? ' <span class="f">· double-click to open</span>' : '');
    tip.classList.add('on');
  });
  canvas.addEventListener('pointermove', e => { tip.style.transform = `translate(${e.offsetX + 14}px, ${e.offsetY + 16}px)`; });
  canvas.addEventListener('pointerleave', () => tip.classList.remove('on'));
  function fileOf(v, id) {
    const e = v.C.ids.get(id); if (!e) return null;
    for (const i of e.parts) if (v.C.parts[i].src) return v.C.parts[i].src;
    return null;
  }
  function hasInsides(v, id) { return v.C.lods.some(L => L.id === id && L.open.length); }

  // ---------- selection ----------
  function select(h, x, y) {
    const v = h.v, g = SEE.groupOf(v, h.part);
    SEE.ws.selection = { key: v.key, id: g.id, label: g.label || g.id, li: g.li, parts: g.parts, file: v.C.parts[h.part].src || fileOf(v, g.id) };
    for (const q of SEE.visuals.values()) q.dirty = true;
    renderSel();
    saveState();
  }
  function clearSelection() { SEE.ws.selection = null; sel.classList.remove('on'); for (const q of SEE.visuals.values()) q.dirty = true; saveState(); }
  function renderSel() {
    const s = SEE.ws.selection; if (!s) { sel.classList.remove('on'); return; }
    const v = SEE.visuals.get(s.key), ins = hasInsides(v, s.id), opened = ins && v.C.lods.some((L, li) => L.id === s.id && v.lodState[li]);
    sel.innerHTML = `<div class="t">${esc(s.label || s.id || 'part')}</div>${s.file ? `<div class="f" title="${esc(s.file)}">${esc(s.file)}</div>` : ''}<div class="row"></div><div class="h">drag it to move ${esc(v.title)}</div>`;
    const row = sel.querySelector('.row');
    const acts = [['Ask', () => about(s)], ['Explain', () => send(`Explain ${s.label || s.id}`, { kind: 'explain', visual: s.key, part: s.label || s.id, id: s.id, file: s.file })],
      ...(s.file && host.on ? [['Open file', () => host.post({ type: 'open', file: s.file })]] : []),
      [opened ? 'Close' : 'Open', () => expand(s.key, s.id)], ['Focus', () => focusVisual(s.key, [s.id])], ['Compare…', () => startCompare(s)]];
    for (const [label, fn] of acts) { const b = el('button', 'pill', label); b.addEventListener('click', fn); row.appendChild(b); }
    sel.classList.add('on');
  }
  function placeSel() {
    const s = SEE.ws.selection; if (!s || !sel.classList.contains('on')) return;
    const v = SEE.visuals.get(s.key); if (!v) return;
    const sb = SEE.partsOnScreen(v, [...s.parts]), [W, H] = SEE.core.size(), w = sel.offsetWidth, h = sel.offsetHeight;
    if (!sb) { sel.style.opacity = 0.4; return; } sel.style.opacity = 1;
    const top = 52, bot = H - (host.on ? 80 : 12), cl = (a, lo, hi) => Math.max(lo, Math.min(hi, a)), cx = (sb.x0 + sb.x1) / 2;
    const spots = [[sb.x1 + 14, cl(sb.y0, top, bot - h)], [sb.x0 - w - 14, cl(sb.y0, top, bot - h)], [cl(cx - w / 2, 8, W - w - 8), sb.y1 + 12], [cl(cx - w / 2, 8, W - w - 8), sb.y0 - h - 12],
      [8, bot - h], [W - w - 8, bot - h], [8, top + 40]];
    let x = W - w - 8, y = top, best = 1e9;
    spots.forEach(([a, b], i) => { if (a < 8 || a + w > W - 8 || b < top || b + h > bot) return;
      const over = !(a + w < sb.x0 || a > sb.x1 || b + h < sb.y0 || b > sb.y1), cr = card.classList.contains('on') ? card.getBoundingClientRect() : null;
      const onCard = cr && !(a + w < cr.left || a > cr.right || b + h < cr.top || b > cr.bottom);
      const c = (over ? 4 : 0) + (onCard ? 3 : 0) + SEE.covered({ x0: a, y0: b, x1: a + w, y1: b + h }) * 2 + i * 0.05;
      if (c < best) { best = c; x = a; y = b; } });
    sel.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  let comparing = null;
  function startCompare(s) { comparing = s; mark.querySelector('.tag').textContent = 'pick the other one…'; sel.classList.remove('on'); }
  function finishCompare(b) {
    const a = comparing; comparing = null; mark.querySelector('.tag').textContent = '';
    if (a.key !== b.key && SEE.ws.layout !== 'row') { SEE.arrange('row'); renderShelf(); }
    SEE.frame([a.key, b.key].filter((x, i, l) => l.indexOf(x) === i));
    send(`Compare ${a.label || a.id} (${a.key}) with ${b.label || b.id} (${b.key})`, { kind: 'compare', visual: a.key, part: a.label || a.id, other: { visual: b.key, part: b.label || b.id, id: b.id } });
  }

  // ---------- open a part into its insides ----------
  function expand(key, id) {
    const v = SEE.visuals.get(key); if (!v) return;
    const li = v.C.lods.findIndex(L => L.id === id);
    if (li >= 0) {
      const open = v.lodState[li];
      if (open) { v.opened.delete(li); v.closedForce.add(li); } else { v.closedForce.delete(li); v.opened.add(li); }
      v.dirty = true;
      if (!open) setTimeout(() => SEE.frame({ key, ids: [id] }), 60);
      setTimeout(renderSel, 50); saveState();
      return true;
    }
    send(`Open up ${id}: show what is inside it`, { kind: 'expand', visual: key, part: id, id });
    return false;
  }

  // ---------- pointer: click selects, double-click opens, drag a selected visual moves it, right-click is the menu ----------
  let moving = null;
  SEE.hooks.down = e => {
    closeMenu();
    const h = SEE.partAt(e.offsetX, e.offsetY);
    if (h && SEE.live && e.button === 0 && !e.shiftKey) { // a living world's drag handlers come first
      const hit = SEE.hitInfo(h, e.offsetX, e.offsetY);
      if (LIVE.grab(h.v.key, hit)) { moving = { live: h.v.key, hit }; return true; }
    }
    if (h && e.button === 0 && (e.altKey || (SEE.ws.selection && SEE.ws.selection.key === h.v.key))) moving = { key: h.v.key, start: SEE.groundAt(e.offsetX, e.offsetY, h.v.pos.y), from: h.v.goal.clone() };
    return true;
  };
  SEE.hooks.drag = (e, d) => {
    if (!moving) return true;
    if (moving.live) { const at = SEE.rayPlane(e.offsetX, e.offsetY, moving.hit); LIVE.drag(moving.live, at, 'move'); return false; }
    const v = SEE.visuals.get(moving.key), p = SEE.groundAt(e.offsetX, e.offsetY, v.pos.y);
    if (!p || !moving.start) return false;
    if (SEE.ws.layout !== 'free') { SEE.ws.layout = 'free'; renderShelf(); }
    v.goal.copy(moving.from).add(p.sub(moving.start).setY(0)); moving.moved = true;
    return false;
  };
  SEE.hooks.up = (e, d) => {
    const m = moving; moving = null;
    if (m && m.live) { LIVE.drag(m.live, SEE.rayPlane(e.offsetX, e.offsetY, m.hit), 'end'); if (d.moved) return; }
    if (m && m.moved) { saveState(); return; }
    if (d.moved) return;
    const h = SEE.partAt(e.offsetX, e.offsetY);
    if (e.button === 2) { openMenu(h, e.offsetX, e.offsetY); return; }
    if (e.button !== 0) return;
    if (h && LIVE.click(h.v.key, SEE.hitInfo(h, e.offsetX, e.offsetY))) return;
    if (comparing && h) { const g = SEE.groupOf(h.v, h.part); finishCompare({ key: h.v.key, id: g.id, label: g.label }); return; }
    if (h) select(h, e.offsetX, e.offsetY); else clearSelection();
  };
  canvas.addEventListener('dblclick', e => {
    const h = SEE.partAt(e.offsetX, e.offsetY);
    if (!h) { SEE.ws.focus = null; SEE.frame(null); renderShelf(); return; }
    const g = SEE.groupOf(h.v, h.part);
    // the innermost node that has insides
    const ids = [...h.info.ids].reverse(), withIns = ids.find(id => hasInsides(h.v, id));
    expand(h.v.key, withIns || g.id);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function openMenu(h, x, y) {
    const items = [];
    if (h) {
      const g = SEE.groupOf(h.v, h.part), s = { key: h.v.key, id: g.id, label: g.label || g.id, parts: g.parts, file: h.info.src || fileOf(h.v, g.id) };
      items.push(['t', s.label || 'part'], ['Ask about it…', () => { select(h); about(s); }], ['Explain it', () => send(`Explain ${s.label}`, { kind: 'explain', visual: s.key, part: s.label, id: s.id, file: s.file })]);
      if (s.file && host.on) items.push(['Open file', () => host.post({ type: 'open', file: s.file })]);
      items.push([hasInsides(h.v, s.id) ? 'Open / close its insides' : 'Show what is inside', () => expand(s.key, s.id)], ['Focus on it', () => focusVisual(s.key, [s.id])],
        ['Compare with…', () => startCompare(s)], ['Hide it', () => { h.v.live.set(s.id, Object.assign(h.v.live.get(s.id) || {}, { hide: true })); h.v.dirty = true; }], ['sep'],
        ['Show only this visual', () => { for (const k of [...SEE.visuals.keys()]) if (k !== s.key) removeVisual(k, true); focusVisual(s.key); }],
        ['Remove this visual', () => removeVisual(s.key, true)]);
    }
    items.push(['sep'], ['Show everything', () => { for (const v of SEE.visuals.values()) { for (const [id, L] of v.live) if (L.hide) v.live.set(id, Object.assign(L, { hide: false })); v.dirty = true; } SEE.ws.focus = null; SEE.frame(null); renderShelf(); }]);
    if (SEE.visuals.size > 1) items.push(['Arrange side by side', () => { SEE.arrange('row'); renderShelf(); saveState(); }], ['Arrange in a grid', () => { SEE.arrange('grid'); renderShelf(); saveState(); }]);
    menu.innerHTML = '';
    for (const [label, fn] of items) {
      if (label === 'sep') { if (menu.lastChild && !menu.lastChild.classList.contains('sep')) menu.appendChild(el('div', 'sep')); continue; }
      if (label === 't') { menu.appendChild(el('div', 't', esc(fn))); continue; }
      const b = el('button', null, esc(label)); b.addEventListener('click', () => { closeMenu(); fn(); }); menu.appendChild(b);
    }
    const [W, H] = SEE.core.size();
    menu.classList.add('on');
    menu.style.left = Math.min(x, W - menu.offsetWidth - 8) + 'px'; menu.style.top = Math.min(y, H - menu.offsetHeight - 8) + 'px';
  }
  function closeMenu() { menu.classList.remove('on'); }
  addEventListener('pointerdown', e => { if (!menu.contains(e.target)) closeMenu(); });

  // ---------- living worlds: controls and status beside the world ----------
  function renderLive() {
    const key = SEE.ws.focus && LIVE.programs.has(SEE.ws.focus) ? SEE.ws.focus : [...LIVE.programs.keys()].find(k => SEE.visuals.has(k));
    const R = key && LIVE.programs.get(key);
    livebox.classList.toggle('on', !!R); if (!R) return;
    livebox.dataset.key = key;
    livebox.querySelector('.ttl').textContent = SEE.visuals.get(key).title;
    const box = livebox.querySelector('.ctl'); box.innerHTML = '';
    for (const h of R.controls) box.appendChild(controlEl(R, h));
    livebox.querySelector('.st').innerHTML = LIVE.inline(R.statusText || '');
  }
  function controlEl(R, h) {
    const c = h.c, call = v => { try { c.on && c.on(v); } catch (err) { console.error(err); } };
    let e;
    if (c.type === 'slider') {
      const lg = !!c.log, to = v => (lg ? Math.log10(v) : v), from = x => (lg ? Math.pow(10, x) : x);
      const fmt = c.format || (v => (Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(0) : +(+v).toPrecision(3)) + '');
      e = el('label', null, `<span>${esc(c.label || '')}</span><input type="range"><output></output>`);
      const inp = e.querySelector('input'), out = e.querySelector('output');
      inp.min = to(c.min ?? 0); inp.max = to(c.max ?? 1); inp.step = c.step ? (lg ? 0.01 : c.step) : 'any';
      const set = v => { inp.value = to(v); out.textContent = fmt(v); }; set(h.value ?? c.min ?? 0);
      h.set = v => { h.value = v; set(v); };
      inp.addEventListener('input', () => { const v = from(+inp.value); h.value = v; out.textContent = fmt(v); call(v); });
    } else if (c.type === 'select') {
      e = el('label', null, `<span>${esc(c.label || '')}</span><select>${(c.options || []).map(o => `<option>${esc(o)}</option>`).join('')}</select>`);
      const s = e.querySelector('select'); if (h.value != null) s.value = h.value; h.set = v => { h.value = v; s.value = v; };
      s.addEventListener('change', () => { h.value = s.value; call(s.value); });
    } else if (c.type === 'toggle') {
      e = el('button', 'pill'); const set = v => { h.value = !!v; e.textContent = h.value ? (c.onLabel || c.label) : c.label; e.classList.toggle('on', h.value); };
      set(h.value); h.set = set; e.addEventListener('click', () => { set(!h.value); call(h.value); });
    } else { e = el('button', 'pill' + (c.primary ? ' on' : ''), esc(c.label || '')); h.set = v => { e.textContent = v; }; e.addEventListener('click', () => call()); }
    return e;
  }
  SEE.on('live-controls', key => renderLive());
  SEE.on('live-status', (key, html) => { if (livebox.dataset.key === key) livebox.querySelector('.st').innerHTML = html; });
  function placeLive() {
    if (!livebox.classList.contains('on')) return;
    const v = SEE.visuals.get(livebox.dataset.key); if (!v) return;
    const [, H] = SEE.core.size(), h = livebox.offsetHeight;
    livebox.style.transform = `translate(12px, ${(H - h - (host.on ? 72 : 36)).toFixed(0)}px)`;
  }

  // ---------- Claude's ops ----------
  async function apply(op) {
    const k = op.key;
    switch (op.op) {
      case 'add': case 'replace': {
        if (!op.scene) return;
        if (op.layout) SEE.ws.layout = op.layout;
        await SEE.addScene(k, op.scene, { stop: op.stop || 0, focus: false, keep: !!op.keep });
        if (op.keep) { renderShelf(); renderSel(); break; }
        if (op.focus !== false) { SEE.ws.focus = k; SEE.frame(SEE.visuals.size > 1 && !op.only ? null : [k]); }
        if (op.opened) { const v = SEE.visuals.get(k); for (const id of op.opened) expandOpen(v, id); }
        renderShelf(); renderTour(); renderLive(); break;
      }
      case 'remove': removeVisual(k); break;
      case 'clear': for (const key of [...SEE.visuals.keys()]) removeVisual(key); break;
      case 'arrange': if (op.order) reorder(op.order); SEE.arrange(op.layout || SEE.ws.layout); renderShelf(); break;
      case 'focus': if (k) focusVisual(k, op.ids); else { SEE.ws.focus = null; SEE.frame(null); renderShelf(); } break;
      case 'point': pointAt(k, [].concat(op.ids || op.id || []), op.tag, op.fly !== false); break;
      case 'highlight': { const v = SEE.visuals.get(k); if (!v) break; for (const id of [].concat(op.ids || op.id || [])) v.live.set(id, Object.assign(v.live.get(id) || {}, { glow: op.on === false ? 0 : (op.glow ?? 0.9) })); v.dirty = true; break; }
      case 'patch': { const v = SEE.visuals.get(k); if (!v) break; for (const [id, val] of Object.entries(op.set || {})) v.live.set(id, Object.assign(v.live.get(id) || {}, val)); v.dirty = true; break; }
      case 'stop': { const v = SEE.visuals.get(k); if (v) { SEE.ws.focus = k; SEE.applyStop(v, op.k ?? op.stop ?? 0); renderTour(); renderShelf(); } break; }
      case 'expand': { const v = SEE.visuals.get(k); if (v) { expandOpen(v, op.id); SEE.frame({ key: k, ids: [op.id] }); } break; }
      case 'collapse': { const v = SEE.visuals.get(k); if (v) { const li = v.C.lods.findIndex(L => L.id === op.id); if (li >= 0) { v.opened.delete(li); v.closedForce.add(li); v.dirty = true; } } break; }
      case 'select': { const v = SEE.visuals.get(k), e = v && v.C.ids.get(op.id); if (e && e.parts.length) select({ v, part: e.parts[0], info: v.C.parts[e.parts[0]] }); break; }
      case 'app': LIVE.claude(k, op.app, op); break;
      case 'view': SEE.frame(k ? [k] : null, { view: { yaw: (op.yaw || 0) * Math.PI / 180, pitch: (op.pitch || 0) * Math.PI / 180 } }); break;
    }
    saveState();
  }
  function expandOpen(v, id) { if (!v) return; const li = v.C.lods.findIndex(L => L.id === id); if (li >= 0) { v.closedForce.delete(li); v.opened.add(li); v.dirty = true; } else SEE.openPath(v, id); }
  function reorder(order) {
    const m = SEE.visuals, ents = [...m.entries()].sort((a, b) => { const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    m.clear(); for (const [k, v] of ents) m.set(k, v);
  }
  let queue = Promise.resolve();
  function onLine(l, replay) {
    talk.push(l);
    if (l.who === 'you') { if (!replay) setBusy(true, 'thinking…'); return; }
    if (l.kind === 'status') { if (!replay) setBusy(true, l.text); return; }
    if (!replay) setBusy(false);
    const ops = [...(l.ops || [])];
    const cur = /\[\[cur:([\s\S]*?)\]\]/.exec(l.text || ''); // the old say.py pointer
    if (cur) { try { const p = JSON.parse(cur[1]); const key = p.visual || SEE.ws.focus || [...SEE.visuals.keys()].pop(); if (key && p.id) ops.push({ op: 'point', key, id: p.id, tag: p.tag }); } catch {} }
    if (l.app) ops.push({ op: 'app', key: l.visual || null, app: l.app });
    queue = queue.then(async () => {
      for (const op of ops) { if (!replay || op.op !== 'point') await apply(op); if (!replay && op.wait) await new Promise(r => setTimeout(r, op.wait * 1000)); }
      if (!replay && (l.text || '').trim()) { const p = ops.find(o => o.op === 'point'); showCard(l, p ? { key: p.key, ids: [].concat(p.ids || p.id || []) } : null); }
    }).catch(err => console.error('op', err));
  }

  // ---------- the panel's state, for the next load and for Claude to read ----------
  let saveT = 0; const removedKeys = new Set();
  function saveState() {
    if (!host.on) return;
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const visuals = [...SEE.visuals.values()].map(v => ({ key: v.key, stop: v.stop, pos: v.goal.toArray().map(x => +x.toFixed(3)),
        opened: [...v.opened].map(li => v.C.lods[li] && v.C.lods[li].id).filter(Boolean),
        hidden: [...v.live].filter(([, L]) => L.hide).map(([id]) => id) }));
      const s = SEE.ws.selection;
      const removed = [...removedKeys]; removedKeys.clear();
      host.post({ type: 'state', state: { removed, layout: SEE.ws.layout, focus: SEE.ws.focus, visuals, selection: s ? { key: s.key, id: s.id, label: s.label, file: s.file } : null } });
    }, 300);
  }

  // ---------- messages from the host ----------
  addEventListener('message', async e => {
    const m = e.data || {};
    if (m.type === 'init') {
      for (const key of [...SEE.visuals.keys()]) SEE.remove(key, true);
      const W = m.workspace || {};
      SEE.ws.layout = W.layout || 'row';
      for (const it of W.visuals || []) if (it.scene) {
        await SEE.addScene(it.key, it.scene, { stop: it.stop || 0, focus: false });
        const v = SEE.visuals.get(it.key);
        if (W.layout === 'free' && it.pos) { v.goal.fromArray(it.pos); v.pos.copy(v.goal); }
        for (const id of it.opened || []) expandOpen(v, id);
        for (const id of it.hidden || []) v.live.set(id, { hide: true });
      }
      SEE.arrange(SEE.ws.layout);
      SEE.ws.focus = W.focus && SEE.visuals.has(W.focus) ? W.focus : null;
      SEE.frame(SEE.ws.focus ? [SEE.ws.focus] : null, { instant: true });
      talk.length = 0;
      for (const l of m.talk || []) onLine(l, true);
      const last = [...talk].reverse().find(l => l.who === 'claude' && l.kind !== 'status' && (l.text || '').trim());
      if (last) showCard(last, null);
      const lastAny = talk[talk.length - 1];
      if (lastAny && (lastAny.who === 'you' || lastAny.kind === 'status')) setBusy(true, lastAny.kind === 'status' ? lastAny.text : 'thinking…');
      renderShelf(); renderTour(); renderLive();
    }
    if (m.type === 'talk') for (const l of m.lines || []) onLine(l, false);
  });

  // ---------- every frame ----------
  SEE.on('frame', () => { placeCard(); placeSel(); placeLive(); });
  SEE.on('loaded', () => { renderShelf(); renderTour(); renderLive(); });
  const origAdd = SEE.addScene;
  SEE.addScene = async (key, scene, opts) => { const v = await origAdd(key, scene, opts); renderShelf(); return v; };
  SEE.insets = () => { // what the UI covers: the camera frames into the rest
    const [W, H] = SEE.core.size(), wide = W > 900;
    const bottom = Math.max(host.on ? 66 : 28, tour.classList.contains('on') ? (host.on ? 112 : 54) : 0, livebox.classList.contains('on') && !wide ? livebox.offsetHeight + 80 : 0);
    const left = livebox.classList.contains('on') && wide ? Math.min(W * 0.3, livebox.offsetWidth + 24) : 0;
    const right = card.classList.contains('on') && wide && !pointing ? Math.min(W * 0.32, card.offsetWidth + 24) : 0;
    return { top: 52, bottom, left, right };
  };
  SEE.ui = { apply, onLine, showCard, pointAt, select, expand, send, renderShelf, renderTour, talk, setBusy };
  host.post({ type: 'ready' });
}
