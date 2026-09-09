import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { BroadcastChannel } from 'node:worker_threads';
import { buildApp } from '../server/app.ts';
import { createTerrainCompute } from '../server/compute.ts';
import { readBackendConfig } from '../server/config.ts';
import { parseAtlasResponse, MAX_ATLAS_BYTES } from '../shared/atlas.ts';
import { createVerdantReach } from '../src/fixtures/verdant-reach.ts';

test('the atlas endpoint returns the complete worker-built biome/resource map through the existing host', async t => {
  const app = await buildApp({ logger: false, config: { ...readBackendConfig({}), workers: 1 } });
  t.after(() => app.close());
  const response = await app.inject('/api/atlas');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(Buffer.byteLength(response.body) <= MAX_ATLAS_BYTES);
  const payload = response.json();
  assert.equal(payload.protocolVersion, 3);
  const world = parseAtlasResponse(payload);
  assert.deepEqual(world, createVerdantReach());
  assert.equal(world.cells.length, 64_000);
  assert.ok(world.cells.some(cell => cell.resource === null), 'resource-free cells survive worker serialization and HTTP');
  assert.ok(world.cells.some(cell => cell.resource === 'uranium'), 'rare sites survive the same delivery path');
  assert.equal((await app.inject('/api/terrain')).json().world.fixtureId, 'aster-island');
  const ready = (await app.inject('/api/ready')).json();
  assert.equal(ready.compute.workers, 1);
  assert.equal(ready.compute.completed, 2);
  assert.equal(ready.admitted, 0);
  assert.equal((await app.inject({ url: '/api/atlas', method: 'POST' })).statusCode, 405);
  assert.equal((await app.inject('/api/atlas?unsupported=yes')).statusCode, 400);
});

test('an active atlas request blocks terrain at shared capacity and completion admits terrain again', async t => {
  const config = { ...readBackendConfig({}), workers: 1, maxQueue: 0 };
  const compute = createTerrainCompute({
    ...config, filename: new URL('./fixtures/compute-controlled.ts', import.meta.url),
  });
  const app = await buildApp({ logger: false, config, compute });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  const cancellation = new AbortController();
  t.after(async () => {
    cancellation.abort();
    channel.close();
    await app.close();
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const started = once(channel, 'message', { signal: AbortSignal.timeout(3_000) });
  // The existing test worker signals when it begins CPU work. No sleep guesses admission.
  const active = fetch(`${origin}/api/atlas`, { signal: cancellation.signal }).then(
    async response => ({ status: response.status, body: await response.text() }),
  );
  // Consume a rejection even if an earlier assertion triggers teardown while fetch is pending.
  void active.catch(() => {});
  await started;
  const excess = await app.inject('/api/terrain');
  assert.equal(excess.statusCode, 503);
  assert.equal(excess.json().error.code, 'OVERLOADED');
  assert.equal(excess.headers['retry-after'], '1');
  assert.equal((await app.inject('/api/ready')).json().admitted, 1);
  assert.deepEqual(await active, { status: 200, body: 'computed' });
  assert.equal((await app.inject('/api/ready')).json().admitted, 0);
  const admitted = await app.inject('/api/terrain');
  assert.equal(admitted.statusCode, 200);
  assert.equal(admitted.body, 'computed');
});
