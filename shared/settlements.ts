import { Type, type Static } from 'typebox';
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
const cell = Type.Integer({ minimum: 0, maximum: 524287 });
const id = Type.String({ pattern: '^settlement-[1-9][0-9]*$', maxLength: 32 });
export const SettlementStateSchema = Type.Object({
 initialCellId: cell, mainSettlementId: id, nextSettlementId: Type.Integer({ minimum: 2, maximum: Number.MAX_SAFE_INTEGER - 100 }), startedDay: count,
 centers: Type.Array(Type.Object({ id, name: Type.String({ minLength: 1, maxLength: 96 }), cellId: cell,
  kind: Type.Enum(['camp', 'settlement']), foundedDay: count, prosperousDays: count,
  foundingCellId: Type.Union([cell, Type.Null()]), foundingDays: count,
  territoryLastWorked: Type.Array(count, { minItems: 1, maxItems: 524288 }), population: Type.Integer({ minimum: 1, maximum: 250 }), food: count,
  territory: Type.Array(cell, { minItems: 1, maxItems: 524288 }), workingCells: Type.Array(cell, { maxItems: 524288 }),
  collected: count, consumed: count, shortfall: count, decision: Type.String({ maxLength: 256 }),
  prospectCellId: Type.Union([cell, Type.Null()]), prospectDays: count,
 }, { additionalProperties: false }), { minItems: 1, maxItems: 250 }),
 history: Type.Array(Type.Object({ day: count, kind: Type.Enum(['established','relocated','expanded']), settlementId: id, cellId: cell,
  message: Type.String({ maxLength: 256 }) }, { additionalProperties: false }), { maxItems: 32 }),
 totalCollected: count, totalConsumed: count, totalShortfall: count, establishmentSpent: count,
}, { additionalProperties: false });
export type SettlementState = Static<typeof SettlementStateSchema>;
export type SettlementCenter = SettlementState['centers'][number];
/** Immutable geography stored once per world; food is measured in person-days. */
export interface SettlementEnvironment { worldKey: string; width: number; height: number; cellKm: number;
 biome: number[]; fertility: number[]; resource: number[]; elevation: number[] }
