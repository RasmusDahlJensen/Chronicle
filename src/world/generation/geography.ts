import { clamp, hashNoise, smoothNoise } from './noise.ts';

// Coordinates use the atlas aspect ratio: x spans two units, y one. These are
// shape coordinates, not equal ground distances on the equal-area projection.
interface Lobe {
  x: number; y: number; cosine: number; sine: number; inverseA: number; inverseB: number; bound: number;
}
interface Continent { lobes: Lobe[]; bays: Lobe[] }
interface RangeSegment {
  x: number; y: number; dx: number; dy: number; lengthSquared: number;
  widthSquared: number; startHeight: number; endHeight: number; bound: number;
}
function lobe(x: number, y: number, a: number, b: number, angle: number): Lobe {
  return { x, y, cosine: Math.cos(angle), sine: Math.sin(angle), inverseA: 1 / a, inverseB: 1 / b, bound: Math.max(a, b) * 1.35 };
}
function longitudeDelta(value: number) { return value - Math.round(value / 2) * 2; }
function shapeAt(shape: Lobe, x: number, y: number) {
  const dx = longitudeDelta(x - shape.x), dy = y - shape.y;
  if (Math.abs(dx) > shape.bound || Math.abs(dy) > shape.bound) return -1;
  const along = (dx * shape.cosine + dy * shape.sine) * shape.inverseA;
  const across = (dy * shape.cosine - dx * shape.sine) * shape.inverseB;
  return 1 - Math.sqrt(along * along + across * across);
}

/** A seeded regional shape model: branching continental cores, coastal basins,
 * offshore island chains, and independently located finite mountain belts.
 * It does not simulate plate motion, erosion, drainage, or geological time.
 */
export function generateElevation(width: number, height: number, seed: number): Int16Array {
  const random = (id: number) => hashNoise(id, 1207, seed + 4621);
  const continents: Continent[] = [];
  const islands: Lobe[] = [];
  const ranges: RangeSegment[] = [];
  const placed: { x: number; y: number; radius: number }[] = [];
  const regionCount = 3 + Math.floor(random(1) * 2.999);

  for (let index = 0; index < regionCount; index++) {
    const key = 100 + index * 200;
    // An uneven mass distribution produces a larger primary continent alongside
    // secondary regions; their number, locations and outlines still vary by seed.
    const a = index === 0 ? 0.30 + random(key + 3) * 0.065 : 0.17 + random(key + 3) * 0.10;
    const b = index === 0 ? 0.12 + random(key + 4) * 0.025 : 0.065 + random(key + 4) * 0.045;
    const angle = index === 0 ? (random(key + 2) - 0.5) * 0.85 : random(key + 2) * Math.PI;
    const radius = Math.sqrt(a * b);
    let x = random(0) * 2, y = 0.3 + random(2) * 0.4, best = -1;
    // Pick among seeded candidates using relative region size rather than a
    // fixed longitude row or a repeated northern/southern arrangement.
    for (let candidate = 0; candidate < 48 && placed.length; candidate++) {
      const cx = random(1800 + index * 100 + candidate * 2) * 2;
      const cy = 0.16 + random(1801 + index * 100 + candidate * 2) * 0.68;
      let separation = 10;
      for (const previous of placed) {
        separation = Math.min(separation, Math.hypot(longitudeDelta(cx - previous.x), cy - previous.y) / (radius + previous.radius));
      }
      if (separation > best) { x = cx; y = cy; best = separation; }
    }
    placed.push({ x, y, radius });
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const locate = (along: number, across: number) => ({ x: x + along * cosine - across * sine, y: y + along * sine + across * cosine });
    const lobes: Lobe[] = [];
    const coreCount = 2 + Math.floor(random(key + 5) * 3.999);
    for (let part = 0; part < coreCount; part++) {
      const center = locate((part / (coreCount - 1) - 0.5) * a * 1.25, (random(key + 10 + part) - 0.5) * b * 0.95);
      lobes.push(lobe(center.x, center.y, a * (0.43 + random(key + 16 + part) * 0.24), b * (0.70 + random(key + 22 + part) * 0.65), angle + (random(key + 28 + part) - 0.5) * 0.9));
    }
    // Unequal side branches make peninsulas and leave ocean between their lobes.
    const branchCount = 1 + Math.floor(random(key + 34) * 4.999);
    for (let branch = 0; branch < branchCount; branch++) {
      const side = random(key + 35 + branch) < 0.5 ? -1 : 1;
      const along = (random(key + 41 + branch) - 0.5) * a * 1.9;
      const across = side * b * (0.8 + random(key + 47 + branch) * 0.85);
      const center = locate(along, across);
      lobes.push(lobe(center.x, center.y, 0.045 + random(key + 53 + branch) * 0.060, 0.033 + random(key + 59 + branch) * 0.040, angle + side * (0.35 + random(key + 65 + branch) * 1.8)));
    }
    const bays: Lobe[] = [];
    const bayCount = Math.floor(random(key + 71) * 3.999);
    for (let bay = 0; bay < bayCount; bay++) {
      const side = random(key + 72 + bay) < 0.5 ? -1 : 1;
      const center = locate((random(key + 76 + bay) - 0.5) * a * 1.7, side * b * (0.95 + random(key + 80 + bay) * 0.3));
      bays.push(lobe(center.x, center.y, a * (0.16 + random(key + 84 + bay) * 0.16), b * (0.7 + random(key + 88 + bay) * 0.35), angle + (random(key + 92 + bay) - 0.5) * 1.5));
    }
    continents.push({ lobes, bays });

    const rangeCount = 1 + Math.floor(random(key + 97) * 2.999);
    for (let range = 0; range < rangeCount; range++) {
      const ridgeKey = key + 100 + range * 11;
      const center = locate((random(ridgeKey) - 0.5) * a * 1.1, (random(ridgeKey + 1) - 0.5) * b * 1.2);
      const direction = angle + (random(ridgeKey + 2) - 0.5) * 1.05 + (range === 2 ? 0.9 : 0);
      const length = a * (0.7 + random(ridgeKey + 3) * 0.8);
      const bend = (random(ridgeKey + 4) - 0.5) * b * 1.4;
      const ridgeWidth = 0.014 + random(ridgeKey + 5) * 0.019;
      const peak = 2600 + random(ridgeKey + 6) * 2500;
      const points: { x: number; y: number; height: number }[] = [];
      for (let step = 0; step <= 6; step++) {
        const t = step / 6, along = (t - 0.5) * length;
        const across = Math.sin(t * Math.PI) * bend + Math.sin(t * Math.PI * 2) * ridgeWidth * 0.8;
        points.push({ x: center.x + along * Math.cos(direction) - across * Math.sin(direction),
          y: center.y + along * Math.sin(direction) + across * Math.cos(direction),
          height: peak * Math.sin(t * Math.PI) ** 0.55 });
      }
      for (let point = 1; point < points.length; point++) {
        const previous = points[point - 1], next = points[point];
        const dx = next.x - previous.x, dy = next.y - previous.y;
        ranges.push({ x: previous.x, y: previous.y, dx, dy, lengthSquared: dx * dx + dy * dy,
          widthSquared: ridgeWidth * ridgeWidth, startHeight: previous.height, endHeight: next.height,
          bound: Math.sqrt(dx * dx + dy * dy) + ridgeWidth * 3 });
      }
    }
  }

  // Small oceanic chains have their own scales and directions, without a copy of
  // each continental mountain/climate pattern stamped onto every island.
  const offshoreRegions = 18 + Math.floor(random(2900) * 10);
  for (let chain = 0; chain < offshoreRegions; chain++) {
    const key = 3000 + chain * 30, x = random(key) * 2, y = 0.08 + random(key + 1) * 0.84;
    const angle = random(key + 2) * Math.PI * 2;
    const mode = random(key + 3);
    const count = mode < 0.6 ? 1 : 3 + Math.floor(random(key + 4) * 3);
    for (let island = 0; island < count; island++) {
      const along = mode > 0.85 ? (island - count / 2) * 0.040 : (random(key + 5 + island) - 0.5) * 0.14;
      const across = mode > 0.85 ? Math.sin(island * 1.5) * 0.022 : (random(key + 11 + island) - 0.5) * 0.11;
      const radius = 0.009 + random(key + 17 + island) ** 1.6 * 0.030;
      const ix = x + along * Math.cos(angle) - across * Math.sin(angle), iy = y + along * Math.sin(angle) + across * Math.cos(angle);
      const direction = angle + random(key + 23 + island) * 1.6;
      islands.push(lobe(ix, iy, radius, radius * (0.30 + random(key + 11 + island) * 0.65), direction));
      if (radius > 0.023) islands.push(lobe(ix + radius * Math.cos(direction), iy + radius * Math.sin(direction), radius * 0.65, radius * 0.45, direction + 0.7));
    }
  }
  if (random(2901) > 0.25) islands.push(lobe(random(2902) * 2, random(2903) < 0.5 ? 0.012 : 0.988, 0.11 + random(2904) * 0.12, 0.04, 0));

  const elevation = new Int16Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const u = (column + 0.5) / width, v = (row + 0.5) / height;
    const x = u * 2 + (smoothNoise(u, v, 8, seed + 3) - 0.5) * 0.085 + (smoothNoise(u, v, 24, seed + 10) - 0.5) * 0.04;
    const y = v + (smoothNoise(u, v, 8, seed + 5) - 0.5) * 0.070 + (smoothNoise(u, v, 24, seed + 11) - 0.5) * 0.035;
    let inland = -1;
    for (const continent of continents) {
      let continental = -1;
      for (const core of continent.lobes) continental = Math.max(continental, shapeAt(core, x, y));
      for (const bay of continent.bays) continental = Math.min(continental, -shapeAt(bay, x, y));
      inland = Math.max(inland, continental);
    }
    for (const island of islands) inland = Math.max(inland, shapeAt(island, x, y));
    inland += (smoothNoise(u, v, 16, seed + 7) - 0.5) * 0.27
      + (smoothNoise(u, v, 64, seed + 8) - 0.5) * 0.15
      + (smoothNoise(u, v, 192, seed + 9) - 0.5) * 0.075;
    const id = row * width + column;
    if (inland < 0) {
      elevation[id] = Math.round(-20 - Math.min(1, -inland) * 4700);
      continue;
    }
    let mountain = 0;
    for (const segment of ranges) {
      const dx = longitudeDelta(x - segment.x), dy = y - segment.y;
      if (Math.abs(dx) > segment.bound || Math.abs(dy) > segment.bound) continue;
      const t = clamp((dx * segment.dx + dy * segment.dy) / segment.lengthSquared, 0, 1);
      const distanceSquared = (dx - segment.dx * t) ** 2 + (dy - segment.dy * t) ** 2;
      mountain = Math.max(mountain, Math.exp(-distanceSquared / segment.widthSquared) * (segment.startHeight + (segment.endHeight - segment.startHeight) * t));
    }
    const regionalHeight = smoothNoise(u, v, 12, seed + 21);
    const plain = 20 + inland ** 0.7 * (120 + regionalHeight ** 2 * 520);
    const hills = Math.max(0, regionalHeight - 0.54) * 950 * smoothNoise(u, v, 48, seed + 23);
    const fold = 0.78 + smoothNoise(u, v, 112, seed + 14) * 0.35;
    elevation[id] = Math.round(plain + hills + mountain * fold * clamp(inland * 7, 0, 1));
  }
  gradeCoasts(elevation, width, height);
  return elevation;
}

/** Grade relief toward sea level over the same atlas-space width at either
 * resolution. A narrow detached coastal fragment must not inherit the full
 * height of a continental belt merely because that belt crosses its location.
 * This is a coast-distance constraint on relief, not a drainage simulation.
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
