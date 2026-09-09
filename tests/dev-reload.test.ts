import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { parseAtlasResponse, type AtlasWorld } from '../shared/atlas.ts';
import { createTestProject, startProject, type RunningProject } from './helpers/project.ts';

async function eventuallyJson<T = Record<string, unknown>>(app: RunningProject, path: string, accepts: (body: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  let last = 'No response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${app.origin}${path}`, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json() as T;
      last = `HTTP ${response.status}`;
      if (response.ok && accepts(body)) return body;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  assert.fail(`The running app did not serve the edited source at ${path}: ${last}\n${app.output()}`);
}

function replaceOnce(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, `Expected one source marker: ${before}`);
  return source.replace(before, after);
}

async function assertUnavailable(origin: string) {
  const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
  assert.ok(response === null || response.status === 503, 'Failed code must not leave the old host reporting ready.');
}

test('adding a new HTTP route updates the same running development origin', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const originalBackend = app.output().match(/Terrain host ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  assert.ok(originalBackend);
  const server = await project.read('server/app.ts');
  const marker = 'const querystring = Type.Object';
  assert.ok(server.includes(marker));
  await project.write('server/app.ts', server.replace(marker,
    "app.get('/api/reload-probe', async () => ({ source: 'edited-backend' }));\n  " + marker));
  const body = await eventuallyJson(app, '/api/reload-probe', body => body.source === 'edited-backend');
  assert.deepEqual(body, { source: 'edited-backend' });
  await assert.rejects(fetch(`${originalBackend}/api/health`, { signal: AbortSignal.timeout(1_000) }));
});

test('worker fixture edits and rapid saves publish the newest name and area through the same proxy', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const source = await project.read('src/fixtures/verdant-reach.ts');
  function revision(name: string, area: number) {
    return replaceOnce(replaceOnce(source, "name: 'The Verdant Reach'", `name: '${name}'`), 'cellAreaKm2: 4', `cellAreaKm2: ${area}`);
  }
  await project.write('src/fixtures/verdant-reach.ts', revision('Reloaded region', 8));
  const updated = await eventuallyJson<{ protocolVersion: number; world: AtlasWorld }>(app, '/api/atlas', body =>
    body.world?.name === 'Reloaded region' && body.world.cellAreaKm2 === 8);
  assert.equal(parseAtlasResponse(updated).cells.length, 64_000);
  // Editors can replace the same file repeatedly before a restart settles.
  for (const name of ['Intermediate region', 'Another region', 'Newest region']) {
    await project.write('src/fixtures/verdant-reach.ts', revision(name, 12));
  }
  const newest = await eventuallyJson<{ protocolVersion: number; world: AtlasWorld }>(app, '/api/atlas', body =>
    body.world?.name === 'Newest region' && body.world.cellAreaKm2 === 12);
  const world = parseAtlasResponse(newest);
  assert.equal(world.cells.length * world.cellAreaKm2, 768_000);
  assert.equal((await fetch(`${app.origin}/api/ready`)).status, 200);
});

test('new shared, world and nested simulation dependencies reload and recover after restoration', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  await project.write('shared/reload-test.ts', "export const sharedRevision = 'initial';\n");
  await project.write('src/world/reload-test.ts', "export const worldRevision = 'initial';\n");
  const server = await project.read('server/app.ts');
  const imports = "import { sharedRevision } from '../shared/reload-test.ts';\nimport { worldRevision } from '../src/world/reload-test.ts';\n";
  await project.write('server/app.ts', imports + replaceOnce(server, 'const querystring = Type.Object',
    "app.get('/api/dependency-probe', async () => ({ shared: sharedRevision, world: worldRevision }));\n  const querystring = Type.Object"));
  await eventuallyJson(app, '/api/dependency-probe', body => body.shared === 'initial' && body.world === 'initial');
  await project.write('shared/reload-test.ts', "export const sharedRevision = 'updated shared';\n");
  await eventuallyJson(app, '/api/dependency-probe', body => body.shared === 'updated shared' && body.world === 'initial');
  await project.write('src/world/reload-test.ts', "export const worldRevision = 'updated world';\n");
  await eventuallyJson(app, '/api/dependency-probe', body => body.shared === 'updated shared' && body.world === 'updated world');

  const beforeRemoval = app.output().length;
  await project.remove('src/world/reload-test.ts');
  await app.waitForOutput(/ERR_MODULE_NOT_FOUND|Cannot find module/, beforeRemoval);
  await assertUnavailable(app.origin);
  await project.write('src/world/reload-test.ts', "export const worldRevision = 'restored world';\n");
  const restored = await eventuallyJson(app, '/api/dependency-probe', body => body.shared === 'updated shared' && body.world === 'restored world');
  assert.deepEqual(restored, { shared: 'updated shared', world: 'restored world' });

  // This scope does not exist when the watcher starts. Adding it must establish
  // future watches, not only reload once because the existing worker was edited.
  const simulationPath = 'src/simulation/subdir/reload-test.ts';
  await assert.rejects(project.read(simulationPath), { code: 'ENOENT' });
  await project.write(simulationPath, "export const simulationRevision = 'New simulation module';\n");
  const worker = await project.read('server/workers/terrain-worker.ts');
  await project.write('server/workers/terrain-worker.ts',
    "import { simulationRevision } from '../../src/simulation/subdir/reload-test.ts';\n" +
    replaceOnce(worker, "if (study === 'verdant') parseAtlasResponse(payload);",
      "if (study === 'verdant') { payload.world.name = simulationRevision; parseAtlasResponse(payload); }"));
  await eventuallyJson<{ world: AtlasWorld }>(app, '/api/atlas', body => body.world?.name === 'New simulation module');
  await project.write(simulationPath, "export const simulationRevision = 'Edited simulation module';\n");
  const reloaded = await eventuallyJson<{ protocolVersion: number; world: AtlasWorld }>(app, '/api/atlas', body =>
    body.world?.name === 'Edited simulation module');
  assert.equal(parseAtlasResponse(reloaded).cells.length, 64_000);
});

const shutdownCases = process.platform === 'win32'
  ? [{ signal: 'SIGTERM' as const, description: 'forced Windows process-tree cleanup' }]
  : (['SIGINT', 'SIGTERM'] as const).map(signal => ({ signal, description: signal }));
for (const { signal, description } of shutdownCases) {
  test(`stopping the development watcher with ${description} after a reload closes all its listeners`, async t => {
    const project = await createTestProject(t);
    const app = await startProject(project);
    const server = await project.read('server/app.ts');
    await project.write('server/app.ts', replaceOnce(server, "({ status: 'ok' })", "({ status: 'reloaded' })"));
    await eventuallyJson(app, '/api/health', body => body.status === 'reloaded');
    await app.stop(signal);
    await assert.rejects(fetch(`${app.origin}/api/health`, { signal: AbortSignal.timeout(1_000) }));
  });
}
