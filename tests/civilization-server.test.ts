import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.ts';
import { parseWorldManifest, parseWorldTile } from '../shared/generated-world.ts';
import { MAX_CIVILIZATION_BYTES, parseCivilizationSnapshot } from '../shared/civilization.ts';

test('one civilization travels through actual worker, shared cache, HTTP and validated geography', async t => {
  const app = await buildApp({ logger: false }); t.after(() => app.close());
  const query = '?seed=Chronicle&size=standard';
  const response = await app.inject(`/api/world/civilization${query}`);
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(Buffer.byteLength(response.body) < MAX_CIVILIZATION_BYTES);
  const world = parseWorldManifest((await app.inject(`/api/world${query}`)).json());
  const snapshot = parseCivilizationSnapshot(response.json(), world), civ = snapshot.civilizations[0];
  assert.equal(snapshot.status, 'spawned');
  const x = civ.originCellId % world.width, y = Math.floor(civ.originCellId / world.width), tx = Math.floor(x / 128), ty = Math.floor(y / 128);
  const tile = parseWorldTile((await app.inject(`/api/world/tile${query}&x=${tx}&y=${ty}`)).json(), world, tx, ty);
  const at = y % 128 * 128 + x % 128;
  assert.ok(tile.fields.fertility[at] >= 25); assert.ok(tile.fields.temperature[at] >= 50);
  assert.equal((await app.inject(`/api/world/civilization${query}`)).body, response.body);
  assert.equal((await app.inject('/api/ready')).json().compute.completed, 1);
  for (const change of [{ protocolVersion: 2 }, { spawnVersion: 3 }, { worldKey: 'other' }, { status: 'no-suitable-land' }, { civilizations: [] }, { civilizations: [civ, civ] }]) {
    assert.throws(() => parseCivilizationSnapshot({ ...snapshot, ...change }, world), /invalid/);
  }
  for (const change of [{ id: 'other' }, { color: 'red' }, { name: '' }, { originCellId: -1 }, { originCellId: world.width * world.height }, { originCellId: 0 }]) {
    assert.throws(() => parseCivilizationSnapshot({ ...snapshot, civilizations: [{ ...civ, ...change }] }, world), /invalid/);
  }
  const before = (await app.inject('/api/ready')).json().compute.completed;
  for (const path of ['/api/world/civilization?seed=', '/api/world/civilization?size=huge', '/api/world/civilization?x=1']) {
    assert.equal((await app.inject(path)).statusCode, 400);
  }
  assert.equal((await app.inject({ url: '/api/world/civilization', method: 'POST' })).statusCode, 405);
  assert.equal((await app.inject('/api/ready')).json().compute.completed, before);
});
