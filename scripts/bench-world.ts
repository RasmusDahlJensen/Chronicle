import { cpus, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { buildApp } from '../server/app.ts';
import { parseWorldManifest, parseWorldTile } from '../shared/generated-world.ts';

const app = await buildApp({ logger: false });
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
try {
  const before = process.memoryUsage().rss;
  const started = performance.now();
  const response = await app.inject('/api/world?seed=Chronicle&size=large');
  if (response.statusCode !== 200) throw new Error(response.body);
  const generationAndDeliveryMs = performance.now() - started;
  const world = parseWorldManifest(response.json());
  const manifestBytes = Buffer.byteLength(response.body);
  let tileBytes = 0; let largestTileBytes = 0; let slowestTileMs = 0;
  for (let y = 0; y < world.height / world.tileSize; y++) for (let x = 0; x < world.width / world.tileSize; x++) {
    const tileStarted = performance.now();
    const tile = await app.inject(`/api/world/tile?seed=Chronicle&size=large&x=${x}&y=${y}`);
    if (tile.statusCode !== 200) throw new Error(tile.body);
    slowestTileMs = Math.max(slowestTileMs, performance.now() - tileStarted);
    parseWorldTile(tile.json(), world, x, y);
    const bytes = Buffer.byteLength(tile.body);
    tileBytes += bytes; largestTileBytes = Math.max(largestTileBytes, bytes);
  }
  const hit = performance.now();
  await app.inject('/api/world?seed=Chronicle&size=large');
  console.log(JSON.stringify({
    runtime: process.version, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    hostMemoryGiB: +(totalmem() / 1024 ** 3).toFixed(1), worldKey: world.worldKey,
    cells: world.width * world.height, landCells: world.landCells, resourceSites: world.resourceSites,
    generationAndDeliveryMs: +generationAndDeliveryMs.toFixed(1), cachedManifestMs: +(performance.now() - hit).toFixed(1),
    manifestBytes, allDetailTilesBytes: tileBytes, largestTileBytes, slowestTileMs: +slowestTileMs.toFixed(1),
    rssAfterGenerationMiB: +(process.memoryUsage().rss / 1024 ** 2).toFixed(1),
    rssIncreaseMiB: +((process.memoryUsage().rss - before) / 1024 ** 2).toFixed(1),
    eventLoopMaxMs: +(delay.max / 1e6).toFixed(1),
    note: 'One local immutable world; includes validation and diagnostic reads. RSS covers workers. Does not establish simultaneous simulation capacity.',
  }, null, 2));
} finally {
  delay.disable();
  await app.close();
}
