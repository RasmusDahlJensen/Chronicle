import type { ChronicleEvent } from '../../shared/simulation.ts';
import { BAND_TUNING } from './tunables.ts';

/** Names joined for an event's data ("Ora, the Vel and the Kin": its template puts "the" before them), at most 120 characters. */
export const namesList = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', the ')} and the ${names.at(-1)}`).slice(0, 120);

/** The factors behind a decision, strongest first; weak ones are dropped, but the strongest is always kept. */
export function causes(factors: Record<string, number>): ChronicleEvent['causes'] {
  const ranked = Object.entries(factors).filter(([, weight]) => weight > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  const kept = ranked.filter(([, weight], at) => at === 0 || weight >= BAND_TUNING.minCause);
  return kept.slice(0, 4).map(([factor, weight]) => ({ factor, weight: Math.max(0.001, Math.round(weight * 1000) / 1000) }));
}
