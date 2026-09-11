import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import { WorldSettingsSchema, WORLD_SIZES, worldKey, decodeWorldSurface, WORLD_BIOMES, type WorldManifest } from './generated-world.ts';
import { CountryAISchema } from './country-ai.ts';
import { SettlementStateSchema } from './settlements.ts';
import { isFoundingBiome } from './civilization.ts';

export const SIMULATION_PROTOCOL_VERSION = 4;
export const SIMULATION_RULES_VERSION = 3;
export const INITIAL_TRIBE_POPULATION = 250;
export const DAYS_PER_YEAR = 360;
export const DAYS_PER_MONTH = 30;
export const MAX_SIMULATION_BYTES = 8 * 1024 * 1024;
const uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 });
export const SimulationStateSchema = Type.Object({
  protocolVersion: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(SIMULATION_PROTOCOL_VERSION)]), rulesVersion: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(SIMULATION_RULES_VERSION)]),
  settlements: Type.Optional(SettlementStateSchema), ai: Type.Optional(CountryAISchema),
  clockMode: Type.Optional(Type.Literal('monthly')),
  spawnOriginCellId: Type.Optional(Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 524287 })])),
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
  clockMode: Type.Optional(Type.Literal('monthly')),
  originCellId: Type.Optional(Type.Integer({ minimum: 0, maximum: 524287 })),
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
  if ((value.protocolVersion >= 3 ? value.rulesVersion !== (value.protocolVersion === 4 ? 3 : 2) || value.clockMode !== 'monthly' || value.spawnOriginCellId === undefined
    || value.speed !== 1 || value.spawnOriginCellId !== null && (value.spawnOriginCellId >= WORLD_SIZES[value.settings.size].width * WORLD_SIZES[value.settings.size].height
      || value.spawnOriginCellId !== value.settlements?.initialCellId)
    : value.protocolVersion !== value.rulesVersion || value.clockMode !== undefined || value.spawnOriginCellId !== undefined)
    || (value.rulesVersion >= 2) !== Boolean(value.settlements) || (value.rulesVersion === 3) !== Boolean(value.ai)) throw new Error('The tribal save is invalid. The saved data has been preserved.');
  if (value.settlements) {
    const sim = value.settlements, cells = WORLD_SIZES[value.settings.size].width * WORLD_SIZES[value.settings.size].height;
    const ids = new Set<string>(), claimed = new Set<number>();
    let population = 0, food = 0;
    for (const center of sim.centers) {
      if (ids.has(center.id) || center.cellId >= cells || !center.territory.includes(center.cellId)
        || center.foundedDay > value.elapsedDays || center.prosperousDays > value.elapsedDays - center.foundedDay
        || center.territoryLastWorked.length !== center.territory.length || center.territoryLastWorked.some(day => day > value.elapsedDays)
        || center.prospectCellId !== null && center.prospectCellId >= cells || center.foundingCellId !== null && center.foundingCellId >= cells
        || new Set(center.workingCells).size !== center.workingCells.length || center.workingCells.some(id => id >= cells)) throw new Error('Invalid settlement checkpoint; saved data has been preserved.');
      ids.add(center.id); population += center.population; food += center.food;
      for (const id of center.territory) { if (id >= cells || claimed.has(id)) throw new Error('Invalid territorial accounting; saved data has been preserved.'); claimed.add(id); }
    }
    if (sim.startedDay > value.elapsedDays || sim.totalConsumed + sim.totalShortfall !== (value.elapsedDays-sim.startedDay)*250
      || sim.history.some(event => event.day > value.elapsedDays || event.cellId >= cells || !ids.has(event.settlementId))
      || population !== value.tribe.population || !ids.has(sim.mainSettlementId) || sim.initialCellId >= cells
      || sim.centers.find(c => c.id === sim.mainSettlementId)!.cellId !== value.tribe.originCellId
      || food !== 250 * 30 + sim.totalCollected - sim.totalConsumed - sim.establishmentSpent
      || sim.centers.some(c => Number(c.id.slice(11)) >= sim.nextSettlementId)) throw new Error('Invalid settlement accounting; saved data has been preserved.');
  }
  if (value.ai) {
    const ai=value.ai, centers=value.settlements!.centers;
    const cells=WORLD_SIZES[value.settings.size].width*WORLD_SIZES[value.settings.size].height;
    const ids=new Set<string>();
    if (ai.historySeed!==value.placementSeed || ai.rngState.every(n=>n===0)
      || ai.history.some(e=>e.day>value.elapsedDays || !centers.some(c=>c.id===e.settlementId))) throw new Error('Invalid country AI checkpoint; saved data has been preserved.');
    for (const d of ai.decisions) {
      const center=centers.find(c=>c.id===d.settlementId);
      if (!center || ids.has(d.settlementId) || d.sinceDay>value.elapsedDays || d.reviewDay<=value.elapsedDays
        || d.reviewDay>value.elapsedDays+90 || d.reservedFood>center.food || d.reservedPeople>=center.population
        || (d.goal==='consolidate') !== (d.targetCellId===null) || d.targetCellId!==null && d.targetCellId>=cells
        || d.goal!=='found' && d.reservedPeople!==0 || d.goal==='found' && d.reservedPeople!==80
        || (d.goal==='consolidate' || d.goal==='expand') && d.reservedFood!==0
        || d.goal==='found' && d.reservedFood<2400 || d.goal==='relocate' && d.reservedFood<center.population*2
        || d.alternatives.some(a=>a.targetCellId!==null && a.targetCellId>=cells)
        || !d.alternatives.some(a=>a.eligible && a.goal===d.goal && a.targetCellId===d.targetCellId)) throw new Error('Invalid country AI commitment; saved data has been preserved.');
      const duration=value.elapsedDays-d.sinceDay+1;
      if (d.goal==='found' ? center.foundingCellId!==d.targetCellId || center.foundingDays<1 || center.foundingDays>duration || center.prospectCellId!==null || center.prospectDays!==0
        : d.goal==='expand' || d.goal==='relocate' ? center.prospectCellId!==d.targetCellId || center.prospectDays<1 || center.prospectDays>duration || center.foundingCellId!==null || center.foundingDays!==0
        : center.foundingCellId!==null || center.foundingDays!==0 || center.prospectCellId!==null || center.prospectDays!==0) throw new Error('Invalid country AI project progress; saved data has been preserved.');
      ids.add(d.settlementId);
    }
    if (centers.some(c=>!ids.has(c.id) && (c.foundingDays!==0 || c.foundingCellId!==null || c.prospectDays!==0 || c.prospectCellId!==null))) throw new Error('Orphaned country AI project; saved data has been preserved.');
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
    if (state.settlements) for (const center of state.settlements.centers) {
      if (!isFoundingBiome(WORLD_BIOMES[surface.biome[center.cellId]]) || surface.elevation[center.cellId] < 0
        || [...center.territory,...center.workingCells].some(id => surface.elevation[id] < 0
          || ['ocean','coast','seaIce','lake','lakeIce','snow','mountain'].includes(WORLD_BIOMES[surface.biome[id]]))) throw new Error('Settlement territory is outside suitable land.');
    }
  }
  return value;
}
export function simulationDate(elapsedDays: number) {
  return { day: elapsedDays % DAYS_PER_YEAR + 1, year: Math.floor(elapsedDays / DAYS_PER_YEAR) + 1 };
}
