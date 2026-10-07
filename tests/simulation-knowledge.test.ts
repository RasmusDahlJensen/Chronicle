import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { RESOURCE_RULES } from '../src/world/resources.ts';
import { depositState, validateTechData } from '../src/simulation/deposits.ts';
import { ERA_NAMES } from '../shared/simulation.ts';
import { ERA_COLORS, lineageColor, packColor, polityColor } from '../src/observer/palettes.ts';
import { advance, availableTechs, catchUp, chooseTarget, inheritKnowledge, knows, learn, mergeKnowledge, newTechs, remaining, researchWeight, shareSpeed, speedOf, startingKnowledge } from '../src/simulation/knowledge.ts';
import { researchPeople } from '../src/simulation/research.ts';
import { RESEARCH_TUNING } from '../src/simulation/tunables.ts';
import { createRng } from '../src/simulation/rng.ts';
import { type Affinity, ERAS, TECH_INDEX, TECHS, validateTechs } from '../src/simulation/techs.ts';

test('every RESOURCE_RULES extraction technology exists in the tech data under exactly that name', () => {
  for (const [resource, rule] of Object.entries(RESOURCE_RULES)) {
    assert.ok(TECH_INDEX.has(rule.extractionTechnology), `${resource} needs "${rule.extractionTechnology}"`);
  }
  assert.doesNotThrow(() => validateTechs(Object.values(RESOURCE_RULES).map(rule => rule.extractionTechnology)));
  assert.throws(() => validateTechs(['Alchemy']), /exactly "Alchemy"/, 'a renamed or missing extraction tech fails startup');
});

test('the graph runs from Stone to Atomic with 60–80 techs, valid prerequisites and the VISION.md starter techs', () => {
  assert.ok(TECHS.length >= 60 && TECHS.length <= 80, `${TECHS.length} techs`);
  assert.deepEqual([...ERAS], [...ERA_NAMES], 'the tech data uses the contract\'s era names');
  assert.equal(ERA_COLORS.length, ERA_NAMES.length, 'every era has a map colour');
  assert.doesNotThrow(validateTechData, 'extraction effects match RESOURCE_RULES');
  for (const era of ERAS) assert.ok(TECHS.some(definition => definition.era === era), `no ${era} tech`);
  for (const name of ['Pottery', 'Agriculture', 'Animal husbandry', 'Boatbuilding', 'Masonry', 'Mining', 'Copper working', 'Bronze working', 'Writing', 'Wheel',
    'Salt harvesting', 'Iron working', 'Sailing', 'Currency', 'Mathematics', 'Forestry', 'Engineering', 'Philosophy', 'Administration', 'Organized religion',
    'Feudalism', 'Navigation', 'Theology', 'Astronomy', 'Gunpowder', 'Printing', 'Banking', 'Geology', 'Steam power', 'Railways', 'Industrialization',
    'Fertilizer', 'Drilling', 'Deep mining', 'Electricity', 'Combustion engine', 'Flight', 'Medicine', 'Nuclear physics', 'Advanced mining', 'Nuclear power',
    'Nuclear weapons', 'Rocketry', 'Spaceflight']) assert.ok(TECH_INDEX.has(name), name);
  assert.deepEqual(TECHS[TECH_INDEX.get('Agriculture')!].requires.includes('Pottery'), true, 'farmers can always store a harvest');
});

test('knowledge starts with the Stone techs, inherits without progress and derives multipliers, methods and mobility', () => {
  const start = startingKnowledge();
  for (const name of ['Foraging', 'Fire', 'Hunting', 'Fishing']) assert.ok(knows(start, name));
  assert.equal(start.era, 0);
  assert.deepEqual(availableTechs(start).map(index => TECHS[index].id).sort(), ['Animal husbandry', 'Boatbuilding', 'Masonry', 'Pottery']);
  let knowledge = learn(start, TECH_INDEX.get('Pottery')!);
  assert.ok(knowledge.multipliers.storeMonths > 1 && knowledge.multipliers.spoilage < 1);
  knowledge = learn(knowledge, TECH_INDEX.get('Agriculture')!);
  assert.ok(knowledge.methods.farm && !knowledge.methods.herd);
  assert.equal(ERAS[knowledge.era], 'Neolithic');
  knowledge.target = TECH_INDEX.get('Masonry')!; knowledge.progress[knowledge.target] = 50;
  const child = inheritKnowledge(knowledge);
  assert.ok(knows(child, 'Agriculture'));
  assert.equal(child.target, -1); assert.ok(child.progress.every(points => points === 0));
});

test('peoples that become one know what either knew, and keep their own research in progress', () => {
  const herders = learn(startingKnowledge(), TECH_INDEX.get('Animal husbandry')!);
  let farmers = learn(learn(startingKnowledge(), TECH_INDEX.get('Pottery')!), TECH_INDEX.get('Agriculture')!);
  farmers.target = TECH_INDEX.get('Masonry')!; farmers.progress[farmers.target] = 120;
  // Herders were halfway to Pottery; the farmers knew it already.
  herders.target = TECH_INDEX.get('Pottery')!; herders.progress[herders.target] = 300;
  assert.equal(newTechs(farmers, herders), 1);
  const merged = mergeKnowledge(farmers, herders);
  for (const name of ['Pottery', 'Agriculture', 'Animal husbandry']) assert.ok(knows(merged, name), name);
  assert.ok(merged.methods.farm && merged.methods.herd);
  assert.equal(merged.target, TECH_INDEX.get('Masonry')); assert.equal(merged.progress[merged.target], 120);
  assert.ok(!merged.available.includes(TECH_INDEX.get('Animal husbandry')!), 'what it now knows is no longer a research option');
  // The herders, taking in the farmers, learn Pottery and Agriculture; their half-done Pottery is now known.
  const other = mergeKnowledge(herders, farmers);
  assert.equal(other.target, -1); assert.equal(other.progress[TECH_INDEX.get('Pottery')!], 0);
  farmers = mergeKnowledge(farmers, startingKnowledge());
  assert.equal(newTechs(farmers, startingKnowledge()), 0);
});

test('research speeds up only through sharing and, a little, catching up on older eras; the parts are recorded', () => {
  const tuning = RESEARCH_TUNING, neolithic = ERAS.indexOf('Neolithic'), bronze = ERAS.indexOf('Bronze');
  // Catch-up: nothing for the polity's own frontier era or later; a little more for each era behind, bounded.
  assert.equal(catchUp(bronze, bronze), 1); assert.equal(catchUp(bronze, neolithic), 1);
  assert.equal(catchUp(neolithic, bronze), 1 + tuning.catchUpPerEra);
  assert.equal(catchUp(0, ERAS.length - 1), 1 + tuning.catchUpPerEra * tuning.catchUpEras, 'giga behind: a bounded boost');
  assert.ok(catchUp(0, ERAS.length - 1) <= 2);
  // Sharing: several times faster, more for open peoples.
  assert.ok(shareSpeed(0) >= 2 && shareSpeed(1) > shareSpeed(0));
  const agriculture = TECH_INDEX.get('Agriculture')!;
  const none = { shared: () => false, frontier: neolithic, openness: 0.5 };
  assert.deepEqual(speedOf(agriculture, none), { share: 1, catchUp: 1 }, 'a contact who farms speeds nothing up by itself');
  const both = speedOf(agriculture, { shared: () => true, frontier: bronze, openness: 0.5 });
  assert.equal(both.share, shareSpeed(0.5)); assert.equal(both.catchUp, 1 + tuning.catchUpPerEra);
  // Progress records how much each speed-up gave.
  const knowledge = learn(startingKnowledge(), TECH_INDEX.get('Pottery')!);
  knowledge.target = agriculture;
  advance(knowledge, 100, speedOf(agriculture, none));
  advance(knowledge, 100, both);
  const total = knowledge.progress[agriculture];
  assert.equal(total, 100 + 100 * both.share * both.catchUp);
  assert.equal(knowledge.caught[agriculture], 100 * (both.catchUp - 1));
  assert.equal(knowledge.taught[agriculture], 100 * both.catchUp * (both.share - 1));
  assert.equal(remaining(knowledge), TECHS[agriculture].cost - total);
  const done = learn(knowledge, agriculture);
  assert.equal(done.progress[agriculture] + done.taught[agriculture] + done.caught[agriculture], 0);
});

test('a large people researches faster than a small one, but not in proportion', () => {
  const tuning = RESEARCH_TUNING;
  assert.equal(researchPeople(500), 500);
  assert.equal(researchPeople(tuning.basePeople), tuning.basePeople);
  const large = researchPeople(100 * tuning.basePeople);
  assert.ok(large > 1.5 * tuning.basePeople && large < 10 * tuning.basePeople, `${large}`);
});

test('research weights follow need, environment, shared knowledge and culture', () => {
  const knowledge = learn(startingKnowledge(), TECH_INDEX.get('Pottery')!);
  const agriculture = TECH_INDEX.get('Agriculture')!;
  const base = { affinity: new Map<Affinity, number>(), foodNeed: 0, tradition: 0.2, openness: 0.5, zeal: 0.5, shared: () => false, frontier: 1, blocked: new Set<number>(), rate: 3 };
  const plain = researchWeight(agriculture, base);
  const fertile = (share: number) => researchWeight(agriculture, { ...base, affinity: new Map<Affinity, number>([['fertileRiver', share]]) });
  assert.ok(fertile(1) > plain * 2, 'fertile river land');
  // A tribe weighs its land by where its people live: one fertile valley among many regions draws it to farming less.
  assert.ok(fertile(0.1) > plain && fertile(0.1) < fertile(0.5) && fertile(0.5) < fertile(1), 'graded by the share of people on such land');
  assert.ok(researchWeight(agriculture, { ...base, foodNeed: 0.7 }) > plain * 3, 'hunger or land pressure raises food techs');
  assert.ok(researchWeight(agriculture, { ...base, shared: () => true }) > plain * 2, 'a people sharing its knowledge, who farm');
  assert.ok(researchWeight(agriculture, { ...base, shared: () => true, openness: 0.9 }) > researchWeight(agriculture, { ...base, shared: () => true, openness: 0.1 }), 'openness raises the sharing bonus');
  assert.ok(researchWeight(agriculture, { ...base, tradition: 0.9 }) < plain, 'tradition resists economic change');
  const mining = TECH_INDEX.get('Mining')!;
  assert.ok(researchWeight(mining, { ...base, blocked: new Set([mining]) }) > researchWeight(mining, base) * 1.5, 'known copper it cannot work draws a polity to Mining');
  // A large band on fertile river land that already knows the other Neolithic techs, with its land filling up, almost
  // always turns to Agriculture, and weighs it far above a band on poor land does (which turns to it later, if at all).
  let settledIn = knowledge;
  for (const name of ['Boatbuilding', 'Masonry']) settledIn = learn(settledIn, TECH_INDEX.get(name)!);
  const fertileLand = new Map<Affinity, number>([['fertileRiver', 1], ['riverOrLake', 1]]);
  let picks = 0;
  for (let draw = 0; draw < 400; draw++) {
    const copy = inheritKnowledge(settledIn);
    chooseTarget(copy, { ...base, rate: 40, foodNeed: 0.6, affinity: fertileLand }, createRng(9, draw));
    if (copy.target === agriculture) picks++;
  }
  assert.ok(picks > 300, `well-placed bands pick Agriculture (${picks} of 400)`);
  const pressed = { ...base, rate: 40, foodNeed: 0.6 };
  assert.ok(researchWeight(agriculture, { ...pressed, affinity: fertileLand }) > 20 * researchWeight(agriculture, pressed), 'fertile river land weighs far more than poor land');
});

test('deposits are unknown, known or usable as knowledge grows', () => {
  let knowledge = startingKnowledge();
  assert.equal(depositState(knowledge, 'coal'), 'unknown', 'coal is invisible until Geology');
  assert.equal(depositState(knowledge, 'copper'), 'known');
  assert.equal(depositState(knowledge, 'fish'), 'usable');
  for (const name of ['Pottery', 'Masonry', 'Mining']) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  assert.equal(depositState(knowledge, 'copper'), 'known', 'extracted but useless until Copper working');
  knowledge = learn(knowledge, TECH_INDEX.get('Copper working')!);
  assert.equal(depositState(knowledge, 'copper'), 'usable');
  assert.equal(RESOURCE_IDS.length, 13);
});

test('every founding people gets its own colour, none of them sea blue', () => {
  const colors = Array.from({ length: 30 }, (_, lineage) => lineageColor(lineage));
  assert.equal(new Set(colors.map(color => color.join(','))).size, 30);
  for (const [red, green, blue] of colors) {
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue), span = max - min || 1;
    const hue = (max === red ? ((green - blue) / span + 6) % 6 : max === green ? (blue - red) / span + 2 : (red - green) / span + 4) * 60;
    assert.ok(hue <= 180 || hue >= 240, `rgb(${red}, ${green}, ${blue}) (hue ${hue.toFixed(0)}°) reads as water`);
  }
  assert.equal(packColor([1, 2, 3], 1), (1 | 2 << 8 | 3 << 16 | 255 << 24) >>> 0, 'little-endian RGBA for image data');
});

test('polities founded one after another get clearly different colours, none of them sea blue', () => {
  const hueOf = ([red, green, blue]: [number, number, number]) => {
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue), span = max - min || 1;
    return (max === red ? ((green - blue) / span + 6) % 6 : max === green ? (blue - red) / span + 2 : (red - green) / span + 4) * 60;
  };
  const colors = Array.from({ length: 3000 }, (_, id) => polityColor(id));
  assert.ok(new Set(colors.slice(0, 1000).map(color => color.join(','))).size > 950, 'a thousand polities, almost all distinct');
  for (const [id, color] of colors.entries()) {
    // Rounding to whole RGB values can move a hue by a fraction of a degree.
    assert.ok(hueOf(color) <= 181 || hueOf(color) >= 239, `polity ${id}: rgb(${color.join(', ')}) reads as water`);
    if (id > 0) assert.ok(color.reduce((sum, value, channel) => sum + Math.abs(value - colors[id - 1][channel]), 0) > 60, `polities ${id - 1} and ${id} look alike`);
  }
});
