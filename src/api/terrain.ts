import type { TerrainWorld } from '../world/terrain.ts';

const MAX_CELLS = 100_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return finite(value) && Number.isInteger(value) && value > 0;
}

/** Validate the host boundary before handing data to the renderer. */
export function parseTerrainResponse(payload: unknown): TerrainWorld {
  const invalid = () => new Error('The terrain response was invalid. Try loading it again.');
  if (!record(payload) || payload.protocolVersion !== 1 || !record(payload.world)) throw invalid();
  const world = payload.world;
  if (!text(world.fixtureId) || !positiveInteger(world.fixtureVersion) || !text(world.name)
    || !positiveInteger(world.width) || !positiveInteger(world.height)
    || world.width * world.height > MAX_CELLS
    || !finite(world.cellAreaKm2) || world.cellAreaKm2 <= 0
    || !Array.isArray(world.cells) || world.cells.length !== world.width * world.height
    || !Array.isArray(world.provinces) || world.provinces.length > world.cells.length) throw invalid();

  const provinceIds = new Set<string>();
  for (const province of world.provinces) {
    if (!record(province) || !text(province.id) || !text(province.name)
      || (province.sovereignId !== null && !text(province.sovereignId))
      || provinceIds.has(province.id)) throw invalid();
    provinceIds.add(province.id);
  }
  for (let index = 0; index < world.cells.length; index++) {
    const cell: unknown = world.cells[index];
    if (!record(cell) || cell.id !== index || !finite(cell.elevation)) throw invalid();
    if (cell.terrain === 'water') {
      if (cell.provinceId !== null) throw invalid();
    } else if (cell.terrain === 'plains' || cell.terrain === 'hills') {
      if (!text(cell.provinceId) || !provinceIds.has(cell.provinceId)) throw invalid();
    } else {
      throw invalid();
    }
  }
  return world as unknown as TerrainWorld;
}

export async function loadTerrain(signal: AbortSignal): Promise<TerrainWorld> {
  let response: Response;
  try {
    response = await fetch('/api/terrain', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Request failed');
  } catch {
    throw new Error('Terrain could not be loaded. Check that Chronicle is running and try again.');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The terrain response could not be read. Try loading it again.');
  }
  return parseTerrainResponse(payload);
}
