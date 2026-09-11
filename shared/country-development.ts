import { Type, type Static } from 'typebox';
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
const kind = Type.Enum(['claim', 'food', 'logistics']);
export const CountryDevelopmentSchema = Type.Object(
  {
    version: Type.Literal(1),
    foodLevel: Type.Integer({ minimum: 0, maximum: 100 }),
    logisticsLevel: Type.Integer({ minimum: 0, maximum: 100 }),
    investmentSpent: count,
    workerDays: count,
    completedWorkerDays: count,
    cancelledWorkerDays: count,
    nextProjectId: Type.Integer({ minimum: 1 }),
    completedProjects: count,
    cancelledProjects: count,
    projects: Type.Array(
      Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          kind,
          targetCellId: Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 524287 })]),
          routeDistance: Type.Integer({ minimum: 0, maximum: 1000000 }),
          startedDay: count,
          progress: count,
          duration: Type.Integer({ minimum: 1, maximum: 360 }),
          cost: Type.Integer({ minimum: 1 }),
          workers: Type.Integer({ minimum: 1, maximum: 80 }),
          level: Type.Integer({ minimum: 0, maximum: 100 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 8 },
    ),
    budget: Type.Object(
      {
        reservedFood: count,
        reservedWorkers: count,
        availableFood: count,
        availableWorkers: count,
        projectSlots: Type.Integer({ minimum: 0, maximum: 8 }),
      },
      { additionalProperties: false },
    ),
    history: Type.Array(
      Type.Object(
        {
          day: count,
          projectId: Type.Integer({ minimum: 1 }),
          kind,
          event: Type.Enum(['started', 'completed', 'cancelled']),
          cost: count,
          message: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type CountryDevelopment = Static<typeof CountryDevelopmentSchema>;
export type CountryProject = CountryDevelopment['projects'][number];
export const DEVELOPMENT_LABELS: Record<CountryProject['kind'], string> = {
  claim: 'Claim land',
  food: 'Improve food gathering',
  logistics: 'Improve logistics',
};
export function initialCountryDevelopment(): CountryDevelopment {
  return {
    version: 1,
    foodLevel: 0,
    logisticsLevel: 0,
    investmentSpent: 0,
    workerDays: 0,
    completedWorkerDays: 0,
    cancelledWorkerDays: 0,
    nextProjectId: 1,
    completedProjects: 0,
    cancelledProjects: 0,
    projects: [],
    budget: { reservedFood: 0, reservedWorkers: 0, availableFood: 7500, availableWorkers: 150, projectSlots: 2 },
    history: [],
  };
}

export function investmentTerms(kind: 'food' | 'logistics', level: number) {
  return {
    cost: Math.ceil((kind === 'food' ? 2000 : 1500) * Math.pow(level, kind === 'food' ? 1.35 : 1.4)),
    duration: kind === 'food' ? 60 : 45,
    workers: kind === 'food' ? 12 : 10,
  };
}
export function developmentEffects(d: Pick<CountryDevelopment, 'foodLevel' | 'logisticsLevel'>) {
  return {
    foodMultiplier: 1 + 0.18 * Math.sqrt(d.foodLevel),
    reachMultiplier: 1 + 0.35 * d.logisticsLevel,
    supportMultiplier: 0.18 / (1 + 0.4 * d.logisticsLevel),
  };
}
