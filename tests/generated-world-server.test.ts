import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';
import { parseWorldManifest, parseWorldTile, inspectWorldCell, decodeWorldSurface, MAX_WORLD_MANIFEST_BYTES, MAX_WORLD_TILE_BYTES } from '../shared/generated-world.ts';

test('large generated world travels through actual workers, manifest, cache and exact cell tiles', async t => {
  const app = await buildApp({ logger: false, config: { ...readBackendConfig({}), workers: 1 } });
  t.after(() => app.close());
  const query = '?seed=Chronicle&size=large';
  const responses = await Promise.all([app.inject(`/api/world${query}`), app.inject(`/api/world${query}`)]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200, response.body.slice(0, 300));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(Buffer.byteLength(response.body) < MAX_WORLD_MANIFEST_BYTES);
  }
  assert.equal(responses[0].body, responses[1].body);
  const world = parseWorldManifest(responses[0].json());
  assert.equal(world.width * world.height, 524288);
  assert.equal(world.settings.seed, 'Chronicle');
  const tileResponse = await app.inject(`/api/world/tile${query}&x=4&y=2`);
  assert.equal(tileResponse.statusCode, 200);
  assert.ok(Buffer.byteLength(tileResponse.body) < MAX_WORLD_TILE_BYTES);
  const tile = parseWorldTile(tileResponse.json(), world, 4, 2);
  const surface = decodeWorldSurface(world.surface);
  for (let at = 0; at < tile.width * tile.height; at++) {
    const id = (tile.y * 128 + Math.floor(at / 128)) * world.width + tile.x * 128 + at % 128;
    assert.equal(tile.fields.elevation[at], surface.elevation[id]);
    assert.equal(tile.fields.biome[at], surface.biome[id]);
  }
  const cell = inspectWorldCell(world, tile, 512, 256);
  assert.equal(cell.id, 262656);
  // The revised seed can put a cold mountain at this equatorial coordinate.
  // Check the inspection contract against its actual cell instead of assuming sea level.
  assert.equal(cell.temperature, tile.fields.temperature[0] / 10);
  assert.equal(cell.moisture, tile.fields.moisture[0] / 1000);
  assert.equal(cell.elevation, tile.fields.elevation[0]);
  assert.equal(cell.y, 256);
  const ready = (await app.inject('/api/ready')).json();
  assert.equal(ready.compute.completed, 1, 'manifest requests and tile requests reuse one bounded generation');
  assert.equal(ready.admitted, 0);
  assert.equal((await app.inject('/api/atlas')).json().world.fixtureId, 'verdant-reach');
});

test('world routes reject malformed and out-of-range inputs before consuming compute', async t => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  for (const url of [
    '/api/world?size=huge', '/api/world?seed=', '/api/world?seed=%2Fetc', '/api/world?extra=true',
    '/api/world/tile?size=standard&x=4&y=0', '/api/world/tile?x=8&y=0', '/api/world/tile?x=-1&y=0',
    '/api/world/tile?x=0.5&y=0', '/api/world/tile?x=0', '/api/world/tile?size=standard&x=0&y=2',
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, 'INVALID_REQUEST');
  }
  for (const url of ['/api/world', '/api/world/tile']) assert.equal((await app.inject({ url, method: 'POST' })).statusCode, 405);
  assert.equal((await app.inject('/api/ready')).json().compute.completed, 0);
});

test('cache eviction and host restarts reproduce the same seed and climate', async t => {
  const app = await buildApp({ logger: false, config: { ...readBackendConfig({}), workers: 1 } });
  t.after(() => app.close());
  const first = await app.inject('/api/world?seed=Repeat&size=standard');
  assert.equal(first.statusCode, 200);
  for (const seed of ['Second', 'Third']) assert.equal((await app.inject(`/api/world?seed=${seed}&size=standard`)).statusCode, 200);
  assert.equal((await app.inject('/api/world?seed=Repeat&size=standard')).body, first.body);
  assert.equal((await app.inject('/api/ready')).json().compute.completed, 4);
  await app.close();
  const restarted = await buildApp({ logger: false, config: { ...readBackendConfig({}), workers: 1 } });
  t.after(() => restarted.close());
  assert.equal((await restarted.inject('/api/world?seed=Repeat&size=standard')).body, first.body);
});
