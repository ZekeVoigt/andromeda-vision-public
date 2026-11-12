// node check-coverage.mjs [PAGE.html] [W] [H]  -- fails (exit 1) on any gap.
// Renders a solid test scene, orbits 360° in 15° steps (and a pitch sweep), zooms 1x -> 10x and orbits again at 10x.
// Every frame: pass A must cover >= 99.5% of a plain reference render's silhouette, and >= 98% of the dot cells
// inside that silhouette must carry ink on the final frame. Also: frame rate during continuous motion.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const here = path.dirname(new URL(import.meta.url).pathname);
const [page = path.join(here, 'test', 'solid.html'), W = '1200', H = '800'] = process.argv.slice(2);
const MASK = 0.995, DOTS = 0.98, FPS = 50;
const frames = [];
for (let y = 0; y < 360; y += 15) frames.push({ yaw: y, pitch: 22, zoom: 1 });
for (const p of [-35, -10, 45, 70, 85]) frames.push({ yaw: 40, pitch: p, zoom: 1 });
for (const z of [1.5, 2, 3, 4, 6, 8, 10]) frames.push({ yaw: 30, pitch: 22, zoom: z });
for (let y = 0; y < 360; y += 45) frames.push({ yaw: y, pitch: 15, zoom: 10 });
const script = [{ wait: 3 }];
if (process.env.SEE_INJECT) script.push({ eval: process.env.SEE_INJECT }, { wait: 1 }); // a deliberate fault, to prove the check catches it
for (const f of frames) script.push({ eval: `SEE.setView(${JSON.stringify(f)})` }, { wait: 0.12 }, { eval: 'SEE.coverage()', label: JSON.stringify(f) });
script.push({ eval: `new Promise(res => { const t0 = performance.now(); (function go() { SEE.goal.yaw += 0.03; SEE.touch(); if (performance.now() - t0 < 2500) requestAnimationFrame(go); else res(SEE.fps()); })(); })`, label: 'motion' });
script.push({ eval: `SEE.setView({yaw: 200, pitch: 30, zoom: 4})` }, { wait: 0.3 }, { shot: 'check-mid' });
const scratch = process.env.SEE_SCRATCH || fs.mkdtempSync('/tmp/see-check-');
const out = execFileSync('node', [path.join(here, 'shoot.mjs'), page, scratch, W, H, JSON.stringify(script)], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 24 });
let fails = 0, n = 0, worstM = 1, worstD = 1;
for (const line of out.split('\n')) {
  const m = /^EVAL (\{.*?\}|motion) (.*)$/.exec(line); if (!m) continue;
  const v = JSON.parse(m[2]);
  if (m[1] === 'motion') {
    const ok = v.fps >= FPS; if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} motion: ${v.fps.toFixed(1)} fps, worst frame ${v.worst.toFixed(1)} ms`);
    continue;
  }
  n++; worstM = Math.min(worstM, v.mask); worstD = Math.min(worstD, v.dots);
  const ok = v.mask >= MASK && v.dots >= DOTS && v.silhouette > 0.01;
  if (!ok) fails++;
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'ok  ' : 'FAIL'} ${m[1]} silhouette ${(v.silhouette * 100).toFixed(1)}% mask ${(v.mask * 100).toFixed(2)}% dots ${(v.dots * 100).toFixed(2)}%`);
}
for (const line of out.split('\n')) if (/^(EXC|error|ERR)/.test(line)) { console.log(line); fails++; }
console.log(`${n} frames checked; worst mask ${(worstM * 100).toFixed(2)}%, worst dots ${(worstD * 100).toFixed(2)}%; ${fails ? fails + ' FAILED' : 'all passed'}`);
if (n < frames.length) { console.log(`only ${n} of ${frames.length} frames measured`); process.exit(1); }
process.exit(fails ? 1 : 0);
