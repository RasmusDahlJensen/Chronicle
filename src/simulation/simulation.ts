import { simulationDate, type ObserverFrame } from '../../shared/simulation.ts';
import { isWaterRegion, populate, produce, regionCapacity, spawnBands } from './bands.ts';
import { Chronicle } from './chronicle.ts';
import { buildFoodModel } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import { checkInvariants } from './invariants.ts';
import { SYSTEMS, type CenturyStats, type Ledger, type SimulationState, type SystemKey, type TickContext } from './state.ts';
import type { RegionPartition } from './regions.ts';
import { seedFromText, systemStream } from './rng.ts';
import { CLOCK_TUNING, SERIES_YEARS } from './tunables.ts';

/** Bump with every slice that changes rules or tuning (part of the world-instance identity). */
export const SIMULATION_RULES_VERSION = 2;

type SystemRun = (state: SimulationState, context: TickContext) => void;

/** Rules per system. Empty systems keep their slot, cadence and timing until a milestone fills them. */
const RUNS: Record<SystemKey, SystemRun> = {
  environment: () => {}, production: state => produce(state), population: populate, knowledge: () => {}, culture: () => {},
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
    chronicle: new Chronicle(), cultures: [], polities: [], groups: [], bands: [],
    gameStock: new Float64Array(regions).fill(1), occupant: new Int32Array(regions).fill(-1),
    capacity: new Float64Array(regions), overCapacity: new Int32Array(regions),
    ledger: emptyLedger(regions), habitable: new Uint8Array(regions), settledLandmasses: [],
    metrics: { silentBandYears: 0, maxOverCapacityMonths: 0, moves: 0, movesCitingPressure: 0, movesLedByPressure: 0, splits: 0, births: 0, deaths: 0, famineDeaths: 0 },
    timing: { ms: new Float64Array(SYSTEMS.length), calls: new Float64Array(SYSTEMS.length) }, stats: [], series: [], checkedEvents: 0,
  };
  for (let region = 0; region < regions; region++) if (regionCapacity(state, region) > 0) state.habitable[region] = 1;
  spawnBands(state);
  state.settledLandmasses = [...new Set(state.bands.map(id => partition.regions[state.polities[id].region].landmass))].sort((a, b) => a - b);
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
  for (const id of state.bands) { const group = state.groups[state.polities[id].group]; ledger.before[group.region] += group.size; }
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
  for (const id of state.bands) total += state.groups[state.polities[id].group].size;
  return total;
}

function seriesPoint(state: SimulationState, year: number): [number, number, number] {
  return [year, worldPopulation(state), state.bands.length];
}

export function collectStats(state: SimulationState, year: number): CenturyStats {
  let population = 0, largest = 0, waterPopulation = 0;
  for (const id of state.bands) {
    const band = state.polities[id], size = state.groups[band.group].size;
    population += size; largest = Math.max(largest, size);
    if (isWaterRegion(state, band.region)) waterPopulation += size;
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
    year, regions: state.partition.regions.length, polities: state.bands.length, bands: state.bands.length, civs: 0, population,
    largestShare: population > 0 ? largest / population : 0, events: state.chronicle.events.length, occupiedRegions: state.bands.length,
    waterPopulationShare: population > 0 ? waterPopulation / population : 0, waterRegionShare: waterRegions / state.partition.regions.length,
    bandMoves: m.moves, bandSplits: m.splits, births: m.births, deaths: m.deaths, famineDeaths: m.famineDeaths,
    occupiedHabitableShare: Math.round(occupiedHabitableShare * 1000) / 1000,
  };
}

export function frameCounters(state: SimulationState): ObserverFrame['counters'] {
  return { regions: state.partition.regions.length, landmasses: state.partition.landmasses.length };
}

/** A digest of everything that determines future history: clock, chronicle, partition, seed, groups and game. */
export function stateHash(state: SimulationState) {
  let partition = 0x811c9dc5, hash = 0x811c9dc5;
  for (const value of state.partition.regionOf) partition = Math.imul(partition ^ (value + 1), 16777619);
  const add = (value: number) => { hash = Math.imul(hash ^ (value | 0), 16777619); hash = Math.imul(hash ^ Math.round((value % 1) * 1e9), 16777619); };
  add(state.tick);
  for (const group of state.groups) { add(group.size); add(group.region); add(group.store); add(group.birthCarry); add(group.naturalCarry); add(group.famineCarry); }
  for (const value of state.gameStock) add(value * 1e6);
  return `${state.tick}:${state.chronicle.hash}:${(partition >>> 0).toString(16)}:${state.seed.toString(16)}:${(hash >>> 0).toString(16)}`;
}
