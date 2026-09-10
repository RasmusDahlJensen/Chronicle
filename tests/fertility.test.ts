import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFertility, createFertilityContext, fertilityAt } from '../shared/fertility.ts';

const flat = { biome: 'grassland', elevation: 100, temperature: 22, moisture: 0.65, slopeDegrees: 0, freshwater: false, river: false };
test('growing potential exposes independent limitations and an exact factor product', () => {
  const good = assessFertility(flat);
  assert.equal(good.soil, 'loamy'); assert.ok(good.score >= 80);
  for (const change of [{ temperature: -10 }, { moisture: 0.05 }, { biome: 'mountain', slopeDegrees: 12 }, { biome: 'wetland', moisture: 0.98 }]) {
    assert.ok(assessFertility({ ...flat, ...change }).score < good.score / 2);
  }
  for (const temperature of [-50, 0, 15, 30, 50]) for (const moisture of [0, 0.3, 0.8, 1]) {
    const facts = assessFertility({ ...flat, temperature, moisture });
    assert.equal(facts.score, Math.round(Object.values(facts.factors).reduce((a, b) => a * b / 100, 100)));
    assert.ok(Object.values(facts.factors).every(value => Number.isInteger(value) && value >= 0 && value <= 100));
  }
});
test('water is excluded and river context is an estimate without automatic irrigation', () => {
  for (const biome of ['ocean', 'coast', 'seaIce', 'lake', 'lakeIce']) {
    const facts = assessFertility({ ...flat, biome });
    assert.equal(facts.applicable, false); assert.equal(facts.score, 0); assert.equal(facts.soil, 'none');
  }
  assert.equal(assessFertility({ ...flat, freshwater: true }).score, assessFertility(flat).score);
  assert.equal(assessFertility({ ...flat, freshwater: true, river: true }).soil, 'alluvial');
  assert.equal(assessFertility({ ...flat, moisture: 0.05, freshwater: true, river: true }).soil, 'sandy');
});
test('regional slopes wrap longitude, bound poles, use physical distances and do not mutate terrain', () => {
  const surface = { elevation: new Int16Array(25).fill(100), biome: new Uint8Array(25) };
  surface.elevation[14] = 1100;
  const original = surface.elevation.slice();
  const hydro = { drySinks: [], rivers: { cells: [14], next: [10], runoff: [1] }, lakes: [] };
  const small = createFertilityContext(surface, { width: 5, height: 5, areaKm2: 100 }, hydro, ['grassland']);
  const large = createFertilityContext(surface, { width: 5, height: 5, areaKm2: 400 }, hydro, ['grassland']);
  assert.ok(fertilityAt(small, 10, 22, 0.65).slopeDegrees > fertilityAt(large, 10, 22, 0.65).slopeDegrees);
  assert.equal(fertilityAt(small, 10, 22, 0.65).freshwater, true);
  assert.equal(fertilityAt(small, 0, 22, 0.65).slopeDegrees, 0);
  assert.deepEqual(surface.elevation, original);
});
test('lake shores use surface level instead of bed depth and closed lakes give no freshwater context', () => {
  const surface = { elevation: new Int16Array(25).fill(100), biome: new Uint8Array(25) };
  surface.elevation[12] = -1000; surface.biome[12] = 1;
  const shape = { width: 5, height: 5, areaKm2: 100 };
  for (const outlet of [null, { cell: 12, next: 13, runoff: 1 }]) {
    const context = createFertilityContext(surface, shape, { drySinks: [], rivers: { cells: [], next: [], runoff: [] }, lakes: [{ id: 1, cells: [12], level: 100, outlet }] }, ['grassland', 'lake']);
    const facts = fertilityAt(context, 11, 22, 0.65);
    assert.equal(facts.slopeDegrees, 0); assert.equal(facts.freshwater, outlet !== null);
    assert.equal(facts.soil, 'loamy');
    assert.equal(fertilityAt(context, 6, 22, 0.65).freshwater, outlet !== null, 'diagonal lakeshore agrees with water inspection');
  }
});
