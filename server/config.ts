import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The lab's checkpoints, beside the fork tool's (`server/workers/checkpoints.ts` uses the same folder). */
const DEFAULT_CHECKPOINTS = join(fileURLToPath(new URL('..', import.meta.url)), '.chronicle', 'checkpoints');

export interface BackendConfig {
  workers: number;
  maxQueue: number;
  jobTimeoutMs: number;
  shutdownTimeoutMs: number;
  logLevel: string;
  /** Live world simulations kept at once (each in its own worker) and in-flight simulation requests. */
  simulations: number;
  simulationRequests: number;
  /** Where simulation workers keep checkpoints for the lab's Load year (Dev 02), or null for none. */
  checkpoints: string | null;
}

/** Explicit limits keep a default launch small and malformed configuration fails early. */
export function readBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  function integer(key: string, fallback: number, min: number, max: number) {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    }
    return value;
  }
  const logLevel = env.CHRONICLE_LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new Error('CHRONICLE_LOG_LEVEL must be fatal, error, warn, info, debug, trace, or silent.');
  }
  return {
    workers: integer('CHRONICLE_WORKERS', Math.min(2, availableParallelism()), 1, 8),
    maxQueue: integer('CHRONICLE_QUEUE_LIMIT', 4, 0, 32),
    // Includes queue time: a tectonic job costs several seconds before encoding.
    // The 25s ceiling still leaves room inside the clients' 30s request timeout.
    jobTimeoutMs: integer('CHRONICLE_JOB_TIMEOUT_MS', 20_000, 100, 25_000),
    shutdownTimeoutMs: 5_000,
    logLevel,
    simulations: integer('CHRONICLE_SIMULATIONS', 2, 1, 8),
    simulationRequests: integer('CHRONICLE_SIMULATION_REQUESTS', 16, 1, 256),
    checkpoints: env.CHRONICLE_CHECKPOINTS === 'off' ? null : resolve(env.CHRONICLE_CHECKPOINTS || DEFAULT_CHECKPOINTS),
  };
}
