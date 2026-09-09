import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createVerdantReach } from '../src/fixtures/verdant-reach.ts';
import { isWaterBiome, parseAtlasResponse } from '../shared/atlas.ts';

test('the authored regional atlas is repeatable, independent, and bounded to its stated area', () => {
  const first = createVerdantReach();
  const second = createVerdantReach();
  assert.deepEqual(first, second);
  assert.equal(first.topology, 'bounded');
  assert.equal(first.width, 320);
  assert.equal(first.height, 200);
  assert.equal(first.cells.length, 64_000);
  assert.equal(first.cellAreaKm2, 4);
  assert.equal(first.cells.length * first.cellAreaKm2, 256_000);
  assert.equal(first.fixtureVersion, 2);
  first.cells[0].elevation = 99_999;
  assert.notEqual(first.cells[0].elevation, second.cells[0].elevation);
  assert.ok(Buffer.byteLength(JSON.stringify({ protocolVersion: 3, world: second })) < 8 * 1024 * 1024);
  assert.equal(parseAtlasResponse({ protocolVersion: 3, world: second }), second);
});

test('special resource sites are sparse, spaced, and make strategic minerals rarer than common resources', () => {
  const world = createVerdantReach();
  const sites = world.cells.filter(cell => cell.resource !== null);
  assert.ok(world.cells.filter(cell => cell.resource === null).length > world.cells.length * 0.99,
    'more than 99% of cells have no special resource site');
  assert.ok(sites.length >= 200 && sites.length <= 500, `${sites.length} sites in the regional study`);
  assert.ok(sites.filter(cell => !isWaterBiome(cell.biome)).length > sites.length * 0.8,
    'most sites are on land');
  assert.ok(sites.some(cell => cell.biome === 'coast' && cell.resource === 'fish'), 'coastal fishing exists');
  assert.ok(sites.some(cell => cell.biome === 'ocean' && cell.resource === 'fish'), 'ocean fishing exists');
  const counts = new Map<string, number>();
  for (const cell of sites) {
    assert.notEqual(cell.resource, null);
    counts.set(cell.resource!, (counts.get(cell.resource!) ?? 0) + 1);
  }
  const gold = counts.get('gold') ?? 0;
  const uranium = counts.get('uranium') ?? 0;
  assert.ok(gold >= 1 && gold <= 8, `${gold} gold sites`);
  assert.ok(uranium >= 1 && uranium <= 4, `${uranium} uranium sites`);
  for (const resource of ['fish', 'grain', 'timber', 'game', 'stone']) {
    assert.ok((counts.get(resource) ?? 0) > Math.max(gold, uranium), `${resource} is more common than rare minerals`);
  }
  for (let first = 0; first < sites.length; first++) {
    for (let second = first + 1; second < sites.length; second++) {
      const dx = sites[first].id % world.width - sites[second].id % world.width;
      const dy = Math.floor(sites[first].id / world.width) - Math.floor(sites[second].id / world.width);
      assert.ok(dx * dx + dy * dy >= 64, `sites ${sites[first].id} and ${sites[second].id} stay at least 8 cells apart`);
    }
  }
});

test('resource placement preserves the accepted geography and province identities', () => {
  const world = createVerdantReach();
  const geography = {
    cells: world.cells.map(({ id, elevation, biome, provinceId }) => ({ id, elevation, biome, provinceId })),
    provinces: world.provinces,
    countries: world.countries,
    annotations: world.annotations,
  };
  assert.equal(createHash('sha256').update(JSON.stringify(geography)).digest('hex'),
    '46afaa497fd8b1c0ed9d3d40bdf6a6253fe887fc72afc789e79745f3eac9f954');
});

test('several substantial landmasses and smaller islands are separated by actual water', () => {
  const world = createVerdantReach();
  const visited = new Uint8Array(world.cells.length);
  const components: number[] = [];
  for (const [index, cell] of world.cells.entries()) {
    assert.equal(cell.id, index);
    assert.ok(Number.isInteger(cell.elevation));
    if (isWaterBiome(cell.biome) || visited[cell.id]) continue;
    const pending = [cell.id];
    visited[cell.id] = 1;
    for (let offset = 0; offset < pending.length; offset++) {
      for (const id of neighbors(pending[offset], world.width, world.height)) {
        if (!visited[id] && !isWaterBiome(world.cells[id].biome)) {
          visited[id] = 1;
          pending.push(id);
        }
      }
    }
    if (pending.length >= 1_000) {
      assert.ok(pending.some(id => world.cells[id].resource !== null),
        `landmass with ${pending.length} cells has a resource site`);
    }
    components.push(pending.length);
  }
  assert.ok(components.filter(size => size >= 1_000).length >= 3, 'three substantial landmasses');
  assert.ok(components.filter(size => size >= 20 && size < 1_000).length >= 4, 'a visible archipelago');
  const land = components.reduce((total, count) => total + count, 0);
  assert.ok(land > 64_000 * 0.3 && land < 64_000 * 0.7);
  for (let x = 0; x < world.width; x++) {
    assert.equal(world.cells[x].biome, 'ocean');
    assert.equal(world.cells[(world.height - 1) * world.width + x].biome, 'ocean');
  }
});

test('every biome has a real region and nonempty resource sites match their terrain', () => {
  const world = createVerdantReach();
  const allowed: Record<string, string[]> = {
    ocean: ['fish'], coast: ['fish', 'salt'], grassland: ['grain', 'game', 'stone', 'coal'],
    forest: ['timber', 'game', 'coal', 'iron'], rainforest: ['timber', 'game', 'gold'],
    desert: ['salt', 'stone', 'copper', 'uranium', 'gold'], savanna: ['grain', 'game', 'copper'],
    wetland: ['fish', 'grain'], tundra: ['game', 'stone', 'iron'],
    mountain: ['stone', 'iron', 'copper', 'gold', 'coal', 'uranium'],
    snow: ['stone', 'iron', 'gold', 'uranium'],
  };
  const biomes = new Map<string, number>();
  const resources = new Set<string>();
  for (const cell of world.cells) {
    if (cell.resource !== null) {
      assert.ok(allowed[cell.biome]?.includes(cell.resource), `${cell.biome}: ${cell.resource}`);
      resources.add(cell.resource);
    }
    assert.equal(isWaterBiome(cell.biome), cell.elevation < 0);
    biomes.set(cell.biome, (biomes.get(cell.biome) ?? 0) + 1);
  }
  for (const biome of Object.keys(allowed)) assert.ok((biomes.get(biome) ?? 0) >= 40, `${biome} has a visible region`);
  assert.deepEqual([...resources].sort(), ['fish', 'grain', 'timber', 'game', 'stone', 'iron', 'copper', 'gold', 'salt', 'coal', 'uranium'].sort());
});

test('every land cell belongs to exactly one connected unclaimed province', () => {
  const world = createVerdantReach();
  assert.deepEqual(world.countries, []);
  const membership = new Map(world.provinces.map(province => {
    assert.equal(province.countryId, null);
    return [province.id, new Set<number>()] as const;
  }));
  assert.equal(membership.size, world.provinces.length, 'province IDs are unique');
  for (const cell of world.cells) {
    if (isWaterBiome(cell.biome)) {
      assert.equal(cell.provinceId, null);
    } else {
      assert.ok(cell.provinceId && membership.has(cell.provinceId));
      membership.get(cell.provinceId)!.add(cell.id);
    }
  }
  for (const [provinceId, members] of membership) {
    assert.ok(members.size > 0, `${provinceId} is not empty`);
    const reached = new Set<number>();
    const pending = [members.values().next().value!];
    for (let offset = 0; offset < pending.length; offset++) {
      const id = pending[offset];
      if (reached.has(id)) continue;
      reached.add(id);
      for (const adjacent of neighbors(id, world.width, world.height)) {
        if (members.has(adjacent) && !reached.has(adjacent)) pending.push(adjacent);
      }
    }
    assert.equal(reached.size, members.size, `${provinceId} remains connected`);
  }
  const largeProvinceSizes = [...membership.values()].map(cells => cells.size).filter(size => size >= 200);
  const average = largeProvinceSizes.reduce((sum, size) => sum + size, 0) / largeProvinceSizes.length;
  assert.ok(average >= 300 && average <= 600, `regional provinces average ${average} cells`);
});

function neighbors(id: number, width: number, height: number): number[] {
  const result: number[] = [];
  if (id % width > 0) result.push(id - 1);
  if (id % width < width - 1) result.push(id + 1);
  if (id >= width) result.push(id - width);
  if (id < width * (height - 1)) result.push(id + width);
  return result;
}
