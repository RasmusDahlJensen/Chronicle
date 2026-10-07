import type { Rng } from './rng.ts';
import { NAME_TUNING } from './tunables.ts';

/**
 * A culture's language seed: a small phoneme inventory (VISION.md "Naming"). Names for bands, cultures and
 * settlements are drawn from it, so a culture's names sound alike. Consonant clusters only begin a name and codas
 * only end it, which keeps names pronounceable. A daughter culture's seed is its parent's with a few sounds changed,
 * and its name keeps its parent's first syllable (M4: names visibly descend). A hybrid's seed mixes both parents'
 * sounds, and its name joins the heavier parent's first syllable to the rest of the other's name.
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
const isVowel = (letter: string) => 'aeiou'.includes(letter);

/** A capitalized name of two or three syllables, within NAME_TUNING's length range (and not in `taken`, lower-case,
 *  when given: culture names are unique). */
export function createName(rng: Rng, language: LanguageSeed, taken?: ReadonlySet<string>) {
  const shape = NAME_TUNING;
  for (let attempt = 0; attempt < 12; attempt++) {
    const syllables = rng.chance(shape.thirdSyllable) ? 3 : 2;
    let name = rng.chance(shape.initialCluster) ? pick(rng, language.initials) : rng.chance(shape.initialConsonant) ? pick(rng, language.consonants) : '';
    for (let at = 0; at < syllables; at++) {
      if (at > 0) name += pick(rng, language.consonants);
      name += pick(rng, language.vowels);
    }
    if (rng.chance(shape.coda)) name += pick(rng, language.codas);
    if (name.length >= shape.minLength && name.length <= shape.maxLength && !taken?.has(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return unused(rng, 'ana', language, taken);
}

/** `stem` with syllables of `language` added until it is a name nobody has (a last resort for crowded names). */
function unused(rng: Rng, stem: string, language: LanguageSeed, taken?: ReadonlySet<string>) {
  let name = stem;
  do {
    if (isVowel(name[name.length - 1] ?? 'a')) name += pick(rng, language.consonants);
    name += pick(rng, language.vowels);
  } while (taken?.has(name) || name.length < NAME_TUNING.minLength);
  return name[0].toUpperCase() + name.slice(1);
}

const SOUNDS = { initials: INITIALS, consonants: CONSONANTS, vowels: VOWELS, codas: CODAS } as const;
const SOUND_KINDS = ['initials', 'consonants', 'vowels', 'codas'] as const;

/** A daughter language: the parent's sounds with `changes` of them replaced by sounds it lacked. */
export function mutateLanguage(rng: Rng, parent: LanguageSeed, changes: number): LanguageSeed {
  const language: LanguageSeed = { initials: [...parent.initials], consonants: [...parent.consonants], vowels: [...parent.vowels], codas: [...parent.codas] };
  for (let at = 0; at < changes; at++) {
    const kind = SOUND_KINDS[rng.int(SOUND_KINDS.length)], sounds = language[kind];
    const unused = [...new Set(SOUNDS[kind])].filter(sound => !sounds.includes(sound));
    if (unused.length && sounds.length) sounds[rng.int(sounds.length)] = unused[rng.int(unused.length)];
  }
  return language;
}

/** A name's first syllable, lower-case: its opening consonants, its first vowels and the consonant after them. */
export function nameStem(name: string) {
  const lower = name.toLowerCase();
  let at = 0;
  while (at < lower.length && !isVowel(lower[at])) at++;
  while (at < lower.length && isVowel(lower[at])) at++;
  if (at < lower.length) at++;
  return lower.slice(0, at);
}

/** A daughter culture's name: its parent's first syllable with a new ending in the daughter's language, not one in
 *  `taken` (lower-case): kin share a first syllable, never a name. */
export function descendName(rng: Rng, parent: string, language: LanguageSeed, taken?: ReadonlySet<string>) {
  const stem = nameStem(parent), shape = NAME_TUNING;
  for (let attempt = 0; attempt < 12; attempt++) {
    let name = stem;
    if (isVowel(name[name.length - 1] ?? 'a')) name += pick(rng, language.consonants);
    name += pick(rng, language.vowels);
    if (rng.chance(shape.coda)) name += pick(rng, language.codas);
    else if (rng.chance(shape.thirdSyllable)) name += pick(rng, language.consonants) + pick(rng, language.vowels);
    if (name.length >= shape.minLength && name.length <= shape.maxLength && name !== parent.toLowerCase() && !taken?.has(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return unused(rng, stem, language, new Set([...(taken ?? []), parent.toLowerCase(), stem]));
}

/** A hybrid language: of each kind of sound, a mix of both parents' (from `first` with chance `weight`), as many as
 *  the parents have on average. */
export function blendLanguage(rng: Rng, first: LanguageSeed, second: LanguageSeed, weight: number): LanguageSeed {
  const language = {} as LanguageSeed;
  for (const kind of SOUND_KINDS) {
    const mine = [...new Set(first[kind])], theirs = [...new Set(second[kind])];
    const count = Math.max(1, Math.round(weight * mine.length + (1 - weight) * theirs.length)), sounds: string[] = [];
    const pools = [mine.filter(sound => !theirs.includes(sound)), theirs.filter(sound => !mine.includes(sound))];
    for (const shared of mine) if (theirs.includes(shared) && sounds.length < count) sounds.push(shared);
    while (sounds.length < count && (pools[0].length || pools[1].length)) {
      const from = pools[0].length && (!pools[1].length || rng.chance(weight)) ? pools[0] : pools[1];
      sounds.push(from.splice(rng.int(from.length), 1)[0]);
    }
    language[kind] = sounds;
  }
  return language;
}

/** A hybrid's name: the heavier parent's first syllable and the rest of the other's name (or a new ending in the
 *  hybrid language when the other's name is all first syllable). */
export function blendName(rng: Rng, first: string, second: string, language: LanguageSeed, taken?: ReadonlySet<string>) {
  const stem = nameStem(first), rest = second.toLowerCase().slice(nameStem(second).length);
  if (rest.length >= 2) {
    const joined = isVowel(stem[stem.length - 1] ?? 'a') === isVowel(rest[0]) && isVowel(rest[0]) ? stem + rest.slice(1) : stem + rest;
    if (joined.length >= NAME_TUNING.minLength && joined.length <= NAME_TUNING.maxLength && joined !== first.toLowerCase() && joined !== second.toLowerCase() && !taken?.has(joined)) return joined[0].toUpperCase() + joined.slice(1);
  }
  return descendName(rng, first, language, taken);
}
