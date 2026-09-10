import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SimulationCommand, SimulationOpen } from '../../shared/simulation.ts';

async function openLab(page: Page) {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel;
}
async function begin(panel: Locator, placement = 'Tribes 1') {
  await panel.getByLabel('Placement seed', { exact: true }).fill(placement);
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel).toContainText('Day 1, Year 1');
}

test('Begin saves its identity before opening and refresh restores the same tribe and completed day', async ({ page }, testInfo) => {
  const opens: SimulationOpen[] = [];
  await page.route('**/api/simulation/open', async route => {
    const body = route.request().postDataJSON() as SimulationOpen;
    expect(await page.evaluate(id => Object.values(localStorage).includes(id), body.instanceId), 'Remember the instance before the host can create it').toBe(true);
    opens.push(body); await route.continue();
  });
  const panel = await openLab(page);
  expect(opens).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toBeVisible();
  await begin(panel, 'Coastal beginning');
  const instance = await panel.getAttribute('data-instance-id');
  const name = await panel.locator('[data-tribe-name]').textContent();
  await expect(panel.locator('[data-tribe-population]')).toHaveText('250');
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel).toContainText('Day 31, Year 1');
  await panel.getByRole('button', { name: 'Locate tribe', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toContainText(name!);
  await page.screenshot({ path: testInfo.outputPath('tribe-day-31.png'), fullPage: true });
  await page.reload();
  await expect(panel).toHaveAttribute('data-instance-id', instance!);
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel.locator('[data-tribe-name]')).toHaveText(name!);
  await expect(panel.getByRole('button', { name: 'Play tribe', exact: true })).toBeEnabled();
  expect(new Set(opens.map(value => value.instanceId))).toEqual(new Set([instance]));
  expect(opens.every(value => value.placementSeed === 'Coastal beginning')).toBe(true);
});

test('play, speed, manual pause and confirmed reset keep the tribe population accounted for', async ({ page }, testInfo) => {
  const panel = await openLab(page); await begin(panel);
  await panel.getByLabel('Simulation speed', { exact: true }).selectOption('10');
  await panel.getByRole('button', { name: 'Play tribe', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Step 1 day', exact: true })).toBeDisabled();
  await expect.poll(async () => Number(await panel.getAttribute('data-elapsed-days'))).toBeGreaterThan(0);
  await panel.getByRole('button', { name: 'Pause tribe', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Step 1 day', exact: true })).toBeEnabled();
  const pausedDays = await panel.getAttribute('data-elapsed-days');
  await page.reload();
  await expect(panel).toHaveAttribute('data-elapsed-days', pausedDays!);
  await expect(panel.getByRole('button', { name: 'Play tribe', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Step 1 day', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', String(Number(pausedDays) + 1));
  const oldIncarnation = Number(await panel.getAttribute('data-incarnation'));
  await panel.getByRole('button', { name: 'Reset tribe', exact: true }).click();
  await expect(panel).toContainText('Saved progress');
  await panel.getByRole('button', { name: 'Cancel reset', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', String(Number(pausedDays) + 1));
  await panel.getByRole('button', { name: 'Reset tribe', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm reset tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel).toHaveAttribute('data-incarnation', String(oldIncarnation + 1));
  await expect(panel.getByRole('button', { name: 'Play tribe', exact: true })).toBeEnabled();
  await expect(panel.locator('[data-tribe-population]')).toHaveText('250');
  await page.screenshot({ path: testInfo.outputPath('tribe-reset.png'), fullPage: true });
});

test('an unconfirmed command preserves the map and retry reads its saved result without repeating it', async ({ page }) => {
  const panel = await openLab(page); await begin(panel);
  const instance = await panel.getAttribute('data-instance-id');
  let commands = 0;
  await page.route('**/api/simulation/command', async route => {
    commands++; const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-layer', 'temperature');
  await page.unroute('**/api/simulation/command');
  await panel.getByRole('button', { name: 'Retry tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-instance-id', instance!);
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  expect(commands).toBe(1);
});

test('a revision conflict refreshes the changed state and never repeats a step automatically', async ({ page }) => {
  const panel = await openLab(page); await begin(panel);
  let commands = 0;
  await page.route('**/api/simulation/command', async route => {
    commands++;
    const command = route.request().postDataJSON() as SimulationCommand;
    const external = await page.request.post('/api/simulation/command', { data: { ...command, days: 30 } });
    expect(external.ok()).toBe(true);
    await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'The state changed.', requestId: 'tribe-conflict' } } });
  });
  await panel.getByRole('button', { name: 'Step 1 day', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel).toContainText('changed');
  expect(commands).toBe(1);
  await page.unroute('**/api/simulation/command');
  await panel.getByRole('button', { name: 'Step 1 day', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '31');
});

test('a failed initial open retains its remembered instance and does not silently create another', async ({ page }) => {
  const opens: SimulationOpen[] = [];
  await page.route('**/api/simulation/open', async route => {
    opens.push(route.request().postDataJSON() as SimulationOpen);
    await route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Host unavailable.', requestId: 'tribe-open' } } });
  });
  const panel = await openLab(page);
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  const instance = opens[0].instanceId;
  await page.reload();
  await expect(panel.getByRole('alert')).toBeVisible();
  expect(opens.every(value => value.instanceId === instance)).toBe(true);
  await page.unroute('**/api/simulation/open');
  await panel.getByRole('button', { name: 'Retry tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-instance-id', instance);
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
});

test('a delayed poll cannot roll back a completed command', async ({ page }) => {
  const panel = await openLab(page); await begin(panel);
  let release!: () => void, started = false, polls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/simulation/observe', async route => {
    polls++;
    if (polls > 1) { await route.continue(); return; }
    const response = await route.fetch(); started = true;
    await held; await route.fulfill({ response }).catch(() => {});
  });
  await expect.poll(() => started).toBe(true);
  await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await panel.evaluate(element => {
    const observed: string[] = [];
    (window as unknown as { tribeDays: string[] }).tribeDays = observed;
    new MutationObserver(() => observed.push(element.getAttribute('data-elapsed-days')!)).observe(element, { attributes: true, attributeFilter: ['data-elapsed-days'] });
  });
  release();
  await expect.poll(() => polls).toBeGreaterThan(1);
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  expect(await page.evaluate(() => (window as unknown as { tribeDays: string[] }).tribeDays)).not.toContain('0');
});

test('mobile tribe controls locate the camp without overflowing the page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openLab(page); await begin(panel);
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await panel.getByRole('button', { name: 'Locate tribe', exact: true }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-layer', 'biomes');
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tribe-mobile.png'), fullPage: true });
});

test('a retained save error can be explicitly retried and paused without repeating the failed step', async ({ page }) => {
  const panel = await openLab(page); await begin(panel);
  let storageFailed = true, refreshedAfterRepair = false;
  const actions: string[] = [];
  for (const path of ['open', 'observe']) await page.route(`**/api/simulation/${path}`, async route => {
    const response = await route.fetch(), view = await response.json();
    if (storageFailed) { view.active = false; view.error = 'The saved checkpoint could not be written.'; }
    else if (path === 'observe') refreshedAfterRepair = true;
    await route.fulfill({ json: view });
  });
  await page.route('**/api/simulation/command', async route => {
    const action = route.request().postDataJSON().action as string; actions.push(action);
    if (storageFailed) await route.fulfill({ status: 503, json: { error: { code: 'SIMULATION_ERROR', message: 'The saved checkpoint could not be written.', requestId: 'save-error' } } });
    else {
      expect(refreshedAfterRepair, 'Refresh the authority before requesting one recovery pause').toBe(true);
      await route.continue();
    }
  });
  await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await panel.getByRole('button', { name: 'Retry tribe', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Retry save and pause', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  storageFailed = false;
  await panel.getByRole('button', { name: 'Retry save and pause', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Play tribe', exact: true })).toBeEnabled();
  expect(actions).toEqual(['step', 'pause']);
  await panel.getByRole('button', { name: 'Step 1 day', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '1');
});
