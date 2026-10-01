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
  if (problems.length) throw new Error(`Invalid simulation tunables: ${problems.join('; ')}.`);
}
