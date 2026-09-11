import type { PlannerStudyReport } from './report-types.ts';

export function renderPlannerReport(report: PlannerStudyReport): string {
  // JSON lives in a raw-text script element. Escaping '<' prevents both closing
  // tags and HTML comment/parser-state tricks; the viewer only writes text nodes.
  const data = JSON.stringify(report).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Chronicle · Country planner study</title>
<style>
:root{font-family:system-ui,sans-serif;color:#233e3a;background:#f5f3e9;font-synthesis:none;--line:#d7ddd1;--muted:#65776f;--teal:#27665d}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;padding:44px 28px 56px;margin:auto}h1,h2,h3,p{margin-top:0}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:clamp(2.2rem,5vw,3.6rem);letter-spacing:-.035em;line-height:1.12;margin:15px 0}h2{font-size:1.55rem;margin-bottom:16px}h3{font-size:1rem}.eyebrow{font-size:.7rem;letter-spacing:.17em;text-transform:uppercase;color:var(--teal);font-weight:700}.intro{max-width:740px;line-height:1.7;color:var(--muted)}.experiment{border-left:3px solid #b48643;background:#eee9d8;padding:14px 18px;font-size:.86rem;line-height:1.6;margin:26px 0}.experiment strong{display:block;font-size:.7rem;letter-spacing:.12em}.controls{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;margin:26px 0 20px}.controls>div,.decision-layout>div{min-width:0}label{margin-bottom:8px;display:grid;gap:8px;font-size:.74rem;font-weight:650;color:#4c665e;min-width:0}select{width:100%;min-width:0;padding:11px 34px 11px 12px;background:#fffef7;border:1px solid #b8c8ba;border-radius:4px;color:#233e3a;font:inherit;font-size:.86rem}select:focus-visible{outline:3px solid #8bb5a3;outline-offset:2px}.scenario-description{font-size:.9rem;line-height:1.7;color:var(--muted);overflow-wrap:anywhere}.card{background:#fffef7;border:1px solid var(--line);padding:24px;border-radius:7px;margin:20px 0}.chart-heading{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:baseline}.chart-heading h2{margin:0}.small{font-size:.78rem;color:var(--muted);line-height:1.65}.legend{display:flex;flex-wrap:wrap;gap:10px 20px;margin:20px 0 0;font-size:.8rem}.legend span{display:flex;gap:7px;align-items:center;overflow-wrap:anywhere;min-width:0}.legend i{display:inline-block;flex:0 0 20px;height:3px;border-radius:2px}.legend .selected{font-weight:750}svg{display:block;width:100%;height:auto;margin-top:15px;overflow:visible}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.stat{background:#e9eee3;border:1px solid var(--line);padding:16px;border-radius:5px;min-width:0}.stat dt{font-size:.73rem;color:var(--muted);line-height:1.5}.stat dd{margin:9px 0 0;font-family:Georgia,serif;font-size:1.9rem;overflow-wrap:anywhere}.policy-heading{margin:26px 0 0;font-size:1rem;overflow-wrap:anywhere}.table-scroll{overflow:auto;max-width:100%;border:1px solid var(--line);border-radius:4px}table{border-collapse:collapse;min-width:640px;width:100%;font-size:.81rem;text-align:left}th,td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}th{font-size:.71rem;color:var(--muted);font-weight:650;background:#f0f2e9}td:not(:first-child),th:not(:first-child){white-space:nowrap}tbody tr:last-child td{border-bottom:0}td:first-child{min-width:145px;max-width:300px}tr.selected{background:#eaf1e6}caption{text-align:left;padding:10px 14px;color:var(--muted)}.decision-layout{display:grid;grid-template-columns:minmax(190px,1fr) minmax(0,2fr);gap:24px;margin:20px 0}.decision-reason{margin:0;line-height:1.75;font-size:.9rem;overflow-wrap:anywhere}.decision-meta{font-size:.75rem;color:var(--muted);margin:0 0 8px}.recommendation{border-top:1px solid var(--line);padding-top:24px;margin-top:32px}.recommendation p{line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}.footnote{margin-top:24px;font-size:.75rem;line-height:1.8;color:var(--muted);overflow-wrap:anywhere}[hidden]{display:none!important}@media(max-width:650px){main{padding:28px 16px 36px}.controls{grid-template-columns:1fr}.card{padding:16px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat dd{font-size:1.6rem}.decision-layout{grid-template-columns:1fr;gap:16px}.chart-heading{display:block}.chart-heading .small{margin-top:8px}svg{margin-top:20px}.legend{gap:12px}h2{font-size:1.4rem}}
</style></head><body><main>
<header><div class="eyebrow">Chronicle / Research notebook</div><h1>How should a country<br>choose its next move?</h1><p class="intro">A measured comparison of country planning policies. Follow the same starting conditions through time, then inspect the plans and forecast alternatives behind each decision.</p></header>
<aside class="experiment"><strong>EXPERIMENT · OFFLINE STUDY</strong>The live map still uses the released policy. This report displays recorded comparisons; its controls do not run simulations or modify live saves.</aside>
<section aria-label="Study controls" class="controls"><div><label for="scenario">Scenario</label><select id="scenario"></select></div><div><label for="policy">Inspect policy</label><select id="policy"></select></div><div><label for="metric">Chart metric</label><select id="metric"><option value="claims">Claimed cells</option><option value="population">Population</option><option value="food">Stored food</option><option value="foodLevel">Food gathering level</option><option value="logisticsLevel">Logistics level</option><option value="starvation">Starvation deaths</option><option value="projects">Active projects</option></select></div></section>
<p class="scenario-description" data-scenario-description></p><p id="empty" hidden>No observations were recorded for this scenario.</p>
<div id="observations"><section class="card" aria-label="Trajectory comparison"><div class="chart-heading"><h2 id="chart-title">Claimed cells</h2><span class="small">All recorded policies · selected policy emphasized</span></div><svg id="chart" role="img" aria-label="Policy trajectories" viewBox="0 0 1000 340"></svg><div id="legend" class="legend"></div><p class="small">Horizontal axis: absolute elapsed simulation day. Dots are recorded observations; connecting lines do not add measurements. Hover a dot for its value.</p></section>
<h2 class="policy-heading" id="policy-heading"></h2><dl class="stats"><div class="stat"><dt>Final population</dt><dd data-summary="population"></dd></div><div class="stat"><dt>Final claimed cells</dt><dd data-summary="claims"></dd></div><div class="stat"><dt>Final food · person-days</dt><dd data-summary="food"></dd></div><div class="stat"><dt>Food / logistics levels</dt><dd data-summary="levels"></dd></div></dl><p class="small" id="run-summary"></p>
<section class="card" aria-label="Measured outcomes"><h2>Measured outcomes &amp; computation</h2><div class="table-scroll" tabindex="0" aria-label="Policy outcome table"><table id="outcomes"><thead><tr><th scope="col">Policy</th><th scope="col">Final claims</th><th scope="col">Starvation deaths</th><th scope="col">Run time, ms</th><th scope="col">Projection transitions</th><th scope="col">Forecast days</th><th scope="col">Max decision, ms</th></tr></thead><tbody></tbody></table></div><p class="small">Run time measures the whole comparison execution on this machine. The current policy’s individual decision time was not separately measured (—). Projection transitions and forecast days count only planning work; zero means no forecasting, not no live simulation. These costs are not a many-country capacity promise.</p></section>
<section class="card" aria-label="Decision exploration"><h2>Why this plan?</h2><div class="decision-layout"><div><label for="decision">Recorded decision</label><select id="decision"></select></div><div><p class="decision-meta" id="decision-meta"></p><p class="decision-reason" data-decision-reason></p></div></div><div class="table-scroll" tabindex="0" aria-label="Forecast alternatives table"><table data-alternatives><thead><tr><th scope="col">Alternative plan</th><th scope="col">Feasibility</th><th scope="col">Utility score</th><th scope="col">Lowest reserve, days</th><th scope="col">Endpoint net food / day</th><th scope="col">Forecast claims</th></tr></thead><tbody></tbody></table></div><p class="small">Outcome search prefers higher utility scores within a decision; ordered HTN selects its first feasible method. Lowest reserve is unreserved food per living person along the projection. Endpoint net food subtracts consumption and territory upkeep. Unavailable alternatives have no meaningful forecast values. Current-policy decisions are sampled at month end; experimental decisions are retained throughout. Decision counts and gaps are not comparable.</p></section></div>
<section class="recommendation" aria-label="Study interpretation"><h2>Recorded interpretation</h2><p id="recommendation"></p></section><footer class="footnote" id="metadata"></footer><noscript>This offline report needs JavaScript to display the embedded measurements. No network connection is required.</noscript>
</main><script id="study-data" type="application/json">${data}</script><script>${viewer}</script></body></html>`;
}

const viewer = String.raw`
'use strict';
const report = JSON.parse(document.getElementById('study-data').textContent);
const byId = id => document.getElementById(id);
const format = value => Number.isFinite(value) ? new Intl.NumberFormat('en', {maximumFractionDigits: 2}).format(value) : 'Unavailable';
const colors = ['#27665d', '#b27435', '#75639c', '#367dad', '#9a4f60', '#778537'];
const labels = {claims:'Claimed cells', population:'Population', food:'Stored food · person-days', foodLevel:'Food gathering level', logisticsLevel:'Logistics level', starvation:'Starvation deaths', projects:'Active projects'};
const text = (tag, value, parent) => { const node = document.createElement(tag); node.textContent = value; if(parent)parent.append(node); return node; };
const svg = (tag, attributes, value) => { const node = document.createElementNS('http://www.w3.org/2000/svg',tag); for(const [key,val] of Object.entries(attributes))node.setAttribute(key,String(val)); if(value!==undefined)node.textContent=value; return node; };
const fillOptions = (select, values) => {select.replaceChildren();values.forEach((label,index)=>{const option=text('option',label,select);option.value=String(index);});};
const scenario = () => report.scenarios[Number(byId('scenario').value)];
const result = () => scenario()?.results[Number(byId('policy').value)];
byId('recommendation').textContent=report.recommendation || 'No interpretation was recorded.';
byId('metadata').textContent='Generated '+report.generatedAt+' · Library: '+report.library+' · Report format '+report.version+'. This artifact contains its own data and requires no external services.';
fillOptions(byId('scenario'),report.scenarios.map(item=>item.label));

function drawChart(){
 const chart=byId('chart'), s=scenario(), metric=byId('metric').value, selected=Number(byId('policy').value);
 if(!s)return;
 const width=Math.max(320,chart.clientWidth);chart.setAttribute('viewBox','0 0 '+width+' 340');
 chart.replaceChildren();chart.dataset.metric=metric;chart.dataset.scenario=s.id;byId('chart-title').textContent=labels[metric];byId('legend').replaceChildren();
 const points=s.results.flatMap(run=>run.points).filter(point=>Number.isFinite(point[metric])&&Number.isFinite(point.day));
 if(!points.length){chart.append(svg('text',{x:width/2,y:170,'text-anchor':'middle',fill:'#65776f'},'No recorded points for this metric.'));return;}
 let minDay=Infinity,maxDay=-Infinity,minimum=0,maximum=1;
 for(const point of points){minDay=Math.min(minDay,point.day);maxDay=Math.max(maxDay,point.day);minimum=Math.min(minimum,point[metric]);maximum=Math.max(maximum,point[metric]);}
 const x=day=>65+(day-minDay)/Math.max(1,maxDay-minDay)*(width-85),y=value=>275-(value-minimum)/(maximum-minimum)*240;
 for(let n=0;n<=4;n++){const value=minimum+(maximum-minimum)*n/4,pos=y(value);chart.append(svg('line',{x1:65,x2:width-20,y1:pos,y2:pos,stroke:'#e0e5d9'}),svg('text',{x:55,y:pos+4,'text-anchor':'end','font-size':12,fill:'#65776f'},format(value)));}
 const ticks=width<600?2:4;
 for(let n=0;n<=(maxDay===minDay?0:ticks);n++){const day=minDay+(maxDay-minDay)*n/ticks;chart.append(svg('text',{x:x(day),y:301,'text-anchor':n===0?'start':n===ticks?'end':'middle','font-size':12,fill:'#65776f'},format(day)));}
 chart.append(svg('text',{x:width/2,y:333,'text-anchor':'middle','font-size':12,fill:'#65776f'},'Elapsed simulation day'));
 s.results.forEach((run,index)=>{
  const color=colors[index%colors.length],valid=run.points.filter(point=>Number.isFinite(point[metric])&&Number.isFinite(point.day));
  const group=svg('g',{'data-series':index,'data-values':valid.map(p=>p[metric]).join(',')});
  group.append(svg('polyline',{points:valid.map(p=>x(p.day)+','+y(p[metric])).join(' '),fill:'none',stroke:color,'stroke-width':index===selected?3.5:2,'stroke-opacity':index===selected?1:.55,'vector-effect':'non-scaling-stroke'}));
  for(const point of valid){const dot=svg('circle',{cx:x(point.day),cy:y(point[metric]),r:index===selected?3.5:2.5,fill:color});dot.append(svg('title',{},run.policy+' · Elapsed day '+point.day+' · '+labels[metric]+': '+format(point[metric])));group.append(dot);}
  chart.append(group);
  const label=text('span','',byId('legend'));if(index===selected)label.className='selected';const swatch=text('i','',label);swatch.style.backgroundColor=color;text('span',run.policy,label);
 });
}
function showDecision(){
 const run=result(),decision=run?.decisions[Number(byId('decision').value)],body=document.querySelector('[data-alternatives] tbody');body.replaceChildren();
 byId('decision-meta').textContent=decision?'Recorded at elapsed day '+format(decision.day)+' · '+decision.plan:'';
 document.querySelector('[data-decision-reason]').textContent=decision?decision.reason:'No recorded planning decisions for this policy.';
 if(!decision)return;
 for(const alternative of decision.alternatives){const row=text('tr','',body);for(const value of [alternative.plan,alternative.feasible?'Feasible':'Unavailable',...['score','minReserveDays','netFood','claims'].map(key=>alternative.feasible?format(alternative[key]):'—')])text('td',value,row);}
}
function showPolicy(){
 const run=result();if(!run)return;const last=run.points.at(-1);
 byId('policy-heading').textContent=run.policy+' · final recorded state';
 for(const key of ['population','claims','food'])document.querySelector('[data-summary="'+key+'"]').textContent=last?format(last[key]):'Unavailable';
 document.querySelector('[data-summary="levels"]').textContent=last?format(last.foodLevel)+' / '+format(last.logisticsLevel):'Unavailable';
 byId('run-summary').textContent=last?'Comparison starts at elapsed day '+format(run.initialDay)+'; final observation at day '+format(last.day)+' ('+format((last.day-run.initialDay)/360)+' years later). '+format(last.projects)+' active projects at the final observation.':'This policy has no recorded observations.';
 fillOptions(byId('decision'),run.decisions.map(decision=>'Day '+decision.day+' · '+decision.plan));byId('decision').disabled=!run.decisions.length;
 document.querySelectorAll('#outcomes tbody tr').forEach((row,index)=>row.classList.toggle('selected',index===Number(byId('policy').value)));
 drawChart();showDecision();
}
function showScenario(){
 const s=scenario(),hasResults=Boolean(s?.results.length);byId('empty').hidden=hasResults;byId('observations').hidden=!hasResults;byId('policy').disabled=!hasResults;byId('metric').disabled=!hasResults;
 document.querySelector('[data-scenario-description]').textContent=s?.description??'';fillOptions(byId('policy'),s?.results.map(run=>run.policy)??[]);
 const body=document.querySelector('#outcomes tbody');body.replaceChildren();
 if(!hasResults)return;
 for(const run of s.results){const last=run.points.at(-1),row=text('tr','',body);for(const value of [run.policy,last?format(last.claims):'Unavailable',last?format(last.starvation):'Unavailable',format(run.elapsedMs),format(run.projections),format(run.simulatedDays),run.policy==='current'?'—':format(run.maxDecisionMs)])text('td',value,row);}
 showPolicy();
}
byId('scenario').addEventListener('change',showScenario);byId('policy').addEventListener('change',showPolicy);byId('metric').addEventListener('change',drawChart);byId('decision').addEventListener('change',showDecision);window.addEventListener('resize',()=>{if(!byId('observations').hidden)drawChart();});showScenario();
`;
