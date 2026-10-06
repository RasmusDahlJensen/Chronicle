import { RESOURCE_IDS, type Resource } from '../../shared/atlas.ts';
import { BUILDINGS } from './buildings.ts';
import { depositState } from './deposits.ts';
import { WONDERS } from './wonders.ts';
import { unrestDepth } from './pressure.ts';
import type { Polity, Settlement, SimulationState, WealthFlows } from './state.ts';
import { STABILITY_TUNING, WEALTH_TUNING } from './tunables.ts';

/**
 * Wealth and what buildings do for a region (VISION.md "Wealth", "Buildings"). Townspeople earn wealth for their
 * civilization, more in market towns; every change in a treasury is a recorded flow (rule 8). Buildings' effects are
 * read here by the systems they change: housing (`settlements.ts`), research, stability and the food store.
 */

/** This tick's wealth flows of a civilization, begun with its treasury as it stood when they began. */
export function wealthFlows(state: SimulationState, civ: Polity): WealthFlows {
  let flows = state.ledger.wealth.get(civ.id);
  if (!flows) { flows = { before: civ.wealth, produced: 0, construction: 0, upkeep: 0, received: 0, given: 0, lost: 0 }; state.ledger.wealth.set(civ.id, flows); }
  return flows;
}

/** What a settlement's townspeople earn in a year: each earns `perTownsperson`, more with markets, less in unrest. */
export function settlementIncome(state: SimulationState, settlement: Settlement) {
  return settlement.urban * WEALTH_TUNING.perTownsperson * settlement.bonus.wealth * (1 - STABILITY_TUNING.outputLoss * unrestDepth(state, settlement.region));
}

/**
 * Wealth a year from a region's sites of one kind (minerals or stone) that `civ` can use: what a mine or quarry there
 * works, or would work. Less in unrest, as all output is.
 */
export function siteIncome(state: SimulationState, civ: Polity, region: number, works: 'mineral' | 'stone') {
  let income = 0;
  for (const [, code] of state.partition.regions[region].sites) {
    const resource = RESOURCE_IDS[code - 1] as Resource | undefined;
    if (!resource || (resource === 'stone') !== (works === 'stone') || !(resource in WEALTH_TUNING.siteYield)) continue;
    if (depositState(civ.knowledge, resource) === 'usable') income += WEALTH_TUNING.siteYield[resource as keyof typeof WEALTH_TUNING.siteYield];
  }
  return income * (1 - STABILITY_TUNING.outputLoss * unrestDepth(state, region));
}

/** What the wonders standing in a civilization's settlements do for it, civilization-wide (VISION.md "Wonders"). */
export function wonderBonus(state: SimulationState, civ: Polity) {
  let research = 1, wealth = 1, stability = 0;
  for (const wonder of state.wonders) {
    if (wonder.status !== 'standing' || state.settlements[wonder.settlement].owner !== civ.id) continue;
    const effects = WONDERS[wonder.type].effects;
    research *= effects.research ?? 1; wealth *= effects.wealth ?? 1; stability += effects.stability ?? 0;
  }
  return { research, wealth, stability };
}

/** A civilization's income a year, as it stands this month: its townspeople's earnings and its worked sites, more
 *  with a wonder that raises wealth. */
export function incomeOf(state: SimulationState, civ: Polity) {
  return townsIncome(state, civ) * wonderBonus(state, civ).wealth;
}

function townsIncome(state: SimulationState, civ: Polity) {
  let income = 0;
  for (const groupId of civ.groups) {
    const region = state.groups[groupId].region;
    let mine = false, quarry = false;
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status !== 'alive') continue;
      income += settlementIncome(state, settlement);
      mine ||= settlement.bonus.mine; quarry ||= settlement.bonus.quarry;
    }
    // A region's sites are worked once, by its mine and its quarry.
    if (mine) income += siteIncome(state, civ, region, 'mineral');
    if (quarry) income += siteIncome(state, civ, region, 'stone');
  }
  return income;
}

/** Whether a civilization quarries stone it can use (its stone buildings cost less). */
export function quarriesStone(state: SimulationState, civ: Polity) {
  for (const groupId of civ.groups) {
    const region = state.groups[groupId].region;
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status === 'alive' && settlement.bonus.quarry && siteIncome(state, civ, region, 'stone') > 0) return true;
    }
  }
  return false;
}

/** What a building costs this civilization: less in stone where it quarries stone. */
export function buildingCost(state: SimulationState, civ: Polity, type: number) {
  const definition = BUILDINGS[type];
  return definition.stone && quarriesStone(state, civ) ? Math.round(definition.cost * WEALTH_TUNING.stoneDiscount) : definition.cost;
}

/** The upkeep a civilization owes a year for its standing buildings and wonders. */
export function upkeepOf(state: SimulationState, civ: Polity) {
  let upkeep = 0;
  for (const wonder of state.wonders) if (wonder.status === 'standing' && state.settlements[wonder.settlement].owner === civ.id) upkeep += WONDERS[wonder.type].upkeep;
  for (const groupId of civ.groups) for (const id of state.regionSettlements[state.groups[groupId].region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') upkeep += settlement.bonus.upkeep;
  }
  return upkeep;
}

/** Production system, after a civilization's townspeople are housed: a month of their earnings joins the treasury in
 *  whole units (the fraction waits for next month). */
export function produceWealth(state: SimulationState, civ: Polity) {
  civ.wealthCarry += incomeOf(state, civ) / 12;
  const produced = Math.floor(civ.wealthCarry);
  if (produced <= 0) return;
  const flows = wealthFlows(state, civ);
  civ.wealthCarry -= produced;
  civ.wealth += produced;
  flows.produced += produced;
}

/** Wealth passing from one civilization to another (the smaller's treasury when it unites with a larger one). */
export function transferWealth(state: SimulationState, from: Polity, to: Polity) {
  const amount = from.wealth, given = wealthFlows(state, from), received = wealthFlows(state, to);
  given.given += amount; received.received += amount;
  from.wealth = 0; to.wealth += amount;
}

/** A civilization that dies out loses its treasury and its unfinished buildings. */
export function loseWealth(state: SimulationState, civ: Polity) {
  if (civ.wealth > 0) { wealthFlows(state, civ).lost += civ.wealth; civ.wealth = 0; }
  state.metrics.projectsAbandoned += civ.projects.length;
  civ.projects = [];
}

/** Research of a region's townspeople, each settlement's times its buildings' research (libraries and the like). */
export function townsResearch(state: SimulationState, region: number) {
  let research = 0;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') research += settlement.urban * settlement.bonus.research;
  }
  return research;
}

/** Stability its buildings add to a region (shrines, temples). */
export function buildingStability(state: SimulationState, region: number) {
  let stability = 0;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') stability += settlement.bonus.stability;
  }
  return stability;
}

/** The region's food store limit multiplier, from its granary (one serves the region). */
export function regionStore(state: SimulationState, region: number) {
  let store = 1;
  for (const id of state.regionSettlements[region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') store = Math.max(store, settlement.bonus.store); }
  return store;
}

/** The region's food spoilage multiplier, from its granary. */
export function regionSpoilage(state: SimulationState, region: number) {
  let spoilage = 1;
  for (const id of state.regionSettlements[region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') spoilage = Math.min(spoilage, settlement.bonus.spoilage); }
  return spoilage;
}
