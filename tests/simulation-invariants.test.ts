import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { SimulationState } from '../src/simulation/state.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * The invariants catch what they guard (VISION.md "invariants each tick"; made cheaper in Dev 03 without loosening
 * them): each test corrupts a copy of a real history with settlements and expects the check to fail.
 */
let history: SimulationState;
const copy = () => { const clone: SimulationState = structuredClone(history); Object.setPrototypeOf(clone.chronicle, Chronicle.prototype); return clone; };
const broken = (corrupt: (state: SimulationState) => void, message: RegExp) => {
  const state = copy();
  checkInvariants(state);
  corrupt(state);
  assert.throws(() => checkInvariants(state), (error: unknown) => error instanceof InvariantError && message.test(error.message));
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (history.tick < 750 * 12) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(history.settlements.length > 10, 'settlements by then');
});

test('the region index: listed once, in its own region, ids in range and in place', () => {
  const region = (state: SimulationState) => state.settlements[0].region;
  broken(state => state.regionSettlements[region(state)].push(0), /twice or not at all/);
  broken(state => {
    const from = state.regionSettlements[region(state)], other = (region(state) + 1) % state.regionSettlements.length;
    from.splice(from.indexOf(0), 1); state.regionSettlements[other].push(0);
  }, /missing from region|names settlement/);
  broken(state => state.regionSettlements[region(state)].push(state.settlements.length + 5), /twice or not at all/);
  broken(state => { state.settlements[1] = { ...state.settlements[1], id: state.settlements.length + 7 }; }, /at place 1/);
});

test('cultures, peoples and harvests stay within their bounds', () => {
  broken(state => { const culture = state.cultures.find(entry => entry.traits.length > 0) ?? state.cultures[0]; culture.traits = [0, 0]; }, /inconsistent traits/);
  broken(state => { state.groups[state.polities[state.living[0]].core].values.expansionism = Number.NaN; }, /expansionism/);
  broken(state => { state.groups[state.polities[state.living[0]].core].values.militarism = 1.2; }, /militarism/);
  broken(state => { state.harvestFactor[0] = 0.01; }, /harvest/);
});
