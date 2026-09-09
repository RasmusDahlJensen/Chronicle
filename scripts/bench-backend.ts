import { availableParallelism, cpus } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server/app.ts';
import { readBackendConfig } from '../server/config.ts';

const round = (value: number) => Math.round(value * 100) / 100;
const endpoint = process.argv.includes('--atlas') ? '/api/atlas' : '/api/terrain';

function latency(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted.length
    ? round(sorted[Math.ceil(sorted.length * fraction) - 1]) : null;
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
}

async function measurePhase(base: string, name: string, requests: number, concurrency: number) {
  const statuses: Record<number, number> = {};
  const successfulTimes: number[] = [];
  const rejectedTimes: number[] = [];
  const healthTimes: number[] = [];
  const responseBytes: number[] = [];
  const errors: string[] = [];
  let transportFailures = 0;
  let healthFailures = 0;
  let next = 0;
  let running = true;
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const started = performance.now();

  async function terrain() {
    const start = performance.now();
    try {
      const response = await fetch(`${base}${endpoint}`, { signal: AbortSignal.timeout(15_000) });
      const body = await response.arrayBuffer();
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      if (response.status === 200) {
        successfulTimes.push(performance.now() - start);
        responseBytes.push(body.byteLength);
      } else if (response.status === 503) {
        rejectedTimes.push(performance.now() - start);
      }
    } catch (error) {
      transportFailures++;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const lanes = Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      next++;
      await terrain();
    }
  });
  const probes = (async () => {
    while (running) {
      const start = performance.now();
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15_000) });
        await response.arrayBuffer();
        if (response.status !== 200) healthFailures++;
        healthTimes.push(performance.now() - start);
      } catch (error) {
        healthFailures++;
        errors.push(`Health: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (running) await delay(10);
    }
  })();

  try {
    await Promise.all(lanes);
  } finally {
    running = false;
    await probes;
    eventLoop.disable();
  }
  const unexpectedResponses = Object.entries(statuses)
    .filter(([status]) => status !== '200' && status !== '503')
    .reduce((total, [, count]) => total + count, 0);
  return {
    name, requests, concurrency, durationMs: round(performance.now() - started),
    statuses, successful: statuses[200] ?? 0, rejected: statuses[503] ?? 0,
    unexpectedResponses, transportFailures,
    successfulTerrainLatencyMs: latency(successfulTimes),
    rejectedTerrainLatencyMs: latency(rejectedTimes),
    successfulResponseBytes: responseBytes.length
      ? { min: Math.min(...responseBytes), max: Math.max(...responseBytes) } : null,
    health: { failures: healthFailures, latencyMs: latency(healthTimes) },
    eventLoopDelayMs: { p95: round(eventLoop.percentile(95) / 1e6), max: round(eventLoop.max / 1e6) },
    errors,
  };
}

async function main() {
  const initialRssBytes = process.memoryUsage.rss();
  let peakRssBytes = initialRssBytes;
  const sampleMemory = () => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss()); };
  const sampler = setInterval(sampleMemory, 25);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const config = readBackendConfig();
    app = await buildApp({ logger: false });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    // This untimed response identifies the real fixture and warms the HTTP path.
    const warmup = await fetch(`${base}${endpoint}`, { signal: AbortSignal.timeout(15_000) });
    if (!warmup.ok) throw new Error(`Terrain warmup returned HTTP ${warmup.status}.`);
    const { world } = await warmup.json();
    const phases = [
      await measurePhase(base, 'normal', 12, 2),
      await measurePhase(base, 'burst', 12, 12),
    ];
    sampleMemory();
    const failed = phases.some(phase => phase.unexpectedResponses > 0 || phase.transportFailures > 0
      || phase.health.failures > 0 || phase.health.latencyMs.count === 0 || phase.successful === 0);
    if (failed) process.exitCode = 1;
    return {
      benchmark: 'Chronicle authored terrain HTTP pipeline; not simulation capacity',
      measuredAt: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, architecture: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown', availableParallelism: availableParallelism() },
      mode: 'Fastify loopback API with real generation workers; no Vite or browser',
      endpoint,
      fixture: { id: world.fixtureId, version: world.fixtureVersion, cells: world.cells.length },
      limits: { workers: config.workers, queued: config.maxQueue, admitted: config.workers + config.maxQueue,
        jobTimeoutMs: config.jobTimeoutMs },
      memory: { scope: 'Host process, worker threads, and this HTTP client/probe harness; excludes other processes',
        sampleIntervalMs: 25, initialRssBytes, peakRssBytes },
      notes: ['Each timed terrain response is read completely.',
        'One untimed HTTP warmup precedes both phases.',
        'Serial health probes run during each terrain phase with a 10 ms interval.',
        'HTTP 503 overload is counted separately and is expected during the default burst.',
        'No throughput or latency acceptance threshold is inferred from this fixture.'],
      phases, passed: !failed,
    };
  } finally {
    clearInterval(sampler);
    await app?.close();
  }
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.log(JSON.stringify({ benchmark: 'Chronicle authored terrain HTTP pipeline', passed: false,
    error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
