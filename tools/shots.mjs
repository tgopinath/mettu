// Captures the screenshots used on the portfolio card: node tools/shots.mjs
// Phone shots: 600-wide JPEGs in prototype/shots. Desktop: shots-desktop/web.jpg (1440×900) for the card's browser window.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'prototype', 'shots');
const DESK = path.join(ROOT, 'shots-desktop'); // the portfolio card's browser window: copy to gopinath-portfolio/assets/thumbs/web-mettu.jpg
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(DESK, { recursive: true });
const tmp = fs.mkdtempSync(path.join(ROOT, '.shots-'));
const port = 5700 + Math.floor(Math.random() * 200), dbg = port + 1000;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--remote-debugging-port=${dbg}`, `--user-data-dir=${tmp}/profile`, 'about:blank'], { stdio: 'ignore' });
try {
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try { const p = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(t => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(250);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const origin = `http://127.0.0.1:${port}`;
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  const phone = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 849, deviceScaleFactor: 2, mobile: true });
  const desktop = () => send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const grab = async (file, { lang = 'en', js, wait = 1500, width = 600, dir = SHOTS } = {}) => {
    await send('Page.navigate', { url: `${origin}/index.html` }); await sleep(1200);
    await send('Runtime.evaluate', { expression: `localStorage.clear(); localStorage.setItem('mettu.lang', '${lang}'); indexedDB.deleteDatabase('mettu')` }); await sleep(300);
    await send('Page.navigate', { url: `${origin}/index.html?shot=${file}#/` }); await sleep(1500);
    if (js) { const r = await send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true }); if (r.result?.exceptionDetails) console.warn(file, r.result.exceptionDetails.text); }
    await sleep(wait);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const png = path.join(tmp, file + '.png');
    fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', '--resampleWidth', String(width), png, '--out', path.join(dir, file + '.jpg')], { stdio: 'pipe' });
  };
  const sample = `await useSample(); await new Promise(r => setTimeout(r, 600));`;
  await phone();
  await grab('make');
  await grab('trim', { js: sample });
  await grab('shape', { js: `${sample} setStep('shape'); await doRender(); scrollTo(0, 250);` });
  await grab('call', { js: `${sample} setStep('test'); await ringTest(); await new Promise(r => setTimeout(r, 6500));`, wait: 300 });
  await grab('find', { js: `location.hash = '#/find'; await new Promise(r => setTimeout(r, 300)); document.querySelector('#exYT').click(); await new Promise(r => setTimeout(r, 4000));` });
  await grab('trim-ta', { lang: 'ta', js: sample });
  await desktop();
  await grab('web', { js: `${sample} setStep('shape'); await doRender();`, width: 1440, dir: DESK });
  console.log('captured', fs.readdirSync(SHOTS).join(', '));
  ws.close();
} finally {
  const exited = new Promise(r => chrome.once('exit', r));
  chrome.kill(); server.kill();
  await Promise.race([exited, sleep(5000)]);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
