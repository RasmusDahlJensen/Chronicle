import { createAsterIsland } from '../../src/fixtures/aster-island.ts';
import { createVerdantReach } from '../../src/fixtures/verdant-reach.ts';
import { MAX_TERRAIN_BYTES, parseTerrainResponse } from '../../shared/terrain.ts';
import { ATLAS_PROTOCOL_VERSION, parseAtlasResponse } from '../../shared/atlas.ts';
import type { TerrainStudy } from '../../shared/studies.ts';
import { generateWorld } from '../../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../../src/world/generation/encode.ts';

/** Construct, validate, and encode either study away from HTTP handling. */
export default async function generateTerrain(study: TerrainStudy = 'aster'): Promise<string> {
  if (typeof study === 'object' && study !== null && study.kind === 'world') {
    return JSON.stringify(encodeGeneratedWorld(await generateWorld({ seed: study.seed, size: study.size })));
  }
  if (study !== 'aster' && study !== 'verdant') throw new Error('Unknown terrain study.');
  const payload = study === 'verdant'
    ? { protocolVersion: ATLAS_PROTOCOL_VERSION, world: createVerdantReach() }
    : { protocolVersion: 1, world: createAsterIsland() };
  if (study === 'verdant') parseAtlasResponse(payload);
  else parseTerrainResponse(payload);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_TERRAIN_BYTES) {
    throw new Error('The terrain response exceeds the 8 MiB transport limit.');
  }
  return body;
}
