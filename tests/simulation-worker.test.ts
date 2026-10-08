import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkpointPath, openCheckpointStore } from '../server/workers/checkpoints.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';
import { createSimulationHost, SimulationUnavailableError } from '../server/simulation-host.ts';
import type { WorldBundle } from '../shared/generated-world.ts';
import { parseChroniclePage, parseObserverFrame, parseRegionMap } from '../shared/simulation.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

let bundle: Promise<WorldBundle> | undefined;
const world = () => bundle ??= generateWorld({ seed: 'Worker clock', size: 'standard' }).then(encodeGeneratedWorld);
const settings = { seed: 'Worker clock', size: 'standard' } as const;

test('the dedicated worker steps, plays, pauses, runs to a year and resets its clock', async t => {
  const host = createSimulationHost({ loadWorld: world });
  t.after(() => host.close());
  const simulation = await host.attach(settings);
  const start = parseObserverFrame(await simulation.frame(0));
  assert.equal(start.tick, 0);
  assert.equal(start.instance.worldKey, 'climate-6:standard:Worker clock');
  assert.equal(start.counters.regions, parseRegionMap(await simulation.regions()).map.regions.length);
  assert.equal((await simulation.control({ action: 'step' })).tick, 1, 'a step is exactly one month');
  await simulation.control({ action: 'speed', speed: 'decade' });
  assert.equal((await simulation.control({ action: 'play' })).playing, true);
  await delay(600);
  const paused = await simulation.control({ action: 'pause' });
  assert.equal(paused.playing, false);
  assert.ok(paused.tick >= 30 && paused.tick <= 120, `ten years per second for about 0.6 s, got ${paused.tick - 1} months`);
  await delay(300);
  assert.equal((await simulation.frame(0)).tick, paused.tick, 'paused time stays still');
  assert.equal(await simulation.runTo(250), 3000, 'run to year stops at January of that year');
  const arrived = await simulation.frame(0);
  assert.equal(arrived.playing, false);
  // U.1: the frame names every polity acting in its events, so they read "the Vraye", not "#12".
  const named = new Set(arrived.names.map(([id]) => id));
  assert.ok(arrived.events.length > 0 && arrived.events.every(event => event.actors.every(actor => named.has(actor.id))), 'every actor named');
  assert.ok(arrived.names.every(([, name]) => name.length > 0));
  // U.2: an inspected people's own chronicle comes with the frame, its actors named; a reset starts it again.
  const actor = arrived.events.filter(event => event.importance >= 0.05 && event.tick > 0).flatMap(event => event.actors.map(entry => entry.id)).find(id => arrived.markers.ids.includes(id))!;
  const home = arrived.markers.regions[arrived.markers.ids.indexOf(actor)];
  const inspected = parseObserverFrame(await simulation.frame(0, home)), own = inspected.inspect!.polity!;
  assert.equal(own.id, actor);
  assert.ok(own.history.some(entry => entry.event.tick > 0), 'its events since year 0');
  const known = new Set(inspected.names.map(([id]) => id));
  assert.ok(own.history.every(entry => entry.event.actors.every(entry => known.has(entry.id))), 'its history\'s actors are named');
  assert.equal(arrived.runTo, null);
  assert.deepEqual(arrived.dev, { actions: 0, refused: null, checkpoints: null, loadedFrom: null });
  // Development controls (Dev 02): a scenario trigger acts now, between months, and the frame says the history was altered.
  const band = arrived.markers.regions[arrived.markers.kinds.indexOf(0)];
  const altered = parseObserverFrame(await simulation.control({ action: 'scenario', scenario: 'drought', region: band }, arrived.eventCount));
  assert.equal(altered.tick, arrived.tick, 'no month passes');
  assert.deepEqual(altered.dev, { actions: 1, refused: null, checkpoints: null, loadedFrom: null });
  assert.deepEqual(altered.events.slice(0, 2).map(event => event.type), ['devScenario', 'drought']);
  const refused = await simulation.control({ action: 'scenario', scenario: 'foundReligion', region: band });
  assert.match(refused.dev.refused ?? '', /tribe/);
  assert.equal(refused.dev.actions, 1, 'a refused control changes nothing');
  assert.equal(refused.eventCount, altered.eventCount);
  assert.equal((await simulation.control({ action: 'reset' })).tick, 0);
  const again = parseObserverFrame(await simulation.frame(0, home)).inspect?.polity;
  assert.ok(!again || again.history.every(entry => entry.event.tick === 0), 'a reset history holds none of the old one');
  assert.deepEqual((await simulation.frame(0)).dev, { actions: 0, refused: null, checkpoints: null, loadedFrom: null }, 'a reset history is unaltered again');
  assert.match((await simulation.control({ action: 'load', year: 100 })).dev.refused ?? '', /keeps no checkpoints/, 'without checkpoints Load year says why');
  assert.equal((await simulation.frame(0)).instance.runId, start.instance.runId, 'a manual reset keeps the same running simulation');
  const report = await simulation.report();
  assert.equal(report.tick, 0);
  assert.deepEqual(report.timing.map(entry => entry.system).slice(0, 3), ['environment', 'production', 'population']);
});

test('Load year restores a kept checkpoint, runs on to the year and keeps it (development tooling)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-lab-checkpoints-'));
  const host = createSimulationHost({ loadWorld: world, checkpoints: root });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const simulation = await host.attach(settings);
  assert.deepEqual((await simulation.frame(0)).dev.checkpoints, []);
  // A history left to its rules keeps a checkpoint every 250 years.
  assert.equal(await simulation.runTo(260), 3120);
  const kept = async (year: number) => { for (let wait = 0; wait < 100 && !(await simulation.frame(0)).dev.checkpoints?.includes(year); wait++) await delay(100); return (await simulation.frame(0)).dev.checkpoints; };
  assert.deepEqual(await kept(250), [250]);
  const original = parseObserverFrame(await simulation.frame(0));
  // Altered, then loaded: the checkpoint at 250 is restored (a new epoch, unaltered) and the history runs on to 255.
  await simulation.control({ action: 'scenario', scenario: 'drought', region: original.markers.regions[0] });
  const loading = parseObserverFrame(await simulation.control({ action: 'load', year: 255 }));
  assert.equal(loading.epoch, original.epoch + 1);
  assert.deepEqual({ actions: loading.dev.actions, loadedFrom: loading.dev.loadedFrom, refused: loading.dev.refused }, { actions: 0, loadedFrom: 250, refused: null });
  for (let wait = 0; wait < 200 && (await simulation.frame(0)).tick < 255 * 12; wait++) await delay(50);
  const loaded = parseObserverFrame(await simulation.frame(0));
  assert.equal(loaded.tick, 255 * 12);
  assert.equal(loaded.playing, false, 'it stops at the year');
  assert.deepEqual(await kept(255), [250, 255], 'the year it ran to is kept too');
  // Loading an earlier year than the history restores from year 0 when no checkpoint is earlier.
  const early = parseObserverFrame(await simulation.control({ action: 'load', year: 10 }));
  assert.equal(early.dev.loadedFrom, null);
  assert.equal(early.epoch, loaded.epoch + 1);
  for (let wait = 0; wait < 200 && (await simulation.frame(0)).tick < 120; wait++) await delay(50);
  assert.equal((await simulation.frame(0)).tick, 120);
});

test('Load year sets aside a checkpoint it cannot use and runs from year 0 instead', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-lab-checkpoints-'));
  // A damaged checkpoint at year 100 of this world, from this code.
  const store = openCheckpointStore(root, settings.seed, settings.size);
  mkdirSync(dirname(checkpointPath(store, 100)), { recursive: true });
  writeFileSync(checkpointPath(store, 100), 'not a checkpoint');
  const host = createSimulationHost({ loadWorld: world, checkpoints: root });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const simulation = await host.attach(settings);
  await simulation.control({ action: 'step' });
  assert.deepEqual((await simulation.frame(0)).dev.checkpoints, [100]);
  const loading = parseObserverFrame(await simulation.control({ action: 'load', year: 110 }));
  assert.equal(loading.dev.loadedFrom, null);
  assert.match(loading.dev.refused ?? '', /^The checkpoint at year 100 could not be used, so this history runs from year 0/);
  assert.deepEqual(loading.dev.checkpoints, [], 'it is no longer offered');
  for (let wait = 0; wait < 200 && (await simulation.frame(0)).tick < 110 * 12; wait++) await delay(50);
  assert.equal((await simulation.frame(0)).tick, 110 * 12, 'the simulation lives on');
});

test('the host reuses a world\'s simulation, bounds live workers and replaces a stopped worker at year 0', async t => {
  const other = generateWorld({ seed: 'Worker other', size: 'standard' }).then(encodeGeneratedWorld);
  const host = createSimulationHost({ loadWorld: async request => request.seed === 'Worker other' ? other : world(), maxInstances: 1 });
  t.after(() => host.close());
  const first = await host.attach(settings);
  assert.equal(await host.attach(settings), first, 'another observer attaches to the same simulation');
  await first.control({ action: 'step' });
  await host.attach({ seed: 'Worker other', size: 'standard' });
  assert.deepEqual(host.snapshot(), { instances: 1, maxInstances: 1 });
  assert.ok(first.failed, 'the least recently used simulation stops when the bound is reached');
  const again = await host.attach(settings);
  assert.notEqual(again, first);
  const frame = await again.frame(0);
  assert.equal(frame.tick, 0, 'a replaced simulation starts again at year 0');
  assert.notEqual(frame.instance.runId, first.instance?.runId, 'observers can tell that the run restarted');
  await again.close();
  await assert.rejects(again.frame(0), /closed/);
  const replaced = await host.attach(settings);
  assert.notEqual(replaced, again);
  assert.equal((await replaced.frame(0)).tick, 0);
});

test('simulation routes validate controls, report method errors and serve frames, chronicle pages and region maps', async t => {
  const app = await buildApp({ logger: false, config: { ...readBackendConfig({ CHRONICLE_CHECKPOINTS: 'off' }), workers: 1 } });
  t.after(() => app.close());
  const query = '?seed=Routes&size=standard';
  const frame = await app.inject(`/api/simulation/frame${query}&cursor=0`);
  assert.equal(frame.statusCode, 200, frame.body.slice(0, 300));
  assert.equal(frame.headers['cache-control'], 'no-store');
  assert.equal(parseObserverFrame(frame.json()).tick, 0);
  const step = await app.inject({ method: 'POST', url: `/api/simulation/control${query}`, payload: { action: 'step' } });
  assert.equal(step.statusCode, 200);
  assert.equal(parseObserverFrame(step.json()).tick, 1);
  for (const payload of [{ action: 'warp' }, { action: 'runTo', year: -1 }, { action: 'runTo', year: 5001 }, { action: 'speed', speed: 'fast' }, { action: 'step', extra: 1 },
    { action: 'scenario', scenario: 'plague', region: 0 }, { action: 'scenario', scenario: 'drought' }, { action: 'scenario', scenario: 'drought', region: -1 }, { action: 'load', year: -1 }]) {
    const rejected = await app.inject({ method: 'POST', url: `/api/simulation/control${query}`, payload });
    assert.equal(rejected.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await app.inject({ method: 'GET', url: `/api/simulation/control${query}` })).statusCode, 405);
  assert.equal((await app.inject({ method: 'POST', url: `/api/simulation/frame${query}` })).statusCode, 405);
  assert.equal((await app.inject(`/api/simulation/frame${query}&cursor=-1`)).statusCode, 400);
  // U.5: pages of the chronicle, read backward with filters; unknown types and bad sizes are refused.
  const page = await app.inject(`/api/simulation/chronicle${query}&limit=5&types=bandSpawned`);
  assert.equal(page.statusCode, 200, page.body.slice(0, 300));
  const read = parseChroniclePage(page.json());
  assert.ok(read.events.length === 5 && read.events.every(event => event.type === 'bandSpawned'));
  assert.ok(read.events.every(event => event.actors.every(actor => read.names.some(([id]) => id === actor.id))), 'its peoples are named');
  const older = parseChroniclePage((await app.inject(`/api/simulation/chronicle${query}&limit=5&types=bandSpawned&before=${read.next}`)).json());
  assert.equal(older.events.length, 5);
  assert.ok(older.events.every(event => event.id < read.events[4].id));
  for (const bad of ['&types=nothing', '&limit=0', '&limit=201', '&min=2', '&before=-1', '&polity=x']) assert.equal((await app.inject(`/api/simulation/chronicle${query}${bad}`)).statusCode, 400, bad);
  assert.equal((await app.inject({ method: 'POST', url: `/api/simulation/chronicle${query}` })).statusCode, 405);
  const regions = await app.inject(`/api/simulation/regions${query}`);
  assert.equal(regions.statusCode, 200);
  const { map, cells } = parseRegionMap(regions.json());
  assert.equal(map.worldKey, 'climate-6:standard:Routes');
  const world = await app.inject(`/api/world${query}`);
  assert.equal(cells.filter(value => value > 0).length, world.json().landCells, 'every land cell of the served world has a region');
  const ready = (await app.inject('/api/ready')).json();
  assert.equal(ready.simulation.instances, 1);
  assert.equal(ready.compute.completed, 1, 'the simulation reuses the generation the map was served from');
});

test('after a crash, concurrent observers share one replacement simulation and in-flight requests get 503-class errors', async t => {
  const host = createSimulationHost({ loadWorld: world, maxInstances: 2 });
  t.after(() => host.close());
  const first = await host.attach(settings);
  const pending = first.frame(0);
  // Simulate a crash: the worker thread ends while a request is in flight.
  await (first as unknown as { worker: { terminate(): Promise<number> } }).worker.terminate();
  await assert.rejects(pending, (error: Error) => error instanceof SimulationUnavailableError);
  assert.ok(first.failed);
  const [a, b] = await Promise.all([host.attach(settings), host.attach(settings)]);
  assert.equal(a, b, 'both observers attach to the same replacement');
  assert.notEqual(a, first);
  assert.equal((await a.frame(0)).tick, 0);
  assert.deepEqual(host.snapshot(), { instances: 1, maxInstances: 2 });
});

test('a world whose simulation cannot start is refused for a while instead of being rebuilt on every poll', async t => {
  let loads = 0;
  const host = createSimulationHost({
    loadWorld: async () => { loads++; const real = await world(); return { manifest: real.manifest, tiles: real.tiles.slice(1) }; },
    failureBackoffMs: 60_000,
  });
  t.after(() => host.close());
  await assert.rejects(host.attach(settings), (error: Error) => error instanceof SimulationUnavailableError && /every geography tile/.test(error.message));
  await assert.rejects(host.attach(settings), /every geography tile/);
  assert.equal(loads, 1, 'the second request is refused without decoding the world again');
});

test('two independent workers produce the same history for the same world and seed', async t => {
  const reports = await Promise.all([0, 1].map(async () => {
    const host = createSimulationHost({ loadWorld: world });
    t.after(() => host.close());
    const simulation = await host.attach(settings);
    assert.equal(await simulation.runTo(120), 1440);
    return simulation.report(true);
  }));
  assert.equal(reports[0].stateHash, reports[1].stateHash);
  assert.equal(reports[0].eventLogHash, reports[1].eventLogHash);
  assert.deepEqual(reports[0].partition, reports[1].partition);
  assert.deepEqual(reports[0].events, reports[1].events);
});

test('simulation routes stay within their own admission limit and release slots after failures', async t => {
  const { default: Fastify } = await import('fastify');
  const { registerSimulationRoutes } = await import('../server/simulation-routes.ts');
  const app = Fastify();
  t.after(() => app.close());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const fakeHost = {
    attach: async () => { await held; throw new SimulationUnavailableError('stopped'); },
    snapshot: () => ({ instances: 0, maxInstances: 1 }), close: async () => {},
  } as unknown as Parameters<typeof registerSimulationRoutes>[1];
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof SimulationUnavailableError ? 503 : 500).send({ message: (error as Error).message }));
  const routes = registerSimulationRoutes(app, fakeHost, 1);
  await app.ready();
  const first = app.inject('/api/simulation/frame?seed=Admission&size=standard');
  await delay(50);
  const second = await app.inject('/api/simulation/frame?seed=Admission&size=standard');
  assert.equal(second.statusCode, 503);
  assert.equal(second.json().error.code, 'OVERLOADED');
  assert.equal(routes.snapshot().admitted, 1);
  release();
  assert.equal((await first).statusCode, 503, 'a stopped simulation answers 503, not 500');
  assert.equal(routes.snapshot().admitted, 0, 'the slot is released after a failure');
});
