import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { isWaterRegion } from '../src/simulation/bands.ts';
import { capacity, harvest, METHOD_COUNT } from '../src/simulation/food.ts';
import { decodeGeography, greatCircleKm } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { createName, createLanguage } from '../src/simulation/names.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng } from '../src/simulation/rng.ts';
import { collectStats, createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import { SPAWN_TUNING } from '../src/simulation/tunables.ts';

test('workers flow to equal marginal yields and capacity is where output equals need', () => {
  // Three methods: forage, hunt, fish (herding and farming unknown).
  const labor = Float64Array.from([1000, 800, 400, 0, 0]), yields = Float64Array.from([1.45, 1.75, 2, 0, 0]);
  const workers = new Float64Array(METHOD_COUNT);
  const few = harvest(labor, 0, yields, 50, workers);
  assert.ok(workers[2] > 0 && workers[0] === 0, 'a few people all fish, the best method');
  assert.ok(Math.abs(few.output / 50 - 2) < 0.15, 'at low labour each worker gets close to the best yield');
  const many = harvest(labor, 0, yields, 1500, workers);
  for (const method of [0, 1, 2]) {
    const marginal = yields[method] * Math.exp(-workers[method] / labor[method]);
    assert.ok(Math.abs(marginal - many.marginal) < 1e-9, `method ${method} works at the shared marginal yield`);
  }
  assert.ok(Math.abs(workers[0] + workers[1] + workers[2] - 1500) < 1e-6, 'every worker is placed');
  const expected = [0, 1, 2].reduce((sum, method) => sum + yields[method] * labor[method] * (1 - Math.exp(-workers[method] / labor[method])), 0);
  assert.ok(Math.abs(many.output - expected) < 1e-6, 'output is the saturating sum over methods');
  const people = capacity(labor, 0, yields);
  assert.ok(Math.abs(harvest(labor, 0, yields, people).output - people) < 0.5, 'at capacity output equals need');
  assert.ok(Math.abs(capacity(labor, 0, yields, people * 0.5) - people) < 0.5 && Math.abs(capacity(labor, 0, yields, people * 1.4) - people) < 0.5, 'warm starts reach the same capacity');
  assert.equal(capacity(labor, 0, Float64Array.from([0.9, 0.8, 0, 0, 0])), 0, 'land that cannot feed its workers has no capacity');
});

test('names come from a culture\'s language seed and are reproducible', () => {
  const language = createLanguage(createRng(7));
  const names = Array.from({ length: 50 }, (_, at) => createName(createRng(7, at), language));
  assert.deepEqual(names, Array.from({ length: 50 }, (_, at) => createName(createRng(7, at), language)));
  for (const name of names) assert.match(name, /^[A-Z][a-z]{2,13}$/);
  assert.ok(new Set(names).size > 30, 'a language yields varied names');
});

async function chronicleWorld() {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Chronicle', size: 'large' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

test('M1 acceptance on Chronicle over 500 years: births and deaths, growth, spread, capacity, causes and water', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Chronicle');
  // Starting state: 30 spaced bands of 50–200 people, each with its own culture.
  assert.equal(state.bands.length, SPAWN_TUNING.bands);
  for (const id of state.bands) {
    const band = state.polities[id], size = state.groups[band.group].size;
    assert.ok(size >= 50 && size <= 200);
    for (const other of state.bands) if (other !== id) {
      assert.ok(greatCircleKm(geography, partition.regions[band.region].centroid, partition.regions[state.polities[other].region].centroid) >= SPAWN_TUNING.minSpacingKm);
    }
  }
  assert.equal(new Set(state.bands.map(id => state.polities[id].culture)).size, SPAWN_TUNING.bands);
  const start = collectStats(state, 0);
  for (let month = 0; month < 500 * 12; month++) stepSimulation(state);
  const end = collectStats(state, 500), m = state.metrics;
  assert.equal(m.silentBandYears, 0, 'every band of at least 50 people records births and deaths every year');
  assert.ok(end.population > start.population * 20, `population grows: ${start.population} → ${end.population}`);
  assert.ok(m.maxOverCapacityMonths <= 24, `no region stays above 1.1× capacity for more than 24 months (${m.maxOverCapacityMonths})`);
  assert.ok(end.bands >= 3 * start.bands && end.occupiedRegions >= 3 * start.occupiedRegions, `bands ${start.bands} → ${end.bands}`);
  const moves = state.chronicle.events.filter(event => event.type === 'bandMoved'), splits = state.chronicle.events.filter(event => event.type === 'bandSplit');
  assert.equal(moves.length, m.moves); assert.equal(splits.length, m.splits);
  assert.ok(moves.length > 20 && splits.length > 100);
  for (const event of [...moves, ...splits]) assert.ok(event.causes.length > 0 && event.region !== null, `${event.type} ${event.id} records causes and a place`);
  const citing = moves.filter(event => event.causes.some(cause => (cause.factor === 'gameDepletion' || cause.factor === 'landPressure') && cause.weight >= 0.1));
  assert.ok(citing.length * 2 >= moves.length, `${citing.length} of ${moves.length} moves cite game depletion or land pressure`);
  assert.ok(end.waterPopulationShare >= 1.25 * end.waterRegionShare, `water share ${end.waterPopulationShare} vs ${end.waterRegionShare}`);
  const water = state.bands.filter(id => isWaterRegion(state, state.polities[id].region)).length;
  assert.ok(water > 0 && water < state.bands.length, 'bands live both near water and inland');
});

test('exact accounting catches any population or food change without a recorded cause', async () => {
  const { geography, partition } = await chronicleWorld();
  const tamper = (change: (state: ReturnType<typeof createSimulation>) => void, pattern: RegExp) => {
    const state = createSimulation(geography, partition, 'Accounting');
    for (let month = 0; month < 24; month++) stepSimulation(state);
    change(state);
    assert.throws(() => checkInvariants(state), (error: Error) => error instanceof InvariantError && pattern.test(error.message));
  };
  tamper(state => { state.groups[state.polities[state.bands[0]].group].size += 1; }, /population .* differs from its accounted/);
  tamper(state => { state.groups[state.polities[state.bands[1]].group].store += 1; }, /food store .* is not explained/);
  tamper(state => {
    const [a, b] = state.bands.map(id => state.polities[id]);
    b.region = a.region; state.groups[b.group].region = a.region;
  }, /holds bands|does not record/);
  // Transfers must close across regions and bands: a split that forgot to take people and food from its parent
  // would balance each region and band on its own books, but create people and food from nothing.
  tamper(state => {
    const band = state.polities[state.bands[2]], group = state.groups[band.group];
    group.size += 40; state.ledger.migrantsIn[band.region] += 40;
  }, /left regions but .* arrived/);
  tamper(state => {
    const group = state.groups[state.polities[state.bands[3]].group];
    group.store += 500; state.ledger.food.get(group.id)!.carriedIn += 500;
  }, /carried out but .* carried in/);
});

test('a band that dies out frees its region and its stored food is recorded as spoilage', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Dissolution');
  for (let month = 0; month < 12; month++) stepSimulation(state);
  const band = state.polities[state.bands[0]], group = state.groups[band.group], region = band.region;
  // One person on the brink of a famine death, holding some food.
  group.size = 1; group.famineCarry = 0.999; group.naturalCarry = 0.999; group.birthCarry = 0; group.foodSecurity = 0;
  stepSimulation(state);
  assert.notEqual(band.deathTick, null, 'the band died out');
  assert.equal(state.occupant[region], -1);
  assert.ok(!state.bands.includes(band.id));
  assert.equal(group.store, 0);
  const flows = state.ledger.food.get(group.id)!;
  assert.equal(flows.before + flows.production - flows.consumption - flows.spoilage + flows.carriedIn - flows.carriedOut, 0, 'its last food is accounted for');
});
