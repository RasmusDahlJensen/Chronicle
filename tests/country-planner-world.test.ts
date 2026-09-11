import test from 'node:test';
import assert from 'node:assert/strict';
import {loadHelaraScenario} from '../scripts/planning/scenarios.ts';
import {chooseCountryPlan,createPlannerSession,advancePlannerSession} from '../scripts/planning/planner.ts';
import {advanceTribeDays} from '../src/simulation/tribe.ts';
import {netFood} from '../scripts/planning/projection.ts';

test('actual Helara recovery uses a future plan, distinguishes risk, and escapes the observed investment plateau',async()=>{
  const {state,environment,digest}=await loadHelaraScenario();
  assert.equal(digest,'250b874f0a814b94b8e3a3b0c3c970a02cd204e424a98e6086f8d590bae8678f','rebuilt geography must match the exact persisted Helara environment');
  assert.equal(state.elapsedDays,4560);assert.equal(state.tribe.name,'Helara');
  assert.equal(netFood(state,environment),1);
  const ordinary=chooseCountryPlan(state,environment,'lookahead'),cautious=chooseCountryPlan(state,environment,'lookahead',{riskAversion:10});
  assert.ok(ordinary.steps.includes('food'));
  assert.notDeepEqual(ordinary.steps,cautious.steps);
  const planned=ordinary.alternatives.find(a=>a.plan===ordinary.id)!;
  assert.ok(planned.netFood>1);
  let session=createPlannerSession(state,'lookahead'),baseline=state;
  for(let n=0;n<6;n++){session=advancePlannerSession(session,30,environment);baseline=advanceTribeDays(baseline,30,environment);}
  assert.ok(session.state.development!.foodLevel>0);
  assert.ok(netFood(session.state,environment)>netFood(baseline,environment));
  assert.equal(baseline.development!.foodLevel,0);
  assert.equal(state.elapsedDays,4560);
});
