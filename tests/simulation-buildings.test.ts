import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDING_INDEX, BUILDINGS, buildingKnown, validateBuildings } from '../src/simulation/buildings.ts';
import { regionCapacity } from '../src/simulation/bands.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { FARM_METHOD, METHOD_COUNT } from '../src/simulation/food.ts';
import { beginWonder, construct, startProjects } from '../src/simulation/construction.ts';
import { bestBuild, bestWonder, buildScore, need, needParts } from '../src/simulation/decisions/build.ts';
import { incomeOf, loseWealth, produceWealth, siteIncome, transferWealth, wealthFlows, wonderBonus } from '../src/simulation/economy.ts';
import { crosses, knowsOfWonder, seaFrom, wonderOptions } from '../src/simulation/perception.ts';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { createLanguage } from '../src/simulation/names.ts';
import type { PolityView } from '../src/simulation/perception.ts';
import { createRng } from '../src/simulation/rng.ts';
import { applyBuildings, foundSettlement, house, housingOf, ruinSettlements } from '../src/simulation/settlements.ts';
import { WONDER_INDEX, WONDERS } from '../src/simulation/wonders.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { BUDGET_TUNING, BUILD_TUNING, SETTLEMENT_TUNING, WEALTH_TUNING } from '../src/simulation/tunables.ts';

test('buildings are data: each unlocked by a tech that names it, and known only once that tech is', () => {
  assert.doesNotThrow(validateBuildings);
  for (const name of ['granary', 'walls', 'shrine', 'temple', 'library', 'market', 'aqueduct']) assert.ok(BUILDING_INDEX.has(name), name);
  const granary = BUILDING_INDEX.get('granary')!, library = BUILDING_INDEX.get('library')!;
  let knowledge = startingKnowledge();
  assert.equal(buildingKnown(knowledge, granary), false);
  knowledge = learn(knowledge, TECH_INDEX.get('Masonry')!);
  assert.equal(buildingKnown(knowledge, granary), true, 'Masonry unlocks the granary');
  assert.equal(buildingKnown(knowledge, library), false);
});

/** Test fixture: one civilization holding one region (cells 0–5 of a 6 × 2 strip, all by a river) with its people. */
function fixture() {
  const cells = 12, width = 6, riverRunoff = new Uint32Array(cells).fill(9_000);
  const state = {
    tick: 0, geography: { width, cells, riverRunoff, resource: new Uint8Array(cells), marine: new Uint8Array(cells), lake: new Uint32Array(cells) },
    partition: { regions: [{ id: 0, centroid: 0, settlementSites: [0, 1, 2, 3, 4], neighbors: [] }], regionOf: new Int32Array(cells) },
    cultures: [{ language: createLanguage(createRng(1, 1)) }], settlements: [], regionSettlements: [[]], chronicle: new Chronicle(),
    groups: [{ id: 0, region: 0, specialists: 0, foodSecurity: 1, size: 100_000, farmShare: 0 }], groupAt: new Int32Array([0]), unrest: new Uint8Array(1), stability: new Float64Array(1).fill(1),
    remoteness: new Float64Array(1), remoteOwner: new Int32Array([0]),
    living: [0], ledger: { wealth: new Map() }, wonders: [], roads: new Map(), owner: new Int32Array([0]),
    farmBonus: new Float64Array(1).fill(1), droughtShield: new Float64Array(1), storeBonus: new Float64Array(1).fill(1), spoilageBonus: new Float64Array(1).fill(1),
    metrics: { settlementsGrown: 0, ruinsResettled: 0, tierChanges: 0, buildingsStarted: 0, buildingsCompleted: 0, buildingsLost: 0, projectsAbandoned: 0, wondersBegun: 0, wondersCompleted: 0, wondersDestroyed: 0, wondersAbandoned: 0, roadsAbandoned: 0, arrearsBegun: 0, taxesRaised: 0, taxesEased: 0 },
  } as unknown as SimulationState;
  const civ = { id: 0, kind: 'civ', name: 'Ora', culture: 0, capital: null, groups: [0], wealth: 0, wealthCarry: 0, upkeepCarry: 0, projects: [], roadWorks: [], roadsUnpaid: 0, heardWonders: [], met: new Map(),
    settledTick: 0, taxRate: BUDGET_TUNING.customaryRate, arrears: 0, inArrears: false, heavyTaxes: false, knowledge: { multipliers: { reach: 1 } } } as unknown as Polity;
  state.polities = [civ];
  return { state, civ };
}
/** A month of construction; returns what the realm paid for running it (administration, services, upkeep). */
const month = (state: SimulationState, tick: number) => {
  state.ledger.wealth.clear(); state.tick = tick;
  const flows = wealthFlows(state, state.polities[0]);
  construct(state, { tick } as never);
  return flows.administration + flows.services + flows.upkeep;
};

test('townspeople earn wealth, recorded to the unit; a union passes the treasury on and a civilization that dies loses it', () => {
  const { state, civ } = fixture();
  foundSettlement(state, createRng(5, 5), civ, 0, true, 0);
  state.groups[0].specialists = house(state, 0, 6_000);
  // Taxes at the customary rate on what 6,000 townspeople's trades produce (no farmers here).
  assert.equal(incomeOf(state, civ), BUDGET_TUNING.customaryRate * BUDGET_TUNING.townOutput * 6_000);
  produceWealth(state, civ);
  assert.equal(civ.wealth, 500); assert.equal(wealthFlows(state, civ).produced, 500);
  const other = { id: 1, wealth: 0, projects: [], roadWorks: [] } as unknown as Polity;
  transferWealth(state, civ, other);
  assert.deepEqual([civ.wealth, other.wealth, wealthFlows(state, civ).given, wealthFlows(state, other).received], [0, 500, 500, 500]);
  other.projects.push({ settlement: 0, type: 0, spent: 0, cost: 1, startedTick: 0, causes: [], waited: 0 });
  other.roadWorks.push({ from: 0, to: 0, path: [0, 1], tier: 1, edges: [[0, 1]], bridges: 0, spent: 0, cost: 1, months: 1, startedTick: 0, causes: [] });
  loseWealth(state, other);
  assert.deepEqual([other.wealth, wealthFlows(state, other).lost, other.projects.length, state.metrics.projectsAbandoned], [0, 500, 0, 1]);
  assert.deepEqual([other.roadWorks.length, state.metrics.roadsAbandoned], [0, 1], 'and its roads under way');
});

test('a building is paid in instalments, completed with the causes that began it, and changes its settlement (housing)', () => {
  const { state, civ } = fixture();
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  const market = BUILDING_INDEX.get('market')!, definition = BUILDINGS[market];
  // Enough for the market and for running the realm meanwhile (its administration and services come first).
  civ.wealth = definition.cost + 20_000;
  assert.equal(startProjects(state, 0, civ, market, [town.id], []), 'nowhere left to build it', 'a market needs a town');
  town.tier = 1;
  assert.equal(startProjects(state, 0, civ, market, [town.id], [{ factor: 'commerce', weight: 0.2 }]), 'began a market');
  assert.equal(startProjects(state, 0, civ, market, [town.id], []), 'nowhere left to build it', 'not twice in one place');
  let running = 0;
  for (let tick = 1; tick <= definition.months; tick++) running += month(state, tick);
  state.chronicle.flush(definition.months);
  const done = state.chronicle.events.find(event => event.type === 'buildingCompleted')!;
  assert.ok(done && done.settlement === town.id && done.causes[0].factor === 'commerce');
  assert.deepEqual(town.buildings.map(building => BUILDINGS[building.type].name), ['market']);
  assert.equal(town.housing, Math.round(SETTLEMENT_TUNING.baseHousing * SETTLEMENT_TUNING.capitalHousing * definition.effects.housing!));
  assert.ok(running > 0); assert.equal(civ.wealth, 20_000 - running, 'the market paid in full, and the realm\'s costs'); assert.equal(civ.projects.length, 0);
  // Work in a settlement that falls to ruin is abandoned.
  civ.wealth = 1_000;
  startProjects(state, 20, civ, BUILDING_INDEX.get('granary')!, [town.id], []);
  ruinSettlements(state, 0, 21);
  month(state, 22);
  assert.equal(civ.projects.length, 0); assert.equal(state.metrics.projectsAbandoned, 1);
});

test('unpaid upkeep wears buildings down until they are lost, an event citing it; paid upkeep mends them', () => {
  const { state, civ } = fixture();
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  const temple = BUILDING_INDEX.get('temple')!;
  town.buildings.push({ type: temple, condition: 1, builtTick: 0 });
  applyBuildings(town);
  civ.wealth = 0;
  for (let tick = 1; tick <= 12; tick++) month(state, tick);
  const worn = town.buildings[0].condition;
  assert.ok(worn < 1 && worn > 0, `worn to ${worn}`);
  civ.wealth = 1_000_000;
  month(state, 13);
  assert.ok(town.buildings[0].condition > worn, 'paid, it mends');
  civ.wealth = 0;
  for (let tick = 14; tick <= 14 + BUILD_TUNING.decayMonths * 2; tick++) month(state, tick);
  assert.equal(town.buildings.length, 0);
  state.chronicle.flush(200);
  const lost = state.chronicle.events.find(event => event.type === 'buildingDecayed')!;
  assert.ok(lost.causes.some(cause => cause.factor === 'unpaidUpkeep')); assert.equal(state.metrics.buildingsLost, 1);
});

test('the Build choice weighs each building\'s need where it is greatest against its cost and upkeep', () => {
  const settlement = (entry: Partial<PolityView['build']['settlements'][number]>) => ({ id: 1, region: 0, name: 'Kesh', tier: 1, urban: 8_000, housing: 8_000, hardship: 0, farmShare: 1, farmers: 20_000, stability: 0.9, frontier: 0, has: [] as number[],
    coast: false, water: true, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false, ...entry });
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  assert.ok(need('food', settlement({ hardship: 0.6 }), values) > need('food', settlement({}), values), 'hard years call for granaries');
  assert.ok(need('faith', settlement({ stability: 0.4 }), values) > need('faith', settlement({}), values), 'unrest calls for shrines and temples');
  assert.ok(need('faith', settlement({}), { ...values, zeal: 0.9 }) > need('faith', settlement({}), { ...values, zeal: 0.1 }), 'pious peoples build more');
  // Shrines and temples cite the region's instability and the people's piety, not unrest it does not have.
  const faith = needParts('faith', settlement({ stability: 0.6 }), values);
  assert.deepEqual(Object.keys(faith), ['instability', 'piety']);
  assert.ok(Math.abs(faith.instability + faith.piety - need('faith', settlement({ stability: 0.6 }), values)) < 1e-12);
  assert.ok(need('housing', settlement({ urban: 7_900 }), values) > 0.5 && need('housing', settlement({ urban: 2_000 }), values) === 0, 'crowded towns need housing');
  assert.equal(need('defense', settlement({ frontier: 0 }), values), 0, 'no foreign neighbours, no walls');
  const granary = BUILDING_INDEX.get('granary')!, temple = BUILDING_INDEX.get('temple')!;
  const kind = (type: number) => ({ type, name: BUILDINGS[type].name, one: BUILDINGS[type].one, many: BUILDINGS[type].many, purpose: BUILDINGS[type].purpose, cost: BUILDINGS[type].cost, upkeep: BUILDINGS[type].upkeep, minTier: BUILDINGS[type].minTier, coast: BUILDINGS[type].coast, water: BUILDINGS[type].water, perRegion: BUILDINGS[type].perRegion, works: BUILDINGS[type].effects.works ?? '' as const });
  const kinds = [granary, temple].map(kind);
  const view = (settlements: ReturnType<typeof settlement>[], wealth = 100_000, income = 50_000) => ({ values, budget: { rate: 0.2, output: income * 5, sites: 0, costs: 0, treasury: wealth, revenue: income, surplus: income, strain: 0, tradition: 0.5, calm: 0.9 }, build: { regions: 1, catalog: kinds, settlements, wonders: [], stability: 0.9 } }) as unknown as PolityView;
  const hungry = view([settlement({ id: 1, hardship: 0.8 }), settlement({ id: 2, hardship: 0.1, name: 'Tal' })]);
  const option = bestBuild(hungry)!;
  assert.equal(option.target, granary); assert.deepEqual(option.targets, [1], 'the hungriest settlement first, one at a time for a civilization of one region');
  assert.equal(option.factors[0].factor, 'hardship'); assert.equal(option.label, 'a granary at Kesh');
  // Without hard years, a granary is wanted for farmers' storage, and says so.
  const calm = bestBuild(view([settlement({ hardship: 0 })]))!;
  assert.equal(calm.target, granary); assert.deepEqual(calm.factors.filter(entry => entry.weight > 0).map(entry => entry.factor), ['storage']);
  assert.equal(buildScore(view([settlement({ has: [granary] })]), kinds[0]).score, Number.NEGATIVE_INFINITY, 'nothing to build where it stands');
  assert.equal(buildScore(view([settlement({ tier: 0 })]), kinds[1]).score, Number.NEGATIVE_INFINITY, 'a temple needs a town');
  assert.ok(buildScore(view([settlement({ hardship: 0.8 })], 0, 100), kinds[0]).score < option.score, 'a poor civilization weighs the cost more');
  // Mines and quarries are worth what their region's usable sites would earn, whatever the settlement's size; a harbor
  // needs the sea beside the settlement and crossings within reach.
  const mine = kind(BUILDING_INDEX.get('mine')!), harbor = kind(BUILDING_INDEX.get('harbor')!);
  assert.equal(buildScore(view([settlement({})]), mine).score, Number.NEGATIVE_INFINITY, 'no usable deposits, no mine');
  const rich = buildScore(view([settlement({ tier: 0, urban: 500, mineYield: 4_000 })]), mine);
  assert.ok(rich.score > 0 && rich.factors[0].factor === 'deposits', 'gold in a small village is worth a mine');
  // A large civilization begins several at once, but never two in one region (one mine works all its sites).
  const wide = { ...view([settlement({ id: 1, mineYield: 4_000 }), settlement({ id: 2, mineYield: 4_000 }), settlement({ id: 3, region: 5, mineYield: 3_000 })]) };
  wide.build.regions = 40;
  assert.deepEqual(buildScore(wide, mine).targets, [1, 3], 'the best settlement in each region');
  assert.equal(buildScore(view([settlement({ seaLinks: 3 })]), harbor).score, Number.NEGATIVE_INFINITY, 'inland');
  assert.ok(buildScore(view([settlement({ coast: true, seaLinks: 3 })]), harbor).score > buildScore(view([settlement({ coast: true, seaLinks: 1 })]), harbor).score, 'more crossings in reach');
});

test('a mine works its region\'s mineral sites for wealth, once the civilization can use them; a harbor opens the sea from its region', () => {
  const { state, civ } = fixture();
  const gold = RESOURCE_IDS.indexOf('gold') + 1, copper = RESOURCE_IDS.indexOf('copper') + 1;
  Object.assign(state.partition.regions[0], { sites: [[0, gold], [1, copper]], sea: [] });
  Object.assign(state, { harbors: new Uint8Array(1), owner: new Int32Array([0]) });
  civ.knowledge = startingKnowledge();
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  assert.equal(siteIncome(state, civ, 0, 'mineral'), 0, 'without Mining nothing is usable');
  for (const name of ['Masonry', 'Mining']) civ.knowledge = learn(civ.knowledge, TECH_INDEX.get(name)!);
  assert.equal(siteIncome(state, civ, 0, 'mineral'), WEALTH_TUNING.siteYield.gold, 'gold once mined; copper only with Copper working');
  assert.equal(incomeOf(state, civ), 0, 'but only a mine works it');
  town.buildings.push({ type: BUILDING_INDEX.get('mine')!, condition: 1, builtTick: 0 }); applyBuildings(town);
  assert.equal(incomeOf(state, civ), WEALTH_TUNING.siteYield.gold);
  // Sea reach from a region needs Sailing and a standing harbor there, in the civilization's own land.
  civ.knowledge = learn(learn(learn(learn(civ.knowledge, TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Boatbuilding')!), TECH_INDEX.get('Fishing')!), TECH_INDEX.get('Sailing')!);
  assert.equal(seaFrom(state, civ, 0), 0, 'no harbor');
  state.harbors[0] = 1;
  assert.equal(seaFrom(state, civ, 0), 1);
  state.owner[0] = -1;
  assert.equal(seaFrom(state, civ, 0), 0, 'not its land');
  assert.ok(crosses(1, 300) && !crosses(1, 301) && crosses(2, 5_000) && !crosses(0, 10));
});

test('a wonder is begun with a motive, paid for over years, unique in the world, and lost when its city falls', () => {
  const { state, civ } = fixture();
  Object.assign(state, { harbors: new Uint8Array(1), owner: new Int32Array([0]) });
  const city = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  const gardens = WONDER_INDEX.get('hangingGardens')!, definition = WONDERS[gardens];
  assert.match(beginWonder(state, 0, civ, gardens, city.id, []), /too small/, 'the Hanging Gardens need a town');
  city.tier = 1;
  assert.match(beginWonder(state, 0, civ, gardens, city.id, [{ factor: 'ambition', weight: 0.1 }]), /began the Hanging Gardens/);
  assert.match(beginWonder(state, 0, civ, gardens, city.id, []), /being built or stands elsewhere/, 'unique in the world');
  civ.wealth = definition.cost + 100_000;
  for (let tick = 1; tick <= definition.months; tick++) month(state, tick);
  state.chronicle.flush(definition.months);
  const done = state.chronicle.events.find(event => event.type === 'wonderCompleted')!;
  assert.ok(done && done.causes[0].factor === 'ambition'); assert.equal(state.wonders[0].status, 'standing');
  assert.equal(city.wonder, gardens); assert.equal(city.housing, Math.round(housingOf({ capital: true }) * definition.effects.housing!), 'its city houses more');
  // Its city falls to ruin: the wonder is destroyed, an event, and may be built again elsewhere.
  ruinSettlements(state, 0, 400);
  state.chronicle.flush(400);
  const lost = state.chronicle.events.find(event => event.type === 'wonderDestroyed')!;
  assert.ok(lost && lost.causes[0].factor === 'cityRuined'); assert.equal(state.wonders[0].status, 'destroyed'); assert.equal(state.metrics.wondersDestroyed, 1);
  assert.equal(state.wonders[0].endCause, 'cityRuined');
  const again = foundSettlement(state, createRng(5, 6), civ, 0, true, 401)!;
  again.tier = 1;
  assert.match(beginWonder(state, 401, civ, gardens, again.id, []), /began/);
  // Unfinished work in a city that falls to ruin is abandoned: an event too.
  ruinSettlements(state, 0, 402);
  state.chronicle.flush(402);
  const abandoned = state.chronicle.events.filter(event => event.type === 'wonderDestroyed').at(-1)!;
  assert.deepEqual([abandoned.data.unfinished, abandoned.causes[0].factor, state.wonders[1].status, state.metrics.wondersAbandoned], [true, 'cityRuined', 'abandoned', 1]);
});

test('a wonder nobody pays for wears away and is destroyed; a standing wonder raises research, wealth or stability across the realm', () => {
  const { state, civ } = fixture();
  Object.assign(state, { harbors: new Uint8Array(1), owner: new Int32Array([0]) });
  const city = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  city.tier = 2;
  state.groups[0].specialists = house(state, 0, 10_000);
  const library = WONDER_INDEX.get('greatLibrary')!, colossus = WONDER_INDEX.get('colossus')!, temple = WONDER_INDEX.get('greatTemple')!;
  const stand = (type: number) => {
    state.wonders.push({ id: state.wonders.length, type, settlement: city.id, builder: 0, begunTick: 0, builtTick: 0, status: 'standing', spent: WONDERS[type].cost, cost: WONDERS[type].cost, condition: 1, endedTick: null, endCause: null, causes: [], waited: 0 });
    city.wonder = type;
  };
  const before = incomeOf(state, civ);
  stand(colossus);
  assert.ok(Math.abs(incomeOf(state, civ) - before * WONDERS[colossus].effects.wealth!) < 1e-6, 'the Colossus raises wealth');
  stand(library); stand(temple);
  assert.deepEqual(wonderBonus(state, civ), { research: WONDERS[library].effects.research!, wealth: WONDERS[colossus].effects.wealth!, stability: WONDERS[temple].effects.stability! });
  state.wonders.length = 0; city.wonder = null;
  stand(temple);
  civ.wealth = 0;
  for (let tick = 1; tick <= BUILD_TUNING.decayMonths + 2 && state.wonders[0].status === 'standing'; tick++) month(state, tick);
  state.chronicle.flush(100);
  const lost = state.chronicle.events.find(event => event.type === 'wonderDestroyed')!;
  assert.deepEqual([state.wonders[0].status, state.wonders[0].endCause, city.wonder, lost.causes[0].factor, lost.data.neglected], ['destroyed', 'unpaidUpkeep', null, 'unpaidUpkeep', true]);
});

test('works wait while their settlement is too small; one a region needs only once, or a harbor away from the sea, is refused', () => {
  const { state, civ } = fixture();
  Object.assign(state, { harbors: new Uint8Array(1), owner: new Int32Array([0]) });
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!, other = foundSettlement(state, createRng(5, 6), civ, 0, false, 0)!;
  const market = BUILDING_INDEX.get('market')!, granary = BUILDING_INDEX.get('granary')!, harbor = BUILDING_INDEX.get('harbor')!;
  town.tier = 1;
  assert.equal(startProjects(state, 0, civ, market, [town.id], []), 'began a market');
  civ.wealth = 1_000_000;
  town.tier = 0;
  month(state, 1);
  assert.equal(civ.projects[0].spent, 0, 'unpaid while the town is a village again');
  town.tier = 1;
  month(state, 2);
  assert.ok(civ.projects[0].spent > 0, 'paid once it is a town');
  assert.equal(startProjects(state, 2, civ, granary, [town.id, other.id], []), 'began a granary', 'one granary serves the region');
  assert.equal(startProjects(state, 2, civ, granary, [other.id], []), 'nowhere left to build it');
  assert.equal(startProjects(state, 2, civ, harbor, [town.id, other.id], []), 'nowhere left to build it', 'no sea beside them');
});

test('a region\'s sites are worked once, however many of its settlements have a mine', () => {
  const { state, civ } = fixture();
  const gold = RESOURCE_IDS.indexOf('gold') + 1;
  Object.assign(state.partition.regions[0], { sites: [[0, gold]], sea: [] });
  civ.knowledge = learn(learn(startingKnowledge(), TECH_INDEX.get('Masonry')!), TECH_INDEX.get('Mining')!);
  const mine = BUILDING_INDEX.get('mine')!;
  for (const seed of [5, 6]) {
    const settlement = foundSettlement(state, createRng(5, seed), civ, 0, seed === 5, 0)!;
    settlement.buildings.push({ type: mine, condition: 1, builtTick: 0 }); applyBuildings(settlement);
  }
  assert.equal(incomeOf(state, civ), WEALTH_TUNING.siteYield.gold);
});

test('the wonder choice needs a motive, a golden age and a great city', () => {
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const gardens = WONDER_INDEX.get('hangingGardens')!, definition = WONDERS[gardens];
  const view = (stability: number, urban: number, expansionism = 0.5) => ({
    values: { ...values, expansionism },
    budget: { rate: 0.2, output: 10_000_000, sites: 0, costs: 0, treasury: 50_000_000, revenue: 2_000_000, surplus: 2_000_000, strain: 0, tradition: 0.5, calm: 0.9 },
    build: {
      regions: 10, catalog: [], stability,
      settlements: [{ id: 1, region: 0, name: 'Kesh', tier: 2, urban, housing: 20_000, hardship: 0, farmShare: 1, stability, frontier: 0, has: [], coast: false, water: true, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false }],
      wonders: [{ type: gardens, name: definition.name, motive: definition.motive, cost: definition.cost, months: definition.months, upkeep: definition.upkeep, minTier: definition.minTier, coast: definition.coast }],
    },
  }) as unknown as PolityView;
  const golden = bestWonder(view(0.95, 20_000))!;
  assert.ok(golden.wonder && golden.target === gardens && golden.label === 'the Hanging Gardens at Kesh' && golden.score > 0);
  assert.ok(bestWonder(view(0.5, 20_000))!.score < 0, 'no golden age, no wonder');
  assert.ok(bestWonder(view(0.95, 2_000))!.score < golden.score, 'a small town is no place for one');
  assert.ok(bestWonder(view(0.95, 20_000, 0.9))!.score > bestWonder(view(0.95, 20_000, 0.1))!.score, 'ambition drives it');
});

test('work that waits too long for its settlement to grow back to the tier it needs is given up; a wonder\'s end is an event', () => {
  const { state, civ } = fixture();
  Object.assign(state, { harbors: new Uint8Array(1), owner: new Int32Array([0]) });
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  town.tier = 1;
  startProjects(state, 0, civ, BUILDING_INDEX.get('market')!, [town.id], []);
  const gardens = WONDER_INDEX.get('hangingGardens')!;
  beginWonder(state, 0, civ, gardens, town.id, []);
  civ.wealth = 0;
  town.tier = 0;
  for (let tick = 1; tick < BUILD_TUNING.waitMonths; tick++) month(state, tick);
  assert.deepEqual([civ.projects.length, state.wonders[0].status], [1, 'building'], 'still waiting');
  month(state, BUILD_TUNING.waitMonths);
  assert.deepEqual([civ.projects.length, state.metrics.projectsAbandoned, state.wonders[0].status, state.wonders[0].endCause], [0, 1, 'abandoned', 'cityShrank']);
  state.chronicle.flush(BUILD_TUNING.waitMonths);
  const ended = state.chronicle.events.find(event => event.type === 'wonderDestroyed')!;
  assert.deepEqual([ended.data.unfinished, ended.data.shrank, ended.causes[0].factor], [true, true, 'cityShrank']);
});

test('irrigation built by a river raises its region\'s lasting capacity at once, and only where a river or lake waters the fields', () => {
  const { state, civ } = fixture();
  const labor = new Float64Array(METHOD_COUNT); labor[FARM_METHOD] = 10_000;
  Object.assign(state, {
    harbors: new Uint8Array(1), owner: new Int32Array([0]), occupant: new Int32Array([0]), gameStock: new Float64Array([1]), capacity: new Float64Array(1), capacityGame: new Float64Array(1),
    food: { labor, baseYield: Float64Array.from([1, 1, 1, 2.2, 2.6]), farmWater: new Float64Array([1]) },
  });
  civ.knowledge = learn(learn(learn(startingKnowledge(), TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Agriculture')!), TECH_INDEX.get('Irrigation')!);
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  const irrigation = BUILDING_INDEX.get('irrigation')!, definition = BUILDINGS[irrigation];
  assert.equal(startProjects(state, 0, civ, irrigation, [town.id], []), 'nowhere left to build it', 'no river or lake in the region');
  Object.assign(state.partition.regions[0], { riverTier: 2 });
  assert.equal(startProjects(state, 0, civ, irrigation, [town.id], []), 'began irrigation works');
  const before = regionCapacity(state, 0);
  civ.wealth = definition.cost + 20_000;
  for (let tick = 1; tick <= definition.months; tick++) month(state, tick);
  assert.equal(state.farmBonus[0], definition.effects.farm);
  assert.ok(state.capacity[0] > before * 1.05, `capacity ${state.capacity[0]} after ${before}`);
});

test('word of a wonder reaches a civilization only through contact, one step further than other news, or when it tries to build the same', () => {
  const polity = (id: number) => ({ id, met: new Map<number, number>(), heardWonders: [] as number[], kind: 'civ', name: `P${id}`, deathTick: null as number | null });
  const [holder, near, far, beyond] = [0, 1, 2, 3].map(polity);
  const state = { polities: [holder, near, far, beyond], settlements: [{ id: 0, owner: 0, status: 'alive', wonder: null, tier: 2, name: 'Kesh' }, { id: 1, owner: 3, status: 'alive', wonder: null, tier: 2, name: 'Tal' }], wonders: [] as unknown[] } as unknown as SimulationState;
  const wonder = { id: 0, type: 0, settlement: 0, builder: 0, begunTick: 0, builtTick: null, status: 'building', spent: 0, cost: 1, condition: 1, endedTick: null, endCause: null, causes: [], waited: 0 } as SimulationState['wonders'][number];
  state.wonders.push(wonder);
  const knows = (civ: Polity) => knowsOfWonder(state, civ, wonder);
  assert.ok(knows(holder as unknown as Polity), 'its own');
  near.met.set(0, 0); far.met.set(1, 0);
  assert.ok(knows(near as unknown as Polity), 'met the holder');
  assert.ok(knows(far as unknown as Polity), 'met someone who met the holder');
  assert.ok(!knows(beyond as unknown as Polity), 'no word reaches a people out of contact');
  near.deathTick = 5;
  assert.ok(!knows(far as unknown as Polity), 'word travels through living peoples only');
  near.deathTick = null;
  // What it may begin: a wonder of that type is ruled out only once word of the one under way has reached it.
  const knowledge = learn(startingKnowledge(), TECH_INDEX.get(WONDERS[0].tech)!);
  const options = (civ: typeof far) => wonderOptions(state, { ...civ, knowledge } as unknown as Polity).map(option => option.type);
  assert.ok(options(beyond).includes(0), 'unheard of, the Pyramids still seem its to build');
  assert.ok(!options(far).includes(0), 'heard of: not offered');
  // Setting out to build the same, it learns of it.
  assert.match(beginWonder(state, 0, beyond as unknown as Polity, 0, 1, []), /being built or stands elsewhere/);
  assert.ok(knows(beyond as unknown as Polity));
  assert.ok(!options(beyond).includes(0));
});
