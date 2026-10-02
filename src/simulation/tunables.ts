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
  /** A polity's capacity is solved yearly (staggered by id), on arrival, and monthly while its people exceed
   *  `capacityRefresh` × the last solve or its region's game stock has moved more than `capacityGameDrift` since then.
   *  Knowledge only raises capacity, so between solves the cached value is within a few percent of a fresh one and the
   *  1.1× over-capacity check reads the same. */
  capacityRefresh: 1.04, capacityGameDrift: 0.01,
} as const;

type LandBiome = Exclude<WorldBiome, 'ocean' | 'coast' | 'seaIce' | 'lake' | 'lakeIce'>;

/**
 * Food from the land (VISION.md "Production"). Each method's labour capacity L (people who can usefully work it) and
 * yield p (food per worker-year when labour is scarce) are derived per region; output = p × L × (1 − e^(−workers/L)).
 * One food unit is one person-year. Densities are people per km² of labour capacity at fertility 100 (foraging) or
 * at full game (hunting); fishing capacity is per shore cell, scaled by the cell's edge length.
 */
export const FOOD_TUNING = {
  forageDensity: { grassland: 0.04, savanna: 0.045, steppe: 0.0225, forest: 0.036, boreal: 0.0225, rainforest: 0.04, wetland: 0.045, tundra: 0.009, desert: 0.0045, mountain: 0.009, snow: 0 } satisfies Record<LandBiome, number>,
  /** Foraging labour scales with fertility between this floor and 1. */
  forageFertilityFloor: 0.3,
  huntDensity: { grassland: 0.0225, savanna: 0.027, steppe: 0.0225, forest: 0.0225, boreal: 0.018, rainforest: 0.0135, wetland: 0.018, tundra: 0.0135, desert: 0.00225, mountain: 0.009, snow: 0 } satisfies Record<LandBiome, number>,
  /** Labour added by each usable game or fish site. */
  gameSiteLabor: 112, fishSiteLabor: 180,
  /** Fishing labour per shore cell of a 973 km² cell (scaled by edge length), and per river cell by tier (stream, river, great river). */
  fishCoastLabor: 36, fishLakeLabor: 27, fishRiverLabor: [0, 6.75, 13.5, 27] as readonly number[],
  /** Fishing grounds reach beyond the shore cells: base labour for a region with a coast, open-lake access or a river (by tier). */
  fishRegionCoast: 225, fishRegionLake: 180, fishRegionRiver: [0, 0, 135, 270] as readonly number[],
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
  birthRate: 0.035, birthSlope: 0.03, deathRate: 0.035,
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
  /**
   * Breaking away (VISION.md, changed at the M2 review): a band that splits off stays in its tribe unless it breaks
   * away, with chance 1 − e^(−s × c), s = (distance from the core band ÷ reachKm)^distancePower + (tribe's bands ÷
   * tribeBands)^sizePower and c = 1 + cultureWeight × (Expansionism − Tradition). Near the heartland of a small tribe
   * splits almost always stay; far out, or in a large tribe, they mostly go their own way.
   */
  reachKm: 4_000, distancePower: 3, tribeBands: 80, sizePower: 2, cultureWeight: 0.8, travelDistance: true,
  /** Splits and moves prefer easy crossings: their appeal × min(1, (easyKm ÷ the crossing's travel-km)^terrainPower). */
  easyKm: 500, terrainPower: 2,
} as const;

export const SPAWN_TUNING = {
  bands: 30, minPopulation: 50, maxPopulation: 200,
  /** Spawn weight: food capacity × (1 + water bonus) × mild-climate factor (Gaussian around the ideal temperature). */
  waterBonus: 1, idealTemperature: 17, temperatureWidth: 12,
  /** Minimum great-circle distance between starting bands. */
  minSpacingKm: 700,
} as const;

/** Research (VISION.md "Research"): base points per person a year scaled by contact, plus specialists; weights for the next target. */
export const RESEARCH_TUNING = {
  basePerPerson: 0.006, contactBonus: 0.08, contactCap: 12,
  /** Base research (experience and tinkering) grows with a polity's people up to a community of this size; beyond it, research needs specialists. */
  basePeople: 1_500,
  specialistResearch: 0.3,
  /** Weight multipliers: food need (hunger or land pressure) raises food techs; exposure raises a tech's weight by
   *  1 + exposureWeight × exposure × (opennessBase + Openness) and lowers its cost; a deposit on the polity's land it knows
   *  but cannot work multiplies its extraction tech's weight by blockedWeight. */
  needWeight: 6, exposureWeight: 12, exposureDiscount: 0.998, opennessBase: 0.5, blockedWeight: 2,
  /** Discovery causes keep the choice factors at least this strong, at most this many. */
  reasonMin: 0.05, reasonCount: 3,
  /** Tradition lowers the weight of techs that change the economy. */
  traditionBrake: 0.6,
  /** Polities within this many regions of each other are in contact (VISION.md M2 simplification), refreshed this often (sea reach as for moves, `MOBILITY_TUNING`). */
  contactRadius: 2, contactMonths: 12,
  /** Contact intensity of a polity two regions away (neighbours count 1); exposure sums the intensities of contacts that know a tech, up to 1. */
  farContact: 1,
  /** Years of research at which a tech's weight halves (effort). */
  effortYears: 100,
  /** Once a year a polity reconsiders its target if another tech now weighs this many times as much. */
  switchRatio: 1.5,
  /** Region environment flags: a biome group covering this share of cells; rough ground by mountain share or defensibility; cold below this mean °C.
   *  Fertile river land is VISION.md's M2 class: farming potential at or above this quantile of land regions, with a river of at least this tier or open-lake access. */
  affinityShare: 0.35, roughShare: 0.25, roughDefensibility: 0.55, coldCelsius: 2, fertileQuantile: 0.75, fertileRiverTier: 2,
} as const;

/** Farming and herding (M2). Densities are people per km² of labour capacity at fertility 100 (farming) or per km² (herding). */
export const FARM_TUNING = {
  farmDensity: { grassland: 10, savanna: 8, steppe: 3, forest: 6, boreal: 2, rainforest: 4, wetland: 5, tundra: 0.2, desert: 0.4, mountain: 1, snow: 0 } satisfies Record<LandBiome, number>,
  fertilityExponent: 1.2,
  herdDensity: { grassland: 1, savanna: 1, steppe: 1.2, forest: 0.2, boreal: 0.2, rainforest: 0.1, wetland: 0.3, tundra: 0.4, desert: 0.2, mountain: 0.3, snow: 0 } satisfies Record<LandBiome, number>,
  grainSiteLabor: 3000,
  /** Farming yield multipliers for river tiers (none, stream, river, great river) and open-lake access. */
  riverFarm: [1, 1.05, 1.15, 1.35], lakeFarm: 1.15,
  yield: { herd: 2.2, farm: 2.6 },
  /** With an empty store, people value crops they must wait for at this share of their yield (graded with the store). */
  sowingPatience: 0.3,
  /** Harvest calendar by latitude band: the months (1–12) when crops sown since the last harvest come in, evenly spaced. */
  harvestNorth: [9], harvestSouth: [3], harvestTropics: [4, 10], tropicsLatitude: 20,
} as const;

export const SPECIALIST_TUNING = {
  /** Specialist share = cap × clamp(floor + slope × (food security − 1), 0, 1), where cap = baseCap × the techs'
   *  specialistCap multipliers: a people living at what its land feeds keeps `floor` of its cap; surplus frees the rest. */
  baseCap: 0.02, floor: 0.3, slope: 3.5,
  /** No people can free more than this share of themselves from food production, whatever their techs. */
  maxShare: 0.9,
} as const;

export const SETTLE_TUNING = {
  /**
   * Yearly settling chance: rises from `from` to `from + span` years in a region, times rate × (baseShare + (1 −
   * baseShare) × farmed/herded share of food)^farmingPower — people settle as they come to live off their fields.
   */
  fromYears: 10, spanYears: 20, baseShare: 0.3, rate: 1, farmingPower: 1, scalePeople: 200_000, scalePower: 2,
} as const;

export const MOBILITY_TUNING = { coastalSailingKm: 300 } as const;

/**
 * The decision step (VISION.md "Decision step"): every `months` per civilization, staggered by id. Scores are 0–1;
 * the choice is weighted random among the `topChoices` best above `minScore`; Do nothing always scores `doNothing`.
 * The last `logSize` steps of each polity are kept for inspection.
 */
export const DECISION_TUNING = { months: 6, minScore: 0.02, doNothing: 0.08, topChoices: 3, logSize: 8, factorCount: 3 } as const;

/**
 * Governance reach (VISION.md "Stability"): how far, in travel-km from the capital, a civilization governs well — a
 * chiefdom's `baseKm` (government forms change it from M7) times its techs' reach multiplier. Travel cost is an edge's
 * travel-km, plus a share of it for crossing a stream, river or great river, and sea crossings cost `seaFactor` per km.
 */
export const REACH_TUNING = { baseKm: 3_000, riverCrossing: [0, 0.1, 0.5, 1], seaFactor: 1.5 } as const;

/**
 * Expansion (VISION.md "Expansion", no threshold): a candidate's score is drive × value × culture − distance − reach.
 * drive = the source region's land pressure + hungerWeight × hunger + opportunityWeight × opportunity (at most 1), where opportunity is how
 * much better the best land it knows is than its own (at most 1); value = (the land's farming capacity over the mean of
 * the civilization's own regions, at most 1)^valuePower, so poorer land keeps some worth to people short of land,
 * × occupiedValue where a tribe's band lives; culture = (expansionismBase +
 * Expansionism) ÷ (expansionismBase + 1); distance = distancePerKm × the crossing's travel cost; reach =
 * reachWeight × (travel cost from the capital ÷ reach)^reachPower: mild within reach, prohibitive soon beyond it.
 * Settlers are `settlerShare` of the source region's people (at least `minSettlers`, leaving at least as many), but no
 * more than `settlerRoom` of what the new land can feed.
 * A tribe's band in the way joins with chance absorbBase + absorbSize × (the civilization's share of their people −
 * 0.5) − absorbTradition × (the band's Tradition − 0.5), within [absorbMin, absorbMax]; otherwise it moves on.
 */
export const EXPAND_TUNING = {
  hungerWeight: 0.5, opportunityWeight: 0.5, valuePower: 0.5, occupiedValue: 0.7, expansionismBase: 0.5, distancePerKm: 0.00003, reachWeight: 0.05, reachPower: 4,
  settlerShare: 0.15, settlerRoom: 0.5, minSettlers: 20,
  absorbBase: 0.5, absorbSize: 0.6, absorbTradition: 0.6, absorbMin: 0.1, absorbMax: 0.95,
} as const;

/**
 * Joining (VISION.md "Joining"): a farming tribe about to settle weighs each civilization it has met whose land it sees
 * next to its own against founding its own (`foundScore`). A civilization's pull = kin (the same founding people) +
 * similarity × culture similarity + prestige × min(1, log10(1 + its people in sight ÷ the tribe's) ÷ prestigeScale)
 * + fed × how well fed its people in sight are + stability × how stable their regions are − crossing × the cheapest
 * crossing's travel-km ÷ 1,000; the tribe's Tradition and Expansionism hold it back (resistance). The choice is
 * weighted random among the best `DECISION_TUNING.topChoices` above `DECISION_TUNING.minScore`. The civilization
 * takes the tribe in with chance 1 ÷ (1 + (travel-km from its capital to the tribe's land ÷ its reach)^admitPower).
 */
export const JOIN_TUNING = {
  kin: 0.6, similarity: 0.3, prestige: 0.6, prestigeScale: 2, fed: 0.1, stability: 0.1, crossing: 0.4,
  tradition: 0.3, expansionism: 0.3, foundScore: 0.1, admitPower: 4,
} as const;

/**
 * Unification (VISION.md "Unification", added at the M3 review): at its decision step a civilization weighs uniting
 * with each larger civilization it knows whose land touches its own. Pull = kin + similarity × culture similarity +
 * size × min(1, log10(the regions it knows the other holds ÷ its own regions) ÷ sizeScale) + fed × how well fed the
 * other's people in sight are + stability × how stable their regions are + trouble × (its own hunger + its share of
 * regions in unrest); resistance = tradition × Tradition + expansionism × Expansionism + contentment × its own mean
 * stability + crossing × the cheapest crossing's travel-km ÷ 1,000. Score = pull − resistance. The larger
 * civilization admits it with chance 1 ÷ (1 + (travel-km from its capital to where they meet ÷ its reach)^admitPower).
 */
export const UNITE_TUNING = {
  kin: 0.16, similarity: 0.08, size: 0.22, sizeScale: 1.5, fed: 0.03, stability: 0.03, trouble: 0.25,
  tradition: 0.06, expansionism: 0.06, contentment: 0.1, crossing: 0.25, admitPower: 4,
} as const;

/**
 * Regional stability (VISION.md "Stability", M3's basic form), yearly per civilization: base − hunger × (1 − food
 * security) − min(overextensionCap, overextension × (travel-km from the capital ÷ reach − 1, if beyond reach)) −
 * foreignRule × (1 − similarity) where a people of another culture lives. Below `unrestBelow` a region falls into
 * unrest (an event) until it recovers past unrestBelow + hysteresis; below it, output falls by up to `outputLoss`
 * and its specialists' research by up to `researchLoss`, in proportion to how far below it is.
 */
export const STABILITY_TUNING = {
  base: 0.9, hunger: 0.6, overextension: 0.4, overextensionCap: 0.8, foreignRule: 0.5,
  unrestBelow: 0.4, hysteresis: 0.1, outputLoss: 0.2, researchLoss: 0.5,
} as const;

/**
 * Migration (VISION.md "Migration"): once a year per civilization (staggered by id), each of its regions sends
 * `rate` × (its land pressure − a neighbour's) of its people, shared among the populated neighbouring regions that
 * civilizations hold (its own or across a border) and are less crowded. Migrants join the people there.
 */
export const MIGRATION_TUNING = { rate: 0.1 } as const;

/**
 * Exploration (VISION.md "Exploration"): score = curiosity × (opennessWeight × Openness + expansionismWeight ×
 * Expansionism) × (base + land pressure), plus `freshMobility` within `freshYears` of a new sea reach. Curiosity is the
 * number of unknown regions next to its sight over `frontierScale` (at most 1). An expedition walks `range[sea]`
 * steps (foot, coastal sailing, ocean navigation) from the own region with the most unknown neighbours, mapping
 * what it passes and meeting who lives there.
 */
export const EXPLORE_TUNING = {
  opennessWeight: 0.5, expansionismWeight: 0.5, base: 0.3, frontierScale: 8, freshMobility: 0.3, freshYears: 50,
  range: [3, 5, 8],
} as const;

/** Culture values of new cultures (0–1 sliders) and how far a daughter culture's values drift from its parent's. */
export const CULTURE_TUNING = { valueMin: 0.15, valueSpan: 0.7, mutation: 0.1 } as const;

/** Name shapes: a third syllable, an initial consonant cluster, an initial consonant and a final coda, by chance. */
export const NAME_TUNING = { thirdSyllable: 0.3, initialCluster: 0.25, initialConsonant: 0.85, coda: 0.55, minLength: 3, maxLength: 11 } as const;

/** Statistics sampled for the lab's world chart. */
export const SERIES_YEARS = 1;

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
  if (!(CLOCK_TUNING.capacityRefresh >= 1 && CLOCK_TUNING.capacityRefresh < 1.1 && CLOCK_TUNING.capacityGameDrift > 0 && CLOCK_TUNING.capacityGameDrift < 0.1)) problems.push('the capacity refresh margins are invalid');
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
  if (!(b.reachKm > 0 && b.distancePower > 0 && b.tribeBands > 0 && b.sizePower > 0 && b.cultureWeight >= 0 && b.cultureWeight < 1)) problems.push('breakaway settings are invalid');
  if (!(b.splitSpan > 0 && b.splitSizeWeight >= 0 && b.splitPressureWeight >= 0 && b.choiceSharpness > 0 && b.maxChance > 0 && b.maxChance <= 1 && b.minFoodPerPerson > 0 && b.pushBase >= 0 && b.pushBase <= 1)) problems.push('band choice weights are invalid');
  const c = CULTURE_TUNING;
  if (!(c.valueMin >= 0 && c.valueSpan > 0 && c.valueMin + c.valueSpan <= 1 && c.mutation >= 0)) problems.push('culture value ranges are invalid');
  const n = NAME_TUNING;
  if (![n.thirdSyllable, n.initialCluster, n.initialConsonant, n.coda].every(value => value >= 0 && value <= 1) || !(n.minLength >= 1 && n.maxLength >= n.minLength)) problems.push('name shapes are invalid');
  if (!(Number.isInteger(SERIES_YEARS) && SERIES_YEARS >= 1)) problems.push('the chart series step must be whole years');
  const sp = SPAWN_TUNING;
  if (!(Number.isInteger(sp.bands) && sp.bands >= 1 && sp.minPopulation >= 1 && sp.maxPopulation >= sp.minPopulation && sp.minSpacingKm >= 0)) problems.push('spawn settings are invalid');
  if (!(sp.temperatureWidth > 0 && sp.waterBonus >= 0)) problems.push('spawn weights are invalid');
  const re = RESEARCH_TUNING;
  if (!(re.basePeople >= 1 && [re.basePerPerson, re.contactBonus, re.specialistResearch, re.needWeight, re.exposureWeight].every(value => value >= 0) && re.exposureDiscount >= 0 && re.exposureDiscount < 1
    && re.traditionBrake >= 0 && re.traditionBrake < 1 && Number.isInteger(re.contactCap) && re.contactCap >= 0)) problems.push('research weights are invalid');
  if (!(Number.isInteger(re.contactRadius) && re.contactRadius >= 1 && Number.isInteger(re.contactMonths) && re.contactMonths >= 1)) problems.push('contact settings are invalid');
  if (!(re.opennessBase >= 0 && re.blockedWeight >= 1 && re.reasonMin >= 0 && Number.isInteger(re.reasonCount) && re.reasonCount >= 1)) problems.push('research weight settings are invalid');
  if (!(re.fertileQuantile > 0 && re.fertileQuantile < 1 && Number.isInteger(re.fertileRiverTier) && re.fertileRiverTier >= 0 && re.fertileRiverTier <= 3)) problems.push('the fertile river land class is invalid');
  if (!(re.farContact >= 0 && re.farContact <= 1 && re.effortYears > 0 && re.switchRatio >= 1)) problems.push('contact intensity and effort settings are invalid');
  if (!(re.affinityShare > 0 && re.affinityShare <= 1 && re.roughShare > 0 && re.roughShare <= 1 && re.roughDefensibility > 0)) problems.push('environment flag thresholds are invalid');
  const fa = FARM_TUNING;
  for (const table of [fa.farmDensity, fa.herdDensity]) for (const [biome, value] of Object.entries(table)) if (!(value >= 0)) problems.push(`farm density for ${biome} must be non-negative`);
  if (!(fa.fertilityExponent > 0 && fa.grainSiteLabor >= 0 && fa.yield.herd > 0 && fa.yield.farm > 0 && fa.lakeFarm >= 1 && fa.riverFarm.length === 4 && fa.riverFarm.every(value => value >= 1))) problems.push('farming settings are invalid');
  for (const calendar of [fa.harvestNorth, fa.harvestSouth, fa.harvestTropics] as readonly (readonly number[])[]) {
    const evenly = calendar.length > 0 && 12 % calendar.length === 0 && calendar.every((month, at) => Number.isInteger(month) && month >= 1 && month <= 12 && (at === 0 || month - calendar[at - 1] === 12 / calendar.length));
    if (!evenly) problems.push('each harvest calendar must list whole months 1–12, rising and evenly spaced');
  }
  if (!(fa.tropicsLatitude > 0 && fa.tropicsLatitude < 90)) problems.push('the tropics latitude must be between 0 and 90°');
  if (!(fa.sowingPatience > 0 && fa.sowingPatience <= 1)) problems.push('sowing patience must be in (0, 1]');
  if (!(SPECIALIST_TUNING.slope >= 0 && SPECIALIST_TUNING.floor >= 0 && SPECIALIST_TUNING.floor <= 1 && SPECIALIST_TUNING.baseCap >= 0 && SPECIALIST_TUNING.baseCap < 1 && SPECIALIST_TUNING.maxShare > 0 && SPECIALIST_TUNING.maxShare < 1)) problems.push('specialist settings are invalid');
  const st = SETTLE_TUNING;
  if (!(st.fromYears >= 0 && st.spanYears > 0 && st.baseShare >= 0 && st.baseShare <= 1 && st.rate > 0 && st.rate <= 1 && st.farmingPower > 0 && st.scalePeople >= 0 && st.scalePower > 0)) problems.push('settling settings are invalid');
  if (!(MOBILITY_TUNING.coastalSailingKm > 0)) problems.push('the coastal sailing reach must be positive');
  const d = DECISION_TUNING;
  if (!(Number.isInteger(d.months) && d.months >= 1 && d.minScore >= 0 && d.doNothing > d.minScore && d.doNothing <= 1 && Number.isInteger(d.topChoices) && d.topChoices >= 1 && Number.isInteger(d.logSize) && d.logSize >= 1 && Number.isInteger(d.factorCount) && d.factorCount >= 1)) problems.push('decision settings are invalid');
  const reach = REACH_TUNING;
  if (!(reach.baseKm > 0 && reach.seaFactor >= 1 && reach.riverCrossing.length === 4 && reach.riverCrossing.every(value => value >= 0))) problems.push('reach settings are invalid');
  const e = EXPAND_TUNING;
  if (!(e.hungerWeight >= 0 && e.opportunityWeight >= 0 && e.valuePower > 0 && e.valuePower <= 1 && e.occupiedValue > 0 && e.occupiedValue <= 1 && e.expansionismBase >= 0 && e.distancePerKm >= 0 && e.reachWeight >= 0 && e.reachPower > 0)) problems.push('expansion scoring is invalid');
  if (!(e.settlerShare > 0 && e.settlerShare < 0.5 && e.settlerRoom > 0 && e.settlerRoom <= 1 && Number.isInteger(e.minSettlers) && e.minSettlers >= 1)) problems.push('settler settings are invalid');
  if (!(e.absorbMin >= 0 && e.absorbMin <= e.absorbMax && e.absorbMax <= 1 && e.absorbSize >= 0 && e.absorbTradition >= 0)) problems.push('absorption settings are invalid');
  if (!(MIGRATION_TUNING.rate > 0 && MIGRATION_TUNING.rate < 0.5)) problems.push('the migration rate must be in (0, 0.5)');
  const j = JOIN_TUNING;
  if (!(Object.values(j).every(value => value >= 0) && j.prestigeScale > 0 && j.foundScore > 0 && j.admitPower > 0)) problems.push('joining settings are invalid');
  const u = UNITE_TUNING;
  if (!(Object.values(u).every(value => value >= 0) && u.sizeScale > 0 && u.admitPower > 0)) problems.push('unification settings are invalid');
  const st2 = STABILITY_TUNING;
  if (!(st2.base > 0 && st2.base <= 1 && st2.hunger >= 0 && st2.overextension >= 0 && st2.overextensionCap >= 0 && st2.foreignRule >= 0 && st2.unrestBelow > 0 && st2.unrestBelow + st2.hysteresis <= 1 && st2.hysteresis >= 0 && st2.outputLoss >= 0 && st2.outputLoss < 1 && st2.researchLoss >= 0 && st2.researchLoss <= 1)) problems.push('stability settings are invalid');
  const x = EXPLORE_TUNING;
  if (!(x.opennessWeight >= 0 && x.expansionismWeight >= 0 && x.base >= 0 && x.frontierScale > 0 && x.freshMobility >= 0 && x.freshYears > 0 && x.range.length === 3 && x.range.every(steps => Number.isInteger(steps) && steps >= 1))) problems.push('exploration settings are invalid');
  if (problems.length) throw new Error(`Invalid simulation tunables: ${problems.join('; ')}.`);
}
