import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { breakawayChance, breakawayOdds, isWaterRegion, reachableFree } from '../src/simulation/bands.ts';
import { capacity, harvest, METHOD_COUNT } from '../src/simulation/food.ts';
import { decodeGeography, greatCircleKm } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { createName, createLanguage } from '../src/simulation/names.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng } from '../src/simulation/rng.ts';
import { collectStats, createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import { BAND_TUNING, SPAWN_TUNING } from '../src/simulation/tunables.ts';

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
  assert.equal(state.living.length, SPAWN_TUNING.bands);
  const home = (id: number) => state.groups[state.polities[id].core];
  for (const id of state.living) {
    const group = home(id);
    assert.equal(state.polities[id].groups.length, 1, 'each starting tribe is one band');
    assert.ok(group.size >= 50 && group.size <= 200);
    for (const other of state.living) if (other !== id) {
      assert.ok(greatCircleKm(geography, partition.regions[group.region].centroid, partition.regions[home(other).region].centroid) >= SPAWN_TUNING.minSpacingKm);
    }
  }
  assert.equal(new Set(state.living.map(id => state.polities[id].culture)).size, SPAWN_TUNING.bands);
  // Each starting band founds a lineage named after its culture.
  assert.deepEqual(state.living.map(id => state.polities[id].lineage), state.living.map((_, index) => index));
  assert.deepEqual(state.lineages, state.living.map(id => state.cultures[state.polities[id].culture].name));
  const start = collectStats(state, 0);
  for (let month = 0; month < 500 * 12; month++) stepSimulation(state);
  const end = collectStats(state, 500), m = state.metrics;
  assert.equal(m.silentBandYears, 0, 'every band of at least 50 people records births and deaths every year');
  assert.ok(end.population > start.population * 20, `population grows: ${start.population} → ${end.population}`);
  assert.ok(m.maxOverCapacityMonths <= 24, `no region stays above 1.1× capacity for more than 24 months (${m.maxOverCapacityMonths})`);
  assert.ok(end.bands >= 3 * start.bands && end.occupiedRegions >= 3 * start.occupiedRegions, `bands ${start.bands} → ${end.bands}`);
  // A split either stays in its tribe (band spread) or breaks away as a new tribe (band split); both are events.
  const moves = state.chronicle.events.filter(event => event.type === 'bandMoved'), splits = state.chronicle.events.filter(event => event.type === 'bandSplit' || event.type === 'bandSpread');
  assert.equal(moves.length, m.moves); assert.equal(splits.length, m.splits);
  assert.ok(moves.length > 20 && splits.length > 100);
  const breakaways = splits.filter(event => event.type === 'bandSplit').length;
  assert.equal(breakaways, m.breakaways);
  assert.ok(breakaways > 0 && breakaways * 2 < splits.length, `splits mostly stay in their tribe (${breakaways} of ${splits.length} broke away)`);
  assert.ok(end.tribes < end.bands, `tribes hold several bands (${end.tribes} tribes, ${end.bands} bands)`);
  for (const event of [...moves, ...splits]) assert.ok(event.causes.length > 0 && event.region !== null, `${event.type} ${event.id} records causes and a place`);
  // Peoples meet as they spread (M3): each first contact is an event, between polities that know each other since.
  const contacts = state.chronicle.events.filter(event => event.type === 'firstContact');
  assert.ok(contacts.length > 0 && contacts.length === m.firstContacts, `${contacts.length} first contacts`);
  for (const event of contacts) assert.ok(state.polities[event.actors[0].id].met.has(event.actors[1].id) && state.polities[event.actors[1].id].met.has(event.actors[0].id));
  const citing = moves.filter(event => event.causes.some(cause => (cause.factor === 'gameDepletion' || cause.factor === 'landPressure') && cause.weight >= 0.1));
  assert.ok(citing.length * 2 >= moves.length, `${citing.length} of ${moves.length} moves cite game depletion or land pressure`);
  assert.ok(end.waterPopulationShare >= 1.25 * end.waterRegionShare, `water share ${end.waterPopulationShare} vs ${end.waterRegionShare}`);
  // Every daughter keeps its parent's lineage, so a people's spread can be followed from its founder.
  for (const polity of state.polities) if (polity.parent !== null) assert.equal(polity.lineage, state.polities[polity.parent].lineage);
  const bands = state.living.flatMap(id => state.polities[id].groups.map(groupId => state.groups[groupId].region));
  const water = bands.filter(region => isWaterRegion(state, region)).length;
  assert.ok(water > 0 && water < bands.length, 'bands live both near water and inland');
});

test('exact accounting catches any population or food change without a recorded cause', async () => {
  const { geography, partition } = await chronicleWorld();
  const tamper = (change: (state: ReturnType<typeof createSimulation>) => void, pattern: RegExp) => {
    const state = createSimulation(geography, partition, 'Accounting');
    for (let month = 0; month < 24; month++) stepSimulation(state);
    change(state);
    assert.throws(() => checkInvariants(state), (error: Error) => error instanceof InvariantError && pattern.test(error.message));
  };
  const core = (state: ReturnType<typeof createSimulation>, at: number) => state.groups[state.polities[state.living[at]].core];
  tamper(state => { core(state, 0).size += 1; }, /population .* differs from its accounted/);
  tamper(state => { core(state, 1).store += 1; }, /food store .* is not explained/);
  tamper(state => { core(state, 1).region = core(state, 0).region; }, /holds bands|does not record/);
  // Transfers must close across regions and bands: a split that forgot to take people and food from its parent
  // would balance each region and band on its own books, but create people and food from nothing.
  tamper(state => {
    const group = core(state, 2);
    group.size += 40; state.ledger.migrantsIn[group.region] += 40;
  }, /left regions but .* arrived/);
  tamper(state => {
    const group = core(state, 3);
    group.store += 500; state.ledger.food.get(group.id)!.carriedIn += 500;
  }, /carried out but .* carried in/);
  // Contact that only one side remembers, and a band that does not see its own region.
  tamper(state => {
    // Contact is checked yearly per polity, staggered by id: tamper with one whose check falls this month.
    const polity = state.polities[state.living.find(id => (state.tick + id) % 12 === 0)!], other = state.living.find(id => id !== polity.id)!;
    polity.met.set(other, state.tick); state.polities[other].met.delete(polity.id);
  }, /not the other way round/);
  tamper(state => { const polity = state.polities[state.living[2]]; polity.map.status[state.groups[polity.core].region] = 0; }, /does not see its own region/);
  // An empty region that still names a band.
  tamper(state => { state.groupAt[state.partition.regions.find(region => state.occupant[region.id] < 0)!.id] = 0; }, /records a band that is not there/);
});

test('breaking away is graded by travel from the heartland, the tribe\'s size and its culture, and never certain', () => {
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const chance = (km: number, bands: number, culture: Partial<typeof values> = {}) => breakawayOdds(km, bands, { ...values, ...culture }).chance;
  const reach = BAND_TUNING.reachKm;
  assert.ok(chance(300, 1) < 0.02, `a small tribe's split next to its heartland almost always stays (${chance(300, 1)})`);
  assert.ok(chance(300, 1) < chance(reach, 1) && chance(reach, 1) < chance(2 * reach, 1), 'likelier the further from the heartland in travel');
  assert.ok(chance(2 * reach, 1) > 0.9 && chance(2 * reach, 1) < 1, 'far away it is likely, never certain');
  assert.ok(chance(300, 5) < chance(300, 40) && chance(300, 40) < chance(300, BAND_TUNING.tribeBands), 'likelier the larger the tribe');
  assert.ok(chance(300, BAND_TUNING.tribeBands) > 0.5 && chance(300, BAND_TUNING.tribeBands) < 0.75, 'a tribe of tribeBands bands loses most splits even near home');
  assert.ok(chance(reach, 10, { expansionism: 0.9, tradition: 0.1 }) > chance(reach, 10) && chance(reach, 10) > chance(reach, 10, { expansionism: 0.1, tradition: 0.9 }), 'Expansionism raises it, Tradition lowers it');
  assert.equal(chance(Number.POSITIVE_INFINITY, 1), 1, 'land cut off from the heartland always goes its own way');
});

test('a split from a real tribe is never certain to break away, wherever it goes', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Breakaways');
  while (state.tick < 12 * 250) stepSimulation(state);
  let options = 0;
  for (const id of state.living) {
    const tribe = state.polities[id];
    for (const groupId of tribe.groups) for (const option of reachableFree(state, tribe, state.groups[groupId].region)) {
      const chance = breakawayChance(state, tribe, option.region).chance;
      assert.ok(chance > 0 && chance < 1, `tribe ${id} into region ${option.region}: ${chance}`);
      options++;
    }
  }
  assert.ok(options > 100, `${options} splits weighed`);
});

test('a tribe that loses its heartland band passes the heartland to another of its bands', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Heartland');
  while (!state.living.some(id => state.polities[id].groups.length >= 3)) stepSimulation(state);
  const tribe = state.polities[state.living.find(id => state.polities[id].groups.length >= 3)!], heartland = state.groups[tribe.core], region = heartland.region;
  heartland.size = 1; heartland.famineCarry = 0.999; heartland.naturalCarry = 0.999; heartland.birthCarry = 0; heartland.foodSecurity = 0;
  stepSimulation(state);
  assert.notEqual(heartland.deathTick, null, 'the heartland band died out');
  assert.equal(tribe.deathTick, null, 'the tribe lives on');
  assert.ok(tribe.core !== heartland.id && tribe.groups.includes(tribe.core), 'one of its other bands is the heartland now');
  assert.equal(state.occupant[region], -1); assert.equal(state.groupAt[region], -1);
});

test('a band that dies out frees its region and its stored food is recorded as spoilage', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Dissolution');
  for (let month = 0; month < 12; month++) stepSimulation(state);
  const band = state.polities[state.living.find(id => state.polities[id].groups.length === 1)!], group = state.groups[band.core], region = group.region;
  // One person on the brink of a famine death, holding some food.
  group.size = 1; group.famineCarry = 0.999; group.naturalCarry = 0.999; group.birthCarry = 0; group.foodSecurity = 0;
  stepSimulation(state);
  assert.notEqual(band.deathTick, null, 'the band died out');
  assert.equal(state.occupant[region], -1);
  assert.ok(!state.living.includes(band.id));
  assert.equal(group.store, 0);
  const flows = state.ledger.food.get(group.id)!;
  assert.equal(flows.before + flows.production - flows.consumption - flows.spoilage + flows.carriedIn - flows.carriedOut, 0, 'its last food is accounted for');
});
