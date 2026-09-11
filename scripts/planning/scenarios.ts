import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateWorld } from '../../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../../src/world/generation/encode.ts';
import { createSettlementEnvironment } from '../../src/simulation/settlements.ts';
import { createCivilizationSnapshot } from '../../src/world/civilization.ts';
import { createTribeState } from '../../src/simulation/tribe.ts';
import { parseSimulationState,type SimulationState } from '../../shared/simulation.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import type { PlannerOptions } from './planner.ts';

export interface PlannerScenario {id:string;label:string;description:string;state:SimulationState;environment:SettlementEnvironment;months:number;options?:PlannerOptions;shock?:{afterDays:number;durationDays:number}}
let source:Promise<Awaited<ReturnType<typeof load>>>|undefined;
async function load(){
  const state=parseSimulationState(JSON.parse(await readFile(new URL('../../docs/research/game-ai/planning/helara.json',import.meta.url),'utf8')));
  const world=await generateWorld(state.settings),bundle=encodeGeneratedWorld(world),manifest=JSON.parse(bundle.manifest),tiles=bundle.tiles.map(t=>JSON.parse(t));
  const environment=createSettlementEnvironment(manifest,tiles);
  return {state,environment,world,manifest,tiles,digest:createHash('sha256').update(JSON.stringify(environment)).digest('hex')};
}
export function loadHelaraScenario(){return source??=load();}
export async function plannerScenarios():Promise<PlannerScenario[]>{
  const h=await loadHelaraScenario();
  const fresh=createTribeState('22222222-2222-4222-8222-222222222222','Growth review 1',h.manifest,createCivilizationSnapshot(h.world),h.tiles,{clockMode:'monthly',environment:h.environment});
  const marginal=createTribeState('33333333-3333-4333-8333-333333333333','Growth review 2',h.manifest,createCivilizationSnapshot(h.world),h.tiles,{clockMode:'monthly',environment:h.environment});
  return [
    {id:'helara',label:'Helara — observed plateau',description:'Actual year 13/month 9 checkpoint; 313 people, 55 claims. Twenty further years. Same geography, history, reserves and capabilities for all policies.',state:h.state,environment:h.environment,months:240},
    {id:'helara-cautious',label:'Helara — cautious comparison',description:'Same checkpoint; only the experimental risk penalty changes from 1 to 10. Baseline and ordered HTN do not use that extra preference. Five further years.',state:h.state,environment:h.environment,months:60,options:{riskAversion:10}},
    {id:'productive',label:'Productive founding location',description:'Chronicle/Large, Growth review 1. Fresh founding endowment, five years; no pre-awarded improvements.',state:fresh,environment:h.environment,months:60},
    {id:'marginal',label:'Contrasting founding location',description:'Chronicle/Large, Growth review 2. Fresh founding endowment, five years. Geography and history differ from the productive case.',state:marginal,environment:h.environment,months:60},
    {id:'disruption',label:'Helara — interrupted recovery',description:'Authored experiment: food potential and food sites become unavailable after 30 days, then recover 30 days later. Plans receive the changed environment when it occurs. This is not a new weather system. Three further years.',state:h.state,environment:h.environment,months:36,shock:{afterDays:30,durationDays:30}},
  ];
}
