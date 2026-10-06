import { SETTLEMENT_TIERS, type ChronicleEvent } from '../../shared/simulation.ts';
import { causes } from './causes.ts';
import { cellNeighbors } from './geography.ts';
import { createName } from './names.ts';
import { unrestDepth } from './pressure.ts';
import type { Rng } from './rng.ts';
import type { Polity, Settlement, SimulationState, TickContext } from './state.ts';
import { SETTLEMENT_TUNING } from './tunables.ts';

/**
 * Settlements (VISION.md "Settlements"): named places on their region's candidate sites. A region's people are rural
 * (food producers) or urban (its specialists); the urban live in its settlements, each up to its housing. Settlements
 * grow into towns and cities with their townspeople, a region whose townspeople outgrow its housing founds another
 * (or resettles ruins), and a region whose people die out or leave leaves its settlements in ruins.
 */

// RNG salt within the population system for a civilization's yearly settlement growth (polity streams).
export const GROWING = 5;

/** A settlement's housing: the base, more for the seat of government (buildings raise it from M3b.2). */
export function housingOf(settlement: Pick<Settlement, 'capital'>) {
  return Math.round(SETTLEMENT_TUNING.baseHousing * (settlement.capital ? SETTLEMENT_TUNING.capitalHousing : 1));
}

/** Make a settlement the capital or not, with the housing that goes with it; the caller rehouses the region. */
export function setCapital(settlement: Settlement, capital: boolean) {
  settlement.capital = capital; settlement.housing = housingOf(settlement);
}

/** A region's living settlements, in founding order (its main settlement first). */
export function livingSettlements(state: SimulationState, region: number): Settlement[] {
  const living: Settlement[] = [];
  for (const id of state.regionSettlements[region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') living.push(settlement); }
  return living;
}

/** All the housing of a region's living settlements. */
export function regionHousing(state: SimulationState, region: number) {
  let housing = 0;
  for (const id of state.regionSettlements[region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') housing += settlement.housing; }
  return housing;
}

/** Whether a cell is on or next to a river, lake, coast or resource site (VISION.md M3b: where settlements sit). */
export function byWater(state: SimulationState, cell: number) {
  const geography = state.geography, near = new Int32Array(4);
  if (geography.riverRunoff[cell] > 0 || geography.resource[cell] > 0) return true;
  for (const other of cellNeighbors(geography, cell, near)) {
    if (other >= 0 && (geography.marine[other] || geography.lake[other] || geography.riverRunoff[other] > 0 || geography.resource[other] > 0)) return true;
  }
  return false;
}

/**
 * A settlement of `polity` in `region`: ruins there are resettled first (the best-sited, keeping the old name with
 * chance `keepName`), otherwise one is founded on the best candidate site no living settlement holds. A region's first
 * settlement takes its best site wherever it lies; further ones need a site by a river, lake, coast or resource site
 * (dry country holds one town, not many). Returns null when there is no such room; a region without a living
 * settlement always gets one. Announced at once unless the caller announces it after its own event.
 */
export function foundSettlement(state: SimulationState, rng: Rng, polity: Polity, region: number, capital: boolean, tick: number,
  cited: ChronicleEvent['causes'] = [], announce = true): Settlement | null {
  const entry = state.partition.regions[region], sites = entry.settlementSites, here = state.regionSettlements[region];
  const rank = (cell: number) => { const at = sites.indexOf(cell); return at < 0 ? sites.length : at; };
  let ruin: Settlement | null = null, living = 0;
  for (const id of here) if (state.settlements[id].status === 'alive') living++;
  for (const id of here) {
    const settlement = state.settlements[id];
    // Ruins are resettled under the same rule: a further settlement only by water.
    if (settlement.status !== 'alive' && (living === 0 || byWater(state, settlement.cell)) && (!ruin || rank(settlement.cell) < rank(ruin.cell))) ruin = settlement;
  }
  let settlement: Settlement;
  if (ruin) {
    const oldName = ruin.name;
    if (!rng.chance(SETTLEMENT_TUNING.keepName)) ruin.name = createName(rng, state.cultures[polity.culture].language);
    Object.assign(ruin, { status: 'alive', owner: polity.id, capital, tier: 0, urban: 0, urbanMean: 0, housing: housingOf({ capital }), formerName: ruin.name === oldName ? null : oldName });
    settlement = ruin;
    state.metrics.ruinsResettled++;
    if (announce) announceSettlement(state, polity, settlement, cited);
  } else {
    const taken = new Set(here.map(id => state.settlements[id].cell));
    const cell = living === 0 ? sites.find(site => !taken.has(site)) ?? sites[0] ?? entry.centroid : sites.find(site => !taken.has(site) && byWater(state, site));
    if (cell === undefined) return null;
    settlement = {
      id: state.settlements.length, name: createName(rng, state.cultures[polity.culture].language), cell, region, owner: polity.id, capital,
      foundedTick: tick, status: 'alive', tier: 0, urban: 0, urbanMean: 0, housing: housingOf({ capital }), ruinedTick: null, formerName: null,
    };
    state.settlements.push(settlement);
    here.push(settlement.id);
    if (announce) announceSettlement(state, polity, settlement, cited);
  }
  if (capital) polity.capital = settlement.id;
  return settlement;
}

/** The chronicle entry for a settlement founded, or for ruins resettled (under the name they had, and any new one). */
export function announceSettlement(state: SimulationState, polity: Polity, settlement: Settlement, cited: ChronicleEvent['causes']) {
  if (settlement.ruinedTick !== null) {
    state.chronicle.emit({
      type: 'ruinsResettled', actors: [{ id: polity.id, role: 'civ' }], region: settlement.region, settlement: settlement.id, causes: cited,
      importance: 0.06, data: { name: settlement.formerName ?? settlement.name, newName: settlement.name, renamed: settlement.formerName !== null, civ: polity.name, capital: settlement.capital },
    });
    return;
  }
  state.chronicle.emit({
    type: 'settlementFounded', actors: [{ id: polity.id, role: 'civ' }], region: settlement.region, settlement: settlement.id, causes: cited,
    importance: settlement.capital ? 0.2 : 0.04, data: { name: settlement.name, civ: polity.name, capital: settlement.capital },
  });
}

/** A region whose people died out or left: its living settlements fall to ruin. */
export function ruinSettlements(state: SimulationState, region: number, tick: number) {
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive') continue;
    Object.assign(settlement, { status: 'ruined', capital: false, urban: 0, urbanMean: 0, tier: 0, housing: housingOf({ capital: false }), ruinedTick: tick });
  }
}

/**
 * The region's townspeople move into its settlements, each taking a share in proportion to its housing (so the seat
 * of government, with more housing, is the largest). Returns how many find a home there (at most all the housing):
 * the rest stay rural. Shares are whole people; the remainder goes to the settlements in founding order.
 */
export function house(state: SimulationState, region: number, specialists: number) {
  let housing = 0;
  for (const id of state.regionSettlements[region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') housing += settlement.housing; }
  const urban = Math.min(specialists, housing);
  let left = urban;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive') continue;
    settlement.urban = Math.floor(urban * settlement.housing / housing);
    left -= settlement.urban;
  }
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive') continue;
    if (left > 0 && settlement.urban < settlement.housing) { const moving = Math.min(left, settlement.housing - settlement.urban); settlement.urban += moving; left -= moving; }
    settlement.urbanMean += (settlement.urban - settlement.urbanMean) / SETTLEMENT_TUNING.meanMonths;
  }
  return urban;
}

/** A settlement's tier for its urban population: up at each threshold, down below `demote` × its own. */
export function tierFor(urban: number, tier: number) {
  const thresholds = SETTLEMENT_TUNING.tiers;
  let next = tier;
  while (next < thresholds.length - 1 && urban >= thresholds[next + 1]) next++;
  while (next > 0 && urban < thresholds[next] * SETTLEMENT_TUNING.demote) next--;
  return next;
}

/**
 * Yearly per civilization (population system, staggered by id): its settlements rise or fall a tier with their
 * townspeople, and each region whose townspeople fill its housing founds another settlement or resettles ruins.
 */
export function growSettlements(state: SimulationState, context: Pick<TickContext, 'tick' | 'stream'>, civ: Polity) {
  const tuning = SETTLEMENT_TUNING;
  let rng: Rng | null = null;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    for (const settlement of livingSettlements(state, region)) {
      const tier = tierFor(settlement.urbanMean, settlement.tier);
      if (tier === settlement.tier) continue;
      const rising = tier > settlement.tier, threshold = tuning.tiers[Math.max(tier, settlement.tier)], mean = Math.round(settlement.urbanMean);
      settlement.tier = tier;
      state.metrics.tierChanges++;
      state.chronicle.emit({
        type: 'settlementTierChanged', actors: [{ id: civ.id, role: 'civ' }], region, settlement: settlement.id,
        causes: rising ? causes({ townspeople: mean / threshold }) : causes({ hunger: Math.max(0, 1 - Math.min(1, group.foodSecurity)), unrest: unrestDepth(state, region), fewerTownspeople: 1 - mean / threshold }),
        importance: rising ? tuning.tierImportance[tier] : tuning.fallImportance,
        data: { name: settlement.name, tier: SETTLEMENT_TIERS[tier], civ: civ.name, urban: mean, rising, falling: !rising },
      });
    }
    const housing = regionHousing(state, region);
    if (housing > 0 && group.specialists >= tuning.foundAt * housing) {
      rng ??= context.stream(civ.id, GROWING);
      if (foundSettlement(state, rng, civ, region, false, context.tick, causes({ townspeople: group.specialists / housing }))) state.metrics.settlementsGrown++;
    }
  }
}
