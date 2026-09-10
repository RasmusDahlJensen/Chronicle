import test from 'node:test';
import assert from 'node:assert/strict';
import { openSimulation, observeSimulation, commandSimulation, SimulationConflictError } from '../src/api/simulation.ts';
import { WORLD_BIOMES, type WorldManifest } from '../shared/generated-world.ts';
import { MAX_SIMULATION_BYTES, type SimulationState } from '../shared/simulation.ts';

// Only the already-validated manifest's identity/surface are needed by this transport fixture.
const world = { worldKey: 'climate-5:standard:Transport', settings: { seed: 'Transport', size: 'standard' },
  surface: { width: 512, height: 256, encoding: 'elevation-i16le-biome-u8',
    data: Buffer.alloc(512 * 256 * 3, Buffer.from([100, 0, WORLD_BIOMES.indexOf('grassland')])).toString('base64') } } as WorldManifest;
const identity = { instanceId: '11111111-1111-4111-8111-111111111111', observerId: '22222222-2222-4222-8222-222222222222' };
const state: SimulationState = { protocolVersion: 1, rulesVersion: 1, id: identity.instanceId, incarnation: 1, revision: 0,
  worldKey: world.worldKey, settings: world.settings, placementSeed: 'Tribes 1',
  tribe: { id: 'civilization-1', name: 'Lorin', color: '#a34f32', originCellId: 1, population: 250 },
  elapsedDays: 0, rngState: 1, running: false, speed: 1 };
const signal = () => new AbortController().signal;

test('tribal transport accepts matching state and rejects wrong instance, placement, rules and camp surface', async t => {
  let reply: unknown = { state, active: false, error: null };
  t.mock.method(globalThis, 'fetch', async () => Response.json(reply));
  const input = { ...identity, settings: world.settings, placementSeed: 'Tribes 1' };
  assert.deepEqual((await openSimulation(input, world, signal())).state, state);
  for (const patch of [{ id: identity.observerId }, { placementSeed: 'Other' }, { rulesVersion: 2 },
    { worldKey: 'climate-5:standard:Other', settings: { seed: 'Other', size: 'standard' } }]) {
    reply = { state: { ...state, ...patch }, active: false, error: null };
    await assert.rejects(openSimulation(input, world, signal()));
  }
  reply = { state, active: true, error: null };
  await assert.rejects(openSimulation(input, world, signal()), /invalid/);
  reply = { state, active: false, error: null };
  const water = { ...world, surface: { ...world.surface,
    data: Buffer.alloc(512 * 256 * 3, Buffer.from([24, 252, 0])).toString('base64') } };
  await assert.rejects(openSimulation(input, water, signal()), /suitable land/);
});

test('tribal streaming cancels at its byte limit and a cancelled pending body cannot become a valid view', async t => {
  let cancelled = false;
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(MAX_SIMULATION_BYTES / 2)); }, cancel() { cancelled = true; },
  })));
  await assert.rejects(observeSimulation(identity, world, signal()), /too large/); assert.equal(cancelled, true);
  cancelled = false;
  mock.mock.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  const abort = new AbortController();
  const pending = observeSimulation(identity, world, abort.signal);
  const rejected = assert.rejects(pending, /could not be read/); abort.abort(); await rejected;
  assert.equal(cancelled, true);
});

test('conflicted and uncertain commands never retry themselves, preserving at-most-once user intent', async t => {
  let requests = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('', { status: 409 }); });
  const command = { ...identity, incarnation: 1, revision: 0, action: 'step' as const, days: 30 as const };
  await assert.rejects(commandSimulation(command, world, signal()), SimulationConflictError); assert.equal(requests, 1);
  mock.mock.mockImplementation(async () => { requests++; throw new Error('connection lost after submission'); });
  await assert.rejects(commandSimulation(command, world, signal()), /saved state/); assert.equal(requests, 2);
});
