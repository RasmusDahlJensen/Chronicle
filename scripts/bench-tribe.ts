import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { createSimulationRuntime } from '../server/workers/simulation-runtime.ts';
import { createSimulationService } from '../server/simulation.ts';
import { parseSimulationState, type SimulationOpen, type SimulationState } from '../shared/simulation.ts';

// Authored tiny checkpoints isolate storage/RPC costs. This is not a future gameplay capacity claim.
const directory = await mkdtemp(join(tmpdir(), 'chronicle-tribe-bench-'));
const samples: number[] = [], inputs: SimulationOpen[] = [], states: SimulationState[] = [];
let service: ReturnType<typeof createSimulationService> | undefined;
try {
  createSimulationRuntime({ directory }).close();
  const db = new DatabaseSync(join(directory, 'simulation.sqlite'));
  try {
    for (let n = 0; n < 16; n++) {
      const input: SimulationOpen = { instanceId: randomUUID(), observerId: randomUUID(),
        settings: { seed: 'Benchmark fixture', size: 'large' }, placementSeed: `Tribes ${n}` };
      const state = parseSimulationState({ protocolVersion: 1, rulesVersion: 1, id: input.instanceId, incarnation: 1, revision: 0,
        worldKey: 'climate-5:large:Benchmark fixture', settings: input.settings, placementSeed: input.placementSeed,
        tribe: { id: 'civilization-1', name: 'Lorin', color: '#a34f32', originCellId: 1, population: 250 },
        elapsedDays: 0, rngState: 123, running: false, speed: 1 });
      inputs.push(input); states.push(state);
      db.prepare('INSERT INTO checkpoints(id,current) VALUES (?,?)').run(state.id, JSON.stringify(state));
    }
  } finally { db.close(); }
  service = createSimulationService({ directory }); await service.ready();
  // Observe the explicit legacy fixtures directly: open would upgrade them with real geography.
  for (const input of inputs) await service.observe({ instanceId: input.instanceId, observerId: input.observerId });
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const start = performance.now();
  for (let iteration = 0; iteration < 20; iteration++) for (let n = 0; n < 16; n++) {
    const before = performance.now();
    const result = await service.command({ instanceId: inputs[n].instanceId, observerId: inputs[n].observerId,
      incarnation: states[n].incarnation, revision: states[n].revision, action: 'step', days: 30 });
    states[n] = result.state; samples.push(performance.now() - before);
  }
  const elapsed = performance.now() - start; lag.disable(); samples.sort((a, b) => a - b);
  await service.close(); service = undefined;
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, hostGiB: totalmem() / 1024 ** 3,
    scenario: '16 authored legacy clock-only 250-person checkpoints; real worker RPC and FULL WAL commits; no food/demographic mechanics',
    batches: samples.length, daysPerWorld: states[0].elapsedDays, checkpointBytes: Buffer.byteLength(JSON.stringify(states[0])),
    durationMs: elapsed, p50Ms: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)],
    maxMs: samples.at(-1), mainLoopMaxMs: lag.max / 1e6, databaseBytes: (await stat(join(directory, 'simulation.sqlite'))).size,
    rssMiB: process.memoryUsage().rss / 1024 ** 2 }, null, 2));
} finally { await service?.close(); await rm(directory, { recursive: true, force: true }); }
