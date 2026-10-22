// Run after `npm run fixtures` with the local dev server running.
// READER_URL=http://127.0.0.1:5190 node scripts/reader-smoke.mjs
// Uses the installed Chrome browser. Touch events are simulated via CDP.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const native = requestAnimationFrame.bind(window);
    const cancel = cancelAnimationFrame.bind(window);
    const pending = new Set();
    window.requestAnimationFrame = callback => {
      const id = native(time => { pending.delete(id); callback(time); });
      pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
    window.__rafCount = () => pending.size;
  });
  await page.goto(process.env.READER_URL || 'http://127.0.0.1:5190');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const fixture = name => fileURLToPath(new URL(`../.test-data/${name}`, import.meta.url));
  const snapshot = () => page.evaluate(() => window.__readerDiagnostics());
  const waitCurrent = n => page.waitForFunction(value => window.__readerDiagnostics().current === value, n);
  const jump = async n => {
    await page.getByTestId('page-input').fill(String(n));
    await page.getByTestId('page-input').press('Enter');
    await waitCurrent(n);
  };
  const waitRendered = n => page.waitForFunction(number => {
    const image = document.querySelector(`.pdf-reader-page[data-page="${number}"] img`);
    return image?.complete && image.naturalWidth > 0;
  }, n);

  await page.getByTestId('import-input').setInputFiles(fixture('mixed-12.pdf'));
  await waitRendered(1);
  await page.getByTestId('layout-select').selectOption('single');
  assert.match(await page.locator('.stf__wrapper').getAttribute('class'), /--portrait/);
  await page.getByTestId('next-page').click();
  await waitCurrent(2);
  await page.getByTestId('layout-select').selectOption('double');
  assert.match(await page.locator('.stf__wrapper').getAttribute('class'), /--landscape/);
  await jump(10);
  await page.getByTestId('next-page').click();
  await waitCurrent(12);
  await waitRendered(12);
  console.log('PASS double final page: 12; actual single/double orientations');

  await page.getByTestId('layout-select').selectOption('single');
  await jump(4);
  await waitRendered(4);
  await page.getByTestId('next-page').click();
  await page.waitForTimeout(180);
  const cloneImages = await page.locator('.pdf-reader-page img').evaluateAll(images => images
    .filter(image => image.parentElement.style.display === 'block')
    .map(image => ({ page: image.parentElement.dataset.page, complete: image.complete, width: image.naturalWidth })));
  assert.ok(cloneImages.length >= 2);
  assert.ok(cloneImages.every(image => image.complete && image.width > 0));
  await waitCurrent(5);
  console.log('PASS portrait animation bitmap clones:', cloneImages);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  async function swipe() {
    const box = await page.locator('#book-stage').boundingBox();
    const y = box.y + box.height * .52;
    const start = box.x + box.width * .60;
    const finish = box.x + box.width * .40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y, id: 0 }] });
    for (let step = 1; step <= 3; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (finish - start) * step / 3, y, id: 0 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.getByTestId('fit-page').click();
  await jump(2);
  await waitRendered(2);
  await swipe();
  await waitCurrent(3);
  await page.getByTestId('zoom-select').selectOption('2');
  await page.waitForTimeout(300);
  const transformBefore = await page.locator('.pdf-reader-transform').getAttribute('style');
  await swipe();
  await page.waitForTimeout(800);
  assert.equal((await snapshot()).current, 3);
  assert.notEqual(await page.locator('.pdf-reader-transform').getAttribute('style'), transformBefore);
  console.log('PASS CDP simulated touch: fit swipes to page 3; 2x zoom pans and keeps page 3');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('import-input').setInputFiles(fixture('long-120.pdf'));
  await waitRendered(1);
  for (const number of [12, 24, 48, 72, 96, 120, 1]) {
    await jump(number);
    const diagnostics = await snapshot();
    assert.ok(diagnostics.cachedPages <= 8);
    assert.ok(diagnostics.activeRenders <= 2);
  }
  await waitRendered(1);
  const naturalWidth = () => page.locator('[data-page="1"] img').first().evaluate(image => image.naturalWidth);
  const before = await naturalWidth();
  await page.getByTestId('zoom-select').selectOption('2');
  await page.waitForFunction(width => document.querySelector('[data-page="1"] img').naturalWidth > width, before);
  const after = await naturalWidth();
  assert.ok(after > before);
  console.log('PASS 120-page jumps: cache <= 8, active renders <= 2; zoom resolution', { before, after });
  assert.equal(await page.evaluate(() => window.__rafCount()), 1);
  await page.getByTestId('close-reader').click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__rafCount()), 0);
  assert.equal((await snapshot()).cachedPages, 0);
  assert.deepEqual(errors, []);
  console.log('PASS close: zero outstanding RAFs, cache released, no page errors');
} finally { await browser.close(); }
