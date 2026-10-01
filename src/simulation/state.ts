import type { Chronicle } from './chronicle.ts';
import type { FoodModel } from './food.ts';
import type { SimulationGeography } from './geography.ts';
import type { LanguageSeed } from './names.ts';
import type { RegionPartition } from './regions.ts';
import type { systemStream } from './rng.ts';

/**
 * The fixed system order of one monthly tick (VISION.md "System order per monthly tick"). Systems with longer
 * cadences still run every month and select the entities due this month (staggered by id), so their cost spreads
 * evenly. Ids index the per-system RNG streams and timing counters; append only.
 */
export const SYSTEMS = [
  { id: 0, key: 'environment', label: 'Environment' },
  { id: 1, key: 'production', label: 'Production' },
  { id: 2, key: 'population', label: 'Population' },
  { id: 3, key: 'knowledge', label: 'Knowledge' },
  { id: 4, key: 'culture', label: 'Culture and religion' },
  { id: 5, key: 'stability', label: 'Stability' },
  { id: 6, key: 'decisions', label: 'Decisions' },
  { id: 7, key: 'construction', label: 'Construction' },
  { id: 8, key: 'diplomacy', label: 'Diplomacy and trade' },
  { id: 9, key: 'war', label: 'War' },
  { id: 10, key: 'fracture', label: 'Fracture' },
  { id: 11, key: 'chronicle', label: 'Chronicle' },
] as const;
export type SystemKey = typeof SYSTEMS[number]['key'];

export const VALUE_KEYS = ['militarism', 'zeal', 'openness', 'tradition', 'expansionism'] as const;
export type CultureValues = Record<typeof VALUE_KEYS[number], number>;

/** Cultures belong to people and are never deleted (VISION.md "Culture and lineage"). */
export interface Culture {
  id: number; name: string; values: CultureValues; language: LanguageSeed;
  parents: { id: number; weight: number }[]; foundedTick: number;
}

/** A band or a civilization (VISION.md "Polities"). Never deleted: dead polities keep their death tick. */
export interface Polity {
  id: number; kind: 'band' | 'civ'; name: string; culture: number;
  /** A band's current region. */
  region: number;
  /** Tick it entered its current region (settling needs a long stay). */
  arrivedTick: number;
  foundedTick: number; deathTick: number | null; parent: number | null;
  /** Its population group (one per band). */
  group: number;
}

/** People of one polity, culture and region; integer size with fractional birth and death carries. */
export interface PopulationGroup {
  id: number; polity: number; culture: number; region: number; size: number; deathTick: number | null;
  /** Food store in integer units of 1/100 person-month. */
  store: number;
  birthCarry: number; naturalCarry: number; famineCarry: number;
  /** Food security of the last month: (store + expected annual food) ÷ annual need. */
  foodSecurity: number;
  /** Births and deaths so far this year, and in the last complete year. */
  birthsYear: number; deathsYear: number; lastBirths: number; lastDeaths: number;
  /** Size at the start of the current year (the acceptance rule reads bands of at least 50 people). */
  sizeAtYearStart: number;
}

export interface CenturyStats {
  year: number; regions: number; polities: number; bands: number; civs: number; population: number;
  largestShare: number; events: number; occupiedRegions: number;
  /** Share of band population in regions with a coast, open-lake access or river tier ≥ river, and the share of land regions with them. */
  waterPopulationShare: number; waterRegionShare: number;
  bandMoves: number; bandSplits: number; births: number; deaths: number; famineDeaths: number;
  /** Lowest share of habitable regions occupied, over the landmasses that started with bands (story health: ≥ 50% by year 700). */
  occupiedHabitableShare: number;
}

/** Per-tick flows that explain every change in region population and band food stores (VISION.md rule 8). */
export interface Ledger {
  births: Int32Array; naturalDeaths: Int32Array; famineDeaths: Int32Array; migrantsIn: Int32Array; migrantsOut: Int32Array;
  /** Region population before this tick. */
  before: Int32Array;
  /** Food flows per group id this tick. */
  food: Map<number, { before: number; production: number; consumption: number; spoilage: number; carriedIn: number; carriedOut: number }>;
}

export interface Metrics {
  /** Bands of at least 50 people that went a whole year without a birth or a death. */
  silentBandYears: number;
  /** Longest run of consecutive months any region spent above 1.1× its capacity. */
  maxOverCapacityMonths: number;
  moves: number; movesCitingPressure: number; movesLedByPressure: number; splits: number;
  births: number; deaths: number; famineDeaths: number;
}

export interface SimulationState {
  seedText: string; seed: number; tick: number;
  geography: SimulationGeography; partition: RegionPartition; food: FoodModel;
  chronicle: Chronicle;
  cultures: Culture[]; polities: Polity[]; groups: PopulationGroup[];
  /** Per region: game stock (0–1), the occupying band (−1 for none), capacity at the current game stock, months above 1.1× capacity. */
  gameStock: Float64Array; occupant: Int32Array; capacity: Float64Array; overCapacity: Int32Array;
  /** Live band ids in creation order (dead bands are dropped from this list but kept in `polities`). */
  bands: number[];
  /** Regions with food for some method at full game, and the landmasses that started with bands. */
  habitable: Uint8Array; settledLandmasses: number[];
  ledger: Ledger;
  metrics: Metrics;
  timing: { ms: Float64Array; calls: Float64Array };
  stats: CenturyStats[];
  /** Every SERIES_YEARS: [year, world population, living polities]. */
  series: [number, number, number][];
  /** Highest event id already checked by the invariants. */
  checkedEvents: number;
}
/**
 * What a system sees of the current tick. `stream(entity)` returns a fresh generator keyed by (seed, tick, system,
 * entity): calling it twice with the same entity in one tick repeats the same numbers, so take one stream per entity
 * and draw from it, or pass distinct entity keys.
 */
export interface TickContext { tick: number; year: number; month: number; stream(entity?: number, salt?: number): ReturnType<typeof systemStream> }
