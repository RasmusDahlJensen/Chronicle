import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRiverReaches, riverPathCommands, riverAppearance } from '../src/renderer/river-paths.ts';
import type { WorldHydrology } from '../shared/world-hydrology.ts';

function graph(edges: number[][]): WorldHydrology {
  return { drySinks: [], lakes: [], rivers: { cells: edges.map(e => e[0]), next: edges.map(e => e[1]), runoff: edges.map(e => e[2]) } };
}
test('river reaches preserve every edge and meet at the same confluence without changing source data', () => {
  const water = graph([[11, 12, 5000], [12, 22, 8000], [21, 22, 6000], [22, 23, 14000], [23, 24, 15000]]);
  const before = structuredClone(water), reaches = buildRiverReaches(water, 10);
  assert.deepEqual(reaches.map(r => r.cells), [[11, 12, 22], [21, 22], [22, 23, 24]]);
  assert.deepEqual(reaches[0].points.at(-1), reaches[2].points[0]);
  assert.deepEqual(reaches[1].points.at(-1), reaches[2].points[0]);
  assert.deepEqual(water, before);
});
test('rounded bends remain within the routed cell and preserve source and terminal centers', () => {
  const [reach] = buildRiverReaches(graph([[11, 12, 5000], [12, 22, 6000]]), 10);
  const commands = riverPathCommands(reach.points);
  assert.deepEqual(commands, [
    { kind: 'move', x: 1.5, y: 1.5 }, { kind: 'line', x: 2, y: 1.5 },
    { kind: 'curve', cx: 2.5, cy: 1.5, x: 2.5, y: 2 }, { kind: 'line', x: 2.5, y: 2.5 },
  ]);
  for (let t = 0; t <= 1; t += 0.05) {
    const x = (1 - t) ** 2 * 2 + 2 * (1 - t) * t * 2.5 + t ** 2 * 2.5;
    const y = (1 - t) ** 2 * 1.5 + 2 * (1 - t) * t * 1.5 + t ** 2 * 2;
    assert.ok(x >= 2 && x <= 3 && y >= 1 && y <= 2);
  }
});
test('seam reaches unwrap locally and lake outlets remain separate from incoming rivers', () => {
  const water = graph([[18, 19, 9000], [19, 10, 10000], [10, 11, 11000]]);
  water.lakes = [{ id: 1, cells: [11, 12], level: 10, outlet: { cell: 12, next: 13, runoff: 11000 } }];
  const reaches = buildRiverReaches(water, 10);
  assert.deepEqual(reaches.map(r => r.cells), [[18, 19, 10, 11], [12, 13]]);
  assert.deepEqual(reaches[0].points.map(p => p.x), [8.5, 9.5, 10.5, 11.5]);
  assert.ok(reaches[0].maxX - reaches[0].minX <= 3);
});
test('overview gives priority to larger rivers while detail reveals the original small streams', () => {
  assert.equal(riverAppearance(1000, 1, 1).opacity, 0);
  assert.ok(riverAppearance(50000, 1, 1).opacity > 0.5);
  assert.ok(riverAppearance(1000, 8, 8).opacity > 0);
  assert.ok(riverAppearance(50000, 8, 8).width > riverAppearance(1000, 8, 8).width);
  assert.ok(riverAppearance(1000, 8, 8).width < 1);
});
