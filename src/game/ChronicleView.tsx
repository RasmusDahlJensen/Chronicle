import { useEffect, useMemo, useRef, useState } from 'react';
import { worldKey, type WorldSettings } from '../../shared/generated-world.ts';
import { simulationDate, type ChronicleEvent, type ObserverFrame } from '../../shared/simulation.ts';
import { fetchChroniclePage } from '../api/simulation.ts';
import { curate, EVENT_KIND_NAMES, EVENT_KINDS, typesOf, type CuratedEntry, type EventKind } from '../observer/chronicle.ts';
import { describeEvent } from '../observer/events.ts';
import { factorName } from '../observer/labels.ts';
import { mergeNames, nameOf } from '../observer/names.ts';
import type { RegionData } from '../observer/useWorldMap.ts';

const number = new Intl.NumberFormat('en');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The chronicle could not be read. Try again.';
/** Notable: as the realm panel's history (U.2) counts them. */
const NOTABLE = 0.05, PAGE = 200;

interface Props {
  settings: WorldSettings; frame: ObserverFrame; regions: RegionData | null;
  /** Hidden while the map or the ledger is shown, so its filters and the pages read are kept. */
  hidden: boolean;
  /** The people selected on the map (a tribe or civilization), offered as a filter. */
  selected: { id: number; name: string } | null;
  onShow: (cell: number) => void;
}

/**
 * The chronicle (U.5): the whole history, newest first, read a page at a time back to year 0, filtered by kind, by
 * people and by importance, curated (runs of one kind of event folded into one line), each event with its causes and
 * a way to show it on the map.
 */
export function ChronicleView({ settings, frame, regions, hidden, selected, onShow }: Props) {
  const [kinds, setKinds] = useState<ReadonlySet<EventKind>>(() => new Set(EVENT_KINDS.filter(kind => kind !== 'development')));
  // The people filtered by, kept by name so it stays listed when it leaves the list of the largest or the selection.
  const [people, setPeople] = useState<{ id: number; name: string } | null>(null);
  const polity = people?.id ?? null;
  const [notable, setNotable] = useState(true);
  const [read, setRead] = useState<{ events: ChronicleEvent[]; next: number | null; eventCount: number; names: ReadonlyMap<number, string>; history: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null), restart = useRef(false);
  const history = `${worldKey(settings)}:${frame.instance.runId}:${frame.epoch}`;
  const filter = `${[...kinds].sort().join(',')}|${polity ?? ''}|${notable}`;

  function load(before: number | null, fresh: boolean) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(null);
    const types = kinds.size === EVENT_KINDS.length ? null : typesOf(kinds);
    void fetchChroniclePage(settings, { before, limit: PAGE, types, polity, min: notable ? NOTABLE : 0 }, controller.signal).then(page => {
      if (controller.signal.aborted) return;
      // An older page from another run or reset epoch (the history started again while reading) starts afresh.
      const from = `${page.runId}:${page.epoch}`;
      setRead(current => {
        if (!fresh && current && current.history !== from) { restart.current = true; return null; }
        const start = fresh || !current;
        return {
          events: start ? page.events : [...current.events, ...page.events], next: page.next, eventCount: start ? page.eventCount : current.eventCount,
          names: mergeNames(start ? new Map() : current.names, page.names, false), history: from,
        };
      });
      setLoading(false);
    }).catch(cause => { if (!controller.signal.aborted) { setError(message(cause)); setLoading(false); } });
  }
  // A new filter, history or request for the newest reads from the newest again.
  // (`filter`, `history` and `revision` identify what to read.)
  useEffect(() => { setRead(null); setError(null); if (kinds.size) load(null, true); else setLoading(false); return () => request.current?.abort(); }, [filter, history, revision]);
  // A page dropped as stale (from another history) reads the newest again.
  useEffect(() => { if (read === null && restart.current) { restart.current = false; load(null, true); } }, [read]);

  const entries = useMemo(() => read ? curate(read.events) : [], [read]);
  const names = useMemo(() => nameOf(read?.names ?? new Map()), [read]);
  const cells = useMemo(() => new Map(frame.settlements.ids.map((id, at) => [id, frame.settlements.cells[at]])), [frame.settlements]);
  const placeOf = (event: ChronicleEvent) => (event.settlement !== null ? cells.get(event.settlement) : undefined)
    ?? (event.region !== null && regions ? regions.map.regions[event.region]?.centroid : undefined) ?? null;
  const newer = read ? frame.eventCount - read.eventCount : 0;
  const peoples = [...[selected, people].filter((entry, at, all): entry is { id: number; name: string } => !!entry && !frame.civList.some(civ => civ.id === entry.id) && all.findIndex(other => other?.id === entry.id) === at), ...frame.civList];

  function toggle(kind: EventKind) {
    setKinds(current => { const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; });
  }

  return <section className="game-ledger-view game-chronicle-view" aria-label="Chronicle" hidden={hidden}>
    <div className="game-ledger-card game-chronicle-filters">
      <h2>The chronicle</h2>
      <fieldset><legend>Kinds of event</legend>
        {EVENT_KINDS.map(kind => <label key={kind}><input type="checkbox" checked={kinds.has(kind)} onChange={() => toggle(kind)} /> {EVENT_KIND_NAMES[kind]}</label>)}
      </fieldset>
      <div className="game-chronicle-row">
        <label>People <select value={polity ?? ''} onChange={event => setPeople(event.target.value === '' ? null : peoples.find(entry => entry.id === Number(event.target.value)) ?? null)}>
          <option value="">Every people</option>
          {peoples.map(entry => <option key={entry.id} value={entry.id}>The {entry.name}{selected?.id === entry.id ? ' (selected)' : ''}</option>)}
        </select></label>
        <label><input type="checkbox" checked={notable} onChange={event => setNotable(event.target.checked)} /> Notable events only</label>
        {newer > 0 && <button type="button" onClick={() => setRevision(current => current + 1)}>The history has {number.format(newer)} newer {newer === 1 ? 'event' : 'events'}: read from the newest</button>}
      </div>
    </div>
    <div className="game-ledger-card">
      {error && kinds.size > 0 && <p className="game-error" role="alert">{error} <button type="button" onClick={() => load(read?.next ?? null, !read)}>Retry</button></p>}
      {!kinds.size ? <p className="game-muted">Choose a kind of event to read.</p>
        : entries.length ? <ol className="game-chronicle" aria-label="The chronicle">{entries.map(entry => <Entry key={entry.event.id} entry={entry} names={names} place={placeOf(entry.event)} onShow={onShow} />)}</ol>
        : !loading && read && <p className="game-muted">{read.next === null ? 'No such events in this history.' : 'None among the events read so far.'}</p>}
      <p className="game-chronicle-more" role="status">{read && read.next !== null
        ? <button type="button" aria-disabled={loading} onClick={() => { if (!loading) load(read.next, false); }}>{loading ? 'Reading the chronicle…' : 'Read older events'}</button>
        : loading ? 'Reading the chronicle…' : read ? 'Back to year 0.' : ''}</p>
    </div>
  </section>;
}

/** One line: its year (or years), what happened, how many more like it, its causes and where. */
function Entry({ entry, names, place, onShow }: { entry: CuratedEntry; names: (id: number) => string; place: number | null; onShow: (cell: number) => void }) {
  const { event, more, from, deaths } = entry, first = simulationDate(from).year, last = simulationDate(event.tick).year;
  return <li>
    <span className="game-event-year">{first < last ? `${number.format(first)}–${number.format(last)}` : number.format(last)}</span>
    <div>
      <p>{describeEvent(event, names)}{more > 0 && <span className="game-history-more"> And {number.format(more)} more like it{first < last ? ` since year ${number.format(first)}` : ' that year'}{deaths !== null ? `: ${number.format(deaths)} died in all` : ''}.</span>}</p>
      {event.causes.length > 0 && <p className="game-muted">Why: {event.causes.map(cause => `${factorName(cause.factor)} ${cause.weight >= 0 ? '+' : '−'}${Math.abs(cause.weight).toFixed(2)}`).join(', ')}</p>}
    </div>
    {place !== null && <button type="button" className="game-chronicle-show" onClick={() => onShow(place)}>Show on the map</button>}
  </li>;
}
