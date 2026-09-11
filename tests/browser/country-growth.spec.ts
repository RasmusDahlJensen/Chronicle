import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { advanceTribeDays } from '../../src/simulation/tribe.ts';
import { parseSimulationState, type SimulationOpen, type SimulationState, type SimulationView } from '../../shared/simulation.ts';

const lab = (page: Page) => page.getByRole('region', { name: 'Tribe lab', exact: true });
const growth = (page: Page) => page.getByRole('region', { name: 'Country growth', exact: true });
const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
async function snapshot(page: Page, identity: SimulationOpen) {
  const response = await page.request.post('/api/simulation/observe', { data: { instanceId: identity.instanceId, observerId: identity.observerId } });
  expect(response.ok()).toBe(true);
  return (await response.json() as SimulationView).state;
}
async function inspectLedger(page: Page, state: SimulationState) {
  const country = state.country!, society = state.settlements!, capital = society.centers[0];
  expect(state.protocolVersion).toBe(5);
  expect(society.centers).toHaveLength(1);
  expect(state.tribe.population).toBe(250 + country.births - country.naturalDeaths - country.starvationDeaths);
  expect(capital.population).toBe(state.tribe.population);
  expect(society.totalConsumed + society.totalShortfall).toBe(country.personDays);
  expect(capital.food).toBe(7500 + society.totalCollected - society.totalConsumed - society.establishmentSpent - country.upkeepPaid - country.spoilage);
  expect(capital.territory).toEqual([country.territory.capitalCellId]);
  expect(capital.workingCells.every(id => country.territory.cells.includes(id))).toBe(true);
  await expect(lab(page).locator('[data-tribe-population]')).toHaveText(String(capital.population));
  await expect(growth(page).locator('[data-country-claims]')).toHaveText(`${country.territory.cells.length} cells`);
  await expect(growth(page).locator('[data-working-cells]')).toHaveText(`${capital.workingCells.length} cells`);
  await expect(growth(page).locator('[data-food-reserves]')).toHaveText(format(capital.food));
  for (const [attribute, value] of [['births', country.births], ['natural-deaths', country.naturalDeaths], ['starvation-deaths', country.starvationDeaths], ['upkeep-paid', country.upkeepPaid], ['spoilage', country.spoilage]] as const) {
    await expect(growth(page).locator(`[data-total-${attribute}]`)).toHaveText(format(value));
  }
  const workforce = growth(page).locator('[data-country-workforce]');
  for (const [label, value] of [['Available workforce', country.metrics.workforce], ['Support required', country.metrics.supportRequired], ['Support assigned', country.metrics.supportWorkers], ['Claim crew', country.metrics.claimWorkers], ['Gatherers', country.metrics.gatheringWorkers], ['Idle workers', country.metrics.idleWorkers]] as const) {
    await expect(workforce.getByText(label, { exact: true }).locator('..').locator('dd')).toHaveText(String(value));
  }
  expect(country.metrics.workforce).toBe(country.metrics.supportWorkers + country.metrics.claimWorkers + country.metrics.gatheringWorkers + country.metrics.idleWorkers);
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-territory-cells', String(country.territory.cells.length));
  await expect(canvas).toHaveAttribute('data-settlement-count', capital.population > 0 ? '1' : '0');
}

test('New game exposes one capital, separate national claims and conserved population and food through the monthly clock', async ({ page }, testInfo) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  let identity = (await opening).postDataJSON() as SimulationOpen;
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '0');
  await expect(growth(page)).toBeVisible();
  const initial = await snapshot(page, identity);
  await growth(page).getByText('Accounting since founding', { exact: true }).click();
  await inspectLedger(page, initial);
  expect(initial.country!.territory.cells.length).toBeGreaterThan(1);
  await expect(lab(page)).toContainText('Capital camp');
  await expect(lab(page)).not.toContainText('births and deaths come later');
  await page.getByRole('button', { name: 'Locate civilization', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected settlement', exact: true })).toContainText('Capital camp');
  await expect(canvas).toHaveAttribute('data-working-area-visible', 'true');
  const capitalId = initial.country!.territory.capitalCellId;
  const claimedCell = initial.country!.territory.cells.find(id => id !== capitalId)!;
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, { id, width }) => {
    const box = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % width + .5 - Number(element.dataset.centerX) + width * 1.5) % width) - width / 2;
    return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + (Math.floor(id / width) + .5 - Number(element.dataset.centerY)) * scale };
  }, { id: claimedCell, width: initial.settings.size === 'large' ? 1024 : 512 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('region', { name: 'Selected country claim', exact: true })).toContainText(initial.tribe.name);
  await expect(canvas).toHaveAttribute('data-working-area-visible', 'false');
  await page.getByRole('button', { name: 'Inspect capital', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-working-area-visible', 'true');
  await page.screenshot({ path: testInfo.outputPath('country-growth-founding.png'), fullPage: true });
  for (let month = 1; month <= 12; month++) {
    await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
    await expect(lab(page)).toHaveAttribute('data-elapsed-days', String(month * 30));
  }
  const advanced = await snapshot(page, identity);
  await inspectLedger(page, advanced);
  expect(advanced.country!.territory.capitalCellId).toBe(capitalId);
  expect(advanced.country!.births + advanced.country!.naturalDeaths + advanced.country!.starvationDeaths).toBeGreaterThan(0);
  const decisions = page.getByRole('region', { name: 'Country decisions', exact: true });
  // A claim can finish on the observed day and leave no active commitment.
  await expect(growth(page)).toContainText(advanced.settlements!.centers[0].decision);
  await expect(decisions.locator('[data-country-decision]')).toHaveCount(advanced.ai!.decisions.length);
  for (const decision of advanced.ai!.decisions) await expect(decisions).toContainText(decision.reason);
  await expect(decisions).not.toContainText('Extend local presence');
  await growth(page).screenshot({ path: testInfo.outputPath('country-growth-year-two.png') });
  await page.screenshot({ path: testInfo.outputPath('country-growth-map-year-two.png'), fullPage: true });
  const reopening = page.waitForRequest('**/api/simulation/open');
  await page.reload();
  identity = (await reopening).postDataJSON() as SimulationOpen;
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '360');
  const restored = await snapshot(page, identity);
  expect(restored.country).toEqual(advanced.country);
  expect(restored.settlements).toEqual(advanced.settlements);
  await growth(page).getByText('Accounting since founding', { exact: true }).click();
  await inspectLedger(page, restored);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(growth(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await growth(page).screenshot({ path: testInfo.outputPath('country-growth-mobile.png') });
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '0');
  const reset = await snapshot(page, identity);
  expect(reset.country).toEqual(initial.country);
  expect(reset.settlements).toEqual(initial.settlements);
  await inspectLedger(page, reset);
});


test('an archived collapsed country has no active marker, territory or working area and remains collapsed after a month', async ({ page }, testInfo) => {
  // Produce a saved collapse through the real core with a clearly synthetic
  // zero-food environment. The browser still reads the host checkpoint against
  // its accepted geography; this fixture tests presentation, not climate change.
  let collapsed: SimulationState | undefined;
  await page.route('**/api/simulation/open', async route => {
    const input = route.request().postDataJSON() as SimulationOpen;
    const temporary = { ...input, instanceId: randomUUID(), observerId: randomUUID() };
    const prepared = await page.request.post('/api/simulation/open', { data: temporary });
    expect(prepared.ok()).toBe(true);
    const { state } = await prepared.json() as SimulationView;
    await page.request.post('/api/simulation/release', { data: { instanceId: temporary.instanceId, observerId: temporary.observerId } });
    const database = new DatabaseSync(join('test-results', 'saves', testInfo.project.name, 'simulation.sqlite'), { timeout: 1000 });
    try {
      const row = database.prepare('SELECT body FROM environments WHERE world_key = ?').get(state.worldKey)!;
      const environment = JSON.parse(row.body as string) as SettlementEnvironment;
      environment.biome.fill(WORLD_BIOMES.indexOf('snow')); environment.fertility.fill(0); environment.resource.fill(0);
      collapsed = { ...state, id: input.instanceId };
      for (let day = 0; day < 3600 && collapsed.tribe.population > 0; day += 30) collapsed = advanceTribeDays(collapsed, 30, environment);
      expect(collapsed.tribe.population).toBe(0);
      parseSimulationState(collapsed);
      database.prepare('INSERT INTO checkpoints (id, current, previous) VALUES (?, ?, NULL)').run(collapsed.id, JSON.stringify(collapsed));
    } finally { database.close(); }
    await route.continue();
  }, { times: 1 });
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  const identity = (await opening).postDataJSON() as SimulationOpen;
  await expect(growth(page).locator('[data-country-collapsed]')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-civilization-id', '');
  await expect(canvas).toHaveAttribute('data-territory-cells', '0');
  await expect(canvas).toHaveAttribute('data-settlement-count', '0');
  await expect(canvas).toHaveAttribute('data-working-area-visible', 'false');
  await expect(page.getByRole('button', { name: 'Locate civilization', exact: true })).toBeDisabled();
  await expect(growth(page)).toContainText('No population');
  await expect(growth(page)).toContainText('Former capital camp');
  // Inspecting the former capital must not recreate the retired identity card.
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, id) => {
    const box = element.getBoundingClientRect(), scale = Number(element.dataset.scale), width = 1024;
    const dx = ((id % width + .5 - Number(element.dataset.centerX) + width * 1.5) % width) - width / 2;
    return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + (Math.floor(id / width) + .5 - Number(element.dataset.centerY)) * scale };
  }, collapsed!.tribe.originCellId);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(collapsed!.tribe.originCellId));
  await expect(page.getByRole('region', { name: 'Selected settlement', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-selected-civilization]')).toHaveCount(0);
  await growth(page).getByText('Accounting since founding', { exact: true }).click();
  await inspectLedger(page, await snapshot(page, identity));
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', String(collapsed!.elapsedDays + 30));
  const advanced = await snapshot(page, identity);
  expect(advanced.country!.births).toBe(collapsed!.country!.births);
  expect(advanced.country!.personDays).toBe(collapsed!.country!.personDays);
  expect(advanced.settlements!.totalCollected).toBe(collapsed!.settlements!.totalCollected);
  await inspectLedger(page, advanced);
  await growth(page).screenshot({ path: testInfo.outputPath('country-growth-collapse.png') });
});
