import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestProject, startProject } from './helpers/project.ts';
import { parseSimulationView, type SimulationView } from '../shared/simulation.ts';

test('documented launcher saves a tribe across host restarts and saves do not trigger development reloads', { timeout: 120_000 }, async t => {
  const project = await createTestProject(t);
  const inheritedDirectory = join(project.root, 'inherited-save-directory');
  const originalDirectory = process.env.CHRONICLE_DATA_DIR;
  process.env.CHRONICLE_DATA_DIR = inheritedDirectory;
  t.after(() => { if (originalDirectory === undefined) delete process.env.CHRONICLE_DATA_DIR; else process.env.CHRONICLE_DATA_DIR = originalDirectory; });
  let host = await startProject(project);
  const body = { instanceId: randomUUID(), observerId: randomUUID(), settings: { seed: 'Chronicle', size: 'standard' }, placementSeed: 'Tribes 1' };
  async function request(path: string, payload: unknown): Promise<SimulationView> {
    const response = await fetch(`${host.origin}/api/simulation/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data));
    return parseSimulationView(data);
  }
  const initial = await request('open', body);
  assert.equal(initial.state.elapsedDays, 0);
  const advanced = await request('command', { instanceId: body.instanceId, observerId: body.observerId,
    incarnation: initial.state.incarnation, revision: initial.state.revision, action: 'step', days: 30 });
  assert.equal(advanced.state.elapsedDays, 30);
  await assert.rejects(access(inheritedDirectory), 'copied project must override inherited personal save directory');
  const files = await readdir(join(project.root, '.chronicle'));
  assert.ok(files.some(file => file.endsWith('.sqlite')), 'launcher must create local SQLite storage');
  for (const file of files) {
    const exposed = await fetch(`${host.origin}/.chronicle/${encodeURIComponent(file)}`);
    assert.notEqual(exposed.status, 200, 'Vite must not serve saved worlds as static files');
  }
  const readyCount = host.output().match(/Chronicle ready/g)?.length;
  await delay(1500);
  assert.equal(host.output().match(/Chronicle ready/g)?.length, readyCount, 'writing saves must not restart Vite or the backend');
  await host.stop();
  host = await startProject(project);
  const restored = await request('open', { ...body, observerId: randomUUID() });
  assert.deepEqual(restored.state, advanced.state, 'same directory must restore the durable checkpoint with no offline catch-up');
  assert.equal(restored.state.running, false);
  assert.equal(restored.state.tribe.population, 250);
});
