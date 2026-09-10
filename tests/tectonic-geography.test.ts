import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCrustSampler, refineTectonicCrust } from '../src/world/generation/tectonic-geography.ts';

function crust() {
  const width = 64, height = 32;
  const values = Float32Array.from({ length: width * height }, (_, id) => {
    const x = id % width, y = Math.floor(id / width);
    return x > 12 && x < 46 && y > 4 && y < 27 ? 1.2 + y / height + Math.sin(x / 7) ** 2 : 0.1 + y / height * 0.3;
  });
  return { width, height, values };
}

function landSizes(elevation: Int16Array, width: number, height: number) {
  const visited = new Uint8Array(elevation.length), sizes: number[] = [];
  for (let first = 0; first < elevation.length; first++) {
    if (visited[first] || elevation[first] < 0) continue;
    const queue = [first]; visited[first] = 1;
    for (let at = 0; at < queue.length; at++) {
      const id = queue[at], x = id % width, row = id - x;
      for (const next of [row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width]) {
        if (next < 0 || next >= width * height || visited[next] || elevation[next] < 0) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

test('crust sampling wraps longitude while latitude remains bounded at distinct cut edges', () => {
  const sample = createCrustSampler(crust());
  for (const v of [0, 0.2, 0.7, 1]) {
    assert.equal(sample(0, v), sample(1, v));
    assert.equal(sample(-0.2, v), sample(0.8, v));
  }
  assert.equal(sample(0.3, -1), sample(0.3, 0));
  assert.equal(sample(0.3, 2), sample(0.3, 1));
  assert.notEqual(sample(0.3, 0), sample(0.3, 1), 'The opposite poles must not become adjacent periodic samples.');
});

test('resolution refines the same continent and preserves finite metre elevations and ocean poles', () => {
  const source = crust();
  const small = refineTectonicCrust(source, 128, 64, 91);
  const large = refineTectonicCrust(source, 256, 128, 91);
  assert.deepEqual(small, refineTectonicCrust(source, 128, 64, 91));
  let agreed = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const land = small[y * 128 + x] >= 0;
    const samples = [large[y * 2 * 256 + x * 2], large[y * 2 * 256 + x * 2 + 1], large[(y * 2 + 1) * 256 + x * 2], large[(y * 2 + 1) * 256 + x * 2 + 1]];
    if (land === (samples.reduce((sum, elevation) => sum + elevation, 0) >= 0)) agreed++;
  }
  assert.ok(agreed / small.length > 0.985, `Changing resolution moved too much coastline: ${agreed / small.length}`);
  for (const elevation of large) assert.ok(elevation >= -10000 && elevation <= 8800);
  assert.ok(large.slice(0, 256).every(elevation => elevation < 0));
  assert.ok(large.slice(-256).every(elevation => elevation < 0));
  assert.ok(large.some(elevation => elevation > 1000));
});

test('invalid crust is rejected before typed-array conversion can turn corruption into land', () => {
  for (const value of [NaN, Infinity, -Infinity, -1]) {
    const source = crust(); source.values[500] = value;
    assert.throws(() => refineTectonicCrust(source, 128, 64, 91), /crust/i);
  }
  const source = crust();
  assert.throws(() => createCrustSampler({ ...source, values: source.values.subarray(1) }), /crust/i);
});

test('high coastal relief cannot bridge a donor strait when atlas resolution increases', () => {
  const values = new Float32Array(64 * 32).fill(0.1);
  for (let y = 10; y < 21; y++) for (let x = 8; x < 34; x++) {
    if (x !== 26) values[y * 64 + x] = 6;
  }
  const source = { width: 64, height: 32, values };
  for (const width of [64, 128, 256]) {
    const pieces = landSizes(refineTectonicCrust(source, width, width / 2, 91), width, width / 2);
    assert.equal(pieces.length, 2, `The one-donor-cell sea strait must remain open at width ${width}`);
  }
  const low = { ...source, values: Float32Array.from(values, value => value >= 1 ? 1.5 : value) };
  const highCoast = refineTectonicCrust(source, 128, 64, 91);
  const lowCoast = refineTectonicCrust(low, 128, 64, 91);
  assert.deepEqual(Array.from(highCoast, value => value >= 0), Array.from(lowCoast, value => value >= 0),
    'Changing the altitude of existing land must not move its donor coastline');
  assert.ok(highCoast.some((value, index) => value > lowCoast[index] + 1000), 'The coastline rule must preserve relief differences');
});

test('opening the donor torus retains a small island outside the immediate polar transition', () => {
  // Equal land counts in every donor row make the ocean-cut choice unambiguous.
  // A four-by-four island lies beside the first few rows, away from the cut itself.
  const values = new Float32Array(64 * 64).fill(0.1);
  for (let y = 0; y < 64; y++) {
    for (let x = 10; x < 20; x++) values[y * 64 + x] = 1.5;
    if (y >= 5 && y < 9) {
      for (let x = 10; x < 14; x++) values[y * 64 + x] = 0.1;
      for (let x = 40; x < 44; x++) values[y * 64 + x] = 1.5;
    }
  }
  for (const width of [64, 128, 256]) {
    const elevation = refineTectonicCrust({ width: 64, height: 64, values }, width, width, 91);
    const pieces = landSizes(elevation, width, width);
    assert.equal(pieces.length, 2);
    assert.ok(pieces[1] >= 14 * (width / 64) ** 2, `The donor's 16-cell island was truncated at width ${width}: ${pieces[1]} cells`);
    assert.ok(elevation.slice(0, width).every(value => value < 0));
    assert.ok(elevation.slice(-width).every(value => value < 0));
  }
});
