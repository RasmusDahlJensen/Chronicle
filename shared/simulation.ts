import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { WORLD_SIZES } from './generated-world.ts';

/**
 * Versioned contracts between the simulation worker, the host and the observer (docs/VISION.md "Architecture and
 * engineering constraints"). The browser only reads these frames and region maps and sends observer controls.
 */
export const SIMULATION_PROTOCOL_VERSION = 17;
export const SIMULATION_SPEEDS = ['month', 'year', 'decade', 'max'] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];
/** Months simulated per wall-clock second for each preset; `max` runs as fast as the worker can. */
export const SPEED_MONTHS_PER_SECOND: Record<SimulationSpeed, number> = { month: 1, year: 12, decade: 120, max: Number.POSITIVE_INFINITY };
export const MAX_SIMULATION_YEAR = 5000;
export const MAX_FRAME_EVENTS = 200;

/** Settlement tiers by urban population (VISION.md "Settlements"); a settlement's tier is its index here. */
export const SETTLEMENT_TIERS = ['village', 'town', 'city', 'metropolis'] as const;
/** Road tiers by number − 1 (VISION.md "Roads"): road (the Wheel), paved road (Engineering), railway, highway. */
export const ROAD_TIER_NAMES = ['road', 'paved road', 'railway', 'highway'] as const;
/** Era labels (VISION.md "Eras"), indexed by the era numbers in frames; the simulation's tech data uses this list as its eras. */
export const ERA_NAMES = ['Stone', 'Neolithic', 'Bronze', 'Iron', 'Classical', 'Medieval', 'Early modern', 'Industrial', 'Modern', 'Atomic'] as const;

/** The chronicle's event types (VISION.md "The Chronicle"). Append only: ids are stored in event logs. */
export const EVENT_TYPES = [
  'bandSpawned', 'bandMoved', 'bandSplit', 'bandAbsorbed', 'bandJoined', 'settled', 'expansion', 'settlementFounded',
  'settlementTierChanged', 'capitalMoved', 'buildingCompleted', 'wonderBegun', 'wonderCompleted', 'wonderDestroyed',
  'roadBuilt', 'roadAgreement', 'settlementLooted', 'settlementBurned', 'settlementRazed', 'ruinsResettled',
  'infrastructureDestroyed', 'techDiscovered', 'expedition', 'voyageLost', 'newLandsDiscovered', 'firstContact',
  'tradeAgreement', 'nonAggressionPact', 'alliance', 'vassalage', 'treatyCancelled', 'treatyBroken', 'raid',
  'warDeclared', 'battleYear', 'regionConquered', 'peaceSigned', 'rulerSuccession', 'successionCrisis',
  'governmentChange', 'unrest', 'revolt', 'secession', 'civilWar', 'civDestroyed', 'cultureSplit', 'hybridCulture',
  'religionFounded', 'schism', 'stateReligionChanged', 'drought', 'climateShock', 'famine', 'plague', 'migrationWave',
  'refugees', 'knowledgeLost', 'industrialization', 'nuclearUse', 'spaceMilestone', 'bandSpread',
  'unification', 'independenceMovement', 'referendum', 'dissolution', 'knowledgeShared', 'buildingDecayed',
] as const;
export type EventType = typeof EVENT_TYPES[number];

const id = () => Type.Integer({ minimum: 0, maximum: 2 ** 31 - 1 });
export const SimulationControlSchema = Type.Union([
  Type.Object({ action: Type.Literal('play') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('pause') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('step') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('speed'), speed: Type.Enum(SIMULATION_SPEEDS) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('runTo'), year: Type.Integer({ minimum: 0, maximum: MAX_SIMULATION_YEAR }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('reset') }, { additionalProperties: false }),
]);
export type SimulationControl = Static<typeof SimulationControlSchema>;

export const ChronicleEventSchema = Type.Object({
  id: id(), tick: id(), type: Type.Enum(EVENT_TYPES),
  actors: Type.Array(Type.Object({ id: id(), role: Type.String({ maxLength: 32 }) }, { additionalProperties: false }), { maxItems: 16 }),
  region: Type.Union([id(), Type.Null()]), settlement: Type.Union([id(), Type.Null()]),
  causes: Type.Array(Type.Object({ factor: Type.String({ maxLength: 48 }), weight: Type.Number() }, { additionalProperties: false }), { maxItems: 8 }),
  parents: Type.Array(id(), { maxItems: 8 }),
  importance: Type.Number({ minimum: 0, maximum: 1 }),
  data: Type.Record(Type.String({ maxLength: 32 }), Type.Union([Type.String({ maxLength: 120 }), Type.Number(), Type.Boolean()])),
}, { additionalProperties: false });
export type ChronicleEvent = Static<typeof ChronicleEventSchema>;

export const SimulationInstanceSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 160 }), worldKey: Type.String({ minLength: 1, maxLength: 100 }),
  partitionVersion: Type.Integer({ minimum: 1 }), rulesVersion: Type.Integer({ minimum: 1 }),
  seed: Type.String({ minLength: 1, maxLength: 64 }),
  /** Changes whenever a fresh simulation starts at year 0 (new worker, host restart, crash recovery). */
  runId: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });
export type SimulationInstance = Static<typeof SimulationInstanceSchema>;

export const ObserverFrameSchema = Type.Object({
  protocolVersion: Type.Literal(SIMULATION_PROTOCOL_VERSION), instance: SimulationInstanceSchema,
  tick: Type.Integer({ minimum: 0, maximum: MAX_SIMULATION_YEAR * 12 }), playing: Type.Boolean(), speed: Type.Enum(SIMULATION_SPEEDS),
  /** Counts manual resets of this run, so every observer can tell a reset history from a continuing one. */
  epoch: Type.Integer({ minimum: 0 }),
  runTo: Type.Union([Type.Integer({ minimum: 0, maximum: MAX_SIMULATION_YEAR }), Type.Null()]),
  eventCount: Type.Integer({ minimum: 0 }),
  /** Events with id ≥ the requested cursor, oldest first, at most MAX_FRAME_EVENTS (the newest ones when more exist). */
  events: Type.Array(ChronicleEventSchema, { maxItems: MAX_FRAME_EVENTS }),
  counters: Type.Object({ regions: Type.Integer({ minimum: 0 }), landmasses: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
  population: Type.Integer({ minimum: 0 }), polities: Type.Integer({ minimum: 0 }),
  /** Living civilizations, living settlements, specialists and the most advanced era any polity has reached. */
  civs: Type.Integer({ minimum: 0 }), settlementCount: Type.Integer({ minimum: 0 }), specialists: Type.Integer({ minimum: 0 }),
  leadingEra: Type.Integer({ minimum: 0, maximum: ERA_NAMES.length - 1 }),
  /** Peoples by descent: the culture name of each starting band, indexed by lineage. */
  lineages: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 1_000 }),
  /** The largest living polities by population (at most 10), for the map legend. */
  largest: Type.Array(Type.Object({
    id: id(), name: Type.String({ maxLength: 40 }), kind: Type.Union([Type.Literal('band'), Type.Literal('civ')]),
    regions: Type.Integer({ minimum: 1 }), population: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }), { maxItems: 10 }),
  /** Living civilizations by population, at most 100 (the civilization list): regions, people, era and capital. */
  civList: Type.Array(Type.Object({
    id: id(), name: Type.String({ maxLength: 40 }), regions: Type.Integer({ minimum: 1 }), population: Type.Integer({ minimum: 0 }),
    era: Type.Integer({ minimum: 0, maximum: ERA_NAMES.length - 1 }), capital: Type.String({ maxLength: 40 }), capitalCell: id(),
  }, { additionalProperties: false }), { maxItems: 100 }),
  /** Living bands (one per region) as parallel arrays: their polity's id, region, population, the polity's kind (0 tribe / 1 civilization), era index and lineage; for map markers and territories. */
  markers: Type.Object({
    ids: Type.Array(id(), { maxItems: 20_000 }), regions: Type.Array(id(), { maxItems: 20_000 }),
    populations: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 20_000 }),
    kinds: Type.Array(Type.Integer({ minimum: 0, maximum: 1 }), { maxItems: 20_000 }),
    eras: Type.Array(Type.Integer({ minimum: 0, maximum: ERA_NAMES.length - 1 }), { maxItems: 20_000 }),
    lineages: Type.Array(Type.Integer({ minimum: 0, maximum: 999 }), { maxItems: 20_000 }),
  }, { additionalProperties: false }),
  /** Living settlements as parallel arrays (id, cell, owner, capital 0/1, tier index into SETTLEMENT_TIERS, and the
   *  name of a town or larger, or of a capital, else ''), for settlement marks and labels. */
  settlements: Type.Object({
    ids: Type.Array(id(), { maxItems: 50_000 }), cells: Type.Array(id(), { maxItems: 50_000 }),
    owners: Type.Array(id(), { maxItems: 50_000 }), capitals: Type.Array(Type.Integer({ minimum: 0, maximum: 1 }), { maxItems: 50_000 }),
    tiers: Type.Array(Type.Integer({ minimum: 0, maximum: SETTLEMENT_TIERS.length - 1 }), { maxItems: 50_000 }),
    names: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 50_000 }),
    /** What stands there that the map draws at detail zoom: 1 harbor, 2 mine, 4 quarry, 8 a wonder (a bitmask). */
    features: Type.Array(Type.Integer({ minimum: 0, maximum: 15 }), { maxItems: 50_000 }),
  }, { additionalProperties: false }),
  /** Standing roads as parallel arrays, in the order first built: the two regions of the land edge it lies on (the
   *  lower id first), its tier (an index into ROAD_TIER_NAMES plus one: 1 road, 2 paved road, 3 railway, 4 highway) and
   *  whether a bridge carries it over the river there (0/1); for the map's roads and bridges. */
  roads: Type.Object({
    a: Type.Array(id(), { maxItems: 100_000 }), b: Type.Array(id(), { maxItems: 100_000 }),
    tiers: Type.Array(Type.Integer({ minimum: 1, maximum: ROAD_TIER_NAMES.length }), { maxItems: 100_000 }),
    bridges: Type.Array(Type.Integer({ minimum: 0, maximum: 1 }), { maxItems: 100_000 }),
  }, { additionalProperties: false }),
  /** Cultivated land (VISION.md "Cultivated land"), for regions with any: how many of the region's farmland cells, in
   *  the region map's `fieldRank` order, its fields cover (a cell is cultivated when its rank is below the count). */
  fields: Type.Object({
    regions: Type.Array(id(), { maxItems: 65_535 }), cells: Type.Array(Type.Integer({ minimum: 1, maximum: 65_535 }), { maxItems: 65_535 }),
  }, { additionalProperties: false }),
  /** The wonders of the world, standing or being built, oldest first: name, city, the civilization that holds it, the year
   *  begun and the year completed (null while being built). */
  wonders: Type.Array(Type.Object({
    name: Type.String({ maxLength: 40 }), city: Type.String({ maxLength: 40 }), civ: Type.String({ maxLength: 40 }),
    begun: Type.Integer({ minimum: 0 }), built: Type.Union([Type.Null(), Type.Integer({ minimum: 0 })]),
  }, { additionalProperties: false }), { maxItems: 32 }),
  /** [year, world population, living polities] every SERIES_YEARS, for the world chart. */
  series: Type.Array(Type.Tuple([Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 })]), { maxItems: 1_000 }),
  /** Details of the region the observer asked about, or null. */
  inspect: Type.Union([Type.Null(), Type.Object({
    region: id(), capacity: Type.Number({ minimum: 0 }), gameStock: Type.Number({ minimum: 0, maximum: 1 }),
    /** The region's weather (VISION.md "Environment"): the share of its crops its last harvest came in at, months of
     *  drought left (0: none), whether it is in famine, and its irrigation's farm yield multiplier (1: none). */
    weather: Type.Object({
      harvest: Type.Number({ minimum: 0 }), drought: Type.Integer({ minimum: 0 }), famine: Type.Boolean(), irrigation: Type.Number({ minimum: 1 }),
    }, { additionalProperties: false }),
    /** Its cultivated land: the share of its farmland's labour under cultivation (0–1) and the cells it covers. */
    fields: Type.Object({ share: Type.Number({ minimum: 0, maximum: 1 }), cells: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
    /** The region's settlements, living and in ruins, main one first: tier, townspeople, housing, founding tick, the
     *  name its ruins bore if resettled under a new one, and its latest chronicle events (the settlement inspector). */
    settlements: Type.Array(Type.Object({
      id: id(), name: Type.String({ maxLength: 40 }), tier: Type.Integer({ minimum: 0, maximum: SETTLEMENT_TIERS.length - 1 }),
      urban: Type.Integer({ minimum: 0 }), housing: Type.Integer({ minimum: 0 }), capital: Type.Boolean(), founded: Type.Integer({ minimum: 0 }),
      status: Type.Union([Type.Literal('alive'), Type.Literal('ruined'), Type.Literal('razed')]), formerName: Type.Union([Type.Null(), Type.String({ maxLength: 40 })]),
      owner: Type.Union([Type.Null(), Type.String({ maxLength: 40 })]),
      /** Its standing buildings with their condition (0–1), and those under construction with the share paid. */
      buildings: Type.Array(Type.Object({ name: Type.String({ maxLength: 40 }), condition: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }), { maxItems: 32 }),
      building: Type.Array(Type.Object({ name: Type.String({ maxLength: 40 }), progress: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }), { maxItems: 32 }),
      /** The wonder standing there, or being built there (with the share paid), if any. */
      wonder: Type.Union([Type.Null(), Type.Object({ name: Type.String({ maxLength: 40 }), standing: Type.Boolean(), progress: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false })]),
      events: Type.Array(ChronicleEventSchema, { maxItems: 6 }),
    }, { additionalProperties: false }), { maxItems: 16 }),
    food: Type.Object({
      forage: Type.Number({ minimum: 0 }), hunt: Type.Number({ minimum: 0 }), fish: Type.Number({ minimum: 0 }),
      herd: Type.Number({ minimum: 0 }), farm: Type.Number({ minimum: 0 }),
    }, { additionalProperties: false }),
    polity: Type.Union([Type.Null(), Type.Object({
      id: id(), kind: Type.Union([Type.Literal('band'), Type.Literal('civ')]), name: Type.String({ maxLength: 40 }), culture: Type.String({ maxLength: 40 }),
      /** Regions the polity holds (its bands) and its people in all of them; the other numbers below are this region's band. */
      regions: Type.Integer({ minimum: 1 }), totalPopulation: Type.Integer({ minimum: 0 }),
      /** The founding people it descends from (the culture name of its starting band). */
      lineage: Type.String({ maxLength: 40 }),
      population: Type.Integer({ minimum: 0 }),
      birthsThisYear: Type.Integer({ minimum: 0 }), deathsThisYear: Type.Integer({ minimum: 0 }),
      birthsLastYear: Type.Integer({ minimum: 0 }), deathsLastYear: Type.Integer({ minimum: 0 }),
      foodSecurity: Type.Number({ minimum: 0 }), foodStoreMonths: Type.Number({ minimum: 0 }), cropsMonths: Type.Number({ minimum: 0 }),
      founded: Type.Integer({ minimum: 0 }), arrived: Type.Integer({ minimum: 0 }),
      /** Share of food from farming and herding, people freed as specialists, and the capital village of a civilization. */
      farmShare: Type.Number({ minimum: 0, maximum: 1 }), specialists: Type.Integer({ minimum: 0 }),
      capital: Type.Union([Type.Null(), Type.Object({ name: Type.String({ maxLength: 40 }), cell: id(), settled: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })]),
      era: Type.Integer({ minimum: 0, maximum: ERA_NAMES.length - 1 }),
      /** Known techs in graph order; research points a year; contacts within two regions. */
      known: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 200 }), researchPerYear: Type.Number({ minimum: 0 }), contacts: Type.Integer({ minimum: 0 }),
      /** Its map: regions it knows (in sight or remembered), regions in sight, and polities it has met. */
      regionsKnown: Type.Integer({ minimum: 1 }), regionsInSight: Type.Integer({ minimum: 1 }), met: Type.Integer({ minimum: 0 }),
      /** Governance reach in travel-km, and this region's travel-km from the capital (null when cut off from it). */
      reachKm: Type.Number({ minimum: 0 }), capitalKm: Type.Union([Type.Null(), Type.Number({ minimum: 0 })]),
      /** A civilization region's stability (0–1, as last assessed), whether it is in unrest, and what lowers it now. */
      stability: Type.Union([Type.Null(), Type.Object({
        value: Type.Number({ minimum: 0, maximum: 1 }), unrest: Type.Boolean(),
        hunger: Type.Number({ minimum: 0 }), overextension: Type.Number({ minimum: 0 }), foreignRule: Type.Number({ minimum: 0 }),
      }, { additionalProperties: false })]),
      /** Its last decision step: the strongest options (best first) with their scores and factors, what it chose (its
       *  action, and its index among the options: the chosen option is always among the best three) and what came of it. */
      lastDecision: Type.Union([Type.Null(), Type.Object({
        tick: Type.Integer({ minimum: 0 }), chosen: Type.Union([Type.Literal('expand'), Type.Literal('explore'), Type.Literal('nothing'), Type.Literal('unite'), Type.Literal('share'), Type.Literal('build')]),
        pick: Type.Integer({ minimum: 0, maximum: 3 }),
        outcome: Type.String({ maxLength: 80 }),
        options: Type.Array(Type.Object({
          action: Type.Union([Type.Literal('expand'), Type.Literal('explore'), Type.Literal('nothing'), Type.Literal('unite'), Type.Literal('share'), Type.Literal('build')]), score: Type.Number(),
          /** The region to expand into, the civilization to unite or share knowledge with (and that people's name), or for
           *  Build the building type, the wonder type or the road tier (and what is built where, as the label). */
          target: Type.Union([Type.Null(), id()]), label: Type.Union([Type.Null(), Type.String({ maxLength: 40 })]),
          factors: Type.Array(Type.Object({ factor: Type.String({ maxLength: 48 }), weight: Type.Number() }, { additionalProperties: false }), { maxItems: 8 }),
        }, { additionalProperties: false }), { maxItems: 4 }),
      }, { additionalProperties: false })]),
      /** A civilization's treasury, its income and upkeep a year, and its buildings and roads under construction (null for a tribe). */
      wealth: Type.Union([Type.Null(), Type.Object({
        treasury: Type.Integer({ minimum: 0 }), income: Type.Number({ minimum: 0 }), upkeep: Type.Number({ minimum: 0 }), projects: Type.Integer({ minimum: 0 }),
        roadWorks: Type.Integer({ minimum: 0 }),
      }, { additionalProperties: false })]),
      /** Peoples it shares knowledge with (VISION.md "Sharing knowledge") and the year each exchange ends. */
      exchanges: Type.Array(Type.Object({ id: id(), name: Type.String({ maxLength: 40 }), until: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }), { maxItems: 64 }),
      /** The active research target, its progress and cost, why it was chosen, and the strongest options at the last
       *  choice; how much faster it goes now: the sharing partner that knows it (its name, else null) and that speed-up,
       *  and the catch-up speed-up (1 when none applies). */
      research: Type.Union([Type.Null(), Type.Object({
        tech: Type.String({ maxLength: 40 }), progress: Type.Number({ minimum: 0 }), cost: Type.Number({ minimum: 0 }),
        sharedBy: Type.Union([Type.Null(), Type.String({ maxLength: 40 })]), shareSpeed: Type.Number({ minimum: 1 }), catchUp: Type.Number({ minimum: 1 }),
        reasons: Type.Array(Type.Object({ factor: Type.String({ maxLength: 48 }), weight: Type.Number() }, { additionalProperties: false }), { maxItems: 8 }),
        candidates: Type.Array(Type.Object({ tech: Type.String({ maxLength: 40 }), weight: Type.Number({ minimum: 0 }) }, { additionalProperties: false }), { maxItems: 8 }),
      }, { additionalProperties: false })]),
    }, { additionalProperties: false })]),
  }, { additionalProperties: false })]),
}, { additionalProperties: false });
export type ObserverFrame = Static<typeof ObserverFrameSchema>;

export const RegionSummarySchema = Type.Object({
  id: id(), landmass: id(), cells: Type.Integer({ minimum: 1 }), areaKm2: Type.Number({ minimum: 0 }),
  centroid: id(), island: Type.Boolean(), coastal: Type.Boolean(), openLake: Type.Boolean(),
  riverTier: Type.Integer({ minimum: 0, maximum: 3 }), neighbors: Type.Array(id(), { maxItems: 64 }),
}, { additionalProperties: false });
export type RegionSummary = Static<typeof RegionSummarySchema>;
export const RegionMapSchema = Type.Object({
  protocolVersion: Type.Literal(SIMULATION_PROTOCOL_VERSION), worldKey: Type.String({ minLength: 1, maxLength: 100 }),
  partitionVersion: Type.Integer({ minimum: 1 }),
  width: Type.Integer({ minimum: 512, maximum: 1024 }), height: Type.Integer({ minimum: 256, maximum: 512 }),
  /** Row-major region id + 1 per cell as little-endian uint16, base64; 0 is water. */
  encoding: Type.Literal('region-u16le'), data: Type.String({ minLength: 1, maxLength: 1_400_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }),
  /** Row-major rank of each cell within its region's farmland (best farmland nearest the region's best settlement site
   *  first) as little-endian uint16, base64; 65535 for no farmland. Frames say how many of each region's are cultivated. */
  fieldRank: Type.String({ minLength: 1, maxLength: 1_400_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }),
  regions: Type.Array(RegionSummarySchema, { maxItems: 65535 }),
}, { additionalProperties: false });
export type RegionMap = Static<typeof RegionMapSchema>;

export const RIVER_TIERS = ['none', 'stream', 'river', 'greatRiver'] as const;

export function simulationDate(tick: number) { return { year: Math.floor(tick / 12), month: tick % 12 + 1 }; }

const invalid = () => new Error('The simulation response was invalid. Try again.');
export function parseObserverFrame(value: unknown): ObserverFrame {
  if (!Check(ObserverFrameSchema, value)) throw invalid();
  const frame = value as ObserverFrame;
  for (let at = 1; at < frame.events.length; at++) if (frame.events[at].id <= frame.events[at - 1].id) throw invalid();
  if (frame.events.some(event => event.id >= frame.eventCount || event.tick > frame.tick)) throw invalid();
  const { ids, regions, populations, kinds, eras, lineages } = frame.markers;
  if ([regions, populations, kinds, eras, lineages].some(array => array.length !== ids.length)) throw invalid();
  if (lineages.some(lineage => lineage >= frame.lineages.length)) throw invalid();
  const settlements = frame.settlements;
  if ([settlements.cells, settlements.owners, settlements.capitals, settlements.tiers, settlements.names, settlements.features].some(array => array.length !== settlements.ids.length)) throw invalid();
  // One marker per region; all of a polity's markers agree on its kind.
  const civs = new Set<number>(), polities = new Set(ids), kindOf = new Map<number, number>();
  if (new Set(regions).size !== regions.length) throw invalid();
  ids.forEach((polity, index) => {
    if ((kindOf.get(polity) ?? kinds[index]) !== kinds[index]) throw invalid();
    kindOf.set(polity, kinds[index]);
    if (kinds[index] === 1) civs.add(polity);
  });
  if (polities.size !== frame.polities || frame.civs > frame.polities || civs.size !== frame.civs) throw invalid();
  // The civilization list holds the largest living civilizations, by people, with the regions and people they report.
  if (frame.civList.length !== Math.min(frame.civs, 100) || new Set(frame.civList.map(entry => entry.id)).size !== frame.civList.length) throw invalid();
  for (const [at, entry] of frame.civList.entries()) {
    let held = 0, people = 0;
    ids.forEach((polity, index) => { if (polity === entry.id) { held++; people += populations[index]; } });
    if (!civs.has(entry.id) || held !== entry.regions || people !== entry.population || (at > 0 && entry.population > frame.civList[at - 1].population)) throw invalid();
  }
  // The legend's polities are living, with exactly the regions and people their bands report.
  for (const entry of frame.largest) {
    let held = 0, people = 0;
    ids.forEach((polity, index) => { if (polity === entry.id) { held++; people += populations[index]; } });
    if (held !== entry.regions || people !== entry.population || (entry.kind === 'civ') !== civs.has(entry.id)) throw invalid();
  }
  if (settlements.ids.length !== frame.settlementCount || eras.some(era => era > frame.leadingEra)) throw invalid();
  // Each road lies on an edge between two regions of this world, named once, lower id first.
  const roads = frame.roads, edges = new Set<string>();
  if ([roads.b, roads.tiers, roads.bridges].some(array => array.length !== roads.a.length)) throw invalid();
  roads.a.forEach((a, index) => {
    const b = roads.b[index], key = `${a},${b}`;
    if (a >= b || b >= frame.counters.regions || edges.has(key)) throw invalid();
    edges.add(key);
  });
  // Cultivated land: regions of this world, each once.
  if (frame.fields.cells.length !== frame.fields.regions.length || new Set(frame.fields.regions).size !== frame.fields.regions.length || frame.fields.regions.some(region => region >= frame.counters.regions)) throw invalid();
  const decision = frame.inspect?.polity?.lastDecision;
  if (decision && (decision.pick >= decision.options.length || decision.options[decision.pick].action !== decision.chosen)) throw invalid();
  if (frame.inspect && frame.inspect.region >= frame.counters.regions) throw invalid();
  if (frame.series.some(([year], at) => year * 12 > frame.tick || (at > 0 && year <= frame.series[at - 1][0]))) throw invalid();
  return frame;
}

/** Validate the region map and decode its cell index (region id + 1, 0 for water) and each cell's farmland rank. */
export function parseRegionMap(value: unknown): { map: RegionMap; cells: Uint16Array; fieldRank: Uint16Array } {
  if (!Check(RegionMapSchema, value)) throw invalid();
  const map = value as RegionMap;
  const shape = Object.values(WORLD_SIZES).find(size => size.width === map.width && size.height === map.height);
  if (!shape) throw invalid();
  const count = map.width * map.height;
  const bytes = atob(map.data);
  if (bytes.length !== count * 2) throw invalid();
  const cells = new Uint16Array(count), sizes = new Uint32Array(map.regions.length);
  for (let cell = 0; cell < count; cell++) {
    const value = bytes.charCodeAt(cell * 2) | (bytes.charCodeAt(cell * 2 + 1) << 8);
    if (value > map.regions.length) throw invalid();
    cells[cell] = value;
    if (value) sizes[value - 1]++;
  }
  for (const [index, region] of map.regions.entries()) {
    if (region.id !== index || sizes[index] !== region.cells || cells[region.centroid] !== index + 1) throw invalid();
    if (region.neighbors.some(other => other >= map.regions.length || other === index)) throw invalid();
  }
  // Farmland ranks: none on water; within each region 0, 1, … with no gaps or repeats.
  const ranks = atob(map.fieldRank);
  if (ranks.length !== count * 2) throw invalid();
  const fieldRank = new Uint16Array(count), offsets = new Uint32Array(map.regions.length + 1), farmland = new Uint32Array(map.regions.length);
  for (const [index, region] of map.regions.entries()) offsets[index + 1] = offsets[index] + region.cells;
  const taken = new Uint8Array(offsets[map.regions.length]);
  for (let cell = 0; cell < count; cell++) {
    const rank = ranks.charCodeAt(cell * 2) | (ranks.charCodeAt(cell * 2 + 1) << 8);
    fieldRank[cell] = rank;
    if (rank === 0xffff) continue;
    const region = cells[cell] - 1;
    if (region < 0 || rank >= map.regions[region].cells || taken[offsets[region] + rank]) throw invalid();
    taken[offsets[region] + rank] = 1; farmland[region]++;
  }
  for (let index = 0; index < map.regions.length; index++) for (let rank = 0; rank < farmland[index]; rank++) if (!taken[offsets[index] + rank]) throw invalid();
  return { map, cells, fieldRank };
}

/** M2 facts in the worker's study report (VISION.md M2 acceptance): firsts, where Agriculture began, when a quarter of the world's people lived in polities that knew it. */
export interface KnowledgeReport {
  firsts: { tech: string; era: string; year: number; region: number }[];
  /** First year any polity reached each era. */
  eras: { era: string; year: number }[];
  agriculture: null | { year: number; region: number; topQuartile: boolean; riverTier: number; openLake: boolean };
  agricultureQuarterYear: number;
}

/** M3 facts for the study (VISION.md M3 acceptance): each living civilization's longest gap between expansions. */
export interface PoliticsReport {
  /** Years, one per living civilization, in id order. */
  longestExpansionGaps: number[];
}

/** Messages between the host and its simulation worker (structured clone, same process). */
export type SimulationRequest =
  | { kind: 'frame'; id: number; cursor: number; inspect?: number }
  | { kind: 'control'; id: number; control: SimulationControl; cursor: number; inspect?: number }
  | { kind: 'regions'; id: number }
  | { kind: 'report'; id: number; events: boolean };
export type SimulationReply =
  | { kind: 'ready'; instance: SimulationInstance; setupMs: number }
  | { kind: 'reply'; id: number; ok: true; body: unknown }
  | { kind: 'reply'; id: number; ok: false; message: string }
  /** A run to a year ended, at the target or because a control interrupted it. */
  | { kind: 'arrived'; tick: number }
  | { kind: 'failed'; message: string };
export interface SimulationInit { manifest: string; tiles: string[]; seed: string; runId: string }
