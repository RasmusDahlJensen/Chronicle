import { availableParallelism } from 'node:os';

export interface BackendConfig {
  workers: number;
  maxQueue: number;
  jobTimeoutMs: number;
  shutdownTimeoutMs: number;
  logLevel: string;
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
    jobTimeoutMs: integer('CHRONICLE_JOB_TIMEOUT_MS', 8_000, 100, 8_000),
    shutdownTimeoutMs: 5_000,
    logLevel,
  };
}
