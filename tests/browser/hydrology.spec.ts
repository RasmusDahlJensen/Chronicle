import { expect, test, type Locator, type Page } from '@playwright/test';
import { createFertilityContext, fertilityAt } from '../../shared/fertility.ts';
import { WORLD_BIOMES, WORLD_GENERATOR_VERSION, WORLD_PROTOCOL_VERSION, type WorldFields, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';

async function pixelSnapshot(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

async function selectCell(page: Page, id: number, world: WorldManifest) {
  const canvas = page.locator('#generated-world-canvas');
  await page.getByRole('button', { name: 'Fit map' }).click();
  const point = await canvas.evaluate((element: HTMLCanvasElement, { id, width, height }) => {
    const bounds = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: bounds.x + bounds.width / 2 + (id % width + 0.5 - width / 2) * scale,
      y: bounds.y + bounds.height / 2 + (Math.floor(id / width) + 0.5 - height / 2) * scale };
  }, { id, width: world.width, height: world.height });
  // Select nearby at overview, then let keyboard navigation bring that location
  // into detail view. Repeated anchored wheel zoom at a pole loses its anchor
  // when the camera first clamps to the latitude boundary.
  await page.mouse.click(point.x, point.y);
  await canvas.focus();
  for (let at = 0; at < 4; at++) await page.keyboard.press('+');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(5);
  const exact = await canvas.evaluate((element: HTMLCanvasElement, { id, width }) => {
    const bounds = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % width + 0.5 - Number(element.dataset.centerX) + width * 1.5) % width) - width / 2;
    return { x: bounds.x + bounds.width / 2 + dx * scale,
      y: bounds.y + bounds.height / 2 + (Math.floor(id / width) + 0.5 - Number(element.dataset.centerY)) * scale };
  }, { id, width: world.width });
  await page.mouse.click(exact.x, exact.y);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(id));
}

test('actual generated rivers can be hidden and inspected for mapped freshwater', async ({ page }, testInfo) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  // Read expected data through the actual host API. Browser network response
  // bodies can be discarded by Chromium while rendering the large manifest.
  const reply = await page.request.get('/api/world?seed=Chronicle&size=large');
  expect(reply.status(), reply.ok() ? 'World manifest' : await reply.text()).toBe(200);
  const world = await reply.json() as WorldManifest;
  await expect(canvas).toHaveAttribute('data-world-key', world.worldKey);
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveAttribute('aria-busy', 'false');
  const rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
  await expect(rivers).toBeChecked();
  await page.getByRole('checkbox', { name: 'Resource sites' }).uncheck();
  const visible = await pixelSnapshot(canvas);
  await rivers.uncheck();
  expect(await pixelSnapshot(canvas)).not.toBe(visible);
  await rivers.check();
  expect(await pixelSnapshot(canvas)).toBe(visible);
  await page.screenshot({ path: testInfo.outputPath('actual-hydrology-fit.png'), fullPage: true });
  expect(world.hydrology.rivers.cells.length).toBeGreaterThan(0);
  const river = world.hydrology.rivers.cells[Math.floor(world.hydrology.rivers.cells.length / 2)];
  await selectCell(page, river, world);
  const water = page.getByRole('region', { name: 'Selected cell water' });
  await expect(water).toContainText('River');
  await expect(water).toContainText('Freshwater river');
  await expect(water).toContainText('Runoff index');
  await expect(water).not.toContainText('m³/s');
  await page.screenshot({ path: testInfo.outputPath('actual-river-detail.png'), fullPage: true });
  const lake = world.hydrology.lakes.find(value => value.cells.length > 1);
  expect(lake).toBeDefined();
  const lakeCell = lake!.cells[Math.floor(lake!.cells.length / 2)];
  await selectCell(page, lakeCell, world);
  await expect(water).toContainText('Lake level');
  await expect(water).toContainText(`${lake!.level.toLocaleString('en')} m`);
  await expect(water).toContainText(lake!.outlet ? 'Freshwater lake' : 'Salinity is not modeled');
  await page.screenshot({ path: testInfo.outputPath('actual-lake-detail.png'), fullPage: true });
});

// Authored transport fixture, not a generator: an inlet, a lake with one outlet,
// a closed lake reached across the world seam, and frozen inland water.
function waterFixture() {
  const width = 1024, height = 512;
  const lakes: WorldManifest['hydrology']['lakes'] = [];
  const lakeAt = new Map<number, number>();
  for (const [id, left, top, columns, rows] of [[1, 508, 248, 12, 16], [2, 2, 226, 8, 8], [3, 560, 248, 8, 8]]) {
    const cells: number[] = [];
    for (let y = top; y < top + rows; y++) for (let x = left; x < left + columns; x++) {
      cells.push(y * width + x); lakeAt.set(y * width + x, id);
    }
    lakes.push({ id, cells, level: 120, outlet: id === 1 ? { cell: 256 * width + 519, next: 256 * width + 520, runoff: 2000 } : null });
  }
  const rivers: WorldManifest['hydrology']['rivers'] = { cells: [], next: [], runoff: [] };
  function edge(x: number, y: number, nextX: number, nextY: number, runoff: number) {
    rivers.cells.push(y * width + x); rivers.next.push(nextY * width + nextX); rivers.runoff.push(runoff);
  }
  for (let x = 480; x < 508; x++) edge(x, 256, x + 1, 256, 1000);
  for (let x = 520; x < 544; x++) edge(x, 256, x + 1, 256, 2000);
  for (let y = 256; y < 472; y++) edge(544, y, 544, y + 1, 2000);
  for (const x of [1018, 1019, 1020, 1021, 1022, 1023, 0, 1]) edge(x, 230, (x + 1) % width, 230, 100);
  function cell(x: number, y: number) {
    const lake = lakeAt.get(y * width + x), ocean = y < 40 || y >= 472;
    return { elevation: ocean ? -1000 : lake ? 100 : 120,
      biome: WORLD_BIOMES.indexOf(ocean ? 'ocean' : lake === 3 ? 'lakeIce' : lake ? 'lake' : 'grassland'),
      temperature: lake === 3 ? -150 : 200 };
  }
  const packed = Buffer.alloc(width * height * 3), biomeCounts = WORLD_BIOMES.map(() => 0);
  const surface = { elevation: new Int16Array(width * height), biome: new Uint8Array(width * height) };
  const hydrology = { rivers, lakes, drySinks: [] };
  let landCells = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = cell(x, y), at = (y * width + x) * 3;
    packed.writeInt16LE(value.elevation, at); packed[at + 2] = value.biome; biomeCounts[value.biome]++;
    surface.elevation[y * width + x] = value.elevation; surface.biome[y * width + x] = value.biome;
    if (y >= 40 && y < 472 && !lakeAt.has(y * width + x)) landCells++;
  }
  const fertility = createFertilityContext(surface, { width, height, areaKm2: 510_000_000 }, hydrology, WORLD_BIOMES);
  function fields(left: number, top: number, columns: number, rows: number, step = 1): WorldFields {
    const result: WorldFields = { elevation: [], biome: [], temperature: [], moisture: [], resource: [], fertility: [] };
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const cellX = left + x * step + Math.floor(step / 2), cellY = top + y * step + Math.floor(step / 2);
      const value = cell(cellX, cellY);
      result.elevation.push(value.elevation); result.biome.push(value.biome); result.temperature.push(value.temperature);
      result.moisture.push(500); result.resource.push(0);
      result.fertility.push(fertilityAt(fertility, cellY * width + cellX, value.temperature / 10, .5).score);
    }
    return result;
  }
  const manifest: WorldManifest = {
    protocolVersion: WORLD_PROTOCOL_VERSION, generatorVersion: WORLD_GENERATOR_VERSION,
    worldKey: `climate-${WORLD_GENERATOR_VERSION}:large:Chronicle`, settings: { seed: 'Chronicle', size: 'large' },
    width, height, tileSize: 128, topology: 'wrap-x', projection: 'cylindrical-equal-area', areaKm2: 510_000_000,
    landCells, resourceSites: 0, biomeCounts, overview: { width: 256, height: 128, fields: fields(0, 0, 256, 128, 4) },
    surface: { width, height, encoding: 'elevation-i16le-biome-u8', data: packed.toString('base64') }, hydrology,
  };
  const tile = (x: number, y: number): WorldTile => ({ protocolVersion: WORLD_PROTOCOL_VERSION, worldKey: manifest.worldKey,
    x, y, width: 128, height: 128, fields: fields(x * 128, y * 128, 128, 128) });
  return { manifest, tile };
}

async function installWaterFixture(page: Page, fixture: ReturnType<typeof waterFixture>) {
  await page.route(/\/api\/world\?/, route => route.fulfill({ json: fixture.manifest }));
  await page.route(/\/api\/world\/tile\?/, route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: fixture.tile(Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))) });
  });
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('checkbox', { name: 'Resource sites' }).uncheck();
}

async function patch(canvas: Locator, x: number, y: number, columns = 1, rows = 1) {
  return canvas.evaluate((element: HTMLCanvasElement, { x, y, columns, rows }) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const dx = ((x - Number(element.dataset.centerX) + 1536) % 1024) - 512;
    return Array.from(element.getContext('2d')!.getImageData(
      (element.clientWidth / 2 + dx * scale) * ratio,
      (element.clientHeight / 2 + (y - Number(element.dataset.centerY)) * scale) * ratio,
      Math.max(1, columns * scale * ratio), Math.max(1, rows * scale * ratio)).data);
  }, { x, y, columns, rows });
}

test('lake water is visible at fit, exposes exact levels and distinguishes closed-basin access', async ({ page }, testInfo) => {
  const fixture = waterFixture(); await installWaterFixture(page, fixture);
  const canvas = page.locator('#generated-world-canvas');
  const lake = await patch(canvas, 512, 251, 4, 4), land = await patch(canvas, 500, 251, 4, 4);
  expect(lake).not.toEqual(land);
  expect(lake[2]).toBeGreaterThan(lake[0]);
  await page.screenshot({ path: testInfo.outputPath('water-fixture-fit.png'), fullPage: true });
  await selectCell(page, 252 * 1024 + 514, fixture.manifest);
  const water = page.getByRole('region', { name: 'Selected cell water' });
  await expect(water).toContainText('Freshwater lake');
  await expect(water).toContainText('120 m');
  await expect(water).toContainText('20 m');
  await expect(water).toContainText('186,768 km²');
  await expect(water).toContainText('One mapped outlet');
  await page.screenshot({ path: testInfo.outputPath('water-fixture-lake-detail.png'), fullPage: true });
  await selectCell(page, 252 * 1024 + 507, fixture.manifest);
  await expect(water).toContainText('Freshwater lakeshore');
  await selectCell(page, 230 * 1024 + 5, fixture.manifest);
  await expect(water).toContainText('Closed basin');
  await expect(water).toContainText('Salinity is not modeled');
  await expect(water).not.toContainText('Freshwater lake');
  await selectCell(page, 250 * 1024 + 563, fixture.manifest);
  await expect(page.locator('.atlas-cell-biome')).toContainText('Frozen lake');
  await expect(water).toContainText('20 m');
});

test('river edges cross the longitude seam locally and leave climate colors unchanged', async ({ page }) => {
  await installWaterFixture(page, waterFixture());
  const canvas = page.locator('#generated-world-canvas'), rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
  const away = await patch(canvas, 400, 229, 8, 3);
  await rivers.uncheck();
  expect(await patch(canvas, 400, 229, 8, 3)).toEqual(away);
  await rivers.check();
  const box = (await canvas.boundingBox())!, scale = Number(await canvas.getAttribute('data-scale'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 512 * scale, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await canvas.focus(); for (let at = 0; at < 3; at++) await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-detail', 'true');
  const west = await patch(canvas, 1022, 230, 2, 1), east = await patch(canvas, 0, 230, 2, 1);
  await rivers.uncheck();
  expect(await patch(canvas, 1022, 230, 2, 1)).not.toEqual(west);
  expect(await patch(canvas, 0, 230, 2, 1)).not.toEqual(east);
  await rivers.check();
  expect(await patch(canvas, 1022, 230, 2, 1)).toEqual(west);
  expect(await patch(canvas, 0, 230, 2, 1)).toEqual(east);
  for (const name of ['Temperature', 'Moisture']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await expect(canvas).toHaveAttribute('data-loaded-tile-count', '4');
    const climate = await pixelSnapshot(canvas);
    await rivers.uncheck(); expect(await pixelSnapshot(canvas)).toBe(climate);
    await rivers.check(); expect(await pixelSnapshot(canvas)).toBe(climate);
  }
});

test('river and lake pixels stay identical when exact detail tiles arrive', async ({ page }) => {
  const fixture = waterFixture();
  await installWaterFixture(page, fixture);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route(/\/api\/world\/tile\?/, async route => {
    requests++; await held;
    const url = new URL(route.request().url());
    await route.fulfill({ json: fixture.tile(Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))) });
  });
  const canvas = page.locator('#generated-world-canvas');
  await canvas.focus(); for (let at = 0; at < 3; at++) await page.keyboard.press('+');
  await expect.poll(() => requests).toBe(4);
  const before = await pixelSnapshot(canvas);
  const rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
  await rivers.uncheck(); expect(await pixelSnapshot(canvas)).not.toBe(before);
  await rivers.check(); expect(await pixelSnapshot(canvas)).toBe(before);
  release();
  await expect(canvas).toHaveAttribute('data-loaded-tile-count', '4');
  expect(await pixelSnapshot(canvas)).toBe(before);
});

test('overview suppresses minor streams and reveals them at detail without changing inspection', async ({ page }) => {
  const fixture = waterFixture(); await installWaterFixture(page, fixture);
  const canvas = page.locator('#generated-world-canvas'), rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
  const overview = await pixelSnapshot(canvas);
  await rivers.uncheck();
  expect(await pixelSnapshot(canvas), 'Weak streams should not cover the overview in tiny blue marks.').toBe(overview);
  await rivers.check();
  await selectCell(page, 256 * 1024 + 490, fixture.manifest);
  await expect(page.getByRole('region', { name: 'Selected cell water' })).toContainText('Freshwater river');
  const detail = await pixelSnapshot(canvas);
  await rivers.uncheck(); expect(await pixelSnapshot(canvas)).not.toBe(detail);
  await expect(page.getByRole('region', { name: 'Selected cell water' })).toContainText('Freshwater river');
});

test('overview keeps a strong river visible while suppressing its minor neighbors', async ({ page }) => {
  const fixture = waterFixture();
  fixture.manifest.hydrology.rivers.runoff = fixture.manifest.hydrology.rivers.runoff.map(flow => flow * 30);
  fixture.manifest.hydrology.lakes[0].outlet!.runoff *= 30;
  await installWaterFixture(page, fixture);
  const canvas = page.locator('#generated-world-canvas'), rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
  const trunk = await patch(canvas, 482, 255, 20, 3), stream = await patch(canvas, 1019, 229, 3, 3);
  await rivers.uncheck();
  expect(await patch(canvas, 482, 255, 20, 3)).not.toEqual(trunk);
  expect(await patch(canvas, 1019, 229, 3, 3)).toEqual(stream);
});
