import { SETTLEMENT_TIERS, type ChronicleEvent } from '../../shared/simulation.ts';
import { causes } from './causes.ts';
import { nearWater } from './regions.ts';
import { createName } from './names.ts';
import { unrestDepth } from './pressure.ts';
import type { Rng } from './rng.ts';
import type { Polity, Settlement, SimulationState, TickContext, Wonder } from './state.ts';
import { BUILDINGS } from './buildings.ts';
import { WONDERS } from './wonders.ts';
import { SETTLEMENT_TUNING } from './tunables.ts';

/**
 * Settlements (VISION.md "Settlements"): named places on their region's candidate sites. A region's people are rural
 * (food producers) or urban (its specialists); the urban live in its settlements, each up to its housing. Settlements
 * grow into towns and cities with their townspeople, a region whose townspeople outgrow its housing founds another
 * (or resettles ruins), and a region whose people die out or leave leaves its settlements in ruins.
 */

// RNG salt within the population system for a civilization's yearly settlement growth (a polity stream: even salts
// are polities', odd ones groups', see bands.ts).
export const GROWING = 6;

/** A settlement's housing: the base, more for the seat of government, times its buildings' housing (markets, aqueducts). */
export function housingOf(settlement: Pick<Settlement, 'capital'> & { buildings?: Settlement['buildings']; wonder?: number | null }) {
  let factor = settlement.capital ? SETTLEMENT_TUNING.capitalHousing : 1;
  for (const building of settlement.buildings ?? []) factor *= BUILDINGS[building.type].effects.housing ?? 1;
  if (settlement.wonder !== undefined && settlement.wonder !== null) factor *= WONDERS[settlement.wonder].effects.housing ?? 1;
  return Math.round(SETTLEMENT_TUNING.baseHousing * factor);
}

/** What a settlement's buildings add up to (its `bonus`). */
export function bonusOf(buildings: Settlement['buildings']): Settlement['bonus'] {
  const bonus = { research: 1, wealth: 1, store: 1, spoilage: 1, stability: 0, upkeep: 0, mine: false, quarry: false, harbor: false, farm: 1, drought: 0 };
  for (const building of buildings) {
    const effects = BUILDINGS[building.type].effects;
    bonus.upkeep += BUILDINGS[building.type].upkeep;
    if (effects.works === 'mineral') bonus.mine = true;
    if (effects.works === 'stone') bonus.quarry = true;
    if (effects.harbor) bonus.harbor = true;
    bonus.research *= effects.research ?? 1; bonus.wealth *= effects.wealth ?? 1; bonus.store *= effects.storeMonths ?? 1;
    bonus.spoilage *= effects.spoilage ?? 1; bonus.stability += effects.stability ?? 0;
    bonus.farm *= effects.farm ?? 1; bonus.drought = Math.max(bonus.drought, effects.drought ?? 0);
  }
  return bonus;
}

/** A region's building effects (`SimulationState.farmBonus` and the rest) from its living settlements' bonuses: the
 *  best of each, since one irrigation and one granary serve the region. Call whenever a settlement's buildings change
 *  or it falls to ruin. */
export function refreshRegionBonus(state: SimulationState, region: number) {
  let farm = 1, drought = 0, store = 1, spoilage = 1;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive') continue;
    farm = Math.max(farm, settlement.bonus.farm); drought = Math.max(drought, settlement.bonus.drought);
    store = Math.max(store, settlement.bonus.store); spoilage = Math.min(spoilage, settlement.bonus.spoilage);
  }
  state.farmBonus[region] = farm; state.droughtShield[region] = drought; state.storeBonus[region] = store; state.spoilageBonus[region] = spoilage;
}

/** After its buildings change: the settlement's housing and bonus follow; the caller rehouses the region. */
export function applyBuildings(settlement: Settlement) {
  settlement.housing = housingOf(settlement); settlement.bonus = bonusOf(settlement.buildings);
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
export function byWater(state: SimulationState, cell: number) { return nearWater(state.geography, cell); }

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
    Object.assign(ruin, { status: 'alive', owner: polity.id, capital, tier: 0, urban: 0, urbanMean: 0, buildings: [], bonus: bonusOf([]), wonder: null, housing: housingOf({ capital }), formerName: ruin.name === oldName ? null : oldName });
    settlement = ruin;
    state.metrics.ruinsResettled++;
    if (announce) announceSettlement(state, polity, settlement, cited);
  } else {
    const taken = new Set(here.map(id => state.settlements[id].cell));
    const cell = living === 0 ? sites.find(site => !taken.has(site)) ?? sites[0] ?? entry.centroid : sites.find(site => !taken.has(site) && byWater(state, site));
    if (cell === undefined) return null;
    settlement = {
      id: state.settlements.length, name: createName(rng, state.cultures[polity.culture].language), cell, region, owner: polity.id, capital,
      foundedTick: tick, status: 'alive', tier: 0, urban: 0, urbanMean: 0, housing: housingOf({ capital }), ruinedTick: null, formerName: null, buildings: [], bonus: bonusOf([]), wonder: null,
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

/**
 * A wonder ends: one under way is abandoned (its city fallen to ruin, or shrunk too small for it for too long), one
 * standing destroyed (its city fallen to ruin, or worn away by unpaid upkeep); either is a major event with its cause,
 * which the wonder keeps. Another may be built elsewhere.
 */
export function endWonder(state: SimulationState, wonder: Wonder, tick: number, cause: 'abandoned' | 'neglected' | 'stalled') {
  const settlement = state.settlements[wonder.settlement], definition = WONDERS[wonder.type], unfinished = wonder.status === 'building';
  wonder.endedTick = tick; wonder.endCause = cause === 'abandoned' ? 'cityRuined' : cause === 'neglected' ? 'unpaidUpkeep' : 'cityShrank';
  if (unfinished) { wonder.status = 'abandoned'; state.metrics.wondersAbandoned++; }
  else { wonder.status = 'destroyed'; settlement.wonder = null; state.metrics.wondersDestroyed++; }
  const owner = state.polities[settlement.owner];
  state.chronicle.emit({
    type: 'wonderDestroyed', actors: [{ id: owner.id, role: 'civ' }], region: settlement.region, settlement: settlement.id,
    causes: [{ factor: wonder.endCause, weight: 1 }], importance: unfinished ? 0.3 : 0.5,
    data: { wonder: definition.name, name: settlement.name, civ: owner.name, unfinished, standing: !unfinished, abandoned: cause === 'abandoned', neglected: cause === 'neglected', shrank: cause === 'stalled' },
  });
}

/** A region whose people died out or left: its living settlements fall to ruin, and their buildings with them. */
export function ruinSettlements(state: SimulationState, region: number, tick: number) {
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive') continue;
    if (settlement.bonus.harbor) state.harbors[region]--;
    // Works under way there are abandoned with it, and a wonder there falls with it.
    const owner = state.polities[settlement.owner], before = owner.projects.length;
    owner.projects = owner.projects.filter(project => project.settlement !== settlement.id);
    state.metrics.projectsAbandoned += before - owner.projects.length;
    for (const wonder of state.wonders) if (wonder.settlement === settlement.id && (wonder.status === 'building' || wonder.status === 'standing')) endWonder(state, wonder, tick, 'abandoned');
    Object.assign(settlement, { status: 'ruined', capital: false, urban: 0, urbanMean: 0, tier: 0, buildings: [], bonus: bonusOf([]), wonder: null, housing: housingOf({ capital: false }), ruinedTick: tick });
  }
  refreshRegionBonus(state, region);
}

/**
 * Why a settlement shrank a tier: the hard years its region remembers, a famine there now, unrest — and, when none of
 * those weighs, only that it has fewer townspeople.
 */
export function fallCauses(state: SimulationState, group: { region: number; size: number }, fewer: number) {
  const region = group.region;
  const factors = {
    hardship: state.hardship[region], famine: state.famine[region] ? Math.min(1, state.famineRecent[region] / Math.max(1, group.size) * SETTLEMENT_TUNING.fallFamineScale) : 0,
    unrest: unrestDepth(state, region),
  };
  const cited = causes(Object.fromEntries(Object.entries(factors).filter(([, weight]) => weight >= SETTLEMENT_TUNING.fallCause)));
  return cited.length ? cited : causes({ fewerTownspeople: fewer });
}

/**
 * The region's townspeople move into its settlements: the capital first, then the others in founding order, each up
 * to its housing, so the main town is the largest and the newest settlements take the growth (a village becomes a
 * town as its region's townspeople grow). Returns how many find a home there (at most all the housing): the rest
 * stay rural. Unless `average` is false (a mid-month rehousing), each settlement's moving average takes this month.
 */
export function house(state: SimulationState, region: number, specialists: number, average = true) {
  // (Allocation-free: this runs every month in every civilization region.)
  const ids = state.regionSettlements[region], settlements = state.settlements;
  let housing = 0, capital = -1;
  for (const id of ids) { const settlement = settlements[id]; if (settlement.status !== 'alive') continue; housing += settlement.housing; settlement.urban = 0; if (settlement.capital) capital = id; }
  const urban = Math.min(specialists, housing);
  let left = urban;
  if (capital >= 0) { const settlement = settlements[capital]; settlement.urban = Math.min(left, settlement.housing); left -= settlement.urban; }
  for (const id of ids) {
    const settlement = settlements[id];
    if (settlement.status !== 'alive') continue;
    if (id !== capital) { settlement.urban = Math.min(left, settlement.housing); left -= settlement.urban; }
    if (average) settlement.urbanMean += (settlement.urban - settlement.urbanMean) / SETTLEMENT_TUNING.meanMonths;
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
        causes: rising ? causes({ townspeople: mean / threshold }) : fallCauses(state, group, 1 - mean / threshold),
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
