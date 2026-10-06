import type { Candidate, Neighbour, Partner, PolityView } from '../perception.ts';
import type { Rng } from '../rng.ts';
import { DECISION_TUNING, EXPAND_TUNING, EXPLORE_TUNING, SHARE_TUNING, UNITE_TUNING } from '../tunables.ts';
import { bestBuild } from './build.ts';

/** Factors named with a leading × are multipliers (logged, never cited as causes); the rest are contributions to the score. */
export const MULTIPLIER = '×';

/**
 * The decision step (VISION.md "Personality and the decision model"), M3's form: Expand, Explore, Unite, Share
 * knowledge, Build or Do nothing, weighed from the needs land pressure, hunger and opportunity, what it could learn, and the
 * civilization's values. Pure: it sees only the
 * view `perception.ts` builds from the civilization's own state and what it knows (VISION.md "Implementation rule";
 * a Biome rule keeps this folder from importing anything else).
 */
export type { Action, Factor, Option } from './options.ts';
import type { Action, Factor, Option } from './options.ts';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** One candidate's expansion score and its parts (VISION.md "Expansion": no threshold). */
export function expansionScore(view: PolityView, candidate: Candidate): Option {
  const tuning = EXPAND_TUNING;
  const relative = view.ownValue > 0 ? candidate.value / view.ownValue : 1;
  const opportunity = clamp01(relative - 1);
  // The crowding of the region the settlers would leave drives it (VISION.md: settled from the source region).
  const drive = clamp01(candidate.pressure + tuning.hungerWeight * view.hunger + tuning.opportunityWeight * opportunity);
  const value = Math.min(1, relative) ** tuning.valuePower * (candidate.tribe ? tuning.occupiedValue : 1);
  const culture = (tuning.expansionismBase + view.values.expansionism) / (tuning.expansionismBase + 1);
  const distance = tuning.distancePerKm * candidate.crossingKm;
  const reach = tuning.reachWeight * (candidate.capitalKm / view.reachKm) ** tuning.reachPower;
  // Settlers need people to spare where they would come from; a tribe living there may instead be taken in.
  const feasible = candidate.tribe || candidate.fromPeople >= 2 * tuning.minSettlers;
  const score = drive * value * culture - distance - reach;
  // Each need's share of the score (what the event cites), the multipliers, and the costs.
  const scale = value * culture;
  return {
    action: 'expand', score: feasible && Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY, target: candidate.region, label: null,
    factors: [
      { factor: 'landPressure', weight: round(candidate.pressure * scale) }, { factor: 'hunger', weight: round(tuning.hungerWeight * view.hunger * scale) },
      { factor: 'opportunity', weight: round(tuning.opportunityWeight * opportunity * scale) },
      { factor: `${MULTIPLIER}landValue`, weight: round(value) }, { factor: `${MULTIPLIER}expansionism`, weight: round(culture) },
      { factor: 'distance', weight: -round(distance) }, { factor: 'governanceReach', weight: Number.isFinite(reach) ? -round(reach) : -1 },
    ],
  };
}

/** The best land to expand into, or none. Ties go to the lower region id (candidates arrive in id order). */
export function bestExpansion(view: PolityView): Option | null {
  let best: Option | null = null;
  for (const candidate of view.candidates) {
    const option = expansionScore(view, candidate);
    if (!best || option.score > best.score) best = option;
  }
  return best;
}

export function explorationScore(view: PolityView): Option {
  const tuning = EXPLORE_TUNING;
  const curiosity = clamp01(view.unknownFrontier / tuning.frontierScale);
  const culture = tuning.opennessWeight * view.values.openness + tuning.expansionismWeight * view.values.expansionism;
  const fresh = view.seaTick >= 0 && view.tick - view.seaTick < tuning.freshYears * 12 ? tuning.freshMobility : 0;
  const push = tuning.base + view.landPressure, score = curiosity * culture * push + (curiosity > 0 ? fresh : 0);
  return {
    action: 'explore', score, target: null, label: null,
    factors: [
      { factor: 'openness', weight: round(curiosity * tuning.opennessWeight * view.values.openness * push) },
      { factor: 'expansionism', weight: round(curiosity * tuning.expansionismWeight * view.values.expansionism * push) },
      { factor: 'landPressure', weight: round(curiosity * culture * view.landPressure) }, { factor: 'newSeaReach', weight: round(curiosity > 0 ? fresh : 0) },
      { factor: `${MULTIPLIER}unknownLand`, weight: round(curiosity) },
    ],
  };
}

/**
 * Uniting with one neighbour (VISION.md "Unification"): kinship, a much larger, well-fed and stable neighbour and its
 * own troubles draw it in; its pride (Tradition, Expansionism), its own contentment and a hard crossing hold it back.
 * Only a larger civilization, as far as it knows, can be joined.
 */
export function unionScore(view: PolityView, neighbour: Neighbour): Option {
  const tuning = UNITE_TUNING;
  const larger = neighbour.knownRegions > view.regions;
  const size = larger ? Math.min(1, Math.log10(neighbour.knownRegions / Math.max(1, view.regions)) / tuning.sizeScale) : 0;
  const parts = {
    kinship: neighbour.kin ? tuning.kin : 0, similarity: tuning.similarity * neighbour.similarity, size: tuning.size * size,
    fed: tuning.fed * neighbour.fed, stability: tuning.stability * neighbour.stability, trouble: tuning.trouble * Math.min(1, view.hunger + view.unrestShare),
    tradition: -tuning.tradition * view.values.tradition, expansionism: -tuning.expansionism * view.values.expansionism,
    contentment: -tuning.contentment * view.stability, crossing: -tuning.crossing * neighbour.crossingKm / 1000,
  };
  const score = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return {
    action: 'unite', score: larger ? score : Number.NEGATIVE_INFINITY, target: neighbour.civ, label: neighbour.name,
    factors: Object.entries(parts).map(([factor, weight]) => ({ factor, weight: round(weight) })),
  };
}

export function bestUnion(view: PolityView): Option | null {
  let best: Option | null = null;
  for (const neighbour of view.neighbours) {
    const option = unionScore(view, neighbour);
    if (!best || option.score > best.score) best = option;
  }
  return best;
}

/**
 * Sharing knowledge with one people in contact (VISION.md "Sharing knowledge"): what it would learn draws it most;
 * kinship, likeness and its Openness make it glad to teach what it knows; its Tradition and the exchanges it already
 * keeps up hold it back. All of it is scaled by how likely they are to accept. Nothing to teach or learn: no exchange.
 */
export function shareScore(view: PolityView, partner: Partner): Option {
  const tuning = SHARE_TUNING;
  const learn = Math.min(1, partner.learn / tuning.techScale), teach = Math.min(1, partner.teach / tuning.techScale);
  const parts = {
    learning: tuning.learn * learn, kinship: partner.kin ? tuning.kin * teach : 0, similarity: tuning.similarity * partner.similarity * teach,
    openness: tuning.openness * view.values.openness * teach, tradition: -tuning.tradition * view.values.tradition,
    busy: -tuning.busy * view.exchanges,
  };
  const score = Object.values(parts).reduce((sum, value) => sum + value, 0) * partner.willing;
  return {
    action: 'share', score: partner.teach + partner.learn > 0 ? score : Number.NEGATIVE_INFINITY, target: partner.polity, label: partner.name,
    factors: [...Object.entries(parts).map(([factor, weight]) => ({ factor, weight: round(weight * partner.willing) })), { factor: `${MULTIPLIER}willing`, weight: round(partner.willing) }],
  };
}

export function bestShare(view: PolityView): Option | null {
  let best: Option | null = null;
  for (const partner of view.partners) {
    const option = shareScore(view, partner);
    if (!best || option.score > best.score) best = option;
  }
  return best;
}

/** Every option of this step, best first (Do nothing is always one). */
export function options(view: PolityView): Option[] {
  const all: Option[] = [{ action: 'nothing', score: DECISION_TUNING.doNothing, target: null, label: null, factors: [{ factor: 'contentment', weight: DECISION_TUNING.doNothing }] }];
  const expand = bestExpansion(view);
  if (expand) all.push(expand);
  all.push(explorationScore(view));
  const unite = bestUnion(view);
  if (unite) all.push(unite);
  const share = bestShare(view);
  if (share) all.push(share);
  const build = bestBuild(view);
  if (build) all.push(build);
  const order: Action[] = ['expand', 'explore', 'unite', 'share', 'build', 'nothing'];
  return all.sort((a, b) => b.score - a.score || order.indexOf(a.action) - order.indexOf(b.action));
}

/** Weighted random among the best few above the minimum (VISION.md step 3), using the polity's stream. */
export function choose(view: PolityView, rng: Rng): { chosen: Option; options: Option[] } {
  const all = options(view);
  const eligible = all.filter(option => option.score >= DECISION_TUNING.minScore).slice(0, DECISION_TUNING.topChoices);
  const pick = rng.weighted(eligible.map(option => option.score));
  return { chosen: eligible[Math.max(0, pick)], options: all };
}

/** The strongest positive contributions to an option, for the causes of the event it leads to (multipliers excluded). */
export function drivers(option: Option): Factor[] {
  return option.factors.filter(entry => entry.weight > 0 && !entry.factor.startsWith(MULTIPLIER)).sort((a, b) => b.weight - a.weight || (a.factor < b.factor ? -1 : 1)).slice(0, DECISION_TUNING.factorCount);
}
