import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import type { WorldManifest, WorldSettings } from '../../shared/generated-world.ts';
import { ERA_NAMES, MAX_SIMULATION_YEAR, SIMULATION_SPEEDS, simulationDate, type ObserverFrame, type SimulationSpeed } from '../../shared/simulation.ts';
import { loadGeneratedWorld } from '../api/generated-world.ts';
import { WORLD_BIOME_STYLE } from '../renderer/generated-world.ts';
import { curate, runKey, type CuratedEntry } from '../observer/chronicle.ts';
import { describeEvent, MONTH_NAMES } from '../observer/events.ts';
import { factorName } from '../observer/labels.ts';
import { cssColor, DENSITY_GRADIENT, DENSITY_RANGE, polityColor, STANDING_COLORS } from '../observer/palettes.ts';
import { useObserver } from '../observer/useObserver.ts';
import { useRegionMap, useWorldMap, type PeoplesLens, type Perspective, type Standing } from '../observer/useWorldMap.ts';
import { chosenWorld, rememberWorld } from '../observer/world-choice.ts';
import { people, RealmPanel, RegionDetail, type RealmTab } from './RealmPanel.tsx';
import { ChronicleView } from './ChronicleView.tsx';
import { Ledger } from './Ledger.tsx';
import { Ages, StoryRail } from './StoryRail.tsx';
import { Tabs } from './Tabs.tsx';
import './game.css';

const number = new Intl.NumberFormat('en');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The world could not be displayed. Try again.';
const SPEED_LABELS: Record<SimulationSpeed, string> = { month: 'month', year: 'year', decade: 'decade', max: 'fastest' };
const LENSES: { lens: PeoplesLens; label: string }[] = [
  { lens: 'polity', label: 'Political' }, { lens: 'culture', label: 'Culture' }, { lens: 'faith', label: 'Faith' },
  { lens: 'era', label: 'Era' }, { lens: 'descent', label: 'Descent' }, { lens: 'diplomacy', label: 'Diplomacy' }, { lens: 'density', label: 'Density' }, { lens: 'off', label: 'Terrain' },
];
/** Events shown in the ticker: the notable ones (`importance`), newest first. */
const TICKER_IMPORTANCE = 0.1, TICKER_LENGTH = 5;
const SIDE_TABS = ['stories', 'powers'] as const;
const SIDE_NAMES = { stories: 'Stories', powers: 'Great powers' } as const;
type Story = ObserverFrame['stories'][number];

/**
 * The game (milestone U; VISION.md "Observer views"). The map is the stage: the top bar keeps time, lenses colour the
 * peoples, the great powers lead to their capitals, selecting land shows who lives there, and the ticker tells the
 * latest notable events. Every number is the simulation's state, read from the observer frames. The developer lab,
 * with geography layers and testing tools, is a separate page (`?lab`).
 */
export function Game() {
  const [world, setWorld] = useState<WorldManifest | null>(null);
  const [request, setRequest] = useState(() => ({ settings: chosenWorld(), revision: 0 }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lens, setLens] = useState<PeoplesLens>('polity');
  const [showTrade, setShowTrade] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [menu, setMenu] = useState(false);
  // The realm panel's tab, kept while other land is chosen so realms can be compared.
  const [tab, setTab] = useState<RealmTab>('overview');
  // The right-hand panel's tab, and the story chosen to be shown on the map: followed by its id into each new frame (its
  // regions grow and change as it goes on), and kept as last told when the rail no longer tells it.
  const [side, setSide] = useState<typeof SIDE_TABS[number]>('stories');
  // The stage: the map, or the ledger over it (U.4).
  const [view, setView] = useState<'map' | 'ledger' | 'chronicle'>('map');
  // The chronicle stays mounted once opened (hidden on the map), so its filters and pages are kept.
  const chronicleOpened = useOnce(view === 'chronicle');
  const [chosen, setStory] = useState<Story | null>(null);
  // Choosing another world in this tab starts that world's history again at year 0 (until saving exists).
  const shown = useRef<{ key: string; fresh: boolean }>({ key: '', fresh: false });
  if (world && shown.current.key !== world.worldKey) shown.current = { key: world.worldKey, fresh: shown.current.key !== '' };

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    void loadGeneratedWorld(request.settings, controller.signal).then(manifest => {
      if (!controller.signal.aborted) { setWorld(manifest); rememberWorld(manifest.settings); }
    }).catch(cause => { if (!controller.signal.aborted) setLoadError(message(cause)); });
    return () => controller.abort();
  }, [request]);

  const { regions, regionError } = useRegionMap(world);
  const [frame, setFrame] = useState<ObserverFrame | null>(null);
  useEffect(() => { setFrame(null); }, [world]);
  const story = chosen ? frame?.stories.find(entry => entry.id === chosen.id) ?? chosen : null;
  // The highlight changes only when the story's regions do, not with every frame.
  const storyRegions = story?.regions.join(',') ?? '';
  const highlight = useMemo(() => storyRegions ? new Set(storyRegions.split(',').map(Number)) : null, [storyRegions]);
  // The diplomacy lens (U.4): the standings of the civilization the place panel shows (set below, once it is known).
  const [standings, setStandings] = useState<{ self: number; name: string; of: ReadonlyMap<number, Standing> } | null>(null);
  // The perspective lens (U.6): the people whose view of the world the map shows, and that view from the frame.
  const [viewAs, setViewAs] = useState<{ id: number; name: string } | null>(null);
  const seenBy = frame?.perspective && viewAs && frame.perspective.polity === viewAs.id ? frame.perspective : null;
  const perspective = useMemo<Perspective | null>(() => seenBy ? {
    observed: new Set(seenBy.observed),
    remembered: new Map(seenBy.remembered.regions.map((region, at) => [region, { occupant: seenBy.remembered.occupants[at], year: seenBy.remembered.years[at] }])),
  } : null, [seenBy]);
  const map = useWorldMap({ world, layer: 'biomes', resources: false, rivers: true, regions, showRegions: false, frame, peoples: lens, showTrade, showFields: true, showRoads, background: '#0b1116', highlight, standings, perspective });
  const region = map.cellRegion;
  const observer = useObserver({ settings: world?.settings ?? null, startFresh: shown.current.fresh, inspect: region?.id ?? null, view: viewAs?.id ?? null, onFrame: setFrame });
  const names = observer.names;
  const inspected = frame?.inspect && region && frame.inspect.region === region.id ? frame.inspect : null;
  // The realm last shown stays (dimmed) while newly chosen land is read, so the panel neither flickers nor loses focus.
  const lastRealm = useRef<NonNullable<ObserverFrame['inspect']> | null>(null);
  if (inspected?.polity) lastRealm.current = inspected;
  else if (inspected || !region) lastRealm.current = null;
  const realmShown = inspected?.polity ? inspected : region ? lastRealm.current : null;
  // The lens follows the realm in the place panel (kept, like the panel, while newly chosen land is read); it changes
  // only when its realm or standings do.
  const lensRealm = realmShown?.polity?.kind === 'civ' ? realmShown.polity : null;
  const lensKey = lensRealm ? `${lensRealm.id}|${lensRealm.standings.map(entry => `${entry.id}:${entry.status}`).join(',')}` : '';
  useEffect(() => {
    setStandings(lensRealm ? { self: lensRealm.id, name: lensRealm.name, of: new Map<number, Standing>(lensRealm.standings.map(entry => [entry.id, entry.status])) } : null);
  // The key identifies the lens's realm and standings.
  }, [lensKey]);

  const date = frame ? simulationDate(frame.tick) : null;
  const powers = frame ? frame.civList.slice(0, 10) : [];
  // The ticker: the latest notable events, curated as the chronicle is (a year's famines on one line).
  const ticker = useMemo(() => curate(observer.events.filter(event => event.importance >= TICKER_IMPORTANCE).reverse()).slice(0, TICKER_LENGTH), [observer.events]);
  // A story ends with its history (a reset or another run) and when the selection it showed is closed.
  const history = frame ? `${frame.instance.runId}:${frame.epoch}` : '';
  // A perspective too: polity ids start again with a new history, so the same id would be another people.
  useEffect(() => { setStory(null); setViewAs(null); }, [history]);
  const selected = !!map.cell || map.inspecting;
  const wasSelected = useRef(false);
  useEffect(() => { if (wasSelected.current && !selected) setStory(null); wasSelected.current = selected; }, [selected]);
  function chooseStory(next: Story) {
    if (story?.id === next.id) { setStory(null); return; }
    setStory(next);
    if (next.focus !== null) map.focusCell(next.focus);
  }

  return <div className="game">
    <header className="game-bar">
      <span className="game-brand" title={world ? `The world of ${world.settings.seed}` : undefined}>CHRONICLE</span>
      <div className="game-clock" role="region" aria-label="Time" data-tick={frame?.tick ?? ''} data-playing={frame ? String(frame.playing) : ''}>
      <h1 className="game-date" id="game-date">{date ? `Year ${number.format(date.year)} · ${MONTH_NAMES[date.month - 1]}` : 'Year —'}</h1>
      {frame && <span className="game-era">{ERA_NAMES[frame.leadingEra]} age</span>}
      <div className="game-time" role="group" aria-label="Time controls">
        {frame?.playing
          ? <button type="button" onClick={() => void observer.send({ action: 'pause' })}>Pause</button>
          : <button type="button" disabled={!frame} onClick={() => void observer.send({ action: 'play' })}>Play</button>}
        <button type="button" disabled={!frame} onClick={() => void observer.send({ action: 'step' })}>Step</button>
        <div className="game-speed" role="group" aria-label="Speed">{SIMULATION_SPEEDS.map(speed => <button key={speed} type="button" aria-pressed={frame?.speed === speed}
          disabled={!frame} onClick={() => void observer.send({ action: 'speed', speed })}>{SPEED_LABELS[speed]}</button>)}</div>
        <RunTo frame={frame} onRun={year => void observer.send({ action: 'runTo', year })} />
      </div>
      </div>
      <div className="game-views" role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>Map</button>
        <button type="button" aria-pressed={view === 'ledger'} disabled={!frame} onClick={() => setView('ledger')}>Ledger</button>
        <button type="button" aria-pressed={view === 'chronicle'} disabled={!frame} onClick={() => setView('chronicle')}>Chronicle</button>
      </div>
      {frame && <dl className="game-totals" aria-label="The world">
        <div><dt>people</dt><dd id="game-people">{people(frame.population)}</dd></div>
        <div><dt>civilizations</dt><dd>{number.format(frame.civs)}</dd></div>
        <div><dt>tribes</dt><dd>{number.format(frame.polities - frame.civs)}</dd></div>
        <div><dt>settlements</dt><dd>{number.format(frame.settlementCount)}</dd></div>
      </dl>}
      <div className="game-menu">
        <button type="button" aria-expanded={menu} onClick={() => setMenu(open => !open)}>World</button>
        {menu && <WorldMenu settings={world?.settings ?? request.settings} onClose={() => setMenu(false)}
          onChoose={settings => { setMenu(false); setRequest(current => ({ settings, revision: current.revision + 1 })); }}
          onReset={() => { setMenu(false); void observer.send({ action: 'reset' }); }} />}
        <a href="?lab" className="game-lab-link">Lab</a>
      </div>
    </header>

    <main className="game-stage" aria-label="The world">
      {world ? <div className="game-map" inert={view !== 'map'}>
        <canvas ref={map.canvas} id="game-map-canvas" tabIndex={0} role="img" aria-label="The world: its peoples, settlements, roads and trade routes. Click land to see who lives there." aria-describedby="game-map-keys" />
        <canvas ref={map.overlay} className="game-map-overlay" aria-hidden="true" />
        <p id="game-map-keys" className="game-sr-only">Keyboard: arrows move the selection, Enter selects, Shift and arrows pan, plus and minus zoom, Home fits the world, Escape clears.</p>
      </div> : <div className="game-loading" role="status">{loadError
        ? <>The world is unavailable: {loadError} <button type="button" onClick={() => setRequest(current => ({ ...current, revision: current.revision + 1 }))}>Retry</button></>
        : 'A world is taking shape…'}</div>}
      <div className="game-alerts">
        {loadError && world && <p className="game-error" role="alert">{loadError} <button type="button" onClick={() => setRequest(current => ({ ...current, revision: current.revision + 1 }))}>Retry</button></p>}
        {observer.error && <p className="game-error" role="alert">{observer.error}</p>}
        {map.canvasError && <p className="game-error" role="alert">{map.canvasError} <button type="button" onClick={map.retryCanvas}>Retry</button></p>}
        {map.tileError && <p className="game-error" role="alert">{map.tileError} <button type="button" onClick={map.retryDetail}>Retry detail</button></p>}
        {regionError && <p className="game-error" role="alert">The simulation's regions could not be read: {regionError}</p>}
      </div>

      {chronicleOpened && frame && world && <ChronicleView settings={world.settings} frame={frame} regions={regions} hidden={view !== 'chronicle'}
        selected={realmShown?.polity ? { id: realmShown.polity.id, name: realmShown.polity.name } : null}
        onShow={cell => { setView('map'); map.focusCell(cell); requestAnimationFrame(() => map.canvas.current?.focus()); }} />}
      {view === 'ledger' && frame && world && <Ledger frame={frame} regions={regions} width={world.width} height={world.height}
        onChoose={cell => { setView('map'); map.focusCell(cell); requestAnimationFrame(() => map.canvas.current?.focus()); }} />}

      {view === 'map' && <>
      {(map.cell || map.inspecting) && <aside className="game-panel game-place" aria-label="Selected place">
        <button type="button" className="game-close" aria-label="Close" onClick={map.clearSelection}>×</button>
        <div className="game-place-body">
        {seenBy && region && <PerspectiveNote perspective={seenBy} region={region.id} />}
        {realmShown && region
          ? <RealmPanel inspected={realmShown} stale={!inspected} region={region} biome={map.cell ? WORLD_BIOME_STYLE[map.cell.biome].label : null} tab={tab} onTab={setTab} names={names}
            viewing={viewAs?.id === realmShown.polity?.id} onViewAs={people => setViewAs(current => current?.id === people.id ? null : people)} />
          : <>
            {map.cell && <h2 className="game-place-title">{WORLD_BIOME_STYLE[map.cell.biome].label}</h2>}
            {region && <RegionDetail inspected={inspected} region={region} biome={map.cell ? WORLD_BIOME_STYLE[map.cell.biome].label : null} names={names} />}
          </>}
        {!map.cell && map.inspecting && !realmShown && <p className="game-muted" role="status">Reading the land…</p>}
        {map.cell && !region && <p className="game-muted" role="status">{!regions ? 'Reading the land…' : map.cell.water.kind === 'ocean' ? 'Open sea.' : map.cell.water.kind === 'lake' ? 'A lake.' : 'Land outside the regions.'}</p>}
        </div>
      </aside>}

      {frame && <aside className="game-panel game-side" aria-label="Stories and great powers">
        <Tabs id="game-side" label="The world now" tabs={SIDE_TABS} names={SIDE_NAMES} chosen={side} onChoose={setSide} className="game-side-tabs" panelClassName="game-side-body">
        {side === 'stories' ? <StoryRail stories={frame.stories} chosen={story?.id ?? null} onChoose={chooseStory} names={names} /> : powers.length === 0 ? <p className="game-muted">No civilization has risen yet.</p> : <>
        <ol aria-label="Civilizations by people" className="game-powers">{powers.map(civ => <li key={civ.id}>
          <button type="button" onClick={() => map.focusCell(civ.capitalCell)} title={`Go to ${civ.capital}, the capital`}>
            <span className="game-swatch" style={{ backgroundColor: cssColor(polityColor(civ.id)) }} aria-hidden="true" />
            <span className="game-power-name">{civ.name}<span className="game-power-era">{ERA_NAMES[civ.era]}</span></span>
            <span className="game-power-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, civ.population / Math.max(1, powers[0].population) * 100)}%` }} /></span>
            <span className="game-power-share">{(civ.population / Math.max(1, frame.population) * 100).toFixed(1)}%</span>
          </button>
        </li>)}</ol>
        <p className="game-muted">{number.format(frame.civs)} civilizations and {number.format(frame.polities - frame.civs)} tribes in all; share of the world's people.</p>
        </>}
        </Tabs>
      </aside>}

      <section className="game-panel game-ticker" aria-label="Lenses and chronicle">
        <div className="game-lenses" role="group" aria-label="Map lens">
          {LENSES.map(entry => <button key={entry.lens} type="button" aria-pressed={lens === entry.lens} onClick={() => setLens(entry.lens)}>{entry.label}</button>)}
          <label><input type="checkbox" checked={showTrade} onChange={event => setShowTrade(event.target.checked)} /> Trade routes</label>
          <label><input type="checkbox" checked={showRoads} onChange={event => setShowRoads(event.target.checked)} /> Roads</label>
          <div className="game-zoom" role="group" aria-label="Map view">
            <button type="button" aria-label="Zoom in" onClick={() => map.zoomBy(1.6)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => map.zoomBy(1 / 1.6)}>−</button>
            <button type="button" onClick={map.fit}>Fit</button>
          </div>
        </div>
        {viewAs && <p className="game-view-chip"><span role="status">The world as the {seenBy?.name ?? viewAs.name} know it{frame && !frame.markers.ids.includes(viewAs.id) ? ' (they are gone)' : ''}: fog where they have never been, muted where they remember.</span>
          <button type="button" onClick={() => setViewAs(null)}>Leave their view</button></p>}
        {lens === 'diplomacy' && <DiplomacyKey realm={standings?.name ?? null} />}
        {lens === 'density' && <div className="game-lens-key" role="group" aria-label="Density lens"><p>People per km² in each region:</p>
          <div className="game-density-scale"><span className="game-density-bar" style={{ background: DENSITY_GRADIENT }} aria-hidden="true" />
            {[DENSITY_RANGE[0], 0.1, 1, 10, 100, DENSITY_RANGE[1]].map(value => <span key={value} style={{ left: `${(Math.log10(value) - Math.log10(DENSITY_RANGE[0])) / (Math.log10(DENSITY_RANGE[1]) - Math.log10(DENSITY_RANGE[0])) * 100}%` }}>{value === DENSITY_RANGE[1] ? `${value}+` : value}</span>)}</div></div>}
        {frame && <Ages ages={frame.ages} year={Math.floor(frame.tick / 12)} />}
        {ticker.length ? <ol className="game-events" aria-label="Latest in the chronicle">{ticker.map(entry => <TickerEvent key={entry.event.id} entry={entry} names={names} />)}</ol>
          : <p className="game-muted">{frame?.tick === 0 ? 'Press Play: the first bands are about to wander.' : 'Nothing notable among the latest events.'}</p>}
      </section>
      </>}
    </main>
  </div>;
}

const STANDING_KEY: [keyof typeof STANDING_COLORS, string][] = [['self', 'the realm'], ['allied', 'allied'], ['pact', 'pact'], ['trade', 'trade partner'], ['rival', 'rival'], ['neutral', 'neutral'], ['unknown', 'not met']];

/** The diplomacy lens's key (U.4): whose standings the map shows, and each standing's colour. */
function DiplomacyKey({ realm }: { realm: string | null }) {
  return <div className="game-lens-key" role="group" aria-label="Diplomacy lens">
    <p>{realm ? `Every people by its standing with the ${realm}:` : 'Select a civilization\'s land to see its standing with every people.'}</p>
    <ul>{STANDING_KEY.map(([standing, label]) => <li key={standing}><span className="game-swatch" style={{ backgroundColor: `rgb(${STANDING_COLORS[standing].join(' ')})` }} aria-hidden="true" />{label}</li>)}</ul>
  </div>;
}

/** One notable event (or a run of them, curated): its year, its text with the peoples' names, and its strongest cause. */
function TickerEvent({ entry, names }: { entry: CuratedEntry; names: (id: number) => string }) {
  const { event, more, deaths } = entry;
  const cause = event.causes.length ? event.causes.reduce((best, entry) => Math.abs(entry.weight) > Math.abs(best.weight) ? entry : best) : null;
  return <li>
    <span className="game-event-year">{number.format(simulationDate(event.tick).year)}</span>
    <span data-run={runKey(event) ?? undefined} data-from={simulationDate(entry.from).year}>{describeEvent(event, names)}{more > 0 && <span className="game-history-more"> And {number.format(more)} more like it{deaths !== null ? `: ${number.format(deaths)} died in all` : ''}.</span>}</span>
    {cause && <span className="game-event-cause">{factorName(cause.factor)}</span>}
  </li>;
}

/** Run the history on to a later year (U.6; as the lab's Run to year), or say where it is running to. */
function RunTo({ frame, onRun }: { frame: ObserverFrame | null; onRun: (year: number) => void }) {
  const now = frame ? Math.floor(frame.tick / 12) : 0, [year, setYear] = useState(''), target = Number(year);
  const valid = year !== '' && Number.isInteger(target) && target > now && target <= MAX_SIMULATION_YEAR, running = frame?.runTo ?? null;
  function submit(event: FormEvent) { event.preventDefault(); if (valid) onRun(target); }
  // The button says where the history is running to, so the bar does not reflow.
  return <form className="game-run-to" onSubmit={submit}>
    <label>To year <input type="number" inputMode="numeric" min={now + 1} max={MAX_SIMULATION_YEAR} value={year} onChange={event => setYear(event.target.value)} disabled={!frame || now >= MAX_SIMULATION_YEAR} /></label>
    <button type="submit" disabled={!frame || !valid}>{running !== null ? `to ${number.format(running)}…` : 'Run'}</button>
    <span className="game-sr-only" role="status">{running !== null ? `Running to year ${number.format(running)}` : ''}</span>
  </form>;
}

/** How the people whose view the map shows knows the selected region (U.6). */
function PerspectiveNote({ perspective, region }: { perspective: NonNullable<ObserverFrame['perspective']>; region: number }) {
  const at = perspective.remembered.regions.indexOf(region), names = new Map(perspective.names);
  const text = perspective.observed.includes(region) ? `In sight of the ${perspective.name}.`
    : at >= 0 ? `Last seen by the ${perspective.name} in year ${number.format(perspective.remembered.years[at])}, ${perspective.remembered.occupants[at] >= 0 ? `held by the ${names.get(perspective.remembered.occupants[at]) ?? '?'} then` : 'with no one living there then'}.`
    : `Unknown to the ${perspective.name}.`;
  return <p className="game-perspective-note" id="game-perspective-note">{text}</p>;
}

/** True from the first time `value` is true. */
function useOnce(value: boolean) {
  const [once, setOnce] = useState(value);
  if (value && !once) setOnce(true);
  return once || value;
}

/** Choosing a world (seed and size), and starting its history again. */
function WorldMenu({ settings, onChoose, onReset, onClose }: { settings: WorldSettings; onChoose: (settings: WorldSettings) => void; onReset: () => void; onClose: () => void }) {
  const [seed, setSeed] = useState(settings.seed);
  const [size, setSize] = useState(settings.size);
  const [confirming, setConfirming] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  function submit(event: FormEvent) { event.preventDefault(); onChoose({ seed, size }); }
  return <div className="game-world-menu" role="dialog" aria-label="World" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <form onSubmit={submit}>
      <label htmlFor="game-seed">World seed</label>
      <input ref={first} id="game-seed" value={seed} onChange={event => setSeed(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9 _.\-]+" autoComplete="off" />
      <label htmlFor="game-size">Size</label>
      <select id="game-size" value={size} onChange={event => setSize(event.target.value as WorldSettings['size'])}>
        <option value="large">Large</option><option value="standard">Standard</option>
      </select>
      <button type="submit">Show this world</button>
    </form>
    {confirming
      ? <button type="button" className="game-danger" onClick={onReset}>Yes, start again from year 0</button>
      : <button type="button" onClick={() => setConfirming(true)}>Start its history again…</button>}
    <button type="button" onClick={onClose}>Close</button>
    <p className="game-muted">The same seed always grows the same land; its history runs on this PC.</p>
  </div>;
}
