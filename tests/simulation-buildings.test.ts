import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDING_INDEX, BUILDINGS, buildingKnown, validateBuildings } from '../src/simulation/buildings.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { construct, startProjects } from '../src/simulation/construction.ts';
import { bestBuild, buildScore, need } from '../src/simulation/decisions/build.ts';
import { incomeOf, loseWealth, produceWealth, siteIncome, transferWealth, wealthFlows } from '../src/simulation/economy.ts';
import { crosses, seaFrom } from '../src/simulation/perception.ts';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { createLanguage } from '../src/simulation/names.ts';
import type { PolityView } from '../src/simulation/perception.ts';
import { createRng } from '../src/simulation/rng.ts';
import { applyBuildings, foundSettlement, house, ruinSettlements } from '../src/simulation/settlements.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { BUILD_TUNING, SETTLEMENT_TUNING, WEALTH_TUNING } from '../src/simulation/tunables.ts';

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
    groups: [{ id: 0, region: 0, specialists: 0, foodSecurity: 1, size: 100_000 }], groupAt: new Int32Array([0]), unrest: new Uint8Array(1), stability: new Float64Array(1).fill(1),
    living: [0], ledger: { wealth: new Map() },
    metrics: { settlementsGrown: 0, ruinsResettled: 0, tierChanges: 0, buildingsStarted: 0, buildingsCompleted: 0, buildingsLost: 0, projectsAbandoned: 0 },
  } as unknown as SimulationState;
  const civ = { id: 0, kind: 'civ', name: 'Ora', culture: 0, capital: null, groups: [0], wealth: 0, wealthCarry: 0, upkeepCarry: 0, projects: [] } as unknown as Polity;
  state.polities = [civ];
  return { state, civ };
}
const month = (state: SimulationState, tick: number) => { state.ledger.wealth.clear(); wealthFlows(state, state.polities[0]); construct(state, { tick } as never); };

test('townspeople earn wealth, recorded to the unit; a union passes the treasury on and a civilization that dies loses it', () => {
  const { state, civ } = fixture();
  foundSettlement(state, createRng(5, 5), civ, 0, true, 0);
  state.groups[0].specialists = house(state, 0, 6_000);
  assert.equal(incomeOf(state, civ), 6_000 * WEALTH_TUNING.perTownsperson);
  produceWealth(state, civ);
  assert.equal(civ.wealth, 500); assert.equal(wealthFlows(state, civ).produced, 500);
  const other = { id: 1, wealth: 0, projects: [] } as unknown as Polity;
  transferWealth(state, civ, other);
  assert.deepEqual([civ.wealth, other.wealth, wealthFlows(state, civ).given, wealthFlows(state, other).received], [0, 500, 500, 500]);
  other.projects.push({ settlement: 0, type: 0, spent: 0, cost: 1, startedTick: 0, causes: [] });
  loseWealth(state, other);
  assert.deepEqual([other.wealth, wealthFlows(state, other).lost, other.projects.length, state.metrics.projectsAbandoned], [0, 500, 0, 1]);
});

test('a building is paid in instalments, completed with the causes that began it, and changes its settlement (housing)', () => {
  const { state, civ } = fixture();
  const town = foundSettlement(state, createRng(5, 5), civ, 0, true, 0)!;
  const market = BUILDING_INDEX.get('market')!, definition = BUILDINGS[market];
  civ.wealth = definition.cost;
  assert.equal(startProjects(state, 0, civ, market, [town.id], [{ factor: 'commerce', weight: 0.2 }]), 'began a market');
  assert.equal(startProjects(state, 0, civ, market, [town.id], []), 'nowhere left to build it', 'not twice in one place');
  for (let tick = 1; tick <= definition.months; tick++) month(state, tick);
  state.chronicle.flush(definition.months);
  const done = state.chronicle.events.find(event => event.type === 'buildingCompleted')!;
  assert.ok(done && done.settlement === town.id && done.causes[0].factor === 'commerce');
  assert.deepEqual(town.buildings.map(building => BUILDINGS[building.type].name), ['market']);
  assert.equal(town.housing, Math.round(SETTLEMENT_TUNING.baseHousing * SETTLEMENT_TUNING.capitalHousing * definition.effects.housing!));
  assert.equal(civ.wealth, 0); assert.equal(civ.projects.length, 0);
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
  const settlement = (entry: Partial<PolityView['build']['settlements'][number]>) => ({ id: 1, name: 'Kesh', tier: 1, urban: 8_000, housing: 8_000, hardship: 0, farmShare: 1, stability: 0.9, frontier: 0, has: [] as number[],
    coast: false, seaLinks: 0, mineYield: 0, quarryYield: 0, ...entry });
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  assert.ok(need('food', settlement({ hardship: 0.6 }), values) > need('food', settlement({}), values), 'hard years call for granaries');
  assert.ok(need('faith', settlement({ stability: 0.4 }), values) > need('faith', settlement({}), values), 'unrest calls for shrines and temples');
  assert.ok(need('faith', settlement({}), { ...values, zeal: 0.9 }) > need('faith', settlement({}), { ...values, zeal: 0.1 }), 'pious peoples build more');
  assert.ok(need('housing', settlement({ urban: 7_900 }), values) > 0.5 && need('housing', settlement({ urban: 2_000 }), values) === 0, 'crowded towns need housing');
  assert.equal(need('defense', settlement({ frontier: 0 }), values), 0, 'no foreign neighbours, no walls');
  const granary = BUILDING_INDEX.get('granary')!, temple = BUILDING_INDEX.get('temple')!;
  const kind = (type: number) => ({ type, name: BUILDINGS[type].name, purpose: BUILDINGS[type].purpose, cost: BUILDINGS[type].cost, upkeep: BUILDINGS[type].upkeep, minTier: BUILDINGS[type].minTier, coast: BUILDINGS[type].coast, works: BUILDINGS[type].effects.works ?? '' as const });
  const kinds = [granary, temple].map(kind);
  const view = (settlements: ReturnType<typeof settlement>[], wealth = 100_000, income = 50_000) => ({ values, build: { wealth, income, upkeep: 0, regions: 1, catalog: kinds, settlements } }) as unknown as PolityView;
  const hungry = view([settlement({ id: 1, hardship: 0.8 }), settlement({ id: 2, hardship: 0.1, name: 'Tal' })]);
  const option = bestBuild(hungry)!;
  assert.equal(option.target, granary); assert.deepEqual(option.targets, [1], 'the hungriest settlement first, one at a time for a civilization of one region');
  assert.equal(option.factors[0].factor, 'hardship');
  assert.equal(buildScore(view([settlement({ has: [granary] })]), kinds[0]).score, Number.NEGATIVE_INFINITY, 'nothing to build where it stands');
  assert.equal(buildScore(view([settlement({ tier: 0 })]), kinds[1]).score, Number.NEGATIVE_INFINITY, 'a temple needs a town');
  assert.ok(buildScore(view([settlement({ hardship: 0.8 })], 0, 100), kinds[0]).score < option.score, 'a poor civilization weighs the cost more');
  // Mines and quarries are worth what their region's usable sites would earn, whatever the settlement's size; a harbor
  // needs the sea beside the settlement and crossings within reach.
  const mine = kind(BUILDING_INDEX.get('mine')!), harbor = kind(BUILDING_INDEX.get('harbor')!);
  assert.equal(buildScore(view([settlement({})]), mine).score, Number.NEGATIVE_INFINITY, 'no usable deposits, no mine');
  const rich = buildScore(view([settlement({ tier: 0, urban: 500, mineYield: 4_000 })]), mine);
  assert.ok(rich.score > 0 && rich.factors[0].factor === 'deposits', 'gold in a small village is worth a mine');
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
