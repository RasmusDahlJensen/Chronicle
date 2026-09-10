import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTerrainCompute } from '../server/compute.ts';
import { parseWorldManifest } from '../shared/generated-world.ts';

test('cancelling a real tectonic job releases its worker and the next world still completes', async t => {
  const compute = createTerrainCompute({ workers: 1, maxQueue: 0, jobTimeoutMs: 20_000, shutdownTimeoutMs: 1000 });
  t.after(() => compute.close());
  await compute.ready();
  const controller = new AbortController();
  const reason = new Error('The viewer left during tectonic generation.');
  const cancelled = compute.generate(controller.signal, { kind: 'world', seed: 'Cancelled', size: 'standard' });
  assert.equal(compute.snapshot().active, 1);
  const timer = setTimeout(() => controller.abort(reason), 250);
  try { await assert.rejects(cancelled, error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(compute.snapshot().active + compute.snapshot().queued, 0);
  const body = await compute.generate(undefined, { kind: 'world', seed: 'Recovery', size: 'standard' });
  const bundle = JSON.parse(body);
  const world = parseWorldManifest(JSON.parse(bundle.manifest));
  assert.equal(world.settings.seed, 'Recovery');
  assert.equal(world.width * world.height, 131072);
  assert.equal(compute.snapshot().completed, 1);
  assert.equal(compute.snapshot().failed, 1);
});
