import { MAX_CIVILIZATION_BYTES, parseCivilizationSnapshot } from '../../shared/civilization.ts';
import { Check } from 'typebox/value';
import { ApiErrorSchema } from '../../shared/http.ts';
import {
  MAX_WORLD_MANIFEST_BYTES, MAX_WORLD_TILE_BYTES, parseWorldManifest, parseWorldSettings, parseWorldTile,
  worldKey, type WorldManifest, type WorldSettings, type WorldTile,
} from '../../shared/generated-world.ts';

async function readJson(response: Response, maximum: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new Error('The world response was too large. Try loading it again.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The world response was empty. Try loading it again.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new Error('The world response was too large. Try loading it again.');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function requestJson(path: string, maximum: number, callerSignal: AbortSignal, detail = false) {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)]);
  const fallback = detail
    ? 'World detail could not be loaded. The overview is still available. Use Retry detail.'
    : 'The world could not be loaded. Check that Chronicle is running and try again.';
  let response: Response;
  try {
    response = await fetch(path, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch { throw new Error(fallback); }
  if (!response.ok) {
    const error = await readJson(response, 8192, signal).catch(() => null);
    if (Check(ApiErrorSchema, error)) {
      if (error.error.code === 'OVERLOADED') throw new Error(detail ? 'The host is busy preparing detail. Use Retry detail shortly.' : 'The host is busy. Try generating the world again shortly.');
      if (error.error.code === 'COMPUTE_TIMEOUT') throw new Error(detail ? 'World detail took too long. Use Retry detail.' : 'World generation took too long. Try again.');
    }
    throw new Error(fallback);
  }
  try { return await readJson(response, maximum, signal); }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes('too large')) throw cause;
    throw new Error(detail ? 'The world detail response could not be read. Use Retry detail.' : 'The world response could not be read. Try again.');
  }
}

export async function loadGeneratedWorld(settings: WorldSettings, signal: AbortSignal): Promise<WorldManifest> {
  parseWorldSettings(settings);
  const query = new URLSearchParams(settings);
  const manifest = parseWorldManifest(await requestJson(`/api/world?${query}`, MAX_WORLD_MANIFEST_BYTES, signal));
  if (manifest.worldKey !== worldKey(settings)) throw new Error('The host returned a different world. Try generating it again.');
  return manifest;
}

export async function loadCivilization(world: WorldManifest, signal: AbortSignal) {
  try {
    const query = new URLSearchParams(world.settings);
    const payload = await requestJson(`/api/world/civilization?${query}`, MAX_CIVILIZATION_BYTES, signal);
    signal.throwIfAborted();
    return parseCivilizationSnapshot(payload, world);
  } catch {
    throw new Error('The civilization could not be loaded. The map is still available. Use Retry civilization.');
  }
}

interface TileJob { x: number; y: number; resolve: (tile: WorldTile) => void; reject: (cause: unknown) => void }

/** One displayed world's network lifecycle; only validated tiles enter its bounded LRU. */
export function createWorldTileClient(manifest: WorldManifest) {
  const controller = new AbortController();
  const cache = new Map<string, WorldTile>();
  const pending = new Map<string, Promise<WorldTile>>();
  const failures = new Map<string, unknown>();
  let visible = new Set<string>();
  const queue: TileJob[] = [];
  let active = 0;
  const keyOf = (x: number, y: number) => `${x},${y}`;

  function pump() {
    while (!controller.signal.aborted && active < 4 && queue.length) {
      const job = queue.shift()!;
      active++;
      const key = keyOf(job.x, job.y);
      const query = new URLSearchParams({ ...manifest.settings, x: String(job.x), y: String(job.y) });
      void requestJson(`/api/world/tile?${query}`, MAX_WORLD_TILE_BYTES, controller.signal, true).then(payload => {
        controller.signal.throwIfAborted();
        const tile = parseWorldTile(payload, manifest, job.x, job.y);
        cache.delete(key);
        cache.set(key, tile);
        // Older views may still be finishing. Keep the current viewport ahead of
        // completion order; an offscreen completion can evict itself when needed.
        while (cache.size > 16) cache.delete([...cache.keys()].find(candidate => !visible.has(candidate))!);
        job.resolve(tile);
      }).catch(cause => {
        if (!controller.signal.aborted) failures.set(key, cause);
        job.reject(cause);
      }).finally(() => { active--; pending.delete(key); pump(); });
    }
  }

  return {
    setVisibleTiles(coordinates: readonly Pick<WorldTile, 'x' | 'y'>[]) {
      // The renderer currently supplies at most 12. Bound pins independently so
      // caller mistakes cannot prevent the 16-entry cache from evicting a tile.
      visible = new Set(coordinates.slice(0, 16).map(({ x, y }) => keyOf(x, y)));
    },
    request(x: number, y: number): Promise<WorldTile> {
      if (controller.signal.aborted) return Promise.reject(new Error('World detail loading was cancelled.'));
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= manifest.width / 128 || y >= manifest.height / 128) return Promise.reject(new Error('Invalid world detail coordinates.'));
      const key = keyOf(x, y);
      const tile = cache.get(key);
      if (tile) { cache.delete(key); cache.set(key, tile); return Promise.resolve(tile); }
      if (failures.has(key)) return Promise.reject(failures.get(key));
      const existing = pending.get(key);
      if (existing) return existing;
      const promise = new Promise<WorldTile>((resolve, reject) => { queue.push({ x, y, resolve, reject }); });
      pending.set(key, promise);
      pump();
      return promise;
    },
    get tiles(): WorldTile[] { return [...cache.values()]; },
    retryFailures() { failures.clear(); },
    destroy() {
      controller.abort();
      for (const job of queue.splice(0)) job.reject(new Error('World detail loading was cancelled.'));
      pending.clear(); cache.clear(); failures.clear(); visible.clear();
    },
  };
}
