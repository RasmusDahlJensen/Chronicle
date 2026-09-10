import {
  WORLD_PROTOCOL_VERSION, WORLD_GENERATOR_VERSION, WORLD_TILE_SIZE, WORLD_AREA_KM2, WORLD_BIOMES,
  MAX_WORLD_MANIFEST_BYTES, MAX_WORLD_TILE_BYTES, MAX_WORLD_BUNDLE_BYTES,
  worldKey, parseWorldManifest, parseWorldTile, type WorldFields, type WorldManifest, type WorldTile, type WorldBundle,
} from '../../../shared/generated-world.ts';
import type { GeneratedWorld } from './generate.ts';

/** Produce bounded, independently verifiable geographic sections in the generation worker. */
export function encodeGeneratedWorld(world: GeneratedWorld): WorldBundle {
  function section(startX: number, startY: number, width: number, height: number, step = 1): WorldFields {
    const fields: WorldFields = { elevation: [], temperature: [], moisture: [], biome: [], resource: [] };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const id = (startY + y * step + Math.floor(step / 2)) * world.width + startX + x * step + Math.floor(step / 2);
      for (const field of Object.keys(fields) as (keyof WorldFields)[]) fields[field].push(world.fields[field][id]);
    }
    return fields;
  }
  const biomeCounts = new Array<number>(WORLD_BIOMES.length).fill(0);
  let landCells = 0; let resourceSites = 0;
  for (let id = 0; id < world.fields.biome.length; id++) {
    biomeCounts[world.fields.biome[id]]++;
    if (world.fields.elevation[id] >= 0) landCells++;
    if (world.fields.resource[id]) resourceSites++;
  }
  const manifest: WorldManifest = {
    protocolVersion: WORLD_PROTOCOL_VERSION, generatorVersion: WORLD_GENERATOR_VERSION, worldKey: worldKey(world.settings),
    settings: world.settings, width: world.width, height: world.height, tileSize: WORLD_TILE_SIZE,
    topology: 'wrap-x', projection: 'cylindrical-equal-area', areaKm2: WORLD_AREA_KM2,
    landCells, resourceSites, biomeCounts,
    overview: { width: 256, height: 128, fields: section(0, 0, 256, 128, world.width / 256) },
  };
  parseWorldManifest(manifest);
  const manifestBody = JSON.stringify(manifest);
  const encoder = new TextEncoder();
  if (encoder.encode(manifestBody).byteLength > MAX_WORLD_MANIFEST_BYTES) throw new Error('World overview exceeds its transport limit.');
  const tiles: string[] = [];
  for (let y = 0; y < world.height / WORLD_TILE_SIZE; y++) for (let x = 0; x < world.width / WORLD_TILE_SIZE; x++) {
    const tile: WorldTile = { protocolVersion: WORLD_PROTOCOL_VERSION, worldKey: manifest.worldKey, x, y,
      width: WORLD_TILE_SIZE, height: WORLD_TILE_SIZE, fields: section(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE, WORLD_TILE_SIZE, WORLD_TILE_SIZE) };
    parseWorldTile(tile, manifest, x, y);
    const body = JSON.stringify(tile);
    if (encoder.encode(body).byteLength > MAX_WORLD_TILE_BYTES) throw new Error('World tile exceeds its transport limit.');
    tiles.push(body);
  }
  const bundle = { manifest: manifestBody, tiles };
  if (encoder.encode(JSON.stringify(bundle)).byteLength > MAX_WORLD_BUNDLE_BYTES) throw new Error('Generated world exceeds its host cache limit.');
  return bundle;
}
