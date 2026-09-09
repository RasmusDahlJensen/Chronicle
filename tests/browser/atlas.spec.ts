import { expect, test } from '@playwright/test';

test('terrain renders, reset restores the same image, and the page reports no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('#terrain-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#land-area')).toContainText(/[1-9]/);
  const areas = await page.evaluate(() => {
    const read = (id: string) => Number(document.getElementById(id)!.textContent!.replaceAll(',', ''));
    return { land: read('land-area'), water: read('water-area'), plains: read('plains-area'), hills: read('hills-area') };
  });
  expect(areas.land + areas.water).toBe(27_648);
  expect(areas.plains + areas.hills).toBe(areas.land);
  expect(areas).toEqual({ land: 9_898, water: 17_750, plains: 7_365, hills: 2_533 });
  const original = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const colorCount = await canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!;
    const colors = new Set<string>();
    for (let y = 10; y < element.height; y += 30) {
      for (let x = 10; x < element.width; x += 30) {
        colors.add(Array.from(ctx.getImageData(x, y, 1, 1).data).join(','));
      }
    }
    return colors.size;
  });
  expect(colorCount).toBeGreaterThan(20);
  // Corrupt the actual rendered view: reset must repaint, not just announce success.
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, element.width, element.height);
  });
  await page.getByRole('button', { name: 'Reset terrain' }).click();
  await expect(page.locator('#terrain-status')).toContainText('restored');
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original);
  await page.screenshot({ path: 'test-results/atlas-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('repeated resets count once per click and keep one active canvas resize subscription', async ({ page }) => {
  await page.addInitScript(() => {
    const active = new Set<ResizeObserver>();
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      observe(target: Element, options?: ResizeObserverOptions) {
        super.observe(target, options);
        if (target.id === 'terrain-canvas') active.add(this);
      }
      disconnect() {
        super.disconnect();
        active.delete(this);
      }
    };
    Object.defineProperty(window, 'activeCanvasObservers', { get: () => active.size });
  });
  await page.goto('/');
  await expect(page.locator('#terrain-canvas')).toHaveAttribute('data-rendered', 'true');
  for (let count = 1; count <= 3; count++) {
    await page.getByRole('button', { name: 'Reset terrain' }).click();
    await expect(page.getByRole('status')).toHaveText(`Original terrain restored · ${count}`);
    expect(await page.evaluate(() => Reflect.get(window, 'activeCanvasObservers'))).toBe(1);
  }
});

test('a browser without a canvas context reports the failure and disables reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('could not open the terrain canvas');
  await expect(page.getByRole('status')).toHaveText('Terrain unavailable');
  await expect(page.getByRole('button', { name: 'Reset terrain' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('resizing an open atlas preserves the terrain and restores its original rendering', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#terrain-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const original = await canvas.evaluate((element: HTMLCanvasElement) => ({ width: element.width, image: element.toDataURL() }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).not.toHaveJSProperty('width', original.width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(canvas).toHaveJSProperty('width', original.width);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(original.image);
});

test('the terrain fits a narrow screen and supports keyboard reset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('#terrain-canvas');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(250);
  expect(box!.width / box!.height).toBeCloseTo(4 / 3, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Reset terrain' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#terrain-status')).toContainText('restored');
  await page.screenshot({ path: 'test-results/atlas-mobile.png', fullPage: true });
});
