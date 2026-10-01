import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeneratedWorldStore } from '../server/generated-world-store.ts';
import { ComputeClosedError, ComputeOverloadedError, ComputeTimeoutError, type TerrainCompute } from '../server/compute.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import type { WorldSettings } from '../shared/generated-world.ts';

// Control CPU completion to test real store lifecycle ordering without timing guesses.
// Bundles still come from the real generator, encoder and validation contract.
function controlledCompute() {
  const jobs: { signal: AbortSignal; settings: WorldSettings; resolve(body: string): void; reject(error: Error): void }[] = [];
  const compute: TerrainCompute = {
    ready: async () => {}, close: async () => {},
    snapshot: () => ({ workers: 1, active: 0, queued: 0, completed: 0, failed: 0 }),
    generate(signal, study) {
      assert.ok(signal && study && typeof study === 'object' && study.kind === 'world');
      return new Promise<string>((resolve, reject) => {
        const cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
        jobs.push({ signal, settings: { seed: study.seed, size: study.size },
          resolve: body => { signal.removeEventListener('abort', cancel); resolve(body); },
          reject: error => { signal.removeEventListener('abort', cancel); reject(error); },
        });
      });
    },
  };
  return { jobs, store: createGeneratedWorldStore(compute) };
}
const settings: WorldSettings = { seed: 'Lifecycle', size: 'standard' };
let body: Promise<string>;
function validBody() { return body ??= generateWorld(settings).then(world => JSON.stringify(encodeGeneratedWorld(world))); }

test('one disconnected observer cannot cancel a generation another observer still needs', async () => {
  const { jobs, store } = controlledCompute();
  const first = new AbortController(); const second = new AbortController();
  const cancelled = assert.rejects(store.get(settings, first.signal), /first left/);
  const survivor = store.get(settings, second.signal);
  first.abort(new Error('first left'));
  await cancelled;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].signal.aborted, false);
  jobs[0].resolve(await validBody());
  assert.equal((await survivor).manifest, JSON.parse(await validBody()).manifest);
  assert.equal((await store.get(settings, second.signal)).manifest, JSON.parse(await validBody()).manifest);
  assert.equal(jobs.length, 1);
  store.close();
});

test('last observer departure cancels disposable work and a new request can retry immediately', async () => {
  const { jobs, store } = controlledCompute();
  const controller = new AbortController();
  const cancelled = assert.rejects(store.get(settings, controller.signal), /left/);
  controller.abort(new Error('left'));
  await cancelled;
  assert.equal(jobs[0].signal.aborted, true);
  const retry = store.get(settings, new AbortController().signal);
  assert.equal(jobs.length, 2);
  jobs[1].resolve(await validBody());
  assert.ok((await retry).tiles.length > 0);
  store.close();
});

test('two in-flight worlds bound admission, failed entries release capacity, and close cancels both', async () => {
  const { jobs, store } = controlledCompute();
  const signal = new AbortController().signal;
  const a = assert.rejects(store.get(settings, signal), ComputeTimeoutError);
  const b = assert.rejects(store.get({ ...settings, seed: 'Second' }, signal), ComputeClosedError);
  await assert.rejects(async () => store.get({ ...settings, seed: 'Third' }, signal), ComputeOverloadedError);
  assert.equal(jobs.length, 2);
  jobs[0].reject(new ComputeTimeoutError());
  await a;
  const c = assert.rejects(store.get({ ...settings, seed: 'Third' }, signal), ComputeClosedError);
  assert.equal(jobs.length, 3);
  store.close();
  await Promise.all([b, c]);
  assert.ok(jobs[1].signal.aborted && jobs[2].signal.aborted);
  await assert.rejects(async () => store.get(settings, signal), ComputeClosedError);
});

test('malformed or mismatched worker results never poison a later valid request', async () => {
  const { jobs, store } = controlledCompute();
  const signal = new AbortController().signal;
  for (const invalid of ['null', '{broken', JSON.stringify({ manifest: '{}', tiles: [] })]) {
    const rejected = assert.rejects(store.get(settings, signal));
    jobs.at(-1)!.resolve(invalid);
    await rejected;
  }
  const retry = store.get(settings, signal);
  jobs.at(-1)!.resolve(await validBody());
  assert.ok((await retry).tiles.length > 0);
  store.close();
});
