import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9234);
const OUT_DIR = path.resolve('docs/visual-audit');
const SCREEN_DIR = path.join(OUT_DIR, 'screenshots');
const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
];
const STATES = [
  { name: 'intro', hash: '', wait: 1200 },
  { name: 'runner1', hash: '#runner1', wait: 1200 },
  { name: 'runner2', hash: '#runner2', wait: 1200 },
  { name: 'runner3', hash: '#runner3', wait: 1200 },
  { name: 'pause', hash: '#runner1', wait: 1200, pause: true },
  { name: 'finale', hash: '#finale', wait: 1200 },
  { name: 'finale-kaya', hash: '#finale-kaya', wait: 1200 },
];
const EXTRA_CAPTURES = [
  { size: { width: 720, height: 390 }, state: { name: 'landscape-overlay', hash: '', wait: 1200 } },
];
let navigationId = 0;

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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const callId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(callId);
        reject(new Error(`CDP timeout: ${method}`));
      }, 60000);
      pending.set(callId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
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

async function waitForCanvas(send) {
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
  await send('Runtime.evaluate', { expression: 'document.fonts?.ready', awaitPromise: true });
}

async function capture(send, file, fullPage = false) {
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: fullPage });
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
}

async function captureState(send, size, state) {
  console.log(`capture ${size.width}x${size.height} ${state.name}`);
  await send('Emulation.setDeviceMetricsOverride', {
    width: size.width,
    height: size.height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const url = new URL(APP_URL);
  url.searchParams.set('audit', String(++navigationId));
  url.hash = state.hash;
  try {
    await send('Page.navigate', { url: String(url) });
  } catch (error) {
    if (!String(error).includes('CDP timeout: Page.navigate')) throw error;
  }
  await waitForCanvas(send);
  await sleep(state.wait);

  const rectResult = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })())`,
    returnByValue: true,
  });
  const rect = JSON.parse(rectResult.result.value);
  if (state.pause) {
    await click(send, rect, 330, 34);
    await sleep(500);
  }

  const filename = `${size.width}x${size.height}-${state.name}.png`;
  await capture(send, path.join(SCREEN_DIR, filename));

  const metricsResult = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const canvas = document.querySelector('canvas');
      const r = canvas.getBoundingClientRect();
      const root = document.documentElement;
      const body = document.body;
      return {
        file: 'docs/visual-audit/screenshots/${filename}',
        viewport: { width: innerWidth, height: innerHeight },
        canvas: { x: r.x, y: r.y, width: r.width, height: r.height },
        body: { scrollWidth: body.scrollWidth, scrollHeight: body.scrollHeight },
        document: { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight },
        horizontalOverflow: Math.max(body.scrollWidth, root.scrollWidth) > innerWidth + 1,
        verticalOverflow: Math.max(body.scrollHeight, root.scrollHeight) > innerHeight + 1
      };
    })())`,
    returnByValue: true,
  });
  return JSON.parse(metricsResult.result.value);
}

function writeContactHtml() {
  const cards = [];
  for (const size of SIZES) {
    for (const state of STATES) {
      const file = `${size.width}x${size.height}-${state.name}.png`;
      cards.push(`<div class="card"><div class="label">${size.width}x${size.height} · ${state.name}</div><img src="screenshots/${file}"></div>`);
    }
  }
  for (const { size, state } of EXTRA_CAPTURES) {
    const file = `${size.width}x${size.height}-${state.name}.png`;
    cards.push(`<div class="card"><div class="label">${size.width}x${size.height} · ${state.name}</div><img src="screenshots/${file}"></div>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Wedding mini-game visual audit</title><style>
body{margin:0;background:#10182a;color:#f3e6d2;font-family:system-ui,sans-serif;padding:18px}
h1{font-size:24px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(7,158px);gap:12px}
.card{background:#16223c;border:2px solid #d8b483;padding:8px}.label{font-size:12px;margin-bottom:6px;color:#ecc079}
img{width:100%;height:auto;display:block;image-rendering:pixelated;background:#0b1120}</style></head><body><h1>Wedding mini-game visual audit</h1><div class="grid">${cards.join('')}</div></body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'contact.html'), html);
}

async function main() {
  await waitFor(APP_URL, 'Dev server');
  fs.mkdirSync(SCREEN_DIR, { recursive: true });

  const chrome = launchChrome('/tmp/wedding-visual-audit-chrome');

  try {
    await waitFor(`http://127.0.0.1:${PORT}/json/version`, 'Chrome DevTools');
    const metrics = [];
    await withTab(APP_URL, async (send) => {
      await send('Page.enable');
      await send('Runtime.enable');
      for (const size of SIZES) {
        for (const state of STATES) metrics.push(await captureState(send, size, state));
      }
      for (const { size, state } of EXTRA_CAPTURES) metrics.push(await captureState(send, size, state));
    });
    fs.writeFileSync(path.join(SCREEN_DIR, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    writeContactHtml();

    await withTab(`file://${path.join(OUT_DIR, 'contact.html')}`, async (send) => {
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 2100, deviceScaleFactor: 1, mobile: false });
      try {
        await send('Page.navigate', { url: `file://${path.join(OUT_DIR, 'contact.html')}` });
      } catch (error) {
        if (!String(error).includes('CDP timeout: Page.navigate')) throw error;
      }
      await sleep(1000);
      await capture(send, path.join(OUT_DIR, 'contact.png'), true);
    });

    const scrollIssues = metrics.filter((m) => m.horizontalOverflow || m.verticalOverflow);
    console.log(`Visual audit complete. Screenshots: ${SCREEN_DIR}`);
    console.log(`Scroll issues: ${scrollIssues.length}`);
  } finally {
    chrome.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
