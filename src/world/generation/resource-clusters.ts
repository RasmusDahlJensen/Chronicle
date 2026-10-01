import { RESOURCE_IDS, type Resource } from '../../../shared/atlas.ts';
import { WORLD_BIOMES, type WorldSettings } from '../../../shared/generated-world.ts';
import { hashNoise } from './noise.ts';

/**
 * Clustered strategic deposits appended by G1. Tin forms a few upland provinces and oil a few lowland basins.
 * Each uses its own seeded streams and only fills land cells without a site, so every earlier site keeps its
 * cell and resource. Distances are in cells, wrapping at the longitude seam.
 */
interface ClusterRule {
  clusters: number; radius: number; spacing: number; minSites: number; maxSites: number; separation: number; stream: number;
}
type ClusteredResource = Extract<Resource, 'tin' | 'oil'>;
const CLUSTERS: Record<ClusteredResource, Record<WorldSettings['size'], ClusterRule>> = {
  // Province radius 4 keeps every tin pair of a province within 8 cells at Large.
  tin: {
    large: { clusters: 3, radius: 4, spacing: 2, minSites: 2, maxSites: 3, separation: 80, stream: 12001 },
    standard: { clusters: 2, radius: 2, spacing: 1.5, minSites: 2, maxSites: 3, separation: 40, stream: 12001 },
  },
  // Basin radius 6 keeps every oil pair of a basin within 12 cells at Large.
  oil: {
    large: { clusters: 5, radius: 6, spacing: 2, minSites: 3, maxSites: 5, separation: 60, stream: 13001 },
    standard: { clusters: 4, radius: 3, spacing: 1.5, minSites: 3, maxSites: 4, separation: 30, stream: 13001 },
  },
};
const TIN_UPLAND_CENTER = 1000, TIN_UPLAND_SITE = 500;
const OIL_LOWLAND_CENTER = 300, OIL_LOWLAND_SITE = 400, OIL_COASTAL_PLAIN = 100;
const OIL_COAST_DISTANCE = { large: 3, standard: 2 } as const;

export interface ClusterFields { elevation: Int16Array; biome: Uint8Array; resource: Uint8Array }

export function placeClusteredSites(fields: ClusterFields, width: number, height: number, size: WorldSettings['size'], seed: number) {
  const { elevation, biome, resource } = fields;
  const kind = (id: number) => WORLD_BIOMES[biome[id]];
  const land = (id: number) => {
    const type = kind(id);
    return elevation[id] >= 0 && type !== 'snow' && type !== 'lake' && type !== 'lakeIce' && type !== 'seaIce' && type !== 'ocean' && type !== 'coast';
  };
  const code = (id: Resource) => RESOURCE_IDS.indexOf(id) + 1;
  let copper = 0;
  for (const value of resource) if (value === code('copper')) copper++;
  // Tin stays below half of copper; a world with fewer than five copper sites has no tin cluster.
  const tinBudget = Math.floor((copper - 1) / 2);
  place('tin', id => land(id) && (kind(id) === 'mountain' || elevation[id] >= TIN_UPLAND_CENTER),
    id => land(id) && elevation[id] >= TIN_UPLAND_SITE, tinBudget);
  const nearSea = marineDistance(biome, width, OIL_COAST_DISTANCE[size]);
  place('oil', id => land(id) && elevation[id] <= OIL_LOWLAND_CENTER
      && (kind(id) === 'desert' || kind(id) === 'steppe' || (elevation[id] <= OIL_COASTAL_PLAIN && nearSea[id] === 1)),
    id => land(id) && elevation[id] <= OIL_LOWLAND_SITE, Number.POSITIVE_INFINITY);

  function distance(a: number, b: number) {
    const ax = a % width, bx = b % width, dy = Math.floor(a / width) - Math.floor(b / width);
    const dx = Math.min(Math.abs(ax - bx), width - Math.abs(ax - bx));
    return Math.hypot(dx, dy);
  }
  function rank(id: number, stream: number) { return hashNoise(id % width, Math.floor(id / width), seed + stream); }
  function place(target: ClusteredResource, center: (id: number) => boolean, site: (id: number) => boolean, budget: number) {
    const rule = CLUSTERS[target][size];
    const candidates: number[] = [];
    for (let id = 0; id < resource.length; id++) if (!resource[id] && center(id) && site(id)) candidates.push(id);
    const order = new Map(candidates.map(id => [id, rank(id, rule.stream)]));
    candidates.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0) || a - b);
    const centers: number[] = [];
    let placed = 0;
    for (const middle of candidates) {
      if (centers.length >= rule.clusters || placed + rule.minSites > budget) break;
      if (resource[middle] || centers.some(other => distance(middle, other) < rule.separation)) continue;
      const options: number[] = [];
      const cx = middle % width, cy = Math.floor(middle / width);
      for (let dy = -rule.radius; dy <= rule.radius; dy++) for (let dx = -rule.radius; dx <= rule.radius; dx++) {
        if (dx * dx + dy * dy > rule.radius * rule.radius || cy + dy < 0 || cy + dy >= height) continue;
        const id = (cy + dy) * width + (cx + dx + width) % width;
        if (id !== middle && !resource[id] && site(id)) options.push(id);
      }
      options.sort((a, b) => rank(a, rule.stream + 1) - rank(b, rule.stream + 1) || a - b);
      const chosen = [middle];
      for (const option of options) {
        if (chosen.length >= Math.min(rule.maxSites, budget - placed)) break;
        if (chosen.every(other => distance(other, option) >= rule.spacing)) chosen.push(option);
      }
      if (chosen.length < rule.minSites) continue;
      for (const id of chosen) resource[id] = code(target);
      placed += chosen.length; centers.push(middle);
    }
  }
}

/** 1 for land within `limit` four-neighbor steps of marine water (ocean, shallow sea or sea ice). */
function marineDistance(biome: Uint8Array, width: number, limit: number) {
  const steps = new Uint8Array(biome.length).fill(255), near = new Uint8Array(biome.length);
  let frontier: number[] = [];
  for (let id = 0; id < biome.length; id++) {
    const type = WORLD_BIOMES[biome[id]];
    if (type === 'ocean' || type === 'coast' || type === 'seaIce') { steps[id] = 0; frontier.push(id); }
  }
  for (let step = 1; step <= limit; step++) {
    const next: number[] = [];
    for (const id of frontier) {
      const x = id % width, row = id - x;
      for (const other of [row + (x + 1) % width, row + (x + width - 1) % width, id >= width ? id - width : -1, id < biome.length - width ? id + width : -1]) {
        if (other < 0 || steps[other] <= step) continue;
        steps[other] = step; near[other] = 1; next.push(other);
      }
    }
    frontier = next;
  }
  return near;
}
