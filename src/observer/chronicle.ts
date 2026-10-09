import type { ChronicleEvent, EventType } from '../../shared/simulation.ts';

/** The kinds the chronicle is filtered by (U.5); every event type belongs to exactly one. */
export const EVENT_KIND_NAMES = {
  peoples: 'Peoples and realms', settlements: 'Settlements and building', knowledge: 'Knowledge', faith: 'Faith and culture',
  diplomacy: 'Trade and diplomacy', exploration: 'Exploration', hardship: 'Hardship', war: 'War and raids', development: 'Development controls',
} as const;
export type EventKind = keyof typeof EVENT_KIND_NAMES;
export const EVENT_KINDS = Object.keys(EVENT_KIND_NAMES) as EventKind[];

export const EVENT_KIND: Record<EventType, EventKind> = {
  bandSpawned: 'peoples', bandMoved: 'peoples', bandSplit: 'peoples', bandAbsorbed: 'peoples', bandJoined: 'peoples', confederation: 'peoples', bandSpread: 'peoples', settled: 'peoples',
  expansion: 'peoples', unification: 'peoples', civDestroyed: 'peoples', migrationWave: 'peoples', refugees: 'peoples', taxes: 'peoples',
  rulerSuccession: 'peoples', successionCrisis: 'peoples', governmentChange: 'peoples', unrest: 'peoples', revolt: 'peoples', secession: 'peoples',
  civilWar: 'peoples', independenceMovement: 'peoples', referendum: 'peoples', dissolution: 'peoples',
  settlementFounded: 'settlements', settlementTierChanged: 'settlements', capitalMoved: 'settlements', buildingCompleted: 'settlements', buildingDecayed: 'settlements',
  wonderBegun: 'settlements', wonderCompleted: 'settlements', wonderDestroyed: 'settlements', roadBuilt: 'settlements', infrastructureDestroyed: 'settlements',
  ruinsResettled: 'settlements',
  techDiscovered: 'knowledge', knowledgeShared: 'knowledge', knowledgeLost: 'knowledge', industrialization: 'knowledge', spaceMilestone: 'knowledge',
  religionFounded: 'faith', schism: 'faith', stateReligionChanged: 'faith', faithSpread: 'faith', cultureSplit: 'faith', hybridCulture: 'faith',
  assimilation: 'faith', traitEarned: 'faith',
  tradeAgreement: 'diplomacy', nonAggressionPact: 'diplomacy', alliance: 'diplomacy', vassalage: 'diplomacy', treatyCancelled: 'diplomacy',
  treatyBroken: 'diplomacy', roadAgreement: 'diplomacy',
  expedition: 'exploration', voyageLost: 'exploration', newLandsDiscovered: 'exploration', firstContact: 'exploration',
  drought: 'hardship', famine: 'hardship', famineRelief: 'hardship', climateShock: 'hardship', plague: 'hardship', neglect: 'hardship', arrears: 'hardship',
  warDeclared: 'war', battleYear: 'war', regionConquered: 'war', peaceSigned: 'war', raid: 'war', settlementLooted: 'war', settlementBurned: 'war',
  settlementRazed: 'war', nuclearUse: 'war', mobilization: 'war', demobilization: 'war',
  devScenario: 'development',
};

/** The event types of the given kinds. */
export const typesOf = (kinds: Iterable<EventKind>) => { const chosen = new Set(kinds); return (Object.keys(EVENT_KIND) as EventType[]).filter(type => chosen.has(EVENT_KIND[type])); };

/** One line of the curated chronicle: its newest event, how many more of its run there were, the tick the run began
 *  and, for famines, the people who died in all of them. */
export interface CuratedEntry { event: ChronicleEvent; more: number; from: number; deaths: number | null }

/** Events of one type for one people, each within this many years of the next, are one line. */
export const RUN_YEARS = 25;
/** Events this important stand on their own lines (a wonder completed, a faith founded, a realm settling), except
 *  droughts and famines, whose importance grows with their toll and whose runs curation is for. */
export const UNFOLDED_IMPORTANCE = 0.3;
const ALWAYS_FOLDED: ReadonlySet<EventType> = new Set(['drought', 'famine']);
/** The people an event is about, where it is not its first actor: the realm taking in or joined, not the band or
 *  realm joining it; the tribe a group breaks away from; the tribe a confederation grows. */
const MAIN_ROLE: Partial<Record<EventType, string>> = { bandAbsorbed: 'civ', bandJoined: 'civ', unification: 'union', bandSplit: 'parent', confederation: 'tribe' };
export const peopleOf = (event: ChronicleEvent) => (event.actors.find(actor => actor.role === MAIN_ROLE[event.type]) ?? event.actors[0])?.id ?? -1;
/** The run an event can fold into (its type and people), or null for one that stands on its own line. */
export const runKey = (event: ChronicleEvent) => event.importance >= UNFOLDED_IMPORTANCE && !ALWAYS_FOLDED.has(event.type) ? null : `${event.type}:${peopleOf(event)}`;

/**
 * The curated chronicle (U.5): events newest first, a run of one type for one people (each within `RUN_YEARS` of the
 * next) folded into one line under its newest event; a famine line sums its famines' deaths. Events of importance
 * `UNFOLDED_IMPORTANCE` or more are never folded, but droughts and famines always are.
 */
export function curate(events: readonly ChronicleEvent[]): CuratedEntry[] {
  const entries: CuratedEntry[] = [], open = new Map<string, CuratedEntry>();
  for (const event of events) {
    const deaths = event.type === 'famine' && typeof event.data.deaths === 'number' ? event.data.deaths : null;
    const key = runKey(event);
    if (key === null) { entries.push({ event, more: 0, from: event.tick, deaths }); continue; }
    const run = open.get(key);
    if (run && run.from - event.tick <= RUN_YEARS * 12) {
      run.more++; run.from = event.tick;
      if (deaths !== null) run.deaths = (run.deaths ?? 0) + deaths;
      continue;
    }
    const entry = { event, more: 0, from: event.tick, deaths };
    entries.push(entry); open.set(key, entry);
  }
  return entries;
}
