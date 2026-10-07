import type { VALUE_NAMES } from '../../shared/simulation.ts';

type Values = Record<typeof VALUE_NAMES[number], number>;

/**
 * Religious tenets as data (VISION.md "Tenets"). A new religion draws two to four of them, weighted by its founders'
 * values (`favour`: each value above or below the middle raises or lowers the weight), never two that `excludes` each
 * other. Each pulls its followers' values a little (`pulls`); some do more:
 * - `spread` multiplies how readily others convert to it (Proselytizing);
 * - `friction` multiplies the unrest a state of this faith stirs among peoples of other faiths (Tolerance);
 * - `stability` steadies its followers' regions (Asceticism).
 * Holy war and Mercantile blessing act through war and trade from M5 and M6; until then, only their pulls.
 */
export interface TenetDefinition {
  key: string; name: string; pulls: Partial<Values>; favour: Partial<Values>; excludes?: string[];
  spread?: number; friction?: number; stability?: number;
}

export const TENETS: readonly TenetDefinition[] = [
  { key: 'proselytizing', name: 'Proselytizing', pulls: { zeal: 0.1 }, favour: { zeal: 1, expansionism: 0.5 }, spread: 1.5 },
  { key: 'holyWar', name: 'Holy war', pulls: { militarism: 0.1, zeal: 0.05 }, favour: { militarism: 1, zeal: 0.5 }, excludes: ['pacifism', 'tolerance'] },
  { key: 'pacifism', name: 'Pacifism', pulls: { militarism: -0.15 }, favour: { militarism: -1 }, excludes: ['holyWar'] },
  { key: 'tolerance', name: 'Tolerance', pulls: { openness: 0.05 }, favour: { openness: 1, zeal: -0.5 }, excludes: ['holyWar'], friction: 0.5 },
  { key: 'ancestorVeneration', name: 'Ancestor veneration', pulls: { tradition: 0.1 }, favour: { tradition: 1 } },
  { key: 'asceticism', name: 'Asceticism', pulls: { expansionism: -0.05 }, favour: { tradition: 0.5, expansionism: -0.5 }, stability: 0.02 },
  { key: 'mercantileBlessing', name: 'Mercantile blessing', pulls: { openness: 0.1 }, favour: { openness: 0.5, expansionism: 0.5 } },
  { key: 'monumentBuilders', name: 'Monument builders', pulls: { expansionism: 0.1 }, favour: { expansionism: 1, zeal: 0.5 } },
];
