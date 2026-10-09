import { simulationDate, type DevScenario } from '../../shared/simulation.ts';
import { forgetMap } from './perception.ts';
import { settle } from './bands.ts';
import { heartOf, splitCulture, summarize } from './culture.ts';
import { strikeDrought } from './environment.ts';
import { canFound, FOUNDING_STREAM, foundingTrigger, foundReligion } from './faith.ts';
import { checkInvariants } from './invariants.ts';
import { learn } from './knowledge.ts';
import type { RegionPartition } from './regions.ts';
import { discover, teacherOf } from './research.ts';
import type { SimulationGeography } from './geography.ts';
import { systemStream } from './rng.ts';
import { razeInScenario } from './ravages.ts';
import { livingSettlements } from './settlements.ts';
import { createSimulation } from './simulation.ts';
import type { PopulationGroup, SimulationState, TickContext } from './state.ts';
import { TECH_INDEX, TECHS } from './techs.ts';
import { ENVIRONMENT_TUNING } from './tunables.ts';

/**
 * TEST FIXTURE — not a product feature. VISION.md M3's acceptance scenario: one settled civilization alone on the
 * largest landmass. Built from a normal start with the real rules: of the starting bands, the one on the largest
 * landmass whose region feeds the most people is kept and every other band is removed before the first month; the
 * kept band learns Neolithic farming and herding and settles at once. History then runs with the normal systems.
 */
export function soleCivilization(geography: SimulationGeography, partition: RegionPartition, seedText: string): SimulationState {
  const state = createSimulation(geography, partition, seedText);
  const landmass = partition.landmasses.reduce((best, entry) => entry.regions.length > best.regions.length ? entry : best, partition.landmasses[0]).id;
  const candidates = state.living.filter(id => partition.regions[state.groups[state.polities[id].core].region].landmass === landmass);
  if (!candidates.length) throw new Error(`No starting band on the largest landmass of ${seedText}.`);
  const kept = candidates.reduce((best, id) => state.capacity[state.groups[state.polities[id].core].region] > state.capacity[state.groups[state.polities[best].core].region] ? id : best, candidates[0]);
  for (const id of state.living.slice()) {
    if (id === kept) continue;
    const polity = state.polities[id];
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      state.occupant[group.region] = -1; state.groupAt[group.region] = -1;
      group.size = 0; group.store = 0; group.deathTick = 0;
    }
    polity.groups = []; polity.deathTick = 0; forgetMap(polity);
    state.living.splice(state.living.indexOf(id), 1);
  }
  const tribe = state.polities[kept];
  for (const name of ['Pottery', 'Agriculture', 'Animal husbandry']) if (!tribe.knowledge.known[TECH_INDEX.get(name)!]) tribe.knowledge = learn(tribe.knowledge, TECH_INDEX.get(name)!);
  settle(state, { tick: 0, stream: (entity, salt) => systemStream(state.seed, 0, 2, entity, salt) }, tribe, { farming: 1, yearsHere: 1 });
  state.chronicle.flush(0);
  return state;
}

/** Random streams of development controls: one system key per use, beyond the real systems'. */
const DEV_STREAMS = 1_000;

/**
 * DEVELOPMENT CONTROL — not a product feature (Dev 02). A scenario trigger makes something happen in `region` now,
 * through the same rules as when it happens by itself, so a feature can be tried without simulating until it does:
 * - `drought`: the longest drought there is strikes the region and the habitable regions beside it;
 * - `research`: the region's people finish what they are researching and learn it;
 * - `foundReligion`: the region's civilization founds a religion (even before it knows Organized religion);
 * - `raze`: a settlement of the region's civilization (not its capital) is razed as in war, the region devastated;
 * - `splitCulture`: the region's people and their neighbours of the same culture in the same realm split off as a
 *   daughter culture (some of their culture must stay behind).
 * Used between months, from the first month on (before it there is no month's accounting to check): its events are
 * dated to the month just simulated and committed at once, and the invariants are checked after. Each use is a `devScenario` event before what it caused and counts in `state.devActions` (which the
 * state hash includes), so an altered history always says so. Returns why it was refused (nothing changed), or null.
 */
export function applyScenario(state: SimulationState, scenario: DevScenario, region: number): string | null {
  if (!(Number.isInteger(region) && region >= 0 && region < state.partition.regions.length)) return `There is no region ${region}.`;
  if (state.tick === 0) return 'Nothing has happened yet: simulate a month first.';
  const tick = state.tick - 1, { year, month } = simulationDate(tick), system = DEV_STREAMS + state.devActions;
  const context: TickContext = { tick, year, month, stream: (entity, salt) => systemStream(state.seed, tick, system, entity, salt) };
  const groupId = state.groupAt[region], group = groupId >= 0 ? state.groups[groupId] : null;
  const polity = group ? state.polities[group.polity] : null;
  let apply: () => void;
  if (scenario === 'drought') {
    if (!state.habitable[region]) return `Nobody could live in region ${region}; droughts strike habitable land.`;
    const struck = [region, ...state.partition.regions[region].neighbors.map(edge => edge.region).filter(at => state.habitable[at])];
    apply = () => strikeDrought(state, [...new Set(struck)], ENVIRONMENT_TUNING.droughtYears, 'developmentControl');
  } else if (!group || !polity) return `Nobody lives in region ${region}.`;
  else if (scenario === 'research') {
    const knowledge = polity.knowledge, tech = knowledge.target;
    if (tech < 0) return `The ${polity.name} are not researching anything now.`;
    apply = () => {
      knowledge.progress[tech] = Math.max(knowledge.progress[tech], TECHS[tech].cost);
      discover(state, context, polity.id, tech, knowledge.taught[tech] > 0 ? teacherOf(state, polity, tech) : -1);
    };
  } else if (scenario === 'raze') {
    if (polity.kind !== 'civ') return `The ${polity.name} are a tribe; only a civilization's settlements are razed.`;
    const target = livingSettlements(state, region).find(settlement => !settlement.capital);
    if (!target) return `Region ${region} has no settlement but its realm's capital to raze.`;
    apply = () => razeInScenario(state, target.id);
  } else if (scenario === 'foundReligion') {
    if (polity.kind !== 'civ') return `The ${polity.name} are a tribe; only civilizations found religions.`;
    apply = () => foundReligion(state, context, context.stream(polity.id, FOUNDING_STREAM), polity, foundingTrigger(state, polity));
  } else {
    const culture = state.cultures[group.culture], members: PopulationGroup[] = [];
    for (const id of state.living) for (const at of state.polities[id].groups) if (state.groups[at].culture === culture.id) members.push(state.groups[at]);
    const area = [group];
    for (const edge of state.partition.regions[region].neighbors) {
      const other = state.groupAt[edge.region];
      if (other >= 0 && !area.includes(state.groups[other]) && state.groups[other].polity === polity.id && state.groups[other].culture === culture.id) area.push(state.groups[other]);
    }
    if (area.length === members.length) return `All of the ${culture.name} live here; some must stay behind for a split.`;
    apply = () => {
      splitCulture(state, context.stream(culture.id), culture, heartOf(state, culture, members), area);
      // What the parent is without them (as after a split by itself).
      summarize(culture, members.filter(member => !area.includes(member)));
    };
  }
  state.chronicle.emit({
    type: 'devScenario', actors: polity ? [{ id: polity.id, role: polity.kind === 'civ' ? 'civ' : 'band' }] : [], region, importance: 0.5,
    data: { scenario, polity: polity?.name ?? '', drought: scenario === 'drought', research: scenario === 'research', foundReligion: scenario === 'foundReligion', splitCulture: scenario === 'splitCulture', raze: scenario === 'raze', unready: scenario === 'foundReligion' && polity !== null && !canFound(polity) },
  });
  apply();
  state.devActions++;
  state.chronicle.flush(tick);
  checkInvariants(state);
  return null;
}
