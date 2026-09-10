import type { WorldBiome } from '../../../shared/generated-world.ts';
import { clamp, smoothNoise } from './noise.ts';

/** Equal-area cylindrical projection: equal row areas, unequal latitude intervals. */
export function latitudeAt(v: number) { return Math.asin(clamp(1 - 2 * v, -1, 1)) * 180 / Math.PI; }
/** Annual mean approximation in °C; 6 °C/km cooling is a model parameter. */
export function baselineTemperature(latitude: number, elevation = 0) {
  return 31 - 62 * (Math.abs(latitude) / 90) ** 1.6 - Math.max(0, elevation) * 0.006;
}
function moistureBelt(latitude: number) {
  const lat = Math.abs(latitude);
  return 0.18 + 0.7 * Math.exp(-((lat / 15) ** 2)) + 0.43 * Math.exp(-(((lat - 50) / 14) ** 2));
}

/** Prevailing winds carry finite ocean moisture, losing it over land and rising slopes.
 * Two circuits remove the arbitrary longitude seam from the upwind initial condition.
 * Values are annual moisture availability (0–1000), not measured rainfall in mm.
 */
export function moistureField(width: number, height: number, elevation: Int16Array, seed: number) {
  const result = new Uint16Array(width * height);
  const step = 1024 / width;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height; const lat = latitudeAt(v);
    const direction = Math.abs(lat) >= 30 && Math.abs(lat) < 60 ? 1 : -1;
    const belt = moistureBelt(lat);
    let vapor = 0.5; let previous = 0;
    for (let at = 0; at < width * 2; at++) {
      const x = direction > 0 ? at % width : width - 1 - at % width;
      const id = y * width + x; const high = Math.max(0, elevation[id]);
      const uplift = Math.max(0, high - previous);
      const removal = 1 - Math.exp(-uplift / 1300);
      if (elevation[id] < 0) vapor = 1;
      const availability = belt * 0.55 + vapor * 0.39 + removal * vapor * 0.9
        + (smoothNoise((x + 0.5) / width, v, 12, seed + 31) - 0.5) * 0.13;
      if (at >= width) result[id] = Math.round(clamp(availability, 0, 1) * 1000);
      if (elevation[id] >= 0) vapor = Math.max(0, vapor * (1 - removal * 0.85) - 0.004 * step);
      previous = high;
    }
  }
  return result;
}

export function classifyClimate(elevation: number, temperature: number, moisture: number): WorldBiome {
  if (elevation < 0) return temperature < -12 ? 'seaIce' : elevation > -180 ? 'coast' : 'ocean';
  if (temperature < -10 || (elevation > 1800 && temperature < 0)) return 'snow';
  if (elevation > 1800) return 'mountain';
  if (temperature < 0) return 'tundra';
  if (temperature < 8) return moisture > 0.42 ? 'boreal' : 'tundra';
  if (temperature > 18 && moisture < 0.33) return 'desert';
  if (temperature > 22) return moisture > 0.7 ? 'rainforest' : 'savanna';
  if (elevation < 70 && moisture > 0.78) return 'wetland';
  if (moisture > 0.57) return 'forest';
  return moisture < 0.3 ? 'steppe' : 'grassland';
}
