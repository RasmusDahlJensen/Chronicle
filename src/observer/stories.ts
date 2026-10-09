import type { ObserverFrame, StoryKind } from '../../shared/simulation.ts';
import { fillTemplate } from './events.ts';
import { factorName } from './labels.ts';

type Story = ObserverFrame['stories'][number];

/** Each kind of story as the rail labels it (U.3). */
export const STORY_KIND_NAMES: Record<StoryKind, string> = {
  rise: 'Rise', decline: 'Decline', union: 'Union', first: 'A first', faith: 'Faith', peoples: 'Peoples', trade: 'Trade', voyage: 'Voyages', hardship: 'Hardship', wonder: 'Wonders', war: 'War',
};

/**
 * The observer's words for each kind of story (VISION.md "Text rendering"), filled from the story's data as events'
 * templates are (`fillTemplate`: `{key}`, and `{?key|text}` where `data[key]` is true). The simulation never writes
 * prose; a test fails if a kind has no template or a template reads data its story does not carry.
 */
export const STORY_TEMPLATES: Record<StoryKind, { title: string; text: string }> = {
  rise: {
    title: 'The rise of the {name}',
    text: 'In {years|year|years} the {name} have grown from {before} to {people} people{?regionsGrew| and from {regionsBefore} to {regions|region|regions}}{?regionsSame|, still in {regions|region|regions}}{?regionsShrank|, though in {regions|region|regions} where they held {regionsBefore}}{?mostlyOwn|, mostly by their own growth}{?mostlyWar|, mostly by war}{?wonInWar|. They won {conquered|region|regions} in war}{?expanded|. They sent settlers into {expansions|region|regions}}{?tribesJoined|; {joined|tribe|tribes} joined them}{?tookIn|; they took in {absorbed|band|bands}}{?unitedWith|; {united|realm|realms} united with them}.',
  },
  decline: {
    title: '{?declining|The decline of the {name}}{?ended|The end of the {name}}',
    text: '{?declining|Since year {peakYear} the {name} have fallen from {peak} to {people} people}{?regionsLost| and from {regionsPeak} to {regions|region|regions}}{?ended|From {peak} people in year {peakYear}, the {name} have come to an end}{?war|. They lost {lostInWar|region|regions} in war}{?famine|. Famine killed {famineDeaths} of them}{?neglect|. Their strained realm let {neglected|region|regions} go unkept}.',
  },
  union: {
    title: '{?one|The {joined} join the {name}}{?many|{count} realms join the {name}}',
    text: '{?one|The {joined} have joined the {name}}{?many|The {joined} and {others|more realm|more realms} have joined the {name}}: {people} people and {regions|region|regions} brought under one rule.',
  },
  first: {
    title: 'The {name} lead the world into the {era} age',
    text: 'The {name} were the first people in the world to learn {tech}, the first art of the {era} age.',
  },
  faith: {
    title: 'The {religion} faith',
    text: '{?founded|Founded by the {name}}{?reformed| in place of the {formerFaith} faith}{?sect|A sect of the {parentFaith} faith, grown apart among the {name}}, it is followed by {people} people in {regions|region|regions}{?hasTenets|. Its tenets: {tenets}}.',
  },
  peoples: {
    title: '{?split|The {culture} grow apart}{?hybrid|Two peoples become the {culture}}{?assimilation|The {culture} take up the ways of the {ruling}}',
    text: '{?split|{population} people of the {parent} among the {name} have become a people of their own, the {culture}}{?hybrid|Among the {name}, the {first} and the {second} have become one people of {population}, the {culture}}{?assimilation|{population} people of the {culture} among the {name} have taken up the ways of the {ruling}, the people who lead them}.',
  },
  trade: {
    title: 'The trade web of the {name}',
    text: 'The {name} hold {agreements|trade agreement|trade agreements} with {partners|partner|partners}{?joint| and share joint roads with {roads|neighbour|neighbours}}.',
  },
  voyage: {
    title: 'The ships of the {name}',
    text: '{?one|{explorer} sailed {km} km for the {name} and reached new lands}{?many|The {name} sent {voyages|voyage|voyages} that reached new lands, the farthest {km} km, by {explorer}}{?metAny|, meeting {met|new people|new peoples}}.',
  },
  hardship: {
    title: 'Famine among the {name}',
    text: 'Famine struck the {name} {famines|time|times} and killed {deaths} people; the worst, in year {worstYear}, killed {worst}.',
  },
  wonder: {
    title: '{wonder}',
    text: 'The {name} completed {wonder} at {city}, after {years|year|years} of work.',
  },
  war: {
    title: '{war}',
    text: '{?fighting|The {attacker} have fought the {defender} since year {since}: {dead} dead so far}{?holding|, and the {attacker} hold {held|region|regions} of theirs}{?behind|, and the {defender} have the upper hand}{?endedWhite|The {attacker} and the {defender} fought for {years|year|years}, and neither won: {dead} dead}{?endedTribute|The {attacker} and the {defender} fought for {years|year|years}: the {loser} pay tribute to the {winner}, after {dead} dead}{?endedCession|After {years|year|years} of war and {dead} dead, the {loser} gave up {ceded|region|regions} to the {winner}}{?endedAnnexation|After {years|year|years} of war and {dead} dead, the {winner} took all the land of the {loser}}{?endedGone|The {attacker} and the {defender} fought until one of them was no more: {dead} dead}.',
  },
};

/** A story in words: its kind, title, what happened, why (its strongest causes) and its years. */
export function describeStory(story: Story) {
  const template = STORY_TEMPLATES[story.kind];
  return {
    kind: STORY_KIND_NAMES[story.kind],
    title: fillTemplate(template.title, story.data),
    text: fillTemplate(template.text, story.data),
    why: story.causes.length ? `Why: ${story.causes.map(cause => factorName(cause.factor)).join(', ')}.` : '',
    years: story.from < story.to ? `${story.from.toLocaleString('en')}–${story.to.toLocaleString('en')}` : story.to.toLocaleString('en'),
  };
}
