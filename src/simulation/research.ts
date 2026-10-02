import { landPressure } from './bands.ts';
import { blockedExtraction } from './deposits.ts';
import { farmingPotential } from './food.ts';
import { chooseTarget, knows, learn, remaining, type ResearchContext } from './knowledge.ts';
import type { Polity, SimulationState, TickContext } from './state.ts';
import { TECH_INDEX, TECHS, type Affinity } from './techs.ts';
import { MOBILITY_TUNING, RESEARCH_TUNING } from './tunables.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';

/**
 * The knowledge system (VISION.md "Research", "Diffusion"): every living polity earns research from its people
 * (scaled by contact) and its specialists, spends it on one target chosen by weighted random, and learns faster what
 * its contacts already know. Contacts are polities within two regions (M2's neutral contact rule).
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

/** Polities within the contact radius over land, and over sea where the polity's mobility reaches; nearer is more intense. */
export function refreshContacts(state: SimulationState, polity: Polity) {
  const regions = state.partition.regions, tuning = RESEARCH_TUNING;
  if (stamp.length !== regions.length) { stamp = new Int32Array(regions.length); mark = 0; }
  mark++;
  stamp[polity.region] = mark;
  frontier.length = 0; frontier.push(polity.region);
  const contacts: number[] = [], weights: number[] = [];
  for (let step = 1; step <= tuning.contactRadius && frontier.length; step++) {
    next.length = 0;
    const weight = step <= 1 ? 1 : tuning.farContact;
    const visit = (region: number) => {
      if (stamp[region] === mark) return;
      stamp[region] = mark; next.push(region);
      const other = state.occupant[region];
      if (other >= 0 && other !== polity.id) { contacts.push(other); weights.push(weight); }
    };
    for (const region of frontier) {
      for (const edge of regions[region].neighbors) visit(edge.region);
      if (polity.knowledge.sea > 0) for (const link of regions[region].sea) if (polity.knowledge.sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) visit(link.region);
    }
    [frontier, next] = [next, frontier];
  }
  polity.contacts = contacts; polity.contactWeights = weights; polity.exposure.tech = -1;
}

/** Exposure to the polity's research target, from its cache when nothing it depends on has changed. */
function targetExposure(state: SimulationState, polity: Polity, tech: number) {
  const cache = polity.exposure;
  if (cache.tech !== tech || cache.learned !== state.learnedCount[tech] || cache.deaths !== state.deathCount) {
    cache.tech = tech; cache.learned = state.learnedCount[tech]; cache.deaths = state.deathCount; cache.value = exposureOf(state, polity, tech);
  }
  return cache.value;
}

/** Exposure to a tech: the summed intensity of contacts that know it, at most 1 (VISION.md "exposure"). */
export function exposureOf(state: SimulationState, polity: Polity, tech: number) {
  let exposure = 0;
  for (let at = 0; at < polity.contacts.length; at++) {
    const other = state.polities[polity.contacts[at]];
    if (other.deathTick === null && other.knowledge.known[tech]) exposure += polity.contactWeights[at];
  }
  return Math.min(1, exposure);
}

/** Research points a year: base per person scaled by contact, plus specialists, times the techs' multiplier. */
export function researchRate(polity: Polity, group: { size: number; specialists: number }) {
  const tuning = RESEARCH_TUNING, contacts = Math.min(polity.contacts.length, tuning.contactCap);
  return (tuning.basePerPerson * Math.min(group.size, tuning.basePeople) * (1 + tuning.contactBonus * contacts) + tuning.specialistResearch * group.specialists) * polity.knowledge.multipliers.research;
}

function contextFor(state: SimulationState, polity: Polity): ResearchContext {
  const culture = state.cultures[polity.culture], group = state.groups[polity.group];
  const blocked = new Set<number>();
  for (const [, code] of state.partition.regions[polity.region].sites) {
    const tech = blockedExtraction(polity.knowledge, code);
    if (tech !== null) blocked.add(tech);
  }
  return {
    affinity: state.affinity[polity.region], blocked, rate: researchRate(polity, group),
    foodNeed: Math.max(1 - group.foodSecurity, landPressure(group.size, state.capacity[polity.region])),
    tradition: culture.values.tradition, openness: culture.values.openness, exposure: tech => exposureOf(state, polity, tech),
  };
}

export function research(state: SimulationState, context: TickContext) {
  const cadence = RESEARCH_TUNING.contactMonths;
  // Discoveries take effect after every polity has researched this month, so knowledge moves at most one contact
  // a month (a neighbour's discovery this month counts from next month).
  const learned: { id: number; tech: number; exposure: number }[] = [];
  for (const id of state.living) {
    const polity = state.polities[id], group = state.groups[polity.group], knowledge = polity.knowledge;
    // Yearly (staggered): refresh contacts and reconsider the target; otherwise choose only when there is none.
    if (((context.tick - id) % cadence + cadence) % cadence === 0) {
      refreshContacts(state, polity);
      chooseTarget(knowledge, contextFor(state, polity), context.stream(id));
    } else if (knowledge.target < 0) chooseTarget(knowledge, contextFor(state, polity), context.stream(id));
    if (knowledge.target < 0) continue;
    const tech = knowledge.target, exposure = targetExposure(state, polity, tech);
    knowledge.progress[tech] += researchRate(polity, group) / 12;
    if (remaining(knowledge, exposure) <= 0) learned.push({ id, tech, exposure });
  }
  for (const { id, tech, exposure } of learned) {
    const polity = state.polities[id];
    const reasons = polity.knowledge.reasons, own = Math.min(1, polity.knowledge.progress[tech] / Math.max(TECHS[tech].cost, 1));
    polity.knowledge = learn(polity.knowledge, tech);
    state.learnedCount[tech]++;
    const first = !state.firsts.some(entry => entry.tech === tech);
    if (first) state.firsts.push({ tech, tick: context.tick, polity: id, region: polity.region });
    state.metrics.discoveries++;
    // Why it was chosen (its positive weight factors), then how it was reached: the polity's own research as a share of
    // the full cost, and exposure to contacts who knew it.
    const causes = reasons.filter(reason => reason.weight > 0 && reason.factor !== 'exposure').slice(0, RESEARCH_TUNING.reasonCount).map(reason => ({ factor: reason.factor, weight: reason.weight }));
    causes.push({ factor: 'ownResearch', weight: Math.max(0.001, Math.round(own * 1000) / 1000) });
    if (exposure > 0) causes.push({ factor: 'exposure', weight: Math.round(exposure * 1000) / 1000 });
    state.chronicle.emit({
      type: 'techDiscovered', actors: [{ id, role: 'polity' }], region: polity.region, causes,
      importance: first ? 0.7 : 0.03, data: { tech: TECHS[tech].name, era: TECHS[tech].era, name: polity.name, first },
    });
    // The next target right away (a stream of its own), so no month of research is lost.
    chooseTarget(polity.knowledge, contextFor(state, polity), context.stream(id, 1));
  }
  if (state.agricultureQuarterYear < 0 && state.living.length) {
    let farmers = 0;
    for (const id of state.living) if (state.polities[id].knowledge.known[AGRICULTURE]) farmers++;
    if (farmers * 4 >= state.living.length) state.agricultureQuarterYear = context.tick / 12;
  }
}

/** Living polities that know a tech, for statistics. */
export function shareKnowing(state: SimulationState, name: string) {
  if (!state.living.length) return 0;
  let count = 0;
  for (const id of state.living) if (knows(state.polities[id].knowledge, name)) count++;
  return count / state.living.length;
}
