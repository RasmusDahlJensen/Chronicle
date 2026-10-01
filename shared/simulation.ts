import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { WORLD_SIZES } from './generated-world.ts';

/**
 * Versioned contracts between the simulation worker, the host and the observer (docs/VISION.md "Architecture and
 * engineering constraints"). The browser only reads these frames and region maps and sends observer controls.
 */
export const SIMULATION_PROTOCOL_VERSION = 2;
export const SIMULATION_SPEEDS = ['month', 'year', 'decade', 'max'] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];
/** Months simulated per wall-clock second for each preset; `max` runs as fast as the worker can. */
export const SPEED_MONTHS_PER_SECOND: Record<SimulationSpeed, number> = { month: 1, year: 12, decade: 120, max: Number.POSITIVE_INFINITY };
export const MAX_SIMULATION_YEAR = 5000;
export const MAX_FRAME_EVENTS = 200;

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
  'refugees', 'knowledgeLost', 'industrialization', 'nuclearUse', 'spaceMilestone',
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
  /** Living bands as parallel arrays (id, region, population), for map markers. */
  bands: Type.Object({
    ids: Type.Array(id(), { maxItems: 20_000 }), regions: Type.Array(id(), { maxItems: 20_000 }),
    populations: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 20_000 }),
  }, { additionalProperties: false }),
  /** [year, world population, living polities] every SERIES_YEARS, for the world chart. */
  series: Type.Array(Type.Tuple([Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 })]), { maxItems: 1_000 }),
  /** Details of the region the observer asked about, or null. */
  inspect: Type.Union([Type.Null(), Type.Object({
    region: id(), capacity: Type.Number({ minimum: 0 }), gameStock: Type.Number({ minimum: 0, maximum: 1 }),
    food: Type.Object({ forage: Type.Number({ minimum: 0 }), hunt: Type.Number({ minimum: 0 }), fish: Type.Number({ minimum: 0 }) }, { additionalProperties: false }),
    band: Type.Union([Type.Null(), Type.Object({
      id: id(), name: Type.String({ maxLength: 40 }), culture: Type.String({ maxLength: 40 }), population: Type.Integer({ minimum: 0 }),
      birthsThisYear: Type.Integer({ minimum: 0 }), deathsThisYear: Type.Integer({ minimum: 0 }),
      birthsLastYear: Type.Integer({ minimum: 0 }), deathsLastYear: Type.Integer({ minimum: 0 }),
      foodSecurity: Type.Number({ minimum: 0 }), foodStoreMonths: Type.Number({ minimum: 0 }), founded: Type.Integer({ minimum: 0 }),
      arrived: Type.Integer({ minimum: 0 }),
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
  const { ids, regions, populations } = frame.bands;
  if (ids.length !== regions.length || ids.length !== populations.length) throw invalid();
  if (frame.series.some(([year], at) => year * 12 > frame.tick || (at > 0 && year <= frame.series[at - 1][0]))) throw invalid();
  return frame;
}

/** Validate the region map and decode its cell index (region id + 1, 0 for water). */
export function parseRegionMap(value: unknown): { map: RegionMap; cells: Uint16Array } {
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
  return { map, cells };
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
