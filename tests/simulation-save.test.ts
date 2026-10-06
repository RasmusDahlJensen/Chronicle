import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stateHash, stepSimulation } from '../src/simulation/simulation.ts';
import type { SimulationState } from '../src/simulation/state.ts';

/**
 * Save-readiness (VISION.md rule 2: until persistence is built, every slice keeps the state save-ready). The whole
 * simulation state is plain data — objects, arrays, typed arrays, maps and sets — that a structured clone copies
 * completely; the chronicle alone is a class and gets its prototype back. A copy taken mid-history, with civilizations,
 * settlements, buildings, roads and fields, then continues exactly as the original.
 */
test('a state copied mid-history continues exactly as the original (save-ready)', async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Save ready', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  const state = createSimulation(geography, partitionRegions(geography), 'Save ready');
  while (state.tick < 900 * 12) stepSimulation(state, () => 0, false);
  assert.ok(state.polities.some(polity => polity.kind === 'civ' && polity.deathTick === null), 'civilizations by then');
  const copy: SimulationState = structuredClone(state);
  Object.setPrototypeOf(copy.chronicle, Chronicle.prototype);
  assert.equal(stateHash(copy), stateHash(state));
  for (let month = 0; month < 240; month++) { stepSimulation(state); stepSimulation(copy); }
  assert.equal(stateHash(copy), stateHash(state));
  assert.equal(copy.chronicle.hash, state.chronicle.hash);
});
