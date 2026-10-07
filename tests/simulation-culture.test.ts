import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { ancestry, cultureYear, divergence, foundCulture, heartOf, lineOf, liveYear, pullMeasures, pullTarget } from '../src/simulation/culture.ts';
import { createLanguage, createName, descendName, mutateLanguage, nameStem } from '../src/simulation/names.ts';
import { describeEvent } from '../src/observer/events.ts';
import { createRng, systemStream } from '../src/simulation/rng.ts';
import { VALUE_KEYS, type Culture, type CultureValues, type Polity, type PopulationGroup, type SimulationState, type TickContext } from '../src/simulation/state.ts';
import { CULTURE_PULLS, CULTURE_TUNING, NAME_TUNING } from '../src/simulation/tunables.ts';

const flat = (value: number): CultureValues => ({ militarism: value, zeal: value, openness: value, tradition: value, expansionism: value });

test('a daughter culture keeps its parent\'s first syllable, and its language changes only a few sounds', () => {
  for (let seed = 0; seed < 300; seed++) {
    const rng = createRng(seed, 0, 0x7e57);
    const language = createLanguage(rng), parent = createName(rng, language);
    const daughter = mutateLanguage(rng, language, CULTURE_TUNING.languageChanges), child = descendName(rng, parent, daughter);
    const stem = nameStem(parent);
    assert.ok(stem.length >= 2, `${parent} has a first syllable`);
    assert.ok(child.toLowerCase().startsWith(stem), `${child} descends from ${parent}`);
    assert.notEqual(child, parent);
    assert.ok(child.length >= NAME_TUNING.minLength && child.length <= NAME_TUNING.maxLength + 4, `${child} is a name`);
    assert.equal(child[0], child[0].toUpperCase());
    let changed = 0;
    for (const kind of ['initials', 'consonants', 'vowels', 'codas'] as const) {
      assert.equal(daughter[kind].length, language[kind].length, 'as many sounds of each kind');
      changed += daughter[kind].filter(sound => !language[kind].includes(sound)).length;
    }
    assert.ok(changed <= CULTURE_TUNING.languageChanges, 'a few sounds changed');
  }
  // Kin share a first syllable, never a name: sixty daughters of one people all differ, and from every name in use.
  const rng = createRng(9, 0, 9), language = createLanguage(rng), taken = new Set(['vaelor']);
  for (let child = 0; child < 60; child++) {
    const name = descendName(rng, 'Vaelor', mutateLanguage(rng, language, 2), taken);
    assert.ok(!taken.has(name.toLowerCase()) && name.toLowerCase().startsWith('vael'), `${name} is new and descends`);
    taken.add(name.toLowerCase());
  }
  assert.equal(nameStem('Vaelor'), 'vael');
  assert.equal(nameStem('Brikath'), 'brik');
  assert.equal(nameStem('Ana'), 'an');
  assert.equal(nameStem('Shou'), 'shou');
});

test('ancestry gives each starting people\'s share in a culture, summing to 1, through splits and hybrids', () => {
  const culture = (id: number, parents: { id: number; weight: number }[]) => ({ id, name: `C${id}`, parents, origin: parents.length ? 'split' : 'founding' }) as unknown as Culture;
  const state = { cultures: [culture(0, []), culture(1, []), culture(2, [{ id: 0, weight: 1 }]), culture(3, [{ id: 2, weight: 0.6 }, { id: 1, weight: 0.4 }]), culture(4, [{ id: 3, weight: 1 }]), culture(5, [{ id: 4, weight: 0.5 }, { id: 2, weight: 0.5 }])] } as unknown as SimulationState;
  assert.deepEqual(ancestry(state, 0), [{ id: 0, share: 1 }], 'a starting people descends from itself');
  assert.deepEqual(ancestry(state, 4).map(entry => entry.id), [0, 1]);
  assert.ok(Math.abs(ancestry(state, 4)[0].share - 0.6) < 1e-12 && Math.abs(ancestry(state, 4)[1].share - 0.4) < 1e-12);
  // Two paths back to the same people add up.
  const five = ancestry(state, 5);
  assert.ok(Math.abs(five[0].share - 0.8) < 1e-12 && five[0].id === 0 && Math.abs(five[1].share - 0.2) < 1e-12);
  for (let id = 0; id < state.cultures.length; id++) assert.ok(Math.abs(ancestry(state, id).reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-12);
  assert.deepEqual(lineOf(state, 4, 8).map(entry => entry.id), [3, 2, 0], 'the line follows the heaviest parent');
  assert.deepEqual(lineOf(state, 4, 2).map(entry => entry.id), [3, 2]);
});

/**
 * Test fixture: one civilization holding a strip of `count` regions (0 – 1 – … ), one group of 10,000 in each, all
 * of one culture, with its heartland in region 0; regions are mild, inland and uncrowded unless a test says otherwise.
 * Only what the culture rules read is filled in.
 */
function strip(count = 6) {
  const regions = Array.from({ length: count }, (_, id) => ({
    id, coastal: false, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other < count).map(region => ({ region, travelKm: 100, riverTier: 0 })),
  }));
  const state = {
    tick: 0, partition: { regions }, occupant: new Int32Array(count).fill(-1), groupAt: new Int32Array(count).fill(-1), owner: new Int32Array(count).fill(-1),
    regionSettlements: regions.map(() => [] as number[]), settlements: [], wonders: [], harshness: new Float64Array(count), hardship: new Float64Array(count), habitable: new Uint8Array(count).fill(1),
    capacity: new Float64Array(count).fill(40_000), remoteness: Float64Array.from(regions, region => region.id * 0.5), remoteOwner: new Int32Array(count),
    cultures: [] as Culture[], polities: [] as Polity[], groups: [] as PopulationGroup[], living: [] as number[],
    metrics: { cultureSplits: 0, civCultureSplits: 0 }, chronicle: new Chronicle(),
  } as unknown as SimulationState;
  const culture = foundCulture(state, createRng(1, 0, 1), 'founding', null, flat(0.5), 40);
  const polity = { id: 0, kind: 'civ', name: 'Kesh', culture: culture.id, groups: [] as number[], core: 0, knowledge: { sea: 0, era: 2 }, deathTick: null } as unknown as Polity;
  state.polities.push(polity); state.living.push(0);
  for (const region of regions) {
    const group = { id: region.id, polity: 0, culture: culture.id, region: region.id, size: 10_000, values: flat(0.5), deathTick: null } as unknown as PopulationGroup;
    state.groups.push(group); polity.groups.push(group.id);
    state.occupant[region.id] = 0; state.groupAt[region.id] = group.id; state.owner[region.id] = 0;
  }
  const context = (tick: number): TickContext => ({ tick, year: Math.floor(tick / 12), month: tick % 12, stream: (entity, salt) => systemStream(7, tick, 4, entity, salt) });
  return { state, polity, culture, context };
}

test('conditions pull a people\'s values: harsh land toward Tradition, a frontier toward Militarism, towns and a sailable coast toward Openness', () => {
  const { state, polity } = strip(3);
  const middle = state.groups[1], calm = pullTarget(pullMeasures(state, polity, middle));
  for (const key of VALUE_KEYS) assert.ok(calm[key] >= CULTURE_PULLS[key].base - 1e-12, `${key} rests at its base or above`);
  state.harshness[1] = 1;
  assert.ok(pullTarget(pullMeasures(state, polity, middle)).tradition > calm.tradition + 0.4, 'harsh land');
  // Another people beside it: half its neighbours are foreign.
  state.occupant[2] = 9;
  assert.ok(Math.abs(pullMeasures(state, polity, middle).frontier - 0.5) < 1e-12);
  assert.ok(pullTarget(pullMeasures(state, polity, middle)).militarism > calm.militarism, 'a frontier');
  // Empty land beside it that could feed people: a frontier of opportunity.
  state.occupant[0] = -1;
  assert.ok(Math.abs(pullMeasures(state, polity, middle).openLand - 0.5) < 1e-12);
  assert.ok(pullTarget(pullMeasures(state, polity, middle)).expansionism > calm.expansionism, 'open land');
  state.hardship[1] = 1;
  assert.ok(pullTarget(pullMeasures(state, polity, middle)).zeal > calm.zeal + 0.4, 'the memory of hunger');
  state.partition.regions[1].coastal = true;
  assert.equal(pullMeasures(state, polity, middle).townsAndSea, 0, 'a coast it cannot sail from is no opening');
  (polity.knowledge as { sea: number }).sea = 1;
  assert.ok(pullTarget(pullMeasures(state, polity, middle)).openness > calm.openness, 'a coast it sails from');
});

test('a people blends toward its neighbours and its heartland, a prestigious neighbour pulls harder, and conditions pull slowly', () => {
  const { state, polity } = strip(3);
  state.groups[0].values = flat(0.7);
  const middle = state.groups[1], prestige = (_: number) => 1;
  liveYear(state, middle, prestige);
  const moved = middle.values.zeal - 0.5;
  assert.ok(moved > 0 && moved < CULTURE_TUNING.influenceRate * 0.2 + 1e-9, 'toward the heartland next door, a little each year');
  // A people far apart hardly sways it: beyond `confidence` only its heartland's pull is left.
  const apart = strip(3);
  apart.state.groups[2].values = flat(0.95); apart.state.groups[0].values = flat(0.5);
  liveYear(apart.state, apart.state.groups[1], prestige);
  assert.ok(apart.state.groups[1].values.zeal < 0.5, 'its far-apart neighbour does not draw it (only its conditions do)');
  // A neighbour of another, far more prestigious people pulls harder than one of a people as prestigious as its own.
  const other = strip(3), foreign = other.state.groups[2];
  other.state.groups[0].values = flat(0.5); foreign.values = flat(0.7); foreign.polity = 1;
  other.state.polities.push({ ...other.polity, id: 1, kind: 'civ', groups: [2], core: 2 } as unknown as Polity);
  other.polity.groups = [0, 1]; other.state.occupant[2] = 1;
  const equal = structuredClone(other.state.groups[1].values);
  liveYear(other.state, other.state.groups[1], () => 1);
  const pulledEqual = other.state.groups[1].values.zeal - equal.zeal;
  other.state.groups[1].values = flat(0.5);
  liveYear(other.state, other.state.groups[1], id => id === 1 ? 100 : 1);
  assert.ok(other.state.groups[1].values.zeal - 0.5 > pulledEqual, 'prestige pulls');
  // Alone, with nobody beside it and its heart far, conditions pull it slowly toward their target.
  const lone = strip(1);
  lone.state.groups[0].values = flat(0.9);
  liveYear(lone.state, lone.state.groups[0], () => 1);
  assert.ok(Math.abs(lone.state.groups[0].values.zeal - (0.9 + CULTURE_TUNING.driftRate * (CULTURE_PULLS.zeal.base - 0.9))) < 1e-12);
  void polity;
});

test('part of a culture grown apart from its heart splits off as a daughter culture; a smaller part does not', () => {
  const { state, polity, culture, context } = strip(6);
  // Regions 3–5 have grown more traditional and less open than the heartland.
  for (const region of [3, 4, 5]) state.groups[region].values = { ...flat(0.5), tradition: 0.9, openness: 0.1 };
  assert.ok(divergence(state.groups[5].values, state.groups[0].values) > CULTURE_TUNING.splitDivergence * 1.2);
  assert.equal(heartOf(state, culture, state.groups).id, polity.core, 'the heart is its realm\'s heartland');
  let year = 0;
  while (state.cultures.length === 1 && year < 400) { cultureYear(state, context(year * 12 + culture.id)); year++; }
  assert.equal(state.cultures.length, 2, 'it split');
  const child = state.cultures[1];
  assert.deepEqual(child.parents, [{ id: culture.id, weight: 1 }]);
  assert.equal(child.origin, 'split');
  assert.ok(child.name.toLowerCase().startsWith(nameStem(culture.name)), 'its name descends');
  assert.ok(Math.abs(((child.hue - culture.hue + 540) % 360) - 180) <= CULTURE_TUNING.hueShift + 1e-9, 'its colour lies near its parent\'s');
  assert.deepEqual(state.groups.filter(group => group.culture === child.id).map(group => group.region), [3, 4, 5]);
  assert.equal(polity.culture, culture.id, 'the realm\'s ruling culture is its heartland\'s');
  assert.equal(child.people, 30_000);
  assert.equal(state.metrics.cultureSplits, 1); assert.equal(state.metrics.civCultureSplits, 1);
  state.chronicle.flush(state.tick);
  const event = state.chronicle.events.find(entry => entry.type === 'cultureSplit')!;
  assert.equal(event.data.culture, child.name); assert.equal(event.data.parent, culture.name);
  assert.equal(event.data.more, 'tradition'); assert.equal(event.data.less, 'openness'); assert.equal(event.data.both, true);
  assert.equal(event.data.regions, 3);
  // Two regions apart are too few.
  const small = strip(6);
  for (const region of [4, 5]) small.state.groups[region].values = { ...flat(0.5), tradition: 0.9, openness: 0.1 };
  for (let at = 0; at < 50; at++) cultureYear(small.state, small.context(at * 12 + small.culture.id));
  assert.equal(small.state.cultures.length, 1);
});

test('a culture with nobody left dies and stays in history', () => {
  const { state, culture, context } = strip(2);
  const other = foundCulture(state, createRng(2, 0, 1), 'founding', null, flat(0.3), 100);
  cultureYear(state, context(other.id));
  assert.equal(other.deathTick, other.id, 'no group of it');
  assert.equal(culture.deathTick, null);
  assert.equal(state.cultures.length, 2);
});

test('the heartland pulls less the farther away a region lies, and another polity\'s people pull less than one\'s own', () => {
  const pulled = (remoteness: number) => {
    const { state } = strip(4);
    // Its neighbours think as it does, so only the heartland (region 0, not beside it) pulls it.
    state.groups[0].values = flat(0.7);
    state.remoteness[2] = remoteness;
    liveYear(state, state.groups[2], () => 1);
    return state.groups[2].values.zeal - (0.5 + CULTURE_TUNING.driftRate * (CULTURE_PULLS.zeal.base - 0.5));
  };
  assert.ok(pulled(0.5) > pulled(3) && pulled(3) > 0, 'nearer, stronger');
  const neighbour = (foreign: boolean) => {
    const { state, polity } = strip(3);
    state.groups[0].values = flat(0.5); state.groups[2].values = flat(0.6); state.remoteOwner[1] = -1;
    if (foreign) { state.groups[2].polity = 1; state.polities.push({ ...polity, id: 1, groups: [2], core: 2 } as unknown as Polity); state.occupant[2] = 1; polity.groups = [0, 1]; }
    liveYear(state, state.groups[1], () => 1);
    return state.groups[1].values.zeal;
  };
  assert.ok(neighbour(false) > neighbour(true), 'its own polity\'s people more');
});

test('a split that takes another polity\'s heartland makes the daughter that polity\'s ruling culture; a culture whose people all left dies', () => {
  const { state, polity, culture, context } = strip(6);
  // A second polity of the same culture holds regions 4 and 5, its heartland in 4.
  const other = { ...polity, id: 1, name: 'Ilu', groups: [4, 5], core: 4 } as unknown as Polity;
  state.polities.push(other); state.living.push(1); polity.groups = [0, 1, 2, 3];
  for (const region of [4, 5]) { state.groups[region].polity = 1; state.occupant[region] = 1; }
  for (const region of [3, 4, 5]) state.groups[region].values = { ...flat(0.5), tradition: 0.9, openness: 0.1 };
  let year = 0;
  while (state.cultures.length === 1 && year < 400) { cultureYear(state, context(year * 12 + culture.id)); year++; }
  const child = state.cultures[1];
  assert.equal(other.culture, child.id, 'its heartland\'s people are the daughter\'s');
  assert.equal(polity.culture, culture.id);
  assert.equal(state.metrics.civCultureSplits, 1, 'split from a culture that rules a civilization');
  assert.ok(culture.people === 30_000 && culture.regions === 3, 'the parent is counted without the part that left');
  state.chronicle.flush(state.tick);
  const text = describeEvent(state.chronicle.events.find(entry => entry.type === 'cultureSplit')!);
  assert.match(text, new RegExp(`In 3 regions of the (Kesh|Ilu) and beyond, 30,000 people have grown apart from the ${culture.name} and become the ${child.name}, with more tradition and less openness than their forebears\\.`));
  // The daughter's people all take up another culture: at its next yearly refresh it dies, and stays in history.
  for (const region of [3, 4, 5]) state.groups[region].culture = culture.id;
  other.culture = culture.id;
  cultureYear(state, context(Math.ceil(state.tick / 12) * 12 + 12 + child.id));
  assert.notEqual(child.deathTick, null);
  assert.ok(child.people === 0 && state.cultures.length === 2);
});
