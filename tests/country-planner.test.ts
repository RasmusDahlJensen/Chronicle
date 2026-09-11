import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentFixture } from './helpers/country-ai.ts';
import { createPlannerSession, advancePlannerSession, chooseCountryPlan } from '../scripts/planning/planner.ts';
import { parseSimulationState } from '../shared/simulation.ts';

test('planner pays for a productive sequence and its future comparison cannot mutate reality', () => {
  const {state,environment}=investmentFixture('Plan recovery',50);
  state.ai!.profile.reserveDays=90;
  const original=structuredClone(state);
  const choice=chooseCountryPlan(state,environment,'lookahead',{riskAversion:0.3});
  assert.ok(choice.steps.some(s=>s==='food'));
  assert.ok(choice.alternatives.some(a=>a.plan==='Wait'));
  assert.deepEqual(state,original);
  let session=createPlannerSession(state,'lookahead',{riskAversion:0.3});
  for(let n=0;n<6;n++)session=advancePlannerSession(session,30,environment);
  assert.ok(session.state.development!.foodLevel>0);
  assert.ok(session.state.development!.investmentSpent>=2000);
  parseSimulationState(session.state);
});

test('experimental plan, progress and decisions resume exactly across JSON and batch boundaries',()=>{
  const {state,environment}=investmentFixture('Plan replay',55);
  let daily=createPlannerSession(state,'lookahead'),monthly=structuredClone(daily);
  for(let n=0;n<90;n++)daily=advancePlannerSession(JSON.parse(JSON.stringify(daily)),1,environment);
  for(let n=0;n<3;n++)monthly=advancePlannerSession(monthly,30,environment);
  assert.deepEqual(daily,monthly);
});

test('changed conditions invalidate committed work, preserve its sunk work, and do not promise impossible recovery',()=>{
  const {state,environment}=investmentFixture('Plan shock',55);
  let session=advancePlannerSession(createPlannerSession(state,'lookahead',{riskAversion:0.3}),5,environment);
  assert.ok(session.state.development!.projects.length);
  const before=session.state.development!.workerDays;
  const harsh=structuredClone(environment);harsh.fertility.fill(0);harsh.resource.fill(0);
  for(let n=0;n<12;n++)session=advancePlannerSession(session,30,harsh);
  assert.ok(session.state.development!.workerDays>=before);
  assert.ok(session.state.development!.cancelledProjects>0);
  assert.ok(session.decisions.some(d=>/cancel|changed|invalid/i.test(d.reason)));
  assert.equal(session.state.development!.foodLevel,0);
  parseSimulationState(session.state);
});

test('search is deterministic and respects its simulation-work budget',()=>{
  const {state,environment}=investmentFixture('Bounded planning',60);
  const first=chooseCountryPlan(state,environment,'lookahead',{maxSimulatedDays:30});
  const second=chooseCountryPlan(state,environment,'lookahead',{maxSimulatedDays:30});
  assert.deepEqual(first,second);
  assert.ok(first.simulatedDays<=30);
  assert.ok(first.budgetExhausted);
});

test('malformed sidecar plans and policy cannot silently reset or change saved experimental decisions',()=>{
  const {state,environment}=investmentFixture('Review sidecar',80);
  const session=advancePlannerSession(createPlannerSession(state,'lookahead'),1,environment);
  assert.ok(session.plan?.projectId);
  for(const mutation of [
    (s:typeof session)=>{(s as unknown as {policy:string}).policy='unsupported';},
    (s:typeof session)=>{s.plan!.index=999;},
    (s:typeof session)=>{s.plan!.projectId=99999;},
    (s:typeof session)=>{s.nextReviewDay=1e99;},
    (s:typeof session)=>{s.plan!.steps=['food','bad-action'];},
  ]){const copy=structuredClone(session);mutation(copy);assert.throws(()=>advancePlannerSession(copy,1,environment),/Invalid planner/);}
});
