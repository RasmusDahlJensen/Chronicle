import { CIVILIZATION_PROTOCOL_VERSION, CIVILIZATION_SPAWN_VERSION, isFoundingBiome, type CivilizationSnapshot } from '../../shared/civilization.ts';
import { WORLD_AREA_KM2, WORLD_BIOMES, worldKey } from '../../shared/generated-world.ts';
import { createFertilityContext, fertilityAt } from '../../shared/fertility.ts';
import { hashNoise, seedNumber } from './generation/noise.ts';
import type { GeneratedWorld } from './generation/generate.ts';

export const CIVILIZATION_START_RULES = { minimumFertility: 25, minimumTemperature: 5, freshwaterBonus: 20 } as const;
const beginnings = ['Avar', 'Bel', 'Cor', 'Dar', 'Elar', 'Fen', 'Gal', 'Hel', 'Istr', 'Jar', 'Kel', 'Lor', 'Mer', 'Nor', 'Or', 'Val'];
const endings = ['an', 'en', 'ia', 'on', 'in', 'ara', 'eth', 'une'];
const colors = ['#9d3d51', '#536daf', '#b26b28', '#76539b', '#287d78', '#8c7027', '#405c8c', '#a34f32'];

/** Reproducible initial identity, computed on the host. No time step or invented holdings. */
export function createCivilizationSnapshot(world: GeneratedWorld): CivilizationSnapshot {
  const { fields, width, height } = world, seed = seedNumber(world.settings.seed);
  const context = createFertilityContext(fields, { width, height, areaKm2: WORLD_AREA_KM2 }, world.hydrology, WORLD_BIOMES);
  let originCellId = -1, best = -Infinity, tie = -Infinity;
  for (let id = 0; id < width * height; id++) {
    if (!isFoundingBiome(WORLD_BIOMES[fields.biome[id]]) || fields.elevation[id] < 0
      || fields.fertility[id] < CIVILIZATION_START_RULES.minimumFertility
      || fields.temperature[id] / 10 < CIVILIZATION_START_RULES.minimumTemperature) continue;
    const fresh = fertilityAt(context, id, fields.temperature[id] / 10, fields.moisture[id] / 1000).freshwater;
    const score = fields.fertility[id] * 2 + (fresh ? CIVILIZATION_START_RULES.freshwaterBonus : 0);
    const candidateTie = hashNoise(id % width, Math.floor(id / width), seed + 17219);
    if (score > best || score === best && candidateTie > tie) { best = score; tie = candidateTie; originCellId = id; }
  }
  const snapshot: CivilizationSnapshot = { protocolVersion: CIVILIZATION_PROTOCOL_VERSION, spawnVersion: CIVILIZATION_SPAWN_VERSION,
    worldKey: worldKey(world.settings), status: originCellId < 0 ? 'no-suitable-land' : 'spawned', civilizations: [] };
  if (originCellId >= 0) {
    const pick = <T>(values: T[], salt: number) => values[Math.floor(hashNoise(0, 0, seed + salt) * values.length) % values.length];
    snapshot.civilizations.push({ id: 'civilization-1', name: pick(beginnings, 4411) + pick(endings, 7727), color: pick(colors, 9811), originCellId });
  }
  return snapshot;
}
