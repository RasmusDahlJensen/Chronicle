import { MAX_CIVILIZATION_BYTES, parseCivilizationSnapshot, type WorldStudyBundle } from '../shared/civilization.ts';
import { MAX_WORLD_BUNDLE_BYTES, parseWorldManifest, worldKey, type WorldSettings } from '../shared/generated-world.ts';
import { ComputeClosedError, ComputeOverloadedError, type TerrainCompute } from './compute.ts';

interface Entry {
  controller: AbortController; promise: Promise<WorldStudyBundle>; complete: boolean; subscribers: number;
}

/** Two immutable worlds at most, including unfinished jobs. Never evict an active job.
 * A shared generation survives one disconnected observer, but is cancelled when nobody needs it.
 * This cache is disposable geography, not a persistent simulation or a user-world store.
 */
export function createGeneratedWorldStore(compute: TerrainCompute) {
  const entries = new Map<string, Entry>();
  let closed = false;
  function obtain(settings: WorldSettings): Entry {
    if (closed) throw new ComputeClosedError();
    const key = worldKey(settings);
    const existing = entries.get(key);
    if (existing) { entries.delete(key); entries.set(key, existing); return existing; }
    if (entries.size >= 2) {
      const evict = [...entries].find(([, entry]) => entry.complete);
      if (!evict) throw new ComputeOverloadedError();
      entries.delete(evict[0]);
    }
    const controller = new AbortController();
    const entry: Entry = { controller, promise: undefined!, complete: false, subscribers: 0 };
    entry.promise = compute.generate(controller.signal, { kind: 'world', ...settings }).then(body => {
      if (Buffer.byteLength(body, 'utf8') > MAX_WORLD_BUNDLE_BYTES) throw new Error('Generated world exceeds its cache limit.');
      const bundle: unknown = JSON.parse(body);
      if (!bundle || typeof bundle !== 'object' || !('manifest' in bundle) || typeof bundle.manifest !== 'string'
        || !('civilization' in bundle) || typeof bundle.civilization !== 'string' || Buffer.byteLength(bundle.civilization) > MAX_CIVILIZATION_BYTES
        || !('tiles' in bundle) || !Array.isArray(bundle.tiles) || bundle.tiles.some(tile => typeof tile !== 'string')) {
        throw new Error('The world worker returned an invalid bundle.');
      }
      const manifest = parseWorldManifest(JSON.parse(bundle.manifest));
      if (manifest.worldKey !== key || bundle.tiles.length !== manifest.width * manifest.height / manifest.tileSize ** 2) {
        throw new Error('The world worker returned a mismatched bundle.');
      }
      parseCivilizationSnapshot(JSON.parse(bundle.civilization), manifest);
      entry.complete = true;
      return { manifest: bundle.manifest, tiles: bundle.tiles, civilization: bundle.civilization } as WorldStudyBundle;
    }).catch(error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry;
  }
  return {
    get(settings: WorldSettings, signal: AbortSignal): Promise<WorldStudyBundle> {
      if (signal.aborted) return Promise.reject(signal.reason);
      const entry = obtain(settings);
      entry.subscribers++;
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return false;
          settled = true; signal.removeEventListener('abort', cancel); entry.subscribers--;
          if (!entry.complete && entry.subscribers === 0) {
            entry.controller.abort(new Error('No observers remain for this generation.'));
            const key = worldKey(settings);
            if (entries.get(key) === entry) entries.delete(key);
          }
          return true;
        };
        const cancel = () => { if (finish()) reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
        entry.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
      });
    },
    close() {
      closed = true;
      for (const entry of entries.values()) entry.controller.abort(new ComputeClosedError());
      entries.clear();
    },
  };
}
