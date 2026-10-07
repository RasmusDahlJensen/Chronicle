import { collectStats, stateHash, stepSimulation } from '../src/simulation/simulation.ts';
import type { CenturyStats, SimulationState } from '../src/simulation/state.ts';
import * as TUNABLES from '../src/simulation/tunables.ts';

/**
 * The core of fork-and-compare (development tooling, Dev 02): tunable overrides and a run from a restored state.
 * Overrides name exported tunables objects of `src/simulation/tunables.ts` and the fields to change, deep-merged:
 * `{ "FAITH_TUNING": { "foundingRate": 0.1 }, "CULTURE_PULLS": { "zeal": { "base": 0.5 } } }`. Every field must exist
 * and keep its type, and the result must pass `validateTunables`. What the world derives from tunables once (food
 * model, field ranking, land value…) is rebuilt on restore with the overrides; values a history has stored from them
 * (cultivated fields, housing, road upkeep…) are not, so a variant whose history no longer holds fails its invariants.
 */
export type Overrides = Record<string, Record<string, unknown>>;

/** Not tunables a fork can change: a history's food stores are counted in this unit (and modules read it once, at
 *  load); the region partition is built before any overrides, and a history's regions are its regions. */
const FIXED = new Map([['FOOD_TUNING.unitsPerPersonMonth', 'is a unit'], ['REGION_TUNING', 'shapes the regions']]);

/** Apply overrides to this process's tunables (validated); returns how to undo them. */
export function applyOverrides(overrides: Overrides): () => void {
  const undo: (() => void)[] = [];
  const restore = () => { for (const step of undo.splice(0).reverse()) step(); };
  const merge = (target: Record<string, unknown>, patch: Record<string, unknown>, path: string) => {
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(target, key)) throw new Error(`${path}.${key} is not a tunable.`);
      const fixed = FIXED.get(`${path}.${key}`);
      if (fixed) throw new Error(`${path}.${key} ${fixed}, not a tunable a fork can change.`);
      const current = target[key];
      const nested = (entry: unknown) => entry !== null && typeof entry === 'object' && !Array.isArray(entry);
      if (nested(value) && nested(current)) { merge(current as Record<string, unknown>, value as Record<string, unknown>, `${path}.${key}`); continue; }
      if (typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) throw new Error(`${path}.${key} must stay a ${Array.isArray(current) ? 'list' : typeof current}.`);
      undo.push(() => { target[key] = current; });
      target[key] = value;
    }
  };
  try {
    for (const [name, patch] of Object.entries(overrides)) {
      const target = Object.hasOwn(TUNABLES, name) ? (TUNABLES as Record<string, unknown>)[name] : undefined;
      if (target === null || typeof target !== 'object' || Array.isArray(target)) throw new Error(`${name} is not a tunables object of src/simulation/tunables.ts.`);
      if (FIXED.has(name)) throw new Error(`${name} ${FIXED.get(name)}, not tunables a fork can change.`);
      merge(target as Record<string, unknown>, patch, name);
    }
    TUNABLES.validateTunables();
  } catch (error) { restore(); throw error; }
  return restore;
}

/** What a run from a state produced: the statistics at its end and every hundred years on the way, the events of each
 *  kind it added, its hashes and its speed. */
export interface RunResult { from: number; to: number; last: CenturyStats; rows: CenturyStats[]; events: Record<string, number>; stateHash: string; eventLogHash: string; msPerYear: number }

/** Run a restored history on for `years`, with the invariants checked every month as in the lab. */
export function runFrom(state: SimulationState, years: number): RunResult {
  const from = state.tick / 12, firstEvent = state.chronicle.events.length, started = performance.now();
  while (state.tick < (from + years) * 12) stepSimulation(state);
  const events: Record<string, number> = {};
  for (let at = firstEvent; at < state.chronicle.events.length; at++) { const type = state.chronicle.events[at].type; events[type] = (events[type] ?? 0) + 1; }
  return {
    from, to: state.tick / 12, last: collectStats(state, state.tick / 12), rows: state.stats.filter(row => row.year > from), events,
    stateHash: stateHash(state), eventLogHash: state.chronicle.hash, msPerYear: years > 0 ? (performance.now() - started) / years : 0,
  };
}
