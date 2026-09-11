import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentFixture } from './helpers/country-ai.ts';
import { advanceTribeDays } from '../src/simulation/tribe.ts';

test('prosperity buys productive investment and funds concurrent expansion with materially greater reach', () => {
  let { state, environment } = investmentFixture('Growth fertile', 80);
  assert.ok('development' in state, 'new games must expose actual investment and shared project budgets');
  for (let n = 0; n < 60; n++) state = advanceTribeDays(state, 30, environment);
  assert.equal(state.settlements!.centers.length, 1);
  assert.ok(
    state.country!.territory.cells.length >= 40,
    'prosperous expansion must greatly exceed the old 8-cell five-year plateau',
  );
});

import { growthFixture } from './helpers/country-ai.ts';
import { parseSimulationState } from '../shared/simulation.ts';
import { resetTribeState } from '../src/simulation/tribe.ts';
import { economy } from '../src/simulation/country-growth.ts';
import { advanceCountryDevelopment, validateDevelopmentGeography } from '../src/simulation/country-development.ts';
const run = (
  state: ReturnType<typeof investmentFixture>['state'],
  env: ReturnType<typeof investmentFixture>['environment'],
  days: number,
) => {
  while (days) {
    const n = Math.min(30, days);
    state = advanceTribeDays(state, n, env);
    days -= n;
  }
  return state;
};
function activeFixture() {
  let { state, environment } = investmentFixture('Budget proof', 80);
  for (let day = 0; day < 720 && state.development!.projects.length < 2; day++)
    state = advanceTribeDays(state, 1, environment);
  assert.ok(state.development!.projects.length >= 2);
  return { state, environment };
}
function ledger(state: ReturnType<typeof investmentFixture>['state']) {
  const d = state.development!,
    g = state.country!,
    c = state.settlements!.centers[0],
    s = state.settlements!;
  assert.equal(
    c.food,
    7500 + s.totalCollected - s.totalConsumed - s.establishmentSpent - g.upkeepPaid - g.spoilage - d.investmentSpent,
  );
  assert.equal(state.tribe.population, 250 + g.births - g.naturalDeaths - g.starvationDeaths);
  assert.equal(
    d.budget.reservedFood,
    d.projects.reduce((n, p) => n + p.cost, 0),
  );
  assert.equal(
    d.budget.reservedWorkers,
    d.projects.reduce((n, p) => n + p.workers, 0),
  );
  assert.ok(d.budget.reservedFood <= c.food);
  assert.ok(d.budget.reservedWorkers <= Math.floor(c.population * 0.6));
  assert.equal(
    g.metrics.workforce,
    g.metrics.supportWorkers + g.metrics.claimWorkers + g.metrics.gatheringWorkers + g.metrics.idleWorkers,
  );
}
test('fertile countries outpace matched marginal and released-rule countries through paid investments', () => {
  const rich = investmentFixture('Growth fertile', 80),
    poor = investmentFixture('Growth fertile', 40),
    old = growthFixture('Growth fertile', 80);
  const success = run(rich.state, rich.environment, 1800),
    marginal = run(poor.state, poor.environment, 1800),
    legacy = run(old.state, old.environment, 1800);
  assert.ok(success.country!.territory.cells.length >= legacy.country!.territory.cells.length * 4);
  assert.ok(success.country!.territory.cells.length > marginal.country!.territory.cells.length * 1.5);
  assert.ok(success.development!.investmentSpent > marginal.development!.investmentSpent);
  assert.ok(success.development!.foodLevel > 0 && success.development!.logisticsLevel > 0);
  const developed = economy(
    rich.environment,
    success.country!.territory,
    success.tribe.population,
    0,
    success.development,
  );
  const unimproved = economy(rich.environment, success.country!.territory, success.tribe.population, 0, {
    foodLevel: 0,
    logisticsLevel: 0,
  });
  assert.ok(developed.collected > unimproved.collected);
  assert.ok(developed.metrics.supportRequired < unimproved.metrics.supportRequired);
  ledger(success);
  ledger(marginal);
});
test('combined projects never double-spend supplies or workers and repeat daily, monthly, saved and reset execution', () => {
  const { state, environment } = activeFixture();
  let daily = state,
    monthly = state;
  for (let i = 0; i < 180; i++) {
    daily = advanceTribeDays(parseSimulationState(JSON.parse(JSON.stringify(daily))), 1, environment);
    ledger(daily);
  }
  for (let i = 0; i < 6; i++) monthly = advanceTribeDays(monthly, 30, environment);
  assert.deepEqual(daily, monthly);
  assert.ok(monthly.development!.completedProjects > state.development!.completedProjects);
  assert.deepEqual(resetTribeState(monthly, environment), {
    ...investmentFixture('Budget proof', 80).state,
    incarnation: 2,
  });
});
test('sudden shortage cancels commitments without spending their quoted costs or losing their already performed work', () => {
  const { state, environment } = activeFixture();
  const projects = state.development!.projects.map((p) => p.id),
    spent = state.development!.investmentSpent,
    claimSpent = state.settlements!.establishmentSpent,
    work = state.development!.workerDays;
  environment.fertility.fill(0);
  const next = advanceTribeDays(state, 1, environment);
  ledger(next);
  assert.ok(projects.some((id) => !next.development!.projects.some((p) => p.id === id)));
  assert.ok(next.development!.cancelledProjects > state.development!.cancelledProjects);
  assert.equal(next.development!.investmentSpent, spent);
  assert.equal(next.settlements!.establishmentSpent, claimSpent);
  assert.ok(next.development!.workerDays >= work);
  const collapsed = run(next, environment, 1800);
  assert.equal(collapsed.tribe.population, 0);
  assert.deepEqual(collapsed.development!.projects, []);
  ledger(collapsed);
  const later = run(collapsed, environment, 360);
  assert.equal(later.development!.workerDays, collapsed.development!.workerDays);
});
test('a newly foreign-owned project target is cancelled and never acquired or funded twice', () => {
  const { state, environment } = activeFixture();
  const project = state.development!.projects.find((p) => p.kind === 'claim')!;
  assert.ok(project);
  const target = project.targetCellId!,
    next = structuredClone(state);
  next.elapsedDays++;
  advanceCountryDevelopment(next, environment, [{ countryId: 'neighbor', capitalCellId: target, cells: [target] }]);
  parseSimulationState(next);
  ledger(next);
  assert.ok(!next.country!.territory.cells.includes(target));
  assert.ok(!next.development!.projects.some((p) => p.targetCellId === target));
  assert.ok(next.development!.history.some((e) => e.projectId === project.id && e.event === 'cancelled'));
});
test('forged portfolio budgets, work, prices and paid improvements fail closed', () => {
  const { state, environment } = activeFixture();
  const mutations: ((s: typeof state) => void)[] = [
    (s) => {
      s.development!.foodLevel++;
    },
    (s) => {
      s.development!.investmentSpent++;
    },
    (s) => {
      s.development!.budget.reservedFood++;
    },
    (s) => {
      s.development!.budget.reservedWorkers++;
    },
    (s) => {
      s.development!.projects[0].progress++;
    },
    (s) => {
      s.development!.projects[0].startedDay++;
    },
    (s) => {
      s.development!.projects.push(structuredClone(s.development!.projects[0]));
    },
    (s) => {
      s.development!.nextProjectId++;
    },
  ];
  for (const mutation of mutations) {
    const copy = structuredClone(state);
    mutation(copy);
    assert.throws(() => parseSimulationState(copy), /preserved/);
  }
  const forged = structuredClone(state),
    p = forged.development!.projects.find((p) => p.kind === 'claim')!;
  p.cost++;
  forged.development!.budget.reservedFood++;
  forged.development!.budget.availableFood--;
  assert.throws(() => validateDevelopmentGeography(forged, environment), /preserved/);
});
test('unknown mineral nodes cannot provide investment supplies or change development choices', () => {
  const { state, environment } = investmentFixture('Unknown nodes', 80),
    altered = structuredClone(environment);
  altered.resource.fill(11);
  assert.deepEqual(run(state, environment, 720), run(state, altered, 720));
});

test('saved work cannot be erased or backdated to finish an investment without its labor', () => {
  let { state, environment } = investmentFixture('Growth fertile', 80);
  while (state.elapsedDays < 60 || !state.development!.projects.some((p) => p.kind === 'food'))
    state = advanceTribeDays(state, 1, environment);
  for (const change of [
    (s: typeof state) => {
      s.development!.workerDays = 0;
    },
    (s: typeof state) => {
      const p = s.development!.projects.find((p) => p.kind === 'food')!;
      p.progress = 59;
      p.startedDay = s.elapsedDays - 58;
    },
  ]) {
    const copy = structuredClone(state);
    change(copy);
    assert.throws(() => parseSimulationState(copy), /preserved/);
  }
  assert.doesNotThrow(() => validateDevelopmentGeography(state, environment));
});

test('a funded investment only reserves work that remains after the current day', () => {
  let { state, environment } = investmentFixture('Growth fertile', 80);
  while (state.elapsedDays < 60 || !state.development!.projects.some((p) => p.kind === 'food'))
    state = advanceTribeDays(state, 1, environment);
  environment.fertility.fill(25);
  state = advanceTribeDays(state, 1, environment);
  const d = state.development!,
    p = d.projects.find((p) => p.kind === 'food')!,
    c = state.settlements!.centers[0];
  assert.ok(p);
  assert.equal(d.projects.length, 1);
  const daily = economy(environment, state.country!.territory, c.population, p.workers, d);
  const deficit = Math.max(0, c.population + daily.metrics.upkeepDue - daily.collected);
  const funded = p.cost + c.population * 7 + deficit * (p.duration - p.progress);
  assert.ok(c.food >= funded);
  state.country!.spoilage += c.food - funded;
  c.food = funded;
  d.budget.availableFood = c.food - d.budget.reservedFood - c.population * 7;
  parseSimulationState(state);
  const next = advanceTribeDays(state, 1, environment);
  assert.ok(
    next.development!.projects.some((project) => project.id === p.id),
    'today’s already performed work must not be funded twice',
  );
  ledger(next);
});

test('completed work releases an affordable project slot without an idle seasonal wait', () => {
  let { state, environment } = investmentFixture('Growth fertile', 80),
    found = false;
  for (let day = 0; day < 500; day++) {
    const before = state;
    state = advanceTribeDays(state, 1, environment);
    if (
      state.development!.completedProjects > before.development!.completedProjects &&
      state.development!.projects.length < state.development!.budget.projectSlots &&
      state.settlements!.centers[0].food > state.tribe.population * state.ai!.profile.reserveDays + 5000
    ) {
      const next = advanceTribeDays(state, 1, environment);
      assert.ok(
        next.development!.nextProjectId > state.development!.nextProjectId,
        'completion should re-evaluate newly available capacity',
      );
      found = true;
      break;
    }
  }
  assert.ok(found, 'fixture should reach a well-provisioned completion');
});
