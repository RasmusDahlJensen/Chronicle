import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';
import { createSimulationHost, SimulationUnavailableError } from '../server/simulation-host.ts';
import type { WorldBundle } from '../shared/generated-world.ts';
import { parseObserverFrame, parseRegionMap } from '../shared/simulation.ts';
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
  assert.equal(arrived.runTo, null);
  assert.equal((await simulation.control({ action: 'reset' })).tick, 0);
  assert.equal((await simulation.frame(0)).instance.runId, start.instance.runId, 'a manual reset keeps the same running simulation');
  const report = await simulation.report();
  assert.equal(report.tick, 0);
  assert.deepEqual(report.timing.map(entry => entry.system).slice(0, 3), ['environment', 'production', 'population']);
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

test('simulation routes validate controls, report method errors and serve frames and region maps', async t => {
  const app = await buildApp({ logger: false, config: { ...readBackendConfig({}), workers: 1 } });
  t.after(() => app.close());
  const query = '?seed=Routes&size=standard';
  const frame = await app.inject(`/api/simulation/frame${query}&cursor=0`);
  assert.equal(frame.statusCode, 200, frame.body.slice(0, 300));
  assert.equal(frame.headers['cache-control'], 'no-store');
  assert.equal(parseObserverFrame(frame.json()).tick, 0);
  const step = await app.inject({ method: 'POST', url: `/api/simulation/control${query}`, payload: { action: 'step' } });
  assert.equal(step.statusCode, 200);
  assert.equal(parseObserverFrame(step.json()).tick, 1);
  for (const payload of [{ action: 'warp' }, { action: 'runTo', year: -1 }, { action: 'runTo', year: 5001 }, { action: 'speed', speed: 'fast' }, { action: 'step', extra: 1 }]) {
    const rejected = await app.inject({ method: 'POST', url: `/api/simulation/control${query}`, payload });
    assert.equal(rejected.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await app.inject({ method: 'GET', url: `/api/simulation/control${query}` })).statusCode, 405);
  assert.equal((await app.inject({ method: 'POST', url: `/api/simulation/frame${query}` })).statusCode, 405);
  assert.equal((await app.inject(`/api/simulation/frame${query}&cursor=-1`)).statusCode, 400);
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
