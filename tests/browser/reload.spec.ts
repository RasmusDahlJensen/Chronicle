import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEFAULT_WORLD_SETTINGS, worldKey } from '../../shared/generated-world.ts';
import { createTestProject, startProject, type RunningProject } from '../helpers/project.ts';

const CLIMATE_PATH = 'src/world/generation/climate.ts';
const CLIMATE_MARKER = 'return 31 - 62';
const DEFAULT_WORLD_KEY = worldKey(DEFAULT_WORLD_SETTINGS);
// The keyboard cursor starts at the centre of the large default world (512, 256).
const CENTRE_CELL = '262656';
// The page always opens the large default world, and every host restart regenerates it.
const WORLD_TIMEOUT = 60_000;
const PAGE_PROBE = 'chronicleReloadProbe';

test('host-side geography edits and failures reach the same open development page', async ({ browser }) => {
  test.setTimeout(180_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    const app = await startProject(project);
    const page = await context.newPage();
    await page.goto(`${app.origin}/`);
    const canvas = page.locator('#generated-world-canvas');
    await expectWorld(page, canvas);
    const initial = await inspectCentreCell(page, canvas);

    const source = await project.read(CLIMATE_PATH);
    expect(source.split(CLIMATE_MARKER)).toHaveLength(2);
    const edited = source.replace(CLIMATE_MARKER, 'return 21 - 62');

    // This atomic edit must replace the host and its terrain worker, then refresh
    // the already-open Vite client. The test never reloads or intercepts a route.
    await markPage(page);
    let outputOffset = app.output().length;
    await project.write(CLIMATE_PATH, edited);
    await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => pageProbe(page), { timeout: 30_000 }).toBe('absent');
    await expectWorld(page, canvas);
    expect(await inspectCentreCell(page, canvas)).toBeCloseTo(initial - 10, 1);

    // A broken host-side edit must take the stale API out of service. The
    // retained page may keep its last valid map, but regenerating cannot claim
    // that stale worker data was freshly produced.
    const retainedMap = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    const token = await markPage(page);
    outputOffset = app.output().length;
    await project.write(CLIMATE_PATH, `${edited}\nconst reloadProbeSyntaxError = ;\n`);
    await app.waitForOutput(/reloadProbeSyntaxError|SyntaxError|expected/i, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(false);
    await page.getByRole('button', { name: 'Regenerate world', exact: true }).click();
    // The History panel reports the unreachable simulation separately; this checks the world's own failure message.
    await expect(page.getByRole('alert').filter({ hasText: 'The world could not be loaded' })).toContainText('could not be loaded', { timeout: 15_000 });
    await expect(page.locator('#world-status')).toHaveText('Previous world retained · Generation failed');
    await expect(canvas).toHaveAttribute('data-world-key', DEFAULT_WORLD_KEY);
    expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(retainedMap);
    expect(await pageProbe(page)).toBe(token);

    // Correcting the same copied file restarts the host and refreshes this page
    // again, without a manual reload or a route-level test substitute. A third
    // baseline proves the recovered worker runs the newest source.
    const recovered = source.replace(CLIMATE_MARKER, 'return 26 - 62');
    outputOffset = app.output().length;
    await project.write(CLIMATE_PATH, recovered);
    await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => pageProbe(page), { timeout: 30_000 }).toBe('absent');
    await expectWorld(page, canvas);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await inspectCentreCell(page, canvas)).toBeCloseTo(initial - 5, 1);
    expect(page.url()).toBe(`${app.origin}/`);
  } finally {
    await context.close();
    await project.dispose();
  }
});

test('frontend edits use HMR without restarting the API or losing component state', async ({ browser }) => {
  test.setTimeout(90_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    const app = await startProject(project);
    const backendOrigin = app.output().match(/Terrain host ready at (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
    expect(backendOrigin).toBeTruthy();
    const page = await context.newPage();
    await page.goto(`${app.origin}/`);
    const canvas = page.locator('#generated-world-canvas');
    await expectWorld(page, canvas);
    // The inspected cell, chosen layer, toggles and an unsubmitted seed are
    // component state that a Fast Refresh of the page component must keep.
    const moisture = page.getByRole('radio', { name: 'Moisture', exact: true });
    const rivers = page.getByRole('checkbox', { name: 'Rivers', exact: true });
    const seed = page.getByLabel('World seed');
    await moisture.check();
    await rivers.uncheck();
    await seed.fill('Unsubmitted seed');
    await expect(canvas).toHaveAttribute('data-layer', 'moisture');
    await inspectCentreCell(page, canvas);
    const selected = page.locator('[data-selected-cell]');
    const token = await markPage(page);

    const componentPath = 'src/components/GeneratedWorldLab.tsx';
    const source = await project.read(componentPath);
    const edited = source.replace('Seeded geography &amp; annual climate', 'Seeded geography &amp; living climate');
    expect(edited).not.toBe(source);
    await project.write(componentPath, edited);

    await expect(page.getByText('Seeded geography & living climate', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await expect(selected).toHaveAttribute('data-selected-cell', CENTRE_CELL);
    await expect(moisture).toBeChecked();
    await expect(rivers).not.toBeChecked();
    await expect(seed).toHaveValue('Unsubmitted seed');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect(canvas).toHaveAttribute('data-layer', 'moisture');
    await expect(canvas).toHaveAttribute('data-world-key', DEFAULT_WORLD_KEY);
    await expect(page.locator('#world-current-seed')).toHaveText(DEFAULT_WORLD_SETTINGS.seed);
    await expect(page.locator('#world-status')).toHaveText('World ready to explore');
    expect(await pageProbe(page)).toBe(token);
    const backendHealth = await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(2_000) });
    expect(backendHealth.status).toBe(200);
    expect(await hostIsReady(app)).toBe(true);
  } finally {
    await context.close();
    await project.dispose();
  }
});

test('generated browser artifacts do not reload an open development page', async ({ browser }) => {
  test.setTimeout(90_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    await project.write('playwright-report/index.html', '<!doctype html><title>Existing Playwright report</title>');
    await project.write('test-results/browser/result.html', '<!doctype html><title>Existing browser result</title>');
    const app = await startProject(project);
    const page = await context.newPage();
    await page.goto(`${app.origin}/`);
    const canvas = page.locator('#generated-world-canvas');
    await expectWorld(page, canvas);
    await inspectCentreCell(page, canvas);
    const selected = page.locator('[data-selected-cell]');
    const token = await markPage(page);

    for (const [path, createdPath] of [
      ['playwright-report/index.html', 'playwright-report/new-report.html'],
      ['test-results/browser/result.html', 'test-results/browser/new-result.html'],
    ]) {
      await project.write(path, '<!doctype html><title>Updated generated artifact</title>');
      await page.waitForTimeout(300);
      await project.write(createdPath, '<!doctype html><title>New generated artifact</title>');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(800);

    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect(selected).toHaveAttribute('data-selected-cell', CENTRE_CELL);
    expect(await pageProbe(page)).toBe(token);
  } finally {
    await context.close();
    await project.dispose();
  }
});

async function expectWorld(page: Page, canvas: Locator) {
  await expect(canvas).toHaveAttribute('data-rendered', 'true', { timeout: WORLD_TIMEOUT });
  await expect(canvas).toHaveAttribute('data-world-key', DEFAULT_WORLD_KEY);
  await expect(page.locator('#world-status')).toHaveText('World ready to explore');
}

/** Select the keyboard cursor's centre cell and return its full-resolution annual temperature in °C. */
async function inspectCentreCell(page: Page, canvas: Locator) {
  await canvas.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', CENTRE_CELL);
  const text = await page.locator('#cell-temperature').textContent();
  const match = text?.match(/^(-?\d+\.\d) °C$/);
  expect(match, `Unexpected temperature text: ${text}`).toBeTruthy();
  return Number(match![1]);
}

/** Tag the current document; a Vite-driven reload replaces it with one that has no tag. */
async function markPage(page: Page) {
  return page.evaluate(name => {
    const value = crypto.randomUUID();
    Reflect.set(window, name, value);
    return value;
  }, PAGE_PROBE);
}

async function pageProbe(page: Page) {
  try {
    return await page.evaluate(name => {
      const value = Reflect.get(window, name);
      return typeof value === 'string' ? value : 'absent';
    }, PAGE_PROBE);
  } catch {
    return 'navigating';
  }
}

async function hostIsReady(app: RunningProject) {
  try {
    const response = await fetch(`${app.origin}/api/ready`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const body = await response.json() as { status?: string };
    return body.status === 'ready';
  } catch {
    return false;
  }
}
