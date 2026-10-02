import type { ChronicleEvent } from '../../shared/simulation.ts';
import { capacity, FARM_METHOD, gameChange, harvest, HERD_METHOD, METHOD_COUNT, monthsToHarvest, regionYields, sow } from './food.ts';
import { greatCircleKm } from './geography.ts';
import { inheritKnowledge, learn, startingKnowledge, type Knowledge } from './knowledge.ts';
import { TECH_INDEX } from './techs.ts';
import { causes } from './causes.ts';
import { createLanguage, createName } from './names.ts';
import { absorbMap, arrive, capitalKm, emptyMap, forgetMap, inheritContacts, joinView, lookAgain } from './perception.ts';
import { chooseJoin } from './decisions/join.ts';
import { landPressure, unrestDepth } from './pressure.ts';
import { createRng, type Rng } from './rng.ts';
import { VALUE_KEYS, type Culture, type CultureValues, type Polity, type PopulationGroup, type Settlement, type SimulationState, type TickContext } from './state.ts';
import { BAND_TUNING, CLOCK_TUNING, CULTURE_TUNING, FOOD_TUNING, JOIN_TUNING, MIGRATION_TUNING, REACH_TUNING, STABILITY_TUNING, MOBILITY_TUNING, POPULATION_TUNING, SETTLE_TUNING, SPAWN_TUNING, SPECIALIST_TUNING } from './tunables.ts';

/**
 * Tribes and settled polities (VISION.md "Food, population and borders"). A polity holds one or more regions with
 * one population group in each, and at most one group lives in a region. A tribe's bands forage, hunt and fish, move
 * and split: a band that splits off usually stays in its tribe and sometimes breaks away as a new tribe. With
 * Agriculture or Animal husbandry they also farm or herd and, once the heartland band has stayed long enough, the
 * whole tribe settles into one civilization with a village in each of its regions. Every movement and every change in
 * size is an event or a ledger flow (births, deaths by cause, migration), so region populations balance each tick.
 */
const yields = new Float64Array(METHOD_COUNT), workers = new Float64Array(METHOD_COUNT);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const UNITS = FOOD_TUNING.unitsPerPersonMonth;
// RNG salts within the population system: polity streams use no salt (settling) or SETTLING_NAMES; group streams
// use DECISION or SPLITTING, so a polity and a group with the same id never share numbers.
const DECISION = 1, SETTLING_NAMES = 2, SPLITTING = 3, JOINING = 4;

/** A region is near water when it has a coast, open-lake access or a river of tier ≥ river. */
export function isWaterRegion(state: SimulationState, region: number) {
  const entry = state.partition.regions[region];
  return entry.coastal || entry.openLake || entry.riverTier >= 2;
}

/** The region of a polity's core group (its heartland). */
export function coreRegion(state: SimulationState, polity: Polity) { return state.groups[polity.core].region; }

/** The polity's people in all its regions. */
export function polityPopulation(state: SimulationState, polity: Polity) {
  let total = 0;
  for (const id of polity.groups) total += state.groups[id].size;
  return total;
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

/**
 * Per region: the people its land could feed at full game with Neolithic farming and herding — static, the value a
 * civilization weighs when it looks for land (its own techs scale all land alike).
 */
export function landValues(state: SimulationState) {
  let knowledge = startingKnowledge();
  for (const name of ['Pottery', 'Agriculture', 'Animal husbandry']) knowledge = learn(knowledge, TECH_INDEX.get(name)!);
  return Float64Array.from(state.partition.regions, region => {
    regionYields(state.food, 1, yields, region.id, knowledge);
    return capacity(state.food.labor, region.id * METHOD_COUNT, yields);
  });
}

export { landPressure } from './pressure.ts';

/** How readily people cross into a region over this travel-km: 1 up to `easyKm`, falling with rougher crossings. */
const terrainEase = (travelKm: number) => Math.min(1, (BAND_TUNING.easyKm / Math.max(1, travelKm)) ** BAND_TUNING.terrainPower);

/** Where a band forced to leave `region` would go: the free land within reach that feeds it best, if any feeds all of it. */
export function refuge(state: SimulationState, tribe: Polity, group: PopulationGroup, region: number) {
  let best = -1, most = 1;
  for (const option of reachableFree(state, tribe, region)) {
    const food = foodPerPerson(state, option.region, group.size, tribe.knowledge);
    if (food >= most) { best = option.region; most = food; }
  }
  return best;
}

/** Free regions a band of this polity could move or split into from `region`: land neighbours, and sea crossings its knowledge allows. */
export function reachableFree(state: SimulationState, polity: Polity, region: number) {
  const here = state.partition.regions[region], sea = polity.knowledge.sea;
  const options = here.neighbors.filter(edge => state.occupant[edge.region] < 0).map(edge => ({ region: edge.region, riverTier: edge.riverTier, travelKm: edge.travelKm }));
  if (sea > 0) {
    for (const link of here.sea) {
      if (state.occupant[link.region] >= 0 || (sea < 2 && link.km > MOBILITY_TUNING.coastalSailingKm)) continue;
      options.push({ region: link.region, riverTier: 0, travelKm: link.km });
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

/** A new population group of `polity` in a free region. */
export function newGroup(state: SimulationState, polity: Polity, region: number, size: number): PopulationGroup {
  const group: PopulationGroup = {
    id: state.groups.length, polity: polity.id, culture: polity.culture, region, size, deathTick: null, foundedTick: state.tick, arrivedTick: state.tick,
    store: 0, planted: 0, birthCarry: 0, naturalCarry: 0, famineCarry: 0, foodSecurity: 1, birthsYear: 0, deathsYear: 0, lastBirths: 0, lastDeaths: 0,
    sizeAtYearStart: size, specialists: 0, farmShare: 0,
  };
  state.groups.push(group); polity.groups.push(group.id);
  state.occupant[region] = polity.id; state.groupAt[region] = group.id;
  arrive(state, polity, region, state.tick);
  return group;
}

/** A new tribe of one band: a starting band, or a band that broke away from `parent`. */
function newTribe(state: SimulationState, rng: Rng, region: number, size: number, culture: Culture, parent: Polity | null): Polity {
  const polity: Polity = {
    id: state.polities.length, kind: 'band', name: createName(rng, culture.language), culture: culture.id,
    foundedTick: state.tick, deathTick: null, parent: parent?.id ?? null, groups: [], core: state.groups.length,
    lineage: parent ? parent.lineage : state.lineages.length,
    knowledge: parent ? inheritKnowledge(parent.knowledge) : startingKnowledge(),
    // A lineage's home is where its first band began: a daughter on another landmass is still away from home.
    homeLandmass: parent ? parent.homeLandmass : state.partition.regions[region].landmass, contacts: [], contactWeights: [],
    exposure: { tech: -1, learned: 0, deaths: 0, value: 0 }, capital: null, settledTick: null,
    map: emptyMap(state.partition.regions.length), met: new Map(),
    decisions: [], lastExpansion: null, longestExpansionGap: 0, seaTick: -1,
  };
  state.polities.push(polity); state.living.push(polity.id);
  // A breakaway knows whom its parent knows before it looks around.
  if (parent) inheritContacts(state, polity, parent, state.tick);
  newGroup(state, polity, region, size);
  return polity;
}

export { causes } from './causes.ts';

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
    const tribe = newTribe(state, naming, region, sizes[index], newCulture(state, naming, null), null);
    state.lineages.push(state.cultures[tribe.culture].name);
    const size = sizes[index];
    state.groups[tribe.core].store = size * UNITS;
    state.chronicle.emit({
      type: 'bandSpawned', actors: [{ id: tribe.id, role: 'band' }], region, importance: 0.3,
      data: { population: size, name: tribe.name, culture: state.cultures[tribe.culture].name },
    });
  }
}

/**
 * Production system: each group's monthly food. Specialists (freed by last month's surplus) do not produce food.
 * Foraging, hunting, fishing and herding feed people every month; farming arrives in harvest months and must be
 * stored. Game depletes where people hunt and regrows everywhere.
 */
export function produce(state: SimulationState, context: TickContext) {
  const { food, ledger } = state;
  const harvested = new Uint8Array(state.partition.regions.length);
  for (const id of state.living) {
    const polity = state.polities[id], knowledge = polity.knowledge, m = knowledge.multipliers;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId], region = group.region;
      regionYields(food, state.gameStock[region], yields, region, knowledge);
      // Unrest lowers what the land yields (VISION.md "Stability": lower output in the region).
      const unrest = unrestDepth(state, region);
      if (unrest > 0) for (let method = 0; method < METHOD_COUNT; method++) yields[method] *= 1 - STABILITY_TUNING.outputLoss * unrest;
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

/**
 * Population system: births and deaths from food security every month. Once a year (staggered by id) a tribe that
 * farms or herds may settle, and each of its bands may split or move.
 */
export function populate(state: SimulationState, context: TickContext) {
  const { ledger, metrics } = state, tuning = POPULATION_TUNING;
  const yearEnd = context.month === 12, cadence = BAND_TUNING.decisionMonths;
  const due = (id: number) => ((context.tick - id) % cadence + cadence) % cadence === 0;
  for (const id of state.living.slice()) {
    const polity = state.polities[id], m = polity.knowledge.multipliers;
    for (const groupId of polity.groups.slice()) {
      const group = state.groups[groupId], region = group.region;
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
        if (polity.kind === 'band' && group.sizeAtYearStart >= 50 && group.foundedTick <= context.tick - 11 && (group.birthsYear === 0 || group.deathsYear === 0)) metrics.silentBandYears++;
        group.lastBirths = group.birthsYear; group.lastDeaths = group.deathsYear;
        group.birthsYear = 0; group.deathsYear = 0; group.sizeAtYearStart = group.size;
      }
      if (group.size <= 0) { removeGroup(state, polity, group, context.tick); continue; }
      const stale = due(groupId) || group.size > CLOCK_TUNING.capacityRefresh * state.capacity[region] || Math.abs(state.gameStock[region] - state.capacityGame[region]) > CLOCK_TUNING.capacityGameDrift;
      const people = stale ? regionCapacity(state, region) : state.capacity[region];
      if (group.size > 1.1 * people) {
        state.overCapacity[region]++;
        metrics.maxOverCapacityMonths = Math.max(metrics.maxOverCapacityMonths, state.overCapacity[region]);
      } else state.overCapacity[region] = 0;
    }
    if (polity.deathTick !== null) continue;
    // Once every group has had its month, so a collapse within one month moves the capital at most once.
    rehome(state, polity);
    if (polity.kind !== 'band') { if (due(id)) migrate(state, polity); continue; }
    // The tribe settles (or prepares to join a civilization) before its bands move on.
    if (due(id) && considerSettling(state, context, polity)) continue;
    for (const groupId of polity.groups.slice()) if (due(groupId)) decide(state, context, polity, state.groups[groupId]);
  }
  // Joins take effect once every group has had its month, so no one is born or dies twice this month.
  for (const { tribe, civ, factors } of joining.splice(0)) {
    if (tribe.deathTick !== null) continue;
    if (civ.deathTick === null) joinCivilization(state, context, tribe, civ, factors);
    else settle(state, context, tribe, { yearsHere: 1, farming: 1 });
  }
}

const joining: { tribe: Polity; civ: Polity; factors: { factor: string; weight: number }[] }[] = [];

/**
 * Migration (VISION.md "Migration"): once a year per civilization, people move from each of its regions to less
 * crowded populated regions next to it that civilizations hold — its own or across a border — in proportion to the
 * difference in land pressure, never more than would even out how crowded the two are, and join the people there.
 * Tribes spread by moving and splitting instead.
 */
function migrate(state: SimulationState, polity: Polity) {
  const regions = state.partition.regions, rate = MIGRATION_TUNING.rate;
  for (const id of polity.groups.slice()) {
    const group = state.groups[id], from = group.region;
    const pressure = landPressure(group.size, state.capacity[from]);
    if (pressure <= 0) continue;
    const targets: { group: PopulationGroup; gap: number }[] = [];
    for (const edge of regions[from].neighbors) {
      if (state.owner[edge.region] < 0 || state.groupAt[edge.region] < 0) continue;
      const there = state.groups[state.groupAt[edge.region]], gap = pressure - landPressure(there.size, state.capacity[edge.region]);
      if (gap > 0) targets.push({ group: there, gap });
    }
    if (!targets.length) continue;
    const size = group.size;
    for (const target of targets) {
      // At most half of what would make both regions equally crowded for their land: migrants never leave a region
      // more crowded than the one they left.
      const here = state.capacity[from], there = state.capacity[target.group.region];
      const level = here > 0 && there > 0 ? (group.size / here - target.group.size / there) * here * there / (here + there) : 0;
      const people = Math.min(Math.floor(size * rate * target.gap / targets.length), Math.floor(level / 2), group.size - 1);
      if (people <= 0) continue;
      group.size -= people; target.group.size += people;
      state.ledger.migrantsOut[from] += people; state.ledger.migrantsIn[target.group.region] += people;
      state.metrics.migrants += people;
    }
  }
}

/** A group that dies out frees its region; its last stored food and crops are recorded as lost, and a civilization's
 *  village there falls to ruin. The polity ends with its last group. */
function removeGroup(state: SimulationState, polity: Polity, group: PopulationGroup, tick: number) {
  const flows = state.ledger.food.get(group.id);
  if (flows) { flows.spoilage += group.store; flows.cropsLost += group.planted; }
  group.store = 0; group.planted = 0; group.size = 0; group.deathTick = tick;
  const region = group.region;
  state.occupant[region] = -1; state.groupAt[region] = -1; state.overCapacity[region] = 0;
  state.stability[region] = 1; state.unrest[region] = 0;
  polity.groups.splice(polity.groups.indexOf(group.id), 1);
  lookAgain(polity);
  if (state.owner[region] === polity.id) {
    state.owner[region] = -1;
    for (const settlement of state.settlements) if (settlement.region === region && settlement.owner === polity.id && settlement.status === 'alive') {
      settlement.status = 'ruined'; settlement.capital = false;
    }
  }
  if (polity.groups.length) return;
  endPolity(state, polity, tick);
  if (polity.kind === 'civ') {
    const capital = polity.capital !== null ? state.settlements[polity.capital] : null;
    state.chronicle.emit({
      type: 'civDestroyed', actors: [{ id: polity.id, role: 'civ' }], region, settlement: capital?.id ?? null,
      causes: causes({ hunger: Math.max(0, 1 - group.foodSecurity), dwindled: 0.001 }), importance: 0.5,
      data: { name: polity.name, capital: capital?.name ?? '?' },
    });
  }
}

/** A polity whose last group died out or left ends; it stays in history. */
export function endPolity(state: SimulationState, polity: Polity, tick: number) {
  polity.deathTick = tick; state.deathCount++;
  state.living.splice(state.living.indexOf(polity.id), 1);
  forgetMap(polity);
}

/**
 * A group passes from one polity to another where it lives (a tribe's band absorbed by a civilization, later a tribe
 * joining one): the people, their culture, food and crops stay; only their polity changes. A civilization founds a
 * village there. The former polity ends with its last group.
 */
export function transferGroup(state: SimulationState, rng: Rng, group: PopulationGroup, from: Polity, to: Polity, tick: number, cited: ChronicleEvent['causes'] = []) {
  from.groups.splice(from.groups.indexOf(group.id), 1);
  lookAgain(from);
  to.groups.push(group.id); group.polity = to.id;
  state.occupant[group.region] = to.id;
  arrive(state, to, group.region, tick);
  if (to.kind === 'civ') { state.owner[group.region] = to.id; foundVillage(state, rng, to, group.region, false, tick, cited); }
  if (!from.groups.length) endPolity(state, from, tick);
  else rehome(state, from);
}

/** After a group died out or left: the heartland passes to the largest remaining band, and a civilization that lost
 *  its capital moves it to the village there. */
export function rehome(state: SimulationState, polity: Polity) {
  if (!polity.groups.includes(polity.core)) {
    polity.core = polity.groups.reduce((best, id) => state.groups[id].size > state.groups[best].size ? id : best, polity.groups[0]);
  }
  if (polity.kind !== 'civ' || polity.capital === null || state.settlements[polity.capital].status === 'alive') return;
  const next = state.settlements.find(settlement => settlement.owner === polity.id && settlement.status === 'alive' && settlement.region === coreRegion(state, polity));
  if (!next) return;
  next.capital = true; polity.capital = next.id;
  state.chronicle.emit({
    type: 'capitalMoved', actors: [{ id: polity.id, role: 'civ' }], region: next.region, settlement: next.id,
    causes: causes({ capitalLost: 1 }), importance: 0.3, data: { name: next.name, civ: polity.name },
  });
}

/** Yearly (staggered by tribe id): a tribe that farms or herds settles once its heartland band has stayed long enough. */
function considerSettling(state: SimulationState, context: TickContext, tribe: Polity) {
  if (!tribe.knowledge.methods.farm && !tribe.knowledge.methods.herd) return false;
  const core = state.groups[tribe.core];
  // Graded: the chance rises with the years the heartland band has stayed and with how much of the tribe's food is
  // farmed or herded.
  const years = (context.tick - core.arrivedTick) / 12;
  const stay = clamp((years - SETTLE_TUNING.fromYears) / SETTLE_TUNING.spanYears, 0, 1);
  let people = 0, farmed = 0;
  for (const id of tribe.groups) { const group = state.groups[id]; people += group.size; farmed += group.size * group.farmShare; }
  const farming = people > 0 ? farmed / people : 0;
  const scale = SETTLE_TUNING.scalePeople > 0 ? Math.min(1, (people / SETTLE_TUNING.scalePeople) ** SETTLE_TUNING.scalePower) : 1;
  const share = SETTLE_TUNING.rate * scale * (SETTLE_TUNING.baseShare + (1 - SETTLE_TUNING.baseShare) * farming) ** SETTLE_TUNING.farmingPower;
  if (!(stay > 0 && context.stream(tribe.id).chance(stay * share))) return false;
  // Before founding its own civilization, it weighs joining one next to it (VISION.md "Joining"); the civilization
  // takes it in only if it can govern its land.
  const view = joinView(state, tribe);
  if (view.options.length) {
    const rng = context.stream(tribe.id, JOINING), { chosen, options } = chooseJoin(view, rng);
    if (chosen.civ !== null) {
      const civ = state.polities[chosen.civ], option = view.options.find(entry => entry.civ === chosen.civ)!;
      const km = capitalKm(state, civ, option.border) ?? Number.POSITIVE_INFINITY;
      const admit = 1 / (1 + (km / (REACH_TUNING.baseKm * civ.knowledge.multipliers.reach)) ** JOIN_TUNING.admitPower);
      if (rng.chance(admit)) { joining.push({ tribe, civ, factors: chosen.factors }); return true; }
      settle(state, context, tribe, { yearsHere: stay, farming, turnedAway: 1 - admit });
      return true;
    }
    const pride = options.find(option => option.civ === null)!;
    settle(state, context, tribe, { yearsHere: stay, farming, independence: pride.score });
    return true;
  }
  settle(state, context, tribe, { yearsHere: stay, farming });
  return true;
}

/**
 * A tribe joins a civilization (VISION.md "Joining"): each of its bands becomes a village of the civilization where it
 * lives, keeping its people, culture, food and crops; the civilization learns what the tribe saw; the tribe ends.
 */
function joinCivilization(state: SimulationState, context: TickContext, tribe: Polity, civ: Polity, factors: { factor: string; weight: number }[]) {
  const rng = context.stream(tribe.id, SETTLING_NAMES), heartland = coreRegion(state, tribe);
  const people = polityPopulation(state, tribe), regions = tribe.groups.length;
  const cited = causes(Object.fromEntries(factors.map(entry => [entry.factor, entry.weight])));
  state.chronicle.emit({
    type: 'bandJoined', actors: [{ id: tribe.id, role: 'band' }, { id: civ.id, role: 'civ' }], region: heartland, causes: cited, importance: 0.2,
    data: { name: tribe.name, civ: civ.name, population: people, regions, kin: tribe.lineage === civ.lineage },
  });
  absorbMap(state, civ, tribe, context.tick);
  for (const id of tribe.groups.slice()) transferGroup(state, rng, state.groups[id], tribe, civ, context.tick, cited);
  state.metrics.joined++;
}

/**
 * Yearly choice of one band (staggered by group id): split when large or crowded, otherwise move when a free
 * neighbour feeds it clearly better. A band that splits off usually stays in its tribe and sometimes breaks away.
 */
function decide(state: SimulationState, context: TickContext, tribe: Polity, group: PopulationGroup) {
  const tuning = BAND_TUNING, rng = context.stream(group.id, DECISION), region = group.region;
  const people = state.capacity[region];
  const pressure = landPressure(group.size, people);
  const depletion = 1 - state.gameStock[region];
  const free = reachableFree(state, tribe, region);
  if (!free.length) return;
  const size = clamp((group.size - tuning.splitFrom * tuning.splitSize) / (tuning.splitSpan * tuning.splitSize), 0, 1);
  const splitDesire = tuning.splitSizeWeight * size + tuning.splitPressureWeight * pressure;
  if (rng.chance(clamp(splitDesire * tuning.splitRate, 0, tuning.maxChance))) {
    const leaving = Math.floor(group.size * tuning.splitShare);
    // The best free neighbour is the one whose land feeds the most people with this tribe's knowledge (its capacity),
    // less the cost of crossing a river; it must also feed the newcomers now.
    const scored = free.filter(edge => foodPerPerson(state, edge.region, leaving, tribe.knowledge) >= 1)
      .map(edge => ({ edge, score: regionCapacity(state, edge.region, tribe.knowledge) * (1 - tuning.riverCrossingCost[edge.riverTier]) * terrainEase(edge.travelKm) }))
      .sort((a, b) => b.score - a.score || a.edge.region - b.edge.region).slice(0, tuning.splitCandidates).filter(entry => entry.score > 0);
    const pick = rng.weighted(scored.map(entry => entry.score ** tuning.choiceSharpness));
    // Causes: the two drivers of the split desire as they contributed, with game depletion as context.
    if (pick >= 0 && leaving > 0) {
      split(state, context, tribe, group, scored[pick].edge.region, leaving, { size: tuning.splitSizeWeight * size, landPressure: tuning.splitPressureWeight * pressure, gameDepletion: depletion });
      return;
    }
  }
  const current = foodPerPerson(state, region, group.size, tribe.knowledge);
  const options = free.map(edge => {
    const there = foodPerPerson(state, edge.region, group.size, tribe.knowledge);
    const gain = (there - current) / Math.max(current, tuning.minFoodPerPerson);
    // A destination must also feed the whole band.
    return { edge, gain, desire: there >= 1 ? clamp((gain - tuning.moveCost - tuning.riverCrossingCost[edge.riverTier]) * terrainEase(edge.travelKm), 0, 1) : 0 };
  }).filter(option => option.desire > 0);
  if (!options.length) return;
  const best = options.reduce((top, option) => option.desire > top.desire ? option : top);
  const push = Math.max(pressure, depletion), factor = tuning.pushBase + (1 - tuning.pushBase) * push;
  if (!rng.chance(clamp(best.desire * tuning.moveRate * factor, 0, tuning.maxChance))) return;
  const pick = rng.weighted(options.map(option => option.desire ** tuning.choiceSharpness));
  // Causes as they contributed: the food gain pulls; pressure and depletion push, by their share of the move chance.
  const pushShare = factor > 0 ? (1 - tuning.pushBase) * push / factor : 0, total = pressure + depletion;
  move(state, context, tribe, group, options[pick].edge.region, {
    opportunity: clamp(options[pick].gain, 0, 1),
    landPressure: total > 0 ? pushShare * pressure / total : 0, gameDepletion: total > 0 ? pushShare * depletion / total : 0,
  });
}

export function move(state: SimulationState, context: Pick<TickContext, 'tick'>, tribe: Polity, group: PopulationGroup, to: number, factors: Record<string, number>) {
  const from = group.region;
  state.ledger.migrantsOut[from] += group.size; state.ledger.migrantsIn[to] += group.size;
  // Crops in the field stay behind.
  const flows = state.ledger.food.get(group.id);
  if (flows) flows.cropsLost += group.planted;
  group.planted = 0;
  state.occupant[from] = -1; state.groupAt[from] = -1; state.overCapacity[from] = 0;
  state.occupant[to] = tribe.id; state.groupAt[to] = group.id;
  group.region = to; group.arrivedTick = context.tick;
  arrive(state, tribe, to, context.tick);
  // The cached capacity may be a former occupant's; the over-capacity check needs this band's.
  regionCapacity(state, to);
  state.metrics.moves++;
  const cited = causes(factors);
  if (cited.some(cause => (cause.factor === 'landPressure' || cause.factor === 'gameDepletion') && cause.weight >= 0.1)) state.metrics.movesCitingPressure++;
  if (cited[0] && (cited[0].factor === 'landPressure' || cited[0].factor === 'gameDepletion')) state.metrics.movesLedByPressure++;
  state.chronicle.emit({
    type: 'bandMoved', actors: [{ id: tribe.id, role: 'band' }], region: to, causes: cited, importance: 0.05,
    data: { from, population: group.size, name: tribe.name },
  });
}

/** The chance that a band splitting off into `to` breaks away from its tribe, and that chance's parts (for causes). */
export function breakawayChance(state: SimulationState, tribe: Polity, to: number) {
  const values = state.cultures[tribe.culture].values;
  // How far in travel: from the heartland through the tribe's own land, so a group that crosses mountains or a great
  // river is likelier to go its own way (and peoples part along barriers).
  const km = BAND_TUNING.travelDistance ? capitalKm(state, tribe, to) ?? Number.POSITIVE_INFINITY
    : greatCircleKm(state.geography, state.partition.regions[coreRegion(state, tribe)].centroid, state.partition.regions[to].centroid);
  return breakawayOdds(km, tribe.groups.length, values);
}

/** The breakaway chance for a split `km` from the heartland, from a tribe of `bands` bands, with these values. */
export function breakawayOdds(km: number, bands: number, values: CultureValues) {
  const tuning = BAND_TUNING;
  const distance = (km / tuning.reachKm) ** tuning.distancePower, size = (bands / tuning.tribeBands) ** tuning.sizePower;
  const culture = 1 + tuning.cultureWeight * (values.expansionism - values.tradition);
  return { chance: 1 - Math.exp(-(distance + size) * culture), distance, size, culture };
}

function split(state: SimulationState, context: TickContext, tribe: Polity, group: PopulationGroup, to: number, leaving: number, factors: Record<string, number>) {
  // A stream of its own, apart from the band's yearly decision stream.
  const rng = context.stream(group.id, SPLITTING);
  const away = breakawayChance(state, tribe, to);
  const breaksAway = rng.chance(away.chance);
  const from = group.region;
  let child: PopulationGroup, polity: Polity, culture: Culture | null = null;
  if (breaksAway) {
    culture = newCulture(state, rng, state.cultures[tribe.culture]);
    polity = newTribe(state, rng, to, leaving, culture, tribe);
    child = state.groups[polity.core];
  } else {
    polity = tribe;
    child = newGroup(state, tribe, to, leaving);
  }
  const carried = Math.floor(group.store * leaving / group.size);
  const parentFlows = state.ledger.food.get(group.id);
  if (parentFlows) parentFlows.carriedOut += carried;
  state.ledger.food.set(child.id, { before: 0, production: 0, consumption: 0, spoilage: 0, carriedIn: carried, carriedOut: 0, plantedBefore: 0, sown: 0, harvested: 0, cropsLost: 0 });
  group.store -= carried; child.store = carried;
  group.size -= leaving;
  child.foodSecurity = group.foodSecurity; child.sizeAtYearStart = leaving;
  regionCapacity(state, to);
  state.ledger.migrantsOut[from] += leaving; state.ledger.migrantsIn[to] += leaving;
  state.metrics.splits++;
  if (breaksAway && culture) {
    state.metrics.breakaways++;
    // Why they left at all, and why they did not stay: distance from the heartland, the tribe's size, its culture.
    const parts = away.distance + away.size;
    state.chronicle.emit({
      type: 'bandSplit', actors: [{ id: polity.id, role: 'child' }, { id: tribe.id, role: 'parent' }], region: to,
      causes: causes({ ...factors, distanceFromHeartland: parts > 0 ? away.chance * away.distance / parts : 0, tribeSize: parts > 0 ? away.chance * away.size / parts : 0 }),
      importance: 0.1, data: { from, population: leaving, name: polity.name, parentName: tribe.name, culture: culture.name },
    });
  } else {
    state.chronicle.emit({
      type: 'bandSpread', actors: [{ id: tribe.id, role: 'band' }], region: to, causes: causes(factors),
      importance: 0.06, data: { from, population: leaving, name: tribe.name, bands: tribe.groups.length },
    });
  }
}

/**
 * A tribe settles (VISION.md "Settling", changed at the M2 review): the whole tribe becomes one civilization that owns
 * every region its bands live in, with a named village in each; the heartland's village is its capital.
 */
export function settle(state: SimulationState, context: Pick<TickContext, 'tick' | 'stream'>, tribe: Polity, factors: Record<string, number>) {
  const rng = context.stream(tribe.id, SETTLING_NAMES);
  const culture = state.cultures[tribe.culture], heartland = coreRegion(state, tribe);
  tribe.kind = 'civ'; tribe.settledTick = context.tick; tribe.lastExpansion = context.tick;
  state.metrics.settled++;
  const cited = causes({ farming: factors.farming, yearsHere: factors.yearsHere, independence: factors.independence ?? 0, turnedAway: factors.turnedAway ?? 0 });
  // The heartland first, so the capital is the tribe's first village.
  const regions = [heartland, ...tribe.groups.map(id => state.groups[id].region).filter(region => region !== heartland)];
  const villages: Settlement[] = [];
  for (const region of regions) {
    state.owner[region] = tribe.id;
    villages.push(foundVillage(state, rng, tribe, region, region === heartland, context.tick, cited, false));
  }
  state.chronicle.emit({
    type: 'settled', actors: [{ id: tribe.id, role: 'polity' }], region: heartland, causes: cited, importance: 0.35,
    data: { name: tribe.name, population: polityPopulation(state, tribe), capital: villages[0].name, culture: culture.name, regions: regions.length },
  });
  for (const village of villages) announceVillage(state, tribe, village, cited);
}

/**
 * A named village of `polity` on its region's best site (VISION.md "Settlements"; until M3b only a village), the
 * capital when `capital`. Announced at once unless the caller announces it after its own event.
 */
export function foundVillage(state: SimulationState, rng: Rng, polity: Polity, region: number, capital: boolean, tick: number,
  cited: ChronicleEvent['causes'] = [], announce = true): Settlement {
  const entry = state.partition.regions[region];
  const settlement: Settlement = {
    id: state.settlements.length, name: createName(rng, state.cultures[polity.culture].language), cell: entry.settlementSites[0] ?? entry.centroid,
    region, owner: polity.id, capital, foundedTick: tick, status: 'alive',
  };
  state.settlements.push(settlement);
  if (capital) polity.capital = settlement.id;
  if (announce) announceVillage(state, polity, settlement, cited);
  return settlement;
}

function announceVillage(state: SimulationState, polity: Polity, settlement: Settlement, cited: ChronicleEvent['causes']) {
  state.chronicle.emit({
    type: 'settlementFounded', actors: [{ id: polity.id, role: 'civ' }], region: settlement.region, settlement: settlement.id, causes: cited,
    importance: settlement.capital ? 0.2 : 0.04, data: { name: settlement.name, civ: polity.name, capital: settlement.capital },
  });
}
