import { ERAS, eraOf, MOBILITY, STARTING_TECHS, TECH_INDEX, TECHS, type Affinity, type Coefficient } from './techs.ts';
import type { Rng } from './rng.ts';
import { FAITH_TUNING, RESEARCH_TUNING } from './tunables.ts';

/**
 * A polity's knowledge (VISION.md "Knowledge and technology"): the techs it knows, its one active research target,
 * and what those techs add up to. Multipliers, mobility and era are derived from the known set and recomputed only
 * when it changes.
 */
export interface Knowledge {
  known: Uint8Array;
  /** The active research target (−1 for none) and research points per tech; a polity that switches target keeps what
   *  it has put into the old one. Of those points, how many came from a sharing partner's help and how many from
   *  catching up (the rest are its own research). */
  target: number; progress: Float64Array; taught: Float64Array; caught: Float64Array;
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
const FOOD = TECHS.map(definition => definition.tags.includes('food')), ECONOMY = TECHS.map(definition => definition.tags.includes('economy')), RELIGION = TECHS.map(definition => definition.tags.includes('religion'));

const fresh = () => ({ target: -1, progress: new Float64Array(TECHS.length), taught: new Float64Array(TECHS.length), caught: new Float64Array(TECHS.length), reasons: [], candidates: [] });

export function startingKnowledge(): Knowledge {
  const known = new Uint8Array(TECHS.length);
  for (const name of STARTING_TECHS) known[TECH_INDEX.get(name)!] = 1;
  return derive({ known, ...fresh() });
}

/** A daughter inherits what its parent knows, but not the parent's research in progress. */
export function inheritKnowledge(parent: Knowledge): Knowledge {
  return derive({ known: parent.known.slice(), ...fresh() });
}

/**
 * Peoples that become one (a tribe joining, a civilization uniting) bring their knowledge: `into` comes to know
 * whatever either knew (VISION.md "Paths, not a timeline": merging). It keeps its own research in progress, except on
 * techs it now knows; its target is chosen again if it is now known.
 */
export function mergeKnowledge(into: Knowledge, from: Knowledge): Knowledge {
  const known = into.known.slice(), progress = into.progress.slice(), taught = into.taught.slice(), caught = into.caught.slice();
  for (let tech = 0; tech < TECHS.length; tech++) if (from.known[tech] && !known[tech]) { known[tech] = 1; progress[tech] = 0; taught[tech] = 0; caught[tech] = 0; }
  const target = into.target >= 0 && !known[into.target] ? into.target : -1;
  return derive({ known, target, progress, taught, caught, reasons: target >= 0 ? into.reasons : [], candidates: target >= 0 ? into.candidates : [] });
}

/** Techs `from` knows that `into` does not. */
export function newTechs(into: Knowledge, from: Knowledge) {
  let count = 0;
  for (let tech = 0; tech < TECHS.length; tech++) if (from.known[tech] && !into.known[tech]) count++;
  return count;
}

function derive(base: Pick<Knowledge, 'known' | 'target' | 'progress' | 'taught' | 'caught' | 'reasons' | 'candidates'>): Knowledge {
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
  const known = knowledge.known.slice(), progress = knowledge.progress.slice(), taught = knowledge.taught.slice(), caught = knowledge.caught.slice();
  known[tech] = 1; progress[tech] = 0; taught[tech] = 0; caught[tech] = 0;
  return derive({ known, target: -1, progress, taught, caught, reasons: [], candidates: [] });
}

/** Techs whose prerequisites are all known and that are not known yet. */
export function availableTechs(knowledge: Knowledge) { return knowledge.available; }

export interface ResearchContext {
  /** Environment conditions of the polity's land: the share (0–1) of its people living where each holds. */
  affinity: Map<Affinity, number>;
  /** Need for food (0–1): hunger, or land pressure when the land is filling up, whichever is larger. */
  foodNeed: number;
  tradition: number; openness: number;
  /** Its people's Zeal: religion techs weigh more for a zealous people (M4.3), less so in the secular age (its
   *  secularity, 0–1, M4.4). */
  zeal: number; secularity: number;
  /** Whether a people it shares knowledge with knows the tech (VISION.md "Sharing knowledge"). */
  shared: (tech: number) => boolean;
  /** The most advanced era it knows of: its own, or a living people's it has met (catch-up). */
  frontier: number;
  /** Research points a year, which sets how long a tech would take. */
  rate: number;
  /** Extraction techs for deposits on the polity's land that it knows but cannot work (the `knownUnusable` affinity). */
  blocked: Set<number>;
}

const ERA = TECHS.map(definition => ERAS.indexOf(definition.era));

/** How much faster a tech of `era` is researched by a polity whose frontier is `frontier`: a little, for each era behind. */
export function catchUp(era: number, frontier: number) {
  return 1 + RESEARCH_TUNING.catchUpPerEra * Math.min(RESEARCH_TUNING.catchUpEras, Math.max(0, frontier - era));
}

/** How much faster a tech is researched while a sharing partner knows it (Openness raises it). */
export function shareSpeed(openness: number) {
  return 1 + RESEARCH_TUNING.shareSpeed * (RESEARCH_TUNING.opennessBase + openness);
}

/** Both speed-ups for one tech in this context: sharing and catching up (1 when none applies). */
export function speedOf(tech: number, context: Pick<ResearchContext, 'shared' | 'frontier' | 'openness'>) {
  return { share: context.shared(tech) ? shareSpeed(context.openness) : 1, catchUp: catchUp(ERA[tech], context.frontier) };
}

/**
 * Research weight of one tech (VISION.md: need, environment, shared knowledge, culture, and the effort it would take).
 * With `factors`, also records each factor's contribution for inspection and causes.
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
  const speed = speedOf(tech, context);
  if (speed.share > 1) {
    const value = 1 + tuning.shareWeight * (tuning.opennessBase + context.openness);
    weight *= value; factors?.push({ factor: 'sharedKnowledge', weight: value - 1 });
  }
  // Effort: people work on what they can finish; a tech that would take many lifetimes is rarely chosen. Sharing and
  // catching up shorten it.
  const years = TECHS[tech].cost / Math.max(context.rate * speed.share * speed.catchUp, 1e-9);
  const effort = 1 / (1 + years / tuning.effortYears);
  weight *= effort; factors?.push({ factor: 'effort', weight: -(1 - effort) });
  if (ECONOMY[tech]) {
    const value = 1 - tuning.traditionBrake * context.tradition;
    weight *= value; factors?.push({ factor: 'tradition', weight: -(1 - value) });
  }
  if (RELIGION[tech]) {
    const value = 1 + (FAITH_TUNING.religionZealBase + context.zeal - 1) * (1 - context.secularity);
    weight *= value; factors?.push({ factor: 'zeal', weight: value - 1 });
  }
  return weight;
}

/**
 * Pick the target by weighted random among the available techs (VISION.md "Research"). With a target already set,
 * the polity reconsiders only when some option now weighs `switchRatio` times its current target (a new sharing
 * partner, hunger); research already put into any tech is kept. The strongest candidates are kept for inspection either way.
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

/** Research points still needed for the current target (0 or less: learned). */
export function remaining(knowledge: Knowledge) {
  return knowledge.target < 0 ? Number.POSITIVE_INFINITY : TECHS[knowledge.target].cost - knowledge.progress[knowledge.target];
}

/**
 * A month (or any span) of research on the current target: `points` of the polity's own research, sped up by sharing
 * and catching up. Records how much of the progress each speed-up gave, so a discovery can say how it was reached.
 */
export function advance(knowledge: Knowledge, points: number, speed: { share: number; catchUp: number }) {
  const tech = knowledge.target;
  if (tech < 0 || !(points > 0)) return;
  knowledge.progress[tech] += points * speed.share * speed.catchUp;
  knowledge.caught[tech] += points * (speed.catchUp - 1);
  knowledge.taught[tech] += points * speed.catchUp * (speed.share - 1);
}
