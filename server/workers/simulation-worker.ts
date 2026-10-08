import { parentPort, workerData } from 'node:worker_threads';
import {
  MAX_FRAME_EVENTS, MAX_SIMULATION_YEAR, SIMULATION_PROTOCOL_VERSION, SPEED_MONTHS_PER_SECOND,
  type ChroniclePage, type ChronicleQuery, type ObserverFrame, type RegionMap, type SimulationControl, type SimulationInit, type SimulationInstance,
  type SimulationReply, type SimulationRequest, type SimulationSpeed,
} from '../../shared/simulation.ts';
import { validateTechData } from '../../src/simulation/deposits.ts';
import { validateBuildings } from '../../src/simulation/buildings.ts';
import { validateWonders } from '../../src/simulation/wonders.ts';
import { validateRoads } from '../../src/simulation/roads.ts';
import { decodeGeography } from '../../src/simulation/geography.ts';
import { checkInvariants, checkPartition } from '../../src/simulation/invariants.ts';
import { partitionRegions, partitionStats, REGION_PARTITION_VERSION } from '../../src/simulation/regions.ts';
import { createSimulation, frameCounters, knowledgeReport, politicsReport, SIMULATION_RULES_VERSION, stateHash, stepSimulation } from '../../src/simulation/simulation.ts';
import { actorNames, chroniclePage, observerView } from '../../src/simulation/observer.ts';
import { applyScenario } from '../../src/simulation/scenarios.ts';
import { restoreCheckpoint, takeCheckpoint } from '../../src/simulation/snapshot.ts';
import { SYSTEMS } from '../../src/simulation/state.ts';
import { CLOCK_TUNING, validateTunables } from '../../src/simulation/tunables.ts';
import { CHECKPOINT_EVERY, checkpointYears, openCheckpointStore, readCheckpoint, writeCheckpoint } from './checkpoints.ts';

/**
 * One world's simulation, alive for the life of its instance (VISION.md "Host-side simulation"). The host sends
 * the validated geography once, then observer controls and frame requests. Ticks run here, never on the HTTP thread.
 */
const port = parentPort;
if (!port) throw new Error('The simulation worker must run in a worker thread.');
const init = workerData as SimulationInit;
const started = performance.now();
validateTunables();
validateTechData();
validateBuildings();
validateWonders();
validateRoads();
const geography = decodeGeography(init.manifest, init.tiles);
const partition = partitionRegions(geography);
checkPartition(geography, partition);
const instance: SimulationInstance = {
  key: `sim-${SIMULATION_RULES_VERSION}.${REGION_PARTITION_VERSION}:${geography.manifest.worldKey}:${init.seed}`,
  worldKey: geography.manifest.worldKey, partitionVersion: REGION_PARTITION_VERSION, rulesVersion: SIMULATION_RULES_VERSION,
  seed: init.seed, runId: init.runId,
};
let state = createSimulation(geography, partition, init.seed);
let playing = false, speed: SimulationSpeed = 'year', target: number | null = null, epoch = 0;
/** Why the last development control used was refused (Dev 02), until the next one or a reset. */
let devRefused: string | null = null;
// Checkpoints (Dev 02): this world's, from this code; kept every CHECKPOINT_EVERY years of a history left to its rules
// and at the year a load runs to, so Load year can restore one instead of simulating there again.
/** A short note for the frame (its contract allows 200 characters). */
const note = (text: string) => text.length > 200 ? `${text.slice(0, 199)}…` : text;
let storeProblem: string | null = null;
const store = (() => {
  if (!init.checkpoints) return null;
  // A checkpoint folder that cannot be used turns Load year off; it never stops the simulation.
  try { return openCheckpointStore(init.checkpoints, init.seed, geography.manifest.settings.size); } catch (error) { storeProblem = (error as Error).message; return null; }
})();
const expect = { worldKey: geography.manifest.worldKey, rulesVersion: SIMULATION_RULES_VERSION, codeHash: store?.codeHash ?? '' };
const saved = new Set(store ? checkpointYears(store) : []), writing = new Set<number>();
/** The year this history was loaded from (null: it ran from year 0), and the tick a load runs to. */
let loadedFrom: number | null = null, loadGoal: number | null = null;
let anchor = { time: 0, tick: 0 };
let timer: ReturnType<typeof setTimeout> | undefined;
let immediate: ReturnType<typeof setImmediate> | undefined;
const endTick = MAX_SIMULATION_YEAR * 12;
const now = () => performance.now();
let regionMap: RegionMap | undefined;

function stop() {
  // An interrupted run to a year still ends: tell anyone waiting for it.
  if (target !== null) port!.postMessage({ kind: 'arrived', tick: state.tick } satisfies SimulationReply);
  playing = false; target = null; loadGoal = null;
  clearTimeout(timer); timer = undefined;
  if (immediate) clearImmediate(immediate); immediate = undefined;
}
function arrive() { stop(); }
/** Run due ticks in bounded slices, yielding between slices so frame requests and controls stay responsive. */
function run() {
  timer = undefined; immediate = undefined;
  if (!playing) return;
  const sliceEnd = now() + CLOCK_TUNING.sliceMs;
  const fast = target !== null || speed === 'max';
  const rate = SPEED_MONTHS_PER_SECOND[speed];
  const due = fast ? endTick : Math.min(endTick, anchor.tick + Math.floor((now() - anchor.time) * rate / 1000));
  while (state.tick < due && (target === null || state.tick < target) && now() < sliceEnd) { stepSimulation(state, now); keep(); }
  if ((target !== null && state.tick >= target) || state.tick >= endTick) { arrive(); return; }
  if (fast || state.tick < due) { immediate = setImmediate(run); return; }
  const wait = anchor.time + (state.tick + 1 - anchor.tick) * 1000 / rate - now();
  timer = setTimeout(run, Math.max(0, wait));
}
function play() {
  if (state.tick >= endTick) return;
  playing = true; anchor = { time: now(), tick: state.tick };
  clearTimeout(timer); if (immediate) clearImmediate(immediate);
  run();
}

function control(command: SimulationControl) {
  switch (command.action) {
    case 'play': target = null; play(); break;
    case 'pause': stop(); break;
    case 'step': stop(); if (state.tick < endTick) { stepSimulation(state, now); keep(); } break;
    case 'speed': speed = command.speed; if (playing) play(); break;
    case 'runTo': {
      const goal = Math.min(endTick, command.year * 12);
      stop();
      if (goal > state.tick) { target = goal; play(); }
      break;
    }
    case 'reset': stop(); state = createSimulation(geography, partition, init.seed); epoch++; devRefused = null; loadedFrom = null; break;
    case 'load': load(command.year); break;
    // DEVELOPMENT CONTROL (Dev 02): between months, through the real rules; a running history keeps running.
    case 'scenario': devRefused = applyScenario(state, command.scenario, command.region); break;
  }
}

/** After each month: keep a checkpoint every CHECKPOINT_EVERY years, and at the year a load runs to, of a history left
 *  to its rules. The state is serialized at once; the file is listed once it is written. */
function keep() {
  if (!store || state.tick % 12 !== 0 || state.devActions > 0) return;
  const year = state.tick / 12;
  if (saved.has(year) || writing.has(year) || (year % CHECKPOINT_EVERY !== 0 && state.tick !== loadGoal)) return;
  writing.add(year);
  writeCheckpoint(store, year, takeCheckpoint(state, { seed: init.seed, size: store.size, ...expect }))
    .then(() => saved.add(year), () => {}).finally(() => writing.delete(year));
}

/** DEVELOPMENT CONTROL (Dev 02): start from `year` — restore the latest checkpoint at or before it (or year 0), unless
 *  this history, left to its rules, is already between that checkpoint and the year; then run on to it. */
function load(year: number) {
  if (!store) { devRefused = note(storeProblem ? `Load year is off: the checkpoint folder cannot be used (${storeProblem}).` : 'This host keeps no checkpoints (CHRONICLE_CHECKPOINTS is off).'); return; }
  stop();
  devRefused = null;
  const goal = Math.min(endTick, year * 12);
  const from = [...saved].filter(at => at * 12 <= goal).sort((a, b) => a - b).at(-1) ?? 0;
  if (state.devActions > 0 || state.tick > goal || state.tick < from * 12) {
    let restored = null;
    if (from > 0) {
      // A checkpoint that cannot be read or restored, or whose history does not hold, is set aside: start from year 0.
      try {
        const checkpoint = readCheckpoint(store, from);
        if (checkpoint) { restored = restoreCheckpoint(checkpoint, geography, partition, expect, state); checkInvariants(restored); }
      } catch (error) {
        restored = null; saved.delete(from);
        devRefused = note(`The checkpoint at year ${from} could not be used, so this history runs from year 0 (${(error as Error).message.split('\n')[0]}).`);
      }
    }
    state = restored ?? createSimulation(geography, partition, init.seed);
    loadedFrom = restored ? from : null; epoch++;
  }
  if (goal > state.tick) { target = goal; loadGoal = goal; play(); }
}

function frame(cursor: number, inspect: number | null = null): ObserverFrame {
  const events = state.chronicle.since(cursor, MAX_FRAME_EVENTS), view = observerView(state, inspect);
  return {
    protocolVersion: SIMULATION_PROTOCOL_VERSION, instance, tick: state.tick, playing, speed, epoch,
    runTo: target === null ? null : target / 12, dev: { actions: state.devActions, refused: devRefused, checkpoints: store ? [...saved].sort((a, b) => a - b).slice(-256) : null, loadedFrom }, eventCount: state.chronicle.events.length,
    events, names: actorNames(state, [...events, ...(view.inspect?.settlements.flatMap(settlement => settlement.events) ?? []), ...(view.inspect?.polity?.history.map(entry => entry.event) ?? []), ...view.stories.flatMap(story => story.events)]), counters: frameCounters(state), ...view,
  };
}

/** A page of the chronicle (U.5), with the names of the peoples acting in it. */
function chronicle(query: ChronicleQuery): ChroniclePage {
  const page = chroniclePage(state, query);
  return { protocolVersion: SIMULATION_PROTOCOL_VERSION, runId: instance.runId, epoch, eventCount: state.chronicle.events.length, ...page, names: actorNames(state, page.events) };
}

function regions(): RegionMap {
  if (regionMap) return regionMap;
  const bytes = new Uint8Array(geography.cells * 2), ranks = new Uint8Array(geography.cells * 2), rank = state.fieldRanking.rank;
  for (let cell = 0; cell < geography.cells; cell++) {
    const value = partition.regionOf[cell] + 1;
    bytes[cell * 2] = value & 0xff; bytes[cell * 2 + 1] = value >> 8;
    ranks[cell * 2] = rank[cell] & 0xff; ranks[cell * 2 + 1] = rank[cell] >> 8;
  }
  regionMap = {
    protocolVersion: SIMULATION_PROTOCOL_VERSION, worldKey: geography.manifest.worldKey, partitionVersion: REGION_PARTITION_VERSION,
    width: geography.width, height: geography.height, encoding: 'region-u16le', data: Buffer.from(bytes).toString('base64'),
    fieldRank: Buffer.from(ranks).toString('base64'),
    regions: partition.regions.map(region => ({
      id: region.id, landmass: region.landmass, cells: region.cells.length, areaKm2: Math.round(region.areaKm2), centroid: region.centroid,
      island: region.island, coastal: region.coastal, openLake: region.openLake, riverTier: region.riverTier,
      neighbors: region.neighbors.map(edge => edge.region),
    })),
  };
  return regionMap;
}

function report(events: boolean) {
  return {
    instance, tick: state.tick, stats: state.stats, metrics: state.metrics, eventLogHash: state.chronicle.hash, stateHash: stateHash(state),
    series: state.series, knowledge: knowledgeReport(state), politics: politicsReport(state),
    eventCount: state.chronicle.events.length, events: events ? state.chronicle.events : undefined,
    timing: SYSTEMS.map(system => ({ system: system.key, ms: state.timing.ms[system.id], calls: state.timing.calls[system.id] })),
    partition: partitionStats(geography, partition),
  };
}

port.on('message', (request: SimulationRequest) => {
  try {
    const body = request.kind === 'frame' ? frame(request.cursor, request.inspect ?? null)
      : request.kind === 'chronicle' ? chronicle(request.query)
      : request.kind === 'control' ? (control(request.control), frame(request.cursor, request.inspect ?? null))
      : request.kind === 'regions' ? regions()
      : report(request.events);
    port.postMessage({ kind: 'reply', id: request.id, ok: true, body } satisfies SimulationReply);
  } catch (error) {
    stop();
    const message = error instanceof Error ? error.message : String(error);
    // Report the failure first, so the host retires this worker before any caller sees the reply.
    port.postMessage({ kind: 'failed', message } satisfies SimulationReply);
    port.postMessage({ kind: 'reply', id: request.id, ok: false, message } satisfies SimulationReply);
  }
});
port.postMessage({ kind: 'ready', instance, setupMs: Math.round(performance.now() - started) } satisfies SimulationReply);
