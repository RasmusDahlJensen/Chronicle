import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { WorldManifest } from '../../shared/generated-world.ts';
import { simulationDate, type SimulationCommand, type SimulationState, type SimulationView } from '../../shared/simulation.ts';
import { commandSimulation, observeSimulation, openSimulation, releaseSimulation, SimulationConflictError } from '../api/simulation.ts';
import './tribe-lab.css';
import { CountryDecisions, SettlementEconomy } from './SettlementDetails.tsx';
import { CountryGrowth } from './CountryGrowth.tsx';

interface Props {
  world: WorldManifest;
  onTribeChange: (world: WorldManifest, state: SimulationState | null) => void;
  onLocate: () => void;
  onLocateSettlement: (id: string) => void;
  mapAvailable: boolean;
  toolbarHost: HTMLDivElement | null;
  placementActive: boolean;
  onPlacement: (active: boolean) => void;
  registerPlacement: (handler: ((cellId: number) => void) | null) => void;
  placementError: string | null;
}
interface Target { id: string; placementSeed: string; originCellId?: number }
type Action = Pick<SimulationCommand, 'action' | 'days' | 'speed'>;
const sessionKey = (world: WorldManifest) => `chronicle:world-session:${world.worldKey}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'The simulation could not be loaded. Retry simulation to read its saved state.';
function rememberedTribe(world: WorldManifest): { target: Target | null; error: string | null } {
  try {
    const raw = localStorage.getItem(sessionKey(world));
    if (!raw) return { target: null, error: null };
    const value = JSON.parse(raw);
    if (!value || !uuid.test(value.id) || typeof value.placementSeed !== 'string' || !value.placementSeed.length || value.placementSeed.length > 64
      || value.originCellId !== undefined && (!Number.isInteger(value.originCellId) || value.originCellId < 0 || value.originCellId >= world.width * world.height)) {
      throw new Error('The saved civilization reference is invalid. It has been preserved; restore the browser reference before retrying.');
    }
    return { target: value, error: null };
  } catch (cause) {
    return { target: null, error: cause instanceof Error && cause.message.includes('reference') ? cause.message : 'This browser could not read its saved civilization reference. Enable local storage and retry.' };
  }
}

/** Observer controls only. All creation, time advancement and saving happen on the host. */
export function TribeLab({ world, onTribeChange, onLocate, onLocateSettlement, mapAvailable, toolbarHost, placementActive, onPlacement, registerPlacement, placementError }: Props) {
  const [initial] = useState(() => rememberedTribe(world));
  const [spawnMenu, setSpawnMenu] = useState(false);
  const [historySeed, setHistorySeed] = useState('');
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
      if (!alive || session.current !== identity) return;
      const previous = latest.current?.state;
      if (previous && (next.state.incarnation < previous.incarnation
        || next.state.incarnation === previous.incarnation && next.state.revision < previous.revision)) return;
      latest.current = next; setView(next); setError(next.error); stoppedForError = next.error !== null;
    }
    function failure(cause: unknown) {
      if (alive && session.current === identity) { stoppedForError = true; setError(errorMessage(cause)); }
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
            if (alive) setNotice('The simulation changed elsewhere. Its current state is shown; review it before trying the command again.');
          } catch (refreshError) { failure(refreshError); }
        } else failure(cause);
      }).finally(() => {
        commandBusy = false;
        if (alive) { setBusy(false); schedule(); }
      });
    };
    void openSimulation({ ...identity, settings: world.settings, placementSeed: target.placementSeed, clockMode: 'monthly', ...(target.originCellId === undefined ? {} : { originCellId: target.originCellId }) }, world, controller.signal)
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

  function begin(originCellId?: number, newGame = false) {
    if (busy || !mapAvailable || !newGame && (target || error)) return;
    try {
      const next = { id: crypto.randomUUID(), placementSeed: newGame ? crypto.randomUUID() : historySeed.trim() || crypto.randomUUID(), ...(originCellId === undefined ? {} : { originCellId }) };
      // Persist identity before sending a request whose outcome could be uncertain.
      localStorage.setItem(sessionKey(world), JSON.stringify(next));
      // Invalidate old responses immediately. Effect cleanup detaches the former
      // observer; its saved state belongs to that instance, never the new game.
      session.current = null; latest.current = null; act.current = () => {};
      setView(null); setError(null); setNotice(null); setConfirmReset(false);
      onTribeChange(world, null);
      setBusy(true); setTarget(next); setSpawnMenu(false); onPlacement(false);
    } catch { setError('This browser could not remember the civilization. Enable local storage and retry before spawning.'); }
  }
  useEffect(() => {
    registerPlacement(busy || target || error || !mapAvailable ? null : begin);
    return () => registerPlacement(null);
  });
  function retryTribe() {
    if (busy) return;
    if (target) { setBusy(true); setRetry(value => value + 1); }
    else {
      const saved = rememberedTribe(world);
      setError(saved.error); setTarget(saved.target);
    }
  }

  const state = view?.state, date = state ? simulationDate(state.elapsedDays) : null;
  const blocked = busy || error !== null;
  return <section className="tribe-lab" aria-label="Tribe lab" data-instance-id={target?.id ?? ''}
    data-elapsed-days={state?.elapsedDays} data-incarnation={state?.incarnation} data-revision={state?.revision} aria-busy={busy}>
    {toolbarHost && createPortal(<section className="world-simulation-toolbar" aria-label="World simulation">
      <div className="world-spawn-controls"><button className="world-new-game" type="button" disabled={busy || !mapAvailable} onClick={() => begin(undefined, true)}>New game</button><button type="button" disabled={blocked || !!target || !mapAvailable} onClick={() => setSpawnMenu(value => !value)}>Spawn civilization</button>
        {spawnMenu && !placementActive && <div className="world-spawn-menu"><label>History seed<input type="text" value={historySeed} maxLength={64} placeholder="Leave blank for a fresh history" disabled={blocked} onChange={event => setHistorySeed(event.target.value)} /></label><p className="atlas-panel-note">Sets country preferences and random placement. Reuse it with the same world and starting location to repeat a history.</p><div><button type="button" disabled={blocked || !mapAvailable} onClick={() => begin()}>Random location</button><button type="button" disabled={blocked || !mapAvailable} onClick={() => { setSpawnMenu(false); onPlacement(true); }}>Choose on map</button></div></div>}
        {placementActive && <><span>Click suitable land to settle.</span><button type="button" onClick={() => onPlacement(false)}>Cancel placement</button></>}
      </div>
      <div className="world-clock-controls"><span className="tribe-date">Month {Math.floor((state?.elapsedDays ?? 0) % 360 / 30) + 1}, Year {date?.year ?? 1}</span>
        <button type="button" disabled={blocked || !state} onClick={() => act.current({ action: state?.running ? 'pause' : 'play' })}>{state?.running ? 'Pause' : 'Play'}</button>
        <button type="button" disabled={blocked || !state || state.running} onClick={() => act.current({ action: 'step', days: 30 })}>Advance 1 month</button>
        <span className="atlas-panel-note">30 days per month · Play advances one month per second</span>
      </div>
      {placementError && <p role="alert">{placementError}</p>}
    </section>, toolbarHost)}
    <p className="atlas-section-index">Civilization · development controls</p>
    {state ? <>
      <div className="world-civilization-heading"><span className="world-civilization-swatch" style={{ backgroundColor: state.tribe.color }} aria-hidden="true" /><h2 data-tribe-name>{state.tribe.name}</h2></div>

      <dl className="world-water-facts"><div><dt>Population</dt><dd data-tribe-population>{state.tribe.population}</dd></div><div><dt>{state.country ? 'Capital cell' : 'Camp cell'}</dt><dd>{state.tribe.originCellId}</dd></div></dl>
      <p className="atlas-panel-note">{state.country ? 'One founding capital supports its people through food and connected country claims. Births and deaths change its population. The calendar has 360 days per year.' : 'This study has 250 people in total. Founding communities redistributes them; births and deaths come later. The calendar has 360 days per year.'}</p>
      <button className="world-locate-civilization" type="button" onClick={onLocate} disabled={!mapAvailable || state.tribe.population === 0}>Locate civilization <span aria-hidden="true">↗</span></button>
      <p className="tribe-run-status" role="status">{error ? 'Last confirmed progress' : busy ? 'Updating simulation…' : state.running ? view.active ? 'Running' : 'Waiting to resume' : 'Paused'}</p>
      {confirmReset ? <div className="tribe-reset-confirmation" role="group" aria-label="Reset simulation confirmation"><p>Reset {state.tribe.name} to Month 1, Year 1, paused at its original camp? Saved progress will be replaced.{state.clockMode === 'monthly' && !state.country && ' Reset also enables country growth from one capital using the original history seed.'}</p><button type="button" disabled={blocked} onClick={() => { setConfirmReset(false); act.current({ action: 'reset' }); }}>Confirm reset simulation</button><button type="button" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel reset</button></div>
        : <button className="tribe-reset-button" type="button" disabled={blocked} onClick={() => setConfirmReset(true)}>Reset simulation</button>}
      {state.settlements && (state.country ? <CountryGrowth country={state.country} society={state.settlements} cellAreaKm2={world.areaKm2 / (world.width * world.height)} onLocate={onLocateSettlement} mapAvailable={mapAvailable} /> : <SettlementEconomy society={state.settlements} onLocate={onLocateSettlement} mapAvailable={mapAvailable} />)}
      {state.ai && state.settlements && <CountryDecisions ai={state.ai} society={state.settlements} countryGrowth={!!state.country} />}
      {state.clockMode === 'monthly' && !state.country && <p className="atlas-panel-note">This saved history keeps its earlier settlement rules. Reset simulation enables country growth from the original location and history seed.</p>}
      <p className="atlas-panel-note">{state.country ? 'Completed days are saved on this PC. The founding capital stays at its original site. Villages and formal provinces develop later.' : 'Completed days are saved on this PC. The main center anchors the tribe. Formal capitals and provinces develop later.'}</p>
    </> : target ? <><h2>Your civilization</h2><p className="atlas-panel-note">{busy ? 'Opening the saved civilization…' : 'The saved instance has not been loaded.'}</p></>
      : <><h2>An unsettled world</h2><p className="atlas-panel-note">New game creates a fresh civilization on this map. Use Spawn civilization for a chosen history seed or manual placement.</p></>}
    {error && <div className="tribe-error"><p className="atlas-panel-note" role="alert">{error}</p>{view?.error
      ? <><p className="atlas-panel-note">After restoring storage access, save the current checkpoint and pause. A failed step or reset will not be repeated.</p><button type="button" disabled={busy} onClick={() => act.current({ action: 'pause' }, true)}>Retry save and pause</button></>
      : <button type="button" disabled={busy} onClick={retryTribe}>Retry simulation</button>}</div>}
    {notice && <p className="atlas-panel-note" role="status">{notice}</p>}
  </section>;
}
