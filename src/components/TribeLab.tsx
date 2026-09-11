import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorldManifest } from '../../shared/generated-world.ts';
import { simulationDate, type SimulationCommand, type SimulationState, type SimulationView } from '../../shared/simulation.ts';
import { commandSimulation, observeSimulation, openSimulation, releaseSimulation, SimulationConflictError } from '../api/simulation.ts';
import './tribe-lab.css';
import { SettlementEconomy } from './SettlementDetails.tsx';

interface Props {
  world: WorldManifest;
  onTribeChange: (world: WorldManifest, state: SimulationState | null) => void;
  onLocate: () => void;
  onLocateSettlement: (id: string) => void;
  mapAvailable: boolean;
}
interface Target { id: string; placementSeed: string }
type Action = Pick<SimulationCommand, 'action' | 'days' | 'speed'>;
const defaultPlacement = 'Tribes 1';
const placementKey = (world: WorldManifest) => `chronicle:tribe-placement:${world.worldKey}`;
const instanceKey = (world: WorldManifest, seed: string) => `chronicle:tribe-instance:${JSON.stringify([world.worldKey, seed])}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'The tribe could not be loaded. Retry tribe to read its saved state.';

function rememberedTribe(world: WorldManifest) {
  try {
    const placementSeed = localStorage.getItem(placementKey(world)) ?? defaultPlacement;
    const id = localStorage.getItem(instanceKey(world, placementSeed));
    if (!placementSeed.length || placementSeed.length > 64 || id !== null && !uuid.test(id)) {
      throw new Error('The saved tribe reference in this browser is invalid. It has been preserved; restore the browser reference before retrying.');
    }
    return { placementSeed, target: id ? { id, placementSeed } : null, error: null };
  } catch (cause) {
    return { placementSeed: defaultPlacement, target: null, error: cause instanceof Error && cause.message.includes('reference') ? cause.message
      : 'This browser could not read its saved tribe reference. Enable local storage and retry.' };
  }
}

/** Observer controls only. All creation, time advancement and saving happen on the host. */
export function TribeLab({ world, onTribeChange, onLocate, onLocateSettlement, mapAvailable }: Props) {
  const [initial] = useState(() => rememberedTribe(world));
  const [placementSeed, setPlacementSeed] = useState(initial.placementSeed);
  const [target, setTarget] = useState<Target | null>(initial.target);
  const [observerId] = useState(() => crypto.randomUUID());
  const [view, setView] = useState<SimulationView | null>(null);
  const [error, setError] = useState<string | null>(initial.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(Boolean(initial.target));
  const [confirmReset, setConfirmReset] = useState(false);
  const [retry, setRetry] = useState(0);
  const latest = useRef<SimulationView | null>(null);
  const session = useRef<{ instanceId: string; observerId: string } | null>(null);
  const act = useRef<(action: Action, recoverSave?: boolean) => void>(() => {});

  useEffect(() => {
    onTribeChange(world, view?.state ?? null);
  }, [world, view?.state, onTribeChange]);

  useEffect(() => {
    if (!target) return;
    const identity = { instanceId: target.id, observerId };
    session.current = identity;
    const controller = new AbortController();
    let alive = true, commandBusy = false, stoppedForError = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: AbortController | null = null;
    setBusy(true); setError(null); setNotice(null);

    function apply(next: SimulationView) {
      if (!alive) return;
      const previous = latest.current?.state;
      if (previous && (next.state.incarnation < previous.incarnation
        || next.state.incarnation === previous.incarnation && next.state.revision < previous.revision)) return;
      latest.current = next; setView(next); setError(next.error); stoppedForError = next.error !== null;
    }
    function failure(cause: unknown) {
      if (alive) { stoppedForError = true; setError(errorMessage(cause)); }
    }
    function schedule() {
      clearTimeout(timer);
      if (alive && !stoppedForError) timer = setTimeout(() => { void refresh(); }, 1000);
    }
    async function refresh() {
      if (!alive) return;
      if (commandBusy) { schedule(); return; }
      const request = new AbortController(); poll = request;
      try { apply(await observeSimulation(identity, world, AbortSignal.any([controller.signal, request.signal]))); }
      catch (cause) { if (!request.signal.aborted) failure(cause); }
      finally { if (poll === request) poll = null; if (!request.signal.aborted) schedule(); }
    }
    act.current = (action, recoverSave = false) => {
      const state = latest.current?.state;
      if (!alive || commandBusy || !state || stoppedForError && !(recoverSave && action.action === 'pause')) return;
      commandBusy = true; setBusy(true); setNotice(null);
      clearTimeout(timer); poll?.abort(); poll = null;
      async function submit() {
        let confirmed = state!;
        if (recoverSave) {
          apply(await observeSimulation(identity, world, controller.signal));
          confirmed = latest.current!.state;
        }
        if (!alive) return;
        apply(await commandSimulation({ ...identity, incarnation: confirmed.incarnation, revision: confirmed.revision, ...action }, world, controller.signal));
      }
      void submit().catch(async cause => {
        if (!alive) return;
        if (cause instanceof SimulationConflictError) {
          try {
            apply(await observeSimulation(identity, world, controller.signal));
            if (alive) setNotice('The tribe changed elsewhere. Its current state is shown; review it before trying the command again.');
          } catch (refreshError) { failure(refreshError); }
        } else failure(cause);
      }).finally(() => {
        commandBusy = false;
        if (alive) { setBusy(false); schedule(); }
      });
    };
    void openSimulation({ ...identity, settings: world.settings, placementSeed: target.placementSeed }, world, controller.signal)
      .then(apply).catch(failure).finally(() => { if (alive) { setBusy(false); schedule(); } });

    function leaving() {
      alive = false; clearTimeout(timer); poll?.abort(); controller.abort();
      void releaseSimulation(identity).catch(() => {});
    }
    function returning(event: PageTransitionEvent) { if (event.persisted) setRetry(value => value + 1); }
    window.addEventListener('pagehide', leaving); window.addEventListener('pageshow', returning);
    return () => {
      alive = false; clearTimeout(timer); poll?.abort(); controller.abort(); act.current = () => {};
      window.removeEventListener('pagehide', leaving); window.removeEventListener('pageshow', returning);
      if (session.current === identity) session.current = null;
      // StrictMode and a refreshed manifest can replay an effect for this same
      // mounted observer. An old cleanup must not release its new attachment.
      queueMicrotask(() => {
        if (session.current?.instanceId !== identity.instanceId || session.current.observerId !== identity.observerId) {
          void releaseSimulation(identity).catch(() => {});
        }
      });
    };
  }, [world, target, observerId, retry]);

  function begin(event: FormEvent) {
    event.preventDefault();
    if (busy || target || error) return;
    try {
      const key = instanceKey(world, placementSeed), remembered = localStorage.getItem(key);
      if (remembered !== null && !uuid.test(remembered)) throw new Error('The saved tribe reference is invalid. It has been preserved; restore the browser reference before retrying.');
      const id = remembered ?? crypto.randomUUID();
      // Do not create anything remotely until a reload can recover its identity.
      localStorage.setItem(key, id); localStorage.setItem(placementKey(world), placementSeed);
      setBusy(true); setTarget({ id, placementSeed });
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('reference') ? cause.message : 'This browser could not remember the tribe. Enable local storage and retry before beginning.');
    }
  }
  function retryTribe() {
    if (busy) return;
    if (target) { setBusy(true); setRetry(value => value + 1); }
    else {
      const saved = rememberedTribe(world);
      setError(saved.error); setPlacementSeed(saved.placementSeed); setTarget(saved.target);
    }
  }

  const state = view?.state, date = state ? simulationDate(state.elapsedDays) : null;
  const blocked = busy || error !== null;
  return <section className="tribe-lab" aria-label="Tribe lab" data-instance-id={target?.id ?? ''}
    data-elapsed-days={state?.elapsedDays} data-incarnation={state?.incarnation} data-revision={state?.revision} aria-busy={busy}>
    <p className="atlas-section-index">Lab controls · Settlement 01</p>
    {state ? <>
      <div className="world-civilization-heading"><span className="world-civilization-swatch" style={{ backgroundColor: state.tribe.color }} aria-hidden="true" /><h2 data-tribe-name>{state.tribe.name}</h2></div>
      <p className="tribe-date">Day {date!.day}, Year {date!.year}</p>
      <dl className="world-water-facts"><div><dt>Population</dt><dd data-tribe-population>{state.tribe.population}</dd></div><div><dt>Camp cell</dt><dd>{state.tribe.originCellId}</dd></div></dl>
      <p className="atlas-panel-note">This study has 250 people in total. Founding communities redistributes them; births and deaths come later. The calendar has 360 days per year.</p>
      <button className="world-locate-civilization" type="button" onClick={onLocate} disabled={!mapAvailable}>Locate tribe <span aria-hidden="true">↗</span></button>
      <p className="tribe-run-status" role="status">{error ? 'Last confirmed progress' : busy ? 'Updating tribe…' : state.running ? view.active ? 'Running' : 'Waiting to resume' : 'Paused'}</p>
      <div className="tribe-time-controls">
        <button type="button" disabled={blocked} onClick={() => act.current({ action: state.running ? 'pause' : 'play' })}>{state.running ? 'Pause tribe' : 'Play tribe'}</button>
        <div className="tribe-speed"><label htmlFor="tribe-speed">Simulation speed</label><select id="tribe-speed" value={state.speed} disabled={blocked} onChange={event => act.current({ action: 'speed', speed: Number(event.target.value) as 1 | 10 })}><option value={1}>1 day / second</option><option value={10}>10 days / second</option></select></div>
        <button type="button" disabled={blocked || state.running} onClick={() => act.current({ action: 'step', days: 1 })}>Step 1 day</button>
        <button type="button" disabled={blocked || state.running} onClick={() => act.current({ action: 'step', days: 30 })}>Step 30 days</button>
      </div>
      {confirmReset ? <div className="tribe-reset-confirmation" role="group" aria-label="Reset tribe confirmation"><p>Reset {state.tribe.name} to Day 1, Year 1, paused at its original camp? Saved progress will be replaced.</p><button type="button" disabled={blocked} onClick={() => { setConfirmReset(false); act.current({ action: 'reset' }); }}>Confirm reset tribe</button><button type="button" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel reset</button></div>
        : <button className="tribe-reset-button" type="button" disabled={blocked} onClick={() => setConfirmReset(true)}>Reset tribe</button>}
      {state.settlements && <SettlementEconomy society={state.settlements} onLocate={onLocateSettlement} mapAvailable={mapAvailable} />}
      <p className="atlas-panel-note">Completed days are saved on this PC. The main center anchors the tribe. Formal capitals and provinces develop later.</p>
    </> : target ? <><h2>Your tribe</h2><p className="atlas-panel-note">{busy ? 'Opening the saved tribal instance…' : 'The saved instance has not been loaded.'}</p></>
      : <><h2>Begin a tribe</h2><p className="atlas-panel-note">Start one tribe with a camp and 250 people, then explore its first days.</p><form onSubmit={begin}>
        <label htmlFor="tribe-placement-seed">Placement seed</label><input id="tribe-placement-seed" value={placementSeed} onChange={event => setPlacementSeed(event.target.value)} minLength={1} maxLength={64} required disabled={blocked} autoComplete="off" />
        <button type="submit" disabled={blocked}>Begin tribe</button></form></>}
    {error && <div className="tribe-error"><p className="atlas-panel-note" role="alert">{error}</p>{view?.error
      ? <><p className="atlas-panel-note">After restoring storage access, save the current checkpoint and pause. A failed step or reset will not be repeated.</p><button type="button" disabled={busy} onClick={() => act.current({ action: 'pause' }, true)}>Retry save and pause</button></>
      : <button type="button" disabled={busy} onClick={retryTribe}>Retry tribe</button>}</div>}
    {notice && <p className="atlas-panel-note" role="status">{notice}</p>}
  </section>;
}
