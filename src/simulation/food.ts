import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import type { RegionPartition } from './regions.ts';
import type { Knowledge } from './knowledge.ts';
import { FARM_TUNING, FOOD_TUNING, REGION_TUNING } from './tunables.ts';

/**
 * Food from the land (VISION.md "Production"). Each region has, per method, a labour capacity L (people) and a base
 * yield p (food per worker-year when labour is scarce). Output saturates with labour: p × L × (1 − e^(−w/L)).
 * Workers flow to the method with the best marginal yield, so all used methods share one marginal yield λ.
 */
export const METHODS = ['forage', 'hunt', 'fish', 'herd', 'farm'] as const;
export type Method = typeof METHODS[number];
export const METHOD_COUNT = METHODS.length;
const FORAGE = 0, HUNT = 1, FISH = 2, HERD = 3, FARM = 4;
export const HERD_METHOD = HERD, FARM_METHOD = FARM;

export interface FoodModel {
  /** labor[region × METHOD_COUNT + method] in people. */
  labor: Float64Array;
  /** Base yield per method (food per worker-year), before game and knowledge multipliers. */
  baseYield: Float64Array;
  /** Farming yield multiplier from great rivers, rivers and open lakes, per region. */
  farmWater: Float64Array;
  /** Harvest months (region × 12): 1 where the crops sown since the last harvest come in. */
  harvest: Float64Array;
  /** Months between harvests per region (12, or 6 with two harvests a year). */
  cycle: Uint8Array;
}

/** Labour capacity per region and method from its cells, water and usable food sites. */
export function buildFoodModel(geography: SimulationGeography, partition: RegionPartition): FoodModel {
  const tuning = FOOD_TUNING;
  const labor = new Float64Array(partition.regions.length * METHOD_COUNT);
  const near = new Int32Array(4);
  const edgeScale = Math.sqrt(geography.cellAreaKm2 / tuning.referenceCellKm2);
  const game = RESOURCE_IDS.indexOf('game') + 1, fish = RESOURCE_IDS.indexOf('fish') + 1, grain = RESOURCE_IDS.indexOf('grain') + 1;
  const farmWater = new Float64Array(partition.regions.length), harvestShare = new Float64Array(partition.regions.length * 12), cycle = new Uint8Array(partition.regions.length);
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
    let farm = 0, herd = 0;
    for (const cell of region.cells) {
      const biome = WORLD_BIOMES[geography.biome[cell]] as keyof typeof FARM_TUNING.farmDensity;
      farm += geography.cellAreaKm2 * (FARM_TUNING.farmDensity[biome] ?? 0) * (geography.fertility[cell] / 100) ** FARM_TUNING.fertilityExponent;
      herd += geography.cellAreaKm2 * (FARM_TUNING.herdDensity[biome] ?? 0);
    }
    // Grain sites add farmland once Agriculture makes them usable (farming needs Agriculture anyway).
    for (const [, code] of region.sites) if (code === grain) farm += FARM_TUNING.grainSiteLabor;
    const at = region.id * METHOD_COUNT;
    labor[at] = forage; labor[at + HUNT] = hunt; labor[at + FISH] = fishing; labor[at + HERD] = herd; labor[at + FARM] = farm;
    farmWater[region.id] = Math.max(FARM_TUNING.riverFarm[region.riverTier], region.openLake ? FARM_TUNING.lakeFarm : 1);
    // Harvest calendar by the region's latitude: one harvest a year outside the tropics, two inside.
    const latitude = geography.latitude[Math.floor(region.centroid / geography.width)] * 180 / Math.PI;
    const months = latitude > FARM_TUNING.tropicsLatitude ? FARM_TUNING.harvestNorth : latitude < -FARM_TUNING.tropicsLatitude ? FARM_TUNING.harvestSouth : FARM_TUNING.harvestTropics;
    for (const month of months) harvestShare[region.id * 12 + month - 1] = 1;
    cycle[region.id] = 12 / months.length;
  }
  const baseYield = Float64Array.from(METHODS, method => method === 'herd' || method === 'farm' ? FARM_TUNING.yield[method] : tuning.yield[method]);
  return { labor, baseYield, farmWater, harvest: harvestShare, cycle };
}

/** Farming potential of a region: its farming labour capacity times its water multiplier (VISION.md M2 acceptance). */
export function farmingPotential(model: FoodModel, region: number) {
  return model.labor[region * METHOD_COUNT + FARM] * model.farmWater[region];
}

/**
 * Effective yields in a region for a polity: game stock scales hunting (and foraging partly), known techs multiply
 * each method, and herding and farming yield nothing until a tech makes them available. Without `knowledge` only
 * the starting methods count (the observer's view of unclaimed land).
 */
export function regionYields(model: FoodModel, gameStock: number, into: Float64Array, region = -1, knowledge?: Knowledge) {
  for (let method = 0; method < METHOD_COUNT; method++) into[method] = model.baseYield[method];
  into[HUNT] *= gameStock;
  into[FORAGE] *= FOOD_TUNING.forageGameFloor + (1 - FOOD_TUNING.forageGameFloor) * gameStock;
  if (!knowledge) { into[HERD] = 0; into[FARM] = 0; return into; }
  const m = knowledge.multipliers;
  into[FORAGE] *= m.forageYield; into[HUNT] *= m.huntYield; into[FISH] *= m.fishYield;
  into[HERD] = knowledge.methods.herd ? into[HERD] * m.herdYield : 0;
  into[FARM] = knowledge.methods.farm ? into[FARM] * m.farmYield * (region >= 0 ? model.farmWater[region] : 1) : 0;
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
  // ln λ rather than λ: with far more people than labour capacity λ underflows to 0, while ln λ stays finite.
  let sumL = 0, sumLnP = 0, lnLambda = 0, used = 0;
  for (let k = 0; k < count; k++) {
    const method = ORDER[k], L = labor[offset + method];
    sumL += L; sumLnP += L * Math.log(yields[method]);
    lnLambda = (sumLnP - people) / sumL;
    used = k + 1;
    if (k + 1 >= count || lnLambda >= Math.log(yields[ORDER[k + 1]])) break;
  }
  const lambda = Math.exp(lnLambda);
  let output = 0;
  for (let k = 0; k < used; k++) {
    const method = ORDER[k], L = labor[offset + method];
    result[method] = L * (Math.log(yields[method]) - lnLambda);
    output += (yields[method] - lambda) * L;
  }
  return { output, marginal: lambda, workers: result };
}
const ORDER = new Int32Array(METHOD_COUNT);
const SCRATCH = new Float64Array(METHOD_COUNT), VALUED = new Float64Array(METHOD_COUNT);

/** Months from `month` (1–12) until the region's next harvest month; 0 when this month is a harvest. */
export function monthsToHarvest(model: FoodModel, region: number, month: number) {
  for (let ahead = 0; ahead < 12; ahead++) if (model.harvest[region * 12 + (month - 1 + ahead) % 12] > 0) return ahead;
  return 0;
}

/**
 * Work for a polity that farms (VISION.md harvest calendar). Crops sown now come in only at the harvest, so when the
 * store will not carry people there (a shortfall of `need − store ÷ months` a month), they value those crops below
 * their yield — down to `FARM_TUNING.sowingPatience` of it with an empty store — and workers flow to whichever method
 * then gives the most. Fields are given up only where other food really pays, graded with the shortfall. Fills
 * `workers` and returns the output rate at the true yields, crops counted as sown.
 */
export function sow(labor: Float64Array, offset: number, yields: Float64Array, people: number, need: number, store: number, months: number, workers: Float64Array) {
  const shortfall = months > 0 && need > 0 ? Math.min(1, Math.max(0, (need - store / months) / need)) : 0;
  if (shortfall <= 0) return harvest(labor, offset, yields, people, workers).output;
  VALUED.set(yields); VALUED[FARM] = yields[FARM] * (1 - shortfall * (1 - FARM_TUNING.sowingPatience));
  harvest(labor, offset, VALUED, people, workers);
  let output = 0;
  for (let method = 0; method < METHOD_COUNT; method++) {
    const L = labor[offset + method];
    if (workers[method] > 0 && L > 0) output += yields[method] * L * (1 - Math.exp(-workers[method] / L));
  }
  return output;
}

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
