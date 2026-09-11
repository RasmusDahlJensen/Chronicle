import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSimulationRuntime } from '../server/workers/simulation-runtime.ts';
import { parseSimulationState, type SimulationState } from '../shared/simulation.ts';

const input = { instanceId: '11111111-1111-4111-8111-111111111111', observerId: '22222222-2222-4222-8222-222222222222',
  settings: { seed: 'Recovery fixture', size: 'standard' as const }, placementSeed: 'Tribes 1' };
// An explicitly authored checkpoint isolates crash recovery from the separately tested terrain generator.
const fixture = parseSimulationState({ protocolVersion: 1, rulesVersion: 1, id: input.instanceId, incarnation: 1, revision: 0,
  worldKey: 'climate-5:standard:Recovery fixture', settings: input.settings, placementSeed: input.placementSeed,
  tribe: { id: 'civilization-1', name: 'Aven', color: '#a34f32', originCellId: 1, population: 250 },
  elapsedDays: 0, rngState: 123, running: false, speed: 1 });

test('abrupt host death releases ownership and recovers the acknowledged checkpoint; stopped directory backup restores it', { timeout: 20_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'live'), backup = join(root, 'backup');
  createSimulationRuntime({ directory }).close();
  const seed = new DatabaseSync(join(directory, 'simulation.sqlite'));
  seed.prepare('INSERT INTO checkpoints(id, current) VALUES (?, ?)').run(fixture.id, JSON.stringify(fixture)); seed.close();
  const moduleUrl = new URL('../server/workers/simulation-runtime.ts', import.meta.url).href;
  const script = `import { createSimulationRuntime } from ${JSON.stringify(moduleUrl)};
    const runtime = createSimulationRuntime({directory: process.argv[1]});
    const input = JSON.parse(process.argv[2]);
    const view = runtime.open(input);
    const advanced = runtime.command({instanceId: input.instanceId, observerId: input.observerId,
      incarnation: view.state.incarnation, revision: view.state.revision, action: 'step', days: 30});
    // Match the real worker: its timer retains the authority for the host lifetime.
    setInterval(() => runtime.tick(), 1000);
    // Exercise GC before checking the lock, rather than depending on heap pressure.
    setImmediate(() => { global.gc(); process.send(advanced.state); });`;
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '--eval', script, directory, JSON.stringify(input)],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr!.on('data', data => { stderr += data; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const [payload] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(stderr); })]);
  const durable = parseSimulationState(payload as SimulationState);
  assert.equal(durable.elapsedDays, 30);
  assert.throws(() => createSimulationRuntime({ directory }), /already|owner|use/i);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const recovered = createSimulationRuntime({ directory });
  try { assert.deepEqual(recovered.open(input)!.state, durable); } finally { recovered.close(); }
  await cp(directory, backup, { recursive: true });
  const restored = createSimulationRuntime({ directory: backup });
  try { assert.deepEqual(restored.open(input)!.state, durable); } finally { restored.close(); }
});
