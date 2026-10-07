import type { PolityView } from '../perception.ts';
import { BUILD_TUNING } from '../tunables.ts';
import { MULTIPLIER, type Option } from './options.ts';

/**
 * The Build action (VISION.md "Buildings": "Polities choose what to build through the Build action of the decision
 * model, driven by needs"). Pure: it sees only the civilization's view. Each building type it knows is weighed by how
 * much its settlements need what the building is for, against the cost of building it where it is needed most and the
 * upkeep it would add.
 */
type Facts = PolityView['build']['settlements'][number];
type Kind = PolityView['build']['catalog'][number];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/** What the realm can spend on building (VISION.md "Wealth": what it can afford is its income after costs): its
 *  surplus a year at customary taxes, and a share of its treasury. */
const spendable = (budget: PolityView['budget']) => Math.max(1, Math.max(0, budget.surplus) + budget.treasury / BUILD_TUNING.treasuryYears);
/** What new upkeep would eat into: that surplus, but no less than a small share of the revenue (a realm already
 *  short weighs new upkeep heavily). */
const headroom = (budget: PolityView['budget']) => Math.max(1, BUILD_TUNING.surplusFloor * budget.revenue, budget.surplus);

/** The values that weigh its building: its people's, with Zeal faded by the secular age (VISION.md "Secular age"). */
const valuesOf = (view: PolityView) => view.build.piety === 1 ? view.values : { ...view.values, zeal: view.values.zeal * view.build.piety };

/** What a need is called when it is cited as a cause, by the purpose that answers it. */
export const NEED_OF: Record<string, string> = { food: 'hardship', faith: 'instability', learning: 'learning', trade: 'commerce', housing: 'crowding', defense: 'frontier', mining: 'deposits', sea: 'seaReach', farming: 'farming' };

/**
 * The needs a building of this purpose answers in one settlement, by name (each 0–1 before its size, summing to at
 * most 1), given the civilization's values: what the decision cites. Food has two: hard years (hardship) and farmers'
 * storage; so has farming: the fields themselves and hard years; and faith: the region's instability, and the piety
 * (Zeal) that makes a people answer it with shrines and temples; the other purposes one each.
 */
export function needParts(purpose: string, settlement: Facts, values: PolityView['values']): Record<string, number> {
  if (purpose === 'faith') {
    const total = need(purpose, settlement, values), share = BUILD_TUNING.faithBase + values.zeal;
    return { instability: share > 0 ? total * BUILD_TUNING.faithBase / share : 0, piety: share > 0 ? total * values.zeal / share : 0 };
  }
  if (purpose === 'farming') {
    const farming = Math.min(1, BUILD_TUNING.irrigationBase * settlement.farmShare);
    return { farming, hardship: Math.min(1 - farming, settlement.hardship * settlement.farmShare) };
  }
  if (purpose !== 'food') return { [NEED_OF[purpose] ?? purpose]: need(purpose, settlement, values) };
  const hardship = clamp01(settlement.hardship), storage = Math.min(1 - hardship, BUILD_TUNING.farmStore * settlement.farmShare);
  return { hardship, storage };
}

/** How much one settlement needs a building of this purpose (0–1, before its size), given the civilization's values. */
export function need(purpose: string, settlement: Facts, values: PolityView['values']) {
  const tuning = BUILD_TUNING;
  switch (purpose) {
    case 'food': return clamp01(settlement.hardship + tuning.farmStore * settlement.farmShare);
    case 'faith': return clamp01((1 - settlement.stability) * (tuning.faithBase + values.zeal));
    case 'learning': return clamp01(tuning.learningBase + values.openness);
    case 'trade': return clamp01(tuning.tradeBase + tuning.tradeOpenness * values.openness);
    case 'housing': return settlement.housing > 0 ? clamp01((settlement.urban / settlement.housing - tuning.crowdFrom) / (1 - tuning.crowdFrom)) : 0;
    case 'defense': return clamp01(settlement.frontier / tuning.frontierScale) * clamp01(tuning.defenseBase + values.militarism);
    case 'sea': return settlement.coast ? clamp01(settlement.seaLinks / tuning.seaScale) * clamp01(tuning.seaBase + (values.openness + values.expansionism) / 2) : 0;
    case 'farming': return clamp01(settlement.farmShare * (tuning.irrigationBase + settlement.hardship));
    default: return 0;
  }
}

/** What a mine or quarry would earn in this settlement's region, as a need (0–1); other buildings need their purpose. */
function needFor(kind: Kind, settlement: Facts, values: PolityView['values']) {
  if (kind.works) return clamp01((kind.works === 'mineral' ? settlement.mineYield : settlement.quarryYield) / BUILD_TUNING.mineScale);
  if ((kind.coast && !settlement.coast) || (kind.water && !settlement.water)) return 0;
  return need(kind.purpose, settlement, values);
}

/** How much a settlement's size counts for this building: mines and quarries are worth their sites whatever its size,
 *  irrigation serves the region's farmers, other buildings its townspeople. */
function sizeFor(kind: Kind, settlement: Facts) {
  if (kind.works) return 1;
  if (kind.purpose === 'farming') return Math.min(1, settlement.farmers / BUILD_TUNING.farmScale);
  return Math.min(1, settlement.urban / BUILD_TUNING.sizeScale);
}

/** One building type's option: where it is needed most (at most a batch of settlements), and its score. */
export function buildScore(view: PolityView, kind: Kind): Option & { targets: number[] } {
  const tuning = BUILD_TUNING, build = view.build;
  const batch = Math.min(tuning.batchMax, Math.max(1, Math.ceil(build.regions / tuning.batchRegions)));
  const regions = new Set<number>();
  const ranked = build.settlements.filter(settlement => settlement.tier >= kind.minTier && !settlement.has.includes(kind.type))
    .map(settlement => ({ settlement, value: needFor(kind, settlement, valuesOf(view)) * sizeFor(kind, settlement) }))
    .filter(entry => entry.value > 0).sort((a, b) => b.value - a.value || a.settlement.id - b.settlement.id)
    // One a region needs only one of: the best settlement in each region.
    .filter(entry => !kind.perRegion || (!regions.has(entry.settlement.region) && regions.add(entry.settlement.region) !== undefined)).slice(0, batch);
  const weight = (tuning.purposeWeight as Record<string, number>)[kind.purpose] ?? 0;
  const worth = ranked.length ? ranked.reduce((sum, entry) => sum + entry.value, 0) / ranked.length : 0;
  // A state religion of Monument builders raises shrines and temples (VISION.md "Tenets").
  const benefit = weight * worth * (kind.purpose === 'faith' ? view.build.monuments : 1);
  // Each need's share of the benefit (what a completed building will cite): food splits into hard years and storage.
  const parts = new Map<string, number>();
  for (const { settlement } of ranked) {
    const size = sizeFor(kind, settlement);
    if (kind.works) parts.set(NEED_OF[kind.purpose], (parts.get(NEED_OF[kind.purpose]) ?? 0) + needFor(kind, settlement, valuesOf(view)));
    else for (const [name, value] of Object.entries(needParts(kind.purpose, settlement, valuesOf(view)))) parts.set(name, (parts.get(name) ?? 0) + value * size);
  }
  const cost = tuning.cost * kind.cost * ranked.length / spendable(view.budget);
  const upkeep = tuning.upkeepWeight * kind.upkeep * ranked.length / headroom(view.budget);
  const label = ranked.length === 1 ? `${kind.one} at ${ranked[0].settlement.name}` : `${kind.many} in ${ranked.length} settlements`;
  const needs = [...parts].map(([factor, total]) => ({ factor, weight: round(weight * total / Math.max(1, ranked.length)) }));
  return {
    action: 'build', score: ranked.length ? benefit - cost - upkeep : Number.NEGATIVE_INFINITY, target: kind.type, label, targets: ranked.map(entry => entry.settlement.id),
    factors: [...(needs.length ? needs : [{ factor: NEED_OF[kind.purpose] ?? kind.purpose, weight: 0 }]), { factor: 'cost', weight: -round(cost) }, { factor: 'upkeep', weight: -round(upkeep) }],
  };
}

/** The building type it would build now, or none. */
export function bestBuild(view: PolityView): (Option & { targets: number[] }) | null {
  let best: (Option & { targets: number[] }) | null = null;
  for (const kind of view.build.catalog) {
    const option = buildScore(view, kind);
    if (!best || option.score > best.score) best = option;
  }
  return best;
}

/** What drives a people to a wonder of this motive: piety (Zeal), ambition (Expansionism) or learning (Openness). */
const MOTIVE_VALUE: Record<string, keyof PolityView['values']> = { piety: 'zeal', ambition: 'expansionism', learning: 'openness' };

/**
 * The wonder it would begin now, if any (VISION.md "Wonders": a large surplus and a motive — a pious, ambitious or
 * learned people in a golden age of stability), in its largest city that can hold it. One at a time.
 */
export function bestWonder(view: PolityView): (Option & { targets: number[] }) | null {
  const tuning = BUILD_TUNING, build = view.build;
  const golden = clamp01((build.stability - tuning.goldenFrom) / (1 - tuning.goldenFrom));
  let best: (Option & { targets: number[] }) | null = null;
  for (const wonder of build.wonders) {
    const city = build.settlements.filter(settlement => settlement.tier >= wonder.minTier && !settlement.wonder && (!wonder.coast || settlement.coast))
      .sort((a, b) => b.urban - a.urban || a.id - b.id)[0];
    if (!city) continue;
    const motive = valuesOf(view)[MOTIVE_VALUE[wonder.motive] ?? 'zeal'], greatness = Math.min(1, city.urban / tuning.wonderCity);
    // The motive is what it cites; the golden age and the city's greatness scale it (multipliers, never causes).
    const drive = tuning.wonderWeight * motive * golden * greatness * view.build.monuments;
    // A wonder is paid for over decades: what it would take each year while it is built weighs against what the realm
    // can spend in a year.
    const cost = tuning.cost * wonder.cost * 12 / wonder.months / spendable(view.budget), upkeep = tuning.upkeepWeight * wonder.upkeep / headroom(view.budget);
    const option = {
      action: 'build' as const, score: drive - cost - upkeep, target: wonder.type, label: `${wonder.name} at ${city.name}`, targets: [city.id], wonder: true,
      factors: [
        { factor: wonder.motive, weight: round(drive) }, { factor: `${MULTIPLIER}goldenAge`, weight: round(golden) }, { factor: `${MULTIPLIER}greatness`, weight: round(greatness) },
        ...(view.build.monuments !== 1 ? [{ factor: `${MULTIPLIER}monumentBuilders`, weight: round(view.build.monuments) }] : []),
        { factor: 'cost', weight: -round(cost) }, { factor: 'upkeep', weight: -round(upkeep) },
      ],
    };
    if (!best || option.score > best.score) best = option;
  }
  return best;
}

/**
 * The roads it would build now (VISION.md "Roads": the capital to its towns and cities, along the cheapest route): the
 * towns and cities its roads do not yet reach at the best tier it knows, the largest and farthest first (at most a
 * batch, as for buildings). Each needs connection (more for an open people) and more the farther it lies from the
 * capital, against the cost and upkeep.
 */
export function bestRoad(view: PolityView): (Option & { targets: number[] }) | null {
  const tuning = BUILD_TUNING, build = view.build, roads = build.roads;
  if (!roads.tier || !roads.routes.length) return null;
  const batch = Math.min(tuning.batchMax, Math.max(1, Math.ceil(build.regions / tuning.batchRegions)));
  const connection = tuning.roadBase + tuning.roadOpenness * view.values.openness;
  const ranked = roads.routes.map(route => {
    const remoteness = tuning.roadReach * Math.min(1, route.km / Math.max(1, view.reachKm)), size = Math.min(1, route.urban / tuning.sizeScale);
    const need = Math.min(1, connection + remoteness);
    // Each part's share of the need, as cited.
    return { route, value: need * size, connection: need * size * connection / (connection + remoteness || 1), remoteness: need * size * remoteness / (connection + remoteness || 1) };
  }).sort((a, b) => b.value - a.value || a.route.settlement - b.route.settlement).slice(0, batch);
  const weight = tuning.purposeWeight.roads, count = ranked.length;
  const mean = (key: 'value' | 'connection' | 'remoteness') => ranked.reduce((sum, entry) => sum + entry[key], 0) / count;
  const cost = tuning.cost * ranked.reduce((sum, entry) => sum + entry.route.cost, 0) / spendable(view.budget);
  const upkeep = tuning.upkeepWeight * ranked.reduce((sum, entry) => sum + entry.route.upkeep, 0) / headroom(view.budget);
  return {
    action: 'build', road: true, score: weight * mean('value') - cost - upkeep, target: roads.tier, targets: ranked.map(entry => entry.route.settlement),
    label: count === 1 ? `${roads.one} to ${ranked[0].route.name}` : `${roads.many} to ${count} towns`,
    factors: [
      { factor: 'connection', weight: round(weight * mean('connection')) }, { factor: 'remoteness', weight: round(weight * mean('remoteness')) },
      { factor: 'cost', weight: -round(cost) }, { factor: 'upkeep', weight: -round(upkeep) },
    ],
  };
}
