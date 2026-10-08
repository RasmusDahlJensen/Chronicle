import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { promisify } from 'node:util';
import { Check } from 'typebox/value';
import type { WorldBundle } from '../shared/generated-world.ts';
import { EVENT_TEMPLATES, describeEvent } from '../src/observer/events.ts';
import { EVENT_TYPES, SimulationControlSchema } from '../shared/simulation.ts';
import { checkpointYears, openCheckpointStore, readCheckpoint, simulationCodeHash, simulationSources, writeCheckpoint } from '../server/workers/checkpoints.ts';
import { decodeWorld } from '../scripts/checkpoints.ts';
import { applyOverrides, runFrom } from '../scripts/fork-core.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { applyScenario } from '../src/simulation/scenarios.ts';
import { createSimulation, SIMULATION_RULES_VERSION, stateHash, stepSimulation } from '../src/simulation/simulation.ts';
import { restoreCheckpoint, takeCheckpoint } from '../src/simulation/snapshot.ts';
import type { SimulationState } from '../src/simulation/state.ts';
import { TECHS } from '../src/simulation/techs.ts';
import { BAND_TUNING, ENVIRONMENT_TUNING, FOOD_TUNING, RESEARCH_TUNING } from '../src/simulation/tunables.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Development tooling (Dev 02): checkpoints, the fork core and command, and the scenario triggers. One history of a
 * standard world is simulated to year 900 (civilizations by then) and shared by the tests, which work on copies of it.
 */
const SEED = 'Dev tools', YEAR = 900;
let bundle: WorldBundle, history: SimulationState;
const meta = { seed: SEED, size: 'standard', rulesVersion: SIMULATION_RULES_VERSION, codeHash: 'test-code' };
const copy = (state: SimulationState) => { const clone: SimulationState = structuredClone(state); Object.setPrototypeOf(clone.chronicle, Chronicle.prototype); return clone; };
const expect = (state: SimulationState) => ({ worldKey: state.geography.manifest.worldKey, rulesVersion: SIMULATION_RULES_VERSION, codeHash: 'test-code' });
const checkpointOf = (state: SimulationState) => structuredClone(takeCheckpoint(state, { ...meta, worldKey: state.geography.manifest.worldKey }));

before(async () => {
  bundle = encodeGeneratedWorld(await generateWorld({ seed: SEED, size: 'standard' }));
  const world = decodeWorld(bundle);
  history = createSimulation(world.geography, world.partition, SEED);
  while (history.tick < YEAR * 12) stepSimulation(history, () => 0, false);
  assert.ok(history.living.some(id => history.polities[id].kind === 'civ'), 'civilizations by then');
});

test('a checkpoint written to disk and restored on a freshly built world continues exactly as the original', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = copy(history), store = openCheckpointStore(root, SEED, 'standard', 'test-code');
  const checkpoint = takeCheckpoint(original, { ...meta, worldKey: original.geography.manifest.worldKey });
  for (const part of ['geography', 'partition', 'food', 'fieldRanking', 'habitable', 'affinity', 'landValue', 'harshness']) assert.ok(!(part in checkpoint.state), `${part} is rebuilt, not saved`);
  await writeCheckpoint(store, YEAR, checkpoint);
  assert.deepEqual(checkpointYears(store), [YEAR]);
  assert.equal(readCheckpoint(store, YEAR + 1), null, 'a missing checkpoint reads as none');
  const world = decodeWorld(bundle), stored = readCheckpoint(store, YEAR);
  assert.ok(stored);
  assert.equal(stored.meta.tick, YEAR * 12);
  const restored = restoreCheckpoint(stored, world.geography, world.partition, expect(original));
  // What the world derives is rebuilt exactly as the history first derived it.
  assert.deepEqual(restored.habitable, original.habitable);
  assert.deepEqual(restored.landValue, original.landValue);
  assert.deepEqual(restored.harshness, original.harshness);
  assert.deepEqual(restored.affinity, original.affinity);
  assert.equal(stateHash(restored), stateHash(original));
  for (let month = 0; month < 240; month++) { stepSimulation(original); stepSimulation(restored); }
  assert.equal(stateHash(restored), stateHash(original));
  assert.equal(restored.chronicle.hash, original.chronicle.hash);
  // Opening a store removes that world's checkpoints from other code.
  const stale = join(root, 'Dev_tools-standard', `r${SIMULATION_RULES_VERSION}-0123456789abcdef`);
  mkdirSync(stale, { recursive: true }); writeFileSync(join(stale, 'year-250.v8.gz'), '');
  openCheckpointStore(root, SEED, 'standard', 'test-code');
  assert.equal(existsSync(stale), false);
  assert.deepEqual(checkpointYears(store), [YEAR]);
});

test('a checkpoint from other simulation code, another world or another partition is refused', () => {
  const world = decodeWorld(bundle), checkpoint = checkpointOf(history);
  assert.throws(() => restoreCheckpoint(checkpoint, world.geography, world.partition, { ...expect(history), codeHash: 'other-code' }), /other simulation code/);
  assert.throws(() => restoreCheckpoint(checkpoint, world.geography, world.partition, { ...expect(history), rulesVersion: SIMULATION_RULES_VERSION + 1 }), /other simulation code/);
  assert.throws(() => restoreCheckpoint(checkpoint, world.geography, world.partition, { ...expect(history), worldKey: 'climate-6:standard:Elsewhere' }), /world/);
  assert.throws(() => restoreCheckpoint({ ...checkpoint, partition: '1:3:abc' }, world.geography, world.partition, expect(history)), /partition/);
  assert.throws(() => restoreCheckpoint({ ...checkpoint, format: 2 as 1 }, world.geography, world.partition, expect(history)), /format/);
});

test('the code hash covers the simulation, its tunables and everything it imports', () => {
  const sources = simulationSources();
  for (const path of ['src/simulation/simulation.ts', 'src/simulation/scenarios.ts', 'src/simulation/tunables.ts', 'shared/simulation.ts', 'shared/atlas.ts', 'shared/generated-world.ts', 'src/world/resources.ts']) assert.ok(sources.includes(path), path);
  assert.ok(!sources.some(path => path.startsWith('server/') || path.startsWith('src/components/')), 'only what the simulation runs on');
  assert.match(simulationCodeHash(), /^[0-9a-f]{16}$/);
});

test('tunable overrides are checked, take effect and are undone', () => {
  const splitRate = BAND_TUNING.splitRate, unit = FOOD_TUNING.unitsPerPersonMonth;
  assert.throws(() => applyOverrides({ BAND_TUNING: { splitRat: 0.9 } }), /not a tunable/);
  assert.throws(() => applyOverrides({ BAND_TUNING: { toString: 0.9 } }), /not a tunable/);
  assert.throws(() => applyOverrides({ BAND_TUNING: { splitRate: 'high' } }), /must stay a number/);
  assert.throws(() => applyOverrides({ BAND_TUNING: { splitRate: -3 } }), /Invalid simulation tunables/);
  assert.throws(() => applyOverrides({ NO_TUNING: { x: 1 } }), /not a tunables object/);
  assert.throws(() => applyOverrides({ FOOD_TUNING: { unitsPerPersonMonth: unit * 2 } }), /a unit/);
  assert.throws(() => applyOverrides({ REGION_TUNING: { minAreaKm2: 1 } }), /shapes the regions/);
  assert.equal(BAND_TUNING.splitRate, splitRate, 'a refused override leaves the tunables as they were');
  const undo = applyOverrides({ BAND_TUNING: { splitRate: 0.95 } });
  assert.equal(BAND_TUNING.splitRate, 0.95);
  undo();
  assert.equal(BAND_TUNING.splitRate, splitRate);
});

test('a fork\'s baseline is the history\'s own continuation; a variant restored under its overrides departs from it', () => {
  const world = decodeWorld(bundle), direct = copy(history);
  const baseline = runFrom(restoreCheckpoint(checkpointOf(history), world.geography, world.partition, expect(history)), 30);
  while (direct.tick < (YEAR + 30) * 12) stepSimulation(direct);
  assert.equal(baseline.stateHash, stateHash(direct));
  assert.equal(baseline.eventLogHash, direct.chronicle.hash);
  assert.equal(baseline.from, YEAR);
  assert.equal(baseline.to, YEAR + 30);
  assert.equal(Object.values(baseline.events).reduce((sum, count) => sum + count, 0), direct.chronicle.events.length - history.chronicle.events.length);
  // As the fork command does it: overrides first, then the restore rebuilds what the world derives with them.
  let undo = applyOverrides({ ENVIRONMENT_TUNING: { droughtChance: Math.min(1, ENVIRONMENT_TUNING.droughtChance * 10) } });
  try {
    const variant = runFrom(restoreCheckpoint(checkpointOf(history), world.geography, world.partition, expect(history)), 30);
    assert.notEqual(variant.stateHash, baseline.stateHash);
    assert.ok((variant.events.drought ?? 0) > (baseline.events.drought ?? 0), 'more droughts with a higher drought chance');
  } finally { undo(); }
  undo = applyOverrides({ RESEARCH_TUNING: { affinityShare: RESEARCH_TUNING.affinityShare / 2 } });
  try {
    const restored = restoreCheckpoint(checkpointOf(history), world.geography, world.partition, expect(history));
    assert.notDeepEqual(restored.affinity, history.affinity, 'derived parts follow the overrides');
  } finally { undo(); }
});

test('the fork command compares a baseline and a variant from a checkpoint it makes', { timeout: 300_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-fork-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, 'out'), variant = JSON.stringify({ BAND_TUNING: { splitRate: 0.95 } });
  await promisify(execFile)(process.execPath, ['scripts/fork.ts', '--seed', 'Fork smoke', '--size', 'standard', '--at', '60', '--years', '20', '--variant', `busy=${variant}`,
    '--stats', 'population,tribes,nonsense', '--checkpoints', join(root, 'checkpoints'), '--out', out, '--concurrency', '2']);
  const comparison = await readFile(join(out, 'comparison.md'), 'utf8'), results = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
  assert.match(comparison, /\| Statistic at the end \| baseline \| busy \| Δ \|/);
  assert.match(comparison, /Unknown statistics left out: nonsense/);
  assert.match(comparison, /\| population \|/);
  const runs = results.results['Fork smoke'];
  assert.deepEqual(Object.keys(runs), ['baseline', 'busy']);
  assert.ok(runs.baseline.ok && runs.busy.ok);
  assert.equal(runs.baseline.result.to, 80);
  assert.notEqual(runs.busy.result.eventLogHash, runs.baseline.result.eventLogHash);
  assert.ok(existsSync(join(root, 'checkpoints', 'Fork_smoke-standard')), 'the checkpoint went where it was told');
});

test('the scenario triggers act through the real rules, say so, and keep the invariants', () => {
  const state = copy(history), untouched = copy(history);
  const civ = state.polities[state.living.find(id => state.polities[id].kind === 'civ')!];
  const home = state.groups[civ.core].region;
  const newEvents = (from: number) => state.chronicle.events.slice(from).map(event => event.type);
  const said = (from: number) => describeEvent(state.chronicle.events[from]);

  // A drought: the longest there is, here and on the habitable land around.
  let from = state.chronicle.events.length;
  assert.equal(applyScenario(state, 'drought', home), null);
  for (const at of [home, ...state.partition.regions[home].neighbors.map(edge => edge.region).filter(region => state.habitable[region])]) assert.equal(state.drought[at], ENVIRONMENT_TUNING.droughtYears * 12);
  assert.deepEqual(newEvents(from), ['devScenario', 'drought']);
  assert.equal(said(from), `Development control (test only): a drought is set off in region ${home}.`);
  assert.equal(state.chronicle.events.at(-1)?.causes[0].factor, 'developmentControl');
  assert.equal(state.chronicle.events.at(-1)?.tick, state.tick - 1, 'dated to the month just simulated');

  // Research: what they were researching is learned now, with the discovery's own event.
  const tech = civ.knowledge.target;
  assert.ok(tech >= 0);
  from = state.chronicle.events.length;
  assert.equal(applyScenario(state, 'research', home), null);
  assert.equal(civ.knowledge.known[tech], 1);
  assert.deepEqual(newEvents(from), ['devScenario', 'techDiscovered']);
  assert.equal(said(from), `Development control (test only): the ${civ.name} are made to finish their research.`);
  assert.equal(state.chronicle.events.at(-1)?.data.tech, TECHS[tech].name);

  // A religion: founded by the civilization, its heartland's faith and its state religion at once.
  from = state.chronicle.events.length;
  const religions = state.religions.length;
  assert.equal(applyScenario(state, 'foundReligion', home), null);
  assert.equal(state.religions.length, religions + 1);
  assert.equal(civ.stateReligion, religions);
  assert.equal(state.groups[civ.core].faith, religions);
  assert.deepEqual(newEvents(from), ['devScenario', 'religionFounded']);
  assert.match(said(from), new RegExp(`^Development control \\(test only\\): the ${civ.name} are made to found a religion(, before they know Organized religion)?\\.$`));

  // A split: the region's people and their same-culture neighbours in the realm become a daughter culture.
  from = state.chronicle.events.length;
  const parent = state.cultures[state.groups[civ.core].culture], cultures = state.cultures.length;
  assert.equal(applyScenario(state, 'splitCulture', home), null);
  assert.equal(state.cultures.length, cultures + 1);
  assert.equal(state.groups[civ.core].culture, cultures);
  assert.equal(civ.culture, cultures, 'the realm is ruled by its heartland\'s new culture');
  assert.deepEqual(state.cultures[cultures].parents.map(entry => entry.id), [parent.id]);
  assert.deepEqual(newEvents(from), ['devScenario', 'cultureSplit']);
  assert.equal(said(from), `Development control (test only): the people of region ${home} and their neighbours are made to split off from their culture.`);
  let left = 0;
  for (const id of state.living) for (const groupId of state.polities[id].groups) if (state.groups[groupId].culture === parent.id) left += state.groups[groupId].size;
  assert.equal(parent.people, left, 'the parent counts the people who stayed');

  // Refusals change nothing.
  const tribe = state.living.find(id => state.polities[id].kind === 'band');
  assert.ok(tribe !== undefined, 'tribes still roam at year 900');
  const empty = state.partition.regions.findIndex((_, region) => state.groupAt[region] < 0);
  from = state.chronicle.events.length;
  assert.match(applyScenario(state, 'foundReligion', state.groups[state.polities[tribe].core].region) ?? '', /tribe/);
  assert.match(applyScenario(state, 'research', empty) ?? '', /Nobody lives/);
  assert.match(applyScenario(state, 'drought', -1) ?? '', /no region/);
  assert.equal(state.chronicle.events.length, from);
  assert.equal(state.devActions, 4);

  // The altered history says so in its hash, and runs on under the invariants.
  assert.notEqual(stateHash(state), stateHash(untouched));
  for (let month = 0; month < 24; month++) stepSimulation(state);
});

test('before the first month no scenario applies, and a fresh history is unaltered', () => {
  const world = decodeWorld(bundle), state = createSimulation(world.geography, world.partition, SEED);
  const region = state.groups[state.polities[state.living[0]].core].region;
  assert.match(applyScenario(state, 'drought', region) ?? '', /simulate a month first/);
  assert.equal(state.devActions, 0);
  stepSimulation(state);
  assert.equal(applyScenario(state, 'drought', region), null, 'from the first month on');
});

test('event templates never nest conditionals (the renderer cannot)', () => {
  for (const type of EVENT_TYPES) {
    // A conditional may hold names and counted nouns ({key|one|many}), never another conditional.
    const flat = EVENT_TEMPLATES[type].replace(/\{\?(\w+)\|((?:[^{}]|\{@?\w+(?:\|[^{}|]*\|[^{}|]*)?\})*)\}/g, '').replace(/\{\w+\|[^{}|]*\|[^{}|]*\}/g, '');
    assert.ok(!flat.includes('{?') && !flat.includes('|'), `${type}: ${EVENT_TEMPLATES[type]}`);
  }
});

test('counted nouns in event texts agree with their counts: one region, one art (the U close-out review)', () => {
  // A plain count before a plural noun is right only inside a guard that holds for more than one (more, many, several…).
  const plural = /^(more|many|moreRegions|severalYears|others|both)$/;
  for (const type of EVENT_TYPES) {
    const unguarded = EVENT_TEMPLATES[type].replace(/\{\?(\w+)\|((?:[^{}]|\{@?\w+(?:\|[^{}|]*\|[^{}|]*)?\})*)\}/g, (_match, flag: string, text: string) => plural.test(flag) ? '' : text);
    assert.doesNotMatch(unguarded, /\{\w+\} (regions|arts|realms|peoples|settlements|soldiers|years)\b/, `${type}: ${EVENT_TEMPLATES[type]}`);
  }
});

test('the contract accepts the development controls and refuses malformed ones', () => {
  assert.ok(Check(SimulationControlSchema, { action: 'scenario', scenario: 'splitCulture', region: 12 }));
  assert.ok(Check(SimulationControlSchema, { action: 'load', year: 1800 }));
  for (const control of [{ action: 'scenario', scenario: 'plague', region: 1 }, { action: 'scenario', scenario: 'drought' }, { action: 'scenario', scenario: 'drought', region: 1.5 }, { action: 'scenario', scenario: 'drought', region: 1, extra: true },
    { action: 'load' }, { action: 'load', year: -1 }, { action: 'load', year: 5001 }]) {
    assert.equal(Check(SimulationControlSchema, control), false, JSON.stringify(control));
  }
});
