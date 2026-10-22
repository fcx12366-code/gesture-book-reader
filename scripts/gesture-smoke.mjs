/**
 * Production-only browser smoke test. Always uses Chrome's virtual camera.
 * Run after npm run build: node scripts/gesture-smoke.mjs
 * Optional: --url http://127.0.0.1:4190/ OR --port 4191
 * Override browser executable with GESTURE_SMOKE_BROWSER.
 * No real camera is accessed. No camera frames are saved or transmitted.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(appRoot, 'dist');
const valueAfter = flag => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json' };
let server;
let browser;

async function browserPath() {
  if (process.env.GESTURE_SMOKE_BROWSER) return process.env.GESTURE_SMOKE_BROWSER;
  for (const filename of [chromium.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    try { await access(filename); return filename; } catch { /* Try the next installed Chromium. */ }
  }
  throw new Error('未找到 Chromium。请安装 Playwright Chromium，或设置 GESTURE_SMOKE_BROWSER。');
}
async function serve() {
  if (valueAfter('--url')) return valueAfter('--url');
  await access(path.join(dist, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = path.resolve(dist, `.${pathname}`);
      if (filename !== dist && !filename.startsWith(dist + path.sep)) {
        response.writeHead(403); response.end(); return;
      }
      const target = filename === dist ? path.join(dist, 'index.html') : filename;
      const bytes = await readFile(target);
      response.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  const port = Number(valueAfter('--port') ?? 4191);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${port}/`;
}

const pdf = await PDFDocument.create();
pdf.addPage([480, 640]);
const pdfBytes = Buffer.from(await pdf.save());

async function scenario(url, missingModel) {
  const context = await browser.newContext();
  const pageErrors = [], workers = [];
  let blockedModelRequests = 0;
  await context.addInitScript(() => {
    window.__gestureSmoke = { cameraRequests: 0, tracks: [] };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__gestureSmoke.cameraRequests++;
      const stream = await original(...args);
      window.__gestureSmoke.tracks.push(...stream.getTracks());
      return stream;
    };
  });
  if (missingModel) {
    await context.route('**/vendor/mediapipe/hand_landmarker.task', async route => {
      blockedModelRequests++;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Intentionally missing test model' });
    });
  }
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  try {
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.__gestureSmoke.cameraRequests), 0, 'Camera must remain off before a click');
    await page.getByTestId('import-input').setInputFiles({ name: 'gesture-smoke.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
    await page.getByTestId('reader').waitFor({ state: 'visible' });
    await page.getByTestId('gesture-toggle').click();
    const expected = missingModel ? 'error' : 'searching';
    await page.waitForFunction(state => document.querySelector('#gesture-status')?.getAttribute('data-state') === state,
      expected, { timeout: 55000 });
    const started = await page.evaluate(() => ({
      status: document.querySelector('#gesture-status-text').textContent,
      cameraRequests: window.__gestureSmoke.cameraRequests,
      trackStates: window.__gestureSmoke.tracks.map(track => track.readyState),
      videoReadyState: document.querySelector('#camera-video').readyState,
    }));
    assert.equal(started.cameraRequests, 1);
    assert.ok(workers.some(url => /gesture\.worker-/.test(url)), 'Production gesture worker must start');
    if (missingModel) {
      assert.match(started.status, /本地手部模型启动失败.*vendor\/mediapipe/);
      assert.ok(started.trackStates.every(state => state === 'ended'), 'Model failure must release all camera tracks');
      assert.ok(blockedModelRequests >= 2, 'Both worker and compatibility fallback should see the model failure');
    } else {
      assert.doesNotMatch(started.status, /兼容模式/);
      assert.equal(started.videoReadyState, 4);
      assert.ok(started.trackStates.every(state => state === 'live'));
      // Leave enough time for several real worker inferences on virtual frames.
      await page.waitForTimeout(700);
      assert.equal(await page.getByTestId('gesture-status').getAttribute('data-state'), 'searching');
      await page.getByTestId('gesture-toggle').click();
    }
    await page.waitForTimeout(400);
    const ended = await page.evaluate(() => ({
      cameraRequests: window.__gestureSmoke.cameraRequests,
      trackStates: window.__gestureSmoke.tracks.map(track => track.readyState),
      sourceCleared: document.querySelector('#camera-video').srcObject === null,
    }));
    assert.equal(ended.cameraRequests, 1, 'Failure/stop must not automatically request camera permission again');
    assert.ok(ended.trackStates.every(state => state === 'ended'));
    assert.equal(ended.sourceCleared, true);
    assert.deepEqual(pageErrors, [], 'No uncaught page errors');
    return { scenario: missingModel ? 'model-404' : 'normal-worker', started, ended, blockedModelRequests, workers, pageErrors };
  } finally { await context.close(); }
}

try {
  const url = await serve();
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true,
    args: ['--no-proxy-server', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const results = [await scenario(url, false), await scenario(url, true)];
  console.log(JSON.stringify({ passed: true, source: 'Chromium virtual camera; no real camera tested', url, results }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}
