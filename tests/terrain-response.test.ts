import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTerrainResponse } from '../src/api/terrain.ts';

function response() {
  return {
    protocolVersion: 1,
    world: {
      fixtureId: 'two-cells', fixtureVersion: 1, name: 'Small coast',
      width: 2, height: 1, cellAreaKm2: 4,
      cells: [
        { id: 0, terrain: 'water', elevation: -10, provinceId: null },
        { id: 1, terrain: 'hills', elevation: 30, provinceId: 'island' },
      ],
      provinces: [{ id: 'island', name: 'Island', sovereignId: null }],
    },
  };
}

test('a supported terrain response preserves host data for rendering', () => {
  const world = parseTerrainResponse(response());
  assert.equal(world.name, 'Small coast');
  assert.equal(world.cellAreaKm2, 4);
  assert.deepEqual(world.cells, [
    { id: 0, terrain: 'water', elevation: -10, provinceId: null },
    { id: 1, terrain: 'hills', elevation: 30, provinceId: 'island' },
  ]);
});

test('malformed or incompatible responses cannot become renderer input', () => {
  const invalid = [
    null,
    { ...response(), protocolVersion: 2 },
    { ...response(), world: null },
    { ...response(), world: { ...response().world, width: 3 } },
    { ...response(), world: { ...response().world, height: -1 } },
    { ...response(), world: { ...response().world, width: 100_001 } },
    { ...response(), world: { ...response().world, cellAreaKm2: 0 } },
    { ...response(), world: { ...response().world, provinces: [] } },
  ];
  for (const payload of invalid) assert.throws(() => parseTerrainResponse(payload), /terrain response/i);
});

test('invalid cell IDs, terrain, elevation, and province references are rejected', () => {
  for (const patch of [
    { id: 0 }, { terrain: 'lava' }, { elevation: NaN },
    { provinceId: 'missing' }, { provinceId: null },
  ]) {
    const payload = response();
    Object.assign(payload.world.cells[1]!, patch);
    assert.throws(() => parseTerrainResponse(payload), /terrain response/i);
  }
  const waterWithProvince = response();
  waterWithProvince.world.cells[0]!.provinceId = 'island';
  assert.throws(() => parseTerrainResponse(waterWithProvince), /terrain response/i);
});
