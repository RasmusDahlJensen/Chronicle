import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createTerrainServer } from '../server/terrain-server.ts';
import { createAsterIsland } from '../src/fixtures/aster-island.ts';
import { summarizeTerrain, type TerrainWorld } from '../src/world/terrain.ts';

async function listen(t: TestContext, constructWorld?: () => TerrainWorld) {
  const server = createTerrainServer(constructWorld);
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('terrain HTTP response supplies the existing complete authored island without caching', async t => {
  const origin = await listen(t);
  const response = await fetch(`${origin}/api/terrain`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.protocolVersion, 1);
  assert.deepEqual(body.world, createAsterIsland());
  assert.equal(body.world.cells.length, 27_648);
  assert.deepEqual(summarizeTerrain(body.world), {
    totalKm2: 27_648, landKm2: 9_898, waterKm2: 17_750, plainsKm2: 7_365, hillsKm2: 2_533,
  });
});

test('each terrain request reconstructs a world instead of reusing earlier mutable data', async t => {
  let constructed: TerrainWorld | undefined;
  const origin = await listen(t, () => {
    constructed = createAsterIsland();
    return constructed;
  });
  const first = await (await fetch(`${origin}/api/terrain`)).json();
  assert.ok(constructed);
  constructed.cells[0].elevation = 900;
  constructed.provinces[0].name = 'Changed after response';
  const second = await (await fetch(`${origin}/api/terrain`)).json();
  assert.deepEqual(second, first);
});

test('health, unknown routes, and unsupported methods have explicit uncached HTTP responses', async t => {
  const origin = await listen(t, () => { throw new Error('Health must not need terrain construction'); });
  for (const [path, method, status, body] of [
    ['/api/health', 'GET', 200, { status: 'ok' }],
    ['/api/missing', 'GET', 404, { error: 'Not found' }],
    ['/api/terrain', 'POST', 405, { error: 'Method not allowed' }],
    ['/api/health', 'DELETE', 405, { error: 'Method not allowed' }],
  ] as const) {
    const response = await fetch(`${origin}${path}`, { method });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get('allow'), status === 405 ? 'GET' : null);
  }
});

test('construction failure returns a safe error and the next request can recover', async t => {
  let fail = true;
  const origin = await listen(t, () => {
    if (fail) throw new Error('Sensitive implementation details');
    return createAsterIsland();
  });
  const response = await fetch(`${origin}/api/terrain`);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Unable to construct terrain' });
  fail = false;
  const recovered = await fetch(`${origin}/api/terrain`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).world.fixtureId, 'aster-island');
});
