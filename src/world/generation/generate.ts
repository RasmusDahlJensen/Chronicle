import { parseWorldSettings, WORLD_SIZES, WORLD_BIOMES, type WorldSettings } from '../../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../../shared/atlas.ts';
import { baselineTemperature, classifyClimate, latitudeAt, moistureField } from './climate.ts';
import { clamp, hashNoise, seedNumber, smoothNoise } from './noise.ts';

export interface GeneratedWorld {
  settings: WorldSettings; width: number; height: number;
  fields: { elevation: Int16Array; temperature: Int16Array; moisture: Uint16Array; biome: Uint8Array; resource: Uint8Array };
}
interface Landmass { x: number; y: number; rx: number; ry: number; tilt: number }

export function generateWorld(input: WorldSettings): GeneratedWorld {
  const settings = { ...parseWorldSettings(input) };
  const { width, height } = WORLD_SIZES[settings.size];
  const seed = seedNumber(settings.seed);
  const random = (id: number) => hashNoise(id, 491, seed);
  const landmasses: Landmass[] = [];
  const count = 4 + Math.floor(random(0) * 2);
  for (let i = 0; i < count; i++) landmasses.push({
    x: (i + 0.3 + random(i * 7 + 1) * 0.4) / count,
    y: 0.23 + random(i * 7 + 2) * 0.54,
    rx: 0.065 + random(i * 7 + 3) * 0.05, ry: 0.17 + random(i * 7 + 4) * 0.16,
    tilt: (random(i * 7 + 5) - 0.5) * 0.7,
  });
  for (let i = 0; i < 18; i++) landmasses.push({ x: random(100 + i * 5), y: 0.1 + random(101 + i * 5) * 0.8,
    rx: 0.005 + random(102 + i * 5) * 0.024, ry: 0.01 + random(103 + i * 5) * 0.042, tilt: 0 });
  for (const [i, y] of [0.016, 0.984].entries()) landmasses.push({ x: random(230 + i), y, rx: 0.12, ry: 0.045, tilt: 0 });
  const elevation = new Int16Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const warpX = (smoothNoise(u, v, 8, seed + 3) - 0.5) * 0.05;
      const warpY = (smoothNoise(u, v, 8, seed + 5) - 0.5) * 0.07;
      let inland = -10; let ridge = 0;
      for (let at = 0; at < landmasses.length; at++) {
        const mass = landmasses[at];
        let dx = u + warpX - mass.x; dx -= Math.round(dx);
        const dy = v + warpY - mass.y;
        const local = (dx + dy * mass.tilt) / mass.rx;
        const shape = 1 - Math.hypot(local, dy / mass.ry);
        inland = Math.max(inland, shape);
        if (at < count && shape > 0) {
          const line = local + 0.3 + Math.sin(v * 17 + at) * 0.16;
          ridge = Math.max(ridge, Math.exp(-((line / 0.2) ** 2)) * clamp(shape * 4, 0, 1));
        }
      }
      inland += (smoothNoise(u, v, 64, seed + 7) - 0.5) * 0.19
        + (smoothNoise(u, v, 160, seed + 8) - 0.5) * 0.055;
      const fold = 0.6 + smoothNoise(u, v, 96, seed + 14) * 0.5;
      elevation[y * width + x] = inland < 0
        ? Math.round(-20 - Math.min(1, -inland) * 4700)
        : Math.round(15 + inland ** 1.3 * 700 + ridge * 4200 * fold * clamp(inland * 8, 0, 1));
    }
  }
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
  // Sparse geographic candidates, independent of display order. Spacing wraps at the longitude seam.
  const spacing = settings.size === 'large' ? 10 : 5;
  const blocked = new Uint8Array(width * height);
  for (let id = 0; id < resource.length; id++) {
    if (blocked[id] || hashNoise(id % width, Math.floor(id / width), seed + 350) > 0.009) continue;
    const type = WORLD_BIOMES[biome[id]];
    const sites = type === 'ocean' || type === 'coast' ? ['fish'] : type === 'seaIce' || type === 'snow' ? []
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
  return { settings, width, height, fields: { elevation, temperature, moisture, biome, resource } };
}
