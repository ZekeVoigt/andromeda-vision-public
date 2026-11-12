// shapes.js -- every /vision shape as real triangles. makeShapes(THREE) -> { geoOf(p, ctx), pathGeo(...), raster... }
// Each geometry is indexed, with position + normal; optional `color` (rgba u8, a = has its own color),
// `along` (0..1 along a path, for flow), `center` (a path's axis point, so a live `width` can thicken it).
function makeShapes(THREE) {
  const V3 = (a, d = [0, 0, 0]) => (Array.isArray(a) && a.length === 3 ? a : d);
  const num = (p, k, d) => (typeof p[k] === 'number' && isFinite(p[k]) ? p[k] : d);

  // ---------- rounded box: a grid per face whose coordinates bunch at the rounded corners ----------
  function box(w, h, d, round, q) {
    const H = [w / 2, h / 2, d / 2], r = Math.max(0, Math.min(round || 0, Math.min(...H) * 0.999));
    const m = r > 0 ? Math.max(3, Math.round(6 * q)) : 0;
    const coords = a => { // along one axis: -H, the arc samples, +H
      if (!r) return [-H[a], H[a]];
      const out = [];
      for (let k = 0; k <= m; k++) out.push(-H[a] + r * (1 - Math.cos(k / m * Math.PI / 2)));
      for (let k = m; k >= 0; k--) out.push(H[a] - r * (1 - Math.cos(k / m * Math.PI / 2)));
      return out.filter((v, i, l) => i === 0 || Math.abs(v - l[i - 1]) > 1e-9);
    };
    const pos = [], nrm = [], idx = [];
    const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]]; // normal axis, u axis, v axis, sign
    for (const [na, ua, va, s] of faces) {
      const U = coords(ua), Vv = coords(va), base = pos.length / 3;
      for (let j = 0; j < Vv.length; j++) for (let i = 0; i < U.length; i++) {
        const p = [0, 0, 0]; p[na] = s * H[na]; p[ua] = U[i]; p[va] = Vv[j];
        let n = [0, 0, 0]; n[na] = s;
        if (r) { // push the corner regions onto their sphere of radius r
          const inner = p.map((v, a) => Math.max(-H[a] + r, Math.min(H[a] - r, v)));
          const dd = p.map((v, a) => v - inner[a]), l = Math.hypot(...dd);
          if (l > 1e-9) { n = dd.map(v => v / l); for (let a = 0; a < 3; a++) p[a] = inner[a] + n[a] * r; }
        }
        pos.push(...p); nrm.push(...n);
      }
      const nu = U.length;
      for (let j = 0; j < Vv.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu, e = c + 1;
        // wind so the face points along +s on its normal axis: (u x v) = +n for the cyclic order
        if (s > 0) idx.push(a, b, e, a, e, c); else idx.push(a, e, b, a, c, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(idx);
    return g;
  }

  // ---------- a tube along a polyline with a radius per point (tapers, cables, links) ----------
  function tubeAlong(pts, radii, closed, q, caps = true) {
    const n = pts.length, sides = Math.max(6, Math.round(14 * q));
    const P = pts.map(p => new THREE.Vector3(...p));
    const T = P.map((p, i) => {
      const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const t = b.clone().sub(a); return t.lengthSq() > 1e-18 ? t.normalize() : new THREE.Vector3(0, 1, 0);
    });
    // parallel-transported frames: no twist along the tube
    const N = [], B = [];
    let up = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    N[0] = new THREE.Vector3().crossVectors(T[0], up).normalize(); B[0] = new THREE.Vector3().crossVectors(T[0], N[0]);
    for (let i = 1; i < n; i++) {
      const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]); let nn = N[i - 1].clone();
      if (ax.lengthSq() > 1e-12) { const ang = Math.acos(Math.max(-1, Math.min(1, T[i - 1].dot(T[i])))); nn.applyAxisAngle(ax.normalize(), ang); }
      N[i] = nn.normalize(); B[i] = new THREE.Vector3().crossVectors(T[i], N[i]);
    }
    let total = 0; const acc = [0];
    for (let i = 1; i < n; i++) { total += P[i].distanceTo(P[i - 1]); acc.push(total); }
    const pos = [], nrm = [], along = [], ctr = [], idx = [];
    for (let i = 0; i < n; i++) {
      const r = radii[i];
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const dn = N[i].clone().multiplyScalar(c).add(B[i].clone().multiplyScalar(s));
        pos.push(P[i].x + dn.x * r, P[i].y + dn.y * r, P[i].z + dn.z * r); nrm.push(dn.x, dn.y, dn.z);
        along.push(total ? acc[i] / total : 0); ctr.push(P[i].x, P[i].y, P[i].z);
      }
    }
    const ring = sides + 1, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % n;
      for (let k = 0; k < sides; k++) { const a = i * ring + k, b = a + 1, c = i2 * ring + k, d = c + 1; idx.push(a, c, b, b, c, d); }
    }
    if (caps && !closed) for (const [i, sgn] of [[0, -1], [n - 1, 1]]) { // flat ends
      if (radii[i] <= 1e-6) continue;
      const base = pos.length / 3, t = T[i].clone().multiplyScalar(sgn);
      pos.push(P[i].x, P[i].y, P[i].z); nrm.push(t.x, t.y, t.z); along.push(i ? 1 : 0); ctr.push(P[i].x, P[i].y, P[i].z);
      for (let k = 0; k <= sides; k++) {
        const a = k / sides * Math.PI * 2, dn = N[i].clone().multiplyScalar(Math.cos(a)).add(B[i].clone().multiplyScalar(Math.sin(a)));
        pos.push(P[i].x + dn.x * radii[i], P[i].y + dn.y * radii[i], P[i].z + dn.z * radii[i]); nrm.push(t.x, t.y, t.z); along.push(i ? 1 : 0); ctr.push(P[i].x, P[i].y, P[i].z);
      }
      for (let k = 0; k < sides; k++) sgn > 0 ? idx.push(base, base + 1 + k, base + 2 + k) : idx.push(base, base + 2 + k, base + 1 + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('center', new THREE.Float32BufferAttribute(ctr, 3));
    g.setIndex(idx);
    return g;
  }
  function catmull(pts, closed, k = 8) { // centripetal enough for our paths: uniform Catmull-Rom on [x,y,z,r]
    const n = pts.length; if (n < 3) return pts;
    const out = [], get = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) for (let s = 0; s < k; s++) {
      const t = s / k, p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      out.push(p1.map((_, d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t * t * t)));
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }
  function arrowGeo(a, b, rad, q) { // a shaft and a cone head, one piece; along runs 0..1
    const d = b.map((v, i) => v - a[i]), len = Math.hypot(...d) || 1e-6, u = d.map(v => v / len);
    const hl = Math.min(len * 0.4, rad * 7), m = b.map((v, i) => v - u[i] * hl), hr = rad * 2.8;
    const shaft = tubeAlong([a, m], [rad, rad], false, q);
    const head = tubeAlong([m, m.map((v, i) => v + u[i] * hl * 0.999), b], [hr, hr * 0.0005 + 1e-5, 1e-5], false, q);
    // the head's sides lean: point their normals out along the cone
    const hn = head.attributes.normal, hp = head.attributes.position, hc = head.attributes.center;
    const slope = hr / hl;
    for (let i = 0; i < hn.count; i++) {
      const r = [hp.getX(i) - hc.getX(i), hp.getY(i) - hc.getY(i), hp.getZ(i) - hc.getZ(i)], l = Math.hypot(...r);
      if (l < 1e-9) continue;
      const n = r.map((v, k) => v / l + u[k] * slope), nl = Math.hypot(...n); hn.setXYZ(i, n[0] / nl, n[1] / nl, n[2] / nl);
    }
    const sa = shaft.attributes.along, ha = head.attributes.along, f = 1 - hl / len;
    for (let i = 0; i < sa.count; i++) sa.setX(i, sa.getX(i) * f);
    for (let i = 0; i < ha.count; i++) ha.setX(i, f + ha.getX(i) * (1 - f));
    return merge([shaft, head]);
  }
  function merge(list) {
    const keys = ['position', 'normal', 'along', 'center', 'color'], out = {}, idx = [];
    let base = 0;
    for (const k of keys) out[k] = [];
    const anyColor = list.some(g => g.attributes.color);
    for (const g of list) {
      const n = g.attributes.position.count;
      for (const k of keys) {
        const a = g.attributes[k];
        if (a) out[k].push(...a.array);
        else if (k === 'along') for (let i = 0; i < n; i++) out[k].push(0);
        else if (k === 'center') out[k].push(...g.attributes.position.array);
        else if (k === 'color' && anyColor) for (let i = 0; i < n; i++) out[k].push(0, 0, 0, 0);
      }
      const ix = g.index ? g.index.array : [...Array(n).keys()];
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
      base += n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(out.along, 1));
    g.setAttribute('center', new THREE.Float32BufferAttribute(out.center, 3));
    if (anyColor) g.setAttribute('color', new THREE.Uint8BufferAttribute(out.color, 4, true));
    g.setIndex(idx);
    return g;
  }

  // ---------- a picture or a glyph as a solid: a mask on a grid, extruded, rows merged into runs ----------
  function maskSolid(W, H, inside, cell, depth, colorAt, heightAt) {
    const pos = [], nrm = [], col = [], idx = [];
    const x0 = -W * cell / 2, y0 = H * cell / 2;
    const quad = (a, b, c, d, n, rgb) => {
      const base = pos.length / 3;
      for (const p of [a, b, c, d]) { pos.push(...p); nrm.push(...n); if (colorAt) col.push(...(rgb || [0, 0, 0, 0])); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const zf = (x, y) => depth / 2 + (heightAt ? heightAt(x, y) : 0);
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (!inside(x, y)) { x++; continue; }
        let e = x + 1;
        // a run of cells merges into one quad when nothing varies along it (no colors, no heights)
        if (!colorAt && !heightAt) while (e < W && inside(e, y)) e++;
        const X0 = x0 + x * cell, X1 = x0 + e * cell, Y0 = y0 - y * cell, Y1 = y0 - (y + 1) * cell, z = zf(x, y);
        const rgb = colorAt ? colorAt(x, y) : null;
        quad([X0, Y1, z], [X1, Y1, z], [X1, Y0, z], [X0, Y0, z], [0, 0, 1], rgb);           // front
        quad([X0, Y1, -depth / 2], [X0, Y0, -depth / 2], [X1, Y0, -depth / 2], [X1, Y1, -depth / 2], [0, 0, -1], rgb); // back
        for (let k = x; k < e; k++) { // walls where the mask ends
          const Xa = x0 + k * cell, Xb = Xa + cell, zk = zf(k, y);
          if (y === 0 || !inside(k, y - 1)) quad([Xa, Y0, -depth / 2], [Xa, Y0, zk], [Xb, Y0, zk], [Xb, Y0, -depth / 2], [0, 1, 0], rgb);
          if (y === H - 1 || !inside(k, y + 1)) quad([Xa, Y1, -depth / 2], [Xb, Y1, -depth / 2], [Xb, Y1, zk], [Xa, Y1, zk], [0, -1, 0], rgb);
        }
        if (x === 0 || !inside(x - 1, y)) quad([X0, Y1, -depth / 2], [X0, Y1, z], [X0, Y0, z], [X0, Y0, -depth / 2], [-1, 0, 0], rgb);
        if (e === W || !inside(e, y)) quad([X1, Y1, -depth / 2], [X1, Y0, -depth / 2], [X1, Y0, zf(e - 1, y)], [X1, Y1, zf(e - 1, y)], [1, 0, 0], rgb);
        x = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    if (colorAt) g.setAttribute('color', new THREE.Uint8BufferAttribute(col, 4, true));
    g.setIndex(idx);
    return g;
  }
  function rasterText(text, font, rows) { // -> {W, H, a: alpha, c: rgb} of the text drawn at `rows` px high
    const cv = document.createElement('canvas'), x = cv.getContext('2d');
    const f = font || `700 ${rows}px Inter, -apple-system, system-ui, sans-serif`;
    x.font = f; const lines = String(text).split('\n');
    const w = Math.ceil(Math.max(...lines.map(l => x.measureText(l).width))) + 4, lh = Math.ceil(rows * 1.2);
    cv.width = w; cv.height = lh * lines.length;
    x.font = f; x.textBaseline = 'middle'; x.fillStyle = '#000';
    lines.forEach((l, i) => x.fillText(l, 2, lh * (i + 0.5)));
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    return { W: cv.width, H: cv.height, d };
  }

  // ---------- one node's own geometry (not containers, notes or links) ----------
  function geoOf(p, ctx) {
    const q = ctx.quality, t = p.type;
    switch (t) {
      case 'box': { const s = V3(p.size, [1, 1, 1]); return box(s[0], s[1], s[2], num(p, 'round', 0), q); }
      case 'sphere': return new THREE.SphereGeometry(num(p, 'radius', 0.5), Math.round(40 * q), Math.round(24 * q));
      case 'dome': {
        const r = num(p, 'radius', 0.5), sph = new THREE.SphereGeometry(r, Math.round(40 * q), Math.round(12 * q), 0, Math.PI * 2, 0, Math.PI / 2);
        const cap = new THREE.CircleGeometry(r, Math.round(40 * q)); cap.rotateX(Math.PI / 2);
        return merge([sph, cap]);
      }
      case 'cylinder': case 'cone': {
        const r = num(p, 'radius', 0.5), r2 = t === 'cone' ? 0 : num(p, 'radius2', r), h = num(p, 'height', 1);
        return new THREE.CylinderGeometry(r2, r, h, Math.round(40 * q), 1, !!p.open);
      }
      case 'capsule': return new THREE.CapsuleGeometry(num(p, 'radius', 0.25), num(p, 'height', 0.5), Math.round(8 * q), Math.round(28 * q));
      case 'torus': {
        const R = num(p, 'radius', 0.5), arc = num(p, 'arc', 360) * Math.PI / 180;
        const g = new THREE.TorusGeometry(R, num(p, 'tube', 0.3 * R), Math.round(16 * q), Math.max(8, Math.round(72 * q * arc / (Math.PI * 2))), arc);
        g.rotateX(Math.PI / 2); return g; // lies in x-z, the arc running from +x toward +z
      }
      case 'tube': case 'arrow': {
        const a = V3(p.from), b = V3(p.to, [0, 1, 0]), r = num(p, 'radius', 0.05);
        return t === 'tube' ? tubeAlong([a, b], [r, r], false, q) : arrowGeo(a, b, r, q);
      }
      case 'curve': {
        const pts = p.path, rs = Array.isArray(p.radius) ? p.radius : pts.map(() => num(p, 'radius', 0.05));
        const both = pts.map((v, i) => [...v, rs[Math.min(i, rs.length - 1)]]);
        const line = p.smooth === false ? both : catmull(both, !!p.closed, 8);
        return tubeAlong(line.map(v => v.slice(0, 3)), line.map(v => Math.max(1e-4, v[3])), !!p.closed && p.smooth !== false, q);
      }
      case 'extrude': {
        const sh = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x, y)));
        for (const h of p.holes || []) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
        const depth = num(p, 'depth', 0.2);
        const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: p.smooth ? 12 : 4 });
        g.translate(0, 0, -depth / 2); return g.index ? g : indexed(g);
      }
      case 'lathe': {
        let prof = p.profile.map(([r, y]) => [r, y]);
        if (p.smooth) prof = catmull(prof.map(v => [...v, 0]), false, 6).map(v => [Math.max(0, v[0]), v[1]]);
        return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), Math.round(48 * q));
      }
      case 'surface': {
        const f = k => new Function('u', 'v', `with (Math) { return (${p[k]}); }`);
        const fx = f('x'), fy = f('y'), fz = f('z'), n = Math.round(56 * q), pos = [], idx = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const u = i / n, v = j / n; pos.push(+fx(u, v) || 0, +fy(u, v) || 0, +fz(u, v) || 0); }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        g.userData.two = true; return g;
      }
      case 'text': {
        const size = num(p, 'size', 1), r = rasterText(p.text, p.font ? p.font.replace(/\d+px/, '96px') : null, 96);
        const cell = size / (96 * 1.2);
        return maskSolid(r.W, r.H, (x, y) => r.d[(y * r.W + x) * 4 + 3] > 110, cell, num(p, 'depth', 0.2) * size, null, null);
      }
      case 'glyph': {
        const size = num(p, 'size', 1), rows = 56, r = rasterText(p.char, `${rows}px "Apple Color Emoji", "Segoe UI Emoji", Inter, sans-serif`, rows);
        const cell = size / (rows * 1.2), emoji = /\p{Extended_Pictographic}/u.test(p.char || '');
        return maskSolid(r.W, r.H, (x, y) => r.d[(y * r.W + x) * 4 + 3] > 110, cell, num(p, 'depth', 0.12) * size,
          emoji ? (x, y) => { const k = (y * r.W + x) * 4; return [r.d[k], r.d[k + 1], r.d[k + 2], 255]; } : null, null);
      }
      case 'image': {
        const im = ctx.images[p.src]; if (!im) return null;
        const size = num(p, 'size', 1), mx = 140, s = Math.min(1, mx / Math.max(im.width, im.height));
        const W = Math.max(2, Math.round(im.width * s)), H = Math.max(2, Math.round(im.height * s));
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, W, H);
        const d = x.getImageData(0, 0, W, H).data, lum = k => (0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]) / 255;
        const mode = p.mask || 'auto', hasAlpha = (() => { for (let k = 3; k < d.length; k += 4) if (d[k] < 250) return true; return false; })();
        const inside = (X, Y) => { const k = (Y * W + X) * 4;
          if (mode === 'all') return true; if (mode === 'dark') return lum(k) < 0.85; if (mode === 'light') return lum(k) > 0.15;
          if (mode === 'alpha' || (mode === 'auto' && hasAlpha)) return d[k + 3] > 110; return true; };
        const cell = size / Math.max(W, H), relief = num(p, 'relief', 0.08) * size, contrast = num(p, 'contrast', 1);
        return maskSolid(W, H, inside, cell, 0.02 * size, (X, Y) => { const k = (Y * W + X) * 4; return [d[k], d[k + 1], d[k + 2], 255]; },
          (X, Y) => relief * Math.pow(1 - lum((Y * W + X) * 4), contrast));
      }
      case 'mesh': return meshGeo(ctx.assets[p.src], ctx);
    }
    return null;
  }
  function indexed(g) {
    const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); return g;
  }
  const b64 = (s, T) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  const meshCache = new Map();
  function meshGeo(asset, ctx) { // build.py's triangles (normalized to 1 unit); colors baked per corner from materials/textures
    if (!asset) return null;
    if (meshCache.has(asset.id)) return meshCache.get(asset.id).clone();
    const V = b64(asset.v, Float32Array), F = b64(asset.f, Uint32Array), nt = F.length / 3;
    const UV = asset.uv ? b64(asset.uv, Float32Array) : null, TM = asset.tm ? b64(asset.tm, Uint16Array) : null;
    const VC = asset.vc ? b64(asset.vc, Uint8Array) : null, TP = asset.tp ? b64(asset.tp, Uint16Array) : null;
    const MATS = asset.mats || [], TEX = (asset.tex || []).map(t => ({ w: t.w, h: t.h, d: b64(t.d, Uint8Array) }));
    const colored = !!(VC || TM);
    // smooth normals per welded vertex, crisp across hard edges (per-corner, split where faces disagree)
    const vn = new Float32Array(V.length), fnrm = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
      const e1 = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], e2 = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1e-12;
      fnrm.set([n[0] / l, n[1] / l, n[2] / l], t * 3);
      for (const v of [a, b, c]) { vn[v] += n[0]; vn[v + 1] += n[1]; vn[v + 2] += n[2]; }
    }
    const pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), col = colored ? new Uint8Array(nt * 12) : null, sub = TP ? new Float32Array(nt * 3) : null;
    for (let t = 0; t < nt; t++) {
      const f = [fnrm[t * 3], fnrm[t * 3 + 1], fnrm[t * 3 + 2]];
      for (let m = 0; m < 3; m++) {
        const k = F[t * 3 + m] * 3, o = (t * 3 + m) * 3;
        pos[o] = V[k]; pos[o + 1] = V[k + 1]; pos[o + 2] = V[k + 2];
        let n = [vn[k], vn[k + 1], vn[k + 2]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
        if (n[0] * f[0] + n[1] * f[1] + n[2] * f[2] < 0.8) n = f;
        nrm[o] = n[0]; nrm[o + 1] = n[1]; nrm[o + 2] = n[2];
        if (col) {
          let c = [1, 1, 1];
          if (VC) c = [0, 1, 2].map(d => VC[(t * 3 + m) * 3 + d] / 255);
          const mt = TM ? MATS[TM[t]] : null;
          if (mt) {
            let base = mt.f ? mt.f.slice(0, 3) : [1, 1, 1];
            if (mt.t != null && TEX[mt.t] && UV) {
              const u = UV[(t * 3 + m) * 2], v = UV[(t * 3 + m) * 2 + 1], T = TEX[mt.t];
              const x = Math.min(T.w - 1, Math.floor((u - Math.floor(u)) * T.w)), y = Math.min(T.h - 1, Math.floor((v - Math.floor(v)) * T.h)), kk = (y * T.w + x) * 3;
              base = [base[0] * T.d[kk] / 255, base[1] * T.d[kk + 1] / 255, base[2] * T.d[kk + 2] / 255];
            }
            c = [c[0] * base[0], c[1] * base[1], c[2] * base[2]];
          }
          col.set([c[0] * 255, c[1] * 255, c[2] * 255, 255].map(v => Math.max(0, Math.min(255, Math.round(v)))), (t * 3 + m) * 4);
        }
        if (sub) sub[t * 3 + m] = TP[t];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
    if (sub) g.userData.sub = sub;
    g.userData.parts = asset.parts || null;
    indexed(g);
    meshCache.set(asset.id, g);
    return g.clone();
  }
  return { geoOf, tubeAlong, arrowGeo, merge, catmull };
}
