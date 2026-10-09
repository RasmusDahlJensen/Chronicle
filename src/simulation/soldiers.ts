import type { Polity, PopulationGroup, SimulationState } from './state.ts';
import { ARMY_TUNING } from './tunables.ts';

/**
 * Soldiers and strength (VISION.md "Military strength"; M6.1), read by the budget, production, beliefs and the army
 * itself (`army.ts`). A civilization's soldiers are rural people under arms, counted in their region's people; they
 * eat from its food but work no land. A tribe keeps none: its warriors hunt and herd.
 */

/** A polity's soldiers. */
export function soldiersOf(state: SimulationState, polity: Polity) {
  let soldiers = 0;
  for (const id of polity.groups) soldiers += state.groups[id].soldiers;
  return soldiers;
}

/** The people of a group who work the land, herd, hunt or fish: its people less its townspeople and soldiers. */
export const workersOf = (group: PopulationGroup) => Math.max(0, group.size - group.specialists - group.soldiers);

/** A group keeps at most its rural people under arms: one that lost people (deaths, migrants, colonists, new
 *  townspeople) sends the rest of its soldiers home with them. */
export function fitSoldiers(group: PopulationGroup) {
  if (group.soldiers > group.size - group.specialists) group.soldiers = Math.max(0, group.size - group.specialists);
}

/** What a soldier costs a year: more for a better-armed army (its military multiplier). */
export const soldierUpkeep = (polity: Polity) => ARMY_TUNING.upkeep * polity.knowledge.multipliers.military ** ARMY_TUNING.arms;

/** Military strength (VISION.md "Military strength"): a civilization's soldiers, or a tribe's warriors (a share of its
 *  people), times its military multiplier (its military techs, each counted as far as its resources are supplied). */
export function strengthOf(state: SimulationState, polity: Polity) {
  if (polity.kind === 'civ') return soldiersOf(state, polity) * polity.knowledge.multipliers.military;
  let people = 0;
  for (const id of polity.groups) people += state.groups[id].size;
  return people * ARMY_TUNING.warriors * polity.knowledge.multipliers.military;
}

/** A polity with no army decided yet: its target and the reasons for it (soldiers its Militarism wants as a garrison,
 *  soldiers the threat adds, soldiers its budget cuts), the people it fears (−1 none) and when it was set (−1 never). */
export const noArmy = (): Polity['army'] => ({ target: 0, garrison: 0, threatened: 0, cut: 0, feared: -1, tick: -1 });

/** Whether a region is held in a war by another people than `owner` (M6.2): occupied land pays its owner nothing. */
export const occupiedAway = (state: SimulationState, region: number, owner: number) => state.occupiedBy[region] >= 0 && state.occupiedBy[region] !== owner;
