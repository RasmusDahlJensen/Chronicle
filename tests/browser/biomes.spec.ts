import { expect, test } from '@playwright/test';
import type { AtlasCell, AtlasWorld } from '../../shared/atlas.ts';
import { BIOMES, RESOURCES } from '../../src/world/atlas.ts';
import { RESOURCE_RULES } from '../../src/world/resources.ts';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  const canvas = page.locator('#world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  return canvas;
}

test('the default atlas renders a larger biome/resource map and reports real host data', async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath('biomes-desktop.png'), fullPage: true });
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

test('land selection moves from province to cell without retaining province tint', async ({ page }) => {
  const canvas = await ready(page);
  const { world } = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  const cell = world.cells.find(candidate => candidate.provinceId !== null)!;
  const remote = world.cells.find(candidate => candidate.provinceId === cell.provinceId
    && Math.hypot(candidate.id % world.width - cell.id % world.width,
      Math.floor(candidate.id / world.width) - Math.floor(cell.id / world.width)) > 10)!;
  const unselected = await atlasCellPatch(canvas, world, remote.id);

  await clickAtlasCell(canvas, world, cell.id);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'province');
  await expect(canvas).toHaveAttribute('data-selected-province-id', cell.provinceId!);
  await expect(canvas).not.toHaveAttribute('data-selected-cell-id');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', cell.provinceId!);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Province resources' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toHaveCount(0);
  const provinceHighlight = await atlasCellPatch(canvas, world, remote.id);
  expect(provinceHighlight).not.toEqual(unselected);

  await clickAtlasCell(canvas, world, cell.id);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'cell');
  await expect(canvas).toHaveAttribute('data-selected-cell-id', String(cell.id));
  await expect(canvas).not.toHaveAttribute('data-selected-province-id');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(cell.id));
  await expect(page.locator('[data-selected-province]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Province resources' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toBeVisible();
  expect(await atlasCellPatch(canvas, world, remote.id)).toEqual(unselected);

  await clickAtlasCell(canvas, world, cell.id);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'province');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', cell.provinceId!);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Province resources' })).toBeVisible();
  expect(await atlasCellPatch(canvas, world, remote.id)).toEqual(provinceHighlight);
  await clickAtlasCell(canvas, world, cell.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(cell.id));
  expect(await atlasCellPatch(canvas, world, remote.id)).toEqual(unselected);

  await clickAtlasCell(canvas, world, remote.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(remote.id));
  await page.getByRole('button', { name: 'Back to province', exact: true }).click();
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', cell.provinceId!);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);

  const other = world.cells.find(candidate => candidate.provinceId !== null && candidate.provinceId !== cell.provinceId)!;
  await clickAtlasCell(canvas, world, other.id);
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', other.provinceId!);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await clickAtlasCell(canvas, world, other.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(other.id));
  await clickAtlasCell(canvas, world, cell.id);
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', cell.provinceId!);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await clickAtlasCell(canvas, world, cell.id);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', cell.provinceId!);
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
  await expect(page.locator('[data-selected-cell], [data-selected-province]')).toHaveCount(0);
});

test('zoom, resource layers and cell selection read the same atlas cells', async ({ page }, testInfo) => {
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
  const response = await page.request.get('/api/atlas');
  const { world } = await response.json() as { world: AtlasWorld };
  const inspected = world.cells.find(cell => cell.provinceId !== null && cell.resource !== null)!;
  await clickAtlasCell(canvas, world, inspected.id);
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', inspected.provinceId!);
  await clickAtlasCell(canvas, world, inspected.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(inspected.id));
  const id = inspected.id;
  expect(Number.isInteger(id)).toBe(true);
  await expect(page.locator('[data-selected-cell]')).toContainText(world.cells[id].elevation.toLocaleString('en'));
  await expect(page.locator('[data-selected-cell]')).toContainText(BIOMES[world.cells[id].biome as keyof typeof BIOMES].label);
  const selectedResource = world.cells[id].resource as keyof typeof RESOURCES | null;
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText(
    selectedResource === null ? 'No resource site' : RESOURCES[selectedResource].label,
  );
  const province = world.provinces.find((province: { id: string }) => province.id === world.cells[id].provinceId);
  await expect(page.locator('[data-selected-cell]')).toContainText(province?.name ?? 'Open water');
  await expect(page.locator('[data-selected-cell]')).toContainText(province ? 'Unclaimed' : 'No country');
  await page.screenshot({ path: testInfo.outputPath('biomes-inspected.png'), fullPage: true });
});

test('a cell without a resource site is described explicitly', async ({ page }) => {
  const centerCellId = 100 * 320 + 160;
  await page.route('**/api/atlas', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.world.cells[centerCellId].resource = null;
    await route.fulfill({ response, json: payload });
  });

  const canvas = await ready(page);
  const { world } = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 320, box.height / 200);
  await canvas.click({ position: {
    x: (box.width - 320 * scale) / 2 + 160.5 * scale,
    y: (box.height - 200 * scale) / 2 + 100.5 * scale,
  } });
  if (world.cells[centerCellId].provinceId !== null) {
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', world.cells[centerCellId].provinceId!);
    await clickAtlasCell(canvas, world, centerCellId);
  }
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(centerCellId));
  const resource = page.getByRole('region', { name: 'Selected cell resource' });
  await expect(resource).toContainText('No resource site');
  await expect(resource).toContainText('still has its biome');
});

test('province resources stay separate from cell details through filters, clearing, water and failed reset', async ({ page }) => {
  const canvas = await ready(page);
  const { world } = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
  const mixed = world.provinces.map(province => ({
    province,
    cells: world.cells.filter(cell => cell.provinceId === province.id),
  })).find(candidate => candidate.cells.some(cell => cell.resource === null)
    && candidate.cells.some(cell => cell.resource === 'stone')
    && candidate.cells.some(cell => cell.resource === 'game'))!;
  const emptyCell = mixed.cells.find(cell => cell.resource === null)!;
  const stoneCell = mixed.cells.find(cell => cell.resource === 'stone')!;
  const resourceCounts = Object.fromEntries(Object.keys(RESOURCES).map(resource => [
    resource,
    mixed.cells.filter(cell => cell.resource === resource).length,
  ])) as Record<keyof typeof RESOURCES, number>;

  await clickAtlasCell(canvas, world, emptyCell.id);
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', mixed.province.id);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toHaveCount(0);
  const provinceResources = page.getByRole('region', { name: 'Province resources' });
  await expect(provinceResources).toContainText(mixed.province.name);
  for (const resource of ['stone', 'game'] as const) {
    const item = provinceResources.locator('li').filter({ hasText: RESOURCES[resource].label });
    await expect(item.locator('.atlas-province-resource-count')).toHaveText(String(resourceCounts[resource]));
  }

  const before = await provinceResources.textContent();
  await page.getByLabel('Resource filter', { exact: true }).selectOption('stone');
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Provinces', exact: true }).check();
  await expect(provinceResources).toHaveText(before!);

  await clickAtlasCell(canvas, world, emptyCell.id);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText('No resource site in this cell');
  await expect(provinceResources).toHaveCount(0);
  await clickAtlasCell(canvas, world, stoneCell.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(stoneCell.id));
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toContainText('Stone');
  await page.getByRole('button', { name: 'Back to province', exact: true }).click();
  await expect(provinceResources).toHaveText(before!);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(provinceResources).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
  await clickAtlasCell(canvas, world, emptyCell.id);
  await expect(provinceResources).toBeVisible();
  const waterCell = world.cells.find(cell => cell.provinceId === null && cell.resource === null)!;
  await clickAtlasCell(canvas, world, waterCell.id);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(waterCell.id));
  await expect(provinceResources).toHaveCount(0);
  await clickAtlasCell(canvas, world, emptyCell.id);
  await expect(provinceResources).toBeVisible();
  const retainedProvince = await provinceResources.textContent();
  await page.route('**/api/atlas', route => route.fulfill({ json: { protocolVersion: 3, world: { cells: [] } } }));
  await page.getByRole('button', { name: 'Reset atlas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('atlas response');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', mixed.province.id);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await expect(provinceResources).toHaveText(retainedProvince!);
  await page.unroute('**/api/atlas');
  await page.getByRole('button', { name: 'Retry atlas', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('restored');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await expect(provinceResources).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
});

test('a valid province with no sites shows zero until reset restores host resources', async ({ page }) => {
  const original = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
  const province = original.world.provinces.find(candidate => {
    const cells = original.world.cells.filter(cell => cell.provinceId === candidate.id);
    return cells.some(cell => cell.resource === null) && cells.some(cell => cell.resource !== null);
  })!;
  const provinceCells = original.world.cells.filter(cell => cell.provinceId === province.id);
  const selectedCell = provinceCells.find(cell => cell.resource === null)!;
  const originalSiteCount = provinceCells.filter(cell => cell.resource !== null).length;

  await page.route('**/api/atlas', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    for (const cell of payload.world.cells) if (cell.provinceId === province.id) cell.resource = null;
    await route.fulfill({ response, json: payload });
  });
  const canvas = await ready(page);
  await clickAtlasCell(canvas, original.world, selectedCell.id);
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', province.id);
  await expect(page.getByRole('region', { name: 'Selected cell resource' })).toHaveCount(0);
  const provinceResources = page.getByRole('region', { name: 'Province resources' });
  await expect(provinceResources).toContainText(province.name);
  await expect(provinceResources).toContainText('No resource sites in this province');
  await expect(provinceResources.locator('.atlas-province-site-total')).toHaveText('0 sites');

  await page.unroute('**/api/atlas');
  await page.getByRole('button', { name: 'Reset atlas', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('restored');
  await clickAtlasCell(canvas, original.world, selectedCell.id);
  await expect(provinceResources.locator('.atlas-province-site-total')).toHaveText(`${originalSiteCount} sites`);
  await expect(provinceResources).not.toContainText('No resource sites in this province');
});

test('the hosted atlas shows every sparse site and its extraction requirement', async ({ page }) => {
  const canvas = await ready(page);
  const response = await page.request.get('/api/atlas');
  const payload = await response.json() as { protocolVersion: number; world: AtlasWorld };
  expect(payload.protocolVersion).toBe(3);
  const sites = payload.world.cells.filter(cell => cell.resource !== null);
  const ordinaryCells = payload.world.cells.filter(cell => cell.resource === null);
  expect(sites.length).toBeGreaterThanOrEqual(200);
  expect(sites.length).toBeLessThanOrEqual(500);
  expect(ordinaryCells.length).toBe(payload.world.cells.length - sites.length);
  expect(new Set(sites.map(cell => cell.resource))).toEqual(new Set(Object.keys(RESOURCES)));

  await expect(canvas).toHaveAttribute('data-resource-markers', String(sites.length));
  const allSitesImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const selectedSite = nearestToCenter(sites, payload.world);
  const ordinaryCell = nearestToCenter(
    ordinaryCells.filter(cell => hasNoNearbySite(cell, sites, payload.world, 4)),
    payload.world,
  );
  const selectedSiteCount = sites.filter(cell => cell.resource === selectedSite.resource).length;
  const legendItem = page.locator('.atlas-resource-legend li').filter({ hasText: RESOURCES[selectedSite.resource!].label });
  await expect(legendItem.locator('.atlas-resource-count')).toHaveText(selectedSiteCount.toLocaleString('en'));
  const siteWithResources = await atlasCellPatch(canvas, payload.world, selectedSite.id);
  const emptyWithResources = await atlasCellPatch(canvas, payload.world, ordinaryCell.id);
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  await expect(canvas).toHaveAttribute('data-resource-markers', '0');
  expect(await atlasCellPatch(canvas, payload.world, selectedSite.id)).not.toEqual(siteWithResources);
  expect(await atlasCellPatch(canvas, payload.world, ordinaryCell.id)).toEqual(emptyWithResources);
  await page.getByRole('checkbox', { name: 'Resources', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-resource-markers', String(sites.length));

  await page.getByLabel('Resource filter', { exact: true }).selectOption(selectedSite.resource!);
  await expect(canvas).toHaveAttribute('data-resource-markers', String(selectedSiteCount));
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(allSitesImage);

  await clickAtlasCell(canvas, payload.world, selectedSite.id);
  if (selectedSite.provinceId !== null) {
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', selectedSite.provinceId);
    await clickAtlasCell(canvas, payload.world, selectedSite.id);
  }
  const selected = page.locator('[data-selected-cell]');
  await expect(selected).toHaveAttribute('data-selected-cell', String(selectedSite.id));
  const resource = page.getByRole('region', { name: 'Selected cell resource' });
  await expect(resource).toContainText(RESOURCES[selectedSite.resource!].label);
  await expect(resource).toContainText('Required extraction technology');
  await expect(resource).toContainText(RESOURCE_RULES[selectedSite.resource!].extractionTechnology);

  await clickAtlasCell(canvas, payload.world, ordinaryCell.id);
  if (ordinaryCell.provinceId !== null && ordinaryCell.provinceId !== selectedSite.provinceId) {
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', ordinaryCell.provinceId);
    await clickAtlasCell(canvas, payload.world, ordinaryCell.id);
  }
  await expect(selected).toHaveAttribute('data-selected-cell', String(ordinaryCell.id));
  await expect(resource).toContainText('No resource site');

  await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
  await expect(canvas).toHaveAttribute('data-resource-markers', '0');
});

test('the visible edge of a resource marker selects its site only while that marker is shown', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const canvas = await ready(page);
    const response = await page.request.get('/api/atlas');
    const { world } = await response.json() as { world: AtlasWorld };
    const site = world.cells.find(cell => {
      const x = cell.id % world.width;
      return cell.provinceId === null && cell.resource !== null && x < world.width - 1
        && world.cells[cell.id + 1].resource === null && world.cells[cell.id + 1].provinceId === null;
    })!;
    const terrainCellId = site.id + 1;

    await clickAtlasMarkerEdge(canvas, world, site.id);
    const selected = page.locator('[data-selected-cell]');
    await expect(selected).toHaveAttribute('data-selected-cell', String(site.id));
    await clickAtlasMarkerEdge(canvas, world, site.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(site.id));
    await expect(page.locator('[data-selected-province]')).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
    await clickAtlasMarkerEdge(canvas, world, site.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(terrainCellId));

    await page.getByRole('checkbox', { name: 'Resources', exact: true }).check();
    const excludedResource = Object.keys(RESOURCES).find(resource => resource !== site.resource)!;
    await page.getByLabel('Resource filter', { exact: true }).selectOption(excludedResource);
    await clickAtlasMarkerEdge(canvas, world, site.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(terrainCellId));
    await page.getByLabel('Resource filter', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    const landSite = world.cells.find(cell => cell.provinceId !== null && cell.resource === 'stone'
      && cell.id % world.width < world.width - 1 && world.cells[cell.id + 1].resource === null
      && world.cells[cell.id + 1].provinceId === cell.provinceId)!;
    const unselectedSite = await atlasCellPatch(canvas, world, landSite.id);
    await clickAtlasMarkerEdge(canvas, world, landSite.id);
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', landSite.provinceId!);
    await expect(selected).toHaveCount(0);
    await clickAtlasMarkerEdge(canvas, world, landSite.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(landSite.id));
    expect(newHighlightPixels(unselectedSite, await atlasCellPatch(canvas, world, landSite.id)),
      'a selected stone site must gain a visible light outline above its resource glyph').toBeGreaterThan(0);
    await clickAtlasMarkerEdge(canvas, world, landSite.id);
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', landSite.provinceId!);
    await expect(selected).toHaveCount(0);
    await clickAtlasMarkerEdge(canvas, world, landSite.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(landSite.id));
    await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
    await clickAtlasMarkerEdge(canvas, world, landSite.id);
    await expect(selected).toHaveAttribute('data-selected-cell', String(landSite.id + 1));

  }
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
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
  await page.mouse.down();
  await canvas.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.up();
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-selected-cell]')).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reset atlas', exact: true });
  await reset.focus();
  for (let count = 1; count <= 3; count++) {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(`Original atlas restored · ${count}`);
    await expect(reset).toBeFocused();
    await expect(canvas).toHaveAttribute('data-zoom', '1.00');
    await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
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

test('resource filtering and province/grid layers change the map without changing cell data', async ({ page }, testInfo) => {
  const canvas = await ready(page);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByLabel('Resource filter', { exact: true }).selectOption('iron');
  const filtered = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(filtered).not.toBe(before);
  await page.getByRole('checkbox', { name: 'Provinces', exact: true }).check();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(filtered);
  await page.getByRole('checkbox', { name: 'Cell grid', exact: true }).check();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('biomes-detail.png'), fullPage: true });
});

test('failed atlas replacement preserves the map and retry restores the original study', async ({ page }) => {
  const canvas = await ready(page);
  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.route('**/api/atlas', route => route.fulfill({ json: { protocolVersion: 3, world: { cells: [] } } }));
  await page.getByRole('button', { name: 'Reset atlas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('atlas response');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);
  await page.unroute('**/api/atlas');
  await page.getByRole('button', { name: 'Retry atlas', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('restored');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);
});

test('the atlas fits mobile and keyboard controls remain usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = await ready(page);
  const { world } = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
  const centerId = Math.floor(world.height / 2) * world.width + Math.floor(world.width / 2);
  expect(world.cells[centerId].provinceId).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await canvas.focus();
  await page.keyboard.press('+');
  await expect(canvas).not.toHaveAttribute('data-zoom', '1.00');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', world.cells[centerId].provinceId!);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(centerId));
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', world.cells[centerId].provinceId!);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(centerId));
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(centerId - 1));
  await page.screenshot({ path: testInfo.outputPath('biomes-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', world.cells[centerId - 1].provinceId!);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(centerId - 1));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
});

test('high-density displays preserve tap tolerance in CSS pixels', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    deviceScaleFactor: 2,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const canvas = page.locator('#world-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await page.getByRole('checkbox', { name: 'Resources', exact: true }).uncheck();
    const { world } = await (await page.request.get('/api/atlas')).json() as { world: AtlasWorld };
    const box = (await canvas.boundingBox())!;
    const scale = Math.min(box.width / world.width, box.height / world.height);
    const startCell = world.cells.find(cell => cell.provinceId !== null && cell.id % world.width < world.width - 4
      && [1, 2, 3, 4].every(offset => world.cells[cell.id + offset].provinceId === cell.provinceId))!;
    const x = box.x + (box.width - world.width * scale) / 2 + (startCell.id % world.width + 0.5) * scale;
    const y = box.y + (box.height - world.height * scale) / 2 + (Math.floor(startCell.id / world.width) + 0.5) * scale;
    const targetId = startCell.id + Math.floor(0.5 + 3 / scale);
    expect(world.cells[targetId].provinceId).not.toBeNull();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y);
    await page.mouse.up();
    await expect(page.locator('[data-selected-province]')).toHaveAttribute('data-selected-province', world.cells[targetId].provinceId!);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y);
    await page.mouse.up();
    await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(targetId));
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y);
    await page.mouse.up();
    await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-selection-kind', 'none');
  } finally { await context.close(); }
});

function newHighlightPixels(before: number[], after: number[]) {
  let added = 0;
  for (let i = 0; i < after.length; i += 4) {
    const wasLight = before[i] > 220 && before[i + 1] > 200 && before[i + 2] > 140;
    const isLight = after[i] > 220 && after[i + 1] > 200 && after[i + 2] > 140;
    if (isLight && !wasLight) added++;
  }
  return added;
}

function nearestToCenter(cells: AtlasCell[], world: AtlasWorld) {
  const centerX = world.width / 2;
  const centerY = world.height / 2;
  return cells.reduce((nearest, cell) => {
    const x = cell.id % world.width;
    const y = Math.floor(cell.id / world.width);
    const nearestX = nearest.id % world.width;
    const nearestY = Math.floor(nearest.id / world.width);
    return Math.hypot(x - centerX, y - centerY) < Math.hypot(nearestX - centerX, nearestY - centerY) ? cell : nearest;
  });
}

function hasNoNearbySite(cell: AtlasCell, sites: AtlasCell[], world: AtlasWorld, radius: number) {
  const x = cell.id % world.width;
  const y = Math.floor(cell.id / world.width);
  return sites.every(site => Math.hypot(site.id % world.width - x, Math.floor(site.id / world.width) - y) > radius);
}

async function atlasCellPatch(canvas: import('@playwright/test').Locator, world: AtlasWorld, cellId: number) {
  return canvas.evaluate((element: HTMLCanvasElement, { world, cellId }) => {
    const scale = Math.min(element.width / world.width, element.height / world.height);
    const x = (element.width - world.width * scale) / 2 + (cellId % world.width + 0.5) * scale;
    const y = (element.height - world.height * scale) / 2 + (Math.floor(cellId / world.width) + 0.5) * scale;
    const radius = Math.ceil(scale * 2);
    return Array.from(element.getContext('2d')!.getImageData(
      Math.floor(x) - radius,
      Math.floor(y) - radius,
      radius * 2 + 1,
      radius * 2 + 1,
    ).data);
  }, { world: { width: world.width, height: world.height }, cellId });
}

async function clickAtlasCell(canvas: import('@playwright/test').Locator, world: AtlasWorld, cellId: number) {
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / world.width, box.height / world.height);
  const x = cellId % world.width;
  const y = Math.floor(cellId / world.width);
  await canvas.click({ position: {
    x: (box.width - world.width * scale) / 2 + (x + 0.5) * scale,
    y: (box.height - world.height * scale) / 2 + (y + 0.5) * scale,
  } });
}

async function clickAtlasMarkerEdge(canvas: import('@playwright/test').Locator, world: AtlasWorld, cellId: number) {
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / world.width, box.height / world.height);
  const x = cellId % world.width;
  const y = Math.floor(cellId / world.width);
  await canvas.click({ position: {
    x: (box.width - world.width * scale) / 2 + (x + 1.6) * scale,
    y: (box.height - world.height * scale) / 2 + (y + 0.5) * scale,
  } });
}
