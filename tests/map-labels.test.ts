import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeLabels } from '../src/renderer/labels.ts';

test('crowded place names never overlap: capitals first, then larger places, the rest left out until the map zooms in', () => {
  const label = (name: string, x: number, y: number, tier: number, capital = false) => ({ name, x, y, tier, capital });
  const width = () => 40;
  const kept = placeLabels([label('Ura', 0, 0, 0), label('Kesh', 10, 4, 1, true), label('Tal', 20, 2, 2), label('Sem', 100, 0, 1)], width);
  assert.deepEqual(kept.map(entry => entry.name), ['Kesh', 'Sem'], 'the capital wins over a larger city beside it; a distant town keeps its name');
  // Spread out (zoomed in), all are shown.
  assert.equal(placeLabels([label('Ura', 0, 0, 0), label('Tal', 0, 30, 2), label('Sem', 100, 0, 1)], width).length, 3);
  // No two kept boxes overlap.
  const many = Array.from({ length: 200 }, (_, at) => label(`P${at}`, (at * 37) % 300, (at * 53) % 200, at % 3, at % 17 === 0));
  const boxes = placeLabels(many, width).map(entry => ({ x1: entry.x - 2, y1: entry.y - 8, x2: entry.x + 42, y2: entry.y + 8 }));
  for (const [at, a] of boxes.entries()) for (const b of boxes.slice(at + 1)) assert.ok(!(a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2));
});
