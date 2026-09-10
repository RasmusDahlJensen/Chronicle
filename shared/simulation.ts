import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { WorldSettingsSchema, WORLD_SIZES, worldKey, decodeWorldSurface, WORLD_BIOMES, type WorldManifest } from './generated-world.ts';
import { isFoundingBiome } from './civilization.ts';

export const SIMULATION_PROTOCOL_VERSION = 1;
export const SIMULATION_RULES_VERSION = 1;
export const INITIAL_TRIBE_POPULATION = 250;
export const DAYS_PER_YEAR = 360;
export const MAX_SIMULATION_BYTES = 16 * 1024;
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
export const SimulationStateSchema = Type.Object({
  protocolVersion: Type.Literal(SIMULATION_PROTOCOL_VERSION), rulesVersion: Type.Literal(SIMULATION_RULES_VERSION),
  id: uuid, incarnation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 100 }), revision: counter,
  worldKey: Type.String({ minLength: 1, maxLength: 100 }), settings: WorldSettingsSchema,
  placementSeed: Type.String({ minLength: 1, maxLength: 64 }),
  tribe: Type.Object({
    id: Type.Literal('civilization-1'), name: Type.String({ minLength: 2, maxLength: 48, pattern: '^[A-Z][a-z]+$' }),
    color: Type.String({ pattern: '^#[0-9a-f]{6}$' }), originCellId: Type.Integer({ minimum: 0, maximum: 524287 }),
    population: Type.Literal(INITIAL_TRIBE_POPULATION),
  }, { additionalProperties: false }),
  elapsedDays: counter, rngState: Type.Integer({ minimum: 1, maximum: 4294967295 }),
  running: Type.Boolean(), speed: Type.Union([Type.Literal(1), Type.Literal(10)]),
}, { additionalProperties: false });
export type SimulationState = Static<typeof SimulationStateSchema>;
export const SimulationViewSchema = Type.Object({
  state: SimulationStateSchema, active: Type.Boolean(), error: Type.Union([Type.Null(), Type.String({ maxLength: 256 })]),
}, { additionalProperties: false });
export type SimulationView = Static<typeof SimulationViewSchema>;
export const SimulationObserveSchema = Type.Object({ instanceId: uuid, observerId: uuid }, { additionalProperties: false });
export type SimulationObserve = Static<typeof SimulationObserveSchema>;
export const SimulationOpenSchema = Type.Object({ ...SimulationObserveSchema.properties, settings: WorldSettingsSchema,
  placementSeed: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });
export type SimulationOpen = Static<typeof SimulationOpenSchema>;
export const SimulationCommandSchema = Type.Object({ ...SimulationObserveSchema.properties,
  incarnation: SimulationStateSchema.properties.incarnation, revision: counter,
  action: Type.Enum(['play', 'pause', 'step', 'reset', 'speed']),
  days: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(30)])),
  speed: Type.Optional(SimulationStateSchema.properties.speed),
}, { additionalProperties: false });
export type SimulationCommand = Static<typeof SimulationCommandSchema>;

/** Checkpoints fail closed; incompatible rules require an explicit migration. */
export function parseSimulationState(value: unknown): SimulationState {
  if (!Check(SimulationStateSchema, value) || value.worldKey !== worldKey(value.settings)
    || value.tribe.originCellId >= WORLD_SIZES[value.settings.size].width * WORLD_SIZES[value.settings.size].height) {
    throw new Error('The tribal save is invalid or uses unsupported rules. The saved data has been preserved.');
  }
  return value;
}
export function parseSimulationView(value: unknown, world?: WorldManifest): SimulationView {
  if (!Check(SimulationViewSchema, value)) throw new Error('The tribal response was invalid. Retry loading the tribe.');
  const state = parseSimulationState(value.state);
  if (value.active && (!state.running || value.error !== null)) throw new Error('The tribal response has an invalid clock status.');
  if (world) {
    if (state.worldKey !== world.worldKey) throw new Error('The tribal response belongs to a different world.');
    const surface = decodeWorldSurface(world.surface), id = state.tribe.originCellId;
    if (!isFoundingBiome(WORLD_BIOMES[surface.biome[id]]) || surface.elevation[id] < 0) {
      throw new Error('The tribal camp is outside suitable land.');
    }
  }
  return value;
}
export function simulationDate(elapsedDays: number) {
  return { day: elapsedDays % DAYS_PER_YEAR + 1, year: Math.floor(elapsedDays / DAYS_PER_YEAR) + 1 };
}
