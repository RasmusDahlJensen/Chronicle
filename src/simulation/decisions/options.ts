/** The shapes every decision option shares (VISION.md "Decision step"), in a module of their own so each choice can use them. */
export type Action = 'expand' | 'explore' | 'nothing' | 'unite' | 'share' | 'build';
export interface Factor { factor: string; weight: number }
/** One option of a decision step: for Build, `target` is the building type (or, with `wonder`, the wonder type) and
 *  `targets` the settlements. */
export interface Option { action: Action; score: number; target: number | null; label: string | null; factors: Factor[]; targets?: number[]; wonder?: boolean }
