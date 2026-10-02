import type { SimulationState } from './state.ts';
import { BAND_TUNING, STABILITY_TUNING } from './tunables.ts';

/** Land pressure (VISION.md): a graded need from 0 to 1 that rises from `pressureFrom` of capacity. */
export function landPressure(size: number, people: number) {
  const tuning = BAND_TUNING;
  return people > 0 ? Math.max(0, Math.min(1, (size / people - tuning.pressureFrom) / (tuning.pressureFull - tuning.pressureFrom))) : 1;
}

/** How deep below the unrest threshold a region's stability lies (0 when stable enough, 1 at zero stability). */
export function unrestDepth(state: Pick<SimulationState, 'stability'>, region: number) {
  const below = STABILITY_TUNING.unrestBelow;
  return state.stability[region] >= below ? 0 : (below - state.stability[region]) / below;
}
