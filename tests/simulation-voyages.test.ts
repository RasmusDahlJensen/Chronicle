import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { voyageScore } from '../src/simulation/decisions/choose.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { decodeGeography, greatCircleKm } from '../src/simulation/geography.ts';
import { learn } from '../src/simulation/knowledge.ts';
import { decisionView, KNOWN, lossChance, OBSERVED, UNKNOWN } from '../src/simulation/perception.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import type { Rng } from '../src/simulation/rng.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, SimulationState, TickContext } from '../src/simulation/state.ts';
import { TECH_INDEX, TECHS } from '../src/simulation/techs.ts';
import { VOYAGE_TUNING } from '../src/simulation/tunables.ts';
import { voyage, voyageTargets } from '../src/simulation/voyages.ts';
import { research } from '../src/simulation/research.ts';
import { createRng } from '../src/simulation/rng.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Overseas voyages (M5.6; VISION.md "Overseas voyages") and maps shared between treaty partners. Each test takes a copy
 * of a real history and gives a civilization a harbor on its coast and the knowledge to sail (a labelled test fixture).
 */
let history: SimulationState;
const civsOf = (state: SimulationState) => state.living.map(id => state.polities[id]).filter(polity => polity.kind === 'civ');
/** Draws that never lose a voyage and always take the first choice. */
const calm = { next: () => 0.5, int: () => 0, chance: () => false, weighted: () => 0 } as unknown as Rng;

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (civsOf(history).length < 2 && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(civsOf(history).length >= 2);
});

/** A copy of the history in which its first civilization with a coast knows `tech` (Sailing or Navigation) and has a
 *  harbor on its coast. */
function sailor(tech = 'Sailing') {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  const civ = civsOf(state).find(entry => entry.groups.some(id => state.partition.regions[state.groups[id].region].coastal))!;
  const wanted = new Set<number>();
  const add = (index: number) => { if (wanted.has(index)) return; for (const name of TECHS[index].requires) add(TECH_INDEX.get(name)!); wanted.add(index); };
  add(TECH_INDEX.get(tech)!);
  for (const index of wanted) if (!civ.knowledge.known[index]) civ.knowledge = learn(civ.knowledge, index);
  const harbor = civ.groups.map(id => state.groups[id].region).find(region => state.partition.regions[region].coastal)!;
  state.harbors[harbor] = 1;
  return { state, civ, harbor, context: { tick: state.tick } as TickContext };
}

test('a civilization with Sailing and a harbor weighs a voyage, less soon after one and after voyages that found nothing', () => {
  const plain = structuredClone(history);
  const landlocked = civsOf(plain)[0];
  assert.equal(decisionView(plain, landlocked).voyage, null, 'no Sailing, no harbor: no voyage');
  const { state, civ } = sailor();
  let view = decisionView(state, civ);
  assert.deepEqual(view.voyage, { harbors: 1, reachKm: VOYAGE_TUNING.reachKm[1], loss: lossChance(1, VOYAGE_TUNING.reachKm[1] / 2), years: -1, empty: 0 });
  const first = voyageScore(view)!;
  assert.equal(first.action, 'voyage');
  assert.ok((first.factors.find(entry => entry.factor === 'risk')?.weight ?? 0) < 0, 'the risk of loss holds it back');
  civ.voyageTick = state.tick - 12 * 10;
  view = decisionView(state, civ);
  assert.ok(voyageScore(view)!.score < first.score, 'ten years after a voyage, less');
  // Voyages that found nothing hold it back, less as the years pass, and not at all once its reach has grown since.
  const afterEmpty = (years: number, empty: number) => { civ.voyageTick = state.tick - 12 * years; civ.emptyVoyages = empty; return voyageScore(decisionView(state, civ))!.score; };
  assert.ok(afterEmpty(150, 3) < afterEmpty(150, 0), 'after voyages that found nothing, less');
  assert.ok(afterEmpty(500, 3) > afterEmpty(150, 3), 'less so as the years pass');
  civ.seaTick = state.tick - 12 * 20;
  assert.equal(afterEmpty(150, 3), afterEmpty(150, 0), 'a sea reach grown since: they no longer count');
  civ.seaTick = -1; civ.emptyVoyages = 0;
  // Navigation sails further, and loses fewer ships a km.
  assert.ok(lossChance(2, 1000) < lossChance(1, 1000) && VOYAGE_TUNING.reachKm[2] > VOYAGE_TUNING.reachKm[1]);
});

test('a voyage maps a strip of one coast within reach; a lost one learns nothing; with nowhere to head, only open sea', () => {
  const { state, civ, harbor, context } = sailor();
  const before = civ.map.status.slice(), voyages = state.metrics.voyages;
  const outcome = voyage(state, context.tick, calm, civ, []);
  assert.match(outcome, /reached (new lands|a far coast)/);
  assert.equal(state.metrics.voyages, voyages + 1); assert.equal(civ.voyageTick, context.tick); assert.equal(civ.emptyVoyages, 0);
  const mapped = [...civ.map.status.keys()].filter(region => before[region] === UNKNOWN && civ.map.status[region] !== UNKNOWN);
  assert.ok(mapped.length >= 1 && mapped.length <= VOYAGE_TUNING.strip);
  const regions = state.partition.regions;
  assert.ok(mapped.every(region => regions[region].coastal && regions[region].landmass === regions[mapped[0]].landmass), 'a strip of one coast');
  assert.ok(mapped.some(region => greatCircleKm(state.geography, regions[harbor].centroid, regions[region].centroid) <= VOYAGE_TUNING.reachKm[1]), 'within its reach');
  for (const region of mapped) { const other = state.occupant[region]; if (other >= 0 && other !== civ.id) assert.ok(civ.met.has(other), 'it meets who lives there'); }
  state.chronicle.flush(state.tick);
  const event = state.chronicle.events.at(-1)!;
  assert.equal(event.type, 'newLandsDiscovered');
  assert.ok(typeof event.data.explorer === 'string' && (event.data.explorer as string).length > 0, 'a named explorer');
  // Lost at sea: an event, and nothing learned.
  const lost = sailor(), map = lost.civ.map.status.slice();
  assert.match(voyage(lost.state, lost.context.tick, { ...calm, chance: () => true } as unknown as Rng, lost.civ, []), /lost at sea/);
  assert.deepEqual(lost.civ.map.status, map);
  assert.equal(lost.state.metrics.voyagesLost, history.metrics.voyagesLost + 1);
  lost.state.chronicle.flush(lost.state.tick);
  assert.equal(lost.state.chronicle.events.at(-1)!.type, 'voyageLost');
  // Nothing unknown in reach: only open sea, and it remembers.
  const charted = sailor();
  charted.civ.map.status = charted.civ.map.status.map(status => status === UNKNOWN ? KNOWN : status);
  // (And no coast it has heard of holds a people it has not met.)
  charted.civ.map.snapshots.forEach(snapshot => { snapshot.occupant = -1; });
  assert.match(voyage(charted.state, charted.context.tick, calm, charted.civ, []), /only open sea/);
  assert.equal(charted.civ.emptyVoyages, 1);
});

test('voyages head for nearer coasts, three times likelier on another landmass, and for known coasts with peoples unmet', () => {
  const { state, civ } = sailor('Navigation');
  const regions = state.partition.regions, held = new Set(civ.groups.map(id => regions[state.groups[id].region].landmass));
  const targets = voyageTargets(state, civ);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(regions[target.region].coastal && target.km <= VOYAGE_TUNING.reachKm[2]);
    assert.ok(Math.abs(target.weight - (held.has(regions[target.region].landmass) ? 1 : VOYAGE_TUNING.otherLand) / Math.max(1, target.km)) < 1e-15);
    const status = civ.map.status[target.region], occupant = civ.map.snapshots.get(target.region)?.occupant ?? -1;
    assert.ok(status === UNKNOWN || (status === KNOWN && occupant >= 0 && !civ.met.has(occupant)), 'unknown, or known to hold a people unmet');
  }
});

test('a voyage to another landmass meets the people living there: a first contact overseas', () => {
  const { state, civ, context } = sailor('Navigation');
  const regions = state.partition.regions, held = new Set(civ.groups.map(id => regions[state.groups[id].region].landmass));
  const far = voyageTargets(state, civ).find(target => !held.has(regions[target.region].landmass))!;
  assert.ok(far, 'another landmass within reach');
  // Labelled test fixture: a people it has not met lives on that coast, and every other coast in reach is charted.
  const stranger = state.polities.find(polity => polity.id !== civ.id && polity.deathTick === null && !civ.met.has(polity.id))!;
  state.occupant[far.region] = stranger.id;
  for (let region = 0; region < regions.length; region++) {
    if (region === far.region) { civ.map.status[region] = UNKNOWN; civ.map.snapshots.delete(region); continue; }
    if (civ.map.status[region] === UNKNOWN) { civ.map.status[region] = KNOWN; civ.map.snapshots.set(region, { occupant: -1, owner: -1, tick: state.tick }); }
    else if (civ.map.status[region] === KNOWN) civ.map.snapshots.get(region)!.occupant = -1;
  }
  assert.deepEqual(voyageTargets(state, civ).map(target => target.region), [far.region]);
  const contacts = state.metrics.voyageContacts, otherLand = state.metrics.voyagesOtherLand;
  assert.match(voyage(state, context.tick, calm, civ, []), /meeting a new people/);
  assert.ok(civ.met.has(stranger.id) && stranger.met.has(civ.id));
  assert.equal(state.metrics.voyageContacts, contacts + 1); assert.equal(state.metrics.voyagesOtherLand, otherLand + 1);
  state.chronicle.flush(state.tick);
  const found = state.chronicle.events.filter(event => event.type === 'newLandsDiscovered').at(-1)!;
  assert.equal(found.data.otherLand, true); assert.equal(found.importance, 0.5);
  assert.ok(state.chronicle.events.some(event => event.type === 'firstContact' && event.actors.some(actor => actor.id === stranger.id) && event.causes[0].factor === 'expedition'));
});

test('a trading partner shares its map at the yearly contact step', () => {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  const [a, b] = civsOf(state);
  a.trading = [b.id];
  const theirs = b.map.observed.filter(region => a.map.status[region] === UNKNOWN);
  assert.ok(theirs.length > 0);
  let tick = state.tick;
  while (((tick - a.id) % 12 + 12) % 12 !== 0) tick++;
  research(state, { tick, year: Math.floor(tick / 12), month: tick % 12, stream: (entity = 0, salt = 0) => createRng(7, tick, entity, salt) } as TickContext);
  assert.ok(theirs.every(region => a.map.status[region] === KNOWN), 'it knows what its partner sees');
});

test('trading partners and allies share their maps once a year', () => {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  const [a, b] = civsOf(state);
  for (const civ of [a, b]) civ.wealth = Math.max(civ.wealth, 1);
  state.ledger.wealth.clear();
  for (const civ of civsOf(state)) wealthFlows(state, civ);
  const feel = (one: Polity, other: Polity, opinion: number) => { one.relations.set(other.id, { intimacy: 0.5, opinion, reasons: [], memories: [] }); one.met.set(other.id, state.tick); };
  feel(a, b, 80); feel(b, a, 80);
  a.allies.push(b.id); b.allies.push(a.id);
  state.treaties.push({ id: state.treaties.length, type: 'alliance', parties: [a.id, b.id], startTick: state.tick, endTick: null, endCause: null });
  const theirs = b.map.observed.filter(region => a.map.status[region] === UNKNOWN);
  assert.ok(theirs.length > 0, 'b sees land a does not know');
  // Up to and through a's yearly contact step.
  while (((state.tick - a.id) % 12 + 12) % 12 !== 0) stepSimulation(state);
  stepSimulation(state);
  assert.ok(a.allies.includes(b.id), 'still allied');
  const learned = theirs.filter(region => a.map.status[region] !== UNKNOWN);
  assert.ok(learned.length >= theirs.length * 0.9, `a learned b's map (${learned.length} of ${theirs.length})`);
  assert.ok(learned.every(region => a.map.status[region] === KNOWN || a.map.status[region] === OBSERVED));
});
