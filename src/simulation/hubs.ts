import { BUILDING_INDEX } from './buildings.ts';
import type { Polity, SimulationState } from './state.ts';
import { TRADE_TUNING } from './tunables.ts';

/** Trade hubs (VISION.md "Hubs"; M5.4): where a civilization's trade routes begin, and what they carry. */

const MARKET = BUILDING_INDEX.get('market')!;

/** A civilization's hub: its largest living settlement with a market or a harbor, else its capital (−1: none). */
export function hubOf(state: SimulationState, civ: Polity) {
  let best = -1, bestTier = -1, bestUrban = -1;
  for (const groupId of civ.groups) for (const id of state.regionSettlements[state.groups[groupId].region]) {
    const settlement = state.settlements[id];
    if (settlement.status !== 'alive' || settlement.owner !== civ.id) continue;
    if (!(settlement.bonus.harbor || settlement.buildings.some(building => building.type === MARKET))) continue;
    if (settlement.tier > bestTier || (settlement.tier === bestTier && settlement.urban > bestUrban)) { best = id; bestTier = settlement.tier; bestUrban = settlement.urban; }
  }
  return best >= 0 ? best : civ.capital ?? -1;
}

/** What a hub carries a year (units): a base, more with a market and a harbor. */
export function hubCapacity(state: SimulationState, hub: number) {
  const settlement = state.settlements[hub], tuning = TRADE_TUNING;
  return tuning.baseCapacity + (settlement.buildings.some(building => building.type === MARKET) ? tuning.market : 0) + (settlement.bonus.harbor ? tuning.harbor : 0);
}
