import { Check } from 'typebox/value';
import { parseAtlasResponse, type AtlasWorld } from '../../shared/atlas.ts';
import { ApiErrorSchema } from '../../shared/http.ts';

export async function loadAtlas(signal: AbortSignal): Promise<AtlasWorld> {
  let response: Response;
  try {
    response = await fetch('/api/atlas', {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      cache: 'no-store', headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('The atlas could not be loaded. Check that Chronicle is running and try again.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    if (Check(ApiErrorSchema, payload)) {
      if (payload.error.code === 'OVERLOADED') throw new Error('The host is busy. Try loading the atlas again shortly.');
      if (payload.error.code === 'COMPUTE_TIMEOUT') throw new Error('The atlas took too long to prepare. Try again.');
    }
    throw new Error('The atlas could not be loaded. Check that Chronicle is running and try again.');
  }
  const payload: unknown = await response.json().catch(() => { throw new Error('The atlas response could not be read. Try again.'); });
  return parseAtlasResponse(payload);
}
