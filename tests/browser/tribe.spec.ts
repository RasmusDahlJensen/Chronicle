import { expect, test, type Page } from '@playwright/test';
import type { SimulationCommand, SimulationOpen } from '../../shared/simulation.ts';

async function openLab(page: Page) {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel;
}
async function begin(page: Page) {
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tribe lab', exact: true })).toHaveAttribute('data-elapsed-days', '0');
  await expect(page.getByRole('region', { name: 'World simulation', exact: true })).toContainText('Month 1, Year 1');
}

test('a fresh world ignores legacy remembered tribes and has no civilization or marker before explicit spawn', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'climate-5:large:Chronicle', seed = 'Tribes 1';
    localStorage.setItem(`chronicle:tribe-placement:${key}`, seed);
    localStorage.setItem(`chronicle:tribe-instance:${JSON.stringify([key, seed])}`, '11111111-1111-4111-8111-111111111111');
  });
  const actorRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/world/civilization') || request.url().includes('/api/simulation/')) actorRequests.push(request.url());
  });
  const panel = await openLab(page);
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Spawn civilization', exact: true })).toBeEnabled();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-civilization-id', '');
  await expect(panel.locator('[data-tribe-name]')).toHaveCount(0);
  expect(actorRequests).toEqual([]);
});

test('Begin saves its identity before opening and refresh restores the same tribe and completed day', async ({ page }, testInfo) => {
  const opens: SimulationOpen[] = [];
  const legacyRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/world/civilization')) legacyRequests.push(request.url()); });
  await page.route('**/api/simulation/open', async route => {
    const body = route.request().postDataJSON() as SimulationOpen;
    expect(await page.evaluate(id => Object.entries(localStorage).some(([key, value]) => key.startsWith('chronicle:world-session:') && JSON.parse(value).id === id), body.instanceId), 'Remember the instance before the host can create it').toBe(true);
    opens.push(body); await route.continue();
  });
  const panel = await openLab(page);
  expect(opens).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveCount(0);
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-civilization-id', '');
  await begin(page);
  const instance = await panel.getAttribute('data-instance-id');
  const name = await panel.locator('[data-tribe-name]').textContent();
  await expect(panel.locator('[data-tribe-population]')).toHaveText('250');
  await expect(page.getByRole('region', { name: 'Civilization', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(page.getByRole('region', { name: 'World simulation', exact: true })).toContainText('Month 2, Year 1');
  await page.getByRole('button', { name: 'Locate civilization', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toContainText(name!);
  await page.screenshot({ path: testInfo.outputPath('tribe-day-31.png'), fullPage: true });
  await page.reload();
  await expect(panel).toHaveAttribute('data-instance-id', instance!);
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel.locator('[data-tribe-name]')).toHaveText(name!);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(new Set(opens.map(value => value.instanceId))).toEqual(new Set([instance]));
  expect(new Set(opens.map(value => value.placementSeed)).size).toBe(1);
  expect(opens.every(value => value.clockMode === 'monthly')).toBe(true);
  expect(legacyRequests).toEqual([]);
});

test('global play advances whole months, pause and confirmed reset preserve population accounting', async ({ page }, testInfo) => {
  const panel = await openLab(page); await begin(page);
  await expect(page.getByLabel('Simulation speed', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 1 month', exact: true })).toBeDisabled();
  await expect.poll(async () => Number(await panel.getAttribute('data-elapsed-days'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Advance 1 month', exact: true })).toBeEnabled();
  const pausedDays = await panel.getAttribute('data-elapsed-days');
  expect(Number(pausedDays) % 30).toBe(0);
  await page.reload();
  await expect(panel).toHaveAttribute('data-elapsed-days', pausedDays!);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', String(Number(pausedDays) + 30));
  const oldIncarnation = Number(await panel.getAttribute('data-incarnation'));
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Reset simulation confirmation' })).toContainText('Saved progress');
  await page.getByRole('button', { name: 'Cancel reset', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', String(Number(pausedDays) + 30));
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel).toHaveAttribute('data-incarnation', String(oldIncarnation + 1));
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await expect(panel.locator('[data-tribe-population]')).toHaveText('250');
  await page.screenshot({ path: testInfo.outputPath('tribe-reset.png'), fullPage: true });
});

test('an unconfirmed command preserves the map and retry reads its saved result without repeating it', async ({ page }) => {
  const panel = await openLab(page); await begin(page);
  const instance = await panel.getAttribute('data-instance-id');
  let commands = 0;
  await page.route('**/api/simulation/command', async route => {
    commands++; const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('radio', { name: 'Temperature', exact: true }).check();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-layer', 'temperature');
  await page.unroute('**/api/simulation/command');
  await page.getByRole('button', { name: 'Retry simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-instance-id', instance!);
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  expect(commands).toBe(1);
});

test('a revision conflict refreshes the changed state and never repeats a step automatically', async ({ page }) => {
  const panel = await openLab(page); await begin(page);
  let commands = 0;
  await page.route('**/api/simulation/command', async route => {
    commands++;
    const command = route.request().postDataJSON() as SimulationCommand;
    const external = await page.request.post('/api/simulation/command', { data: { ...command, days: 30 } });
    expect(external.ok()).toBe(true);
    await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'The state changed.', requestId: 'tribe-conflict' } } });
  });
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel).toContainText('changed');
  expect(commands).toBe(1);
  await page.unroute('**/api/simulation/command');
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '60');
});

test('a failed initial open retains its remembered instance and does not silently create another', async ({ page }) => {
  const opens: SimulationOpen[] = [];
  await page.route('**/api/simulation/open', async route => {
    opens.push(route.request().postDataJSON() as SimulationOpen);
    await route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Host unavailable.', requestId: 'tribe-open' } } });
  });
  const panel = await openLab(page);
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  const instance = opens[0].instanceId;
  await page.reload();
  await expect(panel.getByRole('alert')).toBeVisible();
  expect(opens.every(value => value.instanceId === instance)).toBe(true);
  await page.unroute('**/api/simulation/open');
  await page.getByRole('button', { name: 'Retry simulation', exact: true }).click();
  await expect(panel).toHaveAttribute('data-instance-id', instance);
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
});

test('a delayed poll cannot roll back a completed command', async ({ page }) => {
  const panel = await openLab(page); await begin(page);
  let release!: () => void, started = false, polls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/simulation/observe', async route => {
    polls++;
    if (polls > 1) { await route.continue(); return; }
    const response = await route.fetch(); started = true;
    await held; await route.fulfill({ response }).catch(() => {});
  });
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
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
  await openLab(page); await begin(page);
  await page.getByRole('radio', { name: 'Fertility', exact: true }).check();
  await page.getByRole('button', { name: 'Locate civilization', exact: true }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-layer', 'biomes');
  await expect(page.getByRole('region', { name: 'Selected tribe camp' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tribe-mobile.png'), fullPage: true });
});

test('a retained save error can be explicitly retried and paused without repeating the failed step', async ({ page }) => {
  const panel = await openLab(page); await begin(page);
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
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry simulation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry save and pause', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  storageFailed = false;
  await page.getByRole('button', { name: 'Retry save and pause', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(actions).toEqual(['step', 'pause']);
  await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
});
