import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { parseWorldManifest, parseWorldTile, inspectWorldCell, WORLD_BIOMES, isWorldWater } from '../shared/generated-world.ts';

test('actual generated hydrology travels through surface, sparse graph, exact tiles and water inspection', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'standard' });
  assert.ok(world.hydrology?.rivers.cells.length > 0, 'The real generator must supply connected rivers.');
  assert.ok(world.hydrology.lakes.some(lake => lake.outlet !== null), 'Exercise an outflowing lake.');
  assert.ok(world.hydrology.lakes.some(lake => lake.outlet === null), 'Exercise a closed lake.');
  const bundle = encodeGeneratedWorld(world), manifest = parseWorldManifest(JSON.parse(bundle.manifest));
  assert.deepEqual(manifest.hydrology, world.hydrology);
  for (const id of [world.hydrology.rivers.cells[0], ...world.hydrology.lakes.slice(0, 5).map(lake => lake.cells[0])]) {
    const x = id % world.width, y = Math.floor(id / world.width), tx = Math.floor(x / 128), ty = Math.floor(y / 128);
    const tile = parseWorldTile(JSON.parse(bundle.tiles[ty * (world.width / 128) + tx]), manifest, tx, ty);
    const cell = inspectWorldCell(manifest, tile, x, y);
    assert.ok(cell.water.kind === 'lake' || cell.water.kind === 'river');
    if (cell.water.kind === 'lake') assert.ok(cell.water.lake!.level > cell.elevation);
  }
  assert.equal(manifest.landCells, world.fields.biome.reduce((sum, code) => sum + Number(!isWorldWater(WORLD_BIOMES[code])), 0));
  for (const lake of world.hydrology.lakes) for (const id of lake.cells) {
    assert.ok(['lake', 'lakeIce'].includes(WORLD_BIOMES[world.fields.biome[id]]));
    assert.ok(world.fields.resource[id] === 0 || world.fields.resource[id] === 1, 'Submerged sites must not retain land extraction resources.');
  }
});

test('weak lake outlets retain their route to the sea or an explicit dry basin', async () => {
  const { generateHydrology } = await import('../src/world/generation/hydrology.ts');
  const { hydrologyGraph } = await import('../src/world/generation/hydrology-graph.ts');
  const width = 12, height = 10, elevation = new Int16Array(120).fill(105), moisture = new Uint16Array(120);
  elevation.fill(-100, 0, width); elevation.fill(-100, 108); elevation[53] = 100; moisture[53] = 900;
  const graph = hydrologyGraph(generateHydrology({ width, height, areaKm2: 120000, elevation, moisture }));
  assert.equal(graph.lakes[0].outlet?.runoff, 751);
  let id = graph.lakes[0].outlet!.next, steps = 0;
  while (elevation[id] >= 0) {
    const at = graph.rivers.cells.indexOf(id); assert.ok(at >= 0); id = graph.rivers.next[at]; assert.ok(++steps < 120);
  }
  const world = await generateWorld({ seed: 'Chronicle', size: 'standard' });
  assert.ok(world.hydrology.drySinks.length > 0, 'Preserve actual weak-outlet dry terminals.');
  assert.ok(world.hydrology.rivers.next.every(id => id >= 0));
  const manifest = parseWorldManifest(JSON.parse(encodeGeneratedWorld(world).manifest));
  for (const id of manifest.hydrology.drySinks) {
    assert.ok(!manifest.hydrology.rivers.cells.includes(id));
    const incoming = manifest.hydrology.rivers.next.reduce((sum, next, at) => sum + (next === id ? manifest.hydrology.rivers.runoff[at] : 0), 0)
      + manifest.hydrology.lakes.reduce((sum, lake) => sum + (lake.outlet?.next === id ? lake.outlet.runoff : 0), 0);
    assert.ok(incoming > 0 && incoming < 5000);
  }
});
