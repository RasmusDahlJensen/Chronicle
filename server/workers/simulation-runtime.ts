import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Check } from 'typebox/value';
import { parseCivilizationSnapshot, type WorldStudyBundle } from '../../shared/civilization.ts';
import { parseWorldManifest, parseWorldTile, WORLD_TILE_SIZE, WORLD_SIZES, WORLD_BIOMES, WORLD_AREA_KM2 } from '../../shared/generated-world.ts';
import { DAYS_PER_MONTH, MAX_SIMULATION_BYTES, parseSimulationState, SimulationCommandSchema, SimulationObserveSchema, SimulationOpenSchema,
  type SimulationCommand, type SimulationObserve, type SimulationOpen, type SimulationState, type SimulationView } from '../../shared/simulation.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import type { SettlementEnvironment } from '../../shared/settlements.ts';
import { createSettlementEnvironment, migrateTribeState, validateSettlementGeography } from '../../src/simulation/settlements.ts';
import { UnsuitableSpawnError, advanceTribeDays, createTribeState, resetTribeState } from '../../src/simulation/tribe.ts';
import { SimulationError, simulationConflict, simulationUnavailable } from '../simulation-errors.ts';

// Reserve transport envelope space, including a 256-character escaped error message.
export const MAX_SIMULATION_CHECKPOINT_BYTES = MAX_SIMULATION_BYTES - 2048;
export const SIMULATION_LIMITS = { residents: 16, observers: 64, leaseMs: 30_000, tickMs: 1_000 } as const;
const saveMessage = 'The tribal save could not be completed. The clock is suspended; retry a command after fixing storage.';
const invalidSave = () => new SimulationError('SIMULATION_ERROR', 'The tribal save is invalid or uses unsupported rules. The saved data has been preserved.');
const invalidRequest = () => new SimulationError('INVALID_REQUEST', 'Invalid simulation request.', 400);
interface Resident { state: SimulationState; observers: Map<string, number>; lastTick: number; error: string | null; persisted: boolean; environment?: SettlementEnvironment; environmentPersisted?: boolean }
interface RuntimeOptions { directory?: string; now?: () => number }

const MAX_ENVIRONMENT_BYTES = 20 * 1024 * 1024;
function databaseEnvironmentSchema(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS environments (world_key TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;');
  db.prepare('SELECT body, digest FROM environments WHERE world_key = ?');
}
function validateEnvironment(value: unknown, state: SimulationState): SettlementEnvironment {
  const env = value as SettlementEnvironment, shape = WORLD_SIZES[state.settings.size];
  if (!env || env.worldKey !== state.worldKey || env.width !== shape.width || env.height !== shape.height
    || env.cellKm !== Math.sqrt(WORLD_AREA_KM2 / (shape.width * shape.height))) throw invalidSave();
  const n = shape.width * shape.height;
  for (const [field, min, max] of [['biome', 0, WORLD_BIOMES.length - 1], ['fertility', 0, 100],
    ['resource', 0, RESOURCE_IDS.length], ['elevation', -12000, 12000]] as const) {
    if (!Array.isArray(env[field]) || env[field].length !== n || env[field].some(v => !Number.isInteger(v) || v < min || v > max)) throw invalidSave();
  }
  return env;
}
const digest = (body: string) => createHash('sha256').update(body).digest('hex');

/** Called only in the dedicated worker (or headless tests); it owns all synchronous SQLite work. */
export function createSimulationRuntime(options: RuntimeOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const residents = new Map<string, Resident>();
  let owner: DatabaseSync | undefined, db: DatabaseSync | undefined, closed = false;
  try {
    if (options.directory && options.directory !== ':memory:') {
      mkdirSync(options.directory, { recursive: true });
      owner = new DatabaseSync(join(options.directory, 'simulation-owner.sqlite'), { timeout: 0 });
      try { owner.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;'); }
      catch { throw new SimulationError('UNAVAILABLE', 'This save directory is already in use by another simulation owner.'); }
    }
    db = new DatabaseSync(options.directory && options.directory !== ':memory:' ? join(options.directory, 'simulation.sqlite') : ':memory:', { timeout: 250 });
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (version !== 0 && version !== 1) throw invalidSave();
    if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'").get()) throw invalidSave();
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    if (version === 0) db.exec('BEGIN IMMEDIATE; CREATE TABLE checkpoints (id TEXT PRIMARY KEY, current TEXT NOT NULL, previous TEXT) STRICT; PRAGMA user_version=1; COMMIT;');
    databaseEnvironmentSchema(db);
    // Prepare now so an incompatible table cannot masquerade as a healthy store until first access.
    db.prepare('SELECT current, previous FROM checkpoints WHERE id = ?');
  } catch (error) {
    db?.close(); owner?.close();
    if (error instanceof SimulationError) throw error;
    throw invalidSave();
  }
  const database = db;
  function ensureOpen() { if (closed) throw simulationUnavailable(); }
  function expire() {
    const time = now();
    for (const [id, entry] of residents) {
      for (const [observer, until] of entry.observers) if (until <= time) entry.observers.delete(observer);
      if (entry.observers.size === 0 && !entry.error) residents.delete(id);
    }
  }
  function view(entry: Resident): SimulationView {
    return { state: structuredClone(entry.state), active: entry.state.running && entry.observers.size > 0 && !entry.error,
      error: entry.error };
  }
  function residentEnvironment(worldKey: string) {
    for (const entry of residents.values()) if (entry.environment?.worldKey === worldKey) return entry.environment;
    return undefined;
  }
  function load(id: string): Resident | null {
    ensureOpen(); expire();
    const cached = residents.get(id); if (cached) return cached;
    let row;
    try { row = database.prepare('SELECT current FROM checkpoints WHERE id = ?').get(id); }
    catch { throw invalidSave(); }
    if (!row) return null;
    if (residents.size >= SIMULATION_LIMITS.residents) throw new SimulationError('OVERLOADED', 'Too many tribal worlds are currently observed. Close another world and retry.');
    let state: SimulationState;
    try {
      if (typeof row.current !== 'string' || Buffer.byteLength(row.current) > MAX_SIMULATION_CHECKPOINT_BYTES) throw invalidSave();
      state = parseSimulationState(JSON.parse(row.current));
      if (state.id !== id) throw invalidSave();
    } catch { throw invalidSave(); }
    let environment: SettlementEnvironment | undefined;
    if (state.rulesVersion >= 2) {
      try {
        environment = residentEnvironment(state.worldKey);
        if (!environment) {
          const stored = database.prepare('SELECT body, digest FROM environments WHERE world_key = ?').get(state.worldKey);
          if (!stored || typeof stored.body !== 'string' || Buffer.byteLength(stored.body) > MAX_ENVIRONMENT_BYTES
            || digest(stored.body) !== stored.digest) throw invalidSave();
          environment = validateEnvironment(JSON.parse(stored.body), state);
        }
        validateSettlementGeography(state, environment);
      } catch { throw invalidSave(); }
    }
    const entry: Resident = { state, observers: new Map(), lastTick: now(), error: null, persisted: true,
      environment, environmentPersisted: true };
    residents.set(id, entry); return entry;
  }
  function attach(entry: Resident, observerId: string) {
    if (!entry.observers.has(observerId) && entry.observers.size >= SIMULATION_LIMITS.observers) {
      throw new SimulationError('OVERLOADED', 'Too many observers are connected to this tribe. Close another tab and retry.');
    }
    if (entry.observers.size === 0) entry.lastTick = now();
    entry.observers.set(observerId, now() + SIMULATION_LIMITS.leaseMs);
  }
  function identity(entry: Resident, input: SimulationOpen) {
    const state = entry.state;
    if (state.settings.seed !== input.settings.seed || state.settings.size !== input.settings.size || state.placementSeed !== input.placementSeed
      || state.clockMode !== input.clockMode || (state.spawnOriginCellId ?? undefined) !== input.originCellId) {
      throw simulationConflict('This simulation identity already belongs to a different world or placement.');
    }
  }
  function save(entry: Resident, candidate: SimulationState, environment = entry.environment) {
    const state = parseSimulationState(candidate), body = JSON.stringify(state);
    if (Buffer.byteLength(body) > MAX_SIMULATION_CHECKPOINT_BYTES) throw invalidSave();
    try {
      database.exec('BEGIN IMMEDIATE;');
      if (state.rulesVersion >= 2 && !entry.environmentPersisted) {
        validateEnvironment(environment, state);
        validateSettlementGeography(state, environment!);
        const environmentBody = JSON.stringify(environment);
        if (Buffer.byteLength(environmentBody) > MAX_ENVIRONMENT_BYTES) throw invalidSave();
        const existing = database.prepare('SELECT body, digest FROM environments WHERE world_key = ?').get(state.worldKey);
        if (existing && (typeof existing.body !== 'string' || Buffer.byteLength(existing.body) > MAX_ENVIRONMENT_BYTES
          || digest(existing.body) !== existing.digest || existing.digest !== digest(environmentBody))) throw invalidSave();
        if (!existing) database.prepare('INSERT INTO environments (world_key, body, digest) VALUES (?, ?, ?)')
          .run(state.worldKey, environmentBody, digest(environmentBody));
      }
      if (!entry.persisted) database.prepare('INSERT INTO checkpoints (id, current) VALUES (?, ?)').run(state.id, body);
      else {
        const result = database.prepare('UPDATE checkpoints SET previous = current, current = ? WHERE id = ?').run(body, state.id);
        if (result.changes !== 1) throw invalidSave();
      }
      // FULL synchronous WAL COMMIT is the durable game checkpoint. SQLite's WAL checkpointing remains housekeeping.
      database.exec('COMMIT;');
      entry.state = state; entry.persisted = true; entry.environment = environment ? residentEnvironment(state.worldKey) ?? environment : undefined; entry.environmentPersisted = !!environment;
      entry.error = null;
    } catch {
      try { database.exec('ROLLBACK;'); } catch { /* BEGIN itself may have failed. */ }
      entry.error = saveMessage;
      throw new SimulationError('SIMULATION_ERROR', saveMessage);
    }
  }
  function open(input: SimulationOpen): SimulationView | null {
    if (!Check(SimulationOpenSchema, input) || input.originCellId !== undefined && input.clockMode !== 'monthly') throw invalidRequest();
    const entry = load(input.instanceId); if (!entry) return null;
    identity(entry, input); attach(entry, input.observerId); return view(entry);
  }
  function initialize(input: SimulationOpen, bundle: WorldStudyBundle): SimulationView {
    const existing = open(input); if (existing && existing.state.rulesVersion >= 2) return existing;
    if (!existing && residents.size >= SIMULATION_LIMITS.residents) throw new SimulationError('OVERLOADED', 'Too many tribal worlds are currently observed. Close another world and retry.');
    let state: SimulationState, environment: SettlementEnvironment;
    try {
      const manifest = parseWorldManifest(JSON.parse(bundle.manifest));
      if (manifest.settings.seed !== input.settings.seed || manifest.settings.size !== input.settings.size) throw invalidRequest();
      const civilization = parseCivilizationSnapshot(JSON.parse(bundle.civilization), manifest);
      const columns = manifest.width / WORLD_TILE_SIZE;
      if (bundle.tiles.length !== columns * manifest.height / WORLD_TILE_SIZE) throw invalidRequest();
      const tiles = bundle.tiles.map((body, index) => parseWorldTile(JSON.parse(body), manifest, index % columns, Math.floor(index / columns)));
      environment = createSettlementEnvironment(manifest, tiles);
      state = existing ? migrateTribeState(existing.state, environment) : createTribeState(input.instanceId, input.placementSeed, manifest, civilization, tiles, input);
    } catch (error) {
      if (error instanceof UnsuitableSpawnError) throw new SimulationError('INVALID_REQUEST', error.message, 400);
      throw new SimulationError('SIMULATION_ERROR', 'Unable to start a tribe on suitable land in this world. Its saved data has been preserved.');
    }
    const entry: Resident = residents.get(input.instanceId) ?? { state, observers: new Map(), lastTick: now(), error: null, persisted: false, environment };
    entry.environmentPersisted = false;
    // Keep failed first writes recoverable too; initialize will never silently replace this resident.
    residents.set(state.id, entry); attach(entry, input.observerId);
    save(entry, state, environment);
    return view(entry);
  }
  function observe(input: SimulationObserve): SimulationView {
    if (!Check(SimulationObserveSchema, input)) throw invalidRequest();
    const entry = load(input.instanceId);
    if (!entry) throw new SimulationError('NOT_FOUND', 'This tribal simulation does not exist. Open it before observing.', 404);
    attach(entry, input.observerId); return view(entry);
  }
  function release(input: SimulationObserve) {
    if (!Check(SimulationObserveSchema, input)) throw invalidRequest();
    ensureOpen(); const entry = residents.get(input.instanceId);
    entry?.observers.delete(input.observerId); expire(); return { released: true as const };
  }
  function command(input: SimulationCommand): SimulationView {
    if (!Check(SimulationCommandSchema, input)
      || (input.action === 'step' ? input.days === undefined || input.speed !== undefined
        : input.action === 'speed' ? input.speed === undefined || input.days !== undefined
        : input.days !== undefined || input.speed !== undefined)) throw invalidRequest();
    ensureOpen(); expire(); const entry = residents.get(input.instanceId);
    if (!entry?.observers.has(input.observerId)) throw simulationConflict('This observer lease expired. Observe the tribe before another command.');
    // Pausing the current incarnation must survive a tick between observation and the command.
    // Other actions still require the exact observed revision; a reset always invalidates old intent.
    const revisionMatches = input.action === 'pause' ? input.revision <= entry.state.revision : input.revision === entry.state.revision;
    if (entry.state.incarnation !== input.incarnation || !revisionMatches) throw simulationConflict();
    if (entry.state.clockMode === 'monthly' && (input.action === 'speed' || input.action === 'step' && input.days !== DAYS_PER_MONTH)) throw invalidRequest();
    let next = entry.state;
    if (input.action === 'step') {
      if (next.running) throw simulationConflict('Pause the tribal clock before stepping days.');
      next = advanceTribeDays(next, input.days!, entry.environment);
    } else if (input.action === 'reset') next = resetTribeState(next);
    else if (input.action === 'speed') next = { ...next, speed: input.speed! };
    else next = { ...next, running: input.action === 'play' };
    save(entry, { ...next, revision: entry.state.revision + 1 });
    entry.lastTick = now(); attach(entry, input.observerId); return view(entry);
  }
  function tick() {
    ensureOpen(); expire(); const time = now();
    for (const entry of residents.values()) {
      if (!entry.state.running || !entry.observers.size || entry.error || time - entry.lastTick < SIMULATION_LIMITS.tickMs) continue;
      entry.lastTick = time;
      try { save(entry, { ...advanceTribeDays(entry.state, entry.state.clockMode === 'monthly' ? DAYS_PER_MONTH : entry.state.speed, entry.environment), revision: entry.state.revision + 1 }); }
      catch { entry.error = saveMessage; }
    }
  }
  function close() {
    if (closed) return; closed = true; residents.clear();
    try { database.close(); } finally { owner?.close(); }
  }
  return { open, initialize, observe, release, command, tick, close };
}
