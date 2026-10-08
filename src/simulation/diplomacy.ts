import type { ChronicleEvent } from '../../shared/simulation.ts';
import { borderingCivs, decisionView, fearOf, opinionOf, strengthWithAllies } from './perception.ts';
import { remember } from './relations.ts';
import { jointRoute, roadKey } from './roads.ts';
import type { Pact, PactEnd, Polity, RoadAgreement, SimulationState, TickContext } from './state.ts';
import { DIPLOMACY_TUNING } from './tunables.ts';
import { effectiveValues } from './values.ts';

/**
 * Pacts, alliances and road agreements (VISION.md "Diplomacy and war", "Roads"; M5.5). A civilization proposes one at
 * its decision step (`decisions/choose.ts` weighs what its view lists); the other accepts if its own score for the deal
 * is positive (each part is logged on the event). The parties' partner lists (`pacts`, `allies`, `roadPartners`) are
 * kept in step with the treaties. A road agreement starts each side's stretch of a joint road (`roads.ts` `jointRoute`)
 * as one of its road works; `construction.ts` builds them. Treaties end when relations sour, a party is gone or (a road
 * agreement) its road can no longer be built.
 */

type Kind = Pact['type'] | 'road';
const partnersOf = (polity: Polity, kind: Kind) => kind === 'nonAggression' ? polity.pacts : kind === 'alliance' ? polity.allies : polity.roadPartners;
const total = (parts: Record<string, number>) => Object.values(parts).reduce((sum, value) => sum + value, 0);
const round = (value: number) => Math.round(value * 1000) / 1000;

/** `partner`'s own score for a non-aggression pact `civ` proposes: its fear of `civ`, how pressed it is by others, its
 *  opinion of `civ`, its Militarism and Expansionism. */
export function pactAcceptance(state: SimulationState, partner: Polity, civ: Polity) {
  const tuning = DIPLOMACY_TUNING.pact.accept, values = effectiveValues(state, partner), strength = strengthWithAllies(state, partner);
  let pressed = 0;
  for (const other of borderingCivs(state, partner)) if (other !== civ.id) pressed = Math.max(pressed, fearOf(state, partner, state.polities[other], strength));
  return {
    base: tuning.base, fear: tuning.threat * fearOf(state, partner, civ, strength), pressed: tuning.pressed * pressed, opinion: tuning.opinion * opinionOf(partner, civ.id) / 100,
    peace: tuning.peace * (1 - values.militarism), ambition: -tuning.ambition * values.expansionism,
  };
}

/** `partner`'s own score for an alliance `civ` proposes against `enemy`: its own fear of the enemy (none if it has not
 *  met them), its opinion of `civ`, kinship and a shared faith; never against a people it is bound to by a pact or an
 *  alliance itself (`bound`). */
export function allianceAcceptance(state: SimulationState, partner: Polity, civ: Polity, enemy: Polity) {
  const tuning = DIPLOMACY_TUNING.alliance.accept;
  return {
    base: tuning.base, fear: partner.met.has(enemy.id) ? tuning.threat * fearOf(state, partner, enemy) : 0, opinion: tuning.opinion * opinionOf(partner, civ.id) / 100,
    kin: partner.lineage === civ.lineage ? tuning.kin : 0, faith: partner.stateReligion >= 0 && partner.stateReligion === civ.stateReligion ? tuning.faith : 0,
    bound: partner.allies.includes(enemy.id) || partner.pacts.includes(enemy.id) ? -1 : 0,
  };
}

/** `partner`'s own score for a road agreement `civ` proposes: their trade or alliance, its opinion of `civ`, its own
 *  need of roads (its infrastructure need), and what its own stretch would cost against its revenue. */
export function roadAcceptance(state: SimulationState, partner: Polity, civ: Polity, cost: number) {
  const tuning = DIPLOMACY_TUNING.road.accept, view = decisionView(state, partner);
  return {
    base: tuning.base, partner: partner.trading.includes(civ.id) || partner.allies.includes(civ.id) ? tuning.partner : 0, opinion: tuning.opinion * opinionOf(partner, civ.id) / 100,
    infrastructure: tuning.need * view.needs.infrastructure, cost: -tuning.cost * cost / Math.max(1, view.budget.revenue),
  };
}

const NAMES: Record<Kind, string> = { nonAggression: 'a non-aggression pact', alliance: 'an alliance', road: 'a road agreement' };
/** The opinion below which a treaty of this kind ends (and is neither proposed nor accepted). */
const endOf = (kind: Kind) => kind === 'nonAggression' ? DIPLOMACY_TUNING.end.pact : kind === 'alliance' ? DIPLOMACY_TUNING.end.alliance : DIPLOMACY_TUNING.end.road;

/** A treaty begins: on both parties' partner lists, and counted. */
function begin(state: SimulationState, treaty: Pact | RoadAgreement) {
  state.treaties.push(treaty);
  const [a, b] = treaty.parties.map(id => state.polities[id]);
  partnersOf(a, treaty.type).push(b.id); partnersOf(b, treaty.type).push(a.id);
  if (treaty.type === 'nonAggression') state.metrics.pactsMade++;
  else if (treaty.type === 'alliance') state.metrics.alliancesMade++;
  else state.metrics.roadDealsMade++;
}

/** A refusal: counted, remembered by the proposer, and told in its decision log (with the partner's reasons). */
function refused(state: SimulationState, civ: Polity, partner: Polity, kind: Kind, parts: Record<string, number>) {
  state.metrics.treatiesRefused++;
  remember(state, civ, partner.id, 'refusedTreaty');
  const why = Object.entries(parts).filter(([, weight]) => weight < 0).sort((x, y) => x[1] - y[1]).map(([factor]) => factor).slice(0, 2);
  return `the ${partner.name} would not agree to ${NAMES[kind]}${why.length ? ` (${why.join(', ')})` : ''}`;
}

/**
 * `civ` proposes a non-aggression pact or (against `enemy`) an alliance to `partner` (its decision). The partner
 * accepts if its own score is positive; the treaty is an event citing the proposer's reasons, with the partner's.
 */
export function proposePact(state: SimulationState, context: TickContext, civ: Polity, partner: Polity, kind: Pact['type'], enemy: Polity | null, cited: ChronicleEvent['causes']): string {
  if (partner.deathTick !== null || partner.kind !== 'civ') return 'the other civilization is gone';
  if (partnersOf(civ, kind).includes(partner.id)) return `already has ${NAMES[kind]} with the ${partner.name}`;
  if (kind === 'alliance' && (!enemy || enemy.deathTick !== null)) return 'the threat is gone';
  const parts = kind === 'alliance' ? allianceAcceptance(state, partner, civ, enemy!) : pactAcceptance(state, partner, civ);
  // Never below the opinion at which it would end.
  if (!(total(parts) > 0) || opinionOf(partner, civ.id) < endOf(kind)) return refused(state, civ, partner, kind, parts);
  const treaty: Pact = { id: state.treaties.length, type: kind, parties: [civ.id, partner.id], startTick: context.tick, endTick: null, endCause: null };
  begin(state, treaty);
  state.chronicle.emit({
    type: kind === 'alliance' ? 'alliance' : 'nonAggressionPact', actors: [{ id: civ.id, role: 'a' }, { id: partner.id, role: 'b' }], region: null, causes: cited, importance: kind === 'alliance' ? 0.15 : 0.1,
    data: { against: kind === 'alliance', enemy: enemy?.name ?? '', ...Object.fromEntries(Object.entries(parts).map(([factor, weight]) => [`accept_${factor}`, round(weight)])) },
  });
  return kind === 'alliance' ? `allied with the ${partner.name} against the ${enemy!.name}` : `signed a non-aggression pact with the ${partner.name}`;
}

/**
 * `civ` proposes a road agreement to `partner` (its decision): a joint road between their nearest towns or cities
 * (`jointRoute`, in truth). The partner accepts if its own score, with its true stretch's cost, is positive. Each side
 * with a stretch to build begins it as a road work; a side with none has its half already.
 */
export function proposeRoadDeal(state: SimulationState, context: TickContext, civ: Polity, partner: Polity, cited: ChronicleEvent['causes']): string {
  if (partner.deathTick !== null || partner.kind !== 'civ') return 'the other civilization is gone';
  if (civ.roadPartners.includes(partner.id)) return `already has a road agreement with the ${partner.name}`;
  const route = jointRoute(state, civ, partner);
  if (!route) return `no road to build with the ${partner.name}`;
  const parts = roadAcceptance(state, partner, civ, route.sides[1].cost);
  if (!(total(parts) > 0) || opinionOf(partner, civ.id) < endOf('road')) return refused(state, civ, partner, 'road', parts);
  const treaty: RoadAgreement = {
    id: state.treaties.length, type: 'road', parties: [civ.id, partner.id], cities: route.cities, path: route.path,
    built: [!route.sides[0].edges.length, !route.sides[1].edges.length], startTick: context.tick, endTick: null, endCause: null,
  };
  begin(state, treaty);
  [civ, partner].forEach((party, side) => {
    const stretch = route.sides[side];
    if (!stretch.edges.length) return;
    party.roadWorks.push({
      from: route.cities[side], to: route.cities[1 - side], path: route.path, tier: route.tiers[side], edges: stretch.edges, bridges: stretch.bridges,
      spent: 0, cost: Math.max(1, stretch.cost), months: Math.max(1, stretch.months), startedTick: context.tick, causes: cited, agreement: treaty.id,
    });
    state.metrics.roadsBegun++;
  });
  const [from, to] = route.cities.map(id => state.settlements[id].name);
  state.chronicle.emit({
    type: 'roadAgreement', actors: [{ id: civ.id, role: 'a' }, { id: partner.id, role: 'b' }], region: state.settlements[route.cities[0]].region, causes: cited, importance: 0.08,
    data: { from, to, ...Object.fromEntries(Object.entries(parts).map(([factor, weight]) => [`accept_${factor}`, round(weight)])) },
  });
  return `agreed a road from ${from} to ${to} with the ${partner.name}`;
}

/** A pact, alliance or road agreement ends: off both partner lists (a road agreement's unfinished works with it), an
 *  event (unless both parties are gone). */
export function endTreaty(state: SimulationState, treaty: Pact | RoadAgreement, cause: PactEnd, tick: number) {
  treaty.endTick = tick; treaty.endCause = cause;
  const [a, b] = treaty.parties.map(id => state.polities[id]);
  for (const [one, other] of [[a, b], [b, a]]) { const list = partnersOf(one, treaty.type), at = list.indexOf(other.id); if (at >= 0) list.splice(at, 1); }
  if (treaty.type === 'road') for (const party of [a, b]) {
    const before = party.roadWorks.length;
    party.roadWorks = party.roadWorks.filter(work => work.agreement !== treaty.id);
    state.metrics.roadsAbandoned += before - party.roadWorks.length;
  }
  state.metrics.pactEnded[cause]++;
  // A treaty that soured is remembered by both: neither proposes another for a while.
  if (cause === 'relationsSoured') { remember(state, a, b.id, 'treatySoured'); remember(state, b, a.id, 'treatySoured'); }
  if (a.deathTick !== null && b.deathTick !== null) return;
  state.chronicle.emit({
    type: 'treatyCancelled', actors: [{ id: a.id, role: 'a' }, { id: b.id, role: 'b' }], region: null, causes: [{ factor: cause, weight: 1 }], importance: treaty.type === 'alliance' ? 0.1 : 0.05,
    data: { pact: treaty.type === 'nonAggression', alliance: treaty.type === 'alliance', road: treaty.type === 'road', relationsSoured: cause === 'relationsSoured', partyGone: cause === 'partyGone', routeLost: cause === 'routeLost' },
  });
}

/** Whether a joint road still stands on every edge of its way (roads wear away when unpaid or unkept). */
const standing = (state: SimulationState, treaty: RoadAgreement) => {
  const n = state.partition.regions.length;
  for (let at = 1; at < treaty.path.length; at++) if (!state.roads.has(roadKey(n, treaty.path[at - 1], treaty.path[at]))) return false;
  return true;
};

/**
 * Diplomacy and trade system, M5.5's part, monthly: a treaty with a party gone ends; a road agreement whose unfinished
 * stretch is no longer being built (its works abandoned: land on the way lost, a city fallen), or whose finished road
 * has worn away somewhere, ends (its road lost). Yearly per treaty (staggered by id) the review: opinion on either side
 * below its kind's DIPLOMACY_TUNING.end.
 */
export function diplomacyMonth(state: SimulationState, context: TickContext) {
  for (const treaty of state.treaties) {
    if (treaty.type === 'trade' || treaty.endTick !== null) continue;
    const [a, b] = treaty.parties.map(id => state.polities[id]);
    if (a.deathTick !== null || b.deathTick !== null) { endTreaty(state, treaty, 'partyGone', context.tick); continue; }
    if (treaty.type === 'road' && ([a, b].some((party, side) => !treaty.built[side] && !party.roadWorks.some(work => work.agreement === treaty.id))
      || (treaty.built[0] && treaty.built[1] && !standing(state, treaty)))) {
      endTreaty(state, treaty, 'routeLost', context.tick); continue;
    }
    if (((context.tick - treaty.id) % 12 + 12) % 12 !== 0) continue;
    const end = endOf(treaty.type);
    if (opinionOf(a, b.id) < end || opinionOf(b, a.id) < end) endTreaty(state, treaty, 'relationsSoured', context.tick);
  }
}
