import type { Chronicle } from './chronicle.ts';
import type { SimulationGeography } from './geography.ts';
import type { RegionPartition } from './regions.ts';
import type { systemStream } from './rng.ts';

/**
 * The fixed system order of one monthly tick (VISION.md "System order per monthly tick"). Systems with longer
 * cadences still run every month and select the entities due this month (staggered by id), so their cost spreads
 * evenly. Ids index the per-system RNG streams and timing counters; append only.
 */
export const SYSTEMS = [
  { id: 0, key: 'environment', label: 'Environment' },
  { id: 1, key: 'production', label: 'Production' },
  { id: 2, key: 'population', label: 'Population' },
  { id: 3, key: 'knowledge', label: 'Knowledge' },
  { id: 4, key: 'culture', label: 'Culture and religion' },
  { id: 5, key: 'stability', label: 'Stability' },
  { id: 6, key: 'decisions', label: 'Decisions' },
  { id: 7, key: 'construction', label: 'Construction' },
  { id: 8, key: 'diplomacy', label: 'Diplomacy and trade' },
  { id: 9, key: 'war', label: 'War' },
  { id: 10, key: 'fracture', label: 'Fracture' },
  { id: 11, key: 'chronicle', label: 'Chronicle' },
] as const;
export type SystemKey = typeof SYSTEMS[number]['key'];

export interface CenturyStats {
  year: number; regions: number; polities: number; bands: number; civs: number; population: number;
  largestShare: number; events: number;
}
export interface SimulationState {
  seedText: string; seed: number; tick: number;
  geography: SimulationGeography; partition: RegionPartition;
  chronicle: Chronicle;
  timing: { ms: Float64Array; calls: Float64Array };
  stats: CenturyStats[];
  /** Highest event id already checked by the invariants. */
  checkedEvents: number;
}
/**
 * What a system sees of the current tick. `stream(entity)` returns a fresh generator keyed by (seed, tick, system,
 * entity): calling it twice with the same entity in one tick repeats the same numbers, so take one stream per entity
 * and draw from it, or pass distinct entity keys.
 */
export interface TickContext { tick: number; year: number; month: number; stream(entity?: number): ReturnType<typeof systemStream> }
