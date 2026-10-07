import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import type { WorldBundle } from '../shared/generated-world.ts';
import { DEFAULT_CHECKPOINT_ROOT, openCheckpointStore, readCheckpoint, simulationCodeHash } from '../server/workers/checkpoints.ts';
import { checkInvariants } from '../src/simulation/invariants.ts';
import { SIMULATION_RULES_VERSION } from '../src/simulation/simulation.ts';
import { restoreCheckpoint } from '../src/simulation/snapshot.ts';
import type { CenturyStats } from '../src/simulation/state.ts';
import { decodeWorld, expectFor, loadWorld, stateAt } from './checkpoints.ts';
import { applyOverrides, type Overrides, type RunResult, runFrom } from './fork-core.ts';

/**
 * Fork and compare (development tooling, Dev 02). Restores each seed's history at `--at` from its checkpoint (made
 * once by simulating to it), then runs the baseline and every variant on for `--years` side by side in worker threads,
 * and prints and writes the chosen statistics at the end, their difference from the baseline and the events of each
 * kind each run added. A variant is a name and tunable overrides (see `fork-core.ts`), as JSON or `@file.json`:
 *
 *   npm run fork -- --all --at 1800 --years 400 --variant 'founding={"FAITH_TUNING":{"foundingRate":0.1}}'
 *
 * Calibration only: acceptance still comes from a full study (`npm run study:history`). A run that fails (a variant
 * whose restored history breaks the invariants) is reported in the tables; the others still count.
 */

const STUDY_SEEDS = ['Chronicle', 'Elsewhere', 'Atlas', 'Verdant', 'Aster'] as const;
const DEFAULT_STATS = ['population', 'civs', 'tribes', 'cities', 'meanStability', 'unrestRegions', 'cultures', 'cultureSplits', 'hybrids', 'religions', 'religionsFounded', 'religionMaxCivs', 'stateReligions', 'schisms', 'secularCivs', 'famines'];

interface Place { root: string; seed: string; size: string; at: number; codeHash: string }
type Task = Place & ({ kind: 'prepare' } | { kind: 'run'; years: number; bundle: WorldBundle; label: string; overrides: Overrides });
type Outcome = { ok: true; result: RunResult } | { ok: false; error: string };

if (!isMainThread) {
  const task = workerData as Task;
  if (task.kind === 'prepare') {
    const lines: string[] = [];
    const world = await loadWorld(task.seed, task.size);
    await stateAt(openCheckpointStore(task.root, task.seed, task.size, task.codeHash), task.at, world, line => lines.push(line));
    parentPort?.postMessage({ bundle: world.bundle, lines });
  } else {
    const world = decodeWorld(task.bundle), store = { root: task.root, seed: task.seed, size: task.size, codeHash: task.codeHash };
    const checkpoint = readCheckpoint(store, task.at);
    if (!checkpoint) throw new Error(`${task.seed} has no checkpoint at year ${task.at}.`);
    // Overrides first: what the world derives from tunables is rebuilt on restore with the variant's.
    applyOverrides(task.overrides);
    const state = restoreCheckpoint(checkpoint, world.geography, world.partition, expectFor(store, world.geography));
    try { checkInvariants(state); } catch (error) {
      throw new Error(`the history at year ${task.at} does not hold under these tunables (${(error as Error).message}): a history stores some values made with the old ones (cultivated fields, housing, road upkeep…), so change those in tunables.ts and run a study instead`);
    }
    try { parentPort?.postMessage(runFrom(state, task.years)); } catch (error) {
      throw new Error(`the run broke the invariants (${(error as Error).message}); if this variant changes tunables whose values a history stores (cultivated fields, housing, road upkeep…), change them in tunables.ts and run a study instead`);
    }
  }
} else {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', multiple: true }, all: { type: 'boolean', default: false }, size: { type: 'string', default: 'large' },
      at: { type: 'string' }, years: { type: 'string', default: '200' }, variant: { type: 'string', multiple: true },
      stats: { type: 'string' }, out: { type: 'string' }, concurrency: { type: 'string' }, checkpoints: { type: 'string' },
    },
  });
  const seeds = values.all ? [...STUDY_SEEDS] : values.seed?.length ? values.seed : ['Chronicle'];
  const at = Number(values.at), years = Number(values.years);
  if (!Number.isInteger(at) || at < 1 || at > 5000) throw new Error('--at must be a year from 1 to 5000 (where the forks start).');
  if (!Number.isInteger(years) || years < 1 || years > 5000) throw new Error('--years must be an integer from 1 to 5000.');
  const concurrency = values.concurrency === undefined ? Math.max(1, Math.floor(availableParallelism() / 2)) : Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('--concurrency must be an integer from 1 to 64.');
  const variants: { label: string; overrides: Overrides }[] = [{ label: 'baseline', overrides: {} }];
  for (const entry of values.variant ?? []) {
    const split = entry.indexOf('=');
    if (split < 1) throw new Error(`--variant ${entry}: expected name={"TUNING":{"field":value}} or name=@file.json.`);
    const label = entry.slice(0, split), text = entry.slice(split + 1);
    if (variants.some(variant => variant.label === label)) throw new Error(`--variant ${label} is given twice.`);
    const overrides = JSON.parse(text.startsWith('@') ? await readFile(text.slice(1), 'utf8') : text) as Overrides;
    // Refuse a bad override here rather than in every worker.
    applyOverrides(overrides)();
    variants.push({ label, overrides });
  }
  const labels = variants.map(variant => variant.label);
  const requested = values.stats ? values.stats.split(',').map(name => name.trim()).filter(Boolean) : DEFAULT_STATS;
  const root = resolve(values.checkpoints ?? DEFAULT_CHECKPOINT_ROOT);
  const out = resolve('.chronicle', 'forks', values.out ?? new Date().toISOString().replace(/[:.]/g, '-'));
  const codeHash = simulationCodeHash();

  // One worker per task, at most `concurrency` at once (each holds a large world and its history).
  let running = 0;
  const waiting: (() => void)[] = [];
  const inWorker = async <T>(task: Task): Promise<T> => {
    while (running >= concurrency) await new Promise<void>(next => waiting.push(next));
    running++;
    try {
      return await new Promise<T>((done, fail) => {
        const worker = new Worker(new URL(import.meta.url), { workerData: task, resourceLimits: { maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 64 } });
        let result: T | undefined;
        worker.on('message', (message: T) => { result = message; });
        worker.on('error', fail);
        worker.on('exit', code => result !== undefined ? done(result) : fail(new Error(`the worker exited with code ${code}`)));
      });
    } finally { running--; waiting.shift()?.(); }
  };

  const started = performance.now();
  console.log(`Fork from year ${at} for ${years} years: ${seeds.join(', ')} (${values.size}); runs ${labels.join(', ')}; code r${SIMULATION_RULES_VERSION}-${codeHash}`);
  const outcomes = new Map<string, Map<string, Outcome>>(seeds.map(seed => [seed, new Map()]));
  await Promise.all(seeds.map(async seed => {
    const runs = outcomes.get(seed)!;
    const place = { root, seed, size: values.size, at, codeHash };
    let bundle: WorldBundle;
    try {
      const prepared = await inWorker<{ bundle: WorldBundle; lines: string[] }>({ kind: 'prepare', ...place });
      for (const line of prepared.lines) console.log(line);
      bundle = prepared.bundle;
    } catch (error) {
      for (const label of labels) runs.set(label, { ok: false, error: `no checkpoint: ${(error as Error).message}` });
      console.log(`${seed}: the checkpoint at year ${at} failed: ${(error as Error).message}`);
      return;
    }
    await Promise.all(variants.map(async variant => {
      try {
        const result = await inWorker<RunResult>({ kind: 'run', ...place, years, bundle, ...variant });
        runs.set(variant.label, { ok: true, result });
        console.log(`${seed} ${variant.label}: years ${result.from}–${result.to} at ${result.msPerYear.toFixed(0)} ms/year, hash ${result.eventLogHash}`);
      } catch (error) {
        runs.set(variant.label, { ok: false, error: (error as Error).message });
        console.log(`${seed} ${variant.label}: failed: ${(error as Error).message}`);
      }
    }));
  }));

  const lines = comparison(seeds, labels, requested, outcomes, at, years);
  console.log(`\n${lines.join('\n')}\n`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'comparison.md'), `${lines.join('\n')}\n`);
  const results = Object.fromEntries(seeds.map(seed => [seed, Object.fromEntries(labels.map(label => [label, outcomes.get(seed)!.get(label)]))]));
  await writeFile(join(out, 'results.json'), `${JSON.stringify({ at, years, size: values.size, codeHash, rulesVersion: SIMULATION_RULES_VERSION, variants, results }, null, 1)}\n`);
  const failed = [...outcomes.values()].reduce((count, runs) => count + [...runs.values()].filter(outcome => !outcome.ok).length, 0);
  console.log(`Wrote ${out}/comparison.md and results.json in ${((performance.now() - started) / 1000).toFixed(0)} s${failed ? `; ${failed} run${failed === 1 ? '' : 's'} failed` : ''}.`);
  if (failed) process.exitCode = 1;
}

/** The comparison tables: per seed, each statistic at the end and its change from the baseline (and whether a run
 *  made the very same history); then the mean over the seeds whose runs all finished; then the events each run added. */
function comparison(seeds: string[], labels: string[], requested: string[], outcomes: Map<string, Map<string, Outcome>>, at: number, years: number) {
  const finished = (seed: string, label: string) => { const outcome = outcomes.get(seed)?.get(label); return outcome?.ok ? outcome.result : null; };
  const anyRow = [...outcomes.values()].flatMap(runs => [...runs.values()]).find(outcome => outcome.ok);
  const known = anyRow?.ok ? new Set(Object.keys(anyRow.result.last)) : new Set<string>();
  const stats = requested.filter(name => known.has(name)) as (keyof CenturyStats)[], unknown = requested.filter(name => anyRow && !known.has(name));
  const format = (value: number) => Number.isNaN(value) ? '—' : Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(3);
  const delta = (value: number, base: number) => Number.isNaN(value) || Number.isNaN(base) ? '—' : value === base ? '=' : `${value > base ? '+' : '−'}${format(Math.abs(value - base))}`;
  const header = ['| Statistic at the end |', ...labels.map((label, index) => index === 0 ? ` ${label} |` : ` ${label} | Δ |`)].join('');
  const rule = ['| --- |', ...labels.map((_, index) => index === 0 ? ' ---: |' : ' ---: | ---: |')].join('');
  const table = (value: (label: string, stat: keyof CenturyStats) => number) => [header, rule, ...stats.map(stat => {
    const base = value('baseline', stat);
    return [`| ${stat} |`, ...labels.map((label, index) => index === 0 ? ` ${format(base)} |` : ` ${format(value(label, stat))} | ${delta(value(label, stat), base)} |`)].join('');
  })];
  const lines = [`# Fork from year ${at} for ${years} years`];
  if (unknown.length) lines.push('', `Unknown statistics left out: ${unknown.join(', ')}. Known: ${[...known].filter(name => name !== 'year').join(', ')}.`);
  for (const seed of seeds) {
    lines.push('', `## ${seed}`, '');
    const base = finished(seed, 'baseline');
    for (const label of labels) {
      const outcome = outcomes.get(seed)?.get(label);
      if (outcome && !outcome.ok) lines.push(`- ${label} failed: ${outcome.error}`);
      else if (label !== 'baseline' && base && outcome?.ok && outcome.result.eventLogHash === base.eventLogHash && outcome.result.stateHash === base.stateHash) lines.push(`- ${label}: the very same history as the baseline (these tunables never changed an outcome here)`);
    }
    if (lines.at(-1) !== '') lines.push('');
    lines.push(...table((label, stat) => Number(finished(seed, label)?.last[stat] ?? Number.NaN)));
  }
  const complete = seeds.filter(seed => labels.every(label => finished(seed, label)));
  if (complete.length > 1) {
    const mean = (label: string, stat: keyof CenturyStats) => complete.reduce((sum, seed) => sum + Number(finished(seed, label)!.last[stat]), 0) / complete.length;
    lines.push('', `## Mean over ${complete.length} seeds${complete.length < seeds.length ? ' whose runs all finished' : ''}`, '', ...table(mean));
  }
  const types = new Set<string>();
  for (const seed of seeds) for (const label of labels) for (const type of Object.keys(finished(seed, label)?.events ?? {})) types.add(type);
  const total = (label: string, type: string) => complete.reduce((sum, seed) => sum + (finished(seed, label)!.events[type] ?? 0), 0);
  lines.push('', `## Events added, ${complete.length === seeds.length ? 'all seeds' : `the ${complete.length} seeds whose runs all finished`}`, '', ['| Event |', ...labels.map(label => ` ${label} |`)].join(''), ['| --- |', ...labels.map(() => ' ---: |')].join(''));
  for (const type of [...types].sort()) lines.push([`| ${type} |`, ...labels.map(label => ` ${format(total(label, type))} |`)].join(''));
  return lines;
}
