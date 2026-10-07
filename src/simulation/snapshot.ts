import { habitableRegions, landValues } from './bands.ts';
import { Chronicle } from './chronicle.ts';
import { harshLand } from './culture.ts';
import { rankFarmland } from './fields.ts';
import { buildFoodModel } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import { REGION_PARTITION_VERSION, type RegionPartition } from './regions.ts';
import { regionAffinities } from './research.ts';
import type { SimulationState } from './state.ts';

/**
 * Checkpoints (development tooling, Dev 02; not VISION.md's slice P): a history's state at a moment, without the
 * parts its world and tunables determine — the geography and region partition, and what is derived from them once:
 * the food model, the field ranking, habitable land, regions' affinities, land value and harshness — which are rebuilt
 * on restore (so a fork's tunable overrides reach them). The state is plain data (the save-ready rule), so a checkpoint
 * is a structured-cloneable object; `server/workers/checkpoints.ts` writes it to disk. A checkpoint is tied to the code
 * that made it: the caller records the rules version and a hash of the simulation's code and refuses one from other
 * code; the checkpoint itself refuses another region partition.
 */

/** The parts of a state its world determines, never saved: the world itself, and what is derived from it. */
const WORLD = ['geography', 'partition'] as const;
const DERIVED = ['food', 'fieldRanking', 'habitable', 'affinity', 'landValue', 'harshness'] as const;
type WorldPart = typeof WORLD[number] | typeof DERIVED[number];
export type SavedState = Omit<SimulationState, WorldPart>;
export type WorldDerived = Pick<SimulationState, typeof DERIVED[number]>;

/** What identifies the code and world a checkpoint belongs to. */
export interface CheckpointMeta { seed: string; size: string; worldKey: string; rulesVersion: number; codeHash: string; tick: number }
export interface Checkpoint { format: 1; meta: CheckpointMeta; partition: string; state: SavedState }

/** A region partition's identity: its version, region count and a hash of every cell's region. */
export function partitionDigest(partition: RegionPartition) {
  let hash = 0x811c9dc5;
  for (const value of partition.regionOf) hash = Math.imul(hash ^ (value + 1), 16777619);
  return `${REGION_PARTITION_VERSION}:${partition.regions.length}:${(hash >>> 0).toString(16)}`;
}

/** What a world's tunables derive from it once (as `createSimulation` does). */
export function deriveWorld(geography: SimulationGeography, partition: RegionPartition): WorldDerived {
  const food = buildFoodModel(geography, partition), landValue = landValues({ partition, food });
  return {
    food, fieldRanking: rankFarmland(geography, partition), habitable: habitableRegions(food, partition.regions.length),
    affinity: regionAffinities({ geography, partition, food }), landValue, harshness: harshLand({ partition, landValue }),
  };
}

/** A checkpoint of `state` now (shares its objects: serialize or clone it before the history moves on). */
export function takeCheckpoint(state: SimulationState, meta: Omit<CheckpointMeta, 'tick'>): Checkpoint {
  const saved = { ...state } as Partial<SimulationState>;
  for (const part of [...WORLD, ...DERIVED]) delete saved[part];
  return { format: 1, meta: { ...meta, tick: state.tick }, partition: partitionDigest(state.partition), state: saved as SavedState };
}

/**
 * The state of a checkpoint (already deserialized, and not shared with anything else) on its world: a history that
 * continues exactly as the one it was taken from (with the same tunables). Refuses one made by other code, for another
 * world or on another region partition. A caller that already has this world's derived parts, built with the same
 * tunables (they are read-only), may pass them instead of having them rebuilt.
 */
export function restoreCheckpoint(checkpoint: Checkpoint, geography: SimulationGeography, partition: RegionPartition, expect: Omit<CheckpointMeta, 'tick' | 'seed' | 'size'>, derived?: WorldDerived): SimulationState {
  const meta = checkpoint.meta;
  if (checkpoint.format !== 1) throw new Error(`Unknown checkpoint format ${checkpoint.format}.`);
  if (meta.worldKey !== expect.worldKey) throw new Error(`The checkpoint is of world ${meta.worldKey}, not ${expect.worldKey}.`);
  if (meta.rulesVersion !== expect.rulesVersion || meta.codeHash !== expect.codeHash) {
    throw new Error(`The checkpoint was made by other simulation code (rules ${meta.rulesVersion}, code ${meta.codeHash}; now rules ${expect.rulesVersion}, code ${expect.codeHash}).`);
  }
  if (checkpoint.partition !== partitionDigest(partition)) throw new Error(`The checkpoint was made on another region partition (${checkpoint.partition}, now ${partitionDigest(partition)}).`);
  const world = derived ?? deriveWorld(geography, partition);
  const state = { ...checkpoint.state, geography, partition, ...Object.fromEntries(DERIVED.map(part => [part, world[part]])) } as SimulationState;
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  return state;
}
