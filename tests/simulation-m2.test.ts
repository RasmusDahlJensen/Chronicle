import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { farmingPotential } from '../src/simulation/food.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { learn } from '../src/simulation/knowledge.ts';
import { exposureOf } from '../src/simulation/research.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stepSimulation, worldPopulation } from '../src/simulation/simulation.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';

async function chronicleWorld() {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Chronicle', size: 'large' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

const AGRICULTURE = TECH_INDEX.get('Agriculture')!;

test('M2 acceptance on Chronicle: Agriculture on fertile river land by 600, a farming boom, settled villages and causes', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Chronicle');
  // Every tick runs the invariants, including the rule that no polity holds another landmass before Sailing.
  const population = [worldPopulation(state)];
  let viaNeighbours = 0;
  while (state.tick < 12 * 900) {
    // Knowledge moves at most one contact a month: whoever learns Agriculture from neighbours this month has a contact
    // that knew it when the month began.
    const knew = new Uint8Array(state.polities.length);
    for (const id of state.living) knew[id] = state.polities[id].knowledge.known[AGRICULTURE];
    const from = state.chronicle.events.length;
    stepSimulation(state);
    for (const event of state.chronicle.events.slice(from)) {
      if (event.type !== 'techDiscovered' || event.data.tech !== 'Agriculture' || !event.causes.some(cause => cause.factor === 'exposure')) continue;
      const learner = state.polities[event.actors[0].id];
      assert.ok(learner.contacts.some(other => knew[other]), `polity ${learner.id} learned Agriculture in month ${event.tick} from a contact who knew it before`);
      viaNeighbours++;
    }
    if (state.tick % 12 === 0) population.push(worldPopulation(state));
    // The exposure cache, wherever it is valid, equals a fresh count.
    if (state.tick % 60 === 0) for (const id of state.living) {
      const polity = state.polities[id], cache = polity.exposure;
      if (cache.tech >= 0 && cache.learned === state.learnedCount[cache.tech] && cache.deaths === state.deathCount) assert.equal(cache.value, exposureOf(state, polity, cache.tech));
    }
  }
  assert.ok(viaNeighbours > 100, `${viaNeighbours} polities learned Agriculture from neighbours`);
  const first = state.firsts.find(entry => entry.tech === AGRICULTURE);
  assert.ok(first, 'Agriculture is discovered');
  assert.ok(first.tick <= 600 * 12, `Agriculture by year 600 (year ${first.tick / 12})`);
  const region = partition.regions[first.region];
  const potentials = partition.regions.map(entry => farmingPotential(state.food, entry.id)).sort((a, b) => a - b);
  assert.ok(farmingPotential(state.food, region.id) >= potentials[Math.floor(potentials.length * 0.75)], 'first in a top-quartile farming region');
  assert.ok(region.riverTier >= 2 || region.openLake, 'by a river or with open-lake access');
  // Growth after a quarter of living polities know Agriculture is at least 3× the growth before.
  const quarter = Math.floor(state.agricultureQuarterYear);
  assert.ok(quarter > 0 && quarter + 300 <= 900, `a quarter know Agriculture in year ${quarter}`);
  const rate = (from: number, to: number) => (population[to] / population[from]) ** (1 / (to - from)) - 1;
  const before = rate(Math.max(0, quarter - 300), quarter), after = rate(quarter, quarter + 300);
  const grows = before <= 0 ? after >= 0.001 : after > 0 && after >= 3 * before;
  assert.ok(grows, `growth ${(before * 100).toFixed(2)}%/yr before, ${(after * 100).toFixed(2)}%/yr after`);
  // M1's rules still hold through the farming era.
  assert.equal(state.metrics.silentBandYears, 0, 'every band of 50 or more has births and deaths every year');
  assert.ok(state.metrics.maxOverCapacityMonths <= 24, `no region above 1.1× capacity for more than 24 months (${state.metrics.maxOverCapacityMonths})`);
  // Farmers settled into civilizations with village capitals; discoveries record why.
  const civs = state.living.filter(id => state.polities[id].kind === 'civ');
  assert.ok(civs.length > state.living.length / 2, `${civs.length} of ${state.living.length} polities settled`);
  for (const id of civs) assert.equal(state.settlements[state.polities[id].capital!].owner, id);
  const discoveries = state.chronicle.events.filter(event => event.type === 'techDiscovered');
  assert.equal(discoveries.length, state.metrics.discoveries);
  // Every discovery says how it was reached; the first Agriculture also says why it was chosen there.
  assert.ok(discoveries.every(event => event.causes.some(cause => cause.factor === 'exposure' && cause.weight > 0) || event.causes.some(cause => cause.factor === 'ownResearch' && cause.weight >= 0.99)),
    'learned from neighbours, or invented with the polity\'s own research');
  const invention = discoveries.find(event => event.data.tech === 'Agriculture' && event.data.first === true)!;
  assert.ok(invention.causes.some(cause => cause.factor === 'fertileRiver'), `the first Agriculture cites fertile river land: ${JSON.stringify(invention.causes)}`);
  const settled = state.chronicle.events.filter(event => event.type === 'settled');
  assert.equal(settled.length, state.metrics.settled);
  const farmingSettlers = settled.filter(event => event.causes.some(cause => cause.factor === 'farming' && cause.weight >= 0.05)).length;
  assert.ok(farmingSettlers * 2 > settled.length, `most settlers already live mostly by farming or herding (${farmingSettlers} of ${settled.length})`);
  // Specialists work in settlements only.
  assert.ok(state.living.every(id => state.polities[id].kind === 'civ' || state.polities[id].groups.every(group => state.groups[group].specialists === 0)));
  assert.ok(civs.some(id => state.polities[id].groups.some(group => state.groups[group].specialists > 0)), 'surplus frees specialists');
  // Civilizations remember land beyond their sight, from their own travels and from their neighbours (M3).
  assert.ok(civs.filter(id => state.polities[id].map.snapshots.size > 0).length * 2 > civs.length, 'most civilizations know land they cannot see');
  // Whole tribes settled: civilizations of many regions, a village in each (the invariants check one living village per
  // region they hold and the capital in the heartland every month).
  assert.ok(settled.some(event => (event.data.regions as number) >= 10), 'tribes of ten or more regions settled as one');
  assert.ok(civs.some(id => state.polities[id].groups.length >= 10));
  // A civilization that loses its capital village moves the capital to its new heartland; one that loses every village
  // in the same month ends at once, without moving its capital on the way.
  const civ = state.polities[civs.find(id => state.polities[id].groups.length >= 5)!];
  const dying = (groupId: number) => Object.assign(state.groups[groupId], { size: 1, famineCarry: 0.999, naturalCarry: 0.999, birthCarry: 0, foodSecurity: 0 });
  const oldCapital = state.settlements[civ.capital!], oldCore = civ.core;
  dying(oldCore);
  let from = state.chronicle.events.length;
  stepSimulation(state);
  const moved = state.chronicle.events.slice(from).filter(event => event.type === 'capitalMoved' && event.actors[0].id === civ.id);
  assert.equal(moved.length, 1, 'the capital moved once');
  assert.equal(oldCapital.status, 'ruined');
  assert.ok(civ.core !== oldCore && state.settlements[civ.capital!].region === state.groups[civ.core].region, 'the new capital is in the new heartland');
  const villages = civ.groups.length;
  for (const groupId of civ.groups) dying(groupId);
  from = state.chronicle.events.length;
  stepSimulation(state);
  const ending = state.chronicle.events.slice(from).filter(event => event.actors[0]?.id === civ.id);
  assert.notEqual(civ.deathTick, null);
  assert.deepEqual(ending.map(event => event.type), ['civDestroyed'], `all ${villages} villages died in one month: one event`);
  assert.ok(state.settlements.every(settlement => settlement.owner !== civ.id || settlement.status === 'ruined'));
});

test('a polity on another landmass without Sailing (rail is not Sailing), a civilization without its village, or unexplained crops break the invariants', async () => {
  const { geography, partition } = await chronicleWorld();
  const tamper = (change: (state: ReturnType<typeof createSimulation>) => void, pattern: RegExp) => {
    const state = createSimulation(geography, partition, 'Landmass');
    for (let month = 0; month < 24; month++) stepSimulation(state);
    change(state);
    assert.throws(() => checkInvariants(state), (error: Error) => error instanceof InvariantError && pattern.test(error.message));
  };
  // Carry a tribe's heartland band to a free region of another landmass, with the ledger balanced, as a sea crossing would.
  const carry = (state: ReturnType<typeof createSimulation>, band: ReturnType<typeof createSimulation>['polities'][number]) => {
    const group = state.groups[band.core], from = group.region;
    const target = partition.regions.find(region => region.landmass !== band.homeLandmass && state.occupant[region.id] < 0)!;
    state.ledger.migrantsOut[from] += group.size; state.ledger.migrantsIn[target.id] += group.size;
    state.occupant[from] = -1; state.groupAt[from] = -1; state.occupant[target.id] = band.id; state.groupAt[target.id] = group.id;
    group.region = target.id;
  };
  tamper(state => carry(state, state.polities[state.living[0]]), /without Sailing/);
  tamper(state => {
    // Rail or flight is not Sailing: a polity that knows Railways but not Sailing is still bound to its landmass.
    const band = state.polities[state.living[2]];
    band.knowledge = learn(band.knowledge, TECH_INDEX.get('Railways')!);
    carry(state, band);
  }, /without Sailing/);
  tamper(state => {
    const band = state.polities[state.living[1]];
    band.kind = 'civ'; for (const group of band.groups) state.owner[state.groups[group].region] = band.id;
  }, /has no village there/);
  tamper(state => { state.groups[state.polities[state.living[3]].core].planted += 100; }, /crops in the field/);
});
