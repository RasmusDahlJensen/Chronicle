import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { WORLD_BIOMES } from '../shared/generated-world.ts';
import { expansionScore, explorationScore } from '../src/simulation/decisions/choose.ts';
import { inheritKnowledge, learn, mergeKnowledge, startingKnowledge, withAccess, type Knowledge } from '../src/simulation/knowledge.ts';
import type { Candidate, PolityView } from '../src/simulation/perception.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { accessOf, assess, demanded, reliefThere, resourcesYear, shortfallOf, supplyOf } from '../src/simulation/supply.ts';
import { TECH_INDEX, TECHS } from '../src/simulation/techs.ts';
import { RESOURCE_TUNING } from '../src/simulation/tunables.ts';

/** Resource supply and demand (M5.3; VISION.md "Supply and demand"). */
const index = (name: string) => RESOURCE_IDS.indexOf(name as typeof RESOURCE_IDS[number]);
const knowing = (...names: string[]) => {
  let knowledge = startingKnowledge();
  // Everything they need first, in graph order.
  const wanted = new Set<string>();
  const add = (name: string) => { if (wanted.has(name)) return; for (const requirement of TECHS[TECH_INDEX.get(name)!].requires) add(requirement); wanted.add(name); };
  for (const name of names) add(name);
  for (const name of wanted) if (!knowledge.known[TECH_INDEX.get(name)!]) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  return knowledge;
};

test('a shortfall weakens the techs that need the resource, down to a floor; full supply changes nothing', () => {
  const full = knowing('Bronze working'), access = full.access.slice();
  assert.ok(full.access.every(value => value === 1), 'supplied until assessed');
  assert.deepEqual(withAccess(full, access).multipliers, full.multipliers, 'full access: the same multipliers');
  access[index('tin')] = 0.5;
  const short = withAccess(full, access);
  // Bronze working (copper and tin) counts half; Copper working (copper only) in full.
  assert.ok(Math.abs(short.multipliers.military - 1.15 * (1 + 0.3 * 0.5)) < 1e-12);
  assert.ok(Math.abs(short.multipliers.farmYield - full.multipliers.farmYield / 1.05 * (1 + 0.05 * 0.5)) < 1e-12);
  assert.equal(short.known, full.known, 'the same techs, research kept');
  assert.equal(accessOf(0, 10), RESOURCE_TUNING.floor, 'never below the floor');
  assert.equal(accessOf(5, 10), 0.5);
  assert.equal(accessOf(20, 10), 1);
  assert.equal(accessOf(0, 0), 1, 'nothing demanded: fully supplied');
  assert.equal(shortfallOf(0, 10), 1);
  assert.equal(shortfallOf(15, 10), 0);
});

test('demand follows the techs known; supply counts worked sites and land by area', () => {
  // Two regions: region 0 has a copper site, a tin site and four forest cells; region 1 two mountain cells.
  const biome = (name: string) => WORLD_BIOMES.indexOf(name as typeof WORLD_BIOMES[number]);
  const copper = index('copper') + 1, tin = index('tin') + 1;
  const regions = [{ id: 0, cells: [0, 1, 2, 3], sites: [[0, copper], [1, tin]] }, { id: 1, cells: [4, 5], sites: [] }];
  const settlement = { status: 'alive', bonus: { mine: false, quarry: false } };
  const state = {
    geography: { cellAreaKm2: 25_000, biome: Uint8Array.from([biome('forest'), biome('forest'), biome('forest'), biome('forest'), biome('mountain'), biome('mountain')]) },
    partition: { regions }, regionSettlements: [[0], []], settlements: [settlement],
    groups: [{ region: 0, size: 60_000_000 }, { region: 1, size: 20_000_000 }],
  } as unknown as SimulationState;
  const civ = { kind: 'civ', groups: [0, 1], knowledge: knowing('Bronze working', 'Boatbuilding'), supply: new Float64Array(RESOURCE_IDS.length), demand: new Float64Array(RESOURCE_IDS.length) } as unknown as Polity;
  const wanted = demanded(civ);
  for (const name of ['copper', 'tin', 'timber', 'stone']) assert.equal(wanted[index(name)], 1, `${name} is demanded`);
  assert.equal(wanted[index('iron')], 0, 'not before Iron working');
  let supply = supplyOf(state, civ);
  assert.equal(supply[index('copper')], 0, 'no mine works the site');
  assert.equal(supply[index('timber')], 4 * 25_000 / RESOURCE_TUNING.forestKm2, 'forest by area');
  assert.equal(supply[index('stone')], 2 * 25_000 / RESOURCE_TUNING.roughKm2, 'mountains by area');
  settlement.bonus.mine = true;
  supply = supplyOf(state, civ);
  assert.equal(supply[index('copper')], RESOURCE_TUNING.siteUnits);
  assert.equal(supply[index('tin')], RESOURCE_TUNING.siteUnits);
  // Assessed: demand for its 80 million people, access from supply ÷ demand, the knowledge re-derived.
  assess(state, civ);
  assert.equal(civ.demand[index('tin')], 80_000_000 / RESOURCE_TUNING.peoplePerSite);
  assert.equal(civ.knowledge.access[index('tin')], accessOf(RESOURCE_TUNING.siteUnits, 80_000_000 / RESOURCE_TUNING.peoplePerSite));
  assert.equal(civ.knowledge.access[index('iron')], 1, 'nothing demanded');
  // A tribe is never assessed.
  const tribe = { id: 1, kind: 'band', groups: [1], knowledge: knowing('Bronze working') as Knowledge, supply: new Float64Array(RESOURCE_IDS.length), demand: new Float64Array(RESOURCE_IDS.length) } as unknown as Polity;
  Object.assign(state, { living: [1], polities: [civ, tribe] });
  resourcesYear(state, { tick: 1 } as never);
  assert.ok(tribe.knowledge.access.every(value => value === 1) && tribe.demand.every(value => value === 0));
});

test('a shortfall draws expansion toward land holding what it lacks, and exploration', () => {
  const view = (shortage: number) => ({
    id: 1, tick: 1200, values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 }, people: 10_000, regions: 4, hunger: 0, landPressure: 0.2, ownValue: 100_000,
    reachKm: 1500, unknownFrontier: 6, sea: 0, seaTick: -1, budget: { strain: 0 },
    needs: { hunger: 0, landPressure: 0.2, shortage, threat: 0, unrest: 0, friction: 0, opportunity: 0, grievance: 0, infrastructure: 0 }, threats: [],
  }) as unknown as PolityView;
  const candidate = (short: number): Candidate => ({ region: 10, from: 1, fromPeople: 10_000, pressure: 0.2, crossingKm: 400, capitalKm: 600, value: 100_000, tribe: false, short });
  const lacking = expansionScore(view(0.8), candidate(0.8)), plain = expansionScore(view(0.8), candidate(0));
  assert.ok(lacking.score > plain.score);
  assert.ok(lacking.factors.find(entry => entry.factor === 'resource')!.weight > 0 && plain.factors.find(entry => entry.factor === 'resource')!.weight === 0);
  assert.ok(explorationScore(view(0.8)).score > explorationScore(view(0)).score, 'new land may hold what it lacks');
  assert.ok(explorationScore(view(0.8)).factors.find(entry => entry.factor === 'resourceShortage')!.weight > 0);
});

test('supply counts only what the civilization can work in its own land', () => {
  const biome = (name: string) => WORLD_BIOMES.indexOf(name as typeof WORLD_BIOMES[number]);
  const code = (name: string) => index(name) + 1;
  // Region 0 (its own): coal, stone and timber sites; region 1 (not its own): a copper site.
  const regions = [{ id: 0, cells: [0], sites: [[0, code('coal')], [0, code('stone')], [0, code('timber')]] }, { id: 1, cells: [1], sites: [[1, code('copper')]] }];
  const settlement = { status: 'alive', bonus: { mine: true, quarry: false } };
  const state = {
    geography: { cellAreaKm2: 1, biome: Uint8Array.from([biome('grassland'), biome('grassland')]) }, partition: { regions },
    regionSettlements: [[0], []], settlements: [settlement], groups: [{ region: 0, size: 1_000_000 }],
  } as unknown as SimulationState;
  const civ = (...names: string[]) => ({ kind: 'civ', groups: [0], knowledge: knowing(...names) }) as unknown as Polity;
  const of = (polity: Polity, name: string) => supplyOf(state, polity)[index(name)];
  assert.equal(of(civ('Bronze working'), 'copper'), 0, 'not its land');
  assert.equal(of(civ('Geology'), 'coal'), 0, 'known but not workable before Deep mining');
  assert.equal(of(civ('Deep mining'), 'coal'), 0, 'not usable until a tech that uses it is known');
  assert.equal(of(civ('Industrialization'), 'coal'), RESOURCE_TUNING.siteUnits, 'usable, and its mine works it');
  settlement.status = 'ruins';
  assert.equal(of(civ('Industrialization'), 'coal'), 0, 'a ruined settlement\'s mine works nothing');
  settlement.status = 'alive';
  assert.equal(of(civ('Masonry'), 'stone'), 0, 'no quarry');
  settlement.bonus.quarry = true;
  assert.equal(of(civ('Masonry'), 'stone'), RESOURCE_TUNING.siteUnits);
  assert.equal(of(civ('Iron working'), 'timber'), 0, 'not before Forestry');
  assert.equal(of(civ('Forestry'), 'timber'), RESOURCE_TUNING.siteUnits);
});

test('access is kept through learning and merging; a new people starts fully supplied', () => {
  const access = knowing('Bronze working').access.slice();
  access[index('tin')] = 0.4;
  const short = withAccess(knowing('Bronze working'), access);
  assert.equal(learn(short, TECH_INDEX.get('Wheel')!).access[index('tin')], 0.4);
  assert.equal(mergeKnowledge(short, knowing('Writing')).access[index('tin')], 0.4, 'the realm taking others in keeps its own');
  assert.ok(inheritKnowledge(short).access.every(value => value === 1), 'a daughter is assessed afresh');
});

test('land weighs by what it would make good now: workable sites, forest and rough land, at most the shortfall', () => {
  const biome = (name: string) => WORLD_BIOMES.indexOf(name as typeof WORLD_BIOMES[number]);
  const code = (name: string) => index(name) + 1;
  const regions = [{ id: 0, cells: [0, 1], sites: [] }, { id: 1, cells: [2], sites: [[2, code('stone')]] }];
  const state = {
    geography: { cellAreaKm2: 25_000, biome: Uint8Array.from([biome('forest'), biome('forest'), biome('grassland')]) }, partition: { regions },
  } as unknown as SimulationState;
  const civ = (names: string[], short: Record<string, number>) => {
    const supply = new Float64Array(RESOURCE_IDS.length), demand = new Float64Array(RESOURCE_IDS.length);
    for (const [name, shortfall] of Object.entries(short)) { demand[index(name)] = 2; supply[index(name)] = 2 * (1 - shortfall); }
    return { kind: 'civ', knowledge: knowing(...names), supply, demand } as unknown as Polity;
  };
  // Timber short by half: two forest cells (50,000 km²) give one unit of a demand of two, as much as it lacks.
  assert.equal(reliefThere(state, civ(['Boatbuilding'], { timber: 0.5 }), 0), 0.5);
  assert.ok(Math.abs(reliefThere(state, civ(['Boatbuilding'], { timber: 0.2 }), 0) - 0.2) < 1e-12, 'never more than the shortfall');
  assert.equal(reliefThere(state, civ(['Boatbuilding'], {}), 0), 0, 'nothing lacking');
  // A stone site is no relief until it knows how to build a quarry (Iron working).
  assert.equal(reliefThere(state, civ(['Masonry'], { stone: 1 }), 1), 0);
  assert.equal(reliefThere(state, civ(['Iron working'], { stone: 1 }), 1), RESOURCE_TUNING.siteUnits / 2);
  assert.equal(reliefThere(state, { ...civ(['Iron working'], { stone: 1 }), kind: 'band' } as Polity, 1), 0, 'tribes are not assessed');
});
