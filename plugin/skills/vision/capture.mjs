// node capture.mjs PAGE.html OUTPREFIX "1,2,3" [wait seconds] [width] [height] [js to run before each shot]
// Writes OUTPREFIX-N.png per step (2x). Chrome profiles go in $VISION_SCRATCH (default: this dir).
// Real-time captures of a /vision page in headless Chrome over CDP, each run on a random port.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [page, prefix, stepsArg = '1', waitArg = '6', wArg = '1500', hArg = '950', js = ''] = process.argv.slice(2);
const port = 20000 + Math.floor(Math.random() * 30000);
const scratch = process.env.VISION_SCRATCH || path.dirname(new URL(import.meta.url).pathname);
const udd = path.join(scratch, 'chrome-' + port);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${udd}`, '--no-first-run', '--use-angle=metal',
  '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${wArg},${hArg}`, 'about:blank'], { stdio: 'ignore' });
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
try {
  ws = new WebSocket(await connect());
  await new Promise(r => (ws.onopen = r));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || m); waiting.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: +wArg, height: +hArg, deviceScaleFactor: 2, mobile: false });
  const url = 'file://' + path.resolve(page);
  for (const s of stepsArg.split(',')) {
    await call('Page.navigate', { url: 'about:blank' }); await sleep(200);
    await call('Page.navigate', { url: url + '#step=' + s });
    await sleep(+waitArg * 1000);
    if (js) { const r = await call('Runtime.evaluate', { expression: js, awaitPromise: true }); if (r.exceptionDetails) logs.push('JS: ' + JSON.stringify(r.exceptionDetails).slice(0, 300)); await sleep(+waitArg * 1000); }
    if (process.env.VISION_CLICK) { // a real mouse click (x,y in CSS px), as a person would
      const [cx, cy] = process.env.VISION_CLICK.split(',').map(Number);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 });
      await sleep(1500);
    }
    const t = await call('Runtime.evaluate', { expression: 'document.getElementById("title").textContent' });
    let clip; // VISION_CLIP=1: the 3D view alone, not the page around it
    if (process.env.VISION_CLIP) {
      const r = await call('Runtime.evaluate', { expression: 'JSON.stringify(document.getElementById("viz").getBoundingClientRect())' });
      const b = JSON.parse(r.result.value); clip = { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 };
    }
    const shot = await call('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
    fs.writeFileSync(`${prefix}-${s}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`${prefix}-${s}.png`, '|', t.result && t.result.value);
  }
} catch (e) { console.log('ERR', e.message); }
finally { for (const l of logs.slice(0, 30)) console.log(l); chrome.kill('SIGKILL'); await sleep(300); fs.rmSync(udd, { recursive: true, force: true }); process.exit(0); }
