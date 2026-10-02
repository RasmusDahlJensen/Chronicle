import type { Chronicle } from './chronicle.ts';
import type { FoodModel } from './food.ts';
import type { Knowledge } from './knowledge.ts';
import type { SimulationGeography } from './geography.ts';
import type { LanguageSeed } from './names.ts';
import type { RegionPartition } from './regions.ts';
import type { systemStream } from './rng.ts';
import type { Affinity } from './techs.ts';

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

/**
 * A tribe of bands or a civilization (VISION.md "Polities"), with one population group (a band of people) in each
 * region it holds. Never deleted: dead polities keep their death tick.
 */
export interface Polity {
  id: number; kind: 'band' | 'civ'; name: string; culture: number;
  foundedTick: number; deathTick: number | null; parent: number | null;
  /** Its living population groups, one per region, in the order they were founded. */
  groups: number[];
  /** Its core group: the heartland band, where a breakaway's distance is measured from and the capital is founded. */
  core: number;
  /** The starting band it descends from (0–29 by default): a people's lineage, kept by every daughter. */
  lineage: number;
  knowledge: Knowledge;
  /** The landmass it began on; without Sailing it can never be anywhere else (VISION.md M2). */
  homeLandmass: number;
  /** Polities it is in contact with (within two regions; refreshed by the knowledge system), and each contact's intensity (0–1). */
  contacts: number[]; contactWeights: number[];
  /** Exposure to its research target, valid while the target, contacts, that tech's discovery count and the world's
   *  death count are unchanged (the only things exposure depends on); derived, recomputed when any changes. */
  exposure: { tech: number; learned: number; deaths: number; value: number };
  /** A civilization's capital settlement, and when it settled. */
  capital: number | null; settledTick: number | null;
}

/** A named place (VISION.md "Settlements"); until M3b only a village with a cell, region, owner and capital flag. */
export interface Settlement {
  id: number; name: string; cell: number; region: number; owner: number; capital: boolean; foundedTick: number;
  status: 'alive' | 'ruined' | 'razed';
}

/** People of one polity, culture and region; integer size with fractional birth and death carries. */
export interface PopulationGroup {
  id: number; polity: number; culture: number; region: number; size: number; deathTick: number | null;
  /** Tick it was founded and tick it entered its current region (settling needs a long stay). */
  foundedTick: number; arrivedTick: number;
  /** Food store in integer units of 1/100 person-month. */
  store: number;
  /** Crops in the field: what farm workers have sown since the last harvest, in the same units; the harvest moves it
   *  into the store, and people who leave their land or die out lose it. */
  planted: number;
  birthCarry: number; naturalCarry: number; famineCarry: number;
  /** Food security of the last month (see `produce`): expected food over need, or this month's share of need eaten when people went short. */
  foodSecurity: number;
  /** Births and deaths so far this year, and in the last complete year. */
  birthsYear: number; deathsYear: number; lastBirths: number; lastDeaths: number;
  /** Size at the start of the current year (the acceptance rule reads bands of at least 50 people). */
  sizeAtYearStart: number;
  /** People freed from food production by surplus (VISION.md "Specialists"); they research. */
  specialists: number;
  /** Share of last month's food from farming and herding. */
  farmShare: number;
}

export interface CenturyStats {
  /** Living polities: tribes (of bands) and civilizations; bands are the tribes' groups, one per region. */
  year: number; regions: number; polities: number; tribes: number; bands: number; civs: number; population: number;
  largestShare: number; events: number; occupiedRegions: number;
  /** Most regions held by one polity (a tribe's bands or a civilization's villages). */
  largestRegions: number;
  /** Share of band population in regions with a coast, open-lake access or river tier ≥ river, and the share of land regions with them. */
  waterPopulationShare: number; waterRegionShare: number;
  bandMoves: number; bandSplits: number; bandBreakaways: number; births: number; deaths: number; famineDeaths: number;
  settlements: number; specialists: number;
  /** Share of living polities that know Agriculture, and the leading polity's era index. */
  agricultureShare: number; leadingEra: number;
  /** Lowest share of habitable regions occupied, over the landmasses that started with bands (story health: ≥ 50% by year 700). */
  occupiedHabitableShare: number;
}

/** Per-tick flows that explain every change in region population and band food stores (VISION.md rule 8). */
export interface Ledger {
  births: Int32Array; naturalDeaths: Int32Array; famineDeaths: Int32Array; migrantsIn: Int32Array; migrantsOut: Int32Array;
  /** Region population before this tick. */
  before: Int32Array;
  /** Food flows per group id this tick: the store's (production includes the harvest) and the crops' in the field. */
  food: Map<number, FoodFlows>;
}

export interface FoodFlows {
  before: number; production: number; consumption: number; spoilage: number; carriedIn: number; carriedOut: number;
  plantedBefore: number; sown: number; harvested: number; cropsLost: number;
}

export interface Metrics {
  /** Bands of at least 50 people that went a whole year without a birth or a death. */
  silentBandYears: number;
  /** Longest run of consecutive months any region spent above 1.1× its capacity. */
  maxOverCapacityMonths: number;
  moves: number; movesCitingPressure: number; movesLedByPressure: number;
  /** Band splits, and those that broke away from their tribe as a tribe of their own. */
  splits: number; breakaways: number;
  births: number; deaths: number; famineDeaths: number;
  settled: number; discoveries: number;
}

/** The first discovery of each tech in the world (VISION.md "firsts"). */
export interface FirstDiscovery { tech: number; tick: number; polity: number; region: number }

export interface SimulationState {
  seedText: string; seed: number; tick: number;
  geography: SimulationGeography; partition: RegionPartition; food: FoodModel;
  chronicle: Chronicle;
  cultures: Culture[]; polities: Polity[]; groups: PopulationGroup[];
  /** Per region: game stock (0–1), the occupying polity and its group there (−1 for none), capacity at the current game stock, months above 1.1× capacity. */
  gameStock: Float64Array; occupant: Int32Array; groupAt: Int32Array; capacity: Float64Array; overCapacity: Int32Array;
  /** Per region: the game stock at the last capacity solve (the solve is redone when it has drifted). */
  capacityGame: Float64Array;
  /** Live polity ids in creation order, bands and civilizations (dead ones leave this list but stay in `polities`). */
  living: number[];
  settlements: Settlement[];
  /** Per region: the civilization that owns it (−1 for none). */
  owner: Int32Array;
  firsts: FirstDiscovery[];
  /** Per lineage, the culture name of its starting band (the observer names peoples by it). */
  lineages: string[];
  /** Discoveries of each tech so far and polities that have died out so far (exposure caches read them). */
  learnedCount: Int32Array; deathCount: number;
  /** Year when a quarter of living polities first knew Agriculture (−1 until then). */
  agricultureQuarterYear: number;
  /** Per region: environment conditions that raise research weights (static). */
  affinity: Set<Affinity>[];
  /** Regions with food for some method at full game, and the landmasses that started with bands. */
  habitable: Uint8Array; settledLandmasses: number[];
  ledger: Ledger;
  metrics: Metrics;
  timing: { ms: Float64Array; calls: Float64Array };
  stats: CenturyStats[];
  /** Every SERIES_YEARS (yearly): [year, world population, living polities]. */
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
