// live.js -- living worlds: a scene's `live` program runs in the page and moves the world's own parts.
// Same API as before (see.world, set, get, clear, text, loop, on, find, rebuild, control, status, say, view), now one per
// visual: each living world is a visual in the workspace and keeps running while others are added, moved, compared.
function makeLive(SEE) {
  const THREE = SEE.THREE, programs = new Map(); // key -> runtime
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

  function find(id, list) {
    for (const n of list || []) { if (!n || typeof n !== 'object') continue; if (String(n.id) === String(id)) return n;
      const r = find(id, n.parts) || find(id, n.zoom) || find(id, n.expand) || (n.part ? find(id, [n.part]) : null); if (r) return r; }
    return null;
  }
  // start a visual's program (before its first build, so it may write see.world)
  function prepare(key, scene) {
    if (typeof scene.live !== 'string' || !scene.live.trim()) return null;
    const R = { key, loops: [], clicks: [], drags: [], claude: [], stops: [], text: new Map(), dead: null, controls: [], statusText: '', grab: null };
    const v = () => SEE.visuals.get(key);
    const see = R.api = {
      world: scene.world, stops: scene.stops, state: {},
      set(id, val) { const V = v(); if (!V) return; id = String(id); if (val == null) V.live.delete(id); else V.live.set(id, Object.assign(V.live.get(id) || {}, val)); V.dirty = true; },
      get: id => { const V = v(); return V && V.live.get(String(id)); },
      clear() { const V = v(); if (V) { V.live.clear(); V.dirty = true; } },
      text(id, t) { R.text.set(String(id), String(t)); const V = v(); if (V) SEE.setNoteText(V, String(id), String(t)); },
      loop(fn) { R.loops.push(fn); },
      on(kind, a, b) { const fn = typeof a === 'function' ? a : b, only = typeof a === 'function' ? null : String(a);
        const list = { click: R.clicks, drag: R.drags, claude: R.claude, stop: R.stops }[kind]; if (!list) throw new Error('see.on: click, drag, claude or stop'); list.push({ fn, only }); },
      find: id => find(id, see.world),
      rebuild() { const V = v(); if (!V) return; V.worlds[0] = see.world; SEE.buildWorld(V, 0); SEE.applyStop(V, V.stop, true); },
      control(c) { const h = { c, value: c.value, set(x) { h.value = x; SEE.emit('live-controls', key); } }; R.controls.push(h); SEE.emit('live-controls', key); return h; },
      status(t) { R.statusText = String(t); SEE.emit('live-status', key, inline(R.statusText)); },
      say(text, state) { SEE.emit('say', String(text) + (state ? '\n[live state] ' + JSON.stringify(state) : ''), { kind: 'live', visual: key }); return true; },
      view: () => ({ target: SEE.cam.target.toArray(), dist: SEE.cam.dist, yaw: SEE.cam.yaw, pitch: SEE.cam.pitch }),
    };
    try { new Function('see', scene.live)(see); } catch (err) { fail(R, err); }
    if (scene.world) scene.world = see.world; // a program may write its world before the first build
    programs.set(key, R);
    return R;
  }
  function fail(R, err) {
    console.error('live:', err); R.loops.length = 0; R.dead = String(err && err.message || err);
    SEE.emit('live-status', R.key, 'The live program stopped: ' + esc(R.dead));
  }
  const match = (h, only) => !only || h.id === only || (h.ids || []).includes(only);
  SEE.on('frame', (dt, t) => {
    for (const R of programs.values()) for (const f of R.loops) { try { f(dt, t); } catch (err) { fail(R, err); } }
  });
  SEE.on('removed', key => programs.delete(key));
  SEE.on('stop', ({ key, k, stop }) => { const R = programs.get(key); if (R) for (const h of R.stops) { try { h.fn(k, stop); } catch (err) { fail(R, err); } } });
  // a click on a living world's part: its program first (return false to let the canvas handle it)
  function click(key, h) {
    const R = programs.get(key); if (!R) return false;
    let took = false;
    for (const c of R.clicks) if (match(h, c.only)) { let r; try { r = c.fn(h); } catch (err) { fail(R, err); } if (r !== false) took = true; }
    return took;
  }
  function grab(key, h) {
    const R = programs.get(key); if (!R) return false;
    const hs = R.drags.filter(d => match(h, d.only)); if (!hs.length) return false;
    R.grab = { h, hs };
    for (const d of hs) { try { d.fn(Object.assign({}, h, { phase: 'start' })); } catch (err) { fail(R, err); } }
    return true;
  }
  function drag(key, at, phase) {
    const R = programs.get(key); if (!R || !R.grab) return;
    for (const d of R.grab.hs) { try { d.fn(Object.assign({}, R.grab.h, { at: at || R.grab.h.at, phase })); } catch (err) { fail(R, err); } }
    if (phase === 'end') R.grab = null;
  }
  function claude(key, app, line) {
    const list = key ? [programs.get(key)] : [...programs.values()];
    for (const R of list) if (R) for (const h of R.claude) { try { h.fn(app, line); } catch (err) { fail(R, err); } }
  }
  return { prepare, programs, click, grab, drag, claude, inline };
}
