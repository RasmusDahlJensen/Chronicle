import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateTectonicCrust, TECTONIC_WIDTH, TECTONIC_HEIGHT } from '../src/world/generation/tectonics.ts';
import { runPlatec } from '../vendor/platec/runtime.ts';
import type { PlatecModule } from '../vendor/platec/platec.d.mts';
import createPlatec from '../vendor/platec/platec.mjs';

const cells = 512 * 256;

function boundary() {
  let heap: Float32Array = new Float32Array(cells + 8).fill(1.25);
  let destroyed = 0;
  let steps = 0;
  let receivedSeed = -1;
  const module: PlatecModule = {
    get HEAPF32() { return heap; },
    _chronicle_platec_create(seed, width, height) {
      receivedSeed = seed;
      assert.equal(width, 512);
      assert.equal(height, 256);
      return 4;
    },
    _chronicle_platec_destroy(handle) { assert.equal(handle, 4); destroyed++; heap.fill(-99); },
    _chronicle_platec_heightmap() { return 16; },
    _chronicle_platec_finished() { return steps >= 1 ? 1 : 0; },
    _chronicle_platec_step() { steps++; },
  };
  return {
    module, get destroyed() { return destroyed; }, get steps() { return steps; },
    get receivedSeed() { return receivedSeed; }, get heap() { return heap; },
    replaceHeap(next: Float32Array) { heap = next; },
  };
}

test('tectonic seeds are validated before allocating a WASM instance', async () => {
  for (const seed of [-1, 2 ** 32, 0.25, NaN, Infinity]) {
    await assert.rejects(runPlatec(seed, async () => { assert.fail('Invalid seed reached WASM allocation'); }), /uint32/);
    await assert.rejects(generateTectonicCrust(seed), /uint32/);
  }
  for (const seed of [0, 2436358115, 4294967295]) {
    const fake = boundary();
    await runPlatec(seed, async () => fake.module);
    assert.equal(fake.receivedSeed, seed);
    assert.equal(fake.destroyed, 1);
  }
});

test('tectonic output is copied from the current heap after growth and survives cleanup', async () => {
  const fake = boundary();
  const obsolete = fake.heap;
  fake.module._chronicle_platec_step = () => {
    const grown = new Float32Array(cells + 16).fill(2.5);
    fake.replaceHeap(grown);
    fake.module._chronicle_platec_finished = () => 1;
  };
  const result = await runPlatec(42, async () => fake.module);
  assert.equal(result.length, cells);
  assert.equal(result.buffer.byteLength, cells * 4);
  assert.ok(result.every(value => value === 2.5));
  assert.notEqual(result.buffer, obsolete.buffer);
  assert.notEqual(result.buffer, fake.heap.buffer);
  assert.equal(fake.destroyed, 1);
});

test('failed tectonic jobs clean up and a later instance remains usable', async () => {
  const broken = boundary();
  broken.module._chronicle_platec_step = () => { throw new Error('Tectonic step failed'); };
  await assert.rejects(runPlatec(42, async () => broken.module), /Tectonic step failed/);
  assert.equal(broken.destroyed, 1);
  const healthy = boundary();
  assert.ok((await runPlatec(42, async () => healthy.module)).every(value => value === 1.25));
  assert.equal(healthy.destroyed, 1);
  assert.notEqual(broken.heap.buffer, healthy.heap.buffer);
});

test('tectonic work stops at 2500 steps and destroys the unfinished simulation', async () => {
  const fake = boundary();
  fake.module._chronicle_platec_finished = () => 0;
  await assert.rejects(runPlatec(42, async () => fake.module), /step limit/);
  assert.equal(fake.steps, 2500);
  assert.equal(fake.destroyed, 1);
});

test('tectonic heightmap pointers and field values cannot cross the WASM boundary unchecked', async () => {
  for (const pointer of [0, -4, 3, (cells + 5) * 4]) {
    const fake = boundary();
    fake.module._chronicle_platec_heightmap = () => pointer;
    await assert.rejects(runPlatec(42, async () => fake.module), /heightmap/);
    assert.equal(fake.destroyed, 1);
  }
  for (const invalid of [NaN, Infinity, -0.01]) {
    const fake = boundary();
    fake.heap[4 + cells - 1] = invalid;
    await assert.rejects(runPlatec(42, async () => fake.module), /heightmap/);
    assert.equal(fake.destroyed, 1);
  }
  const failed = boundary();
  failed.module._chronicle_platec_create = () => 0;
  await assert.rejects(runPlatec(42, async () => failed.module), /create/);
  assert.equal(failed.destroyed, 0);
});

test('a tectonic heap exceeding 128 MiB is rejected and cleaned up', async () => {
  const fake = boundary();
  fake.replaceHeap(new Float32Array(128 * 1024 * 1024 / 4 + 1));
  let destroyed = false;
  fake.module._chronicle_platec_destroy = () => { destroyed = true; };
  await assert.rejects(runPlatec(42, async () => fake.module), /heightmap memory/);
  assert.equal(destroyed, true);
});

test('vendored WASM manifest verifies the artifact and rejects source or binary drift', async t => {
  const root = new URL('../', import.meta.url);
  const checked = spawnSync(process.execPath, ['scripts/build-platec.ts', '--check'], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(checked.error);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const manifest = JSON.parse(await readFile(new URL('../vendor/platec/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.compiler.version, '6.0.5');
  assert.equal(manifest.upstream.commit, '2a27c4fb137c657517bca62122b9de80e6b8c255');
  assert.ok(manifest.compiler.flags.includes('-fwasm-exceptions'));
  assert.ok(manifest.compiler.flags.includes('-sMAXIMUM_MEMORY=134217728'));

  const copied = await mkdtemp(join(tmpdir(), 'chronicle-platec-integrity-'));
  t.after(() => rm(copied, { recursive: true, force: true }));
  await mkdir(join(copied, 'scripts'));
  await copyFile(new URL('../scripts/build-platec.ts', import.meta.url), join(copied, 'scripts/build-platec.ts'));
  await cp(new URL('../vendor/platec', import.meta.url), join(copied, 'vendor/platec'), { recursive: true });
  const verifyCopy = () => spawnSync(process.execPath, ['scripts/build-platec.ts', '--check'], {
    cwd: copied, encoding: 'utf8', timeout: 15000,
  });
  await appendFile(join(copied, 'vendor/platec/src/noise.cpp'), '\n// Deliberate unbuilt source edit.\n');
  const changedSource = verifyCopy();
  assert.ifError(changedSource.error);
  assert.notEqual(changedSource.status, 0);
  assert.match(changedSource.stderr, /source or compiler configuration changed/);
  await copyFile(new URL('../vendor/platec/src/noise.cpp', import.meta.url), join(copied, 'vendor/platec/src/noise.cpp'));
  await appendFile(join(copied, 'vendor/platec/platec.mjs'), '\n// Deliberate artifact edit.\n');
  const changedArtifact = verifyCopy();
  assert.ifError(changedArtifact.error);
  assert.notEqual(changedArtifact.status, 0);
  assert.match(changedArtifact.stderr, /artifact checksum mismatch/);
});

test('seed bits above the lowest byte change the initial tectonic field', async () => {
  const initial: Float32Array[] = [];
  for (const seed of [42, 298]) {
    const module = await createPlatec();
    const handle = module._chronicle_platec_create(seed, 64, 32, 0.65, 60, 0.02, 1000000, 0.33, 2, 10);
    try {
      const start = module._chronicle_platec_heightmap(handle) / 4;
      initial.push(module.HEAPF32.slice(start, start + 64 * 32));
    } finally {
      module._chronicle_platec_destroy(handle);
    }
  }
  assert.notDeepEqual(initial[0], initial[1], 'Seeds differing by 256 must not share their initial field');
});

test('real tectonics isolates A → B → A jobs, high seeds and the former zero-RNG crash', { timeout: 60000 }, async t => {
  t.mock.method(Math, 'random', () => assert.fail('Tectonics used ambient randomness'));
  t.mock.method(Date, 'now', () => assert.fail('Tectonics used ambient time'));
  t.mock.method(globalThis, 'fetch', () => assert.fail('The committed WASM tried to download runtime assets'));
  assert.equal(TECTONIC_WIDTH, 512);
  assert.equal(TECTONIC_HEIGHT, 256);
  const digest = (values: Float32Array) => createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
  const a = await generateTectonicCrust(2436358115);
  assert.equal(a.length, cells);
  assert.ok(a.every(value => Number.isFinite(value) && value >= 0));
  const original = digest(a);
  a[0] = -100;
  const b = await generateTectonicCrust(50000);
  const repeat = await generateTectonicCrust(2436358115);
  assert.notEqual(digest(b), original);
  assert.equal(digest(repeat), original);
  assert.equal(a[0], -100, 'A later job must not reuse the earlier returned buffer');
  assert.equal(repeat.buffer.byteLength, cells * 4, 'The result must not retain the WASM heap');
  assert.notEqual(a.buffer, b.buffer);
  assert.notEqual(a.buffer, repeat.buffer);
});
