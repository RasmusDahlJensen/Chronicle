import { CULTURE_ORIGIN_NAMES, VALUE_NAMES } from '../../shared/simulation.ts';
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

export const VALUE_KEYS = VALUE_NAMES;
export type CultureValues = Record<typeof VALUE_KEYS[number], number>;

/** How a culture began: one of the starting peoples, a band that broke away from its tribe, part of a culture that
 *  grew apart from the rest (a split), or two cultures fused (a hybrid). */
export type CultureOrigin = typeof CULTURE_ORIGIN_NAMES[number];

/**
 * Cultures belong to people and are never deleted (VISION.md "Culture and lineage"). Its values are its people's: the
 * mean of the values of the groups it is the culture of, weighted by their people, as of its yearly refresh (frozen
 * once nobody of it is left). Its hue (degrees) is its colour on the culture map; a child's lies near its parent's.
 */
export interface Culture {
  id: number; name: string; values: CultureValues; language: LanguageSeed;
  parents: { id: number; weight: number }[]; foundedTick: number;
  origin: CultureOrigin; hue: number;
  /** People of it and regions where it lives, at its last yearly refresh; the tick it was found without people. */
  people: number; regions: number; deathTick: number | null;
  /** Its traits (indices into `TRAITS`, in the order earned or inherited), and per trait the years in a row most of its
   *  people have lived in that trait's conditions. */
  traits: number[]; traitYears: number[];
}

/**
 * A tribe of bands or a civilization (VISION.md "Polities"), with one population group (a band of people) in each
 * region it holds. Never deleted: dead polities keep their death tick.
 */
export interface Polity {
  /** `culture` is its ruling culture: the culture of its heartland's people (its core group), which its decisions
   *  follow until M5 weighs all its people. */
  id: number; kind: 'band' | 'civ'; name: string; culture: number;
  foundedTick: number; deathTick: number | null; parent: number | null;
  /** Its living population groups, one per region, in the order they were founded. */
  groups: number[];
  /** Its core group: the heartland band, where a breakaway's distance is measured from and the capital is founded. */
  core: number;
  /** The pair of peoples it watches for a hybrid (VISION.md "Hybrids"): the other culture that has lived beside its
   *  ruling culture as a large part of its people (−1 none), that ruling culture, and their years together (growing
   *  while both are large, fading while either is not). */
  together: number; togetherRuling: number; togetherYears: number;
  /** The starting band it descends from (0–29 by default): a people's lineage, kept by every daughter. */
  lineage: number;
  knowledge: Knowledge;
  /** The landmass it began on; without Sailing it can never be anywhere else (VISION.md M2). */
  homeLandmass: number;
  /** Polities it has met within two regions (refreshed yearly by the knowledge system), and the most advanced era it
   *  knows of: its own or a living people's it has met (catch-up). */
  contacts: number[]; frontierEra: number;
  /** Peoples it shares knowledge with, and the tick each exchange ends (VISION.md "Sharing knowledge"; both sides hold
   *  the same entry); and peoples that refused an exchange, with when. */
  exchanges: Map<number, number>; exchangeRefused: Map<number, number>;
  /** A civilization's capital settlement, and when it settled. */
  capital: number | null; settledTick: number | null;
  /** What it knows of the map (VISION.md "Knowledge of the world"); read through `perception.ts`. */
  map: MapKnowledge;
  /** Polities it has met, with the tick they met (first contact, or a breakaway's birth); in the order met. */
  met: Map<number, number>;
  /** Its last decision steps, newest last (VISION.md "Decision log"; at most DECISION_TUNING.logSize). */
  decisions: DecisionRecord[];
  /** Tick of its last expansion (or of settling), and the longest gap between expansions so far, in months. */
  lastExpansion: number | null; longestExpansionGap: number;
  /** Tick its sea reach last grew (−1 never): a fresh mobility unlock makes exploring attractive. */
  seaTick: number;
  /** Civilizations that turned it away when it asked to unite, and when (it waits before asking again). */
  rebuffed: Map<number, number>;
  /** A civilization's treasury in whole units of wealth (VISION.md "Wealth"), the fractions of production and upkeep
   *  not yet counted, and its buildings under construction. */
  wealth: number; wealthCarry: number; upkeepCarry: number; projects: Project[];
  /** Whether any of its buildings is worn below full condition (they mend while upkeep is paid). */
  repairing: boolean;
  /** As a civilization: its people's famine deaths, the months its people lived (person-months) and their output
   *  before tax (a twelfth of a year's each month), so far (M3c's health check: famine and wealth). */
  famineDeaths: number; personMonths: number; outputSum: number;
  /** Its roads under construction (VISION.md "Roads"). */
  roadWorks: RoadWork[];
  /** Wonders (ids) it has heard of only by trying to build the same type (see `perception.ts` `knowsOfWonder`). */
  heardWonders: number[];
  /** Its share of last month's road upkeep left unpaid (0–1): the roads it keeps wear by it. */
  roadsUnpaid: number;
  /** A civilization's taxes (VISION.md "Wealth"): the share of its people's output it takes, set once a year; its
   *  arrears, the share of its costs left unpaid, averaged over about a year (0–1); and whether it is now known to be in
   *  arrears and to tax heavily (each change of these is an event). */
  taxRate: number; arrears: number; inArrears: boolean; heavyTaxes: boolean;
  /** Whether it is letting the buildings and roads of some of its far regions go unkept (an episode, `neglected`), and
   *  the years in a row it has since kept everything up (the episode ends after BUDGET_TUNING.keptYears). */
  deferring: boolean; keptYears: number;
}

export const ACTIONS = ['expand', 'explore', 'nothing', 'unite', 'share', 'build'] as const;
export type Action = typeof ACTIONS[number];

/** One decision step: every option with its score and the factors behind it, best first, and the one chosen (its
 *  action and its index among the options: Build can be weighed as a building, a wonder and roads at once). */
export interface DecisionRecord {
  tick: number; chosen: Action; pick: number;
  options: { action: Action; score: number; target: number | null; label: string | null; factors: { factor: string; weight: number }[] }[];
  /** What came of it: done, or why not (for example a target taken by someone else first). */
  outcome: string;
}

/**
 * A polity's map: per region unknown (0), known (1: seen before, remembered as it was then) or observed (2: in sight
 * now). Civilizations remember; tribes keep only what is in sight. Released (emptied) when the polity dies.
 */
export interface MapKnowledge {
  status: Uint8Array;
  /** The regions in sight, ascending. */
  observed: number[];
  /** What each known region looked like when last seen: who lived there and who owned it, and when. */
  snapshots: Map<number, RegionSnapshot>;
  /** Sight changes only when the polity's regions or its sea reach change: set when a group arrives or leaves, and the
   *  sea reach the sight was last built with. */
  dirty: boolean; sea: number;
}
export interface RegionSnapshot { occupant: number; owner: number; tick: number }

/**
 * A named place on one of its region's candidate sites (VISION.md "Settlements"). Its urban population is its share of
 * the region's townspeople (specialists), at most its housing; its tier (an index into SETTLEMENT_TIERS) follows its
 * urban population. Never deleted: a settlement whose people die out or leave falls to ruin and may be resettled.
 */
export interface Settlement {
  id: number; name: string; cell: number; region: number; owner: number; capital: boolean; foundedTick: number;
  status: 'alive' | 'ruined' | 'razed';
  tier: number; urban: number; housing: number;
  /** Its urban population averaged over about a year (a monthly moving average), which its tier follows; and the years
   *  in a row that average has called for another tier (it changes tier only once that has lasted). */
  urbanMean: number; tierYears: number;
  /** Tick it last fell to ruin (null while it has never been ruined), and the name its ruins bore when they were
   *  resettled under a new one (null otherwise). */
  ruinedTick: number | null; formerName: string | null;
  /** Its standing buildings (VISION.md "Buildings"), at most one of each type, and what they add up to (derived,
   *  recomputed whenever they change): multipliers on its townspeople's research and wealth and its region's food
   *  store and spoilage, stability added to its region, and the upkeep they cost a year. */
  buildings: Building[];
  bonus: BuildingBonus;
  /** The type (an index into WONDERS) of the wonder standing there, if any. */
  wonder: number | null;
}

/**
 * A wonder (VISION.md "Wonders"): begun by a civilization in one of its settlements, paid from its owner's treasury
 * until built, then standing (kept up by its owner, worn by unpaid upkeep) until destroyed; never deleted.
 */
export interface Wonder {
  id: number; type: number; settlement: number; builder: number; begunTick: number; builtTick: number | null;
  status: 'building' | 'standing' | 'destroyed' | 'abandoned'; spent: number; cost: number; condition: number;
  /** When it was destroyed or abandoned, and why (VISION.md "Data model": destroyed year and cause). */
  endedTick: number | null; endCause: 'cityRuined' | 'unpaidUpkeep' | 'cityShrank' | null;
  /** Months it has waited, under way, for its city to grow back to the tier it needs. */
  waited: number;
  causes: { factor: string; weight: number }[];
}
export interface BuildingBonus { research: number; wealth: number; store: number; spoilage: number; stability: number; upkeep: number; mine: boolean; quarry: boolean; harbor: boolean; farm: number; drought: number }

/** A standing building: its type (an index into BUILDINGS), condition (0–1, worn by unpaid upkeep) and when it was built. */
export interface Building { type: number; condition: number; builtTick: number }

/** A building under construction for a civilization: where, what, the wealth spent so far, why it was begun, and the
 *  months it has waited (unpaid) for its settlement to grow back to the building's tier. */
export interface Project { settlement: number; type: number; spent: number; cost: number; startedTick: number; causes: { factor: string; weight: number }[]; waited: number }

/**
 * A road on the land edge between two regions (VISION.md "Infrastructure edge"), keyed in `SimulationState.roads` by
 * `roadKey`: `a` < `b`, its tier (an index into ROAD_TIERS plus one: 1 road, 2 paved road, 3 railway, 4 highway),
 * whether a bridge carries it over the river there, its condition (0–1, worn by unpaid upkeep), who built its present
 * tier and when, and its upkeep a year (derived from its tier, length and bridge).
 */
export interface Road { a: number; b: number; tier: number; bridge: boolean; condition: number; builder: number; builtTick: number; upkeep: number }

/**
 * A road under construction for a civilization: from its capital to one of its towns or cities along `path` (regions,
 * capital's first), at `tier`; the edges it builds or improves (as region pairs, each `a` < `b`), the bridges among
 * them, the wealth spent so far of its cost, the months it takes, and why it was begun.
 */
export interface RoadWork {
  from: number; to: number; path: number[]; tier: number; edges: [number, number][]; bridges: number;
  spent: number; cost: number; months: number; startedTick: number; causes: { factor: string; weight: number }[];
}

/** Each region's farmland cells ranked once (`fields.ts` `rankFarmland`). */
export interface FieldRanking {
  /** Farmland cells, region by region, best first: region r's are `order[start[r]]` to `order[start[r + 1] − 1]`. */
  order: Int32Array; start: Int32Array;
  /** Farm labour (people) along that order, cumulative within each region. */
  cumulative: Float64Array;
  /** Per cell: its place in its region's order, or 0xffff (no farmland, or beyond what the contract carries). */
  rank: Uint16Array;
}

/** People of one polity, culture and region; integer size with fractional birth and death carries. */
export interface PopulationGroup {
  id: number; polity: number; culture: number; region: number; size: number; deathTick: number | null;
  /** Its people's values (VISION.md "Culture and lineage": drift and influence act on the people living here, so the
   *  far parts of a culture can grow apart). */
  values: CultureValues;
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
  /** First contacts so far, and the mean number of regions a civilization knows (in sight or remembered). */
  firstContacts: number; civKnownRegions: number;
  /** Decision steps so far by chosen action, expansions, bands absorbed or displaced by them, and expeditions. */
  chosenExpand: number; chosenExplore: number; chosenNothing: number; chosenUnite: number; chosenShare: number; chosenBuild: number;
  /** Civilizations that united with a larger one so far. */
  unions: number;
  expansions: number; absorbed: number; displaced: number; expeditions: number;
  /** People who migrated between populated regions. */
  migrants: number;
  /** Tribes that joined a civilization instead of founding their own, and civilization regions in unrest now (with
   *  how often unrest broke out so far), and the mean stability of civilization regions. */
  joined: number; unrestRegions: number; unrestOutbreaks: number; meanStability: number;
  /** Median travel cost of land edges between regions of different civilizations over the median of land edges within
   *  civilization-held land (VISION.md M3: borders follow barriers), and over the median of all land edges (VISION.md
   *  M6's target); 0 when no two civilizations border. */
  borderRatio: number; borderRatioAll: number;
  /** Knowledge exchanges offered and agreed so far (and of those, with tribes); Agriculture discoveries with no sharing
   *  so far (independent inventions); the number of eras the living civilizations are in, and the fewest and most techs
   *  any of them knows. */
  exchangeOffers: number; exchanges: number; tribeExchanges: number; agricultureInventions: number; civEras: number; civTechsMin: number; civTechsMax: number;
  /** Living settlements by tier (villages, towns, cities, metropolises), and the share of living settlements within one
   *  cell of a river, lake, coast or resource site (VISION.md M3b). */
  villages: number; towns: number; cities: number; metropolises: number; settlementsByWater: number;
  /** Standing buildings, all civilizations' treasuries together, and buildings completed and lost so far. */
  buildings: number; wealth: number; buildingsCompleted: number; buildingsLost: number;
  /** Wonders standing now, and completed so far. */
  wonders: number; wondersCompleted: number;
  /** Road edges standing now (and of those paved or better, and bridged), their travel-km, roads completed (routes)
   *  and road edges lost so far; and VISION.md M3b's road coverage: of the civilizations with at least 5 regions that
   *  know the Wheel and have a town or city, the share whose roads reach at least half of their towns and cities from
   *  their capital (−1 when there are none), and how many such civilizations there are. */
  roadEdges: number; pavedEdges: number; bridges: number; roadKm: number; roadsBuilt: number; roadsLost: number;
  roadCoverage: number; roadCivs: number;
  /** Droughts begun and famines recorded so far, regions in drought now and regions with irrigation. */
  droughts: number; famines: number; regionsInDrought: number; irrigated: number;
  /** Cultivated cells now and their share of all farmland cells; civilizations' famines watched so far, and of those,
   *  the ones whose fields shrank within 10 years, and regrew after (VISION.md M3b). */
  cultivatedCells: number; cultivatedShare: number; faminesWatched: number; fieldsShrank: number; fieldsRegrew: number;
  /** Realms' budgets (VISION.md "Wealth", M3c): the median civilization's treasury in years of its costs, the median
   *  and highest tax rate, civilizations in arrears now; the shares of living settlements and of civilization regions
   *  (with their settlements) that cost more than they pay; costs and administration a year per person in the third of
   *  civilizations largest and oldest (by their size × age factors) and in the smallest and youngest third
   *  (people-weighted); and civilizations that fell into arrears, raised heavy taxes and eased them so far. */
  treasuryYears: number; taxMedian: number; taxMax: number; civsInArrears: number; settlementsAtLoss: number; regionsAtLoss: number;
  costPerPersonLargeOld: number; costPerPersonSmallYoung: number; adminPerPersonLargeOld: number; adminPerPersonSmallYoung: number;
  /** Empire strain (M3c.4): the mean stability and the share of regions in unrest in the same two thirds; unions
   *  refused only for the larger realm's strain so far; and story health's dominance rule: the longest run of years
   *  the largest polity held more than 35% of the world's people, and all such years, so far. */
  stabilityLargeOld: number; stabilitySmallYoung: number; unrestLargeOld: number; unrestSmallYoung: number;
  unionsRefusedForStrain: number; longestDominance: number; dominanceYears: number;
  /** Visible neglect (M3c.5): the share of civilization regions let go unkept now, of road edges worn below 80% of
   *  their condition, and of standing buildings worn below 80%; civilizations that began to let far regions go unkept
   *  so far. */
  regionsNeglected: number; roadsWorn: number; buildingsWorn: number; neglectBegun: number;
  /** Living cultures (M4): cultures with people, culture splits so far (and of those, from the culture of a
   *  civilization's people), how far cultures differ (the mean over the five values of their spread across living
   *  cultures, people-weighted), how far the people of a culture differ from its heart (people-weighted mean), and the
   *  share of civilizations' people whose culture is not their realm's. */
  cultures: number; cultureSplits: number; civCultureSplits: number; valueSpread: number; cultureDivergence: number; foreignShare: number;
  /** Mixed peoples (M4.2): regions assimilated, hybrid cultures formed and traits earned so far, and living cultures
   *  with at least one trait. */
  assimilations: number; hybrids: number; traitsEarned: number; culturesWithTraits: number;
  arrearsBegun: number; taxesRaised: number; taxesEased: number;
  /** Famine relief so far: food landed and lost on the way (person-months), wealth paid for carriage, episodes begun;
   *  and famine deaths a year per 1,000 people over their lives so far in the third of living civilizations (of at
   *  least a century) richest in output a year and in the poorest third (M3c: famine kills a smaller share in rich
   *  realms). */
  reliefFood: number; reliefLost: number; reliefCost: number; reliefBegun: number; reliefShortTreasury: number; reliefShortFood: number; famineRich: number; faminePoor: number;
}

/** Per-tick flows that explain every change in region population and band food stores (VISION.md rule 8). */
export interface Ledger {
  births: Int32Array; naturalDeaths: Int32Array; famineDeaths: Int32Array; migrantsIn: Int32Array; migrantsOut: Int32Array;
  /** Region population before this tick. */
  before: Int32Array;
  /** Food flows per group id this tick: the store's (production includes the harvest) and the crops' in the field. */
  food: Map<number, FoodFlows>;
  /** Wealth flows per civilization id this tick (VISION.md rule 8). */
  wealth: Map<number, WealthFlows>;
}

/** What changed a treasury this tick: production (taxes and the crown's sites), construction, the costs of running
 *  the realm (upkeep of buildings, wonders and roads; administration; services), famine relief (carriage), and wealth passed between
 *  civilizations (a union) or lost (a civilization that dies out). */
export interface WealthFlows { before: number; produced: number; construction: number; upkeep: number; administration: number; services: number; relief: number; received: number; given: number; lost: number }

export interface FoodFlows {
  before: number; production: number; consumption: number; spoilage: number; carriedIn: number; carriedOut: number;
  plantedBefore: number; sown: number; harvested: number; cropsLost: number;
  /** What the harvest gained (above 0) or lost (below 0) to the weather and drought, beyond the crops in the field
   *  (part of production), and the share of its crops it came in at (`SimulationState.harvestFactor`; 1 without one). */
  weather: number; factor: number;
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
  /** First contacts between polities. */
  firstContacts: number;
  /** Decision steps by chosen action (VISION.md story health: the decision mix), and what expansion did. */
  chosen: Record<Action, number>;
  expansions: number; absorbed: number; displaced: number; expeditions: number; migrants: number;
  /** Tribes that joined a civilization, outbreaks of unrest, and civilizations that united with a larger one. */
  joined: number; unrestOutbreaks: number; unions: number;
  /** Knowledge exchanges offered and agreed (and of those, with tribes), and Agriculture learned with no help from a
   *  sharing partner. */
  exchangeOffers: number; exchanges: number; tribeExchanges: number; agricultureInventions: number;
  /** Settlements founded because a region's townspeople outgrew its housing, ruins resettled, and tier changes. */
  settlementsGrown: number; ruinsResettled: number; tierChanges: number;
  /** Buildings begun, completed, lost to unpaid upkeep, and abandoned unfinished; wonders begun, completed, destroyed
   *  and abandoned. */
  buildingsStarted: number; buildingsCompleted: number; buildingsLost: number; projectsAbandoned: number;
  wondersBegun: number; wondersCompleted: number; wondersDestroyed: number; wondersAbandoned: number;
  /** Roads begun, completed and abandoned (routes); road edges built or improved, bridges built, road edges lost; the
   *  tick the first bridge was built (−1 none yet). */
  roadsBegun: number; roadsBuilt: number; roadsAbandoned: number; roadEdgesBuilt: number; bridgesBuilt: number; roadsLost: number; firstBridgeTick: number;
  /** Droughts begun (anywhere), and famines recorded (one for a polity's regions that fall into famine the same month). */
  droughts: number; famines: number;
  /** Civilizations' famines watched, those whose regions' fields shrank within the years watched, and of those, regrew. */
  faminesWatched: number; fieldsShrank: number; fieldsRegrew: number;
  /** Civilizations that fell into arrears, raised heavy taxes and eased them again (each an event). */
  arrearsBegun: number; taxesRaised: number; taxesEased: number;
  /** Famine relief: food landed and lost on the way (units), wealth paid for carriage, episodes begun (events), and food
   *  the hungry still wanted (units) for lack of treasury or of food to spare within reach. */
  reliefUnits: number; reliefLost: number; reliefCost: number; reliefBegun: number; reliefShortTreasury: number; reliefShortFood: number;
  /** Unions a larger civilization refused only for its budget strain (it would have admitted them unstrained). */
  unionsRefusedForStrain: number;
  /** Civilizations that began to let far regions go unkept (an event). */
  neglectBegun: number;
  /** Cultures that split from another (an event), and of those, from the culture of a civilization's people; regions
   *  whose people took up their realm's ruling culture; hybrid cultures formed; traits earned. */
  cultureSplits: number; civCultureSplits: number; assimilations: number; hybrids: number; traitsEarned: number;
  /** Story health's dominance rule, yearly: years in a row the largest polity has held more than 35% of the world's
   *  people, the longest such run and all such years. */
  dominanceRun: number; longestDominance: number; dominanceYears: number;
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
  /** Per region: hardship (0–1), the memory of hunger — the worst recent shortfall of food, fading over the years. */
  hardship: Float64Array;
  /** Per region: standing harbors in its living settlements (VISION.md: sea crossings start only from a region with one). */
  harbors: Uint8Array;
  /** Every wonder ever begun, in order. */
  wonders: Wonder[];
  /** Standing roads by `roadKey` of their edge, in the order first built. */
  roads: Map<number, Road>;
  /** Per region (VISION.md "Environment"): the weather of its latest harvest (a factor around 1), the factor its last
   *  harvest came in at (the weather times any drought's share, as applied), months of drought left (0: none), famine
   *  deaths over about the last year (a fading sum) and whether it is in a famine now. */
  weather: Float64Array; harvestFactor: Float64Array; drought: Uint8Array; famineRecent: Float64Array; famine: Uint8Array;
  /** Per region: the tick its last recorded famine began (−1 never; a famine there again within a year is the same
   *  famine), and the share of its farm output its fields allowed last month (1 when cleared). */
  famineSince: Int32Array; fieldShare: Float64Array;
  /** Per region, derived from its living settlements' buildings (recomputed whenever they change): the farm yield
   *  multiplier and the share of a drought's loss kept away (irrigation), and the food store limit and spoilage
   *  multipliers (a granary). */
  farmBonus: Float64Array; droughtShield: Float64Array; storeBonus: Float64Array; spoilageBonus: Float64Array;
  /** Per region: cultivated land, as farm labour (people) under cultivation, at most its farmland's (`fields.ts`); and
   *  the fixed ranking of each region's farmland cells that says which cells the fields cover. */
  fields: Float64Array; fieldRanking: FieldRanking;
  /** Civilizations' famines being watched for their regions' fields shrinking and regrowing (VISION.md M3b). */
  famineWatches: { polity: number; regions: number[]; tick: number; before: number; shrunk: number }[];
  /** Per region: every settlement ever founded there (living or in ruins), in founding order; the first living one is
   *  the region's main settlement. */
  regionSettlements: number[][];
  /** Per region: stability (0–1; 1 where no civilization rules) and whether it is in unrest (VISION.md "Stability"),
   *  and its calm as last judged: its stability apart from its realm's taxes and arrears (what taxes can rest on). */
  stability: Float64Array; unrest: Uint8Array; calm: Float64Array;
  /** Per region: its remoteness (travel-km from its owner's capital ÷ governance reach), which its administration
   *  costs follow, and the civilization it was measured for (−1 none); measured at the owner's yearly assessment and in
   *  the month the region joins a realm (`budget.ts`). */
  remoteness: Float64Array; remoteOwner: Int32Array;
  /** Per region: whether its realm lets its buildings, wonders and roads go unkept this year (deferred maintenance,
   *  set at the yearly assessment; 0 where nobody rules). */
  neglected: Uint8Array;
  /** Per region: the tick famine relief last reached it (−1 never, or since its people left); relief again within
   *  RELIEF_TUNING.episodeMonths is the same episode. */
  reliefTick: Int32Array;
  firsts: FirstDiscovery[];
  /** Per lineage, the culture name of its starting band (the observer names peoples by it). */
  lineages: string[];
  /** Year when a quarter of the world's people first lived in polities that know Agriculture (−1 until then). */
  agricultureQuarterYear: number;
  /** Per region: environment conditions that raise research weights (static). */
  affinity: Set<Affinity>[];
  /** Per region: how many farmers and herders it could feed at full game with Neolithic knowledge (static; what a
   *  civilization weighs when it looks for land). */
  landValue: Float64Array;
  /** Per region: how harsh its land is (0–1, static; `culture.ts` `harshLand`), which pulls its people toward Tradition. */
  harshness: Float64Array;
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
