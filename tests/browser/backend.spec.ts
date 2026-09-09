import { expect, test } from '@playwright/test';

test('loading waits for host terrain before enabling reset', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/terrain', async route => {
    await held;
    await route.continue();
  });
  await page.goto('/');
  try {
    await expect(page.getByRole('status')).toHaveText('Loading terrain…');
    await expect(page.getByRole('button', { name: 'Reset terrain' })).toBeDisabled();
    await expect(page.locator('#terrain-canvas')).toHaveCount(0);
    await expect(page.locator('#land-area')).toHaveText('—');
  } finally {
    release();
  }
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.getByRole('button', { name: 'Reset terrain' })).toBeEnabled();
});

test('unavailable host shows an error and retry loads the real terrain', async ({ page }) => {
  await page.route('**/api/terrain', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.locator('#terrain-canvas')).toHaveCount(0);
  await page.unroute('**/api/terrain');
  await page.getByRole('button', { name: 'Retry terrain' }).click();
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.getByRole('status')).toHaveText('Terrain ready to view');
});

test('failed reset keeps the last map and retry commits host data once', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#terrain-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.route('**/api/terrain', route => route.fulfill({ json: { protocolVersion: 1, world: { cells: [] } } }));
  await page.getByRole('button', { name: 'Reset terrain' }).click();
  await expect(page.getByRole('alert')).toContainText('terrain response');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await expect(page.locator('#land-area')).toHaveText('9,898');
  await page.unroute('**/api/terrain');
  await page.getByRole('button', { name: 'Retry terrain' }).click();
  await expect(page.getByRole('status')).toHaveText('Original terrain restored · 1');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
});

test('the browser displays the host response instead of constructing a local fixture', async ({ page }) => {
  await page.route('**/api/terrain', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.world.name = 'Island from the host';
    payload.world.cellAreaKm2 = 2;
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/');
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('aria-label', /^Island from the host:/);
  await expect(page.locator('#land-area')).toHaveText('19,796');
});

test('a dropped connection can be retried without reloading the page', async ({ page }) => {
  await page.route('**/api/terrain', route => route.abort('connectionrefused'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await page.unroute('**/api/terrain');
  await page.getByRole('button', { name: 'Retry terrain' }).click();
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
});

test('a stalled request times out and allows retry', async ({ page }) => {
  // Leave the network request unanswered so the actual client deadline must end it.
  await page.route('**/api/terrain', () => {});
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Loading terrain…');
  await expect(page.getByRole('alert')).toContainText('could not be loaded', { timeout: 12_000 });
  await page.unroute('**/api/terrain');
  await page.getByRole('button', { name: 'Retry terrain' }).click();
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
});

test('keyboard focus survives a host reset so Enter can reset again', async ({ page }) => {
  await page.goto('/');
  const reset = page.getByRole('button', { name: 'Reset terrain' });
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Original terrain restored · 1');
  await expect(reset).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Original terrain restored · 2');
});

test('a busy host explains the failure and retry preserves the existing map', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#terrain-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.route('**/api/terrain', route => route.fulfill({ status: 503, json: {
    error: { code: 'OVERLOADED', message: 'Busy', requestId: 'test-request' },
  } }));
  await page.getByRole('button', { name: 'Reset terrain' }).click();
  await expect(page.getByRole('alert')).toContainText('host is busy');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await page.unroute('**/api/terrain');
  await page.getByRole('button', { name: 'Retry terrain' }).click();
  await expect(page.getByRole('status')).toHaveText('Original terrain restored · 1');
});
