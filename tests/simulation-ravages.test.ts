import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { harvestYield } from '../src/simulation/environment.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { borderingCivs, decisionView } from '../src/simulation/perception.ts';
import { ravage } from '../src/simulation/ravages.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng } from '../src/simulation/rng.ts';
import { ROAD_TIERS, roadKey, roadUpkeep } from '../src/simulation/roads.ts';
import { bonusOf, house, housingOf, livingSettlements, refreshRegionBonus } from '../src/simulation/settlements.ts';
import { BUILDINGS } from '../src/simulation/buildings.ts';
import { addWarIncome } from '../src/simulation/ravages.ts';
import { warIncomeOf } from '../src/simulation/claims.ts';
import { armyTarget } from '../src/simulation/decisions/army.ts';
import { armyView } from '../src/simulation/perception.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState, TickContext, War } from '../src/simulation/state.ts';
import { RAVAGE_TUNING, WAR_TUNING } from '../src/simulation/tunables.ts';
import { declareWar, wageWars, warBetween } from '../src/simulation/war.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * The ravages of war (M6.3; VISION.md "Diplomacy and war", "Destruction"). Each test takes a copy of a real history with
 * two civilizations whose land touches, sets up a war and an occupation, and runs the war system's months by hand (or the
 * whole simulation, with every invariant checked each month).
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
const pairOf = (state: SimulationState) => {
  for (const civ of civsOf(state).sort((a, b) => b.groups.length - a.groups.length || a.id - b.id)) {
    for (const other of borderingCivs(state, civ)) if (state.polities[other].kind === 'civ' && state.polities[other].groups.length >= 4) return [civ.id, other] as const;
  }
  return null;
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (!pairOf(history) && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(pairOf(history), 'two civilizations whose land touches');
});

/** A copy with every war over long ago and the pair at peace with no treaties between them. */
function world() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  for (const war of state.wars) if (war.endTick === null) { war.endTick = state.tick; war.outcome = 'white'; war.occupied = []; }
  for (const war of state.wars) war.endTick = Math.min(war.endTick!, state.tick - WAR_TUNING.truceYears * 12 - 1);
  for (const polity of civsOf(state)) { polity.wars = []; polity.claims = []; }
  state.occupiedBy.fill(-1); state.devastation.fill(0);
  const [a, b] = pairOf(state)!.map(id => state.polities[id]);
  for (const [one, other] of [[a, b], [b, a]]) {
    one.pacts = one.pacts.filter(id => id !== other.id); one.allies = one.allies.filter(id => id !== other.id);
    one.relations.set(other.id, { intimacy: 0.8, opinion: 0, reasons: [], memories: [] });
  }
  return { state, a, b };
}
/** A month's context: real reproducible streams. */
const context = (state: SimulationState): TickContext => ({
  tick: state.tick, year: Math.floor(state.tick / 12), month: state.tick % 12 + 1, stream: (entity = 0, salt = 0) => createRng(state.tick, entity, salt) as never,
});
const begin = (state: SimulationState, a: Polity, b: Polity) => {
  declareWar(state, a, b, decisionView(state, a).warTargets.find(entry => entry.enemy === b.id)!.goal, 'conquest', -1, []);
  return warBetween(state, a.id, b.id)!;
};
/** A month of the war system (the fronts, then the ravages) with the score held where it is set. */
const month = (state: SimulationState, war: War, score: number) => { war.score = score; state.tick++; wageWars(state, context(state)); war.score = score; ravage(state, context(state)); };
/** Tunables set for a test and put back. */
function using<T>(table: object, values: Record<string, number>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, (table as Record<string, number>)[key]]));
  Object.assign(table, values);
  try { return run(); } finally { Object.assign(table, saved); }
}
const none = { raze: 0, burn: 0, loot: 0, bridgeRate: 0, roadRate: 0, flee: 0 };
/** Hold `region` for the war's attacker since a year ago (the ravages read the occupation), and run the ravages alone. */
const occupyNow = (state: SimulationState, war: War, region: number) => {
  war.occupied.push({ region, by: war.attacker, tick: state.tick - 12, fled: 0 }); state.occupiedBy[region] = war.attacker;
};
const ravageMonth = (state: SimulationState) => { state.tick++; ravage(state, context(state)); };
/** Give a settlement standing buildings (a market and an aqueduct for housing, a harbor), full of townspeople. */
function furnish(state: SimulationState, id: number) {
  const settlement = state.settlements[id], region = settlement.region;
  settlement.buildings = [MARKET, AQUEDUCT, HARBOR].map(type => ({ type, condition: 1, builtTick: state.tick }));
  settlement.bonus = bonusOf(settlement.buildings); settlement.housing = housingOf(settlement); refreshRegionBonus(state, region);
  state.harbors[region] = livingSettlements(state, region).filter(entry => entry.bonus.harbor).length;
  const group = state.groups[state.groupAt[region]];
  group.specialists = house(state, region, Math.min(group.size - 1, livingSettlements(state, region).reduce((sum, entry) => sum + entry.housing, 0)), false);
}
const MARKET = BUILDINGS.findIndex(building => building.name === 'market'), AQUEDUCT = BUILDINGS.findIndex(building => building.name === 'aqueduct'), HARBOR = BUILDINGS.findIndex(building => building.name === 'harbor');
// (A chance of 10 is certain whatever the occupier's intent: walls aside.)
const certain = 10;

test('devastation: occupied land is devastated month by month, its harvest and fields cut, its people restless; it fades after', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  using(RAVAGE_TUNING, none, () => {
    month(state, war, WAR_TUNING.occupyStep + 1);
    const region = war.occupied[0].region, fields = state.fields[region];
    for (let at = 1; at < 12; at++) month(state, war, WAR_TUNING.occupyStep + 1);
    assert.ok(Math.abs(state.devastation[region] - Math.min(1, RAVAGE_TUNING.devastate)) < 1e-9, `a year at ${RAVAGE_TUNING.devastate} a year: ${state.devastation[region]}`);
    assert.ok(state.fields[region] < fields, 'fields burned');
    const yieldNow = harvestYield(state, region), clean = state.devastation[region];
    state.devastation[region] = 0;
    assert.ok(yieldNow < harvestYield(state, region), 'the harvest comes in short');
    state.devastation[region] = clean;
    // Given back: it fades, by half every fadeYears.
    month(state, war, -1);
    assert.equal(state.occupiedBy[region], -1);
    const left = state.devastation[region];
    for (let at = 0; at < 12 * RAVAGE_TUNING.fadeYears; at++) month(state, war, -1);
    assert.ok(Math.abs(state.devastation[region] - left / 2) < 1e-6, `${state.devastation[region]} ≈ ${left / 2}`);
  });
});

test('a year of occupation: looting moves treasure and food exactly; burning destroys buildings and kills or drives out townspeople', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  // Looting: the owner's loss is the occupier's gain, in the wealth flows; food is carried off.
  using(RAVAGE_TUNING, none, () => { for (let at = 0; at < 12; at++) month(state, war, WAR_TUNING.occupyStep + 1); });
  using(RAVAGE_TUNING, { ...none, loot: certain }, () => {
    const region = war.occupied[0].region, group = state.groups[state.groupAt[region]];
    const wealthA = a.wealth, wealthB = b.wealth, store = group.store, events = state.chronicle.events.length;
    state.ledger.wealth.clear(); state.ledger.food.clear();
    for (const polity of [a, b]) for (const id of polity.groups) state.ledger.food.set(id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: 0, carriedOut: 0, plantedBefore: 0, sown: 0, harvested: 0, cropsLost: 0, weather: 0, factor: 1 });
    month(state, war, WAR_TUNING.occupyStep + 1);
    state.chronicle.flush(state.tick);
    const looted = state.chronicle.events.slice(events).filter(event => event.type === 'settlementLooted');
    const towns = livingSettlements(state, region).filter(settlement => !settlement.capital).length;
    assert.equal(looted.length, towns, 'each of its settlements looted');
    if (towns) {
      const taken = looted.reduce((sum, event) => sum + Number(event.data.wealth), 0);
      assert.equal(a.wealth - wealthA, taken); assert.equal(wealthB - b.wealth, taken);
      assert.equal(state.ledger.wealth.get(a.id)?.received ?? 0, taken); assert.equal(state.ledger.wealth.get(b.id)?.given ?? 0, taken);
      const carried = state.ledger.food.get(group.id)!.carriedOut;
      assert.equal(store - group.store, carried);
      assert.equal([...state.ledger.food.values()].reduce((sum, flows) => sum + flows.carriedIn, 0), carried, 'carried off to the occupier');
    }
  });
  // Burning: buildings lost; townspeople killed (war deaths) and driven out (migrants); its townspeople still sum up.
  const { state: next, a: one, b: other } = world();
  const burning = begin(next, one, other);
  using(RAVAGE_TUNING, none, () => { for (let at = 0; at < 12; at++) month(next, burning, WAR_TUNING.occupyStep + 1); });
  using(RAVAGE_TUNING, { ...none, burn: certain }, () => {
    const region = burning.occupied[0].region, group = next.groups[next.groupAt[region]];
    const towns = livingSettlements(next, region).filter(settlement => !settlement.capital);
    const urban = towns.reduce((sum, settlement) => sum + settlement.urban, 0), size = group.size;
    next.ledger.warDeaths.fill(0); next.ledger.migrantsIn.fill(0); next.ledger.migrantsOut.fill(0);
    const events = next.chronicle.events.length;
    month(next, burning, WAR_TUNING.occupyStep + 1);
    next.chronicle.flush(next.tick);
    const burned = next.chronicle.events.slice(events).filter(event => event.type === 'settlementBurned');
    assert.equal(burned.length, towns.length);
    const killed = burned.reduce((sum, event) => sum + Number(event.data.killed), 0), fled = burned.reduce((sum, event) => sum + Number(event.data.fled), 0);
    assert.ok(killed + fled <= urban);
    assert.equal(next.ledger.warDeaths[region], killed);
    assert.ok(next.ledger.migrantsOut[region] >= fled && next.ledger.migrantsIn.reduce((sum, value) => sum + value, 0) === next.ledger.migrantsOut.reduce((sum, value) => sum + value, 0));
    assert.equal(size - group.size, killed + next.ledger.migrantsOut[region]);
    const housed = livingSettlements(next, region).reduce((sum, settlement) => sum + settlement.urban, 0);
    assert.ok(housed <= group.specialists, 'townspeople within its specialists');
    // What is left houses them (housing burned with its buildings), and a harbor burned is no longer counted.
    for (const settlement of livingSettlements(next, region)) assert.ok(settlement.urban <= settlement.housing, `${settlement.name}: ${settlement.urban} of ${settlement.housing}`);
    assert.equal(next.harbors[region], livingSettlements(next, region).filter(settlement => settlement.bonus.harbor).length);
  });
});

test('razing leaves ruins, and the region founds a settlement on them when the occupation ends; roads and bridges are broken', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  using(RAVAGE_TUNING, none, () => { for (let at = 0; at < 12; at++) month(state, war, WAR_TUNING.occupyStep + 1); });
  using(RAVAGE_TUNING, { ...none, raze: certain, keepRaze: 1, bridgeRate: 12, roadRate: 12 }, () => {
    const region = war.occupied[0].region;
    const towns = livingSettlements(state, region).filter(settlement => !settlement.capital).map(settlement => settlement.id), everyone = livingSettlements(state, region).length;
    assert.ok(towns.length > 0, 'a settlement to raze');
    const roads = state.partition.regions[region].neighbors.map(edge => roadKey(state.partition.regions.length, region, edge.region)).filter(key => state.roads.has(key));
    const bridged = roads.filter(key => state.roads.get(key)!.bridge);
    const razedBefore = state.metrics.settlementsRazed;
    month(state, war, WAR_TUNING.occupyStep + 1);
    assert.equal(state.metrics.settlementsRazed - razedBefore, towns.length);
    for (const id of towns) { assert.equal(state.settlements[id].status, 'razed'); assert.equal(state.settlements[id].urban, 0); assert.deepEqual(state.settlements[id].buildings, []); }
    // Bridges are torn down first; roads without one are broken.
    for (const key of bridged) { const road = state.roads.get(key); assert.ok(!road?.bridge); if (road) assert.equal(road.upkeep, roadUpkeep(road.tier, state.partition.regions[road.a].neighbors.find(edge => edge.region === road.b)!, false), 'its upkeep without the bridge'); }
    for (const key of roads.filter(key => !bridged.includes(key))) assert.ok(!state.roads.has(key));
    assert.equal(livingSettlements(state, region).length, everyone - towns.length);
    if (towns.length === everyone) {
      // Its last settlement razed: while occupied it has none; given back, it lies in ruins until its people rebuild (by
      // chance, sooner as it heals), on the ruins.
      const resettled = state.metrics.razedResettled;
      using(RAVAGE_TUNING, { ...none, rebuild: 0 }, () => month(state, war, -1));
      assert.equal(state.occupiedBy[region], -1);
      assert.equal(livingSettlements(state, region).length, 0, 'not yet rebuilt');
      // (Beside the ruins on a free site, the ruins left standing — or, as here, on the ruins.)
      const beside = structuredClone(state);
      Object.setPrototypeOf(beside.chronicle, Chronicle.prototype);
      using(RAVAGE_TUNING, { ...none, rebuild: 1_000, fresh: 1 }, () => { beside.tick++; ravage(beside, context(beside)); });
      const anew = livingSettlements(beside, region);
      if (state.partition.regions[region].settlementSites.length > towns.length) {
        assert.equal(anew.length, 1);
        assert.ok(!towns.includes(anew[0].id), 'a new settlement');
        for (const id of towns) assert.equal(beside.settlements[id].status, 'razed', 'the ruins left standing');
      }
      using(RAVAGE_TUNING, { ...none, rebuild: 1_000, fresh: 0 }, () => month(state, war, -1));
      const living = livingSettlements(state, region);
      assert.equal(living.length, 1);
      assert.ok(towns.includes(living[0].id), 'on the ruins');
      assert.equal(state.metrics.razedResettled, resettled + 1);
    }
  });
});

test('refugees flee devastated land for the nearest land of their realm not occupied, as migrants', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  using(RAVAGE_TUNING, { ...none, flee: 1 }, () => {
    for (let at = 0; at < 6; at++) month(state, war, WAR_TUNING.occupyStep + 1);
    const region = war.occupied[0].region, group = state.groups[state.groupAt[region]], size = group.size;
    state.ledger.migrantsIn.fill(0); state.ledger.migrantsOut.fill(0);
    month(state, war, WAR_TUNING.occupyStep + 1);
    const out = state.ledger.migrantsOut[region];
    assert.ok(out > 0 && out < size, 'some flee');
    assert.equal(state.ledger.migrantsIn.reduce((sum, value) => sum + value, 0), out);
    for (let at = 0; at < state.ledger.migrantsIn.length; at++) if (state.ledger.migrantsIn[at]) { assert.equal(state.owner[at], b.id); assert.equal(state.occupiedBy[at], -1); }
  });
});

test('a war in the whole simulation: occupation devastates, ravages come, every invariant holds each month', () => {
  const { state, a, b } = world();
  // The attacker overwhelming, peace held off: a long occupation.
  for (const id of b.groups) state.groups[id].soldiers = 0;
  const war = begin(state, a, b);
  using(WAR_TUNING, { goalMonths: 10_000, peaceAt: 2, acceptExhaustion: 2 }, () => using(WAR_TUNING.peace, { base: -5 }, () => using(RAVAGE_TUNING, { raze: 0.3, burn: 0.3, loot: 0.4, bridgeRate: 1, roadRate: 1 }, () => {
    for (let at = 0; at < 36 && war.endTick === null; at++) stepSimulation(state);
  })));
  const ravaged = state.chronicle.events.filter(event => ['settlementLooted', 'settlementBurned', 'settlementRazed', 'infrastructureDestroyed'].includes(event.type) && event.tick >= war.startTick);
  assert.ok(war.occupied.length === 0 || state.devastation[war.occupied[0].region] > 0, 'occupied land is devastated');
  assert.ok(ravaged.length > 0 || war.endTick !== null, 'a year of occupation brings its ravages');
});

test('burning a furnished town: its buildings and harbor go, its townspeople fit what housing is left; bridges go first; walls and capitals are spared', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  // A town of the defender (not its capital), furnished and full.
  const town = state.settlements.find(settlement => settlement.status === 'alive' && settlement.owner === b.id && !settlement.capital)!;
  assert.ok(town, 'a town of theirs');
  furnish(state, town.id);
  const region = town.region, group = state.groups[state.groupAt[region]];
  occupyNow(state, war, region);
  using(RAVAGE_TUNING, { ...none, burn: certain, burnBuildings: 1 }, () => ravageMonth(state));
  assert.deepEqual(town.buildings, [], 'all burned');
  assert.equal(state.harbors[region], livingSettlements(state, region).filter(settlement => settlement.bonus.harbor).length, 'the harbor no longer counted');
  for (const settlement of livingSettlements(state, region)) assert.ok(settlement.urban <= settlement.housing, `${settlement.name}: ${settlement.urban} of ${settlement.housing}`);
  assert.equal(livingSettlements(state, region).reduce((sum, settlement) => sum + settlement.urban, 0), group.specialists, 'its townspeople are its specialists');
  // A bridged road on a river edge of an occupied region loses its bridge first, its upkeep with it; a road without one is broken.
  const river = state.partition.regions.find(entry => state.owner[entry.id] === b.id && entry.neighbors.some(edge => edge.riverTier >= 1))!;
  assert.ok(river, 'a region of theirs by a river');
  const edge = river.neighbors.find(entry => entry.riverTier >= 1)!, key = roadKey(state.partition.regions.length, river.id, edge.region);
  const tier = ROAD_TIERS.findIndex(entry => entry.bridges) + 1;
  state.roads.set(key, { a: Math.min(river.id, edge.region), b: Math.max(river.id, edge.region), tier, bridge: true, condition: 1, builder: b.id, builtTick: state.tick, upkeep: roadUpkeep(tier, edge, true) });
  occupyNow(state, war, river.id);
  using(RAVAGE_TUNING, { ...none, bridgeRate: 12, roadRate: 12 }, () => ravageMonth(state));
  const road = state.roads.get(key)!;
  assert.ok(road && !road.bridge, 'the bridge is torn down, the road still there');
  assert.equal(road.upkeep, roadUpkeep(tier, edge, false), 'and costs what a road without a bridge costs');
  using(RAVAGE_TUNING, { ...none, bridgeRate: 12, roadRate: 12 }, () => ravageMonth(state));
  assert.ok(!state.roads.has(key), 'then the road is broken');
  // Full walls hold off every ravage; a capital is never razed.
  const walled = state.settlements.find(settlement => settlement.status === 'alive' && settlement.owner === b.id && !settlement.capital && settlement.region !== region)!;
  if (walled) {
    walled.buildings = [{ type: BUILDINGS.findIndex(building => building.name === 'walls'), condition: 1, builtTick: state.tick }];
    walled.bonus = bonusOf(walled.buildings); walled.housing = housingOf(walled); refreshRegionBonus(state, walled.region);
    occupyNow(state, war, walled.region);
    using(RAVAGE_TUNING, { ...none, raze: certain, keepRaze: 1 }, () => using(WAR_TUNING.exhaustion, {}, () => {
      const defence = BUILDINGS.find(building => building.name === 'walls')!.effects.defense!;
      using(BUILDINGS.find(building => building.name === 'walls')!.effects as object, { defense: 1 }, () => ravageMonth(state));
      assert.ok(defence > 0);
    }));
    assert.equal(walled.status, 'alive', 'walls of full strength hold');
  }
  const capital = state.settlements[b.capital!];
  occupyNow(state, war, capital.region);
  using(RAVAGE_TUNING, { ...none, raze: certain, keepRaze: 1 }, () => ravageMonth(state));
  assert.equal(capital.status, 'alive', 'a capital is never razed');
});

test('loot and tribute are war income, fading, and pay for soldiers; refugees with nowhere to go stay', () => {
  const { state, a, b } = world();
  addWarIncome(state, a, 1_000_000);
  assert.equal(warIncomeOf(a, state.tick), 1_000_000);
  assert.ok(Math.abs(warIncomeOf(a, state.tick + 12 * RAVAGE_TUNING.incomeYears) - 500_000) < 1e-6, 'halving every incomeYears');
  const paid = armyView(state, a);
  assert.equal(paid.warIncome, 1_000_000);
  // Every region of theirs occupied: nowhere to flee.
  const war = begin(state, a, b);
  for (const id of b.groups) occupyNow(state, war, state.groups[id].region);
  state.devastation.fill(1);
  state.ledger.migrantsOut.fill(0);
  using(RAVAGE_TUNING, { ...none, flee: 1 }, () => ravageMonth(state));
  assert.equal(state.ledger.migrantsOut.reduce((sum, value) => sum + value, 0), 0, 'nobody moves');
  void armyTarget;
});
