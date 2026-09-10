import { generateTectonicCrust, TECTONIC_WIDTH, TECTONIC_HEIGHT } from './tectonics.ts';
import { refineTectonicCrust } from './tectonic-geography.ts';

/** A single tectonic base drives both atlas resolutions. Climate and resources
 * receive the resulting full-resolution elevation field, never raw crust units.
 */
export async function generateElevation(width: number, height: number, seed: number): Promise<Int16Array> {
  const values = await generateTectonicCrust(seed);
  return refineTectonicCrust({ width: TECTONIC_WIDTH, height: TECTONIC_HEIGHT, values }, width, height, seed);
}
