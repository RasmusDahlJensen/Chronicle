import { BUILDINGS, buildingKnown } from './buildings.ts';
import { TENETS } from './religions.ts';
import { secularity } from './faith.ts';
import { WONDERS, wonderKnown } from './wonders.ts';
import { cultureSimilarity } from './culture.ts';
import { type Costs, fullCostsOf, totalCosts } from './budget.ts';
import { buildingCost, outputOf, siteIncome } from './economy.ts';
import { livingSettlements } from './settlements.ts';
import { cellNeighbors, greatCircleKm } from './geography.ts';
import { CostHeap } from './heap.ts';
import { edgeKm, edgeTravel, jointRoute, knownRoadTier, ROAD_TIERS, roadRoutes } from './roads.ts';
import { landPressure } from './pressure.ts';
import { soldierUpkeep, workersOf } from './soldiers.ts';
import { threatOf } from './decisions/threat.ts';
import { chooseGoal, claimWeight, defenseOf, futilityOf, inTruce, supplyFrom, warBetween, warIncomeOf, wearinessOf } from './claims.ts';
import { beliefBias, estimate, truthOf } from './relations.ts';
import { landStock, reliefThere, shortfallFor } from './supply.ts';
import { hubOf } from './hubs.ts';
import { tradeIncome } from './treaties.ts';
import { activeTrade, lackOf, routeOf, spareOf } from './trade.ts';
import { depositState } from './deposits.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { effectiveValues } from './values.ts';
export { effectiveValues };
import { NEED_NAMES, type BeliefKind, type CultureValues, type MapKnowledge, type NeedName, type Polity, type SimulationState } from './state.ts';
import { BUDGET_TUNING, DIPLOMACY_TUNING, VOYAGE_TUNING, WAR_TUNING, FAITH_TUNING, MOBILITY_TUNING, NEED_TUNING, REACH_TUNING, SHARE_TUNING, TRADE_TUNING, UNITE_TUNING } from './tunables.ts';

/**
 * What each polity knows of the world (VISION.md "Knowledge of the world"), and the query layer through which choices
 * must read it. A polity sees its own regions, their land neighbours and the sea crossings its knowledge reaches from
 * its harbors.
 * A civilization remembers a region that leaves its sight as it was then (a snapshot); a tribe keeps only what is in
 * sight. Two polities meet when one sees where the other lives, and neighbouring civilizations tell each other what
 * they see. Physical systems may read the true world; choices read only `regionView`, `knownRegions`, `hasMet`, and
 * of other peoples only `believe` (an estimate off by the pair's bias, shrunk by their intimacy) and `opinionOf` (M5.1),
 * all of it gathered into the view types decision code is given.
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
 * The sea reach a polity has from one region (VISION.md "Mobility": Sailing and Navigation "from a region with a
 * harbor"): what its knowledge gives (0 none, 1 coastal crossings, 2 any coast), only where it holds the region and a
 * harbor stands there; elsewhere none. The one rule for sight, meeting, travel, expansion, exploration, movement and
 * contact across the sea. Tribes build nothing, so they never cross the sea.
 */
export function seaFrom(state: SimulationState, polity: Polity, region: number): number {
  return polity.knowledge.sea > 0 && state.harbors[region] > 0 && state.owner[region] === polity.id ? polity.knowledge.sea : 0;
}

/** Whether the polity holds a region with a standing harbor (it can sail once its knowledge allows). */
export function hasHarbor(state: SimulationState, polity: Polity) {
  for (const id of polity.groups) if (state.harbors[state.groups[id].region] > 0) return true;
  return false;
}

/** The regions a civilization holds with a standing harbor, ascending (where its voyages sail from: M5.6). */
export function harborRegions(state: SimulationState, civ: Polity) {
  const regions: number[] = [];
  for (const id of civ.groups) { const region = state.groups[id].region; if (state.harbors[region] > 0) regions.push(region); }
  return regions.sort((a, b) => a - b);
}

/** The chance a voyage of `km` is lost at sea at a sea reach (1 Sailing, 2 Navigation; VOYAGE_TUNING). */
export const lossChance = (sea: number, km: number) => Math.min(VOYAGE_TUNING.maxLoss, VOYAGE_TUNING.lossPer1000Km[sea] * km / 1000);

/** Whether a sea crossing of `km` is within a sea reach (1: coastal crossings up to the coastal sailing distance; 2: any). */
export function crosses(sea: number, km: number) {
  return sea >= 2 || (sea >= 1 && km <= MOBILITY_TUNING.coastalSailingKm);
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
    if (crosses(seaFrom(state, polity, region), link.km) || crosses(seaFrom(state, state.polities[them], link.region), link.km)) visit(link.region);
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
  const regions = state.partition.regions, map = polity.map;
  if (stamp.length !== regions.length) { stamp = new Int32Array(regions.length); mark = 0; }
  mark++;
  sight.length = 0;
  const add = (region: number) => { if (stamp[region] !== mark) { stamp[region] = mark; sight.push(region); } };
  for (const id of polity.groups) {
    const here = regions[state.groups[id].region], sea = seaFrom(state, polity, here.id);
    add(here.id);
    for (const edge of here.neighbors) add(edge.region);
    if (sea > 0) for (const link of here.sea) if (crosses(sea, link.km)) add(link.region);
  }
  // (Harbors built or lost make the map dirty; the sea reach its knowledge gives is remembered for the same reason.)
  map.dirty = false; map.sea = polity.knowledge.sea;
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
/**
 * (M6.2) A neighbour it could go to war with, as it knows it: the regions of theirs it would fight for (its goal: their
 * land next to its own, best for it first, never their capital unless that is nearly all they hold), its believed odds
 * (its strength with its allies over both sides', theirs with the allies it knows them to have), and what a war could
 * win it: a weaker or richer neighbour (as the needs' opportunity), land better than its own (0–1), the largest
 * shortfall the goal's sites would relieve and that resource (−1 none), a rival faith (and how little the secular age
 * has cooled it, 0–1), its claims on the goal (0–1), the threat it feels from them, its opinion of them, the natural
 * frontier the goal would win it (the goal's `frontierGain` ÷ WAR_TUNING.frontierScale, 0–1), and how its own wars on
 * them have come to nothing (`futilityOf`).
 */
export interface WarTarget {
  enemy: number; name: string; goal: number[]; odds: number; strength: number; pact: boolean; reach: number;
  opportunity: number; land: number; shortage: number; resource: number; holy: number; claims: number; threat: number; opinion: number; frontier: number; futility: number;
}
/** (M6.2) A war it is fighting: the war, the enemy, whether it attacked, the score in its favour (−100 to 100), its own
 *  and the enemy's exhaustion, and the months it has lasted. */
export interface AtWar { war: number; enemy: number; name: string; attacker: boolean; lead: number; exhaustion: number; theirs: number; months: number }

export interface PolityView {
  /** Its effective values (M5.2: all its people's, people-weighted, with its ruler's and government's modifiers). */
  id: number; tick: number; values: CultureValues;
  /** Trades it could propose (M5.4; `tradeOptions`). */
  trades: TradeOption[];
  /** Pacts and alliances it could propose, and road agreements (M5.5; `pactOptions`, `roadOptions`). */
  pacts: PactOption[]; roads: RoadOption[];
  /** (M6.2) Neighbours it could go to war with (none while it is at war; `warTargets`), the wars it fights (`atWarOf`),
   *  its arrears (0–1) and its war-weariness (its last war's exhaustion, fading). */
  warTargets: WarTarget[]; atWar: AtWar[]; arrears: number; weariness: number;
  /** (M6.4) How raided its land has been lately: its regions' raid memory weighed by their people (0–1); a threat it feels. */
  raided: number;
  /** An overseas voyage it could send (M5.6): from its harbors (how many), how far its sea reach sails (km), the chance
   *  of loss at half that, the years since its last voyage (−1 never), and its voyages in a row that found nothing.
   *  Null without Sailing or a harbor. What lies beyond, it does not know. */
  voyage: { harbors: number; reachKm: number; loss: number; years: number; empty: number } | null;
  /** Its needs, each 0–1 (VISION.md "Needs"; `needsOf`), and the threat it feels from each neighbouring civilization
   *  that threatens it (by id, those above 0): what threatens it is not where it seeks shelter. */
  needs: Record<NeedName, number>; threats: { civ: number; threat: number }[];
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
  /**
   * Its budget a year (VISION.md "Wealth"): its tax rate, its people's output before tax, what its mines and quarries
   * pay, what running the realm costs, its treasury; what customary taxes and its sites would raise (`revenue`) and
   * what that leaves after its costs (`surplus`, below 0 when it must tax above the custom), its strain: how far its
   * costs other than its army exceed that revenue, as a share of it (0–1; the army is its choice, not the weight of
   * running the realm, M6.1), its people's Tradition (how much of a reserve they keep), and how
   * calm its regions are apart from its taxes and arrears (their people-weighted mean calm, as last judged).
   */
  budget: { rate: number; output: number; sites: number; trade: number; costs: number; treasury: number; revenue: number; surplus: number; strain: number; tradition: number; calm: number };
  /** What it could build, and where (VISION.md "Buildings"; the Build action). */
  build: {
    /** Its regions (how widely it builds at once). */
    regions: number;
    /** The building types it knows: purpose, cost (as it would pay), upkeep, the smallest tier they stand in, whether
     *  they need the sea beside the settlement, and which sites they work. */
    catalog: { type: number; name: string; one: string; many: string; purpose: string; cost: number; upkeep: number; minTier: number; coast: boolean; water: boolean; perRegion: boolean; works: '' | 'mineral' | 'stone' }[];
    /** Its living settlements: tier, townspeople and housing, its region's hardship (memory of hunger), share of food
     *  farmed (and the rural people that share stands for) and stability, foreign peoples on the region's borders, the building types it has or is building (for
     *  those one region needs only one of, anywhere in the region); whether the sea is beside it, the sea crossings its
     *  knowledge would reach from there, and the wealth a year its region's usable mineral and stone sites would give. */
    settlements: {
      id: number; region: number; name: string; tier: number; urban: number; housing: number; hardship: number; farmShare: number; farmers: number; stability: number; frontier: number; raided: number; has: number[];
      coast: boolean; water: boolean; seaLinks: number; mineYield: number; quarryYield: number; wonder: boolean;
    }[];
    /** The wonders it could begin (it knows how, none it knows of stands or is being built anywhere, and it builds none
     *  now): their motive, cost, the months they take, upkeep, the smallest tier of their city and whether it needs the
     *  sea; and its realm's mean stability. */
    wonders: { type: number; name: string; motive: string; cost: number; months: number; upkeep: number; minTier: number; coast: boolean }[];
    stability: number;
    /** How much more its state religion makes it build shrines, temples and wonders (Monument builders: VISION.md
     *  "Tenets"; 1 otherwise), and how much of its people's Zeal still moves its building (1 − its secularity). */
    monuments: number; piety: number;
    /** Roads (VISION.md "Roads"): the best tier it knows (0 none) and its names, and for each of its regions with a
     *  town or city that its roads do not yet reach from its capital at that tier, the road it could build there
     *  (`roads.ts` `roadRoutes`): the largest such settlement, its townspeople, its travel-km from the capital now, and
     *  the road's cost, upkeep a year added, edges and bridges. */
    roads: {
      tier: number; one: string; many: string;
      routes: { settlement: number; name: string; urban: number; km: number; cost: number; upkeep: number; edges: number; bridges: number }[];
    };
  };
}

/** A people in contact (met, within two regions) that a civilization could offer an exchange of knowledge (VISION.md "Sharing knowledge"). */
export interface Partner {
  polity: number; name: string; kind: 'band' | 'civ'; kin: boolean; similarity: number;
  /** What it thinks of them (−100 to 100; M5.1). */
  opinion: number;
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
  /** Their population as it believes it, how sure it is (its intimacy with them) and what it thinks of them (M5.1). */
  believedPeople: number; confidence: number; opinion: number;
  /** That civilization's people in its sight: how well fed (0–1) and how stable their regions are. */
  fed: number; stability: number;
  /** The typical crossing between their lands (the median travel-km of the edges they share: a mountain range with one
   *  pass still divides them), and its own region on the cheapest crossing (where they meet). */
  crossingKm: number; border: number;
}

/**
 * A trade it could propose (M5.4): a partner it has met whose land it knows to hold sites of a resource it lacks,
 * with its shortfall (0–1), what it lacks (units a year), the sites it knows there, its opinion of them, their culture's
 * Openness, the route between the hubs (km, how far trade reaches, what it carries) and the wealth a year it would pay.
 */
export interface TradeOption {
  /** (`lack`: what it lacks, units a year; `spare`: what it believes they could spare of it, units a year, a belief off
   *  as its belief of their people, `believedPeople`, is. The route is measured between their true hubs: a people
   *  knows where its partners' great markets and harbors are, and how far trade reaches from them.) */
  partner: number; name: string; resource: number; resourceName: string; shortfall: number; lack: number; spare: number; believedPeople: number; opinion: number; openness: number;
  km: number; reachKm: number; capacity: number; cost: number;
}

/**
 * A pact or an alliance it could propose (M5.5): to a neighbour (a non-aggression pact; `threat` is the threat it feels
 * from them), or to a civilization that, as far as it knows, borders `enemy`, a neighbour it feels threatened by (a
 * defensive alliance; `threat` is that threat). Its opinion of them, whether they are kin or share its state religion,
 * and the strength it believes of the people it fears (`feared`: the neighbour, or the enemy; null without a threat).
 */
export interface PactOption {
  partner: number; name: string; kind: 'nonAggression' | 'alliance'; threat: number; enemy: number; enemyName: string;
  opinion: number; kin: boolean; faith: boolean; feared: { polity: number; strength: number } | null;
}

/**
 * A road agreement it could propose (M5.5): to an ally or trade partner whose land touches its own, both knowing roads.
 * Its opinion of them, whether they trade or are allied, the joint road's travel-km between their nearest towns or
 * cities and what its own stretch would cost.
 */
export interface RoadOption { partner: number; name: string; opinion: number; trading: boolean; allied: boolean; km: number; cost: number }

export interface Candidate {
  region: number;
  /** Its own region next to it with the most people (where settlers would come from), its people and land pressure,
   *  and the crossing's travel cost. */
  from: number; fromPeople: number; pressure: number; crossingKm: number;
  /** Travel cost from its capital, through its own land. */
  capitalKm: number;
  /** The land's value (static farming capacity) and whether a tribe's band lives there, as it knows. */
  value: number; tribe: boolean;
  /** How much of what it lacks the land would make good (0–1; `supply.ts` `reliefThere`; M5.3). */
  short: number;
}

/**
 * What `observer` believes of `other` (VISION.md "Beliefs about other polities"; the query layer of its "Implementation
 * rule"): an estimate of `kind`, off by their pair's bias shrunk by their intimacy, and how sure it is (that intimacy).
 * Decisions see other peoples only through this.
 */
export function believe(state: SimulationState, observer: Polity, other: Polity, kind: BeliefKind) {
  const intimacy = observer.relations.get(other.id)?.intimacy ?? 0;
  return { estimate: estimate(truthOf(state, other, kind), beliefBias(state.seed, observer.id, other.id, kind), intimacy, kind), confidence: intimacy };
}

/** What `observer` thinks of `other` (−100 to 100; 0 for a people it has not judged yet). */
export const opinionOf = (observer: Polity, other: number) => observer.relations.get(other)?.opinion ?? 0;

const medianOf = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };

/** Travel cost of a bare land edge (river crossings cost extra; `roads.ts`) or a sea crossing. */
export { edgeKm };
export const seaKm = (km: number) => km * REACH_TUNING.seaFactor;

// Reused across views: travel cost per region (by stamp), and a heap of (cost, region).
let costStamp = new Int32Array(0), costMark = 0, cost = new Float64Array(0);
const heap = new CostHeap();

/**
 * Travel cost from the polity's capital (its heartland for a tribe) to its own regions and the known land next to
 * them: its own land relays, land beyond is reached but not crossed. Results stay valid until the next call
 * (`travelled`); returns its own regions.
 */
function travelFromCapital(state: SimulationState, polity: Polity) {
  const regions = state.partition.regions, map = polity.map, tuning = REACH_TUNING;
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
    heap.push(through, region);
  };
  heap.clear();
  reach(origin, 0);
  while (heap.size) {
    heap.take();
    const at = heap.cost, region = heap.item;
    if (at > cost[region]) continue;
    // Its own land relays at the crossings' cost; known land it does not hold relays at a premium.
    const factor = own.has(region) ? 1 : tuning.foreignRelay;
    // Roads lower the cost of the edges they lie on (VISION.md "Roads": governance reach grows with roads), where it
    // sees both ends: roads in land it only remembers are as it last saw them, which it does not keep.
    for (const edge of regions[region].neighbors) if (map.status[edge.region] !== UNKNOWN) reach(edge.region, at + factor * edgeTravel(state, region, edge, map.status[region] === OBSERVED && map.status[edge.region] === OBSERVED));
    const sea = seaFrom(state, polity, region);
    if (sea > 0) for (const link of regions[region].sea) if (crosses(sea, link.km) && map.status[link.region] !== UNKNOWN) reach(link.region, at + factor * seaKm(link.km));
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
  BUILDINGS.forEach((definition, type) => {
    if (buildingKnown(civ.knowledge, type)) catalog.push({ type, name: definition.name, one: definition.one, many: definition.many, purpose: definition.purpose, cost: buildingCost(state, civ, type), upkeep: definition.upkeep, minTier: definition.minTier, coast: definition.coast, water: definition.water, perRegion: definition.perRegion, works: definition.effects.works ?? '' });
  });
  const settlements: PolityView['build']['settlements'] = [];
  // Its works under way by settlement, and the settlements where a wonder is being built (looked up once).
  const works = new Map<number, number[]>(), wonderWorks = new Set<number>();
  for (const project of civ.projects) works.get(project.settlement)?.push(project.type) ?? works.set(project.settlement, [project.type]);
  for (const wonder of state.wonders) if (wonder.status === 'building') wonderWorks.add(wonder.settlement);
  // Sites matter only once it can build what works them.
  const mines = catalog.some(kind => kind.works === 'mineral'), quarries = catalog.some(kind => kind.works === 'stone');
  if (catalog.length) for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    // It builds nothing where it lets things go unkept (`budget.ts` `deferMaintenance`).
    if (state.neglected[region]) continue;
    // Foreign peoples on the region's borders, as it sees them (its neighbours are always in sight).
    const foreign = new Set<number>();
    for (const edge of state.partition.regions[region].neighbors) {
      const status = civ.map.status[edge.region], occupant = status === OBSERVED ? state.occupant[edge.region] : status === KNOWN ? civ.map.snapshots.get(edge.region)!.occupant : -1;
      if (occupant >= 0 && occupant !== civ.id) foreign.add(occupant);
    }
    const here = livingSettlements(state, region);
    // What the region has, or is building, of the buildings one region needs only one of.
    const regionHas: number[] = [];
    for (const settlement of here) {
      for (const building of settlement.buildings) if (BUILDINGS[building.type].perRegion) regionHas.push(building.type);
      for (const type of works.get(settlement.id) ?? []) if (BUILDINGS[type].perRegion) regionHas.push(type);
    }
    let seaLinks = 0;
    for (const link of state.partition.regions[region].sea) if (crosses(civ.knowledge.sea, link.km)) seaLinks++;
    const mineYield = mines ? siteIncome(state, civ, region, 'mineral') : 0, quarryYield = quarries ? siteIncome(state, civ, region, 'stone') : 0;
    const water = riverOrLake(state, region), farmers = Math.round(workersOf(group) * group.farmShare);
    for (const settlement of here) {
      const has = regionHas.slice();
      for (const building of settlement.buildings) has.push(building.type);
      for (const type of works.get(settlement.id) ?? []) has.push(type);
      settlements.push({
        id: settlement.id, region, name: settlement.name, tier: settlement.tier, urban: settlement.urban, housing: settlement.housing, hardship: state.hardship[region],
        farmShare: group.farmShare, farmers, stability: state.stability[region], frontier: foreign.size, raided: state.raided[region], has,
        coast: bySea(state, settlement.cell), water, seaLinks, mineYield, quarryYield, wonder: settlement.wonder !== null || wonderWorks.has(settlement.id),
      });
    }
  }
  const wonders = wonderOptions(state, civ);
  let stable = 0;
  for (const groupId of civ.groups) stable += state.stability[state.groups[groupId].region];
  const tier = knownRoadTier(civ.knowledge);
  const roads: PolityView['build']['roads'] = { tier, one: tier ? ROAD_TIERS[tier - 1].one : '', many: tier ? ROAD_TIERS[tier - 1].many : '', routes: [] };
  for (const route of roadRoutes(state, civ, tier)) {
    const settlement = state.settlements[route.settlement];
    if (route.path.some(region => state.neglected[region])) continue;
    roads.routes.push({ settlement: route.settlement, name: settlement.name, urban: settlement.urban, km: route.km, cost: route.cost, upkeep: route.upkeep, edges: route.edges.length, bridges: route.bridges });
  }
  const monuments = civ.stateReligion >= 0 && state.religions[civ.stateReligion].tenets.some(tenet => TENETS[tenet].key === 'monumentBuilders') ? FAITH_TUNING.monumentWeight : 1;
  return { regions: civ.groups.length, catalog, settlements, wonders, stability: civ.groups.length ? stable / civ.groups.length : 1, roads, monuments, piety: 1 - secularity(civ) };
}

/**
 * The wonders a civilization could begin (VISION.md "Wonders"): one at a time, each unique in the world while it stands
 * or is being built; a wonder elsewhere rules its type out only once word of it has reached this civilization.
 */
export function wonderOptions(state: SimulationState, civ: Polity): PolityView['build']['wonders'] {
  const wonders: PolityView['build']['wonders'] = [];
  if (state.wonders.some(wonder => wonder.status === 'building' && state.settlements[wonder.settlement].owner === civ.id)) return wonders;
  WONDERS.forEach((definition, type) => {
    if (!wonderKnown(civ.knowledge, type) || state.wonders.some(wonder => wonder.type === type && (wonder.status === 'building' || wonder.status === 'standing') && knowsOfWonder(state, civ, wonder))) return;
    wonders.push({ type, name: definition.name, motive: definition.motive, cost: definition.cost, months: definition.months, upkeep: definition.upkeep, minTier: definition.minTier, coast: definition.coast });
  });
  return wonders;
}

/** A civilization's budget as it knows it: its own output, sites, costs (all it holds kept up: letting far regions go
 *  does not make it less strained) and treasury (`PolityView['budget']`). */
export function budgetView(state: SimulationState, civ: Polity, costs: Costs = fullCostsOf(state, civ)): PolityView['budget'] {
  const { output, sites } = outputOf(state, civ), total = totalCosts(costs);
  // What its trade agreements bring in a year, net: what it is paid less what it pays (M5.4).
  const trade = tradeIncome(state, civ);
  const revenue = BUDGET_TUNING.customaryRate * output + sites + trade;
  let calm = 0, people = 0;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    calm += group.size * state.calm[region];
    people += group.size;
  }
  return {
    rate: civ.taxRate, output, sites, trade, costs: total, treasury: civ.wealth, revenue, surplus: revenue - total,
    // Strain is the weight of running the realm (M3c), not of the army it chooses to keep (M6.1).
    strain: revenue > 0 ? Math.max(0, Math.min(1, (total - costs.army) / revenue - 1)) : total - costs.army > 0 ? 1 : 0, tradition: effectiveValues(state, civ).tradition,
    calm: people > 0 ? Math.max(0, calm / people) : 1,
  };
}

/**
 * Whether word of a wonder has reached a civilization (VISION.md "Wonders": known only through contact, but word of
 * great works travels one step further than other news): it holds it, or has met the people who hold it, or has met a
 * people who has; or it has heard of it by trying to build the same.
 */
export function knowsOfWonder(state: SimulationState, civ: Polity, wonder: SimulationState['wonders'][number]) {
  const holder = state.settlements[wonder.settlement].owner;
  if (holder === civ.id || civ.met.has(holder) || civ.heardWonders.includes(wonder.id)) return true;
  // Word travels through living peoples, as other news does.
  for (const other of civ.met.keys()) if (state.polities[other].deathTick === null && state.polities[other].met.has(holder)) return true;
  return false;
}

/** Whether a region has a river or a lake (where irrigation may water its fields). */
export const riverOrLake = (state: SimulationState, region: number) => state.partition.regions[region].riverTier >= 1 || state.partition.regions[region].openLake;

/** Whether the sea lies beside a cell (where a harbor may stand). */
const seaNear = new Int32Array(4);
export function bySea(state: SimulationState, cell: number) {
  for (const other of cellNeighbors(state.geography, cell, seaNear)) if (other >= 0 && state.geography.marine[other]) return true;
  return false;
}

/** How ready a people is to accept an exchange: less with strong Tradition and another way of life, less when it would
 *  learn little (VISION.md "Sharing knowledge"). The decision weighs it and `sharing.ts` draws with it. */
export function willingness(tradition: number, similarity: number, gain: number) {
  const tuning = SHARE_TUNING;
  const open = Math.max(0, Math.min(1, 1 - tuning.refusal * tradition * (1 - similarity)));
  return open * (tuning.gainBase + (1 - tuning.gainBase) * Math.min(1, gain / tuning.techScale));
}

export function decisionView(state: SimulationState, polity: Polity): PolityView {
  const regions = state.partition.regions, map = polity.map;
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
      value: state.landValue[region], tribe: view.occupant >= 0, short: reliefThere(state, polity, region),
    });
  };
  for (const region of own) {
    for (const edge of regions[region].neighbors) consider(region, edge.region, edgeKm(edge.travelKm, edge.riverTier));
    const sea = seaFrom(state, polity, region);
    if (sea > 0) for (const link of regions[region].sea) if (crosses(sea, link.km)) consider(region, link.region, seaKm(link.km));
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
    const them = state.polities[civ], people = believe(state, polity, them, 'people');
    neighbours.set(civ, {
      civ, name: them.name, kin: them.lineage === polity.lineage, similarity: cultureSimilarity(culture, state.cultures[them.culture].values), knownRegions: 0,
      believedPeople: people.estimate, confidence: people.confidence, opinion: opinionOf(polity, civ), fed: 0, stability: 0, crossingKm: km, border: region,
    });
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
    partners.push({ polity: other, name: them.name, kind: them.kind, kin: them.lineage === polity.lineage, similarity, opinion: opinionOf(polity, other), teach, learn, willing: willingness(theirs.tradition, similarity, teach) });
  }
  partners.sort((a, b) => a.polity - b.polity);
  const view: PolityView = {
    budget: budgetView(state, polity), build: buildView(state, polity),
    id: polity.id, tick: state.tick, values: effectiveValues(state, polity), needs: Object.fromEntries(NEED_NAMES.map(need => [need, 0])) as PolityView['needs'], threats: [],
    sea: polity.knowledge.sea, seaTick: polity.seaTick, trades: tradeOptions(state, polity), pacts: [], roads: [], voyage: voyageOption(state, polity),
    warTargets: [], atWar: atWarOf(state, polity), arrears: polity.arrears, weariness: wearinessOf(polity, state.tick), raided: raidedOf(state, polity),
    reachKm: REACH_TUNING.baseKm * polity.knowledge.multipliers.reach,
    people, landPressure: people > 0 ? pressure / people : 0, hunger: people > 0 ? hunger / people : 0,
    ownValue: own.size ? value / own.size : 0,
    candidates: [...found.values()].sort((a, b) => a.region - b.region), unknownFrontier,
    regions: own.size, unrestShare: own.size ? unrest / own.size : 0, stability: own.size ? stable / own.size : 1,
    neighbours: [...neighbours.values()].sort((a, b) => a.civ - b.civ), partners, exchanges,
  };
  view.needs = needsOf(state, polity, view, own);
  view.pacts = pactOptions(state, polity, view);
  view.roads = roadOptions(state, polity);
  view.warTargets = warTargets(state, polity, view, own);
  return view;
}

/** (M6.2) The wars it could declare (`WarTarget`): on each civilization it has met whose land touches its own, that is
 *  not its ally and not within a truce, while it fights no war itself (a war on a pact partner breaks the pact). */
function warTargets(state: SimulationState, polity: Polity, view: PolityView, own: Set<number>): WarTarget[] {
  if (polity.kind !== 'civ' || polity.wars.length) return [];
  const tuning = WAR_TUNING, targets: WarTarget[] = [];
  const mine = strengthWithAllies(state, polity), treasury = Math.max(1, polity.wealth), km = capitalTravel(state, polity), reachKm = REACH_TUNING.baseKm * polity.knowledge.multipliers.reach;
  const capitalOf = (civ: Polity) => civ.capital !== null ? state.settlements[civ.capital].region : -1;
  const claimed = new Map(polity.claims.map(claim => [claim.region, claimWeight(claim.tick, state.tick)]));
  for (const enemy of borderingCivs(state, polity, own)) {
    const them = state.polities[enemy];
    if (them.kind !== 'civ' || polity.allies.includes(enemy) || inTruce(state, polity.id, enemy)) continue;
    // Their land next to its own (and a region beyond), as it knows it: where taking it would move its border onto harder
    // ground first, then good land, claimed land more (VISION.md M6: borders settle onto barriers).
    const theirCapital = capitalOf(them);
    const believed = (region: number) => regionView(state, polity, region)?.owner ?? -1;
    const { goal, gain } = chooseGoal(state, polity.id, enemy, claimed, view.ownValue, region => region !== theirCapital || them.groups.length <= tuning.goalRegions, believed);
    if (!goal.length) continue;
    // What it believes of their strength and their allies', on ground that helps them (a border it sees), each side's
    // soldiers reaching the front (its own way there; theirs as the crow flies from their capital).
    const strength = believe(state, polity, them, 'strength').estimate;
    let theirs = strength;
    for (const ally of them.allies) if (polity.met.has(ally) && ally !== polity.id) theirs += DIPLOMACY_TUNING.alliance.strength * believe(state, polity, state.polities[ally], 'strength').estimate;
    let nearest = Number.POSITIVE_INFINITY;
    for (const region of goal) nearest = Math.min(nearest, km(region));
    theirs *= defenseOf(state, goal, polity.id, region => polity.map.status[region] === OBSERVED) * supplyFrom(state, theirCapital, goal);
    const ours = mine / (1 + nearest / tuning.supplyKm), odds = ours + theirs > 0 ? ours / (ours + theirs) : 0.5;
    const ratio = strength / Math.max(1, mine), wealth = believe(state, polity, them, 'wealth').estimate / treasury;
    let value = 0, claims = 0;
    for (const region of goal) { value += state.landValue[region]; claims = Math.max(claims, claimed.get(region) ?? 0); }
    // A resource it lacks that the goal's known sites hold.
    let shortage = 0, resource = -1;
    for (const region of goal) for (const [, code] of state.partition.regions[region].sites) {
      const at = code - 1;
      if (at < 0 || depositState(polity.knowledge, RESOURCE_IDS[at]) === 'unknown') continue;
      const short = shortfallFor(polity, at);
      if (short > shortage) { shortage = short; resource = at; }
    }
    const holy = polity.stateReligion >= 0 && them.stateReligion >= 0 && them.stateReligion !== polity.stateReligion ? 1 - secularity(polity) : 0;
    // How far the goal lies beyond its governance reach (mean travel from its capital over its reach).
    let far = 0;
    for (const region of goal) far += km(region);
    targets.push({
      enemy, name: them.name, goal, odds, strength: Math.round(strength), pact: polity.pacts.includes(enemy), reach: far / goal.length / reachKm, opportunity: chanceOf(ratio, wealth),
      land: view.ownValue > 0 ? clamp01(value / goal.length / view.ownValue - 1) : 0, shortage, resource, holy, claims, threat: fearOf(state, polity, them, mine), opinion: opinionOf(polity, enemy),
      frontier: clamp01(gain / tuning.frontierScale), futility: futilityOf(state, polity.id, enemy),
    });
  }
  return targets;
}

/** (M6.4) How raided a realm's land has been lately: its regions' raid memory weighed by their people (a few raided
 *  villages of a great realm are little threat to it; a small realm raided all over is threatened). */
function raidedOf(state: SimulationState, polity: Polity) {
  let raided = 0, people = 0;
  for (const id of polity.groups) { const group = state.groups[id]; raided += state.raided[group.region] * group.size; people += group.size; }
  return people > 0 ? raided / people : 0;
}

/** (M6.2) The wars it fights now, as `AtWar`. */
function atWarOf(state: SimulationState, polity: Polity): AtWar[] {
  // (A war whose enemy is gone this month ends in the war system; it is no war to make peace in.)
  return polity.wars.filter(id => state.polities[state.wars[id].attacker].deathTick === null && state.polities[state.wars[id].defender].deathTick === null).map(id => {
    const war = state.wars[id], attacker = war.attacker === polity.id, enemy = attacker ? war.defender : war.attacker;
    return {
      war: id, enemy, name: state.polities[enemy].name, attacker, lead: attacker ? war.score : -war.score,
      exhaustion: war.exhaustion[attacker ? 0 : 1], theirs: war.exhaustion[attacker ? 1 : 0], months: state.tick - war.startTick,
    };
  });
}


const TIMBER = RESOURCE_IDS.indexOf('timber'), STONE = RESOURCE_IDS.indexOf('stone');
const TOLERANCE = TENETS.findIndex(tenet => tenet.key === 'tolerance');
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * A civilization's needs (VISION.md "Needs"; M5.2), each 0–1, from its own state and what it believes of the
 * civilizations it has met whose land touches its own (NEED_TUNING): hunger and land pressure; threat from a neighbour
 * it believes stronger and does not like; unrest; friction with neighbours of a rival faith; opportunity from better
 * land or a neighbour it believes weaker or richer; infrastructure (`infrastructureNeed`); resource shortage, its largest
 * shortfall (M5.3); grievance, its strongest claim on land another holds (M6.2).
 */
function needsOf(state: SimulationState, polity: Polity, view: PolityView, own: Set<number>): PolityView['needs'] {
  const bordering = borderingCivs(state, polity, own);
  const strength = strengthWithAllies(state, polity), treasury = Math.max(1, polity.wealth);
  let threat = 0, rivals = 0, chance = 0;
  for (const civ of bordering) {
    const them = state.polities[civ], ratio = believe(state, polity, them, 'strength').estimate / Math.max(1, strength);
    const fear = fearOf(state, polity, them, strength);
    if (fear > 0) view.threats.push({ civ, threat: fear });
    threat = Math.max(threat, fear);
    // (Not against those it is bound to by a pact or an alliance: M5.5.)
    if (!polity.allies.includes(civ) && !polity.pacts.includes(civ)) chance = Math.max(chance, chanceOf(ratio, believe(state, polity, them, 'wealth').estimate / treasury));
    // A rival faith; a tolerant one on either side rubs less (VISION.md "Tenets": Tolerance lowers friction).
    if (polity.stateReligion >= 0 && them.stateReligion >= 0 && them.stateReligion !== polity.stateReligion) {
      rivals += state.religions[polity.stateReligion].tenets.includes(TOLERANCE) || state.religions[them.stateReligion].tenets.includes(TOLERANCE) ? 0.5 : 1;
    }
  }
  let land = 0;
  for (const candidate of view.candidates) if (view.ownValue > 0) land = Math.max(land, candidate.value / view.ownValue - 1);
  let shortage = 0;
  for (let resource = 0; resource < polity.demand.length; resource++) shortage = Math.max(shortage, shortfallFor(polity, resource));
  return {
    // (M6.4: raiders on its land are a threat too.)
    hunger: clamp01(view.hunger), landPressure: clamp01(view.landPressure), shortage, threat: Math.max(threat, view.raided), unrest: unrestOf(view.unrestShare, view.stability),
    friction: frictionOf(bordering.length ? rivals / bordering.length : 0, view.values.zeal, secularity(polity)),
    opportunity: clamp01(Math.max(land, chance)), grievance: grievanceOf(state, polity), infrastructure: infrastructureNeed(view),
  };
}

/**
 * The trades a civilization could propose (M5.4): for its largest shortfalls, each civilization it has met with a hub,
 * whose land as it knows it (its map) holds sites of that resource, more than it believes they need themselves, that
 * sends it none of it now and has not lately refused it.
 */
function tradeOptions(state: SimulationState, polity: Polity): TradeOption[] {
  const tuning = TRADE_TUNING;
  if (polity.kind !== 'civ') return [];
  // What it lacks enough of to trade for (and does not itself send away).
  const wanted: number[] = [];
  for (let resource = 0; resource < polity.demand.length; resource++) {
    if (shortfallFor(polity, resource) > tuning.minShort && lackOf(polity, resource) >= tuning.minAmount && polity.exports[resource] === 0) wanted.push(resource);
  }
  const hub = wanted.length ? hubOf(state, polity) : -1;
  if (hub < 0) return [];
  wanted.sort((a, b) => shortfallFor(polity, b) - shortfallFor(polity, a) || a - b);
  wanted.length = Math.min(wanted.length, tuning.resources);
  // Civilizations whose land it knows to hold what it lacks: sites of it (a deposit it knows of), or forest and rough
  // land for timber and stone.
  const holders = new Map<number, boolean[]>(), stock = landStock(state.geography, state.partition), timber = wanted.indexOf(TIMBER), stone = wanted.indexOf(STONE);
  const count = (region: number) => {
    const owner = regionView(state, polity, region)?.owner ?? -1;
    if (owner < 0 || owner === polity.id) return;
    let holds = holders.get(owner);
    const add = (at: number) => { holds ??= wanted.map(() => false); holds[at] = true; holders.set(owner, holds); };
    if (timber >= 0 && stock.forest[region] > 0) add(timber);
    if (stone >= 0 && stock.rough[region] > 0) add(stone);
    for (const [, code] of state.partition.regions[region].sites) {
      const at = wanted.indexOf(code - 1);
      if (at >= 0 && depositState(polity.knowledge, RESOURCE_IDS[code - 1]) !== 'unknown') add(at);
    }
  };
  for (const region of polity.map.observed) count(region);
  polity.map.snapshots.forEach((_, region) => count(region));
  const options: TradeOption[] = [];
  for (const [partner, holds] of [...holders].sort((a, b) => a[0] - b[0])) {
    const them = state.polities[partner];
    if (them.deathTick !== null || them.kind !== 'civ' || !polity.met.has(partner) || warBetween(state, polity.id, partner)) continue;
    const refused = polity.relations.get(partner)?.memories.some(memory => memory.reason === 'refusedTrade' && state.tick - memory.tick < tuning.refusedYears * 12);
    const theirHub = hubOf(state, them);
    if (refused || theirHub < 0) continue;
    const route = routeOf(state, polity, them, hub, theirHub);
    // What it believes they could spare: a belief like that of their people (off by the same bias, shrunk by intimacy).
    const bias = beliefBias(state.seed, polity.id, partner, 'people'), intimacy = polity.relations.get(partner)?.intimacy ?? 0;
    const believedPeople = Math.round(believe(state, polity, them, 'people').estimate);
    wanted.forEach((resource, at) => {
      const lack = lackOf(polity, resource);
      if (!holds[at] || activeTrade(state, partner, polity.id, resource)) return;
      const spare = estimate(spareOf(them, resource), bias, intimacy, 'people');
      if (spare < tuning.minAmount) return;
      options.push({
        partner, name: them.name, resource, resourceName: RESOURCE_IDS[resource], shortfall: shortfallFor(polity, resource), lack, spare: Math.round(spare * 1000) / 1000, believedPeople, opinion: opinionOf(polity, partner),
        openness: state.cultures[them.culture].values.openness, km: route.km, reachKm: route.reachKm, capacity: route.capacity, cost: tuning.price * Math.min(lack, spare, route.capacity),
      });
    });
  }
  return options;
}

/** The living civilizations it has met whose land touches its own regions (`own`, by default all it holds), ascending. */
export function borderingCivs(state: SimulationState, polity: Polity, own?: Iterable<number>) {
  const bordering = new Set<number>();
  for (const region of own ?? polity.groups.map(id => state.groups[id].region)) for (const edge of state.partition.regions[region].neighbors) {
    const civ = state.owner[edge.region];
    if (civ >= 0 && civ !== polity.id && polity.met.has(civ) && state.polities[civ].deathTick === null) bordering.add(civ);
  }
  return [...bordering].sort((a, b) => a - b);
}

/**
 * What a civilization weighs when it sets the army it means to keep (M6.1; `decisions/army.ts`): its people,
 * Militarism and military multiplier; the strength of its allies as it counts them (DIPLOMACY_TUNING.alliance.strength
 * of each ally's believed strength); each civilization it has met whose land touches its own, with the strength it
 * believes of it, its opinion of it and whether a pact binds them (an ally is no threat); its revenue a year at
 * customary taxes and what its other costs leave of it (its surplus, before any army); its arrears; and what a soldier
 * costs it.
 */
export interface ArmyView {
  people: number; militarism: number; multiplier: number; allies: number;
  neighbours: { polity: number; name: string; strength: number; opinion: number; pact: boolean; war: boolean }[];
  revenue: number; surplus: number; arrears: number; upkeep: number;
  /** (M6.2) The wars it fights now; (M6.3) its war income (loot and tribute received lately, fading); (M6.4) how raided
   *  its land has been lately (0–1). */
  wars: number; warIncome: number; raided: number;
}
export function armyView(state: SimulationState, civ: Polity): ArmyView {
  const costs = fullCostsOf(state, civ), budget = budgetView(state, civ, costs);
  let allies = 0, people = 0;
  for (const ally of civ.allies) allies += DIPLOMACY_TUNING.alliance.strength * believe(state, civ, state.polities[ally], 'strength').estimate;
  for (const id of civ.groups) people += state.groups[id].size;
  const neighbours: ArmyView['neighbours'] = [];
  for (const other of borderingCivs(state, civ)) {
    if (civ.allies.includes(other)) continue;
    const them = state.polities[other];
    neighbours.push({ polity: other, name: them.name, strength: believe(state, civ, them, 'strength').estimate, opinion: opinionOf(civ, other), pact: civ.pacts.includes(other), war: civ.wars.some(id => state.wars[id].attacker === other || state.wars[id].defender === other) });
  }
  return {
    people, militarism: effectiveValues(state, civ).militarism, multiplier: civ.knowledge.multipliers.military, allies, neighbours,
    revenue: budget.revenue, surplus: budget.revenue - (budget.costs - costs.army), arrears: civ.arrears, upkeep: soldierUpkeep(civ), wars: civ.wars.length, warIncome: warIncomeOf(civ, state.tick), raided: raidedOf(state, civ),
  };
}

/** The strength it judges others against (M5.5): its own, and DIPLOMACY_TUNING.alliance.strength of each ally's as it
 *  believes it. */
export function strengthWithAllies(state: SimulationState, polity: Polity) {
  let strength = truthOf(state, polity, 'strength');
  for (const ally of polity.allies) strength += DIPLOMACY_TUNING.alliance.strength * believe(state, polity, state.polities[ally], 'strength').estimate;
  return strength;
}

/** The threat it feels from another civilization (`threatOf`, against its strength with its allies): none from an
 *  ally, less from a pact partner (M5.5). */
export function fearOf(state: SimulationState, polity: Polity, other: Polity, strength = strengthWithAllies(state, polity)) {
  if (polity.allies.includes(other.id)) return 0;
  const fear = threatOf(believe(state, polity, other, 'strength').estimate / Math.max(1, strength), opinionOf(polity, other.id));
  return polity.pacts.includes(other.id) ? fear * (1 - DIPLOMACY_TUNING.pact.calm) : fear;
}

/** Whether a civilization has lately refused it a treaty, or a treaty between them lately soured (DIPLOMACY_TUNING.refusedYears). */
const refusedTreaty = (state: SimulationState, polity: Polity, other: number) =>
  polity.relations.get(other)?.memories.some(memory => (memory.reason === 'refusedTreaty' || memory.reason === 'treatySoured') && state.tick - memory.tick < DIPLOMACY_TUNING.refusedYears * 12) ?? false;

/**
 * The pacts and alliances a civilization could propose (M5.5): a non-aggression pact to each neighbour it has none
 * with; a defensive alliance to each civilization it has met and is not allied with, thinks at least
 * DIPLOMACY_TUNING.alliance.minOpinion of, and knows (from its map) to border a neighbour it feels threatened by (its
 * strongest such threat). None to a people that lately refused it a treaty.
 */
function pactOptions(state: SimulationState, polity: Polity, view: PolityView): PactOption[] {
  if (polity.kind !== 'civ') return [];
  const options: PactOption[] = [];
  const option = (other: number, kind: PactOption['kind'], threat: number, enemy: number) => {
    const them = state.polities[other], feared = enemy >= 0 ? enemy : other;
    options.push({
      partner: other, name: them.name, kind, threat, enemy, enemyName: enemy >= 0 ? state.polities[enemy].name : '', opinion: opinionOf(polity, other),
      kin: them.lineage === polity.lineage, faith: polity.stateReligion >= 0 && them.stateReligion === polity.stateReligion,
      feared: threat > 0 ? { polity: feared, strength: Math.round(believe(state, polity, state.polities[feared], 'strength').estimate) } : null,
    });
  };
  for (const other of borderingCivs(state, polity)) {
    if (state.polities[other].kind !== 'civ' || polity.pacts.includes(other) || polity.allies.includes(other) || opinionOf(polity, other) < DIPLOMACY_TUNING.end.pact || refusedTreaty(state, polity, other) || warBetween(state, polity.id, other)) continue;
    option(other, 'nonAggression', view.threats.find(entry => entry.civ === other)?.threat ?? 0, -1);
  }
  // Allies against what it fears: whoever it knows to border a neighbour that threatens it (not a pact partner of its
  // own, and not one bound to that neighbour by a pact or an alliance).
  const common = new Map<number, { threat: number; enemy: number }>();
  for (const { civ: enemy, threat } of view.threats) {
    if (polity.pacts.includes(enemy)) continue;
    const known = (region: number) => {
      if (regionView(state, polity, region)?.owner !== enemy) return;
      for (const edge of state.partition.regions[region].neighbors) {
        const other = regionView(state, polity, edge.region)?.owner ?? -1;
        if (other < 0 || other === polity.id || other === enemy || !polity.met.has(other) || state.polities[other].kind !== 'civ' || state.polities[other].deathTick !== null) continue;
        if (state.polities[other].allies.includes(enemy) || state.polities[other].pacts.includes(enemy)) continue;
        const held = common.get(other);
        if (!held || threat > held.threat) common.set(other, { threat, enemy });
      }
    };
    for (const region of polity.map.observed) known(region);
    polity.map.snapshots.forEach((_, region) => known(region));
  }
  for (const [other, { threat, enemy }] of [...common].sort((a, b) => a[0] - b[0])) {
    if (polity.allies.includes(other) || opinionOf(polity, other) < DIPLOMACY_TUNING.alliance.minOpinion || refusedTreaty(state, polity, other) || warBetween(state, polity.id, other)) continue;
    option(other, 'alliance', threat, enemy);
  }
  return options;
}

/**
 * The road agreements a civilization could propose (M5.5): to each ally or trade partner whose land touches its own,
 * with which it has none, when a joint road could be built between their nearest towns or cities (`jointRoute`: both
 * know roads, the way through their two lands, the land it would cross kept up): its travel-km and what its own
 * stretch would cost.
 */
function roadOptions(state: SimulationState, polity: Polity): RoadOption[] {
  if (polity.kind !== 'civ' || !knownRoadTier(polity.knowledge) || (!polity.trading.length && !polity.allies.length)) return [];
  const bordering = new Set(borderingCivs(state, polity)), options: RoadOption[] = [];
  for (const other of [...new Set([...polity.trading, ...polity.allies])].sort((a, b) => a - b)) {
    const them = state.polities[other];
    if (!bordering.has(other) || polity.roadPartners.includes(other) || opinionOf(polity, other) < DIPLOMACY_TUNING.end.road || refusedTreaty(state, polity, other) || warBetween(state, polity.id, other)) continue;
    const route = jointRoute(state, polity, them);
    if (!route) continue;
    options.push({
      partner: other, name: them.name, opinion: opinionOf(polity, other), trading: polity.trading.includes(other), allied: polity.allies.includes(other), km: route.km,
      cost: route.sides[0].cost,
    });
  }
  return options;
}

/** The overseas voyage a civilization could send (M5.6), or null without Sailing or a harbor. */
function voyageOption(state: SimulationState, polity: Polity): PolityView['voyage'] {
  const sea = polity.knowledge.sea;
  if (polity.kind !== 'civ' || sea < 1) return null;
  const harbors = harborRegions(state, polity).length;
  if (!harbors) return null;
  const reachKm = VOYAGE_TUNING.reachKm[sea];
  return { harbors, reachKm, loss: lossChance(sea, reachKm / 2), years: polity.voyageTick < 0 ? -1 : (state.tick - polity.voyageTick) / 12, empty: polity.emptyVoyages };
}

/** Threat from one neighbour (`decisions/threat.ts`): believed `ratio` times as strong as itself, and disliked. */
export { threatOf };
/** Grievance (M6.2): the weight of its strongest claim on land another civilization holds now (claims fade). */
export function grievanceOf(state: SimulationState, polity: Polity) {
  let most = 0;
  for (const claim of polity.claims) { const owner = state.owner[claim.region]; if (owner >= 0 && owner !== polity.id) most = Math.max(most, claimWeight(claim.tick, state.tick)); }
  return most;
}
/** Opportunity from one neighbour: believed weaker (`ratio` of its strength) and richer (`wealth` times its treasury). */
export const chanceOf = (ratio: number, wealth: number) => clamp01(NEED_TUNING.weak * clamp01(1 - ratio) + NEED_TUNING.rich * clamp01(wealth - 1));
/** Unrest: the larger of the share of its regions in unrest and how far its stability is below the calm line. */
export const unrestOf = (unrestShare: number, stability: number) =>
  clamp01(Math.max(unrestShare, (NEED_TUNING.calmStability - stability) / NEED_TUNING.calmStability));
/** Friction: the share of its neighbours of a rival faith, by its Zeal, less in the secular age. */
export const frictionOf = (rivalShare: number, zeal: number, secular: number) => clamp01(rivalShare * zeal * (1 - secular));

/** Infrastructure need (VISION.md "Needs"): the largest of the share of its towns and cities its roads do not reach,
 *  the share of its settlements going hungry with no granary or silo, and 1 for a coast without a harbor once it could
 *  sail and build one. */
export function infrastructureNeed(view: PolityView) {
  const build = view.build, towns = build.settlements.filter(settlement => settlement.tier >= 1);
  // Its towns and cities in the regions its roads do not reach (a route is the road one such region would need).
  const unreached = new Set(build.roads.routes.map(route => build.settlements.find(settlement => settlement.id === route.settlement)?.region));
  const unconnected = build.roads.tier > 0 && towns.length > 0 ? towns.filter(settlement => unreached.has(settlement.region)).length / towns.length : 0;
  const food = new Set(build.catalog.filter(entry => entry.purpose === 'food').map(entry => entry.type));
  const hungry = food.size && build.settlements.length
    ? build.settlements.filter(settlement => settlement.hardship >= NEED_TUNING.hungry && !settlement.has.some(type => food.has(type))).length / build.settlements.length : 0;
  const harbor = build.catalog.find(entry => entry.purpose === 'sea')?.type;
  // A coast with somewhere to sail to (the harbor is the one building whose purpose is the sea).
  const noHarbor = view.sea >= 1 && harbor !== undefined && build.settlements.some(settlement => settlement.coast && settlement.seaLinks > 0) && !build.settlements.some(settlement => settlement.has.includes(harbor)) ? 1 : 0;
  return clamp01(Math.max(unconnected, hungry, noHarbor));
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
  return { tribe: tribe.id, people, values: effectiveValues(state, tribe), options: [...found.values()].sort((a, b) => a.civ - b.civ) };
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
