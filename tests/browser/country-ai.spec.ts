import { expect, test, type Page } from '@playwright/test';
import type { SimulationOpen, SimulationView } from '../../shared/simulation.ts';

async function snapshot(page: Page, identity: SimulationOpen) {
  const response = await page.request.post('/api/simulation/observe', { data: { instanceId: identity.instanceId, observerId: identity.observerId } });
  expect(response.ok()).toBe(true);
  return (await response.json() as SimulationView).state;
}

test('a chosen history seed persists decisions through reload and reproduces them after reset', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByLabel('History seed', { exact: true }).fill('Browser history 01');
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  const identity = (await opening).postDataJSON() as SimulationOpen;
  expect(identity.placementSeed).toBe('Browser history 01');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  const decisions = page.getByRole('region', { name: 'Country decisions', exact: true });
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(decisions).toContainText('Browser history 01');
  const initial = await snapshot(page, identity);
  for (const [label, value] of [
    ['Reserve target', `${initial.ai!.profile.reserveDays} days`],
    ['Commitment duration', `${initial.ai!.profile.commitmentDays} days`],
    ['Expansion preference', `${initial.ai!.profile.expansion}/100`],
    ['Mobility preference', `${initial.ai!.profile.mobility}/100`],
  ]) await expect(decisions.getByText(label, { exact: true }).locator('..')).toContainText(value);
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  const advanced = await snapshot(page, identity);
  expect(advanced.ai!.decisions.length).toBeGreaterThan(0);
  const commitment = decisions.locator('[data-country-decision]').first();
  await expect(commitment).toContainText(advanced.ai!.decisions[0].reason);
  await expect(commitment).toContainText('Reserved locally');
  await expect(commitment).toContainText(`Since day ${advanced.ai!.decisions[0].sinceDay + 1}`);
  await expect(commitment).toContainText(`Review day ${advanced.ai!.decisions[0].reviewDay + 1}`);
  await commitment.getByText('Alternatives considered', { exact: true }).click();
  for (const alternative of advanced.ai!.decisions[0].alternatives) {
    await expect(commitment).toContainText(alternative.reason);
  }
  await decisions.getByText('Recent country decisions', { exact: true }).click();
  await expect(decisions.locator('.country-history')).toContainText(advanced.ai!.history.at(-1)!.reason);
  await page.screenshot({ path: testInfo.outputPath('country-decisions.png'), fullPage: true });
  await decisions.screenshot({ path: testInfo.outputPath('country-decisions-panel.png') });
  await page.reload();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  expect((await snapshot(page, identity)).ai).toEqual(advanced.ai);
  await expect(decisions).toContainText(advanced.ai!.decisions[0].reason);
  await page.setViewportSize({ width: 390, height: 844 });
  await commitment.getByText('Alternatives considered', { exact: true }).click();
  await decisions.getByText('Recent country decisions', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('country-decisions-mobile.png'), fullPage: true });
  await decisions.screenshot({ path: testInfo.outputPath('country-decisions-panel-mobile.png') });
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  expect((await snapshot(page, identity)).ai).toEqual(initial.ai);
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  expect((await snapshot(page, identity)).ai).toEqual(advanced.ai);
});

test('manual spawn keeps the chosen history seed and clicked site when opening must be retried', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:standard:Chronicle');
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByLabel('History seed', { exact: true }).fill('Manual history 01');
  await page.getByRole('button', { name: 'Choose on map', exact: true }).click();
  const opens: SimulationOpen[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/simulation/open')) opens.push(request.postDataJSON()); });
  await page.route('**/api/simulation/open', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement) => {
    const id = 46821, box = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    const dx = ((id % 512 + .5 - Number(element.dataset.centerX) + 768) % 512) - 256;
    return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + (Math.floor(id / 512) + .5 - Number(element.dataset.centerY)) * scale };
  });
  await page.mouse.click(point.x, point.y);
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await expect(panel.getByRole('alert')).toBeVisible();
  expect(opens).toHaveLength(1);
  expect(opens[0]).toMatchObject({ placementSeed: 'Manual history 01', originCellId: 46821 });
  await page.unroute('**/api/simulation/open');
  await page.getByRole('button', { name: 'Retry simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  expect(opens).toHaveLength(2);
  expect(opens[1]).toEqual(opens[0]);
  const state = await snapshot(page, opens[1]);
  expect(state.ai!.historySeed).toBe('Manual history 01');
  expect(state.tribe.originCellId).toBe(46821);
});
