import { expect, test, type Page } from '@playwright/test';

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
