import { createCivilizationSnapshot } from '../../src/world/civilization.ts';
import { MAX_CIVILIZATION_BYTES, parseCivilizationSnapshot } from '../../shared/civilization.ts';
import { createAsterIsland } from '../../src/fixtures/aster-island.ts';
import { createVerdantReach } from '../../src/fixtures/verdant-reach.ts';
import type { WorldManifest } from '../../shared/generated-world.ts';
import { MAX_TERRAIN_BYTES, parseTerrainResponse } from '../../shared/terrain.ts';
import { ATLAS_PROTOCOL_VERSION, parseAtlasResponse } from '../../shared/atlas.ts';
import type { TerrainStudy } from '../../shared/studies.ts';
import { generateWorld } from '../../src/world/generation/generate.ts';
import { encodeGeneratedWorld } from '../../src/world/generation/encode.ts';

/** Construct, validate, and encode either study away from HTTP handling. */
export default async function generateTerrain(study: TerrainStudy = 'aster'): Promise<string> {
  if (typeof study === 'object' && study !== null && study.kind === 'world') {
    const world = await generateWorld({ seed: study.seed, size: study.size });
    const bundle = encodeGeneratedWorld(world);
    const snapshot = parseCivilizationSnapshot(createCivilizationSnapshot(world), JSON.parse(bundle.manifest) as WorldManifest);
    const civilization = JSON.stringify(snapshot);
    if (Buffer.byteLength(civilization) > MAX_CIVILIZATION_BYTES) throw new Error('Civilization response exceeds its transport limit.');
    return JSON.stringify({ ...bundle, civilization });
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
