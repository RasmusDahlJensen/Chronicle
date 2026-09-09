import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';

export const MAX_TERRAIN_CELLS = 100_000;
export const MAX_TERRAIN_BYTES = 8 * 1024 * 1024;
const label = () => Type.String({ minLength: 1, maxLength: 256 });
const positiveInteger = () => Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const nullableId = () => Type.Union([label(), Type.Null()]);

export const TerrainSchema = Type.Union([Type.Literal('water'), Type.Literal('plains'), Type.Literal('hills')]);
export const TerrainCellSchema = Type.Object({
  id: Type.Integer({ minimum: 0, maximum: MAX_TERRAIN_CELLS - 1 }),
  terrain: TerrainSchema,
  elevation: Type.Number({ minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE }),
  provinceId: nullableId(),
}, { additionalProperties: false });
export const TerrainWorldSchema = Type.Object({
  fixtureId: label(), fixtureVersion: positiveInteger(), name: label(),
  width: Type.Integer({ minimum: 1, maximum: MAX_TERRAIN_CELLS }),
  height: Type.Integer({ minimum: 1, maximum: MAX_TERRAIN_CELLS }),
  cellAreaKm2: Type.Number({ exclusiveMinimum: 0, maximum: Number.MAX_VALUE }),
  cells: Type.Array(TerrainCellSchema, { minItems: 1, maxItems: MAX_TERRAIN_CELLS }),
  provinces: Type.Array(Type.Object({ id: label(), name: label(), sovereignId: nullableId() }, {
    additionalProperties: false,
  }), { maxItems: MAX_TERRAIN_CELLS }),
}, { additionalProperties: false });
export const TerrainResponseSchema = Type.Object({
  protocolVersion: Type.Literal(1), world: TerrainWorldSchema,
}, { additionalProperties: false });

export type Terrain = Static<typeof TerrainSchema>;
export type TerrainCell = Static<typeof TerrainCellSchema>;
export type TerrainWorld = Static<typeof TerrainWorldSchema>;

/** Structural and relational checks shared by generation workers and the browser. */
export function parseTerrainResponse(payload: unknown): TerrainWorld {
  const invalid = () => new Error('The terrain response was invalid. Try loading it again.');
  if (!Check(TerrainResponseSchema, payload)) throw invalid();
  const world = payload.world;
  if (world.width * world.height > MAX_TERRAIN_CELLS
    || world.cells.length !== world.width * world.height
    || world.provinces.length > world.cells.length) throw invalid();
  const provinceIds = new Set<string>();
  for (const province of world.provinces) {
    if (provinceIds.has(province.id)) throw invalid();
    provinceIds.add(province.id);
  }
  for (const [index, cell] of world.cells.entries()) {
    if (cell.id !== index) throw invalid();
    if (cell.terrain === 'water' ? cell.provinceId !== null
      : cell.provinceId === null || !provinceIds.has(cell.provinceId)) throw invalid();
  }
  return world;
}
