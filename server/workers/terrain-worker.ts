import type { TerrainStudy } from '../../shared/studies.ts';
import { generateWorld } from '../../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../../src/world/generation/encode.ts';

/** Construct and encode generated geography away from HTTP handling. */
export default async function generateTerrain(study: TerrainStudy = { kind: 'probe' }): Promise<string> {
  // The probe proves the worker's module graph (generation, the Platec loader, encoding) loads and a job round-trips,
  // without generating a world. Platec's WebAssembly is instantiated per generation; check:tectonics and the real-worker
  // tests cover that path.
  if (study.kind === 'probe') return JSON.stringify({ status: 'ready' });
  if (study.kind === 'world') return JSON.stringify(encodeGeneratedWorld(await generateWorld({ seed: study.seed, size: study.size })));
  throw new Error('Unknown terrain job.');
}
