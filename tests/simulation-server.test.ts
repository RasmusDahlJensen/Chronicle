import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSimulationRuntime, SIMULATION_LIMITS } from '../server/workers/simulation-runtime.ts';
import { createSimulationService, SIMULATION_RPC_LIMIT } from '../server/simulation.ts';
import { buildApp } from '../server/app.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import type { WorldStudyBundle } from '../shared/civilization.ts';
import type { SimulationCommand, SimulationState } from '../shared/simulation.ts';
import type { TerrainCompute } from '../server/compute.ts';

const input = { instanceId: '11111111-1111-4111-8111-111111111111',
  observerId: '22222222-2222-4222-8222-222222222222',
  settings: { seed: 'Chronicle', size: 'standard' as const }, placementSeed: 'Tribes 1' };
const observer = { instanceId: input.instanceId, observerId: input.observerId };
let bundlePromise: Promise<WorldStudyBundle>;
function bundle() {
  return bundlePromise ??= generateWorld(input.settings).then(world => ({ ...encodeGeneratedWorld(world),
    civilization: JSON.stringify(createCivilizationSnapshot(world)) }));
}
function command(state: SimulationState, action: SimulationCommand['action'], extra: { days?: 1 | 30; speed?: 1 | 10 } = {}): SimulationCommand {
  return { instanceId: state.id, observerId: input.observerId, incarnation: state.incarnation,
    revision: state.revision, action, ...extra };
}

test('durable commands, reset conflicts, restart and absent observers preserve one tribe without offline catch-up', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 0;
  let runtime = createSimulationRuntime({ directory, now: () => now });
  t.after(() => runtime.close());
  assert.equal(runtime.open(input), null);
  let view = runtime.initialize(input, await bundle());
  assert.equal(view.state.tribe.population, 250);
  assert.throws(() => runtime.open({ ...input, placementSeed: 'Another placement' }), /different world or placement/);
  view = runtime.command(command(view.state, 'step', { days: 30 }));
  assert.equal(view.state.elapsedDays, 30);
  const stale = command(view.state, 'step', { days: 1 });
  view = runtime.command(command(view.state, 'reset'));
  assert.equal(view.state.incarnation, 2); assert.equal(view.state.elapsedDays, 0);
  assert.throws(() => runtime.command(stale), /changed/i);
  view = runtime.command(command(view.state, 'play'));
  now += 1_000; runtime.tick();
  view = runtime.observe(observer); assert.equal(view.state.elapsedDays, 1);
  const durable = view.state;
  runtime.release(observer);
  now += 100_000; runtime.tick(); runtime.close();
  runtime = createSimulationRuntime({ directory, now: () => now });
  view = runtime.open(input)!;
  assert.deepEqual(view.state, durable); assert.equal(view.active, true);
  runtime.tick(); assert.equal(runtime.observe(observer).state.elapsedDays, 1);
  now += 1_000; runtime.tick();
  view = runtime.observe(observer); assert.equal(view.state.elapsedDays, 2);
  view = runtime.command(command(view.state, 'pause'));
  runtime.release(observer); now += 100_000;
  assert.equal(runtime.open(input)!.active, false);
  now += 1_000; runtime.tick(); assert.equal(runtime.observe(observer).state.elapsedDays, 2);
});

test('two observers share one clock, leases expire, speed is bounded, and stale or malformed commands do not mutate it', async t => {
  let now = 0;
  const runtime = createSimulationRuntime({ now: () => now }); t.after(() => runtime.close());
  let view = runtime.initialize(input, await bundle());
  const other = { ...input, observerId: '33333333-3333-4333-8333-333333333333' };
  runtime.open(other);
  view = runtime.command(command(view.state, 'speed', { speed: 10 }));
  view = runtime.command(command(view.state, 'play'));
  now = 1_000; runtime.tick();
  view = runtime.observe({ instanceId: other.instanceId, observerId: other.observerId }); assert.equal(view.state.elapsedDays, 10);
  assert.throws(() => runtime.command(command(view.state, 'step', { days: 30 })), /pause/i);
  assert.throws(() => runtime.command(command(view.state, 'pause', { days: 1 })), /Invalid/);
  runtime.release(observer); now = 2_000; runtime.tick();
  assert.equal(runtime.observe({ instanceId: other.instanceId, observerId: other.observerId }).state.elapsedDays, 20);
  now = 32_001; runtime.tick();
  const resumed = runtime.open(input)!;
  assert.equal(resumed.state.elapsedDays, 20, 'expired leases must not accrue missed ticks');
  assert.equal(resumed.active, true);
  assert.throws(() => runtime.command({ ...command(resumed.state, 'pause'), observerId: other.observerId }), /observer/i);
});

test('Pause survives a tick after observation while future revisions, expired observers and old incarnations remain rejected', async t => {
  let now = 0;
  const runtime = createSimulationRuntime({ now: () => now }); t.after(() => runtime.close());
  let view = runtime.initialize(input, await bundle());
  view = runtime.command(command(view.state, 'speed', { speed: 10 }));
  view = runtime.command(command(view.state, 'play'));
  const observed = view.state;
  now += 1_000; runtime.tick();
  const ticked = runtime.observe(observer).state;
  assert.equal(ticked.elapsedDays, 10); assert.equal(ticked.revision, observed.revision + 1);
  assert.throws(() => runtime.command({ ...command(ticked, 'pause'), revision: ticked.revision + 1 }), /changed/i);
  assert.throws(() => runtime.command(command(observed, 'step', { days: 1 })), /changed/i);
  for (const action of ['play', 'reset'] as const) assert.throws(() => runtime.command(command(observed, action)), /changed/i);
  assert.throws(() => runtime.command(command(observed, 'speed', { speed: 1 })), /changed/i);
  view = runtime.command(command(observed, 'pause'));
  assert.equal(view.state.running, false); assert.equal(view.active, false);
  assert.equal(view.state.revision, ticked.revision + 1);
  assert.equal(view.state.elapsedDays, 10);
  now += 1_000; runtime.tick();
  assert.deepEqual(runtime.observe(observer).state, view.state, 'the accepted pause must stop further ticks');
  const beforeReset = command(view.state, 'pause');
  view = runtime.command(command(view.state, 'reset'));
  assert.throws(() => runtime.command({ ...beforeReset, revision: view.state.revision }), /changed/i);
  runtime.release(observer);
  assert.throws(() => runtime.command(command(view.state, 'pause')), /observer/i);
});

test('a failed SQLite transaction keeps both checkpoints, suspends ticks, and an explicit retry recovers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-write-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 0;
  const runtime = createSimulationRuntime({ directory, now: () => now }); t.after(() => runtime.close());
  let view = runtime.initialize(input, await bundle());
  view = runtime.command(command(view.state, 'play'));
  const db = new DatabaseSync(join(directory, 'simulation.sqlite')); t.after(() => db.close());
  const before = db.prepare('SELECT current, previous FROM checkpoints WHERE id = ?').get(input.instanceId);
  db.exec("CREATE TRIGGER reject_write BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT, 'test disk failure'); END;");
  now = 1_000; runtime.tick();
  view = runtime.observe(observer);
  assert.equal(view.active, false); assert.match(view.error!, /save/i); assert.equal(view.state.elapsedDays, 0);
  assert.deepEqual(db.prepare('SELECT current, previous FROM checkpoints WHERE id = ?').get(input.instanceId), before);
  runtime.release(observer); now = 100_000; runtime.tick();
  assert.ok(runtime.open(input)!.error, 'failed state stays recoverable across observer departure');
  db.exec('DROP TRIGGER reject_write;');
  view = runtime.command(command(view.state, 'pause'));
  assert.equal(view.error, null);
  view = runtime.command(command(view.state, 'step', { days: 1 }));
  assert.equal(view.state.elapsedDays, 1);
});

test('one directory has one owner and corrupt current saves reject while preserving an operator-restorable previous checkpoint', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let runtime = createSimulationRuntime({ directory }); t.after(() => runtime.close());
  assert.throws(() => createSimulationRuntime({ directory }), /already|owner|use/i);
  let view = runtime.initialize(input, await bundle());
  view = runtime.command(command(view.state, 'step', { days: 30 }));
  runtime.close();
  const db = new DatabaseSync(join(directory, 'simulation.sqlite'));
  const previous = db.prepare('SELECT previous FROM checkpoints WHERE id = ?').get(input.instanceId)!.previous;
  db.prepare('UPDATE checkpoints SET current = ? WHERE id = ?').run('{broken', input.instanceId);
  db.close();
  runtime = createSimulationRuntime({ directory });
  assert.throws(() => runtime.open(input), /preserved/i); runtime.close();
  const restore = new DatabaseSync(join(directory, 'simulation.sqlite'));
  assert.equal(restore.prepare('SELECT previous FROM checkpoints WHERE id = ?').get(input.instanceId)!.previous, previous);
  restore.prepare('UPDATE checkpoints SET current = previous WHERE id = ?').run(input.instanceId); restore.close();
  runtime = createSimulationRuntime({ directory });
  assert.equal(runtime.open(input)!.state.elapsedDays, 0);
});

test('actual worker HTTP validates requests, persists commands and resumes without regenerating geography', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const encoded = JSON.stringify(await bundle()); let jobs = 0;
  const compute: TerrainCompute = { ready: async () => {}, close: async () => {},
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed: 0, failed: 0 }),
    generate: async () => { jobs++; return encoded; } };
  let app = await buildApp({ compute, simulationDirectory: directory, logger: false }); t.after(() => app.close());
  const diagnostics = (await app.inject('/api/ready')).json();
  assert.equal(diagnostics.status, 'ready'); assert.equal(diagnostics.simulation.status, 'ready');
  const post = (path: string, payload: object) => app.inject({ method: 'POST', url: `/api/simulation/${path}`, payload });
  let response = await post('open', input); assert.equal(response.statusCode, 200, response.body);
  let view = response.json();
  response = await post('command', command(view.state, 'step', { days: 30 }));
  assert.equal(response.statusCode, 200); view = response.json(); assert.equal(view.state.elapsedDays, 30);
  const stale = command(view.state, 'step', { days: 1 });
  response = await post('command', command(view.state, 'reset')); assert.equal(response.statusCode, 200);
  response = await post('command', stale); assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'CONFLICT');
  for (const payload of [{ ...input, state: view.state }, { ...input, instanceId: 'not-a-uuid' }]) {
    assert.equal((await post('open', payload)).statusCode, 400);
  }
  assert.equal((await post('command', { ...command(response.json().state ?? view.state, 'step'), days: 31 })).statusCode, 400);
  assert.equal((await app.inject('/api/simulation/open')).statusCode, 405);
  assert.deepEqual((await post('release', observer)).json(), { released: true });
  await app.close();
  app = await buildApp({ compute, simulationDirectory: directory, logger: false });
  response = await post('open', input); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().state.incarnation, 2); assert.equal(jobs, 1);
});

test('simulation service refuses new calls after a drained close', async () => {
  const service = createSimulationService({});
  assert.equal(service.snapshot().status, 'starting');
  await service.ready();
  assert.equal(service.snapshot().status, 'ready');
  const opened = service.open(input); const closed = service.close();
  assert.equal(await opened, null); await closed;
  await assert.rejects(service.observe(observer), /unavailable|closed/i);
  assert.equal(service.snapshot().pending, 0);
});

test('resident and observer bounds release capacity when durable worlds are no longer observed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-bounds-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = createSimulationRuntime({ directory }); t.after(() => runtime.close());
  const initial = runtime.initialize(input, await bundle()).state;
  const db = new DatabaseSync(join(directory, 'simulation.sqlite')); t.after(() => db.close());
  const ids = Array.from({ length: SIMULATION_LIMITS.residents }, (_, n) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`);
  for (const id of ids) db.prepare('INSERT INTO checkpoints (id, current) VALUES (?, ?)').run(id, JSON.stringify({ ...initial, id }));
  for (const id of ids.slice(0, -1)) runtime.open({ ...input, instanceId: id });
  assert.throws(() => runtime.open({ ...input, instanceId: ids.at(-1)! }), /Too many tribal worlds/);
  runtime.release(observer);
  assert.ok(runtime.open({ ...input, instanceId: ids.at(-1)! }));
  const resident = { ...input, instanceId: ids[0] };
  for (let n = 1; n < SIMULATION_LIMITS.observers; n++) runtime.open({ ...resident,
    observerId: `55555555-5555-4555-8555-${String(n).padStart(12, '0')}` });
  assert.throws(() => runtime.open({ ...resident, observerId: '66666666-6666-4666-8666-666666666666' }), /Too many observers/);
  runtime.release({ instanceId: resident.instanceId, observerId: input.observerId });
  assert.ok(runtime.open({ ...resident, observerId: '66666666-6666-4666-8666-666666666666' }));
});

test('failed first writes remain visible and recover without replacing the selected tribe', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-initial-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = createSimulationRuntime({ directory }); t.after(() => runtime.close());
  const db = new DatabaseSync(join(directory, 'simulation.sqlite')); t.after(() => db.close());
  const encoded = await bundle();
  db.exec("CREATE TRIGGER reject_initial BEFORE INSERT ON checkpoints BEGIN SELECT RAISE(ABORT, 'test disk failure'); END;");
  assert.throws(() => runtime.initialize(input, encoded), /save/i);
  const failed = runtime.observe(observer);
  assert.ok(failed.error); assert.equal(failed.active, false);
  runtime.release(observer);
  assert.deepEqual(runtime.open(input)!.state, failed.state);
  db.exec('DROP TRIGGER reject_initial;');
  const saved = runtime.command(command(failed.state, 'pause'));
  assert.equal(saved.error, null); assert.deepEqual(saved.state.tribe, failed.state.tribe);
  assert.equal(JSON.parse(db.prepare('SELECT current FROM checkpoints WHERE id = ?').get(input.instanceId)!.current as string).revision, 1);
});

test('worker admission bounds queued RPCs before readiness and drains every accepted request', async () => {
  const service = createSimulationService({});
  const accepted = Array.from({ length: SIMULATION_RPC_LIMIT }, () => service.open(input));
  await assert.rejects(service.open(input), /busy/i);
  await Promise.all(accepted); await service.close();
});

test('large initialization messages have a separate queue bound and malformed geography cannot create a save', async t => {
  const service = createSimulationService({}); t.after(() => service.close());
  const encoded = await bundle();
  const first = service.initialize(input, encoded), second = service.initialize(input, encoded);
  await assert.rejects(service.initialize(input, encoded), /busy/i);
  assert.deepEqual(await first, await second);
  const other = { ...input, instanceId: '77777777-7777-4777-8777-777777777777' };
  const swapped = { ...encoded, tiles: [...encoded.tiles] };
  [swapped.tiles[0], swapped.tiles[1]] = [swapped.tiles[1], swapped.tiles[0]];
  await assert.rejects(service.initialize(other, swapped), /suitable land|geography/i);
  assert.equal(await service.open(other), null);
});

test('an unavailable simulation owner is visible in diagnostics without disabling the map host', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-unavailable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const owner = createSimulationRuntime({ directory }); t.after(() => owner.close());
  const compute: TerrainCompute = { ready: async () => {}, close: async () => {},
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed: 0, failed: 0 }),
    generate: async () => { throw new Error('Resume must not ask for geography.'); } };
  const app = await buildApp({ compute, simulationDirectory: directory, logger: false }); t.after(() => app.close());
  const diagnostics = await app.inject('/api/ready');
  assert.equal(diagnostics.statusCode, 200); assert.equal(diagnostics.json().status, 'ready');
  assert.equal(diagnostics.json().simulation.status, 'unavailable');
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  const response = await app.inject({ method: 'POST', url: '/api/simulation/open', payload: input });
  assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'UNAVAILABLE');
  assert.equal(response.body.includes(directory), false);
});

test('concurrent real-worker commands have one winner and graceful shutdown drains its durable result', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-simulation-drain-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let service = createSimulationService({ directory }); t.after(() => service.close());
  const initial = await service.initialize(input, await bundle());
  const first = service.command(command(initial.state, 'step', { days: 30 }));
  const conflict = assert.rejects(service.command(command(initial.state, 'reset')), /changed/i);
  const closed = service.close();
  const committed = await first; await conflict; await closed;
  assert.equal(committed.state.elapsedDays, 30); assert.equal(committed.state.incarnation, 1);
  service = createSimulationService({ directory });
  assert.deepEqual((await service.open(input))!.state, committed.state);
});
