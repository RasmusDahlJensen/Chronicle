import type { ChronicleEvent } from '../../shared/simulation.ts';
import { cultureSimilarity } from './culture.ts';
import { newTechs } from './knowledge.ts';
import { willingness } from './perception.ts';
import type { Rng } from './rng.ts';
import type { Polity, SimulationState } from './state.ts';
import { SHARE_TUNING } from './tunables.ts';

/**
 * Sharing knowledge (VISION.md "Sharing knowledge", added after the M3 review): a civilization offers a people in
 * contact an exchange. They accept with a chance set by their Tradition, how alike the two cultures are and what they
 * would learn; a refusal is remembered. An accepted exchange runs both ways for `SHARE_TUNING.years`: each side
 * researches what the other knows faster (the knowledge system). Returns what happened, for the decision log.
 */
export function share(state: SimulationState, tick: number, rng: Rng, civ: Polity, other: Polity, cited: ChronicleEvent['causes']): string {
  if (other.deathTick !== null) return 'the other people is gone';
  if ((civ.exchanges.get(other.id) ?? 0) > tick) return `already sharing with the ${other.name}`;
  const theirs = state.cultures[other.culture].values;
  const willing = willingness(theirs.tradition, cultureSimilarity(state.cultures[civ.culture].values, theirs), newTechs(other.knowledge, civ.knowledge));
  state.metrics.exchangeOffers++;
  if (!rng.chance(willing)) { civ.exchangeRefused.set(other.id, tick); return `the ${other.name} would not share`; }
  const until = tick + SHARE_TUNING.years * 12;
  civ.exchanges.set(other.id, until); other.exchanges.set(civ.id, until);
  civ.exchangeRefused.delete(other.id);
  state.metrics.exchanges++;
  if (other.kind === 'band') state.metrics.tribeExchanges++;
  const region = civ.capital !== null ? state.settlements[civ.capital].region : state.groups[civ.core].region;
  state.chronicle.emit({
    type: 'knowledgeShared', actors: [{ id: civ.id, role: 'civ' }, { id: other.id, role: 'partner' }], region, causes: cited, importance: 0.08,
    data: { name: civ.name, other: other.name, years: SHARE_TUNING.years, kin: civ.lineage === other.lineage, tribe: other.kind === 'band' },
  });
  return `shares knowledge with the ${other.name}`;
}
