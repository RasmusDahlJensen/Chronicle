import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { BIOME_IDS, RESOURCE_IDS } from './atlas.ts';

export const WORLD_PROTOCOL_VERSION = 1;
export const WORLD_GENERATOR_VERSION = 1;
export const WORLD_TILE_SIZE = 128;
export const WORLD_AREA_KM2 = 510_000_000;
export const MAX_WORLD_MANIFEST_BYTES = 1024 * 1024;
export const MAX_WORLD_TILE_BYTES = 512 * 1024;
export const MAX_WORLD_BUNDLE_BYTES = 20 * 1024 * 1024;
export const WORLD_BIOMES = [...BIOME_IDS, 'boreal', 'steppe', 'seaIce'] as const;
export type WorldBiome = typeof WORLD_BIOMES[number];
export const WORLD_SIZES = { standard: { width: 512, height: 256 }, large: { width: 1024, height: 512 } } as const;
export const WorldSettingsSchema = Type.Object({
  seed: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9 _.-]+$' }),
  size: Type.Enum(['standard', 'large']),
}, { additionalProperties: false });
export type WorldSettings = Static<typeof WorldSettingsSchema>;
export const DEFAULT_WORLD_SETTINGS: WorldSettings = { seed: 'Chronicle', size: 'large' };
export function worldKey(settings: WorldSettings) { return `climate-${WORLD_GENERATOR_VERSION}:${settings.size}:${settings.seed}`; }
export function parseWorldSettings(value: unknown): WorldSettings {
  if (!Check(WorldSettingsSchema, value)) throw new Error('Use a seed of 1–64 letters, numbers, spaces, dots, underscores or hyphens and a supported world size.');
  return value;
}

function fieldsSchema(maxItems: number) {
  const values = (minimum: number, maximum: number) => Type.Array(Type.Integer({ minimum, maximum }), { minItems: 1, maxItems });
  return Type.Object({
    elevation: values(-12000, 12000), temperature: values(-1000, 600), moisture: values(0, 1000),
    biome: values(0, WORLD_BIOMES.length - 1), resource: values(0, RESOURCE_IDS.length),
  }, { additionalProperties: false });
}
const OverviewSchema = Type.Object({ width: Type.Literal(256), height: Type.Literal(128), fields: fieldsSchema(32768) }, { additionalProperties: false });
export const WorldManifestSchema = Type.Object({
  protocolVersion: Type.Literal(WORLD_PROTOCOL_VERSION), generatorVersion: Type.Literal(WORLD_GENERATOR_VERSION),
  worldKey: Type.String({ minLength: 1, maxLength: 100 }), settings: WorldSettingsSchema,
  width: Type.Integer({ minimum: 512, maximum: 1024 }), height: Type.Integer({ minimum: 256, maximum: 512 }),
  tileSize: Type.Literal(WORLD_TILE_SIZE), topology: Type.Literal('wrap-x'), projection: Type.Literal('cylindrical-equal-area'),
  areaKm2: Type.Literal(WORLD_AREA_KM2), landCells: Type.Integer({ minimum: 0, maximum: 524288 }),
  resourceSites: Type.Integer({ minimum: 0, maximum: 524288 }),
  biomeCounts: Type.Array(Type.Integer({ minimum: 0, maximum: 524288 }), { minItems: WORLD_BIOMES.length, maxItems: WORLD_BIOMES.length }),
  overview: OverviewSchema,
}, { additionalProperties: false });
export const WorldTileSchema = Type.Object({
  protocolVersion: Type.Literal(WORLD_PROTOCOL_VERSION), worldKey: Type.String({ minLength: 1, maxLength: 100 }),
  x: Type.Integer({ minimum: 0, maximum: 7 }), y: Type.Integer({ minimum: 0, maximum: 3 }),
  width: Type.Literal(WORLD_TILE_SIZE), height: Type.Literal(WORLD_TILE_SIZE), fields: fieldsSchema(WORLD_TILE_SIZE ** 2),
}, { additionalProperties: false });
export type WorldManifest = Static<typeof WorldManifestSchema>;
export type WorldTile = Static<typeof WorldTileSchema>;
export type WorldFields = WorldTile['fields'];
export interface WorldBundle { manifest: string; tiles: string[] }
export interface InspectedWorldCell {
  id: number; x: number; y: number; elevation: number; temperature: number; moisture: number;
  biome: WorldBiome; resource: typeof RESOURCE_IDS[number] | null;
}

export function isWorldWater(biome: WorldBiome) { return biome === 'ocean' || biome === 'coast' || biome === 'seaIce'; }
function validateFields(fields: WorldFields, length: number) {
  if (Object.values(fields).some(values => values.length !== length)) throw invalid();
  for (let id = 0; id < length; id++) {
    if (isWorldWater(WORLD_BIOMES[fields.biome[id]]) !== (fields.elevation[id] < 0)) throw invalid();
  }
}
function invalid() { return new Error('The generated world response was invalid. Try loading it again.'); }

export function parseWorldManifest(payload: unknown): WorldManifest {
  if (!Check(WorldManifestSchema, payload)) throw invalid();
  const shape = WORLD_SIZES[payload.settings.size];
  const cells = payload.width * payload.height;
  if (payload.width !== shape.width || payload.height !== shape.height || payload.worldKey !== worldKey(payload.settings)) throw invalid();
  if (payload.biomeCounts.reduce((sum, count) => sum + count, 0) !== cells || payload.resourceSites > cells) throw invalid();
  const water = payload.biomeCounts.reduce((sum, count, index) => sum + (isWorldWater(WORLD_BIOMES[index]) ? count : 0), 0);
  if (payload.landCells !== cells - water) throw invalid();
  validateFields(payload.overview.fields, 32768);
  return payload;
}

export function parseWorldTile(payload: unknown, manifest: WorldManifest, x: number, y: number): WorldTile {
  if (!Check(WorldTileSchema, payload)) throw invalid();
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= manifest.width / WORLD_TILE_SIZE || y >= manifest.height / WORLD_TILE_SIZE) throw invalid();
  if (payload.worldKey !== manifest.worldKey || payload.x !== x || payload.y !== y) throw invalid();
  validateFields(payload.fields, WORLD_TILE_SIZE ** 2);
  return payload;
}

export function inspectWorldCell(manifest: WorldManifest, tile: WorldTile, x: number, y: number): InspectedWorldCell {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= manifest.width || y >= manifest.height
    || tile.worldKey !== manifest.worldKey || Math.floor(x / WORLD_TILE_SIZE) !== tile.x || Math.floor(y / WORLD_TILE_SIZE) !== tile.y) throw invalid();
  const at = (y % WORLD_TILE_SIZE) * tile.width + x % WORLD_TILE_SIZE;
  return { id: y * manifest.width + x, x, y, elevation: tile.fields.elevation[at],
    temperature: tile.fields.temperature[at] / 10, moisture: tile.fields.moisture[at] / 1000,
    biome: WORLD_BIOMES[tile.fields.biome[at]], resource: RESOURCE_IDS[tile.fields.resource[at] - 1] ?? null };
}
