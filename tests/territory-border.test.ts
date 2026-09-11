import test from 'node:test';
import assert from 'node:assert/strict';
import { territoryEdges } from '../shared/territory.ts';

test('national outline removes internal town edges without claiming gaps', () => {
  assert.equal(territoryEdges([6], 5, 4).length, 4);
  assert.equal(territoryEdges([6, 7, 7], 5, 4).length, 6);
  assert.equal(territoryEdges([6, 8], 5, 4).length, 8, 'separated holdings retain separate outlines');
  const ring = [0, 1, 2, 5, 7, 10, 11, 12];
  assert.equal(territoryEdges(ring, 5, 4).length, 16, 'unclaimed hole retains its inner border');
});
test('national outline connects the longitude seam but never wraps over a pole', () => {
  const edges = territoryEdges([5, 9], 5, 4);
  assert.equal(edges.length, 6);
  assert.ok(!edges.some(edge => edge.x1 === edge.x2 && [0, 5].includes(edge.x1)), 'no false internal seam border');
  assert.equal(territoryEdges([0, 15], 5, 4).length, 8);
  assert.deepEqual(territoryEdges([7, 6], 5, 4), territoryEdges([6, 7], 5, 4));
});
