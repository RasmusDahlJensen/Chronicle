import type { WorldHydrology } from './world-hydrology.ts';

export interface FertilityFacts {
  score: number; applicable: boolean;
  soil: 'none' | 'rocky' | 'shallow' | 'sandy' | 'alluvial' | 'waterlogged' | 'cold' | 'loamy';
  slopeDegrees: number; freshwater: boolean;
  factors: { warmth: number; moisture: number; soil: number; slope: number; drainage: number };
}
interface FertilityInput {
  biome: string; elevation: number; temperature: number; moisture: number;
  slopeDegrees: number; freshwater: boolean; river: boolean;
}
const water = new Set(['ocean', 'coast', 'seaIce', 'lake', 'lakeIce']);
const percent = (value: number) => Math.round(Math.max(0, Math.min(100, value)));

/** A deliberately crop-independent game heuristic, not a soil survey or yield model.
 * Freshwater proximity is descriptive; it does not supply imaginary irrigation.
 * The rounded factors displayed in the inspector exactly determine the score.
 */
export function assessFertility(input: FertilityInput): FertilityFacts {
  const { biome, elevation, temperature, moisture, freshwater, river } = input;
  const slopeDegrees = Math.round(input.slopeDegrees * 10) / 10;
  if (water.has(biome)) return { score: 0, applicable: false, soil: 'none', slopeDegrees, freshwater,
    factors: { warmth: 0, moisture: 0, soil: 0, slope: 0, drainage: 0 } };
  const soil: FertilityFacts['soil'] = biome === 'mountain' || slopeDegrees >= 8 ? 'rocky'
    : elevation > 1200 || slopeDegrees > 3 ? 'shallow'
    : temperature < 2 ? 'cold'
    : biome === 'wetland' || moisture > 0.9 && slopeDegrees < 0.5 ? 'waterlogged'
    : moisture < 0.3 ? 'sandy'
    : river && slopeDegrees < 1.5 ? 'alluvial' : 'loamy';
  const soilQuality = { none: 0, rocky: 25, shallow: 50, sandy: 40, alluvial: 95, waterlogged: 60, cold: 55, loamy: 85 };
  const factors = {
    warmth: percent(Math.min((temperature + 5) / 23, (55 - temperature) / 23) * 100),
    moisture: percent(moisture / 0.65 * 100), soil: soilQuality[soil],
    slope: percent(Math.exp(-slopeDegrees / 4) * 100),
    drainage: biome === 'wetland' || moisture > 0.9 && slopeDegrees < 0.5 ? 45 : moisture > 0.8 && slopeDegrees < 0.5 ? 75 : 100,
  };
  const score = Math.round(Object.values(factors).reduce((result, factor) => result * factor / 100, 100));
  return { score, applicable: true, soil, slopeDegrees, freshwater, factors };
}

export interface FertilityContext {
  surface: { elevation: ArrayLike<number>; biome: ArrayLike<number> };
  width: number; height: number; biomes: readonly string[];
  levels: Float64Array; fresh: Uint8Array; rivers: Uint8Array;
  horizontal: Float64Array; vertical: Float64Array;
}
/** Prepare once per authoritative surface. Distances follow its equal-area spherical projection. */
export function createFertilityContext(surface: FertilityContext['surface'],
  shape: { width: number; height: number; areaKm2: number }, hydrology: WorldHydrology,
  biomes: readonly string[]): FertilityContext {
  const { width, height, areaKm2 } = shape, count = width * height;
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2
    || !Number.isFinite(areaKm2) || areaKm2 <= 0 || surface.elevation.length !== count || surface.biome.length !== count) {
    throw new Error('Invalid fertility surface.');
  }
  const levels = new Float64Array(count), fresh = new Uint8Array(count), rivers = new Uint8Array(count);
  for (let id = 0; id < count; id++) levels[id] = water.has(biomes[surface.biome[id]]) ? 0 : surface.elevation[id];
  for (const id of hydrology.rivers.cells) { fresh[id] = 1; rivers[id] = 1; }
  for (const lake of hydrology.lakes) for (const id of lake.cells) {
    levels[id] = lake.level; if (lake.outlet) fresh[id] = 1;
  }
  const radius = Math.sqrt(areaKm2 / (4 * Math.PI)) * 1000;
  const latitudes = Float64Array.from({ length: height }, (_, y) => Math.asin(1 - 2 * (y + 0.5) / height));
  const horizontal = new Float64Array(height), vertical = new Float64Array(height - 1);
  for (let y = 0; y < height; y++) {
    horizontal[y] = 2 * radius * Math.asin(Math.cos(latitudes[y]) * Math.sin(Math.PI / width));
    if (y + 1 < height) vertical[y] = radius * Math.abs(latitudes[y + 1] - latitudes[y]);
  }
  return { surface, width, height, biomes, levels, fresh, rivers, horizontal, vertical };
}

export function fertilityAt(context: FertilityContext, id: number, temperature: number, moisture: number): FertilityFacts {
  const { width, height, surface, levels, fresh, rivers } = context;
  if (!Number.isInteger(id) || id < 0 || id >= width * height || !Number.isFinite(temperature)
    || !Number.isFinite(moisture) || moisture < 0 || moisture > 1) throw new Error('Invalid fertility cell.');
  const x = id % width, y = Math.floor(id / width), row = id - x;
  let riseRun = 0, freshwater = Boolean(fresh[id]), river = Boolean(rivers[id]);
  function neighbor(next: number, distance: number) {
    riseRun = Math.max(riseRun, Math.abs(levels[id] - levels[next]) / distance);
    freshwater ||= Boolean(fresh[next]); river ||= Boolean(rivers[next]);
  }
  neighbor(row + (x + 1) % width, context.horizontal[y]);
  neighbor(row + (x + width - 1) % width, context.horizontal[y]);
  if (y > 0) neighbor(id - width, context.vertical[y - 1]);
  if (y + 1 < height) neighbor(id + width, context.vertical[y]);
  // Freshwater vicinity includes diagonal shores, matching accepted water inspection.
  // Regional slope and the alluvial estimate retain edge-sharing neighbors.
  for (const dy of [-1, 1]) if (y + dy >= 0 && y + dy < height) {
    for (const dx of [-1, 1]) freshwater ||= Boolean(fresh[(y + dy) * width + (x + dx + width) % width]);
  }
  return assessFertility({ biome: context.biomes[surface.biome[id]], elevation: surface.elevation[id], temperature, moisture,
    slopeDegrees: Math.atan(riseRun) * 180 / Math.PI, freshwater, river });
}
