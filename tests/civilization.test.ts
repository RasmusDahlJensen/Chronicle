import test from 'node:test';
import assert from 'node:assert/strict';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import { WORLD_BIOMES } from '../shared/generated-world.ts';

function fixture() {
  const count = 64;
  return { settings: { seed: 'Chronicle', size: 'standard' as const }, width: 8, height: 8,
    hydrology: { drySinks: [], rivers: { cells: [27], next: [28], runoff: [5000] }, lakes: [] },
    fields: { elevation: new Int16Array(count).fill(100), biome: new Uint8Array(count).fill(WORLD_BIOMES.indexOf('grassland')),
      fertility: new Uint8Array(count).fill(60), temperature: new Int16Array(count).fill(200),
      moisture: new Uint16Array(count).fill(600), resource: new Uint8Array(count) } };
}
test('one civilization has stable identity, name, color and a suitable origin without changing geography', () => {
  const world = fixture(), original = structuredClone(world);
  const first = createCivilizationSnapshot(world);
  assert.deepEqual(first, createCivilizationSnapshot(world)); assert.deepEqual(world, original);
  assert.equal(first.status, 'spawned'); assert.equal(first.civilizations.length, 1);
  const civ = first.civilizations[0];
  assert.match(civ.name, /^[A-Z][a-z]+$/); assert.match(civ.color, /^#[0-9a-f]{6}$/);
  assert.equal(civ.id, 'civilization-1');
  assert.ok([18, 19, 20, 26, 27, 28, 34, 35, 36].includes(civ.originCellId), 'equally fertile land favors freshwater vicinity');
  const names = new Set(), colors = new Set();
  for (let n = 0; n < 24; n++) {
    world.settings.seed = `Identity ${n}`;
    const candidate = createCivilizationSnapshot(world).civilizations[0]; names.add(candidate.name); colors.add(candidate.color);
  }
  assert.ok(names.size > 10); assert.ok(colors.size >= 4);
});
test('unsuitable land never gets a civilization and the sole viable cell is selected', () => {
  const world = fixture(); world.fields.fertility.fill(0);
  assert.equal(createCivilizationSnapshot(world).status, 'no-suitable-land');
  assert.deepEqual(createCivilizationSnapshot(world).civilizations, []);
  world.fields.fertility[9] = 50;
  assert.equal(createCivilizationSnapshot(world).civilizations[0].originCellId, 9);
  for (const biome of ['ocean', 'coast', 'lake', 'lakeIce', 'seaIce', 'mountain', 'snow', 'wetland', 'tundra'] as const) {
    world.fields.biome[9] = WORLD_BIOMES.indexOf(biome);
    assert.equal(createCivilizationSnapshot(world).civilizations.length, 0, biome);
  }
  world.fields.biome[9] = WORLD_BIOMES.indexOf('grassland'); world.fields.temperature[9] = 49;
  assert.equal(createCivilizationSnapshot(world).civilizations.length, 0);
});

test('seeded tie-breaking cannot outrank a better growing location', () => {
  const world = fixture(); world.hydrology.rivers.cells = []; world.hydrology.rivers.next = []; world.hydrology.rivers.runoff = [];
  world.fields.fertility.fill(0); world.fields.fertility[10] = 60; world.fields.fertility[11] = 56;
  world.settings.seed = 'Tie 6';
  assert.equal(createCivilizationSnapshot(world).civilizations[0].originCellId, 10);
});
