import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { test, type TestContext } from 'node:test';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';
import { createTerrainCompute, type TerrainCompute } from '../server/compute.ts';
import { MAX_WORLD_BUNDLE_BYTES, type WorldSettings } from '../shared/generated-world.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

const config = { ...readBackendConfig({}), workers: 1, maxQueue: 0 };
const controlledWorker = new URL('./fixtures/compute-controlled.ts', import.meta.url);
async function appFor(t: TestContext, compute?: TerrainCompute) {
  const app = await buildApp({ config, compute, logger: false });
  t.after(() => app.close());
  return app;
}

// Host contract tests answer world jobs with a real bundle from the shared generator and encoder,
// built once in this process, so the store's validation runs without a multi-second job per request.
const fixture: WorldSettings = { seed: 'Repeat', size: 'standard' };
const fixtureQuery = `seed=${fixture.seed}&size=${fixture.size}`;
let encoded: Promise<string> | undefined;
function fixtureBundle() {
  return encoded ??= generateWorld(fixture).then(world => JSON.stringify(encodeGeneratedWorld(world)));
}

/** A host-only stand-in for compute that answers each requested job with a fixed body and counts it. */
function fixedCompute(body: string) {
  const jobs: unknown[] = [];
  const compute: TerrainCompute = {
    ready: async () => {}, close: async () => {},
    generate: async (_signal, study) => { jobs.push(study); return body; },
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed: jobs.length, failed: 0 }),
  };
  return { compute, jobs };
}

/** Keep a fixture worker's actual CPU work, cancellation and deadline, then answer with the real bundle. */
function withFixtureBundle(compute: TerrainCompute, body: string): TerrainCompute {
  return { ...compute, generate: async (signal, study) => { await compute.generate(signal, study); return body; } };
}

test('API responses carry a fresh request ID, a JSON content type and no caching; world bodies are sent verbatim', async t => {
  const body = await fixtureBundle();
  const bundle = JSON.parse(body) as { manifest: string; tiles: string[] };
  const { compute, jobs } = fixedCompute(body);
  const app = await appFor(t, compute);
  for (const [url, expected] of [
    ['/api/health', JSON.stringify({ status: 'ok' })],
    [`/api/world?${fixtureQuery}`, bundle.manifest],
    [`/api/world/tile?${fixtureQuery}&x=3&y=1`, bundle.tiles[1 * 4 + 3]],
  ] as const) {
    const response = await app.inject({ url, headers: { 'x-request-id': 'untrusted-client-id' } });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(String(response.headers['x-request-id']), /^[\da-f-]{36}$/);
    assert.equal(response.body, expected);
    const repeat = await app.inject(url);
    assert.equal(repeat.body, expected);
    assert.notEqual(repeat.headers['x-request-id'], response.headers['x-request-id']);
  }
  assert.deepEqual(jobs, [{ kind: 'world', ...fixture }], 'manifest and tile requests reuse one stored generation');
});

test('health, readiness, unknown routes, unsupported methods and queries have explicit contracts', async t => {
  const app = await appFor(t);
  assert.deepEqual((await app.inject('/api/health')).json(), { status: 'ok' });
  const ready = await app.inject('/api/ready');
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, 'ready');
  for (const [url, method, status, code] of [
    ['/api/missing', 'GET', 404, 'NOT_FOUND'],
    ['/api/world', 'POST', 405, 'METHOD_NOT_ALLOWED'],
    ['/api/world/tile', 'PUT', 405, 'METHOD_NOT_ALLOWED'],
    ['/api/health', 'DELETE', 405, 'METHOD_NOT_ALLOWED'],
    ['/api/health?x=1', 'GET', 400, 'INVALID_REQUEST'],
    ['/api/world?extra=true', 'GET', 400, 'INVALID_REQUEST'],
    ['/api/world/tile?size=standard&x=4&y=0', 'GET', 400, 'INVALID_REQUEST'],
  ] as const) {
    const response = await app.inject({ url, method });
    assert.equal(response.statusCode, status, `${method} ${url}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().error.code, code);
    assert.equal(response.json().error.requestId, response.headers['x-request-id']);
    assert.equal(response.headers.allow, status === 405 ? 'GET' : undefined);
  }
  assert.equal((await app.inject('/api/ready')).json().compute.completed, 0, 'rejected requests must not consume compute');
});

test('unexpected compute failures and invalid worker bundles are safe for clients and a later request can recover', async t => {
  const body = await fixtureBundle();
  const failures: (() => Promise<string>)[] = [
    () => { throw new Error('Sensitive implementation details'); },
    async () => 'Sensitive worker output that is not a world bundle',
  ];
  let completed = 0;
  const app = await appFor(t, {
    ready: async () => {}, close: async () => {},
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed, failed: 0 }),
    generate: (_signal, study) => {
      assert.deepEqual(study, { kind: 'world', ...fixture });
      const fail = failures.shift();
      if (fail) return fail();
      completed++;
      return Promise.resolve(body);
    },
  });
  for (const attempt of ['thrown', 'invalid bundle']) {
    const failure = await app.inject(`/api/world?${fixtureQuery}`);
    assert.equal(failure.statusCode, 500, attempt);
    assert.equal(failure.json().error.code, 'INTERNAL_ERROR');
    assert.ok(!failure.body.includes('Sensitive'), attempt);
  }
  const recovered = await app.inject(`/api/world?${fixtureQuery}`);
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body, JSON.parse(body).manifest);
  assert.equal(completed, 1);
});

test('HTTP health responds during real worker CPU work, excess admission is rejected, and disconnect frees capacity', async t => {
  const body = await fixtureBundle();
  const compute = createTerrainCompute({ ...config, filename: controlledWorker });
  const app = await appFor(t, withFixtureBundle(compute, body));
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const channel = new BroadcastChannel(`chronicle-compute-test-${process.pid}`);
  t.after(() => channel.close());
  const started = once(channel, 'message');
  const cancel = new AbortController();
  let finished = false;
  const world = fetch(`${origin}/api/world?${fixtureQuery}`, { signal: cancel.signal }).then(
    response => { finished = true; return response; }, error => error,
  );
  await started;
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(finished, false, 'health must respond before CPU generation finishes');
  // Admission precedes the world store, so another seed and a tile of the running world are both refused.
  for (const url of ['/api/world?seed=Second&size=standard', `/api/world/tile?${fixtureQuery}&x=0&y=0`]) {
    const overload = await fetch(`${origin}${url}`);
    assert.equal(overload.status, 503, url);
    assert.equal((await overload.json()).error.code, 'OVERLOADED');
    assert.equal(overload.headers.get('retry-after'), '1');
  }
  assert.equal((await fetch(`${origin}/api/ready`)).status, 503);
  cancel.abort();
  await world;
  const deadline = Date.now() + 2_000;
  while ((await app.inject('/api/ready')).statusCode !== 200) {
    assert.ok(Date.now() < deadline, 'disconnected request retained admission');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const readmitted = await app.inject(`/api/world?${fixtureQuery}`);
  assert.equal(readmitted.statusCode, 200);
  assert.equal(readmitted.body, JSON.parse(body).manifest);
});

test('a generation deadline has a retryable HTTP response and leaves health usable', async t => {
  const options = { ...config, filename: controlledWorker };
  const compute = createTerrainCompute(options);
  t.after(() => compute.close());
  const app = await appFor(t, compute);
  // Bootstrap uses the normal deadline; only the actual HTTP job gets 100 ms.
  options.jobTimeoutMs = 100;
  const response = await app.inject('/api/world?seed=Deadline&size=standard');
  assert.equal(response.statusCode, 504);
  assert.equal(response.json().error.code, 'COMPUTE_TIMEOUT');
  assert.equal(response.headers['retry-after'], '1');
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  assert.equal((await app.inject('/api/ready')).json().admitted, 0);
});

test('a completed result held by a slow reader retains admission until its connection closes', async t => {
  // Insignificant JSON whitespace keeps the real manifest valid for the store while making the
  // response larger than loopback socket buffers can absorb without a reader.
  const bundle = JSON.parse(await fixtureBundle()) as { manifest: string; tiles: string[] };
  const manifest = bundle.manifest.padEnd(12 * 1024 * 1024, ' ');
  const body = JSON.stringify({ ...bundle, manifest });
  assert.ok(Buffer.byteLength(body) < MAX_WORLD_BUNDLE_BYTES);
  const { compute, jobs } = fixedCompute(body);
  const app = await appFor(t, compute);
  const origin = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  const socket = connect({ host: origin.hostname, port: Number(origin.port) });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  // Keep the client read stream paused; the large valid response exceeds its receive window.
  socket.write(`GET /api/world?${fixtureQuery} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  const deadline = Date.now() + 2_000;
  while (jobs.length === 0) {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await app.inject('/api/ready')).statusCode, 503);
  assert.equal((await app.inject(`/api/world?${fixtureQuery}`)).statusCode, 503);
  assert.equal((await app.inject(`/api/world/tile?${fixtureQuery}&x=0&y=0`)).statusCode, 503);
  assert.equal(jobs.length, 1);
  socket.destroy();
  while ((await app.inject('/api/ready')).statusCode !== 200) {
    assert.ok(Date.now() < deadline, 'closed reader retained admission');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const readmitted = await app.inject(`/api/world?${fixtureQuery}`);
  assert.equal(readmitted.statusCode, 200);
  assert.equal(readmitted.body, manifest);
  assert.equal(jobs.length, 1, 'the completed world stays cached for the next admitted reader');
});
