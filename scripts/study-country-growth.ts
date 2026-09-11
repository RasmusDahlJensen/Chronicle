// Repeatable development balance study using the authoritative generator and simulation.
import { generateWorld } from '../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { createCivilizationSnapshot } from '../src/world/civilization.ts';
import { createSettlementEnvironment } from '../src/simulation/settlements.ts';
import { createTribeState, advanceTribeDays } from '../src/simulation/tribe.ts';
for (const seed of ['Chronicle', 'Elsewhere'])
  for (const size of ['standard', 'large'] as const) {
    const world = await generateWorld({ seed, size }),
      bundle = encodeGeneratedWorld(world),
      manifest = JSON.parse(bundle.manifest),
      tiles = bundle.tiles.map((t) => JSON.parse(t));
    const environment = createSettlementEnvironment(manifest, tiles);
    for (const placementSeed of ['Growth review 1', 'Growth review 2']) {
      let state = createTribeState(
        '11111111-1111-4111-8111-111111111111',
        placementSeed,
        manifest,
        createCivilizationSnapshot(world),
        tiles,
        { clockMode: 'monthly', environment },
      );
      const capital = state.tribe.originCellId,
        initialClaims = state.country!.territory.cells.length,
        started = performance.now(),
        years = [];
      for (let month = 1; month <= 120; month++) {
        state = advanceTribeDays(state, 30, environment);
        if (month % 12 === 0)
          years.push({
            year: month / 12,
            population: state.tribe.population,
            cells: state.country!.territory.cells.length,
            food: state.settlements!.centers[0].food,
          });
      }
      console.log(
        JSON.stringify({
          seed,
          size,
          historySeed: placementSeed,
          capital,
          fertility: environment.fertility[capital],
          initialClaims,
          years,
          births: state.country!.births,
          deaths: state.country!.naturalDeaths + state.country!.starvationDeaths,
          claimsAdded: state.country!.claimsAdded,
          claimsReleased: state.country!.claimsReleased,
          capitals: state.settlements!.centers.length,
          tenYearsMs: Math.round(performance.now() - started),
        }),
      );
    }
  }
