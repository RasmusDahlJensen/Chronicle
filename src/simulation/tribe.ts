import { initialCountryAI } from './country-ai.ts';
import { createSpawnIdentity } from '../world/civilization.ts';
import { initialSettlements, advanceSettlements } from './settlements.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { isSuitableCivilizationSite, CIVILIZATION_SITE_RULES, type CivilizationSnapshot } from '../../shared/civilization.ts';
import { WORLD_BIOMES, WORLD_SIZES, WORLD_TILE_SIZE, worldKey, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';
import { INITIAL_TRIBE_POPULATION, SIMULATION_PROTOCOL_VERSION, SIMULATION_RULES_VERSION, parseSimulationState, type SimulationState } from '../../shared/simulation.ts';
import { hashNoise, seedNumber } from '../world/generation/noise.ts';

export const TRIBE_START_RULES = CIVILIZATION_SITE_RULES;
export class UnsuitableSpawnError extends Error {}
const initialRng = (key: string, placementSeed: string) => seedNumber(`${key}:${placementSeed}:living`) || 1;

/** The transport owns validation of full tiles; the core checks complete, unique geography coverage. */
export function createTribeState(instanceId: string, placementSeed: string, world: WorldManifest,
  civilization: CivilizationSnapshot, tiles: WorldTile[], options: { clockMode?: 'monthly'; originCellId?: number } = {}): SimulationState {
  if (options.originCellId !== undefined && (options.clockMode !== 'monthly' || !Number.isInteger(options.originCellId) || options.originCellId < 0)) throw new UnsuitableSpawnError('Choose a suitable start cell.');
  const shape = WORLD_SIZES[world.settings.size], columns = shape.width / WORLD_TILE_SIZE;
  if (world.worldKey !== worldKey(world.settings) || civilization.worldKey !== world.worldKey
    || world.width !== shape.width || world.height !== shape.height
    || tiles.length !== shape.width * shape.height / WORLD_TILE_SIZE ** 2) throw new Error('Tribal geography does not match its world.');
  const seen = new Set<number>(), seed = seedNumber(`${world.worldKey}:${placementSeed}:placement`);
  let originCellId = -1, bestHash = Infinity;
  for (const tile of tiles) {
    const key = tile.y * columns + tile.x;
    if (tile.worldKey !== world.worldKey || tile.x < 0 || tile.x >= columns || tile.y < 0 || tile.y >= shape.height / WORLD_TILE_SIZE
      || seen.has(key) || tile.width !== WORLD_TILE_SIZE || tile.height !== WORLD_TILE_SIZE
      || Object.values(tile.fields).some(field => field.length !== WORLD_TILE_SIZE ** 2)) throw new Error('Tribal geography has invalid or duplicate tiles.');
    seen.add(key);
    const { fields } = tile;
    for (let at = 0; at < WORLD_TILE_SIZE ** 2; at++) {
      if (!isSuitableCivilizationSite({ biome: WORLD_BIOMES[fields.biome[at]], elevation: fields.elevation[at],
        fertility: fields.fertility[at], temperature: fields.temperature[at] / 10 })) continue;
      const x = tile.x * WORLD_TILE_SIZE + at % WORLD_TILE_SIZE;
      const y = tile.y * WORLD_TILE_SIZE + Math.floor(at / WORLD_TILE_SIZE), id = y * shape.width + x;
      if (options.originCellId !== undefined && id !== options.originCellId) continue;
      const score = hashNoise(x, y, seed);
      if (score < bestHash || score === bestHash && id < originCellId) { originCellId = id; bestHash = score; }
    }
  }
  const identity = options.clockMode === 'monthly' ? createSpawnIdentity(placementSeed) : civilization.civilizations[0];
  if (originCellId < 0 || !identity) throw new UnsuitableSpawnError(options.originCellId === undefined
    ? 'This world has no suitable land for a civilization.' : 'Choose suitable land: a habitable biome, fertility at least 25 and temperature at least 5°C.');
  return parseSimulationState({
    protocolVersion: options.clockMode === 'monthly' ? SIMULATION_PROTOCOL_VERSION : 2,
    ...(options.clockMode === 'monthly' ? { clockMode: 'monthly', spawnOriginCellId: options.originCellId ?? null, ai: initialCountryAI(placementSeed) } : {}), rulesVersion: options.clockMode === 'monthly' ? SIMULATION_RULES_VERSION : 2,
    id: instanceId, incarnation: 1, revision: 0, worldKey: world.worldKey, settings: { ...world.settings }, placementSeed,
    tribe: { ...identity, originCellId, population: INITIAL_TRIBE_POPULATION },
    settlements: initialSettlements(identity.name, originCellId),
    elapsedDays: 0, rngState: initialRng(world.worldKey, placementSeed), running: false, speed: 1,
  });
}

/** Every caller executes the same daily steps. Control speed and wall time are host concerns. */
export function advanceTribeDays(state: SimulationState, days: number, environment?: SettlementEnvironment): SimulationState {
  parseSimulationState(state);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Advance between 1 and 30 whole days per batch.');
  if (state.settlements && !environment) throw new Error('Settlement geography is required to advance this save.');
  const next = structuredClone(state);
  for (let day = 0; day < days; day++) {
    next.elapsedDays++;
    if (next.settlements) advanceSettlements(next, environment!);
  }
  return parseSimulationState(next);
}

export function resetTribeState(state: SimulationState): SimulationState {
  parseSimulationState(state);
  return parseSimulationState({ ...state, ...(state.clockMode === 'monthly' ? { protocolVersion: SIMULATION_PROTOCOL_VERSION, rulesVersion: SIMULATION_RULES_VERSION, ai: initialCountryAI(state.placementSeed) } : {}), incarnation: state.incarnation + 1,
    ...(state.settlements ? { tribe: { ...state.tribe, originCellId: state.settlements.initialCellId }, settlements: initialSettlements(state.tribe.name, state.settlements.initialCellId) } : {}),
    elapsedDays: 0, rngState: initialRng(state.worldKey, state.placementSeed), running: false, speed: 1 });
}
