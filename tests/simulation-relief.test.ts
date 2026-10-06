import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { arriving, carriage, relieve } from '../src/simulation/relief.ts';
import { roadKey } from '../src/simulation/roads.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { FOOD_TUNING, POPULATION_TUNING, RELIEF_TUNING } from '../src/simulation/tunables.ts';

const UNITS = FOOD_TUNING.unitsPerPersonMonth;

/**
 * Test fixture: a civilization holding regions 0–1–2 in a row (500 km apart) beside a foreign region 3 next to 0. Each
 * region harvests in month 6. Region 0's 10,000 people go hungry with an empty store; regions 1 and 2 each hold
 * 20 months of their 10,000 people's food.
 */
function realm(knowledge = learn(startingKnowledge(), TECH_INDEX.get('Pottery')!)) {
  const neighbors = (id: number) => [id - 1, id + 1].filter(other => other >= 0 && other <= 2).map(region => ({ region, travelKm: 500, riverTier: 0 }));
  const regions = [0, 1, 2].map(id => ({ id, neighbors: neighbors(id) })).concat([{ id: 3, neighbors: [{ region: 0, travelKm: 100, riverTier: 0 }] }]);
  regions[0].neighbors.push({ region: 3, travelKm: 100, riverTier: 0 });
  const harvest = new Uint8Array(4 * 12); for (let region = 0; region < 4; region++) harvest[region * 12 + 5] = 1;
  const group = (id: number, store: number, foodSecurity: number) => ({ id, region: id, size: 10_000, store, foodSecurity, specialists: 0 });
  const state = {
    tick: 120, partition: { regions }, roads: new Map(), owner: Int32Array.from([0, 0, 0, 1]), capacity: new Float64Array(4).fill(20_000),
    food: { harvest }, relieved: new Uint8Array(4), chronicle: new Chronicle(),
    groups: [group(0, 0, 0.6), group(1, 20 * 10_000 * UNITS, 1.1), group(2, 20 * 10_000 * UNITS, 1.1), group(3, 30 * 10_000 * UNITS, 1.1)],
    ledger: { wealth: new Map(), food: new Map() },
    metrics: { reliefUnits: 0, reliefLost: 0, reliefCost: 0, reliefBegun: 0 },
  } as unknown as SimulationState;
  for (const each of state.groups) state.ledger.food.set(each.id, { before: each.store, production: 0, consumption: 0, spoilage: 0, carriedIn: 0, carriedOut: 0 } as never);
  const civ = { id: 0, name: 'Ora', groups: [0, 1, 2], wealth: 1_000_000, knowledge } as unknown as Polity;
  state.polities = [civ, { id: 1, groups: [3] } as unknown as Polity];
  return { state, civ };
}

test('a realm sends stored food to its hungry regions from the nearest with food to spare, paying for the carriage; food carried far spoils on the way', () => {
  const { state, civ } = realm();
  const flows = wealthFlows(state, civ);
  relieve(state, civ, 1);
  const [hungry, near, far, foreign] = state.groups;
  const want = RELIEF_TUNING.months * 10_000 * UNITS;
  assert.ok(Math.abs(hungry.store - want) < UNITS, `the hungry region gets ${RELIEF_TUNING.months} months of food (${hungry.store / UNITS} person-months)`);
  assert.equal(far.store, 20 * 10_000 * UNITS, 'all of it from the nearer region');
  assert.equal(foreign.store, 30 * 10_000 * UNITS, 'nothing from another people');
  const sent = 20 * 10_000 * UNITS - near.store, share = arriving(civ, 500);
  assert.ok(share < 1 && sent > hungry.store, 'some spoils on the way');
  // Every unit is a flow: the donor's food carried out and spoiled on the way, the recipient's carried in.
  const given = state.ledger.food.get(near.id)!, taken = state.ledger.food.get(hungry.id)!;
  assert.deepEqual([given.carriedOut, given.spoilage, taken.carriedIn], [hungry.store, sent - hungry.store, hungry.store]);
  assert.equal(flows.relief, Math.ceil(carriage(sent, 500))); assert.equal(civ.wealth, 1_000_000 - flows.relief);
  assert.equal(state.relieved[0], 1);
  state.chronicle.flush(120);
  const event = state.chronicle.events.find(entry => entry.type === 'famineRelief')!;
  assert.ok(event && event.region === 0 && event.data.people === 10_000 && event.data.donors === 1);
  // Next month the same relief is the same episode: no new event.
  hungry.store = 0; state.tick = 121;
  relieve(state, civ, 2);
  state.chronicle.flush(121);
  assert.equal(state.chronicle.events.filter(entry => entry.type === 'famineRelief').length, 1);
});

test('a donor keeps what it needs until its next harvest and its reserve; a poor treasury buys less relief; roads and better storage make it go further', () => {
  // Donors with just their own needs to hand: nothing to spare.
  const lean = realm();
  for (const at of [1, 2]) lean.state.groups[at].store = 10_000 * UNITS * (4 + POPULATION_TUNING.reserveMonths);
  relieve(lean.state, lean.civ, 1);
  assert.equal(lean.state.groups[0].store, 0, 'in month 1 the harvest is 4 months off');
  // A poor treasury pays only a share of itself a month.
  const poor = realm();
  poor.civ.wealth = 1_000;
  relieve(poor.state, poor.civ, 1);
  assert.ok(poor.civ.wealth >= 1_000 * (1 - RELIEF_TUNING.treasuryShare) - 1);
  assert.ok(poor.state.groups[0].store > 0 && poor.state.groups[0].store < RELIEF_TUNING.months * 10_000 * UNITS, 'some relief, not enough');
  // A road on the way makes carriage cheaper; refrigeration keeps more of the food.
  const plain = realm(), road = realm();
  road.state.roads.set(roadKey(4, 0, 1), { a: 0, b: 1, tier: 3, bridge: false, condition: 1, builder: 0, builtTick: 0, upkeep: 0 });
  relieve(plain.state, plain.civ, 1); relieve(road.state, road.civ, 1);
  assert.ok(road.civ.wealth > plain.civ.wealth, 'by rail it costs less');
  const cold = learn(learn(startingKnowledge(), TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Refrigeration')!);
  assert.ok(arriving({ knowledge: cold } as Polity, 2_000) > arriving(plain.civ, 2_000), 'cold stores keep food on the way');
  // A people beyond what its land feeds is not kept there by food from elsewhere.
  const crowded = realm();
  crowded.state.groups[0].size = 30_000;
  relieve(crowded.state, crowded.civ, 1);
  assert.equal(crowded.state.groups[0].store, 0);
});
