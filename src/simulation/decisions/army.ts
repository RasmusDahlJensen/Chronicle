import type { ArmyView } from '../perception.ts';
import { ARMY_TUNING, DIPLOMACY_TUNING, RAVAGE_TUNING, WAR_TUNING } from '../tunables.ts';
import { threatOf } from './threat.ts';

/**
 * The army a realm means to keep (VISION.md "Grounded in history": army size follows threat, and its upkeep pushes a
 * realm toward arrears; M6.1), set once a year at its assessment, before its taxes. Pure: it sees only the
 * civilization's army view.
 * - **Its guard:** its people × garrison × (½ + Militarism): a small guard in peace, more for a militaristic people.
 * - **The threat** it feels: the most from any neighbour it does not ally with (`threatOf`: believed stronger and
 *   disliked; less from a pact partner), judged against the strength of its guard and its allies. Judging against the
 *   guard rather than the army it has keeps a raised army from talking itself down the next year (and up again).
 * - **Wanted:** its guard + its people × threat × the threat it feels.
 * - **Affordable:** what its army budget pays for at a soldier's upkeep: afford × (½ + Militarism) × its revenue at
 *   customary taxes × (1 − arrears), but never more than its surplus at customary taxes (what its other costs leave)
 *   plus `headroom` × that revenue: a realm whose upkeep, services and administration already take its revenue keeps
 *   little more than its floor, rather than let its land decay to pay soldiers.
 * - **The target** is the smaller of the two, never below floor × its people.
 * Its reasons, in soldiers: the guard its Militarism wants, the soldiers the threat adds, and those the cost takes away;
 * and the people it fears most.
 */
export function armyTarget(view: ArmyView) {
  const tuning = ARMY_TUNING, keen = 0.5 + view.militarism;
  const garrison = view.people * tuning.garrison * keen, guard = Math.max(1, garrison * view.multiplier + view.allies);
  let threat = 0, feared: ArmyView['neighbours'][number] | null = null;
  for (const neighbour of view.neighbours) {
    // An enemy at war threatens fully (M6.2).
    const fear = neighbour.war ? 1 : threatOf(neighbour.strength / guard, neighbour.opinion) * (neighbour.pact ? 1 - DIPLOMACY_TUNING.pact.calm : 1);
    if (fear > threat) { threat = fear; feared = neighbour; }
  }
  // At war it wants more (each war, WAR_TUNING.army of its people) and spends more on them (WAR_TUNING.warBudget).
  const threatened = view.people * tuning.threat * threat + view.people * WAR_TUNING.army * view.wars, wanted = garrison + threatened;
  const spend = view.wars > 0 ? WAR_TUNING.warBudget : 1;
  // Recent war income pays for more (M6.3: "army size follows threat and recent war income").
  const budget = spend * Math.min(tuning.afford * keen * view.revenue * (1 - view.arrears), Math.max(0, view.surplus + tuning.headroom * view.revenue))
    + RAVAGE_TUNING.warIncome * view.warIncome;
  const affordable = view.upkeep > 0 ? Math.max(0, budget) / view.upkeep : wanted;
  const target = Math.round(Math.max(tuning.floor * view.people, Math.min(wanted, affordable)));
  return {
    target, garrison: Math.round(garrison), threatened: Math.round(threatened), cut: Math.max(0, Math.round(wanted) - target), threat,
    feared: feared ? { polity: feared.polity, name: feared.name, strength: Math.round(feared.strength) } : null,
  };
}
