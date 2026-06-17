import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9233);
const OUT_DIR = path.resolve('docs/visual-audit/smoke-kaya');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url, label) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(250);
  }
  throw new Error(`${label} is not reachable: ${url}`);
}

async function targetFor(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return res.json();
}

async function withTab(url, fn) {
  const target = await targetFor(url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  await new Promise((resolve) => {
    ws.onopen = resolve;
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

function launchChrome(profileDir) {
  fs.rmSync(profileDir, { recursive: true, force: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  if (process.platform === 'darwin' && CHROME.includes('Google Chrome.app')) {
    const proc = spawn('/bin/zsh', ['-lc', `open -n -a 'Google Chrome' --args ${args.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ')}`], { stdio: 'ignore' });
    return { proc, cleanup: () => spawnSync('pkill', ['-f', profileDir]) };
  }
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  return { proc, cleanup: () => proc.kill('SIGTERM') };
}

function canvasPoint(rect, x, y) {
  return { x: rect.x + (x / 390) * rect.width, y: rect.y + (y / 844) * rect.height };
}

async function click(send, rect, x, y) {
  const p = canvasPoint(rect, x, y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
}

async function shot(send, name) {
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(image.data, 'base64'));
}

async function main() {
  await waitFor(APP_URL, 'Dev server');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chrome = launchChrome('/tmp/wedding-smoke-kaya-chrome');

  try {
    await waitFor(`http://127.0.0.1:${PORT}/json/version`, 'Chrome DevTools');
    await withTab(APP_URL, async (send) => {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await send('Page.navigate', { url: APP_URL });
      await sleep(5200);
      await send('Runtime.evaluate', {
        expression: `new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            if (document.querySelector('canvas')) resolve(true);
            else if (Date.now() - started > 12000) reject(new Error('canvas timeout'));
            else setTimeout(tick, 100);
          };
          tick();
        })`,
        awaitPromise: true,
      });
      await send('Runtime.evaluate', { expression: 'window.dataLayer = []', returnByValue: true });
      const rectResult = await send('Runtime.evaluate', {
        expression: `JSON.stringify((() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })())`,
        returnByValue: true,
      });
      const rect = JSON.parse(rectResult.result.value);
      await click(send, rect, 195, 708);
      await sleep(1200);
      await click(send, rect, 334, 536);
      await shot(send, '01-kaya-stage-1');
      await sleep(11100);
      await click(send, rect, 36, 490);
      await shot(send, '02-kaya-stage-2');
      await sleep(11100);
      await click(send, rect, 332, 528);
      await shot(send, '03-kaya-stage-3');
      await sleep(13600);
      await shot(send, '04-finale-bonus');
      const eventsResult = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.dataLayer)', returnByValue: true });
      const events = JSON.parse(eventsResult.result.value);
      const kayaEvents = events.filter((event) => event.event === 'wedding_game_kaya_found');
      const finish = events.find((event) => event.event === 'wedding_game_finish');
      if (kayaEvents.length !== 3 || kayaEvents.at(-1)?.count !== 3 || finish?.kayaFound !== 3) {
        throw new Error(`Kaya smoke failed: ${JSON.stringify(events)}`);
      }
    });
    console.log(`Kaya smoke passed. Screenshots: ${OUT_DIR}`);
  } finally {
    chrome.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
