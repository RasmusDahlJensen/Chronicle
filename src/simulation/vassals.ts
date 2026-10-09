import { wealthFlows } from './economy.ts';
import { believe, budgetView } from './perception.ts';
import { addWarIncome } from './ravages.ts';
import { remember } from './relations.ts';
import { strengthOf } from './soldiers.ts';
import type { Polity, SimulationState, War } from './state.ts';
import { WAR_TUNING } from './tunables.ts';

/**
 * Vassals (VISION.md "Ending wars": "Overwhelming: vassalage, or annexation if the loser is small"; M6.5). A realm
 * beaten overwhelmingly but too large to annex becomes its winner's vassal: it pays a share of its revenue a year,
 * declares no war of its own and is defended by its overlord, until it believes itself as strong as its overlord and
 * throws it off, or its overlord is gone. Only a realm the winner could hold is made a vassal (`couldHold`). There are
 * no chains: a vassal's own vassals go free, and a vassal makes none; a vassal made another's passes to it.
 */

/** A year's tribute: WAR_TUNING.vassal.share of the vassal's revenue at customary taxes. */
const tributeOf = (state: SimulationState, vassal: Polity) => Math.round(WAR_TUNING.vassal.share * budgetView(state, vassal).revenue);

/** Whether a vassal believes itself strong enough to throw `overlord` off (its strength against its belief of theirs). */
export const strongEnough = (state: SimulationState, vassal: Polity, overlord: Polity) => strengthOf(state, vassal) >= WAR_TUNING.vassal.breakFree * believe(state, vassal, overlord, 'strength').estimate;

/** Whether `winner` could hold `loser` as its vassal: no vassal itself, `loser` at most vassal.maxSize × its people
 *  and not strong enough to throw it off at once. */
export function couldHold(state: SimulationState, winner: Polity, loser: Polity) {
  const people = (polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
  return winner.overlord === null && people(loser) <= WAR_TUNING.vassal.maxSize * people(winner) && !strongEnough(state, loser, winner);
}

/** A peace makes `vassal` the vassal of `overlord` (a war's terms; null for the development control). */
export function makeVassal(state: SimulationState, vassal: Polity, overlord: Polity, war: War | null) {
  for (const id of state.living.slice()) if (state.polities[id].overlord?.id === vassal.id) free(state, state.polities[id], 'overlordFell');
  // A vassal of another passes to its new overlord: its old one is told.
  if (vassal.overlord && vassal.overlord.id !== overlord.id) free(state, vassal, 'newOverlord', overlord);
  vassal.overlord = { id: overlord.id, since: state.tick, war: war?.id ?? -1, amount: tributeOf(state, vassal), carry: 0, paid: 0 };
  state.metrics.vassalages++;
}

/** A vassal goes free: it threw its overlord off (its overlord remembers it), its overlord is gone, or its overlord
 *  became a vassal itself. */
function free(state: SimulationState, vassal: Polity, cause: 'strength' | 'overlordGone' | 'overlordFell' | 'newOverlord', by: Polity | null = null) {
  const bond = vassal.overlord!, overlord = state.polities[bond.id];
  vassal.overlord = null;
  if (cause === 'strength') remember(state, overlord, vassal.id, 'threwOff');
  state.metrics.vassalsFreed++;
  state.chronicle.emit({
    type: 'vassalFreed', actors: [{ id: vassal.id, role: 'vassal' }, { id: overlord.id, role: 'overlord' }], region: null, causes: [{ factor: cause, weight: 1 }], importance: 0.3,
    data: { vassal: vassal.name, overlord: overlord.name, years: Math.round((state.tick - bond.since) / 12), paid: bond.paid, by: by?.name ?? '', [cause]: true },
  });
}

/** War system, each month: vassals pay their tribute (a twelfth of the year's while they can); each January the year's
 *  tribute is set from the vassal's revenue, and a vassal that believes itself as strong as its overlord throws it off. */
export function payVassals(state: SimulationState, month: number) {
  for (const id of state.living.slice()) {
    const vassal = state.polities[id], bond = vassal.overlord;
    if (!bond) continue;
    const overlord = state.polities[bond.id];
    if (overlord.deathTick !== null) { free(state, vassal, 'overlordGone'); continue; }
    if (month === 1) {
      if (strongEnough(state, vassal, overlord)) { free(state, vassal, 'strength'); continue; }
      bond.amount = tributeOf(state, vassal);
    }
    bond.carry += bond.amount / 12;
    const due = Math.floor(bond.carry), paid = Math.min(due, vassal.wealth);
    bond.carry -= due;
    if (paid <= 0) continue;
    const given = wealthFlows(state, vassal), received = wealthFlows(state, overlord);
    vassal.wealth -= paid; overlord.wealth += paid;
    given.given += paid; received.received += paid;
    bond.paid += paid;
    addWarIncome(state, overlord, paid);
  }
}
