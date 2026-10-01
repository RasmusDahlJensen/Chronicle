import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { WORLD_BIOMES } from '../shared/generated-world.ts';
import { placeClusteredSites } from '../src/world/generation/resource-clusters.ts';

const code = (id: typeof RESOURCE_IDS[number]) => RESOURCE_IDS.indexOf(id) + 1;
const biomeCode = (id: typeof WORLD_BIOMES[number]) => WORLD_BIOMES.indexOf(id);

/** A labelled synthetic Large-size field: ocean with a mountain range, an upland snowfield and a lowland desert. */
function fixture(copper: number) {
  const width = 1024, height = 512;
  const elevation = new Int16Array(width * height).fill(-2000);
  const biome = new Uint8Array(width * height).fill(biomeCode('ocean'));
  const resource = new Uint8Array(width * height);
  const paint = (x0: number, y0: number, x1: number, y1: number, metres: number, type: typeof WORLD_BIOMES[number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const id = y * width + (x + width) % width; elevation[id] = metres; biome[id] = biomeCode(type); }
  };
  paint(-40, 150, 360, 380, 200, 'grassland');
  paint(-30, 160, 60, 360, 1800, 'mountain'); // crosses the longitude seam
  paint(100, 160, 190, 360, 1600, 'mountain');
  paint(200, 160, 220, 360, 2500, 'snow');
  paint(240, 200, 340, 330, 150, 'desert');
  // Existing sparse sites, including copper on the mountains, must stay where they are.
  for (let at = 0; at < copper; at++) resource[(170 + at * 7) * width + 120] = code('copper');
  for (let at = 0; at < 40; at++) resource[(205 + at * 3) * width + 250 + at] = code('salt');
  return { width, height, fields: { elevation, biome, resource } };
}

test('tin and oil fill only empty land cells, form clusters and leave every earlier site in place', () => {
  const world = fixture(27);
  const before = world.fields.resource.slice();
  placeClusteredSites(world.fields, world.width, world.height, 'large', 4242);
  const tin: number[] = [], oil: number[] = [];
  for (let id = 0; id < before.length; id++) {
    const now = world.fields.resource[id];
    if (before[id]) assert.equal(now, before[id], `site ${id} moved or changed`);
    else if (now) {
      assert.ok(now === code('tin') || now === code('oil'), `only tin and oil are appended, not ${now}`);
      assert.ok(world.fields.elevation[id] >= 0, 'appended sites are on land');
      assert.notEqual(WORLD_BIOMES[world.fields.biome[id]], 'snow', 'no deposits under permanent snow');
      (now === code('tin') ? tin : oil).push(id);
    }
  }
  const apart = (a: number, b: number) => {
    const dx = Math.abs(a % world.width - b % world.width);
    return Math.hypot(Math.min(dx, world.width - dx), Math.floor(a / world.width) - Math.floor(b / world.width));
  };
  assert.ok(tin.length >= 2 && tin.length < 27 / 2, `tin ${tin.length} must be clustered and below half of copper`);
  assert.ok(tin.every(id => world.fields.elevation[id] >= 500), 'tin sits in mountains and uplands');
  assert.ok(tin.some((a, i) => tin.slice(i + 1).some(b => apart(a, b) <= 8)), 'a tin cluster has two sites within 8 cells');
  assert.ok(oil.every(id => world.fields.elevation[id] <= 400), 'oil sits in lowland basins');
  assert.ok(oil.some((a, i) => oil.slice(i + 1).some((b, j) => apart(a, b) <= 12
    && oil.slice(i + j + 2).some(c => apart(a, c) <= 12 && apart(b, c) <= 12))), 'an oil basin has three sites within 12 cells');
  for (const sites of [tin, oil]) for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) {
    assert.ok(apart(sites[a], sites[b]) >= 2, 'sites inside a cluster stay at least 2 cells apart');
  }

  const repeat = fixture(27);
  placeClusteredSites(repeat.fields, repeat.width, repeat.height, 'large', 4242);
  assert.deepEqual(repeat.fields.resource, world.fields.resource, 'placement is seeded and repeatable');
  const other = fixture(27);
  placeClusteredSites(other.fields, other.width, other.height, 'large', 777);
  assert.notDeepEqual(other.fields.resource, world.fields.resource, 'another seed places other deposits');
});

test('tin stays below half of copper and is omitted with too little copper or no uplands', () => {
  const scarce = fixture(7);
  placeClusteredSites(scarce.fields, scarce.width, scarce.height, 'large', 99);
  const tin = scarce.fields.resource.filter(value => value === code('tin')).length;
  assert.ok(tin >= 2 && tin < 7 / 2, `tin ${tin} with 7 copper sites`);
  const poor = fixture(4);
  placeClusteredSites(poor.fields, poor.width, poor.height, 'large', 99);
  assert.equal(poor.fields.resource.filter(value => value === code('tin')).length, 0, 'a cluster of 2 would be half of 4 copper sites');

  const flat = fixture(27);
  for (let id = 0; id < flat.fields.elevation.length; id++) if (flat.fields.elevation[id] > 400) {
    flat.fields.elevation[id] = 200; flat.fields.biome[id] = biomeCode('grassland');
  }
  placeClusteredSites(flat.fields, flat.width, flat.height, 'large', 99);
  assert.equal(flat.fields.resource.filter(value => value === code('tin')).length, 0, 'a world without uplands has no tin');
  assert.ok(flat.fields.resource.some(value => value === code('oil')), 'oil does not depend on tin');
});
