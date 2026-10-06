import type { Knowledge } from './knowledge.ts';
import { TECH_INDEX } from './techs.ts';

/**
 * Wonders as data (VISION.md "Wonders"): rare, named prestige buildings, each unique in the world while it stands (or
 * while it is being built). Each needs a tech, a great settlement and a motive — piety (Zeal), ambition (Expansionism)
 * or learning (Openness) — in a stable realm, costs years of a large civilization's income, and has its own effect:
 * civilization-wide (research, wealth, stability) or on its own city (housing).
 */
export const MOTIVES = ['piety', 'ambition', 'learning'] as const;
export type Motive = typeof MOTIVES[number];

export interface WonderEffects { research?: number; wealth?: number; stability?: number; housing?: number }
export interface WonderDefinition {
  id: string; name: string; tech: string; motive: Motive;
  /** Wealth to build, months it takes, wealth a year to keep up; the smallest tier of its city; whether it needs the sea. */
  cost: number; months: number; upkeep: number; minTier: number; coast: boolean;
  effects: WonderEffects;
}

const wonder = (id: string, name: string, tech: string, motive: Motive, cost: number, months: number, minTier: number, effects: WonderEffects, coast = false): WonderDefinition =>
  ({ id, name, tech, motive, cost, months, upkeep: Math.round(cost / 500), minTier, coast, effects });

export const WONDERS: readonly WonderDefinition[] = [
  wonder('pyramids', 'the Pyramids', 'Writing', 'ambition', 2_000_000, 240, 1, { stability: 0.04 }),
  wonder('hangingGardens', 'the Hanging Gardens', 'Irrigation', 'ambition', 1_500_000, 180, 1, { housing: 1.5 }),
  wonder('colossus', 'the Colossus', 'Bronze working', 'ambition', 1_500_000, 180, 1, { wealth: 1.1 }, true),
  wonder('greatTemple', 'the Great Temple', 'Organized religion', 'piety', 2_500_000, 240, 1, { stability: 0.05 }),
  wonder('greatLibrary', 'the Great Library', 'Philosophy', 'learning', 3_000_000, 240, 2, { research: 1.1 }),
  wonder('palace', 'the Palace', 'Administration', 'ambition', 3_000_000, 240, 2, { stability: 0.04, housing: 1.3 }),
  wonder('grandObservatory', 'the Grand Observatory', 'Astronomy', 'learning', 4_000_000, 300, 2, { research: 1.1 }),
  wonder('cathedral', 'the Cathedral', 'Theology', 'piety', 5_000_000, 360, 2, { stability: 0.06 }),
];
export const WONDER_INDEX = new Map(WONDERS.map((definition, index) => [definition.id, index]));
const TECH_OF = WONDERS.map(definition => TECH_INDEX.get(definition.tech) ?? -1);

/** Whether a polity with this knowledge can build it. */
export function wonderKnown(knowledge: Knowledge, wonder: number) { return knowledge.known[TECH_OF[wonder]] === 1; }

/** Startup check: unique ids, known techs, positive costs, sensible effects. */
export function validateWonders() {
  const problems: string[] = [];
  if (WONDER_INDEX.size !== WONDERS.length) problems.push('wonder ids must be unique');
  WONDERS.forEach((definition, index) => {
    if (TECH_OF[index] < 0) problems.push(`${definition.id} needs unknown tech ${definition.tech}`);
    if (!(Number.isInteger(definition.cost) && definition.cost > 0 && Number.isInteger(definition.months) && definition.months >= 1 && Number.isInteger(definition.upkeep) && definition.upkeep >= 0)) problems.push(`${definition.id} has invalid cost, time or upkeep`);
    if (!(Number.isInteger(definition.minTier) && definition.minTier >= 0 && definition.minTier <= 3)) problems.push(`${definition.id} has tier ${definition.minTier}`);
    for (const key of ['research', 'wealth', 'housing'] as const) if (definition.effects[key] !== undefined && !(definition.effects[key]! >= 1)) problems.push(`${definition.id} ${key} must be at least 1`);
    if (definition.effects.stability !== undefined && !(definition.effects.stability >= 0 && definition.effects.stability <= 1)) problems.push(`${definition.id} stability must be in [0, 1]`);
  });
  if (problems.length) throw new Error(`Invalid wonder data: ${problems.join('; ')}.`);
}
