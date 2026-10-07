import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDING_INDEX } from '../src/simulation/buildings.ts';
import { administration, ageFactor, arrearsBurden, costsOf, deferMaintenance, fullCostsOf, realmAccount, regionAccount, seatOf, services, settlementAccount, sizeFactor, taxBurden, totalCosts } from '../src/simulation/budget.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { construct } from '../src/simulation/construction.ts';
import { edgeTravel, roadKey, roadUpkeepOf } from '../src/simulation/roads.ts';
import { WONDER_INDEX, WONDERS } from '../src/simulation/wonders.ts';
import { roadLook, roadWear } from '../src/renderer/generated-world.ts';
import { taxRate } from '../src/simulation/decisions/budget.ts';
import { buildScore } from '../src/simulation/decisions/build.ts';
import { expansionScore } from '../src/simulation/decisions/choose.ts';
import { incomeOf, wealthFlows } from '../src/simulation/economy.ts';
import { createLanguage } from '../src/simulation/names.ts';
import { budgetView, type PolityView } from '../src/simulation/perception.ts';
import { createRng } from '../src/simulation/rng.ts';
import { applyBuildings, foundSettlement, house } from '../src/simulation/settlements.ts';
import { stabilityOf } from '../src/simulation/stability.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { BUDGET_TUNING, BUILD_TUNING, REACH_TUNING, STABILITY_TUNING } from '../src/simulation/tunables.ts';

test('administration costs more for more people, farther from the capital, in a larger and in an older realm; services cost more per head in larger places', () => {
  const base = administration(10_000, 0, 1, 1);
  assert.equal(base, BUDGET_TUNING.perRegion + BUDGET_TUNING.perPerson * 10_000);
  assert.ok(administration(20_000, 0, 1, 1) > base, 'more people');
  assert.ok(administration(10_000, 1, 1, 1) > base, 'farther');
  assert.equal(administration(10_000, 50, 1, 1), administration(10_000, BUDGET_TUNING.remoteCap, 1, 1), 'at most remoteCap reaches away');
  assert.equal(sizeFactor(2), 1, 'small realms pay no premium'); assert.equal(sizeFactor(BUDGET_TUNING.sizeScale), 1);
  assert.ok(sizeFactor(4 * BUDGET_TUNING.sizeScale) > sizeFactor(2 * BUDGET_TUNING.sizeScale), 'larger realms pay more per region');
  assert.equal(ageFactor(0), 1);
  assert.ok(ageFactor(1_000) > ageFactor(100) && ageFactor(3_000) > ageFactor(1_000) && ageFactor(1e9) <= 1 + BUDGET_TUNING.ageMax + 1e-9, 'older costs more, up to a limit');
  assert.ok(services(50_000) / 50_000 > services(1_000) / 1_000, 'per head, more in larger places');
});

test('a realm sets its taxes to cover its costs and refill its reserve, step by step, within bounds', () => {
  const tuning = BUDGET_TUNING;
  // A people of middling Tradition keeps two years of costs in reserve.
  const budget = (entry: Partial<PolityView['budget']>) => ({ rate: tuning.customaryRate, output: 1_000_000, sites: 0, costs: 200_000, treasury: 400_000, revenue: 0, surplus: 0, strain: 0, tradition: (2 - tuning.reserveYears) / tuning.reserveTradition, calm: 0.9, ...entry });
  assert.equal(taxRate(budget({})), tuning.customaryRate, 'its costs covered at the customary rate and its reserve full: unchanged');
  assert.equal(taxRate(budget({ costs: 400_000, treasury: 800_000 })), 0.22, 'costlier: up by a step');
  assert.equal(taxRate(budget({ costs: 100_000, treasury: 200_000 })), 0.18, 'cheaper: down by a step');
  assert.ok(taxRate(budget({ treasury: 0 })) > tuning.customaryRate, 'an empty treasury is refilled');
  assert.ok(taxRate(budget({ sites: 100_000 })) < tuning.customaryRate, 'mines and quarries pay part');
  assert.equal(taxRate(budget({ rate: tuning.maxRate, costs: 10_000_000, treasury: 10_000_000 })), tuning.maxRate, 'never above the most it can take');
  assert.equal(taxRate(budget({ rate: tuning.minRate, costs: 0, treasury: 1e9 })), tuning.minRate, 'never below the least');
  assert.ok(taxRate(budget({ tradition: 1 })) > taxRate(budget({ tradition: 0 })), 'a traditional people keeps a larger reserve');
  // A restless realm raises taxes above the custom only as far as its people bear it; at the unrest line, not at all.
  const costly = { rate: 0.3, costs: 10_000_000, treasury: 10_000_000 };
  assert.equal(taxRate(budget({ ...costly, calm: tuning.calmFull })), 0.32, 'calm: up a step');
  assert.equal(taxRate(budget({ ...costly, calm: tuning.calmFloor })), 0.28, 'restless: back toward the custom');
  assert.equal(taxRate(budget({ ...costly, rate: tuning.customaryRate, calm: tuning.calmFloor })), tuning.customaryRate);
  // Steps add up exactly: from the custom, five steps up reach 30% and no more.
  let rate: number = tuning.customaryRate;
  for (let year = 0; year < 5; year++) rate = taxRate(budget({ ...costly, rate }));
  assert.equal(rate, 0.3);
});

test('taxes above the customary rate unsettle people and below it content them; arrears unsettle the far regions most', () => {
  const tuning = BUDGET_TUNING;
  assert.equal(taxBurden(tuning.customaryRate), 0);
  assert.equal(taxBurden(tuning.maxRate), tuning.taxUnrest);
  assert.equal(taxBurden(tuning.minRate), -tuning.taxContent);
  assert.ok(arrearsBurden({ arrears: 1 }, 1) > arrearsBurden({ arrears: 1 }, 0) && arrearsBurden({ arrears: 1 }, 0) > 0, 'the edges most, the heartland a little');
  assert.equal(arrearsBurden({ arrears: 1 }, 3), tuning.arrearsUnrest);
  assert.equal(arrearsBurden({ arrears: 0 }, 1), 0);
  // In a region's stability: heavy taxes and arrears lower it, light taxes raise it.
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const state = { cultures: [{ values }], settlements: [], regionSettlements: [[]], wonders: [] } as unknown as SimulationState;
  const reach = REACH_TUNING.baseKm, group = { foodSecurity: 1.2, culture: 0, region: 0 } as never;
  const civ = (taxRate: number, arrears: number) => ({ culture: 0, knowledge: { multipliers: { reach: 1 } }, taxRate, arrears, groups: [], settledTick: null }) as unknown as Polity;
  const usual = stabilityOf(state, civ(tuning.customaryRate, 0), group, reach / 2);
  assert.ok(stabilityOf(state, civ(tuning.maxRate, 0), group, reach / 2).value < usual.value, 'heavy taxes');
  assert.ok(stabilityOf(state, civ(tuning.minRate, 0), group, reach / 2).value > usual.value, 'light taxes');
  const near = stabilityOf(state, civ(tuning.customaryRate, 1), group, 0), far = stabilityOf(state, civ(tuning.customaryRate, 1), group, reach);
  assert.ok(far.value < near.value && near.value < usual.value, 'arrears, most at the edge');
  assert.equal(far.arrears, tuning.arrearsUnrest);
  // Calm is stability apart from the budget: heavy taxes and arrears lower stability, not calm.
  const burdened = stabilityOf(state, civ(tuning.maxRate, 1), group, reach);
  assert.equal(burdened.calm, usual.calm);
  assert.ok(Math.abs(burdened.calm - burdened.value - burdened.taxes - burdened.arrears) < 1e-12 && burdened.value < burdened.calm);
});

/**
 * Test fixture: one civilization holding a strip of regions of 6 cells each (all by a river): its heartland of 200,000
 * well-fed farmers, and far regions of 20,000 hungry herders and farmers, 1.5 reaches away (with two regions) or 0.8
 * and 1.6 (with three).
 */
function realm(count = 2) {
  const cells = 6 * count, width = 6, regions = Array.from({ length: count }, (_, id) => id);
  const state = {
    tick: 12 * 300, geography: { width, cells, riverRunoff: new Uint32Array(cells).fill(9_000), resource: new Uint8Array(cells), marine: new Uint8Array(cells), lake: new Uint32Array(cells) },
    partition: {
      regions: regions.map(id => ({ id, centroid: id * 6, settlementSites: [id * 6, id * 6 + 1, id * 6 + 2], neighbors: [], sites: [] })),
      regionOf: Int32Array.from({ length: cells }, (_, cell) => Math.floor(cell / 6)),
    },
    cultures: [{ language: createLanguage(createRng(1, 1)), values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 } }], settlements: [], regionSettlements: regions.map(() => []), chronicle: new Chronicle(),
    groups: regions.map(id => id === 0 ? { id, region: id, specialists: 0, foodSecurity: 1.1, size: 200_000, farmShare: 1 } : { id, region: id, specialists: 0, foodSecurity: 0.75, size: 20_000, farmShare: 0.6 }),
    groupAt: Int32Array.from(regions), unrest: new Uint8Array(count), stability: new Float64Array(count).fill(1),
    remoteness: Float64Array.from(regions, id => count === 2 ? 1.5 * id : 0.8 * id), remoteOwner: new Int32Array(count), neglected: new Uint8Array(count),
    living: [0], ledger: { wealth: new Map() }, wonders: [], roads: new Map(), owner: new Int32Array(count),
    farmBonus: new Float64Array(count).fill(1), droughtShield: new Float64Array(count), storeBonus: new Float64Array(count).fill(1), spoilageBonus: new Float64Array(count).fill(1),
    metrics: { settlementsGrown: 0, ruinsResettled: 0, tierChanges: 0, buildingsStarted: 0, buildingsCompleted: 0, buildingsLost: 0, projectsAbandoned: 0, roadsAbandoned: 0, arrearsBegun: 0, taxesRaised: 0, taxesEased: 0, neglectBegun: 0 },
  } as unknown as SimulationState;
  const civ = {
    id: 0, kind: 'civ', name: 'Ora', culture: 0, capital: null, groups: regions.slice(), wealth: 0, wealthCarry: 0, upkeepCarry: 0, projects: [], roadWorks: [], roadsUnpaid: 0,
    heardWonders: [], met: new Map(), settledTick: 0, taxRate: 0.25, arrears: 0, inArrears: false, heavyTaxes: false, deferring: false, keptYears: 0, repairing: false, knowledge: { multipliers: { reach: 1 } },
  } as unknown as Polity;
  state.polities = [civ];
  const city = foundSettlement(state, createRng(5, 5), civ, 0, true, 0, [], false)!;
  const hamlet = foundSettlement(state, createRng(5, 7), civ, 0, false, 0, [], false)!;
  state.groups[0].specialists = house(state, 0, city.housing + 10);
  const villages = regions.slice(1).map(region => {
    const village = foundSettlement(state, createRng(5, 5 + region), civ, region, false, 0, [], false)!;
    state.groups[region].specialists = house(state, region, 10);
    return village;
  });
  // A shrine in the hamlet: it costs more than the hamlet pays.
  hamlet.buildings.push({ type: BUILDING_INDEX.get('shrine')!, condition: 1, builtTick: 0 });
  applyBuildings(hamlet);
  return { state, civ, city, hamlet, village: villages[0], villages };
}

test('each settlement shows what it pays and costs, its region\'s seat keeping the region\'s account, and they add up to the realm\'s; not every place pays', () => {
  const { state, civ, city, hamlet, village } = realm();
  const account = realmAccount(state, civ), costs = costsOf(state, civ);
  const revenue = account.revenue.trades + account.revenue.farms + account.revenue.sites;
  assert.ok(Math.abs(revenue - incomeOf(state, civ)) < 1e-6, `revenue ${revenue} is the realm's income`);
  for (const kind of ['administration', 'services', 'upkeep', 'roads'] as const) assert.ok(Math.abs(account.costs[kind] - costs[kind]) < 1e-6, kind);
  // The capital is its region's seat: it takes in the heartland's farm taxes and pays its administration.
  assert.deepEqual([seatOf(state, 0), seatOf(state, 1)], [city.id, village.id]);
  const capital = settlementAccount(state, civ, city.id), heartland = regionAccount(state, civ, state.groups[0]);
  assert.ok(capital.seat && capital.farms === heartland.farms && capital.administration === heartland.administration);
  assert.ok(capital.balance > 0, 'the capital of rich farmland pays');
  const small = settlementAccount(state, civ, hamlet.id);
  assert.ok(!small.seat && small.farms === 0 && small.administration === 0);
  assert.ok(small.balance < 0, 'the hamlet with a shrine runs at a loss');
  // The far, hungry region's seat pays its administration with nothing from its farmers: a loss.
  const far = settlementAccount(state, civ, village.id);
  assert.ok(far.seat && far.farms === 0, 'hungry farmers have nothing to sell');
  assert.ok(far.balance < 0, 'the frontier village runs at a loss');
  // A region let go unkept: its upkeep is not paid, and the accounts still add up to what the realm pays.
  village.buildings.push({ type: BUILDING_INDEX.get('granary')!, condition: 1, builtTick: 0 }); applyBuildings(village);
  state.neglected[1] = 1;
  const unkept = realmAccount(state, civ), owed = costsOf(state, civ);
  assert.equal(settlementAccount(state, civ, village.id).upkeep, 0);
  for (const kind of ['administration', 'services', 'upkeep', 'roads'] as const) assert.ok(Math.abs(unkept.costs[kind] - owed[kind]) < 1e-6, `${kind} with a region unkept`);
  // The far region costs more to administer per person than the heartland.
  const perPerson = (region: number) => regionAccount(state, civ, state.groups[region]).administration / state.groups[region].size;
  assert.ok(perPerson(1) > perPerson(0));
});

test('a realm\'s budget view reads how calm its regions are, people-weighted, as last judged', () => {
  const { state, civ } = realm();
  Object.assign(state, { calm: Float64Array.from([0.8, 0.4]) });
  assert.ok(Math.abs(budgetView(state, civ).calm - (200_000 * 0.8 + 20_000 * 0.4) / 220_000) < 1e-12);
});

test('a realm pays its costs month by month, to the unit; one that cannot falls into arrears, an event citing its costs, and pays its way again', () => {
  const { state, civ, hamlet } = realm();
  const costs = totalCosts(costsOf(state, civ));
  let paid = 0;
  const start = state.tick;
  const month = (tick: number) => {
    state.ledger.wealth.clear(); state.tick = start + tick;
    const flows = wealthFlows(state, civ), before = civ.wealth;
    construct(state, { tick } as never);
    assert.equal(civ.wealth, before - flows.administration - flows.services - flows.upkeep, 'every unit paid is a flow');
    paid += flows.administration + flows.services + flows.upkeep;
  };
  civ.wealth = 1_000_000;
  for (let tick = 1; tick <= 12; tick++) month(tick);
  // (The realm ages through the year, so its costs grow a little.)
  assert.ok(Math.abs(paid - costs) <= 1 + costs * 0.001, `a year's costs paid (${paid} of ${costs})`);
  assert.equal(civ.arrears, 0);
  // An empty treasury: nothing is paid, arrears rise, buildings wear.
  civ.wealth = 0;
  for (let tick = 13; tick <= 36; tick++) month(tick);
  assert.ok(civ.arrears > BUDGET_TUNING.arrearsEvent && civ.inArrears);
  assert.ok(hamlet.buildings[0].condition < 1, 'the shrine wears');
  state.chronicle.flush(36);
  const fell = state.chronicle.events.find(event => event.type === 'arrears')!;
  assert.ok(fell.data.begun, 'fallen into arrears');
  assert.deepEqual(fell.causes.map(cause => cause.factor).sort(), ['administration', 'services'], 'citing its main costs (the shrine\'s upkeep is too small to cite)');
  // Paid again, it climbs out.
  civ.wealth = 10_000_000;
  for (let tick = 37; tick <= 120 && civ.inArrears; tick++) month(tick);
  assert.equal(civ.inArrears, false);
  state.chronicle.flush(120);
  assert.ok(state.chronicle.events.some(event => event.type === 'arrears' && event.data.ended));
});

test('a realm whose costs outrun its customary taxes is loath to expand, far land most; one with a surplus is not held back', () => {
  const candidate = (capitalKm: number) => ({ region: 10, from: 1, fromPeople: 10_000, pressure: 0.8, crossingKm: 400, capitalKm, value: 100_000, tribe: false });
  const view = (strain: number) => ({
    id: 1, tick: 1200, values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 }, sea: 0, seaTick: -1,
    reachKm: 1_500, people: 10_000, landPressure: 0.5, hunger: 0, ownValue: 100_000, unknownFrontier: 0, regions: 4, unrestShare: 0, stability: 0.9, neighbours: [], partners: [], exchanges: 0,
    budget: { rate: 0.2, output: 1_000_000, sites: 0, costs: 200_000 * (1 + strain), treasury: 0, revenue: 200_000, surplus: -200_000 * strain, strain, tradition: 0.5, calm: 0.9 },
  }) as unknown as PolityView;
  const factor = (option: ReturnType<typeof expansionScore>) => option.factors.find(entry => entry.factor === 'administration')!.weight;
  assert.ok(factor(expansionScore(view(0), candidate(1_500))) === 0, 'no strain, no weight');
  const near = expansionScore(view(0.5), candidate(0)), far = expansionScore(view(0.5), candidate(1_500));
  assert.ok(factor(far) < factor(near) && factor(near) < 0, 'strained: far land weighs most');
  assert.ok(far.score < expansionScore(view(0), candidate(1_500)).score);
});

test('building weighs the realm\'s surplus after its costs: a realm already short weighs new upkeep heavily', () => {
  const granary = BUILDING_INDEX.get('granary')!;
  const kind = { type: granary, name: 'granary', one: 'a granary', many: 'granaries', purpose: 'food', cost: 2_000, upkeep: 40, minTier: 0, coast: false, water: false, perRegion: true, works: '' as const };
  const settlement = { id: 1, region: 0, name: 'Kesh', tier: 1, urban: 8_000, housing: 8_000, hardship: 0.5, farmShare: 1, farmers: 20_000, stability: 0.9, frontier: 0, has: [] as number[], coast: false, water: true, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false };
  const view = (surplus: number, treasury: number) => ({
    values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 },
    budget: { rate: 0.2, output: 50_000, sites: 0, costs: 10_000 - surplus, treasury, revenue: 10_000, surplus, strain: Math.max(0, -surplus / 10_000), tradition: 0.5, calm: 0.9 },
    build: { monuments: 1, regions: 1, catalog: [kind], settlements: [settlement], wonders: [], stability: 0.9 },
  }) as unknown as PolityView;
  const rich = buildScore(view(5_000, 10_000), kind), short = buildScore(view(-2_000, 10_000), kind), broke = buildScore(view(-2_000, 0), kind);
  assert.ok(rich.score > short.score && short.score > broke.score, `${rich.score} > ${short.score} > ${broke.score}`);
  const upkeep = (option: typeof rich) => option.factors.find(entry => entry.factor === 'upkeep')!.weight;
  assert.equal(upkeep(short), -Math.round(BUILD_TUNING.upkeepWeight * 40 / (BUILD_TUNING.surplusFloor * 10_000) * 1000) / 1000, 'short: upkeep against a small share of its revenue');
});

test('a large, old realm holds its far provinces less firmly, most in its far regions', () => {
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const state = { tick: 12 * 1_500, cultures: [{ values }], settlements: [], regionSettlements: [[]], wonders: [] } as unknown as SimulationState;
  const realm = (regions: number, settled: number) => ({ culture: 0, knowledge: { multipliers: { reach: 1 } }, taxRate: BUDGET_TUNING.customaryRate, arrears: 0, groups: new Array(regions).fill(0), settledTick: settled }) as unknown as Polity;
  const group = { foodSecurity: 1.2, culture: 0, region: 0 } as never, reach = REACH_TUNING.baseKm;
  const empire = realm(400, 0), young = realm(10, 12 * 1_450);
  const far = stabilityOf(state, empire, group, reach), near = stabilityOf(state, empire, group, 0);
  assert.ok(far.strain > near.strain && near.strain > 0, 'far provinces most, the heartland a little');
  const expected = STABILITY_TUNING.strain * (sizeFactor(400) * ageFactor(1_500) - 1);
  assert.ok(Math.abs(far.strain - expected) < 1e-12 && Math.abs(far.value - (STABILITY_TUNING.base - expected)) < 1e-12);
  assert.ok(stabilityOf(state, young, group, reach).strain < 0.005, 'a small young realm feels hardly any');
  assert.equal(far.calm, far.value, 'strain is no part of the budget: calm counts it');
});

test('a strained realm lets its far provinces go unkept, more when even its taxes fall short; their buildings wear', () => {
  const { state, civ, village } = realm();
  village.buildings.push({ type: BUILDING_INDEX.get('granary')!, condition: 1, builtTick: 0 });
  applyBuildings(village);
  civ.capital = state.settlements.find(settlement => settlement.capital)!.id;
  const full = totalCosts(fullCostsOf(state, civ));
  // Not strained, its taxes enough: everything kept up.
  deferMaintenance(state, civ, full, 0, 0);
  assert.deepEqual([...state.neglected, civ.deferring], [0, 0, false]);
  // Strained (its costs outrun customary taxes by half): the farthest half of its regions goes unkept, never the capital's.
  deferMaintenance(state, civ, full, 0, 0.5);
  assert.deepEqual([...state.neglected], [0, 1]);
  assert.ok(civ.deferring && state.metrics.neglectBegun === 1);
  assert.equal(totalCosts(costsOf(state, civ)), full - village.bonus.upkeep, 'its upkeep is not paid');
  state.chronicle.flush(state.tick);
  assert.ok(state.chronicle.events.some(event => event.type === 'neglect' && event.data.begun && event.region === 1));
  // Not strained but short even at the taxes it set, with no savings to spare: from the outside in, the capital kept.
  deferMaintenance(state, civ, 0, 0, 0);
  assert.deepEqual([...state.neglected], [0, 1]);
  // Savings beyond the reserve cover a shortfall first.
  civ.wealth = 10 * full;
  deferMaintenance(state, civ, full - village.bonus.upkeep, 0, 0);
  assert.equal(state.neglected[1], 0);
  // The episode ends only after years in a row of keeping everything up (the year just kept is the first).
  for (let year = 2; year < BUDGET_TUNING.keptYears; year++) deferMaintenance(state, civ, full, 0, 0);
  assert.ok(civ.deferring);
  deferMaintenance(state, civ, full, 0, 0);
  assert.equal(civ.deferring, false);
  // A month in a region let go unkept: its buildings wear though everything due is paid.
  civ.wealth = 1_000_000; state.neglected[1] = 1; civ.deferring = true;
  state.ledger.wealth.clear(); wealthFlows(state, civ);
  construct(state, { tick: state.tick } as never);
  assert.ok(village.buildings[0].condition < 1 && civ.arrears === 0, 'the far granary wears');
});

test('a worn road is slower than a kept one, and looks worn on the map', () => {
  const edge = { region: 1, travelKm: 400, riverTier: 0 };
  const road = { a: 0, b: 1, tier: 1, bridge: false, condition: 1, builder: 0, builtTick: 0, upkeep: 0 };
  const state = { partition: { regions: [{ id: 0 }, { id: 1 }] }, roads: new Map([[roadKey(2, 0, 1), road]]) } as unknown as SimulationState;
  const kept = edgeTravel(state, 0, edge);
  road.condition = 0.5;
  assert.ok(edgeTravel(state, 0, edge) > kept && edgeTravel(state, 0, edge) < 400, 'worn: slower, still better than none');
  road.condition = 0;
  assert.equal(edgeTravel(state, 0, edge), 400, 'worn away: no help at all');
  assert.equal(roadWear(0.9), 0); assert.equal(roadWear(0.6), 1); assert.equal(roadWear(0.1), 2);
  const fresh = roadLook(2, 1), worn = roadLook(2, 0.6), crumbling = roadLook(2, 0.1);
  assert.deepEqual(fresh.dash, [], 'a kept paved road is solid');
  assert.ok(worn.dash.length > 0 && worn.color !== fresh.color && worn.width < fresh.width, 'a worn one breaks up and fades');
  assert.ok(crumbling.alpha < worn.alpha && crumbling.width < worn.width && crumbling.dash[1] > crumbling.dash[0], 'a crumbling one is faint, a trail of dots');
});

test('letting go runs from the farthest region inward and stops once the upkeep saved covers the shortfall; roads into unkept land and wonders there wear', () => {
  const { state, civ, villages: [near, far] } = realm(3);
  civ.capital = state.settlements.find(settlement => settlement.capital)!.id;
  for (const village of [near, far]) { village.buildings.push({ type: BUILDING_INDEX.get('granary')!, condition: 1, builtTick: 0 }); applyBuildings(village); }
  // A road between the near and the far region, kept by this realm.
  const road = { a: 1, b: 2, tier: 1, bridge: false, condition: 1, builder: 0, builtTick: 0, upkeep: 50 };
  state.roads.set(roadKey(3, 1, 2), road);
  // A wonder standing in the far village.
  const gardens = WONDER_INDEX.get('hangingGardens')!;
  state.wonders.push({ id: 0, type: gardens, settlement: far.id, builder: 0, begunTick: 0, builtTick: 0, status: 'standing', spent: 1, cost: 1, condition: 1, endedTick: null, endCause: null, causes: [], waited: 0 });
  far.wonder = gardens;
  const full = totalCosts(fullCostsOf(state, civ)), farUpkeep = far.bonus.upkeep + WONDERS[gardens].upkeep + road.upkeep;
  // Short by less than the far region's upkeep (its road counted with it): only the far region goes.
  deferMaintenance(state, civ, full - farUpkeep + 1, 0, 0);
  assert.deepEqual([...state.neglected], [0, 0, 1], 'the farthest first, the rest kept up');
  assert.equal(roadUpkeepOf(state, civ), 0, 'the road into unkept land is not kept up');
  assert.equal(roadUpkeepOf(state, civ, true), 50);
  // A month: the road, the far granary and the wonder wear; nothing is in arrears.
  civ.wealth = 1_000_000;
  state.ledger.wealth.clear(); wealthFlows(state, civ);
  construct(state, { tick: state.tick } as never);
  assert.ok(Math.abs(road.condition - (1 - 1 / BUILD_TUNING.neglectRoadMonths)) < 1e-12, 'the road wears');
  assert.ok(far.buildings[0].condition < 1 && state.wonders[0].condition < 1 && near.buildings[0].condition === 1);
  // Short by more than the far region's upkeep, with no savings: the near one goes too, never the capital's.
  civ.wealth = 0;
  deferMaintenance(state, civ, full - farUpkeep - near.bonus.upkeep, 0, 0);
  assert.deepEqual([...state.neglected], [0, 1, 1]);
  // Kept up again, they mend.
  deferMaintenance(state, civ, full, 0, 0);
  civ.wealth = 1_000_000;
  const worn = road.condition;
  state.ledger.wealth.clear(); wealthFlows(state, civ);
  construct(state, { tick: state.tick + 1 } as never);
  assert.ok(road.condition > worn && far.buildings[0].condition > 1 - 2 / BUILD_TUNING.neglectDecayMonths);
});
