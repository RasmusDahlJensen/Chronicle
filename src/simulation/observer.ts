import type { ObserverFrame } from '../../shared/simulation.ts';
import { capacity, harvest, METHOD_COUNT, regionYields } from './food.ts';
import { cultivatedCells, fieldLand } from './fields.ts';
import { speedOf } from './knowledge.ts';
import { BUILDINGS } from './buildings.ts';
import { WONDERS } from './wonders.ts';
import { realmAccount, settlementAccount } from './budget.ts';
import { regionFarm, wonderBonus } from './economy.ts';
import { researchRate, teacherOf } from './research.ts';
import { polityPopulation } from './bands.ts';
import { capitalKm, knownRegionCount } from './perception.ts';
import { stabilityOf } from './stability.ts';
import type { Polity, SimulationState } from './state.ts';
import { TECHS } from './techs.ts';
import { FOOD_TUNING, REACH_TUNING } from './tunables.ts';

type View = Pick<ObserverFrame, 'population' | 'polities' | 'civs' | 'settlementCount' | 'specialists' | 'leadingEra' | 'lineages' | 'largest' | 'civList' | 'markers' | 'settlements' | 'roads' | 'fields' | 'wonders' | 'series' | 'inspect'>;

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
  const civList = sizes.filter(({ id }) => state.polities[id].kind === 'civ').slice(0, 100).map(({ id, people }) => {
    const polity = state.polities[id], capital = state.settlements[polity.capital!];
    return { id, name: polity.name, regions: polity.groups.length, population: people, era: polity.knowledge.era, capital: capital.name, capitalCell: capital.cell };
  });
  const settlements = { ids: [] as number[], cells: [] as number[], owners: [] as number[], capitals: [] as number[], tiers: [] as number[], names: [] as string[], features: [] as number[] };
  for (const settlement of state.settlements) {
    if (settlement.status !== 'alive') continue;
    settlements.ids.push(settlement.id); settlements.cells.push(settlement.cell); settlements.owners.push(settlement.owner); settlements.capitals.push(settlement.capital ? 1 : 0);
    // Names only for the places a map labels: towns and larger, and capitals.
    settlements.tiers.push(settlement.tier); settlements.names.push(settlement.tier > 0 || settlement.capital ? settlement.name : '');
    settlements.features.push((settlement.bonus.harbor ? 1 : 0) | (settlement.bonus.mine ? 2 : 0) | (settlement.bonus.quarry ? 4 : 0) | (settlement.wonder !== null ? 8 : 0));
  }
  const roads = { a: [] as number[], b: [] as number[], tiers: [] as number[], bridges: [] as number[] };
  for (const road of state.roads.values()) { roads.a.push(road.a); roads.b.push(road.b); roads.tiers.push(road.tier); roads.bridges.push(road.bridge ? 1 : 0); }
  const fields = { regions: [] as number[], cells: [] as number[] };
  for (let region = 0; region < state.fields.length; region++) {
    if (!(state.fields[region] > 0)) continue;
    const cells = Math.min(0xffff, cultivatedCells(state.fieldRanking, region, state.fields[region]));
    if (cells > 0) { fields.regions.push(region); fields.cells.push(cells); }
  }
  // At most 500 chart points: thin evenly once a long history exceeds that.
  const step = Math.max(1, Math.ceil(state.series.length / 500));
  const series = state.series.filter((_, at) => at % step === 0 || at === state.series.length - 1);
  return {
    population, polities: state.living.length, civs, settlementCount: settlements.ids.length, specialists, leadingEra, lineages: state.lineages, largest, civList,
    markers: { ids, regions, populations, kinds, eras, lineages }, settlements, roads, fields, series,
    wonders: state.wonders.filter(wonder => wonder.status === 'building' || wonder.status === 'standing').slice(0, 32).map(wonder => {
      const settlement = state.settlements[wonder.settlement];
      return { name: WONDERS[wonder.type].name, city: settlement.name, civ: state.polities[settlement.owner].name, begun: Math.floor(wonder.begunTick / 12), built: wonder.builtTick === null ? null : Math.floor(wonder.builtTick / 12) };
    }), inspect: inspect === null ? null : inspectRegion(state, inspect),
  };
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function inspectRegion(state: SimulationState, region: number): ObserverFrame['inspect'] {
  if (!Number.isInteger(region) || region < 0 || region >= state.partition.regions.length) return null;
  const occupant = state.occupant[region];
  const polity = occupant >= 0 ? state.polities[occupant] : null, group = state.groupAt[region] >= 0 ? state.groups[state.groupAt[region]] : null;
  // The land as its occupant would work it (unclaimed land: the starting methods only).
  const yields = regionYields(state.food, state.gameStock[region], new Float64Array(METHOD_COUNT), region, polity?.knowledge, regionFarm(state, region));
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
    const knowledge = polity.knowledge, target = knowledge.target, teacher = target < 0 ? -1 : teacherOf(state, polity, target);
    const speed = target < 0 ? null : speedOf(target, { shared: () => teacher >= 0, frontier: polity.frontierEra, openness: state.cultures[polity.culture].values.openness });
    const capital = polity.capital === null ? null : state.settlements[polity.capital];
    const kmFromCapital = capitalKm(state, polity, region);
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
      reachKm: Math.round(REACH_TUNING.baseKm * knowledge.multipliers.reach), capitalKm: Math.round(kmFromCapital),
      lastDecision: lastDecision(polity),
      stability: polity.kind !== 'civ' ? null : (() => {
        const now = stabilityOf(state, polity, group, kmFromCapital ?? Number.POSITIVE_INFINITY);
        return { value: round(state.stability[region]), unrest: state.unrest[region] === 1, hunger: round(now.hunger), overextension: round(now.overextension), foreignRule: round(now.foreignRule), strain: round(now.strain), taxes: round(now.taxes), arrears: round(now.arrears) };
      })(),
      regionsKnown: knownRegionCount(polity), regionsInSight: polity.map.observed.length, met: [...polity.met.keys()].filter(other => state.polities[other].deathTick === null).length,
      wealth: polity.kind !== 'civ' ? null : (() => {
        const account = realmAccount(state, polity), whole = (value: number) => Math.round(value);
        return {
          treasury: polity.wealth, taxRate: round(polity.taxRate),
          revenue: { trades: whole(account.revenue.trades), farms: whole(account.revenue.farms), sites: whole(account.revenue.sites) },
          costs: { administration: whole(account.costs.administration), services: whole(account.costs.services), upkeep: whole(account.costs.upkeep), roads: whole(account.costs.roads) },
          arrears: round(polity.arrears), projects: polity.projects.length, roadWorks: polity.roadWorks.length,
        };
      })(),
      exchanges: [...polity.exchanges].filter(([other, until]) => until > state.tick && state.polities[other].deathTick === null).slice(0, 64)
        .map(([other, until]) => ({ id: other, name: state.polities[other].name, until: Math.floor(until / 12) })),
      research: target < 0 || !speed ? null : {
        tech: TECHS[target].name, progress: round(knowledge.progress[target], 1), cost: TECHS[target].cost,
        sharedBy: teacher >= 0 ? state.polities[teacher].name : null, shareSpeed: round(speed.share, 2), catchUp: round(speed.catchUp, 2),
        reasons: knowledge.reasons.slice(0, 8), candidates: knowledge.candidates.slice(0, 8).map(entry => ({ tech: TECHS[entry.tech].name, weight: Math.max(0, entry.weight) })),
      },
    };
  }
  // The settlement inspector: the region's settlements, main one first, with their latest events.
  const events = state.chronicle.events, shown = state.regionSettlements[region].map(id => state.settlements[id]).sort((a, b) => Number(b.status === 'alive') - Number(a.status === 'alive')).slice(0, 16);
  // One pass back through the chronicle collects each one's latest six events.
  const histories = new Map(shown.map(settlement => [settlement.id, [] as typeof events]));
  let wanting = shown.length;
  // Nothing about these settlements happened before the oldest was founded.
  const since = Math.min(...shown.map(settlement => settlement.foundedTick));
  for (let at = events.length - 1; at >= 0 && wanting > 0 && events[at].tick >= since; at--) {
    const history = events[at].settlement === null ? undefined : histories.get(events[at].settlement!);
    if (!history || history.length >= 6) continue;
    history.push(events[at]);
    if (history.length === 6) wanting--;
  }
  // Accounts are kept by the civilization that rules the region.
  const ruler = state.owner[region] >= 0 ? state.polities[state.owner[region]] : null, wonder = ruler ? wonderBonus(state, ruler).wealth : 1;
  const settlementViews = shown.map(settlement => {
    const history = histories.get(settlement.id)!;
    return {
      id: settlement.id, name: settlement.name, tier: settlement.tier, urban: settlement.urban, housing: settlement.housing, capital: settlement.capital,
      founded: settlement.foundedTick, status: settlement.status, formerName: settlement.formerName,
      owner: settlement.status === 'alive' ? state.polities[settlement.owner].name : null, events: history,
      buildings: settlement.buildings.map(building => ({ name: BUILDINGS[building.type].name, condition: round(building.condition) })),
      building: settlement.status === 'alive' ? state.polities[settlement.owner].projects.filter(project => project.settlement === settlement.id)
        .map(project => ({ name: BUILDINGS[project.type].name, progress: round(project.spent / project.cost) })) : [],
      wonder: (() => {
        const wonder = state.wonders.find(entry => entry.settlement === settlement.id && (entry.status === 'standing' || entry.status === 'building'));
        return wonder ? { name: WONDERS[wonder.type].name, standing: wonder.status === 'standing', progress: round(wonder.spent / wonder.cost) } : null;
      })(),
      account: ruler && settlement.status === 'alive' && settlement.owner === ruler.id ? (() => {
        const account = settlementAccount(state, ruler, settlement.id, wonder), whole = Math.round;
        return {
          seat: account.seat, trades: whole(account.trades), farms: whole(account.farms), sites: whole(account.sites),
          administration: whole(account.administration), services: whole(account.services), upkeep: whole(account.upkeep),
        };
      })() : null,
    };
  });
  return {
    region, capacity: Math.round(people), gameStock: round(state.gameStock[region]), settlements: settlementViews,
    weather: { harvest: round(state.harvestFactor[region]), drought: state.drought[region], famine: state.famine[region] === 1, irrigation: round(regionFarm(state, region)), relief: state.reliefTick[region] >= 0 && state.tick - state.reliefTick[region] <= 1 },
    fields: (() => {
      const land = fieldLand(state.fieldRanking, region);
      return { share: land > 0 ? round(Math.min(1, state.fields[region] / land)) : 0, cells: cultivatedCells(state.fieldRanking, region, state.fields[region]) };
    })(),
    food: { forage: output(0), hunt: output(1), fish: output(2), herd: output(3), farm: output(4) },
    polity: view,
  };
}

/** The polity's last decision step for the inspector: each option's strongest factors (by size), best option first. */
function lastDecision(polity: Polity): NonNullable<NonNullable<ObserverFrame['inspect']>['polity']>['lastDecision'] {
  const step = polity.decisions.at(-1);
  if (!step) return null;
  return {
    tick: step.tick, chosen: step.chosen, pick: step.pick, outcome: step.outcome.slice(0, 80),
    options: step.options.slice(0, 4).map(option => ({
      action: option.action, score: option.score, target: option.target, label: option.label,
      factors: option.factors.filter(entry => entry.weight !== 0).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8),
    })),
  };
}
