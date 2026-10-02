import type { Candidate, PolityView } from '../perception.ts';
import type { Rng } from '../rng.ts';
import { DECISION_TUNING, EXPAND_TUNING, EXPLORE_TUNING } from '../tunables.ts';

/**
 * The decision step (VISION.md "Personality and the decision model"), M3's form: Expand, Explore or Do nothing,
 * weighed from the needs land pressure, hunger and opportunity and the civilization's values. Pure: it sees only the
 * view `perception.ts` builds from the civilization's own state and what it knows (VISION.md "Implementation rule";
 * a Biome rule keeps this folder from importing anything else).
 */
export type Action = 'expand' | 'explore' | 'nothing';
export interface Factor { factor: string; weight: number }
export interface Option { action: Action; score: number; target: number | null; factors: Factor[] }

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
  const score = drive * value * culture - distance - reach;
  return {
    action: 'expand', score: Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY, target: candidate.region,
    factors: [
      { factor: 'landPressure', weight: round(candidate.pressure) }, { factor: 'hunger', weight: round(tuning.hungerWeight * view.hunger) },
      { factor: 'opportunity', weight: round(tuning.opportunityWeight * opportunity) }, { factor: 'landValue', weight: round(value) },
      { factor: 'expansionism', weight: round(culture) }, { factor: 'distance', weight: -round(distance) },
      { factor: 'governanceReach', weight: Number.isFinite(reach) ? -round(reach) : -1 },
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
  const score = curiosity * culture * (tuning.base + view.landPressure) + (curiosity > 0 ? fresh : 0);
  return {
    action: 'explore', score, target: null,
    factors: [
      { factor: 'unknownLand', weight: round(curiosity) }, { factor: 'openness', weight: round(tuning.opennessWeight * view.values.openness) },
      { factor: 'expansionism', weight: round(tuning.expansionismWeight * view.values.expansionism) },
      { factor: 'landPressure', weight: round(view.landPressure) }, { factor: 'newSeaReach', weight: round(curiosity > 0 ? fresh : 0) },
    ],
  };
}

/** Every option of this step, best first (Do nothing is always one). */
export function options(view: PolityView): Option[] {
  const all: Option[] = [{ action: 'nothing', score: DECISION_TUNING.doNothing, target: null, factors: [{ factor: 'contentment', weight: DECISION_TUNING.doNothing }] }];
  const expand = bestExpansion(view);
  if (expand) all.push(expand);
  all.push(explorationScore(view));
  const order: Action[] = ['expand', 'explore', 'nothing'];
  return all.sort((a, b) => b.score - a.score || order.indexOf(a.action) - order.indexOf(b.action));
}

/** Weighted random among the best few above the minimum (VISION.md step 3), using the polity's stream. */
export function choose(view: PolityView, rng: Rng): { chosen: Option; options: Option[] } {
  const all = options(view);
  const eligible = all.filter(option => option.score >= DECISION_TUNING.minScore).slice(0, DECISION_TUNING.topChoices);
  const pick = rng.weighted(eligible.map(option => option.score));
  return { chosen: eligible[Math.max(0, pick)], options: all };
}

/** The strongest positive factors of an option, for the causes of the event it leads to. */
export function drivers(option: Option): Factor[] {
  return option.factors.filter(entry => entry.weight > 0).sort((a, b) => b.weight - a.weight || (a.factor < b.factor ? -1 : 1)).slice(0, DECISION_TUNING.factorCount);
}
