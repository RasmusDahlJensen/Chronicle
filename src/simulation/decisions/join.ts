import type { JoinOption, JoinView } from '../perception.ts';
import type { Rng } from '../rng.ts';
import { DECISION_TUNING, JOIN_TUNING } from '../tunables.ts';
import type { Factor } from './choose.ts';

/**
 * Joining (VISION.md "Joining"): a farming tribe about to settle weighs joining each civilization next to it against
 * founding its own. Pure, like every choice: it sees only the tribe's view.
 */
export interface JoinChoice { civ: number | null; score: number; factors: Factor[] }

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The pull of one civilization, and its parts (kinship, likeness, size, food, order, against crossing and pride). */
export function joinScore(view: JoinView, option: JoinOption): JoinChoice {
  const tuning = JOIN_TUNING;
  const prestige = Math.min(1, Math.log10(1 + option.seenPeople / Math.max(1, view.people)) / tuning.prestigeScale);
  const parts = {
    kinship: option.kin ? tuning.kin : 0, similarity: tuning.similarity * option.similarity, prestige: tuning.prestige * prestige,
    fed: tuning.fed * option.fed, stability: tuning.stability * option.stability, crossing: -tuning.crossing * option.crossingKm / 1000,
    tradition: -tuning.tradition * view.values.tradition, expansionism: -tuning.expansionism * view.values.expansionism,
  };
  const score = Object.values(parts).reduce((sum, value) => sum + value, 0);
  return { civ: option.civ, score, factors: Object.entries(parts).map(([factor, weight]) => ({ factor, weight: round(weight) })) };
}

/** Every option, best first: founding its own (always one) and joining each civilization in view. */
export function joinOptions(view: JoinView): JoinChoice[] {
  const all: JoinChoice[] = [{
    civ: null, score: JOIN_TUNING.foundScore,
    factors: [{ factor: 'independence', weight: JOIN_TUNING.foundScore }, { factor: 'tradition', weight: round(JOIN_TUNING.tradition * view.values.tradition) }, { factor: 'expansionism', weight: round(JOIN_TUNING.expansionism * view.values.expansionism) }],
  }];
  for (const option of view.options) all.push(joinScore(view, option));
  return all.sort((a, b) => b.score - a.score || (a.civ ?? -1) - (b.civ ?? -1));
}

/** Weighted random among the best few above the minimum, as at every decision step. */
export function chooseJoin(view: JoinView, rng: Rng): { chosen: JoinChoice; options: JoinChoice[] } {
  const options = joinOptions(view);
  const eligible = options.filter(option => option.score >= DECISION_TUNING.minScore).slice(0, DECISION_TUNING.topChoices);
  return { chosen: eligible[Math.max(0, rng.weighted(eligible.map(option => option.score)))], options };
}
