import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';

export const MAX_ATLAS_CELLS = 100_000;
export const MAX_ATLAS_BYTES = 8 * 1024 * 1024;
export const ATLAS_PROTOCOL_VERSION = 3;
export const BIOME_IDS = ['ocean', 'coast', 'grassland', 'forest', 'rainforest', 'desert', 'savanna', 'wetland', 'tundra', 'mountain', 'snow'] as const;
export const RESOURCE_IDS = ['fish', 'grain', 'timber', 'game', 'stone', 'iron', 'copper', 'gold', 'salt', 'coal', 'uranium'] as const;
const label = () => Type.String({ minLength: 1, maxLength: 96 });
const nullableId = () => Type.Union([label(), Type.Null()]);
export const BiomeSchema = Type.Enum(BIOME_IDS);
export const ResourceSchema = Type.Enum(RESOURCE_IDS);
export const AtlasCellSchema = Type.Object({
  id: Type.Integer({ minimum: 0, maximum: MAX_ATLAS_CELLS - 1 }),
  elevation: Type.Integer({ minimum: -12_000, maximum: 12_000 }),
  biome: BiomeSchema,
  // Site presence is geography. Null is no special site, not hidden knowledge or zero biome productivity.
  resource: Type.Union([ResourceSchema, Type.Null()]), provinceId: nullableId(),
}, { additionalProperties: false });
export const AtlasProvinceSchema = Type.Object({ id: label(), name: label(), countryId: nullableId() }, { additionalProperties: false });
export const AtlasCountrySchema = Type.Object({ id: label(), name: label() }, { additionalProperties: false });
export const AtlasAnnotationSchema = Type.Object({
  text: label(), x: Type.Number({ minimum: 0, maximum: MAX_ATLAS_CELLS }),
  y: Type.Number({ minimum: 0, maximum: MAX_ATLAS_CELLS }),
  kind: Type.Union([Type.Literal('land'), Type.Literal('water')]),
}, { additionalProperties: false });
export const AtlasWorldSchema = Type.Object({
  fixtureId: label(), fixtureVersion: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), name: label(),
  width: Type.Integer({ minimum: 1, maximum: MAX_ATLAS_CELLS }),
  height: Type.Integer({ minimum: 1, maximum: MAX_ATLAS_CELLS }),
  cellAreaKm2: Type.Number({ exclusiveMinimum: 0, maximum: 1_000_000 }),
  topology: Type.Literal('bounded'), cells: Type.Array(AtlasCellSchema, { minItems: 1, maxItems: MAX_ATLAS_CELLS }),
  provinces: Type.Array(AtlasProvinceSchema, { maxItems: MAX_ATLAS_CELLS }),
  countries: Type.Array(AtlasCountrySchema, { maxItems: MAX_ATLAS_CELLS }),
  annotations: Type.Array(AtlasAnnotationSchema, { maxItems: 100 }),
}, { additionalProperties: false });
export const AtlasResponseSchema = Type.Object({ protocolVersion: Type.Literal(ATLAS_PROTOCOL_VERSION), world: AtlasWorldSchema }, { additionalProperties: false });
export type Biome = Static<typeof BiomeSchema>;
export type Resource = Static<typeof ResourceSchema>;
export type AtlasCell = Static<typeof AtlasCellSchema>;
export type AtlasProvince = Static<typeof AtlasProvinceSchema>;
export type AtlasCountry = Static<typeof AtlasCountrySchema>;
export type AtlasAnnotation = Static<typeof AtlasAnnotationSchema>;
export type AtlasWorld = Static<typeof AtlasWorldSchema>;

export function isWaterBiome(biome: Biome) { return biome === 'ocean' || biome === 'coast'; }

/** Validate identity, geography, and hierarchy before host publication or browser rendering. */
export function parseAtlasResponse(payload: unknown): AtlasWorld {
  const invalid = () => new Error('The atlas response was invalid. Try loading it again.');
  if (!Check(AtlasResponseSchema, payload)) throw invalid();
  const world = payload.world;
  if (world.width * world.height !== world.cells.length || world.cells.length > MAX_ATLAS_CELLS) throw invalid();
  const countries = new Set(world.countries.map(country => country.id));
  const provinces = new Set(world.provinces.map(province => province.id));
  if (countries.size !== world.countries.length || provinces.size !== world.provinces.length) throw invalid();
  for (const province of world.provinces) {
    if (province.countryId !== null && !countries.has(province.countryId)) throw invalid();
  }
  for (const annotation of world.annotations) if (annotation.x >= world.width || annotation.y >= world.height) throw invalid();
  for (const [id, cell] of world.cells.entries()) {
    if (cell.id !== id || isWaterBiome(cell.biome) !== (cell.elevation < 0)) throw invalid();
    if (isWaterBiome(cell.biome) ? cell.provinceId !== null : cell.provinceId === null || !provinces.has(cell.provinceId)) throw invalid();
  }
  const visited = new Uint8Array(world.cells.length);
  const connected = new Set<string>();
  const queue = new Int32Array(world.cells.length);
  for (const cell of world.cells) {
    if (cell.provinceId === null || visited[cell.id]) continue;
    if (connected.has(cell.provinceId)) throw invalid();
    connected.add(cell.provinceId);
    let head = 0; let tail = 1;
    queue[0] = cell.id; visited[cell.id] = 1;
    while (head < tail) {
      const id = queue[head++];
      const x = id % world.width;
      for (const next of [x > 0 ? id - 1 : -1, x < world.width - 1 ? id + 1 : -1, id - world.width, id + world.width]) {
        if (next < 0 || next >= world.cells.length || visited[next] || world.cells[next].provinceId !== cell.provinceId) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
  }
  if (connected.size !== provinces.size) throw invalid();
  return world;
}
