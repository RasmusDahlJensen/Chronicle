import type { ChronicleEvent } from '../../shared/simulation.ts';
import { BAND_TUNING } from './tunables.ts';

/** The factors behind a decision, strongest first; weak ones are dropped, but the strongest is always kept. */
export function causes(factors: Record<string, number>): ChronicleEvent['causes'] {
  const ranked = Object.entries(factors).filter(([, weight]) => weight > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  const kept = ranked.filter(([, weight], at) => at === 0 || weight >= BAND_TUNING.minCause);
  return kept.slice(0, 4).map(([factor, weight]) => ({ factor, weight: Math.max(0.001, Math.round(weight * 1000) / 1000) }));
}
