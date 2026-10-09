import { MAX_FRAME_STORIES, type ChronicleEvent, type ObserverFrame, type StoryKind } from '../../shared/simulation.ts';
import type { Census, Polity, SimulationState } from './state.ts';
import { TENETS } from './religions.ts';
import { ERAS, TECHS } from './techs.ts';

/**
 * The story builder (U.3; VISION.md U: "who rises and falls, why, where"): the history's main stories now, found in
 * the census of civilizations (`state.census`), the chronicle's events of the last two centuries and the state. It is
 * the observer's: built on request, it never changes the simulation. The browser writes each story's text from its
 * kind and data (`src/observer/stories.ts`), as it does for events.
 *
 * Each story is weighed by how much of the world it touched (people gained or lost, joined, following a faith, dying
 * of famine, as shares of the world's people; scaled per kind so a famine's deaths weigh against a realm's growth) and
 * by how recent it is; the strongest are told, at most two rises, declines and unions and one of each other kind.
 */
type Story = ObserverFrame['stories'][number];
type Data = Story['data'];
type Cause = Story['causes'][number];

/** The recent past stories are told from, and how far back a decline looks for a realm's peak. */
export const STORY_YEARS = 100, DECLINE_YEARS = 200;
/** A rise: grown by at least a quarter; a decline: fallen to at most four fifths of its peak. */
export const RISE_GROWTH = 1.25, DECLINE_SHARE = 0.8;
/** Each kind's weight per share of the world's people it touched. */
const KIND_SCALE: Record<StoryKind, number> = { rise: 1, decline: 1, union: 1, first: 0.5, faith: 0.5, peoples: 0.5, trade: 0.4, voyage: 0.3, hardship: 10, wonder: 0.3, war: 1 };
export const KIND_LIMIT: Partial<Record<StoryKind, number>> = { rise: 2, decline: 2, union: 2, war: 2 };
/** A war's dead weigh this many times a person living in the land it took (M6.2). */
export const WAR_STORY_DEAD = 20;
/** Stories of standing facts (a first, a trade web, voyages, a wonder) weigh by their realm's people only up to this
 *  share of the world's, so they do not lead the rail over who rises, falls and unites merely for a realm's size (the
 *  U close-out review). */
export const STANDING_SHARE = 0.03;
const MAX_REGIONS = 2_048;

const peopleOf = (state: SimulationState, polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
const landOf = (state: SimulationState, polity: Polity) => polity.groups.map(id => state.groups[id].region).sort((a, b) => a - b);
const capitalCell = (state: SimulationState, polity: Polity) => polity.capital !== null ? state.settlements[polity.capital].cell : null;
const centroid = (state: SimulationState, region: number | null) => region === null ? null : state.partition.regions[region].centroid;
const acts = (event: ChronicleEvent, id: number, role?: string) => event.actors.some(actor => actor.id === id && (role === undefined || actor.role === role));
const yearOf = (tick: number) => Math.floor(tick / 12);
const number = (value: unknown) => typeof value === 'number' ? value : 0;

/** The index of the first event at or after `tick` (events are in tick order). */
function firstAt(events: readonly ChronicleEvent[], tick: number) {
  let low = 0, high = events.length;
  while (low < high) { const middle = (low + high) >> 1; if (events[middle].tick < tick) low = middle + 1; else high = middle; }
  return low;
}

/** A civilization's place in a census (ids ascending), or −1. */
function placeIn(census: Census, id: number) {
  let low = 0, high = census.ids.length - 1;
  while (low <= high) { const middle = (low + high) >> 1; if (census.ids[middle] === id) return middle; if (census.ids[middle] < id) low = middle + 1; else high = middle - 1; }
  return -1;
}

/** The index of the first census in or after `year`. */
function censusFrom(state: SimulationState, year: number) {
  let low = 0, high = state.census.length;
  while (low < high) { const middle = (low + high) >> 1; if (state.census[middle].year < year) low = middle + 1; else high = middle; }
  return low;
}

/** The causes the events share most, summed (positive and negative), strongest first. */
function strongest(events: readonly ChronicleEvent[]): Cause[] {
  const sums = new Map<string, number>();
  for (const event of events) for (const cause of event.causes) sums.set(cause.factor, (sums.get(cause.factor) ?? 0) + cause.weight);
  return [...sums].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0])).slice(0, 3).map(([factor, weight]) => ({ factor, weight: Math.round(weight * 1000) / 1000 }));
}

/** The most important of the events (three, newest first). */
const keyEvents = (events: readonly ChronicleEvent[]) => [...events].sort((a, b) => b.importance - a.importance || b.id - a.id).slice(0, 3).sort((a, b) => b.id - a.id);
const regionsOf = (events: readonly ChronicleEvent[]) => [...new Set(events.map(event => event.region).filter((region): region is number => region !== null))].sort((a, b) => a - b);

/** The ages of the world (U.3): each later era with the year a people first reached it, from the world's firsts. */
export function agesOf(state: SimulationState): ObserverFrame['ages'] {
  const ages: ObserverFrame['ages'] = [];
  let reached = 0;
  for (const first of state.firsts) {
    const era = ERAS.indexOf(TECHS[first.tech].era);
    if (era <= reached) continue;
    reached = era;
    ages.push({ era, year: yearOf(first.tick), polity: first.polity, name: state.polities[first.polity].name, tech: TECHS[first.tech].name });
  }
  return ages;
}

const built = new WeakMap<SimulationState, { tick: number; events: number; view: Pick<ObserverFrame, 'stories' | 'ages'> }>();
/** The stories and ages for a frame, built once per month (and again when a development control adds events). */
export function storiesView(state: SimulationState): Pick<ObserverFrame, 'stories' | 'ages'> {
  const held = built.get(state);
  if (held && held.tick === state.tick && held.events === state.chronicle.events.length) return held.view;
  const view = { stories: storiesOf(state), ages: agesOf(state) };
  built.set(state, { tick: state.tick, events: state.chronicle.events.length, view });
  return view;
}

/** The history's main stories now, strongest first: at most `MAX_FRAME_STORIES`, and `KIND_LIMIT` of each kind. */
export function storiesOf(state: SimulationState): Story[] {
  const candidates = storyCandidates(state).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const told = new Map<StoryKind, number>(), stories: Story[] = [];
  for (const story of candidates) {
    if ((told.get(story.kind) ?? 0) >= (KIND_LIMIT[story.kind] ?? 1)) continue;
    told.set(story.kind, (told.get(story.kind) ?? 0) + 1);
    stories.push(story);
    if (stories.length === MAX_FRAME_STORIES) break;
  }
  return stories;
}

/** Every story that could be told now, each weighed (unsorted). */
export function storyCandidates(state: SimulationState): Story[] {
  const year = yearOf(state.tick), events = state.chronicle.events;
  let world = 0;
  for (const id of state.living) world += peopleOf(state, state.polities[id]);
  if (world <= 0) return [];
  const recentFrom = Math.max(0, year - STORY_YEARS), declineFrom = Math.max(0, year - DECLINE_YEARS);
  // The events of the last two centuries, by each polity acting in them.
  const start = firstAt(events, declineFrom * 12), recentStart = firstAt(events, recentFrom * 12), mine = new Map<number, ChronicleEvent[]>();
  for (let at = start; at < events.length; at++) for (const actor of events[at].actors) {
    const list = mine.get(actor.id);
    if (list) { if (list[list.length - 1] !== events[at]) list.push(events[at]); } else mine.set(actor.id, [events[at]]);
  }
  const recency = (to: number) => 0.5 + 0.5 * Math.max(0, 1 - (year - to) / STORY_YEARS);
  const candidates: Story[] = [];
  // A story's id stays the same while it goes on (a rise's base census or a union's first event move with time), so a
  // chosen story stays chosen: one per realm for most kinds, else keyed by its religion, event or age.
  function tell(kind: StoryKind, polity: Polity, from: number, to: number, share: number, data: Data, told: readonly ChronicleEvent[], regions: number[], focus: number | null, key: number | null = null, first: Cause[] = []) {
    if (!(share > 0)) return;
    candidates.push({
      id: key === null ? `${kind}:${polity.id}` : `${kind}:${polity.id}:${key}`, kind, polity: polity.id, name: polity.name, alive: polity.deathTick === null, from, to,
      weight: KIND_SCALE[kind] * share * recency(to), data, causes: [...first, ...strongest(told)].slice(0, 3), events: keyEvents(told), regions: regions.slice(0, MAX_REGIONS), focus,
    });
  }

  // Rise: a civilization grown most since its census a century ago (or its first one since).
  const recentCensus = censusFrom(state, recentFrom);
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ') continue;
    let base: { year: number; people: number; regions: number } | null = null;
    for (let at = recentCensus; at < state.census.length && !base; at++) {
      const place = placeIn(state.census[at], id);
      if (place >= 0) base = { year: state.census[at].year, people: state.census[at].people[place], regions: state.census[at].regions[place] };
    }
    if (!base || base.year >= year) continue;
    const people = peopleOf(state, civ), gain = people - base.people;
    if (gain <= 0 || people < base.people * RISE_GROWTH) continue;
    const growth = (mine.get(id) ?? []).filter(event => event.tick >= base.year * 12 && (
      ((event.type === 'expansion' || event.type === 'bandJoined' || event.type === 'bandAbsorbed') && acts(event, id, 'civ')) || (event.type === 'unification' && acts(event, id, 'union'))
      || (event.type === 'regionConquered' && acts(event, id, 'attacker')) || (event.type === 'civDestroyed' && event.data.annexed === true && acts(event, id, 'by'))));
    const count = (type: string) => growth.filter(event => event.type === type).length;
    const expansions = count('expansion'), joined = count('bandJoined'), absorbed = count('bandAbsorbed'), united = count('unification');
    // (M6.2) Land won in war: regions ceded to it and realms it annexed.
    const won = growth.filter(event => event.type === 'regionConquered' || event.type === 'civDestroyed');
    const conquered = won.reduce((sum, event) => sum + (event.type === 'civDestroyed' ? number(event.data.regions) : 1), 0);
    // How much of its gain came with the peoples who joined it, with the land it won in war, and from its own growth
    // (births over deaths, and migrants), as shares of the gain: the first causes of a rise.
    const byWar = Math.min(gain, won.reduce((sum, event) => sum + number(event.data.population), 0));
    const others = Math.min(gain - byWar, growth.filter(event => event.type !== 'expansion' && !won.includes(event)).reduce((sum, event) => sum + number(event.data.population), 0));
    const own = gain - others - byWar;
    const shares = ([['ownGrowth', own / gain], ['peoplesJoined', others / gain], ['conquest', byWar / gain]] as const).filter(([, part]) => part >= 0.05)
      .sort((a, b) => b[1] - a[1]).map(([factor, part]) => ({ factor, weight: Math.round(part * 1000) / 1000 }));
    tell('rise', civ, base.year, year, gain / world, {
      name: civ.name, people, before: base.people, regions: civ.groups.length, regionsBefore: base.regions, years: year - base.year,
      expansions, expanded: expansions > 0, joined, tribesJoined: joined > 0, absorbed, tookIn: absorbed > 0, united, unitedWith: united > 0,
      ownGrowth: own, byOthers: others, byWar, mostlyOwn: own >= others + byWar, mostlyWar: byWar > own && byWar >= others, conquered, wonInWar: conquered > 0,
      regionsGrew: civ.groups.length > base.regions, regionsSame: civ.groups.length === base.regions, regionsShrank: civ.groups.length < base.regions,
    }, growth, landOf(state, civ), capitalCell(state, civ), null, shares);
  }

  // Decline: a civilization fallen furthest from its peak in the last two centuries, or come to an end (a realm that
  // joined another is a union, not a decline).
  const declineCensus = censusFrom(state, declineFrom);
  for (const civ of state.polities) {
    if (civ.kind !== 'civ' || (civ.deathTick !== null && civ.deathTick < declineFrom * 12)) continue;
    let peak: { year: number; people: number; regions: number } | null = null;
    for (let at = declineCensus; at < state.census.length; at++) {
      const place = placeIn(state.census[at], civ.id);
      if (place >= 0 && (!peak || state.census[at].people[place] > peak.people)) peak = { year: state.census[at].year, people: state.census[at].people[place], regions: state.census[at].regions[place] };
    }
    const own = mine.get(civ.id) ?? [], ended = civ.deathTick !== null;
    if (!peak || (ended && own.some(event => event.type === 'unification' && acts(event, civ.id, 'civ')))) continue;
    const people = ended ? 0 : peopleOf(state, civ);
    if (people > peak.people * DECLINE_SHARE) continue;
    const since = own.filter(event => event.tick >= peak.year * 12);
    const famines = since.filter(event => event.type === 'famine' && acts(event, civ.id)), deaths = famines.reduce((sum, event) => sum + number(event.data.deaths), 0);
    const neglected = since.filter(event => event.type === 'neglect' && event.data.begun === true).reduce((most, event) => Math.max(most, number(event.data.regions)), 0);
    // (M6.2) Land lost in war: regions it ceded, and its end if it was annexed.
    const lostInWar = since.filter(event => (event.type === 'regionConquered' && acts(event, civ.id, 'defender')) || (event.type === 'civDestroyed' && event.data.annexed === true && acts(event, civ.id, 'civ')));
    const regionsLostInWar = lostInWar.reduce((sum, event) => sum + (event.type === 'civDestroyed' ? number(event.data.regions) : 1), 0);
    const hard = since.filter(event => ['famine', 'neglect', 'arrears', 'unrest', 'buildingDecayed', 'infrastructureDestroyed', 'civDestroyed', 'drought', 'regionConquered', 'peaceSigned', 'warDeclared'].includes(event.type));
    const regions = ended ? regionsOf(since) : landOf(state, civ);
    tell('decline', civ, peak.year, ended ? yearOf(civ.deathTick!) : year, (peak.people - people) / world, {
      name: civ.name, peak: peak.people, peakYear: peak.year, people, regionsPeak: peak.regions, regions: civ.groups.length, ended, declining: !ended,
      regionsLost: !ended && civ.groups.length < peak.regions,
      famineDeaths: deaths, famine: deaths > 0, neglected, neglect: neglected > 0, lostInWar: regionsLostInWar, war: regionsLostInWar > 0,
    }, hard, regions, ended ? centroid(state, regions[0] ?? null) : capitalCell(state, civ));
  }

  // Union: the realms that joined a larger one in the last century, by the realm they joined.
  const unions = new Map<number, ChronicleEvent[]>();
  for (let at = recentStart; at < events.length; at++) {
    const event = events[at], union = event.type === 'unification' ? event.actors.find(actor => actor.role === 'union') : undefined;
    if (union) { const list = unions.get(union.id); if (list) list.push(event); else unions.set(union.id, [event]); }
  }
  for (const [id, joins] of unions) {
    const civ = state.polities[id], largest = [...joins].sort((a, b) => number(b.data.population) - number(a.data.population) || a.id - b.id)[0];
    const people = joins.reduce((sum, event) => sum + number(event.data.population), 0), regions = joins.reduce((sum, event) => sum + number(event.data.regions), 0);
    tell('union', civ, yearOf(joins[0].tick), yearOf(joins[joins.length - 1].tick), people / world, {
      name: civ.name, joined: String(largest.data.name ?? '?'), count: joins.length, others: joins.length - 1, one: joins.length === 1, many: joins.length > 1, people, regions,
    }, joins, civ.deathTick === null ? landOf(state, civ) : regionsOf(joins), civ.deathTick === null ? capitalCell(state, civ) : centroid(state, joins[0].region));
  }

  // A first: the people that led the world into its newest age, in the last century.
  const ages = agesOf(state), newest = ages[ages.length - 1];
  if (newest && newest.year >= recentFrom) {
    const leader = state.polities[newest.polity], alive = leader.deathTick === null;
    const found = (mine.get(leader.id) ?? []).filter(event => event.type === 'techDiscovered' && event.data.first === true && event.data.tech === newest.tech);
    tell('first', leader, newest.year, newest.year, alive ? Math.min(STANDING_SHARE, peopleOf(state, leader) / world) : 0.01, { name: leader.name, era: ERAS[newest.era], tech: newest.tech },
      found, alive ? landOf(state, leader) : regionsOf(found), alive ? capitalCell(state, leader) : centroid(state, found[0]?.region ?? null), newest.era);
  }

  // Faith: a religion founded in the last century, by how many follow it now.
  for (const religion of state.religions) {
    if (religion.deathTick !== null || religion.foundedTick < recentFrom * 12 || religion.people <= 0) continue;
    const founder = state.polities[religion.founder], sect = religion.parent !== null;
    // A sect grows apart from its parent faith (a schism); a new faith is founded.
    const found = (mine.get(founder.id) ?? []).filter(event => (event.type === 'religionFounded' || event.type === 'schism') && event.data.religion === religion.name);
    const regions: number[] = [];
    for (const id of state.living) for (const group of state.polities[id].groups) if (state.groups[group].faith === religion.id) regions.push(state.groups[group].region);
    tell('faith', founder, yearOf(religion.foundedTick), yearOf(religion.foundedTick), religion.people / world, {
      religion: religion.name, name: founder.name, people: religion.people, regions: religion.regions, tenets: religion.tenets.map(tenet => TENETS[tenet].name).join(', ').slice(0, 120),
      sect, founded: !sect, parentFaith: sect ? state.religions[religion.parent!].name : '', reformed: !sect && found[0]?.data.reformed === true, formerFaith: String(found[0]?.data.from ?? ''),
      hasTenets: religion.tenets.length > 0,
    }, found, regions.sort((a, b) => a - b), centroid(state, religion.holyRegion), religion.id);
  }

  // Peoples: a people grown apart from its forebears, two peoples become one, or a people taking up its rulers' ways
  // (only the strongest is told, so only its regions are gathered).
  let people: ChronicleEvent | null = null;
  for (let at = recentStart; at < events.length; at++) {
    const event = events[at];
    if (event.type !== 'cultureSplit' && event.type !== 'hybridCulture' && event.type !== 'assimilation') continue;
    if (!people || number(event.data.population) * recency(yearOf(event.tick)) > number(people.data.population) * recency(yearOf(people.tick))) people = event;
  }
  if (people) {
    // A new people (split or hybrid) is shown where it lives now; an assimilation where its people took up their
    // rulers' ways (the old culture still lives elsewhere).
    const event = people, polity = state.polities[event.actors[0].id], culture = String(event.data.culture ?? '?'), regions = new Set(event.region === null ? [] : [event.region]);
    if (event.type !== 'assimilation') for (const id of state.living) for (const group of state.polities[id].groups) if (state.cultures[state.groups[group].culture].name === culture) regions.add(state.groups[group].region);
    tell('peoples', polity, yearOf(event.tick), yearOf(event.tick), number(event.data.population) / world, {
      name: polity.name, culture, parent: String(event.data.parent ?? ''), first: String(event.data.first ?? ''), second: String(event.data.second ?? ''), ruling: String(event.data.ruling ?? ''),
      population: number(event.data.population), split: event.type === 'cultureSplit', hybrid: event.type === 'hybridCulture', assimilation: event.type === 'assimilation',
    }, [event], [...regions].sort((a, b) => a - b), centroid(state, event.region), event.id);
  }

  // Trade: the realm with the widest web of trade agreements and joint roads now.
  const trading = new Map<number, { agreements: number; partners: Set<number>; since: number }>();
  for (const treaty of state.treaties) {
    if (treaty.type !== 'trade' || treaty.endTick !== null) continue;
    for (const [one, other] of [[treaty.exporter, treaty.importer], [treaty.importer, treaty.exporter]]) {
      const entry = trading.get(one) ?? { agreements: 0, partners: new Set<number>(), since: treaty.startTick };
      entry.agreements++; entry.partners.add(other); entry.since = Math.min(entry.since, treaty.startTick); trading.set(one, entry);
    }
  }
  for (const [id, entry] of trading) {
    const civ = state.polities[id];
    if (civ.deathTick !== null || entry.agreements < 2) continue;
    const reach = entry.agreements + civ.roadPartners.length;
    const deals = (mine.get(id) ?? []).filter(event => event.tick >= recentFrom * 12 && event.type === 'tradeAgreement');
    // As recent as its newest agreement: a web that has not grown in a century fades from the rail.
    tell('trade', civ, yearOf(entry.since), Math.max(yearOf(entry.since), deals.length ? yearOf(deals[deals.length - 1].tick) : 0), Math.min(1, reach / 10) * Math.min(STANDING_SHARE, peopleOf(state, civ) / world), {
      name: civ.name, agreements: entry.agreements, partners: entry.partners.size, roads: civ.roadPartners.length, joint: civ.roadPartners.length > 0,
    }, deals, landOf(state, civ), capitalCell(state, civ));
  }

  // Voyages: a realm whose ships reached new lands in the last century (not a far coast of land already known).
  const voyages = new Map<number, ChronicleEvent[]>();
  for (let at = recentStart; at < events.length; at++) {
    const event = events[at], civ = event.type === 'newLandsDiscovered' && event.data.newLand === true ? event.actors.find(actor => actor.role === 'civ') : undefined;
    if (civ) { const list = voyages.get(civ.id); if (list) list.push(event); else voyages.set(civ.id, [event]); }
  }
  for (const [id, sailed] of voyages) {
    const civ = state.polities[id], farthest = [...sailed].sort((a, b) => number(b.data.km) - number(a.data.km) || a.id - b.id)[0], met = sailed.reduce((sum, event) => sum + number(event.data.met), 0);
    tell('voyage', civ, yearOf(sailed[0].tick), yearOf(sailed[sailed.length - 1].tick), Math.min(1, sailed.length / 2) * Math.min(STANDING_SHARE, (civ.deathTick === null ? peopleOf(state, civ) : 0) / world), {
      name: civ.name, voyages: sailed.length, one: sailed.length === 1, many: sailed.length > 1, km: number(farthest.data.km), explorer: String(farthest.data.explorer ?? '?'), met, metAny: met > 0,
    }, sailed, regionsOf(sailed), centroid(state, farthest.region));
  }

  // Hardship: the people that lost most to famine in the last century.
  const hunger = new Map<number, ChronicleEvent[]>();
  for (let at = recentStart; at < events.length; at++) {
    const event = events[at];
    if (event.type !== 'famine') continue;
    const list = hunger.get(event.actors[0].id);
    if (list) list.push(event); else hunger.set(event.actors[0].id, [event]);
  }
  for (const [id, famines] of hunger) {
    const polity = state.polities[id], worst = [...famines].sort((a, b) => number(b.data.deaths) - number(a.data.deaths) || a.id - b.id)[0];
    const deaths = famines.reduce((sum, event) => sum + number(event.data.deaths), 0);
    tell('hardship', polity, yearOf(famines[0].tick), yearOf(famines[famines.length - 1].tick), deaths / world, {
      name: polity.name, deaths, famines: famines.length, worst: number(worst.data.deaths), worstYear: yearOf(worst.tick),
    }, famines, regionsOf(famines), centroid(state, worst.region));
  }

  // Wars: those fought in the last century, by their dead and the people of the land they took (M6.2).
  for (const war of state.wars) {
    if (war.endTick !== null && war.endTick < recentFrom * 12) continue;
    const attacker = state.polities[war.attacker], defender = state.polities[war.defender];
    const dead = war.deaths[0] + war.deaths[1];
    let taken = 0;
    for (const region of war.ceded) if (state.groupAt[region] >= 0) taken += state.groups[state.groupAt[region]].size;
    for (const entry of war.occupied) if (state.groupAt[entry.region] >= 0) taken += state.groups[state.groupAt[entry.region]].size;
    const ended = war.endTick !== null, outcome = war.outcome ?? 'white';
    const winner = war.score >= 0 ? attacker : defender, loser = winner === attacker ? defender : attacker;
    const told = (mine.get(war.attacker) ?? []).filter(event => (event.type === 'warDeclared' || event.type === 'battleYear' || event.type === 'peaceSigned' || event.type === 'regionConquered') && event.data.warId === war.id);
    tell('war', attacker, yearOf(war.startTick), ended ? yearOf(war.endTick!) : year, (dead * WAR_STORY_DEAD + taken) / world, {
      war: war.name, attacker: attacker.name, defender: defender.name, since: yearOf(war.startTick), years: Math.max(1, Math.round(((ended ? war.endTick! : state.tick) - war.startTick) / 12)), dead,
      fighting: !ended, ahead: !ended && war.score >= 0, behind: !ended && war.score < 0, held: war.occupied.filter(entry => entry.by === war.attacker).length, lost: war.occupied.filter(entry => entry.by === war.defender).length,
      holding: !ended && war.occupied.some(entry => entry.by === war.attacker),
      endedWhite: ended && outcome === 'white', endedTribute: ended && outcome === 'tribute', endedCession: ended && outcome === 'cession', endedAnnexation: ended && outcome === 'annexation', endedGone: ended && outcome === 'gone',
      winner: winner.name, loser: loser.name, ceded: war.ceded.length,
    }, told, [...new Set([...war.goal, ...war.ceded])].sort((a, b) => a - b), centroid(state, war.goal[0] ?? war.ceded[0] ?? null), war.id, war.causes.slice(0, 2));
  }

  // Wonders: a wonder completed in the last century.
  for (let at = recentStart; at < events.length; at++) {
    const event = events[at];
    if (event.type !== 'wonderCompleted') continue;
    const civ = state.polities[event.actors[0].id];
    tell('wonder', civ, yearOf(event.tick), yearOf(event.tick), civ.deathTick === null ? Math.min(STANDING_SHARE, peopleOf(state, civ) / world) : 0.01, {
      name: civ.name, wonder: String(event.data.wonder ?? '?'), city: String(event.data.name ?? '?'), years: number(event.data.years),
    }, [event], event.region === null ? [] : [event.region], event.settlement === null ? centroid(state, event.region) : state.settlements[event.settlement].cell, event.id);
  }

  return candidates;
}
