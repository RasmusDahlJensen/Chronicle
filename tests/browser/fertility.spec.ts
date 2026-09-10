import { expect, test, type Locator, type Page } from '@playwright/test';
import { inspectWorldCell, isWorldWater, worldKey, WORLD_BIOMES, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';

async function selectCell(page: Page, id: number, world: WorldManifest) {
  const canvas = page.locator('#generated-world-canvas');
  await page.getByRole('button', { name: 'Fit map' }).click();
  const point = await canvas.evaluate((element: HTMLCanvasElement, { id, width, height }) => {
    const bounds = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: bounds.x + bounds.width / 2 + (id % width + 0.5 - width / 2) * scale,
      y: bounds.y + bounds.height / 2 + (Math.floor(id / width) + 0.5 - height / 2) * scale };
  }, { id, width: world.width, height: world.height });
  await page.mouse.click(point.x, point.y);
  await canvas.focus();
  for (let at = 0; at < 4; at++) await page.keyboard.press('+');
  await page.keyboard.press('ArrowRight');
  const exact = await canvas.evaluate((element: HTMLCanvasElement, { id, width }) => {
    const bounds = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % width + 0.5 - Number(element.dataset.centerX) + width * 1.5) % width) - width / 2;
    return { x: bounds.x + bounds.width / 2 + dx * scale,
      y: bounds.y + bounds.height / 2 + (Math.floor(id / width) + 0.5 - Number(element.dataset.centerY)) * scale };
  }, { id, width: world.width });
  await page.mouse.click(exact.x, exact.y);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(id));
}

async function snapshot(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

test('actual fertility layer shows exact growing potential and excludes water', async ({ page }, testInfo) => {
  await page.goto('/');
  const fertility = page.getByRole('radio', { name: 'Fertility', exact: true });
  await expect(fertility).toBeVisible({ timeout: 5000 });
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const reply = await page.request.get('/api/world?seed=Chronicle&size=large');
  expect(reply.ok()).toBe(true);
  const world = await reply.json() as WorldManifest;
  await expect(canvas).toHaveAttribute('data-world-key', world.worldKey);
  await page.getByRole('checkbox', { name: 'Resource sites' }).uncheck();
  const biomes = await snapshot(canvas);
  await fertility.check();
  await expect(canvas).toHaveAttribute('data-layer', 'fertility');
  expect(await snapshot(canvas)).not.toBe(biomes);
  const legend = page.getByRole('region', { name: 'Map legend' });
  await expect(legend).toContainText('Natural growing potential');
  await expect(legend).toContainText('Water');
  await page.screenshot({ path: testInfo.outputPath('fertility-overview.png'), fullPage: true });

  const fields = world.overview.fields;
  let best = -1;
  for (let at = 0; at < fields.biome.length; at++) if (!isWorldWater(WORLD_BIOMES[fields.biome[at]]) && (best < 0 || fields.fertility[at] > fields.fertility[best])) best = at;
  expect(best).toBeGreaterThanOrEqual(0);
  const x = (best % 256) * 4 + 2, y = Math.floor(best / 256) * 4 + 2;
  await selectCell(page, y * world.width + x, world);
  const tileReply = await page.request.get(`/api/world/tile?seed=Chronicle&size=large&x=${Math.floor(x / 128)}&y=${Math.floor(y / 128)}`);
  expect(tileReply.ok()).toBe(true);
  const tile = await tileReply.json() as WorldTile, at = (y % 128) * 128 + x % 128;
  const facts = page.getByRole('region', { name: 'Selected cell fertility' });
  await expect(facts.locator('[data-fertility-score]')).toHaveText(`${tile.fields.fertility[at]} / 100`);
  const assessment = inspectWorldCell(world, tile, x, y).fertility;
  for (const [key, label] of [['warmth', 'Warmth'], ['moisture', 'Moisture'], ['soil', 'Soil'], ['slope', 'Slope'], ['drainage', 'Drainage']] as const) {
    const factor = facts.getByRole('meter', { name: label, exact: true });
    await expect(factor).toBeVisible();
    await expect(factor).toHaveAttribute('value', String(assessment.factors[key]));
  }
  await expect(facts).toContainText('Estimated soil');
  await expect(facts).toContainText('Regional slope');
  await expect(facts).toContainText('yield');
  await page.screenshot({ path: testInfo.outputPath('fertility-cell-factors.png'), fullPage: true });
  const ocean = fields.biome.findIndex(code => WORLD_BIOMES[code] === 'ocean');
  expect(ocean).toBeGreaterThanOrEqual(0);
  await selectCell(page, (Math.floor(ocean / 256) * 4 + 2) * world.width + (ocean % 256) * 4 + 2, world);
  await expect(facts).toContainText('Not growing land');
  await expect(facts.getByRole('meter')).toHaveCount(0);
});

const fertilityColour = (score: number) => {
  const from = score <= 50 ? [151, 105, 76] : [223, 212, 155], to = score <= 50 ? [223, 212, 155] : [47, 103, 65];
  const fraction = score <= 50 ? score / 50 : (score - 50) / 50;
  return [...from.map((value, at) => Math.round(value + (to[at] - value) * fraction)), 255];
};
async function pixel(canvas: Locator, x: number, y: number) {
  return canvas.evaluate((element: HTMLCanvasElement, { x, y }) => {
    const scale = Number(element.dataset.scale), ratio = element.width / element.clientWidth;
    const dx = ((x + .5 - Number(element.dataset.centerX) + 1536) % 1024) - 512;
    return Array.from(element.getContext('2d')!.getImageData(
      (element.clientWidth / 2 + dx * scale) * ratio,
      (element.clientHeight / 2 + (y + .5 - Number(element.dataset.centerY)) * scale) * ratio, 1, 1).data);
  }, { x, y });
}

test('fertility colours use sampled scores until exact tiles arrive and survive layer changes', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const world = await (await page.request.get('/api/world?seed=Chronicle&size=large')).json() as WorldManifest;
  const tiles = await Promise.all([[3, 1], [4, 1], [3, 2], [4, 2]].map(async ([x, y]) => {
    const reply = await page.request.get(`/api/world/tile?seed=Chronicle&size=large&x=${x}&y=${y}`);
    expect(reply.ok()).toBe(true); return await reply.json() as WorldTile;
  }));
  let sample: { x: number; y: number; before: number; after: number } | undefined;
  let water: { x: number; y: number } | undefined;
  for (let y = 205; y < 307; y++) for (let x = 425; x < 599; x++) {
    const tile = tiles.find(value => value.x === Math.floor(x / 128) && value.y === Math.floor(y / 128))!;
    const at = y % 128 * 128 + x % 128, overview = Math.floor(y / 4) * 256 + Math.floor(x / 4);
    const exactWater = isWorldWater(WORLD_BIOMES[tile.fields.biome[at]]), overviewWater = isWorldWater(WORLD_BIOMES[world.overview.fields.biome[overview]]);
    if (exactWater && overviewWater) water = { x, y };
    if (!exactWater && !overviewWater && Math.abs(tile.fields.fertility[at] - world.overview.fields.fertility[overview]) >= 5) {
      sample = { x, y, before: world.overview.fields.fertility[overview], after: tile.fields.fertility[at] };
    }
  }
  expect(sample, 'A visible real cell differs from its coarse sample').toBeDefined();
  expect(water, 'A visible mapped water cell').toBeDefined();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/world/tile?**', async route => { await held; await route.continue(); });
  await page.getByRole('checkbox', { name: 'Resource sites' }).uncheck();
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await canvas.focus(); for (let at = 0; at < 3; at++) await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-detail', 'true');
  await expect(canvas).toHaveAttribute('data-loaded-tile-count', '0');
  expect(await pixel(canvas, sample!.x, sample!.y)).toEqual(fertilityColour(sample!.before));
  expect(await pixel(canvas, water!.x, water!.y)).toEqual([143, 177, 184, 255]);
  release();
  await expect(canvas).toHaveAttribute('data-loaded-tile-count', '4');
  expect(await pixel(canvas, sample!.x, sample!.y)).toEqual(fertilityColour(sample!.after));
  expect(await pixel(canvas, water!.x, water!.y)).toEqual([143, 177, 184, 255]);
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  expect(await pixel(canvas, sample!.x, sample!.y)).toEqual(fertilityColour(sample!.after));
  expect(Number(await canvas.getAttribute('data-texture-count'))).toBeLessThanOrEqual(16);
});

test('malformed fertility retains the previous view and retry loads the requested world', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  const before = await snapshot(canvas);
  await page.route('**/api/world?**', async route => {
    const reply = await route.fetch(); expect(reply.ok()).toBe(true);
    const malformed = await reply.json() as WorldManifest;
    const fields = malformed.overview.fields, at = fields.biome.findIndex(code => !isWorldWater(WORLD_BIOMES[code]));
    expect(at).toBeGreaterThanOrEqual(0);
    fields.fertility[at] = (fields.fertility[at] + 1) % 101;
    await route.fulfill({ json: malformed });
  });
  await page.getByLabel('World seed').fill('Elsewhere');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(page.locator('#world-status')).toContainText('Previous world retained');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await snapshot(canvas)).toBe(before);
  await page.unroute('**/api/world?**');
  await page.getByRole('button', { name: 'Retry generation' }).click();
  await expect(canvas).toHaveAttribute('data-world-key', worldKey({ seed: 'Elsewhere', size: 'large' }));
  await expect(canvas).toHaveAttribute('data-layer', 'fertility');
  expect(await snapshot(canvas)).not.toBe(before);
  await expect(page.locator('#world-current-seed')).toHaveText('Elsewhere');
});
