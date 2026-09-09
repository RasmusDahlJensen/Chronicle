import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasWorld } from '../shared/atlas.ts';
import { parentAtlasSelection, pickAtlasCell, type AtlasSelection } from '../src/renderer/atlas-selection.ts';

const world: AtlasWorld = {
  fixtureId: 'selection-study', fixtureVersion: 1, name: 'Selection study',
  width: 3, height: 2, cellAreaKm2: 4, topology: 'bounded', countries: [], annotations: [],
  provinces: [{ id: 'a', name: 'A', countryId: null }, { id: 'b', name: 'B', countryId: null }],
  cells: [
    { id: 0, biome: 'ocean', elevation: -10, resource: 'fish', provinceId: null },
    { id: 1, biome: 'grassland', elevation: 30, resource: null, provinceId: 'a' },
    { id: 2, biome: 'mountain', elevation: 2000, resource: 'stone', provinceId: 'b' },
    { id: 3, biome: 'coast', elevation: -2, resource: null, provinceId: null },
    { id: 4, biome: 'forest', elevation: 100, resource: 'timber', provinceId: 'a' },
    { id: 5, biome: 'grassland', elevation: 30, resource: null, provinceId: 'b' },
  ],
};

test('land selects its province first, then any cell inside that province', () => {
  const first = pickAtlasCell(world, null, 1);
  assert.deepEqual(first, { kind: 'province', provinceId: 'a' });
  assert.deepEqual(pickAtlasCell(world, first, 1), { kind: 'cell', cellId: 1 });
  const site = pickAtlasCell(world, first, 4);
  assert.deepEqual(site, { kind: 'cell', cellId: 4 });
  assert.deepEqual(pickAtlasCell(world, site, 1), { kind: 'cell', cellId: 1 });
  assert.deepEqual(pickAtlasCell(world, site, 4), site, 'clicking the selected cell stays at cell scope');
});

test('entering another province starts at province scope even when clicking a resource', () => {
  for (const selection of [null, { kind: 'province', provinceId: 'a' }, { kind: 'cell', cellId: 4 }] as AtlasSelection[]) {
    assert.deepEqual(pickAtlasCell(world, selection, 2), { kind: 'province', provinceId: 'b' });
  }
  assert.deepEqual(pickAtlasCell(world, { kind: 'province', provinceId: 'b' }, 5), { kind: 'cell', cellId: 5 });
});

test('water has direct cell inspection and returning to land selects a province', () => {
  for (const selection of [null, { kind: 'province', provinceId: 'a' }, { kind: 'cell', cellId: 4 }] as AtlasSelection[]) {
    assert.deepEqual(pickAtlasCell(world, selection, 0), { kind: 'cell', cellId: 0 });
  }
  assert.deepEqual(pickAtlasCell(world, { kind: 'cell', cellId: 0 }, 3), { kind: 'cell', cellId: 3 });
  assert.deepEqual(pickAtlasCell(world, { kind: 'cell', cellId: 0 }, 4), { kind: 'province', provinceId: 'a' });
});

test('back moves from a land cell to its province and then clears selection', () => {
  const province = parentAtlasSelection(world, { kind: 'cell', cellId: 4 });
  assert.deepEqual(province, { kind: 'province', provinceId: 'a' });
  assert.equal(parentAtlasSelection(world, province), null);
  assert.equal(parentAtlasSelection(world, { kind: 'cell', cellId: 0 }), null);
  assert.equal(parentAtlasSelection(world, null), null);
});

test('selection leaves world data untouched and ignores nonexistent cells', () => {
  const before = structuredClone(world);
  const selection: AtlasSelection = { kind: 'province', provinceId: 'a' };
  for (const cellId of [-1, 6, NaN, 1.5]) assert.deepEqual(pickAtlasCell(world, selection, cellId), selection);
  pickAtlasCell(world, selection, 4);
  parentAtlasSelection(world, { kind: 'cell', cellId: 4 });
  assert.deepEqual(world, before);
  assert.deepEqual(selection, { kind: 'province', provinceId: 'a' });
});
