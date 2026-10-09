import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { peaceScore, warScore } from '../src/simulation/decisions/choose.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { observerView } from '../src/simulation/observer.ts';
import { borderingCivs, decisionView, grievanceOf, type AtWar, type PolityView, type WarTarget } from '../src/simulation/perception.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState, TickContext, War } from '../src/simulation/state.ts';
import { WAR_TUNING } from '../src/simulation/tunables.ts';
import { chooseGoal, claimWeight, crossingOf, declareWar, frontierGain, goalWorth, inTruce, makePeace, medianEdge, ownLandValue, seekPeace, wageWars, warBetween } from '../src/simulation/war.ts';
import { futilityOf } from '../src/simulation/claims.ts';
import { edgeKm } from '../src/simulation/roads.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * War and peace (M6.2; VISION.md "Diplomacy and war"). Each test takes a copy of a real history with two civilizations
 * whose land touches, the second of four regions or more, and sets up the war it examines.
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
const peopleOf = (state: SimulationState, polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
const pairOf = (state: SimulationState) => {
  for (const civ of civsOf(state).sort((a, b) => b.groups.length - a.groups.length || a.id - b.id)) {
    for (const other of borderingCivs(state, civ)) if (state.polities[other].kind === 'civ' && state.polities[other].groups.length >= 4) return [civ.id, other] as const;
  }
  return null;
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (!pairOf(history) && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(pairOf(history), 'two civilizations whose land touches');
});

/** A copy with every war over long ago, the pair neutral to each other with no treaties between them, at peace. */
function world() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  for (const war of state.wars) if (war.endTick === null) { war.endTick = state.tick; war.outcome = 'white'; war.occupied = []; }
  for (const war of state.wars) war.endTick = Math.min(war.endTick!, state.tick - WAR_TUNING.truceYears * 12 - 1);
  for (const polity of civsOf(state)) { polity.wars = []; polity.claims = []; }
  state.occupiedBy.fill(-1);
  const [a, b] = pairOf(state)!.map(id => state.polities[id]);
  for (const [one, other] of [[a, b], [b, a]]) {
    one.pacts = one.pacts.filter(id => id !== other.id); one.allies = one.allies.filter(id => id !== other.id);
    one.relations.set(other.id, { intimacy: 0.8, opinion: 0, reasons: [], memories: [] });
  }
  return { state, a, b };
}
/** A month's context with a small reproducible stream (the fronts draw their chance from it). */
const context = (state: SimulationState): TickContext => ({
  tick: state.tick, year: Math.floor(state.tick / 12), month: state.tick % 12 + 1,
  stream: (entity = 0) => { let seed = (state.tick * 7919 + entity * 104_729) >>> 0; return { next: () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32; } } as never; },
});
const soldiers = (state: SimulationState, polity: Polity, share: number) => {
  for (const id of polity.groups) { const group = state.groups[id]; group.soldiers = Math.floor((group.size - group.specialists) * share); }
};
const goalOf = (state: SimulationState, a: Polity, b: Polity) => decisionView(state, a).warTargets.find(entry => entry.enemy === b.id)!.goal;
const begin = (state: SimulationState, a: Polity, b: Polity) => { declareWar(state, a, b, goalOf(state, a, b), 'conquest', -1, [{ factor: 'conquest', weight: 0.2 }]); return warBetween(state, a.id, b.id)!; };
/** A month of war at a set score (the front moves it a little; occupation follows it). */
const holdAt = (state: SimulationState, war: War, score: number) => { war.score = score; state.tick++; wageWars(state, context(state)); war.score = score; };

test('declaring war: on a neighbour, for its land beyond the border; never on an ally, during a war or a truce; a pact is broken; treaties end, both remember', () => {
  const { state, a, b } = world();
  const target = decisionView(state, a).warTargets.find(entry => entry.enemy === b.id);
  assert.ok(target, 'a neighbour it could go to war with');
  assert.ok(target.goal.length >= 1 && target.goal.length <= WAR_TUNING.goalRegions);
  for (const [at, region] of target.goal.entries()) {
    assert.equal(state.owner[region], b.id);
    assert.ok(state.partition.regions[region].neighbors.some(edge => state.owner[edge.region] === a.id || target.goal.slice(0, at).includes(edge.region)), 'their land next to its own, or beyond the goal so far');
  }
  assert.ok(state.partition.regions[target.goal[0]].neighbors.some(edge => state.owner[edge.region] === a.id), 'beginning at the border');
  a.allies.push(b.id);
  assert.ok(!decisionView(state, a).warTargets.some(entry => entry.enemy === b.id), 'not on an ally');
  a.allies.pop();
  // A pact partner can be attacked, at a cost: the pact is broken, an event, and the victim remembers it.
  const pact = { id: state.treaties.length, type: 'nonAggression' as const, parties: [a.id, b.id] as [number, number], startTick: state.tick - 120, endTick: null, endCause: null };
  state.treaties.push(pact); a.pacts.push(b.id); b.pacts.push(a.id);
  assert.equal(decisionView(state, a).warTargets.find(entry => entry.enemy === b.id)?.pact, true);
  const war = begin(state, a, b);
  assert.equal(pact.endCause, 'broken');
  assert.ok(!a.pacts.includes(b.id) && !b.pacts.includes(a.id));
  assert.ok(b.relations.get(a.id)!.memories.some(memory => memory.reason === 'brokeTreaty'));
  assert.ok(a.wars.includes(war.id) && b.wars.includes(war.id) && war.goal.length > 0);
  assert.ok(a.relations.get(b.id)!.memories.some(memory => memory.reason === 'war') && b.relations.get(a.id)!.memories.some(memory => memory.reason === 'war'), 'both remember it');
  assert.ok(!state.treaties.some(treaty => treaty.endTick === null && (treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties).includes(a.id) && (treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties).includes(b.id)), 'no treaty between them');
  assert.equal(decisionView(state, a).warTargets.length, 0, 'one war at a time');
  assert.ok(decisionView(state, b).atWar.some(entry => entry.enemy === a.id && !entry.attacker));
  state.chronicle.flush(state.tick);
  const declared = state.chronicle.events.at(-1)!;
  assert.ok(state.chronicle.events.some(event => event.type === 'warDeclared' && event.data.name === war.name && event.data.conquest === true));
  assert.ok(state.chronicle.events.some(event => event.type === 'treatyBroken' && event.data.war === war.name));
  void declared;
  makePeace(state, war, 'exhaustion');
  assert.ok(inTruce(state, a.id, b.id));
  assert.ok(!decisionView(state, a).warTargets.some(entry => entry.enemy === b.id), 'not within the truce');
  checkInvariants(state);
});

test('a month of war: the score follows the stronger side; the dead are exact war deaths; occupation follows the score; exhaustion rises', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  soldiers(state, a, 0.06); soldiers(state, b, 0.004);
  const before = peopleOf(state, a) + peopleOf(state, b);
  let dead = 0;
  for (let month = 0; month < 12; month++) {
    state.ledger.warDeaths.fill(0);
    state.tick++;
    wageWars(state, context(state));
    dead += state.ledger.warDeaths.reduce((sum, value) => sum + value, 0);
  }
  assert.ok(war.score > 0, `the stronger attacker gains: ${war.score}`);
  assert.ok(war.deaths[0] > 0 && war.deaths[1] > 0);
  assert.equal(war.deaths[0] + war.deaths[1], dead, 'every death is in the ledger');
  assert.equal(peopleOf(state, a) + peopleOf(state, b), before - dead, 'and leaves the people');
  assert.ok(war.exhaustion[0] > 0 && war.exhaustion[1] > 0);
  // Occupation: one region per occupyStep points of lead, given back as the score turns.
  holdAt(state, war, 2 * WAR_TUNING.occupyStep + 1);
  const held = war.occupied.filter(entry => entry.by === a.id).map(entry => entry.region);
  assert.equal(held.length, Math.min(war.goal.length, 2));
  for (const region of held) assert.equal(state.occupiedBy[region], a.id);
  holdAt(state, war, -1);
  assert.ok(held.every(region => state.occupiedBy[region] === -1), 'given back');
  // A year of the war in the whole simulation: every invariant holds each month (war deaths in the accounts).
  const { state: whole, a: one, b: other } = world();
  const fought = begin(whole, one, other);
  for (let month = 0; month < 12; month++) stepSimulation(whole);
  assert.ok(fought.endTick !== null || fought.deaths[0] + fought.deaths[1] > 0, 'the war goes on, with its dead');
});

test('the ground helps whoever is pushed back, and a people weighing war counts it; goals and counters seek natural frontiers', () => {
  const { state, a, b } = world();
  const goal = goalOf(state, a, b);
  for (const region of goal) assert.ok(crossingOf(state, region, a.id) >= 0 && crossingOf(state, region, a.id) <= 3);
  // The goal is chosen region by region, each next to its land or to one already chosen: first where its border would
  // move onto harder ground or run shorter, then good land.
  const capital = b.capital !== null ? state.settlements[b.capital].region : -1;
  const mayTake = (region: number) => region !== capital || b.groups.length <= WAR_TUNING.goalRegions;
  const own = ownLandValue(state, a), touches = (region: number, land: Set<number>) => state.partition.regions[region].neighbors.some(edge => land.has(edge.region));
  const mine = new Set(a.groups.map(id => state.groups[id].region)), taken = new Set<number>();
  for (const region of goal) {
    assert.equal(state.owner[region], b.id);
    assert.ok(touches(region, mine) || touches(region, taken), 'next to its land or the goal so far');
    taken.add(region);
  }
  const first = [...new Set(a.groups.flatMap(id => state.partition.regions[state.groups[id].region].neighbors.map(edge => edge.region)))]
    .filter(region => state.owner[region] === b.id && mayTake(region));
  assert.ok(first.every(region => goalWorth(state, region, a.id, 0, own) <= goalWorth(state, goal[0], a.id, 0, own)), 'the first is worth most');
  assert.deepEqual(chooseGoal(state, a.id, b.id, new Map(), own, mayTake).goal, goal);
  // The frontier it would gain: each border edge drawn counts its cost over the median edge less the barrier line, each
  // closed the same negated; borders with others do not count.
  let expected = 0;
  for (const edge of state.partition.regions[goal[0]].neighbors) {
    const owner = state.owner[edge.region], excess = edgeKm(edge.travelKm, edge.riverTier) / medianEdge(state) - WAR_TUNING.barrierEdge;
    if (owner === a.id) expected -= excess; else if (owner === b.id) expected += excess;
  }
  assert.ok(Math.abs(frontierGain(state, goal[0], a.id) - expected) < 1e-9);
  // Its believed odds count the ground it must take: harder ground, worse odds.
  const odds = () => decisionView(state, a).warTargets.find(entry => entry.enemy === b.id)!.odds;
  const plain = odds(), ground = WAR_TUNING.ground;
  (WAR_TUNING as { ground: number }).ground = ground + 4;
  try { assert.ok(odds() < plain, `${odds()} < ${plain}`); } finally { (WAR_TUNING as { ground: number }).ground = ground; }
  // The counter: the attacker's land the defender would take, chosen as a goal is (never the attacker's capital).
  const war = begin(state, a, b), ours = a.capital !== null ? state.settlements[a.capital].region : -1;
  assert.deepEqual(war.counter, chooseGoal(state, b.id, a.id, new Map(), ownLandValue(state, b), region => region !== ours).goal);
  assert.ok(war.counter.length > 0 && !war.counter.includes(ours));
  // A month from the same moment, with the ground counting more: the defender holds better when pushed into its land
  // (the score falls), the attacker when pushed into its own (the score rises).
  const month = (score: number, extra: number) => {
    const copy: SimulationState = structuredClone(state);
    Object.setPrototypeOf(copy.chronicle, Chronicle.prototype);
    const fought = copy.wars[war.id];
    fought.score = score;
    (WAR_TUNING as { ground: number }).ground = ground + extra;
    try { copy.tick++; wageWars(copy, context(copy)); } finally { (WAR_TUNING as { ground: number }).ground = ground; }
    return fought.score;
  };
  soldiers(state, a, 0.02); soldiers(state, b, 0.02);
  assert.ok(month(30, 4) < month(30, 0), 'into the defender\'s land');
  assert.ok(month(-30, 4) > month(-30, 0), 'into the attacker\'s land');
});

test('two wars on one realm never hold the same region; a realm annexed in one war ends its other wars that month', () => {
  const { state, a, b } = world();
  const c = civsOf(state).find(civ => civ.id !== a.id && civ.id !== b.id)!;
  const first = begin(state, a, b), region = first.goal[0];
  declareWar(state, c, b, [region], 'conquest', -1, []);
  const second = warBetween(state, c.id, b.id)!;
  assert.ok(second.id > first.id);
  // Both far enough ahead to hold it: the first to take it keeps it, the other waits.
  first.score = 60; second.score = 60;
  state.tick++; wageWars(state, context(state));
  assert.equal(state.occupiedBy[region], a.id);
  assert.ok(!second.occupied.some(entry => entry.region === region));
  checkInvariants(state);
  // The second war ends in annexation (a small loser): the first ends with it, its occupation lifted, that same month.
  const annexRegions = WAR_TUNING.annexRegions;
  (WAR_TUNING as { annexRegions: number }).annexRegions = 10_000;
  try {
    second.score = 100; second.exhaustion[1] = WAR_TUNING.peaceAt;
    state.tick++; wageWars(state, context(state));
  } finally { (WAR_TUNING as { annexRegions: number }).annexRegions = annexRegions; }
  assert.equal(second.outcome, 'annexation');
  assert.notEqual(b.deathTick, null);
  assert.equal(first.endTick, state.tick);
  assert.equal(first.outcome, 'gone');
  assert.deepEqual(first.occupied, []);
  assert.ok(!a.wars.includes(first.id));
  checkInvariants(state);
});

test('peace sought with a side already gone ends the war as such; no treaties with an enemy at war; a war fought again is the Second', () => {
  const { state, a, b } = world();
  const c = civsOf(state).find(civ => civ.id !== a.id && civ.id !== b.id)!;
  const first = begin(state, a, b);
  declareWar(state, c, b, [first.goal[0]], 'conquest', -1, []);
  const second = warBetween(state, c.id, b.id)!;
  // No pact, alliance, trade or joint road offered to the enemy while they fight.
  const view = decisionView(state, a);
  assert.ok(![...view.pacts, ...view.roads].some(option => option.partner === b.id) && !view.trades.some(option => option.partner === b.id));
  // The second war's victor annexes the defender at its decision step; the first attacker then seeks peace the same
  // month, with a side already gone: the war ends as such, and nothing is annexed or ceded twice.
  const annexRegions = WAR_TUNING.annexRegions;
  (WAR_TUNING as { annexRegions: number }).annexRegions = 10_000;
  try {
    second.score = 100; second.exhaustion[1] = WAR_TUNING.acceptExhaustion;
    assert.match(seekPeace(state, c, second, []), /peace/);
  } finally { (WAR_TUNING as { annexRegions: number }).annexRegions = annexRegions; }
  assert.equal(second.outcome, 'annexation');
  first.score = 90;
  assert.match(seekPeace(state, a, first, []), /no more/);
  assert.equal(first.outcome, 'gone');
  assert.ok(!decisionView(state, a).atWar.length);
  checkInvariants(state);
  // A war fought again under the same name is the Second.
  const { state: again, a: one, b: other } = world();
  const ended = begin(again, one, other);
  makePeace(again, ended, 'soughtPeace');
  again.tick += WAR_TUNING.truceYears * 12 + 12;
  const next = begin(again, one, other);
  if (next.name.replace(/^the Second /, 'the ') === ended.name) assert.match(next.name, /^the Second /);
  // Its wars that came to nothing weigh against the next: a white peace counts, fading by half every futilityHalfLife years.
  assert.equal(futilityOf(again, one.id, other.id), ended.outcome === 'white' ? 0.5 ** ((again.tick - ended.endTick!) / 12 / WAR_TUNING.futilityHalfLife) : 0);
});

test('peace terms follow the score: white, tribute, cession (land, people and claims move), annexation of a small loser', () => {
  const outcomes: [number, War['outcome']][] = [[5, 'white'], [25, 'tribute'], [60, 'cession']];
  for (const [score, outcome] of outcomes) {
    const { state, a, b } = world();
    const war = begin(state, a, b);
    if (outcome === 'cession') holdAt(state, war, score); else war.score = score;
    const regionsA = a.groups.length, regionsB = b.groups.length, taken = war.occupied.filter(entry => entry.by === a.id).map(entry => entry.region);
    makePeace(state, war, 'exhaustion');
    state.ledger.warDeaths.fill(0);
    assert.equal(war.outcome, outcome, `score ${score}`);
    assert.equal(a.wars.length + b.wars.length, 0);
    assert.ok(state.occupiedBy.every(value => value === -1), 'occupation lifted');
    if (outcome !== 'white') assert.ok(war.tribute && war.tribute.payer === b.id && war.tribute.payee === a.id && war.tribute.amount > 0, 'tribute');
    if (outcome === 'cession') {
      assert.ok(taken.length > 0);
      assert.equal(a.groups.length, regionsA + taken.length);
      assert.equal(b.groups.length, regionsB - taken.length);
      for (const region of taken) {
        assert.equal(state.owner[region], a.id);
        assert.equal(state.groups[state.groupAt[region]].polity, a.id);
        assert.ok(b.claims.some(claim => claim.region === region), 'the loser claims what it lost');
      }
      assert.ok(b.relations.get(a.id)!.memories.some(memory => memory.reason === 'lostLand'));
      assert.ok(grievanceOf(state, b) > 0.99, 'a fresh grievance');
    }
    state.chronicle.flush(state.tick);
    assert.ok(state.chronicle.events.some(event => event.type === 'peaceSigned' && event.data[outcome!] === true));
    stepSimulation(state);
  }
  // A small loser is annexed: its people, land and treasury pass to the winner, and it ends.
  const { state, a, b } = world();
  const war = begin(state, a, b), regions = a.groups.length + b.groups.length, treasury = a.wealth + b.wealth;
  const tunables = WAR_TUNING as { annexRegions: number }, annexRegions = tunables.annexRegions;
  tunables.annexRegions = 10_000;
  try { war.score = 90; makePeace(state, war, 'goalHeld'); } finally { tunables.annexRegions = annexRegions; }
  assert.equal(war.outcome, 'annexation');
  assert.notEqual(b.deathTick, null);
  assert.equal(a.groups.length, regions);
  assert.equal(a.wealth, treasury);
  stepSimulation(state);
});

test('tribute is paid month by month, from the loser to the winner, until it ends', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  war.score = 25;
  makePeace(state, war, 'exhaustion');
  b.wealth = 1e9;
  const paid = a.wealth;
  for (let month = 0; month < 24; month++) { state.tick++; wageWars(state, context(state)); }
  assert.ok(Math.abs(war.tribute!.paid - war.tribute!.amount * 2) <= 2, `two years of tribute: ${war.tribute!.paid} of ${war.tribute!.amount} a year`);
  assert.equal(a.wealth - paid, war.tribute!.paid);
});

test('seeking peace: accepted when the enemy is tired or the terms favour it; its score grows with exhaustion and losing', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  // The attacker, ahead, offers peace on terms the score gives: a loser not yet tired fights on; a tired one accepts.
  war.score = 50; war.exhaustion = [0.1, 0.1];
  assert.match(seekPeace(state, a, war, []), /fight on/, 'a loser not yet tired fights on');
  war.exhaustion = [0.1, WAR_TUNING.acceptExhaustion];
  assert.match(seekPeace(state, a, war, []), /peace/);
  assert.equal(war.outcome, 'tribute', 'tribute: it holds none of their land yet');
  const view = { values: { militarism: 0.5 } } as PolityView;
  const calm: AtWar = { war: 0, enemy: 1, name: 'X', attacker: false, lead: 0, exhaustion: 0, theirs: 0, months: 12 };
  assert.ok(peaceScore(view, { ...calm, exhaustion: 0.8 }).score > peaceScore(view, calm).score);
  assert.ok(peaceScore(view, { ...calm, lead: -60 }).score > peaceScore(view, calm).score);
});

test('the war option: its motives are its factors, the dominant one frames it, the odds and Militarism scale it', () => {
  const view = { values: { militarism: 0.6, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.7 }, hunger: 0, landPressure: 0, arrears: 0, weariness: 0 } as unknown as PolityView;
  const target: WarTarget = { enemy: 3, name: 'Kesh', goal: [10, 11], odds: 0.75, strength: 900, pact: false, reach: 0.5, opportunity: 0.8, land: 0, shortage: 0, resource: -1, holy: 0, claims: 0, threat: 0, opinion: -20, frontier: 0, futility: 0 };
  const option = warScore(view, target);
  assert.equal(option.action, 'war');
  assert.deepEqual(option.targets, [10, 11]);
  assert.equal(option.factors.filter(entry => !entry.factor.startsWith('×')).sort((x, y) => y.weight - x.weight)[0].factor, 'conquest');
  assert.ok(warScore(view, { ...target, odds: WAR_TUNING.declare.oddsFloor }).score <= 0, 'no chance, no war');
  assert.ok(warScore(view, { ...target, opinion: 80 }).score < option.score, 'a liked neighbour is spared');
  assert.ok(warScore(view, { ...target, pact: true }).score < option.score, 'breaking a pact weighs against it');
  assert.ok(warScore(view, { ...target, reach: 2 }).score < option.score, 'and land beyond its reach');
  assert.ok(warScore(view, { ...target, futility: 1 }).score < option.score, 'and wars on them that came to nothing');
  assert.ok(warScore({ ...view, values: { ...view.values, militarism: 0.1 } } as PolityView, target).score < option.score, 'a peaceful people is slower to war');
  assert.equal(warScore(view, { ...target, opportunity: 0, claims: 1 }).factors.filter(entry => !entry.factor.startsWith('×')).sort((x, y) => y.weight - x.weight)[0].factor, 'reclamation');
  // A natural frontier to be won: the border carried onto harder ground.
  assert.equal(warScore(view, { ...target, opportunity: 0, frontier: 1 }).factors.filter(entry => !entry.factor.startsWith('×')).sort((x, y) => y.weight - x.weight)[0].factor, 'frontier');
  assert.ok(warScore(view, { ...target, frontier: 1 }).score > option.score);
  assert.equal(claimWeight(0, 12 * WAR_TUNING.claimHalfLife), 0.5);
});

test('the frame carries wars, occupation, claims and the standing at war', () => {
  const { state, a, b } = world();
  const war = begin(state, a, b);
  holdAt(state, war, 60);
  const held = war.occupied.find(entry => entry.by === a.id)!;
  const view = observerView(state, held.region);
  const shown = view.wars.find(entry => entry.id === war.id)!;
  assert.ok(shown && shown.ended === null && shown.attacker === a.id && shown.defender === b.id && shown.occupied.some(entry => entry.region === held.region));
  assert.deepEqual(view.inspect!.occupation, { by: a.id, name: a.name, since: Math.floor(held.tick / 12) });
  assert.equal(view.inspect!.polity!.standings.find(entry => entry.id === a.id)?.status, 'war');
  makePeace(state, war, 'exhaustion');
  const after = observerView(state, state.groups[b.groups[0]].region);
  assert.equal(after.wars.find(entry => entry.id === war.id)!.outcome, 'cession');
  const row = after.inspect!.polity!.diplomacy.find(entry => entry.id === a.id);
  if (row) assert.ok(row.claims > 0, 'it claims the land it lost');
});
