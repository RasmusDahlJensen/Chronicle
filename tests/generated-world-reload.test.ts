import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorldManifest } from '../shared/generated-world.ts';
import { createTestProject, startProject } from './helpers/project.ts';

test('editing nested climate code invalidates cached world generation through the same running proxy', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const endpoint = `${app.origin}/api/world?seed=Reload&size=standard`;
  const initialResponse = await fetch(endpoint, { signal: AbortSignal.timeout(25000) });
  assert.equal(initialResponse.status, 200);
  const initial = parseWorldManifest(await initialResponse.json());
  const path = 'src/world/generation/climate.ts';
  const source = await project.read(path);
  const revised = source.replace('return 31 - 62', 'return 21 - 62');
  assert.notEqual(revised, source, 'Locate the annual temperature baseline in the copied module.');
  const offset = app.output().length;
  await project.write(path, revised);
  await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, offset);
  const updatedResponse = await fetch(endpoint, { signal: AbortSignal.timeout(25000) });
  assert.equal(updatedResponse.status, 200);
  const updated = parseWorldManifest(await updatedResponse.json());
  assert.equal(updated.worldKey, initial.worldKey);
  assert.deepEqual(updated.overview.fields.elevation, initial.overview.fields.elevation);
  for (let at = 0; at < updated.overview.fields.temperature.length; at++) {
    assert.equal(updated.overview.fields.temperature[at], initial.overview.fields.temperature[at] - 100);
  }
  assert.notDeepEqual(updated.biomeCounts, initial.biomeCounts);
  assert.notDeepEqual(updated.overview.fields.fertility, initial.overview.fields.fertility,
    'Climate edits must rebuild derived growing potential through the actual worker and proxy.');
});

test('editing only the vendored runtime rebuilds cached terrain through the same running proxy', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const endpoint = `${app.origin}/api/world?seed=Vendor%20reload&size=standard`;
  async function world() {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200, app.output());
    return parseWorldManifest(await response.json());
  }
  const initial = await world();
  assert.equal((await world()).surface.data, initial.surface.data, 'The initial world is stable before the source edit.');

  const path = 'vendor/platec/runtime.ts';
  const source = await project.read(path);
  // Change actual generated crust in one hemisphere; the other hemisphere keeps
  // its original scale, so global sea-level normalization cannot erase the edit.
  const revised = source.replace('return heights;', `
    for (let index = 0; index < Math.floor(heights.length / 2); index++) heights[index] *= 1.3;
    return heights;`);
  assert.notEqual(revised, source, 'Locate the validated crust returned by the copied vendor runtime.');
  const offset = app.output().length;
  await project.write(path, revised);
  await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, offset);
  const updated = await world();
  assert.equal(updated.worldKey, initial.worldKey);
  assert.deepEqual(updated.settings, initial.settings);
  assert.equal(updated.areaKm2, initial.areaKm2);
  assert.ok(updated.surface.data !== initial.surface.data, 'A vendor-only edit must regenerate the terrain, not retain a stale worker/cache.');
  assert.equal((await world()).surface.data, updated.surface.data, 'The regenerated world remains stable in the replacement cache.');
});
