import { causes } from './causes.ts';
import { farmOutput, regionSites, settlementOutput, wonderBonus } from './economy.ts';
import { roadUpkeepOf } from './roads.ts';
import type { Polity, PopulationGroup, SimulationState } from './state.ts';
import { BUDGET_TUNING, REACH_TUNING } from './tunables.ts';
import { WONDERS } from './wonders.ts';

/**
 * A realm's budget (VISION.md "Wealth"): what running it costs a year, and what each of its places earns and costs.
 * Its people produce and the crown takes a share in taxes (`economy.ts`); it pays for the administration of its
 * regions, the services of its settlements and the upkeep of its buildings, wonders and roads. A realm that cannot pay
 * falls into arrears: its buildings and roads wear (`construction.ts`) and its regions grow restless, the farthest
 * first (`stability.ts`).
 */

/** How much costlier each region is to administer in a realm of this many regions: the burden grows faster than size. */
export const sizeFactor = (regions: number) => Math.max(1, regions / BUDGET_TUNING.sizeScale) ** BUDGET_TUNING.sizePower;
/** How much costlier it is in a realm this many years old: offices, privileges and courts accumulate. */
export const ageFactor = (years: number) => 1 + BUDGET_TUNING.ageMax * (1 - Math.exp(-Math.max(0, years) / BUDGET_TUNING.ageYears));
/** Years since a civilization settled. */
export const realmYears = (state: SimulationState, civ: Polity) => civ.settledTick === null ? 0 : (state.tick - civ.settledTick) / 12;

/** Administration a year of a region of `people` at `remoteness` (travel-km from the capital ÷ governance reach), in a
 *  realm with these size and age factors. */
export function administration(people: number, remoteness: number, size: number, age: number) {
  const tuning = BUDGET_TUNING;
  return (tuning.perRegion + tuning.perPerson * people) * (1 + tuning.distance * Math.min(tuning.remoteCap, remoteness)) * size * age;
}

/** Services a year for a settlement's townspeople, more per head in larger places. */
export function services(urban: number) {
  const tuning = BUDGET_TUNING;
  return urban * tuning.servicesBase * (1 + urban / tuning.servicesScale) ** tuning.servicesPower;
}

/** What running a realm costs a year: administration of its regions, services in its settlements, upkeep of its
 *  buildings and wonders, and of the roads it keeps. */
export interface Costs { administration: number; services: number; upkeep: number; roads: number }
export function costsOf(state: SimulationState, civ: Polity, roads = roadUpkeepOf(state, civ)): Costs {
  const size = sizeFactor(civ.groups.length), age = ageFactor(realmYears(state, civ));
  let administered = 0, served = 0, upkeep = 0;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    administered += administration(group.size, state.remoteness[region], size, age);
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status === 'alive') { served += services(settlement.urban); upkeep += settlement.bonus.upkeep; }
    }
  }
  for (const wonder of state.wonders) if (wonder.status === 'standing' && state.settlements[wonder.settlement].owner === civ.id) upkeep += WONDERS[wonder.type].upkeep;
  return { administration: administered, services: served, upkeep, roads };
}
export const totalCosts = (costs: Costs) => costs.administration + costs.services + costs.upkeep + costs.roads;
/** A realm's costs as causes: each kind's share of the whole. */
export function costShares(costs: Costs) {
  const total = totalCosts(costs);
  return total > 0 ? causes({ administration: costs.administration / total, services: costs.services / total, upkeep: (costs.upkeep + costs.roads) / total }) : [];
}

/**
 * Each of a civilization's regions' remoteness (travel-km from its capital ÷ its governance reach), measured for it: at
 * its yearly assessment, and in the month a region joins it (`remotenessStale`).
 */
export function refreshRemoteness(state: SimulationState, civ: Polity, km: (region: number) => number) {
  const reach = REACH_TUNING.baseKm * civ.knowledge.multipliers.reach;
  for (const groupId of civ.groups) {
    const region = state.groups[groupId].region;
    state.remoteness[region] = km(region) / reach; state.remoteOwner[region] = civ.id;
  }
}
export function remotenessStale(state: SimulationState, civ: Polity) {
  for (const groupId of civ.groups) if (state.remoteOwner[state.groups[groupId].region] !== civ.id) return true;
  return false;
}

/** How taxes weigh on a realm's people (stability lost; below 0, gained): above the customary rate, the more the
 *  nearer the most a realm can take; below it, a little contentment. */
export function taxBurden(rate: number) {
  const tuning = BUDGET_TUNING;
  return rate >= tuning.customaryRate
    ? tuning.taxUnrest * (rate - tuning.customaryRate) / (tuning.maxRate - tuning.customaryRate)
    : -tuning.taxContent * (tuning.customaryRate - rate) / (tuning.customaryRate - tuning.minRate);
}

/** Stability a region at `remoteness` loses to its realm's arrears: most in the regions farthest from the capital. */
export function arrearsBurden(civ: Pick<Polity, 'arrears'>, remoteness: number) {
  const tuning = BUDGET_TUNING;
  return tuning.arrearsUnrest * civ.arrears * (tuning.arrearsCore + (1 - tuning.arrearsCore) * Math.min(1, remoteness));
}

/**
 * A month's costs paid or not: arrears follow the share left unpaid, averaged over about a year. A realm falls into
 * arrears (an event citing its costs) and out of them again.
 */
export function recordArrears(state: SimulationState, civ: Polity, unpaid: number, costs: Costs) {
  const tuning = BUDGET_TUNING;
  civ.arrears = Math.max(0, Math.min(1, civ.arrears + (unpaid - civ.arrears) / tuning.arrearsMonths));
  if (!civ.inArrears && civ.arrears >= tuning.arrearsEvent) {
    civ.inArrears = true; state.metrics.arrearsBegun++;
    state.chronicle.emit({
      type: 'arrears', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.08, causes: costShares(costs),
      data: { civ: civ.name, begun: true },
    });
  } else if (civ.inArrears && civ.arrears < tuning.arrearsEvent / 2) {
    civ.inArrears = false;
    state.chronicle.emit({ type: 'arrears', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.04, causes: [], data: { civ: civ.name, ended: true } });
  }
}

/** The seat of a region: its main settlement (the first living one), which keeps the region's account; −1 for none. */
export function seatOf(state: SimulationState, region: number) {
  for (const id of state.regionSettlements[region]) if (state.settlements[id].status === 'alive') return id;
  return -1;
}

/**
 * One settlement's account a year (VISION.md "Wealth": not every place pays): the taxes on its townspeople's trades,
 * and what its services and its buildings and wonder cost. The seat of its region also takes in the taxes on the
 * surplus of the farmers around it and what the region's mines and quarries pay, and pays the region's administration.
 */
export function settlementAccount(state: SimulationState, civ: Polity, id: number, wonder = wonderBonus(state, civ).wealth) {
  const settlement = state.settlements[id], region = settlement.region;
  const trades = civ.taxRate * settlementOutput(state, settlement) * wonder, served = services(settlement.urban);
  let upkeep = settlement.bonus.upkeep;
  if (settlement.wonder !== null) for (const standing of state.wonders) if (standing.settlement === id && standing.status === 'standing') upkeep += WONDERS[standing.type].upkeep;
  const seat = seatOf(state, region) === id && state.groupAt[region] >= 0;
  const around = seat ? regionAccount(state, civ, state.groups[state.groupAt[region]]) : null;
  const farms = around?.farms ?? 0, sites = around?.sites ?? 0, administered = around?.administration ?? 0;
  return { seat, trades, farms, sites, administration: administered, services: served, upkeep, balance: trades + farms + sites - administered - served - upkeep };
}

/** One region's account a year beyond its settlements' own: the taxes on its farmers' surplus, what its sites pay, and
 *  its administration (its seat's to keep). */
export function regionAccount(state: SimulationState, civ: Polity, group: PopulationGroup) {
  const region = group.region, farms = civ.taxRate * farmOutput(state, group), sites = regionSites(state, civ, region);
  const administered = administration(group.size, state.remoteness[region], sizeFactor(civ.groups.length), ageFactor(realmYears(state, civ)));
  return { farms, sites, administration: administered, balance: farms + sites - administered };
}

/** A realm's revenue and costs a year by kind, as the sums of its settlements' accounts (and of regions without a
 *  living settlement) and its roads' upkeep: what the observer shows, the same as `incomeOf` and `costsOf`. */
export function realmAccount(state: SimulationState, civ: Polity) {
  const wonder = wonderBonus(state, civ).wealth;
  let trades = 0, farms = 0, sites = 0, administered = 0, served = 0, upkeep = 0;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId];
    if (seatOf(state, group.region) < 0) {
      const region = regionAccount(state, civ, group);
      farms += region.farms; sites += region.sites; administered += region.administration;
    }
    for (const id of state.regionSettlements[group.region]) {
      if (state.settlements[id].status !== 'alive') continue;
      const account = settlementAccount(state, civ, id, wonder);
      trades += account.trades; farms += account.farms; sites += account.sites; administered += account.administration; served += account.services; upkeep += account.upkeep;
    }
  }
  return { revenue: { trades, farms, sites }, costs: { administration: administered, services: served, upkeep, roads: roadUpkeepOf(state, civ) } };
}
