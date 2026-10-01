import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import type { RegionPartition } from './regions.ts';
import { FOOD_TUNING, REGION_TUNING } from './tunables.ts';

/**
 * Food from the land (VISION.md "Production"). Each region has, per method, a labour capacity L (people) and a base
 * yield p (food per worker-year when labour is scarce). Output saturates with labour: p × L × (1 − e^(−w/L)).
 * Workers flow to the method with the best marginal yield, so all used methods share one marginal yield λ.
 */
export const METHODS = ['forage', 'hunt', 'fish', 'herd', 'farm'] as const;
export type Method = typeof METHODS[number];
export const METHOD_COUNT = METHODS.length;
const FORAGE = 0, HUNT = 1;

export interface FoodModel {
  /** labor[region × METHOD_COUNT + method] in people. */
  labor: Float64Array;
  /** Base yield per method (food per worker-year), before game and knowledge multipliers. */
  baseYield: Float64Array;
}

/** Labour capacity per region and method from its cells, water and usable food sites. */
export function buildFoodModel(geography: SimulationGeography, partition: RegionPartition): FoodModel {
  const tuning = FOOD_TUNING;
  const labor = new Float64Array(partition.regions.length * METHOD_COUNT);
  const near = new Int32Array(4);
  const edgeScale = Math.sqrt(geography.cellAreaKm2 / tuning.referenceCellKm2);
  const game = RESOURCE_IDS.indexOf('game') + 1, fish = RESOURCE_IDS.indexOf('fish') + 1;
  const tiers = REGION_TUNING.riverTierRunoff;
  const tierOf = (runoff: number) => runoff >= tiers.greatRiver ? 3 : runoff >= tiers.river ? 2 : runoff >= tiers.stream ? 1 : 0;
  for (const region of partition.regions) {
    let forage = 0, hunt = 0, fishing = 0;
    for (const cell of region.cells) {
      const biome = WORLD_BIOMES[geography.biome[cell]] as keyof typeof tuning.forageDensity;
      const fertility = geography.fertility[cell] / 100;
      forage += geography.cellAreaKm2 * (tuning.forageDensity[biome] ?? 0) * (tuning.forageFertilityFloor + (1 - tuning.forageFertilityFloor) * fertility);
      hunt += geography.cellAreaKm2 * (tuning.huntDensity[biome] ?? 0);
      let coast = false, lakeshore = false;
      for (const other of cellNeighbors(geography, cell, near)) {
        if (other < 0) continue;
        if (geography.marine[other]) coast = true;
        if (geography.lake[other]) lakeshore = true;
      }
      if (coast) fishing += tuning.fishCoastLabor * edgeScale;
      if (lakeshore) fishing += tuning.fishLakeLabor * edgeScale;
      fishing += tuning.fishRiverLabor[tierOf(geography.riverRunoff[cell])] * edgeScale;
    }
    if (region.coastal) fishing += tuning.fishRegionCoast;
    if (region.openLake) fishing += tuning.fishRegionLake;
    fishing += tuning.fishRegionRiver[region.riverTier];
    // Starting knowledge (Hunting, Fishing) makes game and fish sites usable from year 0.
    for (const [, code] of region.sites) {
      if (code === game) hunt += tuning.gameSiteLabor;
      if (code === fish) fishing += tuning.fishSiteLabor;
    }
    const at = region.id * METHOD_COUNT;
    labor[at] = forage; labor[at + 1] = hunt; labor[at + 2] = fishing;
  }
  const baseYield = Float64Array.from(METHODS, method => tuning.yield[method]);
  return { labor, baseYield };
}

/** Effective yields given a region's game stock; `into` receives METHOD_COUNT values. */
export function regionYields(model: FoodModel, gameStock: number, into: Float64Array) {
  for (let method = 0; method < METHOD_COUNT; method++) into[method] = model.baseYield[method];
  into[HUNT] *= gameStock;
  into[FORAGE] *= FOOD_TUNING.forageGameFloor + (1 - FOOD_TUNING.forageGameFloor) * gameStock;
  return into;
}

export interface Harvest { output: number; marginal: number; workers: Float64Array }

/**
 * Annual output of `people` workers spread over a region's methods. Water-filling: method i receives
 * L_i ln(p_i/λ) workers when p_i > λ, with λ chosen so they sum to `people`; output = Σ (p_i − λ) L_i over used methods.
 */
export function harvest(labor: Float64Array, offset: number, yields: Float64Array, people: number, workers?: Float64Array): Harvest {
  // Methods by descending yield (insertion sort over at most METHOD_COUNT entries, no allocation).
  let count = 0;
  for (let method = 0; method < METHOD_COUNT; method++) {
    if (!(yields[method] > 0 && labor[offset + method] > 0)) continue;
    let at = count++;
    while (at > 0 && yields[ORDER[at - 1]] < yields[method]) { ORDER[at] = ORDER[at - 1]; at--; }
    ORDER[at] = method;
  }
  const result = workers ?? new Float64Array(METHOD_COUNT);
  result.fill(0);
  if (!count || people <= 0) return { output: 0, marginal: count ? yields[ORDER[0]] : 0, workers: result };
  let sumL = 0, sumLnP = 0, lambda = 0, used = 0;
  for (let k = 0; k < count; k++) {
    const method = ORDER[k], L = labor[offset + method];
    sumL += L; sumLnP += L * Math.log(yields[method]);
    lambda = Math.exp((sumLnP - people) / sumL);
    used = k + 1;
    if (k + 1 >= count || lambda >= yields[ORDER[k + 1]]) break;
  }
  let output = 0;
  for (let k = 0; k < used; k++) {
    const method = ORDER[k], L = labor[offset + method];
    result[method] = L * Math.log(yields[method] / lambda);
    output += (yields[method] - lambda) * L;
  }
  return { output, marginal: lambda, workers: result };
}
const ORDER = new Int32Array(METHOD_COUNT);
const SCRATCH = new Float64Array(METHOD_COUNT);

/**
 * Carrying capacity: the population whose saturated output equals its own need (one food unit per person-year).
 * g(P) = F(P) − P is concave with g(0) = 0 and g'(0) > 0, so Newton from the right of the root converges
 * monotonically; a warm start from last month's value usually needs one or two steps.
 */
export function capacity(labor: Float64Array, offset: number, yields: Float64Array, guess = 0) {
  let ceiling = 0, best = 0;
  for (let method = 0; method < METHOD_COUNT; method++) {
    ceiling += yields[method] * labor[offset + method];
    if (labor[offset + method] > 0) best = Math.max(best, yields[method]);
  }
  if (best <= 1 || ceiling <= 0) return 0;
  let people = guess > 0 && guess < ceiling ? guess : ceiling;
  for (let step = 0; step < 60; step++) {
    const { output, marginal } = harvest(labor, offset, yields, people, SCRATCH);
    // Left of the output peak a Newton step would run away from the root: restart from the ceiling.
    const next = marginal >= 1 ? ceiling : people - (output - people) / (marginal - 1);
    const done = Math.abs(next - people) < Math.max(0.05, people * 1e-4);
    people = next;
    if (done) break;
  }
  return Math.max(0, people);
}

/** Annual change of game stock for a region under the given hunting and foraging workers. */
export function gameChange(model: FoodModel, region: number, gameStock: number, workers: Float64Array) {
  const tuning = FOOD_TUNING, at = region * METHOD_COUNT;
  const reach = model.labor[at + HUNT] + tuning.forageEffortShare * model.labor[at + FORAGE];
  const effort = reach > 0 ? (workers[HUNT] + tuning.forageEffortShare * workers[FORAGE]) / reach : 0;
  return tuning.gameRegrowth * gameStock * (1 - gameStock) + tuning.gameSeeding * (1 - gameStock) - tuning.gameHarvest * effort * gameStock;
}
