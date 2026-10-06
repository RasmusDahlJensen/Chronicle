import { causes } from './bands.ts';
import { choose, drivers } from './decisions/choose.ts';
import { expand, explore, unite } from './expansion.ts';
import { decisionView } from './perception.ts';
import { share } from './sharing.ts';
import { startProjects } from './construction.ts';
import type { SimulationState, TickContext } from './state.ts';
import { DECISION_TUNING } from './tunables.ts';

// RNG salts within the decisions system: the choice (no salt), carrying out an expansion, an expedition's path, a
// union's admission, an exchange's acceptance.
const EXPANDING = 1, EXPLORING = 2, UNITING = 3, SHARING = 4;

/**
 * Decisions system (VISION.md "Decision step"): every DECISION_TUNING.months per civilization, staggered by id. The
 * choice reads only the civilization's view (`perception.ts`); carrying it out meets the true world. Every step is
 * logged with all options and their factors; the event an action causes carries its strongest factors as causes.
 * Tribes decide through their bands' moves and splits (population system) until later milestones give them actions.
 */
export function decide(state: SimulationState, context: TickContext) {
  const cadence = DECISION_TUNING.months;
  for (const id of state.living.slice()) {
    const polity = state.polities[id];
    if (polity.kind !== 'civ' || polity.deathTick !== null || ((context.tick - id) % cadence + cadence) % cadence !== 0) continue;
    const view = decisionView(state, polity);
    const { chosen, options } = choose(view, context.stream(id));
    const cited = causes(Object.fromEntries(drivers(chosen).map(entry => [entry.factor, entry.weight])));
    let outcome = 'did nothing';
    if (chosen.action === 'expand') {
      const candidate = view.candidates.find(entry => entry.region === chosen.target)!;
      outcome = expand(state, context, context.stream(id, EXPANDING), polity, candidate.region, candidate.from, cited);
    } else if (chosen.action === 'explore') outcome = explore(state, context.tick, context.stream(id, EXPLORING), polity, cited);
    else if (chosen.action === 'unite') {
      const neighbour = view.neighbours.find(entry => entry.civ === chosen.target)!;
      outcome = unite(state, context.tick, context.stream(id, UNITING), polity, state.polities[neighbour.civ], neighbour.border, cited);
    } else if (chosen.action === 'share') outcome = share(state, context.tick, context.stream(id, SHARING), polity, state.polities[chosen.target!], cited);
    else if (chosen.action === 'build') outcome = startProjects(state, context.tick, polity, chosen.target!, chosen.targets ?? [], cited);
    state.metrics.chosen[chosen.action]++;
    polity.decisions.push({
      tick: context.tick, chosen: chosen.action, outcome,
      // Land beyond all reach scores −∞; the log keeps a finite floor.
      options: options.map(option => ({ action: option.action, score: Math.max(-1, Math.round(option.score * 1000) / 1000), target: option.target, label: option.label, factors: option.factors })),
    });
    if (polity.decisions.length > DECISION_TUNING.logSize) polity.decisions.shift();
  }
}
