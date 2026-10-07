import { causes } from './causes.ts';
import { farmOutput, regionSites, settlementOutput, wonderBonus } from './economy.ts';
import { keeperOf, roadUpkeepOf } from './roads.ts';
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
/** (With `all`, the upkeep of everything it holds; else not of what it lets go unkept this year.) */
export function costsOf(state: SimulationState, civ: Polity, roads = roadUpkeepOf(state, civ), all = false): Costs {
  const size = sizeFactor(civ.groups.length), age = ageFactor(realmYears(state, civ));
  let administered = 0, served = 0, upkeep = 0;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region, kept = all || !state.neglected[region];
    administered += administration(group.size, state.remoteness[region], size, age);
    for (const id of state.regionSettlements[region]) {
      const settlement = state.settlements[id];
      if (settlement.status === 'alive') { served += services(settlement.urban); if (kept) upkeep += settlement.bonus.upkeep; }
    }
  }
  for (const wonder of state.wonders) {
    const settlement = state.settlements[wonder.settlement];
    if (wonder.status === 'standing' && settlement.owner === civ.id && (all || !state.neglected[settlement.region])) upkeep += WONDERS[wonder.type].upkeep;
  }
  return { administration: administered, services: served, upkeep, roads };
}

/** What running a realm would cost a year if it kept up everything it holds. */
export const fullCostsOf = (state: SimulationState, civ: Polity) => costsOf(state, civ, roadUpkeepOf(state, civ, true), true);

/**
 * Deferred maintenance (VISION.md "Wealth": deficits wear buildings and roads, the farthest first; neglect is visible),
 * yearly after taxes are set. A strained court spends on its core: a realm whose costs outrun what customary taxes
 * raise (its `strain`) lets its farthest regions go unkept, a share of its regions as large as its strain ×
 * `neglectStrain`; and if its taxes at the rate set, with what its savings beyond its reserve can spare, still fall
 * short, it lets more go, from the outside in, until what it keeps up fits. Its capital is always kept. Unkept, their
 * buildings, wonders and roads wear and their upkeep is not paid. An episode begins (an event) when it first lets a
 * region go and ends (an event) after `keptYears` years in a row of keeping everything up.
 */
export function deferMaintenance(state: SimulationState, civ: Polity, revenue: number, reserve: number, strain: number) {
  const tuning = BUDGET_TUNING, costs = fullCostsOf(state, civ), spare = Math.max(0, civ.wealth - reserve) / tuning.refillYears;
  let deficit = totalCosts(costs) - revenue - spare, neglected = 0;
  // Upkeep by region: its settlements' buildings and wonders and the roads kept up there.
  const upkeep = new Map<number, number>();
  for (const groupId of civ.groups) upkeep.set(state.groups[groupId].region, 0);
  for (const region of upkeep.keys()) for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive') upkeep.set(region, upkeep.get(region)! + settlement.bonus.upkeep);
  }
  for (const wonder of state.wonders) {
    const region = state.settlements[wonder.settlement].region;
    if (wonder.status === 'standing' && upkeep.has(region)) upkeep.set(region, upkeep.get(region)! + WONDERS[wonder.type].upkeep);
  }
  // A road's upkeep is saved by letting its farther end go.
  for (const road of state.roads.values()) {
    if (keeperOf(state, road) !== civ.id) continue;
    const far = !upkeep.has(road.a) ? road.b : !upkeep.has(road.b) ? road.a : state.remoteness[road.a] >= state.remoteness[road.b] ? road.a : road.b;
    if (upkeep.has(far)) upkeep.set(far, upkeep.get(far)! + road.upkeep);
  }
  // Farthest first; the capital's region last of all and never let go.
  const capital = civ.capital !== null ? state.settlements[civ.capital].region : -1;
  const order = [...upkeep.keys()].sort((a, b) => Number(a === capital) - Number(b === capital) || state.remoteness[b] - state.remoteness[a] || a - b);
  const strained = Math.round(Math.min(1, tuning.neglectStrain * strain) * order.length), short = deficit > 0;
  for (const region of order) {
    if (region !== capital && (neglected < strained || deficit > 0)) { state.neglected[region] = 1; neglected++; deficit -= upkeep.get(region)!; }
    else state.neglected[region] = 0;
  }
  if (neglected > 0) {
    civ.keptYears = 0;
    if (!civ.deferring) {
      civ.deferring = true; state.metrics.neglectBegun++;
      state.chronicle.emit({ type: 'neglect', actors: [{ id: civ.id, role: 'civ' }], region: order[0], importance: 0.06, causes: causes({ strain, shortfall: short ? 1 : 0 }), data: { civ: civ.name, begun: true, regions: neglected } });
    }
  } else if (civ.deferring && ++civ.keptYears >= tuning.keptYears) {
    civ.deferring = false;
    state.chronicle.emit({ type: 'neglect', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.03, causes: [], data: { civ: civ.name, ended: true } });
  }
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
    // Land new to the realm is kept up until its first yearly assessment.
    if (state.remoteOwner[region] !== civ.id) state.neglected[region] = 0;
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
  // In a region let go unkept, its upkeep is not paid.
  let upkeep = state.neglected[region] ? 0 : settlement.bonus.upkeep;
  if (settlement.wonder !== null && !state.neglected[region]) for (const standing of state.wonders) if (standing.settlement === id && standing.status === 'standing') upkeep += WONDERS[standing.type].upkeep;
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

/** A realm's revenue and costs a year by kind, as the sums of its settlements' accounts (every region it holds has a
 *  living settlement, its seat: an invariant) and its roads' upkeep: what the observer shows, the same as `incomeOf`
 *  and `costsOf`. */
export function realmAccount(state: SimulationState, civ: Polity) {
  const wonder = wonderBonus(state, civ).wealth;
  let trades = 0, farms = 0, sites = 0, administered = 0, served = 0, upkeep = 0;
  for (const groupId of civ.groups) {
    for (const id of state.regionSettlements[state.groups[groupId].region]) {
      if (state.settlements[id].status !== 'alive') continue;
      const account = settlementAccount(state, civ, id, wonder);
      trades += account.trades; farms += account.farms; sites += account.sites; administered += account.administration; served += account.services; upkeep += account.upkeep;
    }
  }
  return { revenue: { trades, farms, sites }, costs: { administration: administered, services: served, upkeep, roads: roadUpkeepOf(state, civ) } };
}
