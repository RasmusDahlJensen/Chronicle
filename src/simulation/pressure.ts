import { BAND_TUNING } from './tunables.ts';

/** Land pressure (VISION.md): a graded need from 0 to 1 that rises from `pressureFrom` of capacity. */
export function landPressure(size: number, people: number) {
  const tuning = BAND_TUNING;
  return people > 0 ? Math.max(0, Math.min(1, (size / people - tuning.pressureFrom) / (tuning.pressureFull - tuning.pressureFrom))) : 1;
}
