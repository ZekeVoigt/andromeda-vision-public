// app.js -- the canvas: a workspace of visuals, the camera, labels and notes, zoom levels, stops, picking.
// Everything else (the protocol with Claude, interaction, living worlds) builds on window.SEE.
function makeApp(THREE, core, SC) {
  const { camera } = core;
  const root = document.getElementById('stage'), canvas = document.getElementById('gl');
  const labelLayer = document.getElementById('labels'), leaderSvg = document.getElementById('leaders');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const now = () => performance.now() / 1000;
  const visuals = new Map(); // key -> visual
  let nextIndex = 1;
  const ws = { layout: 'row', gap: 0.35, focus: null, selection: null, hover: null };

  // ---------- theme ----------
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  function readTheme() {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    core.setTheme(dark, css('--ink') || (dark ? '#ececea' : '#151515'), css('--bg') || (dark ? '#111111' : '#f5f5f4'), css('--accent') || '#ff7a4d');
    for (const v of visuals.values()) for (const n of v.noteMeshes) n.userData.res = 0; // re-raster in the new ink
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  // ---------- a visual ----------
  function add(key, scene, opts = {}) {
    const old = visuals.get(key), keep = opts.keep && old ? { pos: old.pos.clone(), goal: old.goal.clone(), placed: old.placed, stop: old.stop,
      opened: [...old.opened].map(li => old.C.lods[li] && old.C.lods[li].id).filter(Boolean), ids: new Set(old.C.ids.keys()), live: old.live, index: old.index,
      centers: new Map([...old.C.ids].map(([id, e]) => { const b = new THREE.Box3(); e.parts.forEach(i => b.union(old.C.parts[i].box)); return [id, b.isEmpty() ? null : b.getCenter(new THREE.Vector3())]; })) } : null;
    if (old) remove(key, true);
    const v = { key, index: nextIndex++, scene, title: scene.title || key, kind: scene.kind || (scene.live ? 'living' : scene.stops && scene.stops.length > 1 ? 'tour' : 'picture'),
      group: new THREE.Group(), noteGroup: new THREE.Group(), stop: 0, live: new Map(), born: now(), pos: new THREE.Vector3(), goal: new THREE.Vector3(),
      opened: new Set(), closedForce: new Set(), worldIdx: 0, labelsEl: new Map(), slot: opts.slot, images: opts.images || {} };
    if (v.index > 255) v.index = 1 + (v.index % 250);
    if (scene.live && SEE.live) { v.kind = 'living'; SEE.live.prepare(key, scene); }
    v.worlds = scene.world ? [scene.world] : (scene.steps || []).map(s => s.shape || []);
    v.stops = scene.world ? (scene.stops || [{ caption: v.title }]) : (scene.steps || []);
    v.stop = Math.max(0, Math.min(v.stops.length - 1, keep ? keep.stop : opts.stop || 0));
    if (keep) { v.known = keep.ids; v.live = keep.live; }
    buildWorld(v, scene.world ? 0 : v.stop, true);
    core.scene.add(v.group); core.noteScene.add(v.noteGroup);
    visuals.set(key, v);
    if (keep) { // a refresh: same place, same open levels, same camera
      v.pos.copy(keep.pos); v.goal.copy(keep.goal); v.placed = keep.placed;
      for (const id of keep.opened) { const li = v.C.lods.findIndex(L => L.id === id); if (li >= 0) v.opened.add(li); }
      v.group.position.copy(v.pos); v.noteGroup.position.copy(v.pos);
      applyStop(v, v.stop, true, true);
      // what moved glides from where it was (the deepest id it shares with the old build)
      v.tween = new Float32Array(v.C.parts.length * 3); v.tweenT0 = now(); let any = false;
      const centers = new Map([...v.C.ids].map(([id, e]) => { const b = new THREE.Box3(); e.parts.forEach(i => b.union(v.C.parts[i].box)); return [id, b.isEmpty() ? null : b.getCenter(new THREE.Vector3())]; }));
      v.C.parts.forEach((p, i) => { for (let k = p.ids.length - 1; k >= 0; k--) { const a = keep.centers.get(p.ids[k]), b = centers.get(p.ids[k]); if (a && b) { const d = a.clone().sub(b); if (d.lengthSq() > 1e-8) { v.tween.set(d.toArray(), i * 3); any = true; } break; } } });
      if (!any) v.tween = null;
      const s = ws.selection; if (s && s.key === key) { const e = v.C.ids.get(s.id); if (e) s.parts = new Set(e.parts); else ws.selection = null; }
      return v;
    }
    arrange(true, key);
    if (opts.focus !== false) frame(opts.frameAll ? null : [key], { instant: visuals.size === 1 });
    applyStop(v, v.stop, true);
    return v;
  }
  function buildWorld(v, wi, first) {
    const t0 = now();
    if (v.mesh) { v.group.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose(); }
    for (const n of v.noteMeshes || []) { v.noteGroup.remove(n); n.material.map?.dispose(); n.material.dispose(); n.geometry.dispose(); }
    v.worldIdx = wi;
    v.C = SC.compile(v.worlds[wi], { assets: v.scene.assets || {}, images: v.images || {} });
    const C = v.C, np = C.parts.length;
    v.table = core.makeTable(Math.max(1, np));
    const R = C.bounds.getSize(new THREE.Vector3()).length() / 2;
    v.radius = Math.max(1e-3, R);
    v.mesh = new THREE.Mesh(C.geometry, core.materialFor(v.table.tex, v.index, reduce ? 0 : R * 0.6));
    v.mesh.frustumCulled = false;
    v.group.add(v.mesh);
    // per-part state that changes over time
    v.presence = new Float32Array(np).fill(0); v.target = new Float32Array(np);
    v.appear = new Float32Array(np);
    const order = C.parts.map((p, i) => i);
    const cy = C.bounds.min.y, hy = Math.max(1e-6, C.bounds.max.y - cy);
    // assembly order: bottom up, a little scattered, the whole thing within ~1.4 s
    for (const i of order) { const b = C.parts[i].box; v.appear[i] = t0 + (reduce ? -9 : 0.05 + 0.9 * ((b.min.y - cy) / hy) * 0.7 + 0.3 * Math.random() * 0.6); }
    if (v.known) for (let i = 0; i < np; i++) { const ids = C.parts[i].ids; if (ids.length && v.known.has(ids[ids.length - 1])) v.appear[i] = t0 - 9; } // a refresh: only what is new assembles
    for (let i = 0; i < np; i++) v.target[i] = v.presence[i] = C.parts[i].hidden ? 0 : 1;
    v.noteMeshes = C.notes.map((n, i) => noteMesh(n, i));
    v.noteMeshes.forEach(m => v.noteGroup.add(m));
    v.lodState = C.lods.map(() => false);
    v.flat = new Map(); // edge group override: part -> group part
    v.dirty = true;
    for (const L of v.labelsEl.values()) L.el.remove();
    v.labelsEl.clear();
  }
  function remove(key, quiet) {
    const v = visuals.get(key); if (!v) return;
    core.scene.remove(v.group); core.noteScene.remove(v.noteGroup);
    v.mesh.geometry.dispose(); v.mesh.material.dispose(); v.table.tex.dispose();
    for (const L of v.labelsEl.values()) L.el.remove();
    visuals.delete(key);
    SEE.emit('removed', key);
    if (!quiet) { arrange(); frame(null); }
  }

  // ---------- notes: words in the world, sharp at any zoom (text textures, re-rastered for the size on screen) ----------
  function noteMesh(n, i) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    m.position.copy(n.pos); m.quaternion.copy(n.quat);
    m.userData = { note: n, i, res: 0 };
    m.renderOrder = 1;
    return m;
  }
  function rasterNote(m, linePx) {
    const n = m.userData.note, lines = wrap(n), weight = n.weight === 'bold' ? 650 : 450;
    const font = `${weight} ${linePx}px Inter, -apple-system, system-ui, sans-serif`;
    const cv = document.createElement('canvas'), x = cv.getContext('2d'); x.font = font;
    const tw = Math.ceil(Math.max(1, ...lines.map(l => x.measureText(l).width))) + 4;
    const lh = Math.round(linePx * 1.3), th = lh * lines.length;
    const k = Math.min(1, 4096 / tw, 4096 / th);
    cv.width = Math.max(2, Math.ceil(tw * k)); cv.height = Math.max(2, Math.ceil(th * k));
    x.scale(k, k); x.font = font; x.textBaseline = 'middle'; x.textAlign = n.align === 'left' ? 'left' : 'center';
    const T = core.theme;
    x.fillStyle = n.hi ? '#' + T.acc.getHexString() : '#' + T.ink.getHexString();
    x.globalAlpha = n.quiet ? 0.6 : n.tone < -0.3 ? 0.7 : 1;
    x.lineJoin = 'round'; x.lineWidth = Math.max(2, linePx * 0.28); x.strokeStyle = '#' + T.bg.getHexString();
    lines.forEach((l, j) => x.strokeText(l, n.align === 'left' ? 2 : tw / 2, lh * (j + 0.5)));
    lines.forEach((l, j) => x.fillText(l, n.align === 'left' ? 2 : tw / 2, lh * (j + 0.5)));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    m.material.map?.dispose(); m.material.map = tex; m.material.needsUpdate = true;
    const wWorld = n.size / linePx * tw, hWorld = n.size * 1.3 * lines.length / 1.0 * (lh / (linePx * 1.3));
    m.scale.set(wWorld, hWorld, 1);
    m.position.copy(n.pos); if (n.align === 'left') m.position.add(new THREE.Vector3(wWorld / 2, 0, 0).applyQuaternion(n.quat));
    m.userData.res = linePx;
  }
  function wrap(n) {
    const raw = n.text.split('\n'); if (!n.width) return raw;
    const cv = wrap.cv || (wrap.cv = document.createElement('canvas').getContext('2d'));
    cv.font = `450 100px Inter, -apple-system, system-ui, sans-serif`;
    const maxW = n.width / n.size * 100, out = [];
    for (const para of raw) {
      let line = '';
      for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (cv.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
      out.push(line);
    }
    return out;
  }

  // ---------- the workspace: where each visual sits ----------
  function arrange(instant, only) {
    const list = [...visuals.values()];
    if (ws.layout === 'free') { for (const v of list) if (only && v.key === only && !v.placed) place(v, list); }
    else {
      const [cw, ch] = core.size(), tall = cw / ch < 0.95;
      if (ws.layout === 'row' && tall && list.length > 1) { // a tall panel: side by side reads as one above the other
        const gap = ws.gap * Math.max(...list.map(v => v.C.bounds.getSize(new THREE.Vector3()).y));
        let y = 0;
        list.forEach(v => { const b = v.C.bounds, c = b.getCenter(new THREE.Vector3()); v.goal.set(-c.x, y - b.max.y, -c.z);
          y -= (b.max.y - b.min.y) + gap + (b.max.z - b.min.z) * 0.55; if (instant || !v.placed) v.pos.copy(v.goal); v.placed = true; }); // depth too: seen from above, a deep one reaches up
        return;
      }
      const n = list.length, cols = ws.layout === 'grid' ? Math.ceil(Math.sqrt(n)) : n;
      const sizes = list.map(v => v.C.bounds.getSize(new THREE.Vector3()));
      const rowsN = Math.ceil(n / cols), colW = Array(cols).fill(0), rowD = Array(rowsN).fill(0);
      sizes.forEach((s, i) => { colW[i % cols] = Math.max(colW[i % cols], s.x); rowD[(i / cols) | 0] = Math.max(rowD[(i / cols) | 0], Math.max(s.z, s.y * 0.5)); });
      const gapX = ws.gap * Math.max(1, ...sizes.map(s => Math.max(s.x, s.y))) ;
      const totalW = colW.reduce((a, b) => a + b, 0) + gapX * (cols - 1);
      list.forEach((v, i) => {
        const c = i % cols, r = (i / cols) | 0, b = v.C.bounds, ctr = b.getCenter(new THREE.Vector3());
        const x = -totalW / 2 + colW.slice(0, c).reduce((a, q) => a + q, 0) + gapX * c + colW[c] / 2;
        const z = -rowD.slice(0, r).reduce((a, q) => a + q, 0) * 1.6 - r * gapX;
        v.goal.set(x - ctr.x, -b.min.y, z - ctr.z);
        if (instant || !v.placed) v.pos.copy(v.goal);
        v.placed = true;
      });
    }
  }
  function place(v, list) { // free layout: a new visual goes to the right of everything
    let maxX = -Infinity;
    for (const o of list) if (o !== v && o.placed) maxX = Math.max(maxX, o.pos.x + o.C.bounds.max.x);
    const b = v.C.bounds, ctr = b.getCenter(new THREE.Vector3());
    v.goal.set(isFinite(maxX) ? maxX + ws.gap * 4 + (ctr.x - b.min.x) - ctr.x : -ctr.x, -b.min.y, -ctr.z); v.pos.copy(v.goal); v.placed = true;
  }
  function worldBox(v, ids) { // a visual's box (or of some ids in it) in workspace terms
    const b = new THREE.Box3();
    if (ids && ids.length) for (const id of ids) {
      const e = v.C.ids.get(id); if (!e) continue;
      for (const i of e.parts) if (v.target[i] > 0 || !v.C.parts[i].hidden) b.union(v.C.parts[i].box);
      for (const i of e.notes) b.union(v.C.notes[i].box);
    }
    if (b.isEmpty()) b.copy(v.C.bounds);
    return b.translate(v.pos);
  }

  // ---------- the camera: orbit / zoom / pan with damping; flights between framings ----------
  const cam = { target: new THREE.Vector3(), yaw: 0.5, pitch: 0.32, dist: 10 };
  const goal = { target: new THREE.Vector3(), yaw: 0.5, pitch: 0.32, dist: 10 };
  let limits = { min: 0.5, max: 50 }, lastInput = -10, idleT = 0;
  function frameBox(b, view, opts = {}) { // the box's corners fit the view from this angle, exactly, with a margin
    const [W, H] = core.size(), c = b.getCenter(new THREE.Vector3());
    if (view) { goal.yaw = view.yaw; goal.pitch = view.pitch; }
    const I = SEE.insets ? SEE.insets() : { top: 0, bottom: 0, left: 0, right: 0 }; // room the UI takes: frame into what is left
    const Wf = Math.max(80, W - I.left - I.right), Hf = Math.max(80, H - I.top - I.bottom);
    const ty = Math.tan(camera.fov * Math.PI / 360) * Hf / H, tx = Math.tan(camera.fov * Math.PI / 360) * Wf / H, m = opts.margin || 1.08;
    const yw = goal.yaw, pt = goal.pitch;
    const back = new THREE.Vector3(Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt)); // from target to eye
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize(), up = new THREE.Vector3().crossVectors(back, right);
    let dist = 1e-3;
    for (let k = 0; k < 8; k++) {
      const q = new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).sub(c);
      const z = q.dot(back);
      dist = Math.max(dist, z + Math.abs(q.dot(right)) * m / tx, z + Math.abs(q.dot(up)) * m / ty);
    }
    // shift the target so the box sits in the middle of the free region, not of the whole canvas
    const perPx = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / H, dx = (I.right - I.left) / 2 * perPx, dy = (I.top - I.bottom) / 2 * perPx;
    goal.target.copy(c).addScaledVector(right, dx).addScaledVector(up, dy); goal.dist = dist;
    if (opts.instant) Object.assign(cam, { yaw: goal.yaw, pitch: goal.pitch, dist: goal.dist }), cam.target.copy(goal.target);
  }
  function frame(keys, opts = {}) { // frame visuals (all when null), or {key, ids}
    const b = new THREE.Box3();
    if (keys && keys.ids) { const v = visuals.get(keys.key); if (v) b.union(worldBox(v, keys.ids)); }
    else for (const v of visuals.values()) if (!keys || keys.includes(v.key)) { const g = v.C.bounds.clone().translate(v.goal); b.union(g); }
    if (b.isEmpty()) return;
    frameBox(b, opts.view, opts);
    const all = new THREE.Box3(); for (const v of visuals.values()) all.union(v.C.bounds.clone().translate(v.goal));
    const R = all.getBoundingSphere(new THREE.Sphere()).radius;
    const fitAll = R / Math.tan(camera.fov * Math.PI / 360); // the whole workspace fits around here
    limits = { min: Math.min(goal.dist, fitAll) / 14, max: Math.max(goal.dist, fitAll) * 2.5 };
  }
  const VIEWS = { 'three-quarter': [28, 16], front: [0, 6], side: [90, 6], back: [180, 10], top: [0, 88], below: [0, -60] };
  const viewOf = v => { if (!v) return null; if (typeof v === 'string') { const q = VIEWS[v]; return q && { yaw: q[0] * Math.PI / 180, pitch: q[1] * Math.PI / 180 }; }
    return { yaw: (v.yaw || 0) * Math.PI / 180, pitch: (v.pitch || 0) * Math.PI / 180 }; };
  function updateCamera(dt, t) {
    const k = 1 - Math.exp(-dt * 7);
    cam.target.lerp(goal.target, k); cam.yaw += (goal.yaw - cam.yaw) * k; cam.pitch += (goal.pitch - cam.pitch) * k;
    cam.dist *= Math.pow(goal.dist / cam.dist, k);
    // alive: a slow breathing sway when nobody is touching it
    const idle = t - lastInput > 4 && !reduce && !dragging;
    idleT += idle ? dt : 0;
    const sway = idle ? 0.035 * Math.sin(idleT * 0.25) * Math.min(1, (t - lastInput - 4) / 3) : 0;
    const yaw = cam.yaw + sway, p = Math.max(-1.45, Math.min(1.5, cam.pitch));
    camera.position.set(cam.target.x + cam.dist * Math.sin(yaw) * Math.cos(p), cam.target.y + cam.dist * Math.sin(p), cam.target.z + cam.dist * Math.cos(yaw) * Math.cos(p));
    camera.up.set(0, 1, 0); camera.lookAt(cam.target);
    camera.near = Math.max(cam.dist * 0.02, 1e-3); camera.far = cam.dist * 30 + 50; camera.updateProjectionMatrix();
  }

  // ---------- input: drag to orbit, right/shift-drag to pan, wheel to zoom toward the cursor ----------
  let dragging = null;
  canvas.addEventListener('contextmenu', e => { if (dragging && dragging.moved) e.preventDefault(); });
  canvas.addEventListener('pointerdown', e => {
    if (SEE.hooks.down && SEE.hooks.down(e) === false) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1, moved: false, t: now() };
    lastInput = now();
  });
  canvas.addEventListener('pointermove', e => {
    lastInput = now();
    if (!dragging) { hoverAt = [e.offsetX, e.offsetY]; return; }
    const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; dragging.x = e.clientX; dragging.y = e.clientY;
    if (Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) > 4) dragging.moved = true;
    if (!dragging.moved) return;
    if (SEE.hooks.drag && SEE.hooks.drag(e, dragging) === false) return;
    if (dragging.pan) pan(dx, dy);
    else { goal.yaw -= dx * 0.008; goal.pitch = Math.max(-1.4, Math.min(1.45, goal.pitch + dy * 0.006)); }
  });
  canvas.addEventListener('pointerup', e => {
    const d = dragging; dragging = null; lastInput = now();
    if (d && SEE.hooks.up) SEE.hooks.up(e, d);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); lastInput = now();
    const f = Math.exp(Math.max(-0.6, Math.min(0.6, e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
    zoomAt(e.offsetX, e.offsetY, f);
  }, { passive: false });
  function pan(dx, dy) {
    const [, H] = core.size(), s = 2 * goal.dist * Math.tan(camera.fov * Math.PI / 360) / H;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    goal.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }
  function zoomAt(x, y, f) { // the point under the cursor stays under it
    const nd = Math.max(limits.min, Math.min(limits.max, goal.dist * f)), real = nd / goal.dist;
    const [W, H] = core.size(), ndc = new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), goal.target);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (hit) goal.target.lerp(hit, 1 - real);
    goal.dist = nd;
  }

  // ---------- stops: what a step of a tour (or the one picture) focuses, lights and hides ----------
  function applyStop(v, k, first, noFrame) {
    v.stop = Math.max(0, Math.min(v.stops.length - 1, k));
    const s = v.stops[v.stop] || {};
    if (!v.scene.world && v.worldIdx !== v.stop && !first) buildWorld(v, v.stop); // the steps form: each step its own object
    const list = x => (x == null ? [] : Array.isArray(x) ? x.map(String) : typeof x === 'string' ? [x] : []);
    v.st = { focus: list(s.focus), highlight: new Set(list(s.highlight)), hide: new Set(list(s.hide)), animate: s.animate || {},
      dim: s.dim !== false, labels: s.labels ? new Set(list(s.labels)) : null, region: s.focus && typeof s.focus === 'object' && !Array.isArray(s.focus) ? s.focus : null };
    // a focus inside a closed zoom level opens it
    for (const id of v.st.focus) openPath(v, id);
    v.dirty = true;
    if (!noFrame && (!first || visuals.size === 1)) {
      const view = viewOf(s.view) || (v.st.focus.length ? null : viewOf(v.scene.view) || { yaw: 0.45, pitch: 0.3 });
      if (v.st.region) frameBox(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...v.st.region.at).add(v.goal), new THREE.Vector3(1, 1, 1).multiplyScalar(2 * (v.st.region.radius || 1))), view);
      else if (v.st.focus.length) frame({ key: v.key, ids: v.st.focus }, { view: view || autoView(v, v.st.focus) });
      else frame([v.key], { view, instant: first && visuals.size === 1 });
    }
    SEE.emit('stop', { key: v.key, k: v.stop, stop: s });
  }
  function autoView(v, ids) { // a sheet face-on, something flat from above, a solid three-quarter front
    const s = worldBox(v, ids).getSize(new THREE.Vector3()), m = Math.max(s.x, s.y, s.z) || 1;
    if (s.z < m * 0.18) return { yaw: 0.12, pitch: 0.1 };
    if (s.y < m * 0.18) return { yaw: 0.2, pitch: 1.0 };
    return { yaw: 0.45, pitch: 0.3 };
  }
  function openPath(v, id) { // open every zoom level that holds this id
    const e = v.C.ids.get(id); if (!e) return;
    for (const i of e.parts) { let L = v.C.parts[i].lod; while (L >= 0) { if (v.C.lods[L].open.includes(i) || v.C.lods[L].id === id) v.opened.add(L); L = v.C.lods[L].parent; } }
  }

  // ---------- the part table: base + stop + live + selection, uploaded when it changes ----------
  function resolveLive(v, part) { // a part's live values: its own id's and every group's above it
    const out = { move: [0, 0, 0], tone: 0, glow: 0, hide: false, width: 1, flat: null, any: false };
    for (const id of part.ids) {
      const L = v.live.get(id); if (!L) continue; out.any = true;
      if (L.move) for (let a = 0; a < 3; a++) out.move[a] += L.move[a] || 0;
      if (typeof L.tone === 'number') out.tone += L.tone;
      if (typeof L.glow === 'number') out.glow = Math.max(out.glow, L.glow);
      if (L.hide) out.hide = true;
      if (typeof L.width === 'number') out.width *= L.width;
      if (L.flat && out.flat == null) out.flat = id;
    }
    return out;
  }
  const ANIMK = { glow: 1, pulse: 2, flow: 3 };
  function writeTable(v, t) {
    const C = v.C, d = v.table.data, st = v.st || { focus: [], highlight: new Set(), hide: new Set(), animate: {} };
    const focusSet = new Set(); for (const id of st.focus) { const e = C.ids.get(id); if (e) e.parts.forEach(i => focusSet.add(i)); }
    const dimOn = st.dim && focusSet.size > 0 && focusSet.size < C.parts.length;
    const flatFirst = new Map();
    for (let i = 0; i < C.parts.length; i++) {
      const p = C.parts[i], o = i * 16, L = resolveLive(v, p);
      let hi = p.hi, anim = p.anim;
      for (const id of p.ids) { if (st.highlight.has(id)) hi = true; if (st.animate[id]) { const a = st.animate[id]; anim = { kind: ANIMK[a.type] || 1, period: a.period ?? 2, delay: a.delay ?? 0, strength: a.strength ?? 1, reverse: !!a.reverse }; } }
      let relLit = false;
      if (p.rel) { const on = q => q && q.key === v.key && (p.rel.includes(q.id) || p.ids.includes(q.id)); relLit = on(ws.selection) || on(ws.hover); if (relLit) hi = true; }
      const hid = L.hide || p.ids.some(id => st.hide.has(id));
      const relOff = p.rel && !relLit && ws.selection && ws.selection.key === v.key; // a selection shows only its own relations
      v.target[i] = hid || relOff ? 0 : lodVisible(v, i) ? 1 : 0;
      d[o] = L.move[0]; d[o + 1] = L.move[1]; d[o + 2] = L.move[2]; d[o + 3] = v.presence[i];
      if (v.tween) { const k = v.tweenK; d[o] += v.tween[i * 3] * k; d[o + 1] += v.tween[i * 3 + 1] * k; d[o + 2] += v.tween[i * 3 + 2] * k; }
      const sel = ws.selection && ws.selection.key === v.key && ws.selection.parts.has(i), hov = ws.hover && ws.hover.key === v.key && ws.hover.parts.has(i);
      const relDim = p.rel && !relLit && ws.selection && ws.selection.key === v.key;
      const flags = (hi ? 1 : 0) | ((dimOn && !focusSet.has(i)) || relDim ? 2 : 0) | (p.quiet && !relLit ? 4 : 0) | (sel ? 8 : 0) | (hov ? 16 : 0) | (p.rel && !relLit ? 32 : 0);
      d[o + 4] = p.tone + L.tone; d[o + 5] = L.glow; d[o + 6] = flags; d[o + 7] = L.width;
      if (anim) { d[o + 8] = anim.kind; d[o + 9] = Math.max(0.2, anim.period); d[o + 10] = anim.delay; d[o + 11] = (anim.reverse ? -1 : 1) * Math.max(0, Math.min(1, anim.strength ?? 1)); }
      else { d[o + 8] = 0; d[o + 9] = 1; d[o + 10] = 0; d[o + 11] = 0; }
      let edge = i;
      if (L.flat) { if (!flatFirst.has(L.flat)) flatFirst.set(L.flat, i); edge = flatFirst.get(L.flat); }
      d[o + 12] = edge; d[o + 13] = v.appear[i] - v.born + v.bornGL; d[o + 14] = 0; d[o + 15] = 0;
    }
    v.table.tex.needsUpdate = true;
  }
  function lodVisible(v, i) { // inside every zoom level above it, on the right side (closed form vs open insides)
    const C = v.C; let L = C.parts[i].lod, child = i;
    while (L >= 0) {
      const lod = C.lods[L], open = v.lodState[L], inOpen = lod.open.includes(child);
      if (open !== inOpen) return false;
      L = lod.parent;
    }
    return true;
  }
  function stepLods(v) { // a zoom level opens once it fills enough of the view (or someone opened it)
    let changed = false;
    const [, H] = core.size();
    v.C.lods.forEach((L, li) => {
      const forced = v.opened.has(li), closed = v.closedForce.has(li);
      let want = forced && !closed;
      if (!want && !closed) {
        const b = L.box.clone().translate(v.pos), s = b.getBoundingSphere(new THREE.Sphere());
        const dd = camera.position.distanceTo(s.center), fill = dd <= s.radius ? 99 : (2 * s.radius / (2 * dd * Math.tan(camera.fov * Math.PI / 360)));
        const q = s.center.clone().project(camera), central = Math.abs(q.x) < 0.45 && Math.abs(q.y) < 0.45 && q.z < 1; // what you zoom into, not its neighbours
        want = fill >= (v.lodState[li] ? L.zoomAt * 0.85 : L.zoomAt) && (central || dd <= s.radius);
      }
      if (want !== v.lodState[li]) { v.lodState[li] = want; changed = true; }
    });
    if (changed) v.dirty = true;
  }

  // ---------- labels: never on top of each other, never over the thing they name ----------
  const project = (p, W, H) => { const q = p.clone().project(camera); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H, q.z]; };
  function screenBox(b, W, H) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = 0;
    for (let k = 0; k < 8; k++) {
      const [x, y, z] = project(new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z), W, H);
      if (z > 1) behind++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return behind === 8 ? null : { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  const _v = new THREE.Vector3();
  let seen = null, seenAt = 0;
  function covered(r) { // the share of a screen rect over visible geometry (from the id buffer read back)
    if (!seen || !seen.buf) return 0;
    const { buf, w, h, sx, sy } = seen, H = core.size()[1];
    const x0 = Math.max(0, Math.floor(r.x0 / sx)), x1 = Math.min(w - 1, Math.floor(r.x1 / sx)), ya = Math.max(0, Math.floor((H - r.y1) / sy)), yb = Math.min(h - 1, Math.floor((H - r.y0) / sy));
    let n = 0, on = 0;
    for (let y = ya; y <= yb; y++) for (let x = x0; x <= x1; x++) { n++; if (buf[(y * w + x) * 4]) on++; }
    return n ? on / n : 0;
  }
  function strokeDensity() { // strokes covering much of their visual's area fade toward a tone (the old bundle rule)
    for (const v of visuals.values()) {
      let ink = 0, area = 0;
      for (const [key, e] of seen.map) { if ((key >> 16) !== v.index) continue; const p = v.C.parts[key & 65535]; if (!p) continue; area += e.n; if (p.path) ink += e.n; }
      const frac = area ? ink / area : 0, k = Math.max(0.25, Math.min(1, Math.pow(0.22 / Math.max(1e-6, frac), 0.8)));
      const u = v.mesh.material.uniforms.uStrokeK; u.value += (k - u.value) * 0.3;
    }
  }
  function seenBox(v, parts) { // the label's parts as they are actually seen (null: hidden behind something, or off screen)
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, tx = 0;
    for (const i of parts) {
      const e = seen.map.get(v.index * 65536 + i); if (!e) continue;
      n += e.n; if (e.y0 < y0) { y0 = e.y0; tx = e.tx; } x0 = Math.min(x0, e.x0); x1 = Math.max(x1, e.x1); y1 = Math.max(y1, e.y1);
    }
    return n >= 3 ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, tx, n } : null;
  }
  function screenHull(v, parts, W, H) { // the parts' real outline on screen (their hull points), and its top point
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, tx = 0, n = 0;
    const per = Math.max(1, Math.floor(parts.length / 40));
    for (let k = 0; k < parts.length; k += per) {
      const i = parts[k], h = v.C.parts[i].hull, o = i * 16, d = v.table.data;
      if (!h) continue;
      for (let j = 0; j < h.length; j += 3) {
        _v.set(h[j] + d[o] + v.pos.x, h[j + 1] + d[o + 1] + v.pos.y, h[j + 2] + d[o + 2] + v.pos.z).project(camera);
        if (_v.z > 1) continue;
        const x = (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H; n++;
        if (y < y0) { y0 = y; tx = x; }
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return n ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, tx } : null;
  }
  const overlap = (a, b, pad = 3) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  function layoutLabels() {
    const [W, H] = core.size(), placed = [], cands = [];
    for (const v of visuals.values()) {
      const st = v.st || {}, focusIds = new Set(st.focus || []);
      v.C.labels.forEach((lab, li) => {
        const vis = lab.parts.filter(i => v.presence[i] > 0.5);
        if (!vis.length && !lab.notes.length) return;
        if (st.labels && !(lab.id && st.labels.has(lab.id))) return;
        const sb = seen ? seenBox(v, vis) : screenHull(v, vis, W, H);
        if (!sb || sb.x1 < 0 || sb.x0 > W || sb.y1 < 0 || sb.y0 > H) return;
        const focus = lab.ids.some(id => focusIds.has(id)), area = Math.min(sb.w, W) * Math.min(sb.h, H);
        const sel = ws.selection && ws.selection.key === v.key && ws.selection.label === li;
        cands.push({ v, li, lab, sb, rank: (sel ? 1e12 : 0) + (focus ? 1e9 : 0) + area * (lab.quiet ? 0.2 : 1) });
      });
    }
    cands.sort((a, b) => b.rank - a.rank);
    const zoomed = cands.length && cands[0].sb.h > H * 0.5;
    const maxN = Math.min(zoomed ? 16 : 10, cands.length);
    const used = new Set(), lines = [];
    const avoid = cands.slice(0, 40).map(c => c.sb).filter(s => s.w * s.h < W * H * 0.2); // small parts: never cover them
    for (const c of cands) {
      if (used.size >= maxN) break;
      const key = c.v.key + ':' + c.li;
      let L = c.v.labelsEl.get(c.li);
      if (!L) { L = { el: document.createElement('div'), x: null, y: null }; L.el.className = 'lbl'; L.el.textContent = c.lab.text; labelLayer.appendChild(L.el); c.v.labelsEl.set(c.li, L); L.el.dataset.key = c.v.key; L.el.dataset.li = c.li; }
      const w = L.el.offsetWidth || 8 * c.lab.text.length, h = L.el.offsetHeight || 20, s = c.sb;
      const cx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, s.tx)), big = s.h > H * 0.55 || s.w > W * 0.7;
      const opts = big ? [[Math.max(6, s.x0 + 10), Math.max(6, s.y0 + 10), false]] : [
        [cx - w / 2, s.y0 - h - 6, false], [s.x1 + 8, (s.y0 + s.y1) / 2 - h / 2, false], [s.x0 - w - 8, (s.y0 + s.y1) / 2 - h / 2, false], [cx - w / 2, s.y1 + 6, false],
        [cx - w / 2, s.y0 - h - 30, true], [cx - w / 2, s.y1 + 30, true], [s.x1 + 34, s.y0 - h - 10, true], [s.x0 - w - 34, s.y0 - h - 10, true],
        [cx - w / 2, s.y0 - h - 56, true], [s.x1 + 34, s.y1 + 10, true], [s.x0 - w - 34, s.y1 + 10, true]];
      const order = opts.map((_, k) => k); if (L.opt != null && L.opt < opts.length) { order.splice(L.opt, 1); order.unshift(L.opt); } // the same side as before while it fits
      // every spot that fits is scored: covering visible things costs most, then distance, a leader, a change of side
      let got = null, best = 1e9;
      for (const oi of order) {
        const [x, y, lead] = opts[oi];
        const r = { x0: x, y0: y, x1: x + w, y1: y + h };
        if (r.x0 < 4 || r.y0 < 52 || r.x1 > W - 4 || r.y1 > H - 4) continue;
        if (placed.some(p => overlap(p, r))) continue;
        if (!big && overlap(r, { x0: s.x0 + 2, y0: s.y0 + 2, x1: s.x1 - 2, y1: s.y1 - 2 }, 0)) continue;
        const cost = (big ? 0 : covered(r) * 4) + oi * 0.06 + (lead ? 0.25 : 0) - (oi === L.opt ? 0.3 : 0);
        if (cost < best) { best = cost; got = { x, y, lead, r, opt: oi }; }
      }
      if (!got) continue;
      // ease toward the spot (labels glide with the camera instead of snapping); a new label appears in place
      const far = L.x == null || Math.hypot(got.x - L.x, got.y - L.y) > 160;
      L.x = far ? got.x : L.x + (got.x - L.x) * 0.5; L.y = far ? got.y : L.y + (got.y - L.y) * 0.5; L.lead = got.lead; L.opt = got.opt;
      got.x = L.x; got.y = L.y;
      placed.push(got.r); used.add(key);
      L.el.style.transform = `translate(${got.x.toFixed(1)}px, ${got.y.toFixed(1)}px)`;
      L.el.classList.add('on');
      L.el.classList.toggle('sel', !!(ws.selection && ws.selection.key === c.v.key && ws.selection.label === c.li));
      if (got.lead) { // a short leader line from the label to the nearest edge of its part
        const lx = got.x + w / 2, ly = got.y + h / 2, above = got.y + h < s.y0;
        const ax = above ? s.tx : Math.max(s.x0, Math.min(s.x1, lx)), ay = above ? s.y0 + 3 : Math.max(s.y0, Math.min(s.y1, ly));
        const ex = above ? got.y + h : got.y > s.y1 ? got.y : ly;
        lines.push(`<line x1="${lx.toFixed(1)}" y1="${ex.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="2"/>`);
      }
    }
    for (const v of visuals.values()) for (const [li, L] of v.labelsEl) if (!used.has(v.key + ':' + li)) { L.el.classList.remove('on'); L.x = null; }
    leaderSvg.innerHTML = lines.join('');
  }

  // ---------- hover and picking ----------
  let hoverAt = null;
  function partAt(x, y) {
    const h = core.pick(x, y); if (!h) return null;
    for (const v of visuals.values()) if (v.index === h.visual && h.part < v.C.parts.length) return { v, part: h.part, info: v.C.parts[h.part] };
    return null;
  }
  function groupOf(v, part, depth = 0) { // what a click names: the nearest labelled (or id'd) node holding the part
    const p = v.C.parts[part];
    for (let k = p.ids.length - 1 - depth; k >= 0; k--) {
      const id = p.ids[k], li = v.C.labels.findIndex(l => l.id === id);
      if (li >= 0 || k === 0) return { id, label: li >= 0 ? v.C.labels[li].text : null, li, parts: new Set(v.C.ids.get(id).parts) };
    }
    return { id: p.id, label: p.label, li: -1, parts: new Set([part]) };
  }

  // ---------- the loop ----------
  let last = now(), frames = 0, ftimes = [];
  const t0GL = now();
  function tick() {
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    ftimes.push(dt); if (ftimes.length > 120) ftimes.shift();
    SEE.emit('frame', dt, t);
    updateCamera(dt, t);
    for (const v of visuals.values()) {
      if (v.bornGL == null) v.bornGL = v.born - t0GL;
      v.pos.lerp(v.goal, 1 - Math.exp(-dt * 6));
      v.group.position.copy(v.pos); v.noteGroup.position.copy(v.pos);
      stepLods(v);
      // presence eases toward its target: hidden parts dissolve out, opened insides dissolve in
      let moving = false;
      for (let i = 0; i < v.presence.length; i++) {
        const a = v.presence[i], b = v.target[i];
        if (a !== b) { const s = dt * (reduce ? 99 : 2.6); v.presence[i] = Math.abs(b - a) <= s ? b : a + Math.sign(b - a) * s; moving = true; }
      }
      if (v.tween) { const e = Math.min(1, (t - v.tweenT0) / 0.9); v.tweenK = Math.pow(1 - e, 3); if (e >= 1) { v.tween = null; } v.dirty = true; }
      if (moving || v.dirty || v.live.size) { writeTable(v, t); v.dirty = false; }
      // notes: shown with their part's level; re-rastered when they grow on screen
      for (const m of v.noteMeshes) {
        const n = m.userData.note, hid = n.ids.some(id => v.st && v.st.hide.has(id) || (v.live.get(id) || {}).hide);
        let on = !hid && (n.lod < 0 || noteLodOn(v, m.userData.i));
        m.visible = on; if (!on) continue;
        const wp = n.pos.clone().add(v.pos), dd = camera.position.distanceTo(wp);
        const px = n.size / (2 * dd * Math.tan(camera.fov * Math.PI / 360)) * core.size()[1] * Math.min(2, devicePixelRatio || 1);
        const need = Math.max(12, Math.min(220, Math.pow(2, Math.ceil(Math.log2(Math.max(8, px * 1.3))))));
        if (need > m.userData.res || m.userData.res > need * 4) rasterNote(m, need);
        m.material.opacity = Math.min(1, Math.max(0, (px - 3) / 4)); // too small to read: not drawn (no grey smear)
      }
    }
    if (hoverAt && !dragging) { const h = partAt(...hoverAt); setHover(h); hoverAt = null; }
    core.render(t - t0GL);
    if (frames % 3 === 0) { seen = core.visibility(4); seenAt = t; strokeDensity(); }
    layoutLabels();
    frames++;
    requestAnimationFrame(tick);
  }
  function noteLodOn(v, ni) {
    let ok = true;
    v.C.lods.forEach((L, li) => { if (L.notesOpen.includes(ni) && !v.lodState[li]) ok = false; if (L.notesClosed.includes(ni) && v.lodState[li]) ok = false; });
    return ok;
  }
  function setHover(h) {
    const prev = ws.hover;
    ws.hover = h ? Object.assign({ key: h.v.key }, groupOf(h.v, h.part)) : null;
    if ((prev && prev.key) !== (ws.hover && ws.hover.key) || (prev && prev.id) !== (ws.hover && ws.hover.id)) {
      for (const v of visuals.values()) v.dirty = true;
      SEE.emit('hover', ws.hover, h);
    }
  }
  let wasTall = null;
  function resize() { const r = root.getBoundingClientRect(); core.resize(r.width, r.height);
    const tall = r.width / Math.max(1, r.height) < 0.95; if (wasTall !== null && tall !== wasTall && visuals.size > 1 && ws.layout === 'row') { arrange(false); frame(ws.focus ? [ws.focus] : null); } wasTall = tall; }
  new ResizeObserver(resize).observe(root);

  const listeners = {};
  const SEE = window.SEE = {
    THREE, core, visuals, ws, cam, goal,
    add, remove, arrange: (layout) => { if (layout) ws.layout = layout; for (const v of visuals.values()) v.placed = ws.layout !== 'free' ? false : v.placed; arrange(false); frame(null); },
    frame, frameBox, applyStop, buildWorld, partAt, groupOf, worldBox, screenBox, zoomAt, pan, openPath, readTheme,
    hooks: {},
    covered: r => covered(r),
    partsOnScreen(v, parts) { const [W, H] = core.size(); return (seen && seenBox(v, parts)) || screenHull(v, parts, W, H); },
    hitInfo(h, x, y) { // what a click on a part names, and where on it (in the visual's own frame, like the scene's coordinates)
      const v = h.v, p = h.info, [W, H] = core.size(), o = h.part * 16, d = v.table.data, mv = new THREE.Vector3(d[o], d[o + 1], d[o + 2]);
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
      v.mesh.updateMatrixWorld(true);
      let at = null, normal = null;
      for (const q of ray.intersectObject(v.mesh, false)) {
        const pa = v.mesh.geometry.attributes.part.getX(q.face.a);
        if (Math.round(pa) === h.part) { at = q.point.clone().sub(v.pos); normal = q.face.normal.clone(); break; }
      }
      if (!at) { at = p.box.getCenter(new THREE.Vector3()).add(mv); normal = camera.position.clone().sub(at.clone().add(v.pos)).normalize(); }
      const g = groupOf(v, h.part);
      return { key: v.key, part: h.part, id: p.id || g.id, ids: p.ids, label: g.label || p.label, at: at.toArray(), normal: normal.toArray(), sub: null };
    },
    rayPlane(x, y, hit) { // where the cursor's ray meets the plane a drag grabbed (visual frame)
      const v = visuals.get(hit.key); if (!v) return null;
      const [W, H] = core.size(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
      const n = new THREE.Vector3(...hit.normal), p0 = new THREE.Vector3(...hit.at).add(v.pos);
      if (Math.abs(n.dot(ray.ray.direction)) < 0.15) n.copy(ray.ray.direction).negate(); // edge-on: slide facing the camera
      const q = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0), new THREE.Vector3());
      return q ? q.sub(v.pos).toArray() : null;
    },
    groundAt(x, y, y0 = 0) { const [W, H] = core.size(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0), new THREE.Vector3()); },
    setNoteText(v, id, text) { for (const m of v.noteMeshes) { const n = m.userData.note; if (n.id === id && n.text !== text) { n.text = text; m.userData.res = 0; } } },
    async addScene(key, scene, opts = {}) { // decode a scene's pictures first, then add it
      const images = {};
      for (const [k, a] of Object.entries(scene.assets || {})) if (a && a.kind === 'image') {
        const im = new Image(); im.src = a.data; try { await im.decode(); images[k] = im; } catch (e) { console.warn('image', k, e); }
      }
      const prev = visuals.get(key);
      const v = add(key, scene, Object.assign({ images }, opts));
      return v;
    },
    async load(data) { // a whole workspace: {visuals: [{key, scene, slot, stop}], layout, focus}
      if (data.layout) ws.layout = data.layout;
      for (const it of data.visuals || []) await SEE.addScene(it.key, it.scene, { stop: it.stop, focus: false });
      frame(data.focus ? [data.focus] : null, { instant: true, view: { yaw: 0.45, pitch: 0.3 } });
      SEE.emit('loaded');
    },
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); },
    emit(ev, ...a) { for (const f of listeners[ev] || []) try { f(...a); } catch (e) { console.error(e); } },
    touch() { lastInput = now(); },
    coverage() { // the gap check: pass A vs a plain reference render, and the dots on the final frame
      const gl = core.renderer.getContext(), [W, H] = core.size(), r = Math.min(2, devicePixelRatio || 1), w = Math.round(W * r), h = Math.round(H * r);
      updateCamera(0, now());
      for (const v of visuals.values()) { v.group.position.copy(v.pos); writeTable(v); }
      const ref = new THREE.WebGLRenderTarget(w, h), mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const keep = [...visuals.values()].map(v => [v.mesh, v.mesh.material]);
      for (const [m] of keep) m.material = mat;
      core.renderer.setRenderTarget(ref); core.renderer.setClearColor(0, 0); core.renderer.clear(); core.renderer.render(core.scene, camera); core.renderer.setRenderTarget(null);
      for (const [m, mt] of keep) m.material = mt;
      const R = new Uint8Array(w * h * 4); core.renderer.readRenderTargetPixels(ref, 0, 0, w, h, R); ref.dispose(); mat.dispose();
      core.render(now() - t0GL);
      const A = new Uint8Array(w * h * 4), fb = core.renderer.properties.get(core.passA).__webglFramebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const F = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, F);
      core.renderer.resetState();
      let nRef = 0, nBoth = 0;
      for (let i = 0; i < w * h; i++) if (R[i * 4 + 3] > 0) { nRef++; if (A[i * 4 + 3] > 0) nBoth++; }
      const bg = core.theme.bg, B = [bg.r * 255, bg.g * 255, bg.b * 255], P = Math.round(3 * r);
      let cells = 0, inked = 0;
      for (let cy = 0; cy + P <= h; cy += P) for (let cx = 0; cx + P <= w; cx += P) {
        const mid = ((cy + (P >> 1)) * w + cx + (P >> 1)) * 4; if (R[mid + 3] === 0) continue;
        cells++;
        let got = false;
        for (let y = cy; y < cy + P && !got; y++) for (let x = cx; x < cx + P; x++) { const k = (y * w + x) * 4; if (Math.abs(F[k] - B[0]) + Math.abs(F[k + 1] - B[1]) + Math.abs(F[k + 2] - B[2]) > 24) { got = true; break; } }
        if (got) inked++;
      }
      return { silhouette: nRef / (w * h), mask: nRef ? nBoth / nRef : 1, dots: cells ? inked / cells : 1, cells };
    },
    fps() { const m = ftimes.reduce((a, b) => a + b, 0) / Math.max(1, ftimes.length); return { fps: 1 / m, worst: Math.max(...ftimes) * 1000 }; },
    // test hooks: set the camera exactly, settle it, and measure
    setView(o) { if (o.yaw != null) goal.yaw = cam.yaw = o.yaw * Math.PI / 180; if (o.pitch != null) goal.pitch = cam.pitch = o.pitch * Math.PI / 180;
      if (o.zoom != null) { SEE._fit = SEE._fit || goal.dist; goal.dist = cam.dist = SEE._fit / o.zoom; } if (o.settle !== false) { cam.target.copy(goal.target); cam.dist = goal.dist; } lastInput = now(); },
  };
  readTheme(); resize();
  requestAnimationFrame(tick);
  return SEE;
}
