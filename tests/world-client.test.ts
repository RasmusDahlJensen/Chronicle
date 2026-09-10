import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createWorldTileClient, loadGeneratedWorld } from '../src/api/generated-world.ts';
import { WORLD_BIOMES, WORLD_PROTOCOL_VERSION, WORLD_GENERATOR_VERSION, MAX_WORLD_MANIFEST_BYTES, worldKey, type WorldManifest, type WorldTile } from '../shared/generated-world.ts';

// Transport fixture: a complete, explicitly ocean-only planet, not generated geography.
function fields(count: number) {
  return { elevation: Array<number>(count).fill(-1000), temperature: Array<number>(count).fill(100),
    moisture: Array<number>(count).fill(500), biome: Array<number>(count).fill(0), resource: Array<number>(count).fill(0),
    fertility: Array<number>(count).fill(0) };
}
const manifest: WorldManifest = {
  protocolVersion: WORLD_PROTOCOL_VERSION, generatorVersion: WORLD_GENERATOR_VERSION,
  worldKey: worldKey({ seed: 'Chronicle', size: 'large' }), settings: { seed: 'Chronicle', size: 'large' },
  width: 1024, height: 512, tileSize: 128, topology: 'wrap-x', projection: 'cylindrical-equal-area', areaKm2: 510_000_000,
  hydrology: { drySinks: [] as number[], rivers: { cells: [], next: [], runoff: [] }, lakes: [] },
  landCells: 0, resourceSites: 0, biomeCounts: WORLD_BIOMES.map((_, index) => index === 0 ? 524_288 : 0),
  overview: { width: 256, height: 128, fields: fields(32768) },
  surface: { width: 1024, height: 512, encoding: 'elevation-i16le-biome-u8',
    data: Buffer.alloc(1024 * 512 * 3, Buffer.from([24, 252, 0])).toString('base64') },
};
const tileFields = fields(16384);
function tileAt(input: string | URL | Request): WorldTile {
  const url = new URL(String(input), 'http://chronicle.local');
  assert.equal(url.pathname, '/api/world/tile');
  assert.equal(url.searchParams.get('seed'), 'Chronicle');
  assert.equal(url.searchParams.get('size'), 'large');
  return { protocolVersion: WORLD_PROTOCOL_VERSION, worldKey: manifest.worldKey, x: Number(url.searchParams.get('x')), y: Number(url.searchParams.get('y')), width: 128, height: 128, fields: tileFields };
}

test('world client rejects a valid response for a different requested seed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(manifest));
  await assert.rejects(loadGeneratedWorld({ seed: 'Other', size: 'large' }, new AbortController().signal), /different world/);
});

test('world response streaming stops and cancels at the byte limit without a content length', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(MAX_WORLD_MANIFEST_BYTES / 2)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(loadGeneratedWorld(manifest.settings, new AbortController().signal), /too large/);
  assert.equal(cancelled, true);
});

test('world tile client shares requests and bounds active requests before serving the queue', async t => {
  const releases: (() => void)[] = [];
  let active = 0, maximumActive = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    active++; maximumActive = Math.max(maximumActive, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--; return Response.json(tileAt(input));
  });
  const client = createWorldTileClient(manifest); t.after(() => client.destroy());
  const first = client.request(0, 0);
  assert.equal(client.request(0, 0), first);
  const requests = [first, ...Array.from({ length: 7 }, (_, index) => client.request(index + 1, 0))];
  assert.equal(active, 4);
  while (releases.length) {
    releases.splice(0).forEach(release => release());
    await setImmediate();
  }
  const tiles = await Promise.all(requests);
  assert.equal(maximumActive, 4);
  assert.deepEqual(tiles.map(tile => tile.x), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('tile LRU retains 16 entries, refreshes access order and reloads an evicted tile', async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const tile = tileAt(input); requests.push(`${tile.x},${tile.y}`); return Response.json(tile);
  });
  const client = createWorldTileClient(manifest); t.after(() => client.destroy());
  for (let index = 0; index < 16; index++) await client.request(index % 8, Math.floor(index / 8));
  await client.request(0, 0);
  await client.request(0, 2);
  assert.equal(client.tiles.length, 16);
  assert.ok(client.tiles.some(tile => tile.x === 0 && tile.y === 0));
  assert.ok(!client.tiles.some(tile => tile.x === 1 && tile.y === 0));
  await client.request(1, 0);
  assert.equal(requests.filter(key => key === '1,0').length, 2);
});

test('a malformed tile never enters the cache and is retried only after explicit recovery', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requests++; const tile = tileAt(input);
    return Response.json(requests === 1 ? { ...tile, worldKey: worldKey({ seed: 'Other', size: 'large' }) } : tile);
  });
  const client = createWorldTileClient(manifest); t.after(() => client.destroy());
  await assert.rejects(client.request(0, 0), /invalid/);
  await assert.rejects(client.request(0, 0), /invalid/);
  assert.equal(client.tiles.length, 0); assert.equal(requests, 1);
  client.retryFailures();
  assert.equal((await client.request(0, 0)).worldKey, manifest.worldKey);
  assert.equal(requests, 2);
});

test('a validly shaped tile that contradicts the terrain surface never enters the detail cache', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requests++;
    const tile = structuredClone(tileAt(input));
    if (requests === 1) { tile.fields.elevation[0] = 100; tile.fields.biome[0] = WORLD_BIOMES.indexOf('grassland'); }
    return Response.json(tile);
  });
  const client = createWorldTileClient(manifest); t.after(() => client.destroy());
  await assert.rejects(client.request(0, 0), /invalid/);
  assert.equal(client.tiles.length, 0);
  await assert.rejects(client.request(0, 0), /invalid/);
  assert.equal(requests, 1);
  client.retryFailures();
  assert.equal((await client.request(0, 0)).fields.elevation[0], -1000);
  assert.equal(requests, 2);
});

test('destroy aborts active detail requests and rejects queued work without starting it', async t => {
  let requests = 0;
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: string, options: RequestInit) => {
    requests++; const signal = options.signal!; signals.push(signal);
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    throw new Error('unreachable');
  });
  const client = createWorldTileClient(manifest);
  const results = Promise.allSettled(Array.from({ length: 8 }, (_, x) => client.request(x, 0)));
  client.destroy();
  assert.ok((await results).every(result => result.status === 'rejected'));
  assert.equal(requests, 4); assert.ok(signals.every(signal => signal.aborted));
  await assert.rejects(client.request(0, 0), /cancelled/);
  assert.equal(client.tiles.length, 0);
});

test('current viewport tiles survive older queued completions and their pins move with the view', async t => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const tile = tileAt(input);
    if (tile.y !== 0 || tile.x >= 4) await held;
    return Response.json(tile);
  });
  const client = createWorldTileClient(manifest); t.after(() => client.destroy());
  const initialView = Array.from({ length: 4 }, (_, x) => ({ x, y: 0 }));
  client.setVisibleTiles(initialView);
  const requests = Array.from({ length: 32 }, (_, index) => client.request(index % 8, Math.floor(index / 8)));
  await Promise.all(requests.slice(0, 4));
  release(); await Promise.all(requests);
  assert.equal(client.tiles.length, 16);
  for (const cell of initialView) assert.ok(client.tiles.some(tile => tile.x === cell.x && tile.y === cell.y), 'An older offscreen completion evicted a visible tile.');

  const nextView = Array.from({ length: 4 }, (_, x) => ({ x, y: 3 }));
  client.setVisibleTiles(nextView);
  for (let index = 0; index < 20; index++) await client.request(index % 8, Math.floor(index / 8));
  assert.equal(client.tiles.length, 16);
  for (const cell of nextView) assert.ok(client.tiles.some(tile => tile.x === cell.x && tile.y === cell.y));
  for (const cell of initialView) assert.ok(!client.tiles.some(tile => tile.x === cell.x && tile.y === cell.y), 'Pins from a previous view must not keep accumulating.');

  client.setVisibleTiles([]);
  for (let index = 0; index < 24; index++) await client.request(index % 8, Math.floor(index / 8));
  assert.equal(client.tiles.length, 16);
  assert.ok(client.tiles.every(tile => tile.y !== 3), 'Returning to overview releases the previous detail view.');
});
