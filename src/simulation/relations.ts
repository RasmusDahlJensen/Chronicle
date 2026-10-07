import { ERA_NAMES } from '../../shared/simulation.ts';
import { cultureSimilarity } from './culture.ts';
import { secularity } from './faith.ts';
import { TENETS } from './religions.ts';
import { createRng } from './rng.ts';
import { BELIEF_KINDS, type BeliefKind, type MemoryReason, type Polity, type Relation, type SimulationState, type TickContext } from './state.ts';
import { RELATION_TUNING } from './tunables.ts';

/**
 * Relations (VISION.md "Beliefs about other polities", "Relations and memory"; M5.1): what each civilization believes
 * of the peoples it has met, how intimate they are and what it thinks of them. Decisions read these only through
 * `perception.ts` (the query layer); this module keeps them, yearly per civilization in the diplomacy system.
 */

// A key of six words: no system stream (four or five words) can draw the same numbers.
const BIAS = 0xb1a5;

/**
 * How far `observer`'s estimate of `other`'s `kind` is off before intimacy shrinks it (VISION.md: drawn once per pair
 * at first contact, seeded, never re-rolled): exp(N(0, biasSpread)) − 1 within [biasMin, biasMax]. A pure function of
 * the pair, so it is the same every time it is asked.
 */
export function beliefBias(seed: number, observer: number, other: number, kind: BeliefKind) {
  const tuning = RELATION_TUNING, rng = createRng(seed, BIAS, BIAS, observer, other, BELIEF_KINDS.indexOf(kind));
  // A standard normal draw (the sum of three uniforms, scaled).
  const normal = (rng.next() + rng.next() + rng.next() - 1.5) * 2;
  return Math.max(tuning.biasMin, Math.min(tuning.biasMax, Math.exp(tuning.biasSpread * normal) - 1));
}

/** The truth a belief estimates (only `perception.ts`, the study and physical systems may ask): a people's population,
 *  strength (until M6's soldiers, its people times its techs' military multiplier), treasury and era. */
export function truthOf(state: SimulationState, polity: Polity, kind: BeliefKind) {
  if (kind === 'era') return polity.knowledge.era;
  if (kind === 'wealth') return polity.wealth;
  let people = 0;
  for (const id of polity.groups) people += state.groups[id].size;
  return kind === 'people' ? people : people * polity.knowledge.multipliers.military;
}

/** An estimate from the truth: off by the pair's bias, shrunk by their intimacy (eras are whole and within the list). */
export function estimate(truth: number, bias: number, intimacy: number, kind: BeliefKind) {
  const value = truth * (1 + bias * (1 - intimacy));
  return kind === 'era' ? Math.max(0, Math.min(ERA_NAMES.length - 1, Math.round(value))) : value;
}

export function newRelation(): Relation { return { intimacy: 0, opinion: 0, reasons: [], memories: [] }; }

/** `observer` remembers something `other` did to it (it fades: RELATION_TUNING.memories). */
export function remember(state: SimulationState, observer: Polity, other: number, reason: MemoryReason) {
  if (observer.kind !== 'civ' || other === observer.id || !observer.met.has(other)) return;
  let relation = observer.relations.get(other);
  if (!relation) { relation = newRelation(); observer.relations.set(other, relation); }
  relation.memories.push({ reason, points: RELATION_TUNING.memories[reason].points, tick: state.tick });
}

/** A belief met the truth (VISION.md: contact corrects beliefs): `observer` comes to know `other` better at once. */
export function correct(observer: Polity, other: number) {
  const relation = observer.relations.get(other);
  if (relation) relation.intimacy = Math.min(1, relation.intimacy + RELATION_TUNING.correction);
}

/** A memory's points now. */
export const memoryNow = (memory: Relation['memories'][number], tick: number) =>
  memory.points * 0.5 ** ((tick - memory.tick) / 12 / RELATION_TUNING.memories[memory.reason].halfLifeYears);

const TOLERANCE = TENETS.findIndex(tenet => tenet.key === 'tolerance');
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Diplomacy system, M5.1's part: once a year per civilization (staggered by id), for each living people it has met,
 * its intimacy moves toward what their contact supports and its opinion is judged again from its standing reasons and
 * memories. Relations with peoples that are gone are dropped.
 */
export function relationsYear(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.kind !== 'civ' || ((context.tick - id) % 12 + 12) % 12 !== 0) continue;
    judge(state, polity, context.tick);
  }
}

export function judge(state: SimulationState, polity: Polity, tick: number) {
  const tuning = RELATION_TUNING, regions = state.partition.regions;
  for (const other of polity.relations.keys()) if (!polity.met.has(other) || state.polities[other].deathTick !== null) polity.relations.delete(other);
  // Its regions that border each people.
  const borders = new Map<number, number>();
  for (const groupId of polity.groups) {
    const region = state.groups[groupId].region, touched = new Set<number>();
    for (const edge of regions[region].neighbors) { const other = state.occupant[edge.region]; if (other >= 0 && other !== polity.id) touched.add(other); }
    for (const other of touched) borders.set(other, (borders.get(other) ?? 0) + 1);
  }
  const contacts = new Set(polity.contacts), mine = state.cultures[polity.culture].values;
  for (const [other] of polity.met) {
    const them = state.polities[other];
    if (them.deathTick !== null || other === polity.id) continue;
    let relation = polity.relations.get(other);
    if (!relation) { relation = newRelation(); polity.relations.set(other, relation); }
    const border = borders.get(other) ?? 0, sharing = (polity.exchanges.get(other) ?? 0) > tick;
    // Intimacy toward what their contact supports.
    const target = Math.min(1, (border > 0 ? tuning.border : 0) + (contacts.has(other) ? tuning.contact : 0) + (sharing ? tuning.exchange : 0));
    relation.intimacy = relation.intimacy < target ? Math.min(target, relation.intimacy + tuning.rise) : Math.max(target, relation.intimacy - tuning.fade);
    // Opinion: its standing reasons and memories.
    const theirs = state.cultures[them.culture].values, parts: Record<string, number> = {};
    const a = polity.stateReligion, b = them.stateReligion;
    if (a >= 0 && b >= 0) {
      // Faith weighs less in the secular age (VISION.md "Secular age").
      const devout = 1 - (secularity(polity) + secularity(them)) / 2;
      if (a === b) parts.sameFaith = tuning.sameFaith * devout;
      else {
        const tolerant = state.religions[a].tenets.includes(TOLERANCE) || state.religions[b].tenets.includes(TOLERANCE);
        parts.rivalFaith = -tuning.rivalFaith * (mine.zeal + theirs.zeal) / 2 * (tolerant ? 0.5 : 1) * devout;
      }
    }
    const likeness = (cultureSimilarity(mine, theirs) - tuning.culturePivot) / (1 - tuning.culturePivot);
    parts.culture = tuning.culture * Math.max(-1, Math.min(1, likeness));
    if (polity.lineage === them.lineage) parts.kin = tuning.kin;
    if (sharing) parts.sharing = tuning.sharing;
    if (border > 0) parts.borderTension = -tuning.borderTension * Math.min(1, border / tuning.borderScale) * (mine.expansionism + theirs.expansionism) / 2;
    relation.memories = relation.memories.filter(memory => Math.abs(memoryNow(memory, tick)) >= tuning.forgetBelow);
    for (const memory of relation.memories) parts[memory.reason] = (parts[memory.reason] ?? 0) + memoryNow(memory, tick);
    let opinion = 0;
    for (const value of Object.values(parts)) opinion += value;
    relation.opinion = round1(Math.max(-100, Math.min(100, opinion)));
    relation.reasons = Object.entries(parts).filter(([, weight]) => Math.abs(weight) >= 0.05).map(([factor, weight]) => ({ factor, weight: round1(weight) }))
      .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight) || (x.factor < y.factor ? -1 : 1)).slice(0, tuning.reasonCount);
  }
}

/** Beliefs and opinion over civilizations' relations with living civilizations (the study's M5.1 table). */
export function relationStats(state: SimulationState) {
  const bands = [[0, 0], [0, 0], [0, 0]];
  let intimacy = 0, opinion = 0, warm = 0, cold = 0, count = 0;
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.kind !== 'civ') continue;
    for (const [other, relation] of polity.relations) {
      const them = state.polities[other];
      if (them.kind !== 'civ' || them.deathTick !== null) continue;
      const truth = truthOf(state, them, 'people');
      if (truth <= 0) continue;
      const error = Math.abs(estimate(truth, beliefBias(state.seed, id, other, 'people'), relation.intimacy, 'people') / truth - 1);
      const band = bands[relation.intimacy < 0.3 ? 0 : relation.intimacy < 0.7 ? 1 : 2];
      band[0] += error; band[1]++;
      intimacy += relation.intimacy; opinion += relation.opinion; count++;
      if (relation.opinion >= 30) warm++;
      if (relation.opinion <= -30) cold++;
    }
  }
  // −1: no pairs know each other that well (or that little).
  const round = (value: number) => Math.round(value * 1000) / 1000, mean = ([sum, n]: number[]) => n ? round(sum / n) : -1;
  return {
    beliefErrorLow: mean(bands[0]), beliefErrorMid: mean(bands[1]), beliefErrorHigh: mean(bands[2]), meanIntimacy: count ? round(intimacy / count) : 0,
    opinionMean: count ? round(opinion / count) : 0, opinionWarm: count ? round(warm / count) : 0, opinionCold: count ? round(cold / count) : 0,
    beliefDecisions: state.metrics.beliefDecisions, beliefsFarOff: state.metrics.beliefsFarOff,
  };
}
