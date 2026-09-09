import { createAsterIsland } from '../../src/fixtures/aster-island.ts';
import { createVerdantReach } from '../../src/fixtures/verdant-reach.ts';
import { MAX_TERRAIN_BYTES, parseTerrainResponse } from '../../shared/terrain.ts';
import { parseAtlasResponse } from '../../shared/atlas.ts';
import type { TerrainStudy } from '../../shared/studies.ts';

/** Construct, validate, and encode either study away from HTTP handling. */
export default function generateTerrain(study: TerrainStudy = 'aster'): string {
  if (study !== 'aster' && study !== 'verdant') throw new Error('Unknown terrain study.');
  const payload = study === 'verdant'
    ? { protocolVersion: 2, world: createVerdantReach() }
    : { protocolVersion: 1, world: createAsterIsland() };
  if (study === 'verdant') parseAtlasResponse(payload);
  else parseTerrainResponse(payload);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_TERRAIN_BYTES) {
    throw new Error('The terrain response exceeds the 8 MiB transport limit.');
  }
  return body;
}
