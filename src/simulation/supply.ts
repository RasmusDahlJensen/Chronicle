import { RESOURCE_IDS, type Resource } from '../../shared/atlas.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { RESOURCE_RULES } from '../world/resources.ts';
import { BUILDING_INDEX, buildingKnown } from './buildings.ts';
import { depositState } from './deposits.ts';
import type { SimulationGeography } from './geography.ts';
import { withAccess } from './knowledge.ts';
import type { RegionPartition } from './regions.ts';
import type { Polity, SimulationState, TickContext } from './state.ts';
import { TECH_INDEX, TECH_NEEDS, TECHS } from './techs.ts';
import { RESOURCE_TUNING } from './tunables.ts';

/**
 * Resource supply and demand (VISION.md "Supply and demand"; M5.3), yearly per civilization in the diplomacy and trade
 * system. Demand comes only from the techs it knows: each resource a known tech needs is demanded at its people ÷
 * `peoplePerSite` units a year. Supply is what it works in its own land: a unit for each usable mineral site a mine
 * works (a quarry for stone), each timber site once it knows Forestry, and forested and rough land by area. How fully
 * each is supplied (within [floor, 1]) scales the multipliers of the techs that need it (`knowledge.ts`): a shortfall
 * weakens, never blocks. Imports join the supply with trade (M5.4).
 */

export const RESOURCE_COUNT = RESOURCE_IDS.length;
const TIMBER = RESOURCE_IDS.indexOf('timber'), STONE = RESOURCE_IDS.indexOf('stone');
const FOREST = new Set(['forest', 'boreal', 'rainforest']), ROUGH = new Set(['mountain', 'snow']);

/** Per region: its forested and its rough or mountainous land, km² (static; cached per world). */
const land = new WeakMap<SimulationGeography, { forest: Float64Array; rough: Float64Array }>();
export function landStock(geography: SimulationGeography, partition: RegionPartition) {
  let stock = land.get(geography);
  if (stock) return stock;
  const forest = new Float64Array(partition.regions.length), rough = new Float64Array(partition.regions.length);
  for (const region of partition.regions) for (const cell of region.cells) {
    const biome = WORLD_BIOMES[geography.biome[cell]];
    if (FOREST.has(biome)) forest[region.id] += geography.cellAreaKm2;
    else if (ROUGH.has(biome)) rough[region.id] += geography.cellAreaKm2;
  }
  stock = { forest, rough };
  land.set(geography, stock);
  return stock;
}

/** Which resources its known techs need (by index). */
export function demanded(polity: Polity) {
  const wanted = new Uint8Array(RESOURCE_COUNT), known = polity.knowledge.known;
  for (let tech = 0; tech < TECHS.length; tech++) if (known[tech]) for (const resource of TECH_NEEDS[tech]) wanted[resource] = 1;
  return wanted;
}

const FORESTRY = TECH_INDEX.get('Forestry')!;

/** What a civilization works in its own land, units a year per resource (by index). */
export function supplyOf(state: SimulationState, civ: Polity) {
  const supply = new Float64Array(RESOURCE_COUNT), stock = landStock(state.geography, state.partition), tuning = RESOURCE_TUNING;
  for (const groupId of civ.groups) {
    const region = state.groups[groupId].region;
    supply[TIMBER] += stock.forest[region] / tuning.forestKm2;
    supply[STONE] += stock.rough[region] / tuning.roughKm2;
    let mine = false, quarry = false;
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status === 'alive') { mine ||= settlement.bonus.mine; quarry ||= settlement.bonus.quarry; }
    }
    for (const [, code] of state.partition.regions[region].sites) {
      const resource = RESOURCE_IDS[code - 1] as Resource | undefined;
      if (!resource || depositState(civ.knowledge, resource) !== 'usable') continue;
      const worked = resource === 'stone' ? quarry : resource === 'timber' ? civ.knowledge.known[FORESTRY] === 1 : RESOURCE_RULES[resource].kind === 'mineral' ? mine : false;
      if (worked) supply[code - 1] += tuning.siteUnits;
    }
  }
  return supply;
}

/** How fully a demand is met (within [floor, 1]; 1 when nothing is demanded), and the shortfall (0–1, unfloored). */
export const accessOf = (supply: number, demand: number) => demand > 0 ? Math.max(RESOURCE_TUNING.floor, Math.min(1, supply / demand)) : 1;
export const shortfallOf = (supply: number, demand: number) => demand > 0 ? Math.max(0, Math.min(1, 1 - supply / demand)) : 0;

/** What a civilization has of a resource this year: what it works (imports join with trade, M5.4). Everything that
 *  measures a shortfall reads this. */
export const available = (polity: Polity, resource: number) => polity.supply[resource];
/** A civilization's shortfall of a resource (0–1). */
export const shortfallFor = (polity: Polity, resource: number) => shortfallOf(available(polity, resource), polity.demand[resource]);
/** How much of its demand is met (0–1; 1 when nothing is demanded). */
export const metFor = (polity: Polity, resource: number) => polity.demand[resource] > 0 ? Math.min(1, available(polity, resource) / polity.demand[resource]) : 1;

const MINE = BUILDING_INDEX.get('mine')!, QUARRY = BUILDING_INDEX.get('quarry')!;

/**
 * How much of what a civilization lacks a region would make good if it held it (0–1): for each resource it is short
 * of, what it could work there now (sites whose deposits it can use and whose mine or quarry it knows how to build, or
 * Forestry for timber, and forest or rough land by area) against its demand, at most its shortfall; the largest.
 * Only sites whose deposits it knows of count (VISION.md "Implementation rule": a region on its map).
 */
export function reliefThere(state: SimulationState, polity: Polity, region: number) {
  if (polity.kind !== 'civ') return 0;
  const stock = landStock(state.geography, state.partition), tuning = RESOURCE_TUNING, knowledge = polity.knowledge;
  const potential = new Float64Array(RESOURCE_COUNT);
  potential[TIMBER] += stock.forest[region] / tuning.forestKm2;
  potential[STONE] += stock.rough[region] / tuning.roughKm2;
  for (const [, code] of state.partition.regions[region].sites) {
    const resource = RESOURCE_IDS[code - 1] as Resource | undefined;
    if (!resource || depositState(knowledge, resource) !== 'usable') continue;
    const workable = resource === 'stone' ? buildingKnown(knowledge, QUARRY) : resource === 'timber' ? knowledge.known[FORESTRY] === 1 : RESOURCE_RULES[resource].kind === 'mineral' && buildingKnown(knowledge, MINE);
    if (workable) potential[code - 1] += tuning.siteUnits;
  }
  let relief = 0;
  for (let resource = 0; resource < RESOURCE_COUNT; resource++) {
    const short = shortfallFor(polity, resource);
    if (short > 0 && potential[resource] > 0) relief = Math.max(relief, Math.min(short, potential[resource] / polity.demand[resource]));
  }
  return relief;
}

/** A civilization's supply and demand this year, kept on it, and its knowledge's access set from them. */
export function assess(state: SimulationState, civ: Polity) {
  const supply = supplyOf(state, civ), wanted = demanded(civ), demand = new Float64Array(RESOURCE_COUNT), access = new Float64Array(RESOURCE_COUNT);
  let people = 0;
  for (const groupId of civ.groups) people += state.groups[groupId].size;
  for (let resource = 0; resource < RESOURCE_COUNT; resource++) {
    demand[resource] = wanted[resource] ? people / RESOURCE_TUNING.peoplePerSite : 0;
    access[resource] = accessOf(supply[resource], demand[resource]);
  }
  civ.supply = supply; civ.demand = demand;
  // Only a change of access re-derives the knowledge (its multipliers).
  if (access.some((value, at) => value !== civ.knowledge.access[at])) civ.knowledge = withAccess(civ.knowledge, access);
}

/** Diplomacy and trade system, M5.3's part: each civilization's resources once a year, staggered by id. */
export function resourcesYear(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.kind === 'civ' && ((context.tick - id) % 12 + 12) % 12 === 0) assess(state, polity);
  }
}
