import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  WORLD_PROTOCOL_VERSION, WORLD_GENERATOR_VERSION, WORLD_BIOMES, worldKey,
  parseWorldManifest, parseWorldTile, inspectWorldCell,
} from '../shared/generated-world.ts';
import { createFertilityContext, fertilityAt } from '../shared/fertility.ts';

function fixture() {
  const width = 512, height = 256, count = width * height;
  const fields = { elevation: new Array(count).fill(100), temperature: new Array(count).fill(120),
    moisture: new Array(count).fill(600), biome: new Array(count).fill(WORLD_BIOMES.indexOf('grassland')), resource: new Array(count).fill(0),
    fertility: new Array(count).fill(0) };
  const cell = (x: number, y: number) => y * width + x;
  for (let x = 0; x < width; x++) { fields.elevation[x] = -100; fields.biome[x] = WORLD_BIOMES.indexOf('coast'); }
  const rivers = { cells: [] as number[], next: [] as number[], runoff: [] as number[] };
  for (let y = 8; y > 0; y--) {
    rivers.cells.push(cell(20, y)); rivers.next.push(cell(20, y - 1)); rivers.runoff.push(10000 + (8 - y) * 1000);
    fields.elevation[cell(20, y)] = y * 5;
  }
  rivers.cells.push(cell(21, 10)); rivers.next.push(cell(21, 9)); rivers.runoff.push(8000);
  fields.elevation[cell(21, 10)] = 50;
  const lakes = [
    { id: 1, cells: [cell(20, 9), cell(21, 9)], level: 45, outlet: { cell: cell(20, 9), next: cell(20, 8), runoff: 10000 } },
    { id: 2, cells: [cell(60, 15), cell(61, 15)], level: 0, outlet: null },
  ];
  for (const lake of lakes) for (const id of lake.cells) {
    fields.elevation[id] = lake.id === 1 ? 30 : -20;
    fields.biome[id] = (WORLD_BIOMES as readonly string[]).indexOf(lake.id === 1 ? 'lake' : 'lakeIce');
    if (lake.id === 2) fields.temperature[id] = -150;
  }
  const hydrology = { drySinks: [] as number[], rivers, lakes };
  const fertility = createFertilityContext(fields, { width, height, areaKm2: 510000000 }, hydrology, WORLD_BIOMES);
  for (let id = 0; id < count; id++) fields.fertility[id] = fertilityAt(fertility, id, fields.temperature[id] / 10, fields.moisture[id] / 1000).score;
  function section(startX: number, startY: number, w: number, h: number, step = 1) {
    const result = { elevation: [] as number[], temperature: [] as number[], moisture: [] as number[], biome: [] as number[], resource: [] as number[], fertility: [] as number[] };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const id = cell(startX + x * step + Math.floor(step / 2), startY + y * step + Math.floor(step / 2));
      for (const key of Object.keys(result) as (keyof typeof result)[]) result[key].push(fields[key][id]);
    }
    return result;
  }
  const bytes = Buffer.alloc(count * 3), biomeCounts = WORLD_BIOMES.map(() => 0);
  for (let id = 0; id < count; id++) {
    bytes.writeInt16LE(fields.elevation[id], id * 3); bytes[id * 3 + 2] = fields.biome[id]; biomeCounts[fields.biome[id]]++;
  }
  const settings = { seed: 'Water fixture', size: 'standard' as const };
  const manifest = { protocolVersion: WORLD_PROTOCOL_VERSION, generatorVersion: WORLD_GENERATOR_VERSION, worldKey: worldKey(settings), settings,
    width, height, tileSize: 128, topology: 'wrap-x', projection: 'cylindrical-equal-area', areaKm2: 510000000,
    landCells: count - 512 - 4, resourceSites: 0, biomeCounts,
    overview: { width: 256, height: 128, fields: section(0, 0, 256, 128, 2) },
    surface: { width, height, encoding: 'elevation-i16le-biome-u8', data: bytes.toString('base64') }, hydrology };
  const tile = { protocolVersion: WORLD_PROTOCOL_VERSION, worldKey: manifest.worldKey, x: 0, y: 0, width: 128, height: 128, fields: section(0, 0, 128, 128) };
  return { manifest, tile, cell };
}

test('hydrology survives manifest/tile validation and supplies exact river, lake and shore inspection', () => {
  const raw = fixture(), manifest = parseWorldManifest(raw.manifest), tile = parseWorldTile(raw.tile, manifest, 0, 0);
  const river = inspectWorldCell(manifest, tile, 20, 8);
  assert.equal(river.water.kind, 'river'); assert.equal(river.water.runoff, 10000); assert.equal(river.water.freshwater, 'river');
  const lake = inspectWorldCell(manifest, tile, 20, 9);
  assert.equal(lake.elevation, 30); assert.equal(lake.water.kind, 'lake'); assert.equal(lake.water.freshwater, 'lake');
  assert.deepEqual(lake.water.lake, { id: 1, areaKm2: 2 * 510000000 / 131072, level: 45, depth: 15, closed: false });
  assert.equal(inspectWorldCell(manifest, tile, 19, 9).water.freshwater, 'lakeshore');
  const closed = inspectWorldCell(manifest, tile, 60, 15);
  assert.equal(closed.biome, 'lakeIce'); assert.equal(closed.water.freshwater, 'none'); assert.equal(closed.water.lake?.closed, true);
  assert.equal(inspectWorldCell(manifest, tile, 20, 0).water.kind, 'ocean');
  assert.equal(inspectWorldCell(manifest, tile, 90, 30).water.kind, 'dry');
});

test('malformed water graphs cannot publish contradictory or disconnected map features', () => {
  const mutations: ((raw: ReturnType<typeof fixture>) => void)[] = [
    r => r.manifest.hydrology.rivers.next.pop(),
    r => { r.manifest.hydrology.lakes[1].level = 12000; },
    r => { r.manifest.hydrology.lakes[0].outlet = null; },
    r => {
      const bytes = Buffer.from(r.manifest.surface.data, 'base64');
      bytes.writeInt16LE(31, r.cell(20, 10) * 3); r.manifest.surface.data = bytes.toString('base64');
    },
    r => { r.manifest.hydrology.drySinks.push(r.cell(80, 80)); },
    r => { r.manifest.hydrology.lakes[0].level = 40; r.manifest.hydrology.rivers.next[0] = r.cell(20, 9); },
    r => {
      r.manifest.hydrology.rivers.runoff.fill(510000000); r.manifest.hydrology.lakes[0].outlet!.runoff = 510000000;
      r.manifest.hydrology.rivers.cells.push(r.cell(30, 1)); r.manifest.hydrology.rivers.next.push(r.cell(30, 0));
      r.manifest.hydrology.rivers.runoff.push(510000000);
    },
    r => { r.manifest.hydrology.rivers.cells[1] = r.manifest.hydrology.rivers.cells[0]; },
    r => { r.manifest.hydrology.rivers.next[0] = r.cell(80, 80); },
    r => { r.manifest.hydrology.rivers.next[0] = r.cell(21, 8); },
    r => { r.manifest.hydrology.rivers.runoff[1] = 1; },
    r => { r.manifest.hydrology.lakes[0].level = 10; },
    r => { r.manifest.hydrology.lakes[0].cells.push(r.cell(60, 15)); },
    r => { r.manifest.hydrology.lakes[0].cells.pop(); },
    r => { r.manifest.hydrology.lakes[0].cells[1] = r.cell(21, 10); },
    r => { r.manifest.hydrology.lakes[0].outlet!.next = r.cell(80, 80); },
    r => { r.manifest.hydrology.lakes[0].outlet!.cell = r.cell(20, 8); },
    r => { r.manifest.hydrology.lakes[0].outlet!.runoff = 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const raw = fixture(); mutate(raw);
    assert.throws(() => parseWorldManifest(raw.manifest), /invalid/, `Malformed water graph ${index}`);
  }
});

test('a constant-height river loop is rejected even though each edge is adjacent and non-uphill', () => {
  const raw = fixture();
  const a = raw.cell(80, 80), b = a + 1;
  raw.manifest.hydrology.rivers.cells.push(a, b); raw.manifest.hydrology.rivers.next.push(b, a); raw.manifest.hydrology.rivers.runoff.push(10000, 10000);
  assert.throws(() => parseWorldManifest(raw.manifest), /invalid/);
});


test('lake resource rules are enforced in both detail tiles and manifest overview', () => {
  for (const [x, y, resource] of [[20, 9, 4], [60, 15, 1]]) {
    const raw = fixture(), manifest = parseWorldManifest(raw.manifest);
    raw.tile.fields.resource[y * 128 + x] = resource;
    assert.throws(() => parseWorldTile(raw.tile, manifest, 0, 0), /invalid/);
  }
  const raw = fixture();
  raw.manifest.overview.fields.resource[4 * 256 + 10] = 4; // Samples lake cell(21,9).
  assert.throws(() => parseWorldManifest(raw.manifest), /invalid/);
});
