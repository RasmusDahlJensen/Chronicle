import type { MapKnowledge, Polity, SimulationState } from './state.ts';
import { MOBILITY_TUNING } from './tunables.ts';

/**
 * What each polity knows of the world (VISION.md "Knowledge of the world"), and the query layer through which choices
 * must read it. A polity sees its own regions, their land neighbours and the sea crossings its knowledge reaches.
 * A civilization remembers a region that leaves its sight as it was then (a snapshot); a tribe keeps only what is in
 * sight. Two polities meet when one sees where the other lives, and neighbouring civilizations tell each other what
 * they see. Physical systems may read the true world; decision code reads only `regionView`, `knownRegions` and
 * `hasMet`.
 */
export const UNKNOWN = 0, KNOWN = 1, OBSERVED = 2;

export function emptyMap(regions: number): MapKnowledge {
  return { status: new Uint8Array(regions), observed: [], snapshots: new Map(), dirty: true, sea: 0 };
}

/** A region as a polity knows it: live when in sight, as last seen when remembered; null when unknown. */
export interface RegionView { region: number; status: 'known' | 'observed'; occupant: number; owner: number; seen: number }

export function regionView(state: SimulationState, observer: Polity, region: number): RegionView | null {
  const status = observer.map.status[region];
  if (status === OBSERVED) return { region, status: 'observed', occupant: state.occupant[region], owner: state.owner[region], seen: state.tick };
  if (status !== KNOWN) return null;
  const snapshot = observer.map.snapshots.get(region)!;
  return { region, status: 'known', occupant: snapshot.occupant, owner: snapshot.owner, seen: snapshot.tick };
}

/** Every region the polity knows, in sight or remembered, ascending. */
export function knownRegions(observer: Polity) {
  const regions: number[] = [];
  for (let region = 0; region < observer.map.status.length; region++) if (observer.map.status[region] !== UNKNOWN) regions.push(region);
  return regions;
}

export const knownRegionCount = (observer: Polity) => observer.map.observed.length + observer.map.snapshots.size;

export const hasMet = (observer: Polity, other: number) => observer.met.has(other);

// Reused across refreshes: a visit stamp per region and the sight being built.
let stamp = new Int32Array(0), mark = 0;
const sight: number[] = [];

/** A region the polity has just moved into or settled is in sight at once (its neighbours join at the next refresh). */
export function seeRegion(polity: Polity, region: number) {
  const map = polity.map;
  map.dirty = true;
  if (map.status[region] === OBSERVED) return;
  map.snapshots.delete(region);
  map.status[region] = OBSERVED;
  let at = map.observed.length;
  while (at > 0 && map.observed[at - 1] > region) at--;
  map.observed.splice(at, 0, region);
}

/** A group of the polity left a region or died out: its sight is rebuilt at the next refresh. */
export function lookAgain(polity: Polity) { polity.map.dirty = true; }

/**
 * Monthly, for polities whose regions or sea reach changed, and yearly for all (sea crossings let one see another
 * that cannot see back): the polity's sight now. Regions that leave it are remembered by a civilization (as they are at this moment,
 * the last it saw of them) and forgotten by a tribe. Anyone living in sight whom it has not met, it meets.
 */
export function observe(state: SimulationState, polity: Polity, tick: number) {
  const regions = state.partition.regions, map = polity.map, sea = polity.knowledge.sea;
  if (stamp.length !== regions.length) { stamp = new Int32Array(regions.length); mark = 0; }
  mark++;
  sight.length = 0;
  const add = (region: number) => { if (stamp[region] !== mark) { stamp[region] = mark; sight.push(region); } };
  for (const id of polity.groups) {
    const here = regions[state.groups[id].region];
    add(here.id);
    for (const edge of here.neighbors) add(edge.region);
    if (sea > 0) for (const link of here.sea) if (sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) add(link.region);
  }
  map.dirty = false; map.sea = sea;
  const remembers = polity.kind === 'civ';
  for (const region of map.observed) {
    if (stamp[region] === mark) continue;
    if (remembers) { map.status[region] = KNOWN; map.snapshots.set(region, { occupant: state.occupant[region], owner: state.owner[region], tick }); }
    else map.status[region] = UNKNOWN;
  }
  sight.sort((a, b) => a - b);
  for (const region of sight) { if (map.status[region] === KNOWN) map.snapshots.delete(region); map.status[region] = OBSERVED; }
  map.observed = sight.slice();
  for (const region of map.observed) {
    const other = state.occupant[region];
    if (other >= 0 && other !== polity.id && !polity.met.has(other)) meet(state, polity, state.polities[other], region, tick);
  }
}

/** First contact: mutual, recorded once per pair, at the region where it happened. */
function meet(state: SimulationState, polity: Polity, other: Polity, region: number, tick: number) {
  polity.met.set(other.id, tick); other.met.set(polity.id, tick);
  state.metrics.firstContacts++;
  const landmass = state.partition.regions[region].landmass;
  const overSea = !polity.groups.some(id => state.partition.regions[state.groups[id].region].landmass === landmass);
  state.chronicle.emit({
    type: 'firstContact', actors: [{ id: polity.id, role: 'a' }, { id: other.id, role: 'b' }], region,
    causes: [{ factor: overSea ? 'seaReach' : 'sharedBorder', weight: 1 }],
    // Meeting a people across the sea is rare and a "first" for both (VISION.md "Importance score").
    importance: overSea ? 0.5 : 0.05, data: { name: polity.name, other: other.name, sea: overSea },
  });
}

/** A breakaway tribe knows its parent and everyone its parent knew; they learn of it too. */
export function inheritContacts(state: SimulationState, child: Polity, parent: Polity, tick: number) {
  for (const [id] of parent.met) {
    const other = state.polities[id];
    if (other.deathTick !== null) continue;
    child.met.set(id, tick); other.met.set(child.id, tick);
  }
  child.met.set(parent.id, tick); parent.met.set(child.id, tick);
}

/**
 * Yearly, for a civilization: each polity in its sight tells it what that polity sees ("neighbours learn of each
 * other's immediate surroundings"). Regions it does not see itself become known as they are now, unless it already
 * has a view at least as recent. Hearing of a people is not meeting them.
 */
export function shareSurroundings(state: SimulationState, polity: Polity, tick: number) {
  const map = polity.map, told = new Set<number>();
  for (const region of map.observed) {
    const other = state.occupant[region];
    if (other < 0 || other === polity.id || told.has(other)) continue;
    told.add(other);
    for (const seen of state.polities[other].map.observed) {
      if (map.status[seen] === OBSERVED) continue;
      const snapshot = map.snapshots.get(seen);
      if (snapshot && snapshot.tick >= tick) continue;
      map.status[seen] = KNOWN;
      map.snapshots.set(seen, { occupant: state.occupant[seen], owner: state.owner[seen], tick });
    }
  }
}

/** A dead polity's map is released; who it met stays as history. */
export function forgetMap(polity: Polity) {
  polity.map = emptyMap(0);
}
