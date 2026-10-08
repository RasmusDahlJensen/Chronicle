import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { tradeScore } from '../src/simulation/decisions/choose.ts';
import { faithDraws } from '../src/simulation/faith.ts';
import { decisionView, seeRegion, UNKNOWN } from '../src/simulation/perception.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { judge, remember } from '../src/simulation/relations.ts';
import { teacherOf } from '../src/simulation/research.ts';
import type { Rng } from '../src/simulation/rng.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState, TickContext, TradeEnd, TradeTreaty } from '../src/simulation/state.ts';
import { accessOf, available, landStock, refreshAccess } from '../src/simulation/supply.ts';
import { TECHS } from '../src/simulation/techs.ts';
import { activeTrade, lackOf, proposeTrade, routeOf, spareOf, tradeMonth } from '../src/simulation/trade.ts';
import { hubOf } from '../src/simulation/hubs.ts';
import { TRADE_TUNING } from '../src/simulation/tunables.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Trade agreements (M5.4; VISION.md "Trade"). Each test takes a copy of a real history with two civilizations and sets
 * what they have and need of a resource: the importer lacks it, the exporter has more than it needs.
 */
let history: SimulationState;
const COPPER = RESOURCE_IDS.indexOf('copper'), TIN = RESOURCE_IDS.indexOf('tin');
const yes = { chance: () => true } as unknown as Rng, no = { chance: () => false } as unknown as Rng;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Trade', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Trade');
  while (civsOf(history).length < 2 && history.tick < 1500 * 12) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(civsOf(history).length >= 2, 'two civilizations by then');
});

/** A copy of the history in which `a` lacks copper (needs 1, has none) and `b` has 3 of which it needs 1; nothing
 *  else is demanded or traded, every route is in reach, and they think nothing of each other. */
function market() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  for (const treaty of state.treaties) if (treaty.endTick === null) { treaty.endTick = state.tick; treaty.endCause = 'partyGone'; }
  for (const polity of civsOf(state)) {
    polity.imports.fill(0); polity.exports.fill(0); polity.trading = []; polity.supply.fill(0); polity.demand.fill(0);
    refreshAccess(polity);
  }
  const [a, b] = civsOf(state);
  a.demand[COPPER] = 1; b.supply[COPPER] = 3; b.demand[COPPER] = 1;
  for (const civ of [a, b]) {
    refreshAccess(civ); inReach(civ);
    civ.exchanges = new Map(); civ.wealth = 1_000_000_000;
  }
  for (const [one, other] of [[a, b], [b, a]]) { one.met.set(other.id, state.tick); one.relations.delete(other.id); }
  // The month's wealth ledger starts again from these treasuries.
  state.ledger.wealth.clear();
  for (const polity of civsOf(state)) wealthFlows(state, polity);
  checkInvariants(state);
  return { state, a, b, context: { tick: state.tick } as TickContext };
}
/** Every route in reach (set again after access is refreshed, which re-derives the multipliers). */
const inReach = (civ: Polity) => { civ.knowledge = { ...civ.knowledge, multipliers: { ...civ.knowledge.multipliers, tradeRange: 1000 } }; };
const events = (state: SimulationState, type: string) => { state.chronicle.flush(state.tick); return state.chronicle.events.filter(event => event.type === type); };
const agree = (state: SimulationState, context: TickContext, a: Polity, b: Polity, resource = COPPER) => {
  assert.match(proposeTrade(state, context, yes, a, b, resource, []), /^trades for/);
  return state.treaties.at(-1) as TradeTreaty;
};
// The next tick its yearly review falls on.
const reviewTick = (treaty: TradeTreaty, from: number) => from + 1 + ((treaty.id - from - 1) % 12 + 12) % 12;

test('acceptance needs a true surplus; the terms respect shortfall, what is spared and capacity; a refusal is remembered', () => {
  const { state, a, b, context } = market();
  b.demand[COPPER] = 3; refreshAccess(b);
  assert.match(proposeTrade(state, context, yes, a, b, COPPER, []), /had no copper to spare/);
  assert.equal(state.treaties.filter(treaty => treaty.endTick === null).length, 0);
  b.demand[COPPER] = 1; refreshAccess(b);
  assert.match(proposeTrade(state, context, no, a, b, COPPER, []), /would not trade copper/);
  assert.equal(state.metrics.tradeRefused, history.metrics.tradeRefused + 1);
  assert.ok(a.relations.get(b.id)?.memories.some(memory => memory.reason === 'refusedTrade'), 'the refusal is remembered');
  const route = routeOf(state, a, b, hubOf(state, a), hubOf(state, b));
  const expected = Math.min(lackOf(a, COPPER), spareOf(b, COPPER), route.capacity);
  assert.equal(spareOf(b, COPPER), 2 * TRADE_TUNING.spare, 'it spares a share of its surplus');
  const treaty = agree(state, context, a, b);
  assert.equal(treaty.amount, expected);
  assert.equal(treaty.exporter, b.id); assert.equal(treaty.importer, a.id);
  assert.equal(treaty.barter, -1, 'it has nothing the other lacks: it pays in wealth');
  assert.equal(treaty.price, Math.round(TRADE_TUNING.price * expected));
  assert.match(proposeTrade(state, context, yes, a, b, COPPER, []), /already trading/);
  assert.equal(events(state, 'tradeAgreement').filter(event => event.actors[0].id === a.id).length, 1);
  checkInvariants(state);
  // Beyond reach, nothing is offered.
  for (const civ of [a, b]) civ.knowledge = { ...civ.knowledge, multipliers: { ...civ.knowledge.multipliers, tradeRange: 1e-6 } };
  assert.match(proposeTrade(state, context, yes, a, b, TIN, []), /beyond reach/);
});

test('no one sends on what it imports, so ending one agreement never leaves another short', () => {
  const { state, a, b, context } = market();
  const upstream = agree(state, context, a, b);
  // The importer's need falls and the exporter's grows: the importer still works no copper, so it has none to spare.
  a.demand[COPPER] = 0.1; b.demand[COPPER] = 3; refreshAccess(a); refreshAccess(b); inReach(a); inReach(b);
  assert.equal(spareOf(a, COPPER), 0);
  assert.match(proposeTrade(state, context, yes, b, a, COPPER, []), /had no copper to spare/);
  // Its mines lost, the exporter ends what it can no longer send at once; each side keeps at least what it imports.
  b.supply[COPPER] = 0;
  tradeMonth(state, { tick: context.tick + 1 } as TickContext);
  assert.equal(upstream.endCause, 'noSurplus');
  assert.ok(available(a, COPPER) >= 0 && available(b, COPPER) >= 0);
  checkInvariants(state);
});

test('barter: it pays with what it spares that the other lacks', () => {
  const { state, a, b, context } = market();
  a.supply[TIN] = 2; a.demand[TIN] = 0.5; b.demand[TIN] = 1; refreshAccess(a); refreshAccess(b);
  const treaty = agree(state, context, a, b);
  assert.equal(treaty.barter, TIN); assert.equal(treaty.price, 0);
  const route = routeOf(state, a, b, hubOf(state, a), hubOf(state, b));
  assert.equal(treaty.barterAmount, Math.min(1.5 * TRADE_TUNING.spare, 1, route.capacity));
  // Imports and exports change what each has, both ways.
  assert.equal(available(a, COPPER), treaty.amount); assert.equal(available(b, COPPER), 3 - treaty.amount);
  assert.equal(available(b, TIN), treaty.barterAmount); assert.equal(available(a, TIN), 2 - treaty.barterAmount);
  assert.deepEqual(a.trading, [b.id]); assert.deepEqual(b.trading, [a.id]);
  assert.equal(a.knowledge.access[COPPER], accessOf(treaty.amount, 1), 'access follows what it has with its imports');
  const wealth = [a.wealth, b.wealth];
  tradeMonth(state, context);
  assert.deepEqual([a.wealth, b.wealth], wealth, 'barter moves no wealth');
  checkInvariants(state);
});

test('payments are exact, monthly, and in the wealth ledger; an importer that cannot pay ends the agreement', () => {
  const { state, a, b, context } = market();
  const treaty = agree(state, context, a, b);
  const before = [a.wealth, b.wealth];
  state.ledger.wealth.clear();
  for (let month = 0; month < 12; month++) tradeMonth(state, { tick: context.tick + month } as TickContext);
  const paid = before[0] - a.wealth;
  assert.equal(b.wealth - before[1], paid, 'what one pays the other receives');
  assert.ok(Number.isInteger(paid) && Math.abs(paid + treaty.carry - treaty.price) < 1e-6, `a year pays the price (${paid} + ${treaty.carry} of ${treaty.price})`);
  assert.equal(state.ledger.wealth.get(a.id)!.given, paid); assert.equal(state.ledger.wealth.get(b.id)!.received, paid);
  assert.equal(treaty.endTick, null, 'still needed and still spared');
  // Its treasury lost (as the ledger tells it): the next payment cannot be made.
  wealthFlows(state, a).lost += a.wealth; a.wealth = 0;
  tradeMonth(state, { tick: context.tick + 12 } as TickContext);
  assert.equal(treaty.endCause, 'unpaid');
  assert.equal(available(a, COPPER), 0); assert.equal(available(b, COPPER), 3);
  checkInvariants(state);
});

test('each ending cause ends the agreement, with its event, and its flows leave both sides', () => {
  const cases: [TradeEnd, (setup: ReturnType<typeof market>) => void, boolean][] = [
    ['needPassed', ({ a }) => { a.supply[COPPER] = 2; refreshAccess(a); }, true],
    ['noSurplus', ({ b }) => { b.demand[COPPER] = 2.9; refreshAccess(b); }, true],
    // Mines lost between reviews: what it sends can never exceed what it has, so this ends at once.
    ['noSurplus', ({ b }) => { b.supply[COPPER] = 0.1; }, false],
    ['relationsSoured', ({ a, b }) => { b.relations.set(a.id, { intimacy: 0, opinion: TRADE_TUNING.cancelOpinion - 1, reasons: [], memories: [] }); }, true],
    ['partyGone', ({ b, state }) => { b.deathTick = state.tick; }, false],
  ];
  for (const [cause, change, yearly] of cases) {
    const setup = market(), { state, a, b, context } = setup;
    const treaty = agree(state, context, a, b);
    change(setup);
    const at = yearly ? reviewTick(treaty, context.tick) : context.tick + 1;
    if (yearly && at > context.tick + 1) {
      tradeMonth(state, { tick: context.tick + 1 } as TickContext);
      assert.equal(treaty.endTick, null, `${cause}: only at the yearly review`);
    }
    tradeMonth(state, { tick: at } as TickContext);
    assert.equal(treaty.endCause, cause);
    assert.equal(activeTrade(state, b.id, a.id, COPPER), null);
    assert.equal(a.imports[COPPER], 0); assert.equal(b.exports[COPPER], 0);
    assert.deepEqual(a.trading, []); assert.deepEqual(b.trading, []);
    const ended = events(state, 'treatyCancelled').at(-1)!;
    assert.equal(ended.data[cause], true, `${cause} is told`);
    assert.deepEqual(ended.causes, [{ factor: cause, weight: 1 }]);
    if (cause !== 'partyGone') checkInvariants(state);
  }
});

test('trading partners grow intimate and warmer, research what the other knows faster, and draw each other\'s hub to their faith', () => {
  const { state, a, b, context } = market();
  // A tech the importer lacks that its partner knows (set for the test), and a faith of the partner's that the people of
  // the importer's hub do not follow.
  const tech = TECHS.findIndex((_, at) => !a.knowledge.known[at]), known = b.knowledge.known.slice();
  known[tech] = 1; b.knowledge = { ...b.knowledge, known };
  const hubPeople = state.groups[a.groups.find(id => state.groups[id].region === state.settlements[hubOf(state, a)].region)!];
  b.stateReligion = hubPeople.faith + 1;
  assert.equal(teacherOf(state, a, tech), -1, 'no exchange or trade: no teacher');
  assert.equal(faithDraws(state, hubPeople).get(b.stateReligion)?.trade ?? 0, 0);
  for (let year = 0; year < 30; year++) judge(state, a, context.tick + year * 12);
  const apart = a.relations.get(b.id)!;
  const { intimacy, opinion } = apart;
  assert.ok(!apart.reasons.some(reason => reason.factor === 'trading'));
  agree(state, context, a, b);
  for (let year = 30; year < 60; year++) judge(state, a, context.tick + year * 12);
  const trading = a.relations.get(b.id)!;
  assert.ok(trading.intimacy >= Math.min(1, intimacy + TRADE_TUNING.intimacy) - 1e-9, `intimacy rises toward its trade target (${intimacy} → ${trading.intimacy})`);
  assert.ok(Math.abs(trading.opinion - opinion - TRADE_TUNING.opinion) < 1e-6 + 0.1, `opinion warms by the trade (${opinion} → ${trading.opinion})`);
  assert.ok(trading.reasons.some(reason => reason.factor === 'trading' && reason.weight === TRADE_TUNING.opinion));
  assert.equal(teacherOf(state, a, tech), b.id, 'a trading partner teaches as an exchange does');
  assert.equal(faithDraws(state, hubPeople).get(b.stateReligion)!.trade, TRADE_TUNING.faithDraw, 'its faith draws the people of the hub');
});

test('the view lists trade only for a real shortfall, with partners whose land it knows to hold the resource', () => {
  const { state, a, b } = market();
  // Land of theirs it knows to hold timber or stone: forest or rough ground in one of their regions.
  const stock = landStock(state.geography, state.partition);
  const regions = b.groups.map(id => state.groups[id].region);
  const forest = regions.find(region => stock.forest[region] > 0), rough = regions.find(region => stock.rough[region] > 0);
  const [resource, region] = forest !== undefined ? [RESOURCE_IDS.indexOf('timber'), forest] : [RESOURCE_IDS.indexOf('stone'), rough!];
  assert.ok(region !== undefined, 'they hold forest or rough land');
  a.demand.fill(0); a.demand[resource] = 1; b.supply[resource] = 3; b.demand[resource] = 1;
  b.demand[COPPER] = 0; b.supply[COPPER] = 0;
  refreshAccess(a); refreshAccess(b);
  const listed = () => decisionView(state, a).trades.filter(option => option.partner === b.id);
  // Land of theirs it does not know: nothing listed.
  for (const at of regions) { a.map.status[at] = UNKNOWN; a.map.snapshots.delete(at); a.map.observed = a.map.observed.filter(seen => seen !== at); }
  assert.equal(listed().length, 0, 'it does not know their land holds it');
  seeRegion(a, region);
  const [option] = listed();
  assert.ok(option, 'listed');
  assert.equal(option.resource, resource); assert.equal(option.lack, 1);
  assert.ok(option.spare > 0, 'it believes they could spare some');
  assert.ok(Number.isFinite(tradeScore(decisionView(state, a), option).score));
  assert.equal(tradeScore(decisionView(state, a), { ...option, km: option.reachKm + 1 }).score, Number.NEGATIVE_INFINITY, 'beyond reach: not an option');
  // Not short (or short of too little to trade): nothing listed.
  a.supply[resource] = 1 - TRADE_TUNING.minAmount / 2; refreshAccess(a);
  assert.equal(listed().length, 0);
  a.supply[resource] = 0; refreshAccess(a);
  // Nothing to spare: nothing listed.
  b.demand[resource] = 3; refreshAccess(b);
  assert.equal(listed().length, 0);
  b.demand[resource] = 1; refreshAccess(b);
  // Refused lately: nothing listed.
  remember(state, a, b.id, 'refusedTrade');
  assert.equal(listed().length, 0);
});
