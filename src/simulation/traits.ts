import type { VALUE_NAMES } from '../../shared/simulation.ts';

type Values = Record<typeof VALUE_NAMES[number], number>;

/** What a people's land and life are measured by for a trait (each true or false for a group; `culture.ts`). */
export const TRAIT_CONDITIONS = ['seafaring', 'greatRiverFarming', 'mountains', 'desertHerding', 'greatWorks'] as const;
export type TraitCondition = typeof TRAIT_CONDITIONS[number];

/**
 * Cultural traits as data (VISION.md "Traits"): flavour earned from conditions most of a culture's people have lived
 * in for `years` in a row, with small pulls on their values. A culture holds at most `TRAIT_TUNING.max`, keeps them
 * once earned, and passes each to a daughter with `TRAIT_TUNING.inherit` (the visible thread of cultural memory).
 * Horse lords (steppe herders with a military history), Merchants and Warrior tradition need war and trade (M5, M6).
 */
export interface TraitDefinition { key: string; name: string; condition: TraitCondition; years: number; pulls: Partial<Values> }

export const TRAITS: readonly TraitDefinition[] = [
  { key: 'seafarers', name: 'Seafarers', condition: 'seafaring', years: 100, pulls: { openness: 0.1, expansionism: 0.05 } },
  { key: 'riverBuilders', name: 'River builders', condition: 'greatRiverFarming', years: 100, pulls: { expansionism: 0.05, tradition: 0.05 } },
  { key: 'mountainFolk', name: 'Mountain folk', condition: 'mountains', years: 100, pulls: { tradition: 0.1, militarism: 0.05 } },
  { key: 'desertNomads', name: 'Desert nomads', condition: 'desertHerding', years: 100, pulls: { militarism: 0.05, tradition: 0.05, openness: -0.05 } },
  { key: 'builders', name: 'Builders', condition: 'greatWorks', years: 100, pulls: { expansionism: 0.1 } },
];
