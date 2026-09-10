import { expect, test, type Page } from '@playwright/test';
import { WORLD_BIOMES, WORLD_GENERATOR_VERSION, WORLD_PROTOCOL_VERSION, type WorldFields, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';

// Explicit renderer fixture: flat terrain bands plus an island that no 4×4
// centre sample hits. It tests transport/rendering, not a second generator.
function textureFixture() {
  const width = 1024, height = 512;
  const packed = Buffer.alloc(width * height * 3);
  const biomeCounts = WORLD_BIOMES.map(() => 0);
  let landCells = 0;
  function cell(x: number, y: number) {
    const land = y >= 40 && y < 470 && ((x >= 64 && x < 320) || (x >= 512 && x < 700) || (x >= 760 && x < 950));
    const island = x >= 400 && x < 402 && y >= 200 && y < 202;
    const biome = !land && !island ? 0 : x >= 760 ? 3 : x >= 512 ? 5 : 2;
    // A slope crossing detail-tile borders makes independent edge shading visible.
    const elevation = !land && !island ? -1000 : x >= 512 && x < 545 ? 300 + (x - 512) * 65 : 300;
    return { biome, elevation };
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = cell(x, y), offset = (y * width + x) * 3;
    packed.writeInt16LE(value.elevation, offset); packed[offset + 2] = value.biome;
    biomeCounts[value.biome]++; if (value.elevation >= 0) landCells++;
  }
  function fields(x: number, y: number, columns: number, rows: number, step = 1): WorldFields {
    const result: WorldFields = { elevation: [], biome: [], temperature: [], moisture: [], resource: [] };
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const value = cell(x + column * step + Math.floor(step / 2), y + row * step + Math.floor(step / 2));
      result.elevation.push(value.elevation); result.biome.push(value.biome);
      result.temperature.push(200); result.moisture.push(500); result.resource.push(0);
    }
    return result;
  }
  const manifest: WorldManifest = {
    protocolVersion: WORLD_PROTOCOL_VERSION, generatorVersion: WORLD_GENERATOR_VERSION,
    worldKey: `climate-${WORLD_GENERATOR_VERSION}:large:Chronicle`, settings: { seed: 'Chronicle', size: 'large' },
    width, height, tileSize: 128, topology: 'wrap-x', projection: 'cylindrical-equal-area', areaKm2: 510_000_000,
    landCells, resourceSites: 0, biomeCounts, overview: { width: 256, height: 128, fields: fields(0, 0, 256, 128, 4) },
    surface: { width, height, encoding: 'elevation-i16le-biome-u8', data: packed.toString('base64') },
    hydrology: { rivers: { cells: [], next: [], runoff: [] }, lakes: [], drySinks: [] },
  };
  function tile(x: number, y: number): WorldTile {
    return { protocolVersion: WORLD_PROTOCOL_VERSION, worldKey: manifest.worldKey, x, y, width: 128, height: 128, fields: fields(x * 128, y * 128, 128, 128) };
  }
  return { manifest, tile };
}
const fixture = textureFixture();
async function installFixture(page: Page) {
  await page.route(/\/api\/world\?/, route => route.fulfill({ json: fixture.manifest }));
  await page.route(/\/api\/world\/tile\?/, route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: fixture.tile(Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))) });
  });
}

test('fit view preserves a two-cell island omitted by sampled climate overview', async ({ page }) => {
  await installFixture(page); await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const point = (x: number, y: number) => Array.from(element.getContext('2d')!.getImageData(
      (element.clientWidth / 2 + (x - 512) * scale) * ratio,
      (element.clientHeight / 2 + (y - 256) * scale) * ratio, 1, 1).data);
    return { island: point(401, 201), ocean: point(405, 205) };
  });
  expect(pixels.island[1]).toBeGreaterThan(pixels.island[2]);
  expect(pixels.ocean[2]).toBeGreaterThan(pixels.ocean[1]);
});

test('flat water and land retain visible terrain texture at fit and detail zoom', async ({ page }, testInfo) => {
  await installFixture(page); await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const variations = await canvas.evaluate((element: HTMLCanvasElement) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const countColours = (x: number, y: number, width: number, height: number) => {
      const image = element.getContext('2d')!.getImageData(
        (element.clientWidth / 2 + (x - 512) * scale) * ratio,
        (element.clientHeight / 2 + (y - 256) * scale) * ratio,
        width * scale * ratio, height * scale * ratio);
      const colours = new Set<string>();
      for (let at = 0; at < image.data.length; at += 4) colours.add(`${image.data[at]},${image.data[at + 1]},${image.data[at + 2]}`);
      return colours.size;
    };
    return { water: countColours(350, 75, 100, 30), grass: countColours(110, 75, 100, 30), forest: countColours(800, 75, 100, 30) };
  });
  expect(variations.water).toBeGreaterThan(12);
  expect(variations.grass).toBeGreaterThan(12);
  expect(variations.forest).toBeGreaterThan(12);
  await page.screenshot({ path: testInfo.outputPath('synthetic-terrain-fit.png'), fullPage: true });
  await canvas.focus(); for (let index = 0; index < 4; index++) await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-detail', 'true');
  const detailVariations = await canvas.evaluate((element: HTMLCanvasElement) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const coloursAt = (x: number) => {
      const image = element.getContext('2d')!.getImageData(
        (element.clientWidth / 2 + (x - 512) * scale) * ratio,
        (element.clientHeight / 2 - 26 * scale) * ratio, 20 * scale * ratio, 20 * scale * ratio);
      const colours = new Set<string>();
      for (let at = 0; at < image.data.length; at += 4) colours.add(`${image.data[at]},${image.data[at + 1]},${image.data[at + 2]}`);
      return colours.size;
    };
    return { water: coloursAt(450), desert: coloursAt(555) };
  });
  expect(detailVariations.water).toBeGreaterThan(12);
  expect(detailVariations.desert).toBeGreaterThan(12);
  await page.screenshot({ path: testInfo.outputPath('synthetic-terrain-detail.png'), fullPage: true });
});

test('biome texture and relief remain identical across detail tile arrivals', async ({ page }) => {
  await installFixture(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0, complete = 0;
  await page.route(/\/api\/world\/tile\?/, async route => {
    requests++; await held;
    const url = new URL(route.request().url());
    await route.fulfill({ json: fixture.tile(Number(url.searchParams.get('x')), Number(url.searchParams.get('y'))) });
    complete++;
  });
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await canvas.focus(); for (let index = 0; index < 3; index++) await page.keyboard.press('+');
  await expect.poll(() => requests).toBe(4);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  release(); await expect.poll(() => complete).toBe(4);
  await page.waitForLoadState('networkidle');
  await expect(canvas).toHaveAttribute('data-loaded-tile-count', '4');
  const after = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(after === before, 'Loading exact detail must not change full-resolution biome terrain or introduce seams.').toBe(true);
});
