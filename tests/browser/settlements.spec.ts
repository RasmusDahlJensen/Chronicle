import { expect, test } from '@playwright/test';

test('a begun tribe exposes its food economy, maintained territory and selected working area', async ({ page }, testInfo) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel.getByRole('region', { name: 'Settlements and subsistence' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-territory-cells', '1');
  await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '30');
  await expect(panel.locator('[data-total-collected]')).not.toHaveText('0');
  await expect(panel.locator('[data-total-consumed]')).not.toHaveText('0');
  await panel.getByRole('button', { name: 'Locate tribe', exact: true }).click();
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
  await panel.getByRole('button', { name: 'Reset tribe', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm reset tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  await expect(canvas).toHaveAttribute('data-territory-cells', '1');
});

test('prosperity supports a second community without duplicating people and both centers remain inspectable', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await page.getByLabel('Resolution', { exact: true }).selectOption('standard');
  await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-world-key', 'climate-5:standard:Chronicle');
  const panel = page.getByRole('region', { name: 'Tribe lab', exact: true });
  await panel.getByLabel('Placement seed', { exact: true }).fill('Tribes 4');
  await panel.getByRole('button', { name: 'Begin tribe', exact: true }).click();
  await expect(panel).toHaveAttribute('data-elapsed-days', '0');
  for (let days = 30; days <= 150; days += 30) {
    await panel.getByRole('button', { name: 'Step 30 days', exact: true }).click();
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
});
