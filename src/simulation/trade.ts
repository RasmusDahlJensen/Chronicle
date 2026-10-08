import { RESOURCE_IDS } from '../../shared/atlas.ts';
import type { ChronicleEvent } from '../../shared/simulation.ts';
import { incomeOf, wealthFlows } from './economy.ts';
import { greatCircleKm } from './geography.ts';
import { hubCapacity, hubOf } from './hubs.ts';
import { correct, remember } from './relations.ts';
import type { Rng } from './rng.ts';
import type { Polity, SimulationState, TickContext, TradeEnd, Treaty } from './state.ts';
import { available, refreshAccess } from './supply.ts';
import { TRADE_TUNING } from './tunables.ts';
import { effectiveValues } from './values.ts';

/**
 * Trade agreements (VISION.md "Trade"; M5.4). A civilization short of a resource proposes trade at its decision step
 * (`decisions/choose.ts` weighs what its view lists); the partner judges in truth whether it can and will. An agreement
 * moves a fixed amount a year through the two hubs, paid in barter or in wealth (monthly, exactly accounted), until the
 * need passes, the goods run out, a payment is missed, relations sour or a party is gone. Imports and exports are kept
 * on both parties (`imports`, `exports`) and their active partners (`trading`), in step with the treaties.
 */

/** The route between two hubs: its length, whether it goes by sea (two harbors), how far either side's trade reaches,
 *  and what it carries. */
export function routeOf(state: SimulationState, a: Polity, b: Polity, hubA: number, hubB: number) {
  const tuning = TRADE_TUNING, from = state.settlements[hubA], to = state.settlements[hubB];
  const sea = from.bonus.harbor && to.bonus.harbor, range = Math.max(a.knowledge.multipliers.tradeRange, b.knowledge.multipliers.tradeRange);
  const km = greatCircleKm(state.geography, from.cell, to.cell);
  return { km, sea, reachKm: (sea ? tuning.seaRangeKm : tuning.rangeKm) * range, capacity: Math.min(hubCapacity(state, hubA), hubCapacity(state, hubB)) };
}

/**
 * What a civilization works of a resource beyond its own demand and what it already sends (no one sends on what it
 * imports, so its exports never exceed what it works), what it would agree to spare of that (a share, so a growing
 * demand does not end the agreement at once), and what it lacks (units a year).
 */
export const surplusOf = (civ: Polity, resource: number) => Math.max(0, civ.supply[resource] - civ.exports[resource] - civ.demand[resource]);
export const spareOf = (civ: Polity, resource: number) => surplusOf(civ, resource) * TRADE_TUNING.spare;
export const lackOf = (civ: Polity, resource: number) => Math.max(0, civ.demand[resource] - available(civ, resource));

/** The agreement through which `exporter` sends `resource` to `importer` now, if any. */
export function activeTrade(state: SimulationState, exporter: number, importer: number, resource: number) {
  for (let at = state.treaties.length - 1; at >= 0; at--) {
    const treaty = state.treaties[at];
    if (treaty.endTick === null && treaty.exporter === exporter && treaty.importer === importer && treaty.resource === resource) return treaty;
  }
  return null;
}

/**
 * `civ` proposes that `partner` send it `resource` (its decision). The partner needs a true surplus and judges: what
 * it gains (wealth a year as a share of its income, or its own shortfall relieved by barter), its opinion of `civ`,
 * its Openness and its Tradition. Returns what happened, for the decision log.
 */
export function proposeTrade(state: SimulationState, context: TickContext, rng: Rng, civ: Polity, partner: Polity, resource: number, cited: ChronicleEvent['causes']): string {
  const tuning = TRADE_TUNING, name = RESOURCE_IDS[resource];
  if (partner.deathTick !== null || partner.kind !== 'civ') return 'the other civilization is gone';
  if (activeTrade(state, partner.id, civ.id, resource)) return `already trading for ${name} with the ${partner.name}`;
  const hubA = hubOf(state, civ), hubB = hubOf(state, partner);
  if (hubA < 0 || hubB < 0) return 'no hub to trade through';
  const route = routeOf(state, civ, partner, hubA, hubB);
  if (route.km > route.reachKm) return `the ${partner.name} are beyond reach`;
  state.metrics.tradeOffers++;
  const amount = Math.min(lackOf(civ, resource), spareOf(partner, resource), route.capacity);
  if (amount < tuning.minAmount) {
    // It learns it misjudged them (VISION.md: contact corrects beliefs).
    correct(civ, partner.id);
    return `the ${partner.name} had no ${name} to spare`;
  }
  // Barter when it has to spare something the partner lacks; otherwise wealth.
  let barter = -1, barterAmount = 0;
  for (let other = 0; other < RESOURCE_IDS.length; other++) {
    if (other === resource) continue;
    const offer = Math.min(spareOf(civ, other), lackOf(partner, other), route.capacity);
    if (offer >= tuning.minAmount && offer > barterAmount) { barter = other; barterAmount = offer; }
  }
  const price = barter >= 0 ? 0 : Math.round(tuning.price * amount);
  const values = effectiveValues(state, partner), opinion = partner.relations.get(civ.id)?.opinion ?? 0;
  const gain = barter >= 0 ? Math.min(1, barterAmount / Math.max(1e-9, partner.demand[barter])) : Math.min(1, price / Math.max(1, incomeOf(state, partner)));
  const chance = Math.max(0, Math.min(1, tuning.accept.base + tuning.accept.gain * gain + tuning.accept.opinion * opinion / 100 + tuning.accept.openness * values.openness - tuning.accept.tradition * values.tradition));
  if (!rng.chance(chance)) {
    state.metrics.tradeRefused++;
    remember(state, civ, partner.id, 'refusedTrade');
    return `the ${partner.name} would not trade ${name}`;
  }
  const treaty: Treaty = {
    id: state.treaties.length, type: 'trade', exporter: partner.id, importer: civ.id, resource, amount, barter, barterAmount, price, carry: 0,
    hubs: [hubB, hubA], startTick: context.tick, endTick: null, endCause: null,
  };
  state.treaties.push(treaty);
  begin(state, treaty);
  state.metrics.tradeAgreements++;
  state.chronicle.emit({
    type: 'tradeAgreement', actors: [{ id: civ.id, role: 'a' }, { id: partner.id, role: 'b' }], region: state.settlements[hubA].region, causes: cited, importance: 0.12,
    data: {
      resource: name, importer: civ.name, exporter: partner.name, from: state.settlements[hubB].name, to: state.settlements[hubA].name,
      barter: barter >= 0, wealth: barter < 0, barterResource: barter >= 0 ? RESOURCE_IDS[barter] : '', price, sea: route.sea,
    },
  });
  return `trades for ${name} with the ${partner.name}`;
}

/** An agreement's flows join both parties' imports and exports (and their partners). */
function begin(state: SimulationState, treaty: Treaty) {
  const exporter = state.polities[treaty.exporter], importer = state.polities[treaty.importer];
  exporter.exports[treaty.resource] += treaty.amount; importer.imports[treaty.resource] += treaty.amount;
  if (treaty.barter >= 0) { importer.exports[treaty.barter] += treaty.barterAmount; exporter.imports[treaty.barter] += treaty.barterAmount; }
  exporter.trading.push(importer.id); importer.trading.push(exporter.id);
  refreshAccess(exporter); refreshAccess(importer);
}

/** An agreement ends: its flows leave both parties, with an event (unless both parties are gone). */
export function endTrade(state: SimulationState, treaty: Treaty, cause: TradeEnd, tick: number) {
  const exporter = state.polities[treaty.exporter], importer = state.polities[treaty.importer];
  treaty.endTick = tick; treaty.endCause = cause;
  exporter.exports[treaty.resource] = settle(exporter.exports[treaty.resource] - treaty.amount); importer.imports[treaty.resource] = settle(importer.imports[treaty.resource] - treaty.amount);
  if (treaty.barter >= 0) { importer.exports[treaty.barter] = settle(importer.exports[treaty.barter] - treaty.barterAmount); exporter.imports[treaty.barter] = settle(exporter.imports[treaty.barter] - treaty.barterAmount); }
  exporter.trading.splice(exporter.trading.indexOf(importer.id), 1); importer.trading.splice(importer.trading.indexOf(exporter.id), 1);
  refreshAccess(exporter); refreshAccess(importer);
  state.metrics.tradeEnded[cause]++;
  if (exporter.deathTick !== null && importer.deathTick !== null) return;
  state.chronicle.emit({
    type: 'treatyCancelled', actors: [{ id: importer.id, role: 'a' }, { id: exporter.id, role: 'b' }], region: null, causes: [{ factor: cause, weight: 1 }], importance: 0.05,
    data: {
      trade: true, resource: RESOURCE_IDS[treaty.resource], importer: importer.name, exporter: exporter.name,
      needPassed: cause === 'needPassed', noSurplus: cause === 'noSurplus', unpaid: cause === 'unpaid', relationsSoured: cause === 'relationsSoured', partyGone: cause === 'partyGone',
    },
  });
}
// Sums of agreed amounts return to exactly 0 when the last agreement ends (no drift from floating sums).
const settle = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;

/**
 * Diplomacy and trade system, M5.4's part, monthly (after this month's resource assessments). First, no one sends
 * more than it works: an exporter that lost the mines or land behind its agreements ends them, newest first (none to
 * spare), and an importer that no longer works the barter goods it sends likewise (unpaid). What each has then stays
 * at least what it imports, whatever ends later. Then wealth-paid agreements are paid (a twelfth of the price a month,
 * whole units, the fraction carried); one the importer cannot pay ends. Yearly per agreement (staggered by id) the
 * review: opinion soured on either side, the importer's need passed, the exporter no longer able to spare it, or the
 * importer its barter goods. Each year the agreement also runs through each side's hub of the day.
 */
export function tradeMonth(state: SimulationState, context: TickContext) {
  const tuning = TRADE_TUNING;
  for (let at = state.treaties.length - 1; at >= 0; at--) {
    const treaty = state.treaties[at];
    if (treaty.endTick !== null) continue;
    const exporter = state.polities[treaty.exporter], importer = state.polities[treaty.importer];
    if (exporter.exports[treaty.resource] > exporter.supply[treaty.resource] + 1e-9) endTrade(state, treaty, 'noSurplus', context.tick);
    else if (treaty.barter >= 0 && importer.exports[treaty.barter] > importer.supply[treaty.barter] + 1e-9) endTrade(state, treaty, 'unpaid', context.tick);
  }
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) continue;
    const exporter = state.polities[treaty.exporter], importer = state.polities[treaty.importer];
    if (exporter.deathTick !== null || importer.deathTick !== null) { endTrade(state, treaty, 'partyGone', context.tick); continue; }
    if (treaty.price > 0) {
      const due = treaty.price / 12 + treaty.carry, whole = Math.floor(due);
      if (importer.wealth < whole) { endTrade(state, treaty, 'unpaid', context.tick); continue; }
      treaty.carry = due - whole;
      if (whole > 0) {
        wealthFlows(state, importer).given += whole; wealthFlows(state, exporter).received += whole;
        importer.wealth -= whole; exporter.wealth += whole;
      }
    }
    if (((context.tick - treaty.id) % 12 + 12) % 12 !== 0) continue;
    const soured = (importer.relations.get(exporter.id)?.opinion ?? 0) < tuning.cancelOpinion || (exporter.relations.get(importer.id)?.opinion ?? 0) < tuning.cancelOpinion;
    // Without this agreement: would the importer still lack it, and could each side still spare what it sends?
    const lackWithout = importer.demand[treaty.resource] - (available(importer, treaty.resource) - treaty.amount);
    const spareWithout = (civ: Polity, resource: number, amount: number) => civ.supply[resource] - (civ.exports[resource] - amount) - civ.demand[resource];
    if (soured) endTrade(state, treaty, 'relationsSoured', context.tick);
    else if (lackWithout < tuning.minShort * importer.demand[treaty.resource]) endTrade(state, treaty, 'needPassed', context.tick);
    else if (spareWithout(exporter, treaty.resource, treaty.amount) < treaty.amount) endTrade(state, treaty, 'noSurplus', context.tick);
    else if (treaty.barter >= 0 && spareWithout(importer, treaty.barter, treaty.barterAmount) < treaty.barterAmount) endTrade(state, treaty, 'unpaid', context.tick);
    else {
      // Goods go through each side's hub of the day (a hub may have fallen to ruin or changed hands).
      const exporterHub = hubOf(state, exporter), importerHub = hubOf(state, importer);
      if (exporterHub >= 0 && importerHub >= 0) treaty.hubs = [exporterHub, importerHub];
    }
  }
}
