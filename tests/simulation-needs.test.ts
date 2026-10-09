import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reasonsFor, unionScore } from '../src/simulation/decisions/choose.ts';
import type { Option } from '../src/simulation/decisions/options.ts';
import { chanceOf, effectiveValues, frictionOf, infrastructureNeed, threatOf, unrestOf, type Neighbour, type PolityView } from '../src/simulation/perception.ts';
import type { Polity, SimulationState } from '../src/simulation/state.ts';
import { NEED_TUNING } from '../src/simulation/tunables.ts';

/** Effective values, needs and causes (M5.2; VISION.md "Personality and the decision model"). */

test('a realm decides by all its people\'s values, people-weighted (ruler and government neutral until M7)', () => {
  const values = (militarism: number, zeal: number) => ({ militarism, zeal, openness: 0.5, tradition: 0.5, expansionism: 0.5 });
  const state = {
    groups: [{ size: 3_000, values: values(0.2, 0.8) }, { size: 1_000, values: values(0.6, 0.4) }],
    cultures: [{ values: values(0.9, 0.9) }],
  } as unknown as SimulationState;
  const polity = { groups: [0, 1], culture: 0 } as unknown as Polity;
  const effective = effectiveValues(state, polity);
  assert.ok(Math.abs(effective.militarism - 0.3) < 1e-12, 'not the ruling culture\'s 0.9: three parts 0.2, one part 0.6');
  assert.ok(Math.abs(effective.zeal - 0.7) < 1e-12);
  assert.equal(effective.openness, 0.5);
  // A realm with nobody left decides by its ruling culture.
  assert.equal(effectiveValues(state, { groups: [], culture: 0 } as unknown as Polity).militarism, 0.9);
});

test('needs rise with what drives them and stay within 0–1', () => {
  // Threat: only from a neighbour believed stronger and disliked, the more the stronger and the more disliked.
  assert.equal(threatOf(0.8, -80), 0, 'a weaker neighbour is no threat');
  assert.equal(threatOf(NEED_TUNING.threatScale, -NEED_TUNING.hostileAt), 1, 'one twice as strong and disliked enough threatens fully');
  assert.ok(threatOf(1.5, -40) > threatOf(1.5, -10), 'dislike raises it');
  assert.equal(threatOf(5, 0), 0, 'an indifferent neighbour is no threat, however strong');
  assert.equal(threatOf(5, 40), 0, 'nor is a friend');
  assert.ok(threatOf(1.8, -30) > threatOf(1.2, -30));
  // Opportunity: a neighbour believed weaker or richer.
  assert.equal(chanceOf(1.2, 0.5), 0);
  assert.ok(chanceOf(0.3, 1) > chanceOf(0.8, 1) && chanceOf(1, 3) > chanceOf(1, 1));
  assert.ok(chanceOf(0, 100) <= 1);
  // Unrest: regions in unrest, or stability below the calm line.
  assert.equal(unrestOf(0, 0.9), 0);
  assert.ok(unrestOf(0, 0.5) > 0 && unrestOf(0.6, 0.9) === 0.6);
  // Friction: rival neighbours, by Zeal, less in the secular age.
  assert.equal(frictionOf(0.5, 0.8, 0), 0.4);
  assert.ok(frictionOf(0.5, 0.8, 0.5) < frictionOf(0.5, 0.8, 0));
  assert.equal(frictionOf(0, 1, 0), 0);
  // Infrastructure: towns its roads do not reach, hungry places without a granary, a coast without a harbor.
  const settlement = (entry: Partial<PolityView['build']['settlements'][number]>) => ({ id: 0, region: 0, name: 'A', tier: 1, urban: 100, housing: 100, hardship: 0, farmShare: 0.8, farmers: 100, stability: 0.9, frontier: 0, has: [] as number[], coast: false, water: false, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false, ...entry });
  const catalog = [{ type: 0, name: 'granary', one: 'a granary', many: 'granaries', purpose: 'food', cost: 1, upkeep: 1, minTier: 0, coast: false, water: false, perRegion: true, works: '' as const },
    { type: 11, name: 'harbor', one: 'a harbor', many: 'harbors', purpose: 'sea', cost: 1, upkeep: 1, minTier: 0, coast: true, water: false, perRegion: true, works: '' as const }];
  // A route is the road a region its roads do not reach would need, to its largest town there.
  const view = (settlements: ReturnType<typeof settlement>[], sea = 0, unreached: number[] = []) => ({ sea, build: { catalog, settlements, roads: { tier: 1, one: '', many: '', routes: unreached.map(id => ({ settlement: id })) } } }) as unknown as PolityView;
  const towns = [settlement({ id: 0, region: 0 }), settlement({ id: 1, region: 1 }), settlement({ id: 2, region: 1 }), settlement({ id: 3, region: 2, tier: 0 })];
  assert.equal(infrastructureNeed(view(towns)), 0);
  assert.equal(infrastructureNeed(view(towns, 0, [1])), 2 / 3, 'two of its three towns lie in a region its roads do not reach (villages do not count)');
  assert.equal(infrastructureNeed(view([settlement({ hardship: 0.5 }), settlement({ hardship: 0.5, has: [0] })])), 0.5, 'one hungry place without a granary');
  assert.equal(infrastructureNeed(view([settlement({ coast: true, seaLinks: 2 })], 1)), 1, 'a coast without a harbor once it could sail');
  assert.equal(infrastructureNeed(view([settlement({ coast: true, seaLinks: 0 })], 1)), 0, 'unless there is nowhere to sail to');
  assert.equal(infrastructureNeed(view([settlement({ coast: true, seaLinks: 2, has: [11] })], 1)), 0);
});

test('a threatened realm looks for shelter in a larger realm it likes, not in the one it fears', () => {
  const neighbour = (opinion: number): Neighbour => ({ civ: 7, name: 'Ora', kin: false, similarity: 0.7, knownRegions: 60, believedPeople: 150_000, confidence: 0.5, opinion, fed: 1, stability: 0.9, crossingKm: 400, border: 3 });
  // It fears civilization 9 (or, in the last case, civilization 7 itself).
  const view = (threat: number, from = 9) => ({
    id: 1, tick: 1200, values: { militarism: 0.5, zeal: 0.5, openness: 0.5, tradition: 0.5, expansionism: 0.5 }, people: 10_000, regions: 4, hunger: 0, unrestShare: 0, stability: 0.9,
    needs: { hunger: 0, landPressure: 0, shortage: 0, threat, unrest: 0, friction: 0, opportunity: 0, grievance: 0, infrastructure: 0 }, threats: threat > 0 ? [{ civ: from, threat }] : [], raided: 0,
  }) as unknown as PolityView;
  const pull = (option: Option) => option.factors.find(entry => entry.factor === 'threat')!.weight;
  assert.ok(unionScore(view(0.8), neighbour(40)).score > unionScore(view(0), neighbour(40)).score, 'threat draws it to a liked realm');
  assert.ok(pull(unionScore(view(0.8), neighbour(80))) > pull(unionScore(view(0.8), neighbour(20))), 'the better liked, the more');
  assert.equal(pull(unionScore(view(0.8), neighbour(0))), 0, 'not to an indifferent one');
  assert.equal(pull(unionScore(view(0.8), neighbour(-60))), 0, 'nor to one it dislikes');
  assert.equal(pull(unionScore(view(0.8, 7), neighbour(40))), 0, 'never into the one it fears');
  assert.equal(pull(unionScore(view(0), neighbour(40))), 0, 'no threat, no pull');
});

test('a decision logs at least two causes whenever two or more factors are nonzero', () => {
  const option = (factors: [string, number][]): Option => ({ action: 'expand', score: 0.3, target: 1, label: null, factors: factors.map(([factor, weight]) => ({ factor, weight })) });
  assert.deepEqual(reasonsFor(option([['landPressure', 0.3], ['hunger', 0.1], ['distance', -0.05]])).map(entry => entry.factor), ['landPressure', 'hunger'], 'what drove it');
  assert.deepEqual(reasonsFor(option([['landPressure', 0.3], ['distance', -0.05], ['governanceReach', -0.2]])), [{ factor: 'landPressure', weight: 0.3 }, { factor: 'governanceReach', weight: -0.2 }], 'one drove it: the strongest that held it back too');
  assert.deepEqual(reasonsFor(option([['contentment', 0.08]])).length, 1, 'a single factor is a single cause');
  assert.deepEqual(reasonsFor(option([['distance', -0.1], ['governanceReach', -0.3]])).map(entry => entry.factor), ['governanceReach', 'distance'], 'with nothing driving it, what weighed most');
  assert.deepEqual(reasonsFor(option([['landPressure', 0.3], ['×landValue', 0.9]])).length, 1, 'multipliers are not causes');
});
