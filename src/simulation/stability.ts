import { causes } from './causes.ts';
import { buildingStability } from './economy.ts';
import { cultureSimilarity } from './culture.ts';
import { capitalTravel } from './perception.ts';
import type { Polity, PopulationGroup, SimulationState, TickContext } from './state.ts';
import { REACH_TUNING, STABILITY_TUNING } from './tunables.ts';

/**
 * Regional stability (VISION.md "Stability, fracture and civil war", M3's basic form): hungry regions, regions far
 * beyond the capital's reach and regions where another people lives under the civilization's rule are less stable.
 * Unrest lowers their output and research. Fracture (revolt, secession, civil war) arrives in M7.
 */

/** A region's stability and what lowers it, from its people's food, its distance from the capital and who lives there. */
export function stabilityOf(state: SimulationState, civ: Polity, group: PopulationGroup, kmFromCapital: number) {
  const tuning = STABILITY_TUNING;
  const hunger = tuning.hunger * Math.max(0, 1 - Math.min(1, group.foodSecurity));
  const reach = REACH_TUNING.baseKm * civ.knowledge.multipliers.reach;
  const overextension = Math.min(tuning.overextensionCap, tuning.overextension * (Number.isFinite(kmFromCapital) ? Math.max(0, kmFromCapital / reach - 1) : Number.POSITIVE_INFINITY));
  const foreignRule = group.culture === civ.culture ? 0 : tuning.foreignRule * (1 - cultureSimilarity(state.cultures[group.culture].values, state.cultures[civ.culture].values));
  // Shrines and temples steady their region (VISION.md "Buildings").
  const buildings = buildingStability(state, group.region);
  return { value: Math.max(0, Math.min(1, tuning.base - hunger - overextension - foreignRule + buildings)), hunger, overextension, foreignRule, buildings };
}

/** Stability system: once a year per civilization (staggered by id), each of its regions; unrest begins and ends. */
export function stabilize(state: SimulationState, context: TickContext) {
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ' || ((context.tick - id) % 12 + 12) % 12 !== 0) continue;
    assess(state, civ);
  }
}

/** Stability of each of a civilization's regions now, and unrest beginning (an event) or ending. */
export function assess(state: SimulationState, civ: Polity) {
  const tuning = STABILITY_TUNING, km = capitalTravel(state, civ);
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], region = group.region;
    const result = stabilityOf(state, civ, group, km(region));
    state.stability[region] = result.value;
    if (!state.unrest[region] && result.value < tuning.unrestBelow) {
      state.unrest[region] = 1; state.metrics.unrestOutbreaks++;
      state.chronicle.emit({
        type: 'unrest', actors: [{ id: civ.id, role: 'civ' }], region,
        causes: causes({ hunger: result.hunger, overextension: result.overextension, foreignRule: result.foreignRule }), importance: 0.1,
        data: { civ: civ.name, stability: Math.round(result.value * 100) / 100 },
      });
    } else if (state.unrest[region] && result.value >= tuning.unrestBelow + tuning.hysteresis) state.unrest[region] = 0;
  }
}
