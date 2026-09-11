import type { SimulationState } from '../../shared/simulation.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { economy } from '../../src/simulation/country-growth.ts';
import { advanceCountryDevelopment, canFundDevelopment, developmentOpportunities, type DevelopmentOrder } from '../../src/simulation/country-development.ts';

export interface Projection { state:SimulationState; minReserveDays:number; path:string[] }
export interface ProjectionBudget { limit:number; days:number; transitions:number; exhausted:boolean }
export function reserveDays(state:SimulationState):number {
  const c=state.settlements!.centers[0];
  return c.population ? Math.max(0,c.food-state.development!.budget.reservedFood)/c.population : 0;
}
export function netFood(state:SimulationState,env:SettlementEnvironment):number {
  const c=state.settlements!.centers[0], e=economy(env,state.country!.territory,c.population,0,state.development);
  return e.collected-c.population-e.metrics.upkeepDue;
}
export function orderForStep(step:string):DevelopmentOrder|null {
  if(step==='food'||step==='logistics')return {kind:step,targetCellId:null};
  if(/^claim:\d+$/.test(step))return {kind:'claim',targetCellId:Number(step.slice(6))};
  if(step==='wait:30')return null;
  throw new Error(`Unknown planning operation: ${step}`);
}
function tick(p:Projection,env:SettlementEnvironment,budget:ProjectionBudget,orders:DevelopmentOrder[]):boolean {
  if(budget.days>=budget.limit){budget.exhausted=true;return false;}
  budget.days++;
  p.state.elapsedDays++;
  advanceCountryDevelopment(p.state,env,[],{orders,reason:'Planner study: project this operation through the shared daily economy.'});
  p.minReserveDays=Math.min(p.minReserveDays,reserveDays(p.state));
  return true;
}
/** Every projected day runs exactly the same costs, work, demography and cancellation as execution. */
export function projectOperation(source:Projection,step:string,env:SettlementEnvironment,budget:ProjectionBudget,endDay:number):Projection|null {
  budget.transitions++;
  const p=structuredClone(source),order=orderForStep(step);
  if(!order){
    if(p.state.elapsedDays+30>endDay)return null;
    for(let i=0;i<30;i++)if(!tick(p,env,budget,[]))return null;
  }else{
    if(p.state.development!.projects.length||!p.state.tribe.population)return null;
    const opportunity=developmentOpportunities(p.state,env,[]).find(o=>o.kind===order.kind&&o.targetCellId===order.targetCellId);
    if(!opportunity||p.state.elapsedDays+opportunity.duration>endDay||!canFundDevelopment(p.state,env,[opportunity],0,false))return null;
    const id=p.state.development!.nextProjectId;
    if(!tick(p,env,budget,[order]))return null;
    while(p.state.development!.projects.some(project=>project.id===id)){
      if(p.state.elapsedDays>=endDay||!tick(p,env,budget,[]))return null;
    }
    if(!p.state.development!.history.some(event=>event.projectId===id&&event.event==='completed'))return null;
  }
  p.path.push(step);
  return p;
}
export function projectUntil(source:Projection,env:SettlementEnvironment,budget:ProjectionBudget,endDay:number):Projection|null {
  const p=structuredClone(source);
  while(p.state.elapsedDays<endDay)if(!tick(p,env,budget,[]))return null;
  return p;
}
