import { createTribeState } from '../../src/simulation/tribe.ts';
import { createSettlementEnvironment } from '../../src/simulation/settlements.ts';
import { WORLD_BIOMES, WORLD_SIZES, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';
import type { CivilizationSnapshot } from '../../shared/civilization.ts';

export function growthFixture(seed = 'History 1', fertility = 65) {
  const world = { settings: { seed: 'Chronicle', size: 'standard' as const }, worldKey: 'climate-5:standard:Chronicle', ...WORLD_SIZES.standard } as WorldManifest;
  const field = (value: number) => Array<number>(128 * 128).fill(value);
  const tiles: WorldTile[] = Array.from({ length: 8 }, (_, n) => ({ protocolVersion: 4, worldKey: world.worldKey,
    x: n % 4, y: Math.floor(n / 4), width: 128, height: 128, fields: { elevation: field(100), biome: field(WORLD_BIOMES.indexOf('grassland')),
    fertility: field(fertility), temperature: field(200), moisture: field(500), resource: field(0) } }));
  const civilization: CivilizationSnapshot = { protocolVersion: 1, spawnVersion: 1, worldKey: world.worldKey, status: 'spawned',
    civilizations: [{ id: 'civilization-1', name: 'Aven', color: '#a34f32', originCellId: 65537 }] };
  return { state: createTribeState('11111111-1111-4111-8111-111111111111', seed, world, civilization, tiles, { clockMode: 'monthly', originCellId: 65537 }),
    environment: createSettlementEnvironment(world, tiles) };
}

/** Released rules 3: preserve the original AI/settlement regression scenarios. */
export function countryFixture(seed = 'History 1', fertility = 65) {
  const fixture = growthFixture(seed, fertility);
  delete fixture.state.country;
  fixture.state.protocolVersion = 4;
  fixture.state.rulesVersion = 3;
  return fixture;
}
