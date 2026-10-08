import { VALUE_KEYS, type CultureValues, type Polity, type SimulationState } from './state.ts';

/**
 * A civilization's effective values (VISION.md "Personality and the decision model"; M5.2): layer 1, its people's
 * values, people-weighted over all its groups (a realm of many peoples is pulled by them all); layers 2 and 3, its
 * ruler's traits and its government's modifiers, which are neutral until M7 gives every realm a ruler and a government.
 */
export function effectiveValues(state: SimulationState, polity: Polity): CultureValues {
  const sums = { militarism: 0, zeal: 0, openness: 0, tradition: 0, expansionism: 0 };
  let people = 0;
  for (const id of polity.groups) {
    const group = state.groups[id];
    people += group.size;
    for (const key of VALUE_KEYS) sums[key] += group.values[key] * group.size;
  }
  const ruler = rulerModifiers(polity), government = governmentModifiers(polity), values = { ...sums };
  for (const key of VALUE_KEYS) values[key] = Math.max(0, Math.min(1, (people > 0 ? sums[key] / people : state.cultures[polity.culture].values[key]) + ruler[key] + government[key]));
  return values;
}
/** Layer 2: its ruler's traits (VISION.md "Ruler traits"), neutral until M7. */
const rulerModifiers = (_polity: Polity): CultureValues => ({ militarism: 0, zeal: 0, openness: 0, tradition: 0, expansionism: 0 });
/** Layer 3: its government's modifiers (VISION.md "Government"), neutral (the default government for its stage) until M7. */
const governmentModifiers = (_polity: Polity): CultureValues => ({ militarism: 0, zeal: 0, openness: 0, tradition: 0, expansionism: 0 });
