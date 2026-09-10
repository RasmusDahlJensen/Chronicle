import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moistureField } from '../src/world/generation/climate.ts';

test('coastal moisture spreads across adjacent latitude rows instead of leaving a single-cell stripe', () => {
  const width = 512, height = 256;
  const elevation = new Int16Array(width * height).fill(100);
  for (let y = 0; y < height; y++) for (let x = 0; x < 6; x++) elevation[y * width + x] = -100;
  const baseline = moistureField(width, height, elevation, 17);
  // A small coastal opening in the westerly belt. The former independent-row
  // model added ~172 moisture points down this row and zero on both neighbors.
  elevation[60 * width + 60] = -100;
  const coastal = moistureField(width, height, elevation, 17);
  const change = (x: number, y: number) => coastal[y * width + x] - baseline[y * width + x];
  for (const x of [70, 80, 100]) {
    assert.ok(change(x, 60) > 20, 'The ocean opening should still moisten its downwind region.');
    assert.ok(change(x, 59) > 10 && change(x, 61) > 10,
      `Crosswind mixing should moisten the neighboring rows too: ${[59, 60, 61].map(y => change(x, y))}`);
    assert.ok(change(x, 55) < 5 && change(x, 65) < 5, 'Mixing must stay regional.');
  }
});
