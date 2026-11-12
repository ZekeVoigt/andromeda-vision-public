// scene.js -- a /vision scene's node tree -> one compiled visual:
//   geometry: every leaf shape's triangles merged (attributes position, normal, color, part, along, center)
//   parts:    one record per leaf: {id, ids (own + ancestors), label, type, src, lod, base (tone, hi, quiet, anim), box}
//   ids:      id -> {parts: [part indices], notes: [note indices]}
//   notes, labels, lods (zoom levels: a closed form and its open insides)
function makeScene(THREE, SH) {
  const v3 = (a, d) => (Array.isArray(a) && a.length === 3 && a.every(x => typeof x === 'number') ? a : d);
  const ANIMS = { glow: 1, pulse: 2, flow: 3 };
  const animOf = a => a && ({ kind: ANIMS[a.type] || 1, period: Math.max(0.2, a.period ?? 2), delay: a.delay ?? 0,
    strength: Math.max(0, Math.min(1, a.strength ?? 1)), reverse: !!a.reverse });
  const nodeMatrix = p => {
    const s0 = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : v3(p.scale, [1, 1, 1]);
    const m = p.type === 'mesh' && typeof p.size === 'number' ? p.size : 1;
    const r = v3(p.rot, [0, 0, 0]).map(d => d * Math.PI / 180);
    return new THREE.Matrix4().compose(new THREE.Vector3(...v3(p.at, [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'ZYX')), new THREE.Vector3(s0[0] * m, s0[1] * m, s0[2] * m));
  };
  const INH0 = { tone: 0, hi: false, quiet: false, anim: null, ids: [], label: null, lod: -1, style: undefined, src: null };

  function compile(world, opts = {}) {
    const ctx = { assets: opts.assets || {}, images: opts.images || {}, quality: 1 };
    // budget: fewer facets per part when there are thousands of parts
    const count = countLeaves(world);
    ctx.quality = count > 3000 ? 0.35 : count > 1200 ? 0.5 : count > 400 ? 0.7 : 1;
    const out = { items: [], parts: [], ids: new Map(), notes: [], labels: [], lods: [], links: [] };
    const geoCache = new WeakMap();
    const geoFor = p => { if (!geoCache.has(p)) geoCache.set(p, SH.geoOf(p, ctx)); return geoCache.get(p); };
    const boxCache = new WeakMap();

    function idEntry(id) { let e = out.ids.get(id); if (!e) out.ids.set(id, (e = { parts: [], notes: [] })); return e; }

    // a node's box in its own parent's frame (closed form), from a dry run
    function nodeBox(p) {
      if (boxCache.has(p)) return boxCache.get(p);
      const dry = { items: [], parts: [], ids: new Map(), notes: [], labels: [], lods: [], links: [], dry: true };
      expandInto(dry, [p], new THREE.Matrix4(), INH0, false);
      const b = new THREE.Box3();
      for (const it of dry.items) { if (!it.geo.boundingBox) it.geo.computeBoundingBox(); b.union(it.geo.boundingBox.clone().applyMatrix4(it.M)); }
      for (const n of dry.notes) b.union(n.box);
      if (b.isEmpty()) b.setFromCenterAndSize(new THREE.Vector3().setFromMatrixPosition(nodeMatrix(p)), new THREE.Vector3());
      boxCache.set(p, b);
      return b;
    }

    function expandInto(o, nodes, M, inh, hidden) {
      for (const p of nodes || []) {
        if (!p || typeof p !== 'object') continue;
        const id = p.id != null ? String(p.id) : null;
        const own = {
          tone: typeof p.tone === 'number' ? p.tone : inh.tone, hi: typeof p.highlight === 'boolean' ? p.highlight : inh.hi,
          quiet: typeof p.quiet === 'boolean' ? p.quiet : inh.quiet, anim: p.animate ? animOf(p.animate) : inh.anim,
          ids: id ? inh.ids.concat(id) : inh.ids, label: p.label ? String(p.label) : inh.label, lod: inh.lod,
          style: p.style || inh.style, src: p.file ? String(p.file) : inh.src,
        };
        if (p.label && !o.dry) o.labels.push({ text: String(p.label), id, ids: own.ids, parts: [], notes: [], quiet: own.quiet });
        const lab = p.label && !o.dry ? o.labels[o.labels.length - 1] : null;
        const here = M.clone().multiply(nodeMatrix(p));
        const p0 = o.parts.length, n0 = o.notes.length;
        const zoom = Array.isArray(p.zoom) && p.zoom.length ? p.zoom : Array.isArray(p.expand) && p.expand.length ? p.expand : null;
        if (zoom && !o.dry) { // two forms in the same place: closed (shown) and open (hidden until it fills the view or is opened)
          const L = { closed: [], open: [], zoomAt: typeof p.zoomAt === 'number' ? p.zoomAt : 0.45, parent: inh.lod, id, open_: false, box: null, notesClosed: [], notesOpen: [] };
          const li = o.lods.push(L) - 1;
          const c0 = o.parts.length, cn0 = o.notes.length;
          expandShape(o, p, here, Object.assign({}, own, { lod: li }), hidden);
          L.closed = range(c0, o.parts.length); L.notesClosed = range(cn0, o.notes.length);
          const z0 = o.parts.length, zn0 = o.notes.length;
          const zg = { type: 'group', parts: zoom };
          expandInto(o, [zg], here, Object.assign({}, own, { lod: li, label: null }), true);
          L.open = range(z0, o.parts.length); L.notesOpen = range(zn0, o.notes.length);
          L.box = boxOfParts(o, L.closed.concat(L.open));
        } else expandShape(o, p, here, own, hidden);
        if (!o.dry) {
          const pr = range(p0, o.parts.length), nr = range(n0, o.notes.length);
          if (id) { const e = idEntry(id); e.parts.push(...pr); e.notes.push(...nr); }
          if (lab) { lab.parts = pr; lab.notes = nr; }
        }
      }
    }
    const range = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; };

    function expandShape(o, p, here, own, hidden) {
      const t = p.type;
      if (t === 'group') return expandInto(o, p.parts, here, own, hidden);
      if (t === 'mirror') {
        const ax = { x: 0, y: 1, z: 2 }[p.axis || 'x'] ?? 0, s = [1, 1, 1]; s[ax] = -1;
        expandInto(o, p.parts, here, own, hidden);
        expandInto(o, p.parts, here.clone().multiply(new THREE.Matrix4().makeScale(...s)), own, hidden);
        return;
      }
      if (t === 'repeat') {
        const n = Math.max(1, Math.min(200, p.count | 0)), off = v3(p.offset, [0, 0, 0]);
        const tr = v3(p.turn, [0, 0, 0]).map(d => d * Math.PI / 180), R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tr[0], tr[1], tr[2], 'ZYX'));
        const kids = p.parts || (p.part ? [p.part] : []);
        let Rk = new THREE.Matrix4();
        for (let k = 0; k < n; k++) {
          const T = new THREE.Matrix4().makeTranslation(off[0] * k, off[1] * k, off[2] * k).multiply(Rk);
          expandInto(o, kids, here.clone().multiply(T), own, hidden);
          Rk = R.clone().multiply(Rk);
        }
        return;
      }
      if (t === 'stack' || t === 'grid') return layout(o, p, here, own, hidden);
      if (t === 'note') {
        const s = Math.cbrt(Math.abs(here.determinant())) || 1, size = (typeof p.size === 'number' ? p.size : 0.08) * s;
        const lines = String(p.text || '').split('\n'), width = (typeof p.width === 'number' ? p.width : 0) * s;
        const w = width || size * 0.56 * Math.max(...lines.map(l => l.length)), h = size * 1.35 * lines.length;
        const pos = new THREE.Vector3().setFromMatrixPosition(here), quat = new THREE.Quaternion(); here.decompose(new THREE.Vector3(), quat, new THREE.Vector3());
        const box = new THREE.Box3().setFromCenterAndSize(pos.clone().add(new THREE.Vector3(p.align === 'left' ? w / 2 : 0, 0, 0)), new THREE.Vector3(w, h, 0));
        o.notes.push({ id: p.id != null ? String(p.id) : null, ids: own.ids, text: String(p.text || ''), pos, quat, size, width, w, h, box,
          align: p.align === 'left' ? 'left' : 'center', weight: p.weight === 'bold' ? 'bold' : 'normal', tone: own.tone, hi: !!(p.highlight ?? own.hi),
          hidden, lod: own.lod, quiet: own.quiet });
        return;
      }
      if (t === 'link') { if (!o.dry) o.links.push({ p, own, hidden, M: here }); return; }
      const geo = geoFor(p); if (!geo) return;
      const pi = o.parts.length;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const box = geo.boundingBox.clone().applyMatrix4(here);
      const path = t === 'tube' || t === 'arrow' || t === 'curve' || t === 'link';
      o.parts.push({ id: p.id != null ? String(p.id) : null, ids: own.ids, label: own.label, type: t, src: own.src, lod: own.lod, hidden,
        tone: own.tone, hi: own.hi, quiet: own.quiet, anim: own.anim, box, path, line: own.style === 'line', two: !!geo.userData.two, rel: Array.isArray(p.rel) ? p.rel.map(String) : null,
        sub: geo.userData.parts || null });
      o.items.push({ geo, M: here, part: pi });
      o.parts[pi].hull = hullOf(geo, here);
    }

    function layout(o, p, here, own, hidden) {
      const kids = p.parts || [], n = kids.length; if (!n) return;
      const bs = kids.map(nodeBox), sz = bs.map(b => b.getSize(new THREE.Vector3()).toArray()), ct = bs.map(b => b.getCenter(new THREE.Vector3()).toArray());
      const gp = Array.isArray(p.gap) ? p.gap : [p.gap ?? 0.1, p.gap ?? 0.1], align = p.align || 'center', place = [];
      if (p.type === 'stack') {
        const ax = { x: 0, y: 1, z: 2 }[p.axis || 'y'] ?? 1, sign = ax === 0 ? 1 : -1;
        const maxS = [0, 1, 2].map(a => Math.max(...sz.map(s => s[a])));
        let pos = -(sz.reduce((t, s) => t + s[ax], 0) + gp[0] * (n - 1)) / 2;
        sz.forEach(s => {
          const at = [0, 0, 0]; at[ax] = sign * (pos + s[ax] / 2); pos += s[ax] + gp[0];
          for (const a of [0, 1, 2]) if (a !== ax && align !== 'center') { const lead = a === 0 ? -1 : 1, k = align === 'start' ? lead : -lead; at[a] = k * (maxS[a] - s[a]) / 2; }
          place.push(at);
        });
      } else {
        const cols = Math.max(1, (p.cols | 0) || Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols);
        const cw = Array(cols).fill(0), rh = Array(rows).fill(0);
        sz.forEach((s, i) => { cw[i % cols] = Math.max(cw[i % cols], s[0]); rh[(i / cols) | 0] = Math.max(rh[(i / cols) | 0], s[1]); });
        const W = cw.reduce((a, b) => a + b, 0) + gp[0] * (cols - 1), H = rh.reduce((a, b) => a + b, 0) + gp[1] * (rows - 1);
        sz.forEach((s, i) => {
          const c = i % cols, r = (i / cols) | 0;
          let x = -W / 2 + cw.slice(0, c).reduce((a, b) => a + b, 0) + gp[0] * c + cw[c] / 2;
          let y = H / 2 - rh.slice(0, r).reduce((a, b) => a + b, 0) - gp[1] * r - rh[r] / 2;
          if (align === 'start') { x += (s[0] - cw[c]) / 2; y -= (s[1] - rh[r]) / 2; }
          place.push([x, y, 0]);
        });
      }
      kids.forEach((q, i) => {
        const T = new THREE.Matrix4().makeTranslation(place[i][0] - ct[i][0], place[i][1] - ct[i][1], place[i][2] - ct[i][2]);
        expandInto(o, [q], here.clone().multiply(T), own, hidden);
      });
    }

    function boxOfParts(o, list) {
      const b = new THREE.Box3(); for (const i of list) b.union(o.parts[i].box); return b;
    }
    function idBox(id) {
      const e = out.ids.get(String(id)); if (!e) return null;
      // a closed node's box, not its hidden insides
      const b = new THREE.Box3();
      for (const i of e.parts) if (!out.parts[i].hidden) b.union(out.parts[i].box);
      for (const i of e.notes) if (!out.notes[i].hidden) b.union(out.notes[i].box);
      if (b.isEmpty()) { for (const i of e.parts) b.union(out.parts[i].box); for (const i of e.notes) b.union(out.notes[i].box); }
      return b.isEmpty() ? null : b;
    }

    expandInto(out, world, new THREE.Matrix4(), INH0, false);

    // links: from one id's box to another's, edge to edge; arched in 3D so they never cut through the floor plane
    for (const L of out.links) {
      const { p, own, hidden } = L, A = idBox(p.from), B = idBox(p.to); if (!A || !B) continue;
      const ca = A.getCenter(new THREE.Vector3()), cb = B.getCenter(new THREE.Vector3()), d = cb.clone().sub(ca), len = d.length(); if (len < 1e-9) continue;
      const u = d.clone().divideScalar(len);
      const exitT = b => { const s = b.getSize(new THREE.Vector3()); let t = 1e9; for (const a of ['x', 'y', 'z']) if (Math.abs(u[a]) > 1e-9) t = Math.min(t, s[a] / 2 / Math.abs(u[a])); return t; };
      const da = A.getSize(new THREE.Vector3()).length(), db = B.getSize(new THREE.Vector3()).length();
      const rad = typeof p.radius === 'number' ? p.radius : Math.max(1e-4, 0.012 * Math.min(da || db, db || da));
      let pa = ca.clone().addScaledVector(u, exitT(A) + rad * 2), pb = cb.clone().addScaledVector(u, -(exitT(B) + rad * 2));
      if (pb.clone().sub(pa).dot(u) <= rad * 4) { pa = ca; pb = cb; }
      const bend = typeof p.bend === 'number' ? p.bend : 0, head = p.head !== false;
      let geo;
      if (!bend) geo = head ? SH.arrowGeo(pa.toArray(), pb.toArray(), rad, ctx.quality) : SH.tubeAlong([pa.toArray(), pb.toArray()], [rad, rad], false, ctx.quality);
      else {
        let nrm = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 0, 1)); if (nrm.length() < 0.1) nrm = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0)); nrm.normalize();
        const span = pa.distanceTo(pb), mid = pa.clone().add(pb).multiplyScalar(0.5).addScaledVector(nrm, bend * span);
        const bez = t => pa.clone().multiplyScalar((1 - t) * (1 - t)).add(mid.clone().multiplyScalar(2 * t * (1 - t))).add(pb.clone().multiplyScalar(t * t));
        const path = []; for (let i = 0; i <= 24; i++) path.push(bez(i / 24));
        const parts = [];
        if (head) {
          const tg = pb.clone().sub(bez(0.95)).normalize(), hl = Math.min(rad * 7, span * 0.3), back = pb.clone().addScaledVector(tg, -hl);
          path[path.length - 1] = back;
          parts.push(SH.tubeAlong(path.map(v => v.toArray()), path.map(() => rad), false, ctx.quality));
          parts.push(SH.arrowGeo(back.clone().addScaledVector(tg, -hl * 1.5).toArray(), pb.toArray(), rad, ctx.quality));
        } else parts.push(SH.tubeAlong(path.map(v => v.toArray()), path.map(() => rad), false, ctx.quality));
        geo = SH.merge(parts);
      }
      geo.computeBoundingBox();
      const pi = out.parts.length, id = p.id != null ? String(p.id) : null;
      out.parts.push({ id, ids: own.ids, label: own.label, type: 'link', src: own.src, lod: own.lod, hidden, tone: own.tone, hi: own.hi, quiet: own.quiet,
        anim: own.anim, box: geo.boundingBox.clone(), path: true, line: own.style === 'line', from: String(p.from), to: String(p.to) });
      out.items.push({ geo, M: new THREE.Matrix4(), part: pi });
      out.parts[pi].hull = hullOf(geo, new THREE.Matrix4());
      if (id) idEntry(id).parts.push(pi);
      for (const k of own.ids) if (k !== id) { const e = out.ids.get(k); if (e) e.parts.push(pi); }
    }

    // merge: one geometry, each vertex knowing its part
    const geometry = mergeItems(out.items);
    const bounds = new THREE.Box3();
    for (const q of out.parts) if (!q.hidden) bounds.union(q.box);
    for (const n of out.notes) if (!n.hidden) bounds.union(n.box);
    if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    return { geometry, parts: out.parts, ids: out.ids, notes: out.notes, labels: out.labels, lods: out.lods, bounds };
  }

  function hullOf(geo, M) { // up to ~60 of a part's own vertices, in visual space: where it really is on screen
    const P = geo.attributes.position, n = P.count, step = Math.max(1, Math.floor(n / 60)), out = [], v = new THREE.Vector3();
    for (let i = 0; i < n; i += step) { v.fromBufferAttribute(P, i).applyMatrix4(M); out.push(v.x, v.y, v.z); }
    return new Float32Array(out);
  }
  function mergeItems(items) {
    let nv = 0, ni = 0;
    for (const it of items) { nv += it.geo.attributes.position.count; ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Uint8Array(nv * 4), part = new Float32Array(nv),
      along = new Float32Array(nv), ctr = new Float32Array(nv * 3), sub = new Float32Array(nv).fill(-1);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let ov = 0, oi = 0;
    for (const it of items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, A = g.attributes.along, Cn = g.attributes.center;
      const S = g.userData.sub;
      nm.getNormalMatrix(it.M);
      const flip = it.M.determinant() < 0;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(it.M); pos.set([v.x, v.y, v.z], (ov + i) * 3);
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.set([v.x, v.y, v.z], (ov + i) * 3); }
        if (C) for (let k = 0; k < 4; k++) col[(ov + i) * 4 + k] = Math.round((C.normalized ? C.array[i * 4 + k] : C.array[i * 4 + k] * 255));
        part[ov + i] = it.part;
        if (A) along[ov + i] = A.getX(i);
        if (Cn) { v.fromBufferAttribute(Cn, i).applyMatrix4(it.M); ctr.set([v.x, v.y, v.z], (ov + i) * 3); }
        else { ctr[(ov + i) * 3] = pos[(ov + i) * 3]; ctr[(ov + i) * 3 + 1] = pos[(ov + i) * 3 + 1]; ctr[(ov + i) * 3 + 2] = pos[(ov + i) * 3 + 2]; }
        if (S) sub[ov + i] = S[i];
      }
      const I = g.index ? g.index.array : null, n = I ? I.length : P.count;
      for (let k = 0; k < n; k += 3) { // a mirrored part keeps its faces facing out
        const a = I ? I[k] : k, b = I ? I[k + 1] : k + 1, c = I ? I[k + 2] : k + 2;
        idx[oi++] = a + ov; idx[oi++] = (flip ? c : b) + ov; idx[oi++] = (flip ? b : c) + ov;
      }
      ov += P.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
    g.setAttribute('part', new THREE.BufferAttribute(part, 1));
    g.setAttribute('along', new THREE.BufferAttribute(along, 1));
    g.setAttribute('center', new THREE.BufferAttribute(ctr, 3));
    g.setAttribute('sub', new THREE.BufferAttribute(sub, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  function countLeaves(nodes) {
    let n = 0;
    for (const p of nodes || []) {
      if (!p || typeof p !== 'object') continue;
      const kids = p.parts || (p.part ? [p.part] : null);
      const times = p.type === 'repeat' ? Math.max(1, Math.min(200, p.count | 0)) : p.type === 'mirror' ? 2 : 1;
      n += kids ? countLeaves(kids) * times : 1;
      if (p.zoom) n += countLeaves(p.zoom);
    }
    return n;
  }
  return { compile };
}
