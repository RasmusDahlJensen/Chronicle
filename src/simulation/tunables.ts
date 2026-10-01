import type { WorldBiome } from '../../shared/generated-world.ts';

/**
 * Every tunable simulation number (VISION.md rule 5). Values are starting points recorded in the active brief;
 * acceptance thresholds live in tests and briefs, never here. `validateTunables` runs before any simulation starts.
 */
export const REGION_TUNING = {
  /** Region area range (VISION.md: 20,000–60,000 km²) and the spacing target between region seeds. */
  minAreaKm2: 20_000, maxAreaKm2: 60_000, targetAreaKm2: 38_000,
  /** Poisson-disk seed spacing as a fraction of √target area. */
  seedSpacing: 0.9,
  /** Seeds are tried in order of a weighted random key; weight = 1 + fertility/100 × fertilityWeight + water bonus. */
  fertilityWeight: 3, waterWeight: 2,
  /** Movement cost per km by biome; mountains and deserts become natural borders. */
  terrainCost: {
    grassland: 1, savanna: 1, steppe: 1.1, forest: 1.6, boreal: 1.6, rainforest: 2.2, wetland: 2.2,
    tundra: 1.5, desert: 2.5, mountain: 4, snow: 6, ocean: 0, coast: 0, seaIce: 0, lake: 0, lakeIce: 0,
  } satisfies Record<WorldBiome, number>,
  /** River tiers by runoff index on a river cell (measured distribution recorded in docs/features/m0.md). */
  riverTierRunoff: { stream: 5_000, river: 10_000, greatRiver: 40_000 },
  /** Fish sites within this many cells of a region's coast or lakeshore belong to the nearest region. */
  fishReachCells: 2,
  /** Sea crossings between regions are recorded up to this distance (km); longer voyages need Navigation. */
  seaCrossingKm: 900,
  /** Candidate settlement sites kept per region. */
  settlementSites: 5,
  /** Defensibility (0–1) = min(1, relief share × mean neighbour relief ÷ reliefScale + cover share × rough cover). */
  defensibility: { reliefScaleM: 400, relief: 0.6, cover: 0.4, mountainCover: 1, forestCover: 0.4 },
  /** Settlement site score: fertility + river tier × riverTier + mouth + confluence + coast + lakeshore + resource + relief (capped). */
  siteScore: { riverTier: 0.5, mouth: 1, confluence: 0.8, coast: 0.6, lakeshore: 0.6, resource: 0.4, reliefScaleM: 1000, reliefCap: 0.3 },
} as const;

export const CLOCK_TUNING = {
  /** Decision cadence per polity (months), staggered by polity id. */
  decisionMonths: 6,
  /** Culture and religion run yearly, staggered by culture id across months. */
  cultureMonths: 12,
  /** Per-century statistics for the headless study. */
  statsYears: 100,
  /** Live play runs ticks in slices of at most this long before yielding to messages. */
  sliceMs: 40,
} as const;

type LandBiome = Exclude<WorldBiome, 'ocean' | 'coast' | 'seaIce' | 'lake' | 'lakeIce'>;

/**
 * Food from the land (VISION.md "Production"). Each method's labour capacity L (people who can usefully work it) and
 * yield p (food per worker-year when labour is scarce) are derived per region; output = p × L × (1 − e^(−workers/L)).
 * One food unit is one person-year. Densities are people per km² of labour capacity at fertility 100 (foraging) or
 * at full game (hunting); fishing capacity is per shore cell, scaled by the cell's edge length.
 */
export const FOOD_TUNING = {
  forageDensity: { grassland: 0.09, savanna: 0.1, steppe: 0.05, forest: 0.08, boreal: 0.05, rainforest: 0.09, wetland: 0.1, tundra: 0.02, desert: 0.01, mountain: 0.02, snow: 0 } satisfies Record<LandBiome, number>,
  /** Foraging labour scales with fertility between this floor and 1. */
  forageFertilityFloor: 0.3,
  huntDensity: { grassland: 0.05, savanna: 0.06, steppe: 0.05, forest: 0.05, boreal: 0.04, rainforest: 0.03, wetland: 0.04, tundra: 0.03, desert: 0.005, mountain: 0.02, snow: 0 } satisfies Record<LandBiome, number>,
  /** Labour added by each usable game or fish site. */
  gameSiteLabor: 250, fishSiteLabor: 400,
  /** Fishing labour per shore cell of a 973 km² cell (scaled by edge length), and per river cell by tier (stream, river, great river). */
  fishCoastLabor: 80, fishLakeLabor: 60, fishRiverLabor: [0, 15, 30, 60] as readonly number[],
  /** Fishing grounds reach beyond the shore cells: base labour for a region with a coast, open-lake access or a river (by tier). */
  fishRegionCoast: 500, fishRegionLake: 400, fishRegionRiver: [0, 0, 300, 600] as readonly number[],
  yield: { forage: 1.45, hunt: 1.75, fish: 2, herd: 0, farm: 0 },
  /** Game multiplies hunting fully and foraging down to this floor. */
  forageGameFloor: 0.6,
  /** Game stock per year: dG = regrowth × G(1 − G) + seeding × (1 − G) − harvest × effort × G (effort: workers ÷ capacity of hunting and 0.3 × foraging). */
  gameRegrowth: 0.05, gameSeeding: 0.008, gameHarvest: 0.08, forageEffortShare: 0.3, gameFloor: 0.02,
  /** Food is counted in integer units of 1/100 of a person-month, so stores balance exactly. */
  unitsPerPersonMonth: 100,
  /** Shore-cell fishing labour is given for cells of this area and scales with cell edge length. */
  referenceCellKm2: 973,
} as const;

/** Births and deaths per year as functions of food security (stored + expected food ÷ annual need). */
export const POPULATION_TUNING = {
  birthRate: 0.035, birthSlope: 0.015, deathRate: 0.035,
  /** Food security above 1 raises births and below 1 lowers them, saturating this far from 1. */
  securitySpan: 0.8,
  /** Extra famine deaths per year: famineDeaths × √(1 − food security) below full security. Small shortfalls already
   *  kill the weakest, so populations cannot linger above what the land feeds; large ones saturate. */
  famineDeaths: 1.5,
  /** Months of food a band can store before Pottery, and the share of the store that perishes each month. */
  storeMonths: 1, storeSpoilage: 0.25,
} as const;

/** Band movement and fission (VISION.md "Band movement and fission"); every trigger is graded. */
export const BAND_TUNING = {
  /** Bands decide on moves and splits once per this many months, staggered by band id. */
  decisionMonths: 12,
  splitSize: 350, splitShare: 0.4,
  /** Split desire = sizeWeight × size factor + pressureWeight × land pressure; the size factor rises from splitFrom × splitSize over splitSpan × splitSize. */
  splitFrom: 0.6, splitSpan: 0.5, splitSizeWeight: 0.7, splitPressureWeight: 0.3,
  splitRate: 0.8,
  /** A split picks among this many best free neighbours, weighted by score^choiceSharpness (moves likewise by desire). */
  splitCandidates: 3, choiceSharpness: 2,
  /** No yearly move or split chance exceeds this. */
  maxChance: 0.95,
  /** Food per person below this is treated as this when comparing land (avoids dividing by nothing). */
  minFoodPerPerson: 0.05,
  /** Move chance = desire × moveRate × (pushBase + (1 − pushBase) × max(land pressure, game depletion)). */
  pushBase: 0.3,
  /** Land pressure rises from this share of capacity and reaches 1 at pressureFull. */
  pressureFrom: 0.6, pressureFull: 1.2,
  /** A move must beat its cost: food per person gained (relative) minus a base cost and river crossing costs. */
  moveCost: 0.15, riverCrossingCost: [0, 0, 0.1, 0.35] as readonly number[],
  moveRate: 1.5,
  /** Causes weaker than this are not recorded on an event. */
  minCause: 0.05,
} as const;

export const SPAWN_TUNING = {
  bands: 30, minPopulation: 50, maxPopulation: 200,
  /** Spawn weight: food capacity × (1 + water bonus) × mild-climate factor (Gaussian around the ideal temperature). */
  waterBonus: 1, idealTemperature: 17, temperatureWidth: 12,
  /** Minimum great-circle distance between starting bands. */
  minSpacingKm: 700,
} as const;

/** Culture values of new cultures (0–1 sliders) and how far a daughter culture's values drift from its parent's. */
export const CULTURE_TUNING = { valueMin: 0.15, valueSpan: 0.7, mutation: 0.1 } as const;

/** Name shapes: a third syllable, an initial consonant cluster, an initial consonant and a final coda, by chance. */
export const NAME_TUNING = { thirdSyllable: 0.3, initialCluster: 0.25, initialConsonant: 0.85, coda: 0.55, minLength: 3, maxLength: 11 } as const;

/** Statistics sampled for the lab's world chart. */
export const SERIES_YEARS = 10;

export function validateTunables() {
  const r = REGION_TUNING;
  const problems: string[] = [];
  if (!(r.minAreaKm2 > 0 && r.minAreaKm2 < r.targetAreaKm2 && r.targetAreaKm2 < r.maxAreaKm2)) problems.push('region areas must satisfy 0 < min < target < max');
  if (r.maxAreaKm2 < 2 * r.minAreaKm2) problems.push('region max area must be at least twice the minimum so splits stay in range');
  if (!(r.seedSpacing > 0 && r.seedSpacing <= 2)) problems.push('seed spacing must be in (0, 2]');
  if (!(r.fertilityWeight >= 0 && r.waterWeight >= 0)) problems.push('seed weights must be non-negative');
  if (!(Number.isInteger(r.settlementSites) && r.settlementSites >= 1)) problems.push('settlement sites must be a positive whole number');
  if (!(r.defensibility.reliefScaleM > 0 && r.siteScore.reliefScaleM > 0)) problems.push('relief scales must be positive');
  for (const [key, value] of [...Object.entries(r.defensibility), ...Object.entries(r.siteScore)]) if (!(value >= 0 && Number.isFinite(value))) problems.push(`region weight ${key} must be finite and non-negative`);
  if (!(CLOCK_TUNING.sliceMs > 0 && Number.isInteger(CLOCK_TUNING.cultureMonths) && CLOCK_TUNING.cultureMonths >= 1)) problems.push('clock slices and culture cadence must be positive');
  for (const [biome, cost] of Object.entries(r.terrainCost)) if (!(cost >= 0 && Number.isFinite(cost))) problems.push(`terrain cost for ${biome} must be finite and non-negative`);
  const tiers = r.riverTierRunoff;
  if (!(tiers.stream > 0 && tiers.stream < tiers.river && tiers.river < tiers.greatRiver)) problems.push('river tiers must increase');
  if (!(Number.isInteger(r.fishReachCells) && r.fishReachCells >= 0)) problems.push('fish reach must be a non-negative integer');
  if (!(r.seaCrossingKm > 0)) problems.push('sea crossing distance must be positive');
  if (!(Number.isInteger(CLOCK_TUNING.decisionMonths) && CLOCK_TUNING.decisionMonths >= 1)) problems.push('decision cadence must be whole months');
  if (!(CLOCK_TUNING.statsYears >= 1)) problems.push('stats cadence must be at least a year');
  const f = FOOD_TUNING;
  for (const table of [f.forageDensity, f.huntDensity]) for (const [biome, value] of Object.entries(table)) if (!(value >= 0)) problems.push(`food density for ${biome} must be non-negative`);
  for (const [method, value] of Object.entries(f.yield)) if (!(value >= 0)) problems.push(`yield for ${method} must be non-negative`);
  if (!(f.forageFertilityFloor >= 0 && f.forageFertilityFloor <= 1 && f.forageGameFloor >= 0 && f.forageGameFloor <= 1)) problems.push('food floors must be within 0–1');
  if (!(f.gameRegrowth > 0 && f.gameHarvest >= 0 && f.gameSeeding >= 0 && f.gameFloor > 0 && f.gameFloor < 1)) problems.push('game dynamics must be positive');
  if (!(Number.isInteger(f.unitsPerPersonMonth) && f.unitsPerPersonMonth >= 1)) problems.push('food units must be whole');
  const p = POPULATION_TUNING;
  if (!(p.birthRate > 0 && p.deathRate > 0 && p.birthSlope >= 0 && p.birthSlope < p.birthRate && p.securitySpan > 0 && p.famineDeaths >= 0)) problems.push('population rates must be positive');
  if (!(p.storeMonths >= 0 && p.storeSpoilage >= 0 && p.storeSpoilage <= 1)) problems.push('store limits must be non-negative and spoilage at most 1');
  const b = BAND_TUNING;
  if (!(b.splitSize > 1 && b.splitShare > 0 && b.splitShare < 1 && b.splitFrom > 0 && b.splitRate >= 0)) problems.push('band split settings are invalid');
  if (!(b.pressureFrom >= 0 && b.pressureFull > b.pressureFrom && b.moveRate >= 0 && b.moveCost >= 0)) problems.push('band movement settings are invalid');
  if (f.fishRiverLabor.length !== 4 || f.fishRegionRiver.length !== 4 || b.riverCrossingCost.length !== 4) problems.push('river tables need one value per river tier (none, stream, river, great river)');
  if (!b.riverCrossingCost.every(cost => cost >= 0 && cost < 1)) problems.push('river crossing costs must be in [0, 1)');
  if (![...f.fishRiverLabor, ...f.fishRegionRiver, f.fishCoastLabor, f.fishLakeLabor, f.fishRegionCoast, f.fishRegionLake, f.gameSiteLabor, f.fishSiteLabor].every(value => value >= 0)) problems.push('fishing and site labour must be non-negative');
  if (!(f.referenceCellKm2 > 0)) problems.push('the reference cell area must be positive');
  if (!(b.minCause >= 0 && b.minCause < 1 && Number.isInteger(b.decisionMonths) && b.decisionMonths >= 1 && Number.isInteger(b.splitCandidates) && b.splitCandidates >= 1)) problems.push('band decision settings are invalid');
  if (!(b.splitSpan > 0 && b.splitSizeWeight >= 0 && b.splitPressureWeight >= 0 && b.choiceSharpness > 0 && b.maxChance > 0 && b.maxChance <= 1 && b.minFoodPerPerson > 0 && b.pushBase >= 0 && b.pushBase <= 1)) problems.push('band choice weights are invalid');
  const c = CULTURE_TUNING;
  if (!(c.valueMin >= 0 && c.valueSpan > 0 && c.valueMin + c.valueSpan <= 1 && c.mutation >= 0)) problems.push('culture value ranges are invalid');
  const n = NAME_TUNING;
  if (![n.thirdSyllable, n.initialCluster, n.initialConsonant, n.coda].every(value => value >= 0 && value <= 1) || !(n.minLength >= 1 && n.maxLength >= n.minLength)) problems.push('name shapes are invalid');
  if (!(Number.isInteger(SERIES_YEARS) && SERIES_YEARS >= 1)) problems.push('the chart series step must be whole years');
  const sp = SPAWN_TUNING;
  if (!(Number.isInteger(sp.bands) && sp.bands >= 1 && sp.minPopulation >= 1 && sp.maxPopulation >= sp.minPopulation && sp.minSpacingKm >= 0)) problems.push('spawn settings are invalid');
  if (!(sp.temperatureWidth > 0 && sp.waterBonus >= 0)) problems.push('spawn weights are invalid');
  if (problems.length) throw new Error(`Invalid simulation tunables: ${problems.join('; ')}.`);
}
