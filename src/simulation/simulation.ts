import { simulationDate, type KnowledgeReport, type ObserverFrame, type PoliticsReport } from '../../shared/simulation.ts';
import { coreRegion, isWaterRegion, landValues, populate, produce, regionCapacity, spawnBands } from './bands.ts';
import { Chronicle } from './chronicle.ts';
import { decide } from './decide.ts';
import { stabilize } from './stability.ts';
import { buildFoodModel, farmingPotential } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import { checkInvariants } from './invariants.ts';
import { edgeKm, knownRegionCount } from './perception.ts';
import { regionAffinities, research, shareKnowing } from './research.ts';
import { byWater } from './settlements.ts';
import { edgeBetween, roadCoverage } from './roads.ts';
import { construct } from './construction.ts';
import { environment } from './environment.ts';
import { wealthFlows } from './economy.ts';
import { ACTIONS, SYSTEMS, type CenturyStats, type Ledger, type SimulationState, type SystemKey, type TickContext } from './state.ts';
import type { RegionPartition } from './regions.ts';
import { seedFromText, systemStream } from './rng.ts';
import { ERAS, TECH_INDEX, TECHS } from './techs.ts';
import { CLOCK_TUNING, SERIES_YEARS } from './tunables.ts';

/** Bump with every slice that changes rules or tuning (part of the world-instance identity). */
export const SIMULATION_RULES_VERSION = 13;

type SystemRun = (state: SimulationState, context: TickContext) => void;

/** Rules per system. Empty systems keep their slot, cadence and timing until a milestone fills them. */
const RUNS: Record<SystemKey, SystemRun> = {
  environment, production: produce, population: populate, knowledge: research, culture: () => {},
  stability: stabilize, decisions: decide, construction: construct, diplomacy: () => {}, war: () => {}, fracture: () => {},
  chronicle: (state, context) => state.chronicle.flush(context.tick),
};

function emptyLedger(regions: number): Ledger {
  return {
    births: new Int32Array(regions), naturalDeaths: new Int32Array(regions), famineDeaths: new Int32Array(regions),
    migrantsIn: new Int32Array(regions), migrantsOut: new Int32Array(regions), before: new Int32Array(regions), food: new Map(), wealth: new Map(),
  };
}

export function createSimulation(geography: SimulationGeography, partition: RegionPartition, seedText: string): SimulationState {
  const regions = partition.regions.length;
  const state: SimulationState = {
    seedText, seed: seedFromText(seedText), tick: 0, geography, partition, food: buildFoodModel(geography, partition),
    chronicle: new Chronicle(), cultures: [], polities: [], groups: [], living: [],
    settlements: [], regionSettlements: Array.from({ length: regions }, () => []), owner: new Int32Array(regions).fill(-1), hardship: new Float64Array(regions), harbors: new Uint8Array(regions), wonders: [], roads: new Map(),
    weather: new Float64Array(regions).fill(1), harvestFactor: new Float64Array(regions).fill(1), drought: new Uint8Array(regions), famineRecent: new Float64Array(regions), famine: new Uint8Array(regions),
    farmBonus: new Float64Array(regions).fill(1), droughtShield: new Float64Array(regions), storeBonus: new Float64Array(regions).fill(1), spoilageBonus: new Float64Array(regions).fill(1), stability: new Float64Array(regions).fill(1), unrest: new Uint8Array(regions), firsts: [], agricultureQuarterYear: -1, affinity: [], landValue: new Float64Array(regions),
    lineages: [],
    gameStock: new Float64Array(regions).fill(1), occupant: new Int32Array(regions).fill(-1), groupAt: new Int32Array(regions).fill(-1),
    capacity: new Float64Array(regions), overCapacity: new Int32Array(regions), capacityGame: new Float64Array(regions),
    ledger: emptyLedger(regions), habitable: new Uint8Array(regions), settledLandmasses: [],
    metrics: { silentBandYears: 0, maxOverCapacityMonths: 0, moves: 0, movesCitingPressure: 0, movesLedByPressure: 0, splits: 0, breakaways: 0, births: 0, deaths: 0, famineDeaths: 0, settled: 0, discoveries: 0, firstContacts: 0,
      chosen: { expand: 0, explore: 0, nothing: 0, unite: 0, share: 0, build: 0 }, expansions: 0, absorbed: 0, displaced: 0, expeditions: 0, migrants: 0, joined: 0, unrestOutbreaks: 0, unions: 0,
      exchangeOffers: 0, exchanges: 0, tribeExchanges: 0, agricultureInventions: 0, settlementsGrown: 0, ruinsResettled: 0, tierChanges: 0,
      buildingsStarted: 0, buildingsCompleted: 0, buildingsLost: 0, projectsAbandoned: 0, wondersBegun: 0, wondersCompleted: 0, wondersDestroyed: 0, wondersAbandoned: 0,
      roadsBegun: 0, roadsBuilt: 0, roadsAbandoned: 0, roadEdgesBuilt: 0, bridgesBuilt: 0, roadsLost: 0, firstBridgeTick: -1, droughts: 0, famines: 0 },
    timing: { ms: new Float64Array(SYSTEMS.length), calls: new Float64Array(SYSTEMS.length) }, stats: [], series: [], checkedEvents: 0,
  };
  for (let region = 0; region < regions; region++) if (regionCapacity(state, region) > 0) state.habitable[region] = 1;
  state.affinity = regionAffinities(state);
  state.landValue = landValues(state);
  spawnBands(state);
  state.settledLandmasses = [...new Set(state.living.map(id => partition.regions[coreRegion(state, state.polities[id])].landmass))].sort((a, b) => a - b);
  state.chronicle.flush(0);
  state.stats.push(collectStats(state, 0));
  state.series.push(seriesPoint(state, 0));
  return state;
}

/** Simulate one month. `now` supplies wall-clock milliseconds for per-system timing; it never affects results. */
export function stepSimulation(state: SimulationState, now: () => number = () => 0, verify = true) {
  const tick = state.tick, { year, month } = simulationDate(tick);
  const ledger = state.ledger;
  for (const array of [ledger.births, ledger.naturalDeaths, ledger.famineDeaths, ledger.migrantsIn, ledger.migrantsOut, ledger.before]) array.fill(0);
  ledger.food.clear(); ledger.wealth.clear();
  // Every civilization's treasury as the month begins (VISION.md rule 8).
  for (const id of state.living) { const polity = state.polities[id]; if (polity.kind === 'civ') wealthFlows(state, polity); }
  for (const id of state.living) for (const groupId of state.polities[id].groups) { const group = state.groups[groupId]; ledger.before[group.region] += group.size; }
  for (const system of SYSTEMS) {
    const context: TickContext = { tick, year, month, stream: (entity, salt) => systemStream(state.seed, tick, system.id, entity, salt) };
    const started = now();
    RUNS[system.key](state, context);
    state.timing.ms[system.id] += now() - started;
    state.timing.calls[system.id]++;
  }
  state.tick = tick + 1;
  if (state.tick % 12 === 0 && (state.tick / 12) % SERIES_YEARS === 0) state.series.push(seriesPoint(state, state.tick / 12));
  if (state.tick % (CLOCK_TUNING.statsYears * 12) === 0) state.stats.push(collectStats(state, state.tick / 12));
  if (verify) checkInvariants(state);
}

export function worldPopulation(state: SimulationState) {
  let total = 0;
  for (const id of state.living) for (const groupId of state.polities[id].groups) total += state.groups[groupId].size;
  return total;
}

function seriesPoint(state: SimulationState, year: number): [number, number, number] {
  return [year, worldPopulation(state), state.living.length];
}

export function collectStats(state: SimulationState, year: number): CenturyStats {
  let population = 0, largest = 0, largestRegions = 0, waterPopulation = 0, bands = 0, tribes = 0, occupied = 0, specialists = 0, leadingEra = 0, civKnown = 0;
  let civTechsMin = Number.POSITIVE_INFINITY, civTechsMax = 0;
  const civEras = new Set<number>();
  for (const id of state.living) {
    const polity = state.polities[id];
    let people = 0;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      people += group.size; specialists += group.specialists; occupied++;
      if (polity.kind === 'band') bands++;
      if (isWaterRegion(state, group.region)) waterPopulation += group.size;
    }
    population += people; largest = Math.max(largest, people); largestRegions = Math.max(largestRegions, polity.groups.length);
    if (polity.kind === 'band') tribes++;
    else {
      civKnown += knownRegionCount(polity); civEras.add(polity.knowledge.era);
      let techs = 0;
      for (const known of polity.knowledge.known) techs += known;
      civTechsMin = Math.min(civTechsMin, techs); civTechsMax = Math.max(civTechsMax, techs);
    }
    leadingEra = Math.max(leadingEra, polity.knowledge.era);
  }
  let waterRegions = 0;
  for (const region of state.partition.regions) if (isWaterRegion(state, region.id)) waterRegions++;
  let occupiedHabitableShare = 1;
  for (const landmass of state.settledLandmasses) {
    let habitable = 0, occupied = 0;
    for (const region of state.partition.landmasses[landmass].regions) if (state.habitable[region]) { habitable++; if (state.occupant[region] >= 0) occupied++; }
    if (habitable) occupiedHabitableShare = Math.min(occupiedHabitableShare, occupied / habitable);
  }
  const m = state.metrics;
  // Borders follow barriers: travel cost of land edges between different civilizations against the edges within the land
  // civilizations hold (M3) and against all land edges (M6).
  const all: number[] = [], held: number[] = [], borders: number[] = [];
  for (const region of state.partition.regions) for (const edge of region.neighbors) {
    if (edge.region < region.id) continue;
    const km = edgeKm(edge.travelKm, edge.riverTier), a = state.owner[region.id], b = state.owner[edge.region];
    all.push(km);
    if (a >= 0 && b >= 0) { held.push(km); if (a !== b) borders.push(km); }
  }
  const median = (values: number[]) => { values.sort((x, y) => x - y); return values.length ? values[Math.floor(values.length / 2)] : 0; };
  const border = median(borders), ratio = (baseline: number[]) => borders.length && baseline.length ? Math.round(border / median(baseline) * 1000) / 1000 : 0;
  const borderRatio = ratio(held), borderRatioAll = ratio(all);
  // Settlements by tier, and how many sit by water or a resource site (VISION.md M3b).
  const tiers = [0, 0, 0, 0];
  let byWaterCount = 0, alive = 0, buildings = 0, wealth = 0;
  for (const settlement of state.settlements) if (settlement.status === 'alive') { alive++; tiers[settlement.tier]++; buildings += settlement.buildings.length; if (byWater(state, settlement.cell)) byWaterCount++; }
  for (const id of state.living) wealth += state.polities[id].wealth;
  // Roads (VISION.md M3b: the capital to its towns and cities) and the network's length.
  let pavedEdges = 0, bridges = 0, roadKm = 0;
  for (const road of state.roads.values()) { if (road.tier >= 2) pavedEdges++; if (road.bridge) bridges++; roadKm += edgeBetween(state, road.a, road.b)!.travelKm; }
  const coverage = roadCoverage(state);
  let regionsInDrought = 0, irrigated = 0;
  for (let region = 0; region < state.drought.length; region++) if (state.drought[region] > 0) regionsInDrought++;
  for (const settlement of state.settlements) if (settlement.status === 'alive' && settlement.bonus.farm > 1) irrigated++;
  let ruled = 0, stable = 0, unrestRegions = 0;
  for (let region = 0; region < state.owner.length; region++) if (state.owner[region] >= 0) { ruled++; stable += state.stability[region]; unrestRegions += state.unrest[region]; }
  return {
    year, regions: state.partition.regions.length, polities: state.living.length, tribes, bands, civs: state.living.length - tribes, population,
    largestShare: population > 0 ? largest / population : 0, events: state.chronicle.events.length, occupiedRegions: occupied, largestRegions,
    waterPopulationShare: population > 0 ? waterPopulation / population : 0, waterRegionShare: waterRegions / state.partition.regions.length,
    bandMoves: m.moves, bandSplits: m.splits, bandBreakaways: m.breakaways, births: m.births, deaths: m.deaths, famineDeaths: m.famineDeaths,
    settlements: alive, specialists,
    agricultureShare: Math.round(shareKnowing(state, 'Agriculture') * 1000) / 1000, leadingEra,
    occupiedHabitableShare: Math.round(occupiedHabitableShare * 1000) / 1000,
    firstContacts: m.firstContacts, civKnownRegions: state.living.length > tribes ? Math.round(civKnown / (state.living.length - tribes)) : 0,
    chosenExpand: m.chosen.expand, chosenExplore: m.chosen.explore, chosenNothing: m.chosen.nothing, chosenUnite: m.chosen.unite, chosenShare: m.chosen.share, chosenBuild: m.chosen.build, unions: m.unions,
    expansions: m.expansions, absorbed: m.absorbed, displaced: m.displaced, expeditions: m.expeditions, migrants: m.migrants, borderRatio, borderRatioAll,
    joined: m.joined, unrestRegions, unrestOutbreaks: m.unrestOutbreaks, meanStability: ruled ? Math.round(stable / ruled * 1000) / 1000 : 0,
    exchangeOffers: m.exchangeOffers, exchanges: m.exchanges, tribeExchanges: m.tribeExchanges, agricultureInventions: m.agricultureInventions, civEras: civEras.size, civTechsMin: civEras.size ? civTechsMin : 0, civTechsMax,
    villages: tiers[0], towns: tiers[1], cities: tiers[2], metropolises: tiers[3], settlementsByWater: alive ? Math.round(byWaterCount / alive * 1000) / 1000 : 1,
    buildings, wealth, buildingsCompleted: m.buildingsCompleted, buildingsLost: m.buildingsLost,
    wonders: state.wonders.filter(wonder => wonder.status === 'standing').length, wondersCompleted: m.wondersCompleted,
    roadEdges: state.roads.size, pavedEdges, bridges, roadKm: Math.round(roadKm), roadsBuilt: m.roadsBuilt, roadsLost: m.roadsLost,
    roadCoverage: coverage.civs ? Math.round(coverage.covered / coverage.civs * 1000) / 1000 : -1, roadCivs: coverage.civs,
    droughts: m.droughts, famines: m.famines, regionsInDrought, irrigated,
  };
}

/** Name of an era index (statistics and the study). */
export const eraName = (era: number) => ERAS[era];

/** M3 facts for the study: each living civilization's longest gap between expansions so far (years). */
export function politicsReport(state: SimulationState): PoliticsReport {
  const longestExpansionGaps: number[] = [];
  for (const id of state.living) {
    const polity = state.polities[id];
    // Counting the time since its last expansion, so a civilization that never expanded again is not reported as 0.
    if (polity.kind === 'civ') longestExpansionGaps.push(Math.round(Math.max(polity.longestExpansionGap, state.tick - (polity.lastExpansion ?? state.tick)) / 12 * 10) / 10);
  }
  return { longestExpansionGaps };
}

/** M2 facts for the study (VISION.md M2 acceptance): firsts, where Agriculture began, when a quarter knew it. */
export function knowledgeReport(state: SimulationState): KnowledgeReport {
  const firsts = state.firsts.map(entry => ({ tech: TECHS[entry.tech].name, era: TECHS[entry.tech].era, year: Math.round(entry.tick / 12 * 100) / 100, region: entry.region }));
  const eras = ERAS.map(era => ({ era, year: firsts.find(entry => entry.era === era)?.year ?? (era === 'Stone' ? 0 : -1) })).filter(entry => entry.year >= 0);
  const first = state.firsts.find(entry => entry.tech === TECH_INDEX.get('Agriculture'));
  let agriculture: KnowledgeReport['agriculture'] = null;
  if (first) {
    const potentials = state.partition.regions.map(region => farmingPotential(state.food, region.id)).sort((a, b) => a - b);
    const region = state.partition.regions[first.region];
    agriculture = { year: Math.round(first.tick / 12 * 100) / 100, region: region.id, topQuartile: farmingPotential(state.food, region.id) >= potentials[Math.floor(potentials.length * 0.75)], riverTier: region.riverTier, openLake: region.openLake };
  }
  return { firsts, eras, agriculture, agricultureQuarterYear: state.agricultureQuarterYear };
}

export function frameCounters(state: SimulationState): ObserverFrame['counters'] {
  return { regions: state.partition.regions.length, landmasses: state.partition.landmasses.length };
}

/** A digest of everything that determines future history: clock, chronicle, partition, seed, groups, polities, settlements, game and caches. */
export function stateHash(state: SimulationState) {
  let partition = 0x811c9dc5, hash = 0x811c9dc5;
  for (const value of state.partition.regionOf) partition = Math.imul(partition ^ (value + 1), 16777619);
  const add = (value: number) => { hash = Math.imul(hash ^ (value | 0), 16777619); hash = Math.imul(hash ^ Math.round((value % 1) * 1e9), 16777619); };
  add(state.tick);
  for (const group of state.groups) { add(group.size); add(group.region); add(group.arrivedTick); add(group.store); add(group.planted); add(group.birthCarry); add(group.naturalCarry); add(group.famineCarry); add(group.specialists); add(group.foodSecurity * 1e6); }
  for (const polity of state.polities) {
    add(polity.kind === 'civ' ? 1 : 0); add(polity.core); add(polity.capital ?? -1); add(polity.homeLandmass); add(polity.knowledge.target);
    for (const group of polity.groups) add(group);
    for (const points of polity.knowledge.progress) if (points) add(points);
    for (const known of polity.knowledge.known) add(known);
    for (const contact of polity.contacts) add(contact);
    // Who it has met and what it knows of the map decide what it can see and choose.
    for (const [id, tick] of polity.met) { add(id); add(tick); }
    add(polity.map.dirty ? 1 : 0); add(polity.map.sea);
    for (const region of polity.map.observed) add(region);
    for (const [region, snapshot] of polity.map.snapshots) { add(region); add(snapshot.occupant); add(snapshot.owner); add(snapshot.tick); }
    add(polity.lastExpansion ?? -1); add(polity.longestExpansionGap); add(polity.seaTick);
    for (const [civ, tick] of polity.rebuffed) { add(civ); add(tick); }
    add(polity.wealth); add(polity.wealthCarry * 1e6); add(polity.upkeepCarry * 1e6); add(polity.repairing ? 1 : 0);
    for (const project of polity.projects) { add(project.settlement); add(project.type); add(project.spent); add(project.waited); }
    add(polity.roadsUnpaid * 1e6);
    for (const work of polity.roadWorks) { add(work.to); add(work.tier); add(work.spent); add(work.cost); for (const [a, b] of work.edges) { add(a); add(b); } }
    for (const step of polity.decisions) { add(step.tick); add(ACTIONS.indexOf(step.chosen)); add(step.pick); add(step.outcome.length); add(step.options.length); for (const option of step.options) { add(option.score * 1000); add(option.target ?? -1); } }
  }
  for (const settlement of state.settlements) { add(settlement.cell); add(settlement.owner); add(settlement.status === 'alive' ? 1 : 0); add(settlement.capital ? 1 : 0); add(settlement.tier); add(settlement.urban); add(settlement.housing); add(settlement.urbanMean * 1000); for (const building of settlement.buildings) { add(building.type); add(building.condition * 1e6); } }
  for (const value of state.owner) add(value);
  for (let region = 0; region < state.stability.length; region++) { add(state.stability[region] * 1e6); add(state.unrest[region]); }
  // The capacity cache warm-starts later solves, so it is part of what determines history.
  for (let region = 0; region < state.capacity.length; region++) { add(state.capacity[region] * 1e3); add(state.capacityGame[region] * 1e6); add(state.overCapacity[region]); }
  for (const value of state.gameStock) add(value * 1e6);
  for (const value of state.hardship) add(value * 1e6);
  for (let region = 0; region < state.weather.length; region++) { add(state.weather[region] * 1e6); add(state.harvestFactor[region] * 1e6); add(state.drought[region]); add(state.famineRecent[region] * 1e3); add(state.famine[region]); }
  for (const [key, road] of state.roads) { add(key); add(road.tier); add(road.bridge ? 1 : 0); add(road.condition * 1e6); }
  for (const wonder of state.wonders) { add(wonder.type); add(wonder.settlement); add(wonder.spent); add(wonder.condition * 1e6); add(['building', 'standing', 'destroyed', 'abandoned'].indexOf(wonder.status)); add(wonder.waited); }
  return `${state.tick}:${state.chronicle.hash}:${(partition >>> 0).toString(16)}:${state.seed.toString(16)}:${(hash >>> 0).toString(16)}`;
}
