import type { TerrainWorld } from '../world/terrain.ts';
import { parseTerrainResponse } from '../../shared/terrain.ts';
import { ApiErrorSchema } from '../../shared/http.ts';
import { Check } from 'typebox/value';

export { parseTerrainResponse } from '../../shared/terrain.ts';

export async function loadTerrain(signal: AbortSignal): Promise<TerrainWorld> {
  let response: Response;
  try {
    response = await fetch('/api/terrain', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Terrain could not be loaded. Check that Chronicle is running and try again.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (Check(ApiErrorSchema, payload)) {
      if (payload.error.code === 'OVERLOADED') throw new Error('Terrain could not be loaded because the host is busy. Try again shortly.');
      if (payload.error.code === 'COMPUTE_TIMEOUT') throw new Error('Terrain generation took too long. Try loading it again.');
    }
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
