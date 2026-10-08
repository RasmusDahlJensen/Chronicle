import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { ERA_NAMES, parseObserverFrame, SIMULATION_PROTOCOL_VERSION, type ObserverFrame } from '../shared/simulation.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { actorNames, HISTORY_IMPORTANCE, HISTORY_LENGTH, HISTORY_RUN_YEARS, observerView } from '../src/simulation/observer.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { truthOf } from '../src/simulation/relations.ts';
import { keeperOf, roadUnkept } from '../src/simulation/roads.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { TECHS } from '../src/simulation/techs.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * The realm panel's frame data (U.2): a civilization's realm at a glance, its own chronicle, its techs' eras and the
 * truth beside its beliefs, read from a real history with civilizations that have met others.
 */
let history: SimulationState, geography: ReturnType<typeof decodeGeography>;
const largestCiv = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ')
  .sort((a, b) => b.groups.length - a.groups.length || a.id - b.id)[0] as Polity | undefined;

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  const ready = () => { const civ = largestCiv(history); return !!civ && civ.groups.length >= 6 && civ.met.size >= 2 && history.settlements.some(s => s.owner === civ.id && s.tier >= 1); };
  while (!ready() && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(ready(), 'a civilization of six regions or more, with a town, that has met others');
});

/** The panel of the civilization ruling `region`, as the frame carries it. */
const panelAt = (state: SimulationState, region: number) => observerView(state, region).inspect?.polity ?? null;

test('the realm summary matches the simulation: settlements by size, stability, unrest, cultures and faiths', () => {
  const civ = largestCiv(history)!, region = history.groups[civ.groups[0]].region, panel = panelAt(history, region)!;
  assert.equal(panel.id, civ.id);
  const realm = panel.realm!;
  const owned = history.settlements.filter(settlement => settlement.status === 'alive' && settlement.owner === civ.id);
  assert.deepEqual(realm.settlements, [0, 1, 2, 3].map(tier => owned.filter(settlement => settlement.tier === tier).length), 'its living settlements by tier');
  assert.ok(realm.settlements[1] + realm.settlements[2] + realm.settlements[3] >= 1);
  assert.equal(realm.cities.length, Math.min(6, owned.length));
  assert.deepEqual(realm.cities.map(city => city.urban), owned.map(settlement => settlement.urban).sort((a, b) => b - a).slice(0, 6), 'the largest first');
  const regions = civ.groups.map(id => history.groups[id].region);
  assert.equal(realm.unrest, regions.filter(at => history.unrest[at]).length);
  assert.equal(realm.neglected, regions.filter(at => history.neglected[at]).length);
  assert.ok(Math.abs(realm.stability - regions.reduce((sum, at) => sum + history.stability[at], 0) / regions.length) < 0.001);
  const kept = [...history.roads.values()].filter(road => keeperOf(history, road) === civ.id);
  assert.equal(realm.roads, kept.length);
  assert.equal(realm.roadsUnkept, kept.filter(road => roadUnkept(history, road)).length);
  assert.ok(realm.cities.every(city => history.settlements[city.id].name === city.name && history.settlements[city.id].owner === civ.id), 'each city by its id');
  // Cultures and faiths: shares of its people, largest first, adding up to all of them when there are four or fewer.
  const people = civ.groups.reduce((sum, id) => sum + history.groups[id].size, 0);
  for (const [entries, key] of [[realm.cultures, 'culture'], [realm.faiths, 'faith']] as const) {
    const sizes = new Map<number, number>();
    for (const id of civ.groups) sizes.set(history.groups[id][key], (sizes.get(history.groups[id][key]) ?? 0) + history.groups[id].size);
    assert.equal(entries.length, Math.min(4, sizes.size));
    assert.ok(entries.every((entry, at) => at === 0 || entry.share <= entries[at - 1].share));
    assert.ok(Math.abs(entries[0].share - Math.max(...sizes.values()) / people) < 0.001);
    if (sizes.size <= 4) assert.ok(Math.abs(entries.reduce((sum, entry) => sum + entry.share, 0) - 1) < 0.01, `${key} shares add up`);
  }
  assert.deepEqual(realm.wonders.map(wonder => wonder.city), history.wonders.filter(wonder => wonder.status === 'standing' && history.settlements[wonder.settlement].owner === civ.id).map(wonder => history.settlements[wonder.settlement].name));
  // A tribe has no realm.
  const tribe = history.living.map(id => history.polities[id]).find(polity => polity.kind === 'band');
  if (tribe) assert.equal(panelAt(history, history.groups[tribe.groups[0]].region)!.realm, null);
});

test('a realm\'s own chronicle lists the notable events it acts in, newest first, a run of one type as one entry, in step with the history', () => {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Object.getPrototypeOf(history.chronicle));
  const civ = largestCiv(state)!, region = state.groups[civ.groups[0]].region;
  // Its notable events, newest first, each folded into the run of its type it lies within 25 years of.
  const expected = (at: SimulationState) => {
    const runs: { id: number; type: string; more: number; from: number }[] = [];
    for (const event of at.chronicle.events.filter(entry => entry.importance >= HISTORY_IMPORTANCE && entry.actors.some(actor => actor.id === civ.id)).reverse()) {
      const run = runs.findLast(entry => entry.type === event.type);
      if (run && run.from - event.tick <= HISTORY_RUN_YEARS * 12) { run.more++; run.from = event.tick; continue; }
      if (runs.length === HISTORY_LENGTH) break;
      runs.push({ id: event.id, type: event.type, more: 0, from: event.tick });
    }
    return runs.map(({ id, more, from }) => ({ id, more, from }));
  };
  const shape = (entries: { event: { id: number }; more: number; from: number }[]) => entries.map(entry => ({ id: entry.event.id, more: entry.more, from: entry.from }));
  const first = panelAt(state, region)!.history;
  assert.ok(first.length > 1);
  assert.deepEqual(shape(first), expected(state));
  assert.ok(first.some(entry => entry.more > 0), 'runs are folded');
  assert.ok(first.every((entry, at) => at === 0 || entry.event.id < first[at - 1].event.id), 'newest first');
  assert.ok(first.every((entry, at) => first.slice(0, at).every(newer => newer.event.type !== entry.event.type || newer.from - entry.event.tick > HISTORY_RUN_YEARS * 12)), 'runs of one type are apart');
  assert.ok(first.every(entry => entry.event.importance >= HISTORY_IMPORTANCE && entry.event.actors.some(actor => actor.id === civ.id)));
  // Its actors are named in the frame, as the worker names them.
  const named = new Set(actorNames(state, first.map(entry => entry.event)).map(([id]) => id));
  assert.ok(first.every(entry => entry.event.actors.every(actor => named.has(actor.id))));
  // Ten years on, the newest of its events lead the list.
  for (let month = 0; month < 120; month++) stepSimulation(state, () => 0, false);
  const later = panelAt(state, state.groups[civ.groups[0]].region);
  if (later?.id === civ.id) assert.deepEqual(shape(later.history), expected(state));
  // A history started again holds none of it.
  const fresh = createSimulation(geography, history.partition, 'Invariants');
  const band = fresh.polities[fresh.living[0]];
  assert.ok(panelAt(fresh, fresh.groups[band.groups[0]].region)!.history.every(entry => entry.event.tick === 0));
});

test('the god view lists the nearest peoples a civilization has not met, nearest first', () => {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Object.getPrototypeOf(history.chronicle));
  const civ = largestCiv(state)!, land = new Set(civ.groups.map(id => state.groups[id].region));
  // How many regions from its land (by land) a polity lives, up to three.
  const away = (id: number) => {
    let frontier = [...land], seen = new Set(land);
    for (let step = 1; step <= 3; step++) {
      const next: number[] = [];
      for (const region of frontier) for (const edge of state.partition.regions[region].neighbors) {
        if (seen.has(edge.region)) continue;
        seen.add(edge.region); next.push(edge.region);
        if (state.occupant[edge.region] === id) return step;
      }
      frontier = next;
    }
    return null;
  };
  // Forget a neighbour it has met: it is listed one region away.
  const neighbour = [...land].flatMap(region => state.partition.regions[region].neighbors.map(edge => state.occupant[edge.region])).find(id => id >= 0 && id !== civ.id && civ.met.has(id))!;
  assert.ok(neighbour !== undefined);
  civ.met.delete(neighbour);
  const unmet = panelAt(state, [...land][0])!.unmet;
  assert.ok(unmet.some(entry => entry.id === neighbour && entry.away === 1));
  assert.ok(unmet.every((entry, at) => !civ.met.has(entry.id) && entry.id !== civ.id && state.polities[entry.id].deathTick === null && away(entry.id) === entry.away && (at === 0 || entry.away >= unmet[at - 1].away)));
  if (unmet.length < 6) for (const id of state.living) if (id !== civ.id && !civ.met.has(id) && away(id) !== null) assert.ok(unmet.some(entry => entry.id === id), `${id} is listed`);
  // A tribe's panel has none.
  const tribe = state.living.map(id => state.polities[id]).find(polity => polity.kind === 'band');
  if (tribe) assert.deepEqual(panelAt(state, state.groups[tribe.groups[0]].region)!.unmet, []);
});

/** A frame carrying `state`'s inspected region, as the worker sends it (the rest a minimal valid frame). */
function frameOf(state: SimulationState, region: number): ObserverFrame {
  return {
    protocolVersion: SIMULATION_PROTOCOL_VERSION, instance: { key: 'k', worldKey: 'w', partitionVersion: 1, rulesVersion: 1, seed: 's', runId: 'r' },
    tick: state.tick, playing: false, speed: 'year', epoch: 0, runTo: null, dev: { actions: 0, refused: null, checkpoints: null, loadedFrom: null }, eventCount: state.chronicle.events.length,
    counters: { regions: state.partition.regions.length, landmasses: 1 }, population: 30, polities: 1, civs: 0, settlementCount: 0, specialists: 0, leadingEra: 0, lineages: ['Vaeli'],
    cultures: [{ id: 0, name: 'Vaeli', hue: 20, parent: null, regions: 1, population: 30 }], religions: [], largest: [], civList: [],
    markers: { ids: [0], regions: [0], populations: [30], kinds: [0], eras: [0], lineages: [0], cultures: [0], faiths: [-1] }, settlements: { ids: [], cells: [], owners: [], capitals: [], tiers: [], names: [], features: [] },
    roads: { a: [], b: [], tiers: [], bridges: [], conditions: [] }, trades: { from: [], to: [], resources: [], sea: [] }, fields: { regions: [], cells: [] }, series: [[0, 30, 1]], wonders: [], names: [], events: [],
    inspect: observerView(state, region).inspect,
  } as ObserverFrame;
}

test('a frame with a realm panel passes the contract, and one whose eras or history are inconsistent is refused', () => {
  const civ = largestCiv(history)!, frame = frameOf(history, history.groups[civ.groups[0]].region);
  const panel = parseObserverFrame(structuredClone(frame)).inspect!.polity!;
  assert.equal(panel.id, civ.id);
  const altered = (change: (polity: NonNullable<NonNullable<ObserverFrame['inspect']>['polity']>) => void) => {
    const copy = structuredClone(frame);
    change(copy.inspect!.polity!);
    return copy;
  };
  assert.throws(() => parseObserverFrame(altered(polity => { polity.knownEras.pop(); })), 'every known tech has its era');
  assert.throws(() => parseObserverFrame(altered(polity => { polity.history.reverse(); })), 'newest first');
  assert.throws(() => parseObserverFrame(altered(polity => { polity.history[0].event.id = frame.eventCount; })), 'events of this history');
  assert.throws(() => parseObserverFrame(altered(polity => { polity.history[0].event.tick = frame.tick + 1; })), 'no later than the frame');
  assert.throws(() => parseObserverFrame(altered(polity => { polity.history[0].from = polity.history[0].event.tick + 1; })), 'a run begins no later than its newest event');
  assert.throws(() => parseObserverFrame(altered(polity => { polity.realm!.settlements.pop(); })), 'settlements by each tier');
});

test('its techs carry their eras, and its beliefs about others carry the truth beside them', () => {
  const civ = largestCiv(history)!, panel = panelAt(history, history.groups[civ.groups[0]].region)!;
  assert.equal(panel.knownEras.length, panel.known.length);
  assert.ok(panel.known.length > 0);
  for (const [at, name] of panel.known.entries()) assert.equal(ERA_NAMES[panel.knownEras[at]], TECHS.find(entry => entry.name === name)!.era, name);
  assert.ok(panel.diplomacy.length > 0);
  for (const row of panel.diplomacy) {
    const other = history.polities[row.id];
    assert.equal(row.truePeople, Math.round(truthOf(history, other, 'people')));
    assert.equal(row.trueStrength, Math.round(truthOf(history, other, 'strength')));
  }
});
