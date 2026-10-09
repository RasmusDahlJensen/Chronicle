import type { WorldBiome } from '../../shared/generated-world.ts';
import { VALUE_NAMES } from '../../shared/simulation.ts';
import { TRAIT_CONDITIONS, TRAITS } from './traits.ts';
import { TENETS } from './religions.ts';

/**
 * Every tunable simulation number (VISION.md rule 5). Values are starting points recorded in the active brief;
 * acceptance thresholds live in tests and briefs, never here. `validateTunables` runs before any simulation starts.
 * Read them where they are used, not into module-level constants: the fork tool (`scripts/fork-core.ts`) overrides
 * them at run time. The food unit (`FOOD_TUNING.unitsPerPersonMonth`) is the exception: stores are counted in it.
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
  /** Settlement site score: fertility + river tier × riverTier + mouth + confluence + coast + lakeshore + resource + relief (capped)
   *  + water when the cell is on or next to a river (stream or larger), a lake, the coast or a resource site (VISION.md M3b:
   *  settlements sit by water or a site wherever the region has such a place). */
  siteScore: { riverTier: 0.5, mouth: 1, confluence: 0.8, coast: 0.6, lakeshore: 0.6, resource: 0.4, reliefScaleM: 1000, reliefCap: 0.3, water: 1.5 },
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
   *  Knowledge mostly raises capacity, so between solves the cached value is within a few percent of a fresh one and the
   *  1.1× over-capacity check reads the same. (Since M5.3 a resource shortfall can lower a civilization's farm and fish
   *  yields at its yearly assessment, by at most the techs' own bonuses; its capacity follows at the next solve.) */
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
  /** Farmers keep a reserve for bad harvests (VISION.md: food security counts stored food): up to this many months
   *  beyond what lasts until the next harvest, as far as their store holds. While their store is short of it, births
   *  count food security as lower by the shortfall (a share of a harvest cycle's need); deaths follow hunger alone. */
  reserveMonths: 3,
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
  basePerPerson: 0.004, contactBonus: 0.08, contactCap: 12,
  /** Base research (experience and tinkering) grows with a polity's people in proportion up to a community of
   *  `basePeople`, and beyond it as (people ÷ basePeople)^scalePower: a large people researches faster, but not in
   *  proportion (VISION.md "Research", changed after the M3 review). */
  basePeople: 1_500, scalePower: 0.15,
  specialistResearch: 0.3,
  /** Weight multipliers: food need (hunger or land pressure) raises food techs; a tech a sharing partner knows weighs
   *  1 + shareWeight × (opennessBase + Openness) times as much and is researched 1 + shareSpeed × (opennessBase +
   *  Openness) times as fast (VISION.md "Sharing knowledge"); a deposit on the polity's land it knows but cannot work
   *  multiplies its extraction tech's weight by blockedWeight. */
  needWeight: 6, shareWeight: 4, shareSpeed: 2, opennessBase: 0.5, blockedWeight: 2,
  /** Catch-up (VISION.md "Paths, not a timeline"): a tech of an earlier era than the most advanced era the polity knows
   *  of (its own, or a people's it has met) is researched 1 + catchUpPerEra × min(eras behind, catchUpEras) times as fast. */
  catchUpPerEra: 0.25, catchUpEras: 4,
  /** Discovery causes keep the choice factors at least this strong, at most this many. */
  reasonMin: 0.05, reasonCount: 3,
  /** Tradition lowers the weight of techs that change the economy. */
  traditionBrake: 0.6,
  /** Polities it has met within this many regions are its contacts (VISION.md M2 simplification), refreshed this often (sea reach as for moves, `MOBILITY_TUNING`). */
  contactRadius: 2, contactMonths: 12,
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
  /** Townspeople close this share of the gap to that each month (moving to and from town takes time). */
  adjust: 1 / 12,
  /** No people can free more than this share of themselves from food production, whatever their techs. */
  maxShare: 0.9,
} as const;

export const SETTLE_TUNING = {
  /**
   * Yearly settling chance: rises from `from` to `from + span` years in a region, times rate × (baseShare + (1 −
   * baseShare) × farmed/herded share of food)^farmingPower — people settle as they come to live off their fields —
   * times max(scaleFloor, min(1, (people ÷ scalePeople)^scalePower)): large peoples form states first, small farming
   * tribes later (pending the user's approval, M3.4 brief).
   */
  fromYears: 10, spanYears: 20, baseShare: 0.3, rate: 1, farmingPower: 1, scalePeople: 200_000, scalePower: 2, scaleFloor: 0.02,
} as const;

export const MOBILITY_TUNING = { coastalSailingKm: 300 } as const;

/**
 * Settlements (VISION.md "Settlements"). A region's townspeople (its specialists) live in its settlements: the capital
 * first, then the others in founding order, each up to its housing (`baseHousing`, × `capitalHousing` for the seat of
 * government, × its buildings' housing). When they
 * fill `foundAt` of the region's housing, a new settlement is founded on the next free candidate site (or ruins are
 * resettled), once a year; a region's first settlement takes its best site, further ones only a site by water or a
 * resource site. A settlement's tier rises when its mean urban population (an exponential moving average with weight
 * 1 ÷ `meanMonths` a month, from 0 at founding) reaches the next of `tiers` (village, town, city, metropolis) and falls
 * when it drops below `demote` × its own; resettled ruins keep their old name with chance `keepName`.
 */
export const SETTLEMENT_TUNING = {
  tiers: [0, 4_000, 12_000, 40_000], demote: 0.6, baseHousing: 8_000, capitalHousing: 2, foundAt: 0.9, keepName: 0.5,
  /** The tier follows the urban population averaged over about this many months (exponentially), not one month's. */
  meanMonths: 24,
  /** Event importance of reaching each tier (a village is never reached), and of falling a tier. */
  tierImportance: [0, 0.03, 0.12, 0.35], fallImportance: 0.05,
  /** A settlement that shrinks a tier cites its region's hardship, a famine there now (its deaths over about a year as a
   *  share of the people, × fallFamineScale) or unrest, each at fallCause or more; else only its fewer townspeople. */
  fallCause: 0.05, fallFamineScale: 10,
  /** Years in a row a settlement's averaged townspeople must call for another tier before it changes. */
  tierYears: 5,
} as const;

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
export const REACH_TUNING = {
  baseKm: 3_600, riverCrossing: [0, 0.1, 0.5, 1], seaFactor: 1.5,
  /** Travel through land it does not hold costs this many times as much; the search stops at `searchReaches` reaches,
   *  and land beyond it (or cut off) counts as straight-line km × `fallbackFactor`, so no land is infinitely far. */
  foreignRelay: 2, searchReaches: 3, fallbackFactor: 2.5,
} as const;

/**
 * Expansion (VISION.md "Expansion", no threshold): a candidate's score is drive × value × culture − distance − reach −
 * administration (BUDGET_TUNING.adminWeight's).
 * drive = the source region's land pressure + hungerWeight × hunger + opportunityWeight × opportunity + resourceWeight × the
 * largest shortfall among the resources whose sites it knows there (M5.3) (at most 1), where opportunity is how
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
  hungerWeight: 0.5, opportunityWeight: 0.5, resourceWeight: 0.3, valuePower: 0.5, occupiedValue: 0.7, expansionismBase: 0.5, distancePerKm: 0.00003, reachWeight: 0.05, reachPower: 4,
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
 * with each civilization it believes larger whose land touches its own. Pull = kin + similarity × culture similarity +
 * size × min(1, log10(their believed population ÷ its own) ÷ sizeScale) + fed × how well fed the other's people in
 * sight are + stability × how stable their regions are + trouble × (its own hunger + its share of regions in unrest) +
 * opinion × its opinion of them ÷ 100 + threat × the most it fears any other neighbour × clamp01(its opinion of them ÷
 * 100) (M5.1, M5.2: a threatened realm seeks shelter in a larger one it likes); resistance = tradition × Tradition + expansionism × Expansionism + contentment × its own mean
 * stability + crossing × the cheapest crossing's travel-km ÷ 1,000. Score = pull − resistance. The larger
 * civilization admits it with chance 1 ÷ (1 + (travel-km from its capital to where they meet ÷ its reach)^admitPower)
 * × (1 − strainRefusal × its own budget strain): a realm already strained is loath to take in more (M3c).
 */
export const UNITE_TUNING = {
  kin: 0.16, similarity: 0.08, size: 0.15, sizeScale: 1.5, fed: 0.03, stability: 0.03, trouble: 0.25, opinion: 0.1, threat: 0.15,
  tradition: 0.06, expansionism: 0.06, contentment: 0.1, crossing: 0.25, admitPower: 4, strainRefusal: 0.6,
  /** A civilization turned away does not ask the same one again for this many years. */
  rebuffYears: 30,
} as const;

/**
 * Regional stability (VISION.md "Stability", M3's basic form), yearly per civilization: base − hunger × (1 − food
 * security) − min(overextensionCap, overextension × (travel-km from the capital ÷ reach − 1, if beyond reach)) −
 * foreignRule × (1 − similarity) where a people of another culture lives − strain × (the realm's size factor × age
 * factor − 1) × (strainCore + (1 − strainCore) × min(1, remoteness)): a large, old realm holds its far provinces less
 * firmly (VISION.md M3c: empire strain; the factors are BUDGET_TUNING's administration factors) − soldiers lately sent
 * home (ARMY_TUNING's demobilization burden, M6.1) − its taxes and arrears (BUDGET_TUNING) + its buildings' and wonders'. Below `unrestBelow` a region falls into unrest (an event)
 * until it recovers past unrestBelow + hysteresis; below it, output falls by up to `outputLoss` and its specialists'
 * research by up to `researchLoss`, in proportion to how far below it is.
 */
export const STABILITY_TUNING = {
  base: 0.9, hunger: 0.6, overextension: 0.4, overextensionCap: 0.8, foreignRule: 0.5, strain: 0.02, strainCore: 0.25,
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
 * Expansionism) × (base + land pressure + shortageWeight × its shortage need: new land may hold what it lacks; M5.3), plus
 * `freshMobility` within `freshYears` of a new sea reach. Curiosity is the
 * number of unknown regions next to its sight over `frontierScale` (at most 1). An expedition walks `range[sea]`
 * steps (foot, coastal sailing, ocean navigation) from the own region with the most unknown neighbours, mapping
 * what it passes and meeting who lives there.
 */
export const EXPLORE_TUNING = {
  opennessWeight: 0.5, expansionismWeight: 0.5, base: 0.3, shortageWeight: 0.3, frontierScale: 8, freshMobility: 0.3, freshYears: 50,
  range: [3, 5, 8],
} as const;

/**
 * Sharing knowledge (VISION.md "Sharing knowledge", added after the M3 review): at its decision step a civilization
 * weighs an exchange with each people it is in contact with. Score = (learn × min(1, techs they know that it does not ÷
 * techScale) + (kin if kin + similarity × culture similarity + openness × Openness) × min(1, techs it would teach ÷
 * techScale) − tradition × Tradition − busy × exchanges it already has) × their willingness: what it would learn is
 * the main draw; only open and kin peoples teach for nothing in return. Willingness = (1 − refusal × their Tradition ×
 * (1 − similarity)) × (gainBase + (1 − gainBase) × min(1, techs they would learn ÷ techScale)): a people that would
 * learn nothing is less ready to give. The other side accepts with that chance. An exchange runs both ways for
 * `years`; a refusal is remembered for `refusedYears`.
 */
export const SHARE_TUNING = {
  learn: 0.2, kin: 0.03, similarity: 0.02, openness: 0.06, techScale: 4, tradition: 0.12, busy: 0.05, refusal: 1, gainBase: 0.5, opinion: 0.05,
  years: 40, refusedYears: 20,
} as const;

/**
 * Wealth (VISION.md "Wealth"): one currency per civilization; what its people produce and the crown takes in taxes is
 * BUDGET_TUNING's. Hardship is the memory of hunger per region: each month it becomes the larger of the month's
 * shortfall of food (1 − food security) and its own value × `hardshipFade`.
 */
export const WEALTH_TUNING = {
  hardshipFade: 0.98,
  /** Wealth a year from each site a mine (minerals) or quarry (stone) works in its region, once its civilization can use
   *  the resource (VISION.md "gold and salt raise wealth"; the supply of the resources themselves comes with trade, M5). */
  siteYield: { copper: 1_500, tin: 2_000, iron: 1_500, gold: 4_000, coal: 1_000, uranium: 2_000, salt: 1_500, stone: 800 },
  /** Buildings of stone cost this share where the civilization quarries stone. */
  stoneDiscount: 0.75,
} as const;

/**
 * A realm's budget (VISION.md "Wealth"; M3c.2). Its people produce and the crown takes a share in taxes; running the
 * realm costs administration, services and upkeep.
 *
 * Output a year: each townsperson's trades `townOutput` (× the settlement's markets and the like); each farmer's
 * surplus `farmOutput` × the share of food farmed or herded × surplus, where surplus = clamp((food security −
 * hungerLine) ÷ (1 − hungerLine), 0, 1): hungry farmers have nothing to sell. Both are lower in unrest. Mines and
 * quarries pay the crown their yield directly (`WEALTH_TUNING.siteYield`).
 *
 * Taxes: the rate is a share of that output, between `minRate` and `maxRate`. Once a year, at its stability
 * assessment, a realm sets the rate that covers its costs (less its sites) and refills its treasury toward a reserve of
 * reserveYears + reserveTradition × Tradition years of costs (prudent, traditional peoples keep more) over
 * `refillYears`, moving at most `rateStep` a year. It raises taxes above the customary rate only as far as its people
 * are calm (VISION.md: a realm chooses between the unrest of heavy taxes and the decay of arrears): at most customary
 * rate + (maxRate − customary rate) × clamp((calm − calmFloor) ÷ (calmFull − calmFloor), 0, 1), where calm is its
 * regions' people-weighted mean stability apart from its taxes and arrears. Above the customary rate, taxes lower
 * every region's stability by up to `taxUnrest` at the maximum; below it they raise it by up to `taxContent`. A realm
 * raising its rate above `heavyRate` (an event) or easing it back to the customary rate (an event) is recorded.
 *
 * Administration a year of each region: (perRegion + perPerson × its people) × (1 + distance × min(remoteCap, travel-km
 * from the capital ÷ governance reach)) × max(1, the realm's regions ÷ sizeScale)^sizePower × (1 + ageMax × (1 −
 * e^(−years since it settled ÷ ageYears))).
 *
 * Services a year of each settlement: townspeople × servicesBase × (1 + townspeople ÷ servicesScale)^servicesPower.
 *
 * Arrears: the share of each month's costs left unpaid, averaged over `arrearsMonths`; it lowers each region's
 * stability by arrearsUnrest × arrears × (arrearsCore + (1 − arrearsCore) × min(1, remoteness)): most at the edges. A
 * realm whose arrears pass `arrearsEvent` falls into arrears (an event) until they fall below half of it.
 *
 * Deferred maintenance (`deferMaintenance`): a strained realm lets its farthest regions go unkept, a share as large as
 * neglectStrain × its strain, more if even its taxes fall short; an episode ends after `keptYears` years of keeping
 * everything up.
 *
 * Expansion weighs the strain on a realm's purse: adminWeight × strain × (½ + ½ × min(1, the land's remoteness)),
 * strain = clamp(costs ÷ (customary taxes + sites) − 1, 0, 1).
 */
export const BUDGET_TUNING = {
  townOutput: 5, farmOutput: 0.2, hungerLine: 0.8,
  customaryRate: 0.2, minRate: 0.05, maxRate: 0.5, rateStep: 0.02, reserveYears: 0.5, reserveTradition: 3, refillYears: 5, heavyRate: 0.3, calmFloor: 0.4, calmFull: 0.85,
  taxUnrest: 0.3, taxContent: 0.05,
  perRegion: 100, perPerson: 0.01, distance: 0.5, remoteCap: 2, sizeScale: 20, sizePower: 0.5, ageMax: 1, ageYears: 600,
  servicesBase: 0.3, servicesScale: 10_000, servicesPower: 0.5,
  arrearsMonths: 12, arrearsUnrest: 0.5, arrearsCore: 0.2, arrearsEvent: 0.1, neglectStrain: 0.5, keptYears: 5,
  adminWeight: 0.5,
} as const;

/**
 * Famine relief (VISION.md "Famine is mitigable, by wealth and knowledge"; `relief.ts`): a hungry region within what
 * its land lastingly feeds wants `months` of need in store; carriage costs `costPer1000Km` wealth per person-month of
 * food per 1,000 travel-km (roads shorten the way), travels `kmPerMonth` and spoils on the way at the realm's monthly
 * store spoilage; the treasury pays at most `treasuryShare` of itself a month. Relief to a region relieved no more than
 * `episodeMonths` before continues its episode.
 */
export const RELIEF_TUNING = { months: 2, costPer1000Km: 0.2, kmPerMonth: 500, treasuryShare: 0.2, episodeMonths: 12 } as const;

/**
 * Building (VISION.md "Buildings" and the Build action). At its decision step a civilization weighs each building type
 * it knows: for each settlement that could have it, need × size, where size = min(1, townspeople ÷ sizeScale) and the
 * need follows the building's purpose —
 *   food: hardship + farmStore × the share of food farmed; faith: (1 − stability) × (faithBase + Zeal);
 *   learning: (learningBase + Openness); trade: (tradeBase + Openness × tradeOpenness);
 *   housing: clamp((townspeople ÷ housing − crowdFrom) ÷ (1 − crowdFrom), 0, 1); defense: min(1, the larger of foreign
 *   neighbours ÷ frontierScale and (M6.4) its region's raid memory) × (defenseBase + Militarism), cited as the frontier
 *   or as raids, whichever is larger.
 * The type's score is purposeWeight × the mean of its best `batch` settlements' values (batch = ceil(regions ÷
 * batchRegions), at most batchMax) − cost × (cost of the batch ÷ (surplus + treasury ÷ treasuryYears)) −
 * upkeepWeight × (the batch's upkeep ÷ max(surplus, surplusFloor × revenue)), where revenue is what customary taxes
 * and the realm's sites raise a year and surplus what that leaves after its costs (VISION.md "Wealth": it weighs its
 * income after costs). The best type is the Build option; it is begun in those settlements. Construction is paid in
 * equal monthly instalments while the treasury allows. Costs are due monthly; unpaid, every building loses
 * unpaid share ÷ decayMonths of condition a month (paid, it regains 1 ÷ recoverMonths) and is lost at 0; in a region
 * its realm lets go unkept, it loses at least 1 ÷ neglectDecayMonths a month, declining over years.
 */
export const BUILD_TUNING = {
  sizeScale: 8_000, farmStore: 0.2, faithBase: 0.3, learningBase: 0.3, tradeBase: 0.4, tradeOpenness: 0.6, crowdFrom: 0.7, frontierScale: 3, defenseBase: 0.1,
  purposeWeight: { food: 0.5, faith: 0.35, learning: 0.3, trade: 0.35, housing: 0.6, defense: 0.25, mining: 0.4, sea: 0.35, farming: 0.4, roads: 0.5 },
  /** farming (irrigation): the share of food farmed or herded × (irrigationBase + hardship), at most 1, sized by the
   *  region's farmers (min(1, farmers ÷ farmScale)) instead of its townspeople. */
  irrigationBase: 0.3, farmScale: 10_000,
  /** mining: min(1, wealth a year the region's unworked usable sites would give ÷ mineScale); sea (a coastal settlement):
   *  min(1, sea crossings within its civilization's reach ÷ seaScale) × (seaBase + (Openness + Expansionism) ÷ 2). */
  mineScale: 3_000, seaScale: 3, seaBase: 0.2,
  /**
   * Wonders (VISION.md "Wonders": a large surplus and a motive): need = the culture's value for its motive (piety: Zeal,
   * ambition: Expansionism, learning: Openness) × golden age (clamp((the realm's mean stability − goldenFrom) ÷
   * (1 − goldenFrom), 0, 1)) × greatness (min(1, its largest fitting city's townspeople ÷ wonderCity)); the score is
   * wonderWeight × need − the cost and upkeep burdens as for buildings, its cost counted as what it takes a year while
   * it is built (cost × 12 ÷ months).
   */
  wonderWeight: 0.6, goldenFrom: 0.6, wonderCity: 20_000,
  /**
   * Roads (VISION.md "Roads"): for each of its regions with a town or city its roads do not yet reach at the best tier
   * it knows, the need is connection (roadBase + roadOpenness × Openness) + remoteness (roadReach × min(1, travel-km
   * from the capital ÷ governance reach)), at most 1, × size; the score is purposeWeight.roads × the mean of the best
   * batch − the cost and upkeep burdens as for buildings. A road's upkeep is roadUpkeep of what it cost to build a
   * year; unpaid (or kept by no civilization) it loses 1 ÷ roadDecayMonths of its condition a month, times the unpaid
   * share, and in a region its keeper lets go unkept 1 ÷ neglectRoadMonths; it is lost at 0.
   */
  roadBase: 0.2, roadOpenness: 0.3, roadReach: 0.8, roadUpkeep: 0.02, roadDecayMonths: 240,
  /** Laying out a route, a stretch of road that already serves (or is being built) counts this share of its travel
   *  cost, so new roads branch off the network instead of running beside it. */
  roadReuse: 0.1,
  batchRegions: 8, batchMax: 12, cost: 0.5, treasuryYears: 5, upkeepWeight: 0.6, surplusFloor: 0.05,
  decayMonths: 60, recoverMonths: 24, neglectDecayMonths: 120, neglectRoadMonths: 120,
  /** Work waits, unpaid, while its settlement is below the tier it needs; after waitMonths it is abandoned. */
  waitMonths: 240,
} as const;

/**
 * The environment (VISION.md "Environment": yield variance and droughts). Each harvest comes in at its crops × the
 * weather, drawn at the harvest month: 1 + harvestSpread × a standard normal draw, within [harvestMin, harvestMax].
 * Each January a region not in drought begins one with chance droughtChance a year (× aridDrought where the land is
 * arid), lasting 1 to droughtYears years, and it spreads to each neighbour with chance droughtSpread. In drought a
 * harvest keeps 1 − droughtFarmLoss of its crops and herds give 1 − droughtHerdLoss of their yield (less of a loss
 * where irrigation stands). A region is in famine once its famine deaths over about a year (a sum fading by
 * famineFade a month) reach famineShare of its people (and at least famineMin); the famine ends below famineEnd. A
 * famine cites what brought it where that weighs at least famineCause; else the shortage itself.
 */
export const ENVIRONMENT_TUNING = {
  harvestSpread: 0.05, harvestMin: 0.8, harvestMax: 1.2,
  droughtChance: 0.0004, aridDrought: 4, droughtYears: 3, droughtSpread: 0.5, droughtFarmLoss: 0.4, droughtHerdLoss: 0.25,
  famineFade: 11 / 12, famineShare: 0.04, famineMin: 50, famineEnd: 0.01, famineCause: 0.03,
} as const;

/**
 * Cultivated land (VISION.md "Cultivated land"; `fields.ts`). A region's fields are farm labour under cultivation: its
 * farmers would work the share 1 − e^(−fieldFactor × farmers ÷ farm labour) of its farmland; fields below that are cleared at clearRate ×
 * that a year, fields above it fall fallow by fallowRate of the gap a year, and until cleared the land yields
 * `uncleared` of its harvest. Farmland — cells with at least minDensity people of farm labour per km², or a grain site —
 * is ranked by its labour × 1 ÷ (1 + cells away from the region's best settlement site ÷ closeCells). The study watches each civilization's famine: its regions' fields shrink when they fall below
 * (1 − shrinkMargin) of what they were within shrinkYears, and regrow when they are back; watches last watchYears.
 */
export const FIELD_TUNING = {
  fieldFactor: 1, clearRate: 1, fallowRate: 0.25, uncleared: 0.8, closeCells: 4, minDensity: 1,
  shrinkYears: 10, shrinkMargin: 0.02, watchYears: 100,
} as const;

/**
 * Cultures (VISION.md "Culture and lineage"). Starting peoples' values (0–1 sliders) and how far a band that breaks
 * away strays from its people's. Living cultures (M4), once a year:
 * - each group's values drift toward what its conditions pull them to (`CULTURE_PULLS`) at `driftRate`, and blend
 *   toward the people it is in contact with at `influenceRate` (toward their weighted mean, scaled down while the
 *   weights add up to less than 1: a lone weak contact pulls less): neighbouring groups (of another polity at
 *   `foreignContact`), each weighted by its polity's prestige against its own (2P ÷ (P + P′), where P is √people ×
 *   (1 + `prestigeEra` × era) × (1 + `prestigeWonder` × standing wonders) × (1 + `prestigeCity` × cities and
 *   metropolises) × (1 + `prestigeWealth` × its treasury per person ÷ `wealthPerPerson`, at most 1)) and by how alike
 *   they already are (1 − difference ÷ `confidence`, none beyond it: peoples far apart hardly sway each other, so
 *   distinct cultures last), and a civilization's heartland at `heartPull` × e^(−remoteness);
 * - each culture's people take a common random step of up to `fashion` in each value (its own way of going).
 * Part of a culture whose people's values differ from its heart's by more than `splitDivergence` (the mean over the
 * five values), over at least `splitRegions` neighbouring regions, splits off as a new culture, with a chance a year of
 * `splitRate` × how far beyond (in units of `splitDivergence`, at most 1); its event names the values it has more and
 * less of by at least `splitNote` × `splitDivergence`. A daughter's language changes `languageChanges` sounds, and its
 * colour turns by up to `hueShift` degrees; the starting peoples' colours lie `hueStep` degrees apart from `hueStart`
 * (as the observer's lineage colours do).
 * Mixed peoples (M4.2), once a year per civilization:
 * - a people of another culture takes up the ruling culture with a chance of `assimilationRate` × how close its values
 *   are to the realm's heartland people's (none beyond `assimilationRange`) × (1 − `assimilationTradition` × its
 *   Tradition) × (1 − `assimilationTolerance` × the heartland's Openness: tolerant realms let peoples be) × (½ + ½ e^(−remoteness)) × how small a share of the realm
 *   its culture is (none at `hybridShare` or more, except for kin: cultures whose ancestry overlaps by at least
 *   `kinShare`); taking up its ways, its values move `assimilationBlend` of the way to the heartland's (within
 *   `splitDivergence` of them, so it does not split off again at once);
 * - the ruling culture and the largest other people, not kin, each holding at least `hybridShare` of the realm's people
 *   for `hybridYears` (counted up while both are large, down while either is not), whose people's values differ by at
 *   most `hybridRange`, fuse into a hybrid with a chance of `hybridRate` a year; becoming one people, every group's
 *   values move `fusionBlend` of the way to the hybrid's, so it does not split along the old seam.
 */
export const CULTURE_TUNING = {
  valueMin: 0.15, valueSpan: 0.7, mutation: 0.1,
  driftRate: 0.005, influenceRate: 0.03, foreignContact: 0.25, confidence: 0.25, heartPull: 2, fashion: 0.03,
  prestigeEra: 0.25, prestigeWonder: 0.5, prestigeCity: 0.1, prestigeWealth: 0.5, wealthPerPerson: 0.2, townShare: 0.25, seaShare: 0.5,
  splitDivergence: 0.07, splitRegions: 3, splitRate: 0.05, splitNote: 0.25, languageChanges: 2, hueShift: 20, hueStart: 20, hueStep: 137.508,
  assimilationRate: 0.01, assimilationRange: 0.1, assimilationBlend: 0.5, assimilationTradition: 0.5, assimilationTolerance: 0.5, kinShare: 0.5, hybridShare: 0.25, hybridYears: 150, hybridRange: 0.1, hybridRate: 0.02, fusionBlend: 0.8,
} as const;

/**
 * Traits (VISION.md "Traits"; `traits.ts`): earned when at least `share` of a culture's people have lived in the
 * trait's conditions for its years in a row; at most `max`; each passes to a daughter with chance `inherit` (from a
 * hybrid's lighter parent, half that). Mountains and deserts are the regions' environment flags (rough; desert, not
 * steppe); desert herders get at least `herding` of their food from herds and fields away from any river or lake (desert
 * farmers live by water), and great-river farmers `farming`.
 */
export const TRAIT_TUNING = { share: 0.6, max: 4, inherit: 0.85, herding: 0.3, farming: 0.5 } as const;

/**
 * Faiths (VISION.md "Religion", M4.3; `faith.ts`), once a year:
 * - a civilization that knows Organized religion or Theology founds a religion with a chance of `foundingRate` × its
 *   trigger (× `reformation` when its rulers already follow one: a reformation is rare): a crisis (famine deaths
 *   over about the last year as a share of its people × `crisisScale`, at most 1) or its people's zeal (its heartland's
 *   Zeal above `zealFloor`, scaled to 1), the stronger; the religion draws `minTenets` to `maxTenets` tenets, each
 *   weighted e^(`tenetFavour` × Σ favour × (value − ½)) by its founders' values;
 * - each people is drawn to religions by the share of its neighbouring peoples following them (another polity's at
 *   `foreignContact`), its realm's state religion (`stateSupport`, plus `templeSupport` with a shrine or temple in its
 *   region) and the holy land under or beside it (`holyDraw`); it may take one up, chosen by those draws, with a chance
 *   of `conversionRate` × all draws together (at most 1) × the religion's spread tenets × (1 − `traditionHold` × its
 *   Tradition) × its attachment (`folkAttachment` to the folk ways, `faithAttachment` to another religion, and
 *   × `stateHold` more when its faith is its realm's state religion: the rulers' faith is entrenched);
 * - under a state religion, a people of another faith is less settled by `friction` × (`zealFriction` + its Zeal),
 *   times the state religion's friction tenets;
 * - research weighs religion techs × (`religionZealBase` + its people's Zeal); a state religion of Monument builders
 *   weighs temples and wonders × `monumentWeight`; an ascetic faith's followers produce `asceticWealth` of their wealth;
 * - schisms (M4.4): a religion's followers in neighbouring regions or one polity are one body; a body of at least
 *   `schismRegions` regions cut off from its main body becomes a sect with one tenet changed, with a chance of
 *   `schismRate` a year × how long its people have been apart (people-weighted: none at half of `schismYears`, all of it
 *   at `schismYears`); its colour turns by up to `sectHueShift` degrees;
 * - the secular age (M4.4): a polity's secularity grows `secularPerTech` for each Early modern or later tech it knows,
 *   at most `secularMax`; faith friction, Zeal's weight in research and in building, and the chance to found a religion
 *   fall by it.
 */
export const FAITH_TUNING = {
  foundingRate: 0.05, crisisScale: 200, zealFloor: 0.4, reformation: 0.01, minTenets: 2, maxTenets: 4, tenetFavour: 4,
  conversionRate: 0.1, foreignContact: 0.5, stateSupport: 0.3, templeSupport: 0.3, holyDraw: 0.5, folkAttachment: 1, faithAttachment: 0.3, stateHold: 0.3, traditionHold: 0.5,
  friction: 0.12, zealFriction: 0.5, religionZealBase: 0.8, monumentWeight: 1.5, asceticWealth: 0.95,
  schismRegions: 3, schismYears: 150, schismRate: 0.02, sectHueShift: 30, secularPerTech: 0.05, secularMax: 0.8,
} as const;

/** What a group's conditions are measured by (0–1 each; `culture.ts`). */
export const PULL_MEASURES = ['harshLand', 'frontier', 'townsAndSea', 'hardship', 'openLand'] as const;
export type PullMeasure = typeof PULL_MEASURES[number];

/**
 * What pulls a people's values (VISION.md "Drift": harsh land raises Tradition, frontier pressure Militarism): each
 * value drifts toward `base` + Σ `weight` × measure (kept within 0–1); the bases put the people-weighted mean of each value near 0.5, where
 * the starting peoples' values centre, so values in decisions keep their meaning. Harsh land: how far its land feeds fewer farmers and herders per
 * km² than the median habitable region; frontier: the share of its neighbouring regions where other peoples live;
 * towns and sea: `seaShare` for a coast its people can sail from, the rest for townspeople (full at `townShare` of its
 * people);
 * hardship: the memory of hunger; open land: the share of its neighbouring regions that could feed people and where
 * nobody lives (a frontier of opportunity, which fades as the land fills).
 */
export const CULTURE_PULLS: Record<typeof VALUE_NAMES[number], { base: number; pulls: { measure: PullMeasure; weight: number }[] }> = {
  militarism: { base: 0.45, pulls: [{ measure: 'frontier', weight: 0.6 }] },
  zeal: { base: 0.45, pulls: [{ measure: 'hardship', weight: 0.6 }] },
  openness: { base: 0.42, pulls: [{ measure: 'townsAndSea', weight: 0.6 }] },
  tradition: { base: 0.32, pulls: [{ measure: 'harshLand', weight: 0.6 }] },
  expansionism: { base: 0.48, pulls: [{ measure: 'openLand', weight: 0.6 }] },
};

/** Name shapes: a third syllable, an initial consonant cluster, an initial consonant and a final coda, by chance. */
export const NAME_TUNING = { thirdSyllable: 0.3, initialCluster: 0.25, initialConsonant: 0.85, coda: 0.55, minLength: 3, maxLength: 11 } as const;

/** Statistics sampled for the lab's world chart, and the census of civilizations (U.3) for the observer's stories. */
export const SERIES_YEARS = 1, CENSUS_YEARS = 10;

/**
 * Beliefs, intimacy and opinion (VISION.md "Beliefs about other polities", "Relations and memory"; M5.1), yearly per
 * civilization and each living people it has met.
 * - Beliefs: each of a pair's estimates (population, strength, wealth, era) is off by a bias drawn once,
 *   exp(N(0, biasSpread)) − 1 within [biasMin, biasMax], times (1 − intimacy).
 * - Intimacy (0–1) moves toward its target by `rise` a year when below it and by `fade` when above: the target is
 *   `border` for a shared border, `contact` for being within two regions, `exchange` while they share knowledge
 *   (trade, alliances, roads and war add later), at most 1; with none of these it fades to 0.
 * - Opinion (−100 to 100), the sum of its standing reasons and memories: `sameFaith` for the same organized faith,
 *   −`rivalFaith` × their mean Zeal for rival organized faiths (halved by a tolerant faith), both less in the secular
 *   age (× 1 − the pair's mean secularity); `culture` × (similarity − `culturePivot`) ÷ (1 − `culturePivot`), within
 *   ±`culture`, for how alike their cultures are (most cultures are fairly alike: the pivot is a typical likeness);
 *   `kin` for a shared lineage, `sharing` while they share knowledge; −`borderTension` × min(1, the regions it has on
 *   their border ÷ `borderScale`) × their mean Expansionism; and each memory's points, halving every `halfLifeYears`
 *   (forgotten below `forgetBelow` points). Its `reasonCount` strongest reasons are kept.
 * - A union refused because the other realm was not as many as believed teaches the truth: intimacy rises by
 *   `correction` (then fades back toward what their contact supports).
 */
export const RELATION_TUNING = {
  biasSpread: 0.5, biasMin: -0.7, biasMax: 2,
  rise: 0.08, fade: 0.03, border: 0.5, contact: 0.2, exchange: 0.3,
  sameFaith: 25, rivalFaith: 30, culture: 30, culturePivot: 0.85, kin: 10, sharing: 15, borderTension: 40, borderScale: 4, correction: 0.3,
  memories: { turnedAway: { points: -20, halfLifeYears: 25 }, refusedExchange: { points: -10, halfLifeYears: 15 }, refusedTrade: { points: -10, halfLifeYears: 15 }, refusedTreaty: { points: -5, halfLifeYears: 10 }, treatySoured: { points: -5, halfLifeYears: 15 },
    war: { points: -40, halfLifeYears: 30 }, lostLand: { points: -30, halfLifeYears: 75 }, brokeTreaty: { points: -25, halfLifeYears: 40 },
    abandoned: { points: -30, halfLifeYears: 40 }, threwOff: { points: -30, halfLifeYears: 40 } },
  forgetBelow: 1, reasonCount: 3,
} as const;

/**
 * Needs (VISION.md "Needs"; M5.2), each 0–1, from what a civilization knows:
 * - threat: the most it feels from a neighbour it believes stronger and dislikes, clamp01((their strength ÷ its own −
 *   1) ÷ (threatScale − 1)) × clamp01(−opinion ÷ hostileAt): a neighbour `threatScale` times as strong with an opinion
 *   of −hostileAt or below threatens fully, a liked or indifferent one not at all;
 * - unrest: the larger of the share of its regions in unrest and how far its stability is below `calmStability`;
 * - friction: the share of its neighbours of a rival organized faith (half for a tolerant faith on either side) × its
 *   Zeal × (1 − its secularity);
 * - opportunity: the larger of the land's (its best candidate's value over its own, − 1) and a neighbour's: believed
 *   weaker (`weak` × (1 − their strength ÷ its own)) and richer (`rich` × (their treasury ÷ its own − 1)), within 0–1;
 * - infrastructure: the largest of the share of its towns and cities in regions its roads do not reach, the share of
 *   its settlements going hungry (hardship of at least `hungry`) with no granary or silo, and 1 for a coast with
 *   somewhere to sail to but no harbor once it could sail and build one.
 * Resource shortage is the largest shortfall of what its techs demand (M5.3); grievance (M6.2) is the weight of its
 * strongest claim on land another civilization holds (`grievanceOf`).
 */
export const NEED_TUNING = { threatScale: 2, hostileAt: 50, calmStability: 0.8, weak: 0.5, rich: 0.3, hungry: 0.2 } as const;

/**
 * Resources (VISION.md "Supply and demand"; M5.3): each resource a known tech needs is demanded at its people ÷
 * `peoplePerSite` units a year; a usable site worked by its mine (a quarry for stone; timber once Forestry is known)
 * supplies `siteUnits`, and forested and rough land supply timber and stone at a unit per `forestKm2` and `roughKm2`. A
 * tech's multipliers count only as far as its scarcest resource is supplied, never below `floor`.
 * `peoplePerSite` is scaled to this simulation's peoples (realms of tens of millions): VISION.md's 50,000 would leave
 * every realm short of everything (the user's decision, 8 October 2026). At 40 million a world's ~30 copper sites cover
 * about as many people as live then (unevenly: trade evens it out), and its ~9 tin sites a third of them.
 */
export const RESOURCE_TUNING = { peoplePerSite: 40_000_000, siteUnits: 1, forestKm2: 50_000, roughKm2: 50_000, floor: 0.25 } as const;

/**
 * Trade (VISION.md "Trade"; M5.4).
 * - Hubs and routes: a civilization trades through its hub, its largest living settlement with a market or harbor
 *   (else its capital). A hub carries `baseCapacity` units a year, `market` more with a market and `harbor` more with
 *   a harbor; a route carries what the poorer of its two hubs does. A route reaches `rangeKm` × the larger of the two
 *   sides' trade range (techs' `tradeRange`) between the hubs (great-circle), or `seaRangeKm` × that between two
 *   harbors.
 * - Proposing (the decision step; its view lists partners for its `resources` largest shortfalls above `minShort`, where
 *   it lacks at least `minAmount`, whose land it knows to hold the resource (its sites, or forest and rough land for
 *   timber and stone) and that it believes could spare at least `minAmount`, a belief off like that of their people):
 *   score = need × shortfall + opinionWeight × opinion ÷ 100 + openness × their culture's Openness − distance × route
 *   km ÷ its reach − cost × wealth a year ÷ its revenue.
 * - Accepting (the partner's own judgement, in truth): it spares at most `spare` of its surplus (so its own growing
 *   demand does not end the agreement at once) and needs that to be at least `minAmount`; it accepts with
 *   chance clamp01(base + gain × (what it gets: a share of its revenue, or its own shortfall relieved by barter) +
 *   opinion × its opinion ÷ 100 + openness × its Openness − tradition × its Tradition). A refusal is remembered.
 * - Terms: the amount is at most the importer's shortfall, what the exporter spares and the route's capacity; paid in
 *   barter (a resource the exporter is short of and the importer spares) or `price` wealth a unit a year.
 * - Effects: imports join what the importer has; trading partners' intimacy target rises by `intimacy` and opinion by
 *   `opinion` points; each one's faith draws the people of the other's hub by `faithDraw`.
 * - Ending (yearly per agreement): the importer's shortfall without it below `minShort`, the exporter short itself, a
 *   payment missed, opinion on either side below `cancelOpinion`, or a party gone.
 */
export const TRADE_TUNING = {
  baseCapacity: 0.5, market: 1, harbor: 1, rangeKm: 3000, seaRangeKm: 6000, resources: 2, minShort: 0.05, minAmount: 0.02, spare: 0.5,
  price: 400_000, need: 0.4, opinionWeight: 0.1, openness: 0.1, distance: 0.1, cost: 0.5,
  accept: { base: 0.6, gain: 2, opinion: 0.3, openness: 0.3, tradition: 0.3 },
  intimacy: 0.3, opinion: 15, faithDraw: 0.2, cancelOpinion: -50, refusedYears: 15,
} as const;

/**
 * Pacts, alliances and road agreements (VISION.md "Diplomacy and war", "Roads"; M5.5). Opinions are −100 to 100 and
 * enter as ÷ 100; threats are the need's per-neighbour threat (0–1).
 * - Non-aggression pact, proposed to a neighbour (its land touches its own): score = threat × the threat it feels from
 *   them + wary × its dislike of them (÷ NEED_TUNING.hostileAt, 0–1) + peace × (1 − its Militarism) − ambition × its
 *   Expansionism. The partner accepts if accept.base + accept.threat × its own fear of the proposer + accept.pressed ×
 *   the largest threat it feels from any other + accept.opinion × its opinion + accept.peace × (1 − its Militarism) −
 *   accept.ambition × its Expansionism > 0. The threat felt from a pact partner is × (1 − calm).
 * - Defensive alliance, proposed to a civilization it has met that, as far as it knows, borders a neighbour it feels
 *   threatened by (the common threat; never a pact partner of its own, nor one the other is bound to by a pact or an
 *   alliance) and that it thinks at least minOpinion of: score = threat × that threat + opinion
 *   × its opinion + kin (same lineage) + faith (same state religion) − independence × its Expansionism. The partner
 *   accepts if accept.base + accept.threat × its own fear of the common enemy + accept.opinion × its opinion + kin +
 *   faith > 0. An ally poses no threat, and `strength` × an ally's believed strength counts beside its own.
 * - Road agreement, proposed to an ally or trade partner whose land touches its own when a joint road could be built
 *   (`roads.ts` `jointRoute`): score = base + partner + opinion × its opinion + need × its infrastructure need − cost ×
 *   its own stretch's cost ÷ its revenue. The partner accepts on the same terms from its side (accept.*, with its own
 *   stretch's cost and its own infrastructure need). A completed joint road adds `capacity` to the trade routes between
 *   them.
 * - Effects: the intimacy target rises by intimacy.* and opinion by opinion.* points for each such treaty.
 * - Ending (yearly per treaty): opinion on either side below end.*, so none is proposed or accepted below it either. A
 *   refusal is remembered (`refusedTreaty`), and a treaty that soured by both (`treatySoured`); no treaty is proposed
 *   to that people again for refusedYears.
 */
export const DIPLOMACY_TUNING = {
  pact: { threat: 0.5, wary: 0.08, peace: 0.05, ambition: 0.06, calm: 0.5, accept: { base: 0.05, threat: 0.4, pressed: 0.2, opinion: 0.3, peace: 0.1, ambition: 0.15 } },
  alliance: { threat: 0.5, opinion: 0.15, kin: 0.05, faith: 0.05, independence: 0.06, minOpinion: 0, strength: 0.5, accept: { base: -0.05, threat: 0.5, opinion: 0.3, kin: 0.05, faith: 0.05 } },
  road: { base: 0.02, partner: 0.04, opinion: 0.06, need: 0.1, cost: 0.5, capacity: 1, accept: { base: 0.02, partner: 0.04, opinion: 0.06, need: 0.1, cost: 0.5 } },
  intimacy: { pact: 0.1, alliance: 0.3, road: 0.2 },
  opinion: { pact: 8, alliance: 15, road: 5 },
  end: { pact: -60, alliance: -10, road: -40 },
  refusedYears: 20,
} as const;

/**
 * Overseas voyages (VISION.md "Overseas voyages"; M5.6). A civilization that knows Sailing and holds a harbor weighs a
 * voyage at its decision step: score = novelty × (opennessWeight × Openness + expansionismWeight × Expansionism) ×
 * (base + land pressure + shortageWeight × its shortage need) + fresh (within freshYears of a new sea reach) − risk ×
 * the chance of loss at half its reach. novelty = min(1, years since its last voyage ÷ everyYears) × emptyDecay ^ (its
 * voyages in a row that found nothing, less one for every emptyFadeYears since the last; none once its sea reach has
 * grown since). The fresh bonus is × min(1, years since its last voyage ÷ everyYears) only.
 * A voyage sails from one of its harbors toward an unknown coast within reachKm[sea reach] (great-circle, from the
 * harbor's region): of the coastal regions it does not know there, it picks one weighted by nearness (1 ÷ km) and
 * `otherLand` times more on a landmass where it holds no land (a known coast too, where it has heard of a people it has
 * not met). It is lost at sea with chance min(maxLoss, lossPer1000Km[sea reach] × km ÷ 1000); otherwise it maps the
 * coast it reaches and the `strip` nearest coastal regions of that landmass, meeting whoever lives there. With nowhere
 * to head it sails half its reach and, if not lost, finds only open sea. A landmass of at
 * least `largeLand` regions is large (a voyage reaching one new to it, or meeting peoples, stands out in the chronicle).
 */
export const VOYAGE_TUNING = {
  opennessWeight: 0.5, expansionismWeight: 0.3, base: 0.2, shortageWeight: 0.3, everyYears: 100, emptyDecay: 0.5, emptyFadeYears: 200, fresh: 0.2, freshYears: 50, risk: 0.3,
  reachKm: [0, 2_000, 8_000], otherLand: 3, lossPer1000Km: [0, 0.15, 0.04], maxLoss: 0.8, strip: 6, largeLand: 10,
} as const;

/** Story health measures (VISION.md "Story health"): the largest polity's share of the world's people it may hold except
 *  for a while. */
export const STORY_TUNING = { dominantShare: 0.35 } as const;

/**
 * Armies (VISION.md "Military strength", "Grounded in history"; M6.1). A civilization's soldiers are rural people under
 * arms, who work no land.
 * - The army it means to keep, set once a year at its assessment (`decisions/army.ts`): it wants its people ×
 *   (`garrison` × (½ + Militarism) + `threat` × the threat it feels, judged against its guard); it can afford what
 *   `afford` × (½ + Militarism) × its revenue at customary taxes × (1 − arrears) pays for, but no more than its surplus
 *   at customary taxes plus `headroom` × that revenue; the target is the smaller, never below `floor` × its people. A target rising by `eventChange` or more of itself is a mobilization,
 *   falling as far the other way (to 1 ÷ (1 + eventChange) of itself) a demobilization, each by at least
 *   `eventSoldiers` (events).
 * - Each month every region's soldiers move toward its share of the target (by rural people, at most `maxShare` of
 *   them): raising closes 1/`raiseMonths` of the gap, releasing 1/`releaseMonths` (at least one soldier).
 * - A soldier costs `upkeep` × the military multiplier^`arms` wealth a year (a better-armed army costs more).
 * - Soldiers sent home add their share of the region's people to its unsettled measure, which fades with a time
 *   constant of `demobYears`; the region's stability loses `demobUnrest` × min(1, unsettled ÷ `demobScale`).
 * - Strength: a civilization's soldiers × its military multiplier; a tribe's people × `warriors` × its multiplier.
 * Revenue is about 0.07 wealth a person-year (M5's close-out), so a garrison of 0.4–0.6% of the people costs 7–10% of
 * it, and a threatened realm's 2–3% would cost 40% or more: its budget holds it to about 1% unless it is militaristic
 * or rich (historical peacetime armies kept well under 1% of their people under arms).
 */
export const ARMY_TUNING = {
  garrison: 0.004, threat: 0.02, floor: 0.001, maxShare: 0.08, raiseMonths: 12, releaseMonths: 3,
  upkeep: 1.2, arms: 0.5, afford: 0.2, headroom: 0.1, demobUnrest: 0.2, demobScale: 0.02, demobYears: 3, warriors: 0.1,
  eventChange: 0.5, eventSoldiers: 300,
} as const;

/**
 * War and peace (VISION.md "Diplomacy and war"; M6.2).
 * - Declaring (the decision step, `decisions/choose.ts` `warScore`) on a neighbour that is not an ally, outside a
 *   truce of truceYears, while it fights no war. Its goal (`claims.ts` `chooseGoal`): up to `goalRegions` of their
 *   regions, one at a time, each next to its land or the goal so far (their capital only when they hold no more), the
 *   one worth most: exp(frontierWorth × the frontier gained) × land value ÷ (land value + its own regions' mean) ×
 *   (1 + its claim). The frontier gained (`frontierGain`): each border edge taking the region would draw counts its
 *   travel cost over the world's median edge less barrierEdge, each it would close the same negated. Motives:
 *   conquest × a weaker or richer neighbour × Expansionism; farmland × hunger or land pressure × better land;
 *   resource × the shortfall the goal's sites relieve; holy × a rival faith (cooled by the secular age) × Zeal;
 *   reclamation × claims on the goal; preemptive × the threat it feels; frontier × the goal's frontier gained ÷
 *   frontierScale (within 0–1). Their sum × `weight` × (militarism + Militarism) × clamp01((odds − oddsFloor) ÷
 *   oddsSpan), the odds being its strength with its allies' × its supply to the goal against theirs with theirs × the
 *   goal's ground (`defenseOf`, below, with the walls it sees) × their supply (from their capital as the crow flies ×
 *   `winding`), less arrears × its arrears, liking × its opinion of them ÷ 100 when positive, weariness × its
 *   war-weariness (its exhaustion when its last war ended, halving every `wearyHalfLife` years), reach × how far the
 *   goal lies beyond its governance reach (its mean travel-km from the capital ÷ reach, less 1), futility × its wars on
 *   them that came to nothing (white peace or lost, each halving every futilityHalfLife years), and `treachery` for
 *   breaking a non-aggression pact with them (a war on a pact partner breaks it: an event, and the victim and the
 *   breaker's treaty partners remember it). No treaty is proposed to an enemy while they fight.
 * - Each month (the war system): strength × supply (1 ÷ (1 + travel-km from its capital to the front ÷ supplyKm)); the
 *   front is the land of the side being pushed back (the defender's goal while the score favours the attacker, the
 *   attacker's counter when it turns), and that side × its ground: (1 + ground × the front's mean defensibility + walls ×
 *   its walls' defence) × (1 + barrier × the mean crossing into it: its easiest border edge's travel cost over the
 *   world's median edge, less 1, within 0–maxCrossing). The score moves by scoreRate × (2 × odds − 1) plus
 *   noise × (a triangular draw in −1..1); each side loses casualties ÷ 12 of its engaged soldiers (soldiers × supply) ×
 *   2 × the other side's share of the strength. A side ahead holds one region it fights for per occupyStep points (one
 *   war holds a region at a time); occupied land pays its owner nothing and costs it occupiedUnrest of stability.
 *   Exhaustion rises a year by exhaustion.years + exhaustion.dead × its dead ÷ its people + exhaustion.occupied × the
 *   share of its regions occupied + exhaustion.arrears × its arrears, × (1 − calm × Militarism), to exhaustion.max. A war whose yearly dead
 *   reach notableDead (or whose occupation changed) is summarized yearly.
 * - Peace: a side at `peaceAt` exhaustion, or the attacker holding its whole goal for `goalMonths`, ends it; a side that
 *   seeks peace (peace.*) is accepted when the other is at acceptExhaustion or the terms favour it or are white. Terms
 *   by the winner's lead: below terms.white a white peace; below terms.tribute tribute; below terms.annex cession of
 *   what it holds (with tribute); above, annexation when the loser holds at most annexRegions regions or annexPeople of
 *   the winner's people, else (M6.5) vassalage when the winner is no vassal itself, else cession with tribute. Tribute:
 *   tributeShare of the loser's revenue a year for tributeYears. Holding a small realm's capital, its whole goal, for goalMonths is annexation. The loser's claims on
 *   land it lost weigh ½ every claimHalfLife years (forgotten below claimFloor); a truce of truceYears follows.
 * - Armies at war: each war adds army × its people to the soldiers it wants, and its army budget × warBudget.
 * - Allies (M6.5): when war is declared on a realm, each ally of it that has met the attacker, is not allied to it, is no
 *   vassal and fights no war with it weighs joining: allies.base + allies.opinion × its opinion of the defender ÷ 100 −
 *   allies.enmity × its opinion of the attacker ÷ 100 + allies.threat × the threat it feels from the attacker +
 *   allies.odds × (2 × the odds − 1) (its strength and the defender's as it believes it against the attacker's) −
 *   allies.weariness × its war-weariness − allies.arrears × its arrears − allies.busy if it fights a war − allies.pact if
 *   a pact binds it to the attacker; above 0 it joins (a vassal's overlord always does). An ally adds allies.share × its
 *   strength × its supply to the front to the defender's side and loses soldiers at the defender's rate; its weariness
 *   grows as a side's exhaustion does (but for occupation) and is its war-weariness at the peace.
 * - Hegemons (M6.5): a civilization whose believed strength is more than hegemon.share of all the strength a people
 *   knows of (its own and every living civilization it has met, at least hegemon.known of them) is a threat to it of
 *   hegemon.weight × (share − hegemon.share) ÷ (1 − hegemon.share), whatever it thinks of it.
 * - Vassals (M6.5): an overwhelming winner makes the loser its vassal only if it could hold it: the loser has at most
 *   vassal.maxSize × its people, and its strength is below vassal.breakFree × the winner's as it believes it (else
 *   cession with tribute). A vassal pays vassal.share of its revenue a year to its overlord, and throws it off when its
 *   strength reaches vassal.breakFree × its overlord's as it believes it.
 */
export const WAR_TUNING = {
  goalRegions: 3, truceYears: 25, wearyHalfLife: 25,
  declare: { weight: 0.4, militarism: 0.25, oddsFloor: 0.35, oddsSpan: 0.35, conquest: 0.5, farmland: 0.4, resource: 0.5, holy: 0.3, reclamation: 0.5, preemptive: 0.3, frontier: 0.2, arrears: 0.3, liking: 0.15, weariness: 0.3, treachery: 0.04, reach: 0.1, futility: 0.1 },
  supplyKm: 1500, winding: 1.4, ground: 0.5, walls: 1, barrier: 1, maxCrossing: 3, frontierWorth: 1, frontierScale: 2, barrierEdge: 1.25, scoreRate: 4, noise: 2, casualties: 0.12, occupyStep: 25,
  exhaustion: { years: 0.08, dead: 40, occupied: 0.6, arrears: 0.3, max: 2 }, calm: 0.5, notableDead: 200,
  peaceAt: 1, goalMonths: 12, acceptExhaustion: 0.4,
  peace: { exhaustion: 0.4, losing: 0.3, terms: 0.3, militarism: 0.1, base: -0.05 },
  terms: { white: 15, tribute: 40, annex: 75 }, tributeShare: 0.1, tributeYears: 10, annexRegions: 4, annexPeople: 0.25,
  claimHalfLife: 75, claimFloor: 0.05, futilityHalfLife: 60, army: 0.02, warBudget: 1.5, occupiedUnrest: 0.3,
  allies: { base: 0.1, opinion: 0.3, enmity: 0.2, threat: 0.3, odds: 0.3, weariness: 0.3, arrears: 0.3, busy: 0.3, pact: 0.2, share: 0.5 },
  hegemon: { share: 0.3, known: 4, weight: 1 },
  vassal: { share: 0.15, breakFree: 1, maxSize: 2 },
} as const;

/**
 * The ravages of war (VISION.md "Diplomacy and war", "Destruction"; M6.3).
 * - Devastation (monthly): an occupied region gains devastate ÷ 12 (at most 1), and its fields lose fieldLoss ÷ 12 ×
 *   devastation of their cultivated land; elsewhere it halves every fadeYears (gone below `gone`). The harvest comes in
 *   × (1 − harvestCut × devastation); the region's stability loses unrest × devastation; while occupied, flee ×
 *   devastation of its people leave a year as refugees.
 * - Ravages (monthly per occupied region): each living settlement but a capital is razed with chance raze ÷ 12, else
 *   burned with burn ÷ 12, else looted with loot ÷ 12, each × the occupier's intent (½ + Militarism) × (1 + hatred × a
 *   holy war or a rival state religion) × (1 − its walls' defence), razing × keepRaze where the occupier fights to keep
 *   the land. Looting takes lootShare of the owner's treasury × the settlement's share of its townspeople (or of its
 *   people, shared among the region's settlements, if larger) and lootFood of the region's stored food (shared among its
 *   settlements); burning destroys each building with chance burnBuildings, kills burnKill and drives out burnFlee of
 *   its townspeople; razing kills razeKill and drives out the rest, and adds razedExhaustion to its owner's side of the
 *   war. A bridged road loses its bridge with chance bridgeRate ÷ 12; a road without one is destroyed with roadRate ÷ 12.
 * - Refugees go to the owner's nearest region not occupied; a flight of refugeeEvent people or more is an event (from
 *   devastated land, the year's flight at once).
 * - Rebuilding: a region left without a settlement founds one when its occupation is over, each month with chance
 *   rebuild ÷ 12 × (1 − devastation), and at the latest when its devastation is gone: on its ruins, or with chance
 *   `fresh` on a free site beside them (the ruins left standing) where there is one.
 * - War income: loot and tribute received, halving every incomeYears; a realm's army budget adds warIncome × it.
 */
export const RAVAGE_TUNING = {
  devastate: 0.5, fieldLoss: 0.3, fadeYears: 4, gone: 0.01, harvestCut: 0.6, unrest: 0.25, flee: 0.05,
  raze: 0.06, burn: 0.06, loot: 0.2, hatred: 1, keepRaze: 0.25, lootShare: 0.5, lootFood: 0.4, razedExhaustion: 0.05, rebuild: 0.3, fresh: 0.5,
  burnBuildings: 0.4, burnKill: 0.05, burnFlee: 0.15, razeKill: 0.3, bridgeRate: 0.3, roadRate: 0.25,
  refugeeEvent: 2000, incomeYears: 10, warIncome: 0.1,
} as const;

/**
 * Raids and confederations (VISION.md "Raids", M6 "threat drives consolidation"; M6.4).
 * - Raids (yearly per tribe band, staggered by band): next to a civilization's region, a band weighs a raid with chance
 *   rate × (hunger × its hunger + herding × its herding share) × riches × odds, at most maxChance: riches its store's
 *   months of food a head over richMonths (at most 1), odds its warriors (people × ARMY_TUNING.warriors × its military
 *   multiplier) against theirs and the walls' (soldiers × multiplier × (1 + walls × walls' defence) + watch × people ×
 *   walls' defence). A raid takes take of their store (at most carryMonths of food a head for the band), kills
 *   raiderDeaths × (1 − odds) of its warriors and defenderDeaths × odds × (1 − walls' defence) of their people (war
 *   deaths), and burns a building with chance burn × (1 − walls' defence). The region remembers it: its raid memory
 *   rises by memory (at most 1) and halves every memoryYears; it calls for walls there, and is a threat its realm feels
 *   (army and unions, weighed by the people of its raided land). A raid cites hunger × its hunger, herding × its herding
 *   share and richesCause × riches.
 * - Confederations (each January): a tribe that raided lately (its raids, halved each year) may, with one chance a year
 *   of confederate × min(1, its raids ÷ confederateRaids), draw in the largest smaller kin tribe next to it, which joins
 *   whole (cited: raiding, and kin × kinCause).
 */
export const RAID_TUNING = {
  rate: 0.6, hunger: 1, herding: 0.6, richMonths: 24, walls: 2, watch: 0.002, maxChance: 0.5, richesCause: 0.5, kinCause: 0.5,
  take: 0.25, carryMonths: 6, raiderDeaths: 0.05, defenderDeaths: 0.002, burn: 0.15,
  memory: 0.5, memoryYears: 10, confederate: 0.1, confederateRaids: 5,
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
  if (!(p.storeMonths >= 0 && p.storeSpoilage >= 0 && p.storeSpoilage <= 1 && p.reserveMonths >= 0)) problems.push('store limits must be non-negative and spoilage at most 1');
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
  if (![c.driftRate, c.influenceRate, c.splitRate].every(rate => rate >= 0 && rate <= 1) || !(c.foreignContact >= 0 && c.confidence > 0 && c.heartPull >= 0 && c.fashion >= 0 && c.fashion < 0.5 && c.prestigeEra >= 0 && c.prestigeWonder >= 0 && c.prestigeCity >= 0 && c.prestigeWealth >= 0 && c.wealthPerPerson > 0 && c.townShare > 0 && c.townShare <= 1 && c.seaShare >= 0 && c.seaShare <= 1 && c.splitNote >= 0 && c.hueStep > 0)) problems.push('culture drift and influence rates are invalid');
  if (![c.assimilationRate, c.assimilationTradition, c.assimilationTolerance, c.hybridRate, c.kinShare, c.fusionBlend].every(value => value >= 0 && value <= 1) || !(c.hybridShare > 0 && c.hybridShare <= 0.5) || !(Number.isInteger(c.hybridYears) && c.hybridRange * (1 - c.fusionBlend) < c.splitDivergence) || !(c.assimilationRange > 0 && c.assimilationRange * (1 - c.assimilationBlend) < c.splitDivergence && c.assimilationBlend >= 0 && c.assimilationBlend <= 1 && c.hybridRange > 0 && c.hybridYears >= 0)) problems.push('assimilation and hybrid settings are invalid');
  const ft = FAITH_TUNING;
  if (![ft.foundingRate, ft.reformation, ft.stateHold, ft.conversionRate, ft.zealFloor, ft.foreignContact, ft.folkAttachment, ft.faithAttachment].every(value => value >= 0 && value <= 1) || ft.zealFloor >= 1
    || ![ft.crisisScale, ft.tenetFavour, ft.stateSupport, ft.templeSupport, ft.holyDraw, ft.friction, ft.zealFriction, ft.religionZealBase, ft.monumentWeight].every(value => value >= 0) || !(ft.traditionHold >= 0 && ft.traditionHold <= 1 && ft.asceticWealth > 0 && ft.asceticWealth <= 1)
    || !(Number.isInteger(ft.schismRegions) && ft.schismRegions >= 1 && Number.isInteger(ft.schismYears) && ft.schismYears >= 1 && ft.schismRate >= 0 && ft.schismRate <= 1 && ft.sectHueShift >= 0 && ft.sectHueShift <= 180 && ft.secularPerTech >= 0 && ft.secularMax >= 0 && ft.secularMax <= 1)
    || !(Number.isInteger(ft.minTenets) && Number.isInteger(ft.maxTenets) && ft.minTenets >= 1 && ft.maxTenets >= ft.minTenets && ft.maxTenets <= TENETS.length)) problems.push('faith settings are invalid');
  if (new Set(TENETS.map(tenet => tenet.key)).size !== TENETS.length || TENETS.some(tenet => (tenet.excludes ?? []).some(key => !TENETS.some(other => other.key === key))
    || Object.values(tenet.pulls).some(pull => !(Math.abs(pull ?? 0) <= 0.3)) || !((tenet.spread ?? 1) > 0) || !((tenet.friction ?? 1) >= 0) || !((tenet.stability ?? 0) >= 0))) problems.push('tenet data is invalid');
  const t = TRAIT_TUNING;
  if (![t.share, t.inherit, t.herding, t.farming].every(value => value >= 0 && value <= 1) || !(Number.isInteger(t.max) && t.max >= 1 && t.max <= 8)) problems.push('trait settings are invalid');
  // Trait data (traits.ts): unique keys, known conditions, years of at least one, small pulls.
  if (new Set(TRAITS.map(trait => trait.key)).size !== TRAITS.length || TRAITS.some(trait => !TRAIT_CONDITIONS.includes(trait.condition) || !(Number.isInteger(trait.years) && trait.years >= 1)
    || Object.values(trait.pulls).some(pull => !(Math.abs(pull ?? 0) <= 0.3)))) problems.push('trait data is invalid');
  if (!(c.splitDivergence > 0 && c.splitDivergence < 1 && Number.isInteger(c.splitRegions) && c.splitRegions >= 1 && Number.isInteger(c.languageChanges) && c.languageChanges >= 0 && c.hueShift >= 0 && c.hueShift <= 180)) problems.push('culture splitting settings are invalid');
  for (const key of VALUE_NAMES) {
    const pull = CULTURE_PULLS[key];
    if (!pull || !(pull.base >= 0 && pull.base <= 1) || pull.pulls.some(entry => !PULL_MEASURES.includes(entry.measure) || !(Math.abs(entry.weight) <= 1))) problems.push(`the pulls on ${key} need a base within 0–1 and known measures with weights within ±1`);
  }
  const n = NAME_TUNING;
  if (![n.thirdSyllable, n.initialCluster, n.initialConsonant, n.coda].every(value => value >= 0 && value <= 1) || !(n.minLength >= 1 && n.maxLength >= n.minLength)) problems.push('name shapes are invalid');
  if (!(Number.isInteger(SERIES_YEARS) && SERIES_YEARS >= 1)) problems.push('the chart series step must be whole years');
  if (!(Number.isInteger(CENSUS_YEARS) && CENSUS_YEARS >= 1)) problems.push('the census step must be whole years');
  const sp = SPAWN_TUNING;
  if (!(Number.isInteger(sp.bands) && sp.bands >= 1 && sp.minPopulation >= 1 && sp.maxPopulation >= sp.minPopulation && sp.minSpacingKm >= 0)) problems.push('spawn settings are invalid');
  if (!(sp.temperatureWidth > 0 && sp.waterBonus >= 0)) problems.push('spawn weights are invalid');
  const re = RESEARCH_TUNING;
  if (!(re.basePeople >= 1 && re.scalePower >= 0 && re.scalePower <= 1 && [re.basePerPerson, re.contactBonus, re.specialistResearch, re.needWeight, re.shareWeight, re.shareSpeed, re.catchUpPerEra].every(value => value >= 0)
    && Number.isInteger(re.catchUpEras) && re.catchUpEras >= 0 && re.traditionBrake >= 0 && re.traditionBrake < 1 && Number.isInteger(re.contactCap) && re.contactCap >= 0)) problems.push('research weights are invalid');
  if (!(Number.isInteger(re.contactRadius) && re.contactRadius >= 1 && Number.isInteger(re.contactMonths) && re.contactMonths >= 1)) problems.push('contact settings are invalid');
  if (!(re.opennessBase >= 0 && re.blockedWeight >= 1 && re.reasonMin >= 0 && Number.isInteger(re.reasonCount) && re.reasonCount >= 1)) problems.push('research weight settings are invalid');
  if (!(re.fertileQuantile > 0 && re.fertileQuantile < 1 && Number.isInteger(re.fertileRiverTier) && re.fertileRiverTier >= 0 && re.fertileRiverTier <= 3)) problems.push('the fertile river land class is invalid');
  if (!(re.effortYears > 0 && re.switchRatio >= 1)) problems.push('effort settings are invalid');
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
  if (!(SPECIALIST_TUNING.slope >= 0 && SPECIALIST_TUNING.floor >= 0 && SPECIALIST_TUNING.floor <= 1 && SPECIALIST_TUNING.baseCap >= 0 && SPECIALIST_TUNING.baseCap < 1 && SPECIALIST_TUNING.maxShare > 0 && SPECIALIST_TUNING.maxShare < 1 && SPECIALIST_TUNING.adjust > 0 && SPECIALIST_TUNING.adjust <= 1)) problems.push('specialist settings are invalid');
  const st = SETTLE_TUNING;
  if (!(st.fromYears >= 0 && st.spanYears > 0 && st.baseShare >= 0 && st.baseShare <= 1 && st.rate > 0 && st.rate <= 1 && st.farmingPower > 0 && st.scalePeople >= 0 && st.scalePower > 0 && st.scaleFloor > 0 && st.scaleFloor <= 1)) problems.push('settling settings are invalid');
  if (!(MOBILITY_TUNING.coastalSailingKm > 0)) problems.push('the coastal sailing reach must be positive');
  const se = SETTLEMENT_TUNING;
  if (!(se.tiers.length === 4 && se.tiers[0] === 0 && se.tiers.every((value, at) => at === 0 || value > se.tiers[at - 1]) && se.demote > 0 && se.demote < 1
    && Number.isInteger(se.baseHousing) && se.baseHousing > 0 && se.capitalHousing >= 1 && se.foundAt > 0 && se.foundAt <= 1 && se.keepName >= 0 && se.keepName <= 1
    && Number.isInteger(se.meanMonths) && se.meanMonths >= 1 && se.tierImportance.length === 4 && [...se.tierImportance, se.fallImportance].every(value => value >= 0 && value <= 1)
    && se.fallCause >= 0 && se.fallFamineScale > 0 && Number.isInteger(se.tierYears) && se.tierYears >= 1)) problems.push('settlement settings are invalid');
  const d = DECISION_TUNING;
  if (!(Number.isInteger(d.months) && d.months >= 1 && d.minScore >= 0 && d.doNothing > d.minScore && d.doNothing <= 1 && Number.isInteger(d.topChoices) && d.topChoices >= 1 && Number.isInteger(d.logSize) && d.logSize >= 1 && Number.isInteger(d.factorCount) && d.factorCount >= 1)) problems.push('decision settings are invalid');
  const reach = REACH_TUNING;
  if (!(reach.baseKm > 0 && reach.seaFactor >= 1 && reach.riverCrossing.length === 4 && reach.riverCrossing.every(value => value >= 0) && reach.foreignRelay >= 1 && reach.searchReaches > 0 && reach.fallbackFactor >= 1)) problems.push('reach settings are invalid');
  const e = EXPAND_TUNING;
  if (!(e.hungerWeight >= 0 && e.opportunityWeight >= 0 && e.valuePower > 0 && e.valuePower <= 1 && e.occupiedValue > 0 && e.occupiedValue <= 1 && e.expansionismBase >= 0 && e.distancePerKm >= 0 && e.reachWeight >= 0 && e.reachPower > 0)) problems.push('expansion scoring is invalid');
  if (!(e.settlerShare > 0 && e.settlerShare < 0.5 && e.settlerRoom > 0 && e.settlerRoom <= 1 && Number.isInteger(e.minSettlers) && e.minSettlers >= 1)) problems.push('settler settings are invalid');
  if (!(e.absorbMin >= 0 && e.absorbMin <= e.absorbMax && e.absorbMax <= 1 && e.absorbSize >= 0 && e.absorbTradition >= 0)) problems.push('absorption settings are invalid');
  if (!(MIGRATION_TUNING.rate > 0 && MIGRATION_TUNING.rate < 0.5)) problems.push('the migration rate must be in (0, 0.5)');
  const j = JOIN_TUNING;
  if (!(Object.values(j).every(value => value >= 0) && j.prestigeScale > 0 && j.foundScore > 0 && j.admitPower > 0)) problems.push('joining settings are invalid');
  const u = UNITE_TUNING;
  if (!(Object.values(u).every(value => value >= 0) && u.sizeScale > 0 && u.admitPower > 0 && u.strainRefusal <= 1)) problems.push('unification settings are invalid');
  if (!(WEALTH_TUNING.hardshipFade >= 0 && WEALTH_TUNING.hardshipFade < 1 && WEALTH_TUNING.stoneDiscount > 0 && WEALTH_TUNING.stoneDiscount <= 1
    && Object.values(WEALTH_TUNING.siteYield).every(value => value >= 0))) problems.push('wealth settings are invalid');
  const bg = BUDGET_TUNING;
  if (!(Object.values(bg).every(value => value >= 0) && bg.townOutput > 0 && bg.hungerLine < 1 && bg.minRate > 0 && bg.minRate < bg.customaryRate && bg.customaryRate < bg.maxRate && bg.maxRate <= 1
    && bg.heavyRate > bg.customaryRate && bg.heavyRate <= bg.maxRate && bg.rateStep > 0 && bg.refillYears > 0 && bg.calmFull > bg.calmFloor && bg.calmFull <= 1 && bg.sizeScale > 0 && bg.ageYears > 0 && bg.servicesScale > 0
    && bg.arrearsMonths >= 1 && bg.arrearsCore <= 1 && bg.arrearsEvent > 0 && bg.arrearsEvent <= 1 && Number.isInteger(bg.keptYears) && bg.keptYears >= 1)) problems.push('budget settings are invalid');
  const rl = RELIEF_TUNING;
  if (!(rl.months > 0 && rl.costPer1000Km >= 0 && rl.kmPerMonth > 0 && rl.treasuryShare > 0 && rl.treasuryShare <= 1 && Number.isInteger(rl.episodeMonths) && rl.episodeMonths >= 1)) problems.push('relief settings are invalid');
  const bu = BUILD_TUNING;
  if (!([bu.sizeScale, bu.frontierScale, bu.batchRegions, bu.treasuryYears, bu.decayMonths, bu.recoverMonths, bu.neglectDecayMonths, bu.neglectRoadMonths, bu.mineScale, bu.seaScale, bu.wonderCity, bu.farmScale, bu.waitMonths].every(value => value > 0) && bu.irrigationBase >= 0 && bu.seaBase >= 0 && bu.roadReuse > 0 && bu.roadReuse <= 1 && bu.wonderWeight >= 0 && bu.roadBase >= 0 && bu.roadOpenness >= 0 && bu.roadReach >= 0 && bu.roadUpkeep >= 0 && bu.roadDecayMonths > 0 && bu.goldenFrom >= 0 && bu.goldenFrom < 1 && [bu.farmStore, bu.faithBase, bu.learningBase, bu.tradeBase, bu.tradeOpenness, bu.defenseBase, bu.cost, bu.upkeepWeight, bu.surplusFloor].every(value => value >= 0)
    && bu.crowdFrom >= 0 && bu.crowdFrom < 1 && Number.isInteger(bu.batchMax) && bu.batchMax >= 1 && Object.values(bu.purposeWeight).every(value => value >= 0))) problems.push('building settings are invalid');
  const sh = SHARE_TUNING;
  if (!(Object.values(sh).every(value => value >= 0) && sh.techScale > 0 && sh.refusal <= 1 && sh.gainBase <= 1 && Number.isInteger(sh.years) && sh.years >= 1 && Number.isInteger(sh.refusedYears))) problems.push('sharing settings are invalid');
  const en = ENVIRONMENT_TUNING;
  if (!(en.harvestSpread >= 0 && en.harvestMin > 0 && en.harvestMin <= 1 && en.harvestMax >= 1 && en.droughtChance >= 0 && en.droughtChance * en.aridDrought <= 1 && Number.isInteger(en.droughtYears) && en.droughtYears >= 1 && en.droughtYears * 12 <= 255
    && en.droughtSpread >= 0 && en.droughtSpread <= 1 && en.droughtFarmLoss >= 0 && en.droughtFarmLoss < 1 && en.droughtHerdLoss >= 0 && en.droughtHerdLoss < 1
    && en.famineFade > 0 && en.famineFade < 1 && en.famineShare > en.famineEnd && en.famineEnd > 0 && en.famineMin >= 0 && en.famineCause >= 0)) problems.push('environment settings are invalid');
  const fi = FIELD_TUNING;
  if (!(fi.fieldFactor >= 1 && fi.minDensity >= 0 && fi.clearRate > 0 && fi.clearRate <= 12 && fi.fallowRate > 0 && fi.fallowRate <= 12 && fi.uncleared >= 0 && fi.uncleared <= 1 && fi.closeCells > 0
    && fi.shrinkYears > 0 && fi.shrinkMargin >= 0 && fi.shrinkMargin < 1 && fi.watchYears >= fi.shrinkYears)) problems.push('field settings are invalid');
  const st2 = STABILITY_TUNING;
  if (!(st2.base > 0 && st2.base <= 1 && st2.hunger >= 0 && st2.overextension >= 0 && st2.overextensionCap >= 0 && st2.foreignRule >= 0 && st2.strain >= 0 && st2.strainCore >= 0 && st2.strainCore <= 1 && st2.unrestBelow > 0 && st2.unrestBelow + st2.hysteresis <= 1 && st2.hysteresis >= 0 && st2.outputLoss >= 0 && st2.outputLoss < 1 && st2.researchLoss >= 0 && st2.researchLoss <= 1)) problems.push('stability settings are invalid');
  if (!(STORY_TUNING.dominantShare > 0 && STORY_TUNING.dominantShare < 1)) problems.push('story health settings are invalid');
  const tr = TRADE_TUNING;
  if (!([tr.baseCapacity, tr.market, tr.harbor, tr.rangeKm, tr.seaRangeKm, tr.price, tr.need, tr.opinionWeight, tr.openness, tr.distance, tr.cost, tr.intimacy, tr.opinion, tr.faithDraw].every(value => value >= 0) && tr.baseCapacity > 0 && tr.price > 0
    && Number.isInteger(tr.resources) && tr.resources >= 1 && tr.minShort > 0 && tr.minShort < 1 && tr.minAmount > 0 && tr.spare > 0 && tr.spare <= 1 && tr.cancelOpinion >= -100 && tr.cancelOpinion <= 0 && tr.refusedYears > 0
    && Object.values(tr.accept).every(value => value >= 0))) problems.push('trade settings are invalid');
  const dp = DIPLOMACY_TUNING;
  const numbers = (entry: object): number[] => Object.values(entry).flatMap(value => typeof value === 'number' ? [value] : numbers(value as object));
  if (!(numbers(dp).every(Number.isFinite) && [dp.pact, dp.alliance, dp.road].every(entry => Object.entries(entry).every(([key, value]) => key === 'accept' || key === 'minOpinion' || (value as number) >= 0))
    && dp.pact.calm <= 1 && dp.alliance.strength <= 1 && dp.alliance.minOpinion >= -100 && dp.alliance.minOpinion <= 100
    && Object.values(dp.end).every(value => value >= -100 && value <= 100) && Object.values(dp.intimacy).every(value => value >= 0 && value <= 1) && dp.refusedYears > 0)) problems.push('diplomacy settings are invalid');
  const vy = VOYAGE_TUNING;
  if (!([vy.opennessWeight, vy.expansionismWeight, vy.base, vy.shortageWeight, vy.fresh, vy.risk].every(value => value >= 0) && vy.everyYears > 0 && vy.emptyFadeYears > 0 && vy.emptyDecay >= 0 && vy.emptyDecay <= 1 && vy.freshYears >= 0
    && vy.reachKm.length === 3 && vy.lossPer1000Km.length === 3 && vy.reachKm.every(value => value >= 0) && vy.lossPer1000Km.every(value => value >= 0) && vy.maxLoss >= 0 && vy.maxLoss < 1
    && vy.otherLand >= 1 && Number.isInteger(vy.strip) && vy.strip >= 1 && vy.largeLand >= 1)) problems.push('voyage settings are invalid');
  const rs = RESOURCE_TUNING;
  if (!(rs.peoplePerSite > 0 && rs.siteUnits > 0 && rs.forestKm2 > 0 && rs.roughKm2 > 0 && rs.floor >= 0 && rs.floor <= 1)) problems.push('resource settings are invalid');
  const nt = NEED_TUNING;
  if (!(nt.threatScale > 1 && nt.hostileAt > 0 && nt.hostileAt <= 100 && nt.calmStability > 0 && nt.calmStability <= 1 && nt.weak >= 0 && nt.rich >= 0 && nt.hungry >= 0 && nt.hungry <= 1)) problems.push('need settings are invalid');
  const rt = RELATION_TUNING;
  if (!(rt.biasSpread >= 0 && rt.biasMin > -1 && rt.biasMin <= 0 && rt.biasMax >= 0 && rt.rise > 0 && rt.rise <= 1 && rt.fade > 0 && rt.fade <= 1)
    || ![rt.border, rt.contact, rt.exchange].every(value => value >= 0 && value <= 1) || ![rt.sameFaith, rt.rivalFaith, rt.culture, rt.kin, rt.sharing, rt.borderTension].every(value => value >= 0 && value <= 100)
    || Object.values(rt.memories).some(memory => !(Math.abs(memory.points) <= 100 && memory.halfLifeYears > 0)) || !(rt.forgetBelow > 0 && Number.isInteger(rt.reasonCount) && rt.reasonCount >= 1)
    || !(rt.culturePivot >= 0 && rt.culturePivot < 1 && rt.borderScale > 0 && rt.correction >= 0 && rt.correction <= 1)) problems.push('relation settings are invalid');
  const ar = ARMY_TUNING;
  if (!([ar.garrison, ar.threat, ar.floor, ar.upkeep, ar.arms, ar.afford, ar.headroom, ar.demobUnrest, ar.eventSoldiers].every(value => value >= 0 && Number.isFinite(value)) && ar.floor <= ar.garrison
    && ar.maxShare > 0 && ar.maxShare <= 1 && ar.raiseMonths >= 1 && ar.releaseMonths >= 1 && ar.demobScale > 0 && ar.demobYears > 0 && ar.demobUnrest <= 1
    && ar.warriors >= 0 && ar.warriors <= 1 && ar.eventChange > 0 && ar.eventChange <= 1)) problems.push('army settings are invalid');
  const wt = WAR_TUNING;
  const warNumbers = (entry: object): number[] => Object.values(entry).flatMap(value => typeof value === 'number' ? [value] : warNumbers(value as object));
  // (Seeking peace has a base below zero: Do nothing outweighs it until a war tires or turns; an ally's base may be either.)
  if (!(warNumbers({ ...wt, peace: { ...wt.peace, base: 0 }, allies: { ...wt.allies, base: 0 } }).every(value => Number.isFinite(value) && value >= 0) && Number.isFinite(wt.peace.base) && wt.peace.base > -1
    && Number.isFinite(wt.allies.base) && Math.abs(wt.allies.base) < 1 && Number.isInteger(wt.goalRegions) && wt.goalRegions >= 1 && wt.goalRegions <= 8
    && wt.declare.oddsSpan > 0 && wt.declare.oddsFloor < 1 && wt.supplyKm > 0 && wt.occupyStep > 0 && wt.occupyStep <= 100 && wt.peaceAt > 0 && wt.acceptExhaustion <= wt.peaceAt
    && wt.terms.white < wt.terms.tribute && wt.terms.tribute < wt.terms.annex && wt.terms.annex <= 100 && wt.tributeShare <= 1 && wt.annexPeople <= 1 && wt.claimHalfLife > 0
    && wt.calm <= 1 && wt.casualties <= 1 && wt.occupiedUnrest <= 1 && wt.frontierScale > 0 && wt.winding >= 1 && wt.maxCrossing > 0 && wt.exhaustion.max >= wt.peaceAt
    && wt.claimFloor < 1 && wt.futilityHalfLife > 0 && wt.allies.share <= 1 && wt.hegemon.share < 1 && Number.isInteger(wt.hegemon.known) && wt.hegemon.known >= 1
    && wt.vassal.share <= 1 && wt.vassal.breakFree > 0 && wt.vassal.maxSize > 0)) problems.push('war settings are invalid');
  const rv = RAVAGE_TUNING;
  if (!(Object.values(rv).every(value => Number.isFinite(value) && value >= 0) && rv.fadeYears > 0 && rv.incomeYears > 0 && rv.devastate <= 12 && rv.gone < 1
    && [rv.fieldLoss, rv.harvestCut, rv.unrest, rv.flee, rv.raze, rv.burn, rv.loot, rv.keepRaze, rv.lootShare, rv.lootFood, rv.burnBuildings, rv.burnKill, rv.burnFlee, rv.razeKill, rv.bridgeRate, rv.roadRate, rv.razedExhaustion, rv.rebuild, rv.fresh].every(value => value <= 1)
    && rv.raze + rv.burn + rv.loot <= 1 && rv.burnKill + rv.burnFlee <= 1)) problems.push('ravage settings are invalid');
  const rd = RAID_TUNING;
  if (!(Object.values(rd).every(value => Number.isFinite(value) && value >= 0) && rd.richMonths > 0 && rd.memoryYears > 0 && rd.confederateRaids > 0
    && [rd.maxChance, rd.take, rd.raiderDeaths, rd.defenderDeaths, rd.burn, rd.memory, rd.confederate].every(value => value <= 1))) problems.push('raid settings are invalid');
  const x = EXPLORE_TUNING;
  if (!(x.opennessWeight >= 0 && x.expansionismWeight >= 0 && x.base >= 0 && x.frontierScale > 0 && x.freshMobility >= 0 && x.freshYears > 0 && x.range.length === 3 && x.range.every(steps => Number.isInteger(steps) && steps >= 1))) problems.push('exploration settings are invalid');
  if (problems.length) throw new Error(`Invalid simulation tunables: ${problems.join('; ')}.`);
}
