import { chooseCountryIntent, completeCountryIntent, type CountryCandidate } from './country-ai.ts';
import { isFoundingBiome } from '../../shared/civilization.ts';
import { WORLD_AREA_KM2, WORLD_BIOMES, WORLD_TILE_SIZE, type WorldManifest, type WorldTile } from '../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { parseSimulationState, type SimulationState } from '../../shared/simulation.ts';
import type { SettlementCenter, SettlementEnvironment, SettlementState } from '../../shared/settlements.ts';

export function createSettlementEnvironment(world: WorldManifest, tiles: WorldTile[]): SettlementEnvironment {
 const count = world.width * world.height;
 const env: SettlementEnvironment = { worldKey: world.worldKey, width: world.width, height: world.height,
  cellKm: Math.sqrt(WORLD_AREA_KM2 / count), biome: Array(count), fertility: Array(count), resource: Array(count), elevation: Array(count) };
 for (const tile of tiles) for (let at = 0; at < WORLD_TILE_SIZE ** 2; at++) {
  const id = (tile.y * WORLD_TILE_SIZE + Math.floor(at / WORLD_TILE_SIZE)) * world.width + tile.x * WORLD_TILE_SIZE + at % WORLD_TILE_SIZE;
  for (const field of ['biome','fertility','resource','elevation'] as const) env[field][id] = tile.fields[field][at];
 }
 return env;
}
function center(id: string, name: string, cellId: number, population: number, food: number, day = 0): SettlementCenter {
 return { id, name, cellId, population, food, kind: 'camp', territory: [cellId], workingCells: [], collected: 0, consumed: 0,
 shortfall: 0, foundedDay: day, prosperousDays: 0, foundingCellId: null, foundingDays: 0, territoryLastWorked: [day], decision: 'Establishing a camp and assessing nearby food.', prospectCellId: null, prospectDays: 0 };
}
export function initialSettlements(name: string, cellId: number, day = 0): SettlementState {
 return { initialCellId: cellId, startedDay: day, mainSettlementId: 'settlement-1', nextSettlementId: 2,
 centers: [center('settlement-1', name, cellId, 250, 7500, day)], history: [], totalCollected: 0, totalConsumed: 0, totalShortfall: 0, establishmentSpent: 0 };
}
export function migrateTribeState(state: SimulationState, environment: SettlementEnvironment): SimulationState {
 if (state.worldKey !== environment.worldKey) throw new Error('Settlement geography belongs to a different world.');
 if (state.settlements) return state;
 return parseSimulationState({ ...state, protocolVersion: 2, rulesVersion: 2, revision: state.revision + 1,
 settlements: initialSettlements(state.tribe.name, state.tribe.originCellId, state.elapsedDays) });
}
function land(env: SettlementEnvironment, id: number) {
 return env.elevation[id] >= 0 && !['ocean','coast','seaIce','lake','lakeIce','snow','mountain'].includes(WORLD_BIOMES[env.biome[id]]);
}
export function settlementNeighbors(env: SettlementEnvironment, id: number): number[] {
 const x = id % env.width, y = Math.floor(id / env.width);
 return [y * env.width + (x + env.width - 1) % env.width, y * env.width + (x + 1) % env.width,
 ...(y > 0 ? [id - env.width] : []), ...(y + 1 < env.height ? [id + env.width] : [])];
}
/** Neighbor length follows the same equal-area spherical projection as fertility. */
export function settlementDistanceKm(env: SettlementEnvironment, from: number, to: number): number {
 const y = Math.floor(from / env.width), nextY = Math.floor(to / env.width), radius = Math.sqrt(WORLD_AREA_KM2 / (4 * Math.PI));
 const latitude = Math.asin(1 - 2 * (y + .5) / env.height);
 return y === nextY ? 2 * radius * Math.asin(Math.cos(latitude) * Math.sin(Math.PI / env.width))
  : radius * Math.abs(latitude - Math.asin(1 - 2 * (nextY + .5) / env.height));
}
/** Fixed physical reach, four-neighbor land paths; inland water is not a free travel bridge. */
function reachable(env: SettlementEnvironment, start: number, maxKm: number) {
 const distances = new Map<number, number>([[start, 0]]), pending = [start];
 while (pending.length) {
  pending.sort((a,b) => distances.get(a)! - distances.get(b)! || a-b);
  const at = pending.shift()!, distance = distances.get(at)!;
  for (const id of settlementNeighbors(env, at)) {
   if (!land(env, id)) continue;
   const biome = WORLD_BIOMES[env.biome[id]];
   const cost = settlementDistanceKm(env, at, id) * (1 + Math.abs(env.elevation[id] - env.elevation[at]) / 600 + (['forest','rainforest','wetland'].includes(biome) ? .5 : 0));
   const next = distance + cost;
   if (next <= maxKm && next < (distances.get(id) ?? Infinity)) { distances.set(id, next); if (!pending.includes(id)) pending.push(id); }
  }
 }
 return distances;
}
/** Recognition is explicit: minerals have no value to this early food economy. */
function foodRate(env: SettlementEnvironment, id: number) {
 const biome = WORLD_BIOMES[env.biome[id]], resource = RESOURCE_IDS[env.resource[id] - 1];
 const baseline = ['desert','tundra'].includes(biome) ? .3 : .9;
 const edible = resource === 'grain' || resource === 'game' ? 1.2 : 0;
 const fishing = settlementNeighbors(env,id).some(n => RESOURCE_IDS[env.resource[n]-1] === 'fish') ? 1 : 0;
 return baseline + env.fertility[id] / 30 + edible + fishing;
}
function event(sim: SettlementState, day: number, kind: SettlementState['history'][number]['kind'], c: SettlementCenter, message: string, cellId = c.cellId) {
 sim.history.push({ day, kind, settlementId: c.id, cellId, message });
 if (sim.history.length > 32) sim.history.shift();
}
function expectedFood(env: SettlementEnvironment, cellId: number, workers: number, available: (id: number) => boolean) {
 const rates = [...reachable(env,cellId,180)].filter(([id]) => available(id)).map(([id,d]) => foodRate(env,id)/(1+d/100)).sort((a,b) => b-a);
 let food = 0;
 for (const rate of rates) { const assigned = Math.min(60,workers); food += Math.floor(assigned*rate); workers -= assigned; if (!workers) break; }
 return food;
}
export function validateSettlementGeography(state: SimulationState, env: SettlementEnvironment): void {
 if (state.worldKey !== env.worldKey) throw new Error('Settlement geography belongs to a different world.');
 for (const c of state.settlements?.centers ?? []) {
  if (!land(env,c.cellId) || !isFoundingBiome(WORLD_BIOMES[env.biome[c.cellId]])
   || [...c.territory,...c.workingCells].some(id => !land(env,id))) throw new Error('Settlement geography contains invalid inhabited or claimed land.');
 }
 for(const d of state.ai?.decisions ?? []) {
  if(d.targetCellId===null) continue;
  const c=state.settlements!.centers.find(center=>center.id===d.settlementId)!;
  const distance=reachable(env,c.cellId,d.goal==='found' ? 360 : 180).get(d.targetCellId);
  const cost=d.goal==='found' ? 2400+80*Math.ceil((distance??Infinity)/20)
   : d.goal==='relocate' ? c.population*Math.max(2,Math.ceil((distance??Infinity)/20)) : 0;
  if(distance===undefined || !land(env,d.targetCellId) || d.reservedFood!==cost
   || d.goal==='found' && distance<180) throw new Error('Invalid country AI project geography or reservation; saved data has been preserved.');
 }

}
export function advanceSettlements(state: SimulationState, env: SettlementEnvironment): void {
 validateSettlementGeography(state,env);
 const sim = state.settlements!, used = new Set<number>(), claimed = new Set(sim.centers.flatMap(c => c.territory));
 for (const c of [...sim.centers]) {
  const paths = reachable(env, c.cellId, 360), workers = Math.floor(c.population * .6);
  const sites = [...paths].filter(([id,d]) => d <= 180 && !used.has(id) && (c.territory.includes(id) || !claimed.has(id)))
   .map(([id,d]) => ({ id, d, rate: foodRate(env,id) / (1 + d / 100) }))
   .sort((a,b) => b.rate-a.rate || a.id-b.id);
  let labor = workers; c.collected = 0; c.workingCells = [];
  for (const site of sites) {
   if (labor <= 0) break;
   const assigned = Math.min(60, labor); labor -= assigned; used.add(site.id); c.workingCells.push(site.id);
   c.collected += Math.floor(assigned * site.rate);
  }
  c.food += c.collected; c.consumed = Math.min(c.food, c.population); c.food -= c.consumed; c.shortfall = c.population - c.consumed;
  sim.totalCollected += c.collected; sim.totalConsumed += c.consumed; sim.totalShortfall += c.shortfall;
  c.prosperousDays = c.collected >= c.population && !c.shortfall ? c.prosperousDays + 1 : 0;
  const retained = c.territory.map((id,i) => ({ id, day: id === c.cellId || c.workingCells.includes(id) ? state.elapsedDays : c.territoryLastWorked[i] }));
  for (const entry of retained) if (state.elapsedDays-entry.day > 30) claimed.delete(entry.id);
  const active = retained.filter(entry => state.elapsedDays-entry.day <= 30);
  c.territory = active.map(e => e.id); c.territoryLastWorked = active.map(e => e.day);
  c.decision = c.shortfall ? 'Food is insufficient; seeking a better supported location.' : c.collected >= c.population ? 'Local gathering and hunting cover food needs; assessing nearby opportunities.' : 'Using stored food while seeking more productive ground.';
  // Establish only cells actually worked repeatedly, attached to this center's existing presence.
  let frontier = sites.find(s => c.workingCells.includes(s.id) && !claimed.has(s.id) && settlementNeighbors(env,s.id).some(n => c.territory.includes(n)));
  const available = (id: number) => (!used.has(id) || c.workingCells.includes(id)) && (!claimed.has(id) || c.territory.includes(id));
  const currentYield = expectedFood(env,c.cellId,workers,available);
  let better = c.kind === 'camp' ? sites.find(s => s.id !== c.cellId && !claimed.has(s.id) && isFoundingBiome(WORLD_BIOMES[env.biome[s.id]])
   && foodRate(env,s.id) > foodRate(env,c.cellId) && expectedFood(env,s.id,workers,available) > currentYield * 1.15) : undefined;
  let aiFounding: [number,number] | undefined;
  if (state.ai) {
   const ai=state.ai, profile=ai.profile, reserve=c.food/c.population;
   const crisis=c.shortfall>0 || c.collected<c.population && reserve<7;
   const candidates: CountryCandidate[]=[];
   const score=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
   const add=(goal:CountryCandidate['goal'],targetCellId:number|null,value:number,eligible:boolean,reason:string,reservedFood=0,reservedPeople=0)=>
    candidates.push({goal,targetCellId,score:score(value),eligible,reason,reservedFood,reservedPeople});
   add('consolidate',null,crisis ? 75 : 40+Math.max(0,profile.reserveDays-reserve)*.5,true,
    c.collected<c.population ? 'Use local reserves and protect food supplies while seeking viable improvements.' : 'Gather food and build local reserves before further commitments.');
   const frontiers=sites.filter(site=>c.workingCells.includes(site.id) && !claimed.has(site.id) && settlementNeighbors(env,site.id).some(n=>c.territory.includes(n))).slice(0,3);
   for(const site of frontiers) add('expand',site.id,42+profile.expansion*.22, !crisis && reserve>=7,
    !crisis && reserve>=7 ? 'Sustained work can extend local presence onto accessible food ground.' : 'Food pressure prevents committing to more local territory.');
   if(!frontiers.length) add('expand',null,0,false,'No unclaimed neighboring working cell can support local expansion.');
   if(better) {
    const cost=c.population*Math.max(2,Math.ceil(better.d/20));
    const viable=c.food>=cost+c.population*7;
    add('relocate',better.id,crisis ? 100 : 48+profile.mobility*.3,viable,
     viable ? 'Better accessible food justifies a provisioned move.' : 'A move would leave fewer than seven days of food.',cost);
   } else add('relocate',null,0,false,c.kind==='camp' ? 'No accessible site offers a sustained food improvement.' : 'This established community is committed to its location.');
   const inhabitedReach=sim.centers.map(other=>reachable(env,other.cellId,180));
   const foundingSites=[...paths].filter(([id,d])=>d>=180 && !claimed.has(id) && foodRate(env,id)>=2.25
    && isFoundingBiome(WORLD_BIOMES[env.biome[id]]) && inhabitedReach.every(reach=>!reach.has(id)))
    .sort((a,b)=>foodRate(env,b[0])/(1+b[1]/500)-foodRate(env,a[0])/(1+a[1]/500) || a[0]-b[0]).slice(0,3);
   for(const site of foundingSites) {
    const cost=80*30+80*Math.ceil(site[1]/20);
    const eligible=!crisis && state.elapsedDays-c.foundedDay>=90 && c.kind==='settlement' && c.population>=160
     && c.food>=cost+(c.population-80)*profile.reserveDays;
    const reason=eligible ? 'An accessible food site can support 80 settlers while preserving the parent’s preferred reserves.'
     : c.population<160 ? 'Too few people remain to support another community.'
     : c.kind!=='settlement' || state.elapsedDays-c.foundedDay<90 ? 'The parent community must establish itself before founding another.'
     : 'Local food cannot yet provision 80 settlers and preserve the parent’s reserve target.';
    add('found',site[0],48+profile.expansion*.35+Math.min(10,Math.max(0,reserve-profile.reserveDays)/10),eligible,reason,cost,80);
   }
   if(!foundingSites.length) add('found',null,0,false,'No separate accessible food site is available within the known area.');
   const previous=ai.decisions.find(d=>d.settlementId===c.id);
   const decision=chooseCountryIntent(ai,c.id,state.elapsedDays,candidates,crisis);
   if(previous?.goal!==decision.goal || previous.targetCellId!==decision.targetCellId) {
    c.prospectCellId=null;c.prospectDays=0;c.foundingCellId=null;c.foundingDays=0;
   }
   c.decision=decision.reason;
   if(decision.goal!=='relocate') better=undefined;
   frontier=decision.goal==='expand' ? frontiers.find(site=>site.id===decision.targetCellId) : undefined;
   aiFounding=decision.goal==='found' ? foundingSites.find(site=>site[0]===decision.targetCellId) : undefined;
   if(!aiFounding) { c.foundingCellId=null; c.foundingDays=0; }
  }
  const prospect = better ?? frontier;
  if (prospect) {
   c.prospectDays = c.prospectCellId === prospect.id ? c.prospectDays + 1 : 1; c.prospectCellId = prospect.id;
   if (c.prospectDays >= Math.max(10, Math.ceil(prospect.d / 10))) {
    if (better) {
     const cost = c.population * Math.max(2, Math.ceil(prospect.d / 20));
     if (c.food >= cost + c.population * 7) {
      c.food -= cost; sim.establishmentSpent += cost;
      for (const id of c.territory) claimed.delete(id);
      c.cellId = better.id; c.territory = [better.id]; c.territoryLastWorked = [state.elapsedDays]; c.prosperousDays = 0; claimed.add(better.id);
      if (c.id === sim.mainSettlementId) state.tribe.originCellId = better.id;
      c.decision = 'Relocated after a sustained improvement in accessible food; supplies paid for the move.';
      event(sim,state.elapsedDays,'relocated',c,c.decision);
      if(state.ai) completeCountryIntent(state.ai,c.id,state.elapsedDays,c.decision);
     }
    } else { c.territory.push(prospect.id); c.territoryLastWorked.push(state.elapsedDays); claimed.add(prospect.id); event(sim,state.elapsedDays,'expanded',c,'Repeated local work established presence in a neighboring cell.',prospect.id); if(state.ai) completeCountryIntent(state.ai,c.id,state.elapsedDays,'Sustained local work extended territorial presence.'); }
    c.prospectDays = 0; c.prospectCellId = null;
   }
  } else { c.prospectDays = 0; c.prospectCellId = null; }
  if (c.prosperousDays >= 60 && c.food >= c.population * 30 && !better) c.kind = 'settlement';
  // New communities require a viable land route, a productive site, transferred people and provisions.
  if (state.ai ? !!aiFounding : state.elapsedDays - c.foundedDay >= 90 && c.kind === 'settlement' && c.population >= 160 && c.food >= c.population * 70) {
   const candidate = aiFounding ?? [...paths].filter(([id,d]) => d >= 180 && !claimed.has(id) && foodRate(env,id) >= 2.25 && isFoundingBiome(WORLD_BIOMES[env.biome[id]])
    && sim.centers.every(other => !reachable(env,other.cellId,180).has(id)))
    .sort((a,b) => foodRate(env,b[0])/(1+b[1]/500)-foodRate(env,a[0])/(1+a[1]/500) || a[0]-b[0])[0];
   if (candidate) {
    c.foundingDays = c.foundingCellId === candidate[0] ? c.foundingDays + 1 : 1; c.foundingCellId = candidate[0];
    c.decision = 'Preparing a new community: checking food access and provisioning the land journey.';
    if (c.foundingDays < 30 + Math.ceil(candidate[1]/20)) continue;
    const population = 80, provisions = population * 30, cost = population * Math.ceil(candidate[1] / 20);
    if (c.food >= provisions + cost + (c.population-population)*30) {
     c.population -= population; c.food -= provisions + cost; sim.establishmentSpent += cost;
     const id = `settlement-${sim.nextSettlementId++}`, added = center(id, `${state.tribe.name} ${sim.nextSettlementId-1}`,candidate[0],population,provisions,state.elapsedDays);
     c.foundingCellId = null; c.foundingDays = 0;
     sim.centers.push(added); claimed.add(candidate[0]); event(sim,state.elapsedDays,'established',added,'A new community was founded with 80 people and supplies transferred from an existing settlement.');
     c.decision = 'Supported a new community with people and supplies.';
     if(state.ai) completeCountryIntent(state.ai,c.id,state.elapsedDays,c.decision);
    }
   } else { c.foundingCellId = null; c.foundingDays = 0; }
  } else { c.foundingCellId = null; c.foundingDays = 0; }
 }
}
