import { parseWorldSettings, WORLD_SIZES, WORLD_BIOMES, WORLD_AREA_KM2, type WorldSettings } from '../../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../../shared/atlas.ts';
import { baselineTemperature, classifyClimate, latitudeAt, moistureField } from './climate.ts';
import { hashNoise, seedNumber, smoothNoise } from './noise.ts';
import { generateElevation } from './geography.ts';
import { generateHydrology } from './hydrology.ts';
import { hydrologyGraph } from './hydrology-graph.ts';
import type { WorldHydrology } from '../../../shared/world-hydrology.ts';

export interface GeneratedWorld {
  settings: WorldSettings; width: number; height: number; hydrology: WorldHydrology;
  fields: { elevation: Int16Array; temperature: Int16Array; moisture: Uint16Array; biome: Uint8Array; resource: Uint8Array };
}

export async function generateWorld(input: WorldSettings): Promise<GeneratedWorld> {
  const settings = { ...parseWorldSettings(input) };
  const { width, height } = WORLD_SIZES[settings.size];
  const seed = seedNumber(settings.seed);
  const elevation = await generateElevation(width, height, seed);
  const moisture = moistureField(width, height, elevation, seed);
  const temperature = new Int16Array(width * height);
  const biome = new Uint8Array(width * height);
  const resource = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height; const latitude = latitudeAt(v);
    for (let x = 0; x < width; x++) {
      const id = y * width + x;
      const degrees = baselineTemperature(latitude, elevation[id]) + (smoothNoise((x + 0.5) / width, v, 8, seed + 81) - 0.5) * 3;
      temperature[id] = Math.round(degrees * 10);
      biome[id] = WORLD_BIOMES.indexOf(classifyClimate(elevation[id], temperature[id] / 10, moisture[id] / 1000));
    }
  }
  const drainage = generateHydrology({ width, height, elevation, moisture, areaKm2: WORLD_AREA_KM2 });
  for (let id = 0; id < biome.length; id++) if (drainage.lake[id]) {
    biome[id] = WORLD_BIOMES.indexOf(temperature[id] < 0 ? 'lakeIce' : 'lake');
  }
  const hydrology = hydrologyGraph(drainage);
  // Sparse geographic candidates, independent of display order. Spacing wraps at the longitude seam.
  const spacing = settings.size === 'large' ? 10 : 5;
  const blocked = new Uint8Array(width * height);
  for (let id = 0; id < resource.length; id++) {
    if (blocked[id] || hashNoise(id % width, Math.floor(id / width), seed + 350) > 0.009) continue;
    const type = WORLD_BIOMES[biome[id]];
    const sites = type === 'ocean' || type === 'coast' || type === 'lake' ? ['fish'] : type === 'seaIce' || type === 'snow' || type === 'lakeIce' ? []
      : type === 'mountain' ? ['stone', 'iron', 'copper', 'coal', 'gold', 'uranium']
      : type === 'desert' ? ['salt', 'stone', 'copper', 'uranium']
      : type === 'forest' || type === 'boreal' || type === 'rainforest' ? ['timber', 'game', 'iron']
      : type === 'tundra' ? ['game', 'stone', 'iron'] : ['grain', 'game', 'stone', 'coal'];
    if (!sites.length) continue;
    const rank = hashNoise(id % width, Math.floor(id / width), seed + 351);
    const site = sites[Math.floor(rank * sites.length) % sites.length];
    if ((site === 'uranium' || site === 'gold') && hashNoise(id % width + 719, Math.floor(id / width) + 193, seed + 9173) < 0.7) continue;
    resource[id] = RESOURCE_IDS.indexOf(site as typeof RESOURCE_IDS[number]) + 1;
    const cx = id % width; const cy = Math.floor(id / width);
    for (let dy = -spacing; dy <= spacing; dy++) for (let dx = -spacing; dx <= spacing; dx++) {
      if (dx * dx + dy * dy >= spacing * spacing || cy + dy < 0 || cy + dy >= height) continue;
      blocked[(cy + dy) * width + (cx + dx + width) % width] = 1;
    }
  }
  return { settings, width, height, hydrology, fields: { elevation, temperature, moisture, biome, resource } };
}
