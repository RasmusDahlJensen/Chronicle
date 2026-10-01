import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateHydrology, type Hydrology } from '../src/world/generation/hydrology.ts';

function bowl(depth = 5, wet = 900) {
  const width = 12, height = 10;
  const elevation = new Int16Array(width * height).fill(100 + depth);
  elevation.fill(-100, 0, width); elevation.fill(-100, elevation.length - width);
  for (let y = 3; y <= 5; y++) for (let x = 4; x <= 6; x++) elevation[y * width + x] = 100;
  for (let y = 1; y <= 3; y++) elevation[y * width + 7] = 100 + depth;
  return { width, height, areaKm2: width * height * 10000, elevation, moisture: new Uint16Array(width * height).fill(wet) };
}

function verifyGraph(result: Hydrology, width: number, height: number, elevation: Int16Array) {
  const count = width * height;
  for (let id = 0; id < count; id++) {
    const next = result.downstream[id];
    if (next >= 0) {
      const x = id % width, row = id - x;
      assert.ok([row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width].includes(next));
      assert.ok(next < count && result.waterLevel[next] <= result.waterLevel[id], `Uphill water ${id} -> ${next}`);
      assert.ok(result.runoff[next] >= result.runoff[id], 'Confluences retain incoming runoff');
    }
    let end = id, steps = 0;
    while (result.downstream[end] >= 0) { end = result.downstream[end]; assert.ok(++steps <= count, 'Drainage must not cycle'); }
    if (result.river[id]) assert.ok(result.ocean[end] || result.lake[end], 'Visible rivers terminate in ocean or a lake');
  }
  for (const lake of result.lakes) {
    assert.ok(lake.cells.length > 0);
    // No pond may sit above a dry neighbour other than its outlet's next cell (the water contract rejects leaks).
    const exit = lake.outlet === null ? -1 : result.downstream[lake.outlet];
    for (const id of lake.cells) {
      const x = id % width, row = id - x;
      for (const next of [row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width]) {
        if (next >= 0 && next < count && result.lake[next] !== lake.id && next !== exit) {
          assert.ok(elevation[next] >= lake.level, `Lake ${lake.id} leaks into ${next}`);
        }
      }
    }
    const exits = lake.cells.filter(cell => result.downstream[cell] >= 0 && result.lake[result.downstream[cell]] !== lake.id);
    assert.deepEqual(exits, lake.outlet === null ? [] : [lake.outlet]);
    for (const cell of lake.cells) { assert.equal(result.lake[cell], lake.id); assert.equal(result.waterLevel[cell], lake.level); }
  }
}

test('ocean connection uses longitude wrapping and preserves enclosed existing water at level zero', () => {
  const input = bowl(400); const before = input.elevation.slice();
  input.elevation[4 * input.width + 5] = -300;
  const original = input.elevation.slice();
  const result = generateHydrology(input);
  assert.deepEqual(input.elevation, original);
  assert.equal(result.ocean[0], 1);
  const inland = 4 * input.width + 5;
  assert.equal(result.ocean[inland], 0); assert.ok(result.lake[inland] > 0);
  assert.equal(result.waterLevel[inland], 0);
  assert.equal(result.lakes.find(lake => lake.id === result.lake[inland])!.outlet, null);
  assert.equal(result.lake[0], 0); assert.notDeepEqual(original, before);
  verifyGraph(result, input.width, input.height, input.elevation);
});

test('a wet shallow depression fills to its sill and has one connected outlet', () => {
  const input = bowl(); const result = generateHydrology(input);
  const lake = result.lakes.find(body => body.cells.includes(4 * input.width + 5));
  assert.ok(lake); assert.equal(lake.level, 105); assert.notEqual(lake.outlet, null);
  assert.equal(lake.cells.length, 9);
  verifyGraph(result, input.width, input.height, input.elevation);
});

test('deep inland basins become bounded terminal lakes without changing accepted bedrock', () => {
  const input = bowl(400); const before = input.elevation.slice();
  const result = generateHydrology(input);
  assert.deepEqual(input.elevation, before);
  const lake = result.lakes.find(body => body.cells.includes(4 * input.width + 5));
  assert.ok(lake); assert.ok(lake.level > 100 && lake.level <= 120); assert.equal(lake.outlet, null);
  for (let cell = 0; cell < before.length; cell++) if (before[cell] >= 0) assert.ok(result.waterLevel[cell] - before[cell] <= 20);
  verifyGraph(result, input.width, input.height, input.elevation);
});

test('dry catchments do not acquire permanent ponds or rivers from geometric depression filling', () => {
  const input = bowl(400, 100); const result = generateHydrology(input);
  assert.equal(result.lakes.length, 0); assert.ok(result.river.every(value => value === 0));
  assert.ok(result.runoff.every(value => value === 0));
  for (let cell = 0; cell < input.elevation.length; cell++) if (input.elevation[cell] >= 0) assert.equal(result.waterLevel[cell], input.elevation[cell]);
  verifyGraph(result, input.width, input.height, input.elevation);
});

test('wet upstream supply sustains a terminal lake even when the basin floor is dry', () => {
  const input = bowl(400);
  for (let y = 3; y <= 5; y++) for (let x = 4; x <= 6; x++) input.moisture[y * input.width + x] = 100;
  const result = generateHydrology(input);
  assert.ok(result.lakes.some(body => body.cells.includes(4 * input.width + 5)));
  assert.ok(result.river.some(value => value !== 0));
  verifyGraph(result, input.width, input.height, input.elevation);
});

test('seam drainage, plateau tie breaking and independent calls are deterministic', () => {
  const input = bowl();
  for (let y = 0; y < input.height; y++) input.elevation[y * input.width + input.width - 1] = -100;
  const a = generateHydrology(input); generateHydrology(bowl(400)); const repeat = generateHydrology(input);
  assert.deepEqual(a, repeat);
  assert.equal(a.downstream[4 * input.width], 4 * input.width + input.width - 1);
  assert.notEqual(a.downstream.buffer, repeat.downstream.buffer);
  verifyGraph(a, input.width, input.height, input.elevation);
});

test('invalid hydrology inputs fail explicitly before allocation or graph traversal', () => {
  const input = bowl();
  for (const areaKm2 of [0, -1, NaN, Infinity, 2 ** 32]) assert.throws(() => generateHydrology({ ...input, areaKm2 }), /hydrology/i);
  for (const width of [0, 1.5, 2 ** 30]) assert.throws(() => generateHydrology({ ...input, width }), /hydrology/i);
  assert.throws(() => generateHydrology({ ...input, moisture: input.moisture.subarray(1) }), /hydrology/i);
  const moisture = input.moisture.slice(); moisture[0] = 1001;
  assert.throws(() => generateHydrology({ ...input, moisture }), /hydrology/i);
});

test('a basin whose entire flat floor exceeds the permitted lake footprint fails instead of silently flooding it', () => {
  const input = bowl(400); input.areaKm2 *= 100;
  assert.throws(() => generateHydrology(input), /hydrology.*(resolve|converge)/i);
});

test('lake confluences preserve the exact sum of runoff and every marked river segment stays connected', () => {
  const input = bowl(); const result = generateHydrology(input);
  const expected = input.moisture.reduce((sum, value, cell) => sum + (input.elevation[cell] < 0 ? 0
    : Math.round(input.areaKm2 / input.elevation.length * (Math.max(0, value - 250) / 750) ** 2)), 0);
  const delivered = result.runoff.reduce((sum, value, cell) => sum + (result.downstream[cell] < 0 ? value : 0), 0);
  assert.equal(delivered, expected);
  for (let cell = 0; cell < result.river.length; cell++) if (result.river[cell]) {
    const next = result.downstream[cell];
    assert.ok(next >= 0); assert.ok(result.river[next] || result.lake[next] || result.ocean[next]);
  }
});

test('retention that alternates between a dry terminal and an unsupplied pond converges with a fixed pond (G1)', () => {
  // Found by random search: generator 5 cycled on this terrain forever ("did not converge within 12 drainage passes").
  const width = 8, height = 7;
  const elevation = Int16Array.from([-100, -100, -100, -100, -100, -100, -100, -100, 12, 12, 12, 13, 13, 11, 10, 12, 12, 12, 12, 13, 12, 10, 12, 12,
    12, 11, 12, 11, 13, 13, 13, 13, 11, 10, 13, 12, 11, 12, 13, 13, 13, 12, 13, 10, 12, 11, 11, 12, -100, -100, -100, -100, -100, -100, -100, -100]);
  const moisture = Uint16Array.from([300, 300, 1000, 1000, 1000, 300, 300, 1000, 1000, 300, 1000, 300, 1000, 1000, 300, 300, 1000, 300, 1000, 300, 1000,
    300, 300, 1000, 300, 1000, 300, 300, 300, 300, 300, 1000, 1000, 300, 1000, 300, 300, 1000, 1000, 1000, 300, 1000, 300, 1000, 1000, 300, 1000, 300,
    1000, 300, 300, 1000, 300, 1000, 300, 300]);
  const input = { width, height, areaKm2: width * height * 5000, elevation, moisture };
  const result = generateHydrology(input);
  verifyGraph(result, width, height, elevation);
  assert.ok(result.river.some(value => value !== 0), 'The scenario keeps a river that must end in water');
  for (const lake of result.lakes) assert.ok(lake.level - Math.min(...lake.cells.map(cell => elevation[cell])) <= 20);
  assert.deepEqual(generateHydrology(input), result, 'The cycle resolution is deterministic');
});

test('accepted Harbors terrain drains wet tributaries through lakes without losing their final sink', async () => {
  const { generateTectonicCrust } = await import('../src/world/generation/tectonics.ts');
  const { refineTectonicCrust } = await import('../src/world/generation/tectonic-geography.ts');
  const { seedNumber } = await import('../src/world/generation/noise.ts');
  const { moistureField } = await import('../src/world/generation/climate.ts');
  const seed = seedNumber('Harbors'); const values = await generateTectonicCrust(seed);
  const width = 1024, height = 512;
  const elevation = refineTectonicCrust({ width: 512, height: 256, values }, width, height, seed);
  const before = elevation.slice();
  const result = generateHydrology({ width, height, areaKm2: 510e6, elevation, moisture: moistureField(width, height, elevation, seed) });
  assert.deepEqual(elevation, before);
  assert.ok(result.lakes.length > 5 && result.river.some(value => value !== 0));
  let newlyWet = 0;
  for (let cell = 0; cell < elevation.length; cell++) {
    if (elevation[cell] >= 0) { assert.ok(result.waterLevel[cell] - elevation[cell] <= 20); if (result.lake[cell]) newlyWet++; }
    if (result.river[cell]) { const next = result.downstream[cell]; assert.ok(next >= 0 && (result.river[next] || result.lake[next] || result.ocean[next])); }
  }
  assert.ok(newlyWet < elevation.length * 0.02, 'Drainage must preserve the accepted continental appearance');
});
