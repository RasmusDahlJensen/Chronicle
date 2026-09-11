import TinyQueue from 'tinyqueue';
import { WORLD_AREA_KM2, WORLD_BIOMES } from '../../shared/generated-world.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import {
  addCountryClaim,
  releaseCountryClaim,
  countryNeighbors,
  type CountryGrowth,
  type CountryTerritory,
} from '../../shared/country-growth.ts';
import type { SimulationState } from '../../shared/simulation.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { settlementDistanceKm } from './settlements.ts';
import { chooseCountryIntent, completeCountryIntent, type CountryCandidate } from './country-ai.ts';

export const COUNTRY_GROWTH_RULES = {
  initialAreaKm2: 4000,
  workforceShare: 0.6,
  supportLaborShare: 0.25,
  claimWorkers: 12,
  birthNumerator: 4,
  deathNumerator: 2,
  demographicDenominator: 36000,
  hungerPersonDaysPerDeath: 30,
  unsupportedGraceDays: 30,
} as const;
const emptyMetrics = (): CountryGrowth['metrics'] => ({
  workforce: 0,
  supportRequired: 0,
  supportWorkers: 0,
  claimWorkers: 0,
  gatheringWorkers: 0,
  idleWorkers: 0,
  foodCapacity: 0,
  upkeepDue: 0,
  upkeepPaid: 0,
  upkeepShortfall: 0,
  births: 0,
  naturalDeaths: 0,
  starvationDeaths: 0,
});
const area = (env: SettlementEnvironment) => WORLD_AREA_KM2 / (env.width * env.height);
export function claimableLand(env: SettlementEnvironment, id: number): boolean {
  return (
    Number.isInteger(id) &&
    id >= 0 &&
    id < env.width * env.height &&
    env.elevation[id] >= 0 &&
    !['ocean', 'coast', 'seaIce', 'lake', 'lakeIce'].includes(WORLD_BIOMES[env.biome[id]])
  );
}
function edgeCost(env: SettlementEnvironment, from: number, to: number): number {
  const biome = WORLD_BIOMES[env.biome[to]];
  return (
    settlementDistanceKm(env, from, to) *
    (1 +
      Math.abs(env.elevation[to] - env.elevation[from]) / 1500 +
      (['forest', 'rainforest', 'wetland'].includes(biome) ? 0.3 : 0))
  );
}
function routes(env: SettlementEnvironment, region: CountryTerritory): Map<number, number> {
  const allowed = new Set(region.cells),
    distances = new Map<number, number>();
  if (!allowed.has(region.capitalCellId)) return distances;
  distances.set(region.capitalCellId, 0);
  const queue = new TinyQueue([{ id: region.capitalCellId, d: 0 }], (a, b) => a.d - b.d || a.id - b.id);
  while (queue.length) {
    const at = queue.pop()!;
    if (at.d !== distances.get(at.id)) continue;
    for (const id of countryNeighbors(at.id, env.width, env.height)) {
      if (!allowed.has(id)) continue;
      const d = at.d + edgeCost(env, at.id, id);
      if (d < (distances.get(id) ?? Infinity)) {
        distances.set(id, d);
        queue.push({ id, d });
      }
    }
  }
  return distances;
}
function frontier(
  env: SettlementEnvironment,
  region: CountryTerritory,
  distances: Map<number, number>,
  others: readonly CountryTerritory[],
) {
  const owned = new Set(region.cells),
    blocked = new Set(others.flatMap((other) => other.cells)),
    result = new Map<number, number>();
  for (const [at, d] of distances)
    for (const id of countryNeighbors(at, env.width, env.height)) {
      if (owned.has(id) || blocked.has(id) || !claimableLand(env, id)) continue;
      const distance = d + edgeCost(env, at, id);
      if (distance < (result.get(id) ?? Infinity)) result.set(id, distance);
    }
  return [...result].map(([id, d]) => ({
    id,
    d,
    neighbors: countryNeighbors(id, env.width, env.height).filter((next) => owned.has(next)).length,
  }));
}
function foodRate(env: SettlementEnvironment, id: number, distance: number): number {
  const biome = WORLD_BIOMES[env.biome[id]],
    resource = RESOURCE_IDS[env.resource[id] - 1];
  if (['mountain', 'snow'].includes(biome)) return 0;
  const baseline = ['desert', 'tundra'].includes(biome) ? 0.3 : 0.9;
  const edible = resource === 'grain' || resource === 'game' ? 1.2 : 0;
  const fishing = countryNeighbors(id, env.width, env.height).some(
    (next) => RESOURCE_IDS[env.resource[next] - 1] === 'fish',
  )
    ? 1
    : 0;
  return (baseline + env.fertility[id] / 30 + edible + fishing) / (1 + distance / 240);
}
function economy(env: SettlementEnvironment, region: CountryTerritory, population: number, crew = 0) {
  const paths = routes(env, region),
    cellArea = area(env);
  let burden = 0;
  for (const [id, d] of paths) burden += (cellArea / 1000) * (1 + Math.max(0, env.elevation[id]) / 2000 + d / 400);
  const workforce = Math.floor(population * 0.6),
    supportRequired = Math.ceil(burden),
    supportWorkers = Math.min(workforce, supportRequired);
  const claimWorkers = Math.min(crew, workforce - supportWorkers),
    upkeepDue = Math.ceil(burden * 2);
  const sites = [...paths]
    .map(([id, d]) => ({ id, rate: foodRate(env, id, d), capacity: Math.max(1, Math.floor(cellArea * 0.04)) }))
    .filter((site) => site.rate > 0)
    .sort((a, b) => b.rate - a.rate || a.id - b.id);
  const foodCapacity = Math.max(0, sites.reduce((n, s) => n + Math.floor(s.capacity * s.rate), 0) - upkeepDue);
  let remaining = workforce - supportWorkers - claimWorkers,
    collected = 0,
    gatheringWorkers = 0;
  const workingCells: number[] = [];
  for (const site of sites) {
    if (remaining === 0) break;
    const assigned = Math.min(site.capacity, remaining);
    remaining -= assigned;
    gatheringWorkers += assigned;
    collected += Math.floor(assigned * site.rate);
    workingCells.push(site.id);
  }
  return {
    paths,
    collected,
    workingCells,
    metrics: {
      ...emptyMetrics(),
      workforce,
      supportRequired,
      supportWorkers,
      claimWorkers,
      gatheringWorkers,
      idleWorkers: remaining,
      foodCapacity,
      upkeepDue,
    },
  };
}
export function countryClaimCost(env: SettlementEnvironment, id: number, distance: number): number {
  return Math.ceil(area(env) * 0.15 * (1 + Math.max(0, env.elevation[id]) / 1500) + distance * 3);
}
function claimDuration(env: SettlementEnvironment, distance: number): number {
  return Math.ceil(10 + Math.sqrt(area(env)) / 5 + distance / 50);
}
export function initialCountryGrowth(
  countryId: string,
  capitalCellId: number,
  env: SettlementEnvironment,
): CountryGrowth {
  if (!claimableLand(env, capitalCellId)) throw new Error('Country capital must be on land.');
  const territory: CountryTerritory = { countryId, capitalCellId, cells: [capitalCellId] };
  while (territory.cells.length < 16 && territory.cells.length * area(env) < COUNTRY_GROWTH_RULES.initialAreaKm2) {
    const candidates = frontier(env, territory, routes(env, territory), []).sort(
      (a, b) => a.d / (1 + a.neighbors * 0.3) - b.d / (1 + b.neighbors * 0.3) || a.id - b.id,
    );
    if (!candidates.length) break;
    addCountryClaim(territory, candidates[0].id, env.width, env.height);
  }
  return {
    version: 1,
    territory,
    initialCells: [...territory.cells],
    claimsAdded: 0,
    claimsReleased: 0,
    births: 0,
    naturalDeaths: 0,
    starvationDeaths: 0,
    birthRemainder: 0,
    deathRemainder: 0,
    hungerRemainder: 0,
    personDays: 0,
    upkeepPaid: 0,
    upkeepShortfall: 0,
    spoilage: 0,
    unsupportedDays: 0,
    metrics: economy(env, territory, 250).metrics,
    history: [],
  };
}
function record(
  country: CountryGrowth,
  day: number,
  kind: CountryGrowth['history'][number]['kind'],
  cellId: number | null,
  message: string,
) {
  country.history.push({ day, kind, cellId, message });
  if (country.history.length > 64) country.history.shift();
}
export function validateCountryGeography(state: SimulationState, env: SettlementEnvironment): void {
  const country = state.country;
  if (!country) return;
  if (
    state.worldKey !== env.worldKey ||
    [...country.territory.cells, ...country.initialCells].some((id) => !claimableLand(env, id))
  )
    throw new Error('Country claims are outside valid land; saved data has been preserved.');
  const distances = routes(env, country.territory);
  if (distances.size !== country.territory.cells.length)
    throw new Error('Country claims are disconnected; saved data has been preserved.');
  for (const d of state.ai!.decisions)
    if (d.goal === 'expand') {
      const site = frontier(env, country.territory, distances, []).find((site) => site.id === d.targetCellId);
      if (
        !site ||
        d.reservedFood !== countryClaimCost(env, site.id, site.d) ||
        state.settlements!.centers[0].prospectDays >= claimDuration(env, site.d)
      )
        throw new Error('Invalid country claim project; saved data has been preserved.');
    }
}
/** One daily transaction over the same authoritative state used by workers and tests. */
export function advanceCountryGrowth(
  state: SimulationState,
  env: SettlementEnvironment,
  others: readonly CountryTerritory[] = [],
): void {
  validateCountryGeography(state, env);
  const country = state.country!,
    sim = state.settlements!,
    c = sim.centers[0],
    ai = state.ai!,
    region = country.territory;
  if (others.some((other) => other.cells.some((id) => region.cells.includes(id))))
    throw new Error('Country ownership overlaps another country.');
  c.collected = 0;
  c.consumed = 0;
  c.shortfall = 0;
  c.workingCells = [];
  c.territoryLastWorked = [state.elapsedDays];
  if (c.population === 0) {
    country.metrics = emptyMetrics();
    return;
  }
  const before = c.population,
    base = economy(env, region, before),
    crisis = c.food < before * 7 || base.collected < before + base.metrics.upkeepDue;
  const candidates: CountryCandidate[] = [
    {
      goal: 'consolidate',
      targetCellId: null,
      score: crisis ? 70 : c.food < before * ai.profile.reserveDays ? 65 : 35,
      eligible: true,
      reason: crisis
        ? 'Food or territorial support is tight; concentrate labor on subsistence.'
        : 'Maintain the capital and build food reserves before another claim.',
      reservedFood: 0,
      reservedPeople: 0,
    },
  ];
  const ranked = frontier(env, region, base.paths, others).sort(
    (a, b) =>
      foodRate(env, b.id, b.d) * 10 +
        b.neighbors * 8 -
        b.d / 40 -
        (foodRate(env, a.id, a.d) * 10 + a.neighbors * 8 - a.d / 40) || a.id - b.id,
  );
  const active = ai.decisions[0]?.targetCellId;
  const activeSite = ranked.find((site) => site.id === active);
  const options = ranked.slice(0, 3);
  if (activeSite && !options.some((s) => s.id === activeSite.id)) options.push(activeSite);
  for (const site of options) {
    const expanded = { ...region, cells: [...region.cells, site.id] },
      forecast = economy(env, expanded, before),
      during = economy(env, region, before, 12);
    const cost = countryClaimCost(env, site.id, site.d),
      duration = claimDuration(env, site.d);
    const rescue =
      crisis &&
      forecast.collected - forecast.metrics.upkeepDue >= before &&
      forecast.collected - forecast.metrics.upkeepDue > base.collected - base.metrics.upkeepDue + before * 0.15;
    // The profile reserve funds a new project. Once committed, protect the safety
    // reserve and remaining work; expected spending or a birth must not restart it.
    const reserveDays = rescue || active === site.id ? 7 : ai.profile.reserveDays;
    const remainingDays = duration - (active === site.id ? c.prospectDays : 0);
    const projectedDeficit = Math.max(0, before + during.metrics.upkeepDue - during.collected) * remainingDays;
    const labor =
      forecast.metrics.supportRequired <= Math.floor(base.metrics.workforce * 0.25) &&
      during.metrics.claimWorkers === 12;
    const funded = c.food >= cost + before * reserveDays + projectedDeficit;
    const sustainable = forecast.collected >= before + forecast.metrics.upkeepDue;
    const eligible = labor && funded && sustainable && (!crisis || rescue);
    const reason = !labor
      ? 'Territorial support would take too much of the available workforce.'
      : !sustainable
        ? 'This land would cost more food to support than the country can produce.'
        : !funded
          ? 'Food reserves cannot yet cover claim supplies, the work period and the reserve target.'
          : crisis && !rescue
            ? 'This claim would not restore an affordable food supply during the shortage.'
            : rescue
              ? 'A provisioned neighboring claim can restore food access without exhausting reserves.'
              : 'Food and available workers can support this neighboring claim and its ongoing upkeep.';
    candidates.push({
      goal: 'expand',
      targetCellId: site.id,
      score: Math.max(
        0,
        Math.min(
          100,
          Math.round(
            (rescue ? 85 : 45) +
              ai.profile.expansion * 0.3 +
              Math.min(15, (before / Math.max(1, base.metrics.foodCapacity)) * 15) +
              site.neighbors * 2 -
              site.d / 100,
          ),
        ),
      ),
      eligible,
      reason,
      reservedFood: cost,
      reservedPeople: 12,
    });
  }
  if (!options.length)
    candidates.push({
      goal: 'expand',
      targetCellId: null,
      score: 0,
      eligible: false,
      reason: 'No adjacent unclaimed land is reachable from this country.',
      reservedFood: 0,
      reservedPeople: 0,
    });
  const previous = ai.decisions[0];
  const decision = chooseCountryIntent(ai, c.id, state.elapsedDays, candidates, crisis, ['consolidate', 'expand']);
  if (previous?.goal !== decision.goal || previous.targetCellId !== decision.targetCellId) {
    c.prospectDays = 0;
    c.prospectCellId = null;
  }
  const daily = economy(env, region, before, decision.goal === 'expand' ? 12 : 0);
  country.metrics = daily.metrics;
  const m = country.metrics;
  c.workingCells = daily.workingCells;
  c.collected = daily.collected;
  country.personDays += before;
  sim.totalCollected += c.collected;
  c.food += c.collected;
  c.consumed = Math.min(before, c.food);
  c.food -= c.consumed;
  c.shortfall = before - c.consumed;
  sim.totalConsumed += c.consumed;
  sim.totalShortfall += c.shortfall;
  m.upkeepPaid = Math.min(c.food, m.upkeepDue);
  c.food -= m.upkeepPaid;
  m.upkeepShortfall = m.upkeepDue - m.upkeepPaid;
  country.upkeepPaid += m.upkeepPaid;
  country.upkeepShortfall += m.upkeepShortfall;
  country.deathRemainder += before * 2;
  m.naturalDeaths = Math.floor(country.deathRemainder / 36000);
  country.deathRemainder %= 36000;
  country.hungerRemainder += c.shortfall;
  m.starvationDeaths = Math.min(before - m.naturalDeaths, Math.floor(country.hungerRemainder / 30));
  country.hungerRemainder %= 30;
  const healthy =
    !c.shortfall &&
    !m.upkeepShortfall &&
    m.supportWorkers === m.supportRequired &&
    daily.collected >= before + m.upkeepDue &&
    c.food >= before * 30;
  if (healthy) {
    country.birthRemainder += before * 4;
    m.births = Math.floor(country.birthRemainder / 36000);
    country.birthRemainder %= 36000;
  }
  country.births += m.births;
  country.naturalDeaths += m.naturalDeaths;
  country.starvationDeaths += m.starvationDeaths;
  c.population = before + m.births - m.naturalDeaths - m.starvationDeaths;
  state.tribe.population = c.population;
  c.prosperousDays = healthy ? c.prosperousDays + 1 : 0;
  if (c.prosperousDays >= 60) c.kind = 'settlement';
  const spoiled = Math.ceil(Math.max(0, c.food - c.population * 120) * 0.005);
  c.food -= spoiled;
  country.spoilage += spoiled;
  c.decision = decision.reason;
  if (c.population === 0) {
    country.claimsReleased += region.cells.length;
    region.cells = [];
    c.workingCells = [];
    c.prospectDays = 0;
    c.prospectCellId = null;
    c.decision = 'The population has died out; the country no longer maintains any claims.';
    completeCountryIntent(ai, c.id, state.elapsedDays, c.decision);
    record(country, state.elapsedDays, 'collapsed', null, c.decision);
    return;
  }
  // Funded crews may temporarily draw reserves; evaluate continuing support
  // without that crew so completing a viable project does not cause retreat.
  const foodDeficit = base.collected < before + base.metrics.upkeepDue;
  const unsupported =
    foodDeficit || c.shortfall > 0 || m.upkeepShortfall > 0 || m.supportRequired > Math.floor(m.workforce * 0.25);
  country.unsupportedDays = unsupported ? country.unsupportedDays + 1 : 0;
  if (decision.goal === 'expand') {
    const site = options.find((site) => site.id === decision.targetCellId)!;
    if (c.food < decision.reservedFood + c.population * 7 || c.population <= 12 || c.shortfall || m.upkeepShortfall) {
      c.prospectDays = 0;
      c.prospectCellId = null;
      c.decision = 'Claim work cancelled to protect food and surviving people.';
      completeCountryIntent(ai, c.id, state.elapsedDays, c.decision);
    } else {
      c.prospectCellId = site.id;
      c.prospectDays++;
      if (c.prospectDays >= claimDuration(env, site.d)) {
        if (addCountryClaim(region, site.id, env.width, env.height, others)) {
          c.food -= decision.reservedFood;
          sim.establishmentSpent += decision.reservedFood;
          country.claimsAdded++;
          c.decision = 'Claimed neighboring land after paid preparation; its support costs begin next day.';
          record(country, state.elapsedDays, 'claimed', site.id, c.decision);
        }
        c.prospectDays = 0;
        c.prospectCellId = null;
        completeCountryIntent(ai, c.id, state.elapsedDays, c.decision);
      }
    }
  } else {
    c.prospectDays = 0;
    c.prospectCellId = null;
  }
  if (country.unsupportedDays >= 30 && region.cells.length > 1 && decision.goal !== 'expand') {
    const candidates = [...base.paths]
      .filter(([id]) => id !== region.capitalCellId)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 8)
      .flatMap(([id, d]) => {
        const reduced = { ...region, cells: [...region.cells] };
        if (!releaseCountryClaim(reduced, id, env.width, env.height)) return [];
        const forecast = economy(env, reduced, before),
          improvement = forecast.collected - forecast.metrics.upkeepDue - (base.collected - base.metrics.upkeepDue);
        return improvement > 0 ||
          c.shortfall > 0 ||
          m.upkeepShortfall > 0 ||
          m.supportRequired > Math.floor(m.workforce * 0.25)
          ? [{ id, d, improvement }]
          : [];
      })
      .sort((a, b) => b.improvement - a.improvement || b.d - a.d || a.id - b.id);
    for (const { id } of candidates)
      if (releaseCountryClaim(region, id, env.width, env.height)) {
        country.claimsReleased++;
        country.unsupportedDays = 0;
        c.workingCells = c.workingCells.filter((cell) => region.cells.includes(cell));
        c.decision =
          'Released an outer claim after sustained food or labor strain; remaining claims stay connected to the capital.';
        record(country, state.elapsedDays, 'released', id, c.decision);
        c.prospectDays = 0;
        c.prospectCellId = null;
        completeCountryIntent(ai, c.id, state.elapsedDays, c.decision);
        break;
      }
  }
}
