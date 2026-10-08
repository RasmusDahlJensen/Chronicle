import { causes } from './causes.ts';
import { armyTarget } from './decisions/army.ts';
import { armyView } from './perception.ts';
import { fitSoldiers } from './soldiers.ts';
import type { Polity, SimulationState, TickContext } from './state.ts';
import { ARMY_TUNING } from './tunables.ts';

/**
 * Armies (VISION.md "Military strength"; "Grounded in history": army size follows threat, its upkeep is a cost in the
 * budget, demobilizing unsettles the soldiers; M6.1). A civilization keeps soldiers drawn from its rural people, who
 * then work no land. Once a year, at its assessment, it sets the army it means to keep (`decisions/army.ts`); each
 * month (the war system) every region's soldiers move toward its share of that target, raised slowly and released
 * quickly, and soldiers sent home unsettle their region for some years. Its strength is its soldiers times its
 * military multiplier.
 */

/**
 * The yearly assessment's army (before its taxes, so they cover it): its target and why. A target rising by
 * `eventChange` of itself or more (½: by half) is a mobilization, falling as far the other way (to 1 ÷ (1 +
 * eventChange) of itself: to two thirds) a demobilization, each by at least `eventSoldiers` (events citing the reasons).
 * Without `announce` (a realm whose land changed at once: a union) it is set quietly, so the united realm neither
 * sends home the soldiers the union brought nor calls it a mobilization.
 */
export function setArmy(state: SimulationState, civ: Polity, announce = true) {
  const decided = armyTarget(armyView(state, civ)), previous = civ.army, before = previous.target, tuning = ARMY_TUNING;
  civ.army = { target: decided.target, garrison: decided.garrison, threatened: decided.threatened, cut: decided.cut, feared: decided.feared?.polity ?? -1, tick: state.tick };
  const change = decided.target - before;
  if (!announce || previous.tick < 0 || before <= 0 || Math.abs(change) < tuning.eventSoldiers) return;
  if (change > 0 ? change < tuning.eventChange * before : decided.target * (1 + tuning.eventChange) > before) return;
  // What changed since last year, each as a share of all that moved its way: the threat, its people (its guard) and
  // what it can afford.
  const parts = change > 0
    ? { threat: decided.threatened - previous.threatened, growth: decided.garrison - previous.garrison, means: previous.cut - decided.cut }
    : { threatPassed: previous.threatened - decided.threatened, cost: decided.cut - previous.cut, fewerPeople: previous.garrison - decided.garrison };
  const moved = Object.values(parts).reduce((sum, value) => sum + Math.max(0, value), 0);
  const reasons = causes(Object.fromEntries(Object.entries(parts).map(([factor, value]) => [factor, moved > 0 ? Math.max(0, value) / moved : 0])));
  if (change > 0) state.metrics.mobilizations++; else state.metrics.demobilizations++;
  state.chronicle.emit({
    type: change > 0 ? 'mobilization' : 'demobilization', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.06, causes: reasons,
    data: { civ: civ.name, soldiers: decided.target, from: before, change: Math.abs(change), ...(change > 0 && decided.feared ? { feared: decided.feared.name } : {}) },
  });
}

/** Each of a civilization's groups' share of its army's target, in whole soldiers (by rural people, at most maxShare of
 *  them), the largest remainders taking what flooring leaves. */
function shares(state: SimulationState, polity: Polity, rural: number) {
  const tuning = ARMY_TUNING, goals: number[] = [], rest: { at: number; fraction: number }[] = [];
  let given = 0;
  polity.groups.forEach((groupId, at) => {
    const group = state.groups[groupId], own = group.size - group.specialists, cap = Math.floor(tuning.maxShare * own);
    const share = rural > 0 ? Math.min(cap, polity.army.target * own / rural) : 0, whole = Math.floor(share);
    goals.push(whole); given += whole;
    if (whole < cap) rest.push({ at, fraction: share - whole });
  });
  // One more soldier each for the largest remainders, while any of the target is left (at most one a region: what
  // the caps hold back stays unraised).
  let left = Math.max(0, polity.army.target - given);
  rest.sort((a, b) => b.fraction - a.fraction || a.at - b.at);
  for (const entry of rest) { if (left <= 0) break; goals[entry.at]++; left--; }
  return goals;
}

/** Per region, the factor by which `unsettled` fades in a month. */
const FADE = () => Math.exp(-1 / (ARMY_TUNING.demobYears * 12));

/**
 * War system (M6.1: armies; wars come with M6.2): each month every civilization's regions raise or release soldiers
 * toward their share of its target (by their rural people, at most `maxShare` of them): raising closes
 * 1/raiseMonths of the gap (at least one soldier), releasing 1/releaseMonths. While the realm stands down (it keeps
 * more soldiers than it means to), soldiers sent home add their share of the region's people to its unsettled measure,
 * which fades over the years. A group never keeps more soldiers than it has rural people.
 */
export function levy(state: SimulationState, _context: TickContext) {
  const tuning = ARMY_TUNING, fade = FADE(), unsettled = state.unsettled;
  for (let region = 0; region < unsettled.length; region++) if (unsettled[region] > 0) unsettled[region] = unsettled[region] * fade < 1e-6 ? 0 : unsettled[region] * fade;
  for (const id of state.living) {
    const polity = state.polities[id];
    let rural = 0, soldiers = 0;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      if (polity.kind !== 'civ') { group.soldiers = 0; continue; }
      fitSoldiers(group);
      rural += group.size - group.specialists; soldiers += group.soldiers;
    }
    if (polity.kind !== 'civ') continue;
    // Soldiers sent home unsettle their region only while the realm stands down (it keeps more than it means to):
    // moving soldiers between its regions as their people change is not a demobilization.
    const standingDown = soldiers > polity.army.target;
    // Each region's share of the target by its rural people (at most maxShare of them), in whole soldiers summing to it
    // (the largest remainders get the rest), so a realm of many small regions still keeps its army.
    const goals = shares(state, polity, rural);
    polity.groups.forEach((groupId, at) => {
      const group = state.groups[groupId], gap = goals[at] - group.soldiers;
      if (gap > 0) group.soldiers += Math.min(gap, Math.max(1, Math.floor(gap / tuning.raiseMonths)));
      else if (gap < 0) {
        const released = Math.min(-gap, Math.max(1, Math.floor(-gap / tuning.releaseMonths)));
        group.soldiers -= released;
        if (standingDown && group.size > 0) unsettled[group.region] += released / group.size;
      }
    });
  }
}
