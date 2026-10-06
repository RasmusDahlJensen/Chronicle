import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD_BIOMES } from '../shared/generated-world.ts';
import { checkFamineWatches, cultivatedCells, fallow, NO_FIELD, rankFarmland, tendFields, watchFamine } from '../src/simulation/fields.ts';
import { FARM_METHOD, METHOD_COUNT } from '../src/simulation/food.ts';
import type { SimulationGeography } from '../src/simulation/geography.ts';
import type { RegionPartition } from '../src/simulation/regions.ts';
import type { SimulationState } from '../src/simulation/state.ts';
import { FARM_TUNING, FIELD_TUNING } from '../src/simulation/tunables.ts';

/**
 * Test fixture: a strip of 8 cells (the start of a wide row), one region of cells 0–6 with its best settlement site at cell 0; cell 3
 * is desert, cell 7 water. Fertility falls along the strip except a rich cell 5.
 */
function world() {
  const biome = new Uint8Array(8).fill(WORLD_BIOMES.indexOf('grassland'));
  biome[3] = WORLD_BIOMES.indexOf('desert'); biome[7] = WORLD_BIOMES.indexOf('ocean');
  const geography = { width: 64, cells: 8, cellAreaKm2: 100, biome, fertility: Uint8Array.from([80, 70, 60, 50, 40, 100, 30, 0]) } as unknown as SimulationGeography;
  const partition = { regions: [{ id: 0, cells: [0, 1, 2, 3, 4, 5, 6], settlementSites: [0], centroid: 3 }] } as unknown as RegionPartition;
  return { geography, partition, ranking: rankFarmland(geography, partition) };
}
const labour = (fertility: number, biome = 'grassland') => 100 * FARM_TUNING.farmDensity[biome as 'grassland'] * (fertility / 100) ** FARM_TUNING.fertilityExponent;

test('a region\'s farmland is ranked by its farm labour and closeness to the best settlement site, with cumulative labour', () => {
  const { ranking } = world();
  assert.equal(ranking.rank[7], NO_FIELD, 'water is no farmland');
  assert.deepEqual([...ranking.order].slice(0, 2), [0, 1], 'the rich land by the site first');
  assert.ok(ranking.rank[5] < ranking.rank[4], 'the rich cell beats a closer poor one');
  assert.ok(ranking.rank[3] !== NO_FIELD && ranking.rank[3] > ranking.rank[6] - 3, 'desert farms a little, late');
  assert.deepEqual([ranking.start[0], ranking.start[1]], [0, 7]);
  for (let at = 1; at < 7; at++) assert.ok(ranking.cumulative[at] > ranking.cumulative[at - 1]);
  assert.ok(Math.abs(ranking.cumulative[0] - labour(80)) < 1e-9);
  // Cells covered: those whose cumulative labour the fields reach.
  assert.equal(cultivatedCells(ranking, 0, 0), 0);
  assert.equal(cultivatedCells(ranking, 0, ranking.cumulative[0]), 1);
  assert.equal(cultivatedCells(ranking, 0, ranking.cumulative[2] + 1), 3);
  assert.equal(cultivatedCells(ranking, 0, 1e12), 7);
});

/** A state of one region with `land` farm labour. */
function fields(land: number) {
  const labor = new Float64Array(METHOD_COUNT); labor[FARM_METHOD] = land;
  return { food: { labor }, fields: new Float64Array(1), famineWatches: [], metrics: { faminesWatched: 0, fieldsShrank: 0, fieldsRegrew: 0 }, tick: 0 } as unknown as SimulationState;
}

test('fields are cleared toward what the farmers work within about a year, yield less until cleared, and fall fallow slowly', () => {
  const state = fields(10_000), tuning = FIELD_TUNING;
  const target = tuning.fieldFactor * 2_000;
  const first = tendFields(state, 0, 2_000);
  assert.equal(state.fields[0], tuning.clearRate / 12 * target);
  assert.ok(Math.abs(first - (tuning.uncleared + (1 - tuning.uncleared) * state.fields[0] / target)) < 1e-12, 'uncleared land yields less');
  for (let month = 1; month < 12 / tuning.clearRate; month++) tendFields(state, 0, 2_000);
  assert.ok(Math.abs(state.fields[0] - target) < 1e-6, 'cleared in a year');
  assert.equal(tendFields(state, 0, 2_000), 1);
  // Never beyond the farmland.
  for (let month = 0; month < 24; month++) tendFields(state, 0, 1_000_000);
  assert.equal(state.fields[0], 10_000);
  // Fewer farmers: the fields fall fallow by a share of the gap a year, and yield in full meanwhile.
  assert.equal(tendFields(state, 0, 1_000), 1);
  const gap = 10_000 - tuning.fieldFactor * 1_000;
  assert.ok(Math.abs(state.fields[0] - (10_000 - tuning.fallowRate / 12 * gap)) < 1e-9);
  // Nobody farms: they fall fallow toward nothing, and a remnant is gone.
  for (let month = 0; month < 12 * 80; month++) fallow(state, 0);
  assert.equal(state.fields[0], 0);
});

test('a civilization\'s famine is watched: its regions\' fields shrinking within ten years and regrowing later are counted once each', () => {
  const state = fields(10_000);
  state.fields[0] = 5_000;
  watchFamine(state, 3, [0]);
  assert.equal(state.metrics.faminesWatched, 1);
  state.tick = 12; checkFamineWatches(state);
  assert.equal(state.metrics.fieldsShrank, 0, 'unchanged');
  state.fields[0] = 4_000; state.tick = 24; checkFamineWatches(state);
  state.tick = 36; checkFamineWatches(state);
  assert.equal(state.metrics.fieldsShrank, 1, 'once');
  state.fields[0] = 5_000; state.tick = 600; checkFamineWatches(state);
  assert.deepEqual([state.metrics.fieldsRegrew, state.famineWatches.length], [1, 0], 'regrown: the watch ends');
  // A famine whose fields do not shrink within ten years stops being watched.
  watchFamine(state, 3, [0]);
  state.tick = 600 + 12 * FIELD_TUNING.shrinkYears + 12; checkFamineWatches(state);
  assert.deepEqual([state.metrics.fieldsShrank, state.famineWatches.length], [1, 0]);
});
