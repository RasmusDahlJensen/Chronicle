import { expect, test } from '@playwright/test';
import { worldKey } from '../../shared/generated-world.ts';

test('generated world draws real climate layers, exact cells, and a reproducible reset', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#world-resolution')).toHaveText('1,024 × 512');
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-layer', 'temperature');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(original);
  await expect(page.getByText('Annual mean temperature')).toBeVisible();
  const climateColours = await canvas.evaluate((element: HTMLCanvasElement) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const at = (row: number) => Array.from(element.getContext('2d')!.getImageData(element.width / 2, (element.clientHeight / 2 + (row - 256) * scale) * ratio, 1, 1).data);
    return { polar: at(10), tropical: at(252) };
  });
  expect(climateColours.polar[2]).toBeGreaterThan(climateColours.polar[0]);
  expect(climateColours.tropical[0]).toBeGreaterThan(climateColours.tropical[2]);
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
  const cellId = Number(await page.locator('[data-selected-cell]').getAttribute('data-selected-cell'));
  const x = cellId % 1024, y = Math.floor(cellId / 1024);
  const tile = await (await page.request.get(`/api/world/tile?seed=Chronicle&size=large&x=${Math.floor(x / 128)}&y=${Math.floor(y / 128)}`)).json();
  const at = (y % 128) * 128 + x % 128;
  await expect(page.locator('#cell-temperature')).toHaveText(`${(tile.fields.temperature[at] / 10).toFixed(1)} °C`);
  await expect(page.locator('#cell-moisture')).toHaveText(`${Math.round(tile.fields.moisture[at] / 10)} / 100`);
  await page.getByRole('radio', { name: 'Moisture', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-layer', 'moisture');
  await expect(page.getByText('Annual moisture index', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Biomes', exact: true }).check();
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('#world-status')).toContainText('World ready');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await page.screenshot({ path: testInfo.outputPath('generated-world-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('failed replacement preserves the map and retry loads the requested seed', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.route('**/api/world?**', route => route.fulfill({ status: 503, json: { error: { code: 'OVERLOADED', message: 'Busy', requestId: 'test-busy' } } }));
  await page.getByLabel('World seed').fill('New continent');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('busy');
  await expect(page.locator('#world-status')).toContainText('Previous world retained');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await page.unroute('**/api/world?**');
  await page.getByRole('button', { name: 'Retry generation' }).click();
  await expect(canvas).toHaveAttribute('data-world-key', worldKey({ seed: 'New continent', size: 'large' }));
});

test('tile failure keeps overview visible and retries only when requested', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  let requests = 0;
  await page.route('**/api/world/tile?**', route => { requests++; return route.fulfill({ status: 503, body: 'unavailable' }); });
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('detail');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('radio', { name: 'Moisture', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-layer', 'moisture');
  expect(requests).toBe(1);
  await page.unroute('**/api/world/tile?**');
  await page.getByRole('button', { name: 'Retry detail' }).click();
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
});

test('a later seed wins over a delayed earlier response', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/world?seed=Delayed&size=large', async route => {
    const response = await route.fetch();
    started!();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByLabel('World seed').fill('Delayed');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await pending;
  await page.getByLabel('World seed').fill('Latest');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-world-key', worldKey({ seed: 'Latest', size: 'large' }));
  release!();
  await expect(page.locator('#world-status')).toContainText('World ready');
  await expect(page.locator('#world-current-seed')).toHaveText('Latest');
});

test('canvas failure offers a retry and narrow layout stays within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let fail = true;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (this.id === 'generated-world-canvas' && fail) { fail = false; return null; }
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('canvas');
  await page.getByRole('button', { name: 'Retry canvas' }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('generated-world-mobile.png'), fullPage: true });
});

test('real resource glyph edges select the site and hidden glyphs do not capture adjacent cells', async ({ page }, testInfo) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const tile = await (await page.request.get('/api/world/tile?seed=Chronicle&size=large&x=3&y=1')).json();
  const at = tile.fields.resource.findIndex((code: number) => code === 6); // Protocol resource code 6 is iron.
  expect(at).toBeGreaterThanOrEqual(0);
  const cell = { x: 384 + at % 128, y: 128 + Math.floor(at / 128) };
  const cellId = cell.y * 1024 + cell.x;
  async function point() {
    return canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
      const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
      return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
        y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
    }, cell);
  }
  const initial = await point();
  await page.mouse.click(initial.x, initial.y);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(cellId));
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText('Iron');
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText('Mining');
  await page.mouse.move(initial.x, initial.y);
  for (let index = 0; index < 4; index++) await page.mouse.wheel(0, -180);
  await expect(canvas).toHaveAttribute('data-detail', 'true');
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(5);
  // All four wheel steps have landed (each zooms by e^0.54) before the glyph's position is measured.
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(Math.exp(0.54 * 4) - 0.01);
  const enlarged = await point();
  await page.mouse.click(enlarged.x + 6, enlarged.y);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(cellId));
  // Toggling the layer may scroll the page to the checkbox: the glyph's position is measured again after each toggle.
  await page.getByLabel('Resource sites', { exact: true }).uncheck();
  await canvas.scrollIntoViewIfNeeded();
  const hidden = await point();
  await page.mouse.click(hidden.x + 6, hidden.y);
  await expect(page.locator('[data-selected-cell]')).not.toHaveAttribute('data-selected-cell', String(cellId));
  await page.getByLabel('Resource sites', { exact: true }).check();
  await canvas.scrollIntoViewIfNeeded();
  const shown = await point();
  await page.mouse.click(shown.x, shown.y);
  await expect.poll(async () => Number(await canvas.getAttribute('data-loaded-tile-count'))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute('data-loaded-tile-count'))).toBeLessThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath('generated-world-detail.png'), fullPage: true });
});

test('the legend and inspector show the tin and oil sites added in G1', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const legend = page.getByRole('list', { name: 'Resource site legend' });
  for (const label of ['Copper', 'Tin', 'Oil', 'Uranium']) await expect(legend).toContainText(label);
  const found = new Map<number, { x: number; y: number }>();
  for (let ty = 0; ty < 4 && found.size < 2; ty++) for (let tx = 0; tx < 8 && found.size < 2; tx++) {
    const tile = await (await page.request.get(`/api/world/tile?seed=Chronicle&size=large&x=${tx}&y=${ty}`)).json();
    for (const code of [12, 13]) { // Protocol resource codes 12 and 13 are tin and oil.
      const at = tile.fields.resource.indexOf(code);
      if (at >= 0 && !found.has(code)) found.set(code, { x: tx * 128 + at % 128, y: ty * 128 + Math.floor(at / 128) });
    }
  }
  expect([...found.keys()].sort()).toEqual([12, 13]);
  for (const [code, label, technology] of [[12, 'Tin', 'Mining'], [13, 'Oil', 'Drilling']] as const) {
    const cell = found.get(code)!;
    const point = await canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
      const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
      return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
        y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
    }, cell);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(cell.y * 1024 + cell.x));
    const region = page.getByRole('region', { name: 'Selected cell resource' });
    await expect(region).toContainText(label);
    await expect(region).toContainText(technology);
  }
});

test('keyboard panning wraps longitude, clamps polar edges, and fits the world again', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await canvas.focus();
  const initial = Number(await canvas.getAttribute('data-center-x'));
  for (let index = 0; index < 12; index++) await page.keyboard.press('Shift+ArrowRight');
  const longitude = Number(await canvas.getAttribute('data-center-x'));
  expect(longitude).toBeGreaterThanOrEqual(0); expect(longitude).toBeLessThan(1024); expect(longitude).not.toBe(initial);
  for (let index = 0; index < 3; index++) await page.keyboard.press('+');
  for (let index = 0; index < 20; index++) await page.keyboard.press('Shift+ArrowUp');
  const topEdge = await canvas.evaluate((element: HTMLCanvasElement) => Number(element.dataset.centerY) - element.clientHeight / Number(element.dataset.scale) / 2);
  expect(topEdge).toBeCloseTo(0, 4);
  await page.keyboard.press('Home');
  await expect(canvas).toHaveAttribute('data-zoom', '1');
  await expect(canvas).toHaveAttribute('data-center-x', '512');
  await expect(canvas).toHaveAttribute('data-center-y', '256');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', '262656');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', '262655');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
});

test('a delayed inspected tile cannot overwrite a newer cell selection', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/world/tile?seed=Chronicle&size=large&x=4&y=2', async route => {
    const response = await route.fetch(); started!();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await canvas.focus(); await page.keyboard.press('Enter'); await pending;
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', '262655');
  release!();
  await page.getByRole('radio', { name: 'Moisture', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-layer', 'moisture');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', '262655');
});

test('delayed offscreen tiles cannot evict a stationary viewport after panning away and back', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  // Biomes now retain full terrain independently of tiles. Temperature still needs exact detail,
  // so it exposes any eviction that silently replaces the current viewport with sampled pixels.
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await canvas.focus();
  for (let index = 0; index < 3; index++) await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-detail', 'true');
  await expect(canvas).toHaveAttribute('data-texture-count', '4');
  await page.waitForLoadState('networkidle');
  const detailedImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  let active = 0, maximumActive = 0;
  await page.route('**/api/world/tile?**', async route => {
    requests.push(route.request().url());
    active++; maximumActive = Math.max(maximumActive, active);
    await held;
    const response = await route.fetch();
    await route.fulfill({ response });
    active--;
  });
  for (let index = 0; index < 35; index++) await page.keyboard.press('Shift+ArrowRight');
  for (let index = 0; index < 10; index++) await page.keyboard.press('Shift+ArrowUp');
  for (let index = 0; index < 35; index++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Home');
  for (let index = 0; index < 3; index++) await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-center-x', '512');
  await expect(canvas).toHaveAttribute('data-center-y', '256');
  release();
  // The fixed pan visits 24 tiles; four were already loaded before responses were held.
  await expect.poll(() => requests.length).toBe(20);
  await expect.poll(() => active).toBe(0);
  await page.waitForLoadState('networkidle');
  expect(requests.length).toBeGreaterThan(16);
  expect(new Set(requests).size).toBe(requests.length);
  expect(maximumActive).toBeLessThanOrEqual(4);
  expect(Number(await canvas.getAttribute('data-texture-count'))).toBeLessThanOrEqual(16);
  const finalImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(finalImage === detailedImage, 'The stationary viewport must retain its full-detail pixels after stale requests finish.').toBe(true);
});
