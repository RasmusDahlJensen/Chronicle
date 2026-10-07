import { causes } from './causes.ts';
import { blendLanguage, blendName, createLanguage, createName, descendName, mutateLanguage } from './names.ts';
import type { Rng } from './rng.ts';
import { VALUE_KEYS, type Culture, type CultureOrigin, type CultureValues, type Polity, type PopulationGroup, type SimulationState, type TickContext } from './state.ts';
import { TRAITS, type TraitCondition } from './traits.ts';
import { TENETS } from './religions.ts';
import { CONVERSION_STREAM, faithYear, realmFaith, refreshReligion, tenetPulls } from './faith.ts';
import { CULTURE_PULLS, CULTURE_TUNING, TRAIT_TUNING, type PullMeasure } from './tunables.ts';

/**
 * Living cultures (VISION.md "Culture and lineage", M4). Values live on the people: each population group holds its
 * own, which drift with its conditions and blend toward the peoples it is in contact with, so a culture stays one
 * where its people are close and grows apart where they are not. A culture's values are its people's mean. When part
 * of a culture has grown far enough from its heart, it splits off as a daughter culture whose name and colour descend
 * from its parent's. Within a realm, smaller peoples grown close to the ruling culture take it up over generations,
 * and two large peoples long together may fuse into a hybrid. Cultures earn traits from the lives most of their people
 * lead. Cultures are never deleted, so any culture's descent can be traced to the starting peoples.
 */

/** Stream salts for a culture's yearly draws (its common step and splitting) and a realm's (assimilation, fusion). */
const CULTURE_STREAM = 0xc017, REALM_STREAM = 0xc018;

/** How alike two cultures' values are (0–1): one minus the mean absolute difference of the five sliders. */
export function cultureSimilarity(a: CultureValues, b: CultureValues) {
  let difference = 0;
  for (const key of VALUE_KEYS) difference += Math.abs(a[key] - b[key]);
  return 1 - difference / VALUE_KEYS.length;
}

/** How far apart two peoples' values are (0–1): the mean absolute difference of the five sliders. */
export const divergence = (a: CultureValues, b: CultureValues) => 1 - cultureSimilarity(a, b);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const wrapHue = (hue: number) => (hue % 360 + 360) % 360;

/**
 * A new culture: a starting people's (a fresh language and name, and the colour `hue`), or a daughter of `parent`
 * (a breakaway band or a split), whose language changes a few sounds, whose name keeps its parent's first syllable and
 * whose colour lies near its parent's.
 */
export function foundCulture(state: SimulationState, rng: Rng, origin: CultureOrigin, parent: Culture | null, values: CultureValues, hue = 0): Culture {
  const language = parent ? mutateLanguage(rng, parent.language, CULTURE_TUNING.languageChanges) : createLanguage(rng);
  const taken = new Set(state.cultures.map(culture => culture.name.toLowerCase()));
  const name = parent ? descendName(rng, parent.name, language, taken) : createName(rng, language, taken);
  const culture: Culture = {
    id: state.cultures.length, name, values: { ...values }, language, parents: parent ? [{ id: parent.id, weight: 1 }] : [], foundedTick: state.tick,
    origin, hue: wrapHue(parent ? parent.hue + (rng.next() * 2 - 1) * CULTURE_TUNING.hueShift : hue), people: 0, regions: 0, deathTick: null,
    traits: [], traitYears: TRAITS.map(() => 0),
  };
  if (parent) inherit(rng, culture, parent.traits, TRAIT_TUNING.inherit);
  state.cultures.push(culture);
  return culture;
}

/** A hybrid of two cultures (VISION.md "Hybrids"): both are its parents, `weight` of it from `first`; its language and
 *  name mix theirs, its colour lies between theirs, and it may keep traits of either (the lighter parent's less often). */
export function foundHybrid(state: SimulationState, rng: Rng, first: Culture, second: Culture, weight: number, values: CultureValues): Culture {
  const [heavy, light, w] = weight >= 0.5 ? [first, second, weight] : [second, first, 1 - weight];
  const language = blendLanguage(rng, heavy.language, light.language, w);
  const turn = ((light.hue - heavy.hue + 540) % 360) - 180;
  const culture: Culture = {
    id: state.cultures.length, name: blendName(rng, heavy.name, light.name, language, new Set(state.cultures.map(entry => entry.name.toLowerCase()))), values: { ...values }, language,
    parents: [{ id: heavy.id, weight: w }, { id: light.id, weight: 1 - w }], foundedTick: state.tick, origin: 'hybrid',
    hue: wrapHue(heavy.hue + (1 - w) * turn), people: 0, regions: 0, deathTick: null, traits: [], traitYears: TRAITS.map(() => 0),
  };
  inherit(rng, culture, heavy.traits, TRAIT_TUNING.inherit);
  inherit(rng, culture, light.traits, TRAIT_TUNING.inherit / 2);
  state.cultures.push(culture);
  return culture;
}

/** A new culture keeps each of `traits` with chance `chance`, up to the most a culture holds. */
function inherit(rng: Rng, culture: Culture, traits: number[], chance: number) {
  for (const trait of traits) if (culture.traits.length < TRAIT_TUNING.max && !culture.traits.includes(trait) && rng.chance(chance)) culture.traits.push(trait);
}

/** A group's people take up another culture; a polity's ruling culture is its heartland people's. */
export function setGroupCulture(state: SimulationState, group: PopulationGroup, culture: number) {
  group.culture = culture;
  const polity = state.polities[group.polity];
  if (polity.core === group.id) polity.culture = culture;
}

/** `into` takes in `people` people whose values are `values` (migrants): its values become everyone's mean. */
export function blendValues(into: PopulationGroup, values: CultureValues, people: number) {
  const total = into.size + people;
  if (total <= 0) return;
  for (const key of VALUE_KEYS) into.values[key] = (into.values[key] * into.size + values[key] * people) / total;
}

/**
 * Per region, how harsh its land is (0–1, static): how far it feeds fewer farmers and herders per km² (at full game,
 * with Neolithic knowledge) than the median habitable region; 1 where it feeds none.
 */
export function harshLand(state: SimulationState) {
  const regions = state.partition.regions, density = regions.map(region => state.landValue[region.id] / Math.max(1, region.areaKm2));
  const fed = density.filter(value => value > 0).sort((a, b) => a - b), median = fed.length ? fed[Math.floor(fed.length / 2)] : 1;
  return Float64Array.from(density, value => 1 - Math.min(1, value / median));
}

/** What a group's conditions measure (0–1 each), for the pulls on its values (`CULTURE_PULLS`). */
export function pullMeasures(state: SimulationState, polity: Polity, group: PopulationGroup): Record<PullMeasure, number> {
  const region = state.partition.regions[group.region];
  let foreign = 0, open = 0;
  for (const edge of region.neighbors) {
    const occupant = state.occupant[edge.region];
    if (occupant >= 0 && occupant !== polity.id) foreign++;
    else if (occupant < 0 && state.habitable[edge.region]) open++;
  }
  let urban = 0;
  for (const id of state.regionSettlements[group.region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive') urban += settlement.urban; }
  const towns = group.size > 0 ? Math.min(1, urban / group.size / CULTURE_TUNING.townShare) : 0;
  return {
    harshLand: state.harshness[group.region],
    frontier: region.neighbors.length ? foreign / region.neighbors.length : 0,
    townsAndSea: CULTURE_TUNING.seaShare * (region.coastal && polity.knowledge.sea > 0 ? 1 : 0) + (1 - CULTURE_TUNING.seaShare) * towns,
    hardship: Math.min(1, state.hardship[group.region]),
    openLand: region.neighbors.length ? open / region.neighbors.length : 0,
  };
}

/** Where a group's values are drawn by its conditions, by its culture's traits and by its faith's tenets. */
export function pullTarget(measured: Record<PullMeasure, number>, traits: number[] = [], tenets: number[] = []): CultureValues {
  const target = {} as CultureValues;
  for (const key of VALUE_KEYS) {
    const pull = CULTURE_PULLS[key];
    let value = pull.base;
    for (const entry of pull.pulls) value += entry.weight * measured[entry.measure];
    for (const trait of traits) value += TRAITS[trait].pulls[key] ?? 0;
    for (const tenet of tenets) value += TENETS[tenet].pulls[key] ?? 0;
    target[key] = clamp01(value);
  }
  return target;
}

/** Which traits' conditions a group's people live in (VISION.md "Traits"). */
export function traitConditions(state: SimulationState, polity: Polity, group: PopulationGroup): Record<TraitCondition, boolean> {
  const region = state.partition.regions[group.region], tuning = TRAIT_TUNING;
  let great = false;
  for (const id of state.regionSettlements[group.region]) { const settlement = state.settlements[id]; if (settlement.status === 'alive' && (settlement.tier >= 2 || settlement.wonder !== null)) great = true; }
  return {
    seafaring: region.coastal && polity.knowledge.sea > 0,
    greatRiverFarming: region.riverTier >= 3 && group.farmShare >= tuning.farming,
    mountains: state.affinity[group.region].has('rough'),
    desertHerding: state.affinity[group.region].has('desert') && group.farmShare >= tuning.herding && region.riverTier < 2 && !region.openLake,
    greatWorks: great,
  };
}

/** A polity's prestige (VISION.md "Influence": size, wealth, tech, great cities, wonders; military victories come with
 *  M6), as `CULTURE_TUNING` weighs them. */
export function prestigeOf(state: SimulationState, polity: Polity, wonders: Map<number, number>) {
  let people = 0, cities = 0;
  for (const id of polity.groups) {
    const group = state.groups[id];
    people += group.size;
    for (const at of state.regionSettlements[group.region]) { const settlement = state.settlements[at]; if (settlement.status === 'alive' && settlement.owner === polity.id && settlement.tier >= 2) cities++; }
  }
  const tuning = CULTURE_TUNING, wealth = people > 0 ? Math.min(1, polity.wealth / people / tuning.wealthPerPerson) : 0;
  return Math.sqrt(people) * (1 + tuning.prestigeEra * polity.knowledge.era) * (1 + tuning.prestigeWonder * (wonders.get(polity.id) ?? 0))
    * (1 + tuning.prestigeCity * cities) * (1 + tuning.prestigeWealth * wealth);
}

/**
 * A group's year (VISION.md "Drift", "Influence"): its values drift toward where its conditions pull them, and blend
 * toward its neighbours' (a more prestigious people pulls harder; another polity's people, and a people already far
 * apart, less: the homophily of Axelrod's model of cultural dissemination and of bounded-confidence models, without
 * which every culture would blend into one) and, in a civilization, toward its heartland's, the more the nearer.
 */
export function liveYear(state: SimulationState, group: PopulationGroup, prestige: (polity: number) => number) {
  const tuning = CULTURE_TUNING, polity = state.polities[group.polity], values = group.values;
  const target = pullTarget(pullMeasures(state, polity, group), state.cultures[group.culture].traits, tenetPulls(state, group.faith));
  const pull = [0, 0, 0, 0, 0];
  let weight = 0;
  const own = prestige(polity.id);
  const toward = (other: CultureValues, w: number) => {
    if (w <= 0) return;
    VALUE_KEYS.forEach((key, at) => { pull[at] += w * (other[key] - values[key]); });
    weight += w;
  };
  for (const edge of state.partition.regions[group.region].neighbors) {
    const at = state.groupAt[edge.region];
    if (at < 0) continue;
    const other = state.groups[at], theirs = prestige(other.polity), alike = Math.max(0, 1 - divergence(values, other.values) / tuning.confidence);
    toward(other.values, (other.polity === polity.id ? 1 : tuning.foreignContact) * (own + theirs > 0 ? 2 * theirs / (own + theirs) : 1) * alike);
  }
  if (polity.kind === 'civ' && polity.core !== group.id && state.remoteOwner[group.region] === polity.id) {
    toward(state.groups[polity.core].values, tuning.heartPull * Math.exp(-state.remoteness[group.region]));
  }
  VALUE_KEYS.forEach((key, at) => {
    values[key] = clamp01(values[key] + tuning.driftRate * (target[key] - values[key]) + tuning.influenceRate * pull[at] / Math.max(1, weight));
  });
}

/**
 * A culture's heart: the heartland group of the polity it rules with the most of its people, or (ruling none) its
 * largest group. Its parts are measured against it.
 */
export function heartOf(state: SimulationState, culture: Culture, groups: PopulationGroup[]) {
  const ruled = new Map<number, number>();
  for (const group of groups) if (state.polities[group.polity].culture === culture.id) ruled.set(group.polity, (ruled.get(group.polity) ?? 0) + group.size);
  let best = -1, most = -1;
  for (const [polity, people] of ruled) if (people > most || (people === most && polity < best)) { best = polity; most = people; }
  if (best >= 0) return state.groups[state.polities[best].core];
  return groups.reduce((largest, group) => group.size > largest.size || (group.size === largest.size && group.id < largest.id) ? group : largest);
}

/**
 * Culture system: once a year per group (staggered by id) its values drift and blend; once a year per culture
 * (staggered by id) its people take a common step, its values and numbers are refreshed (a culture with nobody left
 * dies), and a part grown apart may split off.
 */
export function cultureYear(state: SimulationState, context: TickContext) {
  const due = (id: number) => ((context.tick - id) % 12 + 12) % 12 === 0;
  const wonders = new Map<number, number>(), prestige = new Map<number, number>();
  for (const wonder of state.wonders) {
    if (wonder.status !== 'standing') continue;
    const owner = state.settlements[wonder.settlement].owner;
    wonders.set(owner, (wonders.get(owner) ?? 0) + 1);
  }
  const prestigeOfId = (id: number) => {
    let value = prestige.get(id);
    if (value === undefined) { value = prestigeOf(state, state.polities[id], wonders); prestige.set(id, value); }
    return value;
  };
  // Groups by id, so a band that moves still has one culture year a year.
  // Each people's culture year (staggered by group id).
  for (const id of state.living) for (const groupId of state.polities[id].groups) if (due(groupId)) liveYear(state, state.groups[groupId], prestigeOfId);
  // Each polity's peoples' faith year (staggered by polity id, so its conversions to each religion are one event a
  // year, citing the mean of what drew them: VISION.md "Spread").
  for (const id of state.living.slice()) {
    if (!due(id) || state.polities[id].deathTick !== null) continue;
    const polity = state.polities[id], converted = new Map<number, { regions: number; people: number; region: number; parts: Record<string, number> }>();
    for (const groupId of polity.groups.slice()) {
      const group = state.groups[groupId], taken = faithYear(state, context.stream(groupId, CONVERSION_STREAM), group);
      if (!taken) continue;
      state.metrics.conversions++;
      const entry = converted.get(taken.religion) ?? { regions: 0, people: 0, region: group.region, parts: { neighbours: 0, stateSupport: 0, shrine: 0, holyLand: 0 } };
      entry.regions++; entry.people += group.size;
      for (const key of Object.keys(entry.parts) as (keyof typeof taken.draw)[]) entry.parts[key] += taken.draw[key];
      converted.set(taken.religion, entry);
    }
    for (const [religion, entry] of converted) {
      state.chronicle.emit({
        type: 'faithSpread', actors: [{ id, role: polity.kind === 'civ' ? 'civ' : 'band' }], region: entry.region,
        causes: causes(Object.fromEntries(Object.entries(entry.parts).map(([factor, sum]) => [factor, sum / entry.regions]))), importance: 0.06,
        data: { religion: state.religions[religion].name, polity: polity.name, regions: entry.regions, population: entry.people, one: entry.regions === 1, more: entry.regions > 1 },
      });
    }
  }
  // Each realm's peoples and faith, once a year (staggered by id): assimilation and fusion, and founding a religion.
  for (const id of state.living.slice()) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ' || !due(id)) continue;
    realmPeoples(state, context, civ);
    realmFaith(state, context, civ);
  }
  // Each religion's followers, once a year (staggered by id).
  const religions = state.religions.filter(religion => religion.deathTick === null && due(religion.id));
  if (religions.length) {
    const followers = new Map<number, PopulationGroup[]>();
    for (const id of state.living) for (const groupId of state.polities[id].groups) { const group = state.groups[groupId]; if (group.faith >= 0) { const list = followers.get(group.faith); if (list) list.push(group); else followers.set(group.faith, [group]); } }
    for (const religion of religions) refreshReligion(state, context, religion, followers.get(religion.id) ?? []);
  }
  const cultures = state.cultures.filter(culture => culture.deathTick === null && due(culture.id));
  if (!cultures.length) return;
  const members = new Map<number, PopulationGroup[]>();
  for (const id of state.living) for (const groupId of state.polities[id].groups) {
    const group = state.groups[groupId];
    if (!due(group.culture)) continue;
    const list = members.get(group.culture);
    if (list) list.push(group); else members.set(group.culture, [group]);
  }
  for (const culture of cultures) refreshCulture(state, context, culture, members.get(culture.id) ?? []);
}

function refreshCulture(state: SimulationState, context: TickContext, culture: Culture, groups: PopulationGroup[]) {
  if (!groups.length) { culture.people = 0; culture.regions = 0; culture.deathTick = context.tick; return; }
  const rng = context.stream(culture.id, CULTURE_STREAM), fashion = CULTURE_TUNING.fashion;
  const step = VALUE_KEYS.map(() => (rng.next() * 2 - 1) * fashion);
  for (const group of groups) VALUE_KEYS.forEach((key, at) => { group.values[key] = clamp01(group.values[key] + step[at]); });
  summarize(culture, groups);
  earnTraits(state, culture, groups);
  const left = splitOff(state, rng, culture, groups);
  // What it is without the part that split off.
  if (left) summarize(culture, left);
}

/** A culture earns a trait once at least `TRAIT_TUNING.share` of its people have lived in its conditions for the
 *  trait's years in a row (an event); it keeps it. */
function earnTraits(state: SimulationState, culture: Culture, groups: PopulationGroup[]) {
  const living = new Array<number>(TRAITS.length).fill(0);
  let people = 0;
  for (const group of groups) {
    people += group.size;
    const conditions = traitConditions(state, state.polities[group.polity], group);
    TRAITS.forEach((trait, at) => { if (conditions[trait.condition]) living[at] += group.size; });
  }
  TRAITS.forEach((trait, at) => {
    culture.traitYears[at] = people > 0 && living[at] >= TRAIT_TUNING.share * people ? culture.traitYears[at] + 1 : 0;
    if (culture.traitYears[at] < trait.years || culture.traits.includes(at) || culture.traits.length >= TRAIT_TUNING.max) return;
    culture.traits.push(at);
    state.metrics.traitsEarned++;
    const largest = groups.reduce((best, group) => group.size > best.size ? group : best);
    state.chronicle.emit({
      type: 'traitEarned', actors: [{ id: largest.polity, role: 'polity' }], region: largest.region, causes: causes({ [trait.condition]: living[at] / people }), importance: 0.15,
      data: { culture: culture.name, trait: trait.name, years: trait.years },
    });
  });
}

/** A culture's values, people and regions from its groups. */
function summarize(culture: Culture, groups: PopulationGroup[]) {
  let people = 0;
  const sums = [0, 0, 0, 0, 0];
  for (const group of groups) { people += group.size; VALUE_KEYS.forEach((key, at) => { sums[at] += group.values[key] * group.size; }); }
  if (people > 0) VALUE_KEYS.forEach((key, at) => { culture.values[key] = sums[at] / people; });
  culture.people = people; culture.regions = groups.length;
}

/**
 * Part of a culture whose people have grown apart from its heart (VISION.md "Splitting"): its groups more than
 * `splitDivergence` away, in neighbouring regions, at least `splitRegions` of them, may split off as a daughter
 * culture (at most one split a year per culture; larger parts first).
 */
function splitOff(state: SimulationState, rng: Rng, culture: Culture, groups: PopulationGroup[]): PopulationGroup[] | null {
  const tuning = CULTURE_TUNING, heart = heartOf(state, culture, groups);
  const apart = new Map<number, { group: PopulationGroup; distance: number }>();
  for (const group of groups) { const distance = divergence(group.values, heart.values); if (distance > tuning.splitDivergence) apart.set(group.region, { group, distance }); }
  if (apart.size < tuning.splitRegions) return null;
  const seen = new Set<number>(), areas: { group: PopulationGroup; distance: number }[][] = [];
  for (const start of [...apart.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const area = [apart.get(start)!], queue = [start];
    seen.add(start);
    while (queue.length) {
      for (const edge of state.partition.regions[queue.pop()!].neighbors) {
        if (seen.has(edge.region) || !apart.has(edge.region)) continue;
        seen.add(edge.region); queue.push(edge.region); area.push(apart.get(edge.region)!);
      }
    }
    if (area.length >= tuning.splitRegions) areas.push(area);
  }
  const people = (area: { group: PopulationGroup }[]) => area.reduce((sum, entry) => sum + entry.group.size, 0);
  areas.sort((a, b) => people(b) - people(a) || a[0].group.region - b[0].group.region);
  for (const area of areas) {
    const total = people(area);
    const mean = total > 0 ? area.reduce((sum, entry) => sum + entry.distance * entry.group.size, 0) / total : 0;
    if (!rng.chance(tuning.splitRate * Math.min(1, (mean - tuning.splitDivergence) / tuning.splitDivergence))) continue;
    const gone = new Set(area.map(entry => entry.group));
    split(state, rng, culture, heart, [...gone]);
    return groups.filter(group => !gone.has(group));
  }
  return null;
}

function split(state: SimulationState, rng: Rng, parent: Culture, heart: PopulationGroup, area: PopulationGroup[]) {
  const values = {} as CultureValues;
  let people = 0;
  for (const key of VALUE_KEYS) values[key] = 0;
  for (const group of area) { people += group.size; for (const key of VALUE_KEYS) values[key] += group.values[key] * group.size; }
  for (const key of VALUE_KEYS) values[key] = people > 0 ? values[key] / people : heart.values[key];
  // Split from a settled civilization's culture: one that rules a living civilization (VISION.md M4's criterion).
  const fromCiv = state.living.some(id => state.polities[id].kind === 'civ' && state.polities[id].culture === parent.id);
  const child = foundCulture(state, rng, 'split', parent, values);
  for (const group of area) setGroupCulture(state, group, child.id);
  child.people = people; child.regions = area.length;
  parent.people -= people; parent.regions -= area.length;
  // Who holds most of them, and how they differ from the heart of their people.
  const holders = new Map<number, number>();
  for (const group of area) holders.set(group.polity, (holders.get(group.polity) ?? 0) + group.size);
  let holder = area[0].polity;
  for (const [polity, count] of holders) if (count > (holders.get(holder) ?? 0) || (count === holders.get(holder) && polity < holder)) holder = polity;
  const largest = area.reduce((best, group) => group.size > best.size ? group : best);
  const differences = VALUE_KEYS.map(key => ({ key, by: values[key] - heart.values[key] }));
  const more = differences.reduce((best, entry) => entry.by > best.by ? entry : best), less = differences.reduce((best, entry) => entry.by < best.by ? entry : best);
  const note = CULTURE_TUNING.splitNote * CULTURE_TUNING.splitDivergence, hasMore = more.by >= note, hasLess = less.by <= -note;
  state.metrics.cultureSplits++;
  if (fromCiv) state.metrics.civCultureSplits++;
  const factors: Record<string, number> = {};
  for (const entry of differences) factors[`${entry.by > 0 ? 'more' : 'less'}${entry.key[0].toUpperCase()}${entry.key.slice(1)}`] = Math.abs(entry.by);
  const polity = state.polities[holder];
  state.chronicle.emit({
    type: 'cultureSplit', actors: [{ id: holder, role: 'polity' }], region: largest.region, causes: causes(factors), importance: 0.25,
    data: {
      culture: child.name, parent: parent.name, regions: area.length, population: people, polity: polity.name, others: holders.size > 1, tribe: polity.kind === 'band', fromCiv,
      more: more.key, less: less.key, both: hasMore && hasLess, onlyMore: hasMore && !hasLess, onlyLess: hasLess && !hasMore,
    },
  });
}

/**
 * A culture's descent from the starting peoples (VISION.md "Ancestry query"): each founding culture's share in it,
 * largest first, summing to 1. Parents always have lower ids, so shares pass down from the newest ancestor.
 */
export function ancestry(state: SimulationState, id: number) {
  const weights = new Map<number, number>([[id, 1]]), roots = new Map<number, number>();
  const pending = [id];
  const queued = new Set(pending);
  // Every ancestor once, newest first.
  for (let at = 0; at < pending.length; at++) for (const parent of state.cultures[pending[at]].parents) if (!queued.has(parent.id)) { queued.add(parent.id); pending.push(parent.id); }
  pending.sort((a, b) => b - a);
  for (const current of pending) {
    const weight = weights.get(current) ?? 0, culture = state.cultures[current];
    if (!culture.parents.length) { roots.set(current, (roots.get(current) ?? 0) + weight); continue; }
    for (const parent of culture.parents) weights.set(parent.id, (weights.get(parent.id) ?? 0) + weight * parent.weight);
  }
  return [...roots].map(([root, share]) => ({ id: root, share })).sort((a, b) => b.share - a.share || a.id - b.id);
}

/** A culture's line of descent: its heaviest parent, that one's, and so on, at most `depth` steps back. */
export function lineOf(state: SimulationState, id: number, depth: number) {
  const line: Culture[] = [];
  let culture = state.cultures[id];
  while (line.length < depth && culture.parents.length) {
    const parent = culture.parents.reduce((best, entry) => entry.weight > best.weight ? entry : best);
    culture = state.cultures[parent.id];
    line.push(culture);
  }
  return line;
}

/**
 * Culture measures for the study: living cultures with people; how far cultures differ (per value, the
 * people-weighted spread of living cultures' values, averaged over the five); how far each culture's people differ
 * from its heart (people-weighted); and the share of civilizations' people whose culture is not their realm's.
 */
export function cultureStats(state: SimulationState) {
  const members = new Map<number, PopulationGroup[]>();
  let civPeople = 0, foreign = 0;
  for (const id of state.living) {
    const polity = state.polities[id];
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      const list = members.get(group.culture);
      if (list) list.push(group); else members.set(group.culture, [group]);
      if (polity.kind === 'civ') { civPeople += group.size; if (group.culture !== polity.culture) foreign += group.size; }
    }
  }
  let people = 0, apart = 0;
  const means = [0, 0, 0, 0, 0], cultureValues: { people: number; values: number[] }[] = [];
  for (const [id, groups] of members) {
    const culture = state.cultures[id], heart = heartOf(state, culture, groups);
    let count = 0;
    const sums = [0, 0, 0, 0, 0];
    for (const group of groups) {
      count += group.size; apart += divergence(group.values, heart.values) * group.size;
      VALUE_KEYS.forEach((key, at) => { sums[at] += group.values[key] * group.size; });
    }
    if (count <= 0) continue;
    people += count;
    const values = sums.map(sum => sum / count);
    cultureValues.push({ people: count, values });
    values.forEach((value, at) => { means[at] += value * count; });
  }
  let spread = 0;
  if (people > 0) {
    for (let at = 0; at < means.length; at++) {
      const mean = means[at] / people;
      let variance = 0;
      for (const entry of cultureValues) variance += entry.people * (entry.values[at] - mean) ** 2;
      spread += Math.sqrt(variance / people) / means.length;
    }
  }
  let withTraits = 0;
  for (const id of members.keys()) if (state.cultures[id].traits.length) withTraits++;
  return { cultures: cultureValues.length, valueSpread: spread, cultureDivergence: people > 0 ? apart / people : 0, foreignShare: civPeople > 0 ? foreign / civPeople : 0, culturesWithTraits: withTraits };
}


/**
 * Assimilation (VISION.md "Assimilation"): a people of another culture under a realm's rule takes up its ruling
 * culture over generations. Its yearly chance is `assimilationRate` × how close their values already are to the realm's
 * heartland people's (none beyond `assimilationRange`) × how little they hold to their ways (1 − ½ Tradition) × how hard
 * the realm presses (1 − ½ its heartland's Openness: tolerant realms let peoples be) × how near the court (½ + ½
 * e^(−remoteness)) × how small a share of the realm they are (none at `hybridShare` or more: large peoples do not
 * dissolve, they may fuse instead; kin dissolve into kin whatever their size). Returns the chance and its parts.
 */
export function assimilationChance(state: SimulationState, civ: Polity, group: PopulationGroup, heart: PopulationGroup, share: number, kin = false) {
  const tuning = CULTURE_TUNING;
  const close = Math.max(0, 1 - divergence(group.values, heart.values) / tuning.assimilationRange);
  const holding = 1 - tuning.assimilationTradition * group.values.tradition, pressing = 1 - tuning.assimilationTolerance * heart.values.openness;
  const near = state.remoteOwner[group.region] === civ.id ? 0.5 + 0.5 * Math.exp(-state.remoteness[group.region]) : 0.5;
  const small = kin ? 1 : Math.max(0, 1 - share / tuning.hybridShare);
  return { chance: tuning.assimilationRate * close * holding * pressing * near * small, close, holding, pressing, near, small };
}

/**
 * Whether two cultures are kin: most of their descent is from the same starting peoples (an overlap of their ancestry
 * of at least `kinShare`), as sister peoples and a daughter and her forebear are. Kin do not fuse into a hybrid.
 */
export function kin(state: SimulationState, a: number, b: number) {
  const first = new Map(ancestry(state, a).map(entry => [entry.id, entry.share]));
  let overlap = 0;
  for (const entry of ancestry(state, b)) overlap += Math.min(entry.share, first.get(entry.id) ?? 0);
  return overlap >= CULTURE_TUNING.kinShare;
}

/**
 * A realm's peoples (once a year per civilization): smaller peoples of other cultures, and kin of any size, may
 * assimilate into its ruling culture; and a ruling culture and the largest other people, unrelated, that have both
 * been a large part of the realm for long and have grown alike may fuse into a hybrid people (VISION.md "Hybrids").
 * The years a pair has lived together grow while both are large and fade while either is not, and start again only
 * when the pair changes.
 */
export function realmPeoples(state: SimulationState, context: TickContext, civ: Polity) {
  const tuning = CULTURE_TUNING, ruling = civ.culture, rng = context.stream(civ.id, REALM_STREAM);
  const byCulture = new Map<number, PopulationGroup[]>();
  let total = 0;
  for (const id of civ.groups) {
    const group = state.groups[id];
    total += group.size;
    const list = byCulture.get(group.culture);
    if (list) list.push(group); else byCulture.set(group.culture, [group]);
  }
  const people = (groups: PopulationGroup[]) => groups.reduce((sum, group) => sum + group.size, 0);
  const heart = state.groups[civ.core], kinship = new Map<number, boolean>();
  for (const culture of byCulture.keys()) if (culture !== ruling) kinship.set(culture, kin(state, ruling, culture));
  // The largest other people of the realm, and how long it has lived beside the ruling one as a large part of it.
  let partner = -1, partnerPeople = 0;
  for (const [culture, groups] of byCulture) if (culture !== ruling) { const count = people(groups); if (count > partnerPeople || (count === partnerPeople && culture < partner)) { partner = culture; partnerPeople = count; } }
  const rulingShare = people(byCulture.get(ruling) ?? []) / Math.max(1, total), partnerShare = partnerPeople / Math.max(1, total);
  const large = partner >= 0 && !kinship.get(partner) && rulingShare >= tuning.hybridShare && partnerShare >= tuning.hybridShare;
  // A new ruling culture ends the pair (its rulers did not live beside them).
  if (civ.together >= 0 && civ.togetherRuling !== ruling) { civ.together = -1; civ.togetherRuling = -1; civ.togetherYears = 0; }
  if (civ.together >= 0 && civ.together === partner && large) civ.togetherYears++;
  else if (civ.together >= 0) { civ.togetherYears--; if (civ.togetherYears <= 0) { civ.together = -1; civ.togetherRuling = -1; civ.togetherYears = 0; } }
  if (civ.together < 0 && large) { civ.together = partner; civ.togetherRuling = ruling; civ.togetherYears = 1; }
  if (civ.together === partner && large && civ.togetherYears >= tuning.hybridYears) {
    const a = byCulture.get(ruling)!, b = byCulture.get(partner)!;
    const apart = divergence(meanValues(a), meanValues(b));
    if (apart <= tuning.hybridRange && rng.chance(tuning.hybridRate)) { fuse(state, rng, civ, a, b, apart); return; }
  }
  // Assimilation, aggregated into one event per culture a year, with the mean of what drew its people in.
  const taken = new Map<number, { regions: number; people: number; region: number; parts: Record<string, number> }>();
  for (const [culture, groups] of byCulture) {
    if (culture === ruling) continue;
    const share = people(groups) / Math.max(1, total);
    for (const group of groups) {
      const odds = assimilationChance(state, civ, group, heart, share, kinship.get(culture));
      if (!rng.chance(odds.chance)) continue;
      const entry = taken.get(culture) ?? { regions: 0, people: 0, region: group.region, parts: { closeWays: 0, openToChange: 0, realmPresses: 0, nearCourt: 0, smallPeople: 0 } };
      entry.regions++; entry.people += group.size;
      entry.parts.closeWays += odds.close; entry.parts.openToChange += odds.holding; entry.parts.realmPresses += odds.pressing; entry.parts.nearCourt += odds.near; entry.parts.smallPeople += odds.small;
      taken.set(culture, entry);
      setGroupCulture(state, group, ruling);
      // Taking up its ways: their values move toward the heartland's.
      for (const key of VALUE_KEYS) group.values[key] += tuning.assimilationBlend * (heart.values[key] - group.values[key]);
    }
  }
  for (const [culture, entry] of taken) {
    state.metrics.assimilations += entry.regions;
    const factors = Object.fromEntries(Object.entries(entry.parts).map(([factor, sum]) => [factor, sum / entry.regions]));
    state.chronicle.emit({
      type: 'assimilation', actors: [{ id: civ.id, role: 'civ' }], region: entry.region, causes: causes(factors), importance: 0.08,
      data: { culture: state.cultures[culture].name, ruling: state.cultures[ruling].name, civ: civ.name, regions: entry.regions, population: entry.people, one: entry.regions === 1, more: entry.regions > 1, kin: kinship.get(culture) === true },
    });
  }
}

function meanValues(groups: PopulationGroup[]): CultureValues {
  const values = {} as CultureValues;
  let people = 0;
  for (const key of VALUE_KEYS) values[key] = 0;
  for (const group of groups) { people += group.size; for (const key of VALUE_KEYS) values[key] += group.values[key] * group.size; }
  for (const key of VALUE_KEYS) values[key] = people > 0 ? values[key] / people : groups[0]?.values[key] ?? 0.5;
  return values;
}

/**
 * Two peoples of a realm become one (VISION.md "Hybrids"): a new culture with both as parents, weighted by people.
 * Becoming one people brings their ways together: every group's values move `fusionBlend` of the way to the hybrid's,
 * so the new people does not split along the old seam. Their parents' counts wait for their next yearly refresh.
 */
function fuse(state: SimulationState, rng: Rng, civ: Polity, a: PopulationGroup[], b: PopulationGroup[], apart: number) {
  const first = state.cultures[a[0].culture], second = state.cultures[b[0].culture];
  const pa = a.reduce((sum, group) => sum + group.size, 0), pb = b.reduce((sum, group) => sum + group.size, 0), wa = pa / (pa + pb);
  const values = meanValues([...a, ...b]);
  const hybrid = foundHybrid(state, rng, first, second, wa, values);
  for (const group of [...a, ...b]) {
    setGroupCulture(state, group, hybrid.id);
    for (const key of VALUE_KEYS) group.values[key] += CULTURE_TUNING.fusionBlend * (values[key] - group.values[key]);
  }
  hybrid.people = pa + pb; hybrid.regions = a.length + b.length;
  const years = civ.togetherYears;
  civ.together = -1; civ.togetherRuling = -1; civ.togetherYears = 0;
  state.metrics.hybrids++;
  const capital = civ.capital !== null ? state.settlements[civ.capital] : null;
  state.chronicle.emit({
    type: 'hybridCulture', actors: [{ id: civ.id, role: 'civ' }], region: capital?.region ?? a[0].region, causes: causes({ yearsTogether: years / 1000, alike: 1 - apart }), importance: 0.35,
    data: { culture: hybrid.name, first: first.name, second: second.name, civ: civ.name, firstShare: Math.round(wa * 100), secondShare: 100 - Math.round(wa * 100), population: pa + pb },
  });
}
