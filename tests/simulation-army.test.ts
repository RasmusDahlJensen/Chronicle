import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { levy, setArmy } from '../src/simulation/army.ts';
import { costsOf, totalCosts } from '../src/simulation/budget.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { armyTarget } from '../src/simulation/decisions/army.ts';
import { farmOutput } from '../src/simulation/economy.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { observerView } from '../src/simulation/observer.ts';
import { armyView, believe, borderingCivs, type ArmyView } from '../src/simulation/perception.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { truthOf } from '../src/simulation/relations.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import { soldiersOf, soldierUpkeep, workersOf } from '../src/simulation/soldiers.ts';
import { stabilityOf } from '../src/simulation/stability.ts';
import type { Polity, SimulationState, TickContext } from '../src/simulation/state.ts';
import { ARMY_TUNING, DIPLOMACY_TUNING, NEED_TUNING } from '../src/simulation/tunables.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Armies (M6.1; VISION.md "Military strength", "Grounded in history"). The tests read a real history in which several
 * civilizations have kept armies for a century, and copies of it changed for one case each.
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
const peopleOf = (state: SimulationState, polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
const context = (state: SimulationState): TickContext => ({ tick: state.tick, year: Math.floor(state.tick / 12), month: state.tick % 12 + 1, stream: () => { throw new Error('the levy draws no numbers'); } });

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  const ready = () => civsOf(history).filter(civ => civ.army.tick >= 0 && civ.groups.length >= 3).length >= 5;
  while (!ready() && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  // A century of armies, checked every month.
  for (let month = 0; month < 1200; month++) stepSimulation(history);
  assert.ok(ready(), 'five civilizations of three regions or more that have set their armies');
});

function copy() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  return state;
}

test('soldiers are rural people under arms: within each region\'s rural people, none in a tribe, near their realm\'s target', () => {
  let armies = 0;
  for (const id of history.living) {
    const polity = history.polities[id];
    for (const groupId of polity.groups) {
      const group = history.groups[groupId];
      assert.ok(Number.isInteger(group.soldiers) && group.soldiers >= 0 && group.soldiers <= group.size - group.specialists, `group ${groupId}`);
      if (polity.kind === 'band') assert.equal(group.soldiers, 0, 'a tribe keeps no soldiers: its warriors hunt and herd');
    }
    if (polity.kind !== 'civ' || polity.army.tick < 0) continue;
    const soldiers = soldiersOf(history, polity), people = peopleOf(history, polity);
    assert.ok(soldiers > 0, `${polity.name} keeps an army`);
    assert.ok(polity.army.target >= 0.9 * ARMY_TUNING.floor * people, 'never below the floor (of its people at its last assessment)');
    assert.ok(soldiers <= ARMY_TUNING.maxShare * people, 'at most its regions\' share of their rural people');
    armies++;
  }
  assert.ok(armies >= 5);
  // A century in, the realms' armies are near what they mean to keep (raising takes about a year).
  const civs = civsOf(history).filter(civ => civ.army.tick >= 0);
  const kept = civs.reduce((sum, civ) => sum + soldiersOf(history, civ), 0), meant = civs.reduce((sum, civ) => sum + civ.army.target, 0);
  assert.ok(kept > 0.8 * meant && kept < 1.2 * meant, `${kept} soldiers kept of ${meant} meant`);
});

test('soldiers work no land: farm labour and farm taxes count only the rest', () => {
  const state = copy(), civ = civsOf(state).find(polity => polity.army.tick >= 0)!;
  const group = state.groups[civ.groups.find(id => state.groups[id].farmShare > 0.5 && state.groups[id].size - state.groups[id].specialists > 1000)!];
  group.soldiers = 0;
  const workers = workersOf(group), output = farmOutput(state, group);
  group.soldiers = Math.floor((group.size - group.specialists) / 2);
  assert.equal(workersOf(group), workers - group.soldiers);
  assert.ok(farmOutput(state, group) < output && farmOutput(state, group) > 0.4 * output, 'half its rural people under arms: about half the surplus to tax');
});

test('the army\'s upkeep is a cost paid with the others, in every wealth flow', () => {
  const state = copy(), civ = civsOf(state).filter(polity => soldiersOf(state, polity) > 0).sort((a, b) => soldiersOf(state, b) - soldiersOf(state, a))[0];
  const costs = costsOf(state, civ);
  assert.ok(Math.abs(costs.army - soldiersOf(state, civ) * soldierUpkeep(civ)) < 1e-6, 'its soldiers at their upkeep');
  // A better-armed army costs more: upkeep × the military multiplier^arms.
  const armed = { ...civ, knowledge: { ...civ.knowledge, multipliers: { ...civ.knowledge.multipliers, military: 2 } } } as Polity;
  assert.ok(Math.abs(soldierUpkeep(armed) - ARMY_TUNING.upkeep * 2 ** ARMY_TUNING.arms) < 1e-9);
  assert.equal(totalCosts(costs), costs.administration + costs.services + costs.upkeep + costs.roads + costs.army);
  // A year of payments: the army is paid from the treasury, and the accounts close every month.
  let paid = 0;
  for (let month = 0; month < 12; month++) {
    stepSimulation(state);
    paid += state.ledger.wealth.get(civ.id)?.army ?? 0;
    checkInvariants(state);
  }
  assert.ok(paid > 0.5 * costs.army, `${paid} paid of ${Math.round(costs.army)} a year`);
});

test('strength is soldiers times the military multiplier (a tribe\'s, its warriors\'), and beliefs estimate it', () => {
  const state = copy();
  for (const civ of civsOf(state)) assert.ok(Math.abs(truthOf(state, civ, 'strength') - soldiersOf(state, civ) * civ.knowledge.multipliers.military) < 1e-6);
  const tribe = state.living.map(id => state.polities[id]).find(polity => polity.kind === 'band')!;
  assert.ok(Math.abs(truthOf(state, tribe, 'strength') - peopleOf(state, tribe) * ARMY_TUNING.warriors * tribe.knowledge.multipliers.military) < 1e-6);
  // A belief moves with the truth: doubling an army doubles what others believe of it.
  const civ = civsOf(state).find(polity => borderingCivs(state, polity).length && soldiersOf(state, polity) > 0)!, watcher = state.polities[borderingCivs(state, civ)[0]];
  const before = believe(state, watcher, civ, 'strength').estimate;
  for (const id of civ.groups) state.groups[id].soldiers *= 2;
  assert.ok(Math.abs(believe(state, watcher, civ, 'strength').estimate - 2 * before) < 1e-6 * Math.max(1, before));
});

const view = (overrides: Partial<ArmyView> = {}): ArmyView => ({
  people: 1_000_000, militarism: 0.5, multiplier: 1.3, allies: 0, neighbours: [], revenue: 70_000, surplus: 0, arrears: 0, upkeep: 1.4, wars: 0, warIncome: 0, raided: 0, ...overrides,
});

test('the target: a guard that grows with Militarism, more under threat, held to what the realm can afford, never below the floor', () => {
  const calm = armyTarget(view());
  // (M6.3) Recent war income pays for more soldiers when it is what holds the army back.
  const atWar = view({ neighbours: [{ polity: 9, name: 'Kesh', strength: 50_000, opinion: -60, pact: false, war: true }] });
  assert.ok(armyTarget({ ...atWar, warIncome: 100_000 }).target > armyTarget(atWar).target, 'loot and tribute pay for soldiers');
  assert.equal(calm.target, Math.round(1_000_000 * ARMY_TUNING.garrison), 'a guard of garrison × its people at Militarism ½');
  assert.ok(armyTarget(view({ militarism: 0.9 })).target > calm.target, 'more for a militaristic people');
  // A hostile neighbour twice as strong as its guard threatens fully.
  const guard = calm.garrison * 1.3, hostile = { polity: 7, name: 'Vraye', strength: NEED_TUNING.threatScale * guard, opinion: -NEED_TUNING.hostileAt, pact: false, war: false };
  const threatened = armyTarget(view({ neighbours: [hostile], revenue: 1e9 }));
  assert.equal(threatened.threat, 1);
  assert.equal(threatened.threatened, Math.round(1_000_000 * ARMY_TUNING.threat), 'threat × its people more');
  assert.deepEqual(threatened.feared, { polity: 7, name: 'Vraye', strength: Math.round(hostile.strength) });
  assert.ok(armyTarget(view({ neighbours: [{ ...hostile, pact: true }], revenue: 1e9 })).threat <= 1 - DIPLOMACY_TUNING.pact.calm + 1e-9, 'less from a pact partner');
  assert.equal(armyTarget(view({ neighbours: [{ ...hostile, opinion: 10 }], revenue: 1e9 })).threat, 0, 'none from a neighbour it does not dislike');
  // What it can afford holds the army down: a realm whose other costs take its revenue keeps what its surplus and the
  // headroom allow; one with a surplus up to its army budget (afford × (½ + Militarism) of its revenue), less in arrears.
  const poor = armyTarget(view({ neighbours: [hostile] }));
  assert.ok(poor.target < threatened.target && poor.cut > 0, 'held to its budget');
  assert.equal(poor.target, Math.round(ARMY_TUNING.headroom * 70_000 / 1.4), 'no surplus: the headroom');
  const rich = armyTarget(view({ neighbours: [hostile], surplus: 20_000 }));
  assert.equal(rich.target, Math.round(ARMY_TUNING.afford * 1 * 70_000 / 1.4), 'a surplus: its army budget');
  assert.ok(armyTarget(view({ neighbours: [hostile], surplus: 20_000, arrears: 0.5 })).target < rich.target, 'less in arrears');
  assert.ok(armyTarget(view({ neighbours: [hostile], surplus: -0.2 * 70_000 })).target <= Math.round(ARMY_TUNING.floor * 1_000_000) + 1, 'a strained realm keeps its floor');
  assert.equal(armyTarget(view({ revenue: 0 })).target, Math.round(ARMY_TUNING.floor * 1_000_000), 'never below the floor');
});

test('raising takes about a year, releasing a few months; soldiers sent home unsettle their region for years', () => {
  const state = copy(), civ = civsOf(state).filter(polity => polity.army.tick >= 0).sort((a, b) => peopleOf(state, b) - peopleOf(state, a))[0];
  const people = peopleOf(state, civ), start = soldiersOf(state, civ), goal = start + Math.round(0.01 * people);
  civ.army.target = goal;
  for (let month = 0; month < 12; month++) { levy(state, context(state)); state.tick++; }
  const raised = soldiersOf(state, civ) - start;
  assert.ok(raised > 0.5 * (goal - start) && raised < 0.8 * (goal - start), `a year raises most of the gap, not all: ${raised} of ${goal - start}`);
  // Sent home: most of them within three months.
  const before = soldiersOf(state, civ);
  civ.army.target = Math.round(ARMY_TUNING.floor * people);
  for (let month = 0; month < 3; month++) { levy(state, context(state)); state.tick++; }
  assert.ok(soldiersOf(state, civ) < before - 0.6 * (before - civ.army.target), 'released within months');
  const region = state.groups[civ.groups[0]].region, unsettled = state.unsettled[region];
  assert.ok(unsettled > 0, 'its returning soldiers unsettle the region');
  const group = state.groups[state.groupAt[region]], burden = stabilityOf(state, civ, group, 0).demobilized;
  assert.ok(Math.abs(burden - ARMY_TUNING.demobUnrest * Math.min(1, unsettled / ARMY_TUNING.demobScale)) < 1e-9 && burden > 0);
  // It fades with a time constant of demobYears (in land where nobody lives, so no one else is sent home there).
  const empty = state.groupAt.findIndex(at => at < 0);
  state.unsettled[empty] = 0.01;
  for (let month = 0; month < ARMY_TUNING.demobYears * 12; month++) levy(state, context(state));
  assert.ok(Math.abs(state.unsettled[empty] - 0.01 * Math.exp(-1)) < 1e-6, 'and fades over the years');
});

test('a realm that comes to fear a neighbour mobilizes, and stands down when the threat passes (events with their causes)', () => {
  const state = copy();
  const civ = civsOf(state).find(polity => polity.army.tick >= 0 && borderingCivs(state, polity).some(other => state.polities[other].kind === 'civ' && !polity.allies.includes(other)))!;
  const other = state.polities[borderingCivs(state, civ).find(id => state.polities[id].kind === 'civ' && !civ.allies.includes(id))!];
  civ.pacts = civ.pacts.filter(id => id !== other.id);
  civ.wealth = 1e9; civ.arrears = 0;
  civ.relations.set(other.id, { intimacy: 1, opinion: -100, reasons: [], memories: [] });
  // Their army many times its guard.
  for (const id of other.groups) state.groups[id].soldiers = Math.floor((state.groups[id].size - state.groups[id].specialists) * ARMY_TUNING.maxShare);
  civ.army = { ...civ.army, target: civ.army.garrison, threatened: 0, cut: 0 };
  const events = state.chronicle.events.length;
  // A realm that can afford it (its budget, not its surplus, holds it back here).
  const tunables = ARMY_TUNING as { headroom: number }, headroom = tunables.headroom;
  tunables.headroom = 10;
  try { setArmy(state, civ); } finally { tunables.headroom = headroom; }
  const view = armyView(state, civ);
  assert.ok(view.neighbours.some(entry => entry.polity === other.id));
  assert.ok(civ.army.threatened > 0 && civ.army.feared === other.id, 'it fears them');
  state.chronicle.flush(state.tick);
  const raised = state.chronicle.events.slice(events).find(event => event.type === 'mobilization');
  assert.ok(raised, 'a mobilization');
  assert.equal(raised.data.feared, other.name);
  assert.equal(raised.causes[0].factor, 'threat');
  // Friends again: the threat passes and the army stands down.
  civ.relations.set(other.id, { intimacy: 1, opinion: 60, reasons: [], memories: [] });
  const count = state.chronicle.events.length;
  setArmy(state, civ);
  state.chronicle.flush(state.tick);
  const released = state.chronicle.events.slice(count).find(event => event.type === 'demobilization');
  assert.ok(released, 'a demobilization');
  assert.equal(released.causes[0].factor, 'threatPassed');
});

test('the frame carries the army: a realm\'s soldiers, target and reasons, a region\'s soldiers, the cost, and each realm\'s in the list', () => {
  const state = copy(), civ = civsOf(state).filter(polity => soldiersOf(state, polity) > 0).sort((a, b) => soldiersOf(state, b) - soldiersOf(state, a))[0];
  const region = state.groups[civ.groups[0]].region, view = observerView(state, region), polity = view.inspect!.polity!;
  const soldiers = soldiersOf(state, civ), people = peopleOf(state, civ);
  assert.deepEqual(polity.army, {
    soldiers, target: civ.army.target, share: Math.round(soldiers / people * 1e5) / 1e5, strength: Math.round(soldiers * civ.knowledge.multipliers.military),
    upkeep: Math.round(soldiers * soldierUpkeep(civ)), garrison: civ.army.garrison, threatened: civ.army.threatened, cut: civ.army.cut,
    feared: civ.army.feared >= 0 ? state.polities[civ.army.feared].name : null, raiders: civ.army.raiders,
  });
  assert.equal(polity.soldiers, state.groups[state.groupAt[region]].soldiers);
  assert.equal(polity.wealth!.costs.army, Math.round(costsOf(state, civ).army));
  assert.equal(view.civList.find(entry => entry.id === civ.id)!.soldiers, soldiers);
  assert.ok(polity.stability!.demobilized >= 0);
  // A tribe keeps no army.
  const tribe = state.living.map(id => state.polities[id]).find(entry => entry.kind === 'band')!;
  assert.equal(observerView(state, state.groups[tribe.groups[0]].region).inspect!.polity!.army, null);
});

test('events: a target rising by half is a mobilization, falling to two thirds a demobilization, each citing what changed', () => {
  const state = copy(), civ = civsOf(state).filter(polity => polity.army.tick >= 0).sort((a, b) => peopleOf(state, b) - peopleOf(state, a))[0];
  const decided = armyTarget(armyView(state, civ));
  assert.ok(decided.target >= 1_000, 'a realm large enough for the event threshold');
  const emitted = (previous: Polity['army'], announce = true) => {
    civ.army = previous;
    const count = state.chronicle.events.length;
    setArmy(state, civ, announce);
    state.chronicle.flush(state.tick);
    return state.chronicle.events.slice(count).filter(event => event.type === 'mobilization' || event.type === 'demobilization');
  };
  const base = { ...civ.army, tick: state.tick - 12, garrison: decided.garrison, threatened: decided.threatened, cut: decided.cut };
  // Rising by less than half: no event. By half or more: a mobilization, citing what grew (here its guard: growth).
  assert.equal(emitted({ ...base, target: Math.ceil(decided.target / 1.4) }).length, 0);
  const grew = emitted({ ...base, target: Math.floor(decided.target / 1.6), garrison: Math.floor(decided.garrison / 1.6) - decided.target });
  assert.deepEqual(grew.map(event => event.type), ['mobilization']);
  assert.equal(grew[0].causes[0].factor, 'growth');
  // Falling to two thirds or less: a demobilization, citing the threat that passed; shares of what moved, at most 1.
  const fell = emitted({ ...base, target: Math.ceil(decided.target * 1.6), threatened: decided.threatened + Math.ceil(decided.target * 0.6) });
  assert.deepEqual(fell.map(event => event.type), ['demobilization']);
  assert.equal(fell[0].causes[0].factor, 'threatPassed');
  assert.ok(fell[0].causes.every(cause => cause.weight <= 1));
  // A union sets the army quietly: no event, the united realm's target at once.
  assert.equal(emitted({ ...base, target: 1 }, false).length, 0);
  assert.equal(civ.army.target, decided.target);
});

test('the levy hands out the target in whole soldiers that sum to it, so a realm of small regions still keeps its army', () => {
  const state = copy(), civ = civsOf(state).filter(polity => polity.groups.length >= 5).sort((a, b) => b.groups.length - a.groups.length)[0];
  const target = civ.groups.length * 2 + 1;
  civ.army = { ...civ.army, target };
  for (const id of civ.groups) state.groups[id].soldiers = 0;
  for (let month = 0; month < 60; month++) levy(state, context(state));
  assert.equal(soldiersOf(state, civ), target, 'every soldier of the target raised');
  // Raising toward a higher target (and moving soldiers between its regions) unsettles nothing: the measure only fades.
  const before = civ.groups.map(id => state.unsettled[state.groups[id].region]);
  civ.army.target = target + civ.groups.length;
  for (let month = 0; month < 6; month++) levy(state, context(state));
  const fade = Math.exp(-6 / (ARMY_TUNING.demobYears * 12));
  civ.groups.forEach((id, at) => assert.ok(Math.abs(state.unsettled[state.groups[id].region] - before[at] * fade) < 1e-6, `region ${state.groups[id].region}`));
});
