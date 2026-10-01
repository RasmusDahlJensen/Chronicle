import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { worldKey, type WorldBundle, type WorldSettings } from '../shared/generated-world.ts';
import type {
  ObserverFrame, RegionMap, SimulationControl, SimulationInit, SimulationInstance, SimulationReply, SimulationRequest,
} from '../shared/simulation.ts';

export class SimulationUnavailableError extends Error {
  constructor(message = 'The simulation is unavailable. Try again.') { super(message); }
}

interface HostOptions {
  /** Validated geography exactly as the lab receives it. */
  loadWorld(settings: WorldSettings, signal: AbortSignal): Promise<WorldBundle>;
  /** Live simulations kept at once; the least recently used is stopped (and restarts at year 0) beyond this. */
  maxInstances?: number;
  filename?: URL;
  /** Deadline for a worker reply to one request; a worker that misses it is retired. */
  requestTimeoutMs?: number;
  setupTimeoutMs?: number;
  /** After a world's simulation fails to start, further attempts are refused for this long. */
  failureBackoffMs?: number;
}

export interface SimulationReport {
  instance: SimulationInstance; tick: number; eventLogHash: string; stateHash: string; eventCount: number;
  stats: unknown[]; events?: unknown[]; metrics: Record<string, number>;
  timing: { system: string; ms: number; calls: number }[];
  partition: Record<string, number>;
}

interface WorkerOptions { filename: URL; requestTimeoutMs: number; setupTimeoutMs: number }
type Outgoing = SimulationRequest extends infer Request ? Request extends unknown ? Omit<Request, 'id'> : never : never;

/** One world's dedicated simulation worker (VISION.md "Host-side simulation"). */
export class SimulationWorker {
  readonly ready: Promise<SimulationInstance>;
  private readonly worker: Worker;
  private readonly options: WorkerOptions;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly waiters = new Set<{ resolve(tick: number): void; reject(error: Error): void }>();
  private nextId = 1;
  private failure: SimulationUnavailableError | undefined;
  instance: SimulationInstance | undefined;

  constructor(bundle: WorldBundle, seed: string, options: WorkerOptions) {
    this.options = options;
    const init: SimulationInit = { manifest: bundle.manifest, tiles: bundle.tiles, seed, runId: randomUUID() };
    this.worker = new Worker(options.filename, { workerData: init, resourceLimits: { maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 64 } });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(this.fail('The simulation took too long to start.')), options.setupTimeoutMs);
      this.worker.on('message', (message: SimulationReply) => {
        if (message.kind === 'ready') { clearTimeout(timer); this.instance = message.instance; resolve(message.instance); return; }
        if (message.kind === 'arrived') { for (const waiter of this.waiters) waiter.resolve(message.tick); this.waiters.clear(); return; }
        if (message.kind === 'failed') { reject(this.fail(`The simulation stopped: ${message.message}`)); return; }
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message.body); else entry.reject(new SimulationUnavailableError(message.message));
      });
      this.worker.on('error', error => { clearTimeout(timer); reject(this.fail(`The simulation stopped unexpectedly (${error.message}). It will start again at year 0.`)); });
      this.worker.on('exit', code => { clearTimeout(timer); reject(this.fail(`The simulation worker exited (${code}). It will start again at year 0.`)); });
    });
    this.ready.catch(() => {});
  }

  get failed() { return this.failure !== undefined; }

  /** Retire the worker: reject everything waiting on it and stop its thread. Later requests start a new simulation. */
  private fail(message: string) {
    if (!this.failure) {
      this.failure = new SimulationUnavailableError(message);
      void this.worker.terminate();
    }
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(this.failure); }
    this.pending.clear();
    for (const waiter of this.waiters) waiter.reject(this.failure);
    this.waiters.clear();
    return this.failure;
  }

  async request<T>(message: Outgoing): Promise<T> {
    await this.ready;
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.fail('The simulation stopped responding. It will start again at year 0.'));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.worker.postMessage({ ...message, id } as SimulationRequest);
    });
  }

  frame(cursor: number, inspect?: number) { return this.request<ObserverFrame>({ kind: 'frame', cursor, inspect }); }
  control(control: SimulationControl, cursor = Number.MAX_SAFE_INTEGER, inspect?: number) { return this.request<ObserverFrame>({ kind: 'control', control, cursor, inspect }); }
  regions() { return this.request<RegionMap>({ kind: 'regions' }); }
  report(events = false) { return this.request<SimulationReport>({ kind: 'report', events }); }

  /** Run to January of `year` and resolve with the tick where the run ended (earlier if a control interrupted it). */
  async runTo(year: number): Promise<number> {
    let waiter!: { resolve(tick: number): void; reject(error: Error): void };
    const ended = new Promise<number>((resolve, reject) => { waiter = { resolve, reject }; });
    this.waiters.add(waiter);
    try {
      const frame = await this.control({ action: 'runTo', year });
      if (!frame.playing) { this.waiters.delete(waiter); return frame.tick; }
    } catch (error) { this.waiters.delete(waiter); throw error; }
    return ended;
  }

  async close() {
    this.fail('The simulation was closed.');
    await this.worker.terminate();
  }
}

/** Live simulations by world identity: created on first use, replaced after a crash, bounded in number. */
export function createSimulationHost(options: HostOptions) {
  const filename = options.filename ?? new URL('./workers/simulation-worker.ts', import.meta.url);
  const workerOptions = { filename, requestTimeoutMs: options.requestTimeoutMs ?? 10_000, setupTimeoutMs: options.setupTimeoutMs ?? 120_000 };
  const maxInstances = options.maxInstances ?? 2, backoffMs = options.failureBackoffMs ?? 30_000;
  const live = new Map<string, Promise<SimulationWorker>>();
  const failures = new Map<string, { at: number; message: string }>();
  // Creation belongs to the host, not to the first request: one observer disconnecting must not cancel it.
  const lifetime = new AbortController();
  let closed = false;

  function evict() {
    while (live.size > maxInstances) {
      const [oldest, promise] = live.entries().next().value!;
      live.delete(oldest);
      void promise.then(worker => worker.close(), () => {});
    }
  }

  async function attach(settings: WorldSettings): Promise<SimulationWorker> {
    const key = worldKey(settings);
    for (;;) {
      if (closed) throw new SimulationUnavailableError('The host is shutting down.');
      const entry = live.get(key);
      if (!entry) break;
      const existing = await entry.catch(() => undefined);
      // Another attach may have replaced or evicted the entry while this one waited; always act on the current one.
      if (live.get(key) !== entry) continue;
      if (existing && !existing.failed) { live.delete(key); live.set(key, entry); return existing; }
      live.delete(key);
      void existing?.close();
    }
    const failure = failures.get(key);
    if (failure && Date.now() - failure.at < backoffMs) throw new SimulationUnavailableError(failure.message);
    // From the check above to `live.set` nothing awaits, so concurrent attaches share this one creation.
    const entry = (async () => {
      // Geography failures (busy generator, cancelled job) are transient and pass through unchanged.
      const bundle = await options.loadWorld(settings, lifetime.signal);
      if (closed) throw new SimulationUnavailableError('The host is shutting down.');
      const worker = new SimulationWorker(bundle, settings.seed, workerOptions);
      try { await worker.ready; } catch (error) {
        await worker.close();
        // A simulation that cannot start fails the same way next time; refuse retries for a while instead of
        // re-decoding the world on every poll.
        if (!closed) failures.set(key, { at: Date.now(), message: (error as Error).message });
        throw error;
      }
      failures.delete(key);
      return worker;
    })();
    live.set(key, entry);
    entry.catch(() => { if (live.get(key) === entry) live.delete(key); });
    evict();
    return entry;
  }

  return {
    attach,
    snapshot: () => ({ instances: live.size, maxInstances }),
    async close() {
      closed = true;
      lifetime.abort(new SimulationUnavailableError('The host is shutting down.'));
      const workers = [...live.values()];
      live.clear();
      await Promise.all(workers.map(promise => promise.then(worker => worker.close(), () => {})));
    },
  };
}
export type SimulationHost = ReturnType<typeof createSimulationHost>;
