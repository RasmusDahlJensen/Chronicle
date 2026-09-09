import { expect, test } from '@playwright/test';
import { createTestProject, startProject, type RunningProject } from '../helpers/project.ts';

const FIXTURE_PATH = 'src/fixtures/verdant-reach.ts';
const RELOADED_NAME = 'Reloaded Verdant Reach';
const RECOVERED_NAME = 'Recovered Verdant Reach';

test('worker fixture edits and failures reach the same open development page', async ({ browser }) => {
  test.setTimeout(70_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    const app = await startProject(project);
    const page = await context.newPage();
    await page.goto(app.origin);
    await expect(page.getByRole('heading', { name: 'The Verdant Reach', exact: true })).toBeVisible();
    await expect(page.locator('#atlas-land-area')).toHaveText('134,108');

    const source = await project.read(FIXTURE_PATH);
    const edited = source
      .replace("fixtureVersion: 2, name: 'The Verdant Reach',", `fixtureVersion: 2, name: '${RELOADED_NAME}',`)
      .replace('width: WIDTH, height: HEIGHT, cellAreaKm2: 4,', 'width: WIDTH, height: HEIGHT, cellAreaKm2: 5,');
    expect(edited).not.toBe(source);
    expect(edited).toContain(`name: '${RELOADED_NAME}'`);
    expect(edited).toContain('cellAreaKm2: 5');

    // This atomic edit must replace the host and worker data, then refresh the
    // already-open Vite client. The test never reloads or intercepts a route.
    let outputOffset = app.output().length;
    await project.write(FIXTURE_PATH, edited);
    await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(true);
    await expect(page.getByRole('heading', { name: RELOADED_NAME, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#atlas-land-area')).toHaveText('167,635');
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-rendered', 'true');
    expect(await atlasIdentity(app)).toEqual({ name: RELOADED_NAME, cellAreaKm2: 5 });

    // A broken host-side edit must take the stale API out of service. The
    // retained page may keep its last valid map, but reset cannot claim that
    // stale worker data was freshly restored.
    outputOffset = app.output().length;
    await project.write(FIXTURE_PATH, `${edited}\nconst reloadProbeSyntaxError = ;\n`);
    await app.waitForOutput(/reloadProbeSyntaxError|SyntaxError|expected/i, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(false);
    await page.getByRole('button', { name: 'Reset atlas', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('could not be loaded', { timeout: 15_000 });
    await expect(page.getByRole('status')).not.toContainText('restored');

    // Correcting the same copied file restarts the host and refreshes this page
    // again, without a manual reload or a route-level test substitute.
    const recovered = edited.replace(RELOADED_NAME, RECOVERED_NAME);
    outputOffset = app.output().length;
    await project.write(FIXTURE_PATH, recovered);
    await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, outputOffset);
    await expect.poll(() => hostIsReady(app), { timeout: 15_000 }).toBe(true);
    await expect(page.getByRole('heading', { name: RECOVERED_NAME, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-rendered', 'true');
    await expect(page.getByRole('status')).toHaveText('Atlas ready to explore');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await atlasIdentity(app)).toEqual({ name: RECOVERED_NAME, cellAreaKm2: 5 });
    expect(page.url()).toBe(`${app.origin}/`);
  } finally {
    await context.close();
    await project.dispose();
  }
});

test('frontend edits use HMR without restarting the API or losing inspection state', async ({ browser }) => {
  test.setTimeout(40_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    const app = await startProject(project);
    const backendOrigin = app.output().match(/Terrain host ready at (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
    expect(backendOrigin).toBeTruthy();
    const page = await context.newPage();
    await page.goto(app.origin);
    const canvas = page.locator('#world-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await canvas.click({ position: { x: 180, y: 180 } });
    const selected = page.locator('[data-selected-cell]');
    await expect(selected).toBeVisible();
    const selectedId = await selected.getAttribute('data-selected-cell');
    const pageToken = await page.evaluate(() => {
      const value = crypto.randomUUID();
      Reflect.set(window, 'chronicleHmrProbe', value);
      return value;
    });

    const componentPath = 'src/components/RegionalAtlas.tsx';
    const source = await project.read(componentPath);
    const edited = source.replace('Geography &amp; natural resources', 'Geography &amp; living landscape');
    expect(edited).not.toBe(source);
    await project.write(componentPath, edited);

    await expect(page.getByText('Geography & living landscape', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await expect(selected).toHaveAttribute('data-selected-cell', selectedId!);
    expect(await page.evaluate(() => Reflect.get(window, 'chronicleHmrProbe'))).toBe(pageToken);
    const backendHealth = await fetch(`${backendOrigin}/api/health`, { signal: AbortSignal.timeout(2_000) });
    expect(backendHealth.status).toBe(200);
    expect(await hostIsReady(app)).toBe(true);
  } finally {
    await context.close();
    await project.dispose();
  }
});

test('generated browser artifacts do not reload an open development page', async ({ browser }) => {
  test.setTimeout(40_000);
  const project = await createTestProject();
  const context = await browser.newContext();
  try {
    await project.write('playwright-report/index.html', '<!doctype html><title>Existing Playwright report</title>');
    await project.write('test-results/browser/result.html', '<!doctype html><title>Existing browser result</title>');
    const app = await startProject(project);
    const page = await context.newPage();
    await page.goto(app.origin);
    const canvas = page.locator('#world-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await canvas.click({ position: { x: 180, y: 180 } });
    const selected = page.locator('[data-selected-cell]');
    await expect(selected).toBeVisible();
    const selectedId = await selected.getAttribute('data-selected-cell');
    const pageToken = await page.evaluate(() => {
      const value = crypto.randomUUID();
      Reflect.set(window, 'chronicleArtifactProbe', value);
      return value;
    });

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
    await expect(selected).toHaveAttribute('data-selected-cell', selectedId!);
    expect(await page.evaluate(() => Reflect.get(window, 'chronicleArtifactProbe'))).toBe(pageToken);
  } finally {
    await context.close();
    await project.dispose();
  }
});

async function atlasIdentity(app: RunningProject) {
  try {
    const response = await fetch(`${app.origin}/api/atlas`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { world?: { name?: string; cellAreaKm2?: number } };
    return { name: payload.world?.name, cellAreaKm2: payload.world?.cellAreaKm2 };
  } catch {
    return null;
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
