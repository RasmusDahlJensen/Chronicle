import type { ChronicleEvent } from '../../shared/simulation.ts';
import { greatCircleKm } from './geography.ts';
import { createName } from './names.ts';
import { harborRegions, KNOWN, lossChance, meet, reveal, UNKNOWN } from './perception.ts';
import type { Rng } from './rng.ts';
import type { Polity, SimulationState } from './state.ts';
import { VOYAGE_TUNING } from './tunables.ts';

/**
 * Overseas voyages (VISION.md "Overseas voyages": the Columbus moments; M5.6). A civilization that knows Sailing and
 * holds a harbor sends a voyage toward unknown coasts at its decision step (`decisions/choose.ts` weighs it from its
 * view, which knows its harbors and reach, never what lies beyond). The voyage meets the true world: it may be lost at
 * sea, find only open sea, or map a strip of an unknown coast and meet the peoples living there. Each is a chronicle
 * event naming its explorer.
 */

/**
 * Where a civilization's voyages could head (M5.6): each coast within its reach of one of its harbors (great-circle from
 * the nearest) that it does not know, or that it knows to hold a people it has not met, with that harbor, the distance
 * and the weight of choosing it: nearer likelier (1 ÷ km), and `otherLand` times likelier on a landmass where it holds
 * no land. Ascending by region.
 */
export function voyageTargets(state: SimulationState, civ: Polity) {
  const tuning = VOYAGE_TUNING, sea = civ.knowledge.sea, regions = state.partition.regions, harbors = harborRegions(state, civ);
  const targets: { region: number; harbor: number; km: number; weight: number }[] = [];
  if (sea < 1 || !harbors.length) return targets;
  const reachKm = tuning.reachKm[sea], held = new Set(civ.groups.map(id => regions[state.groups[id].region].landmass));
  for (const region of regions) {
    if (!region.coastal) continue;
    const status = civ.map.status[region.id];
    if (status !== UNKNOWN) {
      // Known: only a coast it has heard holds a people it has not met.
      const occupant = status === KNOWN ? civ.map.snapshots.get(region.id)?.occupant ?? -1 : -1;
      if (occupant < 0 || occupant === civ.id || civ.met.has(occupant)) continue;
    }
    let harbor = -1, km = Number.POSITIVE_INFINITY;
    for (const from of harbors) {
      const here = greatCircleKm(state.geography, regions[from].centroid, region.centroid);
      if (here < km) { km = here; harbor = from; }
    }
    if (km > reachKm) continue;
    targets.push({ region: region.id, harbor, km, weight: (held.has(region.landmass) ? 1 : tuning.otherLand) / Math.max(1, km) });
  }
  return targets;
}

/**
 * `civ` sends a voyage (its decision) toward one of its `voyageTargets`, drawn by weight, from that target's harbor.
 * Lost at sea (by distance and its sea reach), it is an event and nothing is learned; arrived, it maps the coast it
 * reached and the nearest coastal regions of that landmass (`strip`), and meets whoever lives there. With nowhere to
 * head it sails half its reach and finds only open sea (if it is not lost). Returns what happened, for the decision log.
 */
export function voyage(state: SimulationState, tick: number, rng: Rng, civ: Polity, cited: ChronicleEvent['causes']): string {
  const tuning = VOYAGE_TUNING, sea = civ.knowledge.sea, regions = state.partition.regions, harbors = harborRegions(state, civ);
  if (sea < 1 || !harbors.length) return 'it has no harbor to sail from';
  civ.voyageTick = tick;
  state.metrics.voyages++;
  const held = new Set(civ.groups.map(id => regions[state.groups[id].region].landmass)), targets = voyageTargets(state, civ);
  const explorer = createName(rng, state.cultures[civ.culture].language);
  const chosen = targets.length ? targets[Math.max(0, rng.weighted(targets.map(entry => entry.weight)))] : null;
  const harbor = chosen?.harbor ?? harbors[0], km = chosen?.km ?? tuning.reachKm[sea] / 2, harborName = harborSettlementName(state, civ, harbor);
  if (rng.chance(lossChance(sea, km))) {
    state.metrics.voyagesLost++;
    state.chronicle.emit({
      type: 'voyageLost', actors: [{ id: civ.id, role: 'civ' }], region: harbor, causes: cited, importance: 0.06,
      data: { explorer, from: harborName, km: Math.round(km) },
    });
    return `${explorer}'s voyage was lost at sea`;
  }
  if (!chosen) {
    civ.emptyVoyages++; state.metrics.voyagesEmpty++;
    return `${explorer}'s voyage found only open sea`;
  }
  civ.emptyVoyages = 0;
  // The coast it reached, and the nearest coastal regions of that landmass (by steps along the land).
  const target = chosen.region, landmass = regions[target].landmass, known = civ.map.status.slice(), strip = [target], seen = new Set([target]);
  for (let at = 0; at < strip.length && strip.length < tuning.strip; at++) {
    for (const edge of regions[strip[at]].neighbors) {
      if (seen.has(edge.region) || regions[edge.region].landmass !== landmass) continue;
      seen.add(edge.region);
      if (regions[edge.region].coastal) strip.push(edge.region);
      if (strip.length >= tuning.strip) break;
    }
  }
  let mapped = 0, met = 0;
  for (const region of strip) {
    if (reveal(state, civ, region, tick)) mapped++;
    const other = state.occupant[region];
    if (other >= 0 && other !== civ.id && !civ.met.has(other)) { meet(state, civ, state.polities[other], region, tick, true); met++; }
  }
  const otherLand = !held.has(landmass), newLand = !regions.some(region => region.landmass === landmass && known[region.id] !== UNKNOWN);
  if (otherLand) { state.metrics.voyagesOtherLand++; state.metrics.voyageContacts += met; }
  if (newLand) state.metrics.voyagesNewLand++;
  // A voyage stands out by what it found: peoples met overseas, or a large land new to it.
  const large = (state.partition.landmasses[landmass]?.regions.length ?? 0) >= tuning.largeLand;
  state.chronicle.emit({
    type: 'newLandsDiscovered', actors: [{ id: civ.id, role: 'civ' }], region: target, causes: cited,
    importance: met && otherLand ? 0.5 : newLand && large ? 0.35 : met ? 0.15 : newLand ? 0.12 : otherLand ? 0.08 : 0.04,
    data: { explorer, from: harborName, km: Math.round(km), regions: mapped, met, metOne: met === 1, metMany: met > 1, newLand, farCoast: !newLand, large, otherLand },
  });
  return `${explorer} reached ${newLand ? 'new lands' : 'a far coast'} ${Math.round(km)} km away${met ? `, meeting ${met === 1 ? 'a new people' : `${met} new peoples`}` : ''}`;
}

/** The name of a civilization's largest living settlement in a region (its harbor town). */
function harborSettlementName(state: SimulationState, civ: Polity, region: number) {
  let name = '', urban = -1;
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive' && settlement.owner === civ.id && settlement.urban > urban) { name = settlement.name; urban = settlement.urban; }
  }
  return name || `region ${region}`;
}
