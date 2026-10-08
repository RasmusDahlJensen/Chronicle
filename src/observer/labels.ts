import type { AGREEMENT_KINDS, BELIEF_KINDS, DECISION_ACTIONS, DIPLOMATIC_STATUSES, NEED_NAMES, ObserverFrame } from '../../shared/simulation.ts';

/**
 * Words for the simulation's codes, shared by the game and the lab (U.2): decisions, opinion's reasons, standings and
 * treaties, needs and beliefs. The simulation never writes prose; these are the observer's.
 */
export type InspectedPolity = NonNullable<NonNullable<ObserverFrame['inspect']>['polity']>;
type Decision = NonNullable<InspectedPolity['lastDecision']>;

export const DECISION_LABELS: Record<typeof DECISION_ACTIONS[number], string> = {
  expand: 'Expand into', explore: 'Explore', nothing: 'Do nothing', unite: 'Unite with', share: 'Share knowledge with', build: 'Build', trade: 'Propose trade with',
  pact: 'Propose a non-aggression pact with', alliance: 'Propose an alliance with', roadAgreement: 'Propose a joint road with', voyage: 'Send a voyage overseas',
};
export const ACTION_NAMES: Record<typeof DECISION_ACTIONS[number], string> = {
  expand: 'Expand', explore: 'Explore', nothing: 'Do nothing', unite: 'Unite', share: 'Share knowledge', build: 'Build', trade: 'Trade', pact: 'Pact',
  alliance: 'Alliance', roadAgreement: 'Joint road', voyage: 'Voyage',
};
export const NEED_LABELS: readonly (readonly [typeof NEED_NAMES[number], string])[] = [
  ['hunger', 'hunger'], ['landPressure', 'land pressure'], ['shortage', 'shortage'], ['threat', 'threat'], ['unrest', 'unrest'], ['friction', 'friction'],
  ['opportunity', 'opportunity'], ['grievance', 'grievance'], ['infrastructure', 'infrastructure'],
];
export const BELIEF_NAMES: Record<typeof BELIEF_KINDS[number], string> = { people: 'people', strength: 'strength', wealth: 'wealth', era: 'era' };
/** Opinion's reasons. */
export const REASON_NAMES: Record<string, string> = {
  sameFaith: 'same faith', rivalFaith: 'rival faith', culture: 'culture', kin: 'kin', sharing: 'sharing knowledge', trading: 'trading', borderTension: 'border tension',
  turnedAway: 'turned them away', refusedExchange: 'refused to share', refusedTrade: 'refused to trade',
  pact: 'non-aggression pact', allied: 'allies', road: 'joint road', refusedTreaty: 'refused a treaty', treatySoured: 'a treaty soured',
};
/** A people's standing with a civilization and the treaties they may hold (M5.5). */
export const STATUS_NAMES: Record<typeof DIPLOMATIC_STATUSES[number], string> = { allied: 'allied', pact: 'non-aggression pact', trade: 'trade partner', rival: 'rival', neutral: 'neutral' };
export const AGREEMENT_NAMES: Record<typeof AGREEMENT_KINDS[number], string> = { alliance: 'alliance', nonAggression: 'pact', road: 'joint road', trade: 'trade' };

/** A factor's code in words ("landPressure" → "land pressure"). */
export const factorName = (factor: string) => REASON_NAMES[factor] ?? factor.replace(/([A-Z])/g, ' $1').toLowerCase();

/** What a decision was aimed at: the region to expand into, the civilization to unite, share or trade with (and the
 *  resource it would import), or what to build. */
export function decisionTarget(step: Decision) {
  const option = step.options[step.pick];
  if (!option || option.target === null) return '';
  if (option.action === 'build') return ` ${option.label ?? '?'}`;
  return ['unite', 'share', 'trade', 'pact', 'alliance', 'roadAgreement'].includes(option.action) ? ` the ${option.label ?? '?'}` : ` region ${option.target}`;
}

/** A decision's causes: what drove it, and what held it back ("despite"). */
export function causeText(causes: { factor: string; weight: number }[], name = (factor: string) => factor) {
  const why = causes.filter(cause => cause.weight > 0).map(cause => `${name(cause.factor)} +${cause.weight.toFixed(2)}`);
  const despite = causes.filter(cause => cause.weight < 0).map(cause => `${name(cause.factor)} ${cause.weight.toFixed(2)}`);
  return `${why.length ? `Because of ${why.join(', ')}` : 'Chosen'}${despite.length ? `, despite ${despite.join(', ')}` : ''}.`;
}

/** Resource units, readable from thousandths to hundreds. */
export const units = (value: number) => value === 0 ? '0' : value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toPrecision(2);
