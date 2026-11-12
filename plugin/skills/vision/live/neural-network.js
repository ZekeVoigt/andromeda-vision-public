// A living /vision world: a real neural network (an MLP trained by backprop) whose world IS its state.
//   left to right: the inputs, the hidden layers, the output -- every neuron a card showing, in
//   halftone, what it responds to across the plane; every weight a line, thick = strong, orange =
//   positive; then the big field: what the network believes everywhere, and the data it learns from.
// Hands on: drag or click the field to drop points, click a neuron to take it out, click a + to add
// one; the card's controls train, set the learning rate, the data, the inputs and the layers.

// ---------- the network ----------
const FEATS = {
  'x, y': [['x', p => p[0]], ['y', p => p[1]]],
  'x, y, x², y²': [['x', p => p[0]], ['y', p => p[1]], ['x²', p => p[0] * p[0] * 2 - 0.66], ['y²', p => p[1] * p[1] * 2 - 0.66]],
  'x, y, x·y, sin': [['x', p => p[0]], ['y', p => p[1]], ['x·y', p => p[0] * p[1] * 2], ['sin x', p => Math.sin(Math.PI * p[0])], ['sin y', p => Math.sin(Math.PI * p[1])]],
};
const S = { inputs: 'x, y', hidden: [4, 3], lr: 0.03, act: 'tanh', running: true, epoch: 0, brush: 1, set: 'circle', loss: [] };
const ACT = { tanh: [Math.tanh, (z, a) => 1 - a * a], relu: [z => z > 0 ? z : 0, z => z > 0 ? 1 : 0] };
const sig = z => 1 / (1 + Math.exp(-z));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
let net, feats;
const shape = () => [FEATS[S.inputs].length, ...S.hidden, 1];
function init() {
  feats = FEATS[S.inputs];
  const sz = shape(), W = [], b = [];
  for (let l = 1; l < sz.length; l++) {
    const sc = (S.act === 'relu' ? Math.sqrt(2 / sz[l - 1]) : Math.sqrt(1 / sz[l - 1])) * 1.2;
    W.push(Array.from({ length: sz[l] }, () => Array.from({ length: sz[l - 1] }, () => gauss() * sc)));
    b.push(Array.from({ length: sz[l] }, () => 0));
  }
  net = { sz, W, b }; S.epoch = 0; S.loss = [];
}
const fx = p => feats.map(f => f[1](p));
function forward(x) {
  const A = [x], L = net.W.length, f = ACT[S.act][0];
  for (let l = 0; l < L; l++) {
    const W = net.W[l], prev = A[l], a = new Array(W.length);
    for (let j = 0; j < W.length; j++) { let s = net.b[l][j]; for (let i = 0; i < prev.length; i++) s += W[j][i] * prev[i]; a[j] = l === L - 1 ? sig(s) : f(s); }
    A.push(a);
  }
  return A;
}
const predict = p => forward(fx(p))[net.W.length][0];
function epoch(data) {
  const L = net.W.length, d = ACT[S.act][1], order = data.slice().sort(() => Math.random() - 0.5);
  for (let s = 0; s < order.length; s += 10) {
    const batch = order.slice(s, s + 10), gW = net.W.map(W => W.map(r => r.map(() => 0))), gb = net.b.map(b => b.map(() => 0));
    for (const p of batch) {
      const A = forward(fx(p)); let delta = [A[L][0] - p[2]];
      for (let l = L - 1; l >= 0; l--) {
        const W = net.W[l], prev = A[l];
        for (let j = 0; j < W.length; j++) { gb[l][j] += delta[j]; for (let i = 0; i < prev.length; i++) gW[l][j][i] += delta[j] * prev[i]; }
        if (l) { const nd = prev.map((a, i) => { let t = 0; for (let j = 0; j < W.length; j++) t += W[j][i] * delta[j]; return t * d(0, a); }); delta = nd; }
      }
    }
    const k = S.lr / batch.length;
    for (let l = 0; l < L; l++) for (let j = 0; j < net.W[l].length; j++) { net.b[l][j] -= k * gb[l][j]; for (let i = 0; i < net.W[l][j].length; i++) net.W[l][j][i] -= k * gW[l][j][i]; }
  }
  S.epoch++;
}
const lossOf = data => { if (!data.length) return NaN; let s = 0; for (const p of data) { const q = Math.min(1 - 1e-7, Math.max(1e-7, predict(p))); s -= p[2] ? Math.log(q) : Math.log(1 - q); } return s / data.length; };
const accOf = data => data.length ? data.filter(p => (predict(p) > 0.5) === (p[2] === 1)).length / data.length : NaN;

// ---------- data ----------
const SETS = {
  circle: n => Array.from({ length: n }, (_, i) => { const inner = i % 2, r = inner ? Math.random() * 0.42 : 0.62 + Math.random() * 0.3, a = Math.random() * 6.283; return [r * Math.cos(a) + gauss() * 0.03, r * Math.sin(a) + gauss() * 0.03, inner]; }),
  xor: n => Array.from({ length: n }, () => { let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1; x += x > 0 ? .06 : -.06; y += y > 0 ? .06 : -.06; return [x * .9, y * .9, x * y > 0 ? 1 : 0]; }),
  spiral: n => Array.from({ length: n }, (_, i) => { const c = i % 2, t = (i >> 1) / (n / 2) * 1.75 * Math.PI, r = 0.08 + 0.82 * t / (1.75 * Math.PI), a = t + c * Math.PI; return [r * Math.cos(a) + gauss() * .03, r * Math.sin(a) + gauss() * .03, c]; }),
  blobs: n => Array.from({ length: n }, (_, i) => { const c = i % 2; return [(c ? .42 : -.42) + gauss() * .2, (c ? .42 : -.42) + gauss() * .2, c]; }),
  moons: n => Array.from({ length: n }, (_, i) => { const c = i % 2, a = Math.random() * Math.PI; const x = c ? 1 - Math.cos(a) - .5 : Math.cos(a) - .5, y = c ? .5 - Math.sin(a) - .25 : Math.sin(a) - .25; return [x * .6 + gauss() * .04, y * .8 + gauss() * .04, c]; }),
  empty: () => [],
};
const POOL = 260, NDATA = 160;
let data = [];

// ---------- the world, written from the network's shape ----------
const CARD = 0.5, GAPY = 0.66, COLX = 1.18, MAP = 9, FIELD = 2.6, FG = 26, FX = 3.0;
const colX = l => -2.9 + l * COLX * (4 / Math.max(4, net.sz.length));
const rowY = (l, j) => ((net.sz[l] - 1) / 2 - j) * GAPY;
function card(l, j) {
  const t = CARD * 0.82 / MAP, tiles = [];
  for (let k = 0; k < MAP * MAP; k++) tiles.push({ type: 'box', id: `m-${l}-${j}-${k}`, size: [t, t, 0.02], at: [((k % MAP) - (MAP - 1) / 2) * t, ((MAP - 1) / 2 - Math.floor(k / MAP)) * t, 0.035] });
  const name = l === 0 ? feats[j][0] : l === net.sz.length - 1 ? 'output' : null;
  return { type: 'group', id: `n-${l}-${j}`, at: [colX(l), rowY(l, j), 0], ...(name ? { label: name } : {}), parts: [
    { type: 'box', id: `nb-${l}-${j}`, size: [CARD, CARD, 0.05], round: 0.03, tone: -0.35 },
    { type: 'group', id: `map-${l}-${j}`, parts: tiles },
  ] };
}
function buildWorld() {
  const sz = net.sz, parts = [], wires = [];
  for (let l = 0; l < sz.length; l++) for (let j = 0; j < sz[l]; j++) parts.push(card(l, j));
  for (let l = 0; l + 1 < sz.length; l++) for (let j = 0; j < sz[l + 1]; j++) for (let i = 0; i < sz[l]; i++) {
    const a = [colX(l) + CARD / 2, rowY(l, i), 0], b = [colX(l + 1) - CARD / 2, rowY(l + 1, j), 0], k = (b[0] - a[0]) * 0.3;
    wires.push({ type: 'curve', id: `w-${l}-${j}-${i}`, radius: 0.006, style: 'line', path: [a, [a[0] + k, a[1] + (b[1] - a[1]) * 0.12, 0], [b[0] - k, b[1] - (b[1] - a[1]) * 0.12, 0], b] });
  }
  parts.push({ type: 'group', id: 'wires', parts: wires });
  // a + under each hidden column adds a neuron there
  for (let l = 1; l + 1 < sz.length; l++) {
    const y = rowY(l, sz[l] - 1) - GAPY * 0.78;
    parts.push({ type: 'group', id: `add-${l}`, at: [colX(l), y, 0], parts: [
      { type: 'cylinder', radius: 0.1, height: 0.03, rot: [90, 0, 0], tone: -0.5 },
      { type: 'note', text: '+', size: 0.16, weight: 'bold', at: [0, 0.01, 0.03] } ] });
  }
  // the field: what it believes at every point of the plane, and the data
  const t = FIELD / FG, tiles = [], dots = [];
  for (let k = 0; k < FG * FG; k++) tiles.push({ type: 'box', id: `f-${k}`, size: [t, t, 0.03], at: [((k % FG) - (FG - 1) / 2) * t, ((FG - 1) / 2 - Math.floor(k / FG)) * t, 0] });
  for (let i = 0; i < POOL; i++) { const b = slot(i); dots.push({ type: 'sphere', id: `pt-${i}`, radius: 0.03, at: [b[0], b[1], 0.07] }); }
  parts.push({ type: 'group', id: 'field', label: 'what it believes', at: [FX, 0, 0], parts: [
    { type: 'group', id: 'tiles', parts: tiles }, { type: 'group', id: 'points', parts: dots } ] });
  // the loss, as a trail of dots under the network
  const trail = [];
  for (let i = 0; i < 60; i++) trail.push({ type: 'sphere', id: `ls-${i}`, radius: 0.022, at: [-2.9 + i * 0.075, -2.05, 0] });
  parts.push({ type: 'group', id: 'loss', label: 'loss', parts: trail });
  parts.push({ type: 'link', id: 'out-link', from: `n-${sz.length - 1}-0`, to: 'field', radius: 0.012 });
  return parts;
}

// ---------- the world's live state, from the network ----------
// each data dot is built on its own spot of a lattice over the field (dots built in one place would hide
// each other), then moved live to where its point is
const slot = i => { const n = Math.ceil(Math.sqrt(POOL)), s = FIELD * 0.9 / n; return [((i % n) - (n - 1) / 2) * s, ((n - 1) / 2 - Math.floor(i / n)) * s]; };
const GRID = FG; let field = null; // field[l][j] = Float32Array(GRID*GRID) of activations
function sampleField() {
  const L = net.W.length; field = net.sz.map(n => Array.from({ length: n }, () => new Float32Array(GRID * GRID)));
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const A = forward(fx([(gx + 0.5) / GRID * 2 - 1, 1 - (gy + 0.5) / GRID * 2]));
    for (let l = 0; l <= L; l++) for (let j = 0; j < A[l].length; j++) field[l][j][gy * GRID + gx] = A[l][j];
  }
}
// a value -> a tile: orange where it leans to 1 (or fires positive), ink the other way; size = how strongly
const paint = (id, t) => see.set(id, { glow: t > 0 ? 1 : 0, tone: -1.2 + 1.7 * Math.sqrt(Math.min(1, Math.abs(t))) });
function show() {
  sampleField();
  const L = net.W.length;
  for (let k = 0; k < FG * FG; k++) paint(`f-${k}`, (field[L][0][k] - 0.5) * 2);
  for (let l = 0; l <= L; l++) for (let j = 0; j < net.sz[l]; j++) for (let k = 0; k < MAP * MAP; k++) {
    const gx = Math.floor(((k % MAP) + 0.5) / MAP * GRID), gy = Math.floor((Math.floor(k / MAP) + 0.5) / MAP * GRID), v = field[l][j][gy * GRID + gx];
    paint(`m-${l}-${j}-${k}`, l === L ? (v - 0.5) * 2 : S.act === 'relu' ? Math.tanh(v) : v);
  }
  let mx = 1e-3; net.W.forEach(W => W.forEach(r => r.forEach(v => { mx = Math.max(mx, Math.abs(v)); })));
  net.W.forEach((W, l) => W.forEach((r, j) => r.forEach((v, i) => see.set(`w-${l}-${j}-${i}`, { width: 0.4 + 5 * Math.abs(v) / mx, glow: v > 0 ? 0.85 : 0, tone: Math.abs(v) / mx - 0.5 }))));
  const h = S.loss, top = Math.max(0.2, ...h);
  for (let i = 0; i < 60; i++) { const v = h[h.length - 60 + i]; see.set(`ls-${i}`, v == null ? { hide: true } : { hide: false, move: [0, Math.min(1, v / top) * 0.9, 0], glow: i === 59 ? 1 : 0 }); }
  const acc = accOf(data), lo = lossOf(data);
  see.status(`epoch **${S.epoch}** · loss ${isFinite(lo) ? lo.toFixed(3) : '–'} · accuracy ${isFinite(acc) ? Math.round(acc * 100) + '%' : '–'} · ${data.length} points`);
}
function placePoints() {
  for (let i = 0; i < POOL; i++) {
    const p = data[i];
    const b = slot(i);
    see.set(`pt-${i}`, p ? { hide: false, move: [p[0] * FIELD / 2 - b[0], p[1] * FIELD / 2 - b[1], 0], glow: p[2] ? 1 : 0, tone: p[2] ? 0.6 : 1.2 } : { hide: true });
  }
}

// ---------- hands on ----------
see.on('click', 'field', h => { addPoint(h); return true; });
see.on('drag', 'field', h => { if (h.phase !== 'end') addPoint(h); });
let lastAdd = 0;
function addPoint(h) {
  const now = performance.now(); if (h.phase === 'move' && now - lastAdd < 70) return; lastAdd = now;
  const x = (h.at[0] - FX) / (FIELD / 2), y = h.at[1] / (FIELD / 2);
  if (Math.abs(x) > 1 || Math.abs(y) > 1) return;
  if (data.length >= POOL) data.shift();
  data.push([x, y, S.brush]); placePoints(); show();
}
see.on('click', h => { // a neuron: take it out; a +: add one
  const add = (h.ids || []).find(k => /^add-\d+$/.test(k));
  if (add) { const l = +add.slice(4); if (S.hidden[l - 1] < 8) { S.hidden[l - 1]++; reshape(); } return true; }
  const n = (h.ids || []).find(k => /^n-\d+-\d+$/.test(k));
  if (!n) return false;
  const [, l, j] = n.split('-').map(Number);
  if (l === 0 || l === net.sz.length - 1) return false; // inputs and output: ask Claude about them instead
  if (S.hidden[l - 1] > 1) { S.hidden[l - 1]--; reshape(); }
  return true;
});
function flats() { see.set('tiles', { flat: true }); for (let l = 0; l < net.sz.length; l++) for (let j = 0; j < net.sz[l]; j++) see.set(`map-${l}-${j}`, { flat: true }); }
function reshape() { init(); see.clear(); see.world = buildWorld(); see.rebuild(); flats(); placePoints(); show(); }

const play = see.control({ type: 'toggle', label: 'Train', onLabel: 'Pause', value: S.running, on: v => { S.running = v; } });
see.control({ type: 'button', label: 'Reset', on: () => { init(); show(); } });
see.control({ type: 'slider', label: 'learning rate', min: 0.001, max: 3, log: true, value: S.lr, on: v => { S.lr = v; } });
see.control({ type: 'select', label: 'data', options: Object.keys(SETS), value: S.set, on: v => { S.set = v; data = SETS[v](NDATA); init(); placePoints(); show(); } });
see.control({ type: 'select', label: 'inputs', options: Object.keys(FEATS), value: S.inputs, on: v => { S.inputs = v; reshape(); } });
see.control({ type: 'select', label: 'layers', options: ['1', '2', '3', '4'], value: String(S.hidden.length), on: v => { const n = +v; while (S.hidden.length < n) S.hidden.push(3); S.hidden.length = n; reshape(); } });
const brush = see.control({ type: 'toggle', label: 'brush: ink', onLabel: 'brush: orange', value: true, on: v => { S.brush = v ? 1 : 0; } });
see.control({ type: 'button', label: 'Ask Claude', on: () => see.say(`About my neural network: ${S.set} data, inputs ${S.inputs}, hidden ${S.hidden.join('-')}, lr ${+S.lr.toPrecision(2)}, epoch ${S.epoch}, accuracy ${Math.round(accOf(data) * 100)}%. What is it doing?`) });

// Claude can set it up: say.py --app '{"set": {"data": "spiral", "hidden": [6,6], "inputs": "x, y, x·y, sin", "lr": 0.1}, "train": true}'
see.on('claude', a => {
  const s = a.set || {};
  if (s.data && SETS[s.data]) { S.set = s.data; data = SETS[s.data](NDATA); }
  if (s.lr) S.lr = +s.lr;
  let re = false;
  if (s.inputs && FEATS[s.inputs]) { S.inputs = s.inputs; re = true; }
  if (Array.isArray(s.hidden)) { S.hidden = s.hidden.slice(0, 4).map(n => Math.max(1, Math.min(8, n | 0))); re = true; }
  if (re) reshape(); else { init(); placePoints(); show(); }
  if (a.train != null) { S.running = !!a.train; play.set(S.running); }
});

// ---------- the loop ----------
let acc = 0;
see.loop((dt) => {
  if (!S.running || !data.length) return;
  const t0 = performance.now(); let n = 0;
  while (performance.now() - t0 < 8 && n < 3) { epoch(data); n++; }
  if (S.epoch % 2 === 0) { const l = lossOf(data); if (isFinite(l)) S.loss.push(l); if (S.loss.length > 400) S.loss.splice(0, S.loss.length - 400); }
  acc += dt; if (acc > 0.08) { acc = 0; show(); }
});

data = SETS[S.set](NDATA);
init();
see.world = buildWorld();
flats(); placePoints(); show();
