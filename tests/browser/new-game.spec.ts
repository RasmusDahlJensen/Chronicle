import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { SimulationOpen, SimulationView } from '../../shared/simulation.ts';

const panel = (page: Page) => page.getByRole('region', { name: 'Tribe lab', exact: true });
async function loaded(page: Page, identity: SimulationOpen) {
  await expect(panel(page)).toHaveAttribute('data-instance-id', identity.instanceId);
  await expect(panel(page)).toHaveAttribute('data-elapsed-days', '0');
  await expect(panel(page)).toHaveAttribute('aria-busy', 'false');
  // Chromium's captured response body can be unavailable during concurrent
  // terrain delivery. Read the host using the browser's same observer lease.
  const response=await page.request.post('/api/simulation/observe', { data:{ instanceId:identity.instanceId, observerId:identity.observerId } });
  expect(response.ok()).toBe(true);
  return await response.json() as SimulationView;
}
async function start(page: Page) {
  const opened = page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  const identity = (await opened).postDataJSON() as SimulationOpen;
  const view = await loaded(page,identity);
  return { identity, view };
}
async function fresh(page: Page) {
  await page.goto('/');
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-rendered', 'true');
}

test('New game replaces the current civilization and history, and refresh resumes the replacement', async ({ page }, testInfo) => {
  await fresh(page);
  const old = await start(page);
  for (let month=1; month<=6; month++) {
    await page.getByRole('button', { name: 'Advance 1 month', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-elapsed-days', String(month*30));
  }
  await page.getByRole('button', { name: 'Locate civilization', exact: true }).click();
  const canvas=page.locator('#generated-world-canvas');
  const released=page.waitForRequest(request => request.url().endsWith('/api/simulation/release') && request.postDataJSON().instanceId===old.identity.instanceId);
  let unblock!: () => void;
  const held=new Promise<void>(resolve => { unblock=resolve; });
  let arrived=false;
  let replacement: SimulationOpen | undefined;
  await page.route('**/api/simulation/open', async route => { replacement=route.request().postDataJSON(); arrived=true; await held; await route.continue(); });
  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await expect.poll(() => arrived).toBe(true);
  await released;
  await expect(canvas).not.toHaveAttribute('data-civilization-id', old.view.state.tribe.id);
  await expect(canvas).toHaveAttribute('data-settlement-count', '0');
  await expect(canvas).toHaveAttribute('data-territory-cells', '0');
  await expect(page.getByRole('region', { name:'Selected settlement', exact:true })).toHaveCount(0);
  await expect(panel(page).locator('[data-tribe-name]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New game', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Advance 1 month', exact: true })).toBeDisabled();
  unblock();
  const identity=replacement!;
  const next=(await loaded(page,identity)).state;
  expect(next.id).not.toBe(old.view.state.id);
  expect(next.placementSeed).not.toBe(old.view.state.placementSeed);
  // Civilization IDs are local to an instance (both may be civilization-1).
  // The fresh instance and seed identify a different history.
  expect(next.worldKey).toBe(old.view.state.worldKey);
  expect(next.elapsedDays).toBe(0);
  expect(next.running).toBe(false);
  expect(next.settlements!.centers).toHaveLength(1);
  expect(next.tribe.population).toBe(250);
  expect(next.ai!.history).toEqual([]);
  expect(next.ai!.historySeed).toBe(identity.placementSeed);
  await expect(canvas).toHaveAttribute('data-civilization-id', next.tribe.id);
  await expect(canvas).toHaveAttribute('data-settlement-count', '1');
  expect(next.protocolVersion).toBe(6);
  expect(next.country!.personDays).toBe(0);
  expect(next.country!.births + next.country!.naturalDeaths + next.country!.starvationDeaths).toBe(0);
  expect(next.settlements!.centers[0].territory).toEqual([next.country!.territory.capitalCellId]);
  await expect(canvas).toHaveAttribute('data-territory-cells', String(next.country!.territory.cells.length));
  await expect(panel(page).locator('[data-tribe-name]')).toHaveText(next.tribe.name);
  const rgb=[1,3,5].map(at=>Number.parseInt(next.tribe.color.slice(at,at+2),16)).join(', ');
  await expect(panel(page).locator('.world-civilization-swatch')).toHaveCSS('background-color',`rgb(${rgb})`);
  await expect(panel(page)).toHaveAttribute('data-elapsed-days', '0');
  await page.unroute('**/api/simulation/open');
  let resumedIdentity: SimulationOpen | undefined;
  page.on('request', request => { if(request.url().endsWith('/api/simulation/open')) resumedIdentity=request.postDataJSON(); });
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-elapsed-days','0');
  await expect(panel(page)).toHaveAttribute('aria-busy','false');
  const resumed=await page.request.post('/api/simulation/observe', { data:{ instanceId:resumedIdentity!.instanceId, observerId:resumedIdentity!.observerId } });
  expect(resumed.ok()).toBe(true);
  expect((await resumed.json() as SimulationView).state).toEqual(next);
  await expect(canvas).toHaveAttribute('data-civilization-id', next.tribe.id);
  await page.setViewportSize({ width:390, height:844 });
  await expect(page.getByRole('button', { name:'New game', exact:true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({ path:testInfo.outputPath('new-game-mobile.png'), fullPage:true });
});

test('a lost new-game response retries the same replacement and never restores the previous civilization', async ({ page }) => {
  await fresh(page);
  const old=await start(page);
  let accepted: SimulationView | undefined;
  let pending: SimulationOpen | undefined;
  await page.route('**/api/simulation/open', async route => {
    pending=route.request().postDataJSON();
    accepted=await (await route.fetch()).json();
    await route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:{ code:'UNAVAILABLE', message:'New game response lost.', requestId:'new-game-test' } }) });
  });
  await page.getByRole('button', { name:'New game', exact:true }).click();
  await expect(page.getByRole('button', { name:'Retry simulation', exact:true })).toBeVisible();
  await expect(panel(page).getByRole('alert')).toHaveText('New game response lost.');
  expect(accepted!.state.id).not.toBe(old.view.state.id);
  const saved=await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), `chronicle:world-session:${old.view.state.worldKey}`);
  expect(saved.id).toBe(pending!.instanceId);
  await expect(page.locator('#generated-world-canvas')).not.toHaveAttribute('data-civilization-id', old.view.state.tribe.id);
  await page.unroute('**/api/simulation/open');
  const retry=page.waitForRequest('**/api/simulation/open');
  await page.getByRole('button', { name:'Retry simulation', exact:true }).click();
  const identity=(await retry).postDataJSON() as SimulationOpen;
  expect(identity).toEqual(pending);
  expect((await loaded(page,identity)).state).toEqual(accepted!.state);
  await expect(panel(page)).toHaveAttribute('data-elapsed-days','0');
});

test('failure to remember a new game keeps the current civilization and save reference', async ({ page }) => {
  await fresh(page);
  const old=await start(page);
  let opens=0;
  page.on('request', request => { if(request.url().endsWith('/api/simulation/open')) opens++; });
  await page.evaluate(() => { Storage.prototype.setItem=function() { throw new Error('Storage unavailable'); }; });
  await page.getByRole('button', { name:'New game', exact:true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('remember');
  await expect(panel(page)).toHaveAttribute('data-instance-id',old.identity.instanceId);
  await expect(page.locator('#generated-world-canvas')).toHaveAttribute('data-civilization-id',old.view.state.tribe.id);
  expect(opens).toBe(0);
  const saved=await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), `chronicle:world-session:${old.view.state.worldKey}`);
  expect(saved.id).toBe(old.identity.instanceId);
  await page.reload();
  await expect(panel(page)).toHaveAttribute('data-instance-id',old.identity.instanceId);
  await expect(panel(page)).toHaveAttribute('data-elapsed-days','0');
});

test('replacing a running game ignores its late observation and leaves its former save inactive', async ({ page }, testInfo) => {
  await fresh(page);
  const old=await start(page);
  await page.getByRole('button', { name:'Play', exact:true }).click();
  await expect(page.getByRole('button', { name:'Pause', exact:true })).toBeEnabled();
  let unblock!: () => void, arrived=false, finished=false, newPolls=0;
  const held=new Promise<void>(resolve => { unblock=resolve; });
  await page.route('**/api/simulation/observe', async route => {
    if(route.request().postDataJSON().instanceId!==old.identity.instanceId) { newPolls++; await route.continue(); return; }
    const response=await route.fetch();
    expect((await response.json() as SimulationView).state.running).toBe(true);
    arrived=true; await held;
    await route.fulfill({ response }); finished=true;
  });
  await expect.poll(() => arrived).toBe(true);
  const released=page.waitForResponse(response => response.url().endsWith('/api/simulation/release') && response.request().postDataJSON().instanceId===old.identity.instanceId);
  const next=await start(page);
  expect((await released).ok()).toBe(true);
  // Read without observing: /observe would attach a lease and resume the old game.
  const db=new DatabaseSync(join('test-results','saves',testInfo.project.name,'simulation.sqlite'), { readOnly:true, timeout:1000 });
  try {
    const checkpoint=() => db.prepare('SELECT current FROM checkpoints WHERE id = ?').get(old.identity.instanceId)!.current;
    const previous=checkpoint();
    expect(JSON.parse(previous as string).id).toBe(old.identity.instanceId);
    unblock();
    await expect.poll(() => finished).toBe(true);
    // Two host polling intervals also give an erroneously attached old observer
    // enough time to advance: it must stay at its released checkpoint.
    await expect.poll(() => newPolls).toBeGreaterThanOrEqual(2);
    expect(checkpoint()).toBe(previous);
    await expect(panel(page)).toHaveAttribute('data-instance-id',next.identity.instanceId);
    await expect(panel(page)).toHaveAttribute('data-elapsed-days','0');
    await expect(panel(page).locator('[data-tribe-name]')).toHaveText(next.view.state.tribe.name);
    await expect(page.getByRole('button', { name:'Play', exact:true })).toBeEnabled();
  } finally { unblock(); db.close(); }
});
