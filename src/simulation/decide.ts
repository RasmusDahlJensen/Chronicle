import { causes } from './bands.ts';
import { choose, drivers, MULTIPLIER, reasonsFor } from './decisions/choose.ts';
import { expand, explore, unite } from './expansion.ts';
import { decisionView } from './perception.ts';
import { truthOf } from './relations.ts';
import { share } from './sharing.ts';
import { beginWonder, startProjects, startRoads } from './construction.ts';
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
    // The beliefs each option weighed, beside the truth before anything is done (for the study and the lab; the choice
    // never saw it).
    const beliefs = options.map(option => option.beliefs?.map(belief => ({ ...belief, truth: Math.round(truthOf(state, state.polities[belief.polity], belief.kind)) })));
    let outcome = 'did nothing';
    if (chosen.action === 'expand') {
      const candidate = view.candidates.find(entry => entry.region === chosen.target)!;
      outcome = expand(state, context, context.stream(id, EXPANDING), polity, candidate.region, candidate.from, cited);
    } else if (chosen.action === 'explore') outcome = explore(state, context.tick, context.stream(id, EXPLORING), polity, cited);
    else if (chosen.action === 'unite') {
      const neighbour = view.neighbours.find(entry => entry.civ === chosen.target)!;
      outcome = unite(state, context.tick, context.stream(id, UNITING), polity, state.polities[neighbour.civ], neighbour.border, cited);
    } else if (chosen.action === 'share') outcome = share(state, context.tick, context.stream(id, SHARING), polity, state.polities[chosen.target!], cited);
    else if (chosen.action === 'build' && chosen.road) outcome = startRoads(state, context.tick, polity, chosen.targets ?? [], cited);
    else if (chosen.action === 'build' && chosen.wonder) outcome = beginWonder(state, context.tick, polity, chosen.target!, chosen.targets![0], cited);
    else if (chosen.action === 'build') outcome = startProjects(state, context.tick, polity, chosen.target!, chosen.targets ?? [], cited);
    state.metrics.chosen[chosen.action]++;
    if (chosen.action === 'expand' && (chosen.factors.find(entry => entry.factor === 'resource')?.weight ?? 0) > 0) state.metrics.resourceExpansions++;
    const weighed = beliefs[options.indexOf(chosen)];
    if (weighed?.length) {
      state.metrics.beliefDecisions++;
      if (weighed.some(belief => Math.abs(belief.estimate / Math.max(1, belief.truth) - 1) > 0.5)) state.metrics.beliefsFarOff++;
    }
    // The causes it logs: at least two whenever two or more of the chosen option's factors are nonzero (VISION.md M5).
    const reasons = reasonsFor(chosen);
    if (chosen.factors.filter(entry => entry.weight !== 0 && !entry.factor.startsWith(MULTIPLIER)).length >= 2 && reasons.length < 2) state.metrics.causesShort++;
    state.metrics.decisionSteps++;
    polity.decisions.push({
      tick: context.tick, chosen: chosen.action, pick: options.indexOf(chosen), outcome, values: view.values, needs: view.needs, causes: reasons,
      // Land beyond all reach scores −∞; the log keeps a finite floor.
      options: options.map((option, at) => ({
        action: option.action, score: Math.max(-1, Math.round(option.score * 1000) / 1000), target: option.target, label: option.label, factors: option.factors,
        ...(beliefs[at] ? { beliefs: beliefs[at] } : {}),
      })),
    });
    if (polity.decisions.length > DECISION_TUNING.logSize) polity.decisions.shift();
  }
}
