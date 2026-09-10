import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { generateWorld, type GeneratedWorld } from '../src/world/generation/generate.ts';

/** Measure actual connected terrain, including components crossing the longitude seam. */
function components(world: GeneratedWorld, minimumElevation: number) {
  const { width, height } = world;
  const visited = new Uint8Array(width * height);
  const result: { cells: number[]; points: [number, number][]; width: number; height: number }[] = [];
  for (let first = 0; first < visited.length; first++) {
    if (visited[first] || world.fields.elevation[first] < minimumElevation) continue;
    const cells = [first]; visited[first] = 1;
    const columns = new Set<number>(); let top = height; let bottom = 0;
    for (let at = 0; at < cells.length; at++) {
      const id = cells[at], x = id % width, y = Math.floor(id / width);
      columns.add(x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [y * width + (x + 1) % width, y * width + (x - 1 + width) % width, id - width, id + width]) {
        if (next < 0 || next >= visited.length || visited[next] || world.fields.elevation[next] < minimumElevation) continue;
        visited[next] = 1; cells.push(next);
      }
    }
    if (cells.length < 40) continue;
    const sorted = [...columns].sort((a, b) => a - b);
    let gap = -1, start = 0;
    for (let at = 0; at < sorted.length; at++) {
      const next = sorted[(at + 1) % sorted.length] + (at === sorted.length - 1 ? width : 0);
      if (next - sorted[at] > gap) { gap = next - sorted[at]; start = next % width; }
    }
    result.push({ cells, points: cells.map(id => [(id % width - start + width) % width, Math.floor(id / width)]),
      width: width - gap + 1, height: bottom - top + 1 });
  }
  return result.sort((a, b) => b.cells.length - a.cells.length);
}

function convexArea(points: readonly [number, number][]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (values: typeof sorted) => {
    const hull: [number, number][] = [];
    for (const point of values) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  const hull = [...half(sorted), ...half(sorted.reverse())];
  return Math.abs(hull.reduce((sum, point, index) => {
    const next = hull[(index + 1) % hull.length]; return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

test('the default continents have distinct proportions and substantial coastal embayments', () => {
  const world = generateWorld({ seed: 'Chronicle', size: 'standard' });
  const continents = components(world, 0).filter(component => component.cells.length >= 2500);
  assert.ok(continents.length >= 3, 'The geography needs multiple substantial connected landmasses.');
  const largest = continents.slice(0, 3);
  const aspects = largest.map(component => component.width / component.height);
  assert.ok(aspects.some(aspect => aspect > 1.4), `At least one major continent should spread east–west: ${aspects}`);
  assert.ok(Math.max(...aspects) / Math.min(...aspects) > 1.8, `The major continents should not repeat one proportion: ${aspects}`);
  const missingFromHull = largest.map(component => 1 - component.cells.length / convexArea(component.points));
  assert.ok(missingFromHull.some(fraction => fraction > 0.23), `At least one major coastline needs large bays/peninsulas, not just a noisy oval: ${missingFromHull}`);
});

test('mountain belts include differing orientations instead of repeating a central north–south spine', () => {
  const world = generateWorld({ seed: 'Chronicle', size: 'standard' });
  const belts = components(world, 1800).filter(component => component.cells.length >= 60);
  const aspects = belts.map(component => component.width / component.height);
  assert.ok(aspects.some(aspect => aspect > 1.5), `A substantial mountain belt should run across longitude: ${aspects}`);
  assert.ok(aspects.some(aspect => aspect < 0.85), `The same world should contain another belt orientation: ${aspects}`);
  const land = components(world, 0).flatMap(component => component.cells);
  assert.ok(land.filter(id => world.fields.elevation[id] < 700).length / land.length > 0.45, 'Substantial lowland plains must survive the regional mountain belts.');
});

test('geography is reproducible across several seeds without losing continents, islands or broad plains', () => {
  const hashes = new Set<string>();
  const continentCounts = new Set<number>();
  const primaryMassRatios: number[] = [];
  for (const seed of ['Chronicle', 'Elsewhere', 'Harbors']) {
    const world = generateWorld({ seed, size: 'standard' });
    const same = generateWorld({ seed, size: 'standard' });
    assert.deepEqual(world.fields.elevation, same.fields.elevation, seed);
    const hash = createHash('sha256').update(new Uint8Array(world.fields.elevation.buffer)).digest('hex');
    assert.ok(!hashes.has(hash), 'Different seeds must change the land and relief.'); hashes.add(hash);
    const pieces = components(world, 0);
    const land = pieces.reduce((sum, piece) => sum + piece.cells.length, 0);
    assert.ok(land > world.width * world.height * 0.15 && land < world.width * world.height * 0.65, `${seed}: land area ${land}`);
    const continents = pieces.filter(piece => piece.cells.length >= 2500);
    assert.ok(continents.length >= 2, `${seed}: missing substantial continents`);
    continentCounts.add(continents.length);
    primaryMassRatios.push(continents[0].cells.length / continents[1].cells.length);
    assert.ok(pieces.filter(piece => piece.cells.length < 500).length >= 3, `${seed}: missing distinct smaller islands`);
    assert.ok(pieces.flatMap(piece => piece.cells).filter(id => world.fields.elevation[id] < 700).length / land > 0.45, `${seed}: missing broad lowlands`);
  }
  assert.ok(continentCounts.size > 1, 'Seeds should change the connected continental arrangement, not just the outline of a fixed collection.');
  assert.ok(Math.max(...primaryMassRatios) > 2 && Math.min(...primaryMassRatios) < 1.4,
    `The sampled worlds should include both a dominant continent and more comparable continental masses: ${primaryMassRatios}`);
});
