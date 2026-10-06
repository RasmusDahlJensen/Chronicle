import type { ChronicleEvent } from '../../shared/simulation.ts';
import { BUILDINGS } from './buildings.ts';
import { wealthFlows } from './economy.ts';
import { applyBuildings, house } from './settlements.ts';
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
  if (yearly === 0) { civ.upkeepCarry = 0; return; }
  civ.upkeepCarry += yearly / 12;
  const due = Math.floor(civ.upkeepCarry);
  civ.upkeepCarry -= due;
  const paid = Math.min(due, civ.wealth);
  civ.wealth -= paid;
  wealthFlows(state, civ).upkeep += paid;
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
      state.chronicle.emit({
        type: 'buildingDecayed', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: settlement.id,
        causes: [{ factor: 'unpaidUpkeep', weight: Math.max(0.001, Math.round(unpaid * 1000) / 1000) }], importance: 0.06,
        data: { building: BUILDINGS[building.type].name, name: settlement.name, civ: civ.name },
      });
    }
    if (lost) { settlement.buildings = settlement.buildings.filter(building => building.condition > 0); rehouse(state, settlement); }
  }
  civ.repairing = worn;
}

function build(state: SimulationState, tick: number, civ: Polity) {
  // (A building completed this month counts from this month.)
  const remaining: Polity['projects'] = [];
  for (const project of civ.projects) {
    const settlement = state.settlements[project.settlement], definition = BUILDINGS[project.type];
    // A settlement lost or fallen to ruin takes the work with it.
    if (settlement.status !== 'alive' || settlement.owner !== civ.id || settlement.buildings.some(building => building.type === project.type)) { state.metrics.projectsAbandoned++; continue; }
    const instalment = Math.min(definition.cost - project.spent, Math.ceil(definition.cost / definition.months), civ.wealth);
    if (instalment > 0) { civ.wealth -= instalment; project.spent += instalment; wealthFlows(state, civ).construction += instalment; }
    if (project.spent < definition.cost) { remaining.push(project); continue; }
    settlement.buildings.push({ type: project.type, condition: 1, builtTick: tick });
    state.metrics.buildingsCompleted++;
    state.chronicle.emit({
      type: 'buildingCompleted', actors: [{ id: civ.id, role: 'civ' }], region: settlement.region, settlement: settlement.id,
      causes: project.causes, importance: definition.minTier >= 2 ? 0.05 : 0.02, data: { building: definition.name, name: settlement.name, civ: civ.name },
    });
    rehouse(state, settlement);
  }
  civ.projects = remaining;
}

/** The Build action carried out: the building begun in each chosen settlement still standing and without one. */
export function startProjects(state: SimulationState, tick: number, civ: Polity, type: number, settlements: number[], cited: ChronicleEvent['causes']): string {
  let started = 0;
  for (const id of settlements) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive' || settlement.owner !== civ.id || settlement.buildings.some(building => building.type === type) || civ.projects.some(project => project.settlement === id && project.type === type)) continue;
    civ.projects.push({ settlement: id, type, spent: 0, startedTick: tick, causes: cited });
    started++;
  }
  state.metrics.buildingsStarted += started;
  return started ? `began ${started === 1 ? 'a' : started} ${BUILDINGS[type].name}${started === 1 ? '' : 's'}` : 'nowhere left to build it';
}

