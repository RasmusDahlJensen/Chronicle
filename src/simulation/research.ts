import { coreRegion, landPressure } from './bands.ts';
import { blockedExtraction } from './deposits.ts';
import { observe, shareSurroundings } from './perception.ts';
import { farmingPotential } from './food.ts';
import { advance, chooseTarget, knows, learn, remaining, speedOf, type ResearchContext } from './knowledge.ts';
import type { Polity, SimulationState, TickContext } from './state.ts';
import { TECH_INDEX, TECHS, type Affinity } from './techs.ts';
import { MOBILITY_TUNING, RESEARCH_TUNING, SHARE_TUNING, STABILITY_TUNING } from './tunables.ts';
import { unrestDepth } from './pressure.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';

/**
 * The knowledge system (VISION.md "Research", "Paths, not a timeline"): every living polity earns research from its
 * people (scaled by contact) and its specialists and spends it on one target chosen by weighted random. Nothing is
 * learned from neighbours by contact alone: research goes faster only on what a people sharing its knowledge knows
 * (an exchange it agreed to) and, a little, on techs of eras behind the most advanced it knows of. Contacts are
 * polities it has met within two regions (M2's neutral contact rule).
 */
const AGRICULTURE = TECH_INDEX.get('Agriculture')!;

/** Static environment conditions of each region (VISION.md "environment" weights). */
export function regionAffinities(state: Pick<SimulationState, 'geography' | 'partition' | 'food'>): Set<Affinity>[] {
  const { geography, partition, food } = state, tuning = RESEARCH_TUNING;
  const potentials = partition.regions.map(region => farmingPotential(food, region.id)).sort((a, b) => a - b);
  const fertile = potentials[Math.floor(potentials.length * tuning.fertileQuantile)] ?? Number.POSITIVE_INFINITY;
  const site = (code: string) => RESOURCE_IDS.indexOf(code as typeof RESOURCE_IDS[number]) + 1;
  return partition.regions.map(region => {
    const flags = new Set<Affinity>();
    let grass = 0, forest = 0, rough = 0, arid = 0, temperature = 0;
    for (const cell of region.cells) {
      const biome = WORLD_BIOMES[geography.biome[cell]];
      if (biome === 'grassland' || biome === 'savanna' || biome === 'steppe') grass++;
      if (biome === 'forest' || biome === 'boreal' || biome === 'rainforest') forest++;
      if (biome === 'mountain' || biome === 'snow') rough++;
      if (biome === 'desert' || biome === 'steppe') arid++;
      temperature += geography.temperature[cell] / 10;
    }
    const share = (count: number) => count / region.cells.length;
    if (region.coastal) flags.add('coastal');
    if (region.riverTier >= 1 || region.openLake) flags.add('riverOrLake');
    if (farmingPotential(food, region.id) >= fertile && (region.riverTier >= tuning.fertileRiverTier || region.openLake)) flags.add('fertileRiver');
    if (share(grass) >= tuning.affinityShare) flags.add('grassland');
    if (share(forest) >= tuning.affinityShare) flags.add('forest');
    if (share(rough) >= tuning.roughShare || region.defensibility >= tuning.roughDefensibility) flags.add('rough');
    if (share(arid) >= tuning.affinityShare) flags.add('arid');
    if (temperature / region.cells.length < tuning.coldCelsius) flags.add('cold');
    for (const [, code] of region.sites) {
      if (code === site('grain')) flags.add('grainSite');
      if (code === site('game')) flags.add('gameSite');
      if (code === site('fish')) flags.add('fishSite');
    }
    return flags;
  });
}

// Reused across calls: a visit stamp per region, the search frontier and the contacts found (no allocation per search).
let stamp = new Int32Array(0), mark = 0, frontier: number[] = [], next: number[] = [];

/**
 * Polities it has met within the contact radius of any of its regions, over land and over sea where its knowledge
 * reaches, each counted once; and the most advanced era it knows of (its own or a living people's it has met).
 */
export function refreshContacts(state: SimulationState, polity: Polity) {
  const regions = state.partition.regions, tuning = RESEARCH_TUNING;
  if (stamp.length !== regions.length) { stamp = new Int32Array(regions.length); mark = 0; }
  mark++;
  frontier.length = 0;
  for (const id of polity.groups) { const region = state.groups[id].region; stamp[region] = mark; frontier.push(region); }
  const contacts: number[] = [], counted = new Set<number>();
  for (let step = 1; step <= tuning.contactRadius && frontier.length; step++) {
    next.length = 0;
    const visit = (region: number) => {
      if (stamp[region] === mark) return;
      stamp[region] = mark; next.push(region);
      const other = state.occupant[region];
      // Only polities it has met (M3: contact is meeting; M2's neutral form was nearness alone).
      if (other >= 0 && other !== polity.id && !counted.has(other) && polity.met.has(other)) { counted.add(other); contacts.push(other); }
    };
    for (const region of frontier) {
      for (const edge of regions[region].neighbors) visit(edge.region);
      if (polity.knowledge.sea > 0) for (const link of regions[region].sea) if (polity.knowledge.sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) visit(link.region);
    }
    [frontier, next] = [next, frontier];
  }
  polity.contacts = contacts;
  let era = polity.knowledge.era;
  for (const [other] of polity.met) { const them = state.polities[other]; if (them.deathTick === null) era = Math.max(era, them.knowledge.era); }
  polity.frontierEra = era;
}

/** A living people with an exchange in force that knows the tech, or −1 (VISION.md "Sharing knowledge"). */
export function teacherOf(state: SimulationState, polity: Polity, tech: number) {
  for (const [other, until] of polity.exchanges) {
    if (until <= state.tick) continue;
    const them = state.polities[other];
    if (them.deathTick === null && them.knowledge.known[tech]) return other;
  }
  return -1;
}

/** Exchanges that have run out, or whose other side is gone, are dropped (both sides end on the same tick). */
function pruneExchanges(state: SimulationState, polity: Polity) {
  for (const [other, until] of polity.exchanges) if (until <= state.tick || state.polities[other].deathTick !== null) polity.exchanges.delete(other);
  for (const [other, tick] of polity.exchangeRefused) if (state.tick - tick >= SHARE_TUNING.refusedYears * 12) polity.exchangeRefused.delete(other);
}

/**
 * Where a polity's discovery happens, for the record of firsts and the event alike: where its people live in the
 * conditions that drew it to the tech — the region with the most people × the strength of the tech's environment
 * affinities there (fertile river land weighs 40× for Agriculture, a stream 1.5×) — else its heartland. Fixed in
 * advance for every tech, the same weights that drew the polity's choice; not picked after the fact.
 */
function discoveryRegion(state: SimulationState, polity: Polity, tech: number) {
  const affinities = Object.entries(TECHS[tech].affinity ?? {}).filter(([, value]) => value > 1) as [Affinity, number][];
  let best = coreRegion(state, polity), most = 0;
  for (const id of polity.groups) {
    const group = state.groups[id];
    let strength = 1;
    for (const [condition, value] of affinities) if (state.affinity[group.region].has(condition)) strength *= value;
    if (strength > 1 && group.size * strength > most) { best = group.region; most = group.size * strength; }
  }
  return best;
}

/** People whose experience counts toward base research: all of them up to a community's size, then with diminishing returns. */
export function researchPeople(people: number) {
  const tuning = RESEARCH_TUNING;
  return people <= tuning.basePeople ? people : tuning.basePeople * (people / tuning.basePeople) ** tuning.scalePower;
}

/**
 * Research points a year: base research (experience and tinkering) from the polity's people, with diminishing returns
 * beyond a community's size and scaled by contact, plus its specialists, times the techs' multiplier. A large people
 * researches faster than a small one, but not in proportion: spreading over more land does not by itself make a
 * people inventive.
 */
export function researchRate(state: SimulationState, polity: Polity) {
  const tuning = RESEARCH_TUNING, contacts = Math.min(polity.contacts.length, tuning.contactCap);
  let people = 0, specialists = 0;
  // Specialists in regions in unrest research less (VISION.md "Stability": lower output and research).
  for (const id of polity.groups) { const group = state.groups[id]; people += group.size; specialists += group.specialists * (1 - STABILITY_TUNING.researchLoss * unrestDepth(state, group.region)); }
  return (tuning.basePerPerson * researchPeople(people) * (1 + tuning.contactBonus * contacts) + tuning.specialistResearch * specialists) * polity.knowledge.multipliers.research;
}

/** What the polity's choice of research sees: the conditions of all its land, its need for food (people-weighted), its culture. */
function contextFor(state: SimulationState, polity: Polity): ResearchContext {
  const culture = state.cultures[polity.culture];
  const blocked = new Set<number>(), affinity = new Map<Affinity, number>();
  let people = 0, need = 0;
  for (const id of polity.groups) {
    const group = state.groups[id], region = group.region;
    for (const flag of state.affinity[region]) affinity.set(flag, (affinity.get(flag) ?? 0) + group.size);
    for (const [, code] of state.partition.regions[region].sites) {
      const tech = blockedExtraction(polity.knowledge, code);
      if (tech !== null) blocked.add(tech);
    }
    people += group.size; need += group.size * Math.max(1 - group.foodSecurity, landPressure(group.size, state.capacity[region]));
  }
  for (const [flag, living] of affinity) affinity.set(flag, people > 0 ? living / people : 0);
  return {
    affinity, blocked, rate: researchRate(state, polity), foodNeed: people > 0 ? need / people : 0,
    tradition: culture.values.tradition, openness: culture.values.openness, shared: tech => teacherOf(state, polity, tech) >= 0,
    frontier: polity.frontierEra,
  };
}

export function research(state: SimulationState, context: TickContext) {
  const cadence = RESEARCH_TUNING.contactMonths;
  // Discoveries take effect after every polity has researched this month, so a partner's discovery this month helps
  // from next month (what a partner gained by a tribe joining it earlier this month, in the population system, helps now).
  const learned: { id: number; tech: number; teacher: number }[] = [];
  // Sight first, so contacts and choices this month see the world as it is now (VISION.md: observed, refreshed every tick).
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.map.dirty || polity.map.sea !== polity.knowledge.sea || ((context.tick - id) % cadence + cadence) % cadence === 0) observe(state, polity, context.tick);
  }
  for (const id of state.living) {
    const polity = state.polities[id], knowledge = polity.knowledge;
    // Yearly (staggered): refresh contacts and reconsider the target; otherwise choose only when there is none.
    if (((context.tick - id) % cadence + cadence) % cadence === 0) {
      if (polity.kind === 'civ') shareSurroundings(state, polity, context.tick);
      pruneExchanges(state, polity);
      refreshContacts(state, polity);
      chooseTarget(knowledge, contextFor(state, polity), context.stream(id));
    } else if (knowledge.target < 0) chooseTarget(knowledge, contextFor(state, polity), context.stream(id));
    if (knowledge.target < 0) continue;
    const tech = knowledge.target, culture = state.cultures[polity.culture].values;
    advance(knowledge, researchRate(state, polity) / 12, speedOf(tech, { shared: target => teacherOf(state, polity, target) >= 0, frontier: polity.frontierEra, openness: culture.openness }));
    // The partner that helped is named now, before anyone's discoveries this month take effect.
    if (remaining(knowledge) <= 0) learned.push({ id, tech, teacher: knowledge.taught[tech] > 0 ? teacherOf(state, polity, tech) : -1 });
  }
  for (const { id, tech, teacher } of learned) {
    const polity = state.polities[id], before = polity.knowledge;
    const reasons = before.reasons, total = Math.max(before.progress[tech], 1e-9);
    const taught = before.taught[tech] / total, caught = before.caught[tech] / total;
    const sea = before.sea;
    polity.knowledge = learn(polity.knowledge, tech);
    if (polity.knowledge.sea > sea) polity.seaTick = context.tick;
    if (tech === AGRICULTURE && before.taught[tech] === 0) state.metrics.agricultureInventions++;
    const first = !state.firsts.some(entry => entry.tech === tech);
    const place = discoveryRegion(state, polity, tech);
    if (first) state.firsts.push({ tech, tick: context.tick, polity: id, region: place });
    state.metrics.discoveries++;
    // Why it was chosen (its positive weight factors), then how it was reached: the shares of its progress from its own
    // research, from a sharing partner's help and from catching up.
    const causes = reasons.filter(reason => reason.weight > 0 && reason.factor !== 'sharedKnowledge').slice(0, RESEARCH_TUNING.reasonCount).map(reason => ({ factor: reason.factor, weight: reason.weight }));
    const share = (value: number) => Math.round(value * 1000) / 1000;
    causes.push({ factor: 'ownResearch', weight: Math.max(0.001, share(1 - taught - caught)) });
    if (taught > 0) causes.push({ factor: 'sharedKnowledge', weight: Math.max(0.001, share(taught)) });
    if (caught > 0) causes.push({ factor: 'catchUp', weight: Math.max(0.001, share(caught)) });
    // The partner that helped, when one still shares with it (an exchange can run out before the tech is learned).
    const actors = teacher >= 0 ? [{ id, role: 'polity' }, { id: teacher, role: 'teacher' }] : [{ id, role: 'polity' }];
    state.chronicle.emit({
      type: 'techDiscovered', actors, region: place, causes, importance: first ? 0.7 : 0.03,
      data: { tech: TECHS[tech].name, era: TECHS[tech].era, name: polity.name, first, taught: teacher >= 0, ...(teacher >= 0 ? { teacher: state.polities[teacher].name } : {}) },
    });
    // The next target right away (a stream of its own), so no month of research is lost.
    chooseTarget(polity.knowledge, contextFor(state, polity), context.stream(id, 1));
  }
  // When farming takes hold: a quarter of the world's people live in polities that know Agriculture (VISION.md M2,
  // changed after the M3 review at the user's decision; it counted polities before).
  if (state.agricultureQuarterYear < 0 && state.living.length) {
    let farmers = 0, people = 0;
    for (const id of state.living) {
      const polity = state.polities[id];
      for (const groupId of polity.groups) { const size = state.groups[groupId].size; people += size; if (polity.knowledge.known[AGRICULTURE]) farmers += size; }
    }
    if (people > 0 && farmers * 4 >= people) state.agricultureQuarterYear = context.tick / 12;
  }
}

/** Living polities that know a tech, for statistics. */
export function shareKnowing(state: SimulationState, name: string) {
  if (!state.living.length) return 0;
  let count = 0;
  for (const id of state.living) if (knows(state.polities[id].knowledge, name)) count++;
  return count / state.living.length;
}
