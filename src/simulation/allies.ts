import type { ChronicleEvent } from '../../shared/simulation.ts';
import { setArmy } from './army.ts';
import { causes } from './causes.ts';
import { warBetween, wearinessOf } from './claims.ts';
import { endTreaty } from './diplomacy.ts';
import { believe, fearOf, meet, opinionOf } from './perception.ts';
import { remember } from './relations.ts';
import { strengthOf } from './soldiers.ts';
import type { Polity, SimulationState, War } from './state.ts';
import { endTrade } from './trade.ts';
import { WAR_TUNING } from './tunables.ts';

/**
 * Allies at war (VISION.md "Alliances and coalitions": "Defensive allies are called into wars and accept based on their
 * own scores"; M6.5). When a realm is attacked, each of its allies that knows the attacker weighs joining the war on
 * its side; a vassal's overlord joins it without weighing. An ally that joins fights beside the defender (`war.ts`:
 * its strength on the front, its own dead and weariness) until the peace; one that refuses is remembered for it.
 */

/** An ally's own score for joining its ally's war (each part shown on the event): its opinion of the defender and of
 *  the attacker, the threat it feels from the attacker, the odds as it believes them (its strength and the defender's
 *  against the attacker's), its war-weariness and arrears, a war it fights already and a pact with the attacker; the
 *  alliance itself (WAR_TUNING.allies.base) is a reason too. */
export function joinScore(state: SimulationState, ally: Polity, defender: Polity, attacker: Polity) {
  const tuning = WAR_TUNING.allies;
  const ours = strengthOf(state, ally) + believe(state, ally, defender, 'strength').estimate, theirs = believe(state, ally, attacker, 'strength').estimate;
  const odds = ours + theirs > 0 ? ours / (ours + theirs) : 0.5;
  return {
    alliance: tuning.base, loyalty: tuning.opinion * opinionOf(ally, defender.id) / 100, enmity: -tuning.enmity * opinionOf(ally, attacker.id) / 100,
    threat: tuning.threat * fearOf(state, ally, attacker), odds: tuning.odds * (2 * odds - 1),
    weariness: -tuning.weariness * wearinessOf(ally, state.tick), arrears: -tuning.arrears * ally.arrears,
    busy: ally.wars.length + ally.joined.length > 0 ? -tuning.busy : 0, pact: ally.pacts.includes(attacker.id) ? -tuning.pact : 0,
  };
}

/** The allies a defender calls (the war just declared): its allies that know the attacker, are bound to neither side
 *  against the other and fight no war with it already, and its overlord. */
export function callAllies(state: SimulationState, war: War, attacker: Polity, defender: Polity) {
  const overlord = defender.overlord?.id ?? -1, called = new Set(defender.allies);
  if (overlord >= 0) called.add(overlord);
  for (const id of [...called].sort((a, b) => a - b)) {
    const ally = state.polities[id];
    if (id === attacker.id || ally.deathTick !== null || ally.kind !== 'civ' || warBetween(state, id, attacker.id)) continue;
    if (id === overlord) { join(state, war, ally, attacker, defender, [{ factor: 'overlord', weight: 1 }], true); continue; }
    // A vassal fights no war of its own; an ally bound to the attacker too, or that has never met it, stays out.
    if (ally.overlord !== null || ally.allies.includes(attacker.id) || !ally.met.has(attacker.id)) continue;
    const parts = joinScore(state, ally, defender, attacker), score = Object.values(parts).reduce((sum, value) => sum + value, 0);
    if (score > 0) join(state, war, ally, attacker, defender, causes(Object.fromEntries(Object.entries(parts).filter(([, weight]) => weight > 0))), false);
    else refuse(state, war, ally, attacker, defender, parts);
  }
}

/** An ally joins: it fights beside the defender from now on; its treaties with the attacker end and both remember the war. */
function join(state: SimulationState, war: War, ally: Polity, attacker: Polity, defender: Polity, cited: ChronicleEvent['causes'], overlord: boolean) {
  war.allies.push({ id: ally.id, tick: state.tick, carry: 0, deaths: 0, exhaustion: 0 });
  ally.joined.push(war.id);
  // An overlord that never met the attacker meets it now, in the war.
  if (!ally.met.has(attacker.id)) meet(state, ally, attacker, war.goal[0], state.tick);
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) continue;
    const parties = treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties;
    if (!(parties.includes(ally.id) && parties.includes(attacker.id))) continue;
    if (treaty.type === 'trade') endTrade(state, treaty, 'relationsSoured', state.tick);
    else endTreaty(state, treaty, 'relationsSoured', state.tick);
  }
  remember(state, ally, attacker.id, 'war'); remember(state, attacker, ally.id, 'war');
  state.metrics.alliesJoined++;
  state.chronicle.emit({
    type: 'allyJoined', actors: [{ id: ally.id, role: 'ally' }, { id: defender.id, role: 'defender' }, { id: attacker.id, role: 'attacker' }], region: war.goal[0] ?? null, causes: cited, importance: 0.3,
    data: { ally: ally.name, defender: defender.name, attacker: attacker.name, name: war.name, warId: war.id, overlord },
  });
  setArmy(state, ally);
}

/** An ally refuses: the defender remembers being abandoned. */
function refuse(state: SimulationState, war: War, ally: Polity, attacker: Polity, defender: Polity, parts: Record<string, number>) {
  remember(state, defender, ally.id, 'abandoned');
  state.metrics.alliesRefused++;
  const against = causes(Object.fromEntries(Object.entries(parts).filter(([, weight]) => weight < 0).map(([factor, weight]) => [factor, -weight])));
  state.chronicle.emit({
    type: 'allyRefused', actors: [{ id: ally.id, role: 'ally' }, { id: defender.id, role: 'defender' }, { id: attacker.id, role: 'attacker' }], region: war.goal[0] ?? null, causes: against, importance: 0.25,
    data: { ally: ally.name, defender: defender.name, attacker: attacker.name, name: war.name, warId: war.id },
  });
}

/** The allies still fighting a war (living), with their entries. */
export const fightingAllies = (state: SimulationState, war: War) => war.allies.filter(entry => state.polities[entry.id].deathTick === null);

/** The peace: its living allies stand down, weary as the war left them. */
export function releaseAllies(state: SimulationState, war: War) {
  for (const entry of war.allies) {
    const ally = state.polities[entry.id];
    ally.joined = ally.joined.filter(id => id !== war.id);
    if (ally.deathTick !== null) continue;
    ally.weariness = { value: Math.max(wearinessOf(ally, state.tick), entry.exhaustion), tick: state.tick };
    setArmy(state, ally);
  }
}
