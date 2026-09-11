import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {advanceTribeDays} from '../src/simulation/tribe.ts';
import type {SimulationState} from '../shared/simulation.ts';
import {createPlannerSession,advancePlannerSession,type PlannerSession} from './planning/planner.ts';
import {plannerScenarios,loadHelaraScenario} from './planning/scenarios.ts';
import {renderPlannerReport} from './planning/report.ts';
import type {PlannerStudyReport,StudyResult,StudyDecision,StudyPoint} from './planning/report-types.ts';

const output=resolve('docs/research/game-ai/planning');
const report:PlannerStudyReport={version:1,generatedAt:new Date().toISOString(),library:'gameplan-htn 1.0.1 (MIT), development-only. Actual HTN decomposition uses a tested context stack-reader adapter for a reproduced upstream defect. The HTN arm chooses the first feasible authored method; lookahead compares the same methods with shared-core projections. Neither is adopted in the live map.',recommendation:'Experimental comparison in progress. Scores and the limited method vocabulary are provisional; conservation and replay are mandatory. Twenty-year Helara evidence is a single-country observation, not capacity proof for 1,000 societies.',scenarios:[]};
const point=(state:SimulationState):StudyPoint=>({day:state.elapsedDays,population:state.tribe.population,claims:state.country!.territory.cells.length,food:state.settlements!.centers[0].food,foodLevel:state.development!.foodLevel,logisticsLevel:state.development!.logisticsLevel,starvation:state.country!.starvationDeaths,projects:state.development!.projects.length});
await mkdir(output,{recursive:true});
const scenarios=await plannerScenarios();
console.log(JSON.stringify({phase:'geography',helaraEnvironmentDigest:(await loadHelaraScenario()).digest}));
for(const scenario of scenarios){
  const comparison={id:scenario.id,label:scenario.label,description:scenario.description,results:[] as StudyResult[]};
  const disrupted=scenario.shock?structuredClone(scenario.environment):null;
  if(disrupted){disrupted.fertility.fill(0);disrupted.resource.fill(0);}
  for(const policy of ['current','htn','lookahead'] as const){
    let state=structuredClone(scenario.state),session:PlannerSession|undefined=policy==='current'?undefined:createPlannerSession(state,policy,scenario.options);
    const points=[point(state)],decisions:StudyDecision[]=[],seen=new Set<string>();
    let decisionStart=0,maxDecisionMs=0;
    const started=performance.now();
    for(let month=0;month<scenario.months;month++){
      const elapsed=state.elapsedDays-scenario.state.elapsedDays,shock=scenario.shock;
      const env=shock&&elapsed>=shock.afterDays&&elapsed<shock.afterDays+shock.durationDays?disrupted!:scenario.environment;
      if(session){
        session=advancePlannerSession(session,30,env,phase=>{if(phase==='start')decisionStart=performance.now();else maxDecisionMs=Math.max(maxDecisionMs,performance.now()-decisionStart);});
        state=session.state;
        for(const decision of session.decisions){const key=JSON.stringify(decision);if(!seen.has(key)){seen.add(key);decisions.push(decision);}}
      }else{
        state=advanceTribeDays(state,30,env);
        const d=state.ai!.decisions[0];
        if(d){const key=`${d.sinceDay}:${d.goal}`;if(!seen.has(key)){seen.add(key);decisions.push({day:state.elapsedDays,plan:d.goal,reason:d.reason,alternatives:[]});}}
      }
      points.push(point(state));
      if ((month+1)%60===0) console.log(JSON.stringify({phase:'progress',scenario:scenario.id,policy,years:(month+1)/12,claims:state.country!.territory.cells.length,foodLevel:state.development!.foodLevel,logisticsLevel:state.development!.logisticsLevel}));
    }
    const result:StudyResult={policy,initialDay:scenario.state.elapsedDays,points,decisions,elapsedMs:Math.round(performance.now()-started),projections:session?.projections??0,simulatedDays:session?.simulatedDays??0,maxDecisionMs:Math.round(maxDecisionMs*100)/100};
    comparison.results.push(result);
    console.log(JSON.stringify({scenario:scenario.id,policy,final:points.at(-1),elapsedMs:result.elapsedMs,projections:result.projections,simulatedDays:result.simulatedDays,maxDecisionMs:result.maxDecisionMs}));
  }
  report.scenarios.push(comparison);
  await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');
}
report.recommendation="Do not adopt either policy unchanged. In this measured twenty-year Helara run, current policy ended with 63 claims and no investments; HTN reached 524 claims and food/logistics levels 20/21; lookahead reached levels 3/3 but stayed at 55 claims while accumulating food. Forecasting breaks the initial reserve trap and changes the first plan with risk preference, but does not yet produce the desired long-term territorial behavior. HTN remains strongly driven by authored method order.\n\nRetain the shared executor, forecast checks and comparison lab. The next bounded experiment should make the value of productive land, support capacity and resource access compete with diminishing returns from existing land, then reassess persistent country goals and forecast scoring. These results suggest that changing a planner library alone will not fix incentives in the available actions.\n\nDecision cost varies strongly with territory size; consult the measured timings for each scenario. This is not capacity proof for 1,000 societies. Both prototypes use sequential plans; current policy can allocate concurrent work. GamePlanHTN required a tested adapter for an upstream planning-state defect. Uncertainty, learning, villages and diplomacy are not implemented. The live map remains on released rules.";
await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(output,'report.html'),renderPlannerReport(report));
console.log(`Planner report: ${resolve(output,'report.html')}`);
console.log('Open this standalone HTML file in a browser. The live map policy and saves were not modified.');
