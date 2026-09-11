import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFixture } from './helpers/country-ai.ts';
import { advanceTribeDays, resetTribeState } from '../src/simulation/tribe.ts';
import { parseSimulationState } from '../shared/simulation.ts';

// Missing seeded policy, accidental rerolls and ignored history seeds must all fail here.
test('monthly countries receive saved preferences from a separate history seed', () => {
  const { state } = countryFixture();
  assert.ok('ai' in state, 'a new monthly civilization must receive a persistent AI');
  assert.deepEqual(state, countryFixture().state);
  assert.notDeepEqual(state.ai!.profile, countryFixture('History 2').state.ai!.profile);
});

test('AI decisions survive JSON reload and daily/monthly batching with exact accounting', () => {
  const { state, environment } = countryFixture();
  let daily = state, monthly = state;
  for (let n = 0; n < 180; n++) daily = advanceTribeDays(daily, 1, environment);
  for (let n = 0; n < 6; n++) monthly = advanceTribeDays(parseSimulationState(JSON.parse(JSON.stringify(monthly))), 30, environment);
  assert.ok(daily.ai?.history.length, 'decisions must record actual reasons');
  assert.deepEqual(daily, monthly);
  assert.deepEqual(resetTribeState(monthly), { ...state, incarnation: 2 });
  assert.equal(monthly.settlements!.centers.reduce((n,c) => n+c.population,0),250);
  assert.equal(monthly.settlements!.centers.reduce((n,c) => n+c.food,0),7500+monthly.settlements!.totalCollected-monthly.settlements!.totalConsumed-monthly.settlements!.establishmentSpent);
});

test('same landscape with different histories produces different supported development', () => {
  const outcomes = new Set<string>();
  for (let seed=0; seed<8; seed++) {
    let { state, environment } = countryFixture(`People ${seed}`);
    for (let n=0;n<8;n++) state=advanceTribeDays(state,30,environment);
    outcomes.add(JSON.stringify(state.settlements!.centers.map(c=>[c.cellId,c.foundedDay,c.territory])));
  }
  assert.ok(outcomes.size>=3, 'different seeds must change decisions, not only names');
});

import fc from 'fast-check';
import { initialCountryAI, chooseCountryIntent, type CountryCandidate } from '../src/simulation/country-ai.ts';

test('a viable commitment does not reroll daily and food pressure interrupts expansion', () => {
 const ai=initialCountryAI('Commitment');
 const candidates: CountryCandidate[]=[
  {goal:'consolidate',targetCellId:null,score:30,eligible:true,reason:'Protect food.',reservedFood:0,reservedPeople:0},
  {goal:'found',targetCellId:20,score:90,eligible:true,reason:'Support a village.',reservedFood:4000,reservedPeople:80},
 ];
 const first=structuredClone(chooseCountryIntent(ai,'settlement-1',1,candidates,false)), rng=[...ai.rngState];
 for(let day=2;day<30;day++) assert.deepEqual(chooseCountryIntent(ai,'settlement-1',day,candidates,false),first);
 assert.deepEqual(ai.rngState,rng);
 const changed=chooseCountryIntent(ai,'settlement-1',30,candidates,true);
 assert.equal(changed.goal,'consolidate'); assert.equal(changed.reservedFood,0); assert.equal(changed.reservedPeople,0);
 assert.match(changed.reason,/Food pressure/); assert.equal(ai.history.length,2);
});

test('a food deficit cancels real founding preparation without consuming reserved settlers or supplies', () => {
 let {state,environment}=countryFixture('People 1');
 for(let day=0;day<360 && !state.ai?.decisions.some(d=>d.goal==='found');day++) state=advanceTribeDays(state,1,environment);
 assert.ok(state.ai?.decisions.some(d=>d.goal==='found'),'fixture must reach a funded project');
 const main=state.settlements!.centers[0], population=main.population, profile=structuredClone(state.ai!.profile);
 // A valid checkpoint at its exact local funding margin; a real daily deficit must cancel the still-saved project.
 const funding=state.ai!.decisions.find(d=>d.goal==='found')!.reservedFood+(main.population-80)*state.ai!.profile.reserveDays;
 assert.ok(main.food>=funding);
 state.settlements!.establishmentSpent+=main.food-funding; main.food=funding;
 environment.fertility.fill(0);
 state=advanceTribeDays(parseSimulationState(state),1,environment);
 const decision=state.ai!.decisions.find(d=>d.settlementId===main.id)!;
 assert.equal(decision.goal,'consolidate'); assert.equal(decision.reservedFood,0);
 assert.equal(state.settlements!.centers[0].foundingDays,0);
 assert.equal(state.settlements!.centers[0].population,population);
 assert.deepEqual(state.ai!.profile,profile);
 assert.equal(state.settlements!.totalConsumed+state.settlements!.totalShortfall,state.elapsedDays*250);
});

test('unknown mineral placement cannot alter food policies or provide extractable supplies', () => {
 const {state,environment}=countryFixture('Knowledge');
 const minerals=structuredClone(environment); minerals.resource.fill(11);
 let ordinary=state, altered=state;
 for(let month=0;month<6;month++) {ordinary=advanceTribeDays(ordinary,30,environment);altered=advanceTribeDays(altered,30,minerals);}
 assert.deepEqual(ordinary,altered);
});

test('checkpoint rejects missing AI, unbounded RNG, overspending and expired or impossible commitments', () => {
 const {state,environment}=countryFixture();
 const active=advanceTribeDays(state,1,environment);
 assert.ok(active.ai!.decisions.length);
 const invalid: ((s:typeof active)=>void)[]=[s=>{delete s.ai;},s=>{s.ai!.rngState=[0,0,0,0];},s=>{s.ai!.rngState[0]=2147483648;},
  s=>{s.ai!.historySeed='Different';},s=>{s.ai!.decisions[0].reservedFood=999999;},s=>{s.ai!.decisions[0].reviewDay=0;},
  s=>{s.ai!.decisions[0].targetCellId=131072;},s=>{s.ai!.decisions.push(structuredClone(s.ai!.decisions[0]));},
  s=>{s.ai!.decisions[0].sinceDay=2;},s=>{s.ai!.decisions[0].alternatives=[];}];
 for(const change of invalid) {const copy=structuredClone(active);change(copy);assert.throws(()=>parseSimulationState(copy),/preserved/);}
});

test('generated step partitions preserve RNG, intentions and ledgers on the real core', () => {
 const fixture=countryFixture('Properties');
 fc.assert(fc.property(fc.array(fc.integer({min:1,max:30}),{minLength:1,maxLength:8}),parts=>{
  let chunked=fixture.state,daily=fixture.state;
  for(const size of parts) chunked=advanceTribeDays(parseSimulationState(JSON.parse(JSON.stringify(chunked))),size,fixture.environment);
  for(let day=0;day<parts.reduce((n,p)=>n+p,0);day++) daily=advanceTribeDays(daily,1,fixture.environment);
  assert.deepEqual(chunked,daily);
  const sim=chunked.settlements!;
  assert.equal(sim.centers.reduce((n,c)=>n+c.food,0)+sim.totalConsumed+sim.establishmentSpent,7500+sim.totalCollected);
 }),{seed:11092026,numRuns:60});
});

test('legacy monthly checkpoints keep their decisions until explicit reset enables AI', () => {
 const {state,environment}=countryFixture('Legacy');
 const old={...state,protocolVersion:3 as const,rulesVersion:2 as const}; delete old.ai;
 const before=parseSimulationState(old), stepped=advanceTribeDays(before,30,environment);
 assert.equal(stepped.ai,undefined); assert.equal(stepped.rulesVersion,2);
 const reset=resetTribeState(stepped);
 assert.ok(reset.ai); assert.equal(reset.elapsedDays,0);assert.equal(reset.tribe.originCellId,before.tribe.originCellId);
 assert.equal(reset.ai.historySeed,before.placementSeed);
});


test('a parent cannot reserve another community’s food for founding', () => {
 let {state,environment}=countryFixture('Local stockpiles');
 for(let n=0;n<4;n++) state=advanceTribeDays(state,30,environment);
 const sim=state.settlements!,main=sim.centers[0];
 // Two established local economies with conserved totals: almost all goods are at the remote center.
 const total=sim.centers.reduce((n,c)=>n+c.food,0);
 main.population=170; main.food=100; main.kind='settlement'; main.foundingCellId=null; main.foundingDays=0;
 main.prospectCellId=null;main.prospectDays=0;
 sim.centers=[main,{...structuredClone(main),id:'settlement-2',name:'Remote',cellId:66000,population:80,food:total-100,
  territory:[66000],territoryLastWorked:[state.elapsedDays],workingCells:[],foundedDay:state.elapsedDays,prosperousDays:0}];
 sim.nextSettlementId=3;sim.history=[];state.ai!.decisions=[];state.ai!.history=[];
 state=advanceTribeDays(parseSimulationState(state),1,environment);
 const parent=state.ai!.decisions.find(d=>d.settlementId===main.id)!;
 assert.ok(parent.alternatives.some(a=>a.goal==='found'));
 assert.ok(parent.alternatives.filter(a=>a.goal==='found').every(a=>!a.eligible));
 assert.notEqual(parent.goal,'found');assert.equal(parent.reservedPeople,0);
});

test('saved intent targets and progress must agree with the executing community', () => {
 const {state,environment}=countryFixture();
 state.ai!.profile.reserveDays=30;state.ai!.profile.expansion=100;
 const active=advanceTribeDays(state,1,environment);
 const d=active.ai!.decisions[0], center=active.settlements!.centers[0];
 assert.equal(d.goal,'expand');
 center.prospectCellId=d.targetCellId!+1;
 assert.throws(()=>parseSimulationState(active),/preserved/);
});


test('a saved founding project cannot skip work or erase its local reservation', () => {
 let {state,environment}=countryFixture('People 1');
 for(let day=0;day<360 && !state.ai!.decisions.some(d=>d.goal==='found');day++) state=advanceTribeDays(state,1,environment);
 const found=state.ai!.decisions.find(d=>d.goal==='found')!;assert.ok(found);
 for(const change of [(s:typeof state)=>{s.settlements!.centers[0].foundingDays=100;},
  (s:typeof state)=>{s.ai!.decisions.find(d=>d.goal==='found')!.reservedFood=0;},
  (s:typeof state)=>{s.ai!.decisions.find(d=>d.goal==='found')!.reviewDay=s.elapsedDays-1;}]) {
  const copy=structuredClone(state);change(copy);assert.throws(()=>parseSimulationState(copy),/preserved/);
 }
});
