import { Worker } from 'node:worker_threads';
import type { SimulationCommand, SimulationObserve, SimulationOpen, SimulationView } from '../shared/simulation.ts';
import type { WorldStudyBundle } from '../shared/civilization.ts';
import { MAX_WORLD_BUNDLE_BYTES } from '../shared/generated-world.ts';
import { SimulationError, simulationUnavailable } from './simulation-errors.ts';
import type { SimulationRequest, SimulationResult, SimulationWorkerMessage } from './simulation-protocol.ts';

export const SIMULATION_RPC_LIMIT = 64;
const INITIALIZATION_LIMIT = 2;
type Request = SimulationRequest extends infer R ? R extends SimulationRequest ? Omit<R, 'id'> : never : never;
interface Pending { resolve(result: SimulationResult): void; reject(error: Error): void; timer: NodeJS.Timeout; initialization: boolean }

/** One non-disposable authority; only queued messages cross into its SQLite-owning worker. */
export function createSimulationService(options: { directory?: string } = {}) {
  const worker = new Worker(new URL('./workers/simulation-worker.ts', import.meta.url), { workerData: { directory: options.directory } });
  const pending = new Map<number, Pending>();
  let sequence = 0, stopping = false, isReady = false, stopped: Promise<void> | undefined, failure: SimulationError | undefined;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void readyPromise.catch(() => {});
  const startup = setTimeout(() => fail(simulationUnavailable()), 10_000);
  function fail(error: SimulationError) {
    if (failure) return; failure = error; clearTimeout(startup); rejectReady(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear(); void worker.terminate();
  }
  worker.on('message', (message: SimulationWorkerMessage) => {
    if ('ready' in message) { isReady = true; clearTimeout(startup); resolveReady(); return; }
    if ('error' in message && message.id === 0) {
      fail(new SimulationError(message.error.code, message.error.message, message.error.statusCode)); return;
    }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if ('error' in message) item.reject(new SimulationError(message.error.code, message.error.message, message.error.statusCode));
    else item.resolve(message.result);
  });
  worker.on('error', () => fail(simulationUnavailable()));
  worker.on('exit', () => {
    if (!stopping || pending.size) fail(simulationUnavailable());
    clearTimeout(startup);
  });
  function rpc(request: Request, closing = false): Promise<SimulationResult> {
    if (failure || stopping && !closing) return Promise.reject(failure ?? simulationUnavailable());
    if (!closing && pending.size >= SIMULATION_RPC_LIMIT) return Promise.reject(new SimulationError('OVERLOADED', 'The tribal simulation is busy. Retry shortly.'));
    if (request.action === 'initialize') {
      if ([...pending.values()].filter(item => item.initialization).length >= INITIALIZATION_LIMIT) {
        return Promise.reject(new SimulationError('OVERLOADED', 'The tribal simulation is busy. Retry shortly.'));
      }
      const bytes = Buffer.byteLength(request.bundle.manifest) + Buffer.byteLength(request.bundle.civilization)
        + request.bundle.tiles.reduce((total, body) => total + Buffer.byteLength(body), 0);
      if (bytes > MAX_WORLD_BUNDLE_BYTES) return Promise.reject(new SimulationError('SIMULATION_ERROR', 'The tribal geography exceeds its supported size.'));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => fail(simulationUnavailable()), 30_000);
      pending.set(id, { resolve, reject, timer, initialization: request.action === 'initialize' });
      void readyPromise.then(() => {
        if (!pending.has(id)) return;
        try { worker.postMessage({ ...request, id }); } catch { fail(simulationUnavailable()); }
      }, () => { /* fail() already rejects every pending request. */ });
    });
  }
  function close(): Promise<void> {
    if (stopped) return stopped;
    stopping = true;
    stopped = (async () => {
      const timeout = setTimeout(() => fail(simulationUnavailable()), 5_000);
      try { if (!failure) await rpc({ action: 'close' }, true); }
      catch { /* A failed authority already rejects every accepted request. */ }
      finally { clearTimeout(timeout); clearTimeout(startup); await worker.terminate(); }
    })();
    return stopped;
  }
  return {
    snapshot: () => ({ status: stopping ? 'closing' as const : failure ? 'unavailable' as const : isReady ? 'ready' as const : 'starting' as const,
      pending: pending.size, limits: { pending: SIMULATION_RPC_LIMIT, initializations: INITIALIZATION_LIMIT } }),
    ready: () => readyPromise,
    open: (input: SimulationOpen) => rpc({ action: 'open', input }) as Promise<SimulationView | null>,
    initialize: (input: SimulationOpen, bundle: WorldStudyBundle) => rpc({ action: 'initialize', input, bundle }) as Promise<SimulationView>,
    observe: (input: SimulationObserve) => rpc({ action: 'observe', input }) as Promise<SimulationView>,
    release: (input: SimulationObserve) => rpc({ action: 'release', input }) as Promise<{ released: true }>,
    command: (input: SimulationCommand) => rpc({ action: 'command', input }) as Promise<SimulationView>, close,
  };
}
