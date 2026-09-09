import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { BroadcastChannel } from 'node:worker_threads';
import { test } from 'node:test';
import { createAsterIsland } from '../src/fixtures/aster-island.ts';
import {
  createTerrainCompute, ComputeClosedError, ComputeOverloadedError, ComputeTimeoutError,
} from '../server/compute.ts';

const defaults = { workers: 1, maxQueue: 1, jobTimeoutMs: 2_000, shutdownTimeoutMs: 1_000 };
const controlledWorker = new URL('./fixtures/compute-controlled.ts', import.meta.url);

test('native TypeScript workers return the shared authored terrain, independently on each job', async t => {
  const compute = createTerrainCompute(defaults);
  t.after(() => compute.close());
  await compute.ready();
  const first = JSON.parse(await compute.generate());
  assert.equal(first.protocolVersion, 1);
  assert.equal(first.world.cells.length, 27_648);
  assert.deepEqual(first.world, createAsterIsland());
  first.world.cells[0].elevation = 999;
  assert.deepEqual(JSON.parse(await compute.generate()).world, createAsterIsland());
  assert.deepEqual(compute.snapshot(), { workers: 1, active: 0, queued: 0, completed: 2, failed: 0 });
});

test('the host timer runs while a confirmed worker job is consuming CPU', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  t.after(() => channel.close());
  t.after(() => compute.close());
  await compute.ready();
  const started = once(channel, 'message');
  let finished = false;
  const job = compute.generate().finally(() => { finished = true; });
  await started;
  await delay(20);
  assert.equal(finished, false, 'main-thread timer must run before the CPU task completes');
  assert.equal(await job, 'computed');
});

test('bounded admission rejects overload and a queued cancellation frees its place', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  t.after(() => channel.close());
  t.after(() => compute.close());
  await compute.ready();
  const started = once(channel, 'message');
  const running = compute.generate();
  await started;
  const cancellation = new AbortController();
  const queued = compute.generate(cancellation.signal);
  const cancelled = assert.rejects(queued, { name: 'AbortError' });
  assert.equal(compute.snapshot().queued, 1);
  await assert.rejects(compute.generate(), ComputeOverloadedError);
  cancellation.abort();
  await cancelled;
  assert.equal(compute.snapshot().queued, 0);
  const replacement = compute.generate();
  assert.deepEqual(await Promise.all([running, replacement]), ['computed', 'computed']);
});

test('cancelling an executing disposable job rejects it and the pool accepts later work', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  t.after(() => channel.close());
  t.after(() => compute.close());
  await compute.ready();
  const started = once(channel, 'message');
  const controller = new AbortController();
  const cancelled = assert.rejects(compute.generate(controller.signal), { name: 'AbortError' });
  await started;
  controller.abort();
  await cancelled;
  assert.equal(typeof await compute.generate(), 'string');
  assert.equal(compute.snapshot().failed, 1);
});

test('the deadline includes queue wait and does not publish late CPU results', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker, jobTimeoutMs: 500 });
  t.after(() => compute.close());
  await compute.ready();
  const startedAt = performance.now();
  const jobs = [compute.generate(), compute.generate()];
  const results = await Promise.allSettled(jobs);
  assert.deepEqual(results[0], { status: 'fulfilled', value: 'computed' });
  assert.equal(results[1].status, 'rejected');
  if (results[1].status === 'rejected') assert.ok(results[1].reason instanceof ComputeTimeoutError);
  assert.ok(performance.now() - startedAt < 1_000, 'deadlines must settle without waiting for queued CPU work');
  assert.equal(compute.snapshot().completed, 1);
});

test('a task exception does not poison the next job', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: new URL('./fixtures/compute-fails-once.ts', import.meta.url) });
  t.after(() => compute.close());
  await compute.ready();
  await assert.rejects(compute.generate(), /Deliberate task failure/);
  assert.equal(await compute.generate(), 'recovered');
  assert.equal(compute.snapshot().failed, 1);
});

test('an unexpected worker exit rejects its job and a replacement accepts later work', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: new URL('./fixtures/compute-exits.ts', import.meta.url) });
  t.after(() => compute.close());
  await compute.ready();
  await assert.rejects(compute.generate(), /worker exited/);
  assert.equal(await compute.generate(), 'ready');
});

test('an already cancelled caller does not consume compute capacity', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker });
  t.after(() => compute.close());
  await compute.ready();
  await assert.rejects(compute.generate(AbortSignal.abort()), { name: 'AbortError' });
  assert.deepEqual(compute.snapshot(), { workers: 1, active: 0, queued: 0, completed: 0, failed: 0 });
});

test('readiness reports an invalid worker entrypoint instead of accepting requests', async t => {
  const compute = createTerrainCompute({ ...defaults, filename: new URL('./fixtures/compute-missing.ts', import.meta.url) });
  t.after(() => compute.close());
  await assert.rejects(compute.ready());
});

test('closing drains accepted work and rejects later jobs', async () => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker });
  await compute.ready();
  const jobs = [compute.generate(), compute.generate()];
  const closing = compute.close();
  await assert.rejects(compute.generate(), ComputeClosedError);
  assert.deepEqual(await Promise.all(jobs), ['computed', 'computed']);
  await closing;
  await compute.close();
  assert.equal(compute.snapshot().workers, 0);
});

test('shutdown aborts unfinished work at its deadline and releases all workers', async () => {
  const compute = createTerrainCompute({ ...defaults, filename: controlledWorker, shutdownTimeoutMs: 40 });
  await compute.ready();
  const running = assert.rejects(compute.generate(), ComputeClosedError);
  const queued = assert.rejects(compute.generate(), ComputeClosedError);
  await compute.close();
  await Promise.all([running, queued]);
  assert.deepEqual(compute.snapshot(), { workers: 0, active: 0, queued: 0, completed: 0, failed: 2 });
});
