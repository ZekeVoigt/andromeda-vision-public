// A living /vision world: a 3-qubit quantum computer -- an exact state-vector simulator wired to the
// world. Left: the dilution refrigerator, a microwave pulse running down a qubit's line for every gate.
// Top: the circuit -- click any cell to change its gate; a playhead runs it column by column. Right of
// it: each qubit's Bloch sphere (the arrow shrinks to the middle when a qubit is entangled and has no
// state of its own). Bottom: the 8 amplitudes -- bar = probability, dial = phase -- and the
// histogram of measured outcomes. Each stop of the tour loads its own circuit.

// ---------- the simulator ----------
const NQ = 3, DIM = 8, r2 = Math.SQRT1_2;
const C = (re, im = 0) => [re, im], cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], ca = (a, b) => [a[0] + b[0], a[1] + b[1]];
const GATES = {
  H: [[C(r2), C(r2)], [C(r2), C(-r2)]], X: [[C(0), C(1)], [C(1), C(0)]], Y: [[C(0), C(0, -1)], [C(0, 1), C(0)]],
  Z: [[C(1), C(0)], [C(0), C(-1)]], S: [[C(1), C(0)], [C(0), C(0, 1)]], T: [[C(1), C(0)], [C(0), C(r2, r2)]],
};
GATES['⊕'] = GATES.X;
const bitOf = q => 1 << (NQ - 1 - q);                   // q0 is the leftmost bit of |q0 q1 q2>
let psi;
const zero = () => { psi = Array.from({ length: DIM }, (_, i) => C(i === 0 ? 1 : 0)); };
function apply(U, q, ctrl = 0) {
  const m = bitOf(q);
  for (let i = 0; i < DIM; i++) if (!(i & m) && (i & ctrl) === ctrl) {
    const a0 = psi[i], a1 = psi[i | m];
    psi[i] = ca(cm(U[0][0], a0), cm(U[0][1], a1)); psi[i | m] = ca(cm(U[1][0], a0), cm(U[1][1], a1));
  }
}
const prob = i => psi[i][0] * psi[i][0] + psi[i][1] * psi[i][1];
function measureAll() { let u = Math.random(), k = DIM - 1; for (let i = 0; i < DIM; i++) { u -= prob(i); if (u <= 0) { k = i; break; } }
  psi = psi.map((_, i) => C(i === k ? 1 : 0)); return k; }
function bloch(q) { // the qubit's own state: <X>, <Y>, <Z> of its reduced density matrix
  const m = bitOf(q); let z = 0, re = 0, im = 0;
  for (let i = 0; i < DIM; i++) { z += (i & m ? -1 : 1) * prob(i); if (!(i & m)) { const a = psi[i], b = psi[i | m]; re += a[0] * b[0] + a[1] * b[1]; im += a[1] * b[0] - a[0] * b[1]; } }
  return [2 * re, -2 * im, z];
}

// ---------- circuits: cells[col][q] = '', H, X, Y, Z, S, T, • (control), ⊕ (X under a control), M ----------
const NC = 18;
const col = (...g) => g.concat(Array(NQ - g.length).fill(''));
const ORACLE = [col('', 'X', ''), col('•', '•', 'Z'), col('', 'X', '')], DIFF = [col('H', 'H', 'H'), col('X', 'X', 'X'), col('•', '•', 'Z'), col('X', 'X', 'X'), col('H', 'H', 'H')];
const PRESETS = {
  "Grover: find 101": [col('H', 'H', 'H'), ...ORACLE, ...DIFF, ...ORACLE, ...DIFF, col('M', 'M', 'M')],
  'one qubit: H': [col('H'), col('M', 'M', 'M')],
  'gates: X, H, Z, H': [col('X'), col('H'), col('Z'), col('H'), col('M', 'M', 'M')],
  'superposition: H on all': [col('H', 'H', 'H'), col('M', 'M', 'M')],
  'entangle: Bell pair': [col('H'), col('•', '⊕'), col('M', 'M', 'M')],
  'entangle: GHZ': [col('H'), col('•', '⊕'), col('', '•', '⊕'), col('M', 'M', 'M')],
  'interference: H, H': [col('H'), col('H'), col('M', 'M', 'M')],
  empty: [col('M', 'M', 'M')],
};
let cells, preset = "Grover: find 101", edited = false;
function load(name) { preset = name; edited = false; cells = Array.from({ length: NC }, (_, c) => (PRESETS[name][c] || col()).slice()); restart(); presetSel && presetSel.set(name); }
const lastCol = () => { let n = 0; cells.forEach((c, i) => { if (c.some(Boolean)) n = i + 1; }); return n; };
function runColumn(c) { // apply one column to the state; returns what it did, for the world
  const g = cells[c], ctrl = g.reduce((m, s, q) => s === '•' ? m | bitOf(q) : m, 0), hit = [];
  if (g.includes('M')) return { measured: measureAll(), hit: g.map((s, q) => s === 'M' ? q : -1).filter(q => q >= 0) };
  g.forEach((s, q) => { if (GATES[s]) { apply(GATES[s], q, ctrl); hit.push(q); if (S.noise > 0 && Math.random() < S.noise) apply(GATES['XYZ'[Math.floor(Math.random() * 3)]], q); } });
  return { hit };
}
function shots(n) { // the whole circuit n times, each run fresh, each ending in a measurement
  const keep = psi, counts = Array(DIM).fill(0), L = lastCol();
  for (let k = 0; k < n; k++) { zero(); let out = -1; for (let c = 0; c < L; c++) { const r = runColumn(c); if (r.measured != null) out = r.measured; } if (out < 0) out = measureAll(); counts[out]++; }
  psi = keep; return counts;
}

// ---------- the world ----------
const W = [];
const WY = [2.7, 1.9, 1.1], CX0 = -3.0, DX = 0.36, cx = c => CX0 + c * DX;
// the refrigerator (left): plates colder and colder, lines spiralling down to the chip
const FX = -5.7, PL = [[3.3, 1.0, '50 K'], [2.5, 0.9, '4 K'], [1.75, 0.78, '0.8 K'], [1.05, 0.68, '0.1 K'], [0.35, 0.6, '15 mK — colder than space']];
const fr = [];
PL.forEach(([y, r, t], i) => { fr.push({ type: 'cylinder', id: `plate-${i}`, radius: r, height: 0.06, at: [FX, y, 0], tone: 0.2 });
  fr.push({ type: 'note', id: `temp-${i}`, text: t, size: 0.13, align: 'left', at: [FX + r + 0.12, y, 0.05] }); });
for (let i = 0; i + 1 < PL.length; i++) for (let k = 0; k < 3; k++) { const a = k / 3 * 2 * Math.PI + 0.5, r = PL[i + 1][1] * 0.85;
  fr.push({ type: 'tube', id: `post-${i}-${k}`, from: [FX + r * Math.cos(a), PL[i][0], r * Math.sin(a)], to: [FX + r * Math.cos(a), PL[i + 1][0], r * Math.sin(a)], radius: 0.025, tone: -0.2 }); }
fr.push({ type: 'cylinder', id: 'can', radius: 0.42, height: 0.9, at: [FX, -0.25, 0], open: true, tone: -0.4 });
fr.push({ type: 'box', id: 'chip', size: [0.5, 0.06, 0.5], at: [FX, -0.62, 0], tone: 0.4, label: 'qubit chip' });
const pads = [];
for (let q = 0; q < NQ; q++) pads.push({ type: 'box', id: `pad-${q}`, size: [0.1, 0.05, 0.1], at: [FX - 0.15 + q * 0.15, -0.57, 0.05] });
fr.push({ type: 'group', id: 'pads', parts: pads });
const LINES = 4, LN = 26; // 3 control lines and a readout line, each in short pieces that light in turn
for (let l = 0; l < LINES; l++) {
  const seg = [];
  for (let i = 0; i < LN; i++) { const p = t => { const y = 3.45 - t * 4.0, a = l * 1.57 + t * 5, r = 0.18 + 0.1 * Math.sin(t * 9 + l);
      return [FX + (l === 3 ? 0.3 : -0.15 + l * 0.15) * (t > 0.92 ? 1 : 0.4) + r * Math.cos(a) * (1 - t), y, r * Math.sin(a) * (1 - t)]; };
    seg.push({ type: 'tube', id: `line-${l}-${i}`, from: p(i / LN), to: p((i + 1) / LN), radius: 0.018 }); }
  fr.push({ type: 'group', id: `line-${l}`, parts: seg });
}
W.push({ type: 'group', id: 'fridge', label: 'dilution refrigerator', parts: fr });
// the circuit (top)
const circ = [];
WY.forEach((y, q) => { circ.push({ type: 'tube', id: `wire-${q}`, from: [CX0 - 0.35, y, 0], to: [cx(NC - 1) + 0.25, y, 0], radius: 0.012, tone: -0.2 });
  circ.push({ type: 'note', id: `wl-${q}`, text: `q${q}  |0⟩`, size: 0.16, align: 'left', at: [CX0 - 1.05, y, 0.05] }); });
for (let c = 0; c < NC; c++) {
  for (let q = 0; q < NQ; q++) {
    circ.push({ type: 'group', id: `cell-${c}-${q}`, at: [cx(c), WY[q], 0], parts: [
      { type: 'box', id: `gb-${c}-${q}`, size: [0.27, 0.27, 0.05], round: 0.03 },
      { type: 'sphere', id: `dot-${c}-${q}`, radius: 0.065, at: [0, 0, 0.03] },
      { type: 'torus', id: `xor-${c}-${q}`, radius: 0.1, tube: 0.018, rot: [90, 0, 0], at: [0, 0, 0.03] },
      { type: 'note', id: `gn-${c}-${q}`, text: '', size: 0.2, weight: 'bold', at: [0, 0, 0.04] } ] });
  }
  for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) circ.push({ type: 'tube', id: `vc-${c}-${a}${b}`, from: [cx(c), WY[a], 0.02], to: [cx(c), WY[b], 0.02], radius: 0.014 });
}
circ.push({ type: 'box', id: 'playhead', size: [0.04, 2.25, 0.04], at: [cx(0), 1.9, 0.06], highlight: true });
circ.push({ type: 'note', id: 'n-circuit', text: '', size: 0.15, align: 'left', at: [CX0 - 1.05, 3.35, 0.05] });
W.push({ type: 'group', id: 'circuit', label: 'the circuit', parts: circ });
// the Bloch spheres, one per qubit (right of the wires)
const BX = 4.05, BR = 0.33, BN = 7, blochs = [];
WY.forEach((y, q) => {
  const parts = [{ type: 'torus', id: `bs-eq-${q}`, radius: BR, tube: 0.008 }, { type: 'torus', id: `bs-m1-${q}`, radius: BR, tube: 0.008, rot: [90, 0, 0] },
    { type: 'torus', id: `bs-m2-${q}`, radius: BR, tube: 0.008, rot: [0, 0, 90] },
    { type: 'note', id: `bs-0-${q}`, text: '|0⟩', size: 0.1, at: [0, BR + 0.1, 0] }, { type: 'note', id: `bs-1-${q}`, text: '|1⟩', size: 0.1, at: [0, -BR - 0.1, 0] }];
  for (let k = 1; k <= BN; k++) parts.push({ type: 'sphere', id: `bv-${q}-${k}`, radius: k === BN ? 0.05 : 0.022, at: [0, BR * k / BN, 0] }); // the arrow, as dots
  blochs.push({ type: 'group', id: `bloch-${q}`, at: [BX, y, 0], parts });
});
W.push({ type: 'group', id: 'bloch', label: 'each qubit on its Bloch sphere', parts: blochs });
// the state: 8 amplitudes (bottom left) and the histogram (bottom right)
const AX0 = -3.3, ADX = 0.52, AY = -2.7, AH = 2.2, AS = 22, HX0 = 1.15, HDX = 0.46, HH = 1.7, HS = 17;
const label = i => '|' + i.toString(2).padStart(NQ, '0') + '⟩', amps = [], hist = [];
for (let i = 0; i < DIM; i++) {
  const sl = []; for (let k = 0; k < AS; k++) sl.push({ type: 'box', id: `as-${i}-${k}`, size: [0.34, AH / AS * 0.8, 0.2], at: [0, AY + (k + 0.5) * AH / AS, 0] });
  amps.push({ type: 'group', id: `amp-${i}`, at: [AX0 + i * ADX, 0, 0], parts: [{ type: 'group', id: `ab-${i}`, parts: sl },
    { type: 'torus', id: `dial-${i}`, radius: 0.15, tube: 0.012, rot: [90, 0, 0], at: [0, AY - 0.3, 0] },
    { type: 'sphere', id: `dp-${i}`, radius: 0.045, at: [0.15, AY - 0.3, 0.02] },
    { type: 'note', id: `al-${i}`, text: label(i), size: 0.14, at: [0, AY - 0.62, 0.05] },
    { type: 'note', id: `ap-${i}`, text: '', size: 0.12, at: [0, AY + AH + 0.15, 0.05] } ] });
  const hs = []; for (let k = 0; k < HS; k++) hs.push({ type: 'box', id: `hs-${i}-${k}`, size: [0.3, HH / HS * 0.8, 0.2], at: [0, AY + (k + 0.5) * HH / HS, 0] });
  hist.push({ type: 'group', id: `hist-${i}`, at: [HX0 + i * HDX, 0, 0], parts: [{ type: 'group', id: `hb-${i}`, parts: hs },
    { type: 'note', id: `hl-${i}`, text: label(i), size: 0.13, at: [0, AY - 0.25, 0.05] }, { type: 'note', id: `hc-${i}`, text: '', size: 0.12, at: [0, AY + HH + 0.15, 0.05] }] });
}
W.push({ type: 'group', id: 'amplitudes', label: 'the state: 8 amplitudes at once', parts: amps });
W.push({ type: 'group', id: 'histogram', label: 'measured outcomes', parts: hist });
see.world = W;

// ---------- the world from the state ----------
const S = { playing: true, col: 0, wait: 0, speed: 1.1, noise: 0, counts: Array(DIM).fill(0), last: -1, pulses: [], flash: -1, note: '' };
function restart() { zero(); S.col = 0; S.wait = 0.6; S.last = -1; S.counts = Array(DIM).fill(0); S.note = ''; }
function paintCircuit() {
  const L = lastCol();
  for (let c = 0; c < NC; c++) {
    const g = cells[c], ctr = g.map(s => s === '•'), any = g.some(Boolean);
    for (let q = 0; q < NQ; q++) {
      const s = g[q], gate = !!s && s !== '•' && s !== '⊕', done = c < S.col;
      see.set(`gb-${c}-${q}`, { hide: !gate && !!s, tone: gate ? 0.5 : -1.1, glow: gate && c === S.col - 1 ? 1 : 0 });
      see.set(`dot-${c}-${q}`, { hide: s !== '•', glow: c === S.col - 1 ? 1 : 0 });
      see.set(`xor-${c}-${q}`, { hide: s !== '⊕', glow: c === S.col - 1 ? 1 : 0 });
      see.text(`gn-${c}-${q}`, gate ? s : '');
      see.set(`cell-${c}-${q}`, { tone: done || !any ? 0 : -0.25 });
    }
    const top = g.findIndex(Boolean), bot = g.length - 1 - [...g].reverse().findIndex(Boolean), link = ctr.some(Boolean) && top !== bot;
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) see.set(`vc-${c}-${a}${b}`, { hide: !(link && a === top && b === bot) });
  }
  see.set('playhead', { move: [Math.min(S.col, NC) * DX - DX / 2, 0, 0], hide: S.col === 0 || S.col > L });
}
function paintState(dt) {
  for (let i = 0; i < DIM; i++) {
    const p = prob(i), ph = Math.atan2(psi[i][1], psi[i][0]), n = Math.round(p * AS);
    for (let k = 0; k < AS; k++) see.set(`as-${i}-${k}`, { hide: k >= n, glow: i === S.last ? 1 : 0, tone: 0.3 });
    see.set(`dp-${i}`, { hide: p < 1e-4, move: [0.15 * Math.cos(ph) - 0.15, 0.15 * Math.sin(ph), 0], glow: Math.cos(ph) < -0.5 ? 0 : 1 });
    see.set(`dial-${i}`, { tone: p < 1e-4 ? -1 : 0 });
    see.text(`ap-${i}`, p < 0.0005 ? '' : (p * 100).toFixed(p < 0.1 ? 1 : 0) + '%' + (Math.cos(ph) < -0.5 ? ' (−)' : ''));
    const tot = S.counts.reduce((a, b) => a + b, 0), hn = tot ? Math.round(S.counts[i] / Math.max(...S.counts) * HS) : 0;
    for (let k = 0; k < HS; k++) see.set(`hs-${i}-${k}`, { hide: k >= hn, tone: 0.2, glow: i === S.flash ? 1 : 0 });
    see.text(`hc-${i}`, S.counts[i] ? String(S.counts[i]) : '');
  }
  for (let q = 0; q < NQ; q++) {
    const [x, y, z] = bloch(q), len = Math.hypot(x, y, z);
    for (let k = 1; k <= BN; k++) { const f = k / BN; see.set(`bv-${q}-${k}`, { move: [BR * x * f, BR * z * f - BR * f, BR * y * f], glow: k === BN ? 1 : 0, hide: len < 0.08 && k < BN }); }
    see.text(`wl-${q}`, `q${q}  ${len < 0.15 ? 'entangled' : z > 0.98 ? '|0⟩' : z < -0.98 ? '|1⟩' : 'superposed'}`);
  }
  // microwave pulses down the lines; the readout comes back up
  for (const p of S.pulses) p.t += dt * 1.6;
  S.pulses = S.pulses.filter(p => p.t < 1.15);
  for (let l = 0; l < LINES; l++) for (let i = 0; i < LN; i++) {
    let g = 0; for (const p of S.pulses) if (p.line === l) { const at = p.up ? 1 - p.t : p.t; if (Math.abs(i / LN - at) < 0.07) g = 1; }
    see.set(`line-${l}-${i}`, { glow: g, tone: -0.1 });
  }
  for (let q = 0; q < NQ; q++) see.set(`pad-${q}`, { glow: S.pulses.some(p => (p.line === q && p.t > 0.85) || (p.up && p.t < 0.3)) ? 1 : 0 });
  see.text('n-circuit', `${preset}${edited ? ' (edited)' : ''}${S.note ? ' — ' + S.note : ''}`);
  const tot = S.counts.reduce((a, b) => a + b, 0), best = S.counts.indexOf(Math.max(...S.counts));
  see.status(`column **${Math.min(S.col, lastCol())}/${lastCol()}** · ${S.note || 'ready'} · ${tot} shots${tot ? ` · most often ${label(best)} (${Math.round(S.counts[best] / tot * 100)}%)` : ''}`);
}
const NAMES = { H: 'Hadamard: a half-turn that makes a superposition', X: 'X: flips |0⟩ and |1⟩', Z: 'Z: flips the phase of |1⟩', Y: 'Y: flip and phase', S: 'S: a quarter-turn of phase', T: 'T: an eighth-turn of phase', '⊕': 'CNOT: flips the target when the control is 1' };
function advance() {
  const L = lastCol();
  if (S.col >= L) { // the run is over: next shot
    zero(); S.col = 0; S.last = -1; S.note = 'next shot'; return;
  }
  const g = cells[S.col], r = runColumn(S.col);
  if (r.measured != null) { S.last = r.measured; S.counts[r.measured]++; S.flash = r.measured; S.note = `measured ${label(r.measured)}`; S.pulses.push({ line: 3, t: 0, up: true }); }
  else { r.hit.forEach(q => S.pulses.push({ line: q, t: 0 })); const s = g.find(x => x && x !== '•' && x !== 'M'); S.note = s ? (g.includes('•') && s !== '⊕' ? `controlled ${s}` : NAMES[s] || s) : 'idle'; }
  S.col++;
}

// ---------- hands on ----------
const CYCLE = ['', 'H', 'X', 'Z', 'S', 'T', 'Y', '•', '⊕', 'M'];
see.on('click', h => {
  const cell = (h.ids || []).find(k => /^cell-\d+-\d$/.test(k)); if (!cell) return false;
  const [, c, q] = cell.split('-').map(Number), now = cells[c][q];
  cells[c][q] = CYCLE[(CYCLE.indexOf(now) + 1) % CYCLE.length];
  if (cells[c][q] === 'M') cells[c] = cells[c].map(() => 'M'); else if (now === 'M') cells[c] = cells[c].map(s => s === 'M' ? '' : s);
  edited = true; restart(); return true;
});
const play = see.control({ type: 'toggle', label: 'Run', onLabel: 'Pause', value: true, on: v => { S.playing = v; } });
see.control({ type: 'button', label: 'Step', on: () => { S.playing = false; play.set(false); advance(); } });
see.control({ type: 'button', label: '200 shots', on: () => { const c = shots(200); S.counts = S.counts.map((v, i) => v + c[i]); S.flash = -1; S.note = '200 shots run'; } });
see.control({ type: 'slider', label: 'speed', min: 0.3, max: 4, value: S.speed, format: v => v.toFixed(1) + '×', on: v => { S.speed = v; } });
see.control({ type: 'slider', label: 'noise', min: 0, max: 0.2, step: 0.01, value: 0, format: v => Math.round(v * 100) + '%', on: v => { S.noise = v; } });
const presetSel = see.control({ type: 'select', label: 'circuit', options: Object.keys(PRESETS), value: preset, on: v => load(v) });
see.control({ type: 'button', label: 'Ask Claude', on: () => see.say(`About my quantum circuit "${preset}"${edited ? ' (edited)' : ''}: ${cells.slice(0, lastCol()).map(c => c.map(s => s || '·').join('')).join(' ')}. State now: ${psi.map((a, i) => prob(i) > 0.001 ? label(i) + ' ' + Math.round(prob(i) * 100) + '%' : '').filter(Boolean).join(', ')}. Counts: ${S.counts.join('/')}. What is it doing?`) });
// each stop of the tour loads its own circuit (unless you have edited one)
const STOP = ["Grover: find 101", "Grover: find 101", 'one qubit: H', 'gates: X, H, Z, H', 'superposition: H on all', 'entangle: Bell pair', 'interference: H, H', "Grover: find 101", "Grover: find 101", "Grover: find 101"];
see.on('stop', k => { if (!edited && STOP[k] && STOP[k] !== preset) load(STOP[k]); });
// Claude can drive it: say.py --app '{"circuit": "entangle: GHZ", "noise": 0.05, "shots": 200}'
see.on('claude', a => { if (a.circuit && PRESETS[a.circuit]) load(a.circuit); if (a.noise != null) S.noise = +a.noise; if (a.shots) { const c = shots(+a.shots); S.counts = S.counts.map((v, i) => v + c[i]); } if (a.play != null) { S.playing = !!a.play; play.set(S.playing); } });

// ---------- the loop ----------
see.loop(dt => {
  if (S.playing) { S.wait -= dt * S.speed; if (S.wait <= 0) { advance(); S.wait = S.col === 0 ? 1.4 : cells[S.col - 1] && cells[S.col - 1].includes('M') ? 2.0 : 0.85; } }
  paintCircuit(); paintState(dt);
});
load(preset);
see.set('ab-0', {}); for (let i = 0; i < DIM; i++) { see.set(`ab-${i}`, { flat: true }); see.set(`hb-${i}`, { flat: true }); }
paintCircuit(); paintState(0);
