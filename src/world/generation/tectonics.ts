import createPlatec from '../../../vendor/platec/platec.mjs';
import { runPlatec } from '../../../vendor/platec/runtime.ts';

export { TECTONIC_WIDTH, TECTONIC_HEIGHT } from '../../../vendor/platec/runtime.ts';

export async function generateTectonicCrust(seed: number): Promise<Float32Array> {
  return runPlatec(seed, createPlatec);
}
