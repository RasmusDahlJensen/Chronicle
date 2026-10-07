import type { WorldBiome } from '../../shared/generated-world.ts';
import { VALUE_NAMES } from '../../shared/simulation.ts';
import { TRAIT_CONDITIONS, TRAITS } from './traits.ts';
import { TENETS } from './religions.ts';

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
 * civilization admits it with chance 1 ÷ (1 + (travel-km from its capital to where they meet ÷ its reach)^admitPower)
 * × (1 − strainRefusal × its own budget strain): a realm already strained is loath to take in more (M3c).
 */
export const UNITE_TUNING = {
  kin: 0.16, similarity: 0.08, size: 0.22, sizeScale: 1.5, fed: 0.03, stability: 0.03, trouble: 0.25,
  tradition: 0.06, expansionism: 0.06, contentment: 0.1, crossing: 0.25, admitPower: 4, strainRefusal: 0.6,
  /** A civilization turned away does not ask the same one again for this many years. */
  rebuffYears: 30,
} as const;

/**
 * Regional stability (VISION.md "Stability", M3's basic form), yearly per civilization: base − hunger × (1 − food
 * security) − min(overextensionCap, overextension × (travel-km from the capital ÷ reach − 1, if beyond reach)) −
 * foreignRule × (1 − similarity) where a people of another culture lives − strain × (the realm's size factor × age
 * factor − 1) × (strainCore + (1 − strainCore) × min(1, remoteness)): a large, old realm holds its far provinces less
 * firmly (VISION.md M3c: empire strain; the factors are BUDGET_TUNING's administration factors) − its taxes and
 * arrears (BUDGET_TUNING) + its buildings' and wonders'. Below `unrestBelow` a region falls into unrest (an event)
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
 * Expansionism) × (base + land pressure), plus `freshMobility` within `freshYears` of a new sea reach. Curiosity is the
 * number of unknown regions next to its sight over `frontierScale` (at most 1). An expedition walks `range[sea]`
 * steps (foot, coastal sailing, ocean navigation) from the own region with the most unknown neighbours, mapping
 * what it passes and meeting who lives there.
 */
export const EXPLORE_TUNING = {
  opennessWeight: 0.5, expansionismWeight: 0.5, base: 0.3, frontierScale: 8, freshMobility: 0.3, freshYears: 50,
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
  learn: 0.2, kin: 0.03, similarity: 0.02, openness: 0.06, techScale: 4, tradition: 0.12, busy: 0.05, refusal: 1, gainBase: 0.5,
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
 *   housing: clamp((townspeople ÷ housing − crowdFrom) ÷ (1 − crowdFrom), 0, 1); defense: min(1, foreign neighbours ÷
 *   frontierScale) × (defenseBase + Militarism).
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

/** Statistics sampled for the lab's world chart. */
export const SERIES_YEARS = 1;

/** Story health measures (VISION.md "Story health"): the largest polity's share of the world's people it may hold except
 *  for a while. */
export const STORY_TUNING = { dominantShare: 0.35 } as const;

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
  const x = EXPLORE_TUNING;
  if (!(x.opennessWeight >= 0 && x.expansionismWeight >= 0 && x.base >= 0 && x.frontierScale > 0 && x.freshMobility >= 0 && x.freshYears > 0 && x.range.length === 3 && x.range.every(steps => Number.isInteger(steps) && steps >= 1))) problems.push('exploration settings are invalid');
  if (problems.length) throw new Error(`Invalid simulation tunables: ${problems.join('; ')}.`);
}
