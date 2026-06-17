import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9232);
const OUT_DIR = path.resolve('docs/visual-audit/smoke');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isServerUp() {
  try {
    const response = await fetch(APP_URL, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    if (await isServerUp()) return;
    await sleep(500);
  }
  throw new Error(`Dev server is not reachable: ${APP_URL}`);
}

async function targetFor(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  return res.json();
}

async function waitForChrome() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint is not reachable on port ${PORT}`);
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
  return {
    x: rect.x + (x / 390) * rect.width,
    y: rect.y + (y / 844) * rect.height,
  };
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
  await waitForServer();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const chrome = launchChrome('/tmp/wedding-smoke-chrome');

  try {
    await waitForChrome();
    await withTab(APP_URL, async (send) => {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await send('Page.navigate', { url: APP_URL });
      await sleep(5200);
      await send('Runtime.evaluate', { expression: 'document.fonts?.ready', awaitPromise: true });
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
      const rectResult = await send('Runtime.evaluate', {
        expression: `JSON.stringify((() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })())`,
        returnByValue: true,
      });
      const rect = JSON.parse(rectResult.result.value);
      await shot(send, '01-intro');
      await click(send, rect, 195, 708);
      await sleep(1200);
      await shot(send, '02-runner-started');
      await click(send, rect, 190, 420);
      await sleep(800);
      await shot(send, '03-after-jump');
      await click(send, rect, 330, 34);
      await sleep(700);
      await shot(send, '04-pause');
      await click(send, rect, 195, 360);
      await sleep(500);
      await click(send, rect, 195, 802);
      await sleep(1400);
      await shot(send, '05-finale');
      await click(send, rect, 195, 736);
      await sleep(1600);
      const urlResult = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
      if (!String(urlResult.result.value).startsWith('https://velts-wedding.ru/')) {
        throw new Error(`Final CTA did not navigate to landing page: ${urlResult.result.value}`);
      }
    });
    console.log(`Smoke passed. Screenshots: ${OUT_DIR}`);
  } finally {
    chrome.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
