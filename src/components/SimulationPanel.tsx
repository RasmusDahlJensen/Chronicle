import { useEffect, useRef, useState, type FormEvent } from 'react';
import { worldKey, type WorldSettings } from '../../shared/generated-world.ts';
import { ERA_NAMES, MAX_SIMULATION_YEAR, SIMULATION_SPEEDS, simulationDate, type ChronicleEvent, type ObserverFrame, type SimulationControl, type SimulationSpeed } from '../../shared/simulation.ts';
import { fetchObserverFrame, sendSimulationControl } from '../api/simulation.ts';
import { describeEvent, MONTH_NAMES } from '../observer/events.ts';

const SPEED_LABELS: Record<SimulationSpeed, string> = { month: '1 month/s', year: '1 year/s', decade: '10 years/s', max: 'Fastest' };
// A paused simulation changes only through controls, so it is polled less often than a playing one.
const POLL_PLAYING_MS = 250, POLL_PAUSED_MS = 1000, EVENT_LIMIT = 300;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The simulation is unavailable. Try again.';

/** The run id last seen per world in this tab, kept across development reloads so a restart can be reported. */
function rememberRun(key: string, runId: string) {
  try {
    const previous = sessionStorage.getItem(`chronicle.run.${key}`);
    sessionStorage.setItem(`chronicle.run.${key}`, runId);
    return previous;
  } catch { return null; }
}

interface Props {
  settings: WorldSettings | null;
  /** True when the observer chose this world in place of another one: its history starts again at year 0. */
  startFresh?: boolean;
  /** Region whose details each frame should carry (null for none). */
  inspect?: number | null;
  onFrame?: (frame: ObserverFrame) => void;
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
    <figcaption><span className="world-chart-key-population">World population</span> {last[1].toLocaleString('en')} (max {maxPopulation.toLocaleString('en')}) · <span className="world-chart-key-polities">Bands and civilizations</span> {last[2].toLocaleString('en')} · years 0–{maxYear.toLocaleString('en')}</figcaption>
  </figure>;
}

/**
 * Observer time controls and the raw chronicle list. The browser polls compact frames and shows only the newest:
 * each request takes a sequence number and an older response never replaces a newer one. A frame from another world,
 * run or reset epoch never mixes into the displayed history.
 */
export function SimulationPanel({ settings, startFresh = false, inspect = null, onFrame }: Props) {
  const [frame, setFrame] = useState<ObserverFrame | null>(null);
  const [events, setEvents] = useState<ChronicleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restarted, setRestarted] = useState(false);
  const [targetYear, setTargetYear] = useState('100');
  const latest = useRef({ key: '', sequence: 0, applied: 0, runId: '', epoch: -1, cursor: 0, playing: false });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;
  const pollNow = useRef<() => void>(() => {});
  const key = settings ? worldKey(settings) : '';

  /** Apply a frame that holds the events from id `from` on. */
  function apply(sequence: number, next: ObserverFrame, from: number) {
    const state = latest.current;
    if (next.instance.worldKey !== state.key || sequence < state.applied) return;
    state.applied = sequence;
    const newRun = state.runId !== next.instance.runId, newEpoch = newRun || state.epoch !== next.epoch;
    if (newRun) {
      const previous = rememberRun(state.key, next.instance.runId);
      if (state.runId || (previous && previous !== next.instance.runId)) setRestarted(true);
    }
    state.runId = next.instance.runId; state.epoch = next.epoch; state.playing = next.playing;
    setFrame(next); setError(null); onFrameRef.current?.(next);
    // A new run or a reset starts the list again. If this frame was read from an older cursor it may lack the new
    // history's first events, so the next poll reads from the start.
    if (newEpoch && from > 0) { setEvents([]); state.cursor = 0; return; }
    setEvents(current => {
      const base = newEpoch ? [] : current;
      const last = base.length ? base[base.length - 1].id : -1;
      return [...base, ...next.events.filter(event => event.id > last)].slice(-EVENT_LIMIT);
    });
    state.cursor = next.eventCount;
  }

  useEffect(() => {
    if (!settings) return;
    const controller = new AbortController();
    latest.current = { key, sequence: 0, applied: 0, runId: '', epoch: -1, cursor: 0, playing: false };
    setFrame(null); setEvents([]); setRestarted(false); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const sequence = ++latest.current.sequence;
      try {
        // After a reset or restart the cursor from the old history would skip the new one's first events.
        const cursor = latest.current.runId ? latest.current.cursor : 0;
        apply(sequence, await fetchObserverFrame(settings!, cursor, controller.signal, inspectRef.current), cursor);
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(poll, latest.current.playing ? POLL_PLAYING_MS : POLL_PAUSED_MS);
    }
    let polling = false;
    pollNow.current = () => {
      if (polling || controller.signal.aborted) return;
      clearTimeout(timer); polling = true;
      void poll().finally(() => { polling = false; });
    };
    async function begin() {
      if (startFresh) {
        // Choosing another world starts its history again at year 0 (until saving exists).
        try { apply(++latest.current.sequence, await sendSimulationControl(settings!, { action: 'reset' }, 0, controller.signal), 0); }
        catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
      }
      if (!controller.signal.aborted) await poll();
    }
    polling = true;
    void begin().finally(() => { polling = false; });
    return () => { controller.abort(); clearTimeout(timer); pollNow.current = () => {}; };
  // The world key identifies the world; startFresh is read when that world is first shown.
  }, [key]);

  // A new selection should show its region's details now, not at the next paused poll.
  useEffect(() => { pollNow.current(); }, [inspect]);

  async function send(control: SimulationControl) {
    if (!settings) return;
    const sequence = ++latest.current.sequence, world = latest.current.key;
    const cursor = control.action === 'reset' ? 0 : latest.current.cursor;
    try {
      const next = await sendSimulationControl(settings, control, cursor, AbortSignal.timeout(30_000), inspectRef.current);
      if (latest.current.key === world) apply(sequence, next, cursor);
    } catch (cause) { if (latest.current.key === world) setError(message(cause)); }
  }
  function runTo(event: FormEvent) {
    event.preventDefault();
    const year = Number(targetYear);
    if (Number.isInteger(year) && year >= 0 && year <= MAX_SIMULATION_YEAR) void send({ action: 'runTo', year });
  }

  const date = frame ? simulationDate(frame.tick) : null;
  const ended = frame ? frame.tick >= MAX_SIMULATION_YEAR * 12 : false;
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
    {frame && <p className="world-history-totals" id="world-population">{frame.population.toLocaleString('en')} people in {(frame.polities - frame.civs).toLocaleString('en')} {frame.polities - frame.civs === 1 ? 'band' : 'bands'} and {frame.civs.toLocaleString('en')} {frame.civs === 1 ? 'civilization' : 'civilizations'} · {frame.settlementCount.toLocaleString('en')} {frame.settlementCount === 1 ? 'village' : 'villages'} · {frame.specialists.toLocaleString('en')} specialists · most advanced: {ERA_NAMES[frame.leadingEra]} era</p>}
    {frame && <WorldChart series={frame.series} />}
    <p className="atlas-panel-note">{restarted ? 'This world’s simulation started again at year 0: Chronicle restarted or the simulation was stopped. ' : ''}Until saving exists, restarting Chronicle or choosing another seed starts the simulation again at year 0.</p>
    <div className="world-history-events">
      <h3>Chronicle <span>{frame ? `${frame.eventCount.toLocaleString('en')} events` : ''}</span></h3>
      {events.length ? <ol aria-label="Chronicle events">{events.slice().reverse().map(event => {
        const when = simulationDate(event.tick);
        return <li key={event.id}><span className="world-event-date">Year {when.year} · {MONTH_NAMES[when.month - 1].slice(0, 3)}</span>
          <span className="world-event-type">{event.type}</span><span className="world-event-text">{describeEvent(event)}</span>
          {event.causes.length > 0 && <span className="world-event-causes">{event.causes.map(cause => `${cause.factor} ${cause.weight.toFixed(2)}`).join(' · ')}</span>}</li>;
      })}</ol> : <p className="atlas-panel-note">No events yet. Bands and their history arrive in the next milestones.</p>}
    </div>
  </section>;
}
