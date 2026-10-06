import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { FARM_METHOD, METHOD_COUNT } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import type { RegionPartition } from './regions.ts';
import type { FieldRanking, SimulationState } from './state.ts';
import { FARM_TUNING, FIELD_TUNING } from './tunables.ts';

/**
 * Cultivated land (VISION.md "Settlements and infrastructure": "Each region keeps a set of cultivated cells, chosen
 * from its best farmland nearest its settlements and sized by its farming population. It grows with farming and
 * shrinks after famine, devastation or collapse."). A region's fields are farm labour (people-equivalents) under
 * cultivation, at most its farmland's. They are cleared as its farmers need them and fall fallow when fewer work them;
 * land farmed before it is cleared yields less. Which cells they cover follows a fixed ranking of the region's
 * farmland.
 */

/** No rank: a cell that is no farmland (or ranks beyond what the contract carries). */
export const NO_FIELD = 0xffff;

/**
 * Each region's farmland ranked once: by a cell's farm labour (area × farm density × fertility^exponent, as the food
 * model counts it) × closeness to the region's best settlement site (1 ÷ (1 + cells away ÷ closeCells)).
 */
export function rankFarmland(geography: SimulationGeography, partition: RegionPartition): FieldRanking {
  const regions = partition.regions, start = new Int32Array(regions.length + 1), rank = new Uint16Array(geography.cells).fill(NO_FIELD);
  const order: number[] = [], cumulative: number[] = [];
  for (const region of regions) {
    start[region.id] = order.length;
    const home = region.settlementSites[0] ?? region.centroid, homeX = home % geography.width, homeY = Math.floor(home / geography.width);
    const cells: { cell: number; labour: number; score: number }[] = [];
    for (const cell of region.cells) {
      const labour = cellLabour(geography, cell);
      if (!(labour > 0)) continue;
      const dx = Math.abs(cell % geography.width - homeX), away = Math.hypot(Math.min(dx, geography.width - dx), Math.floor(cell / geography.width) - homeY);
      cells.push({ cell, labour, score: labour / (1 + away / FIELD_TUNING.closeCells) });
    }
    cells.sort((a, b) => b.score - a.score || a.cell - b.cell);
    let total = 0;
    cells.forEach((entry, at) => {
      total += entry.labour;
      order.push(entry.cell); cumulative.push(total);
      if (at < NO_FIELD) rank[entry.cell] = at;
    });
  }
  start[regions.length] = order.length;
  return { order: Int32Array.from(order), start, cumulative: Float64Array.from(cumulative), rank };
}

/** A cell's farm labour (people), as the food model counts its farmland. */
function cellLabour(geography: SimulationGeography, cell: number) {
  const biome = WORLD_BIOMES[geography.biome[cell]] as keyof typeof FARM_TUNING.farmDensity;
  return geography.cellAreaKm2 * (FARM_TUNING.farmDensity[biome] ?? 0) * (geography.fertility[cell] / 100) ** FARM_TUNING.fertilityExponent;
}

/**
 * Production system, for a group's region each month: the fields its `farmers` would work (fieldFactor each, at most
 * the region's farmland) are the target; fields below it are cleared at clearRate × target a year, fields above it
 * fall fallow by fallowRate of the gap a year. Returns the share of the month's farm output the fields allow: all of
 * it once cleared, else uncleared + (1 − uncleared) × fields ÷ target.
 */
export function tendFields(state: SimulationState, region: number, farmers: number) {
  const tuning = FIELD_TUNING, land = state.food.labor[region * METHOD_COUNT + FARM_METHOD];
  const target = Math.min(land, tuning.fieldFactor * farmers), fields = state.fields[region];
  if (fields < target) state.fields[region] = Math.min(target, fields + tuning.clearRate / 12 * target);
  else if (fields > target) fallow(state, region, target);
  const now = state.fields[region];
  return now >= target || target <= 0 ? 1 : tuning.uncleared + (1 - tuning.uncleared) * now / target;
}

/** Fields fall fallow toward `target` (none where nobody farms); a remnant under one person's work is gone. */
export function fallow(state: SimulationState, region: number, target = 0) {
  const left = state.fields[region] - FIELD_TUNING.fallowRate / 12 * (state.fields[region] - target);
  state.fields[region] = left < 1 && target <= 0 ? 0 : left;
}

/** How many of a region's ranked farmland cells its fields cover (those whose cumulative labour they reach). */
export function cultivatedCells(ranking: FieldRanking, region: number, fields: number) {
  let low = ranking.start[region], high = ranking.start[region + 1];
  const first = low;
  while (low < high) { const middle = (low + high) >> 1; if (ranking.cumulative[middle] <= fields) low = middle + 1; else high = middle; }
  return low - first;
}

/**
 * VISION.md M3b: "at least one civ's cultivated land shrinks within 10 years after a recorded famine and later
 * regrows". Each famine of a civilization is watched yearly: the fields of the regions it struck, against what they
 * were then. Shrunk: within `shrinkYears` they fall below (1 − shrinkMargin) of that; regrown: later they are back to
 * it or more. Watches end when regrown, or after `watchYears`.
 */
export function watchFamine(state: SimulationState, polity: number, regions: number[]) {
  let fields = 0;
  for (const region of regions) fields += state.fields[region];
  state.famineWatches.push({ polity, regions, tick: state.tick, before: fields, shrunk: -1 });
  state.metrics.faminesWatched++;
}

/** Yearly: each watched famine's fields now; shrinking and regrowth are counted once each. */
export function checkFamineWatches(state: SimulationState) {
  const tuning = FIELD_TUNING;
  state.famineWatches = state.famineWatches.filter(watch => {
    let fields = 0;
    for (const region of watch.regions) fields += state.fields[region];
    const years = (state.tick - watch.tick) / 12;
    if (watch.shrunk < 0 && years <= tuning.shrinkYears && fields < (1 - tuning.shrinkMargin) * watch.before) { watch.shrunk = state.tick; state.metrics.fieldsShrank++; }
    if (watch.shrunk >= 0 && fields >= watch.before) { state.metrics.fieldsRegrew++; return false; }
    return years < (watch.shrunk < 0 ? tuning.shrinkYears : tuning.watchYears);
  });
}
