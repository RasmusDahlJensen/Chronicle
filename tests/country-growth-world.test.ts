import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import { createSettlementEnvironment } from '../src/simulation/settlements.ts';
import { createTribeState, advanceTribeDays } from '../src/simulation/tribe.ts';
import { parseWorldManifest, parseWorldTile } from '../shared/generated-world.ts';
import { connectedCountryCells } from '../shared/country-growth.ts';

test('generated Chronicle geography supports ten-year one-capital growth at two reproducible locations', async () => {
  const world = await generateWorld({ seed: 'Chronicle', size: 'standard' }),
    bundle = encodeGeneratedWorld(world),
    manifest = parseWorldManifest(JSON.parse(bundle.manifest));
  const tiles = bundle.tiles.map((body, n) => parseWorldTile(JSON.parse(body), manifest, n % 4, Math.floor(n / 4)));
  const environment = createSettlementEnvironment(manifest, tiles),
    outcomes = [];
  for (const placementSeed of ['Growth review 1', 'Growth review 2']) {
    let state = createTribeState(
      '11111111-1111-4111-8111-111111111111',
      placementSeed,
      manifest,
      createCivilizationSnapshot(world),
      tiles,
      { clockMode: 'monthly', environment },
    );
    const initial = state;
    for (let month = 0; month < 120; month++) state = advanceTribeDays(state, 30, environment);
    assert.equal(state.settlements!.centers.length, 1);
    assert.ok(state.tribe.population > 280, 'a supported real location must grow over years');
    assert.ok(state.country!.territory.cells.length > initial.country!.territory.cells.length);
    assert.ok(
      connectedCountryCells(state.country!.territory.cells, state.tribe.originCellId, manifest.width, manifest.height),
    );
    assert.equal(state.country!.starvationDeaths, 0);
    assert.ok(state.settlements!.establishmentSpent > 0 && state.country!.upkeepPaid > 0);
    outcomes.push({
      capital: state.tribe.originCellId,
      claims: state.country!.territory.cells,
      profile: state.ai!.profile,
    });
  }
  assert.notDeepEqual(outcomes[0], outcomes[1]);
});
