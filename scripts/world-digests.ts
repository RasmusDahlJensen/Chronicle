import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { RESOURCE_IDS } from '../shared/atlas.ts';
import { WORLD_BIOMES, WORLD_GENERATOR_VERSION, type WorldSettings } from '../shared/generated-world.ts';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';

/**
 * Per-column geography digests for generator comparisons (docs/features/g1.md).
 * `resourceBase` hashes the resource column with the sites G1 appended (tin, oil) cleared, so it equals the
 * previous generator's `resource` digest exactly when only previously empty cells gained a site.
 *
 *   node scripts/world-digests.ts --out digests.json [--concurrency 6] [--seeds name:size,...]
 *   node scripts/world-digests.ts --compare before.json after.json
 */
const APPENDED: readonly string[] = ['tin', 'oil'];
interface Digest {
  seed: string; size: WorldSettings['size']; generator: number; status: 'ok' | 'failed'; error?: string; ms: number;
  columns?: Record<string, string>; resourceCounts?: Record<string, number>;
  clusters?: { tinPairWithin8: boolean; oilTripleWithin12: boolean; appendedOnWater: number };
}

function digestSpecs(): WorldSettings[] {
  const specs: WorldSettings[] = [];
  for (let at = 0; at < 100; at++) specs.push({ seed: `g1-${at}`, size: 'standard' });
  for (let at = 0; at < 50; at++) specs.push({ seed: `g1-${at}`, size: 'large' });
  specs.push({ seed: 'Timing', size: 'standard' }, { seed: 'Timing', size: 'large' });
  for (const seed of ['Chronicle', 'Elsewhere', 'Atlas', 'Verdant', 'Aster']) specs.push({ seed, size: 'large' });
  specs.push({ seed: 'Repeat', size: 'standard' }, { seed: 'Third', size: 'standard' });
  return specs;
}

const hash = (view: ArrayBufferView | string) => createHash('sha256')
  .update(typeof view === 'string' ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest('hex');

async function digest(settings: WorldSettings): Promise<Digest> {
  const started = performance.now();
  try {
    const world = await generateWorld(settings);
    // Encoding validates the manifest, water graph and every tile exactly as the host would publish them.
    encodeGeneratedWorld(world);
    const appended = new Set(APPENDED.map(id => RESOURCE_IDS.indexOf(id as typeof RESOURCE_IDS[number]) + 1).filter(code => code > 0));
    const base = world.fields.resource.map(code => appended.has(code) ? 0 : code);
    const resourceCounts: Record<string, number> = {};
    for (const code of world.fields.resource) if (code) resourceCounts[RESOURCE_IDS[code - 1]] = (resourceCounts[RESOURCE_IDS[code - 1]] ?? 0) + 1;
    const { elevation, temperature, moisture, biome, resource, fertility } = world.fields;
    // G1 acceptance: a tin cluster (2+ sites within 8 cells of each other) and an oil basin (3+ sites pairwise within 12).
    const sites = (id: string) => {
      const code = RESOURCE_IDS.indexOf(id as typeof RESOURCE_IDS[number]) + 1;
      return code ? [...resource.keys()].filter(cell => resource[cell] === code) : [];
    };
    const apart = (a: number, b: number) => {
      const dx = Math.abs(a % world.width - b % world.width);
      return Math.hypot(Math.min(dx, world.width - dx), Math.floor(a / world.width) - Math.floor(b / world.width));
    };
    const tin = sites('tin'), oil = sites('oil');
    const tinPairWithin8 = tin.some((a, i) => tin.slice(i + 1).some(b => apart(a, b) <= 8));
    const oilTripleWithin12 = oil.some((a, i) => oil.slice(i + 1).some((b, j) => apart(a, b) <= 12
      && oil.slice(i + j + 2).some(c => apart(a, c) <= 12 && apart(b, c) <= 12)));
    const water = new Set(['ocean', 'coast', 'seaIce', 'lake', 'lakeIce']);
    const appendedOnWater = [...tin, ...oil].filter(cell => elevation[cell] < 0 || water.has(WORLD_BIOMES[biome[cell]])).length;
    return {
      ...settings, generator: WORLD_GENERATOR_VERSION, status: 'ok', ms: Math.round(performance.now() - started), resourceCounts,
      clusters: { tinPairWithin8, oilTripleWithin12, appendedOnWater },
      columns: {
        elevation: hash(elevation), temperature: hash(temperature), moisture: hash(moisture), biome: hash(biome),
        hydrology: hash(JSON.stringify(world.hydrology)), fertility: hash(fertility), resource: hash(resource), resourceBase: hash(base),
      },
    };
  } catch (error) {
    return { ...settings, generator: WORLD_GENERATOR_VERSION, status: 'failed', error: (error as Error).message, ms: Math.round(performance.now() - started) };
  }
}

if (!isMainThread) {
  parentPort?.on('message', async (settings: WorldSettings | null) => {
    if (!settings) { process.exit(0); }
    parentPort?.postMessage(await digest(settings));
  });
  parentPort?.postMessage({ ready: workerData });
} else if (process.argv[2] === '--compare') {
  const [before, after] = await Promise.all(process.argv.slice(3, 5).map(async path => JSON.parse(await readFile(path, 'utf8')) as { generator: number; results: Digest[] }));
  const key = (result: Digest) => `${result.seed}:${result.size}`;
  const earlier = new Map(before.results.map(result => [key(result), result]));
  let identical = 0, fixed = 0;
  const problems: string[] = [];
  for (const result of after.results) {
    const old = earlier.get(key(result));
    if (!old) { problems.push(`${key(result)}: missing from ${process.argv[3]}`); continue; }
    if (result.status !== 'ok') { problems.push(`${key(result)}: ${result.error}`); continue; }
    if (old.status !== 'ok') { fixed++; continue; }
    const changed = ['elevation', 'temperature', 'moisture', 'biome', 'hydrology', 'fertility'].filter(column => old.columns?.[column] !== result.columns?.[column]);
    if (old.columns?.resource !== result.columns?.resourceBase) changed.push('resource (beyond appended sites)');
    if (changed.length) problems.push(`${key(result)}: ${changed.join(', ')} differ`); else identical++;
  }
  console.log(`generator ${before.generator} → ${after.generator}: ${identical} identical except appended sites, ${fixed} previously failing now generate, ${problems.length} problems`);
  for (const problem of problems) console.log(`  ${problem}`);
  if (problems.length) process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const out = option('--out');
  if (!out) throw new Error('Usage: node scripts/world-digests.ts --out <file.json> [--concurrency N] [--seeds seed:size,...]');
  const seeds = option('--seeds');
  const specs = seeds ? seeds.split(',').map(entry => { const [seed, size] = entry.split(':'); return { seed, size: size as WorldSettings['size'] }; }) : digestSpecs();
  const concurrency = Math.max(1, Math.min(Number(option('--concurrency') ?? Math.max(1, Math.floor(availableParallelism() / 2))), specs.length));
  const results: Digest[] = new Array(specs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, (_, index) => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: index });
    let current = -1;
    const feed = () => {
      if (next >= specs.length) { worker.postMessage(null); return; }
      current = next++; worker.postMessage(specs[current]);
    };
    worker.on('message', (message: Digest | { ready: number }) => {
      if (!('ready' in message)) {
        results[current] = message; done++;
        console.log(`${done}/${specs.length} ${message.seed} ${message.size} ${message.status}${message.error ? `: ${message.error}` : ''} ${message.ms} ms`);
      }
      feed();
    });
    worker.on('error', reject);
    worker.on('exit', () => resolve());
  })));
  await writeFile(out, `${JSON.stringify({ generator: WORLD_GENERATOR_VERSION, results }, null, 1)}\n`);
  const failed = results.filter(result => result.status === 'failed');
  console.log(`Wrote ${results.length} digests to ${out}; ${failed.length} failed: ${failed.map(result => `${result.seed}:${result.size}`).join(', ') || 'none'}`);
}
