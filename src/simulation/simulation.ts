import { simulationDate, type KnowledgeReport, type ObserverFrame } from '../../shared/simulation.ts';
import { coreRegion, isWaterRegion, populate, produce, regionCapacity, spawnBands } from './bands.ts';
import { Chronicle } from './chronicle.ts';
import { buildFoodModel, farmingPotential } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import { checkInvariants } from './invariants.ts';
import { knownRegionCount } from './perception.ts';
import { regionAffinities, research, shareKnowing } from './research.ts';
import { SYSTEMS, type CenturyStats, type Ledger, type SimulationState, type SystemKey, type TickContext } from './state.ts';
import type { RegionPartition } from './regions.ts';
import { seedFromText, systemStream } from './rng.ts';
import { ERAS, TECH_INDEX, TECHS } from './techs.ts';
import { CLOCK_TUNING, SERIES_YEARS } from './tunables.ts';

/** Bump with every slice that changes rules or tuning (part of the world-instance identity). */
export const SIMULATION_RULES_VERSION = 4;

type SystemRun = (state: SimulationState, context: TickContext) => void;

/** Rules per system. Empty systems keep their slot, cadence and timing until a milestone fills them. */
const RUNS: Record<SystemKey, SystemRun> = {
  environment: () => {}, production: produce, population: populate, knowledge: research, culture: () => {},
  stability: () => {}, decisions: () => {}, construction: () => {}, diplomacy: () => {}, war: () => {}, fracture: () => {},
  chronicle: (state, context) => state.chronicle.flush(context.tick),
};

function emptyLedger(regions: number): Ledger {
  return {
    births: new Int32Array(regions), naturalDeaths: new Int32Array(regions), famineDeaths: new Int32Array(regions),
    migrantsIn: new Int32Array(regions), migrantsOut: new Int32Array(regions), before: new Int32Array(regions), food: new Map(),
  };
}

export function createSimulation(geography: SimulationGeography, partition: RegionPartition, seedText: string): SimulationState {
  const regions = partition.regions.length;
  const state: SimulationState = {
    seedText, seed: seedFromText(seedText), tick: 0, geography, partition, food: buildFoodModel(geography, partition),
    chronicle: new Chronicle(), cultures: [], polities: [], groups: [], living: [],
    settlements: [], owner: new Int32Array(regions).fill(-1), firsts: [], agricultureQuarterYear: -1, affinity: [],
    learnedCount: new Int32Array(TECHS.length), deathCount: 0, lineages: [],
    gameStock: new Float64Array(regions).fill(1), occupant: new Int32Array(regions).fill(-1), groupAt: new Int32Array(regions).fill(-1),
    capacity: new Float64Array(regions), overCapacity: new Int32Array(regions), capacityGame: new Float64Array(regions),
    ledger: emptyLedger(regions), habitable: new Uint8Array(regions), settledLandmasses: [],
    metrics: { silentBandYears: 0, maxOverCapacityMonths: 0, moves: 0, movesCitingPressure: 0, movesLedByPressure: 0, splits: 0, breakaways: 0, births: 0, deaths: 0, famineDeaths: 0, settled: 0, discoveries: 0, firstContacts: 0 },
    timing: { ms: new Float64Array(SYSTEMS.length), calls: new Float64Array(SYSTEMS.length) }, stats: [], series: [], checkedEvents: 0,
  };
  for (let region = 0; region < regions; region++) if (regionCapacity(state, region) > 0) state.habitable[region] = 1;
  state.affinity = regionAffinities(state);
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
  ledger.food.clear();
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
    else civKnown += knownRegionCount(polity);
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
  return {
    year, regions: state.partition.regions.length, polities: state.living.length, tribes, bands, civs: state.living.length - tribes, population,
    largestShare: population > 0 ? largest / population : 0, events: state.chronicle.events.length, occupiedRegions: occupied, largestRegions,
    waterPopulationShare: population > 0 ? waterPopulation / population : 0, waterRegionShare: waterRegions / state.partition.regions.length,
    bandMoves: m.moves, bandSplits: m.splits, bandBreakaways: m.breakaways, births: m.births, deaths: m.deaths, famineDeaths: m.famineDeaths,
    settlements: state.settlements.filter(settlement => settlement.status === 'alive').length, specialists,
    agricultureShare: Math.round(shareKnowing(state, 'Agriculture') * 1000) / 1000, leadingEra,
    occupiedHabitableShare: Math.round(occupiedHabitableShare * 1000) / 1000,
    firstContacts: m.firstContacts, civKnownRegions: state.living.length > tribes ? Math.round(civKnown / (state.living.length - tribes)) : 0,
  };
}

/** Name of an era index (statistics and the study). */
export const eraName = (era: number) => ERAS[era];

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
    for (const region of polity.map.observed) add(region);
    for (const [region, snapshot] of polity.map.snapshots) { add(region); add(snapshot.occupant); add(snapshot.owner); add(snapshot.tick); }
  }
  for (const settlement of state.settlements) { add(settlement.cell); add(settlement.owner); add(settlement.status === 'alive' ? 1 : 0); add(settlement.capital ? 1 : 0); }
  for (const value of state.owner) add(value);
  // The capacity cache warm-starts later solves, so it is part of what determines history.
  for (let region = 0; region < state.capacity.length; region++) { add(state.capacity[region] * 1e3); add(state.capacityGame[region] * 1e6); add(state.overCapacity[region]); }
  for (const value of state.gameStock) add(value * 1e6);
  return `${state.tick}:${state.chronicle.hash}:${(partition >>> 0).toString(16)}:${state.seed.toString(16)}:${(hash >>> 0).toString(16)}`;
}
