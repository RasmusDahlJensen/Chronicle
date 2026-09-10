import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { decodeWorldSurface, isWorldWater, WORLD_BIOMES, type WorldBiome, type WorldBundle, type WorldManifest } from './generated-world.ts';

export const CIVILIZATION_PROTOCOL_VERSION = 1;
export const CIVILIZATION_SPAWN_VERSION = 1;
export const MAX_CIVILIZATION_BYTES = 8192;
const CivilizationSchema = Type.Object({
  id: Type.Literal('civilization-1'), name: Type.String({ minLength: 2, maxLength: 48, pattern: '^[A-Z][a-z]+$' }),
  color: Type.String({ pattern: '^#[0-9a-f]{6}$' }), originCellId: Type.Integer({ minimum: 0, maximum: 524287 }),
}, { additionalProperties: false });
export const CivilizationSnapshotSchema = Type.Object({
  protocolVersion: Type.Literal(CIVILIZATION_PROTOCOL_VERSION), spawnVersion: Type.Literal(CIVILIZATION_SPAWN_VERSION),
  worldKey: Type.String({ minLength: 1, maxLength: 100 }),
  status: Type.Enum(['spawned', 'no-suitable-land']),
  civilizations: Type.Array(CivilizationSchema, { maxItems: 1 }),
}, { additionalProperties: false });
export type Civilization = Static<typeof CivilizationSchema>;
export type CivilizationSnapshot = Static<typeof CivilizationSnapshotSchema>;
export interface WorldStudyBundle extends WorldBundle { civilization: string }
export function isFoundingBiome(biome: WorldBiome): boolean {
  return !isWorldWater(biome) && !(['mountain', 'snow', 'tundra', 'wetland'] as WorldBiome[]).includes(biome);
}
/** Identity/location snapshot only. It makes no population or political ownership claim. */
export function parseCivilizationSnapshot(payload: unknown, world: WorldManifest): CivilizationSnapshot {
  const invalid = () => new Error('The civilization response was invalid. Use Retry civilization.');
  if (!Check(CivilizationSnapshotSchema, payload) || payload.worldKey !== world.worldKey
    || payload.civilizations.length !== (payload.status === 'spawned' ? 1 : 0)) throw invalid();
  if (payload.civilizations.length) {
    const id = payload.civilizations[0].originCellId;
    if (id >= world.width * world.height) throw invalid();
    const surface = decodeWorldSurface(world.surface);
    if (!isFoundingBiome(WORLD_BIOMES[surface.biome[id]]) || surface.elevation[id] < 0) throw invalid();
  }
  return payload;
}
