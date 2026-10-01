import type { Rng } from './rng.ts';
import { NAME_TUNING } from './tunables.ts';

/**
 * A culture's language seed: a small phoneme inventory (VISION.md "Naming"). Names for bands, cultures and
 * settlements are drawn from it, so a culture's names sound alike. Consonant clusters only begin a name and codas
 * only end it, which keeps names pronounceable. M4 adds the visible descent of names by mutating a parent's seed.
 */
export interface LanguageSeed { initials: string[]; consonants: string[]; vowels: string[]; codas: string[] }

const INITIALS = ['br', 'dr', 'gr', 'kr', 'tr', 'st', 'th', 'sh', 'kh', 'vr', 'ch', 'sk'];
const CONSONANTS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'y', 'w'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'ae', 'ai', 'ei', 'ia', 'ou'];
const CODAS = ['n', 'r', 'l', 's', 'k', 'th', 'm', 'nd', 'rk', 'sh', 'x', 't'];

function sample<T>(rng: Rng, items: readonly T[], count: number) {
  const pool = items.slice(), chosen: T[] = [];
  while (chosen.length < count && pool.length) chosen.push(pool.splice(rng.int(pool.length), 1)[0]);
  return chosen;
}

export function createLanguage(rng: Rng): LanguageSeed {
  return {
    initials: sample(rng, INITIALS, 2 + rng.int(3)), consonants: sample(rng, CONSONANTS, 6 + rng.int(4)),
    vowels: sample(rng, VOWELS, 3 + rng.int(3)), codas: sample(rng, CODAS, 2 + rng.int(3)),
  };
}

const pick = (rng: Rng, items: readonly string[]) => items[rng.int(items.length)];

/** A capitalized name of two or three syllables, within NAME_TUNING's length range. */
export function createName(rng: Rng, language: LanguageSeed) {
  const shape = NAME_TUNING;
  for (let attempt = 0; attempt < 12; attempt++) {
    const syllables = rng.chance(shape.thirdSyllable) ? 3 : 2;
    let name = rng.chance(shape.initialCluster) ? pick(rng, language.initials) : rng.chance(shape.initialConsonant) ? pick(rng, language.consonants) : '';
    for (let at = 0; at < syllables; at++) {
      if (at > 0) name += pick(rng, language.consonants);
      name += pick(rng, language.vowels);
    }
    if (rng.chance(shape.coda)) name += pick(rng, language.codas);
    if (name.length >= shape.minLength && name.length <= shape.maxLength) return name[0].toUpperCase() + name.slice(1);
  }
  return 'Ana';
}
