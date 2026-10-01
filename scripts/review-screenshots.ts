import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

/**
 * Review-package screenshots (VISION.md rule 2): the running lab at chosen years of one seed. It drives the lab's own
 * time controls through the browser, so the images show exactly what an observer sees.
 *
 *   node scripts/review-screenshots.ts --out .chronicle/review/m0 [--url http://127.0.0.1:5173] [--seed Chronicle] [--years 0,100,250,500,1000] [--regions]
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' }, seed: { type: 'string', default: 'Chronicle' },
    size: { type: 'string', default: 'large' }, years: { type: 'string', default: '0,100,250,500,1000' },
    out: { type: 'string', default: '.chronicle/review/latest' }, regions: { type: 'boolean', default: false },
  },
});
const years = values.years.split(',').map(Number).sort((a, b) => a - b);
if (years.some(year => !Number.isInteger(year) || year < 0 || year > 5000)) throw new Error('--years must list whole years from 0 to 5000.');
await mkdir(values.out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(values.url);
  if (values.seed !== 'Chronicle' || values.size !== 'large') {
    await page.locator('#world-seed').fill(values.seed);
    await page.locator('#world-size').selectOption(values.size);
    await page.getByRole('button', { name: /Regenerate world/ }).click();
  }
  const canvas = page.locator('#generated-world-canvas');
  await canvas.waitFor();
  await page.waitForFunction(seed => document.querySelector('#world-current-seed')?.textContent === seed
    && document.querySelector('#generated-world-canvas')?.getAttribute('data-rendered') === 'true', values.seed, { timeout: 120_000 });
  const history = page.getByRole('region', { name: 'History' });
  await history.getAttribute('data-tick', { timeout: 120_000 });
  await page.waitForFunction(() => /\d/.test(document.querySelector('[aria-label="History"]')?.getAttribute('data-tick') ?? ''), undefined, { timeout: 120_000 });
  if (values.regions) await page.getByLabel('Regions', { exact: true }).check();
  await history.getByRole('button', { name: 'Reset to year 0' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="History"]')?.getAttribute('data-tick') === '0');
  for (const year of years) {
    if (year > 0) {
      await history.getByLabel('Run to year').fill(String(year));
      await history.getByRole('button', { name: 'Run', exact: true }).click();
      await page.waitForFunction(tick => document.querySelector('[aria-label="History"]')?.getAttribute('data-tick') === String(tick)
        && document.querySelector('[aria-label="History"]')?.getAttribute('data-playing') === 'false', year * 12, { timeout: 600_000, polling: 250 });
    }
    await page.waitForTimeout(600);
    const path = join(values.out, `${values.seed}-year-${String(year).padStart(4, '0')}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(path);
  }
} finally {
  await browser.close();
}
