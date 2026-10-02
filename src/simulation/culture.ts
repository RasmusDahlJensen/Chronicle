import { VALUE_KEYS, type CultureValues } from './state.ts';

/** How alike two cultures' values are (0–1): one minus the mean absolute difference of the five sliders. */
export function cultureSimilarity(a: CultureValues, b: CultureValues) {
  let difference = 0;
  for (const key of VALUE_KEYS) difference += Math.abs(a[key] - b[key]);
  return 1 - difference / VALUE_KEYS.length;
}
