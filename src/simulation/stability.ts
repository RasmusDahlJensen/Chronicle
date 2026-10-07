import { ageFactor, arrearsBurden, costShares, deferMaintenance, fullCostsOf, realmYears, refreshRemoteness, sizeFactor, taxBurden, totalCosts } from './budget.ts';
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
 *  the strain of a large, old realm on its far provinces, its realm's taxes (below the customary rate they raise it)
 *  and its realm's arrears. */
export function stabilityOf(state: SimulationState, civ: Polity, group: PopulationGroup, kmFromCapital: number) {
  const tuning = STABILITY_TUNING;
  const hunger = tuning.hunger * Math.max(0, 1 - Math.min(1, group.foodSecurity));
  const reach = REACH_TUNING.baseKm * civ.knowledge.multipliers.reach;
  const overextension = Math.min(tuning.overextensionCap, tuning.overextension * (Number.isFinite(kmFromCapital) ? Math.max(0, kmFromCapital / reach - 1) : Number.POSITIVE_INFINITY));
  const foreignRule = group.culture === civ.culture ? 0 : tuning.foreignRule * (1 - cultureSimilarity(state.cultures[group.culture].values, state.cultures[civ.culture].values));
  const remoteness = Number.isFinite(kmFromCapital) ? kmFromCapital / reach : Number.POSITIVE_INFINITY;
  const taxes = taxBurden(civ.taxRate), arrears = arrearsBurden(civ, remoteness);
  // A large, old realm holds its far provinces less firmly (VISION.md M3c: empire strain).
  const strain = tuning.strain * (sizeFactor(civ.groups.length) * ageFactor(realmYears(state, civ)) - 1) * (tuning.strainCore + (1 - tuning.strainCore) * Math.min(1, remoteness));
  // Shrines and temples steady their region, and some wonders the whole realm (VISION.md "Buildings", "Wonders").
  const buildings = buildingStability(state, group.region) + wonderBonus(state, civ).stability;
  // How calm the region is apart from its realm's budget: what its taxes can rest on.
  const calm = Math.max(0, Math.min(1, tuning.base - hunger - overextension - foreignRule - strain + buildings));
  return { value: Math.max(0, Math.min(1, tuning.base - hunger - overextension - foreignRule - strain - taxes - arrears + buildings)), calm, hunger, overextension, foreignRule, strain, taxes, arrears, buildings };
}

/**
 * Stability system: once a year per civilization (staggered by id), its yearly assessment: how far each of its
 * regions lies from its capital, how calm each is apart from the realm's budget, the taxes it sets for the year on
 * that calm (VISION.md "Wealth"; heavy taxes and their easing are events), and each region's stability under them,
 * with unrest beginning and ending.
 */
export function stabilize(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ' || ((context.tick - id) % 12 + 12) % 12 !== 0) continue;
    const km = capitalTravel(state, civ);
    refreshRemoteness(state, civ, km);
    for (const groupId of civ.groups) { const group = state.groups[groupId]; state.calm[group.region] = stabilityOf(state, civ, group, km(group.region)).calm; }
    setTaxes(state, civ);
    judge(state, civ, km);
  }
}

/** A civilization's regions judged at once when its land changes (a union): measured from its capital again, and
 *  their stability. Taxes are set only at the yearly assessment. */
export function assess(state: SimulationState, civ: Polity) {
  const km = capitalTravel(state, civ);
  refreshRemoteness(state, civ, km);
  judge(state, civ, km);
}

/** The stability of each of a civilization's regions now, with unrest beginning (an event) or ending. */
function judge(state: SimulationState, civ: Polity, km: (region: number) => number) {
  const tuning = STABILITY_TUNING;
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    const result = stabilityOf(state, civ, group, km(region));
    state.stability[region] = result.value; state.calm[region] = result.calm;
    if (!state.unrest[region] && result.value < tuning.unrestBelow) {
      state.unrest[region] = 1; state.metrics.unrestOutbreaks++;
      state.chronicle.emit({
        type: 'unrest', actors: [{ id: civ.id, role: 'civ' }], region,
        causes: causes({ hunger: result.hunger, overextension: result.overextension, foreignRule: result.foreignRule, strain: result.strain, taxes: result.taxes, arrears: result.arrears }), importance: 0.1,
        data: { civ: civ.name, stability: Math.round(result.value * 100) / 100 },
      });
    } else if (state.unrest[region] && result.value >= tuning.unrestBelow + tuning.hysteresis) state.unrest[region] = 0;
  }
}

/** The taxes a civilization sets for the year (`decisions/budget.ts`), from its budget as it knows it (all it holds kept
 *  up), and what it lets go unkept if even they fall short (`deferMaintenance`). */
function setTaxes(state: SimulationState, civ: Polity) {
  const tuning = BUDGET_TUNING, costs = fullCostsOf(state, civ), view = budgetView(state, civ, costs);
  const rate = taxRate(view);
  civ.taxRate = rate;
  deferMaintenance(state, civ, rate * view.output + view.sites, (tuning.reserveYears + tuning.reserveTradition * view.tradition) * totalCosts(costs), view.strain);
  if (!civ.heavyTaxes && rate > tuning.heavyRate) {
    civ.heavyTaxes = true; state.metrics.taxesRaised++;
    state.chronicle.emit({ type: 'taxes', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.06, causes: costShares(costs), data: { civ: civ.name, raised: true, rate: Math.round(rate * 100) } });
  } else if (civ.heavyTaxes && rate <= tuning.customaryRate) {
    civ.heavyTaxes = false; state.metrics.taxesEased++;
    state.chronicle.emit({ type: 'taxes', actors: [{ id: civ.id, role: 'civ' }], region: null, importance: 0.04, causes: [], data: { civ: civ.name, eased: true, rate: Math.round(rate * 100) } });
  }
}
