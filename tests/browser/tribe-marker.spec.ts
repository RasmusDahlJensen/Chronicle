import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SimulationObserve, SimulationOpen, SimulationView } from '../../shared/simulation.ts';

async function snapshot(page: Page, identity: SimulationObserve) {
  const response = await page.request.post('/api/simulation/observe', { data: identity });
  expect(response.ok()).toBe(true);
  return await response.json() as SimulationView;
}
async function beginHere(page: Page) {
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  const opening = page.waitForRequest('**/api/simulation/open');
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  const { instanceId, observerId } = (await opening).postDataJSON() as SimulationOpen;
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  const identity = { instanceId, observerId };
  return { identity, view: await snapshot(page, identity), panel };
}
async function freshWorld(page: Page) {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  return canvas;
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
async function markerColorPixels(canvas: Locator, cell: number, color: string) {
  return canvas.evaluate((element: HTMLCanvasElement, { cell, color }) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const dx = ((cell % 1024 + .5 - Number(element.dataset.centerX) + 1536) % 1024) - 512;
    const x = element.clientWidth / 2 + dx * scale, y = element.clientHeight / 2 + (Math.floor(cell / 1024) + .5 - Number(element.dataset.centerY)) * scale;
    const pixels = element.getContext('2d')!.getImageData((x - 12) * ratio, (y - 12) * ratio, 24 * ratio, 24 * ratio).data;
    const rgb = [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16));
    let matches = 0;
    for (let at = 0; at < pixels.length; at += 4) if (rgb.every((value, channel) => value === pixels[at + channel])) matches++;
    return matches;
  }, { cell, color });
}

test('one actual tribe marker can be located, picked across the seam and preserved on regeneration', async ({ page }, testInfo) => {
  const canvas = await freshWorld(page);
  const { identity, view, panel } = await beginHere(page), tribe = view.state.tribe;
  await expect(panel).toHaveAttribute('data-instance-id', view.state.id);
  await expect(panel.getByRole('heading', { name: tribe.name, exact: true })).toBeVisible();
  const rgb = [1, 3, 5].map(at => Number.parseInt(tribe.color.slice(at, at + 2), 16)).join(', ');
  await expect(panel.locator('.world-civilization-swatch')).toHaveCSS('background-color', `rgb(${rgb})`);
  await expect(canvas).toHaveAttribute('data-civilization-id', tribe.id);
  expect(await markerColorPixels(canvas, tribe.originCellId, tribe.color)).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath('tribe-marker-overview.png'), fullPage: true });
  // Move the longitude seam into the middle of the viewport. Both drawing and
  // picking must use the wrapped copy, rather than the unwrapped cell position.
  const pan = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
      distance: Number(element.dataset.centerX) * Number(element.dataset.scale) };
  });
  await page.mouse.move(pan.x, pan.y); await page.mouse.down();
  await page.mouse.move(pan.x + pan.distance, pan.y, { steps: 5 }); await page.mouse.up();
  expect(await markerColorPixels(canvas, tribe.originCellId, tribe.color)).toBeGreaterThan(20);
  const marker = await pointFor(canvas, tribe.originCellId);
  await page.mouse.click(marker.x + 10, marker.y);
  const selected = page.getByRole('region', { name: 'Selected tribe camp' });
  await expect(selected).toHaveAttribute('data-selected-civilization', tribe.id);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(tribe.originCellId));
  await expect(selected).toContainText(tribe.name);
  await expect(selected).toContainText(tribe.color);
  await expect(selected).toContainText(String(tribe.originCellId));
  await panel.getByRole('button', { name: 'Locate tribe' }).focus(); await page.keyboard.press('Enter');
  await expect(canvas).toHaveAttribute('data-layer', 'biomes');
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('tribe-marker-selected.png'), fullPage: true });
  await canvas.focus(); await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveCount(0);
  await expect(page.locator('.world-selected-cell')).not.toHaveAttribute('data-selected-cell', String(tribe.originCellId));
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('#world-status')).toContainText('World ready');
  await expect(page.locator('.world-selected-cell')).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-instance-id', view.state.id);
  await expect(canvas).toHaveAttribute('data-civilization-id', tribe.id);
  expect((await snapshot(page, identity)).state).toEqual(view.state);
});

test('failed initiation keeps geography usable and retry leaves all scientific layer pixels unchanged', async ({ page }) => {
  const canvas = await freshWorld(page);
  const baselines = new Map<string, string>();
  for (const layer of ['Temperature', 'Moisture', 'Fertility']) {
    await page.getByRole('radio', { name: layer, exact: true }).check();
    baselines.set(layer, await canvasImage(canvas));
  }
  let requests = 0;
  await page.route('**/api/simulation/open', route => { requests++; return route.fulfill({ status: 503, body: 'Unavailable' }); });
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Retry tribe' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await canvas.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.world-selected-cell')).toBeVisible();
  expect(requests).toBe(1);
  const climate = await canvasImage(canvas);
  await page.unroute('**/api/simulation/open');
  await panel.getByRole('button', { name: 'Retry tribe' }).click();
  await expect(panel.locator('[data-tribe-name]')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await canvasImage(canvas)).toBe(climate);
  await canvas.focus(); await page.keyboard.press('Escape');
  for (const [layer, before] of baselines) {
    await page.getByRole('radio', { name: layer, exact: true }).check();
    expect(await canvasImage(canvas), `${layer} keeps its literal colors when the tribe arrives`).toBe(before);
  }
});

test('an older delayed tribal creation cannot replace the current world camp', async ({ page }) => {
  let release!: () => void, earlier: SimulationView | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/simulation/open', async route => {
    if ((route.request().postDataJSON() as SimulationOpen).settings.seed !== 'Chronicle') { await route.continue(); return; }
    const response = await route.fetch(); earlier = await response.json() as SimulationView;
    await held; await route.fulfill({ response }).catch(() => {});
  });
  const canvas = await freshWorld(page);
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect.poll(() => earlier !== undefined).toBe(true);
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  await page.getByLabel('World seed').fill('Elsewhere');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('#world-current-seed')).toHaveText('Elsewhere');
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  const { view: latest } = await beginHere(page);
  expect(latest.state.tribe).not.toEqual(earlier!.state.tribe);
  await expect(canvas).toHaveAttribute('data-world-key', latest.state.worldKey);
  await expect(panel).toHaveAttribute('data-instance-id', latest.state.id);
  release(); await page.waitForLoadState('networkidle');
  await expect(panel.getByRole('heading', { name: latest.state.tribe.name, exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('data-instance-id', latest.state.id);
  await panel.getByRole('button', { name: 'Locate tribe' }).click();
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(latest.state.tribe.originCellId));
  await expect(canvas).toHaveAttribute('data-civilization-id', latest.state.tribe.id);
});

test('mobile locate returns from climate to the tribe marker and dragging does not select', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = await freshWorld(page);
  const { view, panel } = await beginHere(page), tribe = view.state.tribe;
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await panel.getByRole('button', { name: 'Locate tribe' }).click();
  await expect(canvas).toHaveAttribute('data-layer', 'biomes');
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toHaveAttribute('data-selected-civilization', tribe.id);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const point = await pointFor(canvas, tribe.originCellId);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 55, point.y + 10, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toHaveCount(0);
  await expect(page.locator('.world-selected-cell')).toHaveCount(0);
  const moved = await pointFor(canvas, tribe.originCellId);
  await page.mouse.click(moved.x + 10, moved.y);
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toHaveAttribute('data-selected-civilization', tribe.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tribe-marker-mobile.png'), fullPage: true });
});

test('no suitable camp land is an explicit initiation failure with no invented marker', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/simulation/open', async route => {
    requests++;
    await route.fulfill({ status: 503, json: { error: { code: 'SIMULATION_ERROR', message: 'No suitable founding land is available for this tribe.', requestId: 'no-camp-land' } } });
  });
  const canvas = await freshWorld(page);
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('No suitable founding land');
  await expect(panel.getByRole('button', { name: 'Locate tribe' })).toHaveCount(0);
  await expect(panel.locator('[data-tribe-name]')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  expect(requests).toBe(1);
});
