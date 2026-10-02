import { forgetMap } from './perception.ts';
import { settle } from './bands.ts';
import { learn } from './knowledge.ts';
import type { RegionPartition } from './regions.ts';
import type { SimulationGeography } from './geography.ts';
import { systemStream } from './rng.ts';
import { createSimulation } from './simulation.ts';
import type { SimulationState } from './state.ts';
import { TECH_INDEX } from './techs.ts';

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
