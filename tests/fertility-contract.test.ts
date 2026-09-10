import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { parseWorldManifest, parseWorldTile, inspectWorldCell, WORLD_GENERATOR_VERSION, WORLD_PROTOCOL_VERSION } from '../shared/generated-world.ts';

test('fertility survives real generation and transport while malformed or contradictory scores are rejected', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'standard' });
  const bundle = encodeGeneratedWorld(world);
  const manifest = parseWorldManifest(JSON.parse(bundle.manifest));
  assert.equal(manifest.generatorVersion, WORLD_GENERATOR_VERSION); assert.equal(manifest.protocolVersion, WORLD_PROTOCOL_VERSION);
  assert.ok(world.fields.fertility.some(score => score >= 60), 'world contains useful growing land');
  const tile = parseWorldTile(JSON.parse(bundle.tiles[0]), manifest, 0, 0);
  for (const score of [undefined, [], -1, 101, 1.5, NaN]) {
    const changed = (values: number[]) => typeof score === 'number' ? values.map((value, id) => id === 0 ? score : value) : score;
    const fields = { ...tile.fields, fertility: changed(tile.fields.fertility) };
    assert.throws(() => parseWorldTile({ ...tile, fields }, manifest, 0, 0), /invalid/);
    assert.throws(() => parseWorldManifest({ ...manifest, overview: { ...manifest.overview, fields: { ...manifest.overview.fields, fertility: changed(manifest.overview.fields.fertility) } } }), /invalid/);
  }
  const changedTile = structuredClone(tile);
  changedTile.fields.fertility[0] = (tile.fields.fertility[0] + 1) % 101;
  assert.throws(() => parseWorldTile(changedTile, manifest, 0, 0), /invalid/);
  const changedManifest = structuredClone(manifest);
  changedManifest.overview.fields.fertility[0] = (manifest.overview.fields.fertility[0] + 1) % 101;
  assert.throws(() => parseWorldManifest(changedManifest), /invalid/);
  // Check exact land and water inspection, not only a sampled climate overview.
  for (const applicable of [true, false]) {
    const id = world.fields.fertility.findIndex(value => applicable ? value > 0 : value === 0);
    const x = id % world.width, y = Math.floor(id / world.width), tx = Math.floor(x / 128), ty = Math.floor(y / 128);
    const detail = parseWorldTile(JSON.parse(bundle.tiles[ty * world.width / 128 + tx]), manifest, tx, ty);
    const cell = inspectWorldCell(manifest, detail, x, y);
    assert.equal(cell.fertility.score, world.fields.fertility[id]);
    if (applicable) assert.equal(cell.fertility.applicable, true);
  }
});
