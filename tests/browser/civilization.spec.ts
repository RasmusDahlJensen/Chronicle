import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CivilizationSnapshot } from '../../shared/civilization.ts';

async function snapshot(page: Page, seed = 'Chronicle') {
  const response = await page.request.get(`/api/world/civilization?seed=${encodeURIComponent(seed)}&size=large`);
  expect(response.ok()).toBe(true);
  return await response.json() as CivilizationSnapshot;
}
async function pointFor(canvas: Locator, cell: number, width = 1024) {
  return canvas.evaluate((element: HTMLCanvasElement, { cell, width }) => {
    const bounds = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((cell % width + .5 - Number(element.dataset.centerX) + width * 1.5) % width) - width / 2;
    return { x: bounds.x + bounds.width / 2 + dx * scale,
      y: bounds.y + bounds.height / 2 + (Math.floor(cell / width) + .5 - Number(element.dataset.centerY)) * scale };
  }, { cell, width });
}
async function canvasImage(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

test('one real named civilization can be located, picked and reproduced', async ({ page }, testInfo) => {
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Civilization', exact: true });
  await expect(card).toBeVisible({ timeout: 5000 });
  const world = await snapshot(page), civ = world.civilizations[0];
  expect(world.status).toBe('spawned'); expect(world.civilizations).toHaveLength(1);
  await expect(card).toHaveAttribute('data-civilization-id', civ.id);
  await expect(card.getByRole('heading', { name: civ.name, exact: true })).toBeVisible();
  await expect(card.locator('[data-civilization-color]')).toHaveAttribute('data-civilization-color', civ.color);
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-civilization-id', civ.id);
  const colorPixels = await canvas.evaluate((element: HTMLCanvasElement, { cell, color }) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const dx = ((cell % 1024 + .5 - Number(element.dataset.centerX) + 1536) % 1024) - 512;
    const x = element.clientWidth / 2 + dx * scale, y = element.clientHeight / 2 + (Math.floor(cell / 1024) + .5 - Number(element.dataset.centerY)) * scale;
    const pixels = element.getContext('2d')!.getImageData((x - 12) * ratio, (y - 12) * ratio, 24 * ratio, 24 * ratio).data;
    const rgb = [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16));
    let matches = 0;
    for (let at = 0; at < pixels.length; at += 4) if (rgb.every((value, channel) => value === pixels[at + channel])) matches++;
    return matches;
  }, { cell: civ.originCellId, color: civ.color });
  expect(colorPixels).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('civilization-overview.png'), fullPage: true });
  // Move the longitude seam into the middle of the viewport. Picking must use
  // the same wrapped copy as the marker, rather than its unwrapped cell position.
  const pan = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
      distance: Number(element.dataset.centerX) * Number(element.dataset.scale) };
  });
  await page.mouse.move(pan.x, pan.y); await page.mouse.down();
  await page.mouse.move(pan.x + pan.distance, pan.y, { steps: 5 }); await page.mouse.up();
  const marker = await pointFor(canvas, civ.originCellId);
  await page.mouse.click(marker.x + 10, marker.y);
  const selected = page.getByRole('region', { name: 'Selected civilization' });
  await expect(selected).toHaveAttribute('data-selected-civilization', civ.id);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(civ.originCellId));
  await expect(selected).toContainText(civ.name);
  await expect(selected).toContainText(civ.color);
  await expect(selected).toContainText(String(civ.originCellId));
  await card.getByRole('button', { name: 'Locate civilization' }).focus();
  await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-layer', 'biomes');
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('civilization-selected.png'), fullPage: true });
  await canvas.focus(); await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveCount(0);
  await expect(page.locator('.world-selected-cell')).not.toHaveAttribute('data-selected-cell', String(civ.originCellId));
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('.world-selected-cell')).toHaveCount(0);
  await expect(card).toHaveAttribute('data-civilization-id', civ.id);
  await expect(canvas).toHaveAttribute('data-civilization-id', civ.id);
  expect(await snapshot(page)).toEqual(world);
});

test('civilization failure keeps geography usable and retries only when requested', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/world/civilization?**', route => { requests++; return route.fulfill({ status: 503, body: 'Unavailable' }); });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Civilization', exact: true });
  await expect(card).toBeVisible({ timeout: 5000 });
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Retry civilization' })).toBeVisible();
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await canvas.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.world-selected-cell')).toBeVisible();
  expect(requests).toBe(1);
  const climate = await canvasImage(canvas);
  await page.unroute('**/api/world/civilization?**');
  await card.getByRole('button', { name: 'Retry civilization' }).click();
  const world = await snapshot(page);
  await expect(card).toHaveAttribute('data-civilization-id', world.civilizations[0].id);
  await expect(card.getByRole('alert')).toHaveCount(0);
  expect(await canvasImage(canvas)).toBe(climate);
});

test('an older delayed civilization cannot replace the current seed', async ({ page }) => {
  let release!: () => void, earlier: CivilizationSnapshot | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/world/civilization?seed=Chronicle&size=large', async route => {
    const response = await route.fetch(); earlier = await response.json() as CivilizationSnapshot;
    await held; await route.fulfill({ response }).catch(() => {});
  });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Civilization', exact: true });
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect.poll(() => earlier !== undefined).toBe(true);
  await expect(card).toContainText('Finding a founding place');
  await page.getByLabel('World seed').fill('Elsewhere');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  const latest = await snapshot(page, 'Elsewhere');
  expect(latest.civilizations[0]).not.toEqual(earlier!.civilizations[0]);
  await expect(card).toHaveAttribute('data-world-key', latest.worldKey);
  await expect(card).toHaveAttribute('data-civilization-id', latest.civilizations[0].id);
  release(); await page.waitForLoadState('networkidle');
  await expect(card).toHaveAttribute('data-civilization-id', latest.civilizations[0].id);
  await expect(card.getByRole('heading', { name: latest.civilizations[0].name, exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Locate civilization' }).click();
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(latest.civilizations[0].originCellId));
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-civilization-id', latest.civilizations[0].id);
});

test('mobile locate returns from climate to the marker and dragging does not select', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Civilization', exact: true });
  await expect(card).toBeVisible({ timeout: 5000 });
  const world = await snapshot(page), civ = world.civilizations[0];
  await expect(card).toHaveAttribute('data-civilization-id', civ.id);
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await card.getByRole('button', { name: 'Locate civilization' }).click();
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-layer', 'biomes');
  await expect(page.getByRole('region', { name: 'Selected civilization' })).toHaveAttribute('data-selected-civilization', civ.id);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const point = await pointFor(canvas, civ.originCellId);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 55, point.y + 10, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Selected civilization' })).toHaveCount(0);
  await expect(page.locator('.world-selected-cell')).toHaveCount(0);
  const moved = await pointFor(canvas, civ.originCellId);
  await page.mouse.click(moved.x + 10, moved.y);
  await expect(page.getByRole('region', { name: 'Selected civilization' })).toHaveAttribute('data-selected-civilization', civ.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('civilization-mobile.png'), fullPage: true });
});

test('a no-suitable-land snapshot shows an explicit empty state without a marker', async ({ page }) => {
  await page.route('**/api/world/civilization?**', async route => {
    const response = await route.fetch(), actual = await response.json() as CivilizationSnapshot;
    await route.fulfill({ json: { ...actual, status: 'no-suitable-land', civilizations: [] } });
  });
  await page.goto('/');
  const card = page.getByRole('region', { name: 'Civilization', exact: true });
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card).toContainText('No suitable founding land');
  await expect(card.getByRole('button', { name: 'Locate civilization' })).toHaveCount(0);
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-civilization-id', '');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
});
