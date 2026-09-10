import { clamp, smoothNoise, wrap } from './noise.ts';

export interface CrustMap { width: number; height: number; values: Float32Array }

/** Platec is an elevation donor on a torus. Open it through an ocean belt,
 * discard that belt, then sample a bounded latitude interval for the atlas.
 * Plate motion remains an artistic approximation rather than spherical geology.
 */
export function createCrustSampler({ width, height, values }: CrustMap) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4 || values.length !== width * height
    || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid tectonic crust map.');
  const rows = new Uint32Array(height), columns = new Uint32Array(width);
  for (let id = 0; id < values.length; id++) if (values[id] >= 1) { rows[Math.floor(id / width)]++; columns[id % width]++; }
  function oceanCut(counts: Uint32Array, radius: number) {
    let best = Infinity, cut = 0;
    for (let at = 0; at < counts.length; at++) {
      let score = 0;
      for (let offset = -radius; offset <= radius; offset++) score += counts[wrap(at + offset, counts.length)];
      if (score < best) { best = score; cut = at; }
    }
    return cut;
  }
  // Open a narrow cut, rather than discarding a broad latitude band containing
  // islands and parts of continents. The later polar transition ends the atlas.
  const trim = Math.max(1, Math.round(height * 0.01));
  const north = oceanCut(rows, trim) + trim;
  const west = oceanCut(columns, Math.max(1, Math.round(width * 0.02)));
  const get = (x: number, y: number) => values[wrap(y, height) * width + wrap(x, width)];
  return (u: number, v: number) => {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('Invalid crust sample coordinate.');
    const x = west + wrap(u, 1) * width - 0.5, y = north + clamp(v, 0, 1) * (height - trim * 2 - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    return (get(ix, iy) * (1 - fx) + get(ix + 1, iy) * fx) * (1 - fy)
      + (get(ix, iy + 1) * (1 - fx) + get(ix + 1, iy + 1) * fx) * fy;
  };
}

/** Fixed geographic frequencies refine either cell resolution without moving
 * continents. Crust thickness is dimensionless; this explicit game-scale mapping
 * converts it to metres before the existing climate and resource rules run.
 */
export function refineTectonicCrust(crust: CrustMap, width: number, height: number, seed: number): Int16Array {
  const sample = createCrustSampler(crust);
  // Coastlines follow occupied donor cells independently of their altitude.
  // Interpolating tall crust alone would fill narrow sea straits at finer zoom.
  const shoreline = createCrustSampler({ ...crust,
    values: Float32Array.from(crust.values, value => value >= 1 ? 1 : 0) });
  const elevation = new Int16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + 0.5) / width, v = (y + 0.5) / height;
    let thickness = sample(u, v);
    thickness += (smoothNoise(u, v, 128, seed + 701) - 0.5) * 0.06
      + (smoothNoise(u, v, 256, seed + 702) - 0.5) * 0.035;
    let metres = thickness < 1 ? -((1 - thickness) ** 1.5) * 5500 : (thickness - 1) ** 1.6 * 650;
    metres = shoreline(u, v) >= 0.5 ? Math.max(0, metres) : Math.min(-1, metres);
    if (metres > 0) metres *= 0.92 + smoothNoise(u, v, 192, seed + 703) * 0.16;
    // The cut edges end in separate polar oceans, never a north–south join.
    const polarBlend = clamp(Math.min(v, 1 - v) / 0.03, 0, 1);
    metres = -2200 + (metres + 2200) * polarBlend ** 2 * (3 - 2 * polarBlend);
    const rounded = Math.round(clamp(metres, -10000, 8800));
    elevation[y * width + x] = metres < 0 ? Math.min(-1, rounded) : rounded;
  }
  gradeCoasts(elevation, width, height);
  return elevation;
}

/** Restrict coastal relief over a fixed geographic width. This also prevents
 * a detached sliver from inheriting the full altitude of an adjacent range.
 */
function gradeCoasts(elevation: Int16Array, width: number, height: number) {
  const limit = Math.max(2, Math.ceil(width * 0.007));
  const distance = new Uint16Array(elevation.length).fill(limit);
  const queue = new Uint32Array(elevation.length);
  let tail = 0;
  for (let id = 0; id < elevation.length; id++) if (elevation[id] < 0) { distance[id] = 0; queue[tail++] = id; }
  for (let head = 0; head < tail; head++) {
    const id = queue[head], nextDistance = distance[id] + 1;
    if (nextDistance >= limit) continue;
    const x = id % width, row = id - x;
    for (const next of [row + (x + 1) % width, row + (x + width - 1) % width, id - width, id + width]) {
      if (next < 0 || next >= width * height || distance[next] <= nextDistance) continue;
      distance[next] = nextDistance; queue[tail++] = next;
    }
  }
  for (let id = 0; id < elevation.length; id++) if (elevation[id] >= 0 && distance[id] < limit) {
    elevation[id] = Math.round(20 + (elevation[id] - 20) * distance[id] / limit);
  }
}
