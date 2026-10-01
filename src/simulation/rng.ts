/**
 * Seeded randomness. Every system draws from its own stream derived from the root seed, the tick and the system id
 * (VISION.md "Determinism"), so adding a system or a draw never shifts another system's randomness. Streams hold no
 * state beyond the tick, so the root seed is the only random state a save needs.
 */
export function seedFromText(text: string) {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
  return hash >>> 0;
}

/** A 32-bit avalanche mix of several integers (murmur3 finalizer per word). */
export function mix(...values: number[]) {
  let hash = 0x9e3779b9;
  for (const value of values) {
    let word = Math.imul(value | 0, 0xcc9e2d51);
    word = Math.imul((word << 15) | (word >>> 17), 0x1b873593);
    hash ^= word;
    hash = Math.imul((hash << 13) | (hash >>> 19), 5) + 0xe6546b64 | 0;
  }
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, count). */
  int(count: number): number;
  chance(probability: number): boolean;
  /** Index drawn in proportion to non-negative weights; -1 when all are zero. */
  weighted(weights: readonly number[]): number;
}

/** sfc32: small, fast and well distributed; seeded through `mix` so nearby inputs give unrelated streams. */
export function createRng(...key: number[]): Rng {
  let a = mix(...key, 1), b = mix(...key, 2), c = mix(...key, 3), d = 1;
  function next() {
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ (b >>> 9); b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11); c = c + t | 0;
    return (t >>> 0) / 4294967296;
  }
  for (let warm = 0; warm < 12; warm++) next();
  return {
    next,
    int: count => Math.floor(next() * count),
    chance: probability => next() < probability,
    weighted(weights) {
      let total = 0;
      for (const weight of weights) total += weight > 0 ? weight : 0;
      if (!(total > 0)) return -1;
      let target = next() * total;
      for (let index = 0; index < weights.length; index++) {
        if (weights[index] > 0 && (target -= weights[index]) < 0) return index;
      }
      for (let index = weights.length - 1; index >= 0; index--) if (weights[index] > 0) return index;
      return -1;
    },
  };
}

/** The stream for one system at one tick, optionally split further by an entity id. */
export function systemStream(rootSeed: number, tick: number, system: number, entity = 0) {
  return createRng(rootSeed, tick, system, entity);
}

/** Per-year probability applied to a step of `years` years: 1 − (1 − p)^t. */
export function stepProbability(perYear: number, years: number) {
  return 1 - (1 - Math.min(1, Math.max(0, perYear))) ** years;
}
