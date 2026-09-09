import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAtlasResponse } from '../shared/atlas.ts';
import { summarizeAtlas } from '../src/world/atlas.ts';

function response() {
  return { protocolVersion: 3, world: {
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

test('ordinary land and water cells retain geography with no resource site', () => {
  const payload = response();
  Object.assign(payload.world.cells[0], { resource: null });
  Object.assign(payload.world.cells[1], { resource: null });
  const world = parseAtlasResponse(payload);
  assert.equal(world.cells[0].resource, null);
  assert.equal(world.cells[1].resource, null);
  assert.equal(world.cells[1].biome, 'grassland');
  assert.equal(world.cells[1].provinceId, 'a');
  assert.equal(world.cells[4].resource, 'iron');
});

test('resource summaries count actual sites without treating ordinary terrain as resources', () => {
  const payload = response();
  Object.assign(payload.world.cells[0], { resource: null });
  Object.assign(payload.world.cells[1], { resource: null });
  const summary = summarizeAtlas(parseAtlasResponse(payload));
  assert.deepEqual(summary.resources, {
    fish: 0, grain: 0, timber: 1, game: 0, stone: 1, iron: 1,
    copper: 0, gold: 0, salt: 1, coal: 0, uranium: 0,
  });
  assert.equal(summary.resourceSites, 4);
  assert.equal(summary.cellsWithoutResource, 2);
  assert.equal(summary.totalKm2, 24);
  assert.equal(summary.landKm2, 16);
  assert.equal(summary.biomes.grassland, 4);
});

test('an atlas without special sites retains valid geography and zero resource counts', () => {
  const payload = response();
  for (const cell of payload.world.cells) Object.assign(cell, { resource: null });
  const summary = summarizeAtlas(parseAtlasResponse(payload));
  assert.equal(summary.resourceSites, 0);
  assert.equal(summary.cellsWithoutResource, 6);
  assert.ok(Object.values(summary.resources).every(count => count === 0));
  assert.equal(summary.landKm2, 16);
});

function twoProvinceWorld() {
  const payload = response();
  return parseAtlasResponse({
    ...payload,
    world: {
      ...payload.world,
      countries: [{ id: 'country-1', name: 'Example country' }],
      provinces: [
        { id: 'a', name: 'Province A', countryId: 'country-1' },
        { id: '__proto__', name: 'Province B', countryId: 'country-1' },
      ],
      cells: payload.world.cells.map(cell => {
        if (cell.id === 1) return { ...cell, resource: null };
        if (cell.id === 2 || cell.id === 5) {
          return { ...cell, biome: 'mountain', elevation: 2000, resource: 'stone', provinceId: '__proto__' };
        }
        return cell;
      }),
    },
  });
}

test('province summaries count constituent cells and sites independently of shared ownership and sea resources', () => {
  const world = twoProvinceWorld();
  const before = structuredClone(world);
  const summary = summarizeAtlas(world);
  assert.ok(summary.provinces instanceof Map, 'summaries must include provinces keyed by their actual IDs');
  assert.equal(summary.provinces.size, 2);
  const a = summary.provinces.get('a');
  const b = summary.provinces.get('__proto__');
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.cellCount, 2);
  assert.equal(a.areaKm2, 8);
  assert.equal(a.resourceSites, 1);
  assert.deepEqual(a.resources, {
    fish: 0, grain: 0, timber: 0, game: 0, stone: 0, iron: 1,
    copper: 0, gold: 0, salt: 0, coal: 0, uranium: 0,
  });
  assert.equal(b.cellCount, 2);
  assert.equal(b.areaKm2, 8);
  assert.equal(b.resourceSites, 2);
  assert.deepEqual(b.resources, { ...a.resources, iron: 0, stone: 2 });
  assert.equal(summary.resourceSites, 5);
  assert.equal(summary.resources.fish, 1);
  assert.equal(summary.resources.salt, 1);
  assert.deepEqual(world, before, 'summarizing must not change the authoritative cell data');
});

test('a replacement atlas rebuilds province totals and represents a province without sites', () => {
  const world = twoProvinceWorld();
  const original = summarizeAtlas(world);
  const replacement = {
    ...world,
    cellAreaKm2: 9,
    cells: world.cells.map(cell => cell.provinceId === 'a' ? { ...cell, resource: null } : cell),
  };
  const updated = summarizeAtlas(replacement);
  assert.ok(updated.provinces instanceof Map, 'replacement summaries must include provinces');
  const empty = updated.provinces.get('a');
  assert.ok(empty);
  assert.equal(empty.cellCount, 2);
  assert.equal(empty.areaKm2, 18);
  assert.equal(empty.resourceSites, 0);
  assert.ok(Object.values(empty.resources).every(count => count === 0));
  assert.equal(updated.provinces.get('__proto__')?.resourceSites, 2);
  assert.equal(updated.resourceSites, 4);
  assert.equal(original.provinces.get('a')?.resourceSites, 1);
  assert.equal(original.provinces.get('a')?.areaKm2, 8);
  assert.equal(world.cells[4].resource, 'iron');
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
    { id: 0 }, { biome: 'unknown' }, { resource: undefined }, { resource: 'invented' }, { resource: '' }, { resource: [] },
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
  for (const payload of [null, { ...response(), protocolVersion: 1 }, { ...response(), protocolVersion: 2 }, badSize, owner, disconnected, empty, duplicates]) {
    assert.throws(() => parseAtlasResponse(payload), /atlas response/);
  }
});
