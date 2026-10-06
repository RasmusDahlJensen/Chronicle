import type { PolityView } from '../perception.ts';
import { BUILD_TUNING } from '../tunables.ts';
import type { Option } from './options.ts';

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

/** What a need is called when it is cited as a cause, by the purpose that answers it. */
export const NEED_OF: Record<string, string> = { food: 'hardship', faith: 'unrest', learning: 'learning', trade: 'commerce', housing: 'crowding', defense: 'frontier', mining: 'deposits', sea: 'seaReach' };

/**
 * The needs a building of this purpose answers in one settlement, by name (each 0–1 before its size, summing to at
 * most 1), given the civilization's values: what the decision cites. Food has two: hard years (hardship) and farmers'
 * storage; the other purposes one each.
 */
export function needParts(purpose: string, settlement: Facts, values: PolityView['values']): Record<string, number> {
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
    default: return 0;
  }
}

/** What a mine or quarry would earn in this settlement's region, as a need (0–1); other buildings need their purpose. */
function needFor(kind: Kind, settlement: Facts, values: PolityView['values']) {
  if (kind.works) return clamp01((kind.works === 'mineral' ? settlement.mineYield : settlement.quarryYield) / BUILD_TUNING.mineScale);
  if (kind.coast && !settlement.coast) return 0;
  return need(kind.purpose, settlement, values);
}

/** One building type's option: where it is needed most (at most a batch of settlements), and its score. */
export function buildScore(view: PolityView, kind: Kind): Option & { targets: number[] } {
  const tuning = BUILD_TUNING, build = view.build;
  const batch = Math.min(tuning.batchMax, Math.max(1, Math.ceil(build.regions / tuning.batchRegions)));
  const regions = new Set<number>();
  const ranked = build.settlements.filter(settlement => settlement.tier >= kind.minTier && !settlement.has.includes(kind.type))
    // Mines and quarries are worth what their sites give, whatever the settlement's size; other buildings serve townspeople.
    .map(settlement => ({ settlement, value: needFor(kind, settlement, view.values) * (kind.works ? 1 : Math.min(1, settlement.urban / tuning.sizeScale)) }))
    .filter(entry => entry.value > 0).sort((a, b) => b.value - a.value || a.settlement.id - b.settlement.id)
    // One a region needs only one of: the best settlement in each region.
    .filter(entry => !kind.perRegion || (!regions.has(entry.settlement.region) && regions.add(entry.settlement.region) !== undefined)).slice(0, batch);
  const income = Math.max(1, build.income), weight = (tuning.purposeWeight as Record<string, number>)[kind.purpose] ?? 0;
  const worth = ranked.length ? ranked.reduce((sum, entry) => sum + entry.value, 0) / ranked.length : 0;
  const benefit = weight * worth;
  // Each need's share of the benefit (what a completed building will cite): food splits into hard years and storage.
  const parts = new Map<string, number>();
  for (const { settlement } of ranked) {
    const size = kind.works ? 1 : Math.min(1, settlement.urban / tuning.sizeScale);
    if (kind.works) parts.set(NEED_OF[kind.purpose], (parts.get(NEED_OF[kind.purpose]) ?? 0) + needFor(kind, settlement, view.values));
    else for (const [name, value] of Object.entries(needParts(kind.purpose, settlement, view.values))) parts.set(name, (parts.get(name) ?? 0) + value * size);
  }
  const cost = tuning.cost * kind.cost * ranked.length / (income + build.wealth / tuning.treasuryYears);
  const upkeep = tuning.upkeepWeight * (build.upkeep + kind.upkeep * ranked.length) / income;
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
  const income = Math.max(1, build.income);
  let best: (Option & { targets: number[] }) | null = null;
  for (const wonder of build.wonders) {
    const city = build.settlements.filter(settlement => settlement.tier >= wonder.minTier && !settlement.wonder && (!wonder.coast || settlement.coast))
      .sort((a, b) => b.urban - a.urban || a.id - b.id)[0];
    if (!city) continue;
    const motive = view.values[MOTIVE_VALUE[wonder.motive] ?? 'zeal'], greatness = Math.min(1, city.urban / tuning.wonderCity);
    const parts = { [wonder.motive]: tuning.wonderWeight * motive * golden * greatness };
    const cost = tuning.cost * wonder.cost / (income + build.wealth / tuning.treasuryYears), upkeep = tuning.upkeepWeight * (build.upkeep + wonder.upkeep) / income;
    const option = {
      action: 'build' as const, score: parts[wonder.motive] - cost - upkeep, target: wonder.type, label: `${wonder.name} at ${city.name}`, targets: [city.id], wonder: true,
      factors: [{ factor: wonder.motive, weight: round(parts[wonder.motive]) }, { factor: 'goldenAge', weight: round(golden) }, { factor: 'cost', weight: -round(cost) }, { factor: 'upkeep', weight: -round(upkeep) }],
    };
    if (!best || option.score > best.score) best = option;
  }
  return best;
}
