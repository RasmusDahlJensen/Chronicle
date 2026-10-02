import { expect, test, type Page } from '@playwright/test';
import { ERA_NAMES } from '../../shared/simulation.ts';

// One shared simulation per host and world: these scenarios change its clock, so they run in order.
test.describe.configure({ mode: 'serial' });

const history = (page: Page) => page.getByRole('region', { name: 'History' });
async function tick(page: Page) { return Number(await history(page).getAttribute('data-tick')); }
// A world of its own, so scenarios on other worlds never touch this clock.
const SEED = 'History lab', SIZE = 'standard', WIDTH = 512;
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(history(page)).toHaveAttribute('data-tick', /\d+/);
  // Choosing another seed starts that world's history at year 0.
  await page.locator('#world-seed').fill(SEED);
  await page.locator('#world-size').selectOption(SIZE);
  await page.getByRole('button', { name: /Regenerate world/ }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-world-key', `climate-6:${SIZE}:${SEED}`);
  await expect(history(page)).toHaveAttribute('data-tick', '0');
}

/** Click a world cell on the map at its current camera. */
async function clickCell(page: Page, cell: { x: number; y: number }) {
  const canvas = page.locator('#generated-world-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
      y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
  }, cell);
  await page.mouse.click(point.x, point.y);
}

test('time controls: reset shows year 0, step advances exactly one month, play advances until pause', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · January');
  await history(page).getByRole('button', { name: 'Step month' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '1');
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · February');
  await history(page).getByLabel('Speed').selectOption('year');
  await history(page).getByRole('button', { name: 'Play' }).click();
  await expect(history(page)).toHaveAttribute('data-playing', 'true');
  await expect.poll(() => tick(page), { timeout: 10_000 }).toBeGreaterThan(6);
  await history(page).getByRole('button', { name: 'Pause' }).click();
  await expect(history(page)).toHaveAttribute('data-playing', 'false');
  const paused = await tick(page);
  await page.waitForTimeout(1_200);
  expect(await tick(page)).toBe(paused);
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · January');
});

test('a faster speed preset advances the date faster, and run to year stops at that year', async ({ page }) => {
  await ready(page);
  async function advance(speed: string) {
    await history(page).getByLabel('Speed').selectOption(speed);
    const before = await tick(page);
    await history(page).getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2_000);
    await history(page).getByRole('button', { name: 'Pause' }).click();
    await expect(history(page)).toHaveAttribute('data-playing', 'false');
    return await tick(page) - before;
  }
  const monthly = await advance('month');
  const decade = await advance('decade');
  expect(monthly).toBeGreaterThanOrEqual(1);
  expect(monthly).toBeLessThanOrEqual(4);
  expect(decade).toBeGreaterThan(monthly * 5);
  await history(page).getByLabel('Run to year').fill('300');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(300 * 12), { timeout: 30_000 });
  await expect(history(page)).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('#simulation-date')).toHaveText('Year 300 · January');
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
});

test('the region overlay draws region borders and the inspector names the selected cell\'s region', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await page.getByLabel('Regions', { exact: true }).check();
  await expect(canvas).toHaveAttribute('data-region-borders', /^[1-9]\d*$/);
  const regions = await (await page.request.get(`/api/simulation/regions?seed=${encodeURIComponent(SEED)}&size=${SIZE}`)).json();
  // A mid-latitude region keeps the click inside the visible map once the canvas is scrolled into view.
  const region = regions.regions.find((entry: { island: boolean; cells: number; centroid: number }) => !entry.island
    && Math.abs(Math.floor(entry.centroid / WIDTH) - regions.height / 2) < regions.height / 6);
  const cell = { x: region.centroid % WIDTH, y: Math.floor(region.centroid / WIDTH) };
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
      y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
  }, cell);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(region.centroid));
  await expect(page.getByRole('region', { name: 'Selected cell region' })).toContainText(`Region ${region.id}`);
  await page.getByLabel('Regions', { exact: true }).uncheck();
  await expect(canvas).toHaveAttribute('data-region-borders', '0');
});

test('bands appear as markers and territories, the world chart grows and a band region shows its people, births, deaths and food', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-band-markers', '30');
  await history(page).getByLabel('Run to year').fill('200');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(200 * 12), { timeout: 60_000 });
  await expect(page.getByRole('figure', { name: 'World population chart' })).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-band-markers'))).toBeGreaterThan(30);
  const query = `seed=${encodeURIComponent(SEED)}&size=${SIZE}`;
  const frame = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  const regions = await (await page.request.get(`/api/simulation/regions?${query}`)).json();
  // The most populous band away from the poles, so its centre cell is on screen at fit.
  const candidates = frame.markers.regions.map((region: number, index: number) => ({ region, id: frame.markers.ids[index], population: frame.markers.populations[index], centroid: regions.regions[region].centroid }))
    .filter((band: { centroid: number }) => Math.abs(Math.floor(band.centroid / WIDTH) - regions.height / 2) < regions.height / 4)
    .sort((a: { population: number }, b: { population: number }) => b.population - a.population);
  const band = candidates[0];
  const cell = { x: band.centroid % WIDTH, y: Math.floor(band.centroid / WIDTH) };
  await clickCell(page, cell);
  const details = page.getByRole('group', { name: 'Tribe in this region' });
  await expect(details).toBeVisible();
  await expect(page.locator('#band-population')).toHaveText(band.population.toLocaleString('en'));
  // A tribe roams several regions, one band in each: the inspector shows the whole tribe and its band here.
  const held = frame.markers.ids.map((id: number, index: number) => id === band.id ? frame.markers.populations[index] : 0).filter((people: number) => people > 0);
  await expect(page.locator('#polity-regions')).toHaveText(held.length.toLocaleString('en'));
  await expect(page.locator('#polity-total')).toHaveText(held.reduce((sum: number, people: number) => sum + people, 0).toLocaleString('en'));
  await expect(details).toContainText('Births this year');
  await expect(details).toContainText('Food security');
  await expect(page.locator('#region-capacity')).toContainText('people');
  // Peoples' territories: every living polity's region is filled — by default by polity, with a legend of the largest
  // tribes and civilizations; by descent with a legend of the largest peoples; by era with an era legend; or hidden.
  await expect(canvas).toHaveAttribute('data-territory-regions', String(frame.markers.ids.length));
  await expect(page.getByLabel('By polity')).toBeChecked();
  const legend = page.getByRole('region', { name: 'Peoples legend' });
  await expect(legend).toContainText('Largest polities');
  const largest = frame.largest[0];
  expect(largest.regions).toBeGreaterThan(1);
  await expect(legend.getByRole('listitem').first()).toContainText(`${largest.name} tribe`);
  await expect(legend.getByRole('listitem').first()).toContainText(`${largest.regions.toLocaleString('en')} · `);
  await expect(page.locator('#world-population')).toContainText(/[\d,]+ tribes \([\d,]+ bands\)/);
  await page.getByLabel('By descent').check();
  await expect(legend).toContainText('regions · people');
  await expect(page.locator('#polity-lineage')).toContainText('Descended from the');
  await page.getByLabel('By era').check();
  await expect(legend.getByRole('listitem').filter({ hasText: ERA_NAMES[frame.leadingEra] })).toContainText(/[1-9][\d,]*$/);
  await page.getByLabel('Hidden').check();
  await expect(canvas).toHaveAttribute('data-territory-regions', '0');
  await expect(page.getByRole('region', { name: 'Peoples legend' })).toHaveCount(0);
  await page.getByLabel('By polity').check();
  await expect(history(page).getByRole('list', { name: 'Chronicle events' })).toContainText(/band of [\d,]+ people/);
  await expect(history(page).getByRole('list', { name: 'Chronicle events' })).toContainText(/stays with its tribe, now [\d,]+ bands/);
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
});

test('farming bands settle into civilizations with villages, specialists and research the inspector explains', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await history(page).getByLabel('Run to year').fill('650');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(650 * 12), { timeout: 120_000 });
  await expect(page.locator('#world-population')).toContainText(/[1-9][\d,]* civilizations/);
  await expect.poll(async () => Number(await canvas.getAttribute('data-settlement-marks'))).toBeGreaterThan(0);
  const query = `seed=${encodeURIComponent(SEED)}&size=${SIZE}`;
  const frame = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  const regions = await (await page.request.get(`/api/simulation/regions?${query}`)).json();
  expect(frame.civs).toBeGreaterThan(0);
  expect(frame.leadingEra).toBeGreaterThanOrEqual(1);
  // The most populous civilization away from the poles.
  const civ = frame.markers.regions.map((region: number, index: number) => ({ region, kind: frame.markers.kinds[index], population: frame.markers.populations[index], centroid: regions.regions[region].centroid }))
    .filter((entry: { kind: number; centroid: number }) => entry.kind === 1 && Math.abs(Math.floor(entry.centroid / WIDTH) - regions.height / 2) < regions.height / 4)
    .sort((a: { population: number }, b: { population: number }) => b.population - a.population)[0];
  await clickCell(page, { x: civ.centroid % WIDTH, y: Math.floor(civ.centroid / WIDTH) });
  const details = page.getByRole('group', { name: 'Civilization in this region' });
  await expect(details).toBeVisible();
  await expect(details).toContainText(/Neolithic era|Bronze era/);
  await expect(page.locator('#polity-capital')).not.toBeEmpty();
  await expect(page.locator('#polity-specialists')).toHaveText(/^[\d,]+$/);
  await expect(page.locator('#polity-known')).toContainText('Agriculture');
  await expect(details.getByRole('region', { name: 'Knowledge' })).toContainText('points a year');
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
});
