import { Type, type Static } from 'typebox';

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
const cell = Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 524287 })]);
const goal = Type.Enum(['consolidate', 'expand', 'relocate', 'found']);
const settlementId = Type.String({ pattern: '^settlement-[1-9][0-9]*$', maxLength: 32 });
const reason = Type.String({ minLength: 1, maxLength: 256 });
export const CountryAlternativeSchema = Type.Object({ goal, targetCellId: cell, score: Type.Integer({ minimum: 0, maximum: 100 }), eligible: Type.Boolean(), reason }, { additionalProperties: false });
export const CountryAISchema = Type.Object({
  version: Type.Literal(1), historySeed: Type.String({ minLength: 1, maxLength: 64 }),
  profile: Type.Object({ reserveDays: Type.Integer({ minimum: 30, maximum: 90 }), expansion: Type.Integer({ minimum: 0, maximum: 100 }),
    mobility: Type.Integer({ minimum: 0, maximum: 100 }), commitmentDays: Type.Integer({ minimum: 30, maximum: 90 }) }, { additionalProperties: false }),
  rngState: Type.Array(Type.Integer({ minimum: -2147483648, maximum: 2147483647 }), { minItems: 4, maxItems: 4 }),
  decisions: Type.Array(Type.Object({ settlementId, goal, targetCellId: cell, sinceDay: count, reviewDay: count, foodPressure: Type.Boolean(),
    reservedFood: count, reservedPeople: Type.Integer({ minimum: 0, maximum: 80 }), reason,
    alternatives: Type.Array(CountryAlternativeSchema, { minItems: 1, maxItems: 10 }),
  }, { additionalProperties: false }), { maxItems: 250 }),
  history: Type.Array(Type.Object({ day: count, settlementId, goal, reason }, { additionalProperties: false }), { maxItems: 64 }),
}, { additionalProperties: false });
export type CountryAI = Static<typeof CountryAISchema>;
export type CountryAlternative = Static<typeof CountryAlternativeSchema>;
export type CountryDecision = CountryAI['decisions'][number];
export const COUNTRY_GOAL_LABELS: Record<CountryAlternative['goal'], string> = {
  consolidate: 'Build reserves', expand: 'Extend local presence', relocate: 'Move to better food access', found: 'Found a community',
};
