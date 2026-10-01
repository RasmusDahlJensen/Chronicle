import type { ChronicleEvent } from '../../shared/simulation.ts';
import { capacity, gameChange, harvest, METHOD_COUNT, regionYields } from './food.ts';
import { greatCircleKm } from './geography.ts';
import { createLanguage, createName } from './names.ts';
import { createRng, type Rng } from './rng.ts';
import { VALUE_KEYS, type Culture, type CultureValues, type Polity, type PopulationGroup, type SimulationState, type TickContext } from './state.ts';
import { BAND_TUNING, CULTURE_TUNING, FOOD_TUNING, POPULATION_TUNING, SPAWN_TUNING } from './tunables.ts';

/**
 * Bands: foraging, hunting and fishing people who move and split (VISION.md "Food, population and borders").
 * At most one band lives in a region. Every movement and every change in size is recorded as an event or as a
 * ledger flow (births, deaths by cause, migration), so region populations balance exactly each tick.
 */
const yields = new Float64Array(METHOD_COUNT), workers = new Float64Array(METHOD_COUNT);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const UNITS = FOOD_TUNING.unitsPerPersonMonth;

/** A region is near water when it has a coast, open-lake access or a river of tier ≥ river. */
export function isWaterRegion(state: SimulationState, region: number) {
  const entry = state.partition.regions[region];
  return entry.coastal || entry.openLake || entry.riverTier >= 2;
}

/** Annual food per person if `people` lived in `region` now. */
function foodPerPerson(state: SimulationState, region: number, people: number) {
  regionYields(state.food, state.gameStock[region], yields);
  return people > 0 ? harvest(state.food.labor, region * METHOD_COUNT, yields, people, workers).output / people : 0;
}

/** Capacity of a region at its current game stock, warm-started from the last value. */
export function regionCapacity(state: SimulationState, region: number) {
  regionYields(state.food, state.gameStock[region], yields);
  state.capacity[region] = capacity(state.food.labor, region * METHOD_COUNT, yields, state.capacity[region]);
  return state.capacity[region];
}

function randomValues(rng: Rng): CultureValues {
  const values = {} as CultureValues;
  for (const key of VALUE_KEYS) values[key] = Math.round((CULTURE_TUNING.valueMin + CULTURE_TUNING.valueSpan * rng.next()) * 1000) / 1000;
  return values;
}

function newCulture(state: SimulationState, rng: Rng, parent: Culture | null): Culture {
  const values = parent ? { ...parent.values } : randomValues(rng);
  if (parent) for (const key of VALUE_KEYS) values[key] = Math.round(clamp(values[key] + (rng.next() - 0.5) * CULTURE_TUNING.mutation, 0, 1) * 1000) / 1000;
  const language = parent ? parent.language : createLanguage(rng);
  const culture: Culture = {
    id: state.cultures.length, name: createName(rng, language), values, language,
    parents: parent ? [{ id: parent.id, weight: 1 }] : [], foundedTick: state.tick,
  };
  state.cultures.push(culture);
  return culture;
}

function newBand(state: SimulationState, rng: Rng, region: number, size: number, culture: Culture, parent: Polity | null): Polity {
  const polity: Polity = {
    id: state.polities.length, kind: 'band', name: createName(rng, culture.language), culture: culture.id, region,
    arrivedTick: state.tick, foundedTick: state.tick, deathTick: null, parent: parent?.id ?? null, group: state.groups.length,
  };
  const group: PopulationGroup = {
    id: state.groups.length, polity: polity.id, culture: culture.id, region, size, deathTick: null, store: 0,
    birthCarry: 0, naturalCarry: 0, famineCarry: 0, foodSecurity: 1, birthsYear: 0, deathsYear: 0, lastBirths: 0, lastDeaths: 0,
    sizeAtYearStart: size,
  };
  state.polities.push(polity); state.groups.push(group); state.bands.push(polity.id);
  state.occupant[region] = polity.id;
  return polity;
}

/** The factors behind a decision, strongest first; weak ones are dropped, but the strongest is always kept. */
function causes(factors: Record<string, number>): ChronicleEvent['causes'] {
  const ranked = Object.entries(factors).filter(([, weight]) => weight > 0).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  const kept = ranked.filter(([, weight], at) => at === 0 || weight >= BAND_TUNING.minCause);
  return kept.slice(0, 4).map(([factor, weight]) => ({ factor, weight: Math.max(0.001, Math.round(weight * 1000) / 1000) }));
}

/** Year 0: bands in attractive regions (food, fresh water, mild climate), spaced apart (VISION.md "Starting state"). */
export function spawnBands(state: SimulationState) {
  const rng = createRng(state.seed, 0, 0x5ba5);
  const { regions } = state.partition, tuning = SPAWN_TUNING;
  const weight = regions.map(region => {
    const people = regionCapacity(state, region.id);
    if (people <= 0) return 0;
    let temperature = 0;
    for (const cell of region.cells) temperature += state.geography.temperature[cell] / 10;
    temperature /= region.cells.length;
    const mild = Math.exp(-(((temperature - tuning.idealTemperature) / tuning.temperatureWidth) ** 2));
    return people * (1 + (isWaterRegion(state, region.id) ? tuning.waterBonus : 0)) * mild;
  });
  const chosen: number[] = [];
  while (chosen.length < tuning.bands) {
    const pick = rng.weighted(weight);
    if (pick < 0) break;
    weight[pick] = 0;
    const centroid = regions[pick].centroid;
    if (chosen.some(other => greatCircleKm(state.geography, centroid, regions[other].centroid) < tuning.minSpacingKm)) continue;
    chosen.push(pick);
  }
  const sizes = chosen.map(() => tuning.minPopulation + rng.int(tuning.maxPopulation - tuning.minPopulation + 1));
  for (const [index, region] of chosen.entries()) {
    // Cultures and names draw from their own stream, so naming rules never shift where or how large bands start.
    const naming = createRng(state.seed, 0, 0x5ba6, index);
    const band = newBand(state, naming, region, sizes[index], newCulture(state, naming, null), null);
    const size = sizes[index];
    const group = state.groups[band.group];
    group.store = size * UNITS;
    state.chronicle.emit({
      type: 'bandSpawned', actors: [{ id: band.id, role: 'band' }], region, importance: 0.3,
      data: { population: size, name: band.name, culture: state.cultures[band.culture].name },
    });
  }
}

/** Production system: each band's monthly food, stores and spoilage; game depletion and regrowth everywhere. */
export function produce(state: SimulationState) {
  const { food, ledger } = state;
  const harvested = new Uint8Array(state.partition.regions.length);
  for (const id of state.bands) {
    const band = state.polities[id], group = state.groups[band.group], region = band.region;
    regionYields(food, state.gameStock[region], yields);
    const { output } = harvest(food.labor, region * METHOD_COUNT, yields, group.size, workers);
    const before = group.store;
    const production = Math.round(output * UNITS);
    const need = group.size * UNITS;
    const consumption = Math.min(need, before + production);
    // A perishable store: part of what is left rots each month, and nothing beyond the limit keeps.
    const left = before + production - consumption, cap = Math.round(group.size * POPULATION_TUNING.storeMonths * UNITS);
    const spoilage = Math.max(left - cap, Math.round(left * POPULATION_TUNING.storeSpoilage));
    group.store = before + production - consumption - spoilage;
    group.foodSecurity = need > 0 ? (group.store + 12 * production) / (12 * need) : 1;
    ledger.food.set(group.id, { before, production, consumption, spoilage, carriedIn: 0, carriedOut: 0 });
    state.gameStock[region] = clamp(state.gameStock[region] + gameChange(food, region, state.gameStock[region], workers) / 12, FOOD_TUNING.gameFloor, 1);
    harvested[region] = 1;
  }
  workers.fill(0);
  for (let region = 0; region < harvested.length; region++) {
    if (harvested[region] || state.gameStock[region] >= 1) continue;
    state.gameStock[region] = clamp(state.gameStock[region] + gameChange(food, region, state.gameStock[region], workers) / 12, FOOD_TUNING.gameFloor, 1);
  }
}

/** Population system: births and deaths from food security every month; moves and splits once a year per band. */
export function populate(state: SimulationState, context: TickContext) {
  const { ledger, metrics } = state, tuning = POPULATION_TUNING;
  const yearEnd = context.month === 12, cadence = BAND_TUNING.decisionMonths;
  for (const id of state.bands.slice()) {
    const band = state.polities[id], group = state.groups[band.group], region = band.region;
    const security = group.foodSecurity;
    const birthRate = tuning.birthRate + tuning.birthSlope * clamp((security - 1) / tuning.securitySpan, -1, 1);
    const famineRate = tuning.famineDeaths * Math.sqrt(Math.max(0, 1 - security));
    group.birthCarry += group.size * birthRate / 12;
    group.naturalCarry += group.size * tuning.deathRate / 12;
    group.famineCarry += group.size * famineRate / 12;
    const births = Math.floor(group.birthCarry);
    let natural = Math.floor(group.naturalCarry), famine = Math.floor(group.famineCarry);
    group.birthCarry -= births; group.naturalCarry -= natural; group.famineCarry -= famine;
    natural = Math.min(natural, group.size + births);
    famine = Math.min(famine, group.size + births - natural);
    group.size += births - natural - famine;
    group.birthsYear += births; group.deathsYear += natural + famine;
    ledger.births[region] += births; ledger.naturalDeaths[region] += natural; ledger.famineDeaths[region] += famine;
    metrics.births += births; metrics.deaths += natural + famine; metrics.famineDeaths += famine;
    if (yearEnd) {
      // The acceptance rule: a band of at least 50 people, alive all year, has births and deaths every year.
      if (group.sizeAtYearStart >= 50 && band.foundedTick <= context.tick - 11 && (group.birthsYear === 0 || group.deathsYear === 0)) metrics.silentBandYears++;
      group.lastBirths = group.birthsYear; group.lastDeaths = group.deathsYear;
      group.birthsYear = 0; group.deathsYear = 0; group.sizeAtYearStart = group.size;
    }
    if (group.size <= 0) { dissolve(state, band, context.tick); continue; }
    const people = regionCapacity(state, region);
    if (group.size > 1.1 * people) {
      state.overCapacity[region]++;
      metrics.maxOverCapacityMonths = Math.max(metrics.maxOverCapacityMonths, state.overCapacity[region]);
    } else state.overCapacity[region] = 0;
    if (((context.tick - id) % cadence + cadence) % cadence === 0) decide(state, context, band, group, people);
  }
}

function dissolve(state: SimulationState, band: Polity, tick: number) {
  const group = state.groups[band.group];
  // A band that dies out leaves its stored food to rot: recorded as spoilage so the store balances.
  const flows = state.ledger.food.get(group.id);
  if (flows) flows.spoilage += group.store;
  group.store = 0;
  band.deathTick = tick; group.deathTick = tick; group.size = 0;
  state.occupant[band.region] = -1; state.overCapacity[band.region] = 0;
  state.bands.splice(state.bands.indexOf(band.id), 1);
}

/** Yearly choice (staggered by band id): split when large or crowded, move when a free neighbour feeds people clearly better. */
function decide(state: SimulationState, context: TickContext, band: Polity, group: PopulationGroup, people: number) {
  const tuning = BAND_TUNING, rng = context.stream(band.id);
  const region = band.region, here = state.partition.regions[region];
  const pressure = people > 0 ? clamp((group.size / people - tuning.pressureFrom) / (tuning.pressureFull - tuning.pressureFrom), 0, 1) : 1;
  const depletion = 1 - state.gameStock[region];
  const free = here.neighbors.filter(edge => state.occupant[edge.region] < 0);
  if (!free.length) return;
  const size = clamp((group.size - tuning.splitFrom * tuning.splitSize) / (tuning.splitSpan * tuning.splitSize), 0, 1);
  const splitDesire = tuning.splitSizeWeight * size + tuning.splitPressureWeight * pressure;
  if (rng.chance(clamp(splitDesire * tuning.splitRate, 0, tuning.maxChance))) {
    const leaving = Math.floor(group.size * tuning.splitShare);
    // The best free neighbour is the one whose land feeds the most people (its capacity), less the cost of crossing a
    // river; it must also feed the newcomers now.
    const scored = free.filter(edge => foodPerPerson(state, edge.region, leaving) >= 1)
      .map(edge => ({ edge, score: regionCapacity(state, edge.region) * (1 - tuning.riverCrossingCost[edge.riverTier]) }))
      .sort((a, b) => b.score - a.score || a.edge.region - b.edge.region).slice(0, tuning.splitCandidates).filter(entry => entry.score > 0);
    const pick = rng.weighted(scored.map(entry => entry.score ** tuning.choiceSharpness));
    // Causes: the two drivers of the split desire as they contributed, with game depletion as context.
    if (pick >= 0 && leaving > 0) {
      split(state, context, band, group, scored[pick].edge.region, leaving, { size: tuning.splitSizeWeight * size, landPressure: tuning.splitPressureWeight * pressure, gameDepletion: depletion });
      return;
    }
  }
  const current = foodPerPerson(state, region, group.size);
  const options = free.map(edge => {
    const there = foodPerPerson(state, edge.region, group.size);
    const gain = (there - current) / Math.max(current, tuning.minFoodPerPerson);
    // A destination must also feed the whole band.
    return { edge, gain, desire: there >= 1 ? clamp(gain - tuning.moveCost - tuning.riverCrossingCost[edge.riverTier], 0, 1) : 0 };
  }).filter(option => option.desire > 0);
  if (!options.length) return;
  const best = options.reduce((top, option) => option.desire > top.desire ? option : top);
  const push = Math.max(pressure, depletion), factor = tuning.pushBase + (1 - tuning.pushBase) * push;
  if (!rng.chance(clamp(best.desire * tuning.moveRate * factor, 0, tuning.maxChance))) return;
  const pick = rng.weighted(options.map(option => option.desire ** tuning.choiceSharpness));
  // Causes as they contributed: the food gain pulls; pressure and depletion push, by their share of the move chance.
  const pushShare = factor > 0 ? (1 - tuning.pushBase) * push / factor : 0, total = pressure + depletion;
  move(state, context, band, group, options[pick].edge.region, {
    opportunity: clamp(options[pick].gain, 0, 1),
    landPressure: total > 0 ? pushShare * pressure / total : 0, gameDepletion: total > 0 ? pushShare * depletion / total : 0,
  });
}

function move(state: SimulationState, context: TickContext, band: Polity, group: PopulationGroup, to: number, factors: Record<string, number>) {
  const from = band.region;
  state.ledger.migrantsOut[from] += group.size; state.ledger.migrantsIn[to] += group.size;
  state.occupant[from] = -1; state.overCapacity[from] = 0; state.occupant[to] = band.id;
  band.region = to; group.region = to; band.arrivedTick = context.tick;
  state.metrics.moves++;
  const cited = causes(factors);
  if (cited.some(cause => (cause.factor === 'landPressure' || cause.factor === 'gameDepletion') && cause.weight >= 0.1)) state.metrics.movesCitingPressure++;
  if (cited[0] && cited[0].factor !== 'opportunity') state.metrics.movesLedByPressure++;
  state.chronicle.emit({
    type: 'bandMoved', actors: [{ id: band.id, role: 'band' }], region: to, causes: cited, importance: 0.05,
    data: { from, population: group.size, name: band.name },
  });
}

function split(state: SimulationState, context: TickContext, parent: Polity, group: PopulationGroup, to: number, leaving: number, factors: Record<string, number>) {
  // A stream of its own (salt 1), apart from the parent's yearly decision stream.
  const rng = context.stream(parent.id, 1);
  const culture = newCulture(state, rng, state.cultures[parent.culture]);
  const child = newBand(state, rng, to, leaving, culture, parent);
  const childGroup = state.groups[child.group];
  const carried = Math.floor(group.store * leaving / group.size);
  const parentFlows = state.ledger.food.get(group.id);
  if (parentFlows) parentFlows.carriedOut += carried;
  state.ledger.food.set(childGroup.id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: carried, carriedOut: 0 });
  group.store -= carried; childGroup.store = carried;
  group.size -= leaving;
  childGroup.foodSecurity = group.foodSecurity; childGroup.sizeAtYearStart = leaving;
  state.ledger.migrantsOut[parent.region] += leaving; state.ledger.migrantsIn[to] += leaving;
  state.metrics.splits++;
  state.chronicle.emit({
    type: 'bandSplit', actors: [{ id: child.id, role: 'child' }, { id: parent.id, role: 'parent' }], region: to, causes: causes(factors),
    importance: 0.08, data: { from: parent.region, population: leaving, name: child.name, parentName: parent.name, culture: culture.name },
  });
}
