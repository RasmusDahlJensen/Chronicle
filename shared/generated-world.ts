import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { BIOME_IDS, RESOURCE_IDS } from './atlas.ts';
import { WorldHydrologySchema, validateWorldHydrology, inspectWorldWater, type HydrologyIndex, type WaterFacts } from './world-hydrology.ts';

export const WORLD_PROTOCOL_VERSION = 3;
export const WORLD_GENERATOR_VERSION = 4;
export const WORLD_TILE_SIZE = 128;
export const WORLD_AREA_KM2 = 510_000_000;
export const MAX_WORLD_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MAX_WORLD_TILE_BYTES = 512 * 1024;
export const MAX_WORLD_BUNDLE_BYTES = 20 * 1024 * 1024;
export const WORLD_BIOMES = [...BIOME_IDS, 'boreal', 'steppe', 'seaIce', 'lake', 'lakeIce'] as const;
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
const SurfaceSchema = Type.Object({
  width: Type.Integer({ minimum: 512, maximum: 1024 }), height: Type.Integer({ minimum: 256, maximum: 512 }),
  encoding: Type.Literal('elevation-i16le-biome-u8'),
  // Three bytes per cell always encode without base64 padding. Exact length follows the world size.
  data: Type.String({ minLength: 524288, maxLength: 2097152, pattern: '^[A-Za-z0-9+/]+$' }),
}, { additionalProperties: false });
export const WorldManifestSchema = Type.Object({
  protocolVersion: Type.Literal(WORLD_PROTOCOL_VERSION), generatorVersion: Type.Literal(WORLD_GENERATOR_VERSION),
  worldKey: Type.String({ minLength: 1, maxLength: 100 }), settings: WorldSettingsSchema,
  width: Type.Integer({ minimum: 512, maximum: 1024 }), height: Type.Integer({ minimum: 256, maximum: 512 }),
  tileSize: Type.Literal(WORLD_TILE_SIZE), topology: Type.Literal('wrap-x'), projection: Type.Literal('cylindrical-equal-area'),
  areaKm2: Type.Literal(WORLD_AREA_KM2), landCells: Type.Integer({ minimum: 0, maximum: 524288 }),
  resourceSites: Type.Integer({ minimum: 0, maximum: 524288 }),
  biomeCounts: Type.Array(Type.Integer({ minimum: 0, maximum: 524288 }), { minItems: WORLD_BIOMES.length, maxItems: WORLD_BIOMES.length }),
  overview: OverviewSchema,
  surface: SurfaceSchema, hydrology: WorldHydrologySchema,
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
  biome: WorldBiome; resource: typeof RESOURCE_IDS[number] | null; water: WaterFacts;
}

export function isWorldLake(biome: WorldBiome) { return biome === 'lake' || biome === 'lakeIce'; }
export function isWorldWater(biome: WorldBiome) { return biome === 'ocean' || biome === 'coast' || biome === 'seaIce' || isWorldLake(biome); }
const lakeCode = (code: number) => isWorldLake(WORLD_BIOMES[code]);
const marineCode = (code: number) => isWorldWater(WORLD_BIOMES[code]) && !lakeCode(code);
const hydrologyIndexes = new WeakMap<WorldManifest, HydrologyIndex>();
function validateFields(fields: WorldFields, length: number) {
  if (Object.values(fields).some(values => values.length !== length)) throw invalid();
  for (let id = 0; id < length; id++) {
    const biome = WORLD_BIOMES[fields.biome[id]], resource = fields.resource[id];
    if ((biome === 'lake' && resource !== 0 && resource !== RESOURCE_IDS.indexOf('fish') + 1)
      || (biome === 'lakeIce' && resource !== 0)) throw invalid();
    if (!lakeCode(fields.biome[id]) && marineCode(fields.biome[id]) !== (fields.elevation[id] < 0)) throw invalid();
  }
}
function invalid() { return new Error('The generated world response was invalid. Try loading it again.'); }
type SurfaceFields = { elevation: Int16Array; biome: Uint8Array };
// Private validation copies cannot be mutated through the renderer's public decoder.
// Weak ownership releases them when a displayed/cached manifest is discarded.
const validationSurfaces = new WeakMap<WorldManifest, {
  source: WorldManifest['surface']; data: string; width: number; height: number; fields: SurfaceFields;
}>();
function retainSurface(manifest: WorldManifest, fields: SurfaceFields) {
  validationSurfaces.set(manifest, { source: manifest.surface, data: manifest.surface.data,
    width: manifest.surface.width, height: manifest.surface.height, fields });
  return fields;
}
function validationSurface(manifest: WorldManifest) {
  const cached = validationSurfaces.get(manifest), surface = manifest.surface;
  if (cached?.source === surface && cached.data === surface.data && cached.width === surface.width && cached.height === surface.height) return cached.fields;
  return retainSurface(manifest, decodeWorldSurface(surface));
}

/** Protocol-3 terrain surface: row-major int16 little-endian elevation, then one biome byte per cell. */
export function decodeWorldSurface(surface: WorldManifest['surface']) {
  const count = surface.width * surface.height;
  if (surface.data.length !== count * 4) throw invalid();
  const bytes = atob(surface.data);
  const elevation = new Int16Array(count), biome = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    const offset = id * 3;
    elevation[id] = bytes.charCodeAt(offset) | (bytes.charCodeAt(offset + 1) << 8);
    biome[id] = bytes.charCodeAt(offset + 2);
    if (elevation[id] < -12000 || elevation[id] > 12000 || biome[id] >= WORLD_BIOMES.length
      || (!lakeCode(biome[id]) && marineCode(biome[id]) !== (elevation[id] < 0))) throw invalid();
  }
  return { elevation, biome };
}

export function parseWorldManifest(payload: unknown): WorldManifest {
  if (!Check(WorldManifestSchema, payload)) throw invalid();
  const shape = WORLD_SIZES[payload.settings.size];
  const cells = payload.width * payload.height;
  if (payload.width !== shape.width || payload.height !== shape.height || payload.worldKey !== worldKey(payload.settings)) throw invalid();
  if (payload.biomeCounts.reduce((sum, count) => sum + count, 0) !== cells || payload.resourceSites > cells) throw invalid();
  const water = payload.biomeCounts.reduce((sum, count, index) => sum + (isWorldWater(WORLD_BIOMES[index]) ? count : 0), 0);
  if (payload.landCells !== cells - water) throw invalid();
  validateFields(payload.overview.fields, 32768);
  if (payload.surface.width !== payload.width || payload.surface.height !== payload.height) throw invalid();
  const surface = decodeWorldSurface(payload.surface);
  const surfaceCounts = new Array<number>(WORLD_BIOMES.length).fill(0);
  for (const biome of surface.biome) surfaceCounts[biome]++;
  if (surfaceCounts.some((count, index) => count !== payload.biomeCounts[index])) throw invalid();
  const step = payload.width / payload.overview.width;
  for (let at = 0; at < 32768; at++) {
    const id = (Math.floor(at / 256) * step + Math.floor(step / 2)) * payload.width + (at % 256) * step + Math.floor(step / 2);
    if (surface.biome[id] !== payload.overview.fields.biome[at]
      || surface.elevation[id] !== payload.overview.fields.elevation[at]) throw invalid();
  }
  hydrologyIndexes.set(payload, validateWorldHydrology(payload.hydrology, payload, surface, lakeCode, marineCode));
  retainSurface(payload, surface);
  return payload;
}

export function parseWorldTile(payload: unknown, manifest: WorldManifest, x: number, y: number): WorldTile {
  if (!Check(WorldTileSchema, payload)) throw invalid();
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= manifest.width / WORLD_TILE_SIZE || y >= manifest.height / WORLD_TILE_SIZE) throw invalid();
  if (payload.worldKey !== manifest.worldKey || payload.x !== x || payload.y !== y) throw invalid();
  validateFields(payload.fields, WORLD_TILE_SIZE ** 2);
  const surface = validationSurface(manifest);
  for (let at = 0; at < WORLD_TILE_SIZE ** 2; at++) {
    const id = (y * WORLD_TILE_SIZE + Math.floor(at / WORLD_TILE_SIZE)) * manifest.width + x * WORLD_TILE_SIZE + at % WORLD_TILE_SIZE;
    if (payload.fields.elevation[at] !== surface.elevation[id] || payload.fields.biome[at] !== surface.biome[id]) throw invalid();
  }
  return payload;
}

export function inspectWorldCell(manifest: WorldManifest, tile: WorldTile, x: number, y: number): InspectedWorldCell {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= manifest.width || y >= manifest.height
    || tile.worldKey !== manifest.worldKey || Math.floor(x / WORLD_TILE_SIZE) !== tile.x || Math.floor(y / WORLD_TILE_SIZE) !== tile.y) throw invalid();
  const at = (y % WORLD_TILE_SIZE) * tile.width + x % WORLD_TILE_SIZE;
  const surface = validationSurface(manifest);
  let hydro = hydrologyIndexes.get(manifest);
  if (!hydro) { hydro = validateWorldHydrology(manifest.hydrology, manifest, surface, lakeCode, marineCode); hydrologyIndexes.set(manifest, hydro); }
  return { id: y * manifest.width + x, x, y, water: inspectWorldWater(manifest.hydrology, hydro, manifest, surface, y * manifest.width + x, marineCode), elevation: tile.fields.elevation[at],
    temperature: tile.fields.temperature[at] / 10, moisture: tile.fields.moisture[at] / 1000,
    biome: WORLD_BIOMES[tile.fields.biome[at]], resource: RESOURCE_IDS[tile.fields.resource[at] - 1] ?? null };
}
