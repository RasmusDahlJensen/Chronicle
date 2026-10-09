import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { construct } from '../src/simulation/construction.ts';
import { pactScore, roadDealScore } from '../src/simulation/decisions/choose.ts';
import { allianceAcceptance, diplomacyMonth, pactAcceptance, proposePact, proposeRoadDeal } from '../src/simulation/diplomacy.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { learn } from '../src/simulation/knowledge.ts';
import { believe, borderingCivs, decisionView, fearOf, KNOWN, strengthWithAllies } from '../src/simulation/perception.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { judge, truthOf } from '../src/simulation/relations.ts';
import { teacherOf } from '../src/simulation/research.ts';
import { jointRoute, keeperOf, roadUnkept } from '../src/simulation/roads.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Pact, Polity, RoadAgreement, SimulationState, TickContext } from '../src/simulation/state.ts';
import { TECH_INDEX, TECHS } from '../src/simulation/techs.ts';
import { routeOf } from '../src/simulation/trade.ts';
import { hubOf } from '../src/simulation/hubs.ts';
import { roadJoined } from '../src/simulation/treaties.ts';
import { DIPLOMACY_TUNING } from '../src/simulation/tunables.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Pacts, alliances and road agreements (M5.5; VISION.md "Diplomacy and war", "Roads"). Each test takes a copy of a real
 * history with two civilizations whose land touches, with no treaties, and sets what they think of each other.
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
const neighbourPair = (state: SimulationState) => {
  for (const civ of civsOf(state)) for (const other of borderingCivs(state, civ)) if (state.polities[other].kind === 'civ') return [civ.id, other] as const;
  return null;
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (!neighbourPair(history) && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(neighbourPair(history), 'two civilizations whose land touches');
});

/** What `one` thinks of `other` (and how well it knows them), set for the test. */
const feel = (one: Polity, other: Polity, opinion: number, intimacy = 0.5) => { one.relations.set(other.id, { intimacy, opinion, reasons: [], memories: [] }); };

/** A copy of the history with no treaties, the pair (`a`, `b`) neutral to each other, and every treasury full. */
function world() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  for (const treaty of state.treaties) if (treaty.endTick === null) { treaty.endTick = state.tick; treaty.endCause = 'partyGone'; }
  for (const polity of civsOf(state)) {
    polity.imports.fill(0); polity.exports.fill(0); polity.trading = []; polity.pacts = []; polity.allies = []; polity.roadPartners = [];
    polity.roadWorks = polity.roadWorks.filter(work => work.agreement === undefined); polity.wealth = 1_000_000_000;
    // No exchanges either (on both sides), so only treaties teach.
    for (const other of polity.exchanges.keys()) state.polities[other].exchanges.delete(polity.id);
    polity.exchanges = new Map();
  }
  const [a, b] = neighbourPair(state)!.map(id => state.polities[id]);
  feel(a, b, 0); feel(b, a, 0);
  state.ledger.wealth.clear();
  for (const polity of civsOf(state)) wealthFlows(state, polity);
  return { state, a, b, context: { tick: state.tick } as TickContext };
}
const events = (state: SimulationState, type: string) => { state.chronicle.flush(state.tick); return state.chronicle.events.filter(event => event.type === type); };
const total = (parts: Record<string, number>) => Object.values(parts).reduce((sum, value) => sum + value, 0);
/** Make `other` look (and be) overwhelming to `one`, and disliked: `one` fears it. */
const fearsome = (one: Polity, other: Polity) => {
  other.knowledge = { ...other.knowledge, multipliers: { ...other.knowledge.multipliers, military: 1_000 } };
  feel(one, other, -50);
};
const reviewTick = (treaty: Pact | RoadAgreement, from: number) => from + 1 + ((treaty.id - from - 1) % 12 + 12) % 12;

test('a pact is offered to a neighbour; an alliance against a feared neighbour to whoever it knows to border them', () => {
  const { state, a, b } = world();
  let view = decisionView(state, a);
  const neighbours = new Set(view.neighbours.map(entry => entry.civ));
  assert.ok(view.pacts.some(option => option.kind === 'nonAggression' && option.partner === b.id));
  assert.ok(view.pacts.filter(option => option.kind === 'nonAggression').every(option => neighbours.has(option.partner)), 'only neighbours');
  // It fears b: the pact's threat is that fear, and the belief behind it is logged.
  fearsome(a, b);
  view = decisionView(state, a);
  const pact = view.pacts.find(option => option.kind === 'nonAggression' && option.partner === b.id)!;
  assert.ok(pact.threat > 0 && pact.threat === view.threats.find(entry => entry.civ === b.id)?.threat);
  const scored = pactScore(view, pact);
  assert.equal(scored.action, 'pact');
  assert.ok((scored.factors.find(entry => entry.factor === 'threat')?.weight ?? 0) > 0);
  assert.deepEqual(scored.beliefs, [{ polity: b.id, kind: 'strength', estimate: Math.round(believe(state, a, b, 'strength').estimate) }]);
  assert.equal(view.pacts.filter(option => option.kind === 'alliance').length, 0, 'no one else it knows borders them');
  // It comes to believe a third civilization holds land beside b: an alliance against b is offered to it.
  const c = civsOf(state).find(civ => civ.id !== a.id && civ.id !== b.id)!;
  const beside = b.groups.flatMap(id => state.partition.regions[state.groups[id].region].neighbors.map(edge => edge.region)).find(region => state.owner[region] !== b.id && state.owner[region] !== a.id)
    ?? b.groups.flatMap(id => state.partition.regions[state.groups[id].region].neighbors.map(edge => edge.region)).find(region => state.owner[region] !== b.id)!;
  a.map.status[beside] = KNOWN; a.map.observed = a.map.observed.filter(region => region !== beside);
  a.map.snapshots.set(beside, { occupant: c.id, owner: c.id, tick: state.tick });
  for (const region of b.groups.map(id => state.groups[id].region)) if (a.map.status[region] === 0) { a.map.status[region] = KNOWN; a.map.snapshots.set(region, { occupant: b.id, owner: b.id, tick: state.tick }); }
  a.met.set(c.id, state.tick); feel(a, c, 40);
  view = decisionView(state, a);
  const alliance = view.pacts.find(option => option.kind === 'alliance')!;
  assert.equal(alliance.partner, c.id); assert.equal(alliance.enemy, b.id); assert.ok(alliance.threat > 0);
  const allied = pactScore(view, alliance);
  assert.equal(allied.action, 'alliance'); assert.deepEqual(allied.targets, [b.id]);
  // Not when it thinks too little of them.
  feel(a, c, DIPLOMACY_TUNING.alliance.minOpinion - 1);
  assert.equal(decisionView(state, a).pacts.filter(option => option.kind === 'alliance').length, 0);
});

test('the partner accepts only on its own score, never below the opinion at which the treaty would end; a refusal is remembered', () => {
  const { state, a, b, context } = world();
  // Liked: accepted.
  feel(b, a, 80);
  assert.ok(total(pactAcceptance(state, b, a)) > 0);
  const signed = events(state, 'nonAggressionPact').filter(event => event.actors[0].id === a.id).length;
  assert.match(proposePact(state, context, a, b, 'nonAggression', null, []), /signed a non-aggression pact/);
  assert.deepEqual(a.pacts, [b.id]); assert.deepEqual(b.pacts, [a.id]);
  assert.equal(events(state, 'nonAggressionPact').filter(event => event.actors[0].id === a.id).length, signed + 1, 'one event for the pact');
  checkInvariants(state);
  assert.match(proposePact(state, context, a, b, 'nonAggression', null, []), /already has/);
  // Detested: refused, whatever else it weighs, and remembered.
  const fresh = world();
  feel(fresh.b, fresh.a, DIPLOMACY_TUNING.end.pact - 1);
  assert.match(proposePact(fresh.state, fresh.context, fresh.a, fresh.b, 'nonAggression', null, []), /would not agree/);
  assert.equal(fresh.a.pacts.length, 0);
  assert.ok(fresh.a.relations.get(fresh.b.id)!.memories.some(memory => memory.reason === 'refusedTreaty'));
  assert.ok(!decisionView(fresh.state, fresh.a).pacts.some(option => option.partner === fresh.b.id), 'not asked again for a while');
  // Cool, though not below the line: its own score alone decides (here, against).
  const cool = world();
  // (It fears neither the proposer, weak in its eyes, nor anyone else: it likes all its other neighbours.)
  for (const other of borderingCivs(cool.state, cool.b)) feel(cool.b, cool.state.polities[other], 50);
  feel(cool.b, cool.a, DIPLOMACY_TUNING.end.pact + 5);
  cool.a.knowledge = { ...cool.a.knowledge, multipliers: { ...cool.a.knowledge.multipliers, military: 1e-6 } };
  assert.equal(pactAcceptance(cool.state, cool.b, cool.a).fear, 0);
  assert.ok(total(pactAcceptance(cool.state, cool.b, cool.a)) <= 0);
  assert.match(proposePact(cool.state, cool.context, cool.a, cool.b, 'nonAggression', null, []), /would not agree/);
  // An alliance: the partner's own fear of the common enemy decides.
  const third = world(), c = civsOf(third.state).find(civ => civ.id !== third.a.id && civ.id !== third.b.id)!;
  third.b.met.set(c.id, third.state.tick); fearsome(third.b, c); feel(third.b, third.a, 10);
  const parts = allianceAcceptance(third.state, third.b, third.a, c);
  assert.ok(parts.fear > 0 && total(parts) > 0);
  // Never against a people it is bound to itself.
  third.b.pacts.push(c.id);
  assert.equal(allianceAcceptance(third.state, third.b, third.a, c).bound, -1);
  assert.match(proposePact(third.state, third.context, third.a, third.b, 'alliance', c, []), /would not agree/);
  third.b.pacts.pop();
  third.a.relations.get(third.b.id)!.memories = [];
  assert.match(proposePact(third.state, third.context, third.a, third.b, 'alliance', c, []), /allied with/);
  assert.deepEqual(third.a.allies, [third.b.id]);
  third.state.chronicle.flush(third.state.tick);
  assert.equal(third.state.chronicle.events.at(-1)!.data.enemy, c.name);
});

test('a pact halves and an alliance removes the threat felt; an ally\'s strength counts, it teaches, and treaties warm relations', () => {
  const { state, a, b, context } = world();
  fearsome(a, b); feel(b, a, 80);
  const alone = fearOf(state, a, b);
  assert.ok(alone > 0);
  proposePact(state, context, a, b, 'nonAggression', null, []);
  assert.ok(Math.abs(fearOf(state, a, b) - alone * (1 - DIPLOMACY_TUNING.pact.calm)) < 1e-12, 'a pact halves it');
  for (let year = 0; year < 40; year++) judge(state, a, context.tick + year * 12);
  const relation = a.relations.get(b.id)!;
  assert.ok(relation.reasons.some(reason => reason.factor === 'pact' && reason.weight === DIPLOMACY_TUNING.opinion.pact));
  // Allied too: no threat, its strength counts beside its own, and it teaches what it knows.
  const c = civsOf(state).find(civ => civ.id !== a.id && civ.id !== b.id)!;
  b.met.set(c.id, state.tick); fearsome(b, c); feel(b, a, 80);
  assert.match(proposePact(state, context, a, b, 'alliance', c, []), /allied with/);
  checkInvariants(state);
  assert.equal(fearOf(state, a, b), 0);
  assert.ok(Math.abs(strengthWithAllies(state, a) - truthOf(state, a, 'strength') - DIPLOMACY_TUNING.alliance.strength * believe(state, a, b, 'strength').estimate) < 1e-6);
  const tech = TECHS.findIndex((_, at) => !a.knowledge.known[at]), known = b.knowledge.known.slice();
  known[tech] = 1; b.knowledge = { ...b.knowledge, known };
  assert.equal(teacherOf(state, a, tech), b.id);
  const before = a.relations.get(b.id)!.intimacy;
  for (let year = 40; year < 80; year++) judge(state, a, context.tick + year * 12);
  assert.ok(a.relations.get(b.id)!.intimacy >= before, 'intimacy rises toward what the treaties support');
  assert.ok(a.relations.get(b.id)!.reasons.some(reason => reason.factor === 'allied'));
});

test('treaties end when relations sour (remembered by both) or a party is gone, each with its event', () => {
  const { state, a, b, context } = world();
  feel(b, a, 80);
  proposePact(state, context, a, b, 'nonAggression', null, []);
  const pact = state.treaties.at(-1) as Pact;
  feel(b, a, DIPLOMACY_TUNING.end.pact - 1);
  const at = reviewTick(pact, context.tick);
  if (at > context.tick + 1) { diplomacyMonth(state, { tick: context.tick + 1 } as TickContext); assert.equal(pact.endTick, null, 'only at its yearly review'); }
  diplomacyMonth(state, { tick: at } as TickContext);
  assert.equal(pact.endCause, 'relationsSoured');
  assert.deepEqual(a.pacts, []); assert.deepEqual(b.pacts, []);
  assert.ok([a, b].every((one, side) => one.relations.get((side ? a : b).id)!.memories.some(memory => memory.reason === 'treatySoured')));
  const ended = events(state, 'treatyCancelled').at(-1)!;
  assert.equal(ended.data.pact, true); assert.equal(ended.data.relationsSoured, true);
  checkInvariants(state);
  const gone = world();
  feel(gone.b, gone.a, 80);
  proposePact(gone.state, gone.context, gone.a, gone.b, 'nonAggression', null, []);
  gone.b.deathTick = gone.state.tick;
  diplomacyMonth(gone.state, { tick: gone.context.tick + 1 } as TickContext);
  assert.equal((gone.state.treaties.at(-1) as Pact).endCause, 'partyGone');
  assert.deepEqual(gone.a.pacts, []);
});

test('a joint road runs through the two lands between their nearest towns, each side building its own stretch; done, it is a cross-border road', () => {
  const { state, a, b, context } = world();
  // Labelled test fixture: both know the Wheel, and the places on either side of their border are towns.
  const wheel = TECH_INDEX.get('Wheel')!;
  for (const civ of [a, b]) {
    for (const tech of [...TECHS[wheel].requires.map(name => TECH_INDEX.get(name)!), wheel]) if (!civ.knowledge.known[tech]) civ.knowledge = learn(civ.knowledge, tech);
  }
  let border: [number, number] | null = null;
  for (const id of a.groups) for (const edge of state.partition.regions[state.groups[id].region].neighbors) if (!border && state.owner[edge.region] === b.id) border = [state.groups[id].region, edge.region];
  for (const region of border!) for (const id of state.regionSettlements[region]) if (state.settlements[id].status === 'alive') state.settlements[id].tier = Math.max(1, state.settlements[id].tier);
  for (const region of border!) state.neglected[region] = 0;
  feel(a, b, 60); feel(b, a, 60);
  a.allies.push(b.id); b.allies.push(a.id);
  state.treaties.push({ id: state.treaties.length, type: 'alliance', parties: [a.id, b.id], startTick: state.tick, endTick: null, endCause: null });
  const option = decisionView(state, a).roads.find(entry => entry.partner === b.id)!;
  const route = jointRoute(state, a, b)!;
  assert.ok(option && option.allied && option.cost === route.sides[0].cost, 'its own stretch\'s cost');
  assert.ok(Number.isFinite(roadDealScore(decisionView(state, a), option).score));
  const hubs = [hubOf(state, a), hubOf(state, b)], capacity = routeOf(state, a, b, hubs[0], hubs[1]).capacity;
  assert.ok(route.path.every(region => state.owner[region] === a.id || state.owner[region] === b.id), 'through their two lands only');
  route.sides.forEach((stretch, side) => assert.ok(stretch.edges.every(([low]) => state.owner[low] === [a, b][side].id), 'each edge built by its keeper'));
  assert.match(proposeRoadDeal(state, context, a, b, []), /agreed a road/);
  const deal = state.treaties.at(-1) as RoadAgreement;
  assert.equal(deal.type, 'road'); assert.deepEqual(deal.cities, route.cities);
  assert.deepEqual(a.roadPartners, [b.id]); assert.deepEqual(b.roadPartners, [a.id]);
  const works = [a, b].map(civ => civ.roadWorks.find(work => work.agreement === deal.id));
  route.sides.forEach((stretch, side) => assert.equal(!!works[side], stretch.edges.length > 0));
  // Built month by month, each paying for its own stretch.
  for (let month = 1; month <= 600 && !(deal.built[0] && deal.built[1]); month++) {
    construct(state, { tick: context.tick + month } as TickContext);
    diplomacyMonth(state, { tick: context.tick + month } as TickContext);
  }
  assert.deepEqual(deal.built, [true, true]);
  assert.equal(state.metrics.crossBorderRoads, history.metrics.crossBorderRoads + 1);
  for (const [low, high] of [...route.sides[0].edges, ...route.sides[1].edges]) {
    const road = [...state.roads.values()].find(entry => entry.a === low && entry.b === high)!;
    assert.ok(road, 'the road stands on every edge');
    assert.ok(keeperOf(state, road) === a.id || keeperOf(state, road) === b.id);
  }
  assert.ok(events(state, 'roadBuilt').some(event => event.data.joint === true && event.data.partner !== ''));
  assert.ok(roadJoined(state, a, b));
  assert.equal(routeOf(state, a, b, hubs[0], hubs[1]).capacity, capacity + DIPLOMACY_TUNING.road.capacity, 'it carries their trade');
  // A road across their border wears only by its keeper's neglect, not by the neighbour's.
  const n = state.partition.regions.length, across = [...state.roads.values()].find(road => state.owner[road.a] !== state.owner[road.b] && [a.id, b.id].includes(state.owner[road.a]) && [a.id, b.id].includes(state.owner[road.b]));
  if (across) {
    const far = keeperOf(state, across) === state.owner[across.a] ? across.b : across.a, near = far === across.a ? across.b : across.a;
    state.neglected[far] = 1; assert.equal(roadUnkept(state, across), false, 'the neighbour\'s neglect');
    state.neglected[near] = 1; assert.equal(roadUnkept(state, across), true, 'its own');
    state.neglected[far] = 0; state.neglected[near] = 0;
  }
  // Worn away somewhere, the joint road is lost, and the agreement with it.
  const [from, to] = route.path;
  state.roads.delete(from < to ? from * n + to : to * n + from);
  diplomacyMonth(state, { tick: context.tick + 601 } as TickContext);
  assert.equal(deal.endCause, 'routeLost');
  assert.ok(!roadJoined(state, a, b));
});

test('a joint road whose town falls is abandoned, and the agreement ends with its works', () => {
  const { state, a, b, context } = world();
  const wheel = TECH_INDEX.get('Wheel')!;
  for (const civ of [a, b]) for (const tech of [...TECHS[wheel].requires.map(name => TECH_INDEX.get(name)!), wheel]) if (!civ.knowledge.known[tech]) civ.knowledge = learn(civ.knowledge, tech);
  let border: [number, number] | null = null;
  for (const id of a.groups) for (const edge of state.partition.regions[state.groups[id].region].neighbors) if (!border && state.owner[edge.region] === b.id) border = [state.groups[id].region, edge.region];
  for (const region of border!) { state.neglected[region] = 0; for (const id of state.regionSettlements[region]) if (state.settlements[id].status === 'alive') state.settlements[id].tier = Math.max(1, state.settlements[id].tier); }
  feel(a, b, 60); feel(b, a, 60); a.allies.push(b.id); b.allies.push(a.id);
  state.treaties.push({ id: state.treaties.length, type: 'alliance', parties: [a.id, b.id], startTick: state.tick, endTick: null, endCause: null });
  // Their roads so far gone, so each side has a stretch to build.
  state.roads.clear();
  assert.match(proposeRoadDeal(state, context, a, b, []), /agreed a road/);
  const deal = state.treaties.at(-1) as RoadAgreement;
  const work = [a, b].flatMap(civ => civ.roadWorks).find(entry => entry.agreement === deal.id)!;
  state.settlements[work.from].status = 'ruined';
  construct(state, { tick: context.tick + 1 } as TickContext);
  diplomacyMonth(state, { tick: context.tick + 1 } as TickContext);
  assert.equal(deal.endCause, 'routeLost');
  assert.ok([a, b].every(civ => !civ.roadWorks.some(entry => entry.agreement === deal.id)), 'its works end with it');
});

test('a road agreement whose road can no longer be built ends; the partner lists follow the treaties (invariant)', () => {
  const { state, a, b, context } = world();
  feel(b, a, 80);
  proposePact(state, context, a, b, 'nonAggression', null, []);
  checkInvariants(state);
  const broken = structuredClone(state);
  Object.setPrototypeOf(broken.chronicle, Chronicle.prototype);
  broken.polities[a.id].allies.push(b.id);
  assert.throws(() => checkInvariants(broken), (error: unknown) => error instanceof InvariantError && /alliance partners/.test(error.message));
  // A road agreement with no stretch under way and not built: its road is lost.
  state.treaties.push({ id: state.treaties.length, type: 'road', parties: [a.id, b.id], cities: [a.capital!, b.capital!], path: [state.settlements[a.capital!].region, state.settlements[b.capital!].region], built: [false, true], startTick: state.tick, endTick: null, endCause: null });
  a.roadPartners.push(b.id); b.roadPartners.push(a.id);
  diplomacyMonth(state, { tick: context.tick + 1 } as TickContext);
  assert.equal((state.treaties.at(-1) as RoadAgreement).endCause, 'routeLost');
  assert.deepEqual(a.roadPartners, []);
  assert.equal(events(state, 'treatyCancelled').at(-1)!.data.routeLost, true);
});
