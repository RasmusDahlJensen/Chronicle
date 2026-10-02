import { eraOf, MOBILITY, STARTING_TECHS, TECH_INDEX, TECHS, type Affinity, type Coefficient } from './techs.ts';
import type { Rng } from './rng.ts';
import { RESEARCH_TUNING } from './tunables.ts';

/**
 * A polity's knowledge (VISION.md "Knowledge and technology"): the techs it knows, its one active research target,
 * and what those techs add up to. Multipliers, mobility and era are derived from the known set and recomputed only
 * when it changes.
 */
export interface Knowledge {
  known: Uint8Array;
  /** The active research target (−1 for none) and research points spent per tech; a polity that switches target keeps
   *  what it has put into the old one. */
  target: number; progress: Float64Array;
  /** Why the current target was chosen: its weight factors, for inspection and the discovery's causes. */
  reasons: { factor: string; weight: number }[];
  /** The few strongest candidates at the last choice, with their weights (inspection). */
  candidates: { tech: number; weight: number }[];
  multipliers: Record<Coefficient, number>;
  methods: { herd: boolean; farm: boolean };
  /** Highest mobility level of any known tech (display), and sea reach from the techs that give it: 0 none,
   *  1 coastal crossings (Sailing), 2 any coast (Navigation). Later mobility (rail, flight) never implies sea reach. */
  mobility: number; sea: 0 | 1 | 2; era: number;
  /** Techs whose prerequisites are all known and that are not known yet. */
  available: number[];
}

const COEFFICIENTS: Coefficient[] = ['forageYield', 'huntYield', 'fishYield', 'herdYield', 'farmYield', 'storeMonths', 'spoilage',
  'specialistCap', 'research', 'mortality', 'birthRate', 'reach', 'military', 'tradeRange', 'disease'];
// The graph as indices, read on every research choice.
const REQUIRES = TECHS.map(definition => definition.requires.map(name => TECH_INDEX.get(name)!));
const AFFINITIES = TECHS.map(definition => Object.entries(definition.affinity ?? {}) as [Affinity, number][]);
const FOOD = TECHS.map(definition => definition.tags.includes('food')), ECONOMY = TECHS.map(definition => definition.tags.includes('economy'));

export function startingKnowledge(): Knowledge {
  const known = new Uint8Array(TECHS.length);
  for (const name of STARTING_TECHS) known[TECH_INDEX.get(name)!] = 1;
  return derive({ known, target: -1, progress: new Float64Array(TECHS.length), reasons: [], candidates: [] });
}

/** A daughter inherits what its parent knows, but not the parent's research in progress. */
export function inheritKnowledge(parent: Knowledge): Knowledge {
  return derive({ known: parent.known.slice(), target: -1, progress: new Float64Array(TECHS.length), reasons: [], candidates: [] });
}

function derive(base: Pick<Knowledge, 'known' | 'target' | 'progress' | 'reasons' | 'candidates'>): Knowledge {
  const available: number[] = [];
  for (let index = 0; index < TECHS.length; index++) if (!base.known[index] && REQUIRES[index].every(requirement => base.known[requirement])) available.push(index);
  const multipliers = Object.fromEntries(COEFFICIENTS.map(key => [key, 1])) as Record<Coefficient, number>;
  let mobility = 0, sea: 0 | 1 | 2 = 0, herd = false, farm = false;
  for (let index = 0; index < TECHS.length; index++) {
    if (!base.known[index]) continue;
    const effects = TECHS[index].effects;
    for (const [key, value] of Object.entries(effects.multiply ?? {})) multipliers[key as Coefficient] *= value;
    if (effects.mobility) mobility = Math.max(mobility, MOBILITY.indexOf(effects.mobility));
    if (effects.mobility === 'coastalSailing' && sea < 1) sea = 1;
    if (effects.mobility === 'oceanNavigation') sea = 2;
    if (effects.methods?.includes('herd')) herd = true;
    if (effects.methods?.includes('farm')) farm = true;
  }
  return { ...base, multipliers, methods: { herd, farm }, mobility, sea, era: eraOf(base.known), available };
}

export function knows(knowledge: Knowledge, name: string) { return knowledge.known[TECH_INDEX.get(name) ?? -1] === 1; }

export function learn(knowledge: Knowledge, tech: number): Knowledge {
  const known = knowledge.known.slice(), progress = knowledge.progress.slice();
  known[tech] = 1; progress[tech] = 0;
  return derive({ known, target: -1, progress, reasons: [], candidates: [] });
}

/** Techs whose prerequisites are all known and that are not known yet. */
export function availableTechs(knowledge: Knowledge) { return knowledge.available; }

export interface ResearchContext {
  /** Environment conditions of the polity's land: the share (0–1) of its people living where each holds. */
  affinity: Map<Affinity, number>;
  /** Need for food (0–1): hunger, or land pressure when the land is filling up, whichever is larger. */
  foodNeed: number;
  tradition: number; openness: number;
  /** Exposure (0–1) to each tech through contacted polities that know it, by contact intensity. */
  exposure: (tech: number) => number;
  /** Research points a year, which sets how long a tech would take. */
  rate: number;
  /** Extraction techs for deposits on the polity's land that it knows but cannot work (the `knownUnusable` affinity). */
  blocked: Set<number>;
}

/**
 * Research weight of one tech (VISION.md: need, environment, exposure, culture, and the effort it would take). With
 * `factors`, also records each factor's contribution for inspection and causes.
 */
export function researchWeight(tech: number, context: ResearchContext, factors?: { factor: string; weight: number }[]) {
  const tuning = RESEARCH_TUNING;
  let weight = TECHS[tech].weight;
  const need = Math.max(0, Math.min(1, context.foodNeed));
  if (need > 0 && FOOD[tech]) { const value = 1 + tuning.needWeight * need; weight *= value; factors?.push({ factor: 'foodNeed', weight: value - 1 }); }
  for (const [condition, value] of AFFINITIES[tech]) {
    // Graded by the share of its people on such land: a tribe with one fertile river valley among ten regions is
    // drawn to farming far less than a people that lives on them.
    const share = context.affinity.get(condition) ?? 0;
    if (share > 0) { const factor = 1 + share * (value - 1); weight *= factor; factors?.push({ factor: condition, weight: factor - 1 }); }
  }
  if (context.blocked.has(tech)) { weight *= tuning.blockedWeight; factors?.push({ factor: 'knownUnusable', weight: tuning.blockedWeight - 1 }); }
  const exposure = context.exposure(tech);
  if (exposure > 0) {
    const value = 1 + tuning.exposureWeight * exposure * (tuning.opennessBase + context.openness);
    weight *= value; factors?.push({ factor: 'exposure', weight: value - 1 });
  }
  // Effort: people work on what they can finish; a tech that would take many lifetimes is rarely chosen.
  const years = researchCost(tech, exposure) / Math.max(context.rate, 1e-9);
  const effort = 1 / (1 + years / tuning.effortYears);
  weight *= effort; factors?.push({ factor: 'effort', weight: -(1 - effort) });
  if (ECONOMY[tech]) {
    const value = 1 - tuning.traditionBrake * context.tradition;
    weight *= value; factors?.push({ factor: 'tradition', weight: -(1 - value) });
  }
  return weight;
}

/**
 * Pick the target by weighted random among the available techs (VISION.md "Research"). With a target already set,
 * the polity reconsiders only when some option now weighs `switchRatio` times its current target (new exposure,
 * hunger); research already put into any tech is kept. The strongest candidates are kept for inspection either way.
 */
export function chooseTarget(knowledge: Knowledge, context: ResearchContext, rng: Rng) {
  const options = knowledge.available;
  if (!options.length) { knowledge.target = -1; knowledge.candidates = []; return; }
  const weights = options.map(tech => researchWeight(tech, context));
  knowledge.candidates = options.map((tech, at) => ({ tech, weight: Math.round(weights[at] * 1000) / 1000 }))
    .sort((a, b) => b.weight - a.weight || a.tech - b.tech).slice(0, 5);
  const current = knowledge.target >= 0 ? options.indexOf(knowledge.target) : -1;
  if (current >= 0 && !weights.some(weight => weight >= RESEARCH_TUNING.switchRatio * weights[current])) return;
  const pick = Math.max(0, rng.weighted(weights));
  const factors: { factor: string; weight: number }[] = [];
  researchWeight(options[pick], context, factors);
  knowledge.target = options[pick];
  knowledge.reasons = factors.filter(entry => Math.abs(entry.weight) >= RESEARCH_TUNING.reasonMin).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, RESEARCH_TUNING.reasonCount + 1)
    .map(entry => ({ factor: entry.factor, weight: Math.round(entry.weight * 1000) / 1000 }));
}

/** Research points still needed for the current target at this exposure (0 or less: learned). */
export function remaining(knowledge: Knowledge, exposure: number) {
  return knowledge.target < 0 ? Number.POSITIVE_INFINITY : researchCost(knowledge.target, exposure) - knowledge.progress[knowledge.target];
}

/** Cost of a tech for this polity: contact with polities that know it makes it much cheaper (diffusion). */
export function researchCost(tech: number, exposure: number) {
  return TECHS[tech].cost * (1 - RESEARCH_TUNING.exposureDiscount * Math.min(1, exposure));
}
