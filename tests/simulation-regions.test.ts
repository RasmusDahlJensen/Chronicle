import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { decodeGeography, cellNeighbors } from '../src/simulation/geography.ts';
import { checkPartition } from '../src/simulation/invariants.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { REGION_TUNING } from '../src/simulation/tunables.ts';

/** The lab's path: generate → encode → validate the manifest and tiles in the simulation layer → regions. */
async function geographyFor(seed: string, size: 'standard' | 'large') {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed, size }));
  return decodeGeography(bundle.manifest, bundle.tiles);
}

test('M0 acceptance: every land cell belongs to exactly one region and non-island regions stay within 20,000–60,000 km²', async () => {
  for (const [seed, size] of [['Chronicle', 'large'], ['Chronicle', 'standard']] as const) {
    const geography = await geographyFor(seed, size);
    const partition = partitionRegions(geography);
    checkPartition(geography, partition);
    const near = new Int32Array(4);
    let inRange = 0, nonIsland = 0;
    for (const region of partition.regions) {
      // Contiguous, hence within one landmass.
      const inside = new Set(region.cells), seen = new Set([region.cells[0]]), queue = [region.cells[0]];
      for (let at = 0; at < queue.length; at++) for (const next of cellNeighbors(geography, queue[at], near)) {
        if (next >= 0 && inside.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
      assert.equal(seen.size, region.cells.length, `${seed} ${size}: region ${region.id} is not contiguous`);
      if (region.island) { assert.ok(region.areaKm2 < REGION_TUNING.minAreaKm2); continue; }
      nonIsland++;
      const within = region.areaKm2 >= REGION_TUNING.minAreaKm2 && region.areaKm2 <= REGION_TUNING.maxAreaKm2;
      assert.ok(within, `${seed} ${size}: region ${region.id} has ${Math.round(region.areaKm2)} km² and is not an island`);
      if (within) inRange++;
    }
    assert.ok(inRange >= nonIsland * 0.9);
    if (size === 'large') assert.ok(partition.regions.length >= 1500 && partition.regions.length <= 5000, `${partition.regions.length} regions`);
  }
});

test('region partition is deterministic and derives water, sites, neighbours and sea links from geography', async () => {
  const geography = await geographyFor('Validation', 'standard');
  const first = partitionRegions(geography), second = partitionRegions(geography);
  const digest = (values: Int32Array) => createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
  assert.equal(digest(first.regionOf), digest(second.regionOf));
  assert.deepEqual(first.regions.map(region => region.neighbors), second.regions.map(region => region.neighbors));
  const regions = first.regions;
  assert.ok(regions.some(region => region.coastal) && regions.some(region => !region.coastal));
  assert.ok(regions.some(region => region.riverTier >= 2), 'Some regions hold a river');
  for (const region of regions) {
    for (const edge of region.neighbors) {
      assert.notEqual(edge.region, region.id);
      assert.ok(regions[edge.region].neighbors.some(back => back.region === region.id), 'Neighbours are symmetric');
      assert.ok(edge.travelKm > 0 && Number.isFinite(edge.travelKm));
      assert.equal(regions[edge.region].landmass, region.landmass, 'Land neighbours share a landmass');
    }
    for (const link of region.sea) assert.ok(link.km > 0 && link.km <= REGION_TUNING.seaCrossingKm && regions[link.region].sea.some(back => back.region === region.id));
    assert.ok(region.settlementSites.length > 0 && region.settlementSites.every(cell => first.regionOf[cell] === region.id));
    assert.ok(region.defensibility >= 0 && region.defensibility <= 1);
    for (const [cell, code] of region.sites) {
      if (first.regionOf[cell] !== region.id) assert.equal(code, RESOURCE_IDS.indexOf('fish') + 1, 'Only fish sites lie off a region\'s land');
    }
  }
  const sites = regions.reduce((sum, region) => sum + region.sites.length, 0);
  let landSites = 0;
  for (let cell = 0; cell < geography.cells; cell++) if (geography.resource[cell] && geography.land[cell]) landSites++;
  assert.ok(sites >= landSites, 'Every land site belongs to its region');
  assert.ok(regions.some(region => region.sea.length > 0), 'Coastal regions record sea crossings');
});
