import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderPlannerReport } from '../../scripts/planning/report.ts';
import { hostile, reportFixture } from '../helpers/planner-report.ts';

test('offline planner report switches measured trajectories and decisions without requests or mobile overflow', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-report-'));
  try {
    const file = join(directory, 'report.html');
    await writeFile(file, renderPlannerReport(reportFixture()));
    const errors: string[] = [], network: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('file:')) network.push(request.url()); });
    await page.goto(pathToFileURL(file).href);
    await expect(page.getByText('The live map still uses the released policy.', { exact: false })).toBeVisible();
    await expect(page.locator('[data-summary="claims"]')).toHaveText('7');
    await expect(page.locator('#outcomes tbody tr').first().locator('td')).toHaveText(['current', '7', '0', '12', '0', '0', '—']);
    await expect(page.locator('#outcomes tbody tr').nth(1).locator('td').last()).toHaveText('21');
    await expect(page.getByRole('img', { name: 'Policy trajectories' })).toHaveAttribute('data-metric', 'claims');
    await expect(page.locator('[data-series]')).toHaveCount(2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('Inspect policy', { exact: true }).selectOption('1');
    await expect(page.locator('[data-summary="claims"]')).toHaveText('9');
    await expect(page.locator('[data-summary="food"]')).toHaveText('6,200');
    await expect(page.locator('[data-decision-reason]')).toHaveText('A measured alternative for this viewer fixture.');
    await expect(page.locator('[data-alternatives] tbody tr')).toHaveCount(2);
    await expect(page.locator('[data-alternatives]')).toContainText(hostile);
    await expect(page.locator('[data-alternatives] tbody tr').nth(1).locator('td')).toHaveText(['Wait', 'Unavailable', '—', '—', '—', '—']);
    await page.getByLabel('Chart metric', { exact: true }).selectOption('food');
    await expect(page.getByRole('img', { name: 'Policy trajectories' })).toHaveAttribute('data-metric', 'food');
    await expect(page.locator('[data-series="1"]')).toHaveAttribute('data-values', '7500,6200');
    await page.getByLabel('Recorded decision', { exact: true }).selectOption('1');
    await expect(page.locator('[data-decision-reason]')).toHaveText('Preserve the current commitment.');
    await expect(page.locator('[data-alternatives] tbody tr')).toHaveCount(0);
    await page.getByLabel('Scenario', { exact: true }).selectOption('1');
    await expect(page.locator('[data-scenario-description]')).toHaveText(hostile);
    await expect(page.locator('[data-summary="population"]')).toHaveText('0');
    await expect(page.getByRole('img', { name: 'Policy trajectories' })).toHaveAttribute('data-scenario', 'hostile');
    assert.equal(await page.evaluate(() => 'reportInjected' in globalThis), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel('Scenario', { exact: true }).selectOption('0');
    await page.getByLabel('Inspect policy', { exact: true }).selectOption('1');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect.poll(() => page.locator('#chart text').first().evaluate(node => node.getBoundingClientRect().height), {
      message: 'Mobile chart labels must stay readable after the resize event.',
    }).toBeGreaterThanOrEqual(10);
    await page.getByLabel('Scenario', { exact: true }).selectOption('2');
    await expect(page.getByText('No observations were recorded for this scenario.', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
