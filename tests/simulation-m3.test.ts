import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { arrive, decisionView, emptyMap, hasMet, inheritContacts, KNOWN, knownRegions, lookAgain, observe, regionView, shareSurroundings, UNKNOWN, willingness, type Candidate, type PolityView } from '../src/simulation/perception.ts';
import { bestShare, choose, drivers, expansionScore, explorationScore, options, shareScore, unionScore } from '../src/simulation/decisions/choose.ts';
import { chooseJoin, joinOptions, joinScore } from '../src/simulation/decisions/join.ts';
import { stabilityOf } from '../src/simulation/stability.ts';
import { unrestDepth } from '../src/simulation/pressure.ts';
import type { JoinOption, JoinView, Neighbour, Partner } from '../src/simulation/perception.ts';
import { share } from '../src/simulation/sharing.ts';
import { BUILDING_INDEX, BUILDINGS } from '../src/simulation/buildings.ts';
import { bonusOf } from '../src/simulation/settlements.ts';
import { learn, startingKnowledge } from '../src/simulation/knowledge.ts';
import { teacherOf } from '../src/simulation/research.ts';
import { TECH_INDEX } from '../src/simulation/techs.ts';
import { createRng } from '../src/simulation/rng.ts';
import { BUDGET_TUNING, DECISION_TUNING, REACH_TUNING, SHARE_TUNING, STABILITY_TUNING } from '../src/simulation/tunables.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { soleCivilization } from '../src/simulation/scenarios.ts';
import { stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';

/**
 * Test fixture: a strip of six regions on one landmass (0–1–2–3–4–5) and an island (6) 200 km off region 5, with
 * hand-placed polities. Only what the perception rules read is filled in.
 */
function strip() {
  const line = [0, 1, 2, 3, 4, 5];
  const regions = [...line.map(id => ({
    id, landmass: 0, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other <= 5).map(region => ({ region, travelKm: 100, riverTier: 0 })),
    sea: id === 5 ? [{ region: 6, km: 200 }] : [],
  })), { id: 6, landmass: 1, neighbors: [], sea: [{ region: 5, km: 200 }] }];
  const state = {
    tick: 0, partition: { regions }, occupant: new Int32Array(7).fill(-1), owner: new Int32Array(7).fill(-1), groupAt: new Int32Array(7).fill(-1), harbors: new Uint8Array(7),
    groups: [] as { id: number; region: number }[], polities: [] as Polity[], metrics: { firstContacts: 0 }, chronicle: new Chronicle(),
  } as unknown as SimulationState;
  const polity = (kind: 'band' | 'civ', name: string, region: number) => {
    const entry = {
      id: state.polities.length, kind, name, groups: [] as number[], map: emptyMap(7), met: new Map<number, number>(), knowledge: { sea: 0 }, deathTick: null,
    } as unknown as Polity;
    state.polities.push(entry);
    place(entry, region);
    return entry;
  };
  // A polity's (only) group arrives in a region, as moving and settling do.
  const place = (entry: Polity, region: number) => {
    let group = state.groups[entry.groups[0]] as unknown as PopulationGroupStub | undefined;
    if (!group) { group = { id: state.groups.length, region }; state.groups.push(group as never); entry.groups.push(group.id); }
    else { state.occupant[group.region] = -1; lookAgain(entry); }
    group.region = region; state.occupant[region] = entry.id; if (entry.kind === 'civ') state.owner[region] = entry.id;
    arrive(state, entry, region, state.tick);
  };
  return { state, polity, place };
}
type PopulationGroupStub = { id: number; region: number };

test('a polity sees its regions and their neighbours; a civilization remembers what leaves its sight, a tribe forgets', () => {
  const { state, polity, place } = strip();
  const civ = polity('civ', 'Kesh', 1), tribe = polity('band', 'Vael', 4);
  observe(state, civ, 0); observe(state, tribe, 0);
  assert.deepEqual(civ.map.observed, [0, 1, 2]);
  assert.deepEqual(tribe.map.observed, [3, 4, 5]);
  assert.equal(regionView(state, civ, 4), null, 'beyond sight and never seen: unknown');
  assert.equal(state.metrics.firstContacts, 0, 'they have not seen each other');
  // The tribe moves next to the civilization: they meet on arrival, once and both ways.
  state.tick = 12;
  place(tribe, 2);
  observe(state, tribe, 12); observe(state, civ, 12);
  assert.ok(hasMet(civ, tribe.id) && hasMet(tribe, civ.id));
  assert.equal(state.metrics.firstContacts, 1);
  state.chronicle.flush(12);
  const contact = state.chronicle.events.find(event => event.type === 'firstContact')!;
  assert.deepEqual(contact.actors.map(actor => actor.id).sort(), [civ.id, tribe.id].sort());
  assert.equal(contact.data.sea, false);
  assert.equal(contact.tick, 12, 'the month it arrived');
  // The tribe forgets the land it left; the civilization moves away and remembers region 2 as it last saw it.
  assert.equal(tribe.map.status[5], UNKNOWN, 'a tribe keeps only what is in sight');
  state.tick = 24;
  place(civ, 0);
  observe(state, civ, 24);
  assert.deepEqual(civ.map.observed, [0, 1]);
  assert.equal(civ.map.status[2], KNOWN);
  assert.deepEqual(regionView(state, civ, 2), { region: 2, status: 'known', occupant: tribe.id, owner: -1, seen: 24 });
  // The tribe moves on: the civilization's memory is now stale, and it believes what it last saw.
  place(tribe, 3);
  observe(state, tribe, 24);
  assert.equal(state.occupant[2], -1);
  assert.equal(regionView(state, civ, 2)!.occupant, tribe.id, 'a stale snapshot is treated as current');
  assert.deepEqual(knownRegions(civ), [0, 1, 2]);
  assert.equal(regionView(state, civ, 1)!.status, 'observed');
});

test('neighbours tell a civilization what they see; a breakaway knows whom its parent knew; sea crossings widen sight', () => {
  const { state, polity } = strip();
  const civ = polity('civ', 'Kesh', 0), neighbour = polity('civ', 'Ora', 1), beyond = polity('band', 'Ilu', 2);
  observe(state, civ, 0); observe(state, neighbour, 0); observe(state, beyond, 0);
  assert.equal(civ.map.status[2], UNKNOWN, 'region 2 lies beyond its own sight');
  state.tick = 12;
  shareSurroundings(state, civ, 12);
  assert.equal(civ.map.status[2], KNOWN, 'learned from the neighbour, which sees region 2');
  assert.deepEqual(regionView(state, civ, 2), { region: 2, status: 'known', occupant: beyond.id, owner: -1, seen: 12 });
  assert.ok(hasMet(neighbour, beyond.id) && !hasMet(civ, beyond.id), 'hearing of a people is not meeting them');
  // A breakaway from the neighbour already knows the civilization, and the civilization knows it.
  const child = polity('band', 'Orani', 3);
  inheritContacts(state, child, neighbour, 12);
  assert.ok(hasMet(child, neighbour.id) && hasMet(child, civ.id) && hasMet(civ, child.id) && hasMet(neighbour, child.id));
  // Coastal sailing from a harbor reaches the island 200 km off region 5: someone living there is met across the sea.
  const islanders = polity('band', 'Tiru', 6), sailors = polity('civ', 'Mena', 5);
  observe(state, sailors, 12);
  assert.equal(hasMet(sailors, islanders.id), false, 'on foot the island is out of sight');
  (sailors.knowledge as { sea: number }).sea = 1;
  observe(state, sailors, 18);
  assert.equal(hasMet(sailors, islanders.id), false, 'Sailing without a harbor there: still out of sight');
  state.harbors[5] = 1;
  observe(state, sailors, 24);
  assert.ok(hasMet(sailors, islanders.id) && hasMet(islanders, sailors.id));
  // A seafarer that already sees an empty island meets newcomers there the month they land, though they cannot see back.
  state.occupant[6] = -1; islanders.groups.length = 0;
  const late = polity('band', 'Oru', 6);
  assert.equal(late.knowledge.sea, 0, 'the newcomers cannot see back across the sea');
  assert.ok(hasMet(sailors, late.id) && hasMet(late, sailors.id), 'met across the sea on arrival');
  state.chronicle.flush(24);
  const overSea = state.chronicle.events.find(event => event.type === 'firstContact' && event.data.sea === true);
  assert.ok(overSea && overSea.importance > 0.3, 'meeting across the sea is a notable first');
});

async function chronicleWorld() {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Chronicle', size: 'large' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

test('M3 acceptance: a civilization alone on Chronicle\'s largest landmass keeps expanding while it has governable land', async () => {
  const { geography, partition } = await chronicleWorld();
  // Labelled test fixture: the real rules, with every other starting band removed (src/simulation/scenarios.ts).
  const state = soleCivilization(geography, partition, 'Chronicle');
  assert.equal(state.living.length, 1);
  const civ = state.polities[state.living[0]];
  assert.equal(civ.kind, 'civ');
  let longest = 0, pressed = 0, crowded = 0, longestCrowded = 0;
  while (state.tick < 12 * 900) {
    stepSimulation(state);
    if (state.tick % 6) continue;
    const view = decisionView(state, civ), governable = view.candidates.some(candidate => candidate.capitalKm <= view.reachKm);
    // VISION.md M3: whenever land pressure is above 0.5 and land within its governance reach remains, the gap since its
    // last expansion stays under 50 years. With a wide reach it keeps expanding before it gets that crowded, so the
    // same must also hold, more strictly, from its first expansion on whenever its land pressure is above 0.25.
    if (view.landPressure > 0.5 && governable) { pressed++; longest = Math.max(longest, state.tick - civ.lastExpansion!); }
    if (view.landPressure > 0.25 && governable && civ.groups.length > 1) { crowded++; longestCrowded = Math.max(longestCrowded, state.tick - civ.lastExpansion!); }
  }
  assert.ok(longest < 50 * 12, `longest gap at land pressure > 0.5: ${(longest / 12).toFixed(1)} years over ${pressed} steps`);
  assert.ok(crowded > 100, `the civilization felt land pressure with land to take (${crowded} steps)`);
  assert.ok(longestCrowded < 50 * 12, `longest gap at land pressure > 0.25: ${(longestCrowded / 12).toFixed(1)} years`);
  assert.ok(civ.groups.length >= 20, `it expanded into ${civ.groups.length - 1} regions`);
  // Every expansion is an event citing why, and the civilization holds land only within reach of its capital.
  const expansions = state.chronicle.events.filter(event => event.type === 'expansion');
  assert.equal(expansions.length, state.metrics.expansions);
  assert.ok(expansions.every(event => event.causes.length > 0 && event.causes.some(cause => cause.factor === 'landPressure' || cause.factor === 'opportunity' || cause.factor === 'landValue')));
  const view = decisionView(state, civ);
  assert.ok(civ.decisions.length > 0 && civ.decisions.every(step => step.options.some(option => option.action === 'nothing')), 'Do nothing is always weighed');
  assert.ok(view.reachKm > 0);
});

test('a tribe that settles starts to remember; a newer view is kept when neighbours tell older news', () => {
  const { state, polity, place } = strip();
  const settler = polity('band', 'Kesh', 1), neighbour = polity('civ', 'Ora', 3);
  observe(state, settler, 0); observe(state, neighbour, 0);
  settler.kind = 'civ';
  state.tick = 12;
  place(settler, 0);
  observe(state, settler, 12);
  assert.equal(settler.map.status[2], KNOWN, 'once settled, land that leaves its sight is remembered');
  // Its own view of region 2 is from month 12; a report in month 12 does not replace it, a later one does.
  shareSurroundings(state, settler, 12);
  assert.equal(regionView(state, settler, 2)!.seen, 12);
});

/** A view for scoring tests: a civilization of 10,000 with neighbouring land as given. */
function view(overrides: Partial<PolityView>, candidates: Partial<Candidate>[] = []): PolityView {
  return {
    id: 1, tick: 1200, values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 }, sea: 0, seaTick: -1,
    reachKm: 1500, people: 10_000, landPressure: 0.5, hunger: 0, ownValue: 100_000, unknownFrontier: 0, regions: 4, unrestShare: 0, stability: 0.9, neighbours: [], partners: [], exchanges: 0,
    budget: { rate: 0.2, output: 0, sites: 0, costs: 0, treasury: 0, revenue: 0, surplus: 0, strain: 0, tradition: 0.5, calm: 0.9 },
    build: { monuments: 1, regions: 4, catalog: [], settlements: [], wonders: [], stability: 0.9, roads: { tier: 0, one: '', many: '', routes: [] } },
    candidates: candidates.map((entry, at) => ({ region: at + 10, from: 1, fromPeople: 10_000, pressure: 0.8, crossingKm: 400, capitalKm: 600, value: 100_000, tribe: false, ...entry })),
    ...overrides,
  };
}

test('decision scores: crowding, good land and Expansionism draw a civilization outward; distance from the capital holds it back', () => {
  const base = view({});
  const near = expansionScore(base, view({}, [{}]).candidates[0]);
  assert.ok(near.score > DECISION_TUNING.doNothing, `crowded, with good land near the capital, expanding outweighs doing nothing (${near.score.toFixed(3)})`);
  const score = (candidate: Partial<Candidate>, values: Partial<PolityView['values']> = {}) =>
    expansionScore(view({ values: { ...base.values, ...values } }), view({}, [candidate]).candidates[0]).score;
  assert.ok(score({ pressure: 0 }) <= 0.02, 'without crowding there is little reason to leave');
  assert.ok(score({ value: 30_000 }) < near.score && score({ value: 30_000 }) > 0, 'poor land is worth less, but still something');
  assert.ok(score({ tribe: true }) < near.score, 'land where a tribe lives is worth less');
  assert.ok(score({}, { expansionism: 0.9 }) > score({}, { expansionism: 0.1 }), 'Expansionism raises it');
  assert.ok(score({ capitalKm: 1500 }) > 0 && score({ capitalKm: 1500 }) < near.score, 'at the edge of its reach, mildly less');
  assert.ok(score({ capitalKm: 3000 }) < 0, 'far beyond its reach, not worth it');
  assert.ok(score({ capitalKm: Number.POSITIVE_INFINITY }) === Number.NEGATIVE_INFINITY, 'cut off from its capital, never');
  // Exploring needs unknown land next to it; Openness and a new sea reach make it likelier.
  assert.equal(explorationScore(view({})).score, 0);
  const curious = (overrides: Partial<PolityView>) => explorationScore(view({ unknownFrontier: 8, ...overrides })).score;
  assert.ok(curious({ values: { ...base.values, openness: 0.9 } }) > curious({ values: { ...base.values, openness: 0.1 } }));
  assert.ok(curious({ sea: 1, seaTick: 1100 }) > curious({}) + 0.2, 'a fresh sea reach makes exploring attractive');
  // Do nothing is always weighed; the choice is weighted random among the best options above the minimum.
  const all = options(view({ unknownFrontier: 8 }, [{}]));
  assert.deepEqual(all.map(option => option.action).sort(), ['expand', 'explore', 'nothing']);
  const picks = { expand: 0, explore: 0, nothing: 0, unite: 0, share: 0, build: 0 };
  for (let draw = 0; draw < 2000; draw++) picks[choose(view({ unknownFrontier: 8 }, [{}]), createRng(5, draw)).chosen.action]++;
  assert.ok(picks.expand > picks.explore && picks.explore > 0 && picks.nothing > 0, JSON.stringify(picks));
});

test('an expansion cites the needs that drove it, never its multipliers, and settlers must be there to send', () => {
  const crowded = view({}, [{}]);
  const option = expansionScore(crowded, crowded.candidates[0]);
  assert.deepEqual(drivers(option).map(entry => entry.factor), ['landPressure']);
  const empty = view({}, [{ fromPeople: 30 }]);
  assert.equal(expansionScore(empty, empty.candidates[0]).score, Number.NEGATIVE_INFINITY, 'too few people to send settlers');
  const tribe = view({}, [{ fromPeople: 30, tribe: true }]);
  assert.ok(expansionScore(tribe, tribe.candidates[0]).score > 0, 'a band living there can still be taken in');
});

/** A tribe of 5,000 deciding at settling, with civilizations next to it as given. */
function joining(options: Partial<JoinOption>[], values: Partial<JoinView['values']> = {}): JoinView {
  return {
    tribe: 1, people: 5_000, values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5, ...values },
    options: options.map((entry, at) => ({ civ: at + 10, kin: false, similarity: 0.7, seenPeople: 50_000, fed: 1, stability: 0.9, crossingKm: 400, border: 3, ...entry })),
  };
}

test('joining: kin, a large well-kept civilization and an easy crossing draw a settling tribe in; pride and tradition hold it back', () => {
  const score = (option: Partial<JoinOption>, values: Partial<JoinView['values']> = {}) => { const entry = joining([option], values); return joinScore(entry, entry.options[0]).score; };
  assert.ok(score({ kin: true }) > score({}), 'kin');
  assert.ok(score({ seenPeople: 500_000 }) > score({ seenPeople: 5_000 }), 'a larger civilization');
  assert.ok(score({ fed: 1, stability: 1 }) > score({ fed: 0.3, stability: 0.2 }), 'well fed and stable');
  assert.ok(score({ crossingKm: 2_000 }) < score({ crossingKm: 200 }), 'mountains or great rivers between them');
  assert.ok(score({}, { tradition: 0.9, expansionism: 0.9 }) < score({}, { tradition: 0.1, expansionism: 0.1 }), 'tradition and expansionism');
  // Founding its own is always an option; the choice is weighted random among the best.
  const all = joinOptions(joining([{ kin: true }, {}]));
  assert.ok(all.some(option => option.civ === null) && all.length === 3);
  let joined = 0;
  for (let draw = 0; draw < 1000; draw++) if (chooseJoin(joining([{ kin: true, seenPeople: 500_000 }]), createRng(3, draw)).chosen.civ !== null) joined++;
  assert.ok(joined > 600 && joined < 1000, `kin next to a large civilization mostly join, not always (${joined} of 1,000)`);
});

test('stability: hunger, distance beyond the capital\'s reach and foreign rule lower it; unrest grows below the threshold', () => {
  const values = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
  const state = {
    cultures: [{ values }, { values: { ...values, tradition: 0.9, openness: 0.1 } }], stability: new Float64Array([1, 0.3, 0]),
    settlements: [{ status: 'alive', buildings: [] as { type: number }[], bonus: { research: 1, wealth: 1, store: 1, spoilage: 1, stability: 0 } }], regionSettlements: [[], [0]], wonders: [],
  } as unknown as SimulationState;
  const civ = { culture: 0, knowledge: { multipliers: { reach: 1 } }, taxRate: BUDGET_TUNING.customaryRate, arrears: 0, groups: [], settledTick: null } as unknown as Polity;
  const group = (foodSecurity: number, culture = 0, region = 0) => ({ foodSecurity, culture, region }) as never;
  const reach = REACH_TUNING.baseKm;
  const home = stabilityOf(state, civ, group(1.2), reach / 2);
  assert.equal(home.value, STABILITY_TUNING.base, 'fed, near the capital, its own people');
  assert.ok(stabilityOf(state, civ, group(0.5), reach / 2).value < home.value, 'hunger');
  assert.ok(stabilityOf(state, civ, group(1.2), reach * 2).value < home.value, 'beyond reach');
  assert.equal(stabilityOf(state, civ, group(1.2), reach * 0.99).overextension, 0, 'within reach costs nothing');
  assert.ok(stabilityOf(state, civ, group(1.2, 1), reach / 2).foreignRule > 0, 'another people under its rule');
  // A shrine in the region steadies it (M3b.2).
  state.settlements[0].buildings.push({ type: BUILDING_INDEX.get('shrine')!, condition: 1, builtTick: 0 });
  state.settlements[0].bonus = bonusOf(state.settlements[0].buildings);
  assert.equal(stabilityOf(state, civ, group(0.5, 0, 1), reach / 2).value, stabilityOf(state, civ, group(0.5), reach / 2).value + BUILDINGS[BUILDING_INDEX.get('shrine')!].effects.stability!);
  assert.equal(unrestDepth(state, 0), 0);
  assert.ok(unrestDepth(state, 1) > 0 && unrestDepth(state, 1) < unrestDepth(state, 2));
  assert.equal(unrestDepth(state, 2), 1);
});

test('uniting: kin, a much larger and better-kept neighbour and its own troubles draw a civilization in; never into a smaller one', () => {
  const neighbour = (entry: Partial<Neighbour> = {}): Neighbour => ({ civ: 7, name: 'Ora', kin: false, similarity: 0.7, knownRegions: 60, fed: 1, stability: 0.9, crossingKm: 400, border: 3, ...entry });
  const score = (entry: Partial<Neighbour>, own: Partial<PolityView> = {}) => unionScore(view({ regions: 4, ...own }), neighbour(entry)).score;
  assert.ok(score({ kin: true }) > score({}), 'kin');
  assert.ok(score({ knownRegions: 200 }) > score({ knownRegions: 8 }), 'a much larger neighbour');
  assert.ok(score({}, { hunger: 0.6, unrestShare: 0.5 }) > score({}), 'its own hunger and unrest');
  assert.ok(score({}, { stability: 0.95 }) < score({}, { stability: 0.4 }), 'its own contentment holds it back');
  assert.ok(score({ crossingKm: 1800 }) < score({ crossingKm: 300 }), 'mountains or great rivers between them');
  assert.equal(score({ knownRegions: 3 }), Number.NEGATIVE_INFINITY, 'never into a smaller civilization');
  const option = unionScore(view({ regions: 4 }), neighbour({ kin: true }));
  assert.equal(option.label, 'Ora'); assert.equal(option.target, 7);
  // Uniting competes with the other actions at the same step.
  assert.ok(options(view({ regions: 4, neighbours: [neighbour({ kin: true, knownRegions: 200 })] }, [{}])).some(entry => entry.action === 'unite'));
});

test('sharing knowledge: what it would learn, kinship, likeness and Openness draw a civilization to share; Tradition and an unwilling people hold it back', () => {
  const partner = (entry: Partial<Partner> = {}): Partner => ({ polity: 9, name: 'Kesh', kind: 'civ', kin: false, similarity: 0.6, teach: 2, learn: 2, willing: 0.8, ...entry });
  const score = (entry: Partial<Partner>, values: Partial<PolityView['values']> = {}) => shareScore(view({ values: { ...view({}).values, ...values } }), partner(entry)).score;
  assert.ok(score({ learn: 4 }) > score({ learn: 0 }), 'what it would learn');
  assert.ok(score({ kin: true }) > score({}), 'kin');
  assert.ok(score({ similarity: 0.9 }) > score({ similarity: 0.1 }), 'a like-minded people');
  assert.ok(score({}, { openness: 0.9 }) > score({}, { openness: 0.1 }), 'Openness');
  assert.ok(score({}, { tradition: 0.9 }) < score({}, { tradition: 0.1 }), 'Tradition holds it back');
  assert.ok(score({ willing: 0.2 }) < score({ willing: 0.9 }), 'a people unlikely to accept');
  assert.equal(score({ teach: 0, learn: 0 }), Number.NEGATIVE_INFINITY, 'nothing to teach or learn');
  // What it would learn is the main draw. With nothing to learn, only an open people of little Tradition teaches its
  // kin for nothing in return; an ordinary people does not bother.
  assert.ok(score({ learn: 4 }) > DECISION_TUNING.doNothing, 'a people that knows much it lacks is worth an exchange');
  assert.ok(score({ learn: 0, teach: 4, kin: true }, { openness: 0.9, tradition: 0.1 }) > DECISION_TUNING.minScore);
  assert.ok(score({ learn: 0, teach: 4, kin: true }) < DECISION_TUNING.minScore);
  // Each exchange it already keeps up makes another less attractive.
  assert.ok(shareScore(view({ exchanges: 2 }), partner({ learn: 4 })).score < shareScore(view({}), partner({ learn: 4 })).score);
  const option = bestShare(view({ partners: [partner({ polity: 4, learn: 0 }), partner({ polity: 5, learn: 4 })] }))!;
  assert.equal(option.target, 5); assert.equal(option.label, 'Kesh'); assert.equal(option.action, 'share');
  assert.ok(drivers(option).every(entry => !entry.factor.startsWith('×')), 'the willingness is a multiplier, never a cause');
  assert.ok(options(view({ partners: [partner()] })).some(entry => entry.action === 'share'), 'sharing competes with the other actions');
  // The other side: strong Tradition and another way of life make it refuse; so, partly, does having nothing to gain.
  assert.equal(willingness(0, 0.2, 4), 1);
  assert.ok(willingness(0.9, 0.2, 4) < willingness(0.9, 0.9, 4) && willingness(0.9, 0.9, 4) < 1);
  assert.equal(willingness(0, 0.5, 0), SHARE_TUNING.gainBase, 'a people that would learn nothing is less ready to give');
});

test('an exchange runs both ways for decades, is an event with its causes, and a refusal is remembered', () => {
  const { state, polity } = strip();
  Object.assign(state, { cultures: [{ values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.2, expansionism: 0.5 } }, { values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 1, expansionism: 0.5 } }],
    settlements: [{ region: 0 }], metrics: { firstContacts: 0, exchanges: 0 } });
  const civ = polity('civ', 'Ora', 0), tribe = polity('band', 'Kesh', 1), stubborn = polity('band', 'Tal', 2);
  for (const entry of [civ, tribe, stubborn]) Object.assign(entry, { culture: 0, lineage: entry.id, capital: entry === civ ? 0 : null, core: entry.groups[0], exchanges: new Map(), exchangeRefused: new Map(), knowledge: startingKnowledge() });
  stubborn.culture = 1;
  const always = { chance: () => true } as never, never = { chance: () => false } as never;
  state.tick = 600;
  assert.equal(share(state, 600, always, civ, tribe, [{ factor: 'openness', weight: 0.1 }]), 'shares knowledge with the Kesh');
  const until = 600 + SHARE_TUNING.years * 12;
  assert.equal(civ.exchanges.get(tribe.id), until); assert.equal(tribe.exchanges.get(civ.id), until);
  state.chronicle.flush(600);
  const event = state.chronicle.events.find(entry => entry.type === 'knowledgeShared')!;
  assert.deepEqual(event.actors.map(actor => actor.id), [civ.id, tribe.id]); assert.ok(event.causes.length > 0);
  assert.match(share(state, 606, always, civ, tribe, []), /already/);
  // While it runs, each side is helped with what the other knows; never after it ends, nor by a people that is gone.
  const pottery = TECH_INDEX.get('Pottery')!;
  tribe.knowledge = learn(tribe.knowledge, pottery);
  assert.equal(teacherOf(state, civ, pottery), tribe.id);
  assert.equal(teacherOf(state, tribe, pottery), -1, 'the tribe knows nothing from the civilization that it lacks');
  assert.equal(teacherOf(state, stubborn, pottery), -1, 'no exchange, no help, however near');
  state.tick = until;
  assert.equal(teacherOf(state, civ, pottery), -1, 'the exchange has run out');
  state.tick = 606;
  tribe.deathTick = 606;
  assert.equal(teacherOf(state, civ, pottery), -1, 'the other people is gone');
  tribe.deathTick = null;
  // A people of strong Tradition and another way of life may refuse; the refusal is remembered.
  assert.match(share(state, 606, never, civ, stubborn, []), /would not share/);
  assert.equal(civ.exchangeRefused.get(stubborn.id), 606);
  assert.equal(state.metrics.exchanges, 1);
});
