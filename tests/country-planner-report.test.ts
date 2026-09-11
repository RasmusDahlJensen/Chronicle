import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlannerReport } from '../scripts/planning/report.ts';
import { hostile, reportFixture } from './helpers/planner-report.ts';

test('planner report preserves embedded data without executable hostile names', () => {
  const report = reportFixture(), original = structuredClone(report), html = renderPlannerReport(report);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /EXPERIMENT/);
  assert.ok(!html.includes(hostile), 'Untrusted text must not terminate a script or create elements.');
  const payload = html.match(/<script id="study-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(payload, 'The exact measured report must be embedded for offline use.');
  assert.deepEqual(JSON.parse(payload[1]), report);
  assert.deepEqual(report, original);
});
