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
  const ranked = build.settlements.filter(settlement => settlement.tier >= kind.minTier && !settlement.has.includes(kind.type))
    // Mines and quarries are worth what their sites give, whatever the settlement's size; other buildings serve townspeople.
    .map(settlement => ({ settlement, value: needFor(kind, settlement, view.values) * (kind.works ? 1 : Math.min(1, settlement.urban / tuning.sizeScale)) }))
    .filter(entry => entry.value > 0).sort((a, b) => b.value - a.value || a.settlement.id - b.settlement.id).slice(0, batch);
  const income = Math.max(1, build.income);
  const worth = ranked.length ? ranked.reduce((sum, entry) => sum + entry.value, 0) / ranked.length : 0;
  const benefit = ((tuning.purposeWeight as Record<string, number>)[kind.purpose] ?? 0) * worth;
  const cost = tuning.cost * kind.cost * ranked.length / (income + build.wealth / tuning.treasuryYears);
  const upkeep = tuning.upkeepWeight * (build.upkeep + kind.upkeep * ranked.length) / income;
  const label = ranked.length === 1 ? `${kind.name} at ${ranked[0].settlement.name}` : `${kind.name} in ${ranked.length} settlements`;
  return {
    action: 'build', score: ranked.length ? benefit - cost - upkeep : Number.NEGATIVE_INFINITY, target: kind.type, label, targets: ranked.map(entry => entry.settlement.id),
    factors: [{ factor: NEED_OF[kind.purpose] ?? kind.purpose, weight: round(benefit) }, { factor: 'cost', weight: -round(cost) }, { factor: 'upkeep', weight: -round(upkeep) }],
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
