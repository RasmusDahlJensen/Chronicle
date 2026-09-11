import { parseSimulationState, type SimulationState } from '../../shared/simulation.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { advanceCountryDevelopment, developmentOpportunities, canFundDevelopment } from '../../src/simulation/country-development.ts';
import { selectHTNPlan } from './htn.ts';
import { netFood, reserveDays, projectOperation, projectUntil, orderForStep, type Projection, type ProjectionBudget } from './projection.ts';
import type { StudyAlternative, StudyDecision } from './report-types.ts';

import { plannerSettings as settings, parsePlannerSession, type PlannerSession, type PlannerPolicy, type PlannerOptions, type PlannerSettings as Settings } from './session.ts';
export type { PlannerSession, PlannerPolicy, PlannerOptions } from './session.ts';
export interface PlanChoice { id:string; steps:string[]; reason:string; alternatives:StudyAlternative[]; simulatedDays:number; projections:number; budgetExhausted:boolean }
function methods(state:SimulationState,env:SettlementEnvironment) {
  const claims=developmentOpportunities(state,env,[]).filter(o=>o.kind==='claim').slice(0,2);
  const primary=claims[0] ? `claim:${claims[0].targetCellId}` : null;
  return [
    {id:'Food, then logistics',steps:['food','logistics']},
    ...(primary?[{id:'Food, then expand',steps:['food',primary]}]:[]),
    {id:'Improve food',steps:['food']},
    {id:'Improve logistics',steps:['logistics']},
    ...(primary?[{id:'Logistics, then expand',steps:['logistics',primary]}]:[]),
    ...claims.map((c,i)=>({id:`Expand ${i+1}`,steps:[`claim:${c.targetCellId}`]})),
    {id:'Save, then improve food',steps:['wait:30','food']},
    {id:'Wait',steps:['wait:30']},
  ];
}
function value(initial:SimulationState,p:Projection,env:SettlementEnvironment,s:Settings):number {
  const before=initial.settlements!.centers[0],after=p.state.settlements!.centers[0];
  if(!after.population)return -100000;
  const population=Math.max(1,before.population),preferred=initial.ai!.profile.reserveDays;
  const risk=(days:number)=>Math.pow(Math.max(0,preferred-days),2)/preferred;
  const newDeaths=p.state.country!.starvationDeaths-initial.country!.starvationDeaths;
  return (after.food-before.food)/population
    + (netFood(p.state,env)-netFood(initial,env))*180/population
    + 30*Math.log(after.population/population)
    + (5+initial.ai!.profile.expansion*0.3)*Math.log(Math.max(1,p.state.country!.territory.cells.length)/initial.country!.territory.cells.length)
    - s.riskAversion*(risk(p.minReserveDays)-risk(reserveDays(initial)))
    - newDeaths*20;
}
export function chooseCountryPlan(state:SimulationState,env:SettlementEnvironment,policy:PlannerPolicy,options:PlannerOptions={}):PlanChoice {
  if(policy!=='htn'&&policy!=='lookahead')throw new Error('Unknown planner policy.');
  parseSimulationState(state);
  if(!state.development)throw new Error('Planner comparison needs country investment mechanics.');
  const config=settings(options),budget:ProjectionBudget={limit:config.maxSimulatedDays,days:0,transitions:0,exhausted:false};
  const start:Projection={state:structuredClone(state),minReserveDays:reserveDays(state),path:[]},endDay=state.elapsedDays+config.horizonDays;
  const candidates=methods(state,env),cache=new Map<string,Projection|null>();
  const transition=(p:Projection,step:string)=>{
    const key=JSON.stringify([...p.path,step]);
    if(!cache.has(key))cache.set(key,projectOperation(p,step,env,budget,endDay));
    return cache.get(key)!;
  };
  const alternatives:StudyAlternative[]=[],feasible:{id:string;steps:string[];score:number}[]=[];
  // The HTN arm uses actual decomposition and first-feasible method ordering.
  // Outcome search uses the same methods/transitions, comparing all bounded leaf futures.
  const selectedHTN=policy==='htn'?selectHTNPlan(start,candidates,transition):null;
  for(const method of policy==='htn'?candidates.filter(m=>m.id===selectedHTN?.methodId):[...candidates].sort((a,b)=>Number(b.id==='Wait')-Number(a.id==='Wait'))){
    let p:Projection|null=start;
    for(const step of method.steps){p=transition(p,step);if(!p)break;}
    if(p)p=projectUntil(p,env,budget,endDay);
    if(!p){alternatives.push({plan:method.id,score:0,minReserveDays:0,netFood:0,claims:0,feasible:false});continue;}
    const score=value(state,p,env,config);
    alternatives.push({plan:method.id,score:Math.round(score*100)/100,minReserveDays:Math.round(p.minReserveDays*100)/100,netFood:netFood(p.state,env),claims:p.state.country!.territory.cells.length,feasible:true});
    feasible.push({...method,score});
  }
  const chosen=policy==='htn'?feasible[0]:feasible.sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0))[0];
  return {id:chosen?.id??'Wait',steps:chosen?.steps??['wait:30'],reason:chosen ? policy==='htn' ? `First feasible hierarchical plan: ${chosen.id}. Method order determines selection; the displayed risk score does not rank HTN plans.` : `Best evaluated outcome: ${chosen.id}. Preferred reserves are priced as risk, not an admission cutoff.` : 'No funded plan completed evaluation; wait and reassess.',alternatives,simulatedDays:budget.days,projections:budget.transitions,budgetExhausted:budget.exhausted};
}
export function createPlannerSession(state:SimulationState,policy:PlannerPolicy,options:PlannerOptions={}):PlannerSession {
  parseSimulationState(state);
  if(!state.development||!['htn','lookahead'].includes(policy))throw new Error('Invalid planner comparison setup.');
  return {experiment:'country-planner-1',policy,settings:settings(options),state:structuredClone(state),plan:null,nextReviewDay:state.elapsedDays,decisions:[],simulatedDays:0,projections:0};
}
function remember(session:PlannerSession,decision:StudyDecision){session.decisions.push(decision);if(session.decisions.length>64)session.decisions.shift();}
/** Same deterministic daily executor for forecasts and actual study branches. No live API uses this envelope. */
export function advancePlannerSession(source:PlannerSession,days:number,env:SettlementEnvironment,onPlanning?:(phase:'start'|'end')=>void):PlannerSession {
  if(source.experiment!=='country-planner-1'||!Number.isInteger(days)||days<1||days>30)throw new Error('Invalid planner study step.');
  parsePlannerSession(source);
  const session=structuredClone(source);
  for(let day=0;day<days;day++){
    const state=session.state,d=state.development!;
    if(session.plan?.projectId!==null&&session.plan?.projectId!==undefined&&!d.projects.some(p=>p.id===session.plan!.projectId)){
      const event=d.history.find(e=>e.projectId===session.plan!.projectId&&e.event!=='started');
      if(event?.event==='completed'){session.plan.index++;session.plan.projectId=null;}
      else {remember(session,{day:state.elapsedDays,plan:session.plan.id,reason:'Committed work was cancelled; changed conditions require a new plan.',alternatives:[]});session.plan=null;session.nextReviewDay=state.elapsedDays;}
    }
    if(session.plan?.waitUntil!==null&&session.plan?.waitUntil!==undefined&&state.elapsedDays>=session.plan.waitUntil){session.plan.index++;session.plan.waitUntil=null;}
    if(session.plan&&session.plan.index>=session.plan.steps.length){session.plan=null;session.nextReviewDay=state.elapsedDays;}
    if(!session.plan&&state.elapsedDays>=session.nextReviewDay&&!d.projects.length&&state.tribe.population){
      onPlanning?.('start');
      const choice=chooseCountryPlan(state,env,session.policy,session.settings);
      onPlanning?.('end');
      session.simulatedDays+=choice.simulatedDays;session.projections+=choice.projections;
      session.plan={id:choice.id,steps:choice.steps,index:0,projectId:null,waitUntil:null};
      remember(session,{day:state.elapsedDays,plan:choice.id,reason:choice.reason,alternatives:choice.alternatives});
    }
    const orders=[];
    const plan=session.plan;
    if(plan&&plan.projectId===null&&plan.waitUntil===null){
      const step=plan.steps[plan.index],order=orderForStep(step);
      if(!order)plan.waitUntil=state.elapsedDays+30;
      else{
        const opportunity=developmentOpportunities(state,env,[]).find(o=>o.kind===order.kind&&o.targetCellId===order.targetCellId);
        if(opportunity&&canFundDevelopment(state,env,[...d.projects,opportunity],0,false)){orders.push(order);plan.projectId=d.nextProjectId;}
        else {remember(session,{day:state.elapsedDays,plan:plan.id,reason:'Plan inputs or access changed; reassess the invalidated next step.',alternatives:[]});session.plan=null;session.nextReviewDay=state.elapsedDays+1;}
      }
    }
    state.elapsedDays++;
    advanceCountryDevelopment(state,env,[],{orders,reason:session.plan?`Planner study: ${session.plan.id}.`:'Planner study: wait for a feasible next plan.'});
  }
  return parsePlannerSession(session);
}
