import type { ChronicleEvent } from '../../shared/simulation.ts';
import { capacity, FARM_METHOD, gameChange, harvest, HERD_METHOD, METHOD_COUNT, monthsToHarvest, regionYields, sow } from './food.ts';
import { greatCircleKm } from './geography.ts';
import { inheritKnowledge, startingKnowledge, type Knowledge } from './knowledge.ts';
import { createLanguage, createName } from './names.ts';
import { createRng, type Rng } from './rng.ts';
import { VALUE_KEYS, type Culture, type CultureValues, type Polity, type PopulationGroup, type SimulationState, type TickContext } from './state.ts';
import { BAND_TUNING, CLOCK_TUNING, CULTURE_TUNING, FOOD_TUNING, MOBILITY_TUNING, POPULATION_TUNING, SETTLE_TUNING, SPAWN_TUNING, SPECIALIST_TUNING } from './tunables.ts';

/**
 * Bands and settled polities (VISION.md "Food, population and borders"). At most one polity lives in a region.
 * Bands forage, hunt and fish, move and split; with Agriculture or Animal husbandry they also farm or herd and,
 * after staying long enough, settle into a civilization with a village capital. Every movement and every change in
 * size is an event or a ledger flow (births, deaths by cause, migration), so region populations balance each tick.
 */
const yields = new Float64Array(METHOD_COUNT), workers = new Float64Array(METHOD_COUNT);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const UNITS = FOOD_TUNING.unitsPerPersonMonth;

/** A region is near water when it has a coast, open-lake access or a river of tier ≥ river. */
export function isWaterRegion(state: SimulationState, region: number) {
  const entry = state.partition.regions[region];
  return entry.coastal || entry.openLake || entry.riverTier >= 2;
}

/** Annual food per person if `people` with this knowledge lived in `region` now. */
function foodPerPerson(state: SimulationState, region: number, people: number, knowledge?: Knowledge) {
  regionYields(state.food, state.gameStock[region], yields, region, knowledge);
  return people > 0 ? harvest(state.food.labor, region * METHOD_COUNT, yields, people, workers).output / people : 0;
}

/**
 * Capacity of a region at its current game stock for a polity with this knowledge (its occupant's when omitted),
 * warm-started from the last value.
 */
export function regionCapacity(state: SimulationState, region: number, knowledge?: Knowledge) {
  const occupant = state.occupant[region];
  regionYields(state.food, state.gameStock[region], yields, region, knowledge ?? (occupant >= 0 ? state.polities[occupant].knowledge : undefined));
  state.capacity[region] = capacity(state.food.labor, region * METHOD_COUNT, yields, state.capacity[region]);
  state.capacityGame[region] = state.gameStock[region];
  return state.capacity[region];
}

/** Land pressure (VISION.md): a graded need from 0 to 1 that rises from `pressureFrom` of capacity. */
export function landPressure(size: number, people: number) {
  const tuning = BAND_TUNING;
  return people > 0 ? clamp((size / people - tuning.pressureFrom) / (tuning.pressureFull - tuning.pressureFrom), 0, 1) : 1;
}

/** Free regions a polity could move or split into: land neighbours, and sea crossings its mobility allows. */
export function reachableFree(state: SimulationState, polity: Polity) {
  const here = state.partition.regions[polity.region], sea = polity.knowledge.sea;
  const options = here.neighbors.filter(edge => state.occupant[edge.region] < 0).map(edge => ({ region: edge.region, riverTier: edge.riverTier }));
  if (sea > 0) {
    for (const link of here.sea) {
      if (state.occupant[link.region] >= 0 || (sea < 2 && link.km > MOBILITY_TUNING.coastalSailingKm)) continue;
      options.push({ region: link.region, riverTier: 0 });
    }
  }
  return options;
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
    lineage: parent ? parent.lineage : state.lineages.length,
    knowledge: parent ? inheritKnowledge(parent.knowledge) : startingKnowledge(),
    // A lineage's home is where its first band began: a daughter on another landmass is still away from home.
    homeLandmass: parent ? parent.homeLandmass : state.partition.regions[region].landmass, contacts: [], contactWeights: [], exposure: { tech: -1, learned: 0, deaths: 0, value: 0 }, capital: null, settledTick: null,
  };
  const group: PopulationGroup = {
    id: state.groups.length, polity: polity.id, culture: culture.id, region, size, deathTick: null, store: 0, planted: 0,
    birthCarry: 0, naturalCarry: 0, famineCarry: 0, foodSecurity: 1, birthsYear: 0, deathsYear: 0, lastBirths: 0, lastDeaths: 0,
    sizeAtYearStart: size, specialists: 0, farmShare: 0,
  };
  state.polities.push(polity); state.groups.push(group); state.living.push(polity.id);
  state.occupant[region] = polity.id;
  return polity;
}

/** The factors behind a decision, strongest first; weak ones are dropped, but the strongest is always kept. */
export function causes(factors: Record<string, number>): ChronicleEvent['causes'] {
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
    state.lineages.push(state.cultures[band.culture].name);
    const size = sizes[index];
    const group = state.groups[band.group];
    group.store = size * UNITS;
    state.chronicle.emit({
      type: 'bandSpawned', actors: [{ id: band.id, role: 'band' }], region, importance: 0.3,
      data: { population: size, name: band.name, culture: state.cultures[band.culture].name },
    });
  }
}

/**
 * Production system: each polity's monthly food. Specialists (freed by last month's surplus) do not produce food.
 * Foraging, hunting, fishing and herding feed people every month; farming arrives in harvest months and must be
 * stored. Game depletes where people hunt and regrows everywhere.
 */
export function produce(state: SimulationState, context: TickContext) {
  const { food, ledger } = state;
  const harvested = new Uint8Array(state.partition.regions.length);
  for (const id of state.living) {
    const polity = state.polities[id], group = state.groups[polity.group], region = polity.region, knowledge = polity.knowledge;
    const m = knowledge.multipliers;
    regionYields(food, state.gameStock[region], yields, region, knowledge);
    // Surplus frees specialists (VISION.md "Specialists and townspeople"); they live in settlements, so only settled
    // polities have them. The cap grows with storage and farming knowledge.
    const cap = Math.min(SPECIALIST_TUNING.baseCap * m.specialistCap, SPECIALIST_TUNING.maxShare);
    group.specialists = polity.kind === 'band' ? 0 : Math.floor(group.size * cap * clamp(SPECIALIST_TUNING.floor + SPECIALIST_TUNING.slope * (group.foodSecurity - 1), 0, 1));
    const at = region * METHOD_COUNT, before = group.store, plantedBefore = group.planted, need = group.size * UNITS;
    const farming = knowledge.methods.farm;
    // The store that will still be there to eat before the harvest: part of it perishes on the way.
    const toHarvest = monthsToHarvest(food, region, context.month), perishing = Math.min(1, POPULATION_TUNING.storeSpoilage * m.spoilage);
    const output = farming
      ? sow(food.labor, at, yields, group.size - group.specialists, group.size, before / UNITS * Math.max(0, 1 - perishing * toHarvest / 2), toHarvest, workers)
      : harvest(food.labor, at, yields, group.size - group.specialists, workers).output;
    const methodOutput = (method: number) => workers[method] > 0 ? yields[method] * food.labor[at + method] * (1 - Math.exp(-workers[method] / food.labor[at + method])) : 0;
    const farmed = methodOutput(FARM_METHOD), herded = methodOutput(HERD_METHOD), other = output - farmed;
    // Output is a monthly rate. Crops sown this month join those in the field; a harvest month brings them all in.
    const sown = Math.round(farmed * UNITS), harvestMonth = food.harvest[region * 12 + context.month - 1] > 0;
    const harvestedUnits = harvestMonth ? plantedBefore + sown : 0;
    group.planted = plantedBefore + sown - harvestedUnits;
    const production = Math.round(other * UNITS) + harvestedUnits;
    const consumption = Math.min(need, before + production);
    // The store: part of what is left perishes each month, and nothing beyond the limit keeps.
    const left = before + production - consumption, limit = Math.round(group.size * POPULATION_TUNING.storeMonths * m.storeMonths * UNITS);
    const spoilage = Math.max(left - limit, Math.round(left * perishing));
    group.store = before + production - consumption - spoilage;
    group.foodSecurity = foodSecurity(group, farming, other * UNITS, farmed * UNITS, need, food.cycle[region], monthsToHarvest(food, region, context.month % 12 + 1), consumption);
    group.farmShare = output > 0 ? (farmed + herded) / output : 0;
    ledger.food.set(group.id, { before, production, consumption, spoilage, carriedIn: 0, carriedOut: 0, plantedBefore, sown, harvested: harvestedUnits, cropsLost: 0 });
    state.gameStock[region] = clamp(state.gameStock[region] + gameChange(food, region, state.gameStock[region], workers) / 12, FOOD_TUNING.gameFloor, 1);
    harvested[region] = 1;
  }
  workers.fill(0);
  for (let region = 0; region < harvested.length; region++) {
    if (harvested[region] || state.gameStock[region] >= 1) continue;
    state.gameStock[region] = clamp(state.gameStock[region] + gameChange(food, region, state.gameStock[region], workers) / 12, FOOD_TUNING.gameFloor, 1);
  }
}

/**
 * Food security (VISION.md: expected food over need), never more than the share of need people could actually eat this
 * month (a store that runs out before the harvest is hunger). Foragers and herders: the year's expected food from the
 * land over the year's need. Farmers: the coming harvest — crops in the field plus what is still to be sown before it —
 * and other food, over the need of one harvest cycle; cutting a month's sowing lowers it by that month's share only.
 * The store counts by preventing short months, not as security of its own: a big store must not let people live
 * above what their land feeds while it lasts.
 */
function foodSecurity(group: PopulationGroup, farming: boolean, otherRate: number, farmRate: number, need: number, cycle: number, untilHarvest: number, consumption: number) {
  if (need <= 0) return 1;
  // Months from next month to the next harvest month, inclusive, are still to be sown.
  const security = farming ? (group.planted + farmRate * (untilHarvest + 1) + otherRate * cycle) / (need * cycle) : (otherRate + farmRate) / need;
  return consumption < need ? Math.min(security, consumption / need) : security;
}

/** Population system: births and deaths from food security every month; bands decide once a year. */
export function populate(state: SimulationState, context: TickContext) {
  const { ledger, metrics } = state, tuning = POPULATION_TUNING;
  const yearEnd = context.month === 12, cadence = BAND_TUNING.decisionMonths;
  for (const id of state.living.slice()) {
    const polity = state.polities[id], group = state.groups[polity.group], region = polity.region, m = polity.knowledge.multipliers;
    const security = group.foodSecurity;
    const birthRate = (tuning.birthRate + tuning.birthSlope * clamp((security - 1) / tuning.securitySpan, -1, 1)) * m.birthRate;
    const famineRate = tuning.famineDeaths * Math.sqrt(Math.max(0, 1 - security));
    group.birthCarry += group.size * birthRate / 12;
    group.naturalCarry += group.size * tuning.deathRate * m.mortality / 12;
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
      if (polity.kind === 'band' && group.sizeAtYearStart >= 50 && polity.foundedTick <= context.tick - 11 && (group.birthsYear === 0 || group.deathsYear === 0)) metrics.silentBandYears++;
      group.lastBirths = group.birthsYear; group.lastDeaths = group.deathsYear;
      group.birthsYear = 0; group.deathsYear = 0; group.sizeAtYearStart = group.size;
    }
    if (group.size <= 0) { dissolve(state, polity, context.tick); continue; }
    const yearly = ((context.tick - id) % cadence + cadence) % cadence === 0;
    const stale = yearly || group.size > CLOCK_TUNING.capacityRefresh * state.capacity[region] || Math.abs(state.gameStock[region] - state.capacityGame[region]) > CLOCK_TUNING.capacityGameDrift;
    const people = stale ? regionCapacity(state, region) : state.capacity[region];
    if (group.size > 1.1 * people) {
      state.overCapacity[region]++;
      metrics.maxOverCapacityMonths = Math.max(metrics.maxOverCapacityMonths, state.overCapacity[region]);
    } else state.overCapacity[region] = 0;
    if (polity.kind === 'band' && yearly) decide(state, context, polity, group, people);
  }
}

function dissolve(state: SimulationState, polity: Polity, tick: number) {
  const group = state.groups[polity.group];
  // A polity that dies out leaves its stored food to rot: recorded as spoilage so the store balances.
  const flows = state.ledger.food.get(group.id);
  if (flows) { flows.spoilage += group.store; flows.cropsLost += group.planted; }
  group.store = 0; group.planted = 0;
  polity.deathTick = tick; group.deathTick = tick; group.size = 0; state.deathCount++;
  state.occupant[polity.region] = -1; state.overCapacity[polity.region] = 0;
  if (state.owner[polity.region] === polity.id) state.owner[polity.region] = -1;
  if (polity.capital !== null) {
    const capital = state.settlements[polity.capital];
    capital.status = 'ruined';
    state.chronicle.emit({
      type: 'civDestroyed', actors: [{ id: polity.id, role: 'civ' }], region: polity.region, settlement: capital.id,
      causes: causes({ hunger: Math.max(0, 1 - group.foodSecurity), dwindled: 0.001 }), importance: 0.5,
      data: { name: polity.name, capital: capital.name },
    });
  }
  state.living.splice(state.living.indexOf(polity.id), 1);
}

/** Yearly choice (staggered by band id): settle when farming or herding has held it in place, otherwise split or move. */
function decide(state: SimulationState, context: TickContext, band: Polity, group: PopulationGroup, people: number) {
  const tuning = BAND_TUNING, rng = context.stream(band.id);
  if (band.knowledge.methods.farm || band.knowledge.methods.herd) {
    // Graded: the chance rises with years spent here and with how much of the band's food is farmed or herded.
    const years = (context.tick - band.arrivedTick) / 12;
    const stay = clamp((years - SETTLE_TUNING.fromYears) / SETTLE_TUNING.spanYears, 0, 1);
    const share = SETTLE_TUNING.baseShare + (1 - SETTLE_TUNING.baseShare) * group.farmShare;
    if (stay > 0 && rng.chance(stay * share)) { settle(state, context, band, group, { yearsHere: stay, farming: group.farmShare }); return; }
  }
  const region = band.region;
  const pressure = landPressure(group.size, people);
  const depletion = 1 - state.gameStock[region];
  const free = reachableFree(state, band);
  if (!free.length) return;
  const size = clamp((group.size - tuning.splitFrom * tuning.splitSize) / (tuning.splitSpan * tuning.splitSize), 0, 1);
  const splitDesire = tuning.splitSizeWeight * size + tuning.splitPressureWeight * pressure;
  if (rng.chance(clamp(splitDesire * tuning.splitRate, 0, tuning.maxChance))) {
    const leaving = Math.floor(group.size * tuning.splitShare);
    // The best free neighbour is the one whose land feeds the most people with this band's knowledge (its capacity),
    // less the cost of crossing a river; it must also feed the newcomers now.
    const scored = free.filter(edge => foodPerPerson(state, edge.region, leaving, band.knowledge) >= 1)
      .map(edge => ({ edge, score: regionCapacity(state, edge.region, band.knowledge) * (1 - tuning.riverCrossingCost[edge.riverTier]) }))
      .sort((a, b) => b.score - a.score || a.edge.region - b.edge.region).slice(0, tuning.splitCandidates).filter(entry => entry.score > 0);
    const pick = rng.weighted(scored.map(entry => entry.score ** tuning.choiceSharpness));
    // Causes: the two drivers of the split desire as they contributed, with game depletion as context.
    if (pick >= 0 && leaving > 0) {
      split(state, context, band, group, scored[pick].edge.region, leaving, { size: tuning.splitSizeWeight * size, landPressure: tuning.splitPressureWeight * pressure, gameDepletion: depletion });
      return;
    }
  }
  const current = foodPerPerson(state, region, group.size, band.knowledge);
  const options = free.map(edge => {
    const there = foodPerPerson(state, edge.region, group.size, band.knowledge);
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
  // Crops in the field stay behind.
  const flows = state.ledger.food.get(group.id);
  if (flows) flows.cropsLost += group.planted;
  group.planted = 0;
  state.occupant[from] = -1; state.overCapacity[from] = 0; state.occupant[to] = band.id;
  band.region = to; group.region = to; band.arrivedTick = context.tick;
  // The cached capacity may be a former occupant's; the over-capacity check needs this band's.
  regionCapacity(state, to);
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
  state.ledger.food.set(childGroup.id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: carried, carriedOut: 0, plantedBefore: 0, sown: 0, harvested: 0, cropsLost: 0 });
  group.store -= carried; childGroup.store = carried;
  group.size -= leaving;
  childGroup.foodSecurity = group.foodSecurity; childGroup.sizeAtYearStart = leaving;
  regionCapacity(state, to);
  state.ledger.migrantsOut[parent.region] += leaving; state.ledger.migrantsIn[to] += leaving;
  state.metrics.splits++;
  state.chronicle.emit({
    type: 'bandSplit', actors: [{ id: child.id, role: 'child' }, { id: parent.id, role: 'parent' }], region: to, causes: causes(factors),
    importance: 0.08, data: { from: parent.region, population: leaving, name: child.name, parentName: parent.name, culture: culture.name },
  });
}

/** A band settles (VISION.md "Settling"): it becomes a civilization owning its region, with a named village as capital. */
function settle(state: SimulationState, context: TickContext, band: Polity, group: PopulationGroup, factors: Record<string, number>) {
  const region = state.partition.regions[band.region];
  const rng = context.stream(band.id, 2);
  const culture = state.cultures[band.culture];
  const settlement = {
    id: state.settlements.length, name: createName(rng, culture.language), cell: region.settlementSites[0] ?? region.centroid,
    region: region.id, owner: band.id, capital: true, foundedTick: context.tick, status: 'alive' as const,
  };
  state.settlements.push(settlement);
  band.kind = 'civ'; band.capital = settlement.id; band.settledTick = context.tick;
  state.owner[region.id] = band.id;
  state.metrics.settled++;
  const cited = causes({ farming: factors.farming, yearsHere: factors.yearsHere });
  state.chronicle.emit({
    type: 'settled', actors: [{ id: band.id, role: 'polity' }], region: region.id, causes: cited, importance: 0.35,
    data: { name: band.name, population: group.size, capital: settlement.name, culture: culture.name },
  });
  state.chronicle.emit({
    type: 'settlementFounded', actors: [{ id: band.id, role: 'civ' }], region: region.id, settlement: settlement.id, causes: cited,
    importance: 0.2, data: { name: settlement.name, civ: band.name, capital: true },
  });
}
