import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAsterIsland } from '../src/fixtures/aster-island.ts';
import { summarizeTerrain, type TerrainWorld } from '../src/world/terrain.ts';

test('the authored island has water around its boundary and both plains and hills', () => {
  const world = createAsterIsland();
  assert.equal(world.cells.length, world.width * world.height);
  assert.ok(world.cells.some(cell => cell.terrain === 'plains'));
  assert.ok(world.cells.some(cell => cell.terrain === 'hills'));
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const cell = world.cells[y * world.width + x];
      assert.equal(cell.id, y * world.width + x);
      assert.ok(Number.isFinite(cell.elevation));
      if (x === 0 || y === 0 || x === world.width - 1 || y === world.height - 1) {
        assert.equal(cell.terrain, 'water');
      }
    }
  }
});

test('all land belongs to one connected unowned province; water has no province', () => {
  const world = createAsterIsland();
  assert.equal(world.provinces.length, 1);
  assert.equal(world.provinces[0].sovereignId, null);
  const land = new Set(world.cells.filter(cell => cell.terrain !== 'water').map(cell => cell.id));
  assert.ok(land.size > 0);
  for (const cell of world.cells) {
    assert.equal(cell.provinceId, land.has(cell.id) ? world.provinces[0].id : null);
  }
  const pending = [land.values().next().value!];
  const visited = new Set<number>();
  while (pending.length) {
    const id = pending.pop()!;
    if (!land.has(id) || visited.has(id)) continue;
    visited.add(id);
    if (id % world.width > 0) pending.push(id - 1);
    if (id % world.width < world.width - 1) pending.push(id + 1);
    if (id >= world.width) pending.push(id - world.width);
    if (id < world.width * (world.height - 1)) pending.push(id + world.width);
  }
  assert.equal(visited.size, land.size, 'the single fixture province cannot have disconnected land');
});

test('reset reconstructs the authored data and does not reuse mutated cells or provinces', () => {
  const old = createAsterIsland();
  const expected = structuredClone(old);
  old.cells[0].elevation = 900;
  old.cells[0].terrain = 'hills';
  old.provinces[0].name = 'Changed';
  const reset = createAsterIsland();
  assert.deepEqual(reset, expected);
  assert.notEqual(reset.cells[0], old.cells[0]);
  assert.notEqual(reset.provinces[0], old.provinces[0]);
});

test('terrain areas use cell area rather than rendered pixels and count land once', () => {
  const world: TerrainWorld = {
    fixtureId: 'test', fixtureVersion: 1, name: 'Test', width: 5, height: 1, cellAreaKm2: 4,
    provinces: [{ id: 'land', name: 'Land', sovereignId: null }],
    cells: ['water', 'water', 'plains', 'plains', 'hills'].map((terrain, id) => ({
      id, terrain: terrain as 'water' | 'plains' | 'hills', elevation: 0,
      provinceId: terrain === 'water' ? null : 'land',
    })),
  };
  assert.deepEqual(summarizeTerrain(world), { totalKm2: 20, landKm2: 12, waterKm2: 8, plainsKm2: 8, hillsKm2: 4 });
});
