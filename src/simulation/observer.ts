import type { ObserverFrame } from '../../shared/simulation.ts';
import { capacity, harvest, METHOD_COUNT, regionYields } from './food.ts';
import { remaining } from './knowledge.ts';
import { exposureOf, researchRate } from './research.ts';
import { polityPopulation } from './bands.ts';
import { knownRegionCount } from './perception.ts';
import type { SimulationState } from './state.ts';
import { TECHS } from './techs.ts';
import { FOOD_TUNING } from './tunables.ts';

type View = Pick<ObserverFrame, 'population' | 'polities' | 'civs' | 'settlementCount' | 'specialists' | 'leadingEra' | 'lineages' | 'largest' | 'markers' | 'settlements' | 'series' | 'inspect'>;

/**
 * What an observer may see of the true world (VISION.md "Observer views": the god view). Built on request from the
 * state; it never changes the simulation.
 */
export function observerView(state: SimulationState, inspect: number | null): View {
  const ids: number[] = [], regions: number[] = [], populations: number[] = [], kinds: number[] = [], eras: number[] = [], lineages: number[] = [];
  let population = 0, civs = 0, specialists = 0, leadingEra = 0;
  const sizes: { id: number; people: number }[] = [];
  for (const id of state.living) {
    const polity = state.polities[id];
    let people = 0;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      ids.push(id); regions.push(group.region); populations.push(group.size); kinds.push(polity.kind === 'civ' ? 1 : 0); eras.push(polity.knowledge.era); lineages.push(polity.lineage);
      people += group.size; specialists += group.specialists;
    }
    population += people; leadingEra = Math.max(leadingEra, polity.knowledge.era); sizes.push({ id, people });
    if (polity.kind === 'civ') civs++;
  }
  const largest = sizes.sort((a, b) => b.people - a.people || a.id - b.id).slice(0, 10).map(({ id, people }) => {
    const polity = state.polities[id];
    return { id, name: polity.name, kind: polity.kind, regions: polity.groups.length, population: people };
  });
  const settlements = { ids: [] as number[], cells: [] as number[], owners: [] as number[], capitals: [] as number[] };
  for (const settlement of state.settlements) {
    if (settlement.status !== 'alive') continue;
    settlements.ids.push(settlement.id); settlements.cells.push(settlement.cell); settlements.owners.push(settlement.owner); settlements.capitals.push(settlement.capital ? 1 : 0);
  }
  // At most 500 chart points: thin evenly once a long history exceeds that.
  const step = Math.max(1, Math.ceil(state.series.length / 500));
  const series = state.series.filter((_, at) => at % step === 0 || at === state.series.length - 1);
  return {
    population, polities: state.living.length, civs, settlementCount: settlements.ids.length, specialists, leadingEra, lineages: state.lineages, largest,
    markers: { ids, regions, populations, kinds, eras, lineages }, settlements, series, inspect: inspect === null ? null : inspectRegion(state, inspect),
  };
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function inspectRegion(state: SimulationState, region: number): ObserverFrame['inspect'] {
  if (!Number.isInteger(region) || region < 0 || region >= state.partition.regions.length) return null;
  const occupant = state.occupant[region];
  const polity = occupant >= 0 ? state.polities[occupant] : null, group = state.groupAt[region] >= 0 ? state.groups[state.groupAt[region]] : null;
  // The land as its occupant would work it (unclaimed land: the starting methods only).
  const yields = regionYields(state.food, state.gameStock[region], new Float64Array(METHOD_COUNT), region, polity?.knowledge);
  const at = region * METHOD_COUNT, labor = state.food.labor;
  // A fresh solve at the current game stock: the simulation's cached value is only kept up to date where people live,
  // and the observer must never write simulation state.
  const people = capacity(labor, at, yields);
  // Output per method if the region were worked at its capacity, so the observer sees what feeds it.
  const workers = new Float64Array(METHOD_COUNT);
  harvest(labor, at, yields, people, workers);
  const output = (method: number) => Math.round(Math.max(0, yields[method] * labor[at + method] * (1 - Math.exp(-workers[method] / Math.max(labor[at + method], 1e-9)))));
  let view: NonNullable<ObserverFrame['inspect']>['polity'] = null;
  if (polity && group) {
    const knowledge = polity.knowledge, target = knowledge.target, exposure = target < 0 ? 0 : exposureOf(state, polity, target);
    const capital = polity.capital === null ? null : state.settlements[polity.capital];
    view = {
      id: polity.id, kind: polity.kind, name: polity.name, culture: state.cultures[polity.culture].name, lineage: state.lineages[polity.lineage] ?? '',
      regions: polity.groups.length, totalPopulation: polityPopulation(state, polity), population: group.size,
      birthsThisYear: group.birthsYear, deathsThisYear: group.deathsYear, birthsLastYear: group.lastBirths, deathsLastYear: group.lastDeaths,
      foodSecurity: round(group.foodSecurity), foodStoreMonths: group.size > 0 ? round(group.store / (group.size * FOOD_TUNING.unitsPerPersonMonth), 2) : 0,
      cropsMonths: group.size > 0 ? round(group.planted / (group.size * FOOD_TUNING.unitsPerPersonMonth), 2) : 0,
      founded: polity.foundedTick, arrived: group.arrivedTick, farmShare: round(Math.min(1, Math.max(0, group.farmShare))), specialists: group.specialists,
      capital: capital ? { name: capital.name, cell: capital.cell, settled: polity.settledTick ?? capital.foundedTick } : null,
      era: knowledge.era, known: TECHS.filter((_, tech) => knowledge.known[tech]).map(definition => definition.name),
      researchPerYear: round(researchRate(state, polity), 2), contacts: polity.contacts.length,
      regionsKnown: knownRegionCount(polity), regionsInSight: polity.map.observed.length, met: [...polity.met.keys()].filter(other => state.polities[other].deathTick === null).length,
      research: target < 0 ? null : {
        tech: TECHS[target].name, progress: round(knowledge.progress[target], 1), exposure: round(exposure),
        cost: round(knowledge.progress[target] + Math.max(0, remaining(knowledge, exposure)), 1),
        reasons: knowledge.reasons.slice(0, 8), candidates: knowledge.candidates.slice(0, 8).map(entry => ({ tech: TECHS[entry.tech].name, weight: Math.max(0, entry.weight) })),
      },
    };
  }
  return {
    region, capacity: Math.round(people), gameStock: round(state.gameStock[region]),
    food: { forage: output(0), hunt: output(1), fish: output(2), herd: output(3), farm: output(4) },
    polity: view,
  };
}
