import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { joinScore } from '../src/simulation/allies.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { endTreaty } from '../src/simulation/diplomacy.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { observerView } from '../src/simulation/observer.ts';
import { believe, borderingCivs, decisionView, fearOf, hegemonyOf, knownPower } from '../src/simulation/perception.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stateHash, stepSimulation } from '../src/simulation/simulation.ts';
import { strengthOf } from '../src/simulation/soldiers.ts';
import type { Polity, SimulationState, TickContext } from '../src/simulation/state.ts';
import { WAR_TUNING } from '../src/simulation/tunables.ts';
import { couldHold, makeVassal, payVassals } from '../src/simulation/vassals.ts';
import { declareWar, inTruce, makePeace, wageWars, warBetween } from '../src/simulation/war.ts';
import { describeEvent } from '../src/observer/events.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Allies at war, hegemons and vassals (M6.5; VISION.md "Alliances and coalitions", "Ending wars"). Each test takes a
 * copy of a real history with two civilizations whose land touches (the attacker and the defender) and a third that has
 * met both (the ally), and sets up what it examines.
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
const trioOf = (state: SimulationState) => {
  for (const civ of civsOf(state).sort((a, b) => b.groups.length - a.groups.length || a.id - b.id)) {
    for (const other of borderingCivs(state, civ)) {
      if (state.polities[other].kind !== 'civ' || state.polities[other].groups.length < 4) continue;
      const third = civsOf(state).find(them => them.id !== civ.id && them.id !== other && them.met.has(civ.id) && them.met.has(other));
      if (third) return [civ.id, other, third.id] as const;
    }
  }
  return null;
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while ((!trioOf(history) || civsOf(history).length < 6) && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(trioOf(history), 'an attacker, a defender and a third civilization that knows both');
});

/** A copy at peace (every war over long ago), with no vassals, the three neutral to each other with no treaties between
 *  them, and the ally allied to the defender. */
function world(allied = true) {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  for (const war of state.wars) if (war.endTick === null) { war.endTick = state.tick; war.outcome = 'white'; war.occupied = []; }
  for (const war of state.wars) war.endTick = Math.min(war.endTick!, state.tick - WAR_TUNING.truceYears * 12 - 1);
  for (const polity of civsOf(state)) { polity.wars = []; polity.joined = []; polity.claims = []; polity.overlord = null; }
  state.occupiedBy.fill(-1);
  const [a, b, c] = trioOf(state)!.map(id => state.polities[id]);
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null || treaty.type === 'trade') continue;
    if ([a.id, b.id, c.id].filter(id => treaty.parties.includes(id)).length === 2) endTreaty(state, treaty, 'relationsSoured', state.tick);
  }
  for (const one of [a, b, c]) for (const other of [a, b, c]) {
    if (one === other) continue;
    one.pacts = one.pacts.filter(id => id !== other.id); one.allies = one.allies.filter(id => id !== other.id); one.roadPartners = one.roadPartners.filter(id => id !== other.id);
    one.relations.set(other.id, { intimacy: 0.8, opinion: 0, reasons: [], memories: [] });
  }
  if (allied) {
    state.treaties.push({ id: state.treaties.length, type: 'alliance', parties: [b.id, c.id], startTick: state.tick, endTick: null, endCause: null });
    b.allies.push(c.id); c.allies.push(b.id);
  }
  return { state, a, b, c };
}
const context = (state: SimulationState): TickContext => ({
  tick: state.tick, year: Math.floor(state.tick / 12), month: state.tick % 12 + 1,
  stream: (entity = 0) => { let seed = (state.tick * 7919 + entity * 104_729) >>> 0; return { next: () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed / 2 ** 32; } } as never; },
});
const soldiers = (state: SimulationState, polity: Polity, share: number) => {
  for (const id of polity.groups) { const group = state.groups[id]; group.soldiers = Math.floor((group.size - group.specialists) * share); }
};
const opinion = (from: Polity, of: Polity, value: number) => { from.relations.get(of.id)!.opinion = value; };
const overlordOf = (polity: Polity) => polity.overlord?.id ?? -1;
/** Soldiers enough for a strength (as near as whole soldiers allow), spread over its regions by their rural people. */
const strength = (state: SimulationState, polity: Polity, wanted: number) => {
  const total = Math.ceil(wanted / polity.knowledge.multipliers.military), rural = polity.groups.reduce((sum, id) => sum + state.groups[id].size - state.groups[id].specialists, 0);
  let left = total;
  for (const [at, id] of polity.groups.entries()) {
    const group = state.groups[id], share = at === polity.groups.length - 1 ? left : Math.round(total * (group.size - group.specialists) / rural);
    group.soldiers = Math.max(0, Math.min(group.size - group.specialists, share)); left -= group.soldiers;
  }
};
const goalOf = (state: SimulationState, a: Polity, b: Polity) => decisionView(state, a).warTargets.find(entry => entry.enemy === b.id)!.goal;
const begin = (state: SimulationState, a: Polity, b: Polity) => { declareWar(state, a, b, goalOf(state, a, b), 'conquest', -1, [{ factor: 'conquest', weight: 0.2 }]); return state.wars.at(-1)!; };
const told = (state: SimulationState, type: string, from: number) => { state.chronicle.flush(state.tick); return state.chronicle.events.slice(from).filter(event => event.type === type); };
const names = (state: SimulationState) => (id: number) => state.polities[id]?.name ?? '?';

test('an ally weighs joining by its own score: it joins and fights beside the defender, at war with the attacker; its treaties with it end and both remember', () => {
  const { state, a, b, c } = world();
  opinion(c, b, 80); opinion(c, a, -60);
  soldiers(state, a, 0.05); soldiers(state, b, 0.05); soldiers(state, c, 0.05);
  // A pact of the ally with the attacker ends when it joins.
  state.treaties.push({ id: state.treaties.length, type: 'nonAggression', parties: [c.id, a.id], startTick: state.tick, endTick: null, endCause: null });
  c.pacts.push(a.id); a.pacts.push(c.id);
  const parts = joinScore(state, c, b, a);
  assert.ok(parts.loyalty > 0 && parts.enmity > 0 && parts.pact < 0);
  const events = state.chronicle.events.length;
  const war = begin(state, a, b);
  assert.deepEqual(war.allies.map(entry => entry.id), [c.id], 'it joined');
  assert.deepEqual(c.joined, [war.id]);
  assert.equal(warBetween(state, c.id, a.id), war, 'at war with the attacker');
  assert.equal(warBetween(state, c.id, b.id), null, 'not with its ally');
  assert.ok(!c.pacts.includes(a.id) && !a.pacts.includes(c.id), 'its pact with the attacker ended');
  assert.ok(c.relations.get(a.id)!.memories.some(memory => memory.reason === 'war') && a.relations.get(c.id)!.memories.some(memory => memory.reason === 'war'));
  assert.ok(c.army.tick === state.tick, 'it set its army for war');
  const joined = told(state, 'allyJoined', events)[0];
  assert.ok(joined && joined.causes.some(cause => cause.factor === 'loyalty') && !joined.causes.some(cause => cause.factor === 'base'));
  assert.match(describeEvent(joined, names(state)), /join .* beside/);
  assert.deepEqual(decisionView(state, c).warTargets, [], 'no war of its own while it fights one');
  checkInvariants(state);
});

test('an ally that refuses is remembered as having abandoned its ally; an ally bound to both sides, or that never met the attacker, stays out', () => {
  const { state, a, b, c } = world();
  opinion(c, b, -5); opinion(c, a, 40);
  c.weariness = { value: 1, tick: state.tick };
  soldiers(state, a, 0.08); soldiers(state, b, 0.01); soldiers(state, c, 0.01);
  const parts = joinScore(state, c, b, a);
  assert.ok(Object.values(parts).reduce((sum, value) => sum + value, 0) <= 0);
  const events = state.chronicle.events.length;
  const war = begin(state, a, b);
  assert.deepEqual(war.allies, [], 'it refused');
  assert.ok(b.relations.get(c.id)!.memories.some(memory => memory.reason === 'abandoned'), 'abandoned');
  const refused = told(state, 'allyRefused', events)[0];
  assert.ok(refused && refused.causes.some(cause => cause.factor === 'weariness'));
  // Bound to the attacker too: it is not called (and nobody remembers anything).
  const other = world();
  opinion(other.c, other.b, 80);
  other.state.treaties.push({ id: other.state.treaties.length, type: 'alliance', parties: [other.c.id, other.a.id], startTick: other.state.tick, endTick: null, endCause: null });
  other.c.allies.push(other.a.id); other.a.allies.push(other.c.id);
  const second = begin(other.state, other.a, other.b);
  assert.deepEqual(second.allies, []);
  assert.ok(!other.b.relations.get(other.c.id)!.memories.some(memory => memory.reason === 'abandoned'));
  // Never met the attacker: it is not called either.
  const third = world();
  opinion(third.c, third.b, 80);
  third.c.met.delete(third.a.id); third.a.met.delete(third.c.id);
  const unmet = begin(third.state, third.a, third.b);
  assert.deepEqual(unmet.allies, []);
  assert.ok(!third.b.relations.get(third.c.id)!.memories.some(memory => memory.reason === 'abandoned'));
});

test('an ally on the front: its strength helps the defender, its dead are exact war deaths of its own, and at the peace it stands down weary, in truce with the attacker', () => {
  const run = (allied: boolean) => {
    const { state, a, b, c } = world(allied);
    opinion(c, b, 80); opinion(c, a, -60);
    soldiers(state, a, 0.08); soldiers(state, b, 0.04); soldiers(state, c, 0.06);
    const war = begin(state, a, b);
    return { state, a, b, c, war };
  };
  const alone = run(false), helped = run(true);
  assert.equal(helped.war.allies.length, 1);
  // The same month of war with and without the ally (the same chances): the attacker gains less against both.
  for (const { state } of [alone, helped]) { state.tick++; wageWars(state, context(state)); }
  assert.ok(helped.war.score < alone.war.score, 'the ally holds the attacker back');
  // Months of war: the ally's dead are its own, all of them war deaths.
  const { state, a, c, war } = helped, entry = war.allies[0];
  const before = { people: c.groups.reduce((sum, id) => sum + state.groups[id].size, 0), deaths: entry.deaths };
  let warDeaths = 0;
  for (let month = 0; month < 12 && war.endTick === null; month++) {
    state.tick++;
    const allyRegions = new Set(c.groups.map(id => state.groups[id].region));
    state.ledger.warDeaths.fill(0);
    wageWars(state, context(state));
    for (const region of allyRegions) warDeaths += state.ledger.warDeaths[region];
  }
  const after = c.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
  assert.ok(entry.deaths > before.deaths, 'it lost soldiers');
  assert.equal(before.people - after, entry.deaths - before.deaths);
  assert.equal(warDeaths, entry.deaths - before.deaths, 'all of them war deaths');
  assert.ok(entry.exhaustion > 0);
  // The peace: it stands down, weary, its war over; it is in truce with the attacker.
  makePeace(state, war, 'exhaustion');
  assert.deepEqual(c.joined, []);
  assert.ok(c.weariness.value >= entry.exhaustion && c.weariness.tick === state.tick);
  assert.equal(warBetween(state, c.id, a.id), null);
  assert.ok(inTruce(state, c.id, a.id), 'in truce with the attacker');
  // A month of the whole simulation after the peace: every invariant.
  stepSimulation(state);
});

test('a would-be hegemon is a threat to the peoples that know it, whatever they think of it, past a share of all the power they know; none from an ally', () => {
  const { state, a, c } = world(false);
  for (const other of civsOf(state)) if (other.id !== c.id && !c.met.has(other.id)) c.met.set(other.id, state.tick);
  opinion(c, a, 100);
  soldiers(state, a, 0);
  assert.equal(hegemonyOf(knownPower(state, c), a.id), 0, 'no hegemon without soldiers');
  // The attacker towers over all it knows: liked as it is, it is feared.
  const others = civsOf(state).filter(other => other.id !== a.id).reduce((sum, other) => sum + strengthOf(state, other), 0);
  soldiers(state, a, 0.3);
  assert.ok(strengthOf(state, a) > others, 'more than all the others together');
  const power = knownPower(state, c), threat = hegemonyOf(power, a.id);
  assert.ok(power.known >= WAR_TUNING.hegemon.known && threat > 0);
  assert.ok(fearOf(state, c, a) >= threat, 'feared whatever it thinks of them');
  const view = decisionView(state, c);
  assert.ok(view.threats.some(entry => entry.civ === a.id && entry.threat >= threat), 'among its threats, bordering it or not');
  assert.ok(view.needs.threat >= threat);
  // A people that knows few others sees no hegemon; nor is an ally one.
  c.allies.push(a.id);
  assert.equal(fearOf(state, c, a), 0);
  c.allies.pop();
  const few = { ...power, known: WAR_TUNING.hegemon.known - 1 };
  assert.equal(hegemonyOf(few, a.id), 0);
});

/** The two neighbours as winner and loser: the more populous one wins (an overlord holds a smaller realm). */
const pair = (state: SimulationState, a: Polity, b: Polity) => {
  const people = (polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
  return people(a) >= people(b) ? [a, b] as const : [b, a] as const;
};

test('vassalage: an overwhelming win over a realm too large to annex makes it a vassal; it pays its tribute exactly, makes no war, is defended by its overlord, and goes free when strong enough or its overlord is gone', () => {
  const { state, c, ...trio } = world(false), [a, b] = pair(state, trio.a, trio.b);
  const saved = { annexRegions: WAR_TUNING.annexRegions, annexPeople: WAR_TUNING.annexPeople };
  Object.assign(WAR_TUNING, { annexRegions: 0, annexPeople: 0 });
  soldiers(state, a, 0.05); soldiers(state, b, 0.02);
  const war = begin(state, a, b);
  const events = state.chronicle.events.length;
  try { war.score = 90; makePeace(state, war, 'exhaustion'); } finally { Object.assign(WAR_TUNING, saved); }
  assert.equal(war.outcome, 'vassalage');
  assert.equal(b.overlord?.id, a.id, 'the vassal of the winner');
  assert.equal(b.deathTick, null, 'not annexed');
  assert.ok(b.overlord!.amount > 0);
  const peace = told(state, 'peaceSigned', events).find(event => event.data.warId === war.id)!;
  assert.match(describeEvent(peace, names(state)), /become the vassal of the/);
  // No war of its own; its overlord none on it, though their truce is long past (and on it as a free neighbour).
  war.endTick = state.tick - WAR_TUNING.truceYears * 12 - 1;
  assert.deepEqual(decisionView(state, b).warTargets, []);
  assert.ok(!decisionView(state, a).warTargets.some(target => target.enemy === b.id), 'not on its vassal');
  const bond = b.overlord;
  b.overlord = null;
  assert.ok(decisionView(state, a).warTargets.some(target => target.enemy === b.id), 'but on a free neighbour');
  b.overlord = bond;
  // Eleven months of tribute (not a January), exact: what the vassal pays its overlord receives.
  b.wealth = 1_000_000; state.ledger.wealth.clear();
  const before = { vassal: b.wealth, overlord: a.wealth };
  for (let month = 2; month <= 12; month++) payVassals(state, month);
  const paid = b.overlord!.paid;
  assert.ok(paid > 0 && paid <= b.overlord!.amount);
  assert.equal(before.vassal - b.wealth, paid); assert.equal(a.wealth - before.overlord, paid);
  assert.equal(state.ledger.wealth.get(b.id)!.given, paid); assert.equal(state.ledger.wealth.get(a.id)!.received, paid);
  // A month of the whole simulation with the vassal: every invariant (its treasury's flows among them).
  stepSimulation(state);
  // Its overlord joins a war on it, without weighing it.
  assert.ok(b.overlord, 'still a vassal');
  {
    const capital = b.capital === null ? -1 : state.settlements[b.capital].region;
    declareWar(state, c, b, [state.groups[b.groups.find(id => state.groups[id].region !== capital) ?? b.groups[0]].region], 'conquest', -1, []);
    const attacked = state.wars.at(-1)!;
    assert.equal(attacked.attacker, c.id);
    assert.ok(attacked.allies.some(entry => entry.id === a.id), 'its overlord joins');
    makePeace(state, attacked, 'exhaustion');
  }
  // Strong enough as it believes: it throws its overlord off in January (its overlord remembers it); just short of it, not.
  assert.equal(b.overlord?.id, a.id);
  soldiers(state, a, 0.05);
  const threshold = WAR_TUNING.vassal.breakFree * believe(state, b, a, 'strength').estimate;
  strength(state, b, threshold * 0.95);
  assert.ok(strengthOf(state, b) < threshold);
  payVassals(state, 1);
  assert.equal(b.overlord?.id, a.id, 'not yet strong enough');
  strength(state, b, threshold * 1.05);
  assert.ok(strengthOf(state, b) >= threshold);
  const freed = state.chronicle.events.length;
  payVassals(state, 1);
  assert.equal(b.overlord, null, 'free');
  assert.ok(a.relations.get(b.id)!.memories.some(memory => memory.reason === 'threwOff'));
  assert.match(describeEvent(told(state, 'vassalFreed', freed)[0], names(state)), /throw off the rule of/);
  // Its overlord gone: free.
  b.overlord = { id: c.id, since: state.tick, war: war.id, amount: 10, carry: 0, paid: 0 };
  c.deathTick = state.tick; state.living.splice(state.living.indexOf(c.id), 1);
  payVassals(state, 5);
  assert.equal(b.overlord, null);
});

test('vassalage only over a realm the winner could hold; a vassal made another\'s is told; a history with allies and vassals is save-ready', () => {
  const { state, c, ...trio } = world(false), [a, b] = pair(state, trio.a, trio.b);
  const saved = { annexRegions: WAR_TUNING.annexRegions, annexPeople: WAR_TUNING.annexPeople };
  Object.assign(WAR_TUNING, { annexRegions: 0, annexPeople: 0 });
  try {
    // Strong enough to throw it off at once: cession or tribute instead.
    soldiers(state, a, 0.02); soldiers(state, b, 0.1);
    assert.ok(!couldHold(state, a, b));
    const first = begin(state, a, b);
    first.score = 90; makePeace(state, first, 'exhaustion');
    assert.notEqual(first.outcome, 'vassalage');
    assert.equal(overlordOf(b), -1);
    // Beaten and weak: the vassal of the winner, then made another's by a new overwhelming war, which is told.
    first.endTick = state.tick - WAR_TUNING.truceYears * 12 - 1;
    soldiers(state, a, 0.05); soldiers(state, b, 0.01); soldiers(state, c, 0.08);
    const second = begin(state, a, b);
    second.score = 90; makePeace(state, second, 'exhaustion');
    assert.equal(overlordOf(b), a.id);
    const events = state.chronicle.events.length;
    declareWar(state, c, b, [state.groups[b.groups[0]].region], 'conquest', -1, []);
    const third = state.wars.at(-1)!;
    assert.ok(third.allies.some(entry => entry.id === a.id), 'its overlord defends it');
    // A save mid-war, with an ally fighting and a vassal: the copy runs on exactly as the history.
    const copy: SimulationState = structuredClone(state);
    Object.setPrototypeOf(copy.chronicle, Chronicle.prototype);
    for (let month = 0; month < 6; month++) { stepSimulation(state); stepSimulation(copy); }
    assert.equal(stateHash(copy), stateHash(state), 'save-ready');
    // Made another's (at that war's peace): its old overlord is told.
    if (third.endTick === null) makePeace(state, third, 'exhaustion');
    assert.equal(overlordOf(b), a.id);
    makeVassal(state, b, c, third);
    assert.equal(overlordOf(b), c.id, 'the new winner\'s');
    const passed = told(state, 'vassalFreed', events).find(event => event.data.newOverlord === true)!;
    assert.ok(passed && passed.actors.some(actor => actor.id === a.id));
    assert.match(describeEvent(passed, names(state)), /pass from the rule of .+ to that of the /);
    checkInvariants(state);
  } finally { Object.assign(WAR_TUNING, saved); }
});

test('the frame shows allies in a war, and vassals and overlords in the standings and the realm panel', () => {
  const { state, a, b, c } = world();
  opinion(c, b, 80); opinion(c, a, -60);
  soldiers(state, a, 0.05); soldiers(state, b, 0.05); soldiers(state, c, 0.05);
  const war = begin(state, a, b);
  const region = state.groups[c.groups[0]].region, view = observerView(state, region);
  assert.deepEqual(view.wars.find(entry => entry.id === war.id)!.allies.map(entry => entry.id), [c.id]);
  assert.equal(view.inspect!.polity!.standings.find(entry => entry.id === a.id)!.status, 'war', 'the ally is at war with the attacker');
  // A vassal and its overlord (the war over).
  makePeace(state, war, 'exhaustion');
  b.overlord = { id: a.id, since: state.tick, war: war.id, amount: 10, carry: 0, paid: 0 };
  const vassal = observerView(state, state.groups[b.groups[0]].region).inspect!.polity!;
  assert.equal(vassal.standings.find(entry => entry.id === a.id)!.status, 'overlord');
  assert.equal(vassal.overlord!.id, a.id);
  const overlord = observerView(state, state.groups[a.groups[0]].region).inspect!.polity!;
  assert.equal(overlord.standings.find(entry => entry.id === b.id)!.status, 'vassal');
  assert.ok(overlord.vassals.some(entry => entry.id === b.id));
});
