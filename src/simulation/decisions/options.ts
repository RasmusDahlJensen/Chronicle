/** The shapes every decision option shares (VISION.md "Decision step"), in a module of their own so each choice can use them. */
export type Action = 'expand' | 'explore' | 'nothing' | 'unite' | 'share' | 'build';
export interface Factor { factor: string; weight: number }
/** One option of a decision step: for Build, `target` is the building type (with `wonder`, the wonder type; with `road`,
 *  the road tier) and `targets` the settlements (for a road, the towns and cities it would reach). */
export interface Option { action: Action; score: number; target: number | null; label: string | null; factors: Factor[]; targets?: number[]; wonder?: boolean; road?: boolean }

/** Factors named with a leading × are multipliers (logged, never cited as causes); the rest are contributions to the score. */
export const MULTIPLIER = '×';
