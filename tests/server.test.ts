import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { test, type TestContext } from 'node:test';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';
import { createTerrainCompute, type TerrainCompute } from '../server/compute.ts';
import { createAsterIsland } from '../src/fixtures/aster-island.ts';
import { summarizeTerrain } from '../src/world/terrain.ts';

const config = { ...readBackendConfig({}), workers: 1, maxQueue: 0 };
async function appFor(t: TestContext, compute?: TerrainCompute) {
  const app = await buildApp({ config, compute, logger: false });
  t.after(() => app.close());
  return app;
}

test('terrain HTTP supplies the complete authored island with a fresh request ID and no caching', async t => {
  const app = await appFor(t);
  const response = await app.inject({ url: '/api/terrain', headers: { 'x-request-id': 'untrusted-client-id' } });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-type']), /^application\/json/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(String(response.headers['x-request-id']), /^[\da-f-]{36}$/);
  const body = response.json();
  assert.equal(body.protocolVersion, 1);
  assert.deepEqual(body.world, createAsterIsland());
  assert.deepEqual(summarizeTerrain(body.world), {
    totalKm2: 27_648, landKm2: 9_898, waterKm2: 17_750, plainsKm2: 7_365, hillsKm2: 2_533,
  });
  body.world.cells[0].elevation = 900;
  const reset = await app.inject('/api/terrain');
  assert.deepEqual(reset.json().world, createAsterIsland());
  assert.notEqual(reset.headers['x-request-id'], response.headers['x-request-id']);
});

test('health, readiness, unknown routes, unsupported methods and queries have explicit contracts', async t => {
  const app = await appFor(t);
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
  const ready = await app.inject('/api/ready');
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, 'ready');
  for (const [url, method, status, code] of [
    ['/api/missing', 'GET', 404, 'NOT_FOUND'],
    ['/api/terrain', 'POST', 405, 'METHOD_NOT_ALLOWED'],
    ['/api/health', 'DELETE', 405, 'METHOD_NOT_ALLOWED'],
    ['/api/terrain?seed=unsupported', 'GET', 400, 'INVALID_REQUEST'],
  ] as const) {
    const response = await app.inject({ url, method });
    assert.equal(response.statusCode, status);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().error.code, code);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.equal(response.headers.allow, status === 405 ? 'GET' : undefined);
  }
});

test('unexpected compute failure is safe for clients and a later request can recover', async t => {
  const compute = createTerrainCompute(config);
  t.after(() => compute.close());
  let fail = true;
  const app = await appFor(t, { ...compute, generate: signal => {
    if (fail) throw new Error('Sensitive implementation details');
    return compute.generate(signal);
  } });
  const failure = await app.inject('/api/terrain');
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.json().error.code, 'INTERNAL_ERROR');
  assert.ok(!failure.body.includes('Sensitive'));
  fail = false;
  assert.equal((await app.inject('/api/terrain')).statusCode, 200);
});

test('HTTP health responds during real worker CPU work, excess admission is rejected, and disconnect frees capacity', async t => {
  const compute = createTerrainCompute({ ...config,
    filename: new URL('./fixtures/compute-controlled.ts', import.meta.url),
  });
  const app = await appFor(t, compute);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  t.after(() => channel.close());
  const started = once(channel, 'message');
  const cancel = new AbortController();
  let finished = false;
  const terrain = fetch(`${origin}/api/terrain`, { signal: cancel.signal }).then(
    response => { finished = true; return response; }, error => error,
  );
  await started;
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(finished, false, 'health must respond before CPU generation finishes');
  const overload = await fetch(`${origin}/api/terrain`);
  assert.equal(overload.status, 503);
  assert.equal((await overload.json()).error.code, 'OVERLOADED');
  assert.equal(overload.headers.get('retry-after'), '1');
  assert.equal((await fetch(`${origin}/api/ready`)).status, 503);
  cancel.abort();
  await terrain;
  const deadline = Date.now() + 2_000;
  while ((await app.inject('/api/ready')).statusCode !== 200) {
    assert.ok(Date.now() < deadline, 'disconnected request retained admission');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await app.inject('/api/terrain')).statusCode, 200);
});

test('a generation deadline has a retryable HTTP response and leaves health usable', async t => {
  const compute = createTerrainCompute({ ...config, jobTimeoutMs: 100,
    filename: new URL('./fixtures/compute-controlled.ts', import.meta.url),
  });
  const app = await appFor(t, compute);
  const response = await app.inject('/api/terrain');
  assert.equal(response.statusCode, 504);
  assert.equal(response.json().error.code, 'COMPUTE_TIMEOUT');
  assert.equal(response.headers['retry-after'], '1');
  assert.equal((await app.inject('/api/health')).statusCode, 200);
});

test('a completed result held by a slow reader retains admission until its connection closes', async t => {
  const world = {
    ...createAsterIsland(), width: 100_000, height: 1,
    cells: Array.from({ length: 100_000 }, (_, id) => ({ id, terrain: 'water', elevation: -1, provinceId: null })),
    provinces: [],
  };
  const body = JSON.stringify({ protocolVersion: 1, world });
  let completed = 0;
  const app = await appFor(t, {
    ready: async () => {}, close: async () => {},
    generate: async () => { completed++; return body; },
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed, failed: 0 }),
  });
  const origin = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  const socket = connect({ host: origin.hostname, port: Number(origin.port) });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  // Keep the client read stream paused; the large valid response exceeds its receive window.
  socket.write('GET /api/terrain HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  const deadline = Date.now() + 2_000;
  while (completed === 0) {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await app.inject('/api/ready')).statusCode, 503);
  assert.equal((await app.inject('/api/terrain')).statusCode, 503);
  assert.equal(completed, 1);
  socket.destroy();
  while ((await app.inject('/api/ready')).statusCode !== 200) {
    assert.ok(Date.now() < deadline, 'closed reader retained admission');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await app.inject('/api/terrain')).statusCode, 200);
});
