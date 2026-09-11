import { expect, test, type Locator, type Page } from '@playwright/test';
import { decodeWorldSurface, WORLD_BIOMES } from '../../shared/generated-world.ts';
import type { SimulationObserve, SimulationOpen, SimulationView } from '../../shared/simulation.ts';

async function snapshot(page: Page, identity: SimulationObserve) {
  const response = await page.request.post('/api/simulation/observe', { data: { instanceId: identity.instanceId, observerId: identity.observerId } });
  expect(response.ok()).toBe(true);
  return await response.json() as SimulationView;
}
async function beginHere(page: Page, historySeed?: string) {
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  if (historySeed) await page.getByLabel('History seed', { exact: true }).fill(historySeed);
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
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
  // Retain the seam-edge spawn from the full-gate failure (cell 238075).
  const { identity, view, panel } = await beginHere(page, '40ba7923-668a-4365-8004-1d3d9c222cd9'), tribe = view.state.tribe;
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
  // Pointer movement schedules a frame; coordinate reads must use its published view.
  await expect.poll(async () => { const x=Number(await canvas.getAttribute('data-center-x')); return Math.min(Math.abs(x),Math.abs(x-1024)); }).toBeLessThan(.01);
  expect(await markerColorPixels(canvas, tribe.originCellId, tribe.color)).toBeGreaterThan(20);
  const marker = await pointFor(canvas, tribe.originCellId);
  // A seam copy can sit against the viewport edge: test its visible hit radius.
  const bounds=await canvas.boundingBox();
  const hitX=marker.x+(marker.x+10<bounds!.x+bounds!.width ? 10 : -10);
  expect(hitX).toBeGreaterThan(bounds!.x);
  expect(hitX).toBeLessThan(bounds!.x+bounds!.width);
  await page.mouse.click(hitX, marker.y);
  const selected = page.getByRole('region', { name: 'Selected tribe camp' });
  await expect(selected).toHaveAttribute('data-selected-civilization', tribe.id);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(tribe.originCellId));
  await expect(selected).toContainText(tribe.name);
  await expect(selected).toContainText(tribe.color);
  await expect(selected).toContainText(String(tribe.originCellId));
  await page.getByRole('button', { name: 'Locate civilization' }).focus(); await page.keyboard.press('Enter');
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
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry simulation' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await canvas.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.world-selected-cell')).toBeVisible();
  expect(requests).toBe(1);
  const climate = await canvasImage(canvas);
  await page.unroute('**/api/simulation/open');
  await page.getByRole('button', { name: 'Retry simulation' }).click();
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
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
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
  await page.getByRole('button', { name: 'Locate civilization' }).click();
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(latest.state.tribe.originCellId));
  await expect(canvas).toHaveAttribute('data-civilization-id', latest.state.tribe.id);
});

test('mobile locate returns from climate to the tribe marker and dragging does not select', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = await freshWorld(page);
  const { view } = await beginHere(page), tribe = view.state.tribe;
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await page.getByRole('button', { name: 'Locate civilization' }).click();
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
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('No suitable founding land');
  await expect(page.getByRole('button', { name: 'Locate civilization' })).toHaveCount(0);
  await expect(panel.locator('[data-tribe-name]')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  expect(requests).toBe(1);
});


test('manual spawn rejects water, dragging and cancel create nothing, then a clicked viable site is retained', async ({ page }) => {
  const canvas = await freshWorld(page);
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:standard:Chronicle');
  const world = await (await page.request.get('/api/world?seed=Chronicle&size=standard')).json();
  const surface = decodeWorldSurface(world.surface);
  // Choose an ocean cell near the center so the test is independent of page edges.
  const water = Array.from(surface.biome).findIndex((code, id) => WORLD_BIOMES[code] === 'ocean'
    && id % 512 > 100 && id % 512 < 400 && Math.floor(id / 512) > 70 && Math.floor(id / 512) < 180);
  expect(water).toBeGreaterThan(0);
  const opens: SimulationOpen[] = [];
  page.on('request', request => { if (request.url().includes('/api/simulation/open')) opens.push(request.postDataJSON()); });
  const toolbar = page.getByRole('region', { name: 'World simulation', exact: true });
  await expect(toolbar.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await toolbar.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const ocean = await pointFor(canvas, water, 512);
  await page.mouse.click(ocean.x, ocean.y);
  await expect(toolbar.getByRole('alert')).toContainText(/suitable|habitable/i);
  expect(opens).toHaveLength(0);
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await expect(toolbar.getByRole('button', { name: 'Cancel placement', exact: true })).toBeVisible();
  await page.mouse.move(ocean.x, ocean.y); await page.mouse.down();
  await page.mouse.move(ocean.x + 55, ocean.y + 10, { steps: 5 }); await page.mouse.up();
  expect(opens).toHaveLength(0);
  await toolbar.getByRole('button', { name: 'Cancel placement', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('chronicle:world-session:')))).toEqual([]);
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const land = await pointFor(canvas, 46821, 512);
  await page.mouse.click(land.x, land.y);
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  expect(opens).toHaveLength(1); expect(opens[0].originCellId).toBe(46821); expect(opens[0].clockMode).toBe('monthly');
  const state = (await snapshot(page, opens[0])).state;
  expect(state.tribe.originCellId).toBe(46821); expect(state.spawnOriginCellId).toBe(46821);
  await expect(toolbar.getByRole('button', { name: 'Spawn civilization', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  expect((await snapshot(page, opens[0])).state.tribe.originCellId).toBe(46821);
});

test('spawn choices cannot start on a world being replaced and map placement cancels on replacement', async ({ page }) => {
  const canvas = await freshWorld(page), toolbar = page.getByRole('region', { name: 'World simulation', exact: true });
  let release!: () => void, requested = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/world?seed=Elsewhere&size=large', async route => {
    requested = true; await held; await route.continue();
  });
  const opens: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/simulation/open')) opens.push(request.url()); });
  await toolbar.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByLabel('World seed').fill('Elsewhere');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(toolbar.getByRole('button', { name: 'Random location', exact: true })).toBeDisabled();
  await expect(toolbar.getByRole('button', { name: 'Choose on map', exact: true })).toBeDisabled();
  expect(opens).toEqual([]);
  release();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:large:Elsewhere');
  await toolbar.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await toolbar.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Cancel placement', exact: true })).toBeVisible();
  await page.getByLabel('World seed').fill('Chronicle');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:large:Chronicle');
  await expect(toolbar.getByRole('button', { name: 'Cancel placement', exact: true })).toHaveCount(0);
  expect(opens).toEqual([]);
});

test('a failed tile lookup during manual placement can retry detail and spawn on the same chosen cell', async ({ page }) => {
  const canvas = await freshWorld(page);
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:standard:Chronicle');
  let failedRequests = 0;
  await page.route('**/api/world/tile?seed=Chronicle&size=standard&x=1&y=0', route => {
    failedRequests++; return route.fulfill({ status: 503, body: 'Tile unavailable' });
  });
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  let land = await pointFor(canvas, 46821, 512);
  await page.mouse.click(land.x, land.y);
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Retry detail', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await page.unroute('**/api/world/tile?seed=Chronicle&size=standard&x=1&y=0');
  await page.getByRole('button', { name: 'Retry detail', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  land = await pointFor(canvas, 46821, 512);
  await page.mouse.click(land.x, land.y);
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel).toContainText('46821');
});
