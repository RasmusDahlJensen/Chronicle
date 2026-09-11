import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { parseSimulationState, type SimulationOpen, type SimulationView } from '../../shared/simulation.ts';


async function installLegacySettlement(page: Page, project: string) {
  // Install an explicit protocol-3 checkpoint before this instance is opened.
  // The real host prepares geography and initial accounting; all subsequent
  // browser commands and persistence use the unmodified legacy simulation.
  await page.route('**/api/simulation/open', async route => {
    const input = route.request().postDataJSON() as SimulationOpen;
    const temporary = { ...input, instanceId: randomUUID(), observerId: randomUUID() };
    const prepared = await page.request.post('/api/simulation/open', { data: temporary });
    expect(prepared.ok()).toBe(true);
    const { state } = await prepared.json() as SimulationView;
    const { ai: _ai, country: _country, development: _development, ...initial } = state;
    const legacy = parseSimulationState({ ...initial, id: input.instanceId, protocolVersion: 3, rulesVersion: 2 });
    const released = await page.request.post('/api/simulation/release', { data: { instanceId: temporary.instanceId, observerId: temporary.observerId } });
    expect(released.ok()).toBe(true);
    const database = new DatabaseSync(join('test-results', 'saves', project, 'simulation.sqlite'), { timeout: 1000 });
    try { database.prepare('INSERT INTO checkpoints (id, current, previous) VALUES (?, ?, NULL)').run(legacy.id, JSON.stringify(legacy)); }
    finally { database.close(); }
    await route.continue();
  }, { times: 1 });
}

test('an explicit legacy tribe exposes its food economy, maintained territory and selected working area', async ({ page }, testInfo) => {
  await installLegacySettlement(page, testInfo.project.name);
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  const identity = (await opening).postDataJSON() as SimulationOpen;
  expect(identity.placementSeed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel.getByRole('region', { name: 'Settlements and subsistence' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-territory-cells', '1');
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel.locator('[data-total-collected]')).not.toHaveText('0');
  await expect(panel.locator('[data-total-consumed]')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Locate civilization', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected settlement', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-working-area-visible', 'true');
  const territory = await canvas.getAttribute('data-territory-cells');
  const food = await panel.locator('[data-food-reserves]').textContent();
  await page.screenshot({ path: testInfo.outputPath('settlement-territory.png'), fullPage: true });
  await page.reload();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(canvas).toHaveAttribute('data-territory-cells', territory!);
  await expect(panel.locator('[data-food-reserves]')).toHaveText(food!);
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await expect(canvas).toHaveAttribute('data-territory-visible', 'false');
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  const resetResponse = await page.request.post('/api/simulation/observe', { data: { instanceId: identity.instanceId, observerId: identity.observerId } });
  expect(resetResponse.ok()).toBe(true);
  const reset = (await resetResponse.json() as SimulationView).state;
  expect(reset.protocolVersion).toBe(6);
  expect(reset.country!.personDays).toBe(0);
  expect(reset.tribe.population).toBe(250);
  await expect(canvas).toHaveAttribute('data-territory-cells', String(reset.country!.territory.cells.length));
});

test('legacy prosperity supports a second community without duplicating people and both centers remain inspectable', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:standard:Chronicle');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await installLegacySettlement(page, testInfo.project.name);
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const foundingPoint = await canvas.evaluate((element: HTMLCanvasElement) => {
    const id = 46821, box = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % 512 + .5 - Number(element.dataset.centerX) + 768) % 512) - 256;
    return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + (Math.floor(id / 512) + .5 - Number(element.dataset.centerY)) * scale };
  });
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.mouse.click(foundingPoint.x, foundingPoint.y);
  const { instanceId, observerId } = (await opening).postDataJSON() as SimulationOpen;
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  for (let days = 30; days <= 150; days += 30) {
    await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
    await expect(panel).toHaveAttribute('data-elapsed-days', String(days));
  }
  await expect(panel.locator('[data-center-count]')).toHaveText('2');
  await expect(panel.locator('[data-tribe-population]')).toHaveText('250');
  const centers = panel.locator('[data-settlement-id]');
  await expect(centers.nth(0)).toContainText('170 people');
  await expect(centers.nth(1)).toContainText('80 people');
  await centers.nth(1).getByRole('button').click();
  const selected = page.getByRole('region', { name: 'Selected settlement', exact: true });
  await expect(selected).toHaveAttribute('data-selected-settlement', 'settlement-2');
  await expect(selected).toContainText('80');
  await expect(canvas).toHaveAttribute('data-settlement-count', '2');
  await page.screenshot({ path: testInfo.outputPath('two-communities.png'), fullPage: true });
  // At overview glyphs overlap. Clicking the later-painted secondary glyph must
  // select that exact center rather than the main center underneath it.
  const selectedCell = Number(await page.locator('.world-selected-cell').getAttribute('data-selected-cell'));
  await page.getByRole('button', { name: 'Fit map', exact: true }).click();
  const point = await canvas.evaluate((element: HTMLCanvasElement, id) => {
    const box = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % 512 + .5 - Number(element.dataset.centerX) + 768) % 512) - 256;
    return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + (Math.floor(id / 512) + .5 - Number(element.dataset.centerY)) * scale };
  }, selectedCell);
  await page.mouse.click(point.x, point.y);
  await expect(selected).toHaveAttribute('data-selected-settlement', 'settlement-2');
  await expect(page.locator('.world-selected-cell')).toHaveAttribute('data-selected-cell', String(selectedCell));
  await page.reload();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:large:Chronicle');
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(panel.locator('[data-center-count]')).toHaveText('2');
  await expect(panel).toHaveAttribute('data-elapsed-days', '150');
  await page.setViewportSize({ width: 390, height: 844 });
  await centers.nth(1).getByRole('button').click();
  await expect(selected).toHaveAttribute('data-selected-settlement', 'settlement-2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('two-communities-mobile.png'), fullPage: true });
  // One page-level clock advances both communities and their common food ledger.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await panel.getAttribute('data-elapsed-days'))).toBeGreaterThanOrEqual(180);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 1 month', exact: true })).toBeEnabled();
  const response = await page.request.post('/api/simulation/observe', { data: { instanceId, observerId } });
  expect(response.ok()).toBe(true);
  const { state } = await response.json() as SimulationView;
  expect(state.elapsedDays % 30).toBe(0);
  expect(state.protocolVersion).toBe(3);
  expect(state.ai).toBeUndefined();
  // This known productive site establishes a third center on day 174.
  expect(state.settlements!.centers.map(center => center.id)).toEqual(['settlement-1', 'settlement-2', 'settlement-3']);
  expect(state.settlements!.centers.reduce((total, center) => total + center.population, 0)).toBe(250);
  for (const center of state.settlements!.centers) {
    expect(center.consumed + center.shortfall).toBe(center.population);
    expect(center.workingCells.length).toBeGreaterThan(0);
  }
  expect(state.settlements!.totalConsumed + state.settlements!.totalShortfall).toBe(state.elapsedDays * 250);
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Reset simulation confirmation' })).toContainText('enables productive investment and country growth');
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(page.getByRole('region', { name: 'Country decisions', exact: true })).toBeVisible();
  const resetResponse = await page.request.post('/api/simulation/observe', { data: { instanceId, observerId } });
  expect(resetResponse.ok()).toBe(true);
  const reset = (await resetResponse.json() as SimulationView).state;
  expect(reset.protocolVersion).toBe(6);
  expect(reset.country!.territory.capitalCellId).toBe(46821);
  expect(reset.country!.personDays).toBe(0);
  expect(reset.ai!.historySeed).toBe(state.placementSeed);
  expect(reset.tribe.originCellId).toBe(46821);
});
