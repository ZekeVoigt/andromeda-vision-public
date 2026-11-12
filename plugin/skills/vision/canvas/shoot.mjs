// node shoot.mjs PAGE.html OUTDIR WIDTH HEIGHT SCRIPT.json   (or SCRIPT as an inline JSON string)
// Drives the /vision canvas in real headless Chrome (GPU, 2x) through a script of actions and writes PNGs:
//   {"wait": s} {"waitFor": "js expr"} {"eval": "js"} {"shot": "name"} {"move": [x, y]}
//   {"drag": [x0, y0, x1, y1, steps, "left"|"right"]} {"wheel": [x, y, deltaY, steps]} {"click": [x, y]} {"dblclick": [x, y]}
//   {"key": "ArrowRight"}  {"rclick": [x, y]}
// Prints every eval result and console error. Chrome profiles go in $SEE_SCRATCH.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [page, outDir, wArg = '1200', hArg = '800', scriptArg = '[]'] = process.argv.slice(2);
const script = scriptArg.trim().startsWith('[') ? JSON.parse(scriptArg) : JSON.parse(fs.readFileSync(scriptArg, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const port = 20000 + Math.floor(Math.random() * 30000);
const scratch = process.env.SEE_SCRATCH || outDir;
const udd = path.join(scratch, 'chrome-' + port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--use-angle=metal',
  '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${wArg},${hArg}`,
  ...(process.env.SEE_LIGHT ? ['--force-prefers-color-scheme=light'] : []), 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const waiting = new Map(), logs = [];
async function connect() {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const t = l.find(x => x.type === 'page'); if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(150);
  }
  throw new Error('chrome did not start');
}
const call = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', Object.assign({ type, x, y }, extra));
const evalJS = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result && r.result.value; };
try {
  ws = new WebSocket(await connect());
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning' || process.env.SEE_LOG))
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 400));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: +wArg, height: +hArg, deviceScaleFactor: 2, mobile: false });
  if (process.env.SEE_LIGHT) await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await call('Page.navigate', { url: 'file://' + path.resolve(page) });
  for (let i = 0; i < 100; i++) { if (await evalJS('!!window.SEE_READY') === true) break; await sleep(100); }
  for (const a of script) {
    if (a.wait != null) await sleep(a.wait * 1000);
    if (a.waitFor) for (let i = 0; i < 100; i++) { if (await evalJS(a.waitFor)) break; await sleep(100); }
    if (a.eval) { const v = await evalJS(a.eval); console.log('EVAL', a.label || '', JSON.stringify(v)); }
    if (a.move) await mouse('mouseMoved', ...a.move);
    if (a.click || a.rclick) { const [x, y] = a.click || a.rclick, b = a.click ? 'left' : 'right';
      await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: b, buttons: b === 'left' ? 1 : 2, clickCount: 1 }); await mouse('mouseReleased', x, y, { button: b, clickCount: 1 }); }
    if (a.dblclick) { const [x, y] = a.dblclick;
      for (const c of [1, 2]) { await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: c }); await mouse('mouseReleased', x, y, { button: 'left', clickCount: c }); } }
    if (a.drag) {
      const [x0, y0, x1, y1, n = 20, btn = 'left'] = a.drag, buttons = btn === 'left' ? 1 : 2;
      await mouse('mouseMoved', x0, y0); await mouse('mousePressed', x0, y0, { button: btn, buttons, clickCount: 1 });
      for (let k = 1; k <= n; k++) { await mouse('mouseMoved', x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, { button: btn, buttons }); await sleep(16); }
      await mouse('mouseReleased', x1, y1, { button: btn, clickCount: 1 });
    }
    if (a.wheel) { const [x, y, dy, n = 6] = a.wheel; for (let k = 0; k < n; k++) { await mouse('mouseWheel', x, y, { deltaX: 0, deltaY: dy / n }); await sleep(16); } }
    if (a.key) for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: a.key, code: a.key, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, Escape: 27, Enter: 13 }[a.key] || 0 });
    if (a.type) await call('Input.insertText', { text: a.type });
    if (a.shot) {
      const s = await call('Page.captureScreenshot', { format: 'png' });
      const f = path.join(outDir, a.shot + '.png'); fs.writeFileSync(f, Buffer.from(s.data, 'base64')); console.log('SHOT', f);
    }
  }
} catch (e) { console.log('ERR', e.message); }
finally { for (const l of logs.slice(0, 40)) console.log(l); chrome.kill('SIGKILL'); await sleep(300); fs.rmSync(udd, { recursive: true, force: true }); process.exit(0); }
