import { xoroshiro128plus, xoroshiro128plusFromState } from 'pure-rand/generator/xoroshiro128plus';
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { seedNumber } from '../world/generation/noise.ts';
import type { CountryAI, CountryAlternative, CountryDecision } from '../../shared/country-ai.ts';

export interface CountryCandidate extends CountryAlternative { reservedFood: number; reservedPeople: number }
export function initialCountryAI(historySeed: string): CountryAI {
  const rng = xoroshiro128plus(seedNumber(`country-ai-1:${historySeed}`));
  return { version: 1, historySeed, profile: { reserveDays: uniformInt(rng,30,90), expansion: uniformInt(rng,0,100),
    mobility: uniformInt(rng,0,100), commitmentDays: uniformInt(rng,30,90) }, rngState: [...rng.getState()], decisions: [], history: [] };
}
function remember(ai: CountryAI, decision: CountryDecision, day: number, reason = decision.reason) {
  ai.history.push({ day, settlementId: decision.settlementId, goal: decision.goal, reason });
  if (ai.history.length>64) ai.history.shift();
}
/** Scores describe local opportunities; RNG breaks close alternatives only at dated reviews. */
export function chooseCountryIntent(ai: CountryAI, settlementId: string, day: number, candidates: CountryCandidate[], crisis: boolean, crisisGoals: readonly CountryAlternative['goal'][] = ['relocate','consolidate']): CountryDecision {
  const previous = ai.decisions.find(d=>d.settlementId===settlementId);
  const matching = candidates.find(c=>c.eligible && c.goal===previous?.goal && c.targetCellId===previous.targetCellId);
  // Recheck legality/affordability daily, but do not reroll a viable commitment each day.
  if (previous && matching && day<previous.reviewDay && crisis===previous.foodPressure && (!crisis || crisisGoals.includes(previous.goal))) {
    previous.reservedFood=matching.reservedFood; previous.reservedPeople=matching.reservedPeople;
    return previous;
  }
  const eligible=candidates.filter(c=>c.eligible && (!crisis || crisisGoals.includes(c.goal)));
  if (!eligible.length) throw new Error('Country AI has no legal consolidation option.');
  const best=Math.max(...eligible.map(c=>c.score));
  const close=eligible.filter(c=>c.score>=best-12).sort((a,b)=>(a.goal<b.goal ? -1 : a.goal>b.goal ? 1 : 0) || (a.targetCellId??-1)-(b.targetCellId??-1));
  const rng=xoroshiro128plusFromState(ai.rngState);
  let pick=uniformInt(rng,1,close.reduce((n,c)=>n+13-(best-c.score),0));
  const selected=close.find(c=>(pick-=13-(best-c.score))<=0)!;
  ai.rngState=[...rng.getState()];
  const same=previous?.goal===selected.goal && previous.targetCellId===selected.targetCellId;
  const reason=crisis ? `Food pressure triggered reassessment. ${selected.reason}` : selected.reason;
  const decision: CountryDecision={ settlementId, goal:selected.goal, targetCellId:selected.targetCellId,
    sinceDay:same ? previous.sinceDay : day, reviewDay:day+ai.profile.commitmentDays, foodPressure:crisis,
    reservedFood:selected.reservedFood, reservedPeople:selected.reservedPeople, reason,
    alternatives:candidates.map(({reservedFood: _food,reservedPeople: _people,...alternative})=>alternative) };
  if(previous) ai.decisions[ai.decisions.indexOf(previous)]=decision; else ai.decisions.push(decision);
  remember(ai,decision,day,previous && !same ? `Reconsidered ${previous.goal}. ${reason}` : reason);
  return decision;
}
export function completeCountryIntent(ai: CountryAI, settlementId: string, day: number, reason: string): void {
  const decision=ai.decisions.find(d=>d.settlementId===settlementId);
  if(!decision) return;
  remember(ai,decision,day,reason);
  ai.decisions=ai.decisions.filter(d=>d!==decision);
}
