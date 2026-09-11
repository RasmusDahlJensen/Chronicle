import { Type, type Static } from 'typebox';
import type { SettlementState } from './settlements.ts';
import type { CountryAI } from './country-ai.ts';
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
const cell = Type.Integer({ minimum: 0, maximum: 524287 });
export const CountryTerritorySchema = Type.Object(
  {
    countryId: Type.String({ minLength: 1, maxLength: 64 }),
    capitalCellId: cell,
    cells: Type.Array(cell, { maxItems: 524288 }),
  },
  { additionalProperties: false },
);
export type CountryTerritory = Static<typeof CountryTerritorySchema>;
export const CountryGrowthSchema = Type.Object(
  {
    version: Type.Literal(1),
    territory: CountryTerritorySchema,
    initialCells: Type.Array(cell, { minItems: 1, maxItems: 16 }),
    claimsAdded: count,
    claimsReleased: count,
    births: count,
    naturalDeaths: count,
    starvationDeaths: count,
    birthRemainder: Type.Integer({ minimum: 0, maximum: 35999 }),
    deathRemainder: Type.Integer({ minimum: 0, maximum: 35999 }),
    hungerRemainder: Type.Integer({ minimum: 0, maximum: 29 }),
    personDays: count,
    upkeepPaid: count,
    upkeepShortfall: count,
    spoilage: count,
    unsupportedDays: count,
    metrics: Type.Object(
      {
        workforce: count,
        supportRequired: count,
        supportWorkers: count,
        claimWorkers: count,
        gatheringWorkers: count,
        idleWorkers: count,
        foodCapacity: count,
        upkeepDue: count,
        upkeepPaid: count,
        upkeepShortfall: count,
        births: count,
        naturalDeaths: count,
        starvationDeaths: count,
      },
      { additionalProperties: false },
    ),
    history: Type.Array(
      Type.Object(
        {
          day: count,
          kind: Type.Enum(['claimed', 'released', 'collapsed']),
          cellId: Type.Union([cell, Type.Null()]),
          message: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type CountryGrowth = Static<typeof CountryGrowthSchema>;
export function countryNeighbors(id: number, width: number, height: number): number[] {
  const x = id % width,
    y = Math.floor(id / width);
  return [
    y * width + ((x + width - 1) % width),
    y * width + ((x + 1) % width),
    ...(y > 0 ? [id - width] : []),
    ...(y + 1 < height ? [id + width] : []),
  ];
}
export function connectedCountryCells(
  cells: readonly number[],
  capital: number,
  width: number,
  height: number,
): boolean {
  const remaining = new Set(cells);
  if (!remaining.delete(capital)) return false;
  const queue = [capital];
  for (let at = 0; at < queue.length; at++)
    for (const next of countryNeighbors(queue[at], width, height)) if (remaining.delete(next)) queue.push(next);
  return remaining.size === 0;
}
/** Only the authoritative caller supplies the world's other ownership regions. */
export function addCountryClaim(
  region: CountryTerritory,
  id: number,
  width: number,
  height: number,
  others: readonly CountryTerritory[] = [],
): boolean {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id >= width * height ||
    region.cells.includes(id) ||
    others.some((other) => other.cells.includes(id)) ||
    !countryNeighbors(id, width, height).some((next) => region.cells.includes(next))
  )
    return false;
  region.cells.push(id);
  region.cells.sort((a, b) => a - b);
  return true;
}
export function releaseCountryClaim(region: CountryTerritory, id: number, width: number, height: number): boolean {
  if (id === region.capitalCellId || !region.cells.includes(id)) return false;
  const remaining = region.cells.filter((cell) => cell !== id);
  if (!connectedCountryCells(remaining, region.capitalCellId, width, height)) return false;
  region.cells = remaining;
  return true;
}
export function validateCountryGrowth(
  country: CountryGrowth,
  sim: SettlementState,
  ai: CountryAI,
  population: number,
  day: number,
  width: number,
  height: number,
  countryId: string,
): void {
  const fail = () => {
    throw new Error('Invalid country growth accounting or claims; saved data has been preserved.');
  };
  const region = country.territory,
    c = sim.centers[0],
    metrics = country.metrics;
  const sorted = (cells: number[]) => cells.every((id, i) => id < width * height && (i === 0 || id > cells[i - 1]));
  if (
    sim.centers.length !== 1 ||
    sim.mainSettlementId !== c.id ||
    sim.nextSettlementId !== 2 ||
    sim.startedDay !== 0 ||
    region.countryId !== countryId ||
    region.capitalCellId !== sim.initialCellId ||
    c.cellId !== sim.initialCellId ||
    !sorted(region.cells) ||
    !sorted(country.initialCells) ||
    !connectedCountryCells(country.initialCells, region.capitalCellId, width, height) ||
    (population > 0
      ? !connectedCountryCells(region.cells, region.capitalCellId, width, height)
      : region.cells.length !== 0) ||
    region.cells.length !== country.initialCells.length + country.claimsAdded - country.claimsReleased ||
    population !== 250 + country.births - country.naturalDeaths - country.starvationDeaths ||
    country.naturalDeaths * 36000 + country.deathRemainder !== country.personDays * 2 ||
    country.births * 36000 + country.birthRemainder > country.personDays * 4 ||
    country.starvationDeaths * 30 + country.hungerRemainder > sim.totalShortfall ||
    (population > 0 && country.starvationDeaths * 30 + country.hungerRemainder !== sim.totalShortfall) ||
    c.population !== population ||
    c.territory.length !== 1 ||
    c.territory[0] !== c.cellId ||
    c.foundingCellId !== null ||
    c.foundingDays !== 0 ||
    c.workingCells.some((id) => !region.cells.includes(id)) ||
    sim.totalConsumed + sim.totalShortfall !== country.personDays ||
    c.food !==
      7500 + sim.totalCollected - sim.totalConsumed - sim.establishmentSpent - country.upkeepPaid - country.spoilage ||
    metrics.workforce !==
      metrics.supportWorkers + metrics.claimWorkers + metrics.gatheringWorkers + metrics.idleWorkers ||
    metrics.supportWorkers > metrics.supportRequired ||
    (day > 0 && metrics.upkeepDue !== metrics.upkeepPaid + metrics.upkeepShortfall) ||
    country.unsupportedDays > day ||
    country.history.length > 64 ||
    country.history.some((e) => e.day > day || (e.cellId !== null && e.cellId >= width * height)) ||
    ai.decisions.some((d) => d.goal !== 'expand' && d.goal !== 'consolidate')
  )
    fail();
  if (
    day === 0 &&
    (country.personDays ||
      country.births ||
      country.naturalDeaths ||
      country.starvationDeaths ||
      country.upkeepPaid ||
      country.upkeepShortfall ||
      country.spoilage ||
      country.claimsAdded ||
      country.claimsReleased ||
      country.birthRemainder ||
      country.deathRemainder ||
      country.hungerRemainder ||
      country.history.length ||
      sim.totalCollected ||
      sim.totalConsumed ||
      sim.totalShortfall ||
      sim.establishmentSpent)
  )
    fail();
  for (const d of ai.decisions) {
    if (
      d.goal === 'expand' &&
      (d.reservedPeople !== 12 ||
        d.reservedFood < 1 ||
        region.cells.includes(d.targetCellId!) ||
        !countryNeighbors(d.targetCellId!, width, height).some((id) => region.cells.includes(id)))
    )
      fail();
    if (d.goal === 'consolidate' && (d.reservedPeople !== 0 || d.reservedFood !== 0)) fail();
  }
}
