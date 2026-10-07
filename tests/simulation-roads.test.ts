import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { construct, startRoads } from '../src/simulation/construction.ts';
import { bestRoad } from '../src/simulation/decisions/build.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { capitalKm, emptyMap, KNOWN, OBSERVED, type PolityView } from '../src/simulation/perception.ts';
import { BRIDGE, edgeKm, edgeTravel, keeperOf, knownRoadTier, ROAD_TIERS, roadCoverage, roadKey, roadRoutes, roadUpkeep, roadUpkeepOf, validateRoads } from '../src/simulation/roads.ts';
import type { Polity, Settlement, SimulationState } from '../src/simulation/state.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { BUDGET_TUNING, BUILD_TUNING, REACH_TUNING } from '../src/simulation/tunables.ts';

test('road tiers are data: each unlocked by a tech, the Wheel gives roads and Engineering paved roads with bridges', () => {
  assert.doesNotThrow(validateRoads);
  let knowledge = startingKnowledge();
  assert.equal(knownRoadTier(knowledge), 0);
  knowledge = learn(knowledge, TECH_INDEX.get('Wheel')!);
  assert.equal(knownRoadTier(knowledge), 1);
  knowledge = learn(knowledge, TECH_INDEX.get('Engineering')!);
  assert.equal(knownRoadTier(knowledge), 2);
  assert.equal(ROAD_TIERS[0].bridges, false); assert.equal(ROAD_TIERS[1].bridges, true);
});

/**
 * Test fixture: a strip of five regions (0–1–2–3–4), 400 travel-km apart, with a river on the edge 2–3; one
 * civilization holds them all, with its capital (a town) in region 0 and towns in regions 2 and 4, and a village in 1.
 */
function strip(known: string[] = ['Wheel']) {
  const regions = [0, 1, 2, 3, 4].map(id => ({
    id, centroid: id, sea: [],
    neighbors: [id - 1, id + 1].filter(other => other >= 0 && other <= 4).map(region => ({ region, travelKm: 400, riverTier: Math.min(id, region) === 2 ? 2 : 0 })),
  }));
  const state = {
    tick: 0, partition: { regions }, geography: { width: 5, cells: 5 }, roads: new Map(), settlements: [] as Settlement[], regionSettlements: regions.map(() => [] as number[]),
    owner: new Int32Array(5).fill(0), occupant: new Int32Array(5).fill(0), harbors: new Uint8Array(5), wonders: [], chronicle: new Chronicle(), living: [0],
    groups: regions.map(region => ({ id: region.id, region: region.id, size: 10_000, specialists: 0 })), ledger: { wealth: new Map() },
    remoteness: new Float64Array(5), remoteOwner: new Int32Array(5).fill(-1), neglected: new Uint8Array(5),
    metrics: { roadsBegun: 0, roadsBuilt: 0, roadsAbandoned: 0, roadEdgesBuilt: 0, bridgesBuilt: 0, roadsLost: 0, firstBridgeTick: -1, buildingsLost: 0, projectsAbandoned: 0, arrearsBegun: 0 },
  } as unknown as SimulationState;
  let knowledge = startingKnowledge();
  for (const tech of known) knowledge = learn(knowledge, TECH_INDEX.get(tech)!);
  const map = emptyMap(5);
  map.status.fill(OBSERVED);
  const civ = {
    id: 0, kind: 'civ', name: 'Ora', capital: 0, core: 0, groups: [0, 1, 2, 3, 4], knowledge, map, wealth: 0, wealthCarry: 0, upkeepCarry: 0,
    projects: [], roadWorks: [], roadsUnpaid: 0, repairing: false, settledTick: 0, taxRate: BUDGET_TUNING.customaryRate, arrears: 0, inArrears: false, heavyTaxes: false,
  } as unknown as Polity;
  state.polities = [civ];
  const place = (region: number, name: string, tier: number, urban: number) => {
    const settlement = { id: state.settlements.length, name, cell: region, region, owner: 0, capital: region === 0, status: 'alive', tier, urban, buildings: [], bonus: { upkeep: 0 }, wonder: null } as unknown as Settlement;
    state.settlements.push(settlement); state.regionSettlements[region].push(settlement.id);
    return settlement;
  };
  const capital = place(0, 'Kesh', 1, 6_000), village = place(1, 'Ura', 0, 500), tal = place(2, 'Tal', 1, 8_000), sem = place(4, 'Sem', 1, 4_000);
  return { state, civ, capital, village, tal, sem };
}
/** A month of construction; returns what the realm paid for running it (administration, services, upkeep). */
const month = (state: SimulationState, tick: number) => {
  state.tick = tick; state.ledger.wealth.clear();
  const flows = wealthFlows(state, state.polities[0]);
  construct(state, { tick } as never); state.chronicle.flush(tick);
  return flows.administration + flows.services + flows.upkeep;
};

test('a road runs from the capital to each town along the cheapest route through its own land, and is paid for and built', () => {
  const { state, civ, tal, sem } = strip();
  assert.deepEqual(roadCoverage(state), { civs: 1, covered: 0 }, 'the capital alone does not count');
  const routes = roadRoutes(state, civ, 1);
  assert.deepEqual(routes.map(route => [route.settlement, route.path, route.edges.length, route.bridges]), [[tal.id, [0, 1, 2], 2, 0], [sem.id, [0, 1, 2, 3, 4], 4, 0]], 'towns only; no bridges before Engineering');
  assert.equal(routes[1].cost, 4 * ROAD_TIERS[0].perKm * 400);
  assert.equal(routes[1].months, 4 * Math.ceil(400 / ROAD_TIERS[0].kmPerMonth));
  civ.wealth = 1_000_000;
  const cited = [{ factor: 'remoteness', weight: 0.3 }];
  assert.equal(startRoads(state, 0, civ, [sem.id, tal.id], cited), 'began a road to Sem', 'the road to Sem already covers the way to Tal: nothing left to begin there');
  assert.deepEqual(civ.roadWorks.map(work => work.edges), [[[0, 1], [1, 2], [2, 3], [3, 4]]]);
  const before = capitalKm(state, civ, 4), months = civ.roadWorks[0].months;
  let running = 0, roadUpkeepPaid = 0;
  for (let tick = 1; tick <= months; tick++) { running += month(state, tick); roadUpkeepPaid += roadUpkeepOf(state, civ); }
  assert.equal(civ.roadWorks.length, 0);
  assert.equal(state.roads.size, 4);
  assert.equal(roadUpkeepPaid, 4 * roadUpkeep(1, state.partition.regions[0].neighbors[0], false), 'no upkeep before it stands: only from its last month');
  assert.equal(civ.wealth, 1_000_000 - 4 * ROAD_TIERS[0].perKm * 400 - running, 'paid in full, to the unit, besides the realm\'s running costs');
  const built = state.chronicle.events.filter(event => event.type === 'roadBuilt');
  assert.equal(built.length, 1);
  assert.deepEqual([built[0].settlement, built[0].data.from, built[0].data.to, built[0].causes], [sem.id, 'Kesh', 'Sem', cited]);
  // Roads lower travel cost from the capital (VISION.md: governance reach grows with roads); the river still costs extra.
  const after = capitalKm(state, civ, 4);
  assert.ok(after < before, `${after} < ${before}`);
  assert.equal(after, 400 * (3 * ROAD_TIERS[0].travel + ROAD_TIERS[0].travel + REACH_TUNING.riverCrossing[2]));
  assert.equal(roadRoutes(state, civ, 1).length, 0, 'every town is served');
  assert.deepEqual(roadCoverage(state), { civs: 1, covered: 1 }, 'both towns besides the capital');
  // Upkeep: a share of what each road cost, owed by the civilization that holds its regions.
  assert.equal(roadUpkeepOf(state, civ), 4 * roadUpkeep(1, state.partition.regions[0].neighbors[0], false));
});

test('Engineering paves the roads and bridges their rivers, which removes the river\'s extra travel cost', () => {
  const { state, civ, sem } = strip();
  civ.wealth = 10_000_000;
  startRoads(state, 0, civ, [sem.id], []);
  for (let tick = 1; tick <= 16; tick++) month(state, tick);
  civ.knowledge = learn(civ.knowledge, TECH_INDEX.get('Engineering')!);
  const [paving] = roadRoutes(state, civ, 2).filter(route => route.settlement === sem.id);
  assert.equal(paving.edges.length, 4); assert.equal(paving.bridges, 1);
  assert.equal(paving.cost, 4 * ROAD_TIERS[1].perKm * 400 + BRIDGE.cost[2]);
  assert.equal(startRoads(state, 20, civ, [sem.id], [{ factor: 'connection', weight: 0.2 }]), 'began a paved road to Sem');
  const months = civ.roadWorks[0].months;
  for (let tick = 21; tick <= 20 + months; tick++) month(state, tick);
  const river = state.roads.get(roadKey(5, 2, 3))!;
  assert.deepEqual([river.tier, river.bridge, river.builder], [2, true, 0]);
  assert.ok([...state.roads.values()].filter(road => road.bridge).length === 1, 'a bridge only where a river is');
  assert.equal(state.metrics.firstBridgeTick, 20 + months);
  const event = state.chronicle.events.find(entry => entry.type === 'roadBuilt' && entry.data.road === 'a paved road')!;
  assert.deepEqual([event.data.bridges, event.data.oneBridge], [1, true]);
  const edge = state.partition.regions[2].neighbors.find(entry => entry.region === 3)!;
  assert.equal(edgeTravel(state, 2, edge), 400 * ROAD_TIERS[1].travel, 'bridged: no river surcharge');
  assert.equal(edgeTravel(state, 3, state.partition.regions[3].neighbors.find(entry => entry.region === 2)!), edgeTravel(state, 2, edge), 'either way');
  state.roads.clear();
  assert.equal(edgeTravel(state, 2, edge), edgeKm(400, 2));
});

test('roads nobody pays for wear away over the years, and so do roads nobody keeps', () => {
  const { state, civ, tal } = strip();
  civ.wealth = 1_000_000;
  startRoads(state, 0, civ, [tal.id], []);
  for (let tick = 1; tick <= 8; tick++) month(state, tick);
  assert.equal(state.roads.size, 2);
  // Broke: upkeep goes unpaid, the roads wear and are lost.
  civ.wealth = 0;
  let tick = 9;
  for (; state.roads.size && tick < 9 + BUILD_TUNING.roadDecayMonths + 24; tick++) month(state, tick);
  assert.equal(state.roads.size, 0);
  const lost = state.chronicle.events.filter(event => event.type === 'infrastructureDestroyed');
  assert.equal(lost.length, 1, 'roads lost the same month are one event');
  assert.deepEqual([lost[0].causes[0].factor, lost[0].data.unpaid, lost[0].data.roads, lost[0].actors[0].id], ['unpaidUpkeep', true, 2, civ.id]);
  assert.equal(state.metrics.roadsLost, 2);
  // Kept by no one (the land is no civilization's): they crumble at the full rate.
  civ.wealth = 1_000_000;
  startRoads(state, tick, civ, [tal.id], []);
  for (let at = tick + 1; at <= tick + 8; at++) month(state, at);
  assert.equal(state.roads.size, 2);
  state.owner.fill(-1); state.living = [];
  for (let at = 0; at < BUILD_TUNING.roadDecayMonths + 5; at++) month(state, tick + 9 + at);
  assert.equal(state.roads.size, 0);
  const unkept = state.chronicle.events.filter(event => event.type === 'infrastructureDestroyed').slice(1);
  assert.deepEqual(unkept.map(event => [event.causes[0].factor, event.data.unkept, event.actors.length]), [['unkept', true, 0]]);
});

test('a road work ends when the land on its way is lost', () => {
  const { state, civ, sem } = strip();
  civ.wealth = 1_000_000;
  startRoads(state, 0, civ, [sem.id], []);
  month(state, 1);
  state.owner[3] = -1;
  month(state, 2);
  assert.deepEqual([civ.roadWorks.length, state.metrics.roadsAbandoned, state.roads.size], [0, 1, 0]);
});

test('the road choice favours far and large towns, scales with the batch, and needs a known tier and a town to reach', () => {
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const route = (settlement: number, km: number, urban = 8_000) => ({ settlement, name: `T${settlement}`, urban, km, cost: 10_000, upkeep: 200, edges: 3, bridges: 0 });
  const view = (routes: ReturnType<typeof route>[], tier = 1, regions = 8) => ({
    values, reachKm: 4_000,
    budget: { rate: 0.2, output: 500_000, sites: 0, costs: 0, treasury: 1_000_000, revenue: 100_000, surplus: 100_000, strain: 0, tradition: 0.5, calm: 0.9 },
    build: { monuments: 1, regions, roads: { tier, one: 'a road', many: 'roads', routes } },
  }) as unknown as PolityView;
  assert.equal(bestRoad(view([])), null);
  assert.equal(bestRoad(view([route(1, 1_000)], 0)), null, 'no road known');
  const near = bestRoad(view([route(1, 400)]))!, far = bestRoad(view([route(1, 3_000)]))!;
  assert.ok(far.score > near.score, 'a far town needs it more (remoteness)');
  assert.ok(far.road && far.target === 1 && far.label === 'a road to T1' && far.targets[0] === 1);
  assert.deepEqual(far.factors.map(entry => entry.factor), ['connection', 'remoteness', 'cost', 'upkeep']);
  assert.ok(bestRoad(view([route(1, 3_000, 2_000)]))!.score < far.score, 'a small town needs it less');
  // One decision begins roads to a batch of towns (one per eight regions), the neediest first.
  const batch = bestRoad(view([route(1, 500), route(2, 3_000), route(3, 2_000)], 1, 16))!;
  assert.deepEqual(batch.targets, [2, 3]);
  assert.equal(batch.label, 'roads to 2 towns');
});

test('new roads branch off the roads that stand, towns already joined are not offered again, and a road is kept by who holds its ends', () => {
  // A fork: from the capital's region 0 a road runs to 1–2; region 5 lies beside 1 (and beside 0, at a much longer edge).
  const { state, civ, tal } = strip();
  const regions = state.partition.regions as unknown as { id: number; neighbors: { region: number; travelKm: number; riverTier: number }[] }[];
  regions.push({ id: 5, neighbors: [{ region: 1, travelKm: 400, riverTier: 0 }, { region: 0, travelKm: 700, riverTier: 0 }], sea: [], centroid: 5 } as never);
  regions[1].neighbors.push({ region: 5, travelKm: 400, riverTier: 0 }); regions[0].neighbors.push({ region: 5, travelKm: 700, riverTier: 0 });
  for (const key of ['owner', 'occupant'] as const) state[key] = Int32Array.from([...state[key], 0]);
  state.regionSettlements.push([]); state.groups.push({ id: 5, region: 5, size: 10_000, specialists: 0 } as never); civ.groups.push(5);
  state.remoteness = new Float64Array(6); state.remoteOwner = new Int32Array(6).fill(-1); state.neglected = new Uint8Array(6);
  const fifth = { ...tal, id: state.settlements.length, name: 'Ori', region: 5, cell: 5 };
  state.settlements.push(fifth); state.regionSettlements[5].push(fifth.id);
  civ.wealth = 1_000_000;
  startRoads(state, 0, civ, [tal.id], []);
  for (let tick = 1; tick <= 8; tick++) month(state, tick);
  const n = 6;
  assert.ok(state.roads.has(roadKey(n, 0, 1)) && state.roads.has(roadKey(n, 1, 2)));
  // Without roads the direct way 0–5 (700) is cheaper than 0–1–5 (800); with the road to 1 standing, the new road
  // branches off it: only 1–5 is built.
  const [toOri] = roadRoutes(state, civ, 1).filter(route => route.settlement === fifth.id);
  assert.deepEqual(toOri.edges, [[1, 5]]);
  assert.ok(!roadRoutes(state, civ, 1).some(route => route.settlement === tal.id), 'Tal is joined already');
  // The keeper: who holds the road's first region, else its second; nobody when neither is a civilization's.
  const road = state.roads.get(roadKey(n, 0, 1))!;
  assert.equal(keeperOf(state, road), 0);
  state.owner[0] = -1;
  assert.equal(keeperOf(state, road), 0, 'the holder of its second region');
  state.owner[1] = -1;
  assert.equal(keeperOf(state, road), -1);
});

test('a paved road supersedes a dirt road still under way on its edges; coverage counts only peoples who know the Wheel', () => {
  const { state, civ, sem } = strip();
  civ.wealth = 1_000_000;
  startRoads(state, 0, civ, [sem.id], []);
  month(state, 1);
  assert.equal(civ.roadWorks[0].tier, 1);
  civ.knowledge = learn(civ.knowledge, TECH_INDEX.get('Engineering')!);
  assert.match(startRoads(state, 2, civ, [sem.id], []), /began a paved road to Sem/);
  assert.deepEqual([civ.roadWorks.map(work => work.tier), state.metrics.roadsAbandoned], [[2], 1], 'the dirt road is given up where the paved one runs');
  // Engineering without the Wheel: no roads of the Wheel's kind counted.
  const { state: other, civ: unwheeled } = strip(['Engineering']);
  assert.deepEqual(roadCoverage(other), { civs: 0, covered: 0 });
  assert.equal(knownRoadTier(unwheeled.knowledge), 2);
});

test('travel from the capital counts a road only where the civilization sees both its ends', () => {
  const { state, civ, sem } = strip();
  civ.wealth = 1_000_000;
  startRoads(state, 0, civ, [sem.id], []);
  for (let tick = 1; tick <= 16; tick++) month(state, tick);
  const withRoads = capitalKm(state, civ, 4);
  civ.map.status[3] = KNOWN;
  // Remembered land: the edges into region 3 count bare, as last seen.
  assert.equal(capitalKm(state, civ, 3), 400 * (2 * ROAD_TIERS[0].travel) + edgeKm(400, 2));
  assert.ok(capitalKm(state, civ, 4) > withRoads);
});
