import { RESOURCE_IDS, type Resource } from '../../shared/atlas.ts';
import { BUILDINGS } from './buildings.ts';
import { depositState } from './deposits.ts';
import { WONDERS } from './wonders.ts';
import { unrestDepth } from './pressure.ts';
import type { Polity, PopulationGroup, Settlement, SimulationState, WealthFlows } from './state.ts';
import { BUDGET_TUNING, STABILITY_TUNING, WEALTH_TUNING } from './tunables.ts';

/**
 * Wealth and what buildings do for a region (VISION.md "Wealth", "Buildings"). A realm's income comes from what its
 * people do where they live: the crown takes a share of its townspeople's trades and its farmers' surplus in taxes,
 * and its mines and quarries pay it directly. Every change in a treasury is a recorded flow (rule 8); what running the
 * realm costs is `budget.ts`'s. Buildings' effects are read here by the systems they change: housing
 * (`settlements.ts`), research, stability and the food store.
 */

/** This tick's wealth flows of a civilization, begun with its treasury as it stood when they began. */
export function wealthFlows(state: SimulationState, civ: Polity): WealthFlows {
  let flows = state.ledger.wealth.get(civ.id);
  if (!flows) { flows = { before: civ.wealth, produced: 0, construction: 0, upkeep: 0, administration: 0, services: 0, relief: 0, received: 0, given: 0, lost: 0 }; state.ledger.wealth.set(civ.id, flows); }
  return flows;
}

/** What a settlement's townspeople produce in a year before tax: their trades, more with markets, less in unrest. */
export function settlementOutput(state: SimulationState, settlement: Settlement) {
  return settlement.urban * BUDGET_TUNING.townOutput * settlement.bonus.wealth * (1 - STABILITY_TUNING.outputLoss * unrestDepth(state, settlement.region));
}

/** What a region's farmers and herders have to sell in a year before tax: their surplus food, none when they go hungry,
 *  less in unrest. */
export function farmOutput(state: SimulationState, group: PopulationGroup) {
  const tuning = BUDGET_TUNING, farmers = Math.max(0, group.size - group.specialists);
  const surplus = Math.max(0, Math.min(1, (group.foodSecurity - tuning.hungerLine) / (1 - tuning.hungerLine)));
  return farmers * tuning.farmOutput * Math.max(0, Math.min(1, group.farmShare)) * surplus * (1 - STABILITY_TUNING.outputLoss * unrestDepth(state, group.region));
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

/** A civilization's income a year, as it stands this month: taxes on its people's output and what its sites pay. */
export function incomeOf(state: SimulationState, civ: Polity) {
  const wonder = wonderBonus(state, civ).wealth;
  let income = 0;
  for (const groupId of civ.groups) income += regionIncome(state, civ, state.groups[groupId].region, wonder);
  return income;
}

/** What one of a civilization's regions pays it a year: its taxes on the region's output (its townspeople's trades
 *  times `wonder`, a wonder's wealth, and its farmers' surplus) and what its sites pay. */
export function regionIncome(state: SimulationState, civ: Polity, region: number, wonder: number) {
  return civ.taxRate * regionOutput(state, region, wonder) + regionSites(state, civ, region);
}

/** A region's output a year before tax: its settlements' trades (times `wonder`) and its farmers' surplus. */
export function regionOutput(state: SimulationState, region: number, wonder: number) {
  let output = 0;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') output += settlementOutput(state, settlement) * wonder;
  }
  const group = state.groupAt[region];
  return group >= 0 ? output + farmOutput(state, state.groups[group]) : output;
}

/** What the sites a region's mine and quarry work pay the crown a year (each region's sites worked once). */
export function regionSites(state: SimulationState, civ: Polity, region: number) {
  let mine = false, quarry = false;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') { mine ||= settlement.bonus.mine; quarry ||= settlement.bonus.quarry; }
  }
  return (mine ? siteIncome(state, civ, region, 'mineral') : 0) + (quarry ? siteIncome(state, civ, region, 'stone') : 0);
}

/** A realm's output a year before tax (with its wonders' wealth) and what its sites pay: what its taxes are set on. */
export function outputOf(state: SimulationState, civ: Polity) {
  const wonder = wonderBonus(state, civ).wealth;
  let output = 0, sites = 0;
  for (const groupId of civ.groups) { const region = state.groups[groupId].region; output += regionOutput(state, region, wonder); sites += regionSites(state, civ, region); }
  return { output, sites };
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

/** Production system, after a civilization's townspeople are housed: a month of its income (`yearly`, what its
 *  regions pay, as production summed them) joins the treasury in whole units (the fraction waits for next month). */
export function produceWealth(state: SimulationState, civ: Polity, yearly = incomeOf(state, civ)) {
  civ.wealthCarry += yearly / 12;
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

/** A civilization that dies out loses its treasury and its unfinished buildings and roads. */
export function loseWealth(state: SimulationState, civ: Polity) {
  if (civ.wealth > 0) { wealthFlows(state, civ).lost += civ.wealth; civ.wealth = 0; }
  state.metrics.projectsAbandoned += civ.projects.length;
  state.metrics.roadsAbandoned += civ.roadWorks.length;
  civ.projects = []; civ.roadWorks = [];
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

/** The region's food store limit multiplier, from its granary (one serves the region; `refreshRegionBonus`). */
export const regionStore = (state: SimulationState, region: number) => state.storeBonus[region];

/** The region's farm yield multiplier, from its irrigation (one serves the region). */
export const regionFarm = (state: SimulationState, region: number) => state.farmBonus[region];

/** The share of a drought's loss its irrigation keeps away from the region (0 without). */
export const regionDroughtShield = (state: SimulationState, region: number) => state.droughtShield[region];

/** The region's food spoilage multiplier, from its granary. */
export const regionSpoilage = (state: SimulationState, region: number) => state.spoilageBonus[region];
