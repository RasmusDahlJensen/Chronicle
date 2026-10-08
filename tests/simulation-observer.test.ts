import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { CHRONICLE_SCAN, ERA_NAMES, EVENT_TYPES, MAX_FRAME_STORIES, parseChroniclePage, parseObserverFrame, SIMULATION_PROTOCOL_VERSION, STORY_KINDS, type ChronicleQuery, type EventType, type ObserverFrame } from '../shared/simulation.ts';
import { curate, EVENT_KIND, EVENT_KINDS, peopleOf as eventPeople, typesOf } from '../src/observer/chronicle.ts';
import { describeStory, STORY_TEMPLATES } from '../src/observer/stories.ts';
import { agesOf, KIND_LIMIT, storiesOf, storiesView, storyCandidates } from '../src/simulation/stories.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { actorNames, chroniclePage, HISTORY_IMPORTANCE, HISTORY_LENGTH, HISTORY_RUN_YEARS, observerView } from '../src/simulation/observer.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { truthOf } from '../src/simulation/relations.ts';
import { keeperOf, roadUnkept } from '../src/simulation/roads.ts';
import { ruinSettlements } from '../src/simulation/settlements.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { TENETS } from '../src/simulation/religions.ts';
import { KNOWN, OBSERVED } from '../src/simulation/perception.ts';
import { DENSITY_RANGE, densityColor, regionDensities } from '../src/observer/palettes.ts';
import { ERAS, TECHS } from '../src/simulation/techs.ts';
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
    cultures: [{ id: 0, name: 'Vaeli', hue: 20, parent: null, regions: 1, population: 30 }], religions: [], largest: [], civList: [], treaties: [], census: { years: [], civs: [], ids: [], people: [] },
    markers: { ids: [0], regions: [0], populations: [30], kinds: [0], eras: [0], lineages: [0], cultures: [0], faiths: [-1] }, settlements: { ids: [], cells: [], owners: [], capitals: [], tiers: [], names: [], features: [] }, ruins: { cells: [], names: [], razed: [] },
    roads: { a: [], b: [], tiers: [], bridges: [], conditions: [] }, trades: { from: [], to: [], resources: [], sea: [] }, fields: { regions: [], cells: [] }, series: [[0, 30, 1]], wonders: [], names: [], events: [], perspective: null, ...storiesView(state),
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

/** A copy of the history to change, stepped to its next census (every ten years). */
function copied() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Object.getPrototypeOf(history.chronicle));
  while (state.tick % 120 !== 0) stepSimulation(state, () => 0, false);
  return state;
}
const peopleOf = (state: SimulationState, polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);

test('the census records each civilization\'s people and regions every ten years', () => {
  const state = copied(), last = state.census[state.census.length - 1];
  assert.deepEqual(state.census.map(entry => entry.year), state.census.map((_, at) => (at + 1) * 10), 'every ten years from year 10');
  assert.equal(last.year, state.tick / 12);
  const civs = state.living.filter(id => state.polities[id].kind === 'civ').sort((a, b) => a - b);
  assert.ok(civs.length > 0);
  assert.deepEqual(last.ids, civs);
  assert.deepEqual(last.people, civs.map(id => peopleOf(state, state.polities[id])));
  assert.deepEqual(last.regions, civs.map(id => state.polities[id].groups.length));
});

test('a rise and a decline are read from the census; a realm that joined another is a union, not a decline', () => {
  const state = copied(), year = state.tick / 12;
  const censusOf = (at: number, id: number) => { const entry = state.census.find(sample => sample.year === at)!; const place = entry.ids.indexOf(id); return { people: entry.people[place], regions: entry.regions[place] }; };
  const rises = storiesOf(state).filter(story => story.kind === 'rise');
  assert.ok(rises.length > 0, 'a realm has risen');
  for (const story of rises) {
    const then = censusOf(story.from, story.polity), civ = state.polities[story.polity], gain = peopleOf(state, civ) - then.people;
    assert.ok(story.from >= year - 100 && story.to === year);
    assert.deepEqual([story.data.before, story.data.regionsBefore], [then.people, then.regions]);
    assert.deepEqual([story.data.people, story.data.regions], [peopleOf(state, civ), civ.groups.length]);
    assert.ok(Number(story.data.people) >= 1.25 * then.people);
    // How it grew, from its events since that census: settlers sent, tribes joined, bands taken in, realms united, and
    // the people who came with them.
    const since = state.chronicle.events.filter(event => event.tick >= story.from * 12);
    const by = (type: string, role: string) => since.filter(event => event.type === type && event.actors.some(actor => actor.id === civ.id && actor.role === role));
    const joined = [...by('bandJoined', 'civ'), ...by('bandAbsorbed', 'civ'), ...by('unification', 'union')];
    assert.deepEqual([story.data.expansions, story.data.joined, story.data.absorbed, story.data.united], [by('expansion', 'civ').length, by('bandJoined', 'civ').length, by('bandAbsorbed', 'civ').length, by('unification', 'union').length]);
    assert.equal(story.data.byOthers, Math.min(gain, joined.reduce((sum, event) => sum + Number(event.data.population), 0)));
    assert.equal(story.data.ownGrowth, gain - Number(story.data.byOthers));
    assert.deepEqual(story.regions, civ.groups.map(id => state.groups[id].region).sort((a, b) => a - b));
  }
  // A decline: the largest realm loses half its people.
  const civ = largestCiv(state)!;
  for (const id of civ.groups) state.groups[id].size = Math.floor(state.groups[id].size / 2);
  const decline = storyCandidates(state).find(story => story.kind === 'decline' && story.polity === civ.id)!;
  const samples = state.census.filter(sample => sample.year >= year - 200 && sample.ids.includes(civ.id)), peak = Math.max(...samples.map(sample => sample.people[sample.ids.indexOf(civ.id)]));
  assert.ok(decline, 'the realm declines');
  assert.deepEqual([decline.data.peak, decline.data.people, decline.data.ended], [peak, peopleOf(state, civ), false]);
  assert.equal(decline.data.peakYear, samples.find(sample => sample.people[sample.ids.indexOf(civ.id)] === peak)!.year);
  // Another realm joins it and ends: a union, not a decline.
  const other = state.living.map(id => state.polities[id]).find(polity => polity.kind === 'civ' && polity.id !== civ.id)!;
  assert.ok(other);
  other.deathTick = state.tick; state.living = state.living.filter(id => id !== other.id);
  state.chronicle.emit({ type: 'unification', actors: [{ id: other.id, role: 'civ' }, { id: civ.id, role: 'union' }], region: null, importance: 0.5,
    data: { name: other.name, civ: civ.name, regions: other.groups.length, population: 123_456, kin: false, into: 1, techs: 0, learned: false } });
  state.chronicle.flush(state.tick);
  const told = storyCandidates(state);
  assert.ok(!told.some(story => story.kind === 'decline' && story.polity === other.id));
  const union = told.find(story => story.kind === 'union' && story.polity === civ.id)!;
  const unions = state.chronicle.events.filter(event => event.type === 'unification' && event.tick >= (year - 100) * 12 && event.actors.some(actor => actor.id === civ.id && actor.role === 'union'));
  assert.deepEqual([union.id, union.data.joined, union.data.count, union.data.people], [`union:${civ.id}`, other.name, unions.length, unions.reduce((sum, event) => sum + Number(event.data.population), 0)]);
  // A realm that comes to an end otherwise is a decline to nothing.
  const ending = copied(), gone = ending.living.map(id => ending.polities[id]).find(polity => polity.kind === 'civ' && polity.id !== civ.id)!;
  gone.deathTick = ending.tick; ending.living = ending.living.filter(id => id !== gone.id);
  const end = storyCandidates(ending).find(story => story.kind === 'decline' && story.polity === gone.id)!;
  assert.ok(end, 'an ended realm declines');
  assert.deepEqual([end.data.ended, end.data.people, end.to, end.alive], [true, 0, year, false]);
  for (const story of [decline, union, end, ...rises]) for (const text of Object.values(describeStory(story))) assert.ok(!text.includes('?') && !/#\d/.test(text), `${story.kind}: ${text}`);
});

test('each kind of story is told from the history\'s events and state, the strongest eight first, in words', () => {
  const state = copied(), year = state.tick / 12, civ = largestCiv(state)!, region = state.groups[civ.groups[0]].region;
  const others = state.living.filter(id => id !== civ.id).slice(0, 3);
  // What M1–M5 make happen, made to happen now: voyages, a famine, a wonder, two peoples become one, a faith and a
  // sect, trade, a new age, a union and a decline.
  const emit = (type: Parameters<typeof state.chronicle.emit>[0]['type'], data: Record<string, string | number | boolean>, role = 'civ', settlement: number | null = null, actor = civ.id) =>
    state.chronicle.emit({ type, actors: [{ id: actor, role }], region, settlement, importance: 0.5, causes: [{ factor: 'test', weight: 1 }], data });
  const voyage = (km: number, newLand: boolean) => emit('newLandsDiscovered', { explorer: newLand ? 'Tester' : 'Coaster', from: 'Port', km, regions: 5, met: 2, metOne: false, metMany: true, newLand, farCoast: !newLand, large: true, otherLand: true });
  voyage(99_999, true); voyage(199_999, false);
  emit('famine', { name: civ.name, deaths: 5_000_000, population: 9_000_000, regions: 1, more: 0, moreRegions: false }, 'polity');
  const city = state.settlements.find(settlement => settlement.owner === civ.id && settlement.status === 'alive')!;
  emit('wonderCompleted', { wonder: 'the Pyramids', name: city.name, civ: civ.name, years: 40 }, 'civ', city.id);
  emit('hybridCulture', { culture: 'Testai', first: 'Aye', second: 'Bee', civ: civ.name, firstShare: 60, secondShare: 40, population: 50_000_000 });
  const faith = state.religions.length;
  state.religions.push({ id: faith, name: 'Testfaith', tenets: [], founder: civ.id, holyRegion: region, parent: null, foundedTick: state.tick, hue: 0, people: 100_000, regions: 3, deathTick: null });
  state.religions.push({ id: faith + 1, name: 'Testsect', tenets: [0], founder: civ.id, holyRegion: region, parent: faith, foundedTick: state.tick, hue: 0, people: 50_000, regions: 2, deathTick: null });
  state.groups[civ.groups[0]].faith = faith;
  emit('religionFounded', { religion: 'Testfaith', civ: civ.name, tenets: '', reformed: false, from: '' });
  emit('schism', { religion: 'Testsect', parent: 'Testfaith', regions: 2, population: 50_000, polity: civ.name, holyLand: true, mainBody: false }, 'polity');
  for (const other of others) state.treaties.push({ id: state.treaties.length, type: 'trade', exporter: civ.id, importer: other, resource: 0, amount: 1, barter: -1, barterAmount: 0, price: 1, carry: 0, hubs: [0, 0], startTick: state.tick, endTick: null, endCause: null });
  const reached = Math.max(0, ...agesOf(state).map(age => age.era)), tech = TECHS.findIndex(entry => ERAS.indexOf(entry.era) === reached + 1);
  state.firsts.push({ tech, tick: state.tick, polity: civ.id, region });
  emit('techDiscovered', { tech: TECHS[tech].name, era: TECHS[tech].era, name: civ.name, first: true, taught: false }, 'polity');
  const joiner = state.living.map(id => state.polities[id]).find(polity => polity.kind === 'civ' && polity.id !== civ.id)!;
  state.chronicle.emit({ type: 'unification', actors: [{ id: joiner.id, role: 'civ' }, { id: civ.id, role: 'union' }], region, importance: 0.5,
    data: { name: joiner.name, civ: civ.name, regions: 1, population: 1, kin: false, into: 1, techs: 0, learned: false } });
  for (const id of joiner.groups) state.groups[id].size = Math.floor(state.groups[id].size / 2);
  state.chronicle.flush(state.tick);

  const candidates = storyCandidates(state), of = (kind: string, polity = civ.id) => candidates.filter(story => story.kind === kind && story.polity === polity);
  for (const kind of ['voyage', 'hardship', 'wonder', 'peoples', 'trade', 'first', 'union'] as const) assert.equal(of(kind).length, 1, kind);
  assert.equal(of('decline', joiner.id).length, 1);
  const recent = state.chronicle.events.filter(event => event.tick >= (year - 100) * 12), mine = (type: string) => recent.filter(event => event.type === type && event.actors.some(actor => actor.id === civ.id));
  const landfalls = mine('newLandsDiscovered').filter(event => event.data.newLand === true);
  assert.deepEqual([of('voyage')[0].data.km, of('voyage')[0].data.explorer, of('voyage')[0].data.voyages], [99_999, 'Tester', landfalls.length], 'only voyages that reached new lands');
  assert.equal(of('hardship')[0].data.deaths, mine('famine').reduce((sum, event) => sum + Number(event.data.deaths), 0));
  assert.deepEqual([of('wonder')[0].data.wonder, of('wonder')[0].focus], ['the Pyramids', city.cell]);
  assert.deepEqual([of('peoples')[0].data.culture, of('peoples')[0].data.hybrid], ['Testai', true]);
  const [founded, sect] = [faith, faith + 1].map(id => of('faith').find(story => story.id === `faith:${civ.id}:${id}`)!);
  assert.deepEqual([founded.data.religion, founded.data.people, founded.data.founded, founded.data.sect], ['Testfaith', 100_000, true, false]);
  assert.deepEqual([sect.data.religion, sect.data.sect, sect.data.parentFaith, sect.data.tenets], ['Testsect', true, 'Testfaith', TENETS[0].name]);
  assert.ok(founded.regions.includes(region));
  const trades = state.treaties.filter(treaty => treaty.type === 'trade' && treaty.endTick === null && (treaty.exporter === civ.id || treaty.importer === civ.id));
  assert.equal(of('trade')[0].data.agreements, trades.length);
  assert.deepEqual([of('first')[0].data.era, of('first')[0].data.tech], [TECHS[tech].era, TECHS[tech].name]);
  assert.deepEqual(agesOf(state).at(-1), { era: reached + 1, year, polity: civ.id, name: civ.name, tech: TECHS[tech].name });
  for (const story of candidates) {
    assert.ok(story.causes.length <= 3 && story.events.length <= 3 && story.from <= story.to && story.to <= year, story.id);
    assert.ok(story.events.every((event, at) => at === 0 || event.id < story.events[at - 1].id), 'key events newest first');
  }
  assert.equal(new Set(candidates.map(story => story.id)).size, candidates.length, 'each story once');
  // The rail: at most eight, the strongest first, at most two of a rise, decline or union and one of any other kind.
  const told = storiesOf(state);
  const selectable = STORY_KINDS.reduce((sum, kind) => sum + Math.min(KIND_LIMIT[kind] ?? 1, candidates.filter(story => story.kind === kind).length), 0);
  assert.equal(told.length, Math.min(MAX_FRAME_STORIES, selectable));
  assert.ok(told.every((story, at) => at === 0 || story.weight <= told[at - 1].weight));
  for (const kind of STORY_KINDS) assert.ok(told.filter(story => story.kind === kind).length <= (KIND_LIMIT[kind] ?? 1), kind);
  assert.equal(told[0].weight, Math.max(...candidates.map(story => story.weight)), 'the story of the age is the strongest');
  // Every kind has its words, every story reads without gaps or ids, and counts of one take the singular.
  assert.deepEqual(Object.keys(STORY_TEMPLATES).sort(), [...STORY_KINDS].sort());
  assert.deepEqual(new Set(candidates.map(story => story.kind)), new Set(STORY_KINDS), 'every kind told');
  for (const story of candidates) {
    const ones = { ...story, data: Object.fromEntries(Object.entries(story.data).map(([key, value]) => [key, typeof value === 'number' ? 1 : value])) };
    for (const told of [story, ones]) {
      const words = describeStory(told);
      for (const text of [words.title, words.text]) {
        assert.ok(!text.includes('?'), `${story.kind}: ${text}`); assert.doesNotMatch(text, /#\d/); assert.match(text, /^[A-Z0-9]/);
        assert.doesNotMatch(text, /\b1 (?:more |new |trade )?[a-z]+s\b/, `${story.kind}: ${text}`);
      }
    }
  }
});

test('a frame\'s stories and ages are validated', () => {
  const state = copied(), civ = largestCiv(state)!, frame = frameOf(state, state.groups[civ.groups[0]].region);
  assert.ok(frame.stories.length > 0 && frame.ages.length > 0);
  assert.equal(parseObserverFrame(structuredClone(frame)).stories.length, frame.stories.length);
  const altered = (change: (copy: ObserverFrame) => void) => { const copy = structuredClone(frame); change(copy); return copy; };
  assert.throws(() => parseObserverFrame(altered(copy => { copy.stories.push(structuredClone(copy.stories[0])); copy.stories.at(-1)!.weight = 0; })), 'each story once');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.stories.at(-1)!.weight = copy.stories[0].weight + 1; })), 'strongest first');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.stories[0].to = Math.floor(copy.tick / 12) + 1; })), 'not beyond the history');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.stories[0].from = copy.stories[0].to + 1; })), 'from before to');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.stories[0].regions = [copy.counters.regions]; })), 'regions of this world');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.ages.push({ ...copy.ages[0] }); })), 'each later age once');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.ages[0].year = Math.floor(copy.tick / 12) + 1; })), 'ages within the history');
});

test('the ledger\'s table, treaty web and census series, and the diplomacy lens\'s standings, match the simulation', () => {
  const state = copied(), civ = largestCiv(state)!;
  // Treaties of every kind in force between living realms, so the web has each.
  const others = state.living.filter(id => id !== civ.id && state.polities[id].kind === 'civ').slice(0, 2);
  assert.ok(others.length > 0);
  state.treaties.push({ id: state.treaties.length, type: 'trade', exporter: civ.id, importer: others[0], resource: 0, amount: 1, barter: -1, barterAmount: 0, price: 1, carry: 0, hubs: [0, 0], startTick: state.tick, endTick: null, endCause: null });
  state.treaties.push({ id: state.treaties.length, type: 'trade', exporter: others[0], importer: civ.id, resource: 1, amount: 1, barter: -1, barterAmount: 0, price: 1, carry: 0, hubs: [0, 0], startTick: state.tick, endTick: null, endCause: null });
  state.treaties.push({ id: state.treaties.length, type: 'alliance', parties: [civ.id, others[0]], startTick: state.tick, endTick: null, endCause: null });
  state.treaties.push({ id: state.treaties.length, type: 'nonAggression', parties: [others[0], civ.id], startTick: state.tick, endTick: state.tick, endCause: 'relationsSoured' });
  const view = observerView(state, state.groups[civ.groups[0]].region);
  // The table: each realm's settlements, culture, faith, treasury, stability, unrest and treaties.
  for (const row of view.civList) {
    const polity = state.polities[row.id], regions = polity.groups.map(id => state.groups[id].region);
    assert.equal(row.settlements, state.settlements.filter(settlement => settlement.status === 'alive' && settlement.owner === row.id).length);
    assert.deepEqual([row.culture, row.faith], [state.cultures[polity.culture].name, polity.stateReligion >= 0 ? state.religions[polity.stateReligion].name : null]);
    assert.equal(row.treasury, Math.floor(polity.wealth));
    assert.ok(Math.abs(row.stability - regions.reduce((sum, region) => sum + state.stability[region], 0) / regions.length) < 0.001);
    assert.equal(row.unrest, regions.filter(region => state.unrest[region]).length);
    assert.equal(row.trade, state.treaties.filter(treaty => treaty.type === 'trade' && treaty.endTick === null && (treaty.exporter === row.id || treaty.importer === row.id)).length);
    assert.deepEqual([row.roads, row.pacts, row.allies], [polity.roadPartners.length, polity.pacts.length, polity.allies.length]);
  }
  // The web: exactly the treaties in force between living civilizations, each pair and kind once, trade counted.
  const expected = new Map<string, number>();
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) continue;
    const [one, other] = treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties;
    if (state.polities[one].deathTick !== null || state.polities[other].deathTick !== null) continue;
    const key = `${Math.min(one, other)},${Math.max(one, other)},${treaty.type}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  assert.deepEqual(new Map(view.treaties.map(treaty => [`${treaty.a},${treaty.b},${treaty.kind}`, treaty.count])), expected);
  const pair = `${Math.min(civ.id, others[0])},${Math.max(civ.id, others[0])}`;
  assert.equal(expected.get(`${pair},trade`)! >= 2, true);
  assert.ok(expected.has(`${pair},alliance`));
  // The census series: each year's civilizations, and the largest realms' people from their census.
  assert.deepEqual(view.census.ids, view.civList.slice(0, 8).map(row => row.id));
  for (const [step, year] of view.census.years.entries()) {
    const sample = state.census.find(entry => entry.year === year)!;
    assert.equal(view.census.civs[step], sample.ids.length);
    for (const [index, id] of view.census.ids.entries()) assert.equal(view.census.people[index][step], sample.ids.includes(id) ? sample.people[sample.ids.indexOf(id)] : 0);
  }
  assert.equal(view.census.years.at(-1), state.census.at(-1)!.year);
  // Standings: every living people it has met (judged yet or not), by the strongest treaty, else rival at −50 or below,
  // else neutral. A people met this year, before it has an opinion of them, is neutral.
  const fresh = state.living.find(id => id !== civ.id && !civ.met.has(id))!;
  assert.ok(fresh !== undefined, 'a people it has not met');
  civ.met.set(fresh, state.tick);
  const panel = observerView(state, state.groups[civ.groups[0]].region).inspect!.polity!;
  const met = [...civ.met.keys()].filter(other => other !== civ.id && state.polities[other].deathTick === null).sort((a, b) => a - b);
  assert.deepEqual(panel.standings.map(entry => entry.id), met);
  assert.ok(!civ.relations.has(fresh));
  assert.equal(panel.standings.find(entry => entry.id === fresh)!.status, 'neutral');
  for (const entry of panel.standings) {
    const opinion = civ.relations.get(entry.id)?.opinion ?? 0;
    const status = civ.allies.includes(entry.id) ? 'allied' : civ.pacts.includes(entry.id) ? 'pact' : civ.trading.includes(entry.id) ? 'trade' : opinion <= -50 ? 'rival' : 'neutral';
    assert.equal(entry.status, status, `standing with ${entry.id}`);
  }
  // A tribe has no standings.
  const tribe = state.living.map(id => state.polities[id]).find(polity => polity.kind === 'band');
  if (tribe) assert.deepEqual(observerView(state, state.groups[tribe.groups[0]].region).inspect!.polity!.standings, []);
  // A long history's census is thinned to at most 300 years, in order, the latest kept.
  const long = copied();
  long.census = Array.from({ length: 601 }, (_, at) => ({ year: (at + 1) * 10, ids: [], people: [], regions: [] }));
  const thinned = observerView(long, null).census.years;
  assert.ok(thinned.length <= 300 && thinned.length > 150);
  assert.ok(thinned.every((at, index) => index === 0 || at > thinned[index - 1]));
  assert.equal(thinned.at(-1), 6_010);
  // The contract: a frame with them passes, and an inconsistent one is refused.
  const frame = { ...frameOf(state, state.groups[civ.groups[0]].region), ...view } as ObserverFrame;
  const parsed = parseObserverFrame(structuredClone(frame));
  assert.equal(parsed.treaties.length, view.treaties.length);
  const altered = (change: (copy: ObserverFrame) => void) => { const copy = structuredClone(frame); change(copy); return copy; };
  assert.throws(() => parseObserverFrame(altered(copy => { copy.treaties.push({ ...copy.treaties[0] }); })), 'each pair and kind once');
  assert.throws(() => parseObserverFrame(altered(copy => { const first = copy.treaties[0]; copy.treaties[0] = { ...first, a: first.b, b: first.a }; })), 'the lower id first');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.treaties.push({ a: 0, b: 999_999, kind: 'alliance', count: 1 }); })), 'living civilizations');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.census.people[0].pop(); })), 'a value for each year');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.census.years.reverse(); })), 'years in order');
});

test('the chronicle reads backward a page at a time, with filters, exactly as the history holds it', () => {
  const state = copied(), events = state.chronicle.events, civ = largestCiv(state)!;
  const queries: ChronicleQuery[] = [
    { before: null, limit: 200, types: null, polity: null, min: 0 },
    { before: null, limit: 37, types: ['famine', 'drought', 'expansion', 'bandAbsorbed'], polity: null, min: 0 },
    { before: null, limit: 50, types: null, polity: civ.id, min: 0.05 },
  ];
  for (const query of queries) {
    const wanted = events.filter(event => event.importance >= query.min && (!query.types || query.types.includes(event.type)) && (query.polity === null || event.actors.some(actor => actor.id === query.polity))).reverse();
    const read: number[] = [];
    let before: number | null = null, pages = 0;
    do {
      const page = chroniclePage(state, { ...query, before });
      assert.ok(page.events.length <= query.limit);
      assert.ok(page.events.every((event, at) => at === 0 || event.id < page.events[at - 1].id), 'newest first');
      read.push(...page.events.map(event => event.id));
      assert.ok(page.next === null || page.next >= 1);
      before = page.next; pages++;
    } while (before !== null && pages < 1_000);
    assert.deepEqual(read, wanted.map(event => event.id), JSON.stringify(query));
    assert.ok(wanted.length > 0, 'the filter finds events');
  }
  // A page reads at most CHRONICLE_SCAN events: a filter matching nothing comes back empty with more to read.
  const long = { events: Array.from({ length: CHRONICLE_SCAN + 10 }, (_, id) => ({ ...events[0], id, tick: 0 })) } as unknown as SimulationState['chronicle'];
  const empty = chroniclePage({ ...state, chronicle: long } as SimulationState, { before: null, limit: 10, types: ['plague'], polity: null, min: 0 });
  assert.deepEqual(empty, { events: [], next: 10 });
});

test('the curated chronicle folds a people\'s runs of one kind of event, famines too, and every type has one kind', () => {
  let id = 100;
  // As the simulation writes them: a band taken in names the band first and the realm second.
  const event = (type: EventType, year: number, actor: number, data: Record<string, number> = {}, importance = 0.1) => ({
    id: id--, tick: year * 12, type, actors: type === 'bandAbsorbed' ? [{ id: 900 + actor, role: 'band' }, { id: actor, role: 'civ' }] : [{ id: actor, role: 'civ' }],
    region: 1, settlement: null, causes: [], parents: [], importance, data,
  });
  // Newest first, as the chronicle reads.
  const events = [
    event('famine', 900, 1, { deaths: 100 }, 0.4), event('famine', 900, 2, { deaths: 50 }), event('bandAbsorbed', 899, 1), event('famine', 890, 1, { deaths: 7 }),
    event('bandAbsorbed', 880, 1), event('bandAbsorbed', 880, 2), event('bandAbsorbed', 856, 1), event('wonderCompleted', 850, 1, {}, 0.7), event('wonderCompleted', 849, 1, {}, 0.7),
    event('bandAbsorbed', 820, 1),
  ];
  const entries = curate(events);
  assert.deepEqual(entries.map(entry => [entry.event.id, entry.more, entry.from / 12, entry.deaths]), [
    [100, 1, 890, 107], // the 1's famines in 900 and 890 (an important famine still folds): their deaths summed
    [99, 0, 900, 50], // another people's famine the same year is its own line
    [98, 2, 856, null], // the bands the realm 1 took in in 899, 880 and 856 (each from another band), each within 25 years of the next
    [95, 0, 880, null], // another realm's band
    [93, 0, 850, null], // two wonders: important events stand on their own lines
    [92, 0, 849, null],
    [91, 0, 820, null], // 36 years before the run's oldest: a new line
  ]);
  assert.equal(entries.reduce((sum, entry) => sum + entry.more + 1, 0), events.length, 'every event is in one line');
  assert.deepEqual(events.slice(0, 3).map(eventPeople), [1, 2, 1], 'the realm taking in, not the band');
  // Every event type has exactly one kind, and the kinds' types cover them all once.
  assert.deepEqual(Object.keys(EVENT_KIND).sort(), [...EVENT_TYPES].sort());
  assert.deepEqual(EVENT_KINDS.flatMap(kind => typesOf([kind])).sort(), [...EVENT_TYPES].sort());
});

test('reading on past a page\'s scan limit finds sparse events exactly', () => {
  const state = copied(), template = state.chronicle.events[0];
  // 120,000 events, one in 7,000 a famine.
  const events = Array.from({ length: 120_000 }, (_, at) => ({ ...template, id: at, tick: Math.floor(at / 100), type: at % 7_000 === 3 ? 'famine' as const : 'bandMoved' as const }));
  const long = { ...state, chronicle: { events } } as unknown as SimulationState;
  const read: number[] = [];
  let before: number | null = null, pages = 0;
  do { const page = chroniclePage(long, { before, limit: 200, types: ['famine'], polity: null, min: 0 }); read.push(...page.events.map(event => event.id)); before = page.next; pages++; } while (before !== null && pages < 100);
  assert.deepEqual(read, events.filter(event => event.type === 'famine').map(event => event.id).reverse());
  assert.ok(pages >= 3, 'it took several reads');
});

test('a chronicle page is validated', () => {
  const state = copied(), page = chroniclePage(state, { before: null, limit: 20, types: null, polity: null, min: 0 });
  const reply = { protocolVersion: SIMULATION_PROTOCOL_VERSION, runId: 'r', epoch: 0, eventCount: state.chronicle.events.length, ...page, names: actorNames(state, page.events) };
  assert.equal(parseChroniclePage(structuredClone(reply)).events.length, 20);
  assert.throws(() => parseChroniclePage({ ...reply, events: [...reply.events].reverse() }), 'newest first');
  assert.throws(() => parseChroniclePage({ ...reply, eventCount: reply.events[0].id }), 'within the history');
  assert.throws(() => parseChroniclePage({ ...reply, next: reply.events[0].id + 1 }), 'the next page starts below this one');
});

test('the perspective lens shows the map as a people knows it: in sight, remembered as last seen, or unknown', () => {
  const state = copied(), civ = largestCiv(state)!;
  const view = observerView(state, null, civ.id).perspective!;
  assert.equal(view.polity, civ.id);
  assert.deepEqual(view.observed, [...civ.map.observed].sort((a, b) => a - b));
  const remembered = [...civ.map.status.keys()].filter(region => civ.map.status[region] === KNOWN);
  assert.ok(remembered.length > 0, 'it remembers land out of sight');
  assert.deepEqual(view.remembered.regions, remembered);
  for (const [at, region] of view.remembered.regions.entries()) {
    const snapshot = civ.map.snapshots.get(region)!;
    assert.deepEqual([view.remembered.occupants[at], view.remembered.years[at]], [snapshot.occupant, Math.floor(snapshot.tick / 12)]);
    if (snapshot.occupant >= 0) assert.equal(new Map(view.names).get(snapshot.occupant), state.polities[snapshot.occupant].name);
  }
  assert.ok(view.observed.every(region => civ.map.status[region] === OBSERVED));
  // Nothing asked, or a people gone: no perspective.
  assert.equal(observerView(state, null).perspective, null);
  const gone = state.polities.find(polity => polity.deathTick !== null);
  if (gone) assert.equal(observerView(state, null, gone.id).perspective, null);
  // The contract.
  const frame = { ...frameOf(state, state.groups[civ.groups[0]].region), perspective: view } as ObserverFrame;
  assert.equal(parseObserverFrame(structuredClone(frame)).perspective!.observed.length, view.observed.length);
  const altered = (change: (copy: NonNullable<ObserverFrame['perspective']>) => void) => { const copy = structuredClone(frame); change(copy.perspective!); return copy; };
  assert.throws(() => parseObserverFrame(altered(copy => { copy.remembered.regions[0] = copy.observed[0]; copy.remembered.regions.sort((a, b) => a - b); })), 'in sight or remembered, not both');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.observed.reverse(); })), 'ascending');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.remembered.years[0] = Math.floor(frame.tick / 12) + 1; })), 'seen no later than now');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.names = []; })), 'every remembered people named');
  assert.throws(() => parseObserverFrame(altered(copy => { copy.remembered.occupants.pop(); })), 'one occupant per region');
});

test('the density lens shows each region\'s people over its area, from dark at 0.01 per km² to bright at 300 and more', () => {
  const state = copied(), view = observerView(state, null), densities = regionDensities(view.markers, region => state.partition.regions[region].areaKm2);
  assert.equal(densities.size, view.markers.regions.length, 'every inhabited region');
  for (const id of state.living) for (const group of state.polities[id].groups) {
    const { region, size } = state.groups[group];
    assert.ok(Math.abs(densities.get(region)! - size / state.partition.regions[region].areaKm2) < 1e-9, `region ${region}`);
  }
  const lightness = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const scale = [0.001, 0.01, 0.1, 0.5, 1, 5, 10, 50, 100, 300, 3000].map(density => lightness(densityColor(density)));
  assert.ok(scale.every((value, at) => at === 0 || value >= scale[at - 1]), 'brighter the denser');
  assert.deepEqual(densityColor(0.001), densityColor(DENSITY_RANGE[0]));
  assert.deepEqual(densityColor(3000), densityColor(DENSITY_RANGE[1]));
});

test('the frame\'s ruins are the history\'s ruined and razed settlements, and the weighed beliefs name their peoples', () => {
  const state = copied();
  // No ruins arise by year 1,000 here, so two regions away from any capital fall: one to ruin, one razed.
  const capitals = new Set(state.living.map(id => state.polities[id].capital));
  const regions = [...new Set(state.settlements.filter(settlement => settlement.status === 'alive').map(settlement => settlement.region))]
    .filter(region => state.regionSettlements[region].every(id => !capitals.has(id))).slice(0, 2);
  assert.equal(regions.length, 2, 'two settled regions without a capital');
  for (const region of regions) ruinSettlements(state, region, state.tick);
  for (const id of state.regionSettlements[regions[1]]) state.settlements[id].status = 'razed';
  const view = observerView(state, regions[0]), fallen = state.settlements.filter(settlement => settlement.status !== 'alive');
  assert.ok(fallen.some(settlement => settlement.status === 'ruined') && fallen.some(settlement => settlement.status === 'razed'), 'a ruin of each kind');
  assert.deepEqual(view.ruins.cells, fallen.map(settlement => settlement.cell));
  assert.deepEqual(view.ruins.names, fallen.map(settlement => settlement.name));
  assert.deepEqual(view.ruins.razed, fallen.map(settlement => settlement.status === 'razed' ? 1 : 0));
  assert.equal(view.settlements.ids.length + view.ruins.cells.length, state.settlements.length, 'every settlement, standing or in ruins');
  // The region's panel lists its ruins, and the frame passes the contract; arrays that do not line up are refused.
  assert.deepEqual(view.inspect!.settlements.filter(settlement => settlement.status === 'ruined').map(settlement => settlement.id), state.regionSettlements[regions[0]]);
  const frame = { ...frameOf(state, regions[0]), ruins: view.ruins };
  assert.deepEqual(parseObserverFrame(structuredClone(frame)).ruins, view.ruins);
  assert.throws(() => parseObserverFrame({ ...frame, ruins: { ...view.ruins, names: view.ruins.names.slice(1) } }));
  assert.throws(() => parseObserverFrame({ ...frame, ruins: { ...view.ruins, razed: view.ruins.razed.map(() => 2) } }));
  // Each belief a decision weighed is named.
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.kind !== 'civ') continue;
    for (const option of observerView(state, state.groups[polity.groups[0]].region).inspect!.polity!.lastDecision?.options ?? []) for (const belief of option.beliefs ?? []) assert.equal(belief.name, state.polities[belief.polity].name);
  }
});
