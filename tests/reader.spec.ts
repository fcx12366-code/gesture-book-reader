import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const fixture = (name: string) => fileURLToPath(new URL(`../.test-data/${name}`, import.meta.url));
async function openPdf(page: Page, name = 'mixed-12.pdf') {
  await page.getByTestId('import-input').setInputFiles(fixture(name));
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('page-total')).toContainText(name === 'single.pdf' ? '1' : name === 'long-120.pdf' ? '120' : '12');
}
async function jump(page: Page, number: number) {
  await page.getByTestId('page-input').fill(String(number));
  await page.getByTestId('page-input').press('Enter');
  await expect(page.getByTestId('page-input')).toHaveValue(String(number));
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('import, arrows, keyboard, direct page selection and thumbnails', async ({ page }) => {
  await openPdf(page);
  await page.getByTestId('layout-select').selectOption('single');
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-input')).toHaveValue('2');
  await page.getByTestId('prev-page').click();
  await expect(page.getByTestId('page-input')).toHaveValue('1');
  await page.getByTestId('page-input').evaluate(input => input.blur());
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('page-input')).toHaveValue('2');
  await jump(page, 10);
  await page.getByTestId('thumbnails-toggle').click();
  await page.getByTestId('thumbnail-4').click();
  await expect(page.getByTestId('page-input')).toHaveValue('4');
});

test('replace and close documents, including one-page PDF', async ({ page }) => {
  await openPdf(page);
  await jump(page, 8);
  await page.getByTestId('import-input').setInputFiles(fixture('single.pdf'));
  await expect(page.getByTestId('page-total')).toContainText('1');
  await expect(page.getByTestId('page-input')).toHaveValue('1');
  await expect(page.getByTestId('next-page')).toBeDisabled();
  await expect(page.getByTestId('prev-page')).toBeDisabled();
  await page.getByTestId('close-reader').click();
  await expect(page.getByTestId('import-zone')).toBeVisible();
  await openPdf(page);
});

test('single/double layouts, zoom, pan, fit and resize stay usable', async ({ page }) => {
  await openPdf(page);
  await page.getByTestId('layout-select').selectOption('double');
  await jump(page, 4);
  const image = page.locator('.pdf-reader-page[data-page="4"] img').first();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const originalPixels = await image.evaluate((img: HTMLImageElement) => img.naturalWidth);
  await page.getByTestId('zoom-select').selectOption('2');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(originalPixels);
  const transform = page.locator('.pdf-reader-transform');
  const beforePan = await transform.getAttribute('style');
  const box = await page.locator('#book-stage').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .6);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .4, box!.y + box!.height * .4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => transform.getAttribute('style')).not.toBe(beforePan);
  await expect(page.getByTestId('page-input')).toHaveValue('4');
  await page.getByTestId('fit-page').click();
  await expect(page.getByTestId('zoom-select')).toHaveValue('1');
  await page.getByTestId('layout-select').selectOption('auto');
  await expect(page.locator('.pdf-reader-viewport')).toHaveAttribute('data-layout', 'double');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.pdf-reader-viewport')).toHaveAttribute('data-layout', 'single');
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-input')).not.toHaveValue('4');
});

test('120-page navigation keeps high-resolution bitmap cache within eight entries', async ({ page }) => {
  await openPdf(page, 'long-120.pdf');
  for (const number of [12, 24, 48, 72, 96, 120, 1]) {
    await jump(page, number);
    const snapshot = await page.evaluate(() => (window as any).__readerDiagnostics());
    expect(snapshot.cachedPages).toBeLessThanOrEqual(8);
    expect(snapshot.activeRenders).toBeLessThanOrEqual(2);
  }
  const diagnostics = await page.evaluate(() => (window as any).__readerDiagnostics());
  expect(diagnostics.total).toBe(120);
  expect(diagnostics.current).toBe(1);
  expect(diagnostics.cachedPages).toBeLessThanOrEqual(8);
  expect(diagnostics.activeRenders).toBeLessThanOrEqual(2);
  await expect.poll(() => page.getByTestId('reader').locator('img').evaluateAll((images) => images.some(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await page.getByTestId('thumbnails-toggle').click();
  await page.getByTestId('thumbnail-110').scrollIntoViewIfNeeded();
  await expect.poll(() => page.getByTestId('thumbnail-110').locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height)).toBeGreaterThan(0);
  await expect.poll(() => page.getByTestId('thumbnail-1').locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height)).toBe(0);
  const pixels = await page.locator('#thumbnail-scroll canvas').evaluateAll((canvases) => canvases.reduce((sum, canvas) => sum + (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height, 0));
  expect(pixels).toBeLessThan(2_000_000);
  await expect(page.locator('#thumbnail-scroll canvas')).toHaveCount(120);
  await page.getByTestId('thumbnails-toggle').click();
  await expect(page.locator('#thumbnail-scroll canvas')).toHaveCount(0);
});

test('corrupted PDF gives readable error and a later valid import succeeds', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles(fixture('broken.pdf'));
  await expect(page.getByTestId('error-message')).toBeVisible();
  await expect(page.getByTestId('error-message')).not.toBeEmpty();
  await openPdf(page);
});

test('camera permission rejection is handled (simulated, not hardware validation)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Denied by automated test', 'NotAllowedError'); } });
  });
  await page.reload();
  await openPdf(page);
  await page.getByTestId('gesture-toggle').click();
  await expect(page.getByTestId('gesture-status')).toContainText(/权限|拒绝|允许|摄像头|失败/);
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-input')).not.toHaveValue('1');
});

test('reselecting same PDF after refresh restores reading progress', async ({ page }) => {
  await openPdf(page);
  await jump(page, 7);
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByTestId('import-zone')).toBeVisible();
  await openPdf(page);
  await expect(page.getByTestId('page-input')).toHaveValue('7');
});

test('encrypted PDF allows cancel, wrong-password retry and successful unlock', async ({ page }) => {
  test.skip(!existsSync(fixture('encrypted.pdf')), 'Generate optional encrypted fixture: npm run fixtures -- --encrypted (requires Python pypdf).');
  await page.getByTestId('import-input').setInputFiles(fixture('encrypted.pdf'));
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#password-cancel').click();
  await expect(page.locator('#password-dialog')).not.toBeVisible();
  await expect(page.locator('#loading')).not.toBeVisible();
  await openPdf(page);
  await page.getByTestId('import-input').setInputFiles(fixture('encrypted.pdf'));
  await expect(page.locator('#password-dialog')).toBeVisible();
  await page.locator('#password-input').fill('wrong-password');
  await page.locator('#password-form').getByRole('button', { name: '解锁 PDF' }).click();
  await expect(page.locator('#password-message')).toContainText('密码不正确');
  await page.locator('#password-input').fill('zhijian123');
  await page.locator('#password-form').getByRole('button', { name: '解锁 PDF' }).click();
  await expect(page.locator('#password-dialog')).not.toBeVisible();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('page-total')).toContainText('12');
});

test('drag import is local and replacing/closing releases page blob URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const live = new Set<string>();
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => { const url = create(blob); live.add(url); return url; };
    URL.revokeObjectURL = (url: string) => { live.delete(url); revoke(url); };
    (window as any).__liveBlobs = live;
  });
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  await page.reload();
  const transfer = await page.evaluateHandle((bytes: number[]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' }));
    return transfer;
  }, Array.from(readFileSync(fixture('mixed-12.pdf'))));
  await page.getByTestId('import-zone').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__liveBlobs.size)).toBeGreaterThan(0);
  const initial = await page.evaluate(() => [...(window as any).__liveBlobs] as string[]);
  await page.getByTestId('import-input').setInputFiles(fixture('single.pdf'));
  await expect(page.getByTestId('page-total')).toContainText('1');
  await expect.poll(() => page.evaluate((urls) => urls.some(url => (window as any).__liveBlobs.has(url)), initial)).toBe(false);
  await page.getByTestId('close-reader').click();
  await expect.poll(() => page.evaluate(() => (window as any).__liveBlobs.size)).toBe(0);
  expect(external).toEqual([]);
});

test('odd-page double spreads stop at final spread and fullscreen keeps errors visible', async ({ page }) => {
  await page.getByTestId('import-input').setInputFiles(fixture('odd-11.pdf'));
  await expect(page.getByTestId('page-total')).toHaveText('11');
  await page.getByTestId('layout-select').selectOption('double');
  await expect(page.getByTestId('page-input')).toHaveValue('1');
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-input')).toHaveValue('2');
  for (const number of [2, 3]) {
    await expect.poll(() => page.locator(`.pdf-reader-page[data-page="${number}"] img`).first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  await jump(page, 10);
  await expect(page.getByTestId('next-page')).toBeDisabled();
  await expect(page.getByTestId('prev-page')).toBeEnabled();
  await page.getByTestId('prev-page').click();
  await expect(page.getByTestId('page-input')).toHaveValue('8');
  await page.locator('#fullscreen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await page.getByTestId('import-input').setInputFiles(fixture('broken.pdf'));
  await expect(page.getByTestId('error-message')).toBeVisible();
  await expect.poll(() => page.getByTestId('error-message').evaluate((error) => !!document.fullscreenElement?.contains(error))).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await openPdf(page);
  await page.getByTestId('close-reader').click();
  await expect(page.getByTestId('import-zone')).toBeVisible();
});
