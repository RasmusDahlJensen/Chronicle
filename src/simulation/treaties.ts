import type { Pact, Polity, RoadAgreement, SimulationState } from './state.ts';

/** Lookups over the treaties (M5.5), in a module of their own so trade, diplomacy, the budget and the view can share them. */

/** What a civilization's trade agreements bring in a year, net (M5.4): what it is paid less what it pays. */
export function tradeIncome(state: SimulationState, civ: Polity) {
  let net = 0;
  for (const treaty of state.treaties) {
    if (treaty.type !== 'trade' || treaty.endTick !== null || treaty.price === 0) continue;
    if (treaty.exporter === civ.id) net += treaty.price;
    else if (treaty.importer === civ.id) net -= treaty.price;
  }
  return net;
}

/** The active pact, alliance or road agreement of a kind between two civilizations, if any. */
export function treatyBetween(state: SimulationState, kind: Pact['type'] | 'road', a: number, b: number): Pact | RoadAgreement | null {
  for (let at = state.treaties.length - 1; at >= 0; at--) {
    const treaty = state.treaties[at];
    if (treaty.type === kind && treaty.endTick === null && ((treaty.parties[0] === a && treaty.parties[1] === b) || (treaty.parties[0] === b && treaty.parties[1] === a))) return treaty;
  }
  return null;
}

/** Whether two civilizations' joint road is complete (an active road agreement both sides have built). */
export function roadJoined(state: SimulationState, a: Polity, b: Polity) {
  if (!a.roadPartners.includes(b.id)) return false;
  const treaty = treatyBetween(state, 'road', a.id, b.id);
  return treaty?.type === 'road' && treaty.built[0] && treaty.built[1];
}
