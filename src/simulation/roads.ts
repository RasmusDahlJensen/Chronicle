import { ROAD_TIER_NAMES } from '../../shared/simulation.ts';
import { CostHeap } from './heap.ts';
import type { Knowledge } from './knowledge.ts';
import type { RegionEdge } from './regions.ts';
import { livingSettlements } from './settlements.ts';
import type { Polity, Road, SimulationState } from './state.ts';
import { TECHS } from './techs.ts';
import { BUILD_TUNING, REACH_TUNING } from './tunables.ts';

/**
 * Roads and bridges as data, and the rules they follow (VISION.md "Settlements and infrastructure": Roads, Bridges,
 * Destruction). A road lies on the land edge between two regions. Its tier rises with technology (road with the Wheel,
 * paved road with Engineering, railway, highway), and each tier lowers the edge's travel cost. A bridge carries a
 * paved road or better over the river on its edge and removes the river's surcharge. A civilization builds roads from
 * its capital to its towns and cities along the cheapest route through its own land, and keeps them up; unpaid or
 * unkept, they wear away.
 */
export interface RoadTier {
  /** Its id (named by the unlocks of the tech that allows it), its name with its article and in the plural. */
  id: string; name: string; one: string; many: string;
  /** Wealth to build per travel-km, travel-km built a month, the travel cost it leaves (a share of the bare edge's),
   *  and whether it bridges the rivers it crosses. */
  perKm: number; kmPerMonth: number; travel: number; bridges: boolean;
}

export const ROAD_TIERS: readonly RoadTier[] = [
  { id: 'road', name: 'road', one: 'a road', many: 'roads', perKm: 4, kmPerMonth: 100, travel: 0.75, bridges: false },
  { id: 'pavedRoad', name: 'paved road', one: 'a paved road', many: 'paved roads', perKm: 12, kmPerMonth: 40, travel: 0.5, bridges: true },
  { id: 'railway', name: 'railway', one: 'a railway', many: 'railways', perKm: 60, kmPerMonth: 30, travel: 0.25, bridges: true },
  { id: 'highway', name: 'highway', one: 'a highway', many: 'highways', perKm: 100, kmPerMonth: 30, travel: 0.2, bridges: true },
];

/** A bridge: its cost by the river tier it crosses (none, stream, river, great river), and the months it adds. */
export const BRIDGE = { cost: [0, 2_000, 6_000, 15_000], months: 12 } as const;

const UNLOCKED_BY = ROAD_TIERS.map(tier => TECHS.flatMap((tech, index) => tech.effects.unlocks?.includes(tier.id) ? [index] : []));

/** The best road tier this knowledge allows (0: none). */
export function knownRoadTier(knowledge: Knowledge) {
  for (let tier = ROAD_TIERS.length; tier >= 1; tier--) if (UNLOCKED_BY[tier - 1].some(tech => knowledge.known[tech])) return tier;
  return 0;
}

/** Startup check: an unlocking tech for each tier, rising costs and falling travel cost, positive rates. */
export function validateRoads() {
  const problems: string[] = [];
  if (ROAD_TIERS.length !== ROAD_TIER_NAMES.length || ROAD_TIERS.some((tier, index) => tier.name !== ROAD_TIER_NAMES[index])) problems.push('road tiers must match the contract\'s ROAD_TIER_NAMES');
  ROAD_TIERS.forEach((tier, index) => {
    if (!UNLOCKED_BY[index].length) problems.push(`no tech unlocks ${tier.id}`);
    if (!(tier.perKm > 0 && tier.kmPerMonth > 0 && tier.travel > 0 && tier.travel < 1)) problems.push(`${tier.id} has invalid cost, rate or travel`);
    if (index > 0 && !(tier.travel < ROAD_TIERS[index - 1].travel && tier.perKm > ROAD_TIERS[index - 1].perKm)) problems.push(`${tier.id} must cost more and travel faster than ${ROAD_TIERS[index - 1].id}`);
  });
  if (!(BRIDGE.cost.length === REACH_TUNING.riverCrossing.length && BRIDGE.cost.every(cost => Number.isInteger(cost) && cost >= 0) && BRIDGE.months >= 0)) problems.push('bridge costs are invalid');
  if (problems.length) throw new Error(`Invalid road data: ${problems.join('; ')}.`);
}

/** The key of the land edge between two regions in `SimulationState.roads`. */
export const roadKey = (regions: number, a: number, b: number) => a < b ? a * regions + b : b * regions + a;

/** Travel cost of a bare land edge: river crossings cost extra. */
export const edgeKm = (travelKm: number, riverTier: number) => travelKm * (1 + REACH_TUNING.riverCrossing[riverTier]);

/** Travel cost of the land edge from `from`, with the road on it if any (unless `roads` is false): its tier's share of
 *  the distance, and the river's surcharge unless a bridge carries it. */
export function edgeTravel(state: SimulationState, from: number, edge: RegionEdge, roads = true) {
  if (roads && state.roads.size) {
    const road = state.roads.get(roadKey(state.partition.regions.length, from, edge.region));
    if (road) return edge.travelKm * (ROAD_TIERS[road.tier - 1].travel + (road.bridge ? 0 : REACH_TUNING.riverCrossing[edge.riverTier]));
  }
  return edgeKm(edge.travelKm, edge.riverTier);
}

/** The edge from region `a` to region `b`. */
export function edgeBetween(state: SimulationState, a: number, b: number) {
  return state.partition.regions[a].neighbors.find(edge => edge.region === b);
}

/** A road's upkeep a year: a share of what its tier and its bridge cost to build on this edge. */
export function roadUpkeep(tier: number, edge: RegionEdge, bridge: boolean) {
  return Math.round(BUILD_TUNING.roadUpkeep * (ROAD_TIERS[tier - 1].perKm * edge.travelKm + (bridge ? BRIDGE.cost[edge.riverTier] : 0)));
}

/** Who keeps a road up: the civilization holding its first region, else its second; −1 when neither is held. */
export function keeperOf(state: SimulationState, road: Road) {
  const first = state.owner[road.a];
  return first >= 0 ? first : state.owner[road.b];
}

/** The upkeep a year of the roads a civilization keeps. */
export function roadUpkeepOf(state: SimulationState, civ: Polity) {
  let upkeep = 0;
  for (const road of state.roads.values()) if (keeperOf(state, road) === civ.id) upkeep += road.upkeep;
  return upkeep;
}

/** A road a civilization could build: to a town or city (the largest of its region) from its capital. */
export interface Route {
  /** The settlement it reaches, that settlement's region, its travel-km from the capital now, and the regions on the
   *  way (the capital's first). */
  settlement: number; region: number; km: number; path: number[];
  /** The edges to build or improve (each as [lower region, higher region]), the bridges among them, and the wealth,
   *  months and upkeep a year (beyond the roads there now) it would take. */
  edges: [number, number][]; bridges: number; cost: number; months: number; upkeep: number;
}

// Reused across searches: cost and predecessor per region (by stamp), the regions roads already serve, and the heap.
let routeStamp = new Int32Array(0), routeMark = 0, routeCost = new Float64Array(0), routeFrom = new Int32Array(0), servedStamp = new Int32Array(0);
const routeHeap = new CostHeap(), servedQueue: number[] = [];

/** Whether the road on this edge serves at `tier`: at the tier or better, and bridged where that tier bridges a river. */
function serves(road: Road | undefined, edge: RegionEdge, tier: number) {
  return !!road && road.tier >= tier && (!ROAD_TIERS[tier - 1].bridges || edge.riverTier < 1 || road.bridge);
}

/** A stretch of road that already serves (or is being built) counts this share of its travel cost when routes are laid
 *  out, so new roads branch off the network instead of running beside it. */
const REUSE = 0.1;

/**
 * The roads a civilization could build now at `tier` (VISION.md "Roads": the capital to its towns and cities along the
 * cheapest route): for each of its regions with a town or city that its roads at that tier do not yet join to its
 * capital through its own land, the cheapest way there through its own land, where stretches its roads already serve
 * at the tier (or that its works at the tier or better are building) count for little, so the network grows as
 * branches from what stands. The road is the way's edges below the tier, or lacking a bridge where the tier bridges
 * rivers, that no such work is building. Regions its own land does not reach give none.
 */
export function roadRoutes(state: SimulationState, civ: Polity, tier: number): Route[] {
  if (civ.capital === null || tier < 1) return [];
  const regions = state.partition.regions, n = regions.length, definition = ROAD_TIERS[tier - 1];
  if (routeStamp.length !== n) { routeStamp = new Int32Array(n); routeCost = new Float64Array(n); routeFrom = new Int32Array(n); servedStamp = new Int32Array(n); routeMark = 0; }
  routeMark++;
  const pending = new Set<number>();
  for (const work of civ.roadWorks) if (work.tier >= tier) for (const [a, b] of work.edges) pending.add(a * n + b);
  const origin = state.settlements[civ.capital].region;
  // Regions its roads at the tier already join to the capital.
  servedStamp[origin] = routeMark; servedQueue.length = 0; servedQueue.push(origin);
  while (servedQueue.length) {
    const region = servedQueue.pop()!;
    for (const edge of regions[region].neighbors) {
      if (servedStamp[edge.region] === routeMark || state.owner[edge.region] !== civ.id || !serves(state.roads.get(roadKey(n, region, edge.region)), edge, tier)) continue;
      servedStamp[edge.region] = routeMark; servedQueue.push(edge.region);
    }
  }
  routeStamp[origin] = routeMark; routeCost[origin] = 0; routeFrom[origin] = -1;
  routeHeap.clear(); routeHeap.push(0, origin);
  while (routeHeap.size) {
    const [at, region] = routeHeap.pop();
    if (at > routeCost[region]) continue;
    for (const edge of regions[region].neighbors) {
      if (state.owner[edge.region] !== civ.id) continue;
      const key = roadKey(n, region, edge.region), travel = edgeTravel(state, region, edge);
      const through = at + (pending.has(key) || serves(state.roads.get(key), edge, tier) ? REUSE * travel : travel);
      if (routeStamp[edge.region] === routeMark && routeCost[edge.region] <= through) continue;
      routeStamp[edge.region] = routeMark; routeCost[edge.region] = through; routeFrom[edge.region] = region;
      routeHeap.push(through, edge.region);
    }
  }
  const routes: Route[] = [];
  for (const groupId of civ.groups) {
    const region = state.groups[groupId].region;
    if (servedStamp[region] === routeMark || routeStamp[region] !== routeMark) continue;
    let target = -1, urban = -1;
    for (const settlement of livingSettlements(state, region)) if (settlement.tier >= 1 && settlement.urban > urban) { target = settlement.id; urban = settlement.urban; }
    if (target < 0) continue;
    const route: Route = { settlement: target, region, km: 0, path: [region], edges: [], bridges: 0, cost: 0, months: 0, upkeep: 0 };
    for (let to = region, from = routeFrom[region]; from >= 0; to = from, from = routeFrom[from]) {
      route.path.push(from);
      const edge = edgeBetween(state, from, to)!, key = roadKey(n, from, to), road = state.roads.get(key);
      // Its travel-km from the capital now, along this way.
      route.km += edgeTravel(state, from, edge);
      const bridge = definition.bridges && edge.riverTier >= 1, newBridge = bridge && !road?.bridge, newTier = !road || road.tier < tier;
      if (!(newTier || newBridge) || pending.has(key)) continue;
      route.edges.push(from < to ? [from, to] : [to, from]);
      if (newTier) { route.cost += Math.round(definition.perKm * edge.travelKm); route.months += Math.ceil(edge.travelKm / definition.kmPerMonth); }
      if (newBridge) { route.bridges++; route.cost += BRIDGE.cost[edge.riverTier]; route.months += BRIDGE.months; }
      route.upkeep += roadUpkeep(Math.max(tier, road?.tier ?? 0), edge, bridge || (road?.bridge ?? false)) - (road?.upkeep ?? 0);
    }
    if (!route.edges.length) continue;
    route.path.reverse(); route.edges.reverse();
    routes.push(route);
  }
  return routes;
}

const WHEEL = TECHS.findIndex(tech => tech.name === 'Wheel');

/**
 * VISION.md M3b's road coverage: of the living civilizations with at least `minRegions` regions that know the Wheel and
 * have a town or city besides their capital, how many there are and how many reach at least half of those towns and
 * cities from their capital by road (those in the capital's own region count as reached).
 */
export function roadCoverage(state: SimulationState, minRegions = 5) {
  const regions = state.partition.regions, n = regions.length;
  let civs = 0, covered = 0;
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ' || civ.capital === null || civ.groups.length < minRegions || !civ.knowledge.known[WHEEL]) continue;
    let towns = 0;
    for (const groupId of civ.groups) for (const settlement of livingSettlements(state, state.groups[groupId].region)) if (settlement.tier >= 1 && settlement.id !== civ.capital) towns++;
    if (!towns) continue;
    civs++;
    const reached = new Set([state.settlements[civ.capital].region]), queue = [...reached];
    while (queue.length) {
      const region = queue.pop()!;
      for (const edge of regions[region].neighbors) if (!reached.has(edge.region) && state.roads.has(roadKey(n, region, edge.region))) { reached.add(edge.region); queue.push(edge.region); }
    }
    let served = 0;
    for (const groupId of civ.groups) {
      const region = state.groups[groupId].region;
      if (reached.has(region)) for (const settlement of livingSettlements(state, region)) if (settlement.tier >= 1 && settlement.id !== civ.capital) served++;
    }
    if (served * 2 >= towns) covered++;
  }
  return { civs, covered };
}
