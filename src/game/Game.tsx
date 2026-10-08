import { useEffect, useRef, useState, type FormEvent } from 'react';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import type { WorldManifest, WorldSettings } from '../../shared/generated-world.ts';
import { ERA_NAMES, SIMULATION_SPEEDS, simulationDate, type ChronicleEvent, type ObserverFrame, type SimulationSpeed } from '../../shared/simulation.ts';
import { loadGeneratedWorld } from '../api/generated-world.ts';
import { WORLD_BIOME_STYLE } from '../renderer/generated-world.ts';
import { describeEvent, MONTH_NAMES } from '../observer/events.ts';
import { factorName } from '../observer/labels.ts';
import { cssColor, polityColor } from '../observer/palettes.ts';
import { useObserver } from '../observer/useObserver.ts';
import { useRegionMap, useWorldMap, type PeoplesLens } from '../observer/useWorldMap.ts';
import { chosenWorld, rememberWorld } from '../observer/world-choice.ts';
import { people, RealmPanel, RegionDetail, type RealmTab } from './RealmPanel.tsx';
import './game.css';

const number = new Intl.NumberFormat('en');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The world could not be displayed. Try again.';
const SPEED_LABELS: Record<SimulationSpeed, string> = { month: 'month', year: 'year', decade: 'decade', max: 'fastest' };
const LENSES: { lens: PeoplesLens; label: string }[] = [
  { lens: 'polity', label: 'Political' }, { lens: 'culture', label: 'Culture' }, { lens: 'faith', label: 'Faith' },
  { lens: 'era', label: 'Era' }, { lens: 'descent', label: 'Descent' }, { lens: 'off', label: 'Terrain' },
];
/** Events shown in the ticker: the notable ones (`importance`), newest first. */
const TICKER_IMPORTANCE = 0.1, TICKER_LENGTH = 5;

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
  const map = useWorldMap({ world, layer: 'biomes', resources: false, rivers: true, regions, showRegions: false, frame, peoples: lens, showTrade, showFields: true, showRoads, background: '#0b1116' });
  const region = map.cellRegion;
  const observer = useObserver({ settings: world?.settings ?? null, startFresh: shown.current.fresh, inspect: region?.id ?? null, onFrame: setFrame });
  const names = observer.names;
  const inspected = frame?.inspect && region && frame.inspect.region === region.id ? frame.inspect : null;
  // The realm last shown stays (dimmed) while newly chosen land is read, so the panel neither flickers nor loses focus.
  const lastRealm = useRef<NonNullable<ObserverFrame['inspect']> | null>(null);
  if (inspected?.polity) lastRealm.current = inspected;
  else if (inspected || !region) lastRealm.current = null;
  const realmShown = inspected?.polity ? inspected : region ? lastRealm.current : null;

  const date = frame ? simulationDate(frame.tick) : null;
  const powers = frame ? frame.civList.slice(0, 10) : [];
  const ticker = observer.events.filter(event => event.importance >= TICKER_IMPORTANCE).slice(-TICKER_LENGTH).reverse();

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
      </div>
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
      {world ? <div className="game-map">
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

      {(map.cell || map.inspecting) && <aside className="game-panel game-place" aria-label="Selected place">
        <button type="button" className="game-close" aria-label="Close" onClick={map.clearSelection}>×</button>
        <div className="game-place-body">
        {realmShown && region
          ? <RealmPanel inspected={realmShown} stale={!inspected} region={region} biome={map.cell ? WORLD_BIOME_STYLE[map.cell.biome].label : null} tab={tab} onTab={setTab} names={names} />
          : <>
            {map.cell && <h2 className="game-place-title">{WORLD_BIOME_STYLE[map.cell.biome].label}</h2>}
            {region && <RegionDetail inspected={inspected} region={region} biome={map.cell ? WORLD_BIOME_STYLE[map.cell.biome].label : null} names={names} />}
          </>}
        {map.cell && !region && <p className="game-muted" role="status">{!regions ? 'Reading the land…' : map.cell.water.kind === 'ocean' ? 'Open sea.' : map.cell.water.kind === 'lake' ? 'A lake.' : 'Land outside the regions.'}</p>}
        </div>
      </aside>}

      {powers.length > 0 && frame && <aside className="game-panel game-powers" aria-label="Great powers">
        <h2>Great powers</h2>
        <ol aria-label="Civilizations by people">{powers.map(civ => <li key={civ.id}>
          <button type="button" onClick={() => map.focusCell(civ.capitalCell)} title={`Go to ${civ.capital}, the capital`}>
            <span className="game-swatch" style={{ backgroundColor: cssColor(polityColor(civ.id)) }} aria-hidden="true" />
            <span className="game-power-name">{civ.name}<span className="game-power-era">{ERA_NAMES[civ.era]}</span></span>
            <span className="game-power-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, civ.population / Math.max(1, powers[0].population) * 100)}%` }} /></span>
            <span className="game-power-share">{(civ.population / Math.max(1, frame.population) * 100).toFixed(1)}%</span>
          </button>
        </li>)}</ol>
        <p className="game-muted">{number.format(frame.civs)} civilizations and {number.format(frame.polities - frame.civs)} tribes in all; share of the world's people.</p>
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
        {ticker.length ? <ol className="game-events" aria-label="Latest in the chronicle">{ticker.map(event => <TickerEvent key={event.id} event={event} names={names} />)}</ol>
          : <p className="game-muted">{frame?.tick === 0 ? 'Press Play: the first bands are about to wander.' : 'Nothing notable among the latest events.'}</p>}
      </section>
    </main>
  </div>;
}

/** One notable event: its year, its text with the peoples' names, and its strongest cause. */
function TickerEvent({ event, names }: { event: ChronicleEvent; names: (id: number) => string }) {
  const cause = event.causes.length ? event.causes.reduce((best, entry) => Math.abs(entry.weight) > Math.abs(best.weight) ? entry : best) : null;
  return <li>
    <span className="game-event-year">{number.format(simulationDate(event.tick).year)}</span>
    <span>{describeEvent(event, names)}</span>
    {cause && <span className="game-event-cause">{factorName(cause.factor)}</span>}
  </li>;
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
