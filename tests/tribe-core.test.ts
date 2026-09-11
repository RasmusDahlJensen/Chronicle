import { createSettlementEnvironment } from '../src/simulation/settlements.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTribeState, advanceTribeDays, resetTribeState } from '../src/simulation/tribe.ts';
import { parseSimulationState, parseSimulationView, simulationDate } from '../shared/simulation.ts';
import { WORLD_BIOMES, WORLD_SIZES, type WorldManifest, type WorldTile } from '../shared/generated-world.ts';
import type { CivilizationSnapshot } from '../shared/civilization.ts';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const settings = { seed: 'Chronicle', size: 'standard' as const }, key = 'climate-5:standard:Chronicle';
  const world = { settings, worldKey: key, ...WORLD_SIZES.standard } as WorldManifest;
  const tiles: WorldTile[] = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
    const field = (n: number) => Array<number>(128 ** 2).fill(n);
    tiles.push({ protocolVersion: 4, worldKey: key, x, y, width: 128, height: 128,
      fields: { elevation: field(100), biome: field(WORLD_BIOMES.indexOf('grassland')), fertility: field(0),
        temperature: field(200), moisture: field(500), resource: field(0) } });
  }
  // A handful of viable starts; unequal fertility must not turn this into best-site selection.
  for (let n = 0; n < 8; n++) tiles[n].fields.fertility[n + 1] = 30 + n * 10;
  const civilization: CivilizationSnapshot = { protocolVersion: 1, spawnVersion: 1, worldKey: key,
    status: 'spawned', civilizations: [{ id: 'civilization-1', name: 'Lorin', color: '#a34f32', originCellId: 1 }] };
  return { world, tiles, civilization };
}
test('tribal placement is repeatable, sampled across viable land, and independent of instance identity or tile order', () => {
  const { world, tiles, civilization } = fixture();
  const before = JSON.stringify(tiles), locations = new Set<number>();
  for (let n = 0; n < 32; n++) {
    const first = createTribeState(id, `Tribes ${n}`, world, civilization, tiles);
    assert.deepEqual(first, createTribeState(id, `Tribes ${n}`, world, civilization, [...tiles].reverse()));
    assert.deepEqual(first.tribe, createTribeState('22222222-2222-4222-8222-222222222222', `Tribes ${n}`, world, civilization, tiles).tribe);
    assert.equal(first.tribe.population, 250); assert.equal(first.elapsedDays, 0); assert.equal(first.running, false);
    locations.add(first.tribe.originCellId);
  }
  assert.ok(locations.size >= 6, 'placement should sample viable sites, not always choose the best');
  assert.equal(JSON.stringify(tiles), before);
});
test('daily stepping, different batches and persisted continuation produce the same complete core state', () => {
  const { world, tiles, civilization } = fixture();
  const initial = createTribeState(id, 'Tribes 1', world, civilization, tiles);
  const environment = createSettlementEnvironment(world, tiles);
  let daily = initial, batched = initial;
  for (let n = 0; n < 360; n++) daily = advanceTribeDays(daily, 1, environment);
  for (let n = 0; n < 12; n++) batched = advanceTribeDays(parseSimulationState(JSON.parse(JSON.stringify(batched))), 30, environment);
  assert.deepEqual(daily, batched); assert.equal(daily.elapsedDays, 360);
  assert.deepEqual(simulationDate(daily.elapsedDays), { day: 1, year: 2 });
  assert.deepEqual(simulationDate(0), { day: 1, year: 1 });
  assert.equal(daily.tribe.population, initial.tribe.population); assert.equal(daily.rngState, initial.rngState);
  assert.equal(initial.elapsedDays, 0, 'stepping must not mutate its checkpoint input');
  const reset = resetTribeState({ ...daily, running: true, speed: 10, revision: 19 });
  assert.deepEqual(reset, { ...initial, incarnation: 2, revision: 19 });
  for (const invalid of [0, -1, 31, 1.5, NaN, Infinity]) assert.throws(() => advanceTribeDays(initial, invalid));
});
test('tribe creation rejects unsuitable worlds and incomplete or mismatched geography without inventing people', () => {
  const { world, tiles, civilization } = fixture();
  assert.throws(() => createTribeState(id, 'Tribes', world, civilization, tiles.slice(1)), /tile|geography/i);
  assert.throws(() => createTribeState(id, 'Tribes', world, { ...civilization, worldKey: 'other' }, tiles), /world|geography/i);
  for (const tile of tiles) tile.fields.fertility.fill(0);
  assert.throws(() => createTribeState(id, 'Tribes', world, civilization, tiles), /suitable/i);
  tiles[0].fields.fertility[1] = 70;
  for (const biome of ['ocean', 'lake', 'mountain', 'snow', 'tundra', 'wetland'] as const) {
    tiles[0].fields.biome[1] = WORLD_BIOMES.indexOf(biome);
    assert.throws(() => createTribeState(id, 'Tribes', world, civilization, tiles), /suitable/i);
  }
  tiles[0].fields.biome[1] = WORLD_BIOMES.indexOf('grassland'); tiles[0].fields.temperature[1] = 49;
  assert.throws(() => createTribeState(id, 'Tribes', world, civilization, tiles), /suitable/i);
});
test('checkpoint validation rejects incompatible, mismatched, overflowing and inconsistent state', () => {
  const { world, tiles, civilization } = fixture();
  const state = createTribeState(id, 'Tribes', world, civilization, tiles);
  for (const patch of [{ rulesVersion: 3 }, { protocolVersion: 3 }, { worldKey: 'bad' }, { elapsedDays: -1 },
    { rngState: 0 }, { revision: Number.MAX_SAFE_INTEGER }, { extra: 1 }, { tribe: { ...state.tribe, population: 251 } },
    { tribe: { ...state.tribe, originCellId: 131072 } }]) {
    assert.throws(() => parseSimulationState({ ...state, ...patch }), /preserved/);
  }
  assert.throws(() => advanceTribeDays({ ...state, elapsedDays: Number.MAX_SAFE_INTEGER - 100 }, 1));
  assert.deepEqual(parseSimulationView({ state, active: false, error: null }).state, state);
  assert.throws(() => parseSimulationView({ state, active: 'yes', error: null }));
});
