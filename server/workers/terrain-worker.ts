import { createAsterIsland } from '../../src/fixtures/aster-island.ts';
import { MAX_TERRAIN_BYTES, parseTerrainResponse } from '../../shared/terrain.ts';

/** Generate and encode the existing fixture entirely away from HTTP handling. */
export default function generateTerrain(): string {
  const payload = { protocolVersion: 1, world: createAsterIsland() };
  parseTerrainResponse(payload);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_TERRAIN_BYTES) {
    throw new Error('The terrain response exceeds the 8 MiB transport limit.');
  }
  return body;
}
