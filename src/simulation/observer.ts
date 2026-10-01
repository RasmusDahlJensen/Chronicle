import type { ObserverFrame } from '../../shared/simulation.ts';
import { capacity, harvest, METHOD_COUNT, regionYields } from './food.ts';
import type { SimulationState } from './state.ts';
import { FOOD_TUNING } from './tunables.ts';

/**
 * What an observer may see of the true world (VISION.md "Observer views": the god view). Built on request from the
 * state; it never changes the simulation.
 */
export function observerView(state: SimulationState, inspect: number | null): Pick<ObserverFrame, 'population' | 'polities' | 'bands' | 'series' | 'inspect'> {
  const ids: number[] = [], regions: number[] = [], populations: number[] = [];
  let population = 0;
  for (const id of state.bands) {
    const band = state.polities[id], size = state.groups[band.group].size;
    ids.push(id); regions.push(band.region); populations.push(size); population += size;
  }
  // At most 500 chart points: thin evenly once a long history exceeds that.
  const step = Math.max(1, Math.ceil(state.series.length / 500));
  const series = state.series.filter((_, at) => at % step === 0 || at === state.series.length - 1);
  return { population, polities: state.bands.length, bands: { ids, regions, populations }, series, inspect: inspect === null ? null : inspectRegion(state, inspect) };
}

function inspectRegion(state: SimulationState, region: number): ObserverFrame['inspect'] {
  if (!Number.isInteger(region) || region < 0 || region >= state.partition.regions.length) return null;
  const yields = regionYields(state.food, state.gameStock[region], new Float64Array(METHOD_COUNT));
  const at = region * METHOD_COUNT, labor = state.food.labor;
  // A fresh solve at the current game stock: the simulation's cached value is only kept up to date where people live,
  // and the observer must never write simulation state.
  const people = capacity(labor, at, yields);
  // Output per method if the region were worked at its capacity, so the observer sees what feeds it.
  const workers = new Float64Array(METHOD_COUNT);
  harvest(labor, at, yields, people, workers);
  const output = (method: number) => Math.round(Math.max(0, yields[method] * labor[at + method] * (1 - Math.exp(-workers[method] / Math.max(labor[at + method], 1e-9)))));
  const occupant = state.occupant[region];
  const band = occupant >= 0 ? state.polities[occupant] : null, group = band ? state.groups[band.group] : null;
  return {
    region, capacity: Math.round(people), gameStock: Math.round(state.gameStock[region] * 1000) / 1000,
    food: { forage: output(0), hunt: output(1), fish: output(2) },
    band: band && group ? {
      id: band.id, name: band.name, culture: state.cultures[band.culture].name, population: group.size,
      birthsThisYear: group.birthsYear, deathsThisYear: group.deathsYear, birthsLastYear: group.lastBirths, deathsLastYear: group.lastDeaths,
      foodSecurity: Math.round(group.foodSecurity * 1000) / 1000,
      foodStoreMonths: group.size > 0 ? Math.round(group.store / (group.size * FOOD_TUNING.unitsPerPersonMonth) * 100) / 100 : 0,
      founded: band.foundedTick, arrived: band.arrivedTick,
    } : null,
  };
}
