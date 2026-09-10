import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { latitudeAt, baselineTemperature, classifyClimate, moistureField } from '../src/world/generation/climate.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { WORLD_BIOMES, isWorldLake, MAX_WORLD_MANIFEST_BYTES, parseWorldManifest, parseWorldTile, decodeWorldSurface, inspectWorldCell } from '../shared/generated-world.ts';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { hashNoise, smoothNoise } from '../src/world/generation/noise.ts';

test('longitude noise joins seamlessly and independently seeded resource choices remain reachable', () => {
  for (const y of [0, 0.1, 0.5, 0.9, 1]) assert.equal(smoothNoise(0, y, 16, 91), smoothNoise(1, y, 16, 91));
  const buckets = new Array(10).fill(0);
  for (let id = 0; id < 100000; id++) {
    if (hashNoise(id % 512, Math.floor(id / 512), 350) < 0.009) {
      buckets[Math.floor(hashNoise(id % 512, Math.floor(id / 512), 351) * 10)]++;
    }
  }
  assert.ok(buckets.every(count => count > 10), `Conditional choices should span the resource range: ${buckets}`);
});

test('both poles are colder than the equator and equal-area latitude is symmetric', () => {
  assert.equal(latitudeAt(0), 90);
  assert.equal(latitudeAt(0.5), 0);
  assert.equal(latitudeAt(1), -90);
  for (const latitude of [0, 15, 30, 45, 60, 75, 90]) {
    assert.equal(baselineTemperature(latitude), baselineTemperature(-latitude));
    if (latitude < 90) assert.ok(baselineTemperature(latitude) > baselineTemperature(latitude + 5));
  }
  assert.ok(baselineTemperature(0) > 25);
  assert.ok(baselineTemperature(90) < -20);
  assert.ok(baselineTemperature(30, 3000) < baselineTemperature(30, 0) - 15);
});

test('biomes follow temperature, moisture and elevation instead of island quotas', () => {
  const cases: [number, number, number, string][] = [
    [100, 28, 0.9, 'rainforest'], [100, 28, 0.1, 'desert'],
    [100, 26, 0.45, 'savanna'], [100, 12, 0.8, 'forest'],
    [100, 12, 0.45, 'grassland'], [100, 12, 0.15, 'steppe'],
    [100, 3, 0.75, 'boreal'], [100, -5, 0.5, 'tundra'],
    [100, -20, 0.4, 'snow'], [3600, -2, 0.6, 'snow'],
    [-1500, -25, 0.2, 'seaIce'], [-1500, 20, 0.5, 'ocean'],
  ];
  for (const [elevation, temperature, moisture, expected] of cases) {
    assert.equal(classifyClimate(elevation, temperature, moisture), expected);
  }
});

test('ocean-facing mountain slopes are wetter than their leeward lowlands', () => {
  const width = 512; const height = 8;
  const elevation = new Int16Array(width * height).fill(100);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 6; x++) elevation[y * width + x] = -100;
    for (let x = 20; x < 25; x++) elevation[y * width + x] = (x - 19) * 750;
  }
  const moisture = moistureField(width, height, elevation, 17);
  const row = width; // ~39° north, prevailing westerlies.
  const wetSlope = (moisture[row + 21] + moisture[row + 22]) / 2;
  const lee = (moisture[row + 27] + moisture[row + 28]) / 2;
  assert.ok(wetSlope > lee + 150, `windward ${wetSlope}; leeward ${lee}`);
});

function digest(fields: Awaited<ReturnType<typeof generateWorld>>['fields']) {
  const hash = createHash('sha256');
  for (const values of Object.values(fields)) hash.update(new Uint8Array(values.buffer));
  return hash.digest('hex');
}

test('seeded generation is repeatable, varied, sparse and regionally coherent', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'standard' });
  const repeat = await generateWorld({ seed: 'Chronicle', size: 'standard' });
  const other = await generateWorld({ seed: 'Elsewhere', size: 'standard' });
  assert.equal(world.width * world.height, 131072);
  assert.equal(digest(world.fields), digest(repeat.fields));
  assert.notEqual(digest(world.fields), digest(other.fields));
  let land = 0; let sites = 0; let matches = 0; let pairs = 0;
  const biomes = new Set<number>();
  for (let id = 0; id < world.fields.biome.length; id++) {
    const biome = world.fields.biome[id];
    biomes.add(biome);
    if (world.fields.elevation[id] >= 0) land++;
    if (world.fields.resource[id] !== 0) sites++;
    if (id % world.width > 0) { pairs++; if (biome === world.fields.biome[id - 1]) matches++; }
    const row = Math.floor(id / world.width);
    if (row === 0 || row === world.height - 1) assert.ok(world.fields.temperature[id] < -100);
  }
  assert.ok(land > world.width * world.height * 0.15 && land < world.width * world.height * 0.65);
  assert.ok(sites > 30 && sites < world.width * world.height * 0.015);
  assert.ok(matches / pairs > 0.8, `Neighbor coherence ${matches / pairs}`);
  for (const biome of ['rainforest', 'forest', 'desert', 'snow', 'boreal', 'tundra']) {
    assert.ok(biomes.has(WORLD_BIOMES.indexOf(biome as typeof WORLD_BIOMES[number])), `Missing ${biome}`);
  }
  assert.equal('provinces' in world, false);
});

test('islands inherit equatorial and polar climates while mountains add cooler ecosystems', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'large' });
  const visited = new Uint8Array(world.width * world.height);
  let continents = 0; let islands = 0; let equatorialIslands = 0; let coldIslands = 0; let mountainIslands = 0;
  const equatorialHemispheres = new Set<number>(); const coldHemispheres = new Set<number>();
  const latitude = (cell: number) => latitudeAt((Math.floor(cell / world.width) + 0.5) / world.height);
  const averageTemperature = (cells: number[]) => cells.reduce((sum, cell) => sum + world.fields.temperature[cell], 0) / cells.length;
  for (let id = 0; id < visited.length; id++) {
    if (visited[id] || world.fields.elevation[id] < 0) continue;
    const connected = [id]; visited[id] = 1;
    for (let at = 0; at < connected.length; at++) {
      const cell = connected[at]; const x = cell % world.width; const row = cell - x;
      for (const next of [row + (x + 1) % world.width, row + (x - 1 + world.width) % world.width, cell - world.width, cell + world.width]) {
        if (next < 0 || next >= visited.length || visited[next] || world.fields.elevation[next] < 0) continue;
        visited[next] = 1; connected.push(next);
      }
    }
    if (connected.length >= world.width * world.height * 0.01) continents++;
    if (connected.length >= 10 && connected.length < 2000) {
      islands++;
      const exposed = connected.filter(cell => !isWorldLake(WORLD_BIOMES[world.fields.biome[cell]]));
      const lowlands = exposed.filter(cell => world.fields.elevation[cell] < 700);
      const equatorial = lowlands.filter(cell => Math.abs(latitude(cell)) <= 10);
      const cold = lowlands.filter(cell => Math.abs(latitude(cell)) >= 55);
      if (equatorial.length) equatorialIslands++;
      if (cold.length) coldIslands++;
      for (const cell of equatorial) {
        equatorialHemispheres.add(Math.sign(latitude(cell)));
        assert.ok(world.fields.temperature[cell] > 220, 'Equatorial island lowlands should remain warm.');
        assert.ok(['rainforest', 'savanna', 'desert'].includes(WORLD_BIOMES[world.fields.biome[cell]]),
          'Equatorial lowlands must not repeat polar or alpine ecosystems.');
      }
      for (const cell of cold) {
        coldHemispheres.add(Math.sign(latitude(cell)));
        assert.ok(world.fields.temperature[cell] < 80, 'High-latitude island lowlands should remain cold.');
        assert.ok(['boreal', 'tundra', 'snow'].includes(WORLD_BIOMES[world.fields.biome[cell]]),
          'High-latitude islands must not repeat tropical ecosystems.');
      }
      const highlands = exposed.filter(cell => world.fields.elevation[cell] > 1800);
      const latitudes = connected.map(latitude);
      if (lowlands.length && highlands.length && Math.max(...latitudes) - Math.min(...latitudes) < 3) {
        mountainIslands++;
        assert.ok(averageTemperature(highlands) < averageTemperature(lowlands) - 60,
          'Mountain zones should be substantially colder than the same island’s nearby lowlands.');
      }
      for (const cell of exposed) {
        assert.equal(WORLD_BIOMES[world.fields.biome[cell]], classifyClimate(
          world.fields.elevation[cell], world.fields.temperature[cell] / 10, world.fields.moisture[cell] / 1000,
        ), 'An elevated island may have more biomes only as a consequence of its actual climate/terrain.');
      }
    }
  }
  assert.ok(continents >= 3, 'The default world should have several substantial continents.');
  assert.ok(islands >= 5, 'The default world should also have distinct smaller islands.');
  assert.ok(equatorialIslands >= 2 && coldIslands >= 2, 'Exercise several distinct islands in each climate region.');
  assert.deepEqual([...equatorialHemispheres].sort(), [-1, 1], 'Exercise equatorial islands in both hemispheres.');
  assert.deepEqual([...coldHemispheres].sort(), [-1, 1], 'Exercise cold islands in both hemispheres.');
  assert.ok(mountainIslands >= 1, 'Exercise altitude-driven climate zones on a small island.');
});

test('large world encodes a bounded overview and exact tiles without losing climate, resources or fertility', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'large' });
  assert.equal(world.width * world.height, 524288);
  const bundle = encodeGeneratedWorld(world);
  const manifest = parseWorldManifest(JSON.parse(bundle.manifest));
  assert.equal(manifest.width, 1024);
  assert.equal(manifest.height, 512);
  assert.equal(manifest.areaKm2, 510000000);
  assert.equal(manifest.overview.fields.biome.length, 32768);
  assert.ok(Buffer.byteLength(bundle.manifest) < MAX_WORLD_MANIFEST_BYTES);
  const surface = decodeWorldSurface(manifest.surface);
  assert.deepEqual(surface.elevation, world.fields.elevation);
  assert.deepEqual(surface.biome, world.fields.biome);
  assert.equal(bundle.tiles.length, 32);
  const counts = new Array(WORLD_BIOMES.length).fill(0);
  for (const body of bundle.tiles) {
    assert.ok(Buffer.byteLength(body) < 512 * 1024);
    const raw = JSON.parse(body);
    const tile = parseWorldTile(raw, manifest, raw.x, raw.y);
    assert.equal(inspectWorldCell(manifest, tile, tile.x * 128, tile.y * 128).fertility.score, tile.fields.fertility[0]);
    for (let at = 0; at < tile.fields.biome.length; at++) {
      const id = (tile.y * 128 + Math.floor(at / tile.width)) * world.width + tile.x * 128 + at % tile.width;
      for (const field of ['elevation', 'temperature', 'moisture', 'biome', 'resource', 'fertility'] as const) {
        assert.equal(tile.fields[field][at], world.fields[field][id]);
      }
      counts[tile.fields.biome[at]]++;
    }
  }
  assert.deepEqual(counts, manifest.biomeCounts);
});

test('rare minerals remain reachable and resource spacing crosses the world seam', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'large' });
  const sites: number[] = [];
  const counts = new Array(RESOURCE_IDS.length + 1).fill(0);
  for (let id = 0; id < world.fields.resource.length; id++) {
    counts[world.fields.resource[id]]++;
    if (world.fields.resource[id]) sites.push(id);
  }
  const gold = counts[RESOURCE_IDS.indexOf('gold') + 1];
  const uranium = counts[RESOURCE_IDS.indexOf('uranium') + 1];
  const iron = counts[RESOURCE_IDS.indexOf('iron') + 1];
  assert.ok(gold > 0 && uranium > 0, `gold ${gold}; uranium ${uranium}`);
  for (const [index, resource] of RESOURCE_IDS.entries()) assert.ok(counts[index + 1] > 0, `The default world has no ${resource} sites`);
  assert.ok(gold < iron && uranium < iron);
  for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) {
    const dy = Math.floor(sites[a] / world.width) - Math.floor(sites[b] / world.width);
    if (Math.abs(dy) >= 10) continue;
    const rawX = Math.abs(sites[a] % world.width - sites[b] % world.width);
    const dx = Math.min(rawX, world.width - rawX);
    assert.ok(dx * dx + dy * dy >= 100, 'resource sites must stay separated across tile and world boundaries');
  }
});

test('generated-world validation rejects wrong identity, corrupt fields and incomplete tiles', async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Validation', size: 'standard' }));
  const manifest = parseWorldManifest(JSON.parse(bundle.manifest));
  const tile = JSON.parse(bundle.tiles[0]);
  assert.throws(() => parseWorldManifest({ ...manifest, protocolVersion: 99 }));
  assert.throws(() => parseWorldManifest({ ...manifest, landCells: -1 }));
  assert.throws(() => parseWorldTile({ ...tile, worldKey: 'another-world' }, manifest, 0, 0));
  assert.throws(() => parseWorldTile(tile, manifest, 1, 0));
  tile.fields.temperature[0] = Number.NaN;
  assert.throws(() => parseWorldTile(tile, manifest, 0, 0));
  tile.fields.temperature[0] = 50;
  tile.fields.biome.pop();
  assert.throws(() => parseWorldTile(tile, manifest, 0, 0));
});
