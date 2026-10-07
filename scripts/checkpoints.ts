import { parseWorldSettings, type WorldBundle } from '../shared/generated-world.ts';
import { CHECKPOINT_EVERY, checkpointYears, readCheckpoint, writeCheckpoint, type CheckpointStore } from '../server/workers/checkpoints.ts';
import { decodeGeography, type SimulationGeography } from '../src/simulation/geography.ts';
import { partitionRegions, type RegionPartition } from '../src/simulation/regions.ts';
import { SIMULATION_RULES_VERSION, createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import { restoreCheckpoint, takeCheckpoint } from '../src/simulation/snapshot.ts';
import type { SimulationState } from '../src/simulation/state.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/** The fork tool's side of checkpoints (development tooling, Dev 02): worlds, and a history's state at a year. The
 *  files themselves are `server/workers/checkpoints.ts`'s, shared with the lab. */

/** A seed's world through the lab's path, and the simulation's geography and regions for it. */
export async function loadWorld(seed: string, size: string) {
  const bundle = encodeGeneratedWorld(await generateWorld(parseWorldSettings({ seed, size })));
  return { bundle, ...decodeWorld(bundle) };
}

export function decodeWorld(bundle: WorldBundle): { geography: SimulationGeography; partition: RegionPartition } {
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

/** What a store's checkpoints must match on this world. */
export const expectFor = (store: CheckpointStore, geography: SimulationGeography) => ({ worldKey: geography.manifest.worldKey, rulesVersion: SIMULATION_RULES_VERSION, codeHash: store.codeHash });

/** The state at `year` of this seed's history: restored from the latest checkpoint at or before it and simulated on,
 *  keeping checkpoints every `CHECKPOINT_EVERY` years and at `year`. */
export async function stateAt(store: CheckpointStore, year: number, world: { geography: SimulationGeography; partition: RegionPartition }, log: (line: string) => void = () => {}) {
  const expect = expectFor(store, world.geography);
  const from = checkpointYears(store).filter(at => at <= year).at(-1);
  const stored = from === undefined ? null : readCheckpoint(store, from);
  const state: SimulationState = stored ? restoreCheckpoint(stored, world.geography, world.partition, expect) : createSimulation(world.geography, world.partition, store.seed);
  if (state.tick === year * 12) return state;
  const started = performance.now(), first = state.tick / 12;
  while (state.tick < year * 12) {
    stepSimulation(state, undefined, false);
    const at = state.tick / 12;
    if (state.tick % 12 === 0 && (at % CHECKPOINT_EVERY === 0 || at === year)) await writeCheckpoint(store, at, takeCheckpoint(state, { seed: store.seed, size: store.size, ...expect }));
  }
  log(`${store.seed}: simulated years ${first}–${year} for its checkpoint in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return state;
}
