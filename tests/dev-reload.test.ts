import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { parseWorldManifest, type WorldManifest } from '../shared/generated-world.ts';
import { createTestProject, startProject, type RunningProject } from './helpers/project.ts';

interface Polling { deadlineMs?: number; requestTimeoutMs?: number }

async function eventuallyJson<T = Record<string, unknown>>(app: RunningProject, path: string, accepts: (body: T) => boolean,
  { deadlineMs = 10_000, requestTimeoutMs = 2_000 }: Polling = {}): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  let last = 'No response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${app.origin}${path}`, { signal: AbortSignal.timeout(requestTimeoutMs) });
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

// Every host restart regenerates a standard world in its worker (a few seconds each).
const worldPolling: Polling = { deadlineMs: 90_000, requestTimeoutMs: 25_000 };

/** Wait until the proxied worker serves this seed's geography with the expected annual temperature shift. */
async function eventuallyWorld(app: RunningProject, seed: string, accepts: (world: WorldManifest) => boolean) {
  const body = await eventuallyJson<unknown>(app, `/api/world?seed=${encodeURIComponent(seed)}&size=standard`, body => {
    try {
      return accepts(parseWorldManifest(body));
    } catch {
      return false;
    }
  }, worldPolling);
  return parseWorldManifest(body);
}

/** Same terrain, every annual mean moved by `tenths` (±0.1 °C rounding), so distinct revisions are unambiguous. */
function temperatureShift(initial: WorldManifest, tenths: number) {
  return (world: WorldManifest) => world.worldKey === initial.worldKey
    && world.overview.fields.temperature.length === initial.overview.fields.temperature.length
    && world.overview.fields.temperature.every((value, at) => Math.abs(value - initial.overview.fields.temperature[at] - tenths) <= 1)
    && world.overview.fields.elevation.every((value, at) => value === initial.overview.fields.elevation[at]);
}

function replaceOnce(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, `Expected one source marker: ${before}`);
  return source.replace(before, after);
}

async function assertUnavailable(origin: string) {
  const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
  assert.ok(response === null || response.status === 503, 'Failed code must not leave the old host reporting ready.');
}

const CLIMATE_PATH = 'src/world/generation/climate.ts';
const CLIMATE_MARKER = 'return 31 - 62';

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

test('worker geography edits and rapid saves publish the newest climate through the same proxy', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const seed = 'Rapid saves';
  const initial = await eventuallyWorld(app, seed, () => true);
  const source = await project.read(CLIMATE_PATH);
  // The annual temperature baseline runs only inside the terrain worker thread.
  const revision = (baseline: number) => replaceOnce(source, CLIMATE_MARKER, `return ${baseline} - 62`);
  await project.write(CLIMATE_PATH, revision(21));
  await eventuallyWorld(app, seed, temperatureShift(initial, -100));
  // Editors can replace the same file repeatedly before a restart settles.
  for (const baseline of [29, 27, 25]) await project.write(CLIMATE_PATH, revision(baseline));
  const newest = await eventuallyWorld(app, seed, temperatureShift(initial, -60));
  assert.deepEqual(newest.overview.fields.elevation, initial.overview.fields.elevation);
  assert.ok(temperatureShift(initial, -60)(await eventuallyWorld(app, seed, () => true)), 'The newest save remains served after restarts settle.');
  assert.equal((await fetch(`${app.origin}/api/ready`)).status, 200);
});

test('new shared, world and nested world dependencies reload and recover after restoration', async t => {
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
  // future watches, not only reload once because the existing worker graph was edited.
  const seed = 'Nested reload';
  const initial = await eventuallyWorld(app, seed, () => true);
  const nestedPath = 'src/world/nested/subdir/reload-test.ts';
  await assert.rejects(project.read(nestedPath), { code: 'ENOENT' });
  await assert.rejects(project.read('src/world/nested'), { code: 'ENOENT' });
  await project.write(nestedPath, 'export const nestedOffset = -10;\n');
  const climate = await project.read(CLIMATE_PATH);
  await project.write(CLIMATE_PATH, "import { nestedOffset } from '../nested/subdir/reload-test.ts';\n" +
    replaceOnce(climate, CLIMATE_MARKER, `return 31 + nestedOffset - 62`));
  await eventuallyWorld(app, seed, temperatureShift(initial, -100));
  // Only the newly created nested module changes; the worker must load its new value.
  await project.write(nestedPath, 'export const nestedOffset = -5;\n');
  const reloaded = await eventuallyWorld(app, seed, temperatureShift(initial, -50));
  assert.deepEqual(reloaded.overview.fields.elevation, initial.overview.fields.elevation);
  assert.equal((await fetch(`${app.origin}/api/ready`)).status, 200);
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
