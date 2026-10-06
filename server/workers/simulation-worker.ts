import { parentPort, workerData } from 'node:worker_threads';
import {
  MAX_FRAME_EVENTS, MAX_SIMULATION_YEAR, SIMULATION_PROTOCOL_VERSION, SPEED_MONTHS_PER_SECOND,
  type ObserverFrame, type RegionMap, type SimulationControl, type SimulationInit, type SimulationInstance,
  type SimulationReply, type SimulationRequest, type SimulationSpeed,
} from '../../shared/simulation.ts';
import { validateTechData } from '../../src/simulation/deposits.ts';
import { validateBuildings } from '../../src/simulation/buildings.ts';
import { validateWonders } from '../../src/simulation/wonders.ts';
import { validateRoads } from '../../src/simulation/roads.ts';
import { decodeGeography } from '../../src/simulation/geography.ts';
import { checkPartition } from '../../src/simulation/invariants.ts';
import { partitionRegions, partitionStats, REGION_PARTITION_VERSION } from '../../src/simulation/regions.ts';
import { createSimulation, frameCounters, knowledgeReport, politicsReport, SIMULATION_RULES_VERSION, stateHash, stepSimulation } from '../../src/simulation/simulation.ts';
import { observerView } from '../../src/simulation/observer.ts';
import { SYSTEMS } from '../../src/simulation/state.ts';
import { CLOCK_TUNING, validateTunables } from '../../src/simulation/tunables.ts';

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
let anchor = { time: 0, tick: 0 };
let timer: ReturnType<typeof setTimeout> | undefined;
let immediate: ReturnType<typeof setImmediate> | undefined;
const endTick = MAX_SIMULATION_YEAR * 12;
const now = () => performance.now();
let regionMap: RegionMap | undefined;

function stop() {
  // An interrupted run to a year still ends: tell anyone waiting for it.
  if (target !== null) port!.postMessage({ kind: 'arrived', tick: state.tick } satisfies SimulationReply);
  playing = false; target = null;
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
  while (state.tick < due && (target === null || state.tick < target) && now() < sliceEnd) stepSimulation(state, now);
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
    case 'step': stop(); if (state.tick < endTick) stepSimulation(state, now); break;
    case 'speed': speed = command.speed; if (playing) play(); break;
    case 'runTo': {
      const goal = Math.min(endTick, command.year * 12);
      stop();
      if (goal > state.tick) { target = goal; play(); }
      break;
    }
    case 'reset': stop(); state = createSimulation(geography, partition, init.seed); epoch++; break;
  }
}

function frame(cursor: number, inspect: number | null = null): ObserverFrame {
  return {
    protocolVersion: SIMULATION_PROTOCOL_VERSION, instance, tick: state.tick, playing, speed, epoch,
    runTo: target === null ? null : target / 12, eventCount: state.chronicle.events.length,
    events: state.chronicle.since(cursor, MAX_FRAME_EVENTS), counters: frameCounters(state), ...observerView(state, inspect),
  };
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
