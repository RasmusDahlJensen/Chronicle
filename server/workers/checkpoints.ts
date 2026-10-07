import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SIMULATION_RULES_VERSION } from '../../src/simulation/simulation.ts';
import type { Checkpoint } from '../../src/simulation/snapshot.ts';

/**
 * Checkpoint files (development tooling, Dev 02), shared by the lab's simulation worker and the fork tool:
 * `<root>/<seed>-<size>/r<rules>-<code>/year-<year>.v8.gz`, a state serialized with V8's structured serializer and
 * gzipped. A checkpoint belongs to the simulation code that made it: the code hash covers every file of `src/simulation`
 * (the tunables too) and every file they import (shared contracts, resource rules), so any change makes new ones, and
 * opening a store removes that world's checkpoints from other code. A history restored from one is always the history
 * those rules make; the fork tool applies its tunable overrides on top of such a checkpoint, in memory.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_CHECKPOINT_ROOT = join(ROOT, '.chronicle', 'checkpoints');
/** Checkpoints are kept every this many years of a history left to its rules. */
export const CHECKPOINT_EVERY = 250;

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sources(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Every file the given ones import, directly or not (relative static imports and re-exports). */
function importClosure(entries: string[]) {
  const seen = new Set<string>(), queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(resolve(dirname(file), match[1]));
  }
  return [...seen];
}

/** The simulation's code, as paths from the project root: `src/simulation` (with its tunables) and everything it imports. */
export function simulationSources() {
  return importClosure(sources(join(ROOT, 'src', 'simulation'))).map(path => relative(ROOT, path)).sort();
}

/** A hash of the simulation's code (`simulationSources`). */
export function simulationCodeHash() {
  const hash = createHash('sha256');
  for (const path of simulationSources()) { hash.update(path); hash.update('\0'); hash.update(readFileSync(join(ROOT, path))); hash.update('\0'); }
  return hash.digest('hex').slice(0, 16);
}

/** Where one world's checkpoints from this code live. */
export interface CheckpointStore { root: string; seed: string; size: string; codeHash: string }

const slug = (text: string) => text.replace(/[^A-Za-z0-9_-]+/g, '_');
const worldDirectory = (store: CheckpointStore) => join(store.root, `${slug(store.seed)}-${slug(store.size)}`);
const codeDirectory = (store: CheckpointStore) => join(worldDirectory(store), `r${SIMULATION_RULES_VERSION}-${store.codeHash}`);
export const checkpointPath = (store: CheckpointStore, year: number) => join(codeDirectory(store), `year-${year}.v8.gz`);

/** A world's checkpoint store for the current code; its checkpoints from other code are removed (they cannot be used),
 *  and so are files an interrupted write left behind. */
export function openCheckpointStore(root: string, seed: string, size: string, codeHash = simulationCodeHash()): CheckpointStore {
  const store = { root, seed, size, codeHash };
  const current = `r${SIMULATION_RULES_VERSION}-${codeHash}`;
  if (existsSync(worldDirectory(store))) {
    for (const entry of readdirSync(worldDirectory(store), { withFileTypes: true })) {
      if (entry.isDirectory() && /^r\d+-[0-9a-f]+$/.test(entry.name) && entry.name !== current) rmSync(join(worldDirectory(store), entry.name), { recursive: true, force: true });
    }
  }
  if (existsSync(codeDirectory(store))) {
    // Another process may be writing one now: only files older than an hour are left over.
    for (const name of readdirSync(codeDirectory(store)).filter(entry => entry.endsWith('.tmp'))) {
      const path = join(codeDirectory(store), name);
      try { if (Date.now() - statSync(path).mtimeMs > 3_600_000) unlinkSync(path); } catch { /* gone already */ }
    }
  }
  return store;
}

/** The years this store has checkpoints for, in order. */
export function checkpointYears(store: CheckpointStore) {
  if (!existsSync(codeDirectory(store))) return [];
  return readdirSync(codeDirectory(store)).map(name => /^year-(\d+)\.v8\.gz$/.exec(name)).filter(match => match !== null).map(match => Number(match[1])).sort((a, b) => a - b);
}

const gzipAsync = promisify(gzip);

/** Write a checkpoint. The state is serialized at once (the history may move on while the file is written); the file
 *  appears whole or not at all. */
export async function writeCheckpoint(store: CheckpointStore, year: number, checkpoint: Checkpoint) {
  const bytes = serialize(checkpoint), path = checkpointPath(store, year), temporary = `${path}.${randomUUID()}.tmp`;
  const packed = await gzipAsync(bytes, { level: 6 });
  mkdirSync(dirname(path), { recursive: true });
  try { writeFileSync(temporary, packed); renameSync(temporary, path); } catch (error) {
    try { unlinkSync(temporary); } catch { /* never written */ }
    throw error;
  }
}

/** The checkpoint for `year`, or null when there is none. */
export function readCheckpoint(store: CheckpointStore, year: number): Checkpoint | null {
  const path = checkpointPath(store, year);
  if (!existsSync(path)) return null;
  return deserialize(gunzipSync(readFileSync(path))) as Checkpoint;
}
