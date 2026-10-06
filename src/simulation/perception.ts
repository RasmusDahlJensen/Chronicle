import { BUILDINGS, buildingKnown } from './buildings.ts';
import { cultureSimilarity } from './culture.ts';
import { incomeOf, upkeepOf } from './economy.ts';
import { livingSettlements } from './settlements.ts';
import { greatCircleKm } from './geography.ts';
import { landPressure } from './pressure.ts';
import type { CultureValues, MapKnowledge, Polity, SimulationState } from './state.ts';
import { MOBILITY_TUNING, REACH_TUNING, SHARE_TUNING, UNITE_TUNING } from './tunables.ts';

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

/**
 * A group of the polity arrives in a region (moving, splitting, expanding, joining): the region is in its sight at
 * once, and it meets whoever lives next to it or sees it across the sea — the same month, whichever side's sight is
 * rebuilt later (a seafarer that already sees an island meets the newcomers there).
 */
export function arrive(state: SimulationState, polity: Polity, region: number, tick: number) {
  seeRegion(polity, region);
  const here = state.partition.regions[region];
  const visit = (other: number) => {
    const them = state.occupant[other];
    if (them >= 0 && them !== polity.id && !polity.met.has(them)) meet(state, polity, state.polities[them], other, tick);
  };
  for (const edge of here.neighbors) visit(edge.region);
  for (const link of here.sea) {
    const them = state.occupant[link.region];
    if (them < 0) continue;
    const reaches = (sea: number) => sea >= 2 || (sea >= 1 && link.km <= MOBILITY_TUNING.coastalSailingKm);
    if (reaches(polity.knowledge.sea) || reaches(state.polities[them].knowledge.sea)) visit(link.region);
  }
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

/** First contact: mutual, recorded once per pair, at the region where it happened (seen from home, or by an expedition). */
export function meet(state: SimulationState, polity: Polity, other: Polity, region: number, tick: number, expedition = false) {
  polity.met.set(other.id, tick); other.met.set(polity.id, tick);
  state.metrics.firstContacts++;
  const landmass = state.partition.regions[region].landmass;
  const overSea = !polity.groups.some(id => state.partition.regions[state.groups[id].region].landmass === landmass);
  state.chronicle.emit({
    type: 'firstContact', actors: [{ id: polity.id, role: 'a' }, { id: other.id, role: 'b' }], region,
    causes: [{ factor: expedition ? 'expedition' : overSea ? 'seaReach' : 'sharedBorder', weight: 1 }],
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

/**
 * What a civilization weighs at its decision step (VISION.md "Decision step": only its own knowledge and beliefs).
 * Built here from its own state and its map; decision code receives nothing else.
 */
export interface PolityView {
  id: number; tick: number; values: CultureValues;
  /** Sea reach (0 none, 1 coastal crossings, 2 any coast) and the tick it last grew (−1 never). */
  sea: number; seaTick: number;
  /** Governance reach in travel-km from its capital. */
  reachKm: number;
  /** Its people, and their land pressure and hunger (people-weighted, 0–1). */
  people: number; landPressure: number; hunger: number;
  /** Mean land value of its own regions (see `SimulationState.landValue`). */
  ownValue: number;
  /** Land it knows next to its own, held by no civilization as far as it knows. */
  candidates: Candidate[];
  /** Unknown regions next to what it sees: land still to discover. */
  unknownFrontier: number;
  /** Its own regions, the share of them in unrest and their mean stability. */
  regions: number; unrestShare: number; stability: number;
  /** Civilizations it has met whose land touches its own, as far as it knows them (VISION.md "Unification"). */
  neighbours: Neighbour[];
  /** Peoples it is in contact with and could share knowledge with (none it shares with now or that refused lately),
   *  and how many exchanges it has now. */
  partners: Partner[]; exchanges: number;
  /** What it could build, and where (VISION.md "Buildings"; the Build action). */
  build: {
    /** Its treasury, income and upkeep a year, and its regions (how widely it builds at once). */
    wealth: number; income: number; upkeep: number; regions: number;
    /** The building types it knows: purpose, cost, upkeep, the smallest tier they stand in. */
    catalog: { type: number; name: string; purpose: string; cost: number; upkeep: number; minTier: number }[];
    /** Its living settlements: tier, townspeople and housing, its region's hardship (memory of hunger), share of food
     *  farmed and stability, foreign peoples on the region's borders, and the building types it has or is building. */
    settlements: { id: number; name: string; tier: number; urban: number; housing: number; hardship: number; farmShare: number; stability: number; frontier: number; has: number[] }[];
  };
}

/** A people in contact (met, within two regions) that a civilization could offer an exchange of knowledge (VISION.md "Sharing knowledge"). */
export interface Partner {
  polity: number; name: string; kind: 'band' | 'civ'; kin: boolean; similarity: number;
  /** Techs it knows that they do not (it would teach), and techs they know that it does not (it would learn): peoples
   *  in contact see what each other can do. */
  teach: number; learn: number;
  /** How likely they are to accept: from their Tradition, how alike their cultures are and what they would learn. */
  willing: number;
}

export interface Neighbour {
  civ: number; name: string; kin: boolean; similarity: number;
  /** Regions it knows that civilization holds (in sight or remembered): its size as far as it knows. */
  knownRegions: number;
  /** That civilization's people in its sight: how well fed (0–1) and how stable their regions are. */
  fed: number; stability: number;
  /** The typical crossing between their lands (the median travel-km of the edges they share: a mountain range with one
   *  pass still divides them), and its own region on the cheapest crossing (where they meet). */
  crossingKm: number; border: number;
}

export interface Candidate {
  region: number;
  /** Its own region next to it with the most people (where settlers would come from), its people and land pressure,
   *  and the crossing's travel cost. */
  from: number; fromPeople: number; pressure: number; crossingKm: number;
  /** Travel cost from its capital, through its own land. */
  capitalKm: number;
  /** The land's value (static farming capacity) and whether a tribe's band lives there, as it knows. */
  value: number; tribe: boolean;
}

const medianOf = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };

/** Travel cost of a land edge (river crossings cost extra) or a sea crossing. */
export const edgeKm = (travelKm: number, riverTier: number) => travelKm * (1 + REACH_TUNING.riverCrossing[riverTier]);
export const seaKm = (km: number) => km * REACH_TUNING.seaFactor;

// Reused across views: travel cost per region (by stamp), and a binary heap of [cost, region].
let costStamp = new Int32Array(0), costMark = 0, cost = new Float64Array(0);
const heap: number[] = [];

/**
 * Travel cost from the polity's capital (its heartland for a tribe) to its own regions and the known land next to
 * them: its own land relays, land beyond is reached but not crossed. Results stay valid until the next call
 * (`travelled`); returns its own regions.
 */
function travelFromCapital(state: SimulationState, polity: Polity) {
  const regions = state.partition.regions, map = polity.map, sea = polity.knowledge.sea, tuning = REACH_TUNING;
  travelGeography = state.geography; travelRegions = regions;
  if (costStamp.length !== regions.length) { costStamp = new Int32Array(regions.length); cost = new Float64Array(regions.length); costMark = 0; }
  costMark++;
  const own = new Set<number>();
  for (const id of polity.groups) own.add(state.groups[id].region);
  origin = polity.capital !== null ? state.settlements[polity.capital].region : state.groups[polity.core].region;
  limit = tuning.searchReaches * tuning.baseKm * polity.knowledge.multipliers.reach;
  const reach = (region: number, through: number) => {
    if (through > limit || (costStamp[region] === costMark && cost[region] <= through)) return;
    costStamp[region] = costMark; cost[region] = through;
    push(through, region);
  };
  heap.length = 0;
  reach(origin, 0);
  while (heap.length) {
    const [at, region] = pop();
    if (at > cost[region]) continue;
    // Its own land relays at the crossings' cost; known land it does not hold relays at a premium.
    const factor = own.has(region) ? 1 : tuning.foreignRelay;
    for (const edge of regions[region].neighbors) if (map.status[edge.region] !== UNKNOWN) reach(edge.region, at + factor * edgeKm(edge.travelKm, edge.riverTier));
    if (sea > 0) for (const link of regions[region].sea) if ((sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) && map.status[link.region] !== UNKNOWN) reach(link.region, at + factor * seaKm(link.km));
  }
  return own;
}

let origin = 0, limit = 0;

/** Travel-km from the last search's origin; land it did not reach counts as straight-line km × the fallback factor. */
function travelled(region: number) {
  if (costStamp[region] === costMark) return cost[region];
  const geography = travelGeography!, regions = travelRegions!;
  return Math.max(limit, greatCircleKm(geography, regions[origin].centroid, regions[region].centroid) * REACH_TUNING.fallbackFactor);
}
let travelGeography: SimulationState['geography'] | null = null, travelRegions: SimulationState['partition']['regions'] | null = null;

/** Travel-km from the polity's capital to each region (never infinite); the getter is valid until the next search. */
export function capitalTravel(state: SimulationState, polity: Polity): (region: number) => number {
  travelFromCapital(state, polity);
  return travelled;
}

/** Travel-km from the polity's capital (its heartland for a tribe) to a region (never infinite: see `travelled`). */
export function capitalKm(state: SimulationState, polity: Polity, region: number) {
  travelFromCapital(state, polity);
  return travelled(region);
}

/**
 * How much of these people a civilization could govern from its capital (VISION.md: it accepts only land it can
 * govern): the people-weighted mean of 1 ÷ (1 + (travel-km ÷ reach)^power) over their regions.
 */
export function governable(state: SimulationState, civ: Polity, groups: readonly number[], power: number) {
  travelFromCapital(state, civ);
  const reach = REACH_TUNING.baseKm * civ.knowledge.multipliers.reach;
  let fit = 0, people = 0;
  for (const id of groups) { const group = state.groups[id]; fit += group.size / (1 + (travelled(group.region) / reach) ** power); people += group.size; }
  return people > 0 ? fit / people : 0;
}

/** What a civilization could build and where (the Build action's view): its own settlements and what it knows. */
function buildView(state: SimulationState, civ: Polity): PolityView['build'] {
  const catalog: PolityView['build']['catalog'] = [];
  BUILDINGS.forEach((definition, type) => { if (buildingKnown(civ.knowledge, type)) catalog.push({ type, name: definition.name, purpose: definition.purpose, cost: definition.cost, upkeep: definition.upkeep, minTier: definition.minTier }); });
  const settlements: PolityView['build']['settlements'] = [];
  if (catalog.length) for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    // Foreign peoples on the region's borders, as it sees them (its neighbours are always in sight).
    const foreign = new Set<number>();
    for (const edge of state.partition.regions[region].neighbors) { const view = regionView(state, civ, edge.region); if (view && view.occupant >= 0 && view.occupant !== civ.id) foreign.add(view.occupant); }
    for (const settlement of livingSettlements(state, region)) {
      const has = settlement.buildings.map(building => building.type);
      for (const project of civ.projects) if (project.settlement === settlement.id) has.push(project.type);
      settlements.push({
        id: settlement.id, name: settlement.name, tier: settlement.tier, urban: settlement.urban, housing: settlement.housing, hardship: state.hardship[region],
        farmShare: group.farmShare, stability: state.stability[region], frontier: foreign.size, has,
      });
    }
  }
  return { wealth: civ.wealth, income: incomeOf(state, civ), upkeep: upkeepOf(state, civ), regions: civ.groups.length, catalog, settlements };
}

/** How ready a people is to accept an exchange: less with strong Tradition and another way of life, less when it would
 *  learn little (VISION.md "Sharing knowledge"). The decision weighs it and `sharing.ts` draws with it. */
export function willingness(tradition: number, similarity: number, gain: number) {
  const tuning = SHARE_TUNING;
  const open = Math.max(0, Math.min(1, 1 - tuning.refusal * tradition * (1 - similarity)));
  return open * (tuning.gainBase + (1 - tuning.gainBase) * Math.min(1, gain / tuning.techScale));
}

export function decisionView(state: SimulationState, polity: Polity): PolityView {
  const regions = state.partition.regions, map = polity.map, sea = polity.knowledge.sea;
  const own = new Set<number>();
  let people = 0, pressure = 0, hunger = 0, value = 0;
  for (const id of polity.groups) {
    const group = state.groups[id];
    own.add(group.region);
    people += group.size; value += state.landValue[group.region];
    pressure += group.size * landPressure(group.size, state.capacity[group.region]);
    hunger += group.size * Math.max(0, 1 - Math.min(1, group.foodSecurity));
  }
  // Candidates: known land next to its own that no civilization holds as far as it knows, and that can feed farmers.
  const found = new Map<number, Candidate>();
  const consider = (from: number, region: number, crossing: number) => {
    if (own.has(region) || map.status[region] === UNKNOWN || !(state.landValue[region] > 0)) return;
    const view = regionView(state, polity, region)!;
    if (view.owner >= 0) return;
    const size = state.groups[state.groupAt[from]].size, current = found.get(region);
    if (current && state.groups[state.groupAt[current.from]].size >= size) return;
    found.set(region, {
      region, from, fromPeople: size, pressure: landPressure(size, state.capacity[from]), crossingKm: crossing, capitalKm: Number.POSITIVE_INFINITY,
      value: state.landValue[region], tribe: view.occupant >= 0,
    });
  };
  for (const region of own) {
    for (const edge of regions[region].neighbors) consider(region, edge.region, edgeKm(edge.travelKm, edge.riverTier));
    if (sea > 0) for (const link of regions[region].sea) if (sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) consider(region, link.region, seaKm(link.km));
  }
  // Travel from the capital only matters when there is land to weigh (most steps in a full world have none).
  if (found.size) {
    travelFromCapital(state, polity);
    for (const candidate of found.values()) candidate.capitalKm = travelled(candidate.region);
  }
  // Civilizations whose land touches its own, sized by the regions it knows they hold.
  const neighbours = new Map<number, Neighbour>(), culture = state.cultures[polity.culture].values, shared = new Map<number, number[]>();
  for (const region of own) for (const edge of regions[region].neighbors) {
    const civ = state.owner[edge.region];
    if (civ < 0 || civ === polity.id || !polity.met.has(civ)) continue;
    // A civilization that turned it away lately is not asked again yet.
    const rebuffed = polity.rebuffed.get(civ);
    if (rebuffed !== undefined && state.tick - rebuffed < UNITE_TUNING.rebuffYears * 12) continue;
    const km = edgeKm(edge.travelKm, edge.riverTier), entry = neighbours.get(civ);
    shared.get(civ)?.push(km) ?? shared.set(civ, [km]);
    if (entry) { if (km < entry.crossingKm) { entry.crossingKm = km; entry.border = region; } continue; }
    const them = state.polities[civ];
    neighbours.set(civ, { civ, name: them.name, kin: them.lineage === polity.lineage, similarity: cultureSimilarity(culture, state.cultures[them.culture].values), knownRegions: 0, fed: 0, stability: 0, crossingKm: km, border: region });
  }
  for (const entry of neighbours.values()) entry.crossingKm = medianOf(shared.get(entry.civ)!);
  if (neighbours.size) {
    const seen = new Map<number, number>();
    for (const region of map.observed) {
      const entry = neighbours.get(state.owner[region]);
      if (!entry) continue;
      entry.knownRegions++;
      const group = state.groups[state.groupAt[region]];
      entry.fed += group.size * Math.min(1, group.foodSecurity); entry.stability += group.size * state.stability[region];
      seen.set(entry.civ, (seen.get(entry.civ) ?? 0) + group.size);
    }
    map.snapshots.forEach(snapshot => { const entry = neighbours.get(snapshot.owner); if (entry) entry.knownRegions++; });
    for (const entry of neighbours.values()) { const people = seen.get(entry.civ) ?? 0; if (people > 0) { entry.fed /= people; entry.stability /= people; } }
  }
  let unrest = 0, stable = 0;
  for (const region of own) { unrest += state.unrest[region]; stable += state.stability[region]; }
  // Unknown land next to what it sees, each counted once.
  let unknownFrontier = 0;
  if (frontierStamp.length !== regions.length) { frontierStamp = new Int32Array(regions.length); frontierMark = 0; }
  frontierMark++;
  for (const region of map.observed) for (const edge of regions[region].neighbors) if (map.status[edge.region] === UNKNOWN && frontierStamp[edge.region] !== frontierMark) { frontierStamp[edge.region] = frontierMark; unknownFrontier++; }
  // Peoples in contact it could share knowledge with.
  const partners: Partner[] = [];
  let exchanges = 0;
  for (const [other, until] of polity.exchanges) if (until > state.tick && state.polities[other].deathTick === null) exchanges++;
  for (const other of polity.contacts) {
    const them = state.polities[other];
    if (them.deathTick !== null || (polity.exchanges.get(other) ?? 0) > state.tick) continue;
    const refused = polity.exchangeRefused.get(other);
    if (refused !== undefined && state.tick - refused < SHARE_TUNING.refusedYears * 12) continue;
    let teach = 0, learn = 0;
    for (let tech = 0; tech < them.knowledge.known.length; tech++) {
      if (polity.knowledge.known[tech] && !them.knowledge.known[tech]) teach++;
      else if (!polity.knowledge.known[tech] && them.knowledge.known[tech]) learn++;
    }
    const theirs = state.cultures[them.culture].values, similarity = cultureSimilarity(culture, theirs);
    partners.push({ polity: other, name: them.name, kind: them.kind, kin: them.lineage === polity.lineage, similarity, teach, learn, willing: willingness(theirs.tradition, similarity, teach) });
  }
  partners.sort((a, b) => a.polity - b.polity);
  return {
    build: buildView(state, polity),
    id: polity.id, tick: state.tick, values: { ...state.cultures[polity.culture].values }, sea, seaTick: polity.seaTick,
    reachKm: REACH_TUNING.baseKm * polity.knowledge.multipliers.reach,
    people, landPressure: people > 0 ? pressure / people : 0, hunger: people > 0 ? hunger / people : 0,
    ownValue: own.size ? value / own.size : 0,
    candidates: [...found.values()].sort((a, b) => a.region - b.region), unknownFrontier,
    regions: own.size, unrestShare: own.size ? unrest / own.size : 0, stability: own.size ? stable / own.size : 1,
    neighbours: [...neighbours.values()].sort((a, b) => a.civ - b.civ), partners, exchanges,
  };
}

let frontierStamp = new Int32Array(0), frontierMark = 0;

/**
 * What a farming tribe about to settle weighs (VISION.md "Joining"): each civilization it has met whose land it sees
 * next to its own, as far as it can tell from what it sees — kinship, how alike their ways are, the people it sees in
 * that civilization's regions, how well fed they are and how stable their regions, and the easiest crossing.
 */
export interface JoinView { tribe: number; people: number; values: CultureValues; options: JoinOption[] }
export interface JoinOption {
  civ: number; kin: boolean; similarity: number;
  /** Its people in the tribe's sight, their food security (0–1, people-weighted) and their regions' stability. */
  seenPeople: number; fed: number; stability: number;
  /** The typical crossing from the tribe's land into its land (the median travel-km of the edges they share), and the
   *  tribe's region on the cheapest crossing. */
  crossingKm: number; border: number;
}

export function joinView(state: SimulationState, tribe: Polity): JoinView {
  const regions = state.partition.regions, culture = state.cultures[tribe.culture];
  const found = new Map<number, JoinOption>(), shared = new Map<number, number[]>();
  let people = 0;
  for (const id of tribe.groups) {
    const region = state.groups[id].region;
    people += state.groups[id].size;
    for (const edge of regions[region].neighbors) {
      const civ = state.owner[edge.region];
      if (civ < 0 || !tribe.met.has(civ)) continue;
      const km = edgeKm(edge.travelKm, edge.riverTier), option = found.get(civ);
      shared.get(civ)?.push(km) ?? shared.set(civ, [km]);
      if (option && option.crossingKm <= km) continue;
      if (option) { option.crossingKm = km; option.border = region; continue; }
      const them = state.polities[civ];
      found.set(civ, {
        civ, kin: them.lineage === tribe.lineage, similarity: cultureSimilarity(culture.values, state.cultures[them.culture].values),
        seenPeople: 0, fed: 0, stability: 0, crossingKm: km, border: region,
      });
    }
  }
  for (const region of tribe.map.observed) {
    const option = found.get(state.owner[region]);
    if (!option) continue;
    const group = state.groups[state.groupAt[region]];
    option.seenPeople += group.size; option.fed += group.size * Math.min(1, group.foodSecurity); option.stability += group.size * state.stability[region];
  }
  for (const option of found.values()) {
    if (option.seenPeople > 0) { option.fed /= option.seenPeople; option.stability /= option.seenPeople; }
    option.crossingKm = medianOf(shared.get(option.civ)!);
  }
  return { tribe: tribe.id, people, values: { ...culture.values }, options: [...found.values()].sort((a, b) => a.civ - b.civ) };
}

function push(at: number, region: number) {
  heap.push(at, region);
  let child = heap.length / 2 - 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (heap[parent * 2] <= heap[child * 2]) break;
    [heap[parent * 2], heap[child * 2]] = [heap[child * 2], heap[parent * 2]];
    [heap[parent * 2 + 1], heap[child * 2 + 1]] = [heap[child * 2 + 1], heap[parent * 2 + 1]];
    child = parent;
  }
}

function pop(): [number, number] {
  const top: [number, number] = [heap[0], heap[1]];
  const lastRegion = heap.pop()!, lastCost = heap.pop()!;
  if (heap.length) {
    heap[0] = lastCost; heap[1] = lastRegion;
    let parent = 0;
    const size = heap.length / 2;
    for (;;) {
      const left = parent * 2 + 1, right = left + 1;
      let smallest = parent;
      if (left < size && heap[left * 2] < heap[smallest * 2]) smallest = left;
      if (right < size && heap[right * 2] < heap[smallest * 2]) smallest = right;
      if (smallest === parent) break;
      [heap[parent * 2], heap[smallest * 2]] = [heap[smallest * 2], heap[parent * 2]];
      [heap[parent * 2 + 1], heap[smallest * 2 + 1]] = [heap[smallest * 2 + 1], heap[parent * 2 + 1]];
      parent = smallest;
    }
  }
  return top;
}

/** A region an expedition passes: remembered as it is now (unless in sight). */
export function reveal(state: SimulationState, polity: Polity, region: number, tick: number) {
  const map = polity.map;
  if (map.status[region] === OBSERVED) return false;
  const fresh = map.status[region] === UNKNOWN;
  map.status[region] = KNOWN;
  map.snapshots.set(region, { occupant: state.occupant[region], owner: state.owner[region], tick });
  return fresh;
}

/** A polity that joins or is annexed hands over what it knew: the newer view of each region is kept (VISION.md "Sharing knowledge"). */
export function absorbMap(state: SimulationState, into: Polity, from: Polity, tick: number) {
  for (const region of from.map.observed) if (into.map.status[region] !== OBSERVED) {
    into.map.status[region] = KNOWN;
    into.map.snapshots.set(region, { occupant: state.occupant[region], owner: state.owner[region], tick });
  }
  from.map.snapshots.forEach((snapshot, region) => {
    if (into.map.status[region] === OBSERVED) return;
    const mine = into.map.snapshots.get(region);
    if (mine && mine.tick >= snapshot.tick) return;
    into.map.status[region] = KNOWN; into.map.snapshots.set(region, { ...snapshot });
  });
}

/** A dead polity's map is released; who it met stays as history. */
export function forgetMap(polity: Polity) {
  polity.map = emptyMap(0);
}
