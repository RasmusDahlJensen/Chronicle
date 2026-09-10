import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../shared/generated-world.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import type { GeneratedWorld } from '../src/world/generation/generate.ts';
import { createFertilityContext, fertilityAt } from '../shared/fertility.ts';

// Explicit transport fixture. Single-cell shores must survive an overview sample that misses them.
function surfaceFixture(size: 'standard' | 'large'): GeneratedWorld {
  const { width, height } = contract.WORLD_SIZES[size];
  const count = width * height;
  const fields = { elevation: new Int16Array(count).fill(-11000), temperature: new Int16Array(count).fill(150),
    moisture: new Uint16Array(count).fill(500), biome: new Uint8Array(count), resource: new Uint8Array(count), fertility: new Uint8Array(count) };
  const land = [1, width - 1, width * 128 + 128, count - 2];
  for (const id of land) {
    fields.elevation[id] = 11999;
    fields.biome[id] = contract.WORLD_BIOMES.indexOf('mountain');
  }
  const hydrology = { drySinks: [] as number[], rivers: { cells: [], next: [], runoff: [] }, lakes: [] };
  const fertility = createFertilityContext(fields, { width, height, areaKm2: contract.WORLD_AREA_KM2 }, hydrology, contract.WORLD_BIOMES);
  for (const id of land) fields.fertility[id] = fertilityAt(fertility, id, fields.temperature[id] / 10, fields.moisture[id] / 1000).score;
  return { settings: { seed: 'Surface fidelity', size }, width, height, fields, hydrology };
}

test('overview preserves every terrain cell, including narrow coastlines and single-cell islands at both resolutions', () => {
  for (const size of ['standard', 'large'] as const) {
    const world = surfaceFixture(size);
    const bundle = encodeGeneratedWorld(world);
    const manifest = contract.parseWorldManifest(JSON.parse(bundle.manifest));
    assert.ok(manifest.surface, 'The overview must carry full-resolution terrain instead of only a coarse sample.');
    assert.equal(manifest.surface.width, world.width);
    assert.equal(manifest.surface.height, world.height);
    const surface = contract.decodeWorldSurface(manifest.surface);
    assert.deepEqual(surface.elevation, world.fields.elevation);
    assert.deepEqual(surface.biome, world.fields.biome);
    assert.ok(Buffer.byteLength(bundle.manifest) < contract.MAX_WORLD_MANIFEST_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(bundle)) < contract.MAX_WORLD_BUNDLE_BYTES);
    assert.equal(manifest.overview.fields.biome.filter(biome => biome !== 0).length, 0,
      'The old climate sample deliberately misses these tiny features; full terrain must still retain them.');
  }
});

test('malformed full-resolution surfaces and inconsistent summaries never reach the renderer', () => {
  const bundle = encodeGeneratedWorld(surfaceFixture('standard'));
  const manifest = JSON.parse(bundle.manifest);
  assert.ok(manifest.surface, 'A verified terrain surface is required.');
  const rejects = (change: Record<string, unknown>) => assert.throws(() => contract.parseWorldManifest({ ...manifest,
    surface: { ...manifest.surface, ...change } }), /invalid/);
  rejects({ width: 1024 });
  rejects({ encoding: 'unknown' });
  rejects({ data: manifest.surface.data.slice(4) });
  rejects({ data: `!${manifest.surface.data.slice(1)}` });
  rejects({ data: manifest.surface.data + 'AAAA' });
  function changedByte(offset: number, value: number) {
    const bytes = Buffer.from(manifest.surface.data, 'base64'); bytes[offset] = value;
    return bytes.toString('base64');
  }
  rejects({ data: changedByte(2, 255) }); // Invalid biome code.
  rejects({ data: changedByte(2, contract.WORLD_BIOMES.indexOf('grassland')) }); // Land below sea level.
  rejects({ data: changedByte(1, 127) }); // Elevation outside the contract range.
  rejects({ data: changedByte(5, contract.WORLD_BIOMES.indexOf('snow')) }); // Valid fields, wrong summary.
  const changedSample = structuredClone(manifest);
  changedSample.overview.fields.elevation[0] = -100;
  assert.throws(() => contract.parseWorldManifest(changedSample), /invalid/);
});
