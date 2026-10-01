import { simulationDate, type ObserverFrame } from '../../shared/simulation.ts';
import { Chronicle } from './chronicle.ts';
import type { SimulationGeography } from './geography.ts';
import { checkInvariants } from './invariants.ts';
import { SYSTEMS, type CenturyStats, type SimulationState, type SystemKey, type TickContext } from './state.ts';
import type { RegionPartition } from './regions.ts';
import { seedFromText, systemStream } from './rng.ts';
import { CLOCK_TUNING } from './tunables.ts';

/** Bump with every slice that changes rules or tuning (part of the world-instance identity). */
export const SIMULATION_RULES_VERSION = 1;

type SystemRun = (state: SimulationState, context: TickContext) => void;

/** Rules per system. Empty systems keep their slot, cadence and timing until a milestone fills them. */
const RUNS: Record<SystemKey, SystemRun> = {
  environment: () => {}, production: () => {}, population: () => {}, knowledge: () => {}, culture: () => {},
  stability: () => {}, decisions: () => {}, construction: () => {}, diplomacy: () => {}, war: () => {}, fracture: () => {},
  chronicle: (state, context) => state.chronicle.flush(context.tick),
};

export function createSimulation(geography: SimulationGeography, partition: RegionPartition, seedText: string): SimulationState {
  const state: SimulationState = {
    seedText, seed: seedFromText(seedText), tick: 0, geography, partition, chronicle: new Chronicle(),
    timing: { ms: new Float64Array(SYSTEMS.length), calls: new Float64Array(SYSTEMS.length) }, stats: [], checkedEvents: 0,
  };
  state.chronicle.flush(0);
  state.stats.push(collectStats(state, 0));
  return state;
}

/** Simulate one month. `now` supplies wall-clock milliseconds for per-system timing; it never affects results. */
export function stepSimulation(state: SimulationState, now: () => number = () => 0, verify = true) {
  const tick = state.tick, { year, month } = simulationDate(tick);
  for (const system of SYSTEMS) {
    const context: TickContext = { tick, year, month, stream: entity => systemStream(state.seed, tick, system.id, entity) };
    const started = now();
    RUNS[system.key](state, context);
    state.timing.ms[system.id] += now() - started;
    state.timing.calls[system.id]++;
  }
  state.tick = tick + 1;
  if (state.tick % (CLOCK_TUNING.statsYears * 12) === 0) state.stats.push(collectStats(state, state.tick / 12));
  if (verify) checkInvariants(state);
}

export function collectStats(state: SimulationState, year: number): CenturyStats {
  return { year, regions: state.partition.regions.length, polities: 0, bands: 0, civs: 0, population: 0, largestShare: 0, events: state.chronicle.events.length };
}

export function frameCounters(state: SimulationState): ObserverFrame['counters'] {
  return { regions: state.partition.regions.length, landmasses: state.partition.landmasses.length };
}

/** A digest of everything that determines future history: the clock, the chronicle and the region partition (M0). */
export function stateHash(state: SimulationState) {
  let partition = 0x811c9dc5;
  for (const value of state.partition.regionOf) partition = Math.imul(partition ^ (value + 1), 16777619);
  return `${state.tick}:${state.chronicle.hash}:${(partition >>> 0).toString(16)}:${state.seed.toString(16)}`;
}
