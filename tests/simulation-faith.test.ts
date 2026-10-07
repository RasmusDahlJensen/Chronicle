import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeEvent } from '../src/observer/events.ts';
import { BUILDING_INDEX } from '../src/simulation/buildings.ts';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { pullTarget } from '../src/simulation/culture.ts';
import { bestWonder } from '../src/simulation/decisions/build.ts';
import { faithWealth } from '../src/simulation/economy.ts';
import type { PolityView } from '../src/simulation/perception.ts';
import { canFound, changeTenet, drawTenets, faithBurden, faithDraws, faithStats, faithYear, followRulers, foundingTrigger, foundReligion, realmFaith, refreshReligion, secularity, setGroupFaith } from '../src/simulation/faith.ts';
import { learn, researchWeight, startingKnowledge } from '../src/simulation/knowledge.ts';
import { createLanguage } from '../src/simulation/names.ts';
import { TENETS } from '../src/simulation/religions.ts';
import { createRng, systemStream } from '../src/simulation/rng.ts';
import type { Culture, CultureValues, Polity, PopulationGroup, SimulationState, TickContext } from '../src/simulation/state.ts';
import { ERAS, eraOf, TECH_INDEX, TECHS } from '../src/simulation/techs.ts';
import { FAITH_TUNING } from '../src/simulation/tunables.ts';
import type { Affinity } from '../src/simulation/techs.ts';

const flat = (value: number): CultureValues => ({ militarism: value, zeal: value, openness: value, tradition: value, expansionism: value });
const tenet = (key: string) => TENETS.findIndex(entry => entry.key === key);
const ORGANIZED = TECH_INDEX.get('Organized religion')!;

/**
 * Test fixture: a strip of `count` regions (0 – 1 – …), one group of 10,000 in each; regions 0 to `split − 1` belong
 * to the civilization Kesh (heartland and capital in region 0), the rest to the civilization Ilu (heartland at
 * `split`). All keep the folk ways. Only what the faith rules read is filled in.
 */
function world(count = 6, split = 3) {
  const regions = Array.from({ length: count }, (_, id) => ({ id, neighbors: [id - 1, id + 1].filter(other => other >= 0 && other < count).map(region => ({ region, travelKm: 100, riverTier: 0 })) }));
  const culture = { id: 0, name: 'Vael', language: createLanguage(createRng(1, 0, 1)), values: flat(0.5) } as unknown as Culture;
  const state = {
    tick: 0, partition: { regions }, groupAt: new Int32Array(count), occupant: new Int32Array(count), hardship: new Float64Array(count),
    regionSettlements: regions.map(() => [] as number[]), settlements: [] as unknown[], religions: [], cultures: [culture], famineRecent: new Float64Array(count),
    groups: [] as PopulationGroup[], polities: [] as Polity[], living: [0, 1],
    metrics: { religionsFounded: 0, conversions: 0, stateReligionChanges: 0, schisms: 0 }, chronicle: new Chronicle(),
  } as unknown as SimulationState;
  const polity = (id: number, name: string, core: number) => ({ id, kind: 'civ', name, culture: 0, groups: [] as number[], core, capital: null, stateReligion: -1, knowledge: startingKnowledge() }) as unknown as Polity;
  state.polities.push(polity(0, 'Kesh', 0), polity(1, 'Ilu', split));
  for (const region of regions) {
    const owner = region.id < split ? 0 : 1;
    state.groups.push({ id: region.id, polity: owner, culture: 0, region: region.id, size: 10_000, values: flat(0.5), faith: -1, faithApart: 0, deathTick: null } as unknown as PopulationGroup);
    state.polities[owner].groups.push(region.id);
    state.groupAt[region.id] = region.id; state.occupant[region.id] = owner;
  }
  const context = (tick: number): TickContext => ({ tick, year: Math.floor(tick / 12), month: tick % 12, stream: (entity, salt) => systemStream(5, tick, 4, entity, salt) });
  return { state, kesh: state.polities[0], ilu: state.polities[1], context };
}

test('a religion draws two to four tenets, never two that exclude each other, weighted by its founders\' values', () => {
  let zealousProselytizing = 0, calmProselytizing = 0;
  for (let seed = 0; seed < 400; seed++) {
    const rng = createRng(seed, 0, 0xfa);
    for (const [values, count] of [[{ ...flat(0.5), zeal: 0.95 }, 'zealous'], [{ ...flat(0.5), zeal: 0.05 }, 'calm']] as const) {
      const tenets = drawTenets(rng, values);
      assert.ok(tenets.length >= FAITH_TUNING.minTenets && tenets.length <= FAITH_TUNING.maxTenets);
      assert.equal(new Set(tenets).size, tenets.length);
      for (const at of tenets) for (const other of tenets) assert.ok(!TENETS[at].excludes?.includes(TENETS[other].key), `${TENETS[at].key} with ${TENETS[other].key}`);
      if (tenets.includes(tenet('proselytizing'))) { if (count === 'zealous') zealousProselytizing++; else calmProselytizing++; }
    }
  }
  assert.ok(zealousProselytizing > calmProselytizing * 1.5, `zealous founders preach more (${zealousProselytizing} against ${calmProselytizing})`);
});

test('a realm that knows Organized religion founds a religion when a crisis or zeal moves it; its heartland follows it as the state religion', () => {
  const { state, kesh, context } = world();
  assert.equal(canFound(kesh), false);
  for (let year = 0; year < 200; year++) realmFaith(state, context(year * 12), kesh);
  assert.equal(state.religions.length, 0, 'without the knowledge, never');
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  assert.equal(canFound(kesh), true);
  state.groups[0].values = { ...flat(0.5), zeal: FAITH_TUNING.zealFloor };
  assert.equal(foundingTrigger(state, kesh).trigger, 0, 'a calm people without zeal is not moved');
  state.groups[0].values = { ...flat(0.5), zeal: 0.9 };
  assert.ok(Math.abs(foundingTrigger(state, kesh).zealous - (0.9 - FAITH_TUNING.zealFloor) / (1 - FAITH_TUNING.zealFloor)) < 1e-12, 'a zealous people is');
  state.famineRecent[1] = 150;
  assert.ok(Math.abs(foundingTrigger(state, kesh).crisis - Math.min(1, FAITH_TUNING.crisisScale * 150 / 30_000)) < 1e-12, 'and so is one in a famine');
  let year = 0;
  while (!state.religions.length && year < 2_000) { realmFaith(state, context(year * 12), kesh); year++; }
  const religion = state.religions[0];
  assert.ok(religion, 'in time it founds one');
  assert.equal(religion.founder, kesh.id); assert.equal(religion.holyRegion, 0); assert.equal(religion.parent, null);
  assert.equal(state.groups[0].faith, religion.id); assert.equal(kesh.stateReligion, religion.id);
  assert.equal(state.groups[1].faith, -1, 'its other peoples keep the folk ways for now');
  assert.equal(state.metrics.religionsFounded, 1);
  // A realm whose rulers follow a religion founds another (a reformation) only rarely: its attachment lowers the chance.
  let reformed = year;
  while (state.religions.length < 2 && reformed < year + 20_000) { realmFaith(state, context(reformed * 12), kesh); reformed++; }
  assert.equal(state.religions.length, 2, 'in time, a reformation');
  assert.equal(kesh.stateReligion, 1);
  state.chronicle.flush(state.tick);
  const event = state.chronicle.events.find(entry => entry.type === 'religionFounded')!;
  assert.equal(describeEvent(event), `In region 0, the Kesh found the ${religion.name} faith (${religion.tenets.map(at => TENETS[at].name).join(', ')}).`);
  assert.ok(event.causes.length > 0);
  const reformation = state.chronicle.events.filter(entry => entry.type === 'religionFounded')[1];
  assert.ok(describeEvent(reformation).endsWith(`, in place of the ${religion.name} faith.`), describeEvent(reformation));
});

test('a people is drawn to its neighbours\' religions (another realm\'s less), to its state religion (more with a shrine) and to holy land', () => {
  const { state, kesh, context } = world();
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  const religion = foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  // Region 1 lies beside the holy land (region 0), whose people follow it, and is in Kesh, whose state religion it is.
  assert.deepEqual(faithDraws(state, state.groups[1]).get(religion.id), { neighbours: 1 / 2, stateSupport: FAITH_TUNING.stateSupport, shrine: 0, holyLand: FAITH_TUNING.holyDraw });
  state.settlements.push({ status: 'alive', buildings: [{ type: BUILDING_INDEX.get('shrine')!, condition: 1 }] } as never); state.regionSettlements[1].push(0);
  assert.equal(faithDraws(state, state.groups[1]).get(religion.id)!.shrine, FAITH_TUNING.templeSupport, 'a shrine adds');
  // Region 3 is Ilu's heartland: its neighbour in Kesh (region 2) follows the folk ways, so nothing draws it yet.
  assert.equal(faithDraws(state, state.groups[3]).size, 0);
  setGroupFaith(state, state.groups[2], religion.id);
  assert.equal(faithDraws(state, state.groups[3]).get(religion.id)!.neighbours, FAITH_TUNING.foreignContact / 2, 'another realm\'s people draw less');
  assert.equal(faithDraws(state, state.groups[0]).has(religion.id), false, 'its own faith draws nothing');
  // Conversion: a traditional people, or one already of a religion, is slower (counted over the same draws, on a copy
  // of Ilu's heartland people that is not its heartland).
  const taken = (values: CultureValues, faith: number) => {
    let count = 0;
    for (let seed = 0; seed < 3_000; seed++) {
      const copy = { ...state.groups[3], values, faith, id: 99 } as PopulationGroup;
      const drawn = faithDraws(state, copy);
      if (drawn.size && faithYear({ ...state, polities: [state.polities[0], { ...state.polities[1], core: 98 }] } as unknown as SimulationState, createRng(seed, 0, 8), copy)) count++;
    }
    return count;
  };
  assert.ok(taken({ ...flat(0.5), tradition: 0.9 }, -1) < taken({ ...flat(0.5), tradition: 0.1 }, -1), 'Tradition holds a people to its ways');
  assert.ok(taken(flat(0.5), 99) < taken(flat(0.5), -1), 'a people of another religion is slower');
  let year = 0;
  while (state.groups[3].faith < 0 && year < 5_000) { faithYear(state, createRng(year, 0, 7), state.groups[3]); year++; }
  assert.equal(state.groups[3].faith, religion.id, 'in time Ilu\'s heartland takes it up');
  assert.equal(state.polities[1].stateReligion, religion.id, 'and so Ilu\'s rulers: it is their state religion');
  assert.equal(state.metrics.stateReligionChanges, 1);
  state.chronicle.flush(state.tick);
  assert.equal(describeEvent(state.chronicle.events.find(entry => entry.type === 'stateReligionChanged')!), `The Ilu take up the ${religion.name} faith as their state religion.`);
});

test('peoples of another faith under a state religion are less settled, less so under a tolerant one; an ascetic faith steadies its followers', () => {
  const { state, kesh, context } = world();
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  const religion = foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  religion.tenets = [tenet('proselytizing'), tenet('holyWar')];
  const other = state.groups[1];
  assert.ok(Math.abs(faithBurden(state, kesh, other) - FAITH_TUNING.friction * 1) < 1e-12, 'the folk ways under a state religion');
  other.values = { ...flat(0.5), zeal: 0.9 };
  assert.ok(faithBurden(state, kesh, other) > FAITH_TUNING.friction, 'zealous peoples more');
  religion.tenets = [tenet('tolerance')];
  assert.ok(Math.abs(faithBurden(state, kesh, other) - FAITH_TUNING.friction * 1.4 * (TENETS[tenet('tolerance')].friction ?? 1)) < 1e-12, 'a tolerant state religion less');
  assert.equal(faithBurden(state, kesh, state.groups[0]), 0, 'its own followers feel none');
  religion.tenets = [tenet('asceticism')];
  assert.ok(faithBurden(state, kesh, state.groups[0]) < 0, 'an ascetic faith steadies');
  assert.equal(faithBurden(state, state.polities[1], state.groups[4]), 0, 'a realm of the folk ways presses no faith');
});

test('a realm returns to the folk ways when its heartland does; a religion with no followers dies; the stats count followers and realms', () => {
  const { state, kesh, ilu, context } = world();
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  const religion = foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  setGroupFaith(state, state.groups[4], religion.id);
  assert.equal(ilu.stateReligion, -1, 'a people that is not the heartland does not change its realm\'s faith');
  assert.deepEqual(faithStats(state), { religions: 1, faithShare: 2 / 6, religionMaxCivs: 2, stateReligions: 1, secularCivs: 0 });
  setGroupFaith(state, state.groups[0], -1);
  assert.equal(kesh.stateReligion, -1);
  state.chronicle.flush(state.tick);
  assert.equal(describeEvent(state.chronicle.events.find(entry => entry.type === 'stateReligionChanged' && entry.data.folk === true)!), `The Kesh return to the folk ways of their forebears, leaving the ${religion.name} faith.`);
  setGroupFaith(state, state.groups[4], -1);
  refreshReligion(state, context(24), religion, []);
  assert.equal(religion.deathTick, 24);
  // A heartland that moves takes its faith along as the realm's.
  setGroupFaith(state, state.groups[1], religion.id); religion.deathTick = null;
  kesh.core = 1; followRulers(state, kesh, 'heartlandMoved');
  assert.equal(kesh.stateReligion, religion.id);
});

test('tenets pull their followers\' values, and zealous peoples weigh religious techs more, which need only Writing', () => {
  const measured = { harshLand: 0, frontier: 0, townsAndSea: 0, hardship: 0, openLand: 0 };
  assert.ok(Math.abs(pullTarget(measured, [], [tenet('pacifism')]).militarism - pullTarget(measured).militarism - (TENETS[tenet('pacifism')].pulls.militarism ?? 0)) < 1e-12);
  assert.deepEqual(TECHS[ORGANIZED].requires, ['Writing']);
  const base = { affinity: new Map<Affinity, number>(), foodNeed: 0, tradition: 0.5, openness: 0.5, zeal: 0.5, secularity: 0, shared: () => false, frontier: 1, blocked: new Set<number>(), rate: 3 };
  assert.ok(researchWeight(ORGANIZED, { ...base, zeal: 0.9 }) > researchWeight(ORGANIZED, base) && researchWeight(ORGANIZED, base) > researchWeight(ORGANIZED, { ...base, zeal: 0.1 }));
  const writing = TECH_INDEX.get('Writing')!;
  assert.equal(researchWeight(writing, { ...base, zeal: 0.9 }), researchWeight(writing, base), 'other techs are not');
});

test('a people passes through each age: knowing a later era\'s tech early does not label it that era', () => {
  let knowledge = startingKnowledge();
  for (const name of ['Pottery', 'Agriculture', 'Writing', 'Organized religion']) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  assert.equal(ERAS[eraOf(knowledge.known)], 'Bronze', 'priests without iron are not yet Classical');
  for (const name of ['Masonry', 'Mining', 'Copper working', 'Bronze working', 'Iron working']) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  assert.equal(ERAS[eraOf(knowledge.known)], 'Classical', 'once it knows an Iron tech, Organized religion makes it Classical');
});

test('a state religion of Monument builders raises shrines, temples and wonders; an ascetic faith\'s followers produce less wealth', () => {
  const { state, kesh, context } = world();
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  const religion = foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  religion.tenets = [tenet('monumentBuilders'), tenet('asceticism')];
  assert.equal(faithWealth(state, 0), FAITH_TUNING.asceticWealth, 'its followers');
  assert.equal(faithWealth(state, 1), 1, 'not the folk ways');
  const wonder = (monuments: number) => bestWonder({
    values: flat(0.5), budget: { rate: 0.2, output: 10_000_000, sites: 0, costs: 0, treasury: 50_000_000, revenue: 2_000_000, surplus: 2_000_000, strain: 0, tradition: 0.5, calm: 0.9 },
    build: { monuments, piety: 1, regions: 10, catalog: [], stability: 0.95, wonders: [{ type: 0, name: 'the Pyramids', motive: 'piety', cost: 100_000, months: 120, upkeep: 0, minTier: 1, coast: false }],
      settlements: [{ id: 1, region: 0, name: 'Kesh', tier: 2, urban: 20_000, housing: 20_000, hardship: 0, farmShare: 1, stability: 0.95, frontier: 0, has: [], coast: false, water: true, seaLinks: 0, mineYield: 0, quarryYield: 0, wonder: false }] },
  } as unknown as PolityView)!;
  assert.ok(wonder(FAITH_TUNING.monumentWeight).factors.some(entry => entry.factor.includes('monumentBuilders')));
  assert.ok(wonder(FAITH_TUNING.monumentWeight).score > wonder(1).score, 'a wonder weighs more');
});

test('followers long cut off from their religion\'s main body become a sect with one tenet changed; a small or recent part does not', () => {
  const { state, kesh, ilu, context } = world(9, 4);
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  const religion = foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  religion.tenets = [tenet('proselytizing'), tenet('pacifism')];
  // Regions 0–1 (Kesh, around the holy land) and 5–8 (Ilu, with its heartland in 4 keeping the folk ways... until it
  // too follows) follow it; region 2–4 between them keep the folk ways, so Ilu's followers are cut off.
  for (const region of [1, 5, 6, 7, 8]) setGroupFaith(state, state.groups[region], religion.id);
  const followers = () => state.groups.filter(group => group.faith === religion.id);
  for (let year = 1; year <= FAITH_TUNING.schismYears / 2; year++) refreshReligion(state, context(year * 12), religion, followers());
  assert.equal(state.religions.length, 1, 'not before they have been apart half the years');
  assert.equal(state.groups[1].faithApart, 0, 'the main body is not apart');
  assert.equal(state.groups[6].faithApart, FAITH_TUNING.schismYears / 2);
  let year = FAITH_TUNING.schismYears / 2 + 1;
  while (state.religions.length === 1 && year < 5_000) { refreshReligion(state, context(year * 12), religion, followers()); year++; }
  const sect = state.religions[1];
  assert.equal(sect.parent, religion.id);
  assert.deepEqual(state.groups.filter(group => group.faith === sect.id).map(group => group.region), [5, 6, 7, 8]);
  assert.deepEqual(state.groups.filter(group => group.faith === religion.id).map(group => group.region), [0, 1]);
  const changed = sect.tenets.filter(at => !religion.tenets.includes(at)).length + religion.tenets.filter(at => !sect.tenets.includes(at)).length;
  assert.ok(changed >= 1 && changed <= 2, 'one tenet changed');
  for (const at of sect.tenets) for (const other of sect.tenets) assert.ok(!TENETS[at].excludes?.includes(TENETS[other].key));
  assert.ok(sect.name.toLowerCase().startsWith(religion.name.toLowerCase().slice(0, 2)), `${sect.name} descends from ${religion.name}`);
  assert.equal(ilu.stateReligion, -1, 'Ilu\'s heartland (region 4) keeps the folk ways');
  assert.equal(state.metrics.schisms, 1);
  state.chronicle.flush(state.tick);
  assert.match(describeEvent(state.chronicle.events.find(entry => entry.type === 'schism')!), new RegExp(`^In 4 regions, the followers of the ${religion.name} faith, long cut off from its holy land, become the ${sect.name} faith`));
  // The schism comes before the realm's change of state religion it may bring; a people that changes faith starts its
  // years apart afresh.
  const types = state.chronicle.events.map(entry => entry.type);
  assert.ok(types.indexOf('schism') >= 0);
  const convert = state.groups[7];
  convert.faithApart = 120; setGroupFaith(state, convert, religion.id);
  assert.equal(convert.faithApart, 0);
  // Followers in one realm are in contact even when its regions do not touch: an enclave of the founding realm is not cut off.
  const enclave = world(9, 4);
  enclave.kesh.knowledge = learn(enclave.kesh.knowledge, ORGANIZED);
  const faith = foundReligion(enclave.state, enclave.context(0), createRng(5, 0, 5), enclave.kesh, { crisis: 1, zealous: 0 });
  for (const region of [6, 7, 8]) { const group = enclave.state.groups[region]; group.polity = 0; enclave.kesh.groups.push(group.id); enclave.ilu.groups.splice(enclave.ilu.groups.indexOf(group.id), 1); setGroupFaith(enclave.state, group, faith.id); }
  for (let at = 1; at < 1_000; at++) refreshReligion(enclave.state, enclave.context(at * 12), faith, enclave.state.groups.filter(group => group.faith === faith.id));
  assert.equal(enclave.state.religions.length, 1, 'no sect within its own realm');
  assert.equal(enclave.state.groups[7].faithApart, 0);
  // Two regions apart are too few.
  const small = world(9, 4);
  small.kesh.knowledge = learn(small.kesh.knowledge, ORGANIZED);
  const other = foundReligion(small.state, small.context(0), createRng(4, 0, 4), small.kesh, { crisis: 1, zealous: 0 });
  for (const region of [7, 8]) setGroupFaith(small.state, small.state.groups[region], other.id);
  for (let at = 1; at < 1_000; at++) refreshReligion(small.state, small.context(at * 12), other, small.state.groups.filter(group => group.faith === other.id));
  assert.equal(small.state.religions.length, 1);
});

test('a changed tenet never brings in one its others exclude', () => {
  for (let seed = 0; seed < 300; seed++) {
    const rng = createRng(seed, 0, 0x5c);
    const before = drawTenets(rng, { ...flat(0.5), militarism: rng.next(), openness: rng.next() });
    const after = changeTenet(rng, before).tenets;
    assert.ok(after.length >= 1);
    for (const at of after) for (const other of after) assert.ok(!TENETS[at].excludes?.includes(TENETS[other].key), `${TENETS[at].key} with ${TENETS[other].key}`);
  }
});

test('in the secular age, faith unsettles less, zeal weighs less in research and building, and religions are founded less', () => {
  const { state, kesh, context } = world();
  kesh.knowledge = learn(kesh.knowledge, ORGANIZED);
  foundReligion(state, context(0), createRng(3, 0, 3), kesh, { crisis: 1, zealous: 0 });
  assert.equal(secularity(kesh), 0);
  const before = faithBurden(state, kesh, state.groups[1]);
  // Gradually, tech by tech of the Early modern era and later.
  const modern = TECHS.map((definition, index) => ({ definition, index })).filter(({ definition }) => ERAS.indexOf(definition.era) >= ERAS.indexOf('Early modern'));
  for (const { index } of modern.slice(0, 4)) kesh.knowledge = learn(kesh.knowledge, index);
  assert.ok(Math.abs(secularity(kesh) - 4 * FAITH_TUNING.secularPerTech) < 1e-12);
  assert.ok(Math.abs(faithBurden(state, kesh, state.groups[1]) - before * (1 - secularity(kesh))) < 1e-12, 'friction fades');
  for (const { index } of modern) kesh.knowledge = learn(kesh.knowledge, index);
  assert.equal(secularity(kesh), FAITH_TUNING.secularMax, 'never wholly');
  const base = { affinity: new Map<Affinity, number>(), foodNeed: 0, tradition: 0.5, openness: 0.5, zeal: 0.9, secularity: 0, shared: () => false, frontier: 1, blocked: new Set<number>(), rate: 3 };
  const plain = researchWeight(ORGANIZED, { ...base, zeal: 1 - FAITH_TUNING.religionZealBase });
  assert.ok(researchWeight(ORGANIZED, base) > researchWeight(ORGANIZED, { ...base, secularity: 0.8 }) && researchWeight(ORGANIZED, { ...base, secularity: 0.8 }) > plain, 'zeal weighs less in research');
  // Founding: a secular realm of the folk ways founds less often (counted over the same years).
  const founded = (secular: boolean) => {
    let count = 0;
    for (let seed = 0; seed < 400; seed++) {
      const fresh = world();
      fresh.kesh.knowledge = learn(fresh.kesh.knowledge, ORGANIZED);
      if (secular) for (const { index } of modern) fresh.kesh.knowledge = learn(fresh.kesh.knowledge, index);
      fresh.state.groups[0].values = { ...flat(0.5), zeal: 1 };
      realmFaith(fresh.state, fresh.context(seed * 12), fresh.kesh);
      count += fresh.state.religions.length;
    }
    return count;
  };
  assert.ok(founded(true) < founded(false), 'religions are founded less');
});
