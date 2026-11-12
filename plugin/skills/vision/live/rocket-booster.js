// A living /vision world: a liquid-fuelled first-stage booster (LOX + RP-1, nine engines, gas-generator
// cycle) flown by real physics: thrust that grows as the air thins, propellant drained by the mass
// flow, drag, gravity falling off with height. Left: the altitude column and readouts. Middle: the
// booster in cutaway -- the tanks' levels drop as it burns; click an engine to shut it down. Right:
// one engine opened up -- pumps, turbine, gas generator, injector, chamber, nozzle -- with the gas
// speeding up through the throat at its real Mach numbers.

// ---------- the vehicle (a generic booster; numbers of the right order) ----------
const G0 = 9.80665, RE = 6371e3, OF = 2.45;           // O/F: kg of LOX per kg of RP-1
const DRY = 25e3, UPPER = 120e3, LOX0 = 284e3, RP0 = 116e3;
const FVAC = 914e3, MDOT = FVAC / (311 * G0), AE = 0.63; // per engine at 100%: vacuum thrust, kg/s, exit area m²
const PC = 97, TC = 3600, PE = 0.62;                   // chamber bar and K, exit pressure bar, at 100%
const CD = 0.32, AREF = Math.PI * 1.85 * 1.85;
const S = { t: 0, h: 0, v: 0, lox: LOX0, rp: RP0, on: false, spool: 0, throttle: 1, warp: 5, eng: Array(9).fill(true),
  phase: 'pad', maxQ: 0, maxQh: 0, apogee: 0, F: 0, q: 0, a: 0 };

// ---------- the world ----------
const W = [];
const ring = (id, r, y, x = 0, o = {}) => ({ type: 'torus', id, radius: r, tube: 0.012, at: [x, y, 0], ...o });
const rod = (id, a, b, r = 0.012, o = {}) => ({ type: 'tube', id, from: a, to: b, radius: r, ...o });
function chain(prefix, pts, n, r) { // a pipe as n short pieces along a smooth path (each can glow in turn)
  const P = t => { const k = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1))), f = t * (pts.length - 1) - k;
    return [0, 1, 2].map(i => pts[k][i] + (pts[k + 1][i] - pts[k][i]) * f); };
  const out = [];
  for (let i = 0; i < n; i++) out.push(rod(`${prefix}-${i}`, P(i / n), P((i + 1) / n), r));
  return { type: 'group', id: prefix, parts: out };
}
// the booster: x = 0, nozzles at y = -3.2, top of the upper stack at 3.9
const R = 0.55, LOXY = [-0.15, 2.85], RPY = [-2.4, -0.35], NS = 20;
function tank(id, y0, y1, label, tone) {
  const parts = [], H = y1 - y0;
  for (let y = y0; y <= y1 + 1e-6; y += H / 7) parts.push(ring(`${id}-r${parts.length}`, R, y));
  parts.push(ring(`${id}-cap0`, R * 0.62, y0 - 0.1), ring(`${id}-cap1`, R * 0.62, y1 + 0.1));
  for (let k = 0; k < 10; k++) { const a = k / 10 * 2 * Math.PI; parts.push(rod(`${id}-s${k}`, [R * Math.cos(a), y0, R * Math.sin(a)], [R * Math.cos(a), y1, R * Math.sin(a)], 0.008, { style: 'line' })); }
  const fill = [];
  for (let k = 0; k < NS; k++) fill.push({ type: 'cylinder', id: `${id}-f${k}`, radius: R * 0.9, height: H / NS * 0.86, at: [0, y0 + (k + 0.5) * H / NS, 0], tone });
  parts.push({ type: 'group', id: `${id}-fill`, parts: fill });
  return { type: 'group', id, label, parts };
}
W.push(tank('lox', LOXY[0], LOXY[1], 'liquid oxygen', 0.35), tank('rp1', RPY[0], RPY[1], 'RP-1 kerosene', -0.1));
W.push(chain('downcomer', [[0, LOXY[0], 0], [0, -1.4, 0], [0, -2.55, 0]], 12, 0.05));
W.push({ type: 'group', id: 'rpfeed', parts: [chain('rpf-a', [[0.32, RPY[0], 0], [0.32, -2.55, 0]], 3, 0.035).parts, chain('rpf-b', [[-0.32, RPY[0], 0], [-0.32, -2.55, 0]], 3, 0.035).parts].flat() });
W.push({ type: 'group', id: 'intertank', parts: [ring('it-0', R, -0.25), ring('it-1', R, -0.3)] });
W.push({ type: 'group', id: 'upper', label: 'upper stage', parts: [
  { type: 'cylinder', id: 'interstage', radius: R, height: 0.5, at: [0, 3.15, 0], tone: -0.55 },
  { type: 'cylinder', id: 'upper-body', radius: R * 0.97, height: 0.55, at: [0, 3.68, 0], tone: -0.7, quiet: true },
  { type: 'cone', id: 'fairing', radius: R * 0.97, height: 0.7, at: [0, 4.3, 0], tone: -0.7, quiet: true } ] });
// grid fins and folded legs
for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4;
  W.push({ type: 'box', id: `fin-${k}`, size: [0.28, 0.2, 0.03], at: [(R + 0.12) * Math.cos(a), 2.75, (R + 0.12) * Math.sin(a)], rot: [0, -a * 180 / Math.PI, 0], tone: -0.2 });
  W.push(rod(`leg-${k}`, [(R + 0.04) * Math.cos(a), -1.7, (R + 0.04) * Math.sin(a)], [(R + 0.1) * Math.cos(a), -3.05, (R + 0.1) * Math.sin(a)], 0.035, { tone: -0.3 })); }
// the engine section: a thrust plate and nine engines (eight round one)
const engs = [{ type: 'cylinder', id: 'octaweb', radius: R, height: 0.12, at: [0, -2.62, 0], tone: -0.2 }];
const EP = [[0, 0]].concat(Array.from({ length: 8 }, (_, k) => [0.36 * Math.cos(k * Math.PI / 4), 0.36 * Math.sin(k * Math.PI / 4)]));
EP.forEach(([x, z], i) => engs.push({ type: 'group', id: `eng-${i}`, at: [x, -2.95, z], parts: [
  { type: 'cylinder', id: `bell-${i}`, radius: 0.15, radius2: 0.065, height: 0.46, open: true, tone: 0.3 },
  { type: 'cylinder', id: `cham-${i}`, radius: 0.06, height: 0.14, at: [0, 0.29, 0], tone: 0.2 } ] }));
W.push({ type: 'group', id: 'engines', label: 'nine engines', parts: engs });
// the plume: rings of glowing particles, each built on its own spot and moved live
const PR = 15, PK = 12;
const plume = [];
for (let j = 0; j < PR; j++) for (let k = 0; k < PK; k++) { const a = (k + (j % 2) * 0.5) / PK * 2 * Math.PI, r = 0.2 + j * 0.035;
  plume.push({ type: 'sphere', id: `pl-${j}-${k}`, radius: 0.06 + j * 0.004, at: [r * Math.cos(a), -3.35 - j * 0.24, r * Math.sin(a)] }); }
W.push({ type: 'group', id: 'plume', label: 'exhaust plume', parts: plume });
// the pad, which falls away, and clouds that stream past in the lower air
W.push({ type: 'group', id: 'pad', parts: [{ type: 'box', id: 'pad-deck', size: [3.4, 0.12, 1.6], at: [0, -3.35, 0], tone: -0.5 },
  { type: 'box', id: 'pad-tower', size: [0.25, 6.6, 0.25], at: [-1.1, -0.1, -0.2], tone: -0.6, quiet: true }] });
const CLOUD = [[-1.9, 2.5], [1.8, 0.4], [-2.2, -1.8], [2.1, -3.6], [-1.6, -5], [1.6, 3.6]];
CLOUD.forEach(([x, y], i) => W.push({ type: 'group', id: `cloud-${i}`, at: [x, y, -0.6], quiet: true, parts: [
  { type: 'sphere', radius: 0.26, scale: [1.6, 0.7, 1] }, { type: 'sphere', radius: 0.2, at: [0.3, 0.08, 0], scale: [1.4, 0.8, 1] }, { type: 'sphere', radius: 0.18, at: [-0.32, 0.03, 0], scale: [1.4, 0.7, 1] } ] }));

// the altitude column and readouts (left)
const GX = -3.3, GY0 = -3.1, GH = 7.0, GMAX = 400e3, gy = h => GY0 + GH * Math.sqrt(Math.min(1, Math.max(0, h) / GMAX));
const gauge = [{ type: 'box', id: 'gauge-bar', size: [0.05, GH, 0.05], at: [GX, GY0 + GH / 2, 0], tone: -0.3 }];
[[0, '0'], [1e3, '1 km'], [10e3, '10 km'], [50e3, '50 km'], [100e3, '100 km — space'], [200e3, '200 km'], [400e3, '400 km']].forEach(([h, s], i) => {
  gauge.push({ type: 'box', id: `tick-${i}`, size: [0.22, 0.025, 0.03], at: [GX, gy(h), 0], tone: -0.1 });
  gauge.push({ type: 'note', id: `tickn-${i}`, text: s, size: 0.15, align: 'left', at: [GX + 0.2, gy(h), 0.05] }); });
gauge.push({ type: 'cone', id: 'marker', radius: 0.11, height: 0.24, rot: [0, 0, -90], at: [GX - 0.22, GY0, 0], highlight: true });
gauge.push({ type: 'box', id: 'apogee-mark', size: [0.34, 0.03, 0.03], at: [GX, GY0, 0], tone: 0.6 });
W.push({ type: 'group', id: 'gauge', label: 'altitude', parts: gauge });
const RO = ['t', 'alt', 'vel', 'acc', 'thr', 'q', 'prop'];
W.push({ type: 'group', id: 'readout', parts: RO.map((k, i) => ({ type: 'note', id: `ro-${k}`, text: k, size: 0.3, align: 'left', at: [2.0, -3.5 - i * 0.48, 0.1] })) });

// one engine, opened up (right)
const EX = 4.0, prof = y => y >= 0.2 ? 0.5 : y >= -0.3 ? 0.22 + 0.28 * (t => t * t * (3 - 2 * t))((y + 0.3) / 0.5) : 0.22 + 0.66 * (1 - Math.pow(1 - (-0.3 - y) / 2.3, 2));
const YI = 1.15, YE = -2.6, eng = [];
for (let k = 0; k < 16; k++) { const a = k / 16 * 2 * Math.PI, path = [];
  for (let y = YI; y >= YE - 1e-6; y -= 0.1) path.push([EX + prof(y) * Math.cos(a), y, prof(y) * Math.sin(a)]);
  eng.push({ type: 'curve', id: `rib-${k}`, path, radius: 0.007, style: 'line' }); }
const rings = [];
[1.15, 0.7, 0.2, -0.05, -0.3, -0.7, -1.2, -1.6, -2.1, -2.6].forEach((y, i) => rings.push(ring(`nr-${i}`, prof(y), y, EX, { tube: 0.01 })));
eng.push({ type: 'group', id: 'walls', parts: rings });
eng.push({ type: 'group', id: 'chamber', label: 'combustion chamber', parts: [
  { type: 'cylinder', id: 'injector', radius: 0.52, height: 0.09, at: [EX, YI + 0.05, 0], tone: 0.3 },
  { type: 'box', id: 'chamber-zone', size: [0.02, 0.02, 0.02], at: [EX, 0.7, 0] } ] });
eng.push({ type: 'group', id: 'nozzle', label: 'nozzle', parts: [ring('throat', 0.22, -0.3, EX, { tube: 0.022, tone: 0.6 }), ring('exit-ring', 0.88, YE, EX, { tube: 0.02 })] });
eng.push(ring('manifold', prof(-1.6) + 0.05, -1.6, EX, { tube: 0.03, tone: 0.2 }));
// the turbopump: LOX pump, turbine, fuel pump on one shaft; the gas generator that drives it
const SY = 2.05, PX = [EX + 0.95, EX + 1.55, EX + 2.15];
const pump = [rod('shaft', [PX[0] - 0.25, SY, 0], [PX[2] + 0.25, SY, 0], 0.04, { tone: 0.3 }),
  { type: 'cylinder', id: 'lox-pump', radius: 0.27, height: 0.32, rot: [0, 0, 90], at: [PX[0], SY, 0], tone: 0.1 },
  { type: 'cylinder', id: 'turbine', radius: 0.2, height: 0.16, rot: [0, 0, 90], at: [PX[1], SY, 0], tone: 0.4 },
  { type: 'cylinder', id: 'fuel-pump', radius: 0.24, height: 0.3, rot: [0, 0, 90], at: [PX[2], SY, 0], tone: -0.1 },
  { type: 'cylinder', id: 'gas-gen', radius: 0.1, height: 0.3, at: [PX[1], SY + 0.62, 0], tone: 0.3 }];
const blades = [];
for (let k = 0; k < 12; k++) { const a = k / 12 * 2 * Math.PI; blades.push({ type: 'box', id: `blade-${k}`, size: [0.1, 0.12, 0.04], at: [PX[1], SY + 0.3 * Math.cos(a), 0.3 * Math.sin(a)], rot: [-a * 180 / Math.PI, 0, 0] }); }
pump.push({ type: 'group', id: 'blades', parts: blades });
eng.push({ type: 'group', id: 'pump', label: 'turbopump', parts: pump });
// the plumbing: propellant in from the tanks, out to the engine; the turbine's exhaust overboard
eng.push(chain('lox-in', [[PX[0], 3.35, 0], [PX[0], SY + 0.3, 0]], 6, 0.045));
eng.push(chain('rp-in', [[PX[2], 3.35, 0], [PX[2], SY + 0.27, 0]], 6, 0.04));
eng.push(chain('lox-out', [[PX[0], SY - 0.28, 0], [PX[0], 1.5, 0], [EX + 0.2, 1.42, 0], [EX + 0.15, YI + 0.12, 0]], 10, 0.045));
eng.push(chain('rp-out', [[PX[2], SY - 0.26, 0], [PX[2] + 0.1, 0.2, 0], [PX[2] - 0.6, -1.3, 0], [EX + prof(-1.6) + 0.08, -1.6, 0]], 12, 0.04));
eng.push(chain('gg-feed', [[EX + 0.4, YI + 0.14, 0], [PX[1] - 0.2, SY + 0.85, 0], [PX[1], SY + 0.78, 0]], 5, 0.022));
eng.push(chain('gg-exhaust', [[PX[1], SY - 0.2, 0], [PX[1] + 0.9, SY - 0.6, 0], [PX[2] + 0.55, -1.0, 0], [PX[2] + 0.55, -1.75, 0]], 10, 0.05));
eng.push({ type: 'cone', id: 'gg-nozzle', radius: 0.1, height: 0.22, rot: [180, 0, 0], at: [PX[2] + 0.55, -1.86, 0], tone: 0.1 });
const ggp = []; for (let k = 0; k < 6; k++) ggp.push({ type: 'sphere', id: `ggp-${k}`, radius: 0.045, at: [PX[2] + 0.55 + (k % 2 ? 0.04 : -0.04), -2.05 - k * 0.14, 0] });
eng.push({ type: 'group', id: 'gg-plume', parts: ggp });
// the gas, from injector to exit: particles at their real speed (area-Mach relation, gamma 1.2)
const GAM = 1.2, NP = 90, areaOf = M => (1 / M) * Math.pow((2 / (GAM + 1)) * (1 + (GAM - 1) / 2 * M * M), (GAM + 1) / (2 * (GAM - 1)));
function machAt(y) { const ar = Math.pow(prof(y) / 0.22, 2); let lo = y > -0.3 ? 1e-3 : 1, hi = y > -0.3 ? 1 : 8;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, f = areaOf(m) - ar; if (y > -0.3 ? f > 0 : f < 0) lo = m; else hi = m; } return (lo + hi) / 2; }
const MACH = []; for (let i = 0; i <= 100; i++) MACH.push(machAt(YI - (YI - YE) * i / 100));
const mach = y => MACH[Math.max(0, Math.min(100, Math.round((YI - y) / (YI - YE) * 100)))];
const gas = [], GP = [];
for (let i = 0; i < NP; i++) { const y = YI - 0.05 - (YI - YE - 0.1) * (i + 0.5) / NP, u = ((i * 0.618) % 1) * 1.6 - 0.8, w = ((i * 0.381) % 1) * 1.2 - 0.6;
  GP.push({ y0: y, y, u, w }); gas.push({ type: 'sphere', id: `gas-${i}`, radius: 0.05, at: [EX + u * prof(y), y, w * prof(y)] }); }
eng.push({ type: 'group', id: 'gas', parts: gas });
eng.push({ type: 'note', id: 'n-chamber', text: '', size: 0.13, align: 'left', at: [EX - 1.55, 0.7, 0.1] });
eng.push({ type: 'note', id: 'n-throat', text: '', size: 0.13, align: 'left', at: [EX - 1.55, -0.3, 0.1] });
eng.push({ type: 'note', id: 'n-exit', text: '', size: 0.13, align: 'left', at: [EX - 1.9, -2.85, 0.1] });
eng.push({ type: 'note', id: 'n-pump', text: '', size: 0.12, align: 'left', at: [PX[0] - 0.2, SY + 1.15, 0.1] });
eng.push({ type: 'note', id: 'n-in', text: 'LOX in            RP-1 in', size: 0.11, at: [(PX[0] + PX[2]) / 2, 3.5, 0.1] });
W.push({ type: 'group', id: 'engine-detail', label: 'one engine, opened up', parts: eng });
W.push({ type: 'curve', id: 'callout', path: [[0.7, -2.95, 0], [1.6, -3.0, 0], [2.4, -1.6, 0], [3.0, -0.9, 0]], radius: 0.01, tone: -0.3 });
W.push({ type: 'note', id: 'n-plume', text: '', size: 0.15, align: 'left', at: [0.75, -5.2, 0.1] });
see.world = W;

// ---------- physics ----------
const firing = () => S.on && S.lox > 0 && S.rp > 0;
function step(dt) {
  const pa = 101325 * Math.exp(-S.h / 8500), rho = 1.225 * Math.exp(-S.h / 8500);
  S.spool = firing() ? Math.min(1, S.spool + dt / 1.5) : Math.max(0, S.spool - dt / 0.4);
  const n = S.eng.filter(Boolean).length, k = S.throttle * S.spool;
  const mdot = n * MDOT * k;
  S.F = Math.max(0, n * (FVAC * k - pa * AE * (S.spool > 0.05 ? 1 : 0)));
  if (mdot > 0) { S.lox = Math.max(0, S.lox - mdot * OF / (1 + OF) * dt); S.rp = Math.max(0, S.rp - mdot / (1 + OF) * dt); }
  if (S.on && (S.lox <= 0 || S.rp <= 0)) { S.on = false; S.phase = 'coast'; launch.set(false); }
  const m = DRY + UPPER + S.lox + S.rp, g = G0 * Math.pow(RE / (RE + S.h), 2), D = 0.5 * rho * S.v * Math.abs(S.v) * CD * AREF;
  S.a = (S.F - D) / m - g;
  if (S.h <= 0 && S.v <= 0 && S.a < 0) { S.a = 0; S.v = 0; S.h = 0; if (S.phase === 'coast' || S.phase === 'falling') S.phase = 'down'; }
  else { if (S.phase === 'pad' && S.a > 0) S.phase = 'burn'; S.v += S.a * dt; S.h = Math.max(0, S.h + S.v * dt); S.t += dt; }
  S.q = 0.5 * rho * S.v * S.v; if (S.q > S.maxQ) { S.maxQ = S.q; S.maxQh = S.h; }
  if (S.h > S.apogee) S.apogee = S.h; else if (S.v < 0 && S.phase === 'coast') S.phase = 'falling';
  S.pa = pa;
}

// ---------- the world from the state ----------
const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
let clock = 0;
function show(dt) {
  clock += dt;
  const fire = S.spool > 0.02, k = S.throttle * S.spool, pa = 101325 * Math.exp(-S.h / 8500);
  // tanks: each slice shown while propellant still fills it
  const lf = S.lox / LOX0, rf = S.rp / RP0;
  for (let i = 0; i < NS; i++) { see.set(`lox-f${i}`, { hide: (i + 0.5) / NS > lf }); see.set(`rp1-f${i}`, { hide: (i + 0.5) / NS > rf }); }
  // propellant moving in the pipes: a wave down each, as fast as the flow
  const wave = (prefix, n, speed, on) => { for (let i = 0; i < n; i++) { const ph = ((i - clock * speed) % 4 + 4) % 4; see.set(`${prefix}-${i}`, { glow: on && ph < 1.2 ? 1 : 0, tone: on ? 0.3 : -0.3 }); } };
  const sp = 6 * k;
  wave('downcomer', 12, sp, fire); wave('rpf-a', 3, sp, fire); wave('rpf-b', 3, sp, fire);
  wave('lox-in', 6, sp, fire); wave('rp-in', 6, sp, fire); wave('lox-out', 10, sp, fire); wave('rp-out', 12, sp, fire);
  wave('gg-feed', 5, sp, fire); wave('gg-exhaust', 10, sp * 1.4, fire);
  // the turbine spins: a glow runs round its blades
  const rpm = 36000 * k;
  for (let i = 0; i < 12; i++) { const ph = ((i - clock * rpm / 2000) % 12 + 12) % 12; see.set(`blade-${i}`, { glow: fire && ph < 2.5 ? 1 : 0, tone: fire ? 0.4 : -0.2 }); }
  see.set('gas-gen', { glow: fire ? 0.9 : 0 }); see.set('turbine', { glow: fire ? 0.5 * k : 0 });
  for (let i = 0; i < 6; i++) see.set(`ggp-${i}`, { hide: !fire || i > 5 * k, glow: 1, tone: Math.random() * 0.6 - 0.3 });
  // the nine engines
  for (let i = 0; i < 9; i++) see.set(`eng-${i}`, { glow: fire && S.eng[i] ? 1 : 0, tone: S.eng[i] ? 0 : -0.9 });
  // the walls glow where fuel cools them, the injector and chamber with the fire
  for (let i = 0; i < 16; i++) see.set(`rib-${i}`, { glow: fire ? 0.6 : 0, width: fire ? 1.3 : 1 });
  see.set('injector', { glow: fire ? 1 : 0 }); see.set('manifold', { glow: fire ? 0.8 : 0 });
  // the gas: each particle at its local speed, hot (orange) in the chamber, cooling as it expands
  for (let i = 0; i < NP; i++) {
    const p = GP[i], M = mach(p.y), T = 1 / (1 + (GAM - 1) / 2 * M * M), v = 0.15 + 1.25 * M;
    if (fire) { p.y -= v * dt * (0.4 + 0.6 * k); if (p.y < YE) p.y = YI - 0.05; }
    const r = prof(p.y);
    see.set(`gas-${i}`, { hide: !fire, move: [p.u * r - p.u * prof(p.y0), p.y - p.y0, p.w * r - p.w * prof(p.y0)], glow: T > 0.55 ? 1 : 0, tone: T * 1.3 - 0.5 });
  }
  // the plume: as long as the thrust, as wide as the exit pressure is over the air's (it balloons with height)
  const n = S.eng.filter(Boolean).length, over = PE * k * 1e5 / Math.max(50, pa), spread = Math.min(4.5, Math.max(0.55, Math.sqrt(over)));
  const len = fire ? Math.ceil(PR * Math.min(1, 0.35 + 0.65 * k) * (0.4 + 0.6 * n / 9)) : 0, diamonds = pa > 40000;
  for (let j = 0; j < PR; j++) for (let kk = 0; kk < PK; kk++) {
    const a = (kk + (j % 2) * 0.5) / PK * 2 * Math.PI, r0 = 0.2 + j * 0.035, r = (0.18 + j * 0.05 * spread) * (0.85 + 0.3 * Math.random()), jit = (Math.random() - 0.5) * 0.08;
    see.set(`pl-${j}-${kk}`, j >= len ? { hide: true } : { hide: false, move: [(r - r0) * Math.cos(a), jit - (spread > 1.2 ? j * 0.03 * (spread - 1) : 0), (r - r0) * Math.sin(a)],
      glow: 1, tone: (diamonds && j % 3 === 1 ? 0.9 : 0.1) - j * 0.06 + Math.random() * 0.3 });
  }
  // the pad drops away; clouds stream past in the lower air
  see.set('pad', { move: [0, -Math.min(9, S.h * 0.004), 0], hide: S.h > 2400 });
  CLOUD.forEach(([, y], i) => { const yy = ((y + 5 - S.h * 0.0022) % 10 + 10) % 10 - 5; see.set(`cloud-${i}`, { move: [0, yy - y, 0], hide: S.h < 300 || S.h > 14000 }); });
  see.set('marker', { move: [0, gy(S.h) - GY0, 0] }); see.set('apogee-mark', { move: [0, gy(S.apogee) - GY0, 0], hide: S.apogee < 500 });
  // the words
  const m = DRY + UPPER + S.lox + S.rp, TW = S.F / (m * G0);
  see.text('ro-t', `T+ **${fmt(S.t, 1)} s** · ${S.phase === 'pad' ? (S.on ? 'engines starting' : 'on the pad') : S.phase}`);
  see.text('ro-alt', `altitude  **${S.h < 1000 ? fmt(S.h) + ' m' : fmt(S.h / 1000, 1) + ' km'}**`);
  see.text('ro-vel', `speed  **${fmt(S.v)} m/s**  (Mach ${fmt(S.v / 300, 1)})`);
  see.text('ro-acc', `acceleration  **${fmt(S.a / G0 + (S.h > 0 ? 1 : 0), 1)} g**`);
  see.text('ro-thr', `thrust  **${fmt(S.F / 1e6, 2)} MN** · T/W ${fmt(TW, 2)}`);
  see.text('ro-q', `air pressure on it  **${fmt(S.q / 1000, 1)} kPa**${S.maxQ > 1000 ? ` · max ${fmt(S.maxQ / 1000)} kPa at ${fmt(S.maxQh / 1000, 1)} km` : ''}`);
  see.text('ro-prop', `propellant  **${fmt((S.lox + S.rp) / 1000)} t** of 400 t · mass ${fmt(m / 1000)} t`);
  see.text('n-chamber', fire ? `${fmt(PC * k)} bar · ${fmt(TC)} K\nkerosene + oxygen burning\nMach ${fmt(mach(0.7), 2)}` : 'chamber cold');
  see.text('n-throat', fire ? `throat: Mach 1.00\n${fmt(MDOT * k)} kg/s through each engine` : 'throat');
  const ve = (FVAC * k - 0) / Math.max(1, MDOT * k);
  see.text('n-exit', fire ? `exit: Mach ${fmt(mach(YE), 1)} · ${fmt(ve / 1000, 2)} km/s\n${fmt(PE * k, 2)} bar out vs ${fmt(pa / 1e5, 2)} bar air` : 'exit');
  see.text('n-pump', fire ? `turbopump  **${fmt(rpm)} rpm**\na small burn in the gas generator spins the turbine` : 'turbopump idle');
  see.text('n-plume', !fire ? '' : over < 0.9 ? 'over-expanded: the air squeezes the plume narrow (shock diamonds)' : over < 1.3 ? 'matched to the air' : 'under-expanded: thin air, the plume balloons wide');
  see.status(`T+ **${fmt(S.t, 1)} s** · ${S.h < 1000 ? fmt(S.h) + ' m' : fmt(S.h / 1000, 1) + ' km'} · ${fmt(S.v)} m/s · ${fmt(S.F / 1e6, 1)} MN · ${fmt((S.lox + S.rp) / 4000)}% propellant${S.apogee > 1000 && S.phase !== 'burn' ? ` · apogee ${fmt(S.apogee / 1000)} km` : ''}`);
}

// ---------- hands on ----------
see.on('click', h => { // an engine: shut it down, or relight it
  const e = (h.ids || []).find(k => /^eng-\d$/.test(k)); if (!e) return false;
  const i = +e.slice(4); S.eng[i] = !S.eng[i]; return true;
});
function reset() { Object.assign(S, { t: 0, h: 0, v: 0, lox: LOX0, rp: RP0, on: false, spool: 0, phase: 'pad', maxQ: 0, maxQh: 0, apogee: 0, F: 0, q: 0, a: 0 }); S.eng.fill(true); launch.set(false); }
const launch = see.control({ type: 'toggle', label: 'Launch', onLabel: 'Shut down', value: false, on: v => { if (v && (S.lox <= 0 || S.rp <= 0)) { reset(); } S.on = v; } });
see.control({ type: 'slider', label: 'throttle', min: 0.4, max: 1, step: 0.01, value: 1, format: v => Math.round(v * 100) + '%', on: v => { S.throttle = v; } });
const warp = see.control({ type: 'select', label: 'time', options: ['1×', '5×', '20×'], value: '5×', on: v => { S.warp = parseInt(v); } });
see.control({ type: 'button', label: 'Reset', on: reset });
see.control({ type: 'button', label: 'Ask Claude', on: () => see.say(`About my rocket: T+${fmt(S.t, 1)} s, ${fmt(S.h / 1000, 1)} km, ${fmt(S.v)} m/s, thrust ${fmt(S.F / 1e6, 2)} MN, ${S.eng.filter(Boolean).length} of 9 engines, throttle ${Math.round(S.throttle * 100)}%, ${fmt((S.lox + S.rp) / 1000)} t propellant left. What is happening right now?`) });
// Claude can fly it: say.py --app '{"launch": true, "throttle": 0.7, "warp": 20, "engines": [true,false,...]}'
see.on('claude', a => {
  if (a.reset) reset();
  if (a.throttle) S.throttle = Math.max(0.4, Math.min(1, +a.throttle));
  if (a.warp) { S.warp = +a.warp; warp.set(a.warp + '×'); }
  if (Array.isArray(a.engines)) a.engines.slice(0, 9).forEach((v, i) => { S.eng[i] = !!v; });
  if (a.launch != null) { S.on = !!a.launch; launch.set(S.on); }
});

// ---------- the loop: it lights itself a moment after it appears ----------
let since = 0;
see.loop(dt => {
  since += dt;
  if (since > 2.5 && since - dt <= 2.5 && S.phase === 'pad' && !S.on) { S.on = true; launch.set(true); }
  let left = dt * S.warp; while (left > 0) { const h = Math.min(0.02, left); step(h); left -= h; }
  show(dt);
});
see.set('lox-fill', { flat: true }); see.set('rp1-fill', { flat: true });
show(0);
