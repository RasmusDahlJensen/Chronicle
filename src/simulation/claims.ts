import { BUILDINGS } from './buildings.ts';
import { greatCircleKm } from './geography.ts';
import { edgeKm } from './roads.ts';
import { livingSettlements } from './settlements.ts';
import type { SimulationState } from './state.ts';
import { RAVAGE_TUNING, WAR_TUNING } from './tunables.ts';

/**
 * What wars leave behind that other systems read (M6.2): which wars are being fought, truces, the weight of claims on
 * lost land, how hard a border is to cross and to hold, and which land a war is fought for. A leaf of the war module
 * (`war.ts`), so perception can read it.
 */

/** The war two civilizations are fighting now, if any. */
export function warBetween(state: SimulationState, a: number, b: number) {
  for (const id of state.polities[a].wars) { const war = state.wars[id]; if ((war.attacker === a && war.defender === b) || (war.attacker === b && war.defender === a)) return war; }
  return null;
}

/** Whether a war between them ended within WAR_TUNING.truceYears. */
export function inTruce(state: SimulationState, a: number, b: number) {
  for (const war of state.wars) {
    if (war.endTick === null || state.tick - war.endTick >= WAR_TUNING.truceYears * 12) continue;
    if ((war.attacker === a && war.defender === b) || (war.attacker === b && war.defender === a)) return true;
  }
  return false;
}

/** How much a claim still weighs (VISION.md "Claims on lost regions … decay slowly"): halving every claimHalfLife years. */
export const claimWeight = (tick: number, now: number) => 0.5 ** ((now - tick) / 12 / WAR_TUNING.claimHalfLife);

/** The median travel cost of all land region edges (a world's own, measured once): what a border crossing is judged against. */
const medians = new WeakMap<object, number>();
export function medianEdge(state: SimulationState) {
  let median = medians.get(state.partition);
  if (median === undefined) {
    const costs: number[] = [];
    for (const region of state.partition.regions) for (const edge of region.neighbors) if (edge.region > region.id) costs.push(edgeKm(edge.travelKm, edge.riverTier));
    costs.sort((a, b) => a - b);
    median = costs.length ? costs[Math.floor(costs.length / 2)] : 1;
    medians.set(state.partition, median);
  }
  return median;
}

/** How hard the way into a region is from a people's land (0 to WAR_TUNING.maxCrossing): its easiest border edge's travel
 *  cost over the world's median edge, less 1 — a river or a mountain pass on the border is a barrier (VISION.md M6:
 *  borders settle onto them). */
export function crossingOf(state: SimulationState, region: number, from: number) {
  let easiest = Number.POSITIVE_INFINITY;
  for (const edge of state.partition.regions[region].neighbors) if (state.owner[edge.region] === from) easiest = Math.min(easiest, edgeKm(edge.travelKm, edge.riverTier));
  return Number.isFinite(easiest) ? Math.max(0, Math.min(WAR_TUNING.maxCrossing, easiest / medianEdge(state) - 1)) : 0;
}

/** A people's war-weariness now (0–1 and more): its exhaustion when its last war ended, fading (halving every
 *  WAR_TUNING.wearyHalfLife years). */
export const wearinessOf = (polity: { weariness: { value: number; tick: number } }, now: number) => polity.weariness.value * 0.5 ** ((now - polity.weariness.tick) / 12 / WAR_TUNING.wearyHalfLife);

/**
 * How taking a region would change `from`'s borders (VISION.md M6: borders settle onto barriers), in median edges: each
 * border edge it would draw (to the region's owner's other land) counts its travel cost over the world's median edge,
 * less WAR_TUNING.barrierEdge (a crossing that much harder than the median is a barrier); each border edge it would
 * close (to `from`'s land, or to regions in `taken`, land `from` means to take with it) counts the same, negated. Above
 * 0 the border would lie on barriers or run shorter across open land: a natural frontier. Borders with third peoples
 * stay borders, so they do not count.
 */
export function frontierGain(state: SimulationState, region: number, from: number, taken: ReadonlySet<number> = NONE, ownerOf: (region: number) => number = TRUE_OWNER(state)) {
  const median = medianEdge(state), owner = ownerOf(region);
  let gain = 0;
  for (const edge of state.partition.regions[region].neighbors) {
    const other = ownerOf(edge.region), excess = edgeKm(edge.travelKm, edge.riverTier) / median - WAR_TUNING.barrierEdge;
    if (other === from || taken.has(edge.region)) gain -= excess;
    else if (other === owner) gain += excess;
  }
  return gain;
}
const NONE: ReadonlySet<number> = new Set();
/** Who holds a region, as the world is (the war system's view; a people weighing war passes what it knows instead). */
const TRUE_OWNER = (state: SimulationState) => (region: number) => state.owner[region];

/** What a region of another's is worth fighting for to `by` (VISION.md M6: borders settle onto barriers): where taking it
 *  would move its border onto harder ground, × exp(frontierWorth × `frontierGain`), first; then its land, as land value ÷
 *  (land value + `ownValue`, the mean of its own regions'), so poor land is little wanted but between good lands the
 *  frontier decides; claimed land counts × (1 + its claim, 0–1). */
export function goalWorth(state: SimulationState, region: number, by: number, claim: number, ownValue: number, taken: ReadonlySet<number> = NONE, ownerOf = TRUE_OWNER(state)) {
  const land = state.landValue[region];
  return (1 + claim) * land / (land + Math.max(1, ownValue)) * Math.exp(WAR_TUNING.frontierWorth * frontierGain(state, region, by, taken, ownerOf));
}

/**
 * The land a people fights for (a war's goal, or the counter its enemy may take): up to WAR_TUNING.goalRegions of
 * `enemy`'s regions, each next to `by`'s land or to one already chosen, the one worth most (`goalWorth`, those already
 * chosen counted as taken) at each step, so a goal can reach the river or mountains a region beyond the border. `may`
 * says which regions it may choose (their capital only when they hold little else) and `ownerOf` who it believes holds
 * a region (what it knows of the land). Returns the regions in order and the frontier the whole would gain (the sum of
 * their gains).
 */
export function chooseGoal(state: SimulationState, by: number, enemy: number, claims: ReadonlyMap<number, number>, ownValue: number, may: (region: number) => boolean, ownerOf = TRUE_OWNER(state)) {
  const goal: number[] = [], taken = new Set<number>(), candidates = new Set<number>();
  const consider = (region: number) => {
    for (const edge of state.partition.regions[region].neighbors) if (ownerOf(edge.region) === enemy && !taken.has(edge.region) && may(edge.region)) candidates.add(edge.region);
  };
  for (const id of state.polities[by].groups) consider(state.groups[id].region);
  let gain = 0;
  while (goal.length < WAR_TUNING.goalRegions && candidates.size) {
    let best = -1, worth = Number.NEGATIVE_INFINITY;
    for (const region of candidates) {
      const value = goalWorth(state, region, by, claims.get(region) ?? 0, ownValue, taken, ownerOf);
      if (value > worth || (value === worth && region < best)) { best = region; worth = value; }
    }
    gain += frontierGain(state, best, by, taken, ownerOf);
    goal.push(best); taken.add(best); candidates.delete(best); consider(best);
  }
  return { goal, gain };
}

/** How the ground helps those who hold these regions against `attacker` (1 and more): their defensibility, the walls
 *  standing there, and how hard the way in is from the attacker's land (`crossingOf`: rivers and mountains on the
 *  border). The front's defence in a war, and what a people weighing war believes of it (`sees`: the walls it can see). */
export function defenseOf(state: SimulationState, regions: readonly number[], attacker: number, sees: (region: number) => boolean = () => true) {
  if (!regions.length) return 1;
  let ground = 0, walls = 0, crossing = 0;
  for (const region of regions) {
    ground += state.partition.regions[region].defensibility;
    crossing += crossingOf(state, region, attacker);
    let best = 0;
    if (sees(region)) for (const settlement of livingSettlements(state, region)) for (const building of settlement.buildings) best = Math.max(best, (BUILDINGS[building.type].effects.defense ?? 0) * building.condition);
    walls += best;
  }
  return (1 + WAR_TUNING.ground * ground / regions.length + WAR_TUNING.walls * walls / regions.length) * (1 + WAR_TUNING.barrier * crossing / regions.length);
}

/** The mean land value of a people's regions (what it judges other land against). */
export function ownLandValue(state: SimulationState, polity: { groups: number[] }) {
  let sum = 0;
  for (const id of polity.groups) sum += state.landValue[state.groups[id].region];
  return polity.groups.length ? sum / polity.groups.length : 0;
}

/** How far a people's soldiers reach a front as another people judges it: 1 ÷ (1 + the straight-line km from their
 *  capital's region to the nearest of these regions × WAR_TUNING.winding ÷ supplyKm); 1 without a capital. */
export function supplyFrom(state: SimulationState, capital: number, regions: readonly number[]) {
  if (capital < 0 || !regions.length) return 1;
  const regionsOf = state.partition.regions;
  let nearest = Number.POSITIVE_INFINITY;
  for (const region of regions) nearest = Math.min(nearest, greatCircleKm(state.geography, regionsOf[capital].centroid, regionsOf[region].centroid));
  return 1 / (1 + nearest * WAR_TUNING.winding / WAR_TUNING.supplyKm);
}

/** How its own wars on `enemy` have come to nothing (VISION.md: wars are weighed against what they cost): each war it
 *  began on them that ended in a white peace or lost, fading by half every WAR_TUNING.futilityHalfLife years. */
export function futilityOf(state: SimulationState, attacker: number, enemy: number) {
  let futility = 0;
  for (const war of state.wars) {
    if (war.attacker !== attacker || war.defender !== enemy || war.endTick === null || war.outcome === 'gone' || (war.outcome !== 'white' && war.score >= 0)) continue;
    futility += 0.5 ** ((state.tick - war.endTick) / 12 / WAR_TUNING.futilityHalfLife);
  }
  return futility;
}

/** A people's war income now (M6.3): the loot and tribute it has received, fading by half every RAVAGE_TUNING.incomeYears. */
export const warIncomeOf = (polity: { warIncome: { value: number; tick: number } }, now: number) => polity.warIncome.value * 0.5 ** ((now - polity.warIncome.tick) / 12 / RAVAGE_TUNING.incomeYears);
