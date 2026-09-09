import { isWaterBiome, type AtlasCell, type AtlasProvince, type AtlasWorld, type Biome, type Resource } from '../../shared/atlas.ts';

const WIDTH = 320;
const HEIGHT = 200;

/** Fixed regional geography for the atlas lab, not a user-seeded planet generator. */
export function createVerdantReach(): AtlasWorld {
  const cells: AtlasCell[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const u = (x + 0.5) / WIDTH;
      const v = (y + 0.5) / HEIGHT;
      const western = Math.max(
        coastShape(u, v, 0.245, 0.48, 0.215, 0.395, 0.3),
        coastShape(u, v, 0.388, 0.46, 0.09, 0.135, 1.5),
      ) - peak(u, v, 0.38, 0.65, 0.065, 0.055) * 0.22;
      const eastern = coastShape(u, v, 0.775, 0.48, 0.195, 0.345, 2.1)
        - peak(u, v, 0.655, 0.63, 0.06, 0.05) * 0.19;
      const northern = coastShape(u, v, 0.566, 0.126, 0.098, 0.10, 0.8);
      const islands = Math.max(
        coastShape(u, v, 0.535, 0.705, 0.026, 0.04, 0.2),
        coastShape(u, v, 0.58, 0.77, 0.026, 0.032, 1.8),
        coastShape(u, v, 0.53, 0.842, 0.038, 0.026, 1.2),
        coastShape(u, v, 0.607, 0.889, 0.027, 0.024, 0.4),
        coastShape(u, v, 0.693, 0.89, 0.033, 0.041, 2.5),
        coastShape(u, v, 0.808, 0.905, 0.06, 0.043, 0.7),
      );
      const inland = Math.min(Math.max(western, eastern, northern, islands),
        (Math.min(u, 1 - u) - 0.018) * 12, (Math.min(v, 1 - v) - 0.024) * 12);

      const ridges = peak(u, v, 0.187, 0.23, 0.037, 0.11) * 2_500
        + peak(u, v, 0.225, 0.40, 0.032, 0.12) * 2_900
        + peak(u, v, 0.278, 0.56, 0.04, 0.09) * 2_000
        + peak(u, v, 0.827, 0.315, 0.075, 0.026) * 2_700
        + peak(u, v, 0.851, 0.495, 0.025, 0.11) * 3_200
        + peak(u, v, 0.56, 0.105, 0.055, 0.028) * 1_800
        + peak(u, v, 0.806, 0.903, 0.012, 0.018) * 2_300;
      const folds = 0.56 + noise(u * 29, v * 29) * 0.67 + noise(u * 71, v * 71) * 0.23;
      const elevation = inland <= 0
        ? Math.round(Math.min(-1, inland * 3_300 - 30))
        : Math.round(8 + Math.min(inland, 0.6) * 420
          + ridges * folds * Math.min(1, inland / 0.22));
      const moisture = 0.48 + noise(u * 8 + 31, v * 8 + 8) * 0.32
        + peak(u, v, 0.14, 0.72, 0.09, 0.15) * 0.26
        + peak(u, v, 0.875, 0.675, 0.055, 0.14) * 0.26
        - peak(u, v, 0.732, 0.51, 0.095, 0.17) * 0.68
        - peak(u, v, 0.345, 0.60, 0.075, 0.11) * 0.38;
      const temperature = v * 1.4 - 0.12 - Math.max(0, elevation) / 5_200
        + (noise(u * 13, v * 13) - 0.5) * 0.12;
      const biome = classify(elevation, inland, temperature, moisture, u, v);
      cells.push({ id: y * WIDTH + x, elevation, biome, resource: null, provinceId: null });
    }
  }

  placeResourceSites(cells);
  return {
    fixtureId: 'verdant-reach', fixtureVersion: 2, name: 'The Verdant Reach',
    width: WIDTH, height: HEIGHT, cellAreaKm2: 4, topology: 'bounded', cells,
    provinces: assignProvinces(cells), countries: [],
    annotations: [
      { text: 'ELDERMERE', x: 76, y: 107, kind: 'land' },
      { text: 'VEYRA', x: 246, y: 114, kind: 'land' },
      { text: 'SKELD', x: 181, y: 26, kind: 'land' },
      { text: 'SAFFRON ISLES', x: 183, y: 169, kind: 'land' },
      { text: 'MERIDIAN SEA', x: 174, y: 95, kind: 'water' },
    ],
  };
}

function classify(elevation: number, inland: number, temperature: number, moisture: number, u: number, v: number): Biome {
  if (elevation < 0) return elevation > -210 ? 'coast' : 'ocean';
  if (temperature < -0.02 || elevation > 2_950) return 'snow';
  if (elevation > 1_280) return 'mountain';
  if (temperature < 0.19) return 'tundra';
  if (inland < 0.043 && elevation < 125 && temperature > 0.32) return 'desert';
  // Broad low-lying deltas between the wooded slopes and the sea.
  const delta = peak(u, v, 0.125, 0.72, 0.055, 0.085)
    + peak(u, v, 0.881, 0.683, 0.05, 0.07);
  if (elevation < 220 && moisture > 0.64 && delta > 0.37) return 'wetland';
  if (temperature > 0.48 && moisture < 0.37) return 'desert';
  if (temperature > 0.66 && moisture < 0.59) return 'savanna';
  if (temperature > 0.68 && moisture > 0.66) return 'rainforest';
  if (moisture > 0.58 && elevation < 1_150) return 'forest';
  return 'grassland';
}

/** Reviewable site budgets for this authored study, not production or economy balance. */
const RESOURCE_SITES: { resource: Resource; count: number; biomes: Biome[] }[] = [
  { resource: 'uranium', count: 3, biomes: ['desert', 'mountain', 'snow'] },
  { resource: 'gold', count: 6, biomes: ['rainforest', 'desert', 'mountain', 'snow'] },
  { resource: 'fish', count: 12, biomes: ['coast'] },
  { resource: 'fish', count: 14, biomes: ['ocean'] },
  { resource: 'fish', count: 4, biomes: ['wetland'] },
  { resource: 'iron', count: 28, biomes: ['forest', 'tundra', 'mountain', 'snow'] },
  { resource: 'copper', count: 22, biomes: ['desert', 'savanna', 'mountain'] },
  { resource: 'coal', count: 24, biomes: ['grassland', 'forest', 'mountain'] },
  { resource: 'salt', count: 18, biomes: ['coast', 'desert'] },
  { resource: 'grain', count: 60, biomes: ['grassland', 'savanna', 'wetland'] },
  { resource: 'timber', count: 52, biomes: ['forest', 'rainforest'] },
  { resource: 'game', count: 46, biomes: ['grassland', 'forest', 'rainforest', 'savanna', 'tundra'] },
  { resource: 'stone', count: 40, biomes: ['grassland', 'desert', 'tundra', 'mountain', 'snow'] },
];

/** Only a site's cell receives a resource; ordinary cells retain their biome and no special site. */
function placeResourceSites(cells: AtlasCell[]): void {
  const minimumSpacing = 8;
  const blocked = new Uint8Array(cells.length);
  for (const [index, plan] of RESOURCE_SITES.entries()) {
    // Ranking uses the existing deterministic fixture hash, independent of render order or runtime RNG.
    const candidates = cells.filter(cell => plan.biomes.includes(cell.biome)).map(cell => ({
      id: cell.id,
      rank: value(cell.id % WIDTH + 730 + index * 137, Math.floor(cell.id / WIDTH) + 290),
    }));
    candidates.sort((a, b) => a.rank - b.rank || a.id - b.id);
    let placed = 0;
    for (const { id } of candidates) {
      if (blocked[id]) continue;
      cells[id].resource = plan.resource;
      const x = id % WIDTH;
      const y = Math.floor(id / WIDTH);
      for (let dy = -minimumSpacing + 1; dy < minimumSpacing; dy++) {
        for (let dx = -minimumSpacing + 1; dx < minimumSpacing; dx++) {
          if (dx * dx + dy * dy >= minimumSpacing * minimumSpacing) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) blocked[ny * WIDTH + nx] = 1;
        }
      }
      if (++placed === plan.count) break;
    }
  }
}

/** Competing flood fronts keep each province connected, including on small islands. */
function assignProvinces(cells: AtlasCell[]): AtlasProvince[] {
  const provinces: AtlasProvince[] = [];
  const seen = new Uint8Array(cells.length);
  const distance = new Uint16Array(cells.length);
  distance.fill(65_535);
  for (const cell of cells) {
    if (isWaterBiome(cell.biome) || seen[cell.id]) continue;
    const component = [cell.id];
    seen[cell.id] = 1;
    for (let at = 0; at < component.length; at++) {
      for (const id of neighbors(component[at])) {
        if (!seen[id] && !isWaterBiome(cells[id].biome)) {
          seen[id] = 1;
          component.push(id);
        }
      }
    }
    const count = Math.max(1, Math.round(component.length / 450));
    const centerX = component.reduce((sum, id) => sum + id % WIDTH, 0) / component.length;
    const centerY = component.reduce((sum, id) => sum + Math.floor(id / WIDTH), 0) / component.length;
    const region = centerX < 155 ? 'Eldermere' : centerY < 49 ? 'Skeld'
      : component.length < 1_000 ? 'Saffron' : 'Veyra';
    const seeds: number[] = [];
    let next = component[Math.floor(component.length / 2)];
    for (let seed = 0; seed < count; seed++) {
      seeds.push(next);
      const pending = [next];
      distance[next] = 0;
      for (let at = 0; at < pending.length; at++) {
        const id = pending[at];
        for (const adjacent of neighbors(id)) {
          if (!isWaterBiome(cells[adjacent].biome) && distance[adjacent] > distance[id] + 1) {
            distance[adjacent] = distance[id] + 1;
            pending.push(adjacent);
          }
        }
      }
      next = component.reduce((farthest, id) => distance[id] > distance[farthest] ? id : farthest, component[0]);
    }
    const pending = [...seeds];
    for (const id of seeds) {
      const provinceId = `p${String(provinces.length + 1).padStart(3, '0')}`;
      provinces.push({ id: provinceId, name: `${region} ${provinces.length + 1}`, countryId: null });
      cells[id].provinceId = provinceId;
    }
    for (let at = 0; at < pending.length; at++) {
      const id = pending[at];
      for (const adjacent of neighbors(id)) {
        if (!isWaterBiome(cells[adjacent].biome) && cells[adjacent].provinceId === null) {
          cells[adjacent].provinceId = cells[id].provinceId;
          pending.push(adjacent);
        }
      }
    }
  }
  return provinces;
}

function neighbors(id: number): number[] {
  const result: number[] = [];
  if (id % WIDTH > 0) result.push(id - 1);
  if (id % WIDTH < WIDTH - 1) result.push(id + 1);
  if (id >= WIDTH) result.push(id - WIDTH);
  if (id < WIDTH * (HEIGHT - 1)) result.push(id + WIDTH);
  return result;
}

function coastShape(u: number, v: number, cx: number, cy: number, rx: number, ry: number, phase: number): number {
  const x = (u - cx) / rx;
  const y = (v - cy) / ry;
  const angle = Math.atan2(y, x);
  const shore = 1 + 0.13 * Math.cos(angle * 3 + phase) + 0.072 * Math.sin(angle * 5 + phase)
    + 0.026 * Math.cos(angle * 11 - phase) + 0.016 * Math.sin(angle * 23)
    + (noise(u * 83 + 11, v * 83) - 0.5) * 0.035;
  return shore - Math.hypot(x, y);
}

function peak(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  return Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  return (value(ix, iy) * (1 - tx) + value(ix + 1, iy) * tx) * (1 - ty)
    + (value(ix, iy + 1) * (1 - tx) + value(ix + 1, iy + 1) * tx) * ty;
}

function value(x: number, y: number): number {
  let n = Math.imul(x + 101, 374761393) ^ Math.imul(y + 37, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4_294_967_295;
}
