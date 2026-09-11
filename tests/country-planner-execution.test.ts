import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentFixture } from './helpers/country-ai.ts';
import { advanceCountryDevelopment } from '../src/simulation/country-development.ts';
import { parseSimulationState } from '../shared/simulation.ts';
import { advanceTribeDays } from '../src/simulation/tribe.ts';

test('explicit planner orders execute paid work through the real daily economy without changing default policy', () => {
  const { state, environment } = investmentFixture('Planner executor', 50);
  state.ai!.profile.reserveDays = 90;
  const original = structuredClone(state);
  const first = structuredClone(state); first.elapsedDays++;
  advanceCountryDevelopment(first, environment, [], { orders: [{ kind: 'food', targetCellId: null }], reason: 'Study: improve food before expanding.' });
  assert.equal(first.development!.projects[0]?.kind, 'food');
  assert.equal(first.development!.projects[0]?.progress, 1);
  parseSimulationState(first);
  let next = first;
  for (let n = 1; n < 60; n++) {
    next.elapsedDays++;
    advanceCountryDevelopment(next, environment, [], { orders: [], reason: 'Study: execute committed work.' });
    parseSimulationState(next);
  }
  assert.equal(next.development!.foodLevel, 1);
  assert.equal(next.development!.investmentSpent, 2000);
  assert.equal(next.development!.completedWorkerDays, 720);
  assert.equal(next.settlements!.centers[0].food, 7500 + next.settlements!.totalCollected - next.settlements!.totalConsumed - next.country!.upkeepPaid - next.country!.spoilage - 2000);
  assert.deepEqual(state, original);
  const defaultNext = structuredClone(state); defaultNext.elapsedDays++;
  advanceCountryDevelopment(defaultNext, environment);
  assert.deepEqual(defaultNext, advanceTribeDays(state, 1, environment));
  assert.equal(defaultNext.development!.projects.length, 0);
});

test('explicit study orders cannot invent supplies, duplicate work or claim foreign land', () => {
  const { state, environment } = investmentFixture('Planner constraints', 25);
  state.elapsedDays++;
  advanceCountryDevelopment(state, environment, [], { orders: [{ kind: 'food', targetCellId: null }, { kind: 'food', targetCellId: null }], reason: 'Study: duplicate proposal.' });
  assert.ok(state.development!.projects.filter(p => p.kind === 'food').length <= 1);
  parseSimulationState(state);
  const target = state.country!.territory.cells.at(-1)! + 1;
  const before = state.development!.nextProjectId;
  state.country!.spoilage += state.settlements!.centers[0].food;
  state.settlements!.centers[0].food = 0;
  state.elapsedDays++;
  advanceCountryDevelopment(state, environment, [{ countryId: 'foreign', capitalCellId: target, cells: [target] }], { orders: [{kind:'claim',targetCellId:target},{kind:'logistics',targetCellId:null}], reason: 'Study: unavailable inputs.' });
  assert.equal(state.development!.nextProjectId, before);
  assert.ok(!state.country!.territory.cells.includes(target));
  parseSimulationState(state);
});

test('valid explicit orders are independent of the strategic inspector alternative limit', async()=>{
  const {developmentOpportunities,canFundDevelopment}=await import('../src/simulation/country-development.ts');
  const fixture=investmentFixture('Review control',80);
  const state=advanceTribeDays(fixture.state,30,fixture.environment);
  let next=advanceTribeDays(state,3,fixture.environment);
  const target=developmentOpportunities(next,fixture.environment,[]).slice(9).find(o=>canFundDevelopment(next,fixture.environment,[...next.development!.projects,o],0,false));
  assert.ok(target);
  next.elapsedDays++;
  advanceCountryDevelopment(next,fixture.environment,[],{orders:[target],reason:'Study: execute a valid alternative beyond display capacity.'});
  assert.ok(next.development!.projects.some(p=>p.kind===target.kind&&p.targetCellId===target.targetCellId));
});
