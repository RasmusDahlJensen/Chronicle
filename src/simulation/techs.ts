import type { Resource } from '../../shared/atlas.ts';
import { ERA_NAMES } from '../../shared/simulation.ts';

/**
 * The technology graph in data (VISION.md "Knowledge and technology"). Every polity researches the same graph on its
 * own path. Effects are limited to kinds the systems already understand, so new techs never need new code:
 * coefficient multipliers, food methods, resource reveal/extraction/use, mobility and unlocks. Costs are research
 * points; one person earns `RESEARCH_TUNING.basePerPerson` a year before specialists. The extraction requirements in
 * `src/world/resources.ts` (`RESOURCE_RULES`) must name techs here exactly (tested).
 */
export const ERAS = ERA_NAMES;
export type Era = typeof ERAS[number];
export const MOBILITY = ['foot', 'riverBoats', 'coastalSailing', 'oceanNavigation', 'rail', 'flight', 'space'] as const;
export type Mobility = typeof MOBILITY[number];

/** Coefficients a tech can multiply. Food yields per method; storage in months and monthly spoilage; the specialist cap. */
export type Coefficient = 'forageYield' | 'huntYield' | 'fishYield' | 'herdYield' | 'farmYield' | 'storeMonths' | 'spoilage'
  | 'specialistCap' | 'research' | 'mortality' | 'birthRate' | 'reach' | 'military' | 'tradeRange' | 'disease';
/** Environment conditions that raise a tech's research weight (VISION.md "environment"). Known-but-unusable deposits
 *  raise every extraction tech the same way (`RESEARCH_TUNING.blockedWeight`). */
export type Affinity = 'coastal' | 'riverOrLake' | 'fertileRiver' | 'grassland' | 'forest' | 'rough' | 'arid' | 'cold'
  | 'grainSite' | 'gameSite' | 'fishSite';
/** What a tech is for, read by the need and culture weights. */
export type TechTag = 'food' | 'storage' | 'sailing' | 'mining' | 'metal' | 'military' | 'scholarship' | 'governance' | 'religion'
  | 'trade' | 'construction' | 'industry' | 'energy' | 'medicine' | 'economy';

export interface TechEffects {
  multiply?: Partial<Record<Coefficient, number>>;
  /** Food methods this tech makes available (beyond foraging, hunting and fishing). */
  methods?: ('herd' | 'farm')[];
  reveal?: Resource[]; extract?: Resource[]; use?: Resource[];
  mobility?: Mobility;
  /** Governments, buildings, wonders, infrastructure, actions and treaties used by later milestones. */
  unlocks?: string[];
}
export interface TechDefinition {
  id: string; name: string; era: Era; requires: string[]; cost: number; tags: TechTag[];
  affinity?: Partial<Record<Affinity, number>>;
  /** Base research weight before need, environment, shared knowledge and culture (1 unless set): a tech that is
   *  rarely invented without its environment has a low base and a strong affinity. */
  weight: number;
  effects: TechEffects;
  /** May be lost when a successor's specialists or libraries fall below a threshold (M7). */
  requiresScale?: boolean;
}

const tech = (name: string, era: Era, requires: string[], cost: number, tags: TechTag[], effects: TechEffects = {}, affinity?: TechDefinition['affinity'], requiresScale = false, weight = 1): TechDefinition =>
  ({ id: name, name, era, requires, cost, tags, effects, affinity, requiresScale, weight });

export const TECHS: readonly TechDefinition[] = [
  // Stone: known by every starting band.
  tech('Foraging', 'Stone', [], 0, ['food']),
  tech('Fire', 'Stone', [], 0, []),
  tech('Hunting', 'Stone', [], 0, ['food'], { extract: ['game'] }),
  tech('Fishing', 'Stone', [], 0, ['food'], { extract: ['fish'] }),
  // Neolithic.
  tech('Pottery', 'Neolithic', ['Fire'], 600, ['storage', 'economy'], { multiply: { storeMonths: 14, spoilage: 0.08, specialistCap: 1.5 } }, { riverOrLake: 1.5, grainSite: 1.3 }),
  tech('Agriculture', 'Neolithic', ['Pottery', 'Foraging'], 6_000, ['food', 'economy'], { methods: ['farm'], extract: ['grain'], multiply: { specialistCap: 2 } }, { fertileRiver: 40, riverOrLake: 1.5, grainSite: 4 }, false, 0.05),
  tech('Animal husbandry', 'Neolithic', ['Hunting'], 7_000, ['food', 'economy'], { methods: ['herd'], multiply: { specialistCap: 1.3 } }, { grassland: 20, gameSite: 2, arid: 1.5, fertileRiver: 2, riverOrLake: 1.2 }, false, 0.05),
  tech('Boatbuilding', 'Neolithic', ['Fishing', 'Fire'], 900, ['sailing', 'food'], { mobility: 'riverBoats', multiply: { fishYield: 1.15 } }, { riverOrLake: 2.5, coastal: 2, fishSite: 1.3 }),
  tech('Masonry', 'Neolithic', ['Fire'], 1_000, ['construction'], { extract: ['stone'], unlocks: ['granary', 'walls', 'shrine'] }, { rough: 1.8 }),
  // Bronze.
  tech('Mining', 'Bronze', ['Masonry'], 96_000_000, ['mining', 'economy'], { extract: ['iron', 'copper', 'gold', 'tin'], unlocks: ['mine'] }, { rough: 2 }),
  tech('Copper working', 'Bronze', ['Mining'], 115_200_000, ['metal', 'military'], { use: ['copper'], multiply: { military: 1.15, farmYield: 1.05 } }),
  tech('Bronze working', 'Bronze', ['Copper working'], 153_600_000, ['metal', 'military'], { use: ['copper', 'tin'], multiply: { military: 1.3, farmYield: 1.05 } }),
  tech('Writing', 'Bronze', ['Pottery'], 124_800_000, ['scholarship', 'governance'], { multiply: { research: 1.25, specialistCap: 1.2 }, unlocks: ['monarchy', 'library', 'temple'] }),
  tech('Wheel', 'Bronze', ['Animal husbandry', 'Masonry'], 105_600_000, ['trade', 'economy'], { multiply: { reach: 1.2, tradeRange: 1.3 }, unlocks: ['road'] }, { grassland: 1.5 }),
  tech('Salt harvesting', 'Bronze', ['Pottery'], 86_400_000, ['storage', 'economy'], { extract: ['salt'], multiply: { spoilage: 0.7 } }, { coastal: 1.4, arid: 1.4 }),
  tech('Irrigation', 'Bronze', ['Agriculture'], 115_200_000, ['food'], { multiply: { farmYield: 1.15 }, unlocks: ['irrigation'] }, { fertileRiver: 2, arid: 1.5 }),
  tech('Plough', 'Bronze', ['Agriculture', 'Animal husbandry'], 134_400_000, ['food'], { multiply: { farmYield: 1.2 } }, { grassland: 1.4 }),
  tech('Herbal medicine', 'Bronze', ['Writing'], 105_600_000, ['medicine'], { multiply: { mortality: 0.95 } }),
  tech('Horseback riding', 'Bronze', ['Animal husbandry', 'Wheel'], 124_800_000, ['military'], { multiply: { military: 1.15, reach: 1.1 } }, { grassland: 2 }),
  // Iron.
  tech('Iron working', 'Iron', ['Bronze working'], 345_600_000, ['metal', 'military'], { use: ['iron'], multiply: { military: 1.3, farmYield: 1.1 }, unlocks: ['quarry'] }),
  tech('Sailing', 'Iron', ['Boatbuilding'], 268_800_000, ['sailing', 'trade'], { mobility: 'coastalSailing', multiply: { fishYield: 1.15, tradeRange: 1.3 }, unlocks: ['harbor'] }, { coastal: 3, fishSite: 1.3 }),
  tech('Currency', 'Iron', ['Writing', 'Bronze working'], 307_200_000, ['trade', 'economy'], { multiply: { tradeRange: 1.3 }, unlocks: ['market'] }),
  tech('Mathematics', 'Iron', ['Writing'], 307_200_000, ['scholarship'], { multiply: { research: 1.15 } }),
  tech('Forestry', 'Iron', ['Iron working'], 268_800_000, ['economy'], { extract: ['timber'] }, { forest: 2.5 }),
  tech('Shipbuilding', 'Iron', ['Sailing', 'Forestry'], 326_400_000, ['sailing', 'trade'], { multiply: { fishYield: 1.1, tradeRange: 1.2 } }, { coastal: 2 }),
  // Classical.
  tech('Engineering', 'Classical', ['Mathematics', 'Masonry', 'Iron working'], 505_600_000, ['construction'], { unlocks: ['pavedRoad', 'bridge', 'aqueduct', 'canal', 'fortress'] }, undefined, true),
  tech('Philosophy', 'Classical', ['Mathematics'], 460_800_000, ['scholarship'], { multiply: { research: 1.1 }, unlocks: ['republic'] }),
  tech('Administration', 'Classical', ['Writing', 'Currency'], 505_600_000, ['governance'], { multiply: { reach: 1.3, specialistCap: 1.2 }, unlocks: ['dictatorship'] }, undefined, true),
  tech('Organized religion', 'Classical', ['Writing', 'Philosophy'], 460_800_000, ['religion'], { unlocks: ['religionFounding', 'temple'] }),
  tech('Cartography', 'Classical', ['Mathematics', 'Sailing'], 416_000_000, ['sailing'], { multiply: { tradeRange: 1.2 } }, { coastal: 1.5 }),
  tech('Architecture', 'Classical', ['Masonry', 'Mathematics'], 460_800_000, ['construction', 'storage'], { unlocks: ['monument', 'silo'] }),
  tech('Crop rotation', 'Classical', ['Plough', 'Iron working'], 460_800_000, ['food'], { multiply: { farmYield: 1.2 } }),
  // Medieval.
  tech('Feudalism', 'Medieval', ['Administration', 'Horseback riding'], 1_030_400_000, ['governance', 'military'], { multiply: { reach: 1.2, military: 1.1 }, unlocks: ['feudalMonarchy'] }),
  tech('Navigation', 'Medieval', ['Sailing', 'Astronomy'], 1_097_600_000, ['sailing'], { mobility: 'oceanNavigation', multiply: { tradeRange: 1.4 }, unlocks: ['shipyard'] }, { coastal: 2.5 }),
  tech('Theology', 'Medieval', ['Organized religion', 'Philosophy'], 960_000_000, ['religion'], { unlocks: ['theocracy'] }),
  tech('Astronomy', 'Medieval', ['Mathematics', 'Philosophy'], 960_000_000, ['scholarship'], { multiply: { research: 1.1 }, unlocks: ['observatory'] }),
  tech('Optics', 'Medieval', ['Astronomy'], 915_200_000, ['scholarship'], { multiply: { research: 1.1 } }),
  tech('Steel', 'Medieval', ['Iron working', 'Engineering'], 1_030_400_000, ['metal', 'military'], { use: ['iron'], multiply: { military: 1.25 } }),
  tech('Heavy plough', 'Medieval', ['Crop rotation', 'Steel'], 915_200_000, ['food'], { multiply: { farmYield: 1.15 } }),
  // Early modern.
  tech('Chemistry', 'Early modern', ['Mathematics', 'Mining', 'Astronomy'], 2_099_200_000, ['scholarship', 'industry'], { multiply: { research: 1.1 } }),
  tech('Gunpowder', 'Early modern', ['Chemistry', 'Steel'], 2_099_200_000, ['military'], { multiply: { military: 1.5 } }),
  tech('Printing', 'Early modern', ['Engineering', 'Theology'], 1_984_000_000, ['scholarship'], { multiply: { research: 1.3, reach: 1.1 }, unlocks: ['constitutionalMonarchy', 'university'] }),
  tech('Banking', 'Early modern', ['Currency', 'Mathematics', 'Administration'], 1_984_000_000, ['trade', 'economy'], { multiply: { tradeRange: 1.2 }, unlocks: ['democracy'] }),
  tech('Economics', 'Early modern', ['Banking', 'Printing'], 2_099_200_000, ['trade', 'economy'], { multiply: { tradeRange: 1.2, specialistCap: 1.2 } }),
  tech('Geology', 'Early modern', ['Mining', 'Chemistry'], 2_099_200_000, ['mining'], { reveal: ['coal', 'oil'] }, { rough: 1.5 }),
  // Industrial.
  tech('Deep mining', 'Industrial', ['Geology', 'Engineering'], 3_456_000_000, ['mining', 'industry'], { extract: ['coal'] }),
  tech('Steam power', 'Industrial', ['Engineering', 'Deep mining'], 3_840_000_000, ['industry', 'energy'], { multiply: { research: 1.1 } }),
  tech('Railways', 'Industrial', ['Steam power', 'Steel'], 3_840_000_000, ['industry', 'trade'], { mobility: 'rail', multiply: { reach: 1.4, tradeRange: 1.4 }, unlocks: ['railway', 'railStation'] }),
  tech('Industrialization', 'Industrial', ['Steam power', 'Banking'], 4_224_000_000, ['industry', 'economy'], { use: ['coal', 'iron'], multiply: { specialistCap: 2 }, unlocks: ['factory', 'coalPowerPlant', 'oneParty'] }, undefined, true),
  tech('Fertilizer', 'Industrial', ['Chemistry', 'Industrialization'], 3_840_000_000, ['food', 'industry'], { multiply: { farmYield: 1.8 } }),
  // Cold stores and refrigerated carriage: food keeps far longer, in store and on the way (VISION.md: famine is mitigable by knowledge).
  tech('Refrigeration', 'Industrial', ['Chemistry', 'Steam power'], 3_840_000_000, ['storage', 'food'], { multiply: { spoilage: 0.3, storeMonths: 1.5 } }),
  tech('Drilling', 'Industrial', ['Geology', 'Steam power'], 3_840_000_000, ['mining', 'industry'], { extract: ['oil'] }),
  // Modern.
  tech('Electricity', 'Modern', ['Industrialization', 'Chemistry'], 5_990_400_000, ['energy', 'scholarship'], { multiply: { research: 1.2 }, unlocks: ['powerGrid'] }),
  tech('Combustion engine', 'Modern', ['Drilling', 'Electricity'], 6_291_200_000, ['industry', 'military'], { use: ['oil'], multiply: { military: 1.3, reach: 1.2 }, unlocks: ['highway'] }),
  tech('Flight', 'Modern', ['Combustion engine'], 6_739_200_000, ['military', 'trade'], { mobility: 'flight', unlocks: ['airport'] }),
  tech('Medicine', 'Modern', ['Chemistry', 'Printing'], 5_990_400_000, ['medicine'], { multiply: { mortality: 0.6, birthRate: 0.7, disease: 0.5 } }),
  tech('Radio', 'Modern', ['Electricity'], 5_689_600_000, ['scholarship', 'governance'], { multiply: { reach: 1.3, research: 1.1 } }),
  // Atomic.
  tech('Nuclear physics', 'Atomic', ['Electricity', 'Chemistry'], 10_752_000_000, ['scholarship', 'energy'], { reveal: ['uranium'] }),
  tech('Advanced mining', 'Atomic', ['Nuclear physics', 'Deep mining'], 10_752_000_000, ['mining'], { extract: ['uranium'] }),
  tech('Nuclear power', 'Atomic', ['Nuclear physics', 'Advanced mining'], 12_096_000_000, ['energy'], { use: ['uranium'], unlocks: ['nuclearPowerPlant'] }),
  tech('Nuclear weapons', 'Atomic', ['Nuclear physics', 'Advanced mining'], 12_096_000_000, ['military'], { use: ['uranium'], unlocks: ['nuclearWeapons'] }),
  tech('Rocketry', 'Atomic', ['Combustion engine', 'Flight'], 11_424_000_000, ['military', 'scholarship'], { unlocks: ['rocketSite'] }),
  tech('Computers', 'Atomic', ['Electricity', 'Radio'], 11_424_000_000, ['scholarship'], { multiply: { research: 1.3 } }),
  tech('Spaceflight', 'Atomic', ['Rocketry', 'Computers'], 13_440_000_000, ['scholarship'], { mobility: 'space', unlocks: ['spaceProgram'] }),
];

export const STARTING_TECHS = ['Foraging', 'Fire', 'Hunting', 'Fishing'] as const;
export const TECH_INDEX = new Map(TECHS.map((definition, index) => [definition.id, index]));

/** The era a polity is in: the latest era of any tech it knows (eras are labels, never gates). */
export function eraOf(known: Uint8Array) {
  let era = 0;
  for (let index = 0; index < TECHS.length; index++) if (known[index]) era = Math.max(era, ERAS.indexOf(TECHS[index].era));
  return era;
}

/** Graph checks run at startup: unique ids, known prerequisites of no later era, no cycles, positive costs. */
export function validateTechs(requiredNames: readonly string[]) {
  const problems: string[] = [];
  if (TECH_INDEX.size !== TECHS.length) problems.push('tech ids must be unique');
  for (const definition of TECHS) {
    for (const requirement of definition.requires) {
      const prerequisite = TECHS[TECH_INDEX.get(requirement) ?? -1];
      if (!prerequisite) problems.push(`${definition.id} requires unknown ${requirement}`);
      else if (ERAS.indexOf(prerequisite.era) > ERAS.indexOf(definition.era)) problems.push(`${definition.id} requires a later-era tech ${requirement}`);
    }
    const starting = (STARTING_TECHS as readonly string[]).includes(definition.id);
    if (!(starting ? definition.cost === 0 : definition.cost > 0)) problems.push(`${definition.id} has cost ${definition.cost}`);
    for (const value of Object.values(definition.effects.multiply ?? {})) if (!(value > 0 && Number.isFinite(value))) problems.push(`${definition.id} multiplies by ${value}`);
    for (const value of Object.values(definition.affinity ?? {})) if (!(value >= 1)) problems.push(`${definition.id} has affinity ${value}`);
    if (!(definition.weight > 0 && Number.isFinite(definition.weight))) problems.push(`${definition.id} has base weight ${definition.weight}`);
  }
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return true;
    if (state.get(id) === 1) return false;
    state.set(id, 1);
    const ok = (TECHS[TECH_INDEX.get(id) ?? -1]?.requires ?? []).every(visit);
    state.set(id, 2);
    return ok;
  };
  for (const definition of TECHS) if (!visit(definition.id)) { problems.push(`the tech graph has a cycle through ${definition.id}`); break; }
  for (const name of requiredNames) if (!TECH_INDEX.has(name)) problems.push(`resource extraction needs a tech named exactly "${name}"`);
  if (problems.length) throw new Error(`Invalid tech data: ${problems.join('; ')}.`);
}
