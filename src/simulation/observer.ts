import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { CHRONICLE_SCAN, MAX_CHRONICLE_PAGE, MAX_FRAME_NAMES, MAX_FRAME_RUINS, MAX_FRAME_WARS, type ChronicleEvent, type ChronicleQuery, type ObserverFrame, MAX_FRAME_DEVASTATED } from '../../shared/simulation.ts';
import { capacity, harvest, METHOD_COUNT, regionYields } from './food.ts';
import { cultivatedCells, fieldLand } from './fields.ts';
import { speedOf } from './knowledge.ts';
import { BUILDINGS } from './buildings.ts';
import { WONDERS } from './wonders.ts';
import { realmAccount, settlementAccount } from './budget.ts';
import { soldiersOf, soldierUpkeep, strengthOf } from './soldiers.ts';
import { regionFarm, wonderBonus } from './economy.ts';
import { researchRate, teacherOf } from './research.ts';
import { polityPopulation } from './bands.ts';
import { believe, capitalKm, KNOWN, knownRegionCount } from './perception.ts';
import { truthOf } from './relations.ts';
import { keeperOf, roadUnkept } from './roads.ts';
import { available, metFor } from './supply.ts';
import { stabilityOf } from './stability.ts';
import { storiesView } from './stories.ts';
import { NEED_NAMES, VALUE_KEYS, type Culture, type CultureValues, type Polity, type PopulationGroup, type Settlement, type SimulationState, type TradeTreaty } from './state.ts';
import { tradeIncome, treatyBetween } from './treaties.ts';
import { ancestry, lineOf } from './culture.ts';
import { TRAITS } from './traits.ts';
import { TENETS } from './religions.ts';
import { ERAS, TECHS } from './techs.ts';
import { DECISION_TUNING, FOOD_TUNING, REACH_TUNING, RESEARCH_TUNING, WAR_TUNING } from './tunables.ts';
import { claimWeight, warBetween } from './claims.ts';

type View = Pick<ObserverFrame, 'population' | 'polities' | 'civs' | 'settlementCount' | 'specialists' | 'leadingEra' | 'lineages' | 'cultures' | 'religions' | 'largest' | 'civList' | 'treaties' | 'census' | 'markers' | 'settlements' | 'ruins' | 'devastated' | 'roads' | 'trades' | 'fields' | 'wonders' | 'series' | 'stories' | 'ages' | 'perspective' | 'inspect' | 'wars'>;

/** Whether a settlement looks worn: something stands there and its region is let go unkept, or a building or its
 *  wonder is below 80% condition. */
function worn(state: SimulationState, settlement: SimulationState['settlements'][number]) {
  if (state.neglected[settlement.region] && (settlement.buildings.length > 0 || settlement.wonder !== null)) return true;
  for (const building of settlement.buildings) if (building.condition < 0.8) return true;
  if (settlement.wonder !== null) for (const wonder of state.wonders) if (wonder.settlement === settlement.id && wonder.status === 'standing' && wonder.condition < 0.8) return true;
  return false;
}

/**
 * What an observer may see of the true world (VISION.md "Observer views": the god view). Built on request from the
 * state; it never changes the simulation.
 */
export function observerView(state: SimulationState, inspect: number | null, perspective: number | null = null): View {
  const ids: number[] = [], regions: number[] = [], populations: number[] = [], kinds: number[] = [], eras: number[] = [], lineages: number[] = [], cultureIds: number[] = [], faiths: number[] = [];
  const living = new Map<number, { regions: number; population: number }>(), followed = new Map<number, { regions: number; population: number; civs: Set<number> }>();
  let population = 0, civs = 0, specialists = 0, leadingEra = 0;
  const sizes: { id: number; people: number }[] = [];
  for (const id of state.living) {
    const polity = state.polities[id];
    let people = 0;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      ids.push(id); regions.push(group.region); populations.push(group.size); kinds.push(polity.kind === 'civ' ? 1 : 0); eras.push(polity.knowledge.era); lineages.push(polity.lineage); cultureIds.push(group.culture);
      const culture = living.get(group.culture) ?? { regions: 0, population: 0 };
      culture.regions++; culture.population += group.size; living.set(group.culture, culture);
      faiths.push(group.faith);
      if (group.faith >= 0) {
        const faith = followed.get(group.faith) ?? { regions: 0, population: 0, civs: new Set<number>() };
        faith.regions++; faith.population += group.size; if (polity.kind === 'civ') faith.civs.add(id); followed.set(group.faith, faith);
      }
      people += group.size; specialists += group.specialists;
    }
    population += people; leadingEra = Math.max(leadingEra, polity.knowledge.era); sizes.push({ id, people });
    if (polity.kind === 'civ') civs++;
  }
  const largest = sizes.sort((a, b) => b.people - a.people || a.id - b.id).slice(0, 10).map(({ id, people }) => {
    const polity = state.polities[id];
    return { id, name: polity.name, kind: polity.kind, regions: polity.groups.length, population: people };
  });
  // The treaty web (U.4): each pair of civilizations and kind of treaty between them now, trade counted.
  const trading = new Map<number, number>(), web = new Map<string, { a: number; b: number; kind: 'alliance' | 'nonAggression' | 'road' | 'trade'; count: number }>();
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) continue;
    const [one, other] = treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties;
    if (state.polities[one].deathTick !== null || state.polities[other].deathTick !== null) continue;
    const a = Math.min(one, other), b = Math.max(one, other), key = `${a},${b},${treaty.type}`, held = web.get(key);
    if (held) held.count++; else web.set(key, { a, b, kind: treaty.type, count: 1 });
    if (treaty.type === 'trade') for (const party of [one, other]) trading.set(party, (trading.get(party) ?? 0) + 1);
  }
  const owned = new Map<number, number>();
  for (const settlement of state.settlements) if (settlement.status === 'alive') owned.set(settlement.owner, (owned.get(settlement.owner) ?? 0) + 1);
  const civList = sizes.filter(({ id }) => state.polities[id].kind === 'civ').slice(0, 100).map(({ id, people }) => {
    const polity = state.polities[id], capital = state.settlements[polity.capital!];
    let stability = 0, unrest = 0;
    for (const group of polity.groups) { const region = state.groups[group].region; stability += state.stability[region]; if (state.unrest[region]) unrest++; }
    return {
      id, name: polity.name, regions: polity.groups.length, population: people, era: polity.knowledge.era, capital: capital.name, capitalCell: capital.cell,
      settlements: owned.get(id) ?? 0, culture: state.cultures[polity.culture].name, faith: polity.stateReligion >= 0 ? state.religions[polity.stateReligion].name : null,
      treasury: Math.max(0, Math.floor(polity.wealth)), stability: polity.groups.length ? round(stability / polity.groups.length) : 1, unrest,
      trade: trading.get(id) ?? 0,
      roads: polity.roadPartners.length, pacts: polity.pacts.length, allies: polity.allies.length, soldiers: soldiersOf(state, polity),
    };
  });
  const settlements = { ids: [] as number[], cells: [] as number[], owners: [] as number[], capitals: [] as number[], tiers: [] as number[], names: [] as string[], features: [] as number[] };
  const fallen: Settlement[] = [];
  for (const settlement of state.settlements) {
    if (settlement.status !== 'alive') { fallen.push(settlement); continue; }
    settlements.ids.push(settlement.id); settlements.cells.push(settlement.cell); settlements.owners.push(settlement.owner); settlements.capitals.push(settlement.capital ? 1 : 0);
    // Names only for the places a map labels: towns and larger, and capitals.
    settlements.tiers.push(settlement.tier); settlements.names.push(settlement.tier > 0 || settlement.capital ? settlement.name : '');
    settlements.features.push((settlement.bonus.harbor ? 1 : 0) | (settlement.bonus.mine ? 2 : 0) | (settlement.bonus.quarry ? 4 : 0) | (settlement.wonder !== null ? 8 : 0) | (worn(state, settlement) ? 16 : 0));
  }
  // Ruins: the MAX_FRAME_RUINS that fell last, in settlement order.
  const kept = fallen.length <= MAX_FRAME_RUINS ? fallen : [...fallen].sort((a, b) => (b.ruinedTick ?? 0) - (a.ruinedTick ?? 0) || b.id - a.id).slice(0, MAX_FRAME_RUINS).sort((a, b) => a.id - b.id);
  const ruins = {
    cells: kept.map(settlement => settlement.cell), names: kept.map(settlement => settlement.name), razed: kept.map(settlement => settlement.status === 'razed' ? 1 : 0),
    total: fallen.length, razedTotal: fallen.filter(settlement => settlement.status === 'razed').length,
  };
  const roads = { a: [] as number[], b: [] as number[], tiers: [] as number[], bridges: [] as number[], conditions: [] as number[] };
  for (const road of state.roads.values()) { roads.a.push(road.a); roads.b.push(road.b); roads.tiers.push(road.tier); roads.bridges.push(road.bridge ? 1 : 0); roads.conditions.push(Math.round(road.condition * 100)); }
  const trades = { from: [] as number[], to: [] as number[], resources: [] as number[], sea: [] as number[] };
  for (const treaty of state.treaties) {
    if (treaty.type !== 'trade' || treaty.endTick !== null) continue;
    const from = state.settlements[treaty.hubs[0]], to = state.settlements[treaty.hubs[1]];
    trades.from.push(from.cell); trades.to.push(to.cell); trades.resources.push(treaty.resource); trades.sea.push(from.bonus.harbor && to.bonus.harbor ? 1 : 0);
  }
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
    population, polities: state.living.length, civs, settlementCount: settlements.ids.length, specialists, leadingEra, lineages: state.lineages, largest, civList, wars: warsView(state),
    treaties: [...web.values()].sort((x, y) => x.a - y.a || x.b - y.b || x.kind.localeCompare(y.kind)), census: censusSeries(state, civList.slice(0, 8).map(entry => entry.id)),
    cultures: [...living].sort(([a, x], [b, y]) => y.population - x.population || a - b).slice(0, 2_000).map(([id, entry]) => {
      const culture = state.cultures[id];
      return { id, name: culture.name, hue: round(culture.hue, 2), parent: culture.parents.length ? heaviestParent(state, culture).name : null, ...entry };
    }),
    religions: [...followed].sort(([a, x], [b, y]) => y.population - x.population || a - b).slice(0, 500).map(([id, entry]) => {
      const religion = state.religions[id];
      return { id, name: religion.name, hue: round(religion.hue, 2), regions: entry.regions, population: entry.population, civs: entry.civs.size };
    }),
    markers: { ids, regions, populations, kinds, eras, lineages, cultures: cultureIds, faiths }, settlements, ruins, devastated: devastatedView(state), roads, trades, fields, series,
    wonders: state.wonders.filter(wonder => wonder.status === 'building' || wonder.status === 'standing').slice(0, 32).map(wonder => {
      const settlement = state.settlements[wonder.settlement];
      return { name: WONDERS[wonder.type].name, city: settlement.name, civ: state.polities[settlement.owner].name, begun: Math.floor(wonder.begunTick / 12), built: wonder.builtTick === null ? null : Math.floor(wonder.builtTick / 12) };
    }), ...storiesView(state), perspective: perspective === null ? null : perspectiveOf(state, perspective), inspect: inspect === null ? null : inspectRegion(state, inspect, living),
  };
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The census over time for the ledger's charts (U.4): at most 300 years (thinned evenly, the latest kept), how many
 *  civilizations lived in each, and the people of the given civilizations in each (0 where one was not yet one). */
function censusSeries(state: SimulationState, ids: number[]): ObserverFrame['census'] {
  const step = Math.max(1, Math.ceil(state.census.length / 300));
  const kept = state.census.filter((_, at) => at % step === 0 || at === state.census.length - 1).slice(-300);
  return {
    years: kept.map(entry => entry.year), civs: kept.map(entry => entry.ids.length), ids,
    people: ids.map(id => kept.map(entry => { const at = entry.ids.indexOf(id); return at >= 0 ? entry.people[at] : 0; })),
  };
}
/** Three significant digits (resource units run from thousandths to hundreds). */
const significant = (value: number) => value === 0 ? 0 : Number(value.toPrecision(3));

/**
 * A people's standing with a civilization (VISION.md "Civ panel"; M5.5): allied, non-aggression pact or trade partner
 * by the strongest treaty between them now (and the year it began), else a rival at an opinion of −50 or below, else
 * neutral; and every kind of treaty between them now.
 */
function standingOf(state: SimulationState, polity: Polity, other: number, opinion: number) {
  const agreements: ('alliance' | 'nonAggression' | 'road' | 'trade')[] = [];
  // At war (M6.2; M6.5: on opposite sides of a war, an ally's too), since the war began.
  const war = warBetween(state, polity.id, other);
  if (war) return { status: 'war' as const, agreements, since: Math.floor(war.startTick / 12) as number | null };
  if (polity.allies.includes(other)) agreements.push('alliance');
  if (polity.pacts.includes(other)) agreements.push('nonAggression');
  if (polity.roadPartners.includes(other)) agreements.push('road');
  if (polity.trading.includes(other)) agreements.push('trade');
  const since = (kind: 'alliance' | 'nonAggression') => { const treaty = treatyBetween(state, kind, polity.id, other); return treaty ? Math.floor(treaty.startTick / 12) : null; };
  // (M6.5) Its overlord, or its vassal, since the peace that made it one.
  if (polity.overlord?.id === other) return { status: 'overlord' as const, agreements, since: Math.floor(polity.overlord.since / 12) as number | null };
  const theirs = state.polities[other].overlord;
  if (theirs?.id === polity.id) return { status: 'vassal' as const, agreements, since: Math.floor(theirs.since / 12) as number | null };
  if (agreements.includes('alliance')) return { status: 'allied' as const, agreements, since: since('alliance') };
  if (agreements.includes('nonAggression')) return { status: 'pact' as const, agreements, since: since('nonAggression') };
  if (agreements.includes('trade')) {
    let first: number | null = null;
    for (const treaty of state.treaties) if (treaty.type === 'trade' && treaty.endTick === null && ((treaty.exporter === polity.id && treaty.importer === other) || (treaty.importer === polity.id && treaty.exporter === other))) first = Math.min(first ?? treaty.startTick, treaty.startTick);
    return { status: 'trade' as const, agreements, since: first === null ? null : Math.floor(first / 12) };
  }
  return { status: opinion <= -50 ? 'rival' as const : 'neutral' as const, agreements, since: null };
}

function inspectRegion(state: SimulationState, region: number, living: Map<number, { regions: number; population: number }>): ObserverFrame['inspect'] {
  // (M6.5) Its overlord and its vassals lead its Diplomacy rows.
  const bound = (polity: Polity, other: number) => polity.overlord?.id === other || state.polities[other].overlord?.id === polity.id ? 1 : 0;
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
      stateReligion: polity.stateReligion >= 0 ? state.religions[polity.stateReligion].name : null,
      regions: polity.groups.length, totalPopulation: polityPopulation(state, polity), population: group.size,
      birthsThisYear: group.birthsYear, deathsThisYear: group.deathsYear, birthsLastYear: group.lastBirths, deathsLastYear: group.lastDeaths,
      foodSecurity: round(group.foodSecurity), foodStoreMonths: group.size > 0 ? round(group.store / (group.size * FOOD_TUNING.unitsPerPersonMonth), 2) : 0,
      cropsMonths: group.size > 0 ? round(group.planted / (group.size * FOOD_TUNING.unitsPerPersonMonth), 2) : 0,
      founded: polity.foundedTick, arrived: group.arrivedTick, farmShare: round(Math.min(1, Math.max(0, group.farmShare))), specialists: group.specialists, soldiers: group.soldiers,
      army: polity.kind !== 'civ' ? null : armyOf(state, polity),
      capital: capital ? { name: capital.name, cell: capital.cell, settled: polity.settledTick ?? capital.foundedTick } : null,
      era: knowledge.era, known: TECHS.filter((_, tech) => knowledge.known[tech]).map(definition => definition.name),
      knownEras: TECHS.filter((_, tech) => knowledge.known[tech]).map(definition => ERAS.indexOf(definition.era)),
      researchPerYear: round(researchRate(state, polity), 2), contacts: Math.min(polity.contacts.length, RESEARCH_TUNING.contactCap),
      reachKm: Math.round(REACH_TUNING.baseKm * knowledge.multipliers.reach), capitalKm: Math.round(kmFromCapital),
      lastDecision: lastDecision(state, polity),
      resources: polity.kind !== 'civ' ? [] : RESOURCE_IDS.flatMap((resource, at) => polity.supply[at] > 0 || polity.demand[at] > 0 || polity.imports[at] > 0
        ? [{ resource, supply: significant(available(polity, at)), demand: significant(polity.demand[at]), met: round(metFor(polity, at)) }] : []),
      treaties: polity.kind !== 'civ' ? [] : state.treaties.filter((treaty): treaty is TradeTreaty => treaty.type === 'trade' && treaty.endTick === null && (treaty.exporter === polity.id || treaty.importer === polity.id)).slice(0, 32).map(treaty => ({
        partner: state.polities[treaty.exporter === polity.id ? treaty.importer : treaty.exporter].name, partnerId: treaty.exporter === polity.id ? treaty.importer : treaty.exporter, resource: RESOURCE_IDS[treaty.resource], amount: significant(treaty.amount), imports: treaty.importer === polity.id,
        barter: treaty.barter >= 0 ? RESOURCE_IDS[treaty.barter] : null, barterAmount: significant(treaty.barterAmount), price: treaty.price, since: Math.floor(treaty.startTick / 12),
      })),
      diplomacy: polity.kind !== 'civ' ? [] : [...polity.relations].filter(([other]) => state.polities[other].deathTick === null)
        .sort((a, b) => bound(polity, b[0]) - bound(polity, a[0]) || b[1].intimacy - a[1].intimacy || b[1].opinion - a[1].opinion || a[0] - b[0]).slice(0, 24).map(([other, relation]) => {
          const them = state.polities[other];
          const met = Math.floor((polity.met.get(other) ?? 0) / 12), standing = standingOf(state, polity, other, relation.opinion);
          return {
            id: other, name: them.name, kind: them.kind, opinion: relation.opinion, reasons: relation.reasons.slice(0, 4), intimacy: round(relation.intimacy),
            people: Math.round(believe(state, polity, them, 'people').estimate), strength: Math.round(believe(state, polity, them, 'strength').estimate),
            sharing: (polity.exchanges.get(other) ?? 0) > state.tick, met, status: standing.status, agreements: standing.agreements, since: standing.since ?? met,
            truePeople: Math.round(truthOf(state, them, 'people')), trueStrength: Math.round(truthOf(state, them, 'strength')),
            claims: polity.claims.filter(claim => state.owner[claim.region] === other && claimWeight(claim.tick, state.tick) >= WAR_TUNING.claimFloor).length,
            claimed: them.claims.filter(claim => state.owner[claim.region] === polity.id && claimWeight(claim.tick, state.tick) >= WAR_TUNING.claimFloor).length,
          };
        }),
      stability: polity.kind !== 'civ' ? null : (() => {
        const now = stabilityOf(state, polity, group, kmFromCapital ?? Number.POSITIVE_INFINITY);
        return { value: round(state.stability[region]), unrest: state.unrest[region] === 1, hunger: round(now.hunger), overextension: round(now.overextension), foreignRule: round(now.foreignRule), faith: round(now.faith), strain: round(now.strain), taxes: round(now.taxes), arrears: round(now.arrears), demobilized: round(now.demobilized), occupied: round(now.occupied), devastated: round(now.devastated) };
      })(),
      regionsKnown: knownRegionCount(polity), regionsInSight: polity.map.observed.length, met: [...polity.met.keys()].filter(other => state.polities[other].deathTick === null).length,
      wealth: polity.kind !== 'civ' ? null : (() => {
        const account = realmAccount(state, polity), whole = (value: number) => Math.round(value);
        return {
          treasury: polity.wealth, taxRate: round(polity.taxRate),
          revenue: { trades: whole(account.revenue.trades), farms: whole(account.revenue.farms), sites: whole(account.revenue.sites) }, agreements: whole(tradeIncome(state, polity)),
          costs: { administration: whole(account.costs.administration), services: whole(account.costs.services), upkeep: whole(account.costs.upkeep), roads: whole(account.costs.roads), army: whole(account.costs.army) },
          arrears: round(polity.arrears), projects: polity.projects.length, roadWorks: polity.roadWorks.length,
        };
      })(),
      realm: polity.kind === 'civ' ? realmSummary(state, polity) : null,
      history: historyOf(state, polity), unmet: polity.kind === 'civ' ? unmetNear(state, polity) : [],
      // Every living people it has met, judged or not yet (opinion is formed yearly; until then it is neutral).
      overlord: polity.overlord && state.polities[polity.overlord.id].deathTick === null ? {
        id: polity.overlord.id, name: state.polities[polity.overlord.id].name, since: Math.floor(polity.overlord.since / 12), perYear: polity.overlord.amount, paid: polity.overlord.paid,
      } : null,
      vassals: polity.kind !== 'civ' ? [] : state.living.filter(id => state.polities[id].overlord?.id === polity.id).slice(0, 16)
        .map(id => ({ id, name: state.polities[id].name, since: Math.floor(state.polities[id].overlord!.since / 12), perYear: state.polities[id].overlord!.amount })),
      standings: polity.kind !== 'civ' ? [] : [...polity.met.keys()].filter(other => other !== polity.id && state.polities[other].deathTick === null).sort((a, b) => a - b)
        .map(other => ({ id: other, status: standingOf(state, polity, other, polity.relations.get(other)?.opinion ?? 0).status })),
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
    region, capacity: Math.round(people), gameStock: round(state.gameStock[region]), settlements: settlementViews, neglected: state.neglected[region] === 1,
    occupation: occupationOf(state, region), devastation: round(state.devastation[region]), raided: round(state.raided[region]),
    people: group ? peopleView(state, group, living.get(group.culture)!) : null,
    weather: { harvest: round(state.harvestFactor[region]), drought: state.drought[region], famine: state.famine[region] === 1, irrigation: round(regionFarm(state, region)), relief: state.reliefTick[region] >= 0 && state.tick - state.reliefTick[region] <= 1 },
    fields: (() => {
      const land = fieldLand(state.fieldRanking, region);
      return { share: land > 0 ? round(Math.min(1, state.fields[region] / land)) : 0, cells: cultivatedCells(state.fieldRanking, region, state.fields[region]) };
    })(),
    food: { forage: output(0), hunt: output(1), fish: output(2), herd: output(3), farm: output(4) },
    polity: view,
  };
}

/** A civilization's realm at a glance (U.2): its settlements by tier and largest cities, its wonders, its regions'
 *  mean stability, unrest and neglect, the road edges it keeps, and its people's cultures and faiths by share. */
function realmSummary(state: SimulationState, civ: Polity): NonNullable<NonNullable<ObserverFrame['inspect']>['polity']>['realm'] {
  const settlements = [0, 0, 0, 0], cities: { id: number; name: string; tier: number; urban: number; capital: boolean }[] = [];
  const cultures = new Map<number, number>(), faiths = new Map<number, number>();
  let people = 0, stability = 0, unrest = 0, neglected = 0;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    people += group.size; stability += state.stability[region];
    if (state.unrest[region]) unrest++;
    if (state.neglected[region]) neglected++;
    cultures.set(group.culture, (cultures.get(group.culture) ?? 0) + group.size);
    faiths.set(group.faith, (faiths.get(group.faith) ?? 0) + group.size);
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status !== 'alive' || settlement.owner !== civ.id) continue;
      settlements[settlement.tier]++;
      cities.push({ id: settlement.id, name: settlement.name, tier: settlement.tier, urban: settlement.urban, capital: settlement.capital });
    }
  }
  let roads = 0, roadsUnkept = 0;
  for (const road of state.roads.values()) if (keeperOf(state, road) === civ.id) { roads++; if (roadUnkept(state, road)) roadsUnkept++; }
  const top = (shares: Map<number, number>) => [...shares].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  return {
    settlements, cities: cities.sort((a, b) => b.urban - a.urban || Number(b.capital) - Number(a.capital) || a.id - b.id).slice(0, 6),
    wonders: state.wonders.filter(wonder => wonder.status === 'standing' && state.settlements[wonder.settlement].owner === civ.id).slice(0, 16)
      .map(wonder => ({ name: WONDERS[wonder.type].name, city: state.settlements[wonder.settlement].name })),
    stability: civ.groups.length ? round(stability / civ.groups.length) : 1, unrest, neglected, roads, roadsUnkept,
    cultures: top(cultures).map(([id, size]) => ({ name: state.cultures[id].name, share: round(people > 0 ? size / people : 0) })),
    faiths: top(faiths).map(([id, size]) => ({ name: id >= 0 ? state.religions[id].name : null, share: round(people > 0 ? size / people : 0) })),
  };
}

/** The perspective lens (U.6; VISION.md "Perspective lens"): the map as a living people knows it, from its own map
 *  knowledge (M3.1): the regions in sight, and the regions it remembers with their last-seen snapshots. */
export function perspectiveOf(state: SimulationState, id: number): ObserverFrame['perspective'] {
  const polity = state.polities[id];
  if (!polity || polity.deathTick !== null) return null;
  const remembered = { regions: [] as number[], occupants: [] as number[], years: [] as number[] }, names = new Map<number, string>();
  for (let region = 0; region < polity.map.status.length; region++) {
    if (polity.map.status[region] !== KNOWN) continue;
    const snapshot = polity.map.snapshots.get(region)!;
    remembered.regions.push(region); remembered.occupants.push(snapshot.occupant); remembered.years.push(Math.floor(snapshot.tick / 12));
    if (snapshot.occupant >= 0) names.set(snapshot.occupant, state.polities[snapshot.occupant].name);
  }
  return { polity: id, name: polity.name, observed: [...polity.map.observed].sort((a, b) => a - b), remembered, names: [...names] };
}

/** A page of the chronicle (U.5), read backward from `query.before`: the matching events, newest first, and where the
 *  next page reads from (null once the first event is read). At most `CHRONICLE_SCAN` events are read per page. */
export function chroniclePage(state: SimulationState, query: ChronicleQuery) {
  const events = state.chronicle.events, types = query.types ? new Set<string>(query.types) : null, limit = Math.min(MAX_CHRONICLE_PAGE, Math.max(1, query.limit));
  const found: ChronicleEvent[] = [];
  let at = Math.min(query.before ?? events.length, events.length) - 1;
  const stop = at - CHRONICLE_SCAN;
  for (; at >= 0 && at > stop && found.length < limit; at--) {
    const event = events[at];
    if (event.importance < query.min || (types && !types.has(event.type)) || (query.polity !== null && !event.actors.some(actor => actor.id === query.polity))) continue;
    found.push(event);
  }
  return { events: found, next: at >= 0 ? at + 1 : null };
}

/** A polity's own chronicle (U.2): the latest notable events it acts in (`HISTORY_IMPORTANCE`: not each village
 *  founded, town grown, small building or road, which the region's settlements show), newest first, back to its
 *  founding (from the most recent `HISTORY_SCAN` events, so a long-quiet people's list may be short). A run of events of
 *  one type, each within `HISTORY_RUN_YEARS` of the next (bands taken in, hungry regions fed, contacts made), is one
 *  entry: its newest event, how many more there were and when the run began, so a few busy decades do not fill the
 *  list. Entries are ordered by their newest event; the scan ends where a 41st entry would begin. */
export const HISTORY_LENGTH = 40, HISTORY_IMPORTANCE = 0.05, HISTORY_RUN_YEARS = 25;
const HISTORY_SCAN = 60_000;
function historyOf(state: SimulationState, polity: Polity) {
  const events = state.chronicle.events, found: { event: ChronicleEvent; more: number; from: number }[] = [], stop = Math.max(0, events.length - HISTORY_SCAN);
  const open = new Map<string, { event: ChronicleEvent; more: number; from: number }>();
  for (let at = events.length - 1; at >= stop && events[at].tick >= polity.foundedTick; at--) {
    const event = events[at];
    if (event.importance < HISTORY_IMPORTANCE || !event.actors.some(actor => actor.id === polity.id)) continue;
    const run = open.get(event.type);
    if (run && run.from - event.tick <= HISTORY_RUN_YEARS * 12) { run.more++; run.from = event.tick; continue; }
    if (found.length === HISTORY_LENGTH) break;
    const entry = { event, more: 0, from: event.tick };
    found.push(entry); open.set(event.type, entry);
  }
  return found;
}

/** The god view (U.2; VISION.md "Civ panel"): the living peoples within `UNMET_DEPTH` regions of a civilization's land,
 *  by land, that it has not met yet, nearest first (ties by id). */
const UNMET_DEPTH = 3, UNMET_LENGTH = 6;
function unmetNear(state: SimulationState, civ: Polity) {
  const seen = new Set(civ.groups.map(id => state.groups[id].region)), listed = new Set<number>();
  const found: { id: number; name: string; kind: 'band' | 'civ'; away: number }[] = [];
  let frontier = [...seen].sort((a, b) => a - b);
  for (let away = 1; away <= UNMET_DEPTH && frontier.length; away++) {
    const next: number[] = [], here: number[] = [];
    for (const region of frontier) for (const edge of state.partition.regions[region].neighbors) {
      if (seen.has(edge.region)) continue;
      seen.add(edge.region); next.push(edge.region);
      const other = state.occupant[edge.region];
      if (other >= 0 && other !== civ.id && !civ.met.has(other) && !listed.has(other)) { listed.add(other); here.push(other); }
    }
    for (const id of here.sort((a, b) => a - b)) found.push({ id, name: state.polities[id].name, kind: state.polities[id].kind, away });
    frontier = next.sort((a, b) => a - b);
  }
  return found.slice(0, UNMET_LENGTH);
}

function heaviestParent(state: SimulationState, culture: Culture) {
  return state.cultures[culture.parents.reduce((best, entry) => entry.weight > best.weight ? entry : best).id];
}

const roundValues = (values: CultureValues) => Object.fromEntries(VALUE_KEYS.map(key => [key, round(values[key])])) as CultureValues;

/** The people of a region for the inspector: their culture, its origin and descent, and their values; where and how
 *  many live by it now (`living`, counted from the groups as the map is). */
function peopleView(state: SimulationState, group: PopulationGroup, living: { regions: number; population: number }): NonNullable<ObserverFrame['inspect']>['people'] {
  const culture = state.cultures[group.culture];
  return {
    culture: culture.name, origin: culture.origin, parent: culture.parents.length ? heaviestParent(state, culture).name : null, founded: culture.foundedTick,
    parents: culture.parents.map(entry => ({ name: state.cultures[entry.id].name, weight: round(entry.weight) })), traits: culture.traits.map(trait => TRAITS[trait].name),
    regions: living.regions, population: living.population,
    ancestry: ancestry(state, culture.id).slice(0, 6).map(entry => ({ name: state.cultures[entry.id].name, share: round(entry.share) })),
    line: lineOf(state, culture.id, 6).map(entry => ({ name: entry.name, origin: entry.origin, founded: entry.foundedTick })),
    values: roundValues(group.values), cultureValues: roundValues(culture.values),
    faith: group.faith < 0 ? null : (() => {
      const religion = state.religions[group.faith];
      return {
        name: religion.name, tenets: religion.tenets.map(tenet => TENETS[tenet].name), founded: religion.foundedTick, founder: state.polities[religion.founder].name,
        parent: religion.parent === null ? null : state.religions[religion.parent].name, holy: religion.holyRegion === group.region,
      };
    })(),
  };
}

/** Whether the choice could draw an option (the log keeps them best first): among the best DECISION_TUNING.topChoices of
 *  those scoring at least DECISION_TUNING.minScore. */
function drawable(options: readonly { score: number }[], at: number) {
  let place = 0;
  for (let index = 0; index < options.length; index++) {
    if (options[index].score < DECISION_TUNING.minScore) continue;
    if (index === at) return place < DECISION_TUNING.topChoices;
    place++;
  }
  return false;
}

/** The frame's devastated regions (M6.3): those at 0.05 or more, the most devastated first, in percent. */
function devastatedView(state: SimulationState): ObserverFrame['devastated'] {
  const regions: number[] = [];
  for (let region = 0; region < state.devastation.length; region++) if (state.devastation[region] >= 0.05) regions.push(region);
  regions.sort((a, b) => state.devastation[b] - state.devastation[a] || a - b);
  const kept = regions.slice(0, MAX_FRAME_DEVASTATED);
  return { regions: kept, levels: kept.map(region => Math.round(state.devastation[region] * 100)) };
}

/** The frame's wars (M6.2): every war now, then those ended in the last century, newest first. While a war lasts, its
 *  goal and counter are the land still to be fought for (the defender's and the attacker's). */
function warsView(state: SimulationState): ObserverFrame['wars'] {
  const recent = state.tick - 100 * 12, now = state.wars.filter(war => war.endTick === null);
  const ended = state.wars.filter(war => war.endTick !== null && war.endTick >= recent).reverse();
  return [...now, ...ended].slice(0, MAX_FRAME_WARS).map(war => ({
    id: war.id, name: war.name, attacker: war.attacker, attackerName: state.polities[war.attacker].name, defender: war.defender, defenderName: state.polities[war.defender].name,
    framing: war.framing, resource: war.resource >= 0 ? RESOURCE_IDS[war.resource] : null, since: Math.floor(war.startTick / 12), ended: war.endTick === null ? null : Math.floor(war.endTick / 12),
    outcome: war.outcome, score: Math.round(war.score * 10) / 10, exhaustion: { attacker: round(war.exhaustion[0]), defender: round(war.exhaustion[1]) },
    dead: { attacker: war.deaths[0], defender: war.deaths[1] },
    goal: (war.endTick === null ? war.goal.filter(region => state.owner[region] === war.defender) : war.goal).slice(0, 8),
    counter: (war.endTick === null ? war.counter.filter(region => state.owner[region] === war.attacker) : war.counter).slice(0, 8),
    occupied: war.occupied.slice(0, 16).map(entry => ({ region: entry.region, by: entry.by })),
    ceded: war.ceded.slice(0, 4_096), causes: war.causes.slice(0, 4),
    allies: war.allies.slice(0, 8).map(entry => ({ id: entry.id, name: state.polities[entry.id].name, since: Math.floor(entry.tick / 12), dead: entry.deaths })),
  }));
}

/** Who holds a region in a war now (M6.2), and since when; null when no one does. */
function occupationOf(state: SimulationState, region: number) {
  const by = state.occupiedBy[region];
  if (by < 0) return null;
  for (const war of state.wars) {
    if (war.endTick !== null) continue;
    const entry = war.occupied.find(held => held.region === region);
    if (entry) return { by, name: state.polities[by].name, since: Math.floor(entry.tick / 12) };
  }
  return null;
}

/** A civilization's army for the inspector (M6.1): its soldiers and what it means to keep, and why. */
function armyOf(state: SimulationState, civ: Polity) {
  const soldiers = soldiersOf(state, civ), people = polityPopulation(state, civ), army = civ.army;
  return {
    soldiers, target: army.target, share: people > 0 ? Math.min(1, Math.round(soldiers / people * 1e5) / 1e5) : 0,
    strength: Math.round(strengthOf(state, civ)), upkeep: Math.round(soldiers * soldierUpkeep(civ)),
    garrison: army.garrison, threatened: army.threatened, cut: army.cut, feared: army.feared >= 0 ? state.polities[army.feared].name : null, raiders: army.raiders,
  };
}

/** The polity's last decision step for the inspector: each option's strongest factors (by size), best option first. */
function lastDecision(state: SimulationState, polity: Polity): NonNullable<NonNullable<ObserverFrame['inspect']>['polity']>['lastDecision'] {
  const step = polity.decisions.at(-1);
  if (!step) return null;
  return {
    tick: step.tick, chosen: step.chosen, pick: step.pick, outcome: step.outcome.slice(0, 80),
    values: roundValues(step.values),
    needs: Object.fromEntries(NEED_NAMES.map(need => [need, round(step.needs[need])])) as typeof step.needs, causes: step.causes.slice(0, 4),
    options: step.options.slice(0, 4).map((option, at) => ({
      action: option.action, score: option.score, drawn: drawable(step.options, at), target: option.target, label: option.label,
      factors: option.factors.filter(entry => entry.weight !== 0).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8),
      ...(option.beliefs ? { beliefs: option.beliefs.slice(0, 4).map(belief => ({ ...belief, name: state.polities[belief.polity].name })) } : {}),
    })),
  };
}

/** The names of the polities acting in some events, by id (U.1: so the observer can write "the Vraye", not "#12"). */
export function actorNames(state: SimulationState, events: readonly ChronicleEvent[]): [number, string][] {
  const names = new Map<number, string>();
  for (const event of events) for (const actor of event.actors) {
    const polity = state.polities[actor.id];
    if (polity && !names.has(actor.id)) names.set(actor.id, polity.name.slice(0, 40));
  }
  return [...names].sort((a, b) => a[0] - b[0]).slice(0, MAX_FRAME_NAMES);
}
