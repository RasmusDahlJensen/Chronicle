import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { WORLD_BIOMES } from '../../shared/generated-world.ts';
import { cellNeighbors, greatCircleKm, stepKm, type SimulationGeography } from './geography.ts';
import { createRng, seedFromText } from './rng.ts';
import { REGION_TUNING } from './tunables.ts';

/** Bump when the partition or the precomputed region geography changes (part of the world-instance identity). */
export const REGION_PARTITION_VERSION = 1;

export interface RegionEdge { region: number; travelKm: number; riverTier: number }
export interface SeaLink { region: number; km: number }
export interface Region {
  id: number; landmass: number; cells: number[]; areaKm2: number; centroid: number; island: boolean;
  coastal: boolean; openLake: boolean; riverTier: number;
  /** Resource sites assigned to this region: [cell, resource code]. */
  sites: [number, number][];
  /** 0–1 from local relief, mountains and forest cover. */
  defensibility: number;
  neighbors: RegionEdge[]; sea: SeaLink[];
  /** Ranked candidate cells for settlements. */
  settlementSites: number[];
}
export interface RegionPartition {
  regions: Region[];
  /** Region id per cell, −1 for water. */
  regionOf: Int32Array;
  landmasses: { id: number; cells: number; regions: number[] }[];
}

const FISH = RESOURCE_IDS.indexOf('fish') + 1;

/** Derive regions deterministically from the validated geography (VISION.md "Region generation"). */
export function partitionRegions(geography: SimulationGeography): RegionPartition {
  const { cells, land, cellAreaKm2 } = geography;
  const tuning = REGION_TUNING;
  const minCells = Math.ceil(tuning.minAreaKm2 / cellAreaKm2), maxCells = Math.floor(tuning.maxAreaKm2 / cellAreaKm2);
  const near = new Int32Array(4);
  const landmassOf = new Int32Array(cells).fill(-1);
  const landmassCells: number[][] = [];
  for (let start = 0; start < cells; start++) {
    if (!land[start] || landmassOf[start] >= 0) continue;
    const id = landmassCells.length, members = [start];
    landmassOf[start] = id;
    for (let at = 0; at < members.length; at++) for (const next of cellNeighbors(geography, members[at], near)) {
      if (next >= 0 && land[next] && landmassOf[next] < 0) { landmassOf[next] = id; members.push(next); }
    }
    landmassCells.push(members);
  }
  const random = createRng(seedFromText(geography.manifest.worldKey), REGION_PARTITION_VERSION);
  const priority = new Float64Array(cells);
  for (let id = 0; id < cells; id++) {
    if (!land[id]) continue;
    const water = geography.riverRunoff[id] || touchesWater(geography, id, near) ? tuning.waterWeight : 0;
    const weight = 1 + geography.fertility[id] / 100 * tuning.fertilityWeight + water;
    // Efraimidis–Spirakis key: ascending −ln(u)/w draws a weighted random order.
    priority[id] = -Math.log(1 - random.next()) / weight;
  }
  const cost = new Float64Array(cells);
  for (let id = 0; id < cells; id++) cost[id] = land[id] ? tuning.terrainCost[WORLD_BIOMES[geography.biome[id]]] : 0;
  const regionOf = new Int32Array(cells).fill(-1);
  let regionCount = 0;
  const spacingKm = Math.sqrt(tuning.targetAreaKm2) * tuning.seedSpacing;
  for (const members of landmassCells) {
    if (members.length <= maxCells) {
      for (const id of members) regionOf[id] = regionCount;
      regionCount++;
      continue;
    }
    const seeds = poissonSeeds(geography, members, priority, spacingKm);
    regionCount = grow(geography, members, seeds, regionOf, regionCount, cost, maxCells, priority);
  }
  regionCount = repairSizes(geography, landmassCells, regionOf, regionCount, minCells, maxCells);
  const ordered = renumber(geography, regionOf, regionCount);
  return describe(geography, ordered, landmassOf, landmassCells, minCells);
}

function touchesWater(geography: SimulationGeography, id: number, near: Int32Array) {
  for (const next of cellNeighbors(geography, id, near)) if (next >= 0 && geography.lake[next] && geography.openLake[geography.lake[next]]) return true;
  return false;
}

/** Weighted Poisson-disk sampling over one landmass: try cells in priority order, keep those ≥ spacing from every kept seed. */
function poissonSeeds(geography: SimulationGeography, members: number[], priority: Float64Array, spacingKm: number) {
  const order = members.slice().sort((a, b) => priority[a] - priority[b] || a - b);
  const bucket = 16, columns = Math.ceil(geography.width / bucket), rows = Math.ceil(geography.height / bucket);
  const grid = new Map<number, number[]>();
  const seeds: number[] = [];
  const reachRows = Math.ceil(spacingKm / Math.min(...geography.northSouthKm.subarray(0, geography.height - 1)) / bucket) + 1;
  for (const id of order) {
    const x = id % geography.width, y = Math.floor(id / geography.width);
    const bx = Math.floor(x / bucket), by = Math.floor(y / bucket);
    // Use the narrowest east–west step among the rows in reach: toward a pole a neighbour's row is narrower than ours.
    const poleward = y < geography.height / 2 ? Math.max(0, y - reachRows * bucket) : Math.min(geography.height - 1, y + reachRows * bucket);
    const reachColumns = Math.min(columns, Math.ceil(spacingKm / Math.max(1e-6, Math.min(geography.eastWestKm[y], geography.eastWestKm[poleward])) / bucket) + 1);
    let free = true;
    for (let dy = -reachRows; dy <= reachRows && free; dy++) {
      const row = by + dy;
      if (row < 0 || row >= rows) continue;
      for (let dx = -reachColumns; dx <= reachColumns && free; dx++) {
        const list = grid.get(row * columns + ((bx + dx) % columns + columns) % columns);
        if (list) for (const other of list) if (greatCircleKm(geography, id, other) < spacingKm) { free = false; break; }
      }
    }
    if (!free) continue;
    seeds.push(id);
    const key = by * columns + bx;
    const list = grid.get(key);
    if (list) list.push(id); else grid.set(key, [id]);
  }
  return seeds;
}

/** Capped multi-source Dijkstra on movement cost; leftover pockets get their own seeds until every cell is claimed. */
function grow(geography: SimulationGeography, members: number[], seeds: number[], regionOf: Int32Array, first: number,
  cost: Float64Array, maxCells: number, priority: Float64Array) {
  const near = new Int32Array(4);
  const distance = new Map<number, number>();
  const sizes: number[] = [];
  let next = first;
  const heap = new MinHeap();
  const start = (cell: number) => {
    const region = next++; sizes[region - first] = 0;
    distance.set(cell, 0); heap.push(0, cell, region);
  };
  for (const seed of seeds) start(seed);
  const unclaimed = () => members.filter(id => regionOf[id] < 0);
  for (;;) {
    while (heap.size) {
      const [d, cell, region] = heap.pop();
      if (regionOf[cell] >= 0 || d > (distance.get(cell) ?? Number.POSITIVE_INFINITY)) continue;
      if (sizes[region - first] >= maxCells) continue;
      regionOf[cell] = region; sizes[region - first]++;
      for (const other of cellNeighbors(geography, cell, near)) {
        if (other < 0 || !geography.land[other] || regionOf[other] >= 0) continue;
        const step = stepKm(geography, cell, other) * (cost[cell] + cost[other]) / 2;
        const total = d + step;
        if (total < (distance.get(other) ?? Number.POSITIVE_INFINITY)) { distance.set(other, total); heap.push(total, other, region); }
      }
    }
    const left = unclaimed();
    if (!left.length) return next;
    // A pocket enclosed by full regions: seed it at its most attractive cell and grow only through unclaimed land.
    let best = left[0];
    for (const id of left) if (priority[id] < priority[best]) best = id;
    distance.clear();
    for (const id of left) distance.delete(id);
    start(best);
  }
}

/**
 * Bring every region of a landmass larger than one region into range. An undersized region merges into a neighbour
 * when the result fits; otherwise it takes border cells from neighbours that stay in range and connected; only if
 * neither works does it merge and split the result in two.
 */
function repairSizes(geography: SimulationGeography, landmassCells: number[][], regionOf: Int32Array, count: number,
  minCells: number, maxCells: number) {
  const near = new Int32Array(4);
  const members = new Map<number, number[]>();
  const landmassSize = new Map<number, number>();
  for (const landmass of landmassCells) for (const id of landmass) {
    const region = regionOf[id];
    const list = members.get(region);
    if (list) list.push(id); else members.set(region, [id]);
    landmassSize.set(region, landmass.length);
  }
  let next = count;
  const size = (region: number) => members.get(region)?.length ?? 0;
  for (let guard = 0; guard < count * 4; guard++) {
    // Smallest undersized region first; ties by id for determinism.
    let small = -1;
    for (const [region, list] of members) {
      if (list.length >= minCells || (landmassSize.get(region) ?? 0) <= maxCells) continue;
      if (small < 0 || list.length < size(small) || (list.length === size(small) && region < small)) small = region;
    }
    if (small < 0) break;
    const cells = members.get(small) ?? [];
    const border = new Map<number, number>();
    for (const id of cells) for (const other of cellNeighbors(geography, id, near)) {
      if (other >= 0 && regionOf[other] >= 0 && regionOf[other] !== small) border.set(regionOf[other], (border.get(regionOf[other]) ?? 0) + 1);
    }
    if (!border.size) throw new Error('A region below the minimum area has no land neighbour.');
    const fitting = [...border].filter(([other]) => size(other) + cells.length <= maxCells)
      .sort(([a, edgeA], [b, edgeB]) => edgeB - edgeA || size(a) - size(b) || a - b);
    if (fitting.length) {
      const target = fitting[0][0];
      for (const id of cells) regionOf[id] = target;
      members.set(target, [...(members.get(target) ?? []), ...cells]);
      members.delete(small);
      continue;
    }
    if (steal(geography, small, cells, members, regionOf, minCells)) continue;
    // Last resort: merge into the smallest neighbour and split the result along graph distance from its two ends.
    const target = [...border].sort(([a], [b]) => size(a) - size(b) || a - b)[0][0];
    const merged = [...(members.get(target) ?? []), ...cells];
    const [first, second] = splitInTwo(geography, merged);
    for (const id of first) regionOf[id] = target;
    for (const id of second) regionOf[id] = next;
    members.delete(small); members.set(target, first); members.set(next, second);
    landmassSize.set(next, landmassSize.get(target) ?? 0);
    next++;
  }
  return next;
}

/** Grow the region to the minimum by taking adjacent cells from neighbours that stay at or above it and connected. */
function steal(geography: SimulationGeography, region: number, cells: number[], members: Map<number, number[]>, regionOf: Int32Array, minCells: number) {
  const near = new Int32Array(4), around = new Int32Array(4);
  while (cells.length < minCells) {
    let best = -1, bestDonor = -1;
    for (const id of cells) for (const other of cellNeighbors(geography, id, near)) {
      const donor = other >= 0 ? regionOf[other] : -1;
      if (donor < 0 || donor === region) continue;
      const donorCells = members.get(donor) ?? [];
      if (donorCells.length <= minCells) continue;
      const better = best < 0 || donorCells.length > (members.get(bestDonor)?.length ?? 0)
        || (donorCells.length === (members.get(bestDonor)?.length ?? 0) && other < best);
      if (better && stillConnected(geography, donorCells, other, around)) { best = other; bestDonor = donor; }
    }
    if (best < 0) return false;
    members.set(bestDonor, (members.get(bestDonor) ?? []).filter(id => id !== best));
    regionOf[best] = region; cells.push(best);
  }
  members.set(region, cells);
  return true;
}

function stillConnected(geography: SimulationGeography, cells: number[], removed: number, near: Int32Array) {
  const inside = new Set(cells); inside.delete(removed);
  const start = cells.find(id => id !== removed);
  if (start === undefined) return false;
  const seen = new Set([start]), queue = [start];
  for (let at = 0; at < queue.length; at++) for (const other of cellNeighbors(geography, queue[at], near)) {
    if (other >= 0 && inside.has(other) && !seen.has(other)) { seen.add(other); queue.push(other); }
  }
  return seen.size === inside.size;
}

/** Split a connected region between its two most distant cells by graph distance (ties to the first), keeping both parts connected. */
function splitInTwo(geography: SimulationGeography, members: number[]): [number[], number[]] {
  const near = new Int32Array(4);
  const inside = new Set(members);
  const distances = (from: number) => {
    const seen = new Map([[from, 0]]), queue = [from];
    for (let at = 0; at < queue.length; at++) for (const other of cellNeighbors(geography, queue[at], near)) {
      if (other >= 0 && inside.has(other) && !seen.has(other)) { seen.set(other, (seen.get(queue[at]) ?? 0) + 1); queue.push(other); }
    }
    return { seen, last: queue[queue.length - 1] };
  };
  const a = distances(members.reduce((low, id) => Math.min(low, id))).last, fromA = distances(a);
  const b = fromA.last, fromB = distances(b);
  const first: number[] = [], second: number[] = [];
  for (const id of members) ((fromA.seen.get(id) ?? 0) <= (fromB.seen.get(id) ?? 0) ? first : second).push(id);
  return [first, second];
}

/** Number regions in order of their first cell, so ids follow the map and do not depend on repair order. */
function renumber(geography: SimulationGeography, regionOf: Int32Array, count: number) {
  const mapping = new Int32Array(count).fill(-1);
  let next = 0;
  for (let id = 0; id < geography.cells; id++) {
    const region = regionOf[id];
    if (region < 0) continue;
    if (mapping[region] < 0) mapping[region] = next++;
    regionOf[id] = mapping[region];
  }
  return { regionOf, count: next };
}

function describe(geography: SimulationGeography, partition: { regionOf: Int32Array; count: number }, landmassOf: Int32Array,
  landmassCells: number[][], minCells: number): RegionPartition {
  const { regionOf, count } = partition;
  const tuning = REGION_TUNING;
  const near = new Int32Array(4);
  const members: number[][] = Array.from({ length: count }, () => []);
  for (let id = 0; id < geography.cells; id++) if (regionOf[id] >= 0) members[regionOf[id]].push(id);
  const tierOf = (runoff: number) => runoff >= tuning.riverTierRunoff.greatRiver ? 3 : runoff >= tuning.riverTierRunoff.river ? 2 : runoff >= tuning.riverTierRunoff.stream ? 1 : 0;
  const regions: Region[] = members.map((cells, id) => {
    let coastal = false, openLake = false, riverTier = 0, relief = 0, rough = 0;
    let sx = 0, sy = 0, sz = 0;
    for (const cell of cells) {
      const phi = geography.latitude[Math.floor(cell / geography.width)], lambda = (cell % geography.width) / geography.width * 2 * Math.PI;
      sx += Math.cos(phi) * Math.cos(lambda); sy += Math.cos(phi) * Math.sin(lambda); sz += Math.sin(phi);
      riverTier = Math.max(riverTier, tierOf(geography.riverRunoff[cell]));
      const type = WORLD_BIOMES[geography.biome[cell]];
      if (type === 'mountain' || type === 'snow') rough += tuning.defensibility.mountainCover;
      else if (type === 'forest' || type === 'rainforest' || type === 'boreal' || type === 'wetland') rough += tuning.defensibility.forestCover;
      for (const other of cellNeighbors(geography, cell, near)) {
        if (other < 0) continue;
        if (geography.marine[other]) coastal = true;
        if (geography.lake[other] && geography.openLake[geography.lake[other]]) openLake = true;
        if (geography.land[other]) relief += Math.abs(geography.elevation[other] - geography.elevation[cell]);
      }
    }
    // The cell nearest the mean direction on the sphere.
    let centroid = cells[0], best = Number.NEGATIVE_INFINITY;
    for (const cell of cells) {
      const phi = geography.latitude[Math.floor(cell / geography.width)], lambda = (cell % geography.width) / geography.width * 2 * Math.PI;
      const dot = Math.cos(phi) * Math.cos(lambda) * sx + Math.cos(phi) * Math.sin(lambda) * sy + Math.sin(phi) * sz;
      if (dot > best) { best = dot; centroid = cell; }
    }
    const meanRelief = relief / (cells.length * 4);
    const weights = tuning.defensibility;
    const defensibility = Math.min(1, meanRelief / weights.reliefScaleM * weights.relief + rough / cells.length * weights.cover);
    const landmass = landmassOf[cells[0]];
    return {
      id, landmass, cells, areaKm2: cells.length * geography.cellAreaKm2, centroid,
      island: landmassCells[landmass].length < minCells,
      coastal, openLake, riverTier, sites: [], defensibility, neighbors: [], sea: [], settlementSites: [],
    };
  });
  // Land sites belong to their region; fish sites within reach of a coast or lakeshore go to the nearest region.
  const fishOwner = nearestRegionWithin(geography, regionOf, tuning.fishReachCells);
  for (let cell = 0; cell < geography.cells; cell++) {
    const code = geography.resource[cell];
    if (!code) continue;
    if (regionOf[cell] >= 0) regions[regionOf[cell]].sites.push([cell, code]);
    else if (code === FISH && fishOwner[cell] >= 0) regions[fishOwner[cell]].sites.push([cell, code]);
  }
  // Land neighbours: shared four-neighbour borders, travel cost between centroids, largest river tier along the border.
  for (const region of regions) {
    const edges = new Map<number, number>();
    for (const cell of region.cells) for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0 || regionOf[other] < 0 || regionOf[other] === region.id) continue;
      const tier = Math.max(tierOf(geography.riverRunoff[cell]), tierOf(geography.riverRunoff[other]));
      edges.set(regionOf[other], Math.max(edges.get(regionOf[other]) ?? 0, tier));
    }
    region.neighbors = [...edges].sort(([a], [b]) => a - b).map(([other, riverTier]) => ({
      region: other, riverTier,
      travelKm: greatCircleKm(geography, region.centroid, regions[other].centroid) * (meanCost(geography, region) + meanCost(geography, regions[other])) / 2,
    }));
  }
  for (const link of seaLinks(geography, regionOf, tuning.seaCrossingKm)) {
    regions[link.a].sea.push({ region: link.b, km: link.km });
    regions[link.b].sea.push({ region: link.a, km: link.km });
  }
  for (const region of regions) region.sea.sort((a, b) => a.region - b.region);
  for (const region of regions) region.settlementSites = settlementSites(geography, region, tierOf);
  const landmasses = landmassCells.map((cells, id) => ({ id, cells: cells.length, regions: [] as number[] }));
  for (const region of regions) landmasses[region.landmass].regions.push(region.id);
  return { regions, regionOf, landmasses };
}

function meanCost(geography: SimulationGeography, region: Region) {
  let total = 0;
  for (const cell of region.cells) total += REGION_TUNING.terrainCost[WORLD_BIOMES[geography.biome[cell]]];
  return total / region.cells.length;
}

/** Breadth-first search over water from every land cell, limited to `reach` steps; ties go to the lowest region id. */
function nearestRegionWithin(geography: SimulationGeography, regionOf: Int32Array, reach: number) {
  const owner = new Int32Array(geography.cells).fill(-1), steps = new Int32Array(geography.cells).fill(-1);
  const near = new Int32Array(4);
  let frontier: number[] = [];
  for (let cell = 0; cell < geography.cells; cell++) if (regionOf[cell] >= 0) { owner[cell] = regionOf[cell]; steps[cell] = 0; frontier.push(cell); }
  for (let step = 1; step <= reach; step++) {
    const next: number[] = [];
    for (const cell of frontier) for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0 || geography.land[other]) continue;
      if (steps[other] < 0) { steps[other] = step; owner[other] = owner[cell]; next.push(other); }
      else if (steps[other] === step && owner[cell] < owner[other]) owner[other] = owner[cell];
    }
    frontier = next;
  }
  for (let cell = 0; cell < geography.cells; cell++) if (geography.land[cell]) owner[cell] = -1;
  return owner;
}

/** Sea crossings: a water Voronoi diagram grown from every coastal region; touching cells give the crossing distance. */
function seaLinks(geography: SimulationGeography, regionOf: Int32Array, limitKm: number) {
  const owner = new Int32Array(geography.cells).fill(-1), distance = new Float64Array(geography.cells).fill(Number.POSITIVE_INFINITY);
  const near = new Int32Array(4);
  const heap = new MinHeap();
  for (let cell = 0; cell < geography.cells; cell++) {
    if (regionOf[cell] < 0) continue;
    for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0 || !geography.marine[other]) continue;
      const d = stepKm(geography, cell, other) / 2;
      if (d < distance[other] || (d === distance[other] && regionOf[cell] < owner[other])) { distance[other] = d; owner[other] = regionOf[cell]; heap.push(d, other, regionOf[cell]); }
    }
  }
  while (heap.size) {
    const [d, cell, region] = heap.pop();
    if (d > distance[cell] || owner[cell] !== region || d > limitKm / 2) continue;
    for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0 || !geography.marine[other]) continue;
      const total = d + stepKm(geography, cell, other);
      if (total < distance[other] || (total === distance[other] && region < owner[other])) { distance[other] = total; owner[other] = region; heap.push(total, other, region); }
    }
  }
  const best = new Map<string, { a: number; b: number; km: number }>();
  for (let cell = 0; cell < geography.cells; cell++) {
    if (owner[cell] < 0) continue;
    for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0 || owner[other] < 0 || owner[other] === owner[cell]) continue;
      const a = Math.min(owner[cell], owner[other]), b = Math.max(owner[cell], owner[other]);
      const km = distance[cell] + distance[other] + stepKm(geography, cell, other);
      if (km > limitKm) continue;
      const key = `${a}:${b}`, current = best.get(key);
      if (!current || km < current.km) best.set(key, { a, b, km });
    }
  }
  return [...best.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

/** Whether a cell is on or next to a mapped river, a lake, the coast or a resource site: where settlements sit
 *  (VISION.md M3b). One rule for ranking sites, for founding further settlements and for the acceptance measure. */
export function nearWater(geography: Pick<SimulationGeography, 'width' | 'cells' | 'riverRunoff' | 'resource' | 'marine' | 'lake'>, cell: number) {
  if (geography.riverRunoff[cell] > 0 || geography.resource[cell] > 0) return true;
  const near = new Int32Array(4);
  for (const other of cellNeighbors(geography, cell, near)) {
    if (other >= 0 && (geography.marine[other] || geography.lake[other] || geography.riverRunoff[other] > 0 || geography.resource[other] > 0)) return true;
  }
  return false;
}

function settlementSites(geography: SimulationGeography, region: Region, tierOf: (runoff: number) => number) {
  const near = new Int32Array(4);
  const scored = region.cells.map(cell => {
    let score = geography.fertility[cell] / 100;
    let upstream = 0, mouth = false, coast = false, lakeshore = false, relief = 0;
    // On or next to a river, lake, coast or resource site.
    const water = nearWater(geography, cell);
    for (const other of cellNeighbors(geography, cell, near)) {
      if (other < 0) continue;
      if (geography.marine[other]) coast = true;
      if (geography.lake[other] && geography.openLake[geography.lake[other]]) lakeshore = true;
      if (geography.riverRunoff[other] && geography.riverRunoff[other] < geography.riverRunoff[cell]) upstream++;
      if (geography.riverRunoff[cell] && geography.marine[other]) mouth = true;
      relief = Math.max(relief, Math.abs(geography.elevation[other] - geography.elevation[cell]));
    }
    const tier = tierOf(geography.riverRunoff[cell]);
    const weights = REGION_TUNING.siteScore;
    score += tier * weights.riverTier + (mouth ? weights.mouth : 0) + (upstream >= 2 ? weights.confluence : 0)
      + (coast ? weights.coast : 0) + (lakeshore ? weights.lakeshore : 0) + (geography.resource[cell] ? weights.resource : 0);
    score += Math.min(weights.reliefCap, relief / weights.reliefScaleM) + (water ? weights.water : 0);
    return { cell, score };
  });
  scored.sort((a, b) => b.score - a.score || a.cell - b.cell);
  return scored.slice(0, REGION_TUNING.settlementSites).map(entry => entry.cell);
}

/** Binary min-heap of (key, cell, tag) with deterministic tie breaking by cell, then tag. */
class MinHeap {
  private keys: number[] = []; private cells: number[] = []; private tags: number[] = [];
  get size() { return this.keys.length; }
  private less(a: number, b: number) {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && (this.cells[a] < this.cells[b] || (this.cells[a] === this.cells[b] && this.tags[a] < this.tags[b])));
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.tags[a], this.tags[b]] = [this.tags[b], this.tags[a]];
  }
  push(key: number, cell: number, tag: number) {
    this.keys.push(key); this.cells.push(cell); this.tags.push(tag);
    let at = this.keys.length - 1;
    while (at > 0) { const parent = (at - 1) >> 1; if (!this.less(at, parent)) break; this.swap(at, parent); at = parent; }
  }
  pop(): [number, number, number] {
    const result: [number, number, number] = [this.keys[0], this.cells[0], this.tags[0]];
    const last = this.keys.length - 1;
    this.swap(0, last); this.keys.pop(); this.cells.pop(); this.tags.pop();
    let at = 0;
    for (;;) {
      const left = at * 2 + 1, right = left + 1;
      let smallest = at;
      if (left < this.keys.length && this.less(left, smallest)) smallest = left;
      if (right < this.keys.length && this.less(right, smallest)) smallest = right;
      if (smallest === at) break;
      this.swap(at, smallest); at = smallest;
    }
    return result;
  }
}

/** Partition summary for the study and the brief: counts, the area range check and water features. */
export function partitionStats(geography: SimulationGeography, partition: RegionPartition) {
  const tuning = REGION_TUNING;
  const regions = partition.regions, nonIsland = regions.filter(region => !region.island);
  const areas = nonIsland.map(region => region.areaKm2).sort((a, b) => a - b);
  const quantile = (fraction: number) => Math.round(areas[Math.floor(fraction * (areas.length - 1))] ?? 0);
  let hash = 0x811c9dc5;
  for (const value of partition.regionOf) hash = Math.imul(hash ^ (value + 1), 16777619);
  return {
    regions: regions.length, islands: regions.length - nonIsland.length, landmasses: partition.landmasses.length,
    outsideRange: nonIsland.filter(region => region.areaKm2 < tuning.minAreaKm2 || region.areaKm2 > tuning.maxAreaKm2).length,
    areaP5: quantile(0.05), areaP50: quantile(0.5), areaP95: quantile(0.95),
    coastal: regions.filter(region => region.coastal).length, river: regions.filter(region => region.riverTier >= 2).length,
    greatRiver: regions.filter(region => region.riverTier >= 3).length, openLake: regions.filter(region => region.openLake).length,
    landCells: geography.land.reduce((sum, value) => sum + value, 0), digest: hash >>> 0,
  };
}
