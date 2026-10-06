import type { ChronicleEvent } from '../../shared/simulation.ts';
import { BUILDINGS } from './buildings.ts';
import { buildingCost, wealthFlows } from './economy.ts';
import { bySea, hasHarbor, lookAgain } from './perception.ts';
import { applyBuildings, endWonder, house } from './settlements.ts';
import { WONDERS } from './wonders.ts';
import type { Polity, Settlement, SimulationState, TickContext } from './state.ts';
import { BUILD_TUNING } from './tunables.ts';

/**
 * Construction system (VISION.md "Buildings", "Destruction"), monthly per civilization: upkeep is paid for its
 * standing buildings (unpaid, they wear down and are lost), and its buildings under construction are paid in
 * instalments while the treasury allows, then completed. Every completion and loss is an event with its causes.
 */
export function construct(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ') continue;
    payUpkeep(state, civ);
    build(state, context.tick, civ);
    buildWonders(state, context.tick, civ);
  }
}

/** A building's housing and bonus change its settlement; its region's townspeople move accordingly. */
function rehouse(state: SimulationState, settlement: Settlement) {
  applyBuildings(settlement);
  const group = state.groups[state.groupAt[settlement.region]];
  group.specialists = house(state, settlement.region, group.specialists, false);
}

function payUpkeep(state: SimulationState, civ: Polity) {
  // (Allocation-free in the usual month: everything paid and in good repair.)
  let yearly = 0;
  for (const groupId of civ.groups) for (const id of state.regionSettlements[state.groups[groupId].region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') yearly += settlement.bonus.upkeep;
  }
  for (const wonder of state.wonders) if (wonder.status === 'standing' && state.settlements[wonder.settlement].owner === civ.id) yearly += WONDERS[wonder.type].upkeep;
  if (yearly === 0) { civ.upkeepCarry = 0; return; }
  civ.upkeepCarry += yearly / 12;
  const due = Math.floor(civ.upkeepCarry);
  civ.upkeepCarry -= due;
  const flows = wealthFlows(state, civ), paid = Math.min(due, civ.wealth);
  civ.wealth -= paid;
  flows.upkeep += paid;
  // Paid in full, buildings mend; short, they wear in proportion to what went unpaid and are lost at nothing.
  const unpaid = due > 0 ? 1 - paid / due : 0;
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
    if (settlement.status !== 'alive' || settlement.owner !== civ.id) continue;
    const definition = WONDERS[wonder.type];
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
  state.wonders.push({ id: state.wonders.length, type, settlement: at, builder: civ.id, begunTick: tick, builtTick: null, status: 'building', spent: 0, cost: definition.cost, condition: 1, endedTick: null, causes: cited });
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
    const instalment = Math.min(project.cost - project.spent, Math.ceil(project.cost / definition.months), civ.wealth);
    if (instalment > 0) { const flows = wealthFlows(state, civ); civ.wealth -= instalment; project.spent += instalment; flows.construction += instalment; }
    if (project.spent < project.cost) { remaining.push(project); continue; }
    // A settlement that has shrunk below what the building needs no longer gets it.
    if (settlement.tier < definition.minTier) { state.metrics.projectsAbandoned++; continue; }
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
    if (settlement.status !== 'alive' || settlement.owner !== civ.id || settlement.buildings.some(building => building.type === type) || civ.projects.some(project => project.settlement === id && project.type === type)) continue;
    if (definition.coast && !bySea(state, settlement.cell)) continue;
    // One a region needs only one of: not if any settlement there has it or is building it.
    if (definition.perRegion && state.regionSettlements[settlement.region].some(other => state.settlements[other].status === 'alive'
      && (state.settlements[other].buildings.some(building => building.type === type) || civ.projects.some(project => project.settlement === other && project.type === type)))) continue;
    civ.projects.push({ settlement: id, type, spent: 0, cost, startedTick: tick, causes: cited });
    started++;
  }
  state.metrics.buildingsStarted += started;
  return started ? `began ${started === 1 ? BUILDINGS[type].one : `${started} ${BUILDINGS[type].many}`}` : 'nowhere left to build it';
}

