import { expect, test, type Page } from '@playwright/test';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { ERA_NAMES, parseChroniclePage } from '../../shared/simulation.ts';
import { curate, EVENT_KIND_NAMES, EVENT_KINDS, typesOf, type EventKind } from '../../src/observer/chronicle.ts';

// One shared simulation per host and world: these scenarios change its clock, so they run in order.
test.describe.configure({ mode: 'serial' });

const history = (page: Page) => page.getByRole('region', { name: 'History' });
async function tick(page: Page) { return Number(await history(page).getAttribute('data-tick')); }
// A world of its own, so scenarios on other worlds never touch this clock.
const SEED = 'History lab', SIZE = 'standard', WIDTH = 512;
async function ready(page: Page) {
  await page.goto('/?lab');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(history(page)).toHaveAttribute('data-tick', /\d+/);
  // Choosing another seed starts that world's history at year 0.
  await page.locator('#world-seed').fill(SEED);
  await page.locator('#world-size').selectOption(SIZE);
  await page.getByRole('button', { name: /Regenerate world/ }).click();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-world-key', `climate-6:${SIZE}:${SEED}`);
  await expect(history(page)).toHaveAttribute('data-tick', '0');
}

/** The game page (U.1) on this world, in its own tab: the world chosen in the tab is this test's. */
/** Whether the map's selected cell lies clear of the game's panels (the place panel, the rail, the lenses and ticker). */
async function selectionClear(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game-map-canvas') as HTMLCanvasElement | null, point = canvas?.dataset.selectionPoint;
    if (!canvas || !point) return false;
    const box = canvas.getBoundingClientRect(), [x, y] = point.split(',').map(Number), at = { x: box.left + x, y: box.top + y };
    if (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom) return false;
    return ['.game-place', '.game-side', '.game-ticker'].every(selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return !rect || at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom;
    });
  });
}

async function openGame(page: Page) {
  await page.addInitScript(([seed, size]) => sessionStorage.setItem('chronicle.world', JSON.stringify({ seed, size })), [SEED, SIZE]);
  await page.goto('/');
  const canvas = page.locator('#game-map-canvas');
  await expect(canvas).toHaveAttribute('data-world-key', `climate-6:${SIZE}:${SEED}`, { timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-rendered', 'true');
  await expect(gameTime(page)).toHaveAttribute('data-tick', /\d+/);
  return canvas;
}
const gameTime = (page: Page) => page.getByRole('region', { name: 'Time' });

/** Click a world cell on the game map at its current camera. */
async function clickGameCell(page: Page, cell: { x: number; y: number }) {
  const point = await page.locator('#game-map-canvas').evaluate((element: HTMLCanvasElement, coordinate) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
      y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
  }, cell);
  await page.mouse.click(point.x, point.y);
}

/** Click a world cell on the map at its current camera. */
async function clickCell(page: Page, cell: { x: number; y: number }) {
  const canvas = page.locator('#generated-world-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
      y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
  }, cell);
  await page.mouse.click(point.x, point.y);
}

test('time controls: reset shows year 0, step advances exactly one month, play advances until pause', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · January');
  await history(page).getByRole('button', { name: 'Step month' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '1');
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · February');
  await history(page).getByLabel('Speed').selectOption('year');
  await history(page).getByRole('button', { name: 'Play' }).click();
  await expect(history(page)).toHaveAttribute('data-playing', 'true');
  await expect.poll(() => tick(page), { timeout: 10_000 }).toBeGreaterThan(6);
  await history(page).getByRole('button', { name: 'Pause' }).click();
  await expect(history(page)).toHaveAttribute('data-playing', 'false');
  const paused = await tick(page);
  await page.waitForTimeout(1_200);
  expect(await tick(page)).toBe(paused);
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
  await expect(page.locator('#simulation-date')).toHaveText('Year 0 · January');
});

test('the game is the main page: the world map with its time bar, lenses and a chronicle in the peoples\' names', async ({ page }) => {
  const query = `seed=${encodeURIComponent(SEED)}&size=${SIZE}`;
  const canvas = await openGame(page);
  await page.request.post(`/api/simulation/control?${query}&cursor=0`, { data: { action: 'reset' } });
  await expect(gameTime(page)).toHaveAttribute('data-tick', '0');
  await expect(page.locator('#game-date')).toHaveText('Year 0 · January');
  // Time: step advances exactly one month; play advances until pause.
  await gameTime(page).getByRole('button', { name: 'Step', exact: true }).click();
  await expect(gameTime(page)).toHaveAttribute('data-tick', '1');
  await expect(page.locator('#game-date')).toHaveText('Year 0 · February');
  await gameTime(page).getByRole('button', { name: 'Play' }).click();
  await expect(gameTime(page)).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => Number(await gameTime(page).getAttribute('data-tick')), { timeout: 10_000 }).toBeGreaterThan(3);
  await gameTime(page).getByRole('button', { name: 'Pause' }).click();
  await expect(gameTime(page)).toHaveAttribute('data-playing', 'false');
  // U.6: run to a year, as the lab can.
  const goal = Math.floor(Number(await gameTime(page).getAttribute('data-tick')) / 12) + 2;
  await gameTime(page).getByLabel('To year').fill(String(goal));
  await gameTime(page).getByRole('button', { name: 'Run' }).click();
  await expect(gameTime(page)).toHaveAttribute('data-tick', String(goal * 12));
  await expect(page.locator('#game-date')).toHaveText(`Year ${goal} · January`);
  // Lenses colour the peoples' land, or show the bare terrain.
  await expect.poll(async () => Number(await canvas.getAttribute('data-territory-regions'))).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Terrain' }).click();
  await expect(canvas).toHaveAttribute('data-territory-regions', '0');
  await page.getByRole('button', { name: 'Culture' }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-territory-regions'))).toBeGreaterThan(0);
  // The chronicle ticker: notable events, each starting with a capital and naming peoples, never "#12".
  const ticker = page.getByRole('list', { name: 'Latest in the chronicle' });
  await expect(ticker.getByRole('listitem').first()).toBeVisible();
  for (const text of await ticker.getByRole('listitem').allTextContents()) {
    expect(text).toMatch(/^[\d,]+[A-Z]/);
    expect(text).not.toMatch(/#\d/);
  }
  // Selecting the land of a band shows who lives there.
  const frame = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  const regions = await (await page.request.get(`/api/simulation/regions?${query}`)).json();
  const band = frame.markers.regions[0], centroid = regions.regions[band].centroid;
  await clickGameCell(page, { x: centroid % WIDTH, y: Math.floor(centroid / WIDTH) });
  const place = page.getByRole('complementary', { name: 'Selected place' });
  await expect(place.getByRole('region', { name: 'Tribe' })).toBeVisible();
  const here = (await (await page.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${band}`)).json()).inspect.polity;
  await expect(page.locator('#game-realm-name')).toHaveText(`The ${here.name}`);
  await expect(page.locator('#game-place-line')).toContainText(`Region ${band}`);
  // U.2: a tribe's panel has no Diplomacy or Economy; its Region tab shows the land.
  const tabs = place.getByRole('tablist', { name: 'About the tribe' });
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Knowledge', 'History', 'Region']);
  await tabs.getByRole('tab', { name: 'Region' }).click();
  await expect(place.locator('#game-region')).toContainText(`Region ${band}`);
  // The developer lab is its own page, on the same world, and leads back.
  await page.getByRole('link', { name: 'Lab' }).click();
  await expect(history(page)).toBeVisible();
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-world-key', `climate-6:${SIZE}:${SEED}`, { timeout: 60_000 });
  await page.getByRole('link', { name: 'Back to the game' }).click();
  await expect(page.locator('#game-map-canvas')).toHaveAttribute('data-world-key', `climate-6:${SIZE}:${SEED}`, { timeout: 60_000 });
  await page.request.post(`/api/simulation/control?${query}&cursor=0`, { data: { action: 'reset' } });
});

test('a faster speed preset advances the date faster, and run to year stops at that year', async ({ page }) => {
  await ready(page);
  async function advance(speed: string) {
    await history(page).getByLabel('Speed').selectOption(speed);
    const before = await tick(page);
    await history(page).getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2_000);
    await history(page).getByRole('button', { name: 'Pause' }).click();
    await expect(history(page)).toHaveAttribute('data-playing', 'false');
    return await tick(page) - before;
  }
  const monthly = await advance('month');
  const decade = await advance('decade');
  expect(monthly).toBeGreaterThanOrEqual(1);
  expect(monthly).toBeLessThanOrEqual(4);
  expect(decade).toBeGreaterThan(monthly * 5);
  await history(page).getByLabel('Run to year').fill('300');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(300 * 12), { timeout: 30_000 });
  await expect(history(page)).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('#simulation-date')).toHaveText('Year 300 · January');
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
});

test('the region overlay draws region borders and the inspector names the selected cell\'s region', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await page.getByLabel('Regions', { exact: true }).check();
  await expect(canvas).toHaveAttribute('data-region-borders', /^[1-9]\d*$/);
  const regions = await (await page.request.get(`/api/simulation/regions?seed=${encodeURIComponent(SEED)}&size=${SIZE}`)).json();
  // A mid-latitude region keeps the click inside the visible map once the canvas is scrolled into view.
  const region = regions.regions.find((entry: { island: boolean; cells: number; centroid: number }) => !entry.island
    && Math.abs(Math.floor(entry.centroid / WIDTH) - regions.height / 2) < regions.height / 6);
  const cell = { x: region.centroid % WIDTH, y: Math.floor(region.centroid / WIDTH) };
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((element: HTMLCanvasElement, coordinate) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    return { x: rect.x + rect.width / 2 + (coordinate.x + 0.5 - Number(element.dataset.centerX)) * scale,
      y: rect.y + rect.height / 2 + (coordinate.y + 0.5 - Number(element.dataset.centerY)) * scale };
  }, cell);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(region.centroid));
  await expect(page.getByRole('region', { name: 'Selected cell region' })).toContainText(`Region ${region.id}`);
  await page.getByLabel('Regions', { exact: true }).uncheck();
  await expect(canvas).toHaveAttribute('data-region-borders', '0');
});

test('bands appear as markers and territories, the world chart grows and a band region shows its people, births, deaths and food', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await expect(canvas).toHaveAttribute('data-band-markers', '30');
  await history(page).getByLabel('Run to year').fill('200');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(200 * 12), { timeout: 60_000 });
  await expect(page.getByRole('figure', { name: 'World population chart' })).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-band-markers'))).toBeGreaterThan(30);
  const query = `seed=${encodeURIComponent(SEED)}&size=${SIZE}`;
  const frame = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  const regions = await (await page.request.get(`/api/simulation/regions?${query}`)).json();
  // The most populous band away from the poles, so its centre cell is on screen at fit.
  const candidates = frame.markers.regions.map((region: number, index: number) => ({ region, id: frame.markers.ids[index], population: frame.markers.populations[index], centroid: regions.regions[region].centroid }))
    .filter((band: { centroid: number }) => Math.abs(Math.floor(band.centroid / WIDTH) - regions.height / 2) < regions.height / 4)
    .sort((a: { population: number }, b: { population: number }) => b.population - a.population);
  const band = candidates[0];
  const cell = { x: band.centroid % WIDTH, y: Math.floor(band.centroid / WIDTH) };
  await clickCell(page, cell);
  const details = page.getByRole('group', { name: 'Tribe in this region' });
  await expect(details).toBeVisible();
  await expect(page.locator('#band-population')).toHaveText(band.population.toLocaleString('en'));
  // A tribe roams several regions, one band in each: the inspector shows the whole tribe and its band here.
  const held = frame.markers.ids.map((id: number, index: number) => id === band.id ? frame.markers.populations[index] : 0).filter((people: number) => people > 0);
  await expect(page.locator('#polity-regions')).toHaveText(held.length.toLocaleString('en'));
  await expect(page.locator('#polity-total')).toHaveText(held.reduce((sum: number, people: number) => sum + people, 0).toLocaleString('en'));
  await expect(details).toContainText('Births this year');
  // What it knows of the map: the inspector shows the frame's counts.
  const inspected = (await (await page.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${band.region}`)).json()).inspect.polity;
  await expect(page.locator('#polity-map')).toContainText(`Knows ${inspected.regionsKnown.toLocaleString('en')} regions (${inspected.regionsInSight.toLocaleString('en')} in sight)`);
  await expect(details).toContainText('Food security');
  await expect(page.locator('#region-capacity')).toContainText('people');
  // Peoples' territories: every living polity's region is filled — by default by polity, with a legend of the largest
  // tribes and civilizations; by descent with a legend of the largest peoples; by era with an era legend; or hidden.
  await expect(canvas).toHaveAttribute('data-territory-regions', String(frame.markers.ids.length));
  await expect(page.getByLabel('Political')).toBeChecked();
  const legend = page.getByRole('region', { name: 'Peoples legend' });
  await expect(legend).toContainText('Largest polities');
  const largest = frame.largest[0];
  expect(largest.regions).toBeGreaterThan(1);
  await expect(legend.getByRole('listitem').first()).toContainText(`${largest.name} tribe`);
  await expect(legend.getByRole('listitem').first()).toContainText(`${largest.regions.toLocaleString('en')} · `);
  await expect(page.locator('#world-population')).toContainText(/[\d,]+ tribes \([\d,]+ bands\)/);
  await page.getByLabel('By descent').check();
  await expect(legend).toContainText('regions · people');
  await expect(page.locator('#polity-lineage')).toContainText('Descended from the');
  // By culture: each region the culture of its people, with a legend of the largest cultures; the inspector names the
  // people's culture and its descent from the starting peoples.
  await page.getByLabel('By culture').check();
  await expect(canvas).toHaveAttribute('data-territory-regions', String(frame.markers.ids.length));
  await expect(page.locator('#culture-legend').getByRole('listitem').first()).toContainText(frame.cultures[0].name);
  const people = (await (await page.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${band.region}`)).json()).inspect.people;
  await expect(page.locator('#people-culture')).toContainText(people.culture);
  await expect(page.locator('#people-ancestry')).toContainText(/Descent from the starting peoples: \d+% \w+/);
  await expect(page.locator('#people-ancestry')).toContainText(`lives in ${people.regions.toLocaleString('en')} region`);
  expect(people.regions).toBeGreaterThan(0);
  await expect(page.locator('#people-values')).toContainText('militarism');
  // By faith: at year 200 no religion exists yet; every people keeps the folk ways of its culture.
  await page.getByLabel('By faith').check();
  await expect(canvas).toHaveAttribute('data-territory-regions', String(frame.markers.ids.length));
  expect(frame.religions).toEqual([]);
  await expect(page.locator('#religion-legend-empty')).toContainText('No religion has been founded yet');
  await expect(page.locator('#people-faith')).toHaveText(`Faith: the folk ways of the ${people.culture}.`);
  await page.getByLabel('By era').check();
  await expect(legend.getByRole('listitem').filter({ hasText: ERA_NAMES[frame.leadingEra] })).toContainText(/[1-9][\d,]*$/);
  await page.getByLabel('Hidden').check();
  await expect(canvas).toHaveAttribute('data-territory-regions', '0');
  await expect(page.getByRole('region', { name: 'Peoples legend' })).toHaveCount(0);
  await page.getByLabel('Political').check();
  await expect(history(page).getByRole('list', { name: 'Chronicle events' })).toContainText(/band of [\d,]+ people/);
  await expect(history(page).getByRole('list', { name: 'Chronicle events' })).toContainText(/stays with its tribe, now [\d,]+ bands/);
  // Development controls (Dev 02, test only): a scenario trigger in the selected region adds its events now and marks
  // the history altered; one that cannot apply says why and changes nothing.
  // Open by default, so they are easy to find.
  await expect(history(page).locator('.world-dev-controls')).toContainText(`In region ${band.region}, now, through the real rules:`);
  await history(page).getByRole('button', { name: 'Drought here and around' }).click();
  const events = history(page).getByRole('list', { name: 'Chronicle events' });
  await expect(events.getByRole('listitem').filter({ hasText: `Development control (test only): a drought is set off in region ${band.region}` })).toHaveCount(1);
  await expect(events.getByRole('listitem').filter({ hasText: `Drought strikes region ${band.region}` }).first()).toBeVisible();
  await expect(history(page).getByRole('note')).toHaveText('This history was altered: development controls were used once.');
  // U.7: the game says so too.
  const game = await page.context().newPage();
  await openGame(game);
  await expect(game.locator('#game-altered')).toHaveText('Altered: development controls used once');
  await game.close();
  await history(page).getByRole('button', { name: 'Found a religion' }).click();
  await expect(history(page).locator('.world-dev-refused')).toContainText('only civilizations found religions');
  await expect(history(page).getByRole('note')).toHaveText('This history was altered: development controls were used once.');
  // Load year: the altered history is replaced by one left to its rules, run to that year (from the nearest checkpoint
  // at or before it, or from year 0).
  await history(page).getByLabel('Load year').fill('100');
  await history(page).getByRole('button', { name: 'Load', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(100 * 12), { timeout: 60_000 });
  await expect(history(page).getByRole('note')).toHaveCount(0);
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
  await expect(history(page).getByRole('note')).toHaveCount(0);
});

test('farming bands settle into civilizations with villages, specialists, research the inspector explains, roads and trade', async ({ page }) => {
  // Fourteen centuries or more of history run in the worker.
  test.setTimeout(300_000);
  await ready(page);
  const canvas = page.locator('#generated-world-canvas');
  await history(page).getByLabel('Run to year').fill('650');
  await history(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(history(page)).toHaveAttribute('data-tick', String(650 * 12), { timeout: 120_000 });
  await expect(page.locator('#world-population')).toContainText(/[1-9][\d,]* civilizations/);
  await expect.poll(async () => Number(await canvas.getAttribute('data-settlement-marks'))).toBeGreaterThan(0);
  const query = `seed=${encodeURIComponent(SEED)}&size=${SIZE}`;
  const frame = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  const regions = await (await page.request.get(`/api/simulation/regions?${query}`)).json();
  expect(frame.civs).toBeGreaterThan(0);
  expect(frame.leadingEra).toBeGreaterThanOrEqual(1);
  // U.1: in the game page (another tab on the same history), the great powers lead to their capitals and the realm
  // there is shown; after several paused polls the ticker still names every people.
  const game = await page.context().newPage();
  await openGame(game);
  // U.3: the story rail tells the history's stories; choosing one shows it on the map and opens its realm, choosing it
  // again or closing the selection ends it. The ages run from the Stone age.
  const side = game.getByRole('complementary', { name: 'Stories and great powers' });
  const told = (await (await game.request.get(`/api/simulation/frame?${query}&cursor=0`)).json()).stories;
  expect(told.length).toBeGreaterThan(0);
  const stories = side.getByRole('list', { name: 'Stories of the age' }).getByRole('listitem');
  await expect(stories).toHaveCount(told.length);
  await expect(stories.first()).toContainText('The story of the age');
  await expect(stories.first()).toContainText(told[0].name);
  for (const text of await stories.allTextContents()) expect(text).not.toMatch(/#\d|\?/);
  const lead = stories.first().getByRole('button'), mapCanvas = game.locator('#game-map-canvas');
  await lead.click();
  await expect(lead).toHaveAttribute('aria-pressed', 'true');
  await expect(mapCanvas).toHaveAttribute('data-highlight-regions', String(told[0].regions.length));
  // The map shows where it happened, clear of the panels (the U close-out review).
  await expect.poll(() => selectionClear(game)).toBe(true);
  await lead.click();
  await expect(mapCanvas).toHaveAttribute('data-highlight-regions', '0');
  // A living realm's story (a rise, decline, union or trade web) goes to that realm and opens its panel.
  const realmStory = told.findIndex((story: { kind: string; alive: boolean }) => ['rise', 'decline', 'union', 'trade'].includes(story.kind) && story.alive);
  expect(realmStory).toBeGreaterThanOrEqual(0);
  await stories.nth(realmStory).getByRole('button').click();
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${told[realmStory].name}`);
  await expect.poll(() => selectionClear(game)).toBe(true);
  await expect(mapCanvas).toHaveAttribute('data-highlight-regions', String(told[realmStory].regions.length));
  await game.getByRole('complementary', { name: 'Selected place' }).getByRole('button', { name: 'Close' }).click();
  await expect(mapCanvas).toHaveAttribute('data-highlight-regions', '0');
  const ages = game.getByRole('list', { name: 'The ages' }).getByRole('listitem');
  await expect(ages.first()).toContainText('Stone');
  await expect(ages.nth(1)).toContainText('Neolithic');
  await side.getByRole('tab', { name: 'Great powers' }).click();
  const powers = game.getByRole('list', { name: 'Civilizations by people' });
  await expect(powers.getByRole('listitem')).toHaveCount(Math.min(10, frame.civList.length));
  await expect(powers.getByRole('listitem').first()).toContainText(frame.civList[0].name);
  await powers.getByRole('button').first().click();
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${frame.civList[0].name}`);
  await expect.poll(() => selectionClear(game)).toBe(true);
  const place = game.getByRole('complementary', { name: 'Selected place' });
  await expect(place).toContainText(`capital ${frame.civList[0].capital}`);
  // U.2: its realm panel. Each tab shows this realm's state, as the frame for its capital's region carries it.
  const capitalRegion = Buffer.from(regions.data, 'base64').readUInt16LE(frame.civList[0].capitalCell * 2) - 1;
  const realm = (await (await game.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${capitalRegion}`)).json()).inspect.polity;
  const tabs = place.getByRole('tablist', { name: 'About the realm' });
  await expect(tabs.getByRole('tab')).toHaveText(['Overview', 'Diplomacy', 'Economy', 'Knowledge', 'History', 'Region']);
  await expect(place.locator('#game-realm-settlements')).toContainText(/village|town|city/);
  await expect(place.locator('#game-realm-glance')).toContainText(realm.realm.cultures[0].name);
  // M6.1: its army, its share of the people, strength and upkeep, and why it keeps that many.
  expect(realm.army.soldiers).toBeGreaterThan(0);
  await expect(place.locator('#game-realm-army')).toContainText(`${realm.army.soldiers.toLocaleString('en')} soldier`);
  await expect(place.locator('#game-realm-army')).toContainText(`upkeep ${realm.army.upkeep.toLocaleString('en')} a year`);
  await expect(place.locator('#game-army-reasons')).toContainText(`It means to keep ${realm.army.target.toLocaleString('en')} soldier`);
  await expect(place.locator('#game-army-reasons')).toContainText(`a guard of ${realm.army.garrison.toLocaleString('en')}`);
  await tabs.getByRole('tab', { name: 'Diplomacy' }).click();
  await expect(tabs.getByRole('tab', { name: 'Diplomacy' })).toHaveAttribute('aria-selected', 'true');
  const known = place.getByRole('list', { name: 'Peoples it knows' }).getByRole('listitem');
  await expect(known).toHaveCount(realm.diplomacy.length);
  await expect(known.first()).toContainText(`The ${realm.diplomacy[0].name}`);
  await expect(known.first()).toContainText(/opinion [+−]\d/);
  const standings = { allied: 'allied', pact: 'non-aggression pact', trade: 'trade partner', rival: 'rival', neutral: 'neutral' } as Record<string, string>;
  await expect(known.first().locator('.game-standing')).toHaveText(standings[realm.diplomacy[0].status]);
  if (realm.unmet.length) await expect(place.locator('#game-unmet').getByRole('listitem')).toHaveCount(realm.unmet.length);
  await tabs.getByRole('tab', { name: 'Economy' }).click();
  await expect(place.locator('#game-economy-purse')).toContainText(`Treasury ${realm.wealth.treasury.toLocaleString('en')}`);
  await expect(place.locator('#game-economy-balance')).toContainText(/A (surplus|deficit) of/);
  // M6.1: the army is a cost in the budget.
  await expect(place.getByRole('definition').filter({ hasText: realm.wealth.costs.army.toLocaleString('en') }).first()).toBeVisible();
  await expect(place.locator('#game-economy-purse')).toContainText('army');
  await tabs.getByRole('tab', { name: 'Economy' }).press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Knowledge' })).toHaveAttribute('aria-selected', 'true');
  await expect(place.locator('#game-known')).toContainText(realm.known[0]);
  await expect(place.locator('#game-beliefs')).toContainText('truly');
  await tabs.getByRole('tab', { name: 'History' }).click();
  const own = place.locator('#game-history').getByRole('listitem');
  expect(realm.history.length).toBeGreaterThan(0);
  await expect(own).toHaveCount(realm.history.length);
  for (const text of await own.allTextContents()) { expect(text).toMatch(/^[\d,]+(–[\d,]+)?[A-Z]/); expect(text).not.toMatch(/#\d/); }
  await tabs.getByRole('tab', { name: 'History' }).press('End');
  await expect(tabs.getByRole('tab', { name: 'Region' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: 'Region' })).toBeFocused();
  await expect(place.locator('#game-region')).toContainText(`Region ${capitalRegion}`);
  await expect(place.locator('#game-region')).toContainText(frame.civList[0].capital);
  // U.4: the diplomacy lens colours every people by its standing with the selected realm (its own land as itself).
  const mapCanvasNow = game.locator('#game-map-canvas');
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Diplomacy' }).click();
  await expect(game.getByLabel('Diplomacy lens')).toContainText(`standing with the ${frame.civList[0].name}`);
  // Each region by its people's standing (as the frame for the realm's capital reports them), the rest not met.
  const standingOf = new Map<number, string>(realm.standings.map((entry: { id: number; status: string }) => [entry.id, entry.status]));
  const expectedCounts: Record<string, number> = { self: 0, allied: 0, pact: 0, trade: 0, rival: 0, neutral: 0, unknown: 0 };
  for (const id of frame.markers.ids as number[]) expectedCounts[id === realm.id ? 'self' : standingOf.get(id) ?? 'unknown']++;
  expect(expectedCounts.self).toBe(frame.civList[0].regions);
  expect(expectedCounts.unknown).toBeLessThan(frame.markers.ids.length - expectedCounts.self);
  await expect(mapCanvasNow).toHaveAttribute('data-standings', Object.entries(expectedCounts).map(([standing, count]) => `${standing}:${count}`).join(' '));
  // The ledger: the world over time, the realms (sortable; a row returns to the map at that realm) and the treaty web.
  await game.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Ledger' }).click();
  const ledger = game.getByRole('region', { name: 'Ledger' });
  await expect(ledger.getByRole('img', { name: /The world's people/ })).toBeVisible();
  await expect(ledger.getByRole('img', { name: /largest realms/ })).toBeVisible();
  const table = ledger.getByRole('region', { name: 'Realms' }).getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(frame.civList.length + 1);
  await table.getByRole('button', { name: 'Regions' }).click();
  await expect(table.getByRole('columnheader', { name: /Regions/ })).toHaveAttribute('aria-sort', 'descending');
  // M6.1: each realm's army.
  await expect(table.getByRole('columnheader', { name: /Army/ })).toBeVisible();
  const widest = [...frame.civList].sort((a: { regions: number; id: number }, b: { regions: number; id: number }) => b.regions - a.regions || a.id - b.id)[0];
  await expect(table.getByRole('row').nth(1).getByRole('rowheader')).toHaveText(widest.name);
  const listed = new Set(frame.civList.map((civ: { id: number }) => civ.id));
  await expect(ledger.getByRole('region', { name: 'Treaty web' }).locator('svg')).toHaveAttribute('data-treaties', String(frame.treaties.filter((treaty: { a: number; b: number }) => listed.has(treaty.a) && listed.has(treaty.b)).length));
  await table.getByRole('row').nth(1).getByRole('button').click();
  await expect(ledger).toHaveCount(0);
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${widest.name}`);
  // U.5: the chronicle, newest first, filtered by people and by kind exactly as the host's own page, curated as the
  // browser curates it; "Show on the map" returns to the map at that place.
  await game.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Chronicle' }).click();
  const chronicle = game.getByRole('region', { name: 'Chronicle', exact: true });
  const lines = chronicle.getByRole('list', { name: 'The chronicle' }).getByRole('listitem');
  await expect(lines.first()).toBeVisible();
  const pageOf = async (kinds: EventKind[], polity: number | null, before: number | null = null) => parseChroniclePage(await (await game.request.get(
    `/api/simulation/chronicle?${query}&limit=200&types=${typesOf(kinds).join(',')}${polity === null ? '' : `&polity=${polity}`}${before === null ? '' : `&before=${before}`}&min=0.05`)).json());
  const everyKind = EVENT_KINDS.filter(kind => kind !== 'development');
  const yearsOf = (entries: ReturnType<typeof curate>) => entries.map(entry => { const first = Math.floor(entry.from / 12), last = Math.floor(entry.event.tick / 12); return first < last ? `${first.toLocaleString('en')}–${last.toLocaleString('en')}` : last.toLocaleString('en'); });
  // Newest first, as the host's own page curated; reading on adds the next page.
  const newest = await pageOf(everyKind, null);
  await expect(lines.locator('.game-event-year')).toHaveText(yearsOf(curate(newest.events)));
  if (newest.next !== null) {
    await chronicle.getByRole('button', { name: 'Read older events' }).click();
    const older = await pageOf(everyKind, null, newest.next);
    await expect(lines).toHaveCount(curate([...newest.events, ...older.events]).length);
  }
  await chronicle.getByRole('combobox', { name: 'People' }).selectOption(String(frame.civList[0].id));
  const theirs = await pageOf(everyKind, frame.civList[0].id);
  expect(theirs.events.length).toBeGreaterThan(0);
  await expect(lines).toHaveCount(curate(theirs.events).length);
  for (const text of await lines.allTextContents()) expect(text).not.toMatch(/#\d/);
  for (const kind of everyKind) if (kind !== 'peoples') await chronicle.getByRole('checkbox', { name: EVENT_KIND_NAMES[kind] }).uncheck();
  const realmEvents = await pageOf(['peoples'], frame.civList[0].id);
  expect(realmEvents.events.length).toBeGreaterThan(0);
  await expect(lines).toHaveCount(curate(realmEvents.events).length);
  if (realmEvents.next === null) await expect(chronicle.getByText('Back to year 0.')).toBeVisible();
  const shown = curate(realmEvents.events)[0].event;
  await lines.first().getByRole('button', { name: 'Show on the map' }).click();
  await expect(chronicle).toBeHidden();
  await expect(game.getByRole('complementary', { name: 'Selected place' })).toContainText(`Region ${shown.region}`);
  // The ticker is curated too: no two of its lines belong to one run (of one type, for one people, within 25 years).
  const runs = await game.getByRole('list', { name: 'Latest in the chronicle' }).locator('[data-run]').evaluateAll(spans => spans.map(span => ({ run: span.getAttribute('data-run'), from: Number(span.getAttribute('data-from')), year: Number(span.closest('li')?.querySelector('.game-event-year')?.textContent?.replace(/,/g, '')) })));
  for (const [at, line] of runs.entries()) for (const older of runs.slice(at + 1)) if (older.run === line.run) expect(line.from - older.year).toBeGreaterThan(25);
  // U.6: the perspective lens, the world as the largest realm knows it: its regions in sight, remembered, and fogged.
  const viewer = frame.civList[0], regionOfCell = (cell: number) => Buffer.from(regions.data, 'base64').readUInt16LE(cell * 2) - 1;
  await powers.getByRole('button').first().click();
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${viewer.name}`);
  const knownMap = (await (await game.request.get(`/api/simulation/frame?${query}&cursor=0&view=${viewer.id}`)).json()).perspective;
  await place.getByRole('button', { name: `View as the ${viewer.name}` }).click();
  const fogged = regions.regions.length - knownMap.observed.length - knownMap.remembered.regions.length;
  expect(knownMap.remembered.regions.length + fogged).toBeGreaterThan(0);
  await expect(mapCanvasNow).toHaveAttribute('data-perspective', `seen:${knownMap.observed.length} remembered:${knownMap.remembered.regions.length} fog:${fogged}`);
  await expect(game.locator('#game-perspective-note')).toHaveText(`In sight of the ${viewer.name}.`);
  // Another realm's capital, as the viewer knows it.
  const other = frame.civList[1], otherRegion = regionOfCell(other.capitalCell), memory = knownMap.remembered.regions.indexOf(otherRegion);
  await powers.getByRole('button').nth(1).click();
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${other.name}`);
  await expect(game.locator('#game-perspective-note')).toHaveText(knownMap.observed.includes(otherRegion) ? `In sight of the ${viewer.name}.`
    : memory >= 0 ? new RegExp(`^Last seen by the ${viewer.name} in year ${knownMap.remembered.years[memory].toLocaleString('en')}`) : `Unknown to the ${viewer.name}.`);
  // A region it remembers, someone living there when last seen: selecting it says when, and who.
  await game.getByRole('group', { name: 'Map view' }).getByRole('button', { name: 'Fit' }).click();
  const remembered = knownMap.remembered.regions.map((region: number, at: number) => ({ region, at })).filter(({ at }: { at: number }) => knownMap.remembered.occupants[at] >= 0);
  expect(remembered.length).toBeGreaterThan(0);
  const target = await mapCanvasNow.evaluate((element: HTMLCanvasElement, { candidates, centroids, width }) => {
    const rect = element.getBoundingClientRect(), scale = Number(element.dataset.scale);
    for (const candidate of candidates) {
      const cell = centroids[candidate.region], x = rect.x + rect.width / 2 + (cell % width + 0.5 - Number(element.dataset.centerX)) * scale, y = rect.y + rect.height / 2 + (Math.floor(cell / width) + 0.5 - Number(element.dataset.centerY)) * scale;
      if (document.elementFromPoint(x, y) === element || document.elementFromPoint(x, y)?.classList.contains('game-map-overlay')) return { ...candidate, x, y };
    }
    return null;
  }, { candidates: remembered, centroids: regions.regions.map((region: { centroid: number }) => region.centroid), width: WIDTH });
  expect(target).not.toBeNull();
  await game.mouse.click(target!.x, target!.y);
  const names = new Map<number, string>(knownMap.names);
  await expect(game.locator('#game-perspective-note')).toHaveText(`Last seen by the ${viewer.name} in year ${knownMap.remembered.years[target!.at].toLocaleString('en')}, held by the ${names.get(knownMap.remembered.occupants[target!.at])} then.`);
  await game.locator('.game-view-chip').getByRole('button', { name: 'Leave their view' }).click();
  await expect(mapCanvasNow).toHaveAttribute('data-perspective', '');
  // The density lens: each region's people over its area; the densest as the frame and the region map give it.
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Density' }).click();
  await expect(mapCanvasNow).toHaveAttribute('data-territory-regions', String(frame.markers.regions.length));
  const densest = frame.markers.regions.map((region: number, index: number) => [region, frame.markers.populations[index] / regions.regions[region].areaKm2] as [number, number])
    .sort((a: [number, number], b: [number, number]) => b[1] - a[1] || a[0] - b[0])[0];
  await expect(mapCanvasNow).toHaveAttribute('data-densest', `${densest[0]}:${densest[1].toFixed(3)}`);
  // The settlement inspector: a capital's buildings with their condition, and its own history.
  const capitals = await Promise.all(frame.civList.slice(0, 10).map(async (civ: { capitalCell: number }) => (await (await game.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${regionOfCell(civ.capitalCell)}`)).json()).inspect));
  const builtAt = capitals.findIndex((inspect: { settlements: { capital: boolean; buildings: unknown[] }[] }) => inspect.settlements.some(settlement => settlement.capital && settlement.buildings.length > 0));
  expect(builtAt).toBeGreaterThanOrEqual(0);
  const seat = capitals[builtAt].settlements.find((settlement: { capital: boolean }) => settlement.capital);
  await powers.getByRole('button').nth(builtAt).click();
  await expect(game.locator('#game-realm-name')).toHaveText(`The ${frame.civList[builtAt].name}`);
  await place.getByRole('tablist', { name: 'About the realm' }).getByRole('tab', { name: 'Region' }).click();
  const buildings = place.locator('#game-region li').filter({ hasText: seat.name }).locator('.game-buildings');
  for (const building of seat.buildings) await expect(buildings).toContainText(building.condition < 0.995 ? `${building.name} (${Math.round(building.condition * 100)}% kept up)` : building.name);
  await expect(place.getByRole('list', { name: `The history of ${seat.name}` }).getByRole('listitem').first()).toBeVisible();
  await expect(place.locator('#game-region')).toContainText('it can house');
  // U.7: the rest of M1–M5. Each lens says what its colours mean.
  const lensKey = (name: string) => game.getByRole('group', { name: `${name} lens` });
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Political', exact: true }).click();
  await expect(lensKey('Political')).toContainText(`The ${frame.largest[0].name}`);
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Culture', exact: true }).click();
  await expect(lensKey('Culture')).toContainText(`The ${frame.cultures[0].name}`);
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Faith', exact: true }).click();
  await expect(lensKey('Faith')).toContainText('The folk ways');
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Era', exact: true }).click();
  await expect(lensKey('Era')).toContainText(`${ERA_NAMES[frame.leadingEra]} age`);
  const lineagePeople = new Map<number, number>();
  frame.markers.lineages.forEach((lineage: number, at: number) => lineagePeople.set(lineage, (lineagePeople.get(lineage) ?? 0) + frame.markers.populations[at]));
  const topLineage = [...lineagePeople].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  await game.getByRole('group', { name: 'Map lens' }).getByRole('button', { name: 'Descent', exact: true }).click();
  await expect(lensKey('Descent')).toContainText(`Of the ${frame.lineages[topLineage]}`);
  // Ruins are drawn as the frame reports them (none arise before M6's razing on this world).
  await expect(mapCanvasNow).toHaveAttribute('data-ruin-marks', String(frame.ruins.cells.length));
  // The realm panel: every option weighed, the research options, and the region's people, food and accounts.
  const largest = (await (await game.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${regionOfCell(viewer.capitalCell)}`)).json()).inspect;
  await powers.getByRole('button').first().click();
  await expect(place.locator('#game-realm-name')).toHaveText(`The ${largest.polity.name}`);
  const realmTabs = place.getByRole('tablist', { name: 'About the realm' });
  await realmTabs.getByRole('tab', { name: 'Overview' }).click();
  // The seed is fixed: by year 650 the largest realm has decided and has research options.
  const decision = largest.polity.lastDecision, candidates = largest.polity.research?.candidates ?? [];
  expect(decision).toBeTruthy();
  expect(candidates.length).toBeGreaterThan(0);
  const options = place.getByRole('list', { name: 'What it weighed' }).getByRole('listitem');
  await expect(options).toHaveCount(decision.options.length);
  await expect(options.nth(decision.pick)).toContainText('chosen');
  await expect(options.first()).toContainText(decision.options[0].score.toFixed(2));
  await realmTabs.getByRole('tab', { name: 'Knowledge' }).click();
  await expect(place.getByRole('list', { name: 'Research options' }).getByRole('listitem')).toHaveCount(candidates.length);
  await expect(place.getByRole('list', { name: 'Research options' }).getByRole('listitem').first()).toContainText(candidates[0].tech);
  await realmTabs.getByRole('tab', { name: 'Region' }).click();
  await expect(place.locator('#game-region-culture')).toContainText(`The ${largest.people.culture}`);
  await expect(place.locator('#game-region-culture')).toContainText('Descent:');
  await expect(place.locator('#game-region-faith')).toContainText(largest.people.faith ? `The ${largest.people.faith.name} faith` : `The folk ways of the ${largest.people.culture}`);
  await expect(place.locator('#game-region-food')).toContainText(`${Math.round(largest.capacity).toLocaleString('en')} people`);
  await expect(place.locator('#game-region-soldiers')).toContainText(`${largest.polity.soldiers.toLocaleString('en')} of its rural people under arms`);
  await expect(place.locator('.game-account').first()).toContainText(/^Pays [\d,]+ a year/);
  // The ledger: the world now, the wonders, the largest cultures and the religions.
  await game.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Ledger' }).click();
  await expect(game.locator('#game-world-now')).toContainText(`${frame.civs.toLocaleString('en')} civilization`);
  await expect(game.locator('#game-world-now')).toContainText(`${frame.settlements.tiers.filter((tier: number) => tier === 0).length.toLocaleString('en')} village`);
  const wonders = game.getByRole('region', { name: 'Wonders of the world' });
  if (frame.wonders.length) await expect(wonders).toContainText(`at ${frame.wonders[0].city}, of the ${frame.wonders[0].civ}`);
  else await expect(wonders).toContainText('No wonder stands or is being built yet.');
  await expect(game.locator('#game-cultures tbody tr')).toHaveCount(Math.min(12, frame.cultures.length));
  await expect(game.locator('#game-cultures tbody tr').first()).toContainText(frame.cultures[0].name);
  if (frame.religions.length) {
    await expect(game.locator('#game-religions tbody tr')).toHaveCount(Math.min(12, frame.religions.length));
    await expect(game.locator('#game-religions tbody tr').first()).toContainText(`The ${frame.religions[0].name} faith`);
  } else await expect(game.getByRole('region', { name: 'Cultures and religions' })).toContainText('No religion has been founded yet');
  await game.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Map' }).click();
  await game.waitForTimeout(2_500);
  for (const text of await game.getByRole('list', { name: 'Latest in the chronicle' }).getByRole('listitem').allTextContents()) expect(text).not.toMatch(/#\d/);
  await game.close();
  // The most populous civilization away from the poles.
  const civ = frame.markers.regions.map((region: number, index: number) => ({ region, kind: frame.markers.kinds[index], population: frame.markers.populations[index], centroid: regions.regions[region].centroid }))
    .filter((entry: { kind: number; centroid: number }) => entry.kind === 1 && Math.abs(Math.floor(entry.centroid / WIDTH) - regions.height / 2) < regions.height / 4)
    .sort((a: { population: number }, b: { population: number }) => b.population - a.population)[0];
  await clickCell(page, { x: civ.centroid % WIDTH, y: Math.floor(civ.centroid / WIDTH) });
  const details = page.getByRole('group', { name: 'Civilization in this region' });
  await expect(details).toBeVisible();
  await expect(details).toContainText(/Neolithic era|Bronze era/);
  await expect(page.locator('#polity-capital')).not.toBeEmpty();
  await expect(page.locator('#polity-specialists')).toHaveText(/^[\d,]+$/);
  await expect(page.locator('#polity-known')).toContainText('Agriculture');
  // M3b: the region's settlements with their tier, townspeople and housing, and the rural/urban split.
  const settlementsHere = page.getByRole('region', { name: 'Settlements here' });
  await expect(settlementsHere).toContainText(/(Village|Town|City|Metropolis)(, capital)? of the/);
  await expect(settlementsHere).toContainText(/townspeople of [\d,]+ it can house/);
  await expect(page.locator('#polity-rural')).toHaveText(/^[\d,]+$/);
  // M3b.6: the region's last harvest (and any drought, famine or irrigation); M3b.7: its cultivated land.
  await expect(page.locator('#region-harvest')).toContainText(/\d+% of the crops/);
  await expect(page.locator('#region-fields')).toContainText(/\d+% of its farmland cultivated/);
  // M3c.2: the realm's budget, and what each settlement pays and costs (the region's seat keeps its farm taxes and administration).
  await expect(page.locator('#polity-wealth')).toContainText(/taxes \d+% of what its people produce · revenue [\d,]+ a year \(trades [\d,]+, farms [\d,]+.*\) · costs [\d,]+ a year \(administration [\d,]+, services [\d,]+, upkeep [\d,]+/);
  await expect(settlementsHere).toContainText(/Seat of the region: pays [\d,]+ a year \(trades [\d,]+, farm taxes [\d,]+.*\); costs [\d,]+ \(administration [\d,]+, services [\d,]+, upkeep [\d,]+\): a (profit|loss) of [\d,]+ a year/);
  // The Fields layer draws exactly the cultivated cells the frame reports (each region's count of its ranked farmland).
  const cultivated = frame.fields.cells.reduce((sum: number, cells: number) => sum + cells, 0);
  expect(cultivated).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-field-cells'))).toBe(cultivated);
  await page.getByLabel('Fields').uncheck();
  await expect(canvas).toHaveAttribute('data-field-cells', '0');
  await page.getByLabel('Fields').check();
  await expect(page.locator('#world-population')).toContainText(/[\d,]+ settlements?/);
  await expect(details.getByRole('region', { name: 'Knowledge' })).toContainText('points a year');
  // M3: a civilization weighs expanding, exploring, uniting, sharing knowledge or doing nothing every six months; the inspector shows the last
  // step with its options and their reasons, and its governance reach.
  await expect(details.getByRole('region', { name: 'Decisions' })).toContainText('reach');
  // M3.3: each civilization region has a stability, with what lowers it.
  await expect(page.locator('#polity-stability')).toContainText(/Stability here [01]\.\d\d/);
  await expect(page.locator('#polity-decision')).toContainText(/Expand into|Explore|Do nothing|Unite with|Share knowledge with|Build|Propose (trade|a non-aggression pact|an alliance|a joint road) with|Send a voyage overseas/);
  // Do nothing is always weighed; Expand only when it knows land next to its own that nobody holds.
  const weighed = details.getByRole('list', { name: 'Options weighed' });
  await expect(weighed).toContainText('Do nothing');
  expect(await weighed.getByRole('listitem').count()).toBeGreaterThanOrEqual(2);
  // M5.2: the decision shows the needs it weighed and the effective values it was taken with (all its people's).
  await expect(page.locator('#polity-needs')).toContainText(/Needs: hunger \d\.\d\d · land pressure \d\.\d\d · shortage \d\.\d\d · threat \d\.\d\d/);
  await expect(page.locator('#polity-values')).toContainText(/Decided by all its people's values: militarism \d\.\d\d/);
  await expect(page.locator('#polity-causes')).toContainText(/^(Because of [a-zA-Z]+ \+\d\.\d\d|Chosen)/);
  // M5.1: its Diplomacy: the peoples it knows best, with its opinion of them and why, its beliefs and their intimacy.
  const inspected = (await (await page.request.get(`/api/simulation/frame?${query}&cursor=0&inspect=${civ.region}`)).json()).inspect.polity;
  expect(inspected.diplomacy.length).toBeGreaterThan(0);
  // M5.3: its resources, worked against what its techs demand (every civilization knows Neolithic stone or boat work).
  expect(inspected.resources.length).toBeGreaterThan(0);
  await expect(details.getByRole('region', { name: 'Resources' })).toContainText(inspected.resources[0].resource);
  const relations = details.getByRole('list', { name: 'Relations' });
  await expect(relations.getByRole('listitem')).toHaveCount(inspected.diplomacy.length);
  await expect(relations.getByRole('listitem').first()).toContainText(inspected.diplomacy[0].name);
  await expect(relations.getByRole('listitem').first()).toContainText(`intimacy ${inspected.diplomacy[0].intimacy.toFixed(2)}`);
  await expect(relations).toContainText(/opinion [+-]?\d+/);
  // M5.5: each people's standing (allied, pact, trade partner, rival or neutral) and its treaties.
  const standing = { allied: 'allied', pact: 'non-aggression pact', trade: 'trade partner', rival: 'rival', neutral: 'neutral' } as const;
  await expect(relations.getByRole('listitem').first()).toContainText(standing[inspected.diplomacy[0].status as keyof typeof standing]);
  // The political map marks capitals with stars, and the civilization list takes the observer to one.
  await expect.poll(async () => Number(await canvas.getAttribute('data-capital-marks'))).toBeGreaterThan(0);
  const civilizations = history(page).getByRole('list', { name: 'Civilizations' });
  await expect(civilizations.getByRole('listitem')).toHaveCount(Math.min(frame.civs, 100));
  const first = frame.civList[0];
  await civilizations.getByRole('button').first().click();
  await expect(page.locator('[data-selected-cell]')).toHaveAttribute('data-selected-cell', String(first.capitalCell));
  await expect(page.locator('#polity-capital')).toHaveText(first.capital);
  // Zoomed in on it, settlements are drawn by tier and named (capitals and cities first).
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-settlement-labels'))).toBeGreaterThan(0);
  // M3b.5: once a civilization knows the Wheel it builds roads from its capital to its towns, drawn on the map. (Run
  // on a century at a time until the first roads stand: when the Wheel comes depends on the whole history.)
  let later = frame;
  for (let year = 1200; year <= 2000 && !later.roads.a.length; year += 100) {
    await history(page).getByLabel('Run to year').fill(String(year));
    await history(page).getByRole('button', { name: 'Run', exact: true }).click();
    await expect(history(page)).toHaveAttribute('data-tick', String(year * 12), { timeout: 120_000 });
    later = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  }
  expect(later.roads.a.length).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-road-marks'))).toBe(later.roads.a.length);
  // M3c.5: roads worn below 80% are drawn worn, as many as the frame reports.
  expect(later.roads.conditions.length).toBe(later.roads.a.length);
  await expect.poll(async () => Number(await canvas.getAttribute('data-worn-road-marks'))).toBe(later.roads.conditions.filter((condition: number) => condition < 80).length);
  // M5.4: trade agreements are drawn between their two hubs on the trade-routes layer, and the inspector lists them.
  // (Run on a century at a time until one is in force.)
  for (let year = await tick(page) / 12 + 100; year <= 2000 && !later.trades.from.length; year += 100) {
    await history(page).getByLabel('Run to year').fill(String(year));
    await history(page).getByRole('button', { name: 'Run', exact: true }).click();
    await expect(history(page)).toHaveAttribute('data-tick', String(year * 12), { timeout: 120_000 });
    later = await (await page.request.get(`/api/simulation/frame?${query}&cursor=0`)).json();
  }
  expect(later.trades.from.length).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-trade-marks'))).toBe(later.trades.from.length);
  await page.getByLabel('Trade routes').uncheck();
  await expect(canvas).toHaveAttribute('data-trade-marks', '0');
  await page.getByLabel('Trade routes').check();
  await page.getByRole('button', { name: 'Fit map' }).click();
  const importerHub = later.trades.to[0];
  await clickCell(page, { x: importerHub % WIDTH, y: Math.floor(importerHub / WIDTH) });
  await expect(details.getByRole('region', { name: 'Trade' })).toContainText(`imports ${RESOURCE_IDS[later.trades.resources[0]]} from the`);
  await history(page).getByRole('button', { name: 'Reset to year 0' }).click();
  await expect(history(page)).toHaveAttribute('data-tick', '0');
});
