import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentFixture } from './helpers/country-ai.ts';
import { advancePlannerSession, chooseCountryPlan, createPlannerSession } from '../scripts/planning/planner.ts';
import { projectOperation, type Projection, type ProjectionBudget } from '../scripts/planning/projection.ts';

// Forecast and execution deliberately explain their actions differently. Keep
// every other state field, including RNG, dated events, reservations and ledgers.
function withoutExplanation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutExplanation);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'reason' && key !== 'decision')
      .map(([key, entry]) => [key, withoutExplanation(entry)]));
  return value;
}

for (const steps of [['food', 'logistics'], ['wait:30', 'food']]) {
  test(`projected ${steps.join(' then ')} matches the complete executed state and lowest food reserve`, () => {
    const { state, environment } = investmentFixture('Projection correspondence', 65);
    const original = structuredClone(state);
    const uncommittedFoodDays = (current: typeof state) => {
      const capital = current.settlements!.centers[0];
      const reserved = current.development!.projects.reduce((total, project) => total + project.cost, 0);
      return capital.population ? Math.max(0, capital.food - reserved) / capital.population : 0;
    };
    let session = createPlannerSession(state, 'lookahead');
    session.plan = { id: 'Fixed correspondence sequence', steps, index: 0, projectId: null, waitUntil: null };
    session.nextReviewDay = 360;
    let projection: Projection = { state: structuredClone(state), minReserveDays: uncommittedFoodDays(state), path: [] };
    const budget: ProjectionBudget = { limit: 2400, days: 0, transitions: 0, exhausted: false };
    let actualLowestReserve = uncommittedFoodDays(state);
    for (const step of steps) {
      const next = projectOperation(projection, step, environment, budget, 360);
      assert.ok(next, 'the shared executor must finish this funded operation');
      projection = next;
      while (session.state.elapsedDays < projection.state.elapsedDays) {
        session = advancePlannerSession(JSON.parse(JSON.stringify(session)), 1, environment);
        actualLowestReserve = Math.min(actualLowestReserve, uncommittedFoodDays(session.state));
      }
      assert.deepEqual(withoutExplanation(session.state), withoutExplanation(projection.state));
      assert.equal(projection.minReserveDays, actualLowestReserve);
    }
    assert.equal(projection.state.elapsedDays, steps[0] === 'food' ? 105 : 90);
    assert.equal(budget.days, projection.state.elapsedDays);
    assert.equal(budget.transitions, 2);
    assert.equal(budget.exhausted, false);
    assert.deepEqual(state, original, 'neither projection nor study execution can mutate the caller checkpoint');
  });
}

test('unknown mineral nodes cannot change HTN or outcome-search plans and projected consequences', () => {
  const { state, environment } = investmentFixture('Planner unknown mineral knowledge', 65);
  const minerals = structuredClone(environment);
  minerals.resource.fill(11);
  for (const policy of ['htn', 'lookahead'] as const)
    assert.deepEqual(chooseCountryPlan(state, minerals, policy), chooseCountryPlan(state, environment, policy));
});
