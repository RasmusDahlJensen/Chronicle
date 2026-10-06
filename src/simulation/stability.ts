import { arrearsBurden, costShares, costsOf, refreshRemoteness, taxBurden } from './budget.ts';
import { causes } from './causes.ts';
import { taxRate } from './decisions/budget.ts';
import { buildingStability, wonderBonus } from './economy.ts';
import { cultureSimilarity } from './culture.ts';
import { budgetView, capitalTravel } from './perception.ts';
import type { Polity, PopulationGroup, SimulationState, TickContext } from './state.ts';
import { BUDGET_TUNING, REACH_TUNING, STABILITY_TUNING } from './tunables.ts';

/**
 * Regional stability (VISION.md "Stability, fracture and civil war", M3's basic form): hungry regions, regions far
 * beyond the capital's reach and regions where another people lives under the civilization's rule are less stable;
 * so are realms that tax heavily, and the far regions of realms in arrears (VISION.md "Wealth"). Unrest lowers their
 * output and research. Fracture (revolt, secession, civil war) arrives in M7.
 */

/** A region's stability and what lowers it, from its people's food, its distance from the capital, who lives there,
 *  its realm's taxes (below the customary rate they raise it) and its realm's arrears. */
export function stabilityOf(state: SimulationState, civ: Polity, group: PopulationGroup, kmFromCapital: number) {
  const tuning = STABILITY_TUNING;
  const hunger = tuning.hunger * Math.max(0, 1 - Math.min(1, group.foodSecurity));
  const reach = REACH_TUNING.baseKm * civ.knowledge.multipliers.reach;
  const overextension = Math.min(tuning.overextensionCap, tuning.overextension * (Number.isFinite(kmFromCapital) ? Math.max(0, kmFromCapital / reach - 1) : Number.POSITIVE_INFINITY));
  const foreignRule = group.culture === civ.culture ? 0 : tuning.foreignRule * (1 - cultureSimilarity(state.cultures[group.culture].values, state.cultures[civ.culture].values));
  const taxes = taxBurden(civ.taxRate), arrears = arrearsBurden(civ, Number.isFinite(kmFromCapital) ? kmFromCapital / reach : Number.POSITIVE_INFINITY);
  // Shrines and temples steady their region, and some wonders the whole realm (VISION.md "Buildings", "Wonders").
  const buildings = buildingStability(state, group.region) + wonderBonus(state, civ).stability;
  return { value: Math.max(0, Math.min(1, tuning.base - hunger - overextension - foreignRule - taxes - arrears + buildings)), hunger, overextension, foreignRule, taxes, arrears, buildings };
}

/** Stability system: once a year per civilization (staggered by id), its budget and each of its regions; unrest
 *  begins and ends. */
export function stabilize(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ' || ((context.tick - id) % 12 + 12) % 12 !== 0) continue;
    assess(state, civ);
  }
}

/**
 * A civilization's yearly assessment: how far each of its regions lies from its capital, the taxes it sets for the
 * year (VISION.md "Wealth"; heavy taxes and their easing are events), and the stability of each region now, with
 * unrest beginning (an event) or ending.
 */
export function assess(state: SimulationState, civ: Polity) {
  const tuning = STABILITY_TUNING, km = capitalTravel(state, civ);
  refreshRemoteness(state, civ, km);
  setTaxes(state, civ);
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    const result = stabilityOf(state, civ, group, km(region));
    state.stability[region] = result.value;
    if (!state.unrest[region] && result.value < tuning.unrestBelow) {
      state.unrest[region] = 1; state.metrics.unrestOutbreaks++;
      state.chronicle.emit({
        type: 'unrest', actors: [{ id: civ.id, role: 'civ' }], region,
        causes: causes({ hunger: result.hunger, overextension: result.overextension, foreignRule: result.foreignRule, taxes: result.taxes, arrears: result.arrears }), importance: 0.1,
        data: { civ: civ.name, stability: Math.round(result.value * 100) / 100 },
      });
    } else if (state.unrest[region] && result.value >= tuning.unrestBelow + tuning.hysteresis) state.unrest[region] = 0;
  }
}

/** The taxes a civilization sets for the year (`decisions/budget.ts`), from its budget as it knows it. */
function setTaxes(state: SimulationState, civ: Polity) {
  const tuning = BUDGET_TUNING, costs = costsOf(state, civ);
  const rate = taxRate(budgetView(state, civ, costs));
  civ.taxRate = rate;
  if (!civ.heavyTaxes && rate > tuning.heavyRate) {
    civ.heavyTaxes = true; state.metrics.taxesRaised++;
    state.chronicle.emit({ type: 'taxes', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.06, causes: costShares(costs), data: { civ: civ.name, raised: true, rate: Math.round(rate * 100) } });
  } else if (civ.heavyTaxes && rate <= tuning.customaryRate) {
    civ.heavyTaxes = false; state.metrics.taxesEased++;
    state.chronicle.emit({ type: 'taxes', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.04, causes: [], data: { civ: civ.name, eased: true, rate: Math.round(rate * 100) } });
  }
}
