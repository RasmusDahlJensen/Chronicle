import test from 'node:test';
import assert from 'node:assert/strict';
import { growthFixture as countryFixture, investmentFixture } from './helpers/country-ai.ts';
import { advanceTribeDays, resetTribeState } from '../src/simulation/tribe.ts';
import { parseSimulationState } from '../shared/simulation.ts';

function run(
  state: ReturnType<typeof countryFixture>['state'],
  environment: ReturnType<typeof countryFixture>['environment'],
  days: number,
) {
  while (days > 0) {
    const count = Math.min(days, 30);
    state = advanceTribeDays(state, count, environment);
    days -= count;
  }
  return state;
}

test('a prosperous released rules 4 country grows people and connected national claims for five years with one capital', () => {
  const { state, environment } = countryFixture('Growth fertile', 80);
  assert.equal(state.protocolVersion, 5);
  assert.equal(state.rulesVersion, 4);
  assert.equal(state.development, undefined);
  assert.ok(state.country, 'growth games need country-owned territory, separate from town working areas');
  const grown = run(state, environment, 360 * 5);
  assert.equal(grown.settlements!.centers.length, 1);
  assert.ok(grown.tribe.population > 260, 'sustained prosperity must grow beyond the fixed founding allocation');
  assert.ok(
    grown.country!.territory.cells.length > state.country.territory.cells.length,
    'country expansion must work without founding towns',
  );
  assert.ok(grown.country!.births > grown.country!.naturalDeaths + grown.country!.starvationDeaths);
  assert.ok(grown.country!.upkeepPaid > 0);
  assert.ok(grown.settlements!.establishmentSpent > 0, 'claims must consume their actual food cost');
  assert.deepEqual(grown.settlements!.centers[0].territory, [state.tribe.originCellId]);
  assert.equal(
    grown.tribe.population,
    250 + grown.country!.births - grown.country!.naturalDeaths - grown.country!.starvationDeaths,
  );
  assert.equal(grown.settlements!.totalConsumed + grown.settlements!.totalShortfall, grown.country!.personDays);
});

test('country growth preserves exact daily, monthly, saved continuation and reset accounting', () => {
  const { state, environment } = countryFixture('Growth replay', 75);
  let daily = state;
  for (let n = 0; n < 360; n++)
    daily = advanceTribeDays(parseSimulationState(JSON.parse(JSON.stringify(daily))), 1, environment);
  const monthly = run(state, environment, 360);
  assert.deepEqual(daily, monthly);
  assert.equal(monthly.rulesVersion, 4);
  assert.equal(monthly.development, undefined);
  assert.throws(() => resetTribeState(monthly), /geography/i);
  assert.deepEqual(resetTribeState(monthly, environment), { ...investmentFixture('Growth replay', 75).state, incarnation: 2 });
});

import {
  addCountryClaim,
  releaseCountryClaim,
  connectedCountryCells,
  countryNeighbors,
} from '../shared/country-growth.ts';
import { validateCountryGeography } from '../src/simulation/country-growth.ts';

test('a provisioned claim completes its remaining work instead of repeatedly funding the whole project again', () => {
  let { state, environment } = countryFixture('Growth fertile', 80);
  environment.fertility.fill(50);
  for (let day = 0; day < 1300; day++) {
    state = advanceTribeDays(state, 1, environment);
    const c = state.settlements!.centers[0];
    if (c.prospectDays === 1 && c.collected < c.consumed + state.country!.metrics.upkeepDue) break;
  }
  assert.equal(state.ai!.decisions[0]?.goal, 'expand');
  const center = state.settlements!.centers[0],
    intent = state.ai!.decisions[0];
  const funded =
    intent.reservedFood +
    center.population * state.ai!.profile.reserveDays +
    40 * (center.consumed + state.country!.metrics.upkeepDue - center.collected);
  assert.ok(center.food >= funded);
  state.country!.spoilage += center.food - funded;
  center.food = funded;
  const claims = state.country!.claimsAdded;
  const completed = run(state, environment, 30);
  assert.ok(
    completed.country!.claimsAdded > claims,
    'funded ongoing work must not reset because already-worked days are budgeted again',
  );
});

test('ordinary claims cannot knowingly create an ongoing food deficit', () => {
  let { state, environment } = countryFixture('Review fertility 50', 50),
    previousClaims = 0;
  for (let day = 0; day < 1800; day++) {
    const afterClaim = state.country!.claimsAdded > previousClaims;
    previousClaims = state.country!.claimsAdded;
    state = advanceTribeDays(state, 1, environment);
    const c = state.settlements!.centers[0],
      m = state.country!.metrics;
    if (afterClaim && m.claimWorkers === 0)
      assert.ok(c.collected >= c.consumed + m.upkeepDue, 'new claims must support the forecast ongoing food cost');
  }
  assert.ok(state.country!.claimsAdded > 0);
});

test('food hardship stops claims; restored food can rebuild reserves and population', () => {
  let { state, environment } = countryFixture('Recovery', 80);
  state = run(state, environment, 360);
  const rich = state;
  environment.fertility.fill(0);
  state = run(state, environment, 180);
  assert.equal(state.country!.claimsAdded, rich.country!.claimsAdded);
  assert.ok(state.tribe.population < rich.tribe.population);
  // A release completes consolidation on this day, leaving no active intent.
  assert.ok(state.ai!.decisions.every((d) => d.goal === 'consolidate'));
  assert.match(state.settlements!.centers[0].decision, /subsistence|Released/);
  const poor = state;
  environment.fertility.fill(80);
  state = run(state, environment, 1080);
  assert.ok(state.tribe.population > poor.tribe.population);
  assert.ok(state.settlements!.centers[0].food > poor.settlements!.centers[0].food);
  assert.ok(state.country!.births > poor.country!.births);
});

test('persistent deprivation releases claims and can extinguish a country without negative people or ghost claims', () => {
  let { state, environment } = countryFixture('Hardship', 80);
  environment.fertility.fill(0);
  let released = false;
  for (let day = 0; day < 360; day++) {
    state = advanceTribeDays(state, 1, environment);
    assert.ok(
      connectedCountryCells(
        state.country!.territory.cells,
        state.tribe.originCellId,
        environment.width,
        environment.height,
      ) || state.tribe.population === 0,
    );
    released ||= state.tribe.population > 0 && state.country!.claimsReleased > 0;
  }
  assert.ok(released, 'unsupported outer land should be relinquished before total collapse');
  assert.equal(state.tribe.population, 0);
  assert.deepEqual(state.country!.territory.cells, []);
  assert.equal(state.country!.naturalDeaths + state.country!.starvationDeaths, 250);
  assert.ok(state.country!.upkeepShortfall > 0);
  assert.deepEqual(state.ai!.decisions, []);
  const later = run(state, environment, 360);
  assert.equal(later.country!.personDays, state.country!.personDays);
  assert.equal(later.country!.births, 0);
  assert.equal(later.settlements!.totalCollected, state.settlements!.totalCollected);
  assert.deepEqual(later.country!.territory.cells, []);
  assert.equal(later.country!.metrics.workforce, 0);
});

test('canonical claims exclude foreign owners, wrap the world seam and cannot detach land from the capital', () => {
  const own = { countryId: 'one', capitalCellId: 10, cells: [10] },
    other = { countryId: 'two', capitalCellId: 11, cells: [11] };
  assert.equal(addCountryClaim(own, 11, 10, 5, [other]), false);
  assert.equal(addCountryClaim(own, 19, 10, 5, [other]), true, 'east-west seam is adjacent');
  assert.equal(addCountryClaim(own, 29, 10, 5, [other]), true);
  assert.equal(addCountryClaim(own, 35, 10, 5, [other]), false, 'no disconnected claims');
  assert.equal(releaseCountryClaim(own, 19, 10, 5), false, 'bridge removal would detach 29');
  assert.equal(releaseCountryClaim(own, 10, 10, 5), false);
  assert.equal(releaseCountryClaim(own, 29, 10, 5), true);
  assert.equal(releaseCountryClaim(own, 19, 10, 5), true);
  assert.deepEqual(own.cells, [10]);
  assert.deepEqual(other.cells, [11]);
  assert.ok(!countryNeighbors(0, 10, 5).includes(40), 'poles do not wrap');
});

test('new country decisions ignore undiscovered mineral deposits and account for all food and workers', () => {
  const { state, environment } = countryFixture('Country minerals', 80),
    minerals = structuredClone(environment);
  minerals.resource.fill(11);
  const ordinary = run(state, environment, 720),
    altered = run(state, minerals, 720);
  assert.deepEqual(ordinary, altered);
  const g = ordinary.country!,
    sim = ordinary.settlements!,
    m = g.metrics;
  assert.equal(
    sim.centers[0].food + sim.totalConsumed + sim.establishmentSpent + g.upkeepPaid + g.spoilage,
    7500 + sim.totalCollected,
  );
  assert.ok(g.spoilage > 0);
  assert.equal(m.workforce, m.supportWorkers + m.gatheringWorkers + m.claimWorkers + m.idleWorkers);
  assert.ok(sim.centers[0].workingCells.every((id) => g.territory.cells.includes(id)));
});

test('saved country rejects forged population, food, ownership, demographic carry and project cost', () => {
  const { state, environment } = countryFixture('Forgery', 80),
    active = run(state, environment, 180);
  const invalid: ((s: typeof state) => void)[] = [
    (s) => {
      s.country!.births++;
    },
    (s) => {
      s.country!.personDays++;
    },
    (s) => {
      s.country!.upkeepPaid++;
    },
    (s) => {
      s.country!.territory.cells.push(s.country!.territory.cells[0]);
    },
    (s) => {
      s.country!.deathRemainder++;
    },
    (s) => {
      s.country!.metrics.gatheringWorkers++;
    },
    (s) => {
      s.country!.initialCells = [1];
    },
    (s) => {
      s.country!.history.push({ day: s.elapsedDays + 1, kind: 'claimed', cellId: 1, message: 'Future' });
    },
  ];
  for (const change of invalid) {
    const copy = structuredClone(active);
    change(copy);
    assert.throws(() => parseSimulationState(copy), /preserved/);
  }
  for (const change of [
    (s: typeof state) => {
      s.country!.birthRemainder = 35999;
    },
    (s: typeof state) => {
      s.country!.deathRemainder = 35999;
    },
    (s: typeof state) => {
      s.settlements!.totalCollected += 1000000;
      s.settlements!.centers[0].food += 1000000;
    },
  ]) {
    const copy = structuredClone(state);
    change(copy);
    assert.throws(() => parseSimulationState(copy), /preserved/);
  }
  let project = state;
  for (let d = 0; d < 360 && project.ai!.decisions[0]?.goal !== 'expand'; d++)
    project = advanceTribeDays(project, 1, environment);
  assert.equal(project.ai!.decisions[0]?.goal, 'expand');
  project.ai!.decisions[0].reservedFood++;
  assert.throws(() => validateCountryGeography(project, environment), /preserved/);
});

test('a surviving country cannot erase a hunger death by changing both population mirrors', () => {
  const { state, environment } = countryFixture('Review hunger ledger', 80);
  environment.fertility.fill(0);
  const hungry = run(state, environment, 90);
  assert.ok(hungry.tribe.population > 0 && hungry.country!.starvationDeaths > 0);
  hungry.country!.starvationDeaths--;
  hungry.tribe.population++;
  hungry.settlements!.centers[0].population++;
  assert.throws(() => parseSimulationState(hungry), /preserved/);
});

test('sustained unprofitable territory retreats while reserves still protect people', () => {
  let { state, environment } = countryFixture('Early retreat', 80);
  state = run(state, environment, 360);
  assert.ok(state.country!.territory.cells.length > 2);
  environment.fertility.fill(45);
  const reserves = state.settlements!.centers[0].food;
  const before = state;
  state = run(state, environment, 60);
  assert.ok(
    state.country!.claimsReleased > before.country!.claimsReleased,
    'do not wait for accumulated reserves to hit zero before correcting known support deficits',
  );
  assert.ok(state.settlements!.centers[0].food > 0 && reserves > 0);
  assert.equal(state.country!.starvationDeaths, 0);
});
