import { expect, test, type Page } from '@playwright/test';
import type { SimulationOpen, SimulationState, SimulationView } from '../../shared/simulation.ts';

const lab = (page: Page) => page.getByRole('region', { name: 'Tribe lab', exact: true });
const investment = (page: Page) => page.getByRole('region', { name: 'Country investment', exact: true });
const format = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);

async function snapshot(page: Page, identity: SimulationOpen) {
  const response = await page.request.post('/api/simulation/observe', { data: { instanceId: identity.instanceId, observerId: identity.observerId } });
  expect(response.ok()).toBe(true);
  return (await response.json() as SimulationView).state;
}

async function inspectProjects(page: Page, state: SimulationState) {
  const development = state.development!, panel = investment(page);
  await expect(panel.locator('[data-food-level]')).toHaveText(String(development.foodLevel));
  await expect(panel.locator('[data-logistics-level]')).toHaveText(String(development.logisticsLevel));
  await expect(panel.locator('[data-reserved-food]')).toHaveText(format(development.budget.reservedFood));
  await expect(panel.locator('[data-reserved-workers]')).toHaveText(format(development.budget.reservedWorkers));
  await expect(panel.locator('[data-available-food]')).toHaveText(format(development.budget.availableFood));
  await expect(panel.locator('[data-available-workers]')).toHaveText(format(development.budget.availableWorkers));
  await expect(panel.locator('[data-investment-spent]')).toHaveText(format(development.investmentSpent));
  await expect(panel.locator('[data-project-worker-days]')).toHaveText(format(development.workerDays));
  await expect(panel.locator('[data-country-project]')).toHaveCount(development.projects.length);
  expect(development.budget.reservedFood).toBe(development.projects.reduce((sum, project) => sum + project.cost, 0));
  expect(development.budget.reservedWorkers).toBe(development.projects.reduce((sum, project) => sum + project.workers, 0));
  for (const project of development.projects) {
    const row = panel.locator(`[data-country-project="${project.id}"]`);
    await expect(row).toContainText(`${project.progress} / ${project.duration} days`);
    await expect(row).toContainText(`${format(project.cost)} food`);
    await expect(row).toContainText(`${project.workers} workers`);
    if (project.targetCellId !== null) await expect(row).toContainText(`Cell ${project.targetCellId}`);
    const start = development.history.find(event => event.projectId === project.id && event.event === 'started');
    if (start) await expect(row).toContainText(start.message);
    await expect(row.getByRole('progressbar')).toHaveAttribute('value', String(project.progress));
    await expect(row.getByRole('progressbar')).toHaveAttribute('max', String(project.duration));
  }
  const society = state.settlements!, country = state.country!;
  expect(society.centers[0].food).toBe(7500 + society.totalCollected - society.totalConsumed - society.establishmentSpent
    - development.investmentSpent - country.upkeepPaid - country.spoilage);
  const growth = page.getByRole('region', { name: 'Country growth', exact: true });
  await expect(growth.locator('[data-total-investment-spent]')).toHaveText(format(development.investmentSpent));
  await expect(growth.getByText('Project workers', { exact: true }).locator('..').locator('dd')).toHaveText(String(country.metrics.claimWorkers));
  await expect(page.getByRole('region', { name: 'Country decisions', exact: true })).not.toContainText('Reserved locally');
}

test('New game shows an unpaid founding investment budget', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  const identity = (await opening).postDataJSON() as SimulationOpen;
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '0');
  await expect(investment(page)).toBeVisible();
  const initial = await snapshot(page, identity);
  expect(initial.protocolVersion).toBe(6);
  expect(initial.rulesVersion).toBe(5);
  expect(initial.development!.foodLevel).toBe(0);
  expect(initial.development!.logisticsLevel).toBe(0);
  expect(initial.development!.investmentSpent).toBe(0);
  expect(initial.development!.projects).toEqual([]);
  await page.getByText('Accounting since founding', { exact: true }).click();
  await inspectProjects(page, initial);
});

test('monthly investment shows paid effects and shared projects and survives reload and exact reset', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Spawn civilization', exact: true }).click();
  await page.getByLabel('History seed', { exact: true }).fill('Growth review 1');
  const opening = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'Random location', exact: true }).click();
  let identity = (await opening).postDataJSON() as SimulationOpen;
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '0');
  const initial = await snapshot(page, identity);
  await page.getByText('Accounting since founding', { exact: true }).click();
  await inspectProjects(page, initial);
  let advanced = initial, observedConcurrentProjects = false;
  for (let month = 1; month <= 24; month++) {
    await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
    await expect(lab(page)).toHaveAttribute('data-elapsed-days', String(month * 30));
    advanced = await snapshot(page, identity);
    await inspectProjects(page, advanced);
    if (advanced.development!.projects.length >= 2) {
      if (!observedConcurrentProjects) {
        await investment(page).screenshot({ path: testInfo.outputPath('country-investment-projects.png') });
        const reopening = page.waitForRequest('**/api/simulation/open');
        await page.reload();
        identity = (await reopening).postDataJSON() as SimulationOpen;
        await expect(lab(page)).toHaveAttribute('data-elapsed-days', String(month * 30));
        const restored = await snapshot(page, identity);
        expect(restored.development).toEqual(advanced.development);
        expect(restored.settlements).toEqual(advanced.settlements);
        await page.getByText('Accounting since founding', { exact: true }).click();
        await inspectProjects(page, restored);
      }
      observedConcurrentProjects = true;
    }
  }
  expect(observedConcurrentProjects).toBe(true);
  expect(advanced.development!.investmentSpent).toBeGreaterThan(0);
  expect(advanced.development!.foodLevel + advanced.development!.logisticsLevel).toBeGreaterThan(0);
  expect(advanced.country!.territory.cells.length).toBeGreaterThan(initial.country!.territory.cells.length);
  await expect(investment(page).locator('[data-food-effect]')).not.toHaveText('0%');
  await investment(page).screenshot({ path: testInfo.outputPath('country-investment-year-three.png') });
  const reopening = page.waitForRequest('**/api/simulation/open');
  await page.reload();
  identity = (await reopening).postDataJSON() as SimulationOpen;
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '720');
  const restored = await snapshot(page, identity);
  expect(restored.development).toEqual(advanced.development);
  expect(restored.country).toEqual(advanced.country);
  expect(restored.settlements).toEqual(advanced.settlements);
  await page.getByText('Accounting since founding', { exact: true }).click();
  await inspectProjects(page, restored);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await investment(page).screenshot({ path: testInfo.outputPath('country-investment-mobile.png') });
  await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm reset simulation', exact: true }).click();
  await expect(lab(page)).toHaveAttribute('data-elapsed-days', '0');
  const reset = await snapshot(page, identity);
  expect(reset.development).toEqual(initial.development);
  expect(reset.country).toEqual(initial.country);
  expect(reset.settlements).toEqual(initial.settlements);
  await inspectProjects(page, reset);
  expect(errors).toEqual([]);
});
