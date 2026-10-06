import type { PolityView } from '../perception.ts';
import { BUDGET_TUNING } from '../tunables.ts';

/**
 * Taxes (VISION.md "Wealth"): once a year a realm sets the share of its people's output it takes, to cover its costs
 * and keep a reserve of some years of them, more for a traditional people. It raises them above the customary rate
 * only as far as its people are calm; a restless realm accepts arrears instead. Pure: it sees only the civilization's
 * budget view.
 */
export function taxRate(budget: PolityView['budget']) {
  const tuning = BUDGET_TUNING;
  // What it must raise from taxes this year: its costs, less what its mines and quarries pay, and a share of the gap
  // between its treasury and its reserve.
  const reserve = (tuning.reserveYears + tuning.reserveTradition * budget.tradition) * budget.costs;
  const wanted = budget.costs - budget.sites + (reserve - budget.treasury) / tuning.refillYears;
  const target = budget.output > 0 ? wanted / budget.output : tuning.customaryRate;
  const tolerance = Math.max(0, Math.min(1, (budget.calm - tuning.calmFloor) / (tuning.calmFull - tuning.calmFloor)));
  const bearable = tuning.customaryRate + (tuning.maxRate - tuning.customaryRate) * tolerance;
  const bounded = Math.max(tuning.minRate, Math.min(bearable, target));
  // Taxes change by a step a year at most; rates are kept to a millionth, so steps add up exactly.
  return Math.round(Math.max(budget.rate - tuning.rateStep, Math.min(budget.rate + tuning.rateStep, bounded)) * 1e6) / 1e6;
}
