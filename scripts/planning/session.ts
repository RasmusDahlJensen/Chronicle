import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {SimulationStateSchema,parseSimulationState} from '../../shared/simulation.ts';
import {orderForStep} from './projection.ts';
const count=Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER-100});
const text=Type.String({minLength:1,maxLength:512});
const finite=Type.Number({minimum:-1e12,maximum:1e12});
const object=<T extends Record<string,import('typebox').TSchema>>(properties:T)=>Type.Object(properties,{additionalProperties:false});
const settingsSchema=object({riskAversion:Type.Number({minimum:0,maximum:20}),horizonDays:Type.Integer({minimum:30,maximum:360}),maxSimulatedDays:Type.Integer({minimum:0,maximum:12000})});
export const PlannerSessionSchema=object({
  experiment:Type.Literal('country-planner-1'),policy:Type.Enum(['htn','lookahead']),settings:settingsSchema,state:SimulationStateSchema,
  plan:Type.Union([Type.Null(),object({id:text,steps:Type.Array(Type.String({pattern:'^(food|logistics|wait:30|claim:[0-9]+)$',maxLength:32}),{minItems:1,maxItems:3}),index:Type.Integer({minimum:0,maximum:2}),projectId:Type.Union([Type.Null(),count]),waitUntil:Type.Union([Type.Null(),count])})]),
  nextReviewDay:count,simulatedDays:count,projections:count,
  decisions:Type.Array(object({day:count,plan:text,reason:text,alternatives:Type.Array(object({plan:text,score:finite,minReserveDays:Type.Number({minimum:0,maximum:1e12}),netFood:finite,claims:count,feasible:Type.Boolean()}),{maxItems:12})}),{maxItems:64}),
});
export type PlannerSession=Static<typeof PlannerSessionSchema>;
export type PlannerPolicy=PlannerSession['policy'];
export type PlannerOptions=Partial<PlannerSession['settings']>;
export type PlannerSettings=PlannerSession['settings'];
export function plannerSettings(options:PlannerOptions):PlannerSettings {
  const s={riskAversion:options.riskAversion??1,horizonDays:options.horizonDays??180,maxSimulatedDays:options.maxSimulatedDays??2400};
  if(!Check(settingsSchema,s))throw new Error('Invalid planner comparison budget or preferences.');
  return s;
}
export function parsePlannerSession(value:unknown):PlannerSession {
  const invalid=()=>{throw new Error('Invalid planner study checkpoint; preserve its original data.');};
  if(!Check(PlannerSessionSchema,value))return invalid();
  const s=value;parseSimulationState(s.state);
  if(!s.state.development||s.nextReviewDay>s.state.elapsedDays+360)return invalid();
  if(s.decisions.some((d,i)=>d.day>s.state.elapsedDays||i>0&&d.day<s.decisions[i-1].day))return invalid();
  const p=s.plan;
  if(p){
    if(p.index>=p.steps.length)return invalid();
    for(const step of p.steps){const order=orderForStep(step);if(order?.targetCellId!==null&&order?.targetCellId!==undefined&&order.targetCellId>524287)return invalid();}
    if(p.waitUntil!==null&&(p.projectId!==null||p.steps[p.index]!=='wait:30'||p.waitUntil<s.state.elapsedDays||p.waitUntil>s.state.elapsedDays+30))return invalid();
    if(p.projectId!==null){
      const active=s.state.development.projects.find(x=>x.id===p.projectId),event=s.state.development.history.find(x=>x.projectId===p.projectId&&x.event!=='started'),order=orderForStep(p.steps[p.index]);
      if(!order||p.projectId!==s.state.development.nextProjectId-1||(!active&&!event))return invalid();
      if(active&&(active.kind!==order.kind||active.targetCellId!==order.targetCellId))return invalid();
      if(event&&event.kind!==order.kind)return invalid();
    }
  }
  return s;
}
