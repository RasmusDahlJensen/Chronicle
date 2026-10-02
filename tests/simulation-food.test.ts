import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { reachableFree } from '../src/simulation/bands.ts';
import { FARM_METHOD, harvest, METHOD_COUNT, monthsToHarvest, sow } from '../src/simulation/food.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng } from '../src/simulation/rng.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { FARM_TUNING, FOOD_TUNING, POPULATION_TUNING } from '../src/simulation/tunables.ts';

const total = (workers: Float64Array) => workers.reduce((sum, value) => sum + value, 0);

test('the food solver stays finite when people far outnumber the land\'s labour capacity', () => {
  const labor = Float64Array.from([300, 200, 100, 0, 0]), yields = Float64Array.from([1.45, 1.75, 2, 0, 0]);
  const workers = new Float64Array(METHOD_COUNT);
  // 600,000 people on 600 labour: e^(−1000) underflows, so λ is carried as its logarithm.
  const result = harvest(labor, 0, yields, 600_000, workers);
  assert.ok(workers.every(Number.isFinite) && Math.abs(total(workers) - 600_000) < 1e-3, 'every worker is placed, finitely');
  assert.ok(Math.abs(result.output - (1.45 * 300 + 1.75 * 200 + 2 * 100)) < 1e-6, 'output saturates at Σ yield × labour');
});

test('sowing follows the store: graded, never more than the plain optimum, and never all-or-nothing', () => {
  const labor = Float64Array.from([400, 300, 200, 0, 50_000]), yields = Float64Array.from([1.45, 1.75, 2, 0, 2.6]);
  const plain = new Float64Array(METHOD_COUNT), workers = new Float64Array(METHOD_COUNT);
  const people = 20_000;
  harvest(labor, 0, yields, people, plain);
  // A store that lasts until the harvest: the plain optimum.
  sow(labor, 0, yields, people, people, people * 12, 6, workers);
  assert.deepEqual([...workers], [...plain]);
  // The harvest month needs no bridge.
  sow(labor, 0, yields, people, people, 0, 0, workers);
  assert.deepEqual([...workers], [...plain]);
  // Less store, fewer sowers, but the fields are never abandoned: other food saturates, so cutting them buys little.
  let previous = plain[FARM_METHOD];
  for (const months of [5, 3, 1, 0.5, 0]) {
    sow(labor, 0, yields, people, people, people * months, 6, workers);
    assert.ok(Math.abs(total(workers) - people) < 1e-6, 'every worker is placed');
    assert.ok(workers[FARM_METHOD] <= previous + 1e-9, `fewer sowers with ${months} months of store`);
    assert.ok(workers[FARM_METHOD] > 0.9 * plain[FARM_METHOD], 'a large farming people keeps its fields');
    previous = workers[FARM_METHOD];
  }
  // A small band that has just learned farming, with land to forage and no store, sows only a little at first.
  const band = 300, small = new Float64Array(METHOD_COUNT);
  harvest(labor, 0, yields, band, small);
  sow(labor, 0, yields, band, band, 0, 8, workers);
  assert.ok(workers[FARM_METHOD] < small[FARM_METHOD], 'with an empty store, a band keeps people on other methods');
  // Fuzz: finite, placed, and bounded by the plain optimum.
  const rng = createRng(42);
  const fuzzLabor = new Float64Array(METHOD_COUNT), fuzzYields = new Float64Array(METHOD_COUNT);
  for (let draw = 0; draw < 20_000; draw++) {
    for (let method = 0; method < METHOD_COUNT; method++) { fuzzLabor[method] = rng.next() < 0.2 ? 0 : rng.next() * 5000; fuzzYields[method] = rng.next() < 0.1 ? 0 : 0.5 + rng.next() * 3; }
    const fuzzPeople = Math.floor(1 + rng.next() * 2_000_000), need = fuzzPeople * (0.8 + rng.next() * 0.4);
    const output = sow(fuzzLabor, 0, fuzzYields, fuzzPeople, need, rng.next() < 0.3 ? 0 : rng.next() * need * 6, Math.floor(rng.next() * 12), workers);
    harvest(fuzzLabor, 0, fuzzYields, fuzzPeople, plain);
    assert.ok(Number.isFinite(output) && output >= 0 && workers.every(value => Number.isFinite(value) && value >= -1e-9), `draw ${draw} is finite`);
    assert.ok(workers[FARM_METHOD] <= plain[FARM_METHOD] + 1e-6 * Math.max(1, plain[FARM_METHOD]), `draw ${draw} sows no more than the optimum`);
  }
});

async function chronicle() {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Chronicle', size: 'large' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

test('the harvest calendar follows latitude, and a harvest brings in exactly the crops sown since the last one', async () => {
  const { geography, partition } = await chronicle();
  const state = createSimulation(geography, partition, 'Chronicle');
  const latitude = (region: number) => geography.latitude[Math.floor(partition.regions[region].centroid / geography.width)] * 180 / Math.PI;
  for (const region of partition.regions) {
    const north = latitude(region.id) > FARM_TUNING.tropicsLatitude, south = latitude(region.id) < -FARM_TUNING.tropicsLatitude;
    const months = Array.from({ length: 12 }, (_, at) => at + 1).filter(month => state.food.harvest[region.id * 12 + month - 1] > 0);
    assert.deepEqual(months, north ? [...FARM_TUNING.harvestNorth] : south ? [...FARM_TUNING.harvestSouth] : [...FARM_TUNING.harvestTropics]);
    assert.equal(state.food.cycle[region.id], 12 / months.length);
    assert.equal(monthsToHarvest(state.food, region.id, months[0]), 0);
    assert.equal(monthsToHarvest(state.food, region.id, months[0] % 12 + 1), 12 / months.length - 1);
  }
  // Follow farming villages through two harvest cycles: each harvest equals what was sown since the previous one
  // (crops are only ever added by sowing and removed by the harvest; the invariants check the ledger every tick).
  // Farmers can always store a harvest (VISION.md "Time"): after a harvest of at least the store limit, nobody goes
  // short before the next one, though part of the store perishes every month.
  while (state.tick < 12 * 620) stepSimulation(state);
  const farmers = state.living.filter(id => state.polities[id].kind === 'civ').flatMap(id => state.polities[id].groups).slice(0, 40);
  const sownSince = new Map(farmers.map(id => [id, state.groups[id].planted]));
  const storeLimit = POPULATION_TUNING.storeMonths * state.polities[state.groups[farmers[0]].polity].knowledge.multipliers.storeMonths;
  const ample = new Set<number>();
  let harvests = 0, bridged = 0;
  for (let month = 0; month < 30; month++) {
    const need = new Map(farmers.map(id => [id, state.groups[id].size * FOOD_TUNING.unitsPerPersonMonth]));
    stepSimulation(state);
    for (const id of farmers) {
      if (state.groups[id].deathTick !== null) continue;
      const flows = state.ledger.food.get(id)!;
      const sown = sownSince.get(id)! + flows.sown;
      if (flows.harvested > 0) {
        assert.equal(flows.harvested, sown, `village group ${id} harvests what it sowed`); harvests++; sownSince.set(id, 0);
        if (flows.harvested >= storeLimit * need.get(id)!) ample.add(id); else ample.delete(id);
      } else {
        sownSince.set(id, sown);
        if (ample.has(id)) { assert.equal(flows.consumption, need.get(id)!, `village group ${id} lives on its stored harvest`); bridged++; }
      }
    }
  }
  assert.ok(bridged > 0, `${bridged} months bridged by a stored harvest`);
  assert.ok(harvests >= farmers.length, `${harvests} harvests followed`);
});

test('sea crossings need Sailing (coastal) or Navigation (any); later mobility gives no sea reach', async () => {
  const { geography, partition } = await chronicle();
  const state = createSimulation(geography, partition, 'Sailing');
  const home = (id: number) => state.groups[state.polities[id].core].region;
  const band = state.polities[state.living.find(id => partition.regions[home(id)].sea.length > 0) ?? state.living[0]];
  const region = partition.regions[home(band.id)];
  assert.ok(region.sea.length > 0, 'a band on a coast with sea crossings');
  const seaRegions = new Set(region.sea.map(link => link.region));
  const crossings = () => reachableFree(state, band, region.id).filter(option => seaRegions.has(option.region) && !region.neighbors.some(edge => edge.region === option.region));
  assert.equal(crossings().length, 0, 'foot only: no sea crossings');
  let knowledge = startingKnowledge();
  for (const name of ['Masonry', 'Pottery', 'Fishing', 'Boatbuilding']) if (!knowledge.known[TECH_INDEX.get(name)!]) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  // Railways without Sailing (forced past its prerequisites): mobility is higher, sea reach still none.
  band.knowledge = learn(knowledge, TECH_INDEX.get('Railways')!);
  assert.ok(band.knowledge.mobility >= 3 && band.knowledge.sea === 0);
  assert.equal(crossings().length, 0, 'rail does not cross the sea');
  band.knowledge = learn(knowledge, TECH_INDEX.get('Sailing')!);
  const free = region.sea.filter(link => state.occupant[link.region] < 0);
  assert.deepEqual(crossings().map(option => option.region).sort((a, b) => a - b),
    free.filter(link => link.km <= 300).map(link => link.region).filter(other => !region.neighbors.some(edge => edge.region === other)).sort((a, b) => a - b), 'Sailing: crossings up to 300 km');
  band.knowledge = learn(band.knowledge, TECH_INDEX.get('Navigation')!);
  assert.equal(crossings().length, free.filter(link => !region.neighbors.some(edge => edge.region === link.region)).length, 'Navigation: any crossing');
});
