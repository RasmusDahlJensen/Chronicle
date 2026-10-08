import { useEffect, useRef, useState } from 'react';
import { worldKey, type WorldSettings } from '../../shared/generated-world.ts';
import type { ChronicleEvent, ObserverFrame, SimulationControl } from '../../shared/simulation.ts';
import { fetchObserverFrame, sendSimulationControl } from '../api/simulation.ts';
import { mergeNames, nameOf } from './names.ts';

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

export interface ObserverOptions {
  settings: WorldSettings | null;
  /** True when the observer chose this world in place of another one: its history starts again at year 0. */
  startFresh?: boolean;
  /** Region whose details each frame should carry (null for none). */
  inspect?: number | null;
  /** The people whose perspective each frame should carry (U.6; null for none). */
  view?: number | null;
  onFrame?: (frame: ObserverFrame) => void;
}

/**
 * The observer's view of a world's simulation, shared by the game and the lab (U.1): it polls compact frames and keeps
 * only the newest (each request takes a sequence number and an older response never replaces a newer one), keeps the
 * latest chronicle events, and sends controls. A frame from another world, run or reset epoch never mixes into the
 * displayed history.
 */
export function useObserver({ settings, startFresh = false, inspect = null, view = null, onFrame }: ObserverOptions) {
  const [frame, setFrame] = useState<ObserverFrame | null>(null);
  const [events, setEvents] = useState<ChronicleEvent[]>([]);
  // The names of the peoples in the kept events, gathered from every frame of this run and epoch.
  const [names, setNames] = useState<ReadonlyMap<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [restarted, setRestarted] = useState(false);
  const latest = useRef({ key: '', sequence: 0, applied: 0, runId: '', epoch: -1, cursor: 0, playing: false });
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const inspectRef = useRef(inspect), viewRef = useRef(view);
  inspectRef.current = inspect; viewRef.current = view;
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
    setNames(current => mergeNames(current, next.names, newEpoch));
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
    setFrame(null); setEvents([]); setNames(new Map()); setRestarted(false); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const sequence = ++latest.current.sequence;
      try {
        // After a reset or restart the cursor from the old history would skip the new one's first events.
        const cursor = latest.current.runId ? latest.current.cursor : 0;
        apply(sequence, await fetchObserverFrame(settings!, cursor, controller.signal, inspectRef.current, viewRef.current), cursor);
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

  // A new selection or perspective should show now, not at the next paused poll.
  useEffect(() => { pollNow.current(); }, [inspect, view]);

  /** Apply a control (play, pause, step, speed, run to a year, reset, and the development controls). */
  async function send(control: SimulationControl) {
    if (!settings) return;
    const sequence = ++latest.current.sequence, world = latest.current.key;
    const cursor = control.action === 'reset' ? 0 : latest.current.cursor;
    try {
      const next = await sendSimulationControl(settings, control, cursor, AbortSignal.timeout(30_000), inspectRef.current, viewRef.current);
      if (latest.current.key === world) apply(sequence, next, cursor);
    } catch (cause) { if (latest.current.key === world) setError(message(cause)); }
  }

  return { frame, events, error, restarted, send, names: nameOf(names) };
}
