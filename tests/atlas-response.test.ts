import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAtlasResponse } from '../shared/atlas.ts';

function response() {
  return { protocolVersion: 2, world: {
    fixtureId: 'small-study', fixtureVersion: 1, name: 'Small study', width: 3, height: 2,
    cellAreaKm2: 4, topology: 'bounded', countries: [], annotations: [],
    provinces: [{ id: 'a', name: 'Province A', countryId: null }],
    cells: [
      { id: 0, biome: 'ocean', elevation: -10, resource: 'fish', provinceId: null },
      { id: 1, biome: 'grassland', elevation: 50, resource: 'grain', provinceId: 'a' },
      { id: 2, biome: 'forest', elevation: 100, resource: 'timber', provinceId: 'a' },
      { id: 3, biome: 'coast', elevation: -2, resource: 'salt', provinceId: null },
      { id: 4, biome: 'mountain', elevation: 2000, resource: 'iron', provinceId: 'a' },
      { id: 5, biome: 'snow', elevation: 3000, resource: 'stone', provinceId: 'a' },
    ],
  } };
}

test('atlas validation preserves actual biome, resource, area and hierarchy data', () => {
  const payload = response();
  assert.deepEqual(parseAtlasResponse(payload), payload.world);
});

test('a country can own two distinct connected provinces without replacing cell membership', () => {
  const original = response();
  const payload = {
    ...original,
    world: {
      ...original.world,
      countries: [{ id: 'country-1', name: 'Example country' }],
      provinces: [
        { id: 'a', name: 'Province A', countryId: 'country-1' },
        { id: 'b', name: 'Province B', countryId: 'country-1' },
      ],
      cells: original.world.cells.map(cell => ({
        ...cell, provinceId: cell.id === 2 || cell.id === 5 ? 'b' : cell.provinceId,
      })),
    },
  };
  const world = parseAtlasResponse(payload);
  assert.deepEqual(world.countries, [{ id: 'country-1', name: 'Example country' }]);
  assert.deepEqual(world.provinces.map(province => [province.id, province.countryId]), [
    ['a', 'country-1'], ['b', 'country-1'],
  ]);
  assert.deepEqual(world.cells.map(cell => cell.provinceId), [null, 'a', 'b', null, 'a', 'b']);
});

test('malformed cell resources, biomes, IDs, elevation and water membership are rejected', () => {
  for (const patch of [
    { id: 0 }, { biome: 'unknown' }, { resource: null }, { resource: 'invented' },
    { elevation: NaN }, { elevation: -1 }, { provinceId: null }, { provinceId: 'missing' },
  ]) {
    const payload = response(); Object.assign(payload.world.cells[1], patch);
    assert.throws(() => parseAtlasResponse(payload), /atlas response/);
  }
  const water = response(); water.world.cells[0].provinceId = 'a';
  assert.throws(() => parseAtlasResponse(water));
});

test('atlas boundary rejects incompatible envelopes, dimensions, ownership and disconnected provinces', () => {
  const badSize = response(); badSize.world.width = 4;
  const owner = response(); Object.assign(owner.world.provinces[0], { countryId: 'unknown' });
  const disconnected = response();
  disconnected.world.provinces.push({ id: 'b', name: 'Province B', countryId: null });
  disconnected.world.cells[2].provinceId = 'b'; disconnected.world.cells[4].provinceId = 'b';
  const empty = response(); empty.world.provinces.push({ id: 'b', name: 'Empty province', countryId: null });
  const duplicates = response(); duplicates.world.provinces.push({ ...duplicates.world.provinces[0] });
  for (const payload of [null, { ...response(), protocolVersion: 1 }, badSize, owner, disconnected, empty, duplicates]) {
    assert.throws(() => parseAtlasResponse(payload), /atlas response/);
  }
});
