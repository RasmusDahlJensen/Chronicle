import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Chronicle } from '../src/simulation/chronicle.ts';
import { armyTarget } from '../src/simulation/decisions/army.ts';
import { need, needParts } from '../src/simulation/decisions/build.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { armyView, decisionView } from '../src/simulation/perception.ts';
import { raid, raidTarget } from '../src/simulation/raids.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createRng } from '../src/simulation/rng.ts';
import { createSimulation, stepSimulation } from '../src/simulation/simulation.ts';
import type { Polity, PopulationGroup, SimulationState, TickContext } from '../src/simulation/state.ts';
import { ARMY_TUNING, RAID_TUNING } from '../src/simulation/tunables.ts';
import { BUILDINGS } from '../src/simulation/buildings.ts';
import { bonusOf, housingOf, livingSettlements, refreshRegionBonus } from '../src/simulation/settlements.ts';
import { unionScore } from '../src/simulation/decisions/choose.ts';
import { describeEvent } from '../src/observer/events.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Raids and confederations (M6.4; VISION.md "Raids", M6 "threat drives consolidation"). Each test takes a copy of a real
 * history with a tribe's band beside a civilization's land.
 */
let history: SimulationState;
const borderBand = (state: SimulationState) => {
  for (const id of state.living) {
    const tribe = state.polities[id];
    if (tribe.kind !== 'band') continue;
    for (const groupId of tribe.groups) {
      const group = state.groups[groupId];
      for (const edge of state.partition.regions[group.region].neighbors) if (state.owner[edge.region] >= 0 && state.groupAt[edge.region] >= 0) return { tribe, group, region: edge.region };
    }
  }
  return null;
};

before(async () => {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Invariants', size: 'standard' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  history = createSimulation(geography, partitionRegions(geography), 'Invariants');
  while (!borderBand(history) && history.tick < 1500 * 12) for (let month = 0; month < 120; month++) stepSimulation(history, () => 0, false);
  stepSimulation(history);
  assert.ok(borderBand(history), 'a tribe beside a civilization');
});

function world() {
  const state: SimulationState = structuredClone(history);
  Object.setPrototypeOf(state.chronicle, Chronicle.prototype);
  state.raided.fill(0);
  const { tribe, group } = borderBand(state)!;
  return { state, tribe: tribe as Polity, group: group as PopulationGroup };
}
const context = (state: SimulationState): TickContext => ({
  tick: state.tick, year: Math.floor(state.tick / 12), month: state.tick % 12 + 1, stream: (entity = 0, salt = 0) => createRng(state.tick, entity, salt) as never,
});

test('a band weighs a raid: hunger, herding and a rich store push it; soldiers, walls and a poor store hold it off', () => {
  const { state, tribe, group } = world();
  group.foodSecurity = 0.5; group.herdShare = 0.5;
  const target = raidTarget(state, tribe, group)!;
  assert.ok(target && target.chance > 0 && target.chance <= RAID_TUNING.maxChance);
  const there = state.groups[state.groupAt[target.region]];
  const chance = () => { const found = raidTarget(state, tribe, group); return found && found.region === target.region ? found.chance : 0; };
  const at = (change: () => void, undo: () => void) => { change(); const value = chance(); undo(); return value; };
  // A fed band that does not herd raids less (farming is not herding).
  assert.ok(at(() => { group.foodSecurity = 1; group.herdShare = 0; group.farmShare = 1; }, () => { group.foodSecurity = 0.5; group.herdShare = 0.5; }) < target.chance, 'a fed band of farmers raids less');
  // A poor store, soldiers, walls: each holds it off.
  const store = there.store;
  assert.ok(at(() => { there.store = 0; }, () => { there.store = store; }) < target.chance || target.riches === 0, 'nothing to take');
  const soldiers = there.soldiers;
  assert.ok(at(() => { there.soldiers = Math.max(0, there.size - there.specialists); }, () => { there.soldiers = soldiers; }) < target.chance, 'soldiers hold it off');
  const town = livingSettlements(state, target.region)[0], buildings = town.buildings;
  assert.ok(at(() => { town.buildings = [{ type: BUILDINGS.findIndex(building => building.name === 'walls'), condition: 1, builtTick: 0 }]; }, () => { town.buildings = buildings; }) < target.chance, 'walls hold it off');
});

test('a raid takes food exactly, kills on both sides as war deaths, burns a building, moves no border, and is remembered: walls, the army and unions answer', () => {
  const { state, tribe, group } = world();
  group.foodSecurity = 0; group.herdShare = 1;
  const target = raidTarget(state, tribe, group)!;
  const there = state.groups[state.groupAt[target.region]], owner = state.owner[target.region];
  // Even odds (soldiers to match its warriors), and a building to burn.
  there.soldiers = Math.min(Math.max(0, there.size - there.specialists), Math.round(group.size * ARMY_TUNING.warriors * tribe.knowledge.multipliers.military / Math.max(0.01, state.polities[owner].knowledge.multipliers.military)));
  const town = livingSettlements(state, target.region)[0];
  town.buildings = [{ type: BUILDINGS.findIndex(building => building.name === 'granary'), condition: 1, builtTick: 0 }];
  town.bonus = bonusOf(town.buildings); town.housing = housingOf(town); refreshRegionBonus(state, target.region);
  const before = { mine: group.store, theirs: there.store, raiders: group.size, people: there.size, events: state.chronicle.events.length };
  for (const id of [group.id, there.id]) state.ledger.food.set(id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: 0, carriedOut: 0, plantedBefore: 0, sown: 0, harvested: 0, cropsLost: 0, weather: 0, factor: 1 });
  state.ledger.warDeaths.fill(0);
  const saved = { rate: RAID_TUNING.rate, maxChance: RAID_TUNING.maxChance, burn: RAID_TUNING.burn };
  Object.assign(RAID_TUNING, { rate: 1_000, maxChance: 1, burn: 1 });
  try {
    // A month when its band weighs a raid.
    while ((state.tick + 1 + group.id) % 12 !== 0) state.tick++;
    state.tick++;
    raid(state, context(state));
  } finally { Object.assign(RAID_TUNING, saved); }
  const taken = before.theirs - there.store;
  assert.ok(taken > 0);
  assert.equal(group.store - before.mine, taken);
  assert.equal(state.ledger.food.get(there.id)!.carriedOut, taken); assert.equal(state.ledger.food.get(group.id)!.carriedIn, taken);
  assert.ok(before.raiders > group.size && before.people > there.size, 'the dead on both sides');
  assert.equal(before.raiders - group.size + before.people - there.size, state.ledger.warDeaths.reduce((sum, value) => sum + value, 0), 'all war deaths');
  assert.deepEqual(town.buildings, [], 'its granary burned');
  assert.ok(there.soldiers <= there.size - there.specialists);
  assert.equal(state.owner[target.region], owner, 'no border moves');
  assert.ok(state.raided[target.region] > 0, 'remembered');
  // Told in full.
  state.chronicle.flush(state.tick);
  const told = state.chronicle.events.slice(before.events).find(event => event.type === 'raid')!;
  assert.ok(told && told.causes.length > 0);
  const text = describeEvent(told, id => state.polities[id]?.name ?? '?');
  assert.match(text, /^Raiders of the .+ fall on .+, burn its granary and carry off food for [\d,]+ (person|people) for a month; the .+ lose [\d,]+ (person|people); [\d,]+ raiders? fall\.$/);
  // Nothing to carry off: said so, not "food for 0 people".
  assert.match(describeEvent({ ...told, data: { ...told.data, food: 0 } }, id => state.polities[id]?.name ?? '?'), / but find little food to carry off;/);
  // Walls are wanted there, citing raids; its realm feels the threat in proportion to its people raided.
  const civ = state.polities[owner];
  const settlement = decisionView(state, civ).build.settlements.find(entry => entry.region === target.region)!;
  const values = decisionView(state, civ).values;
  assert.ok(need('defense', settlement, values) > need('defense', { ...settlement, raided: 0 }, values), 'walls are wanted where raiders came');
  assert.ok(Object.keys(needParts('defense', { ...settlement, frontier: 0 }, values)).includes('raids'), 'and the need is named raids');
  const view = armyView(state, civ);
  // Its regions' raid memory weighed by their people: one raided region of several is a part of the threat, not all of it.
  let weighed = 0, people = 0;
  for (const id of civ.groups) { const at = state.groups[id]; weighed += state.raided[at.region] * at.size; people += at.size; }
  assert.ok(Math.abs(view.raided - weighed / people) < 1e-12, 'weighed by the people of its raided land');
  assert.ok(civ.groups.length > 1 && view.raided < state.raided[target.region], 'less than the raided region remembers');
  const raided = armyTarget({ ...view, raided: 1, neighbours: [] }), calm = armyTarget({ ...view, raided: 0, neighbours: [] });
  assert.ok(raided.raiders && raided.threatened > calm.threatened, 'it keeps more soldiers, for fear of raiders');
  // A raided realm seeks shelter in a liked larger neighbour more.
  const shelter = decisionView(state, civ), neighbour = { civ: 9_999, name: 'Ora', kin: false, similarity: 0.5, knownRegions: 50, believedPeople: shelter.people * 10, confidence: 1, opinion: 60, fed: 1, stability: 1, crossingKm: 300, border: 2 };
  assert.ok(unionScore({ ...shelter, raided: 1 }, neighbour).score > unionScore({ ...shelter, raided: 0, threats: [] }, neighbour).score);
});

test('raids in the whole simulation: every invariant holds each month as bands raid, burn and confederate', () => {
  const { state } = world();
  const saved = { rate: RAID_TUNING.rate, maxChance: RAID_TUNING.maxChance, burn: RAID_TUNING.burn, confederate: RAID_TUNING.confederate };
  Object.assign(RAID_TUNING, { rate: 100, maxChance: 1, burn: 1, confederate: 1 });
  // Something to burn: a granary in every settlement beside a tribe's band.
  const granary = BUILDINGS.findIndex(building => building.name === 'granary');
  for (const id of state.living) {
    if (state.polities[id].kind !== 'band') continue;
    for (const at of state.polities[id].groups) for (const edge of state.partition.regions[state.groups[at].region].neighbors) {
      if (state.owner[edge.region] < 0) continue;
      for (const town of livingSettlements(state, edge.region)) if (!town.buildings.some(building => building.type === granary)) {
        town.buildings.push({ type: granary, condition: 1, builtTick: 0 }); town.bonus = bonusOf(town.buildings); town.housing = housingOf(town);
      }
      refreshRegionBonus(state, edge.region);
    }
  }
  const { raids, buildingsBurned } = state.metrics;
  try {
    for (let month = 0; month < 24; month++) {
      stepSimulation(state);
      // Every band a hungry herder (its own month recomputes both), then a month of raids and every invariant after them.
      for (const id of state.living) if (state.polities[id].kind === 'band') for (const at of state.polities[id].groups) Object.assign(state.groups[at], { foodSecurity: 0, herdShare: 1 });
      raid(state, context(state));
      checkInvariants(state);
    }
  } finally { Object.assign(RAID_TUNING, saved); }
  assert.ok(state.metrics.raids > raids, 'bands raided');
  assert.ok(state.metrics.buildingsBurned > buildingsBurned, 'and burned');
});

test('a raiding tribe draws a smaller kin tribe beside it into its confederation', () => {
  const { state, tribe: first } = world();
  // A tribe beside it, made its kin; the larger of the two raided lately and draws in the smaller.
  let other: Polity | null = null;
  for (const id of first.groups) for (const edge of state.partition.regions[state.groups[id].region].neighbors) {
    const at = state.occupant[edge.region];
    if (at >= 0 && at !== first.id && state.polities[at].kind === 'band') other ??= state.polities[at];
  }
  assert.ok(other, 'a tribe beside it');
  const size = (polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
  const [tribe, kin] = size(other) < size(first) ? [first, other] : [other, first];
  assert.ok(size(kin) < size(tribe));
  kin.lineage = tribe.lineage;
  const bands = kin.groups.length, before = tribe.groups.length;
  tribe.raids = RAID_TUNING.confederateRaids;
  const confederate = RAID_TUNING.confederate;
  Object.assign(RAID_TUNING, { confederate: 1 });
  try { while (state.tick % 12 !== 0) state.tick++; raid(state, context(state)); } finally { Object.assign(RAID_TUNING, { confederate }); }
  assert.notEqual(kin.deathTick, null, 'the smaller tribe joined');
  assert.equal(tribe.groups.length, before + bands);
  checkInvariants(state);
  state.chronicle.flush(state.tick);
  const told = state.chronicle.events.find(event => event.type === 'confederation' && event.actors.some(actor => actor.id === kin!.id))!;
  assert.ok(told && told.causes.some(cause => cause.factor === 'raiding'));
  assert.match(describeEvent(told, id => state.polities[id]?.name ?? '?'), /join/);
});
