import Piscina from 'piscina';
import type { TerrainStudy } from '../shared/studies.ts';

export class ComputeOverloadedError extends Error {
  constructor() { super('Terrain compute is busy. Try again shortly.'); }
}

export class ComputeTimeoutError extends Error {
  constructor() { super('Terrain computation exceeded its deadline.'); }
}

export class ComputeClosedError extends Error {
  constructor() { super('Terrain compute is shutting down.'); }
}

export interface TerrainCompute {
  ready(): Promise<void>;
  generate(signal?: AbortSignal, study?: TerrainStudy): Promise<string>;
  close(): Promise<void>;
  snapshot(): { workers: number; active: number; queued: number; completed: number; failed: number };
}

interface ComputeOptions {
  workers: number;
  maxQueue: number;
  jobTimeoutMs: number;
  shutdownTimeoutMs: number;
  filename?: string | URL;
}

/** One bounded, application-owned executor for disposable terrain jobs. */
export function createTerrainCompute(options: ComputeOptions): TerrainCompute {
  const filename = options.filename ?? new URL('./workers/terrain-worker.ts', import.meta.url);
  const pool = new Piscina<TerrainStudy, string>({
    filename: filename instanceof URL ? filename.href : filename,
    minThreads: options.workers,
    maxThreads: options.workers,
    maxQueue: options.maxQueue,
    concurrentTasksPerWorker: 1,
    // These constrain V8 heaps, not total process memory or ArrayBuffers.
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  });
  const jobs = new Map<Promise<string>, AbortController>();
  let closed = false;
  let completed = 0;
  let failed = 0;
  let bootstrapError: Error | undefined;
  let readiness: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  pool.on('error', (error: Error) => {
    // Bootstrap failures can otherwise leave queued jobs waiting without a worker.
    // Piscina replaces an established worker after an ordinary task crash.
    if (pool.threads.length === 0) {
      bootstrapError = error;
      for (const controller of jobs.values()) controller.abort(error);
    }
  });

  function submit(signal?: AbortSignal, count = true, study: TerrainStudy = { kind: 'probe' }): Promise<string> {
    if (closed) return Promise.reject(new ComputeClosedError());
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (bootstrapError) return Promise.reject(bootstrapError);
    if (jobs.size >= options.workers + options.maxQueue) return Promise.reject(new ComputeOverloadedError());

    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    // The deadline begins at admission and includes time spent in the queue.
    const timer = setTimeout(() => controller.abort(new ComputeTimeoutError()), options.jobTimeoutMs);
    const job = pool.run(study, { signal: controller.signal })
      .then(body => {
        controller.signal.throwIfAborted();
        if (typeof body !== 'string') throw new Error('Terrain worker returned an invalid body.');
        if (count) completed++;
        return body;
      })
      .catch((error: unknown) => {
        if (count) failed++;
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        jobs.delete(job);
      });
    jobs.set(job, controller);
    return job;
  }

  return {
    ready() {
      if (closed) return Promise.reject(new ComputeClosedError());
      // Exercise the real worker and its geography imports with a cheap, uncounted probe job.
      readiness ??= submit(undefined, false).then(() => {});
      return readiness;
    },
    generate: (signal, study) => submit(signal, true, study),
    close() {
      closed = true;
      closing ??= (async () => {
        const timer = setTimeout(() => {
          for (const controller of jobs.values()) controller.abort(new ComputeClosedError());
        }, options.shutdownTimeoutMs);
        try {
          await Promise.allSettled([...jobs.keys()]);
        } finally {
          clearTimeout(timer);
          await pool.destroy();
        }
      })();
      return closing;
    },
    snapshot() {
      const queued = pool.queueSize;
      return { workers: pool.threads.length, active: Math.max(0, jobs.size - queued), queued, completed, failed };
    },
  };
}
