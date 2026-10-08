import { useState, type FormEvent } from 'react';
import type { WorldSettings } from '../../shared/generated-world.ts';
import { DEV_SCENARIOS, ERA_NAMES, MAX_SIMULATION_YEAR, SIMULATION_SPEEDS, simulationDate, type DevScenario, type ObserverFrame, type SimulationSpeed } from '../../shared/simulation.ts';
import { describeEvent, MONTH_NAMES } from '../observer/events.ts';
import { cssColor, polityColor } from '../observer/palettes.ts';
import { useObserver } from '../observer/useObserver.ts';

const SPEED_LABELS: Record<SimulationSpeed, string> = { month: '1 month/s', year: '1 year/s', decade: '10 years/s', max: 'Fastest' };
/** DEVELOPMENT CONTROLS (Dev 02), not product features: scenario triggers in the selected region. */
const DEV_LABELS: Record<DevScenario, string> = { drought: 'Drought here and around', research: 'Finish their research', foundReligion: 'Found a religion', splitCulture: 'Split off their culture' };

interface Props {
  settings: WorldSettings | null;
  /** True when the observer chose this world in place of another one: its history starts again at year 0. */
  startFresh?: boolean;
  /** Region whose details each frame should carry (null for none). */
  inspect?: number | null;
  onFrame?: (frame: ObserverFrame) => void;
  /** Show a civilization's capital on the map (the civilization list). */
  onFocusCell?: (cell: number) => void;
}

/** World population and living polities over time, from the frame's series. */
function WorldChart({ series }: { series: ObserverFrame['series'] }) {
  if (series.length < 2) return null;
  const width = 520, height = 120, pad = 4;
  const maxYear = series[series.length - 1][0] || 1;
  const maxPopulation = Math.max(1, ...series.map(point => point[1]));
  const maxPolities = Math.max(1, ...series.map(point => point[2]));
  const line = (value: (point: ObserverFrame['series'][number]) => number, max: number) => series.map(point =>
    `${(pad + point[0] / maxYear * (width - 2 * pad)).toFixed(1)},${(height - pad - value(point) / max * (height - 2 * pad)).toFixed(1)}`).join(' ');
  const last = series[series.length - 1];
  return <figure className="world-history-chart" aria-label="World population chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`World population ${last[1].toLocaleString('en')} in year ${last[0]}`}>
      <polyline className="world-chart-population" points={line(point => point[1], maxPopulation)} />
      <polyline className="world-chart-polities" points={line(point => point[2], maxPolities)} />
    </svg>
    <figcaption><span className="world-chart-key-population">World population</span> {last[1].toLocaleString('en')} (max {maxPopulation.toLocaleString('en')}) · <span className="world-chart-key-polities">Tribes and civilizations</span> {last[2].toLocaleString('en')} · years 0–{maxYear.toLocaleString('en')}</figcaption>
  </figure>;
}

/** Living settlements by tier: "1,204 settlements (310 towns, 12 cities)". */
function settlementSummary(frame: ObserverFrame) {
  const counts = [0, 0, 0, 0];
  for (const tier of frame.settlements.tiers) counts[tier]++;
  const parts = ([[1, 'town', 'towns'], [2, 'city', 'cities'], [3, 'metropolis', 'metropolises']] as const).filter(([tier]) => counts[tier] > 0).map(([tier, one, many]) => `${counts[tier].toLocaleString('en')} ${counts[tier] === 1 ? one : many}`);
  return `${frame.settlementCount.toLocaleString('en')} ${frame.settlementCount === 1 ? 'settlement' : 'settlements'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * Observer time controls and the raw chronicle list. The browser polls compact frames and shows only the newest:
 * each request takes a sequence number and an older response never replaces a newer one. A frame from another world,
 * run or reset epoch never mixes into the displayed history.
 */
export function SimulationPanel({ settings, startFresh = false, inspect = null, onFrame, onFocusCell }: Props) {
  const { frame, events, error, restarted, send, names } = useObserver({ settings, startFresh, inspect, onFrame });
  const [targetYear, setTargetYear] = useState('100');
  const [loadYear, setLoadYear] = useState('1000');
  /** Where the last development control was used: a region, or 'load' (its refusal is shown only there). */
  const [devUsed, setDevUsed] = useState<number | 'load' | null>(null);

  function runTo(event: FormEvent) {
    event.preventDefault();
    const year = Number(targetYear);
    if (Number.isInteger(year) && year >= 0 && year <= MAX_SIMULATION_YEAR) void send({ action: 'runTo', year });
  }
  function load(year: number) {
    if (!Number.isInteger(year) || year < 0 || year > MAX_SIMULATION_YEAR) return;
    setDevUsed('load'); void send({ action: 'load', year });
  }
  function trigger(scenario: DevScenario) {
    if (inspect === null) return;
    setDevUsed(inspect); void send({ action: 'scenario', scenario, region: inspect });
  }

  const date = frame ? simulationDate(frame.tick) : null;
  const ended = frame ? frame.tick >= MAX_SIMULATION_YEAR * 12 : false;
  // Tribes roam with one band in each of their regions.
  const bands = frame ? frame.markers.kinds.filter(kind => kind === 0).length : 0;
  const status = !frame ? 'Starting the simulation…' : frame.runTo !== null ? `Running to year ${frame.runTo}…` : frame.playing ? `Playing · ${SPEED_LABELS[frame.speed]}` : ended ? 'The run has reached its end' : 'Paused';
  return <section className="world-history" aria-label="History" data-tick={frame?.tick ?? ''} data-playing={frame ? String(frame.playing) : ''} data-run-id={frame?.instance.runId ?? ''} data-epoch={frame?.epoch ?? ''}>
    <div className="world-history-heading">
      <div><p className="atlas-section-index">04 / History</p><h2 id="simulation-date">{date ? `Year ${date.year.toLocaleString('en')} · ${MONTH_NAMES[date.month - 1]}` : 'Year —'}</h2></div>
      <p className="world-history-status" role="status" aria-live="polite">{status}</p>
    </div>
    <div className="world-history-controls" role="group" aria-label="Time controls">
      <button type="button" disabled={!frame || frame.playing || ended} onClick={() => void send({ action: 'play' })}>Play</button>
      <button type="button" disabled={!frame || !frame.playing} onClick={() => void send({ action: 'pause' })}>Pause</button>
      <button type="button" disabled={!frame || ended} onClick={() => void send({ action: 'step' })}>Step month</button>
      <label>Speed <select aria-label="Speed" value={frame?.speed ?? 'year'} disabled={!frame} onChange={event => void send({ action: 'speed', speed: event.target.value as SimulationSpeed })}>
        {SIMULATION_SPEEDS.map(speed => <option key={speed} value={speed}>{SPEED_LABELS[speed]}</option>)}
      </select></label>
      <form onSubmit={runTo}><label>Run to year <input aria-label="Run to year" type="number" min={0} max={MAX_SIMULATION_YEAR} value={targetYear} onChange={event => setTargetYear(event.target.value)} /></label><button type="submit" disabled={!frame}>Run</button></form>
      <button type="button" className="world-history-reset" disabled={!frame} onClick={() => void send({ action: 'reset' })}>Reset to year 0</button>
    </div>
    {error && <p className="atlas-error" role="alert">{error}</p>}
    <details className="world-dev-controls" open>
      <summary>Testing tools: development controls <span>test only · they change this history</span></summary>
      {frame?.dev.checkpoints && <form className="world-dev-load" onSubmit={event => { event.preventDefault(); load(Number(loadYear)); }}>
        <label>Load year <input aria-label="Load year" type="number" min={0} max={MAX_SIMULATION_YEAR} value={loadYear} onChange={event => setLoadYear(event.target.value)} /></label>
        <button type="submit" disabled={!frame}>Load</button>
        <span>{frame.dev.checkpoints.length ? 'Saved:' : 'Starts from the nearest saved year before it and runs on; years are saved every 250 years of a history left to its rules.'}</span>
        {frame.dev.checkpoints.map(year => <button key={year} type="button" className="world-dev-year" onClick={() => { setLoadYear(String(year)); load(year); }}>{year.toLocaleString('en')}</button>)}
      </form>}
      <p>{frame?.tick === 0 ? 'Nothing has happened yet: run the history a little first.' : inspect === null ? 'Select a region on the map to use these there.' : `In region ${inspect}, now, through the real rules:`} A religion needs a civilization (from about year 1,000).</p>
      <div role="group" aria-label="Scenario triggers">{DEV_SCENARIOS.map(scenario => <button key={scenario} type="button" disabled={!frame || frame.tick === 0 || inspect === null}
        onClick={() => trigger(scenario)}>{DEV_LABELS[scenario]}</button>)}</div>
      {frame && frame.dev.checkpoints === null && <p className="world-dev-loaded">Load year is off on this host (CHRONICLE_CHECKPOINTS).</p>}
      {frame?.dev.refused && devUsed !== null && (devUsed === 'load' || devUsed === inspect) && <p className="world-dev-refused" role="status">{frame.dev.refused}</p>}
      {frame && frame.dev.loadedFrom !== null && <p className="world-dev-loaded">This history was loaded from the checkpoint at year {frame.dev.loadedFrom.toLocaleString('en')}.</p>}
    </details>
    {frame && frame.dev.actions > 0 && <p className="world-dev-altered" role="note">This history was altered: development controls were used {frame.dev.actions === 1 ? 'once' : `${frame.dev.actions.toLocaleString('en')} times`}.</p>}
    {frame && <p className="world-history-totals" id="world-population">{frame.population.toLocaleString('en')} people in {(frame.polities - frame.civs).toLocaleString('en')} {frame.polities - frame.civs === 1 ? 'tribe' : 'tribes'} ({bands.toLocaleString('en')} {bands === 1 ? 'band' : 'bands'}) and {frame.civs.toLocaleString('en')} {frame.civs === 1 ? 'civilization' : 'civilizations'} · {settlementSummary(frame)} · {frame.specialists.toLocaleString('en')} townspeople · most advanced: {ERA_NAMES[frame.leadingEra]} era</p>}
    {frame && <WorldChart series={frame.series} />}
    {frame && frame.civList.length > 0 && <details className="world-civ-list" open>
      <summary>Civilizations <span>{frame.civs.toLocaleString('en')}{frame.civs > frame.civList.length ? `, the largest ${frame.civList.length}` : ''} · regions · people</span></summary>
      <ol aria-label="Civilizations">{frame.civList.map(civ => <li key={civ.id}>
        <button type="button" onClick={() => onFocusCell?.(civ.capitalCell)} title={`Show ${civ.capital}, the capital, on the map`}>
          <span className="world-civ-swatch" style={{ backgroundColor: cssColor(polityColor(civ.id)) }} aria-hidden="true" />
          <span className="world-civ-name">{civ.name}</span> <span className="world-civ-era">{ERA_NAMES[civ.era]} · capital {civ.capital}</span>
          <span className="world-civ-size">{civ.regions.toLocaleString('en')} · {civ.population.toLocaleString('en')}</span>
        </button></li>)}</ol>
    </details>}
    {frame && frame.wonders.length > 0 && <details className="world-civ-list" open>
      <summary>Wonders of the world <span>{frame.wonders.filter(wonder => wonder.built !== null).length.toLocaleString('en')} standing</span></summary>
      <ol aria-label="Wonders of the world">{frame.wonders.map(wonder => <li key={wonder.name} className="world-wonder">
        <span className="world-civ-name">{wonder.name[0].toUpperCase() + wonder.name.slice(1)}</span> <span className="world-civ-era">at {wonder.city}, the {wonder.civ}</span>
        <span className="world-civ-size">{wonder.built === null ? `being built since ${wonder.begun}` : `built ${wonder.built}`}</span>
      </li>)}</ol>
    </details>}
    <p className="atlas-panel-note">{restarted ? 'This world’s simulation started again at year 0: Chronicle restarted or the simulation was stopped. ' : ''}Until saving exists, restarting Chronicle or choosing another seed starts the simulation again at year 0.</p>
    <div className="world-history-events">
      <h3>Chronicle <span>{frame ? `${frame.eventCount.toLocaleString('en')} events` : ''}</span></h3>
      {events.length ? <ol aria-label="Chronicle events">{events.slice().reverse().map(event => {
        const when = simulationDate(event.tick);
        return <li key={event.id}><span className="world-event-date">Year {when.year} · {MONTH_NAMES[when.month - 1].slice(0, 3)}</span>
          <span className="world-event-type">{event.type}</span><span className="world-event-text">{describeEvent(event, names)}</span>
          {event.causes.length > 0 && <span className="world-event-causes">{event.causes.map(cause => `${cause.factor} ${cause.weight.toFixed(2)}`).join(' · ')}</span>}</li>;
      })}</ol> : <p className="atlas-panel-note">No events yet. Bands and their history arrive in the next milestones.</p>}
    </div>
  </section>;
}
