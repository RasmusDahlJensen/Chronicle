import type { Knowledge } from './knowledge.ts';
import { TECHS } from './techs.ts';

/**
 * Buildings as data (VISION.md "Buildings"): what unlocks each (a tech that names it in its unlocks), what it costs in
 * wealth and months, its yearly upkeep, where it may stand, the need it answers and its effects. Effects are limited
 * to kinds the systems understand, so new buildings never need new code. Mines, quarries and harbors (M3b.3) and
 * wonders (M3b.4) join this list later.
 */
export const PURPOSES = ['food', 'faith', 'learning', 'trade', 'housing', 'defense', 'mining', 'sea'] as const;
export type Purpose = typeof PURPOSES[number];

export interface BuildingEffects {
  /** Multipliers on the settlement's housing, on its townspeople's research and wealth, and on its region's food store
   *  limit and spoilage; additions to its region's stability and to its defence (from M6). */
  housing?: number; research?: number; wealth?: number; storeMonths?: number; spoilage?: number;
  stability?: number; defense?: number;
  /** The region's sites it works (VISION.md: mines and quarries are needed before a mineral or stone site yields), and
   *  whether it is a harbor (sea crossings start only from a region with one). */
  works?: 'mineral' | 'stone'; harbor?: boolean;
}
export interface BuildingDefinition {
  id: string; name: string; purpose: Purpose;
  /** Wealth to build, months it takes, wealth a year to keep up. */
  cost: number; months: number; upkeep: number;
  /** The smallest tier of settlement it may stand in (0 village … 3 metropolis); whether it needs the sea next to the
   *  settlement; whether one serves its whole region (no second in the same region); whether it is built of stone
   *  (cheaper where the civilization quarries stone). */
  minTier: number; coast: boolean; perRegion: boolean; stone: boolean;
  effects: BuildingEffects;
}

const building = (id: string, purpose: Purpose, cost: number, months: number, upkeep: number, minTier: number, effects: BuildingEffects,
  place: { coast?: boolean; perRegion?: boolean; stone?: boolean } = {}): BuildingDefinition =>
  ({ id, name: id, purpose, cost, months, upkeep, minTier, coast: place.coast ?? false, perRegion: place.perRegion ?? false, stone: place.stone ?? false, effects });

export const BUILDINGS: readonly BuildingDefinition[] = [
  // Neolithic (Masonry).
  building('granary', 'food', 2_000, 12, 40, 0, { storeMonths: 1.5, spoilage: 0.8 }),
  building('walls', 'defense', 4_000, 24, 80, 1, { defense: 0.5 }, { stone: true }),
  building('shrine', 'faith', 1_500, 12, 30, 0, { stability: 0.03 }),
  // Bronze (Writing; Organized religion also unlocks the temple).
  building('temple', 'faith', 6_000, 36, 120, 1, { stability: 0.06 }, { stone: true }),
  // Bronze (Mining): works the region's mineral sites.
  building('mine', 'mining', 10_000, 36, 200, 0, { works: 'mineral' }, { perRegion: true }),
  building('library', 'learning', 8_000, 36, 160, 1, { research: 1.25 }),
  // Iron (Currency).
  building('market', 'trade', 6_000, 24, 120, 1, { wealth: 1.5, housing: 1.25 }),
  // Iron (Iron working: stone tools of iron; Sailing): stone sites, and the sea.
  building('quarry', 'mining', 6_000, 24, 120, 0, { works: 'stone' }, { perRegion: true }),
  building('harbor', 'sea', 12_000, 36, 240, 0, { harbor: true }, { coast: true, perRegion: true }),
  // Classical (Engineering).
  building('aqueduct', 'housing', 30_000, 60, 600, 1, { housing: 2.5 }, { stone: true }),
  // Medieval (Astronomy) and Early modern (Printing).
  building('observatory', 'learning', 25_000, 48, 500, 2, { research: 1.15 }),
  building('university', 'learning', 40_000, 60, 800, 2, { research: 1.4 }),
];
export const BUILDING_INDEX = new Map(BUILDINGS.map((definition, index) => [definition.id, index]));

// For each building, the techs that unlock it.
const UNLOCKED_BY = BUILDINGS.map(definition => TECHS.flatMap((tech, index) => tech.effects.unlocks?.includes(definition.id) ? [index] : []));

/** Whether a polity with this knowledge can build it. */
export function buildingKnown(knowledge: Knowledge, building: number) {
  return UNLOCKED_BY[building].some(tech => knowledge.known[tech]);
}

/** Startup check: unique ids, an unlocking tech for each, positive costs, sensible effects. */
export function validateBuildings() {
  const problems: string[] = [];
  if (BUILDING_INDEX.size !== BUILDINGS.length) problems.push('building ids must be unique');
  BUILDINGS.forEach((definition, index) => {
    if (!UNLOCKED_BY[index].length) problems.push(`no tech unlocks ${definition.id}`);
    if (!(definition.cost > 0 && Number.isInteger(definition.cost) && Number.isInteger(definition.months) && definition.months >= 1 && definition.upkeep >= 0 && Number.isInteger(definition.upkeep))) problems.push(`${definition.id} has invalid cost, time or upkeep`);
    if (!(Number.isInteger(definition.minTier) && definition.minTier >= 0 && definition.minTier <= 3)) problems.push(`${definition.id} has tier ${definition.minTier}`);
    const effects = definition.effects;
    for (const key of ['housing', 'research', 'wealth', 'storeMonths'] as const) if (effects[key] !== undefined && !(effects[key]! >= 1)) problems.push(`${definition.id} ${key} must be at least 1`);
    if (effects.spoilage !== undefined && !(effects.spoilage > 0 && effects.spoilage <= 1)) problems.push(`${definition.id} spoilage must be in (0, 1]`);
    for (const key of ['stability', 'defense'] as const) if (effects[key] !== undefined && !(effects[key]! >= 0 && effects[key]! <= 1)) problems.push(`${definition.id} ${key} must be in [0, 1]`);
  });
  if (problems.length) throw new Error(`Invalid building data: ${problems.join('; ')}.`);
}
