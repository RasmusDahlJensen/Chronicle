import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENT_TYPES, parseObserverFrame, SIMULATION_PROTOCOL_VERSION, simulationDate } from '../shared/simulation.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng, mix, stepProbability, systemStream } from '../src/simulation/rng.ts';
import { createSimulation, stateHash, stepSimulation } from '../src/simulation/simulation.ts';
import { SYSTEMS } from '../src/simulation/state.ts';
import { REGION_TUNING, validateTunables } from '../src/simulation/tunables.ts';
import { describeEvent, EVENT_TEMPLATES } from '../src/observer/events.ts';

test('system streams are reproducible and independent of each other', () => {
  const draw = (rng: ReturnType<typeof createRng>) => Array.from({ length: 5 }, () => rng.next());
  assert.deepEqual(draw(systemStream(7, 120, 2)), draw(systemStream(7, 120, 2)));
  assert.notDeepEqual(draw(systemStream(7, 120, 2)), draw(systemStream(7, 120, 3)), 'another system draws other numbers');
  assert.notDeepEqual(draw(systemStream(7, 120, 2)), draw(systemStream(7, 121, 2)), 'another tick draws other numbers');
  assert.notDeepEqual(draw(systemStream(7, 120, 2, 1)), draw(systemStream(7, 120, 2, 2)), 'entity streams are independent');
  // Adding draws to one system's stream cannot shift another system's stream: streams are pure functions of their key.
  const before = draw(systemStream(7, 120, 4)); draw(systemStream(7, 120, 3)); draw(systemStream(7, 120, 3));
  assert.deepEqual(draw(systemStream(7, 120, 4)), before);
  const rng = createRng(1, 2, 3);
  const buckets = new Array(10).fill(0);
  for (let at = 0; at < 20_000; at++) { const value = rng.next(); assert.ok(value >= 0 && value < 1); buckets[Math.floor(value * 10)]++; }
  assert.ok(buckets.every(count => count > 1_800 && count < 2_200), `uniform draws: ${buckets}`);
  assert.equal(createRng(5).weighted([0, 0, 0]), -1);
  assert.equal(createRng(5).weighted([0, 3, 0]), 1);
  assert.notEqual(mix(1, 2), mix(2, 1));
  assert.ok(Math.abs(stepProbability(0.1, 1) - 0.1) < 1e-15);
  assert.ok(Math.abs(stepProbability(0.1, 1 / 12) * 12 - 0.1) < 0.006, 'monthly steps of a yearly probability add up to about the yearly value');
  assert.ok(Math.abs(1 - (1 - stepProbability(0.2, 1 / 12)) ** 12 - 0.2) < 1e-12, 'twelve monthly steps compound exactly to the yearly probability');
});

test('the chronicle assigns ids in flush order, hashes its log and pages from a cursor', () => {
  const chronicle = new Chronicle();
  chronicle.emit({ type: 'bandSpawned', importance: 0.5, region: 3, data: { population: 120 } });
  chronicle.emit({ type: 'famine', importance: 0.2, region: 4, causes: [{ factor: 'drought', weight: 0.7 }] });
  assert.equal(chronicle.events.length, 0, 'events wait for the chronicle system');
  chronicle.flush(12);
  assert.deepEqual(chronicle.events.map(event => [event.id, event.tick, event.type]), [[0, 12, 'bandSpawned'], [1, 12, 'famine']]);
  const other = new Chronicle();
  other.emit({ type: 'bandSpawned', importance: 0.5, region: 3, data: { population: 120 } });
  other.flush(12);
  assert.notEqual(other.hash, chronicle.hash);
  other.emit({ type: 'famine', importance: 0.2, region: 4, causes: [{ factor: 'drought', weight: 0.7 }] });
  other.flush(12);
  assert.equal(other.hash, chronicle.hash, 'the same log in the same order has the same hash');
  assert.deepEqual(chronicle.since(1, 10).map(event => event.id), [1]);
  for (let at = 0; at < 30; at++) chronicle.emit({ type: 'unrest', importance: 0.1 });
  chronicle.flush(13);
  assert.deepEqual(chronicle.since(0, 5).map(event => event.id), [27, 28, 29, 30, 31], 'a cursor far behind receives the newest events');
});

test('every event type has a text template that fills its data, actors and region', () => {
  assert.deepEqual(Object.keys(EVENT_TEMPLATES).sort(), [...EVENT_TYPES].sort());
  const text = describeEvent({
    id: 0, tick: 0, type: 'bandSpawned', actors: [{ id: 4, role: 'band' }], region: 17, settlement: null, causes: [], parents: [],
    importance: 0.5, data: { population: 1200, name: 'Tarun', culture: 'Vaeli' },
  });
  assert.equal(text, 'The Tarun band of 1,200 people (Vaeli culture) appears in region 17.');
  assert.equal(describeEvent({ id: 1, tick: 0, type: 'raid', actors: [{ id: 4, role: 'attacker' }], region: 2, settlement: null, causes: [], parents: [], importance: 0, data: {} },
    id => `Band ${id}`), 'Band 4 raids ? in region 2.', 'actor names come from the observer, missing ones show as ?');
  assert.match(describeEvent({ id: 0, tick: 0, type: 'famine', actors: [], region: null, settlement: null, causes: [], parents: [], importance: 0, data: {} }), /\?/);
  // `{?key|text}` adds its text only when the value is true.
  const discovery = (first: boolean) => describeEvent({ id: 2, tick: 0, type: 'techDiscovered', actors: [], region: 3, settlement: null, causes: [], parents: [], importance: 0, data: { name: 'Kavo', tech: 'Agriculture', era: 'Neolithic', first } });
  assert.equal(discovery(true), 'The Kavo learn Agriculture (Neolithic era), the first people in the world to do so.');
  assert.equal(discovery(false), 'The Kavo learn Agriculture (Neolithic era).');
  // The conditional text may hold placeholders of its own.
  const event = (type: 'techDiscovered' | 'bandJoined' | 'unification' | 'knowledgeShared', data: Record<string, string | number | boolean>) =>
    describeEvent({ id: 3, tick: 0, type, actors: [], region: 3, settlement: null, causes: [], parents: [], importance: 0, data });
  assert.equal(event('techDiscovered', { name: 'Kavo', tech: 'Pottery', era: 'Neolithic', first: false, taught: true, teacher: 'Ora' }), 'The Kavo learn Pottery (Neolithic era), helped by the Ora.');
  assert.equal(event('techDiscovered', { name: 'Kavo', tech: 'Pottery', era: 'Neolithic', first: false, taught: false }), 'The Kavo learn Pottery (Neolithic era).');
  assert.equal(event('bandJoined', { name: 'Kesh', civ: 'Ora', population: 900, regions: 2, kin: false, learned: true, techs: 1 }), 'The Kesh tribe of 900 people joins the Ora, bringing 2 regions and 1 arts the Ora did not know.');
  assert.equal(event('unification', { name: 'Tal', civ: 'Ora', regions: 3, population: 5000, kin: true, learned: false, techs: 0 }), 'The Tal join the Ora, their kin: 3 regions and 5,000 people unite under one rule.');
  assert.equal(event('knowledgeShared', { name: 'Ora', other: 'Kesh', years: 40 }), 'The Ora and the Kesh agree to share what they know for 40 years.');
});

test('tunables are validated before a simulation starts', () => {
  assert.doesNotThrow(validateTunables);
  const original = REGION_TUNING.minAreaKm2;
  (REGION_TUNING as { minAreaKm2: number }).minAreaKm2 = REGION_TUNING.maxAreaKm2;
  try { assert.throws(validateTunables, /region areas/); } finally { (REGION_TUNING as { minAreaKm2: number }).minAreaKm2 = original; }
});

test('determinism: the same world and seed give identical history, systems run in their fixed order and invariants hold', async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Determinism', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  const partition = partitionRegions(geography);
  assert.deepEqual(SYSTEMS.map(system => system.key), ['environment', 'production', 'population', 'knowledge', 'culture', 'stability', 'decisions', 'construction', 'diplomacy', 'war', 'fracture', 'chronicle']);
  const run = () => {
    const state = createSimulation(geography, partition, 'Determinism');
    for (let month = 0; month < 12 * 120; month++) stepSimulation(state);
    return state;
  };
  const first = run(), second = run();
  assert.ok(first.chronicle.events.length > 30, 'bands spawn, split and move, so the log has real history to compare');
  assert.equal(stateHash(first), stateHash(second));
  const other = createSimulation(geography, partition, 'Another seed');
  for (let month = 0; month < 12 * 120; month++) stepSimulation(other);
  assert.notEqual(other.chronicle.hash, first.chronicle.hash, 'another simulation seed gives another history');
  assert.equal(first.chronicle.hash, second.chronicle.hash);
  assert.deepEqual(first.stats, second.stats);
  assert.deepEqual(first.stats.map(row => row.year), [0, 100]);
  assert.equal(first.tick, 1440);
  assert.deepEqual(simulationDate(first.tick), { year: 120, month: 1 });
  assert.ok([...first.timing.calls].every(calls => calls === 1440), 'every system runs every month');
  // A corrupted event is caught on the next tick.
  first.chronicle.events.push({ ...first.chronicle.events[0] ?? { id: 0, tick: 0, type: 'unrest', actors: [], region: null, settlement: null, causes: [], parents: [], importance: 0, data: {} }, id: 99 });
  assert.throws(() => checkInvariants(first), InvariantError);
});

test('observer frames reject events newer than the frame or out of order', () => {
  const frame = {
    protocolVersion: SIMULATION_PROTOCOL_VERSION, instance: { key: 'k', worldKey: 'w', partitionVersion: 1, rulesVersion: 1, seed: 's', runId: 'r' },
    tick: 5, playing: false, speed: 'year', epoch: 0, runTo: null, eventCount: 2, counters: { regions: 1, landmasses: 1 },
    population: 30, polities: 1, civs: 0, settlementCount: 0, specialists: 0, leadingEra: 0, lineages: ['Vaeli'],
    largest: [{ id: 0, name: 'Vaeli', kind: 'band', regions: 1, population: 30 }], civList: [],
    markers: { ids: [0], regions: [0], populations: [30], kinds: [0], eras: [0], lineages: [0] }, settlements: { ids: [], cells: [], owners: [], capitals: [], tiers: [], names: [], features: [] },
    series: [[0, 30, 1]], inspect: null,
    events: [
      { id: 0, tick: 1, type: 'unrest', actors: [], region: null, settlement: null, causes: [], parents: [], importance: 0.1, data: {} },
      { id: 1, tick: 2, type: 'unrest', actors: [], region: null, settlement: null, causes: [], parents: [], importance: 0.1, data: {} },
    ],
  };
  assert.equal(parseObserverFrame(frame).events.length, 2);
  assert.throws(() => parseObserverFrame({ ...frame, events: [...frame.events].reverse() }));
  assert.throws(() => parseObserverFrame({ ...frame, tick: 1 }));
  assert.throws(() => parseObserverFrame({ ...frame, speed: 'warp' }));
  assert.throws(() => parseObserverFrame({ ...frame, markers: { ...frame.markers, regions: [] } }), 'marker arrays must line up');
  assert.throws(() => parseObserverFrame({ ...frame, markers: { ...frame.markers, eras: [10] } }), 'eras are known');
  assert.throws(() => parseObserverFrame({ ...frame, markers: { ...frame.markers, lineages: [1] } }), 'lineages are named');
  assert.throws(() => parseObserverFrame({ ...frame, largest: [{ ...frame.largest[0], regions: 2 }] }), 'the legend counts the polity\'s regions');
  assert.throws(() => parseObserverFrame({ ...frame, largest: [{ ...frame.largest[0], id: 1 }] }), 'the legend names living polities');
  const civFrame = { ...frame, civs: 1, largest: [], markers: { ...frame.markers, kinds: [1] }, settlements: { ids: [0], cells: [3], owners: [0], capitals: [1], tiers: [1], names: ['Kesh'], features: [1] }, settlementCount: 1 };
  const listed = { id: 0, name: 'Vaeli', regions: 1, population: 30, era: 0, capital: 'Kesh', capitalCell: 3 };
  assert.equal(parseObserverFrame({ ...civFrame, civList: [listed] }).civList.length, 1);
  assert.throws(() => parseObserverFrame({ ...civFrame, civList: [] }), 'every civilization is listed while there are at most 100');
  assert.throws(() => parseObserverFrame({ ...civFrame, civList: [{ ...listed, regions: 2 }] }), 'the list reports the regions its markers hold');
  assert.throws(() => parseObserverFrame({ ...civFrame, civList: [listed, listed] }), 'no civilization twice');
  const two = { ids: [0, 0], populations: [30, 30], eras: [0, 0], lineages: [0, 0] };
  assert.throws(() => parseObserverFrame({ ...frame, largest: [], markers: { ...two, regions: [0, 0], kinds: [0, 0] } }), 'one band per region');
  assert.throws(() => parseObserverFrame({ ...frame, civs: 1, largest: [], markers: { ...two, regions: [0, 1], kinds: [0, 1] } }), 'a polity is a tribe or a civilization in all its regions');
  assert.throws(() => parseObserverFrame({ ...frame, settlements: { ids: [0], cells: [5], owners: [], capitals: [1], tiers: [0], names: [''], features: [0] } }), 'settlement arrays must line up');
  assert.throws(() => parseObserverFrame({ ...civFrame, settlements: { ...civFrame.settlements, tiers: [] } }), 'every settlement has a tier');
  assert.throws(() => parseObserverFrame({ ...civFrame, settlements: { ...civFrame.settlements, tiers: [4] } }), 'tiers are village to metropolis');
  assert.throws(() => parseObserverFrame({ ...frame, civs: 1 }), 'civilization count matches the markers');
  assert.throws(() => parseObserverFrame({ ...frame, polities: 2 }), 'one marker per living polity');
  assert.throws(() => parseObserverFrame({ ...frame, settlementCount: 1 }), 'settlement count matches the settlements');
  assert.throws(() => parseObserverFrame({ ...frame, series: [[10, 30, 1]] }), 'the series cannot run ahead of the clock');
});
