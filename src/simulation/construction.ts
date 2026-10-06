import type { ChronicleEvent } from '../../shared/simulation.ts';
import { regionCapacity } from './bands.ts';
import { BUILDINGS } from './buildings.ts';
import { buildingCost, wealthFlows } from './economy.ts';
import { bySea, hasHarbor, lookAgain, riverOrLake } from './perception.ts';
import { applyBuildings, endWonder, house, refreshRegionBonus } from './settlements.ts';
import { WONDERS } from './wonders.ts';
import { edgeBetween, keeperOf, knownRoadTier, ROAD_TIERS, roadKey, roadRoutes, roadUpkeep } from './roads.ts';
import type { Polity, Settlement, SimulationState, TickContext } from './state.ts';
import { BUILD_TUNING } from './tunables.ts';

/**
 * Construction system (VISION.md "Buildings", "Roads", "Destruction"), monthly per civilization: upkeep is paid for
 * its standing buildings, wonders and the roads it keeps (unpaid, they wear down and are lost), and its works under
 * construction are paid in instalments while the treasury allows, then completed. Roads no civilization keeps wear
 * away. Every completion and loss is an event with its causes.
 */
export function construct(state: SimulationState, context: TickContext) {
  const owed = roadDues(state);
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ') continue;
    payUpkeep(state, civ, owed[id]);
    build(state, context.tick, civ);
    buildWonders(state, context.tick, civ);
    buildRoads(state, context.tick, civ);
  }
  wearRoads(state);
}

// Reused monthly: the road upkeep a year each polity owes for the roads it keeps.
let dues = new Float64Array(0);
function roadDues(state: SimulationState) {
  if (dues.length < state.polities.length) dues = new Float64Array(Math.max(64, state.polities.length * 2));
  else dues.fill(0);
  for (const road of state.roads.values()) { const keeper = keeperOf(state, road); if (keeper >= 0) dues[keeper] += road.upkeep; }
  return dues;
}

/** A building's housing and bonus change its settlement; its region's townspeople move accordingly, and its land's
 *  capacity follows its irrigation. */
function rehouse(state: SimulationState, settlement: Settlement) {
  const farm = state.farmBonus[settlement.region];
  applyBuildings(settlement);
  refreshRegionBonus(state, settlement.region);
  const group = state.groups[state.groupAt[settlement.region]];
  group.specialists = house(state, settlement.region, group.specialists, false);
  if (state.farmBonus[settlement.region] !== farm) regionCapacity(state, settlement.region);
}

function payUpkeep(state: SimulationState, civ: Polity, roads: number) {
  // (Allocation-free in the usual month: everything paid and in good repair.)
  let yearly = roads;
  for (const groupId of civ.groups) for (const id of state.regionSettlements[state.groups[groupId].region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') yearly += settlement.bonus.upkeep;
  }
  for (const wonder of state.wonders) if (wonder.status === 'standing' && state.settlements[wonder.settlement].owner === civ.id) yearly += WONDERS[wonder.type].upkeep;
  if (yearly === 0) { civ.upkeepCarry = 0; civ.roadsUnpaid = 0; return; }
  civ.upkeepCarry += yearly / 12;
  const due = Math.floor(civ.upkeepCarry);
  civ.upkeepCarry -= due;
  const flows = wealthFlows(state, civ), paid = Math.min(due, civ.wealth);
  civ.wealth -= paid;
  flows.upkeep += paid;
  // Paid in full, buildings mend; short, they wear in proportion to what went unpaid and are lost at nothing.
  const unpaid = due > 0 ? 1 - paid / due : 0;
  // Its roads wear by the same share (`wearRoads`).
  civ.roadsUnpaid = unpaid;
  if (unpaid <= 0 && !civ.repairing) return;
  let worn = false;
  for (const groupId of civ.groups) for (const id of state.regionSettlements[state.groups[groupId].region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive' || !settlement.buildings.length) continue;
    let lost = false;
    for (const building of settlement.buildings) {
      building.condition = unpaid > 0 ? building.condition - unpaid / BUILD_TUNING.decayMonths : Math.min(1, building.condition + 1 / BUILD_TUNING.recoverMonths);
      if (building.condition < 1) worn = true;
      if (building.condition > 0) continue;
      lost = true;
      state.metrics.buildingsLost++;
      // A harbor lost: no more sailing from here.
      if (BUILDINGS[building.type].effects.harbor) { state.harbors[settlement.region]--; lookAgain(civ); }
      state.chronicle.emit({
        type: 'buildingDecayed', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: settlement.id,
        causes: [{ factor: 'unpaidUpkeep', weight: Math.max(0.001, Math.round(unpaid * 1000) / 1000) }], importance: 0.06,
        data: { building: BUILDINGS[building.type].name, the: `the ${BUILDINGS[building.type].name}`, name: settlement.name, civ: civ.name },
      });
    }
    if (lost) { settlement.buildings = settlement.buildings.filter(building => building.condition > 0); rehouse(state, settlement); }
  }
  // Its wonders wear and mend the same way; one worn away is destroyed.
  for (const wonder of state.wonders) {
    if (wonder.status !== 'standing' || state.settlements[wonder.settlement].owner !== civ.id) continue;
    wonder.condition = unpaid > 0 ? wonder.condition - unpaid / BUILD_TUNING.decayMonths : Math.min(1, wonder.condition + 1 / BUILD_TUNING.recoverMonths);
    if (wonder.condition < 1) worn = true;
    if (wonder.condition > 0) continue;
    const settlement = state.settlements[wonder.settlement];
    endWonder(state, wonder, state.tick, 'neglected');
    rehouse(state, settlement);
  }
  civ.repairing = worn;
}

/** Its wonders under way are paid in instalments while the treasury allows, and completed: a major event. */
function buildWonders(state: SimulationState, tick: number, civ: Polity) {
  for (const wonder of state.wonders) {
    if (wonder.status !== 'building') continue;
    const settlement = state.settlements[wonder.settlement];
    const definition = WONDERS[wonder.type];
    if (settlement.status !== 'alive' || settlement.owner !== civ.id) continue;
    // Work waits while its city is smaller than the wonder needs, and is given up after waiting too long.
    if (settlement.tier < definition.minTier) {
      if (++wonder.waited >= BUILD_TUNING.waitMonths) endWonder(state, wonder, tick, 'stalled');
      continue;
    }
    wonder.waited = 0;
    const instalment = Math.min(wonder.cost - wonder.spent, Math.ceil(wonder.cost / definition.months), civ.wealth);
    if (instalment > 0) { const flows = wealthFlows(state, civ); civ.wealth -= instalment; wonder.spent += instalment; flows.construction += instalment; }
    if (wonder.spent < wonder.cost) continue;
    wonder.status = 'standing'; wonder.builtTick = tick; settlement.wonder = wonder.type;
    state.metrics.wondersCompleted++;
    state.chronicle.emit({
      type: 'wonderCompleted', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: settlement.id, causes: wonder.causes, importance: 0.7,
      data: { wonder: definition.name, name: settlement.name, civ: civ.name, years: Math.round((tick - wonder.begunTick) / 12) },
    });
    rehouse(state, settlement);
  }
}

/** The Build action carried out for a wonder: begun in its city, a major event, unless another people builds it or it stands. */
export function beginWonder(state: SimulationState, tick: number, civ: Polity, type: number, at: number, cited: ChronicleEvent['causes']): string {
  const settlement = state.settlements[at], definition = WONDERS[type];
  if (settlement.status !== 'alive' || settlement.owner !== civ.id) return 'the city is gone';
  if (state.wonders.some(wonder => wonder.type === type && (wonder.status === 'building' || wonder.status === 'standing'))) return `${definition.name} is being built or stands elsewhere`;
  if (settlement.wonder !== null || state.wonders.some(wonder => wonder.settlement === at && wonder.status === 'building')) return `${settlement.name} already has a wonder`;
  if (settlement.tier < definition.minTier) return `${settlement.name} is too small for it`;
  state.wonders.push({ id: state.wonders.length, type, settlement: at, builder: civ.id, begunTick: tick, builtTick: null, status: 'building', spent: 0, cost: definition.cost, condition: 1, endedTick: null, endCause: null, causes: cited, waited: 0 });
  state.metrics.wondersBegun++;
  state.chronicle.emit({
    type: 'wonderBegun', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: at, causes: cited, importance: 0.3,
    data: { wonder: definition.name, name: settlement.name, civ: civ.name },
  });
  return `began ${definition.name} at ${settlement.name}`;
}

function build(state: SimulationState, tick: number, civ: Polity) {
  // (A building completed this month counts from this month.)
  const remaining: Polity['projects'] = [];
  for (const project of civ.projects) {
    const settlement = state.settlements[project.settlement], definition = BUILDINGS[project.type];
    // A settlement lost or fallen to ruin takes the work with it.
    if (settlement.status !== 'alive' || settlement.owner !== civ.id || settlement.buildings.some(building => building.type === project.type)) { state.metrics.projectsAbandoned++; continue; }
    // Work waits (unpaid) while the settlement is smaller than the building needs, and is given up after waiting too long.
    if (settlement.tier < definition.minTier) {
      if (++project.waited >= BUILD_TUNING.waitMonths) state.metrics.projectsAbandoned++; else remaining.push(project);
      continue;
    }
    project.waited = 0;
    const instalment = Math.min(project.cost - project.spent, Math.ceil(project.cost / definition.months), civ.wealth);
    if (instalment > 0) { const flows = wealthFlows(state, civ); civ.wealth -= instalment; project.spent += instalment; flows.construction += instalment; }
    if (project.spent < project.cost) { remaining.push(project); continue; }
    settlement.buildings.push({ type: project.type, condition: 1, builtTick: tick });
    // A harbor: the civilization's sea reach now starts here too (its sight is rebuilt); its first makes the sea fresh.
    if (definition.effects.harbor) {
      if (civ.knowledge.sea > 0 && !hasHarbor(state, civ)) civ.seaTick = tick;
      state.harbors[settlement.region]++; lookAgain(civ);
    }
    state.metrics.buildingsCompleted++;
    state.chronicle.emit({
      type: 'buildingCompleted', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: settlement.id,
      causes: project.causes, importance: definition.minTier >= 2 ? 0.05 : 0.02, data: { building: definition.name, one: definition.one, name: settlement.name, civ: civ.name },
    });
    rehouse(state, settlement);
  }
  civ.projects = remaining;
}

/** The Build action carried out: the building begun in each chosen settlement still standing and without one. */
export function startProjects(state: SimulationState, tick: number, civ: Polity, type: number, settlements: number[], cited: ChronicleEvent['causes']): string {
  let started = 0;
  const cost = buildingCost(state, civ, type);
  const definition = BUILDINGS[type];
  for (const id of settlements) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive' || settlement.owner !== civ.id || settlement.tier < definition.minTier || settlement.buildings.some(building => building.type === type) || civ.projects.some(project => project.settlement === id && project.type === type)) continue;
    if ((definition.coast && !bySea(state, settlement.cell)) || (definition.water && !riverOrLake(state, settlement.region))) continue;
    // One a region needs only one of: not if any settlement there has it or is building it.
    if (definition.perRegion && state.regionSettlements[settlement.region].some(other => state.settlements[other].status === 'alive'
      && (state.settlements[other].buildings.some(building => building.type === type) || civ.projects.some(project => project.settlement === other && project.type === type)))) continue;
    civ.projects.push({ settlement: id, type, spent: 0, cost, startedTick: tick, causes: cited, waited: 0 });
    started++;
  }
  state.metrics.buildingsStarted += started;
  return started ? `began ${started === 1 ? BUILDINGS[type].one : `${started} ${BUILDINGS[type].many}`}` : 'nowhere left to build it';
}


/** Its roads under way are paid in instalments while the treasury allows, then laid on their edges: an event. */
function buildRoads(state: SimulationState, tick: number, civ: Polity) {
  if (!civ.roadWorks.length) return;
  const remaining: Polity['roadWorks'] = [], n = state.partition.regions.length;
  for (const work of civ.roadWorks) {
    const target = state.settlements[work.to];
    // Land lost on the way, or the town fallen to ruin, ends the work.
    if (target.status !== 'alive' || target.owner !== civ.id || work.path.some(region => state.owner[region] !== civ.id)) { state.metrics.roadsAbandoned++; continue; }
    const instalment = Math.min(work.cost - work.spent, Math.ceil(work.cost / work.months), civ.wealth);
    if (instalment > 0) { const flows = wealthFlows(state, civ); civ.wealth -= instalment; work.spent += instalment; flows.construction += instalment; }
    if (work.spent < work.cost) { remaining.push(work); continue; }
    const definition = ROAD_TIERS[work.tier - 1];
    let bridges = 0;
    for (const [a, b] of work.edges) {
      const edge = edgeBetween(state, a, b)!, key = roadKey(n, a, b), bridge = definition.bridges && edge.riverTier >= 1;
      let road = state.roads.get(key);
      if (!road) { road = { a, b, tier: work.tier, bridge: false, condition: 1, builder: civ.id, builtTick: tick, upkeep: 0 }; state.roads.set(key, road); }
      else if (road.tier < work.tier) { road.tier = work.tier; road.builder = civ.id; road.builtTick = tick; }
      if (bridge && !road.bridge) {
        road.bridge = true; bridges++; state.metrics.bridgesBuilt++;
        if (state.metrics.firstBridgeTick < 0) state.metrics.firstBridgeTick = tick;
      }
      road.condition = 1; road.upkeep = roadUpkeep(road.tier, edge, road.bridge);
      state.metrics.roadEdgesBuilt++;
    }
    state.metrics.roadsBuilt++;
    state.chronicle.emit({
      type: 'roadBuilt', actors: [{ id: civ.id, role: 'civ' }], region: target.region, settlement: target.id, causes: work.causes, importance: work.tier >= 2 ? 0.05 : 0.03,
      data: { civ: civ.name, road: definition.one, from: state.settlements[work.from].name, to: target.name, bridges, oneBridge: bridges === 1, manyBridges: bridges > 1 },
    });
  }
  civ.roadWorks = remaining;
}

/**
 * Monthly, after upkeep: each road mends while its keeper pays in full and wears by the share it left unpaid; a road
 * no civilization keeps wears at the full rate (VISION.md: "the roads of a collapsed empire crumble over decades").
 * Roads worn away are lost: one event a month for each keeper's (and for the unkept), however many stretches.
 */
function wearRoads(state: SimulationState) {
  let lost: Map<number, { region: number; roads: number; unpaid: number }> | null = null;
  for (const [key, road] of state.roads) {
    const keeper = keeperOf(state, road), unpaid = keeper >= 0 ? state.polities[keeper].roadsUnpaid : 1;
    if (unpaid > 0) road.condition -= unpaid / BUILD_TUNING.roadDecayMonths;
    else if (road.condition < 1) road.condition = Math.min(1, road.condition + 1 / BUILD_TUNING.recoverMonths);
    if (road.condition > 0) continue;
    state.roads.delete(key);
    state.metrics.roadsLost++;
    lost ??= new Map();
    const entry = lost.get(keeper);
    if (entry) entry.roads++; else lost.set(keeper, { region: road.a, roads: 1, unpaid });
  }
  if (lost) for (const [keeper, entry] of lost) state.chronicle.emit({
    type: 'infrastructureDestroyed', actors: keeper >= 0 ? [{ id: keeper, role: 'civ' }] : [], region: entry.region, settlement: null,
    causes: [{ factor: keeper >= 0 ? 'unpaidUpkeep' : 'unkept', weight: Math.max(0.001, Math.round(entry.unpaid * 1000) / 1000) }], importance: Math.min(0.3, 0.02 + 0.005 * entry.roads),
    data: { civ: keeper >= 0 ? state.polities[keeper].name : '', roads: entry.roads, one: entry.roads === 1, many: entry.roads > 1, unpaid: keeper >= 0, unkept: keeper < 0 },
  });
}

/** The Build action carried out for roads: a road begun to each chosen town or city its roads do not yet reach. */
export function startRoads(state: SimulationState, tick: number, civ: Polity, targets: number[], cited: ChronicleEvent['causes']): string {
  const tier = knownRoadTier(civ.knowledge);
  if (!tier || civ.capital === null) return 'it knows no roads';
  const definition = ROAD_TIERS[tier - 1], begun: string[] = [];
  // Roads of a lower tier still under way are superseded where the new roads run (the work spent on them is lost).
  const superseded = (edges: [number, number][]) => {
    const keys = new Set(edges.map(([a, b]) => `${a},${b}`)), before = civ.roadWorks.length;
    civ.roadWorks = civ.roadWorks.filter(work => work.tier >= tier || !work.edges.some(([a, b]) => keys.has(`${a},${b}`)));
    state.metrics.roadsAbandoned += before - civ.roadWorks.length;
  };
  for (const id of targets) {
    // Searched again for each: the roads just begun claim their edges.
    const route = roadRoutes(state, civ, tier).find(entry => entry.settlement === id);
    if (!route) continue;
    superseded(route.edges);
    civ.roadWorks.push({
      from: civ.capital, to: id, path: route.path, tier, edges: route.edges, bridges: route.bridges,
      spent: 0, cost: Math.max(1, route.cost), months: Math.max(1, route.months), startedTick: tick, causes: cited,
    });
    begun.push(state.settlements[id].name);
  }
  state.metrics.roadsBegun += begun.length;
  return begun.length === 1 ? `began ${definition.one} to ${begun[0]}` : begun.length ? `began ${begun.length} ${definition.many}` : 'its roads already reach them';
}
