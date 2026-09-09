import assert from 'node:assert/strict';
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
  first.cells[0].elevation = 99_999;
  assert.notEqual(first.cells[0].elevation, second.cells[0].elevation);
  assert.ok(Buffer.byteLength(JSON.stringify({ protocolVersion: 2, world: second })) < 8 * 1024 * 1024);
  assert.equal(parseAtlasResponse({ protocolVersion: 2, world: second }), second);
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

test('every biome has a real region and primary resources match their terrain', () => {
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
    assert.ok(allowed[cell.biome]?.includes(cell.resource), `${cell.biome}: ${cell.resource}`);
    assert.equal(isWaterBiome(cell.biome), cell.elevation < 0);
    biomes.set(cell.biome, (biomes.get(cell.biome) ?? 0) + 1);
    resources.add(cell.resource);
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
