import { expect, test } from '@playwright/test';
import { BIOMES, RESOURCES } from '../../src/world/atlas.ts';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  const canvas = page.locator('#world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  return canvas;
}

test('the default atlas renders a larger biome/resource map and reports real host data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const canvas = await ready(page);
  await expect(page.getByRole('heading', { name: 'The Verdant Reach', exact: true })).toBeVisible();
  await expect(page.locator('#atlas-cell-count')).toHaveText('64,000');
  const image = await canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!;
    let saturated = 0;
    const colors = new Set<string>();
    for (let y = 15; y < element.height; y += 15) {
      for (let x = 15; x < element.width; x += 15) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        colors.add(`${r},${g},${b}`);
        if (Math.max(r, g, b) - Math.min(r, g, b) > 45) saturated++;
      }
    }
    return { colors: colors.size, saturated };
  });
  expect(image.colors).toBeGreaterThan(150);
  expect(image.saturated).toBeGreaterThan(200);
  await page.screenshot({ path: 'test-results/biomes-desktop.png', fullPage: true });
  // Sample the actual cells so neutral letterboxing or colorful icons cannot
  // hide a broken terrain palette (the first visual pass caught this bug).
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  const { world } = await (await page.request.get('/api/atlas')).json();
  const colors = await canvas.evaluate((element: HTMLCanvasElement, world) => {
    const ctx = element.getContext('2d')!;
    const scale = Math.min(element.width / world.width, element.height / world.height);
    const offsetX = (element.width - world.width * scale) / 2;
    const offsetY = (element.height - world.height * scale) / 2;
    const samples: Record<string, number[][]> = {};
    for (const cell of world.cells) {
      if (!['ocean', 'forest', 'desert', 'snow'].includes(cell.biome)) continue;
      const x = offsetX + (cell.id % world.width + 0.5) * scale;
      const y = offsetY + (Math.floor(cell.id / world.width) + 0.5) * scale;
      (samples[cell.biome] ??= []).push(Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3));
    }
    return Object.fromEntries(Object.entries(samples).map(([biome, values]) => [biome,
      [0, 1, 2].map(channel => values.reduce((sum, rgb) => sum + rgb[channel], 0) / values.length)]));
  }, world);
  expect(colors.ocean[2] - colors.ocean[0]).toBeGreaterThan(30);
  expect(colors.forest[1] - colors.forest[0]).toBeGreaterThan(15);
  expect(colors.desert[0] - colors.desert[2]).toBeGreaterThan(45);
  expect(Math.min(...colors.snow)).toBeGreaterThan(170);
  expect(errors).toEqual([]);
});

test('zoom, resource layers and cell selection read the same atlas cells', async ({ page }) => {
  const canvas = await ready(page);
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(original);
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).check();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-zoom', '1.50');
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-zoom', '1.00');
  await canvas.click({ position: { x: 100, y: 100 } });
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
  const id = Number(await page.locator('[data-selected-cell]').getAttribute('data-selected-cell'));
  const response = await page.request.get('/api/atlas');
  const { world } = await response.json();
  expect(Number.isInteger(id)).toBe(true);
  await expect(page.locator('[data-selected-cell]')).toContainText(world.cells[id].elevation.toLocaleString('en'));
  await expect(page.locator('[data-selected-cell]')).toContainText(BIOMES[world.cells[id].biome as keyof typeof BIOMES].label);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText(RESOURCES[world.cells[id].resource as keyof typeof RESOURCES].label);
  const province = world.provinces.find((province: { id: string }) => province.id === world.cells[id].provinceId);
  await expect(page.locator('[data-selected-cell]')).toContainText(province?.name ?? 'Open water');
  await expect(page.locator('[data-selected-cell]')).toContainText(province ? 'Unclaimed' : 'No country');
  await page.screenshot({ path: 'test-results/biomes-inspected.png', fullPage: true });
});

test('drag and cancelled gestures do not pick cells; repeated reset restores camera and one renderer', async ({ page }) => {
  await page.addInitScript(() => {
    const active = new Set<ResizeObserver>();
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      observe(target: Element, options?: ResizeObserverOptions) {
        super.observe(target, options);
        if (target.id === 'world-canvas') active.add(this);
      }
      disconnect() { super.disconnect(); active.delete(this); }
    };
    Object.defineProperty(window, 'atlasObservers', { get: () => active.size });
  });
  const canvas = await ready(page);
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const beforeDrag = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(beforeDrag);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await page.mouse.down();
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.up();
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await canvas.click({ position: { x: 100, y: 100 } });
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reset atlas', exact: true });
  await reset.focus();
  for (let count = 1; count <= 3; count++) {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(`Original atlas restored · ${count}`);
    await expect(reset).toBeFocused();
    await expect(canvas).toHaveAttribute('data-zoom', '1.00');
    await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
    expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
    expect(await page.evaluate(() => Reflect.get(window, 'atlasObservers'))).toBe(1);
  }
});

test('initial host failure can be retried and uses the replacement host name and area', async ({ page }) => {
  await page.route('**/api/atlas', route => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.locator('#world-canvas')).toHaveCount(0);
  await page.unroute('**/api/atlas');
  await page.route('**/api/atlas', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.world.name = 'Atlas from the host';
    payload.world.cellAreaKm2 = 8;
    await route.fulfill({ response, json: payload });
  });
  await page.getByRole('button', { name: 'Retry atlas' }).click();
  await expect(page.locator('#world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.getByRole('heading', { name: 'Atlas from the host', exact: true })).toBeVisible();
  await expect(page.locator('#atlas-land-area')).toHaveText('268,216');
});

test('missing canvas support reports a visible error without uncaught failures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not open the atlas canvas');
  await expect(page.getByRole('status')).toHaveText('Atlas unavailable');
  await expect(page.getByRole('button', { name: 'Reset atlas' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('resource filtering and province/grid layers change the map without changing cell data', async ({ page }) => {
  const canvas = await ready(page);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByLabel('Resource filter', { exact: true }).selectOption('iron');
  const filtered = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(filtered).not.toBe(before);
  await page.getByRole('checkbox', { name: 'Provinces', exact: true }).check();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(filtered);
  await page.getByRole('checkbox', { name: 'Cell grid', exact: true }).check();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.screenshot({ path: 'test-results/biomes-detail.png', fullPage: true });
});

test('failed atlas replacement preserves the map and retry restores the original study', async ({ page }) => {
  const canvas = await ready(page);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.route('**/api/atlas', route => route.fulfill({ json: { protocolVersion: 2, world: { cells: [] } } }));
  await page.getByRole('button', { name: 'Reset atlas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('atlas response');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);
  await page.unroute('**/api/atlas');
  await page.getByRole('button', { name: 'Retry atlas', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('restored');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);
});

test('the atlas fits mobile and keyboard controls remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await canvas.focus();
  await page.keyboard.press('+');
  await expect(canvas).not.toHaveAttribute('data-zoom', '1.00');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
  await page.screenshot({ path: 'test-results/biomes-mobile.png', fullPage: true });
});

test('high-density displays preserve tap tolerance in CSS pixels', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/');
    const canvas = page.locator('#world-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y);
    await page.mouse.up();
    await expect(page.locator('[data-selected-cell]')).toBeVisible();
    await page.getByRole('button', { name: 'Clear cell selection' }).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y);
    await page.mouse.up();
    await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  } finally { await context.close(); }
});
