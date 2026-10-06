import { regionDroughtShield } from './economy.ts';
import { checkFamineWatches, fallow } from './fields.ts';
import type { SimulationState, TickContext } from './state.ts';
import { ENVIRONMENT_TUNING } from './tunables.ts';

// RNG salts within the environment system: a harvest's weather, a drought's onset.
const HARVEST = 1, DROUGHT = 2;

/**
 * Environment system (VISION.md: "harvest calendar, yield variance, droughts"), monthly and first in the tick. At a
 * region's harvest month it draws the weather that harvest comes in at; each January droughts may begin, more often in
 * arid land, and spread to neighbouring regions; drought months count down. Famine deaths fade from the region's
 * memory month by month. Climate shocks wait for later milestones.
 */
export function environment(state: SimulationState, context: TickContext) {
  const tuning = ENVIRONMENT_TUNING, harvest = state.food.harvest, regions = state.weather.length, month = context.month;
  for (let region = 0; region < regions; region++) {
    if (state.drought[region] > 0) state.drought[region]--;
    state.famineRecent[region] *= tuning.famineFade;
    // A famine in a region its people have left (or died out of) ends once the dying is over; their fields fall fallow.
    if (state.groupAt[region] < 0) {
      if (state.famine[region] && state.famineRecent[region] < tuning.famineMin) state.famine[region] = 0;
      if (state.fields[region] > 0) fallow(state, region);
    }
  }
  // Droughts begin before this month's harvests come in, so a harvest in a drought's first month is cut too.
  if (month === 1) { beginDroughts(state, context); checkFamineWatches(state); }
  // One stream for the month's harvests, drawn in region order.
  let rng: ReturnType<TickContext['stream']> | null = null;
  for (let region = 0; region < regions; region++) {
    if (harvest[region * 12 + month - 1] > 0) {
      rng ??= context.stream(0, HARVEST);
      // A standard normal draw (the sum of three uniforms, scaled), within the bounds.
      const normal = (rng.next() + rng.next() + rng.next() - 1.5) * 2;
      state.weather[region] = Math.max(tuning.harvestMin, Math.min(tuning.harvestMax, 1 + tuning.harvestSpread * normal));
      // The share the harvest comes in at, whoever farms there (production applies it).
      state.harvestFactor[region] = harvestYield(state, region);
    }
  }
}

/** Each January: droughts begin, each in one region and those beside it it spreads to; an event where it touches people. */
function beginDroughts(state: SimulationState, context: TickContext) {
  const tuning = ENVIRONMENT_TUNING, regions = state.partition.regions, rng = context.stream(0, DROUGHT);
  // One stream for the year's droughts, drawn in region order.
  for (let region = 0; region < regions.length; region++) {
    if (state.drought[region] > 0 || !state.habitable[region]) continue;
    const arid = state.affinity[region].has('arid');
    if (!rng.chance(tuning.droughtChance * (arid ? tuning.aridDrought : 1))) continue;
    const years = 1 + rng.int(tuning.droughtYears), struck = [region];
    state.drought[region] = years * 12;
    for (const edge of regions[region].neighbors) {
      if (state.drought[edge.region] > 0 || !state.habitable[edge.region] || !rng.chance(tuning.droughtSpread)) continue;
      state.drought[edge.region] = years * 12;
      struck.push(edge.region);
    }
    state.metrics.droughts++;
    const peoples = [...new Set(struck.map(at => state.occupant[at]).filter(id => id >= 0))];
    if (!peoples.length) continue;
    let people = 0;
    for (const at of struck) if (state.groupAt[at] >= 0) people += state.groups[state.groupAt[at]].size;
    state.chronicle.emit({
      type: 'drought', actors: peoples.slice(0, 8).map(id => ({ id, role: 'polity' })), region, settlement: null,
      causes: [{ factor: arid ? 'dryLand' : 'weather', weight: 1 }], importance: Math.min(0.3, 0.04 + people / 2_000_000),
      data: { name: state.polities[peoples[0]].name, others: peoples.length > 1, more: struck.length - 1, oneMore: struck.length === 2, moreRegions: struck.length > 2, years, oneYear: years === 1, severalYears: years > 1, people },
    });
  }
}

/** The share of its crops a region's harvest comes in at now: the weather, and less in drought (irrigation softens it). */
export function harvestYield(state: SimulationState, region: number) {
  return state.weather[region] * (state.drought[region] > 0 ? 1 - ENVIRONMENT_TUNING.droughtFarmLoss * (1 - regionDroughtShield(state, region)) : 1);
}

/** The share of their yield herds give in a region now: less in drought (irrigation softens it). */
export function herdYield(state: SimulationState, region: number) {
  return state.drought[region] > 0 ? 1 - ENVIRONMENT_TUNING.droughtHerdLoss * (1 - regionDroughtShield(state, region)) : 1;
}
