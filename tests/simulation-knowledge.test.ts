import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { RESOURCE_RULES } from '../src/world/resources.ts';
import { depositState, validateTechData } from '../src/simulation/deposits.ts';
import { ERA_NAMES } from '../shared/simulation.ts';
import { ERA_COLORS } from '../src/observer/palettes.ts';
import { availableTechs, chooseTarget, inheritKnowledge, knows, learn, researchCost, researchWeight, startingKnowledge } from '../src/simulation/knowledge.ts';
import { createRng } from '../src/simulation/rng.ts';
import { ERAS, TECH_INDEX, TECHS, validateTechs } from '../src/simulation/techs.ts';

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

test('research weights follow need, environment, exposure and culture, and contact makes techs cheaper', () => {
  const knowledge = learn(startingKnowledge(), TECH_INDEX.get('Pottery')!);
  const agriculture = TECH_INDEX.get('Agriculture')!;
  const base = { affinity: new Set<never>(), foodNeed: 0, tradition: 0.2, openness: 0.5, exposure: () => 0, blocked: new Set<number>(), rate: 3 };
  const plain = researchWeight(agriculture, base);
  assert.ok(researchWeight(agriculture, { ...base, affinity: new Set(['fertileRiver'] as const) as Set<never> }) > plain * 2, 'fertile river land');
  assert.ok(researchWeight(agriculture, { ...base, foodNeed: 0.7 }) > plain * 3, 'hunger or land pressure raises food techs');
  assert.ok(researchWeight(agriculture, { ...base, exposure: () => 1 }) > plain * 2, 'neighbours who farm');
  assert.ok(researchWeight(agriculture, { ...base, tradition: 0.9 }) < plain, 'tradition resists economic change');
  assert.ok(researchCost(agriculture, 1) < researchCost(agriculture, 0) * 0.5);
  const mining = TECH_INDEX.get('Mining')!;
  assert.ok(researchWeight(mining, { ...base, blocked: new Set([mining]) }) > researchWeight(mining, base) * 1.5, 'known copper it cannot work draws a polity to Mining');
  // A large band on fertile river land that already knows the other Neolithic techs, with its land filling up, almost
  // always turns to Agriculture, and weighs it far above a band on poor land does (which mostly learns it from neighbours).
  let settledIn = knowledge;
  for (const name of ['Boatbuilding', 'Masonry']) settledIn = learn(settledIn, TECH_INDEX.get(name)!);
  const fertileLand = new Set(['fertileRiver', 'riverOrLake'] as const) as Set<never>;
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
