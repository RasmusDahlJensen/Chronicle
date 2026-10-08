import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BELIEF_KINDS } from '../shared/simulation.ts';
import { believe, opinionOf } from '../src/simulation/perception.ts';
import { beliefBias, judge, memoryNow, remember, truthOf } from '../src/simulation/relations.ts';
import { TENETS } from '../src/simulation/religions.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { ERAS, TECHS } from '../src/simulation/techs.ts';
import { secularity } from '../src/simulation/faith.ts';
import { RELATION_TUNING } from '../src/simulation/tunables.ts';

/**
 * Beliefs, intimacy and opinion (M5.1; VISION.md "Beliefs about other polities", "Relations and memory"). A strip of
 * six regions in a row, each people holding the regions given; values, faiths and lineages set per test.
 */
const VALUES = { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 };
function world() {
  const regions = Array.from({ length: 6 }, (_, id) => ({ id, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other < 6).map(region => ({ region, travelKm: 100, riverTier: 0 })) }));
  const state = {
    tick: 0, seed: 1234, partition: { regions }, occupant: new Int32Array(6).fill(-1), groups: [] as { id: number; region: number; size: number }[],
    polities: [] as Polity[], cultures: [] as { values: typeof VALUES }[], religions: [] as { tenets: number[] }[],
  } as unknown as SimulationState;
  const people = (kind: 'band' | 'civ', held: number[], options: { values?: Partial<typeof VALUES>; faith?: number; lineage?: number; size?: number } = {}) => {
    const id = state.polities.length;
    state.cultures.push({ values: { ...VALUES, ...options.values } } as never);
    const polity = {
      id, kind, name: `P${id}`, culture: state.cultures.length - 1, groups: [] as number[], deathTick: null, met: new Map<number, number>(), contacts: [] as number[],
      exchanges: new Map<number, number>(), relations: new Map(), stateReligion: options.faith ?? -1, lineage: options.lineage ?? id, wealth: 500,
      knowledge: { era: 2, multipliers: { military: 1.5 }, known: new Uint8Array(TECHS.length) },
    } as unknown as Polity;
    for (const region of held) {
      state.groups.push({ id: state.groups.length, region, size: options.size ?? 1_000, values: state.cultures[state.cultures.length - 1].values } as never);
      polity.groups.push(state.groups.length - 1); state.occupant[region] = id;
    }
    state.polities.push(polity);
    return polity;
  };
  const meet = (a: Polity, b: Polity) => { a.met.set(b.id, state.tick); b.met.set(a.id, state.tick); };
  return { state, people, meet };
}

test('a belief is the truth off by the pair\'s own bias, shrunk by intimacy; the bias is never re-rolled', () => {
  const { state, people, meet } = world();
  const a = people('civ', [0]), b = people('civ', [3], { size: 4_000 });
  meet(a, b);
  for (const kind of BELIEF_KINDS) {
    const bias = beliefBias(state.seed, a.id, b.id, kind);
    assert.equal(beliefBias(state.seed, a.id, b.id, kind), bias, 'the same every time it is asked');
    assert.ok(bias >= RELATION_TUNING.biasMin && bias <= RELATION_TUNING.biasMax);
  }
  // Each side misjudges the other in its own way.
  assert.notEqual(beliefBias(state.seed, a.id, b.id, 'people'), beliefBias(state.seed, b.id, a.id, 'people'));
  const truth = truthOf(state, b, 'people'), bias = beliefBias(state.seed, a.id, b.id, 'people');
  assert.equal(truth, 4_000);
  assert.equal(truthOf(state, b, 'strength'), 6_000, 'strength: people times the military multiplier');
  // A stranger is misjudged by the whole bias; intimacy shrinks it; full intimacy sees the truth.
  assert.equal(believe(state, a, b, 'people').estimate, truth * (1 + bias));
  assert.equal(believe(state, a, b, 'people').confidence, 0);
  for (const intimacy of [0.25, 0.5, 0.9, 1]) {
    a.relations.set(b.id, { intimacy, opinion: 0, reasons: [], memories: [] });
    assert.ok(Math.abs(believe(state, a, b, 'people').estimate - truth * (1 + bias * (1 - intimacy))) < 1e-9);
    assert.equal(believe(state, a, b, 'people').confidence, intimacy);
  }
  // The truth changes; the misjudgment does not.
  state.groups[b.groups[0]].size = 8_000;
  assert.ok(Math.abs(believe(state, a, b, 'people').estimate - 8_000) < 1e-9);
  a.relations.set(b.id, { intimacy: 0, opinion: 0, reasons: [], memories: [] });
  assert.equal(believe(state, a, b, 'people').estimate, 8_000 * (1 + bias));
  // Eras are whole and within the list.
  assert.ok(Number.isInteger(believe(state, a, b, 'era').estimate));
});

test('intimacy rises along a shared border and with sharing, and fades without contact', () => {
  const { state, people, meet } = world();
  const a = people('civ', [0, 1]), b = people('civ', [2, 3]);
  meet(a, b);
  a.contacts = [b.id];
  judge(state, a, 0);
  assert.equal(a.relations.get(b.id)!.intimacy, RELATION_TUNING.rise, 'a first year of a shared border');
  for (let year = 1; year < 40; year++) judge(state, a, year * 12);
  assert.equal(a.relations.get(b.id)!.intimacy, RELATION_TUNING.border + RELATION_TUNING.contact, 'border and contact, no more');
  a.exchanges.set(b.id, 100 * 12);
  for (let year = 40; year < 60; year++) judge(state, a, year * 12);
  assert.equal(a.relations.get(b.id)!.intimacy, Math.min(1, RELATION_TUNING.border + RELATION_TUNING.contact + RELATION_TUNING.exchange), 'sharing knowledge brings them closer');
  // They part: b moves away and they share nothing more.
  state.occupant[2] = -1; state.occupant[3] = -1; state.occupant[5] = b.id; state.groups[b.groups[0]].region = 5; state.groups[b.groups[1]].region = 5;
  a.contacts = []; a.exchanges.clear();
  const before = a.relations.get(b.id)!.intimacy;
  judge(state, a, 200 * 12);
  assert.ok(Math.abs(a.relations.get(b.id)!.intimacy - (before - RELATION_TUNING.fade)) < 1e-9, 'it fades slowly');
  for (let year = 201; year < 260; year++) judge(state, a, year * 12);
  assert.equal(a.relations.get(b.id)!.intimacy, 0);
  // A people that is gone is forgotten.
  (b as { deathTick: number | null }).deathTick = 300 * 12;
  judge(state, a, 300 * 12);
  assert.equal(a.relations.has(b.id), false);
});

test('opinion: faith, likeness, kinship, border tension, sharing and memories that fade', () => {
  const { state, people, meet } = world();
  const tolerance = TENETS.findIndex(tenet => tenet.key === 'tolerance');
  state.religions.push({ tenets: [] } as never, { tenets: [] } as never, { tenets: [tolerance] } as never);
  const a = people('civ', [0], { faith: 0, lineage: 3, values: { zeal: 0.8 } });
  const same = people('civ', [5], { faith: 0, lineage: 3, values: { zeal: 0.8 } });
  const rival = people('civ', [3], { faith: 1, values: { zeal: 0.8, militarism: 0.1, openness: 0.9 } });
  const tolerant = people('civ', [4], { faith: 2, lineage: 9, values: { zeal: 0.8 } });
  for (const other of [same, rival, tolerant]) meet(a, other);
  judge(state, a, 0);
  const reason = (other: Polity, factor: string) => a.relations.get(other.id)!.reasons.find(entry => entry.factor === factor)?.weight;
  assert.equal(reason(same, 'sameFaith'), RELATION_TUNING.sameFaith);
  assert.equal(reason(same, 'kin'), RELATION_TUNING.kin);
  assert.equal(reason(same, 'culture'), RELATION_TUNING.culture, 'the very same values');
  assert.equal(reason(rival, 'rivalFaith'), -RELATION_TUNING.rivalFaith * 0.8);
  assert.ok(opinionOf(a, same.id) > 0 && opinionOf(a, rival.id) < opinionOf(a, same.id));
  // A tolerant faith halves the rivalry (the same values otherwise, so only the faith differs from the same-faith people).
  assert.equal(a.relations.get(tolerant.id)!.opinion, RELATION_TUNING.culture - RELATION_TUNING.rivalFaith * 0.8 / 2);
  // Border tension: an expansionist pair sharing a border.
  const { state: border, people: borderPeople, meet: borderMeet } = world();
  const x = borderPeople('civ', [0, 1], { values: { expansionism: 0.9 } }), y = borderPeople('civ', [2], { values: { expansionism: 0.9 } });
  borderMeet(x, y);
  judge(border, x, 0);
  assert.equal(x.relations.get(y.id)!.reasons.find(entry => entry.factor === 'borderTension')?.weight, Math.round(-RELATION_TUNING.borderTension * Math.min(1, 1 / RELATION_TUNING.borderScale) * 0.9 * 10) / 10, 'one of its regions on their border');
  // Unlike cultures dislike each other: likeness is judged against a typical one.
  const { state: unlike, people: unlikePeople, meet: unlikeMeet } = world();
  const p = unlikePeople('civ', [0], { values: { militarism: 0.1, openness: 0.9 } }), q = unlikePeople('civ', [5], { values: { militarism: 0.9, openness: 0.1 } });
  unlikeMeet(p, q);
  judge(unlike, p, 0);
  assert.equal(p.relations.get(q.id)!.reasons.find(entry => entry.factor === 'culture')?.weight, -RELATION_TUNING.culture, 'far apart in two values');
  // In the secular age faith weighs less (VISION.md "Secular age").
  const modern = TECHS.map((definition, tech) => ERAS.indexOf(definition.era) >= ERAS.indexOf('Early modern') ? tech : -1).filter(tech => tech >= 0).slice(0, 4);
  for (const tech of modern) { a.knowledge.known[tech] = 1; same.knowledge.known[tech] = 1; }
  judge(state, a, 0);
  assert.ok(Math.abs(reason(same, 'sameFaith')! - Math.round(RELATION_TUNING.sameFaith * (1 - secularity(a)) * 10) / 10) < 1e-9);
  assert.ok(reason(same, 'sameFaith')! < RELATION_TUNING.sameFaith);
  for (const tech of modern) { a.knowledge.known[tech] = 0; same.knowledge.known[tech] = 0; }
  judge(state, a, 0);
  // Sharing knowledge warms them; being turned away cools them, and the memory fades.
  const before = opinionOf(a, rival.id);
  a.exchanges.set(rival.id, 10 * 12);
  remember(state, a, rival.id, 'turnedAway');
  judge(state, a, 0);
  assert.equal(opinionOf(a, rival.id), Math.round((before + RELATION_TUNING.sharing + RELATION_TUNING.memories.turnedAway.points) * 10) / 10);
  assert.ok(a.relations.get(rival.id)!.reasons.length === RELATION_TUNING.reasonCount, 'its strongest reasons only');
  const memory = a.relations.get(rival.id)!.memories[0];
  assert.equal(memoryNow(memory, 0), RELATION_TUNING.memories.turnedAway.points);
  assert.ok(Math.abs(memoryNow(memory, RELATION_TUNING.memories.turnedAway.halfLifeYears * 12) - RELATION_TUNING.memories.turnedAway.points / 2) < 1e-9, 'halved after its half-life');
  judge(state, a, 400 * 12);
  assert.equal(a.relations.get(rival.id)!.memories.length, 0, 'forgotten in time');
  // Only civilizations keep relations, and only of peoples they have met.
  const tribe = people('band', [2]);
  remember(state, tribe, a.id, 'turnedAway');
  remember(state, a, tribe.id, 'turnedAway');
  assert.equal(tribe.relations.size, 0);
  assert.equal(a.relations.has(tribe.id), false, 'a people it has not met');
});
