import type { ChronicleEvent } from '../../shared/simulation.ts';
import { foundVillage, move, newGroup, polityPopulation, refuge, regionCapacity, transferGroup } from './bands.ts';
import { meet, reveal, UNKNOWN } from './perception.ts';
import type { Rng } from './rng.ts';
import type { Polity, SimulationState, TickContext } from './state.ts';
import { EXPAND_TUNING, EXPLORE_TUNING, MOBILITY_TUNING } from './tunables.ts';

/**
 * Carrying out what a civilization decided (VISION.md "Expansion", "Migration", "Exploration"). This is physical: it
 * meets the true world, which may differ from what the civilization believed — a region someone else took first, a
 * band that will not be taken in.
 */

/** A civilization expanded (or settled): the gap since its last expansion counts toward the longest. */
export function markExpansion(civ: Polity, tick: number) {
  if (civ.lastExpansion !== null) civ.longestExpansionGap = Math.max(civ.longestExpansionGap, tick - civ.lastExpansion);
  civ.lastExpansion = tick;
}

/** The chance that a tribe's band in the land a civilization expands into joins it (graded, never certain). */
export function absorbChance(civPeople: number, bandPeople: number, tradition: number) {
  const tuning = EXPAND_TUNING, share = civPeople / Math.max(1, civPeople + bandPeople);
  return Math.max(tuning.absorbMin, Math.min(tuning.absorbMax, tuning.absorbBase + tuning.absorbSize * (share - 0.5) - tuning.absorbTradition * (tradition - 0.5)));
}

/**
 * Expand into `target` from `from`: a tribe's band living there is taken in or moves on; otherwise settlers from the
 * source region found a village. Returns what happened, for the decision log.
 */
export function expand(state: SimulationState, context: Pick<TickContext, 'tick'>, rng: Rng, civ: Polity, target: number, from: number, cited: ChronicleEvent['causes']): string {
  const tick = context.tick;
  if (state.owner[target] >= 0) return 'taken by another civilization first';
  if (state.occupant[from] !== civ.id) return 'its own land there is gone';
  const occupant = state.occupant[target];
  if (occupant >= 0) {
    const tribe = state.polities[occupant], band = state.groups[state.groupAt[target]];
    const chance = absorbChance(polityPopulation(state, civ), band.size, state.cultures[tribe.culture].values.tradition);
    // A band with nowhere to go that would feed it stays and joins.
    const to = refuge(state, tribe, band, target);
    if (to < 0 || rng.chance(chance)) {
      transferGroup(state, rng, band, tribe, civ, tick);
      regionCapacity(state, target);
      state.metrics.absorbed++;
      markExpansion(civ, tick);
      state.chronicle.emit({
        type: 'bandAbsorbed', actors: [{ id: tribe.id, role: 'band' }, { id: civ.id, role: 'civ' }], region: target,
        causes: [...cited, ...(to >= 0 ? [] : [{ factor: 'nowhereToGo', weight: 1 }])].slice(0, 4), importance: 0.08,
        data: { name: tribe.name, civ: civ.name, population: band.size, ended: tribe.deathTick !== null },
      });
      return 'took in a band';
    }
    move(state, context, tribe, band, to, { displaced: 1 });
    state.metrics.displaced++;
  }
  const source = state.groups[state.groupAt[from]], tuning = EXPAND_TUNING;
  // As many as the new land feeds well (a share of its capacity), at most a share of the source's people.
  const room = Math.floor(regionCapacity(state, target, civ.knowledge) * tuning.settlerRoom);
  const settlers = Math.min(room, Math.max(tuning.minSettlers, Math.floor(source.size * tuning.settlerShare)));
  if (settlers < tuning.minSettlers) return 'the land is too poor to settle';
  if (source.size - settlers < tuning.minSettlers) return 'too few people to send';
  const group = newGroup(state, civ, target, settlers);
  const carried = Math.floor(source.store * settlers / source.size);
  const flows = state.ledger.food.get(source.id);
  if (flows) flows.carriedOut += carried;
  state.ledger.food.set(group.id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: carried, carriedOut: 0, plantedBefore: 0, sown: 0, harvested: 0, cropsLost: 0 });
  source.store -= carried; group.store = carried;
  source.size -= settlers;
  group.foodSecurity = source.foodSecurity; group.culture = source.culture;
  state.ledger.migrantsOut[from] += settlers; state.ledger.migrantsIn[target] += settlers;
  state.owner[target] = civ.id;
  regionCapacity(state, target);
  state.metrics.expansions++;
  markExpansion(civ, tick);
  state.chronicle.emit({
    type: 'expansion', actors: [{ id: civ.id, role: 'civ' }], region: target, causes: cited, importance: 0.06,
    data: { name: civ.name, from, population: settlers },
  });
  foundVillage(state, rng, civ, target, false, tick, cited);
  return 'expanded';
}

/**
 * An expedition (VISION.md "Exploration"): from its own region with the most unknown neighbours it walks
 * EXPLORE_TUNING.range steps (more with sea reach), each step to the neighbour with the most land it does not know
 * (ties at random), mapping every region it passes and those next to them, and meeting whoever lives on its path.
 */
export function explore(state: SimulationState, tick: number, rng: Rng, civ: Polity, cited: ChronicleEvent['causes']): string {
  const regions = state.partition.regions, map = civ.map, sea = civ.knowledge.sea;
  const unknownAround = (region: number) => regions[region].neighbors.reduce((count, edge) => count + (map.status[edge.region] === UNKNOWN ? 1 : 0), 0);
  const next = (region: number) => {
    const options = regions[region].neighbors.map(edge => edge.region);
    if (sea > 0) for (const link of regions[region].sea) if (sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) options.push(link.region);
    return options;
  };
  let start = -1, most = 0;
  for (const id of civ.groups) {
    const region = state.groups[id].region, count = unknownAround(region);
    if (count > most || (count === most && count > 0 && region < start)) { start = region; most = count; }
  }
  // Nothing unknown next to its own land: set out from the region of its sight that borders the most unknown land.
  if (start < 0) for (const region of map.observed) {
    const count = unknownAround(region);
    if (count > most) { start = region; most = count; }
  }
  if (start < 0) return 'no unknown land within reach';
  let revealed = 0, met = 0, at = start;
  const visited = new Set([start]);
  for (let step = 0; step < EXPLORE_TUNING.range[sea]; step++) {
    const options = next(at).filter(region => !visited.has(region));
    if (!options.length) break;
    const scores = options.map(region => 1 + unknownAround(region) + (map.status[region] === UNKNOWN ? 2 : 0));
    at = options[Math.max(0, rng.weighted(scores))];
    visited.add(at);
    for (const region of [at, ...regions[at].neighbors.map(edge => edge.region)]) if (reveal(state, civ, region, tick)) revealed++;
    const other = state.occupant[at];
    if (other >= 0 && other !== civ.id && !civ.met.has(other)) { meet(state, civ, state.polities[other], at, tick, true); met++; }
  }
  state.metrics.expeditions++;
  state.chronicle.emit({
    type: 'expedition', actors: [{ id: civ.id, role: 'civ' }], region: start, causes: cited, importance: met ? 0.12 : 0.04,
    data: { name: civ.name, regions: revealed, met, metPeoples: met > 0, end: at },
  });
  return revealed ? `mapped ${revealed} regions` : 'found nothing new';
}
