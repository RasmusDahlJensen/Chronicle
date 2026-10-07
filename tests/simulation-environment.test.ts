import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announceFamine, fedSecurity, hungerSecurity, recordFamine, reserveShortfall, type FamineOnset } from '../src/simulation/bands.ts';
import { BUILDING_INDEX, BUILDINGS } from '../src/simulation/buildings.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { buildScore, need } from '../src/simulation/decisions/build.ts';
import { regionDroughtShield, regionFarm } from '../src/simulation/economy.ts';
import { environment, harvestYield, herdYield } from '../src/simulation/environment.ts';
import { regionYields, type FoodModel } from '../src/simulation/food.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import type { PolityView } from '../src/simulation/perception.ts';
import type { Rng } from '../src/simulation/rng.ts';
import { systemStream } from '../src/simulation/rng.ts';
import { bonusOf, fallCauses, refreshRegionBonus } from '../src/simulation/settlements.ts';
import type { Polity, PopulationGroup, Settlement, SimulationState } from '../src/simulation/state.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { ENVIRONMENT_TUNING, FOOD_TUNING, POPULATION_TUNING } from '../src/simulation/tunables.ts';

/**
 * Test fixture: four regions in a line (0–1–2–3), all habitable; region 0 arid; harvests in September, one a year.
 * A tribe lives in region 1.
 */
function fixture() {
  const regions = [0, 1, 2, 3].map(id => ({ id, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other <= 3).map(region => ({ region, travelKm: 300, riverTier: 0 })) }));
  const harvest = new Float64Array(4 * 12);
  for (let region = 0; region < 4; region++) harvest[region * 12 + 8] = 1;
  const state = {
    tick: 0, seed: 7, partition: { regions }, food: { harvest, cycle: new Uint8Array(4).fill(12) },
    weather: new Float64Array(4).fill(1), harvestFactor: new Float64Array(4).fill(1), drought: new Uint8Array(4), famineRecent: new Float64Array(4), famine: new Uint8Array(4),
    habitable: new Uint8Array(4).fill(1), affinity: [new Set(['arid']), new Set(), new Set(), new Set()], occupant: Int32Array.from([-1, 0, -1, -1]), groupAt: Int32Array.from([-1, 0, -1, -1]),
    groups: [{ id: 0, region: 1, size: 10_000, store: 0, specialists: 0, foodSecurity: 0.9 }], regionSettlements: [[], [], [], []], settlements: [], stability: new Float64Array(4).fill(1), unrest: new Uint8Array(4),
    chronicle: new Chronicle(), metrics: { droughts: 0, famines: 0 }, capacity: new Float64Array(4).fill(10_000),
    farmBonus: new Float64Array(4).fill(1), droughtShield: new Float64Array(4), storeBonus: new Float64Array(4).fill(1), spoilageBonus: new Float64Array(4).fill(1),
    fields: new Float64Array(4), famineWatches: [], famineSince: new Int32Array(4).fill(-1), fieldShare: new Float64Array(4).fill(1),
    hardship: new Float64Array(4), fieldRanking: { order: Int32Array.from([0, 1, 2, 3]), start: Int32Array.from([0, 1, 2, 3, 4]), cumulative: Float64Array.from([1000, 1000, 1000, 1000]), rank: new Uint16Array(4) },
  } as unknown as SimulationState;
  const tribe = { id: 0, kind: 'band', name: 'Ora', knowledge: learn(learn(startingKnowledge(), TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Agriculture')!) } as unknown as Polity;
  state.polities = [tribe];
  return { state, tribe, group: state.groups[0] as PopulationGroup };
}
const context = (state: SimulationState, tick: number, stream?: (entity?: number, salt?: number) => Rng) =>
  ({ tick, year: Math.floor(tick / 12), month: tick % 12 + 1, stream: stream ?? ((entity?: number, salt?: number) => systemStream(state.seed, tick, 0, entity, salt)) }) as never;

test('each harvest comes in at the weather drawn for it: reproducible, around 1 and within bounds, drawn only at harvest months', () => {
  const { state } = fixture();
  environment(state, context(state, 7));
  assert.deepEqual([...state.weather], [1, 1, 1, 1], 'August: no harvest yet');
  environment(state, context(state, 8));
  const first = [...state.weather];
  assert.ok(first.every(value => value >= ENVIRONMENT_TUNING.harvestMin && value <= ENVIRONMENT_TUNING.harvestMax) && first.some(value => value !== 1));
  environment(state, context(state, 8));
  assert.deepEqual([...state.weather], first, 'the same tick draws the same weather');
  const draws: number[] = [];
  for (let year = 0; year < 400; year++) { environment(state, context(state, year * 12 + 8)); draws.push(...state.weather); }
  const mean = draws.reduce((sum, value) => sum + value, 0) / draws.length;
  assert.ok(Math.abs(mean - 1) < 0.01, `mean weather ${mean}`);
});

test('a drought begins in January, spreads to neighbouring regions, lasts its years and cuts harvests and herds; irrigation softens it', () => {
  const { state } = fixture();
  // A stream whose chances all succeed: region 0 begins a drought (two years) and spreads it to region 1.
  const always: Rng = { next: () => 0.5, int: () => 1, chance: () => true, weighted: () => 0 };
  environment(state, context(state, 12, () => always));
  assert.deepEqual([...state.drought], [24, 24, 24, 24], 'region 0 and its neighbour, then region 2 and its neighbour');
  assert.equal(state.metrics.droughts, 2);
  state.chronicle.flush(12);
  const events = state.chronicle.events.filter(event => event.type === 'drought');
  assert.equal(events.length, 1, 'only the drought that touches people is an event');
  assert.deepEqual([events[0].region, events[0].causes[0].factor, events[0].actors[0].id, events[0].data.years, events[0].data.oneMore], [0, 'dryLand', 0, 2, true]);
  state.weather[1] = 1.05;
  assert.equal(harvestYield(state, 1), 1.05 * (1 - ENVIRONMENT_TUNING.droughtFarmLoss));
  assert.equal(herdYield(state, 1), 1 - ENVIRONMENT_TUNING.droughtHerdLoss);
  // Irrigation in the region keeps away half the loss.
  const irrigation = BUILDING_INDEX.get('irrigation')!;
  state.settlements.push({ id: 0, status: 'alive', region: 1, buildings: [{ type: irrigation, condition: 1, builtTick: 0 }], bonus: bonusOf([{ type: irrigation, condition: 1, builtTick: 0 }]) } as unknown as Settlement);
  state.regionSettlements[1].push(0);
  refreshRegionBonus(state, 1);
  assert.equal(regionDroughtShield(state, 1), BUILDINGS[irrigation].effects.drought);
  assert.equal(harvestYield(state, 1), 1.05 * (1 - ENVIRONMENT_TUNING.droughtFarmLoss * 0.5));
  for (let tick = 13; tick < 13 + 24; tick++) environment(state, context(state, tick, () => ({ ...always, chance: () => false })));
  assert.deepEqual([...state.drought], [0, 0, 0, 0], 'over after two years');
  assert.equal(harvestYield(state, 1), state.weather[1]);
});

test('famine is recorded once while hunger kills a clear share of a region\'s people within a year, with what brought it', () => {
  const { state, tribe, group } = fixture();
  const onsets: FamineOnset[] = [];
  const month = () => { recordFamine(state, tribe, group, 10_000, onsets); announceFamine(state, tribe, onsets); };
  state.weather[1] = 1; state.harvestFactor[1] = 1 - ENVIRONMENT_TUNING.droughtFarmLoss;
  state.famineRecent[1] = ENVIRONMENT_TUNING.famineShare * group.size - 1;
  month();
  assert.equal(state.famine[1], 0, 'below the share: no famine');
  state.famineRecent[1] += 2;
  month(); month();
  state.chronicle.flush(0);
  const famines = state.chronicle.events.filter(event => event.type === 'famine');
  assert.equal(famines.length, 1, 'one event for the episode');
  assert.deepEqual([famines[0].causes[0].factor, famines[0].causes[0].weight, famines[0].data.deaths, famines[0].data.regions], ['drought', ENVIRONMENT_TUNING.droughtFarmLoss, Math.round(ENVIRONMENT_TUNING.famineShare * group.size + 1), 1]);
  assert.equal(state.metrics.famines, 1);
  state.famineRecent[1] = ENVIRONMENT_TUNING.famineEnd * group.size - 1;
  month();
  assert.equal(state.famine[1], 0, 'the dying fell back: it is over');
  // Flaring again in the same region within a year of its start, it is the same famine: no new event.
  state.famineRecent[1] = group.size; state.tick = 11;
  month();
  assert.equal(state.metrics.famines, 1, 'the same famine');
  state.famine[1] = 0;
  // A year on, with nothing else to blame: a new famine, citing the shortfall itself.
  state.harvestFactor[1] = 1; state.famineRecent[1] = group.size; state.tick = 24;
  month();
  state.chronicle.flush(1);
  assert.equal(state.chronicle.events.filter(event => event.type === 'famine').at(-1)!.causes[0].factor, 'shortage');
  // Several regions of one people falling into famine the same month are one event, set in the worst.
  const second = { ...group, id: 1, region: 2, size: 20_000 } as PopulationGroup;
  state.famine.fill(0); state.famineRecent[1] = group.size; state.famineRecent[2] = second.size; state.tick = 48;
  recordFamine(state, tribe, group, 10_000, onsets); recordFamine(state, tribe, second, 10_000, onsets); announceFamine(state, tribe, onsets);
  state.chronicle.flush(2);
  const joint = state.chronicle.events.filter(event => event.type === 'famine').at(-1)!;
  assert.deepEqual([joint.region, joint.data.regions, joint.data.more, joint.data.deaths], [2, 2, 1, group.size + second.size]);
  // Spreading to a region not yet struck, within the year, it is recorded too (a famine spreads); uncleared land is cited.
  const third = { ...group, id: 2, region: 3, size: 5_000 } as PopulationGroup;
  state.famineRecent[3] = third.size; state.fieldShare[3] = 0.85; state.harvestFactor[3] = 1; state.tick = 50;
  recordFamine(state, tribe, third, 10_000, onsets); announceFamine(state, tribe, onsets);
  state.chronicle.flush(3);
  const spread = state.chronicle.events.filter(event => event.type === 'famine').at(-1)!;
  assert.deepEqual([spread.region, spread.causes[0].factor], [3, 'uncleared']);
});

test('hunger counts stores only within what the land lastingly feeds; tier falls cite the hard times behind them', () => {
  const { state, group } = fixture();
  group.foodSecurity = 0.8; group.store = group.size * FOOD_TUNING.unitsPerPersonMonth * 4;
  assert.equal(hungerSecurity(group, group.size), 1, 'within capacity: the store carries them');
  assert.equal(hungerSecurity(group, group.size - 1), 0.8, 'beyond it: hunger follows the land');
  state.hardship[1] = 0.3;
  assert.equal(fallCauses(state, group, 0.5)[0].factor, 'hardship');
  state.hardship[1] = 0.01;
  assert.deepEqual(fallCauses(state, group, 0.5).map(cause => cause.factor), ['fewerTownspeople'], 'nothing else to name');
  state.famine[1] = 1; state.famineRecent[1] = group.size * 0.05;
  assert.equal(fallCauses(state, group, 0.5)[0].factor, 'famine');
});

test('the environment sets every region\'s harvest share at its harvest month, lets empty regions\' fields fall fallow, and checks famine watches each January', () => {
  const { state } = fixture();
  state.fields[2] = 500; state.drought[3] = 30;
  environment(state, context(state, 8));
  assert.ok(state.harvestFactor[0] !== 1 || state.weather[0] === 1, 'set for regions nobody farms');
  assert.ok(Math.abs(state.harvestFactor[3] - state.weather[3] * (1 - ENVIRONMENT_TUNING.droughtFarmLoss)) < 1e-12, 'with the drought');
  assert.ok(state.fields[2] < 500, 'nobody farms region 2: its fields fall fallow');
  Object.assign(state.metrics, { faminesWatched: 0, fieldsShrank: 0, fieldsRegrew: 0 });
  state.fields[2] = 400;
  state.famineWatches.push({ polity: 0, regions: [2], tick: 0, before: 500, shrunk: -1 });
  environment(state, context(state, 12, () => ({ next: () => 0.5, int: () => 0, chance: () => false, weighted: () => 0 })));
  assert.equal(state.metrics.fieldsShrank, 1, 'the yearly check ran');
});

test('hunger counts food in store: people eating their fill from their stores do not starve, whatever the land gives', () => {
  const { group } = fixture();
  const need = group.size * FOOD_TUNING.unitsPerPersonMonth;
  group.foodSecurity = 0.75;
  group.store = 0;
  assert.equal(fedSecurity(group), 0.75, 'no store: what the land gives');
  group.store = need / 2;
  assert.equal(fedSecurity(group), 0.75, 'half a month in store is less than the land gives');
  group.store = need * 3;
  assert.equal(fedSecurity(group), 1, 'months in store: nobody goes short');
  group.foodSecurity = 1.2;
  assert.equal(fedSecurity(group), 1.2, 'a surplus still counts as one');
});

test('farmers keep a reserve beyond the next harvest: births slow while their store is short of it, as far as their store can hold one', () => {
  const { state, tribe, group } = fixture();
  const need = group.size * FOOD_TUNING.unitsPerPersonMonth, holds = POPULATION_TUNING.storeMonths * tribe.knowledge.multipliers.storeMonths;
  const reserve = Math.min(POPULATION_TUNING.reserveMonths, holds - 12);
  assert.ok(reserve > 0);
  // In August, the harvest comes next month: the store should hold the reserve alone.
  group.store = need * reserve;
  assert.equal(reserveShortfall(state, tribe, group, 8), 0);
  group.store = 0;
  assert.equal(reserveShortfall(state, tribe, group, 8), reserve / 12, 'at most the reserve\'s share of a year');
  group.store = need * reserve / 2;
  assert.ok(Math.abs(reserveShortfall(state, tribe, group, 8) - reserve / 24) < 1e-12);
  // Two harvests a year: the reserve is still a share of a year's need.
  state.food.cycle[1] = 6; group.store = 0;
  assert.equal(reserveShortfall(state, tribe, group, 8), Math.min(POPULATION_TUNING.reserveMonths, holds - 6) / 12);
});

test('irrigation raises its region\'s farm yield and is wanted where a river or lake waters farmland', () => {
  const irrigation = BUILDING_INDEX.get('irrigation')!, definition = BUILDINGS[irrigation];
  const { state } = fixture();
  state.settlements.push({ id: 0, status: 'alive', region: 2, bonus: bonusOf([{ type: irrigation, condition: 1, builtTick: 0 }]) } as unknown as Settlement);
  state.regionSettlements[2].push(0);
  refreshRegionBonus(state, 2);
  assert.equal(regionFarm(state, 2), definition.effects.farm); assert.equal(regionFarm(state, 1), 1);
  const model = { baseYield: Float64Array.from([1, 1, 1, 2, 2.6]), farmWater: new Float64Array(4).fill(1) } as unknown as FoodModel;
  const knowledge = learn(learn(startingKnowledge(), TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Agriculture')!);
  const plain = regionYields(model, 1, new Float64Array(5), 2, knowledge)[4], watered = regionYields(model, 1, new Float64Array(5), 2, knowledge, regionFarm(state, 2))[4];
  assert.equal(watered, plain * definition.effects.farm!, 'capacity follows the farm yield');
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const settlement = (entry: Record<string, unknown>) => ({ id: 1, region: 0, name: 'Kesh', tier: 0, urban: 500, housing: 8_000, hardship: 0, farmShare: 1, farmers: 20_000, stability: 1, frontier: 0, has: [], coast: false, water: true, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false, ...entry });
  assert.ok(need('farming', settlement({ hardship: 0.5 }) as never, values) > need('farming', settlement({}) as never, values), 'hard years call for it');
  assert.equal(need('farming', settlement({ farmShare: 0 }) as never, values), 0, 'no farming, no irrigation');
  const kind = { type: irrigation, name: definition.name, one: definition.one, many: definition.many, purpose: definition.purpose, cost: definition.cost, upkeep: definition.upkeep, minTier: 0, coast: false, water: true, perRegion: true, works: '' as const };
  const view = (entry: Record<string, unknown>) => ({ values, budget: { rate: 0.2, output: 500_000, sites: 0, costs: 0, treasury: 1_000_000, revenue: 100_000, surplus: 100_000, strain: 0, tradition: 0.5, calm: 0.9 }, build: { monuments: 1, regions: 1, catalog: [kind], settlements: [settlement(entry)], wonders: [], stability: 1 } }) as unknown as PolityView;
  assert.ok(buildScore(view({}), kind).score > 0, 'a village of farmers by a river wants it');
  assert.equal(buildScore(view({ water: false }), kind).score, Number.NEGATIVE_INFINITY, 'no river or lake: nothing to water the fields');
  assert.ok(buildScore(view({ farmers: 2_000 }), kind).score < buildScore(view({}), kind).score, 'it serves the region\'s farmers');
});
