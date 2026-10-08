import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

/**
 * Review-package screenshots (VISION.md rule 2): the running lab at chosen years of one seed. It drives the lab's own
 * time controls through the browser, so the images show exactly what an observer sees.
 *
 *   node scripts/review-screenshots.ts --out .chronicle/review/m0 [--url http://127.0.0.1:5173] [--seed Chronicle] [--years 0,100,250,500,1000] [--regions]
 *     [--peoples polity|descent|culture|faith|era|off] (the Peoples map lens; each image's name ends with it when given)
 *
 * With `--game` it captures the game page instead (milestone U): the map at each year, then at the last year each of
 * its views: the largest realm's panel tab by tab, a chosen story, the diplomacy, density and perspective lenses, the
 * ledger and the chronicle. The history is driven through the host's controls.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' }, seed: { type: 'string', default: 'Chronicle' },
    size: { type: 'string', default: 'large' }, years: { type: 'string', default: '0,100,250,500,1000' },
    out: { type: 'string', default: '.chronicle/review/latest' }, regions: { type: 'boolean', default: false }, peoples: { type: 'string' },
    game: { type: 'boolean', default: false },
  },
});
const years = values.years.split(',').map(Number).sort((a, b) => a - b);
if (years.some(year => !Number.isInteger(year) || year < 0 || year > 5000)) throw new Error('--years must list whole years from 0 to 5000.');
await mkdir(values.out, { recursive: true });
const browser = await chromium.launch();
if (values.game) {
  try { await gameScreenshots(); } finally { await browser.close(); }
  process.exit(0);
}
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  // The lab page (the game is the main page since U.1): its controls drive the history.
  await page.goto(new URL('/?lab', values.url).toString());
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
  const lenses: Record<string, string> = { polity: 'Political', descent: 'By descent', culture: 'By culture', faith: 'By faith', era: 'By era', off: 'Hidden' };
  if (values.peoples !== undefined) {
    if (!lenses[values.peoples]) throw new Error(`--peoples must be one of ${Object.keys(lenses).join(', ')}.`);
    await page.getByLabel(lenses[values.peoples], { exact: true }).check();
  }
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
    const path = join(values.out, `${values.seed}-year-${String(year).padStart(4, '0')}${values.peoples !== undefined ? `-${values.peoples}` : ''}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(path);
  }
} finally {
  await browser.close();
}

/** The game page (milestone U) at each year, then each of its views at the last year. */
async function gameScreenshots() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const query = `seed=${encodeURIComponent(values.seed)}&size=${values.size}`, api = (path: string) => new URL(path, values.url).toString();
  const shot = async (name: string) => { await page.waitForTimeout(800); const path = join(values.out, `game-${values.seed}-${name}.png`); await page.screenshot({ path }); console.log(path); };
  await page.addInitScript(([seed, size]) => sessionStorage.setItem('chronicle.world', JSON.stringify({ seed, size })), [values.seed, values.size]);
  await page.goto(values.url);
  await page.waitForFunction(() => document.querySelector('#game-map-canvas')?.getAttribute('data-rendered') === 'true', undefined, { timeout: 120_000 });
  await page.request.post(api(`/api/simulation/control?${query}&cursor=0`), { data: { action: 'reset' } });
  for (const year of years) {
    if (year > 0) {
      await page.request.post(api(`/api/simulation/control?${query}&cursor=0`), { data: { action: 'runTo', year } });
      for (;;) {
        const frame = await (await page.request.get(api(`/api/simulation/frame?${query}&cursor=999999999`))).json();
        if (frame.tick >= year * 12 && frame.runTo === null) break;
        await page.waitForTimeout(1000);
      }
    }
    await page.waitForFunction(tick => document.querySelector('[aria-label="Time"]')?.getAttribute('data-tick') === String(tick), year * 12, { timeout: 60_000 });
    await shot(`year-${String(year).padStart(4, '0')}`);
  }
  // The largest realm's panel, tab by tab (once a civilization exists).
  await page.getByRole('tab', { name: 'Great powers' }).click();
  const largest = page.getByRole('list', { name: 'Civilizations by people' }).getByRole('button').first();
  if (await largest.count()) {
    await largest.click();
    await page.locator('#game-realm-name').waitFor();
    for (const tab of ['Overview', 'Diplomacy', 'Economy', 'Knowledge', 'History', 'Region']) {
      await page.getByRole('tablist', { name: 'About the realm' }).getByRole('tab', { name: tab }).click();
      await shot(`realm-${tab.toLowerCase()}`);
    }
    // The lenses on that realm, and the world as it knows it.
    const lens = (name: string) => page.getByRole('group', { name: 'Map lens' }).getByRole('button', { name, exact: true }).click();
    await lens('Diplomacy'); await shot('lens-diplomacy');
    await lens('Density'); await shot('lens-density');
    await lens('Political');
    await page.getByRole('button', { name: /^View as the / }).click();
    await shot('lens-perspective');
    await page.locator('.game-view-chip').getByRole('button', { name: 'Leave their view' }).click();
  } else console.log('No civilization yet: the realm panel and the lenses on a realm are left out.');
  // The story of the age, shown on the map.
  await page.getByRole('tab', { name: 'Stories' }).click();
  const lead = page.getByRole('list', { name: 'Stories of the age' }).getByRole('button').first();
  if (await lead.count()) { await lead.click(); await shot('story'); await lead.click(); }
  // The ledger and the chronicle.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Ledger' }).click();
  await shot('ledger');
  await page.getByRole('region', { name: 'Ledger' }).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await shot('ledger-web');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Chronicle' }).click();
  await shot('chronicle');
}
