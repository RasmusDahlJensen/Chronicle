import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorldManifest } from '../shared/generated-world.ts';
import { createTestProject, startProject } from './helpers/project.ts';

test('editing nested climate code invalidates cached world generation through the same running proxy', async t => {
  const project = await createTestProject(t);
  const app = await startProject(project);
  const endpoint = `${app.origin}/api/world?seed=Reload&size=standard`;
  const initialResponse = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  assert.equal(initialResponse.status, 200);
  const initial = parseWorldManifest(await initialResponse.json());
  const path = 'src/world/generation/climate.ts';
  const source = await project.read(path);
  const revised = source.replace('return 31 - 62', 'return 21 - 62');
  assert.notEqual(revised, source, 'Locate the annual temperature baseline in the copied module.');
  const offset = app.output().length;
  await project.write(path, revised);
  await app.waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//, offset);
  const updatedResponse = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  assert.equal(updatedResponse.status, 200);
  const updated = parseWorldManifest(await updatedResponse.json());
  assert.equal(updated.worldKey, initial.worldKey);
  assert.deepEqual(updated.overview.fields.elevation, initial.overview.fields.elevation);
  for (let at = 0; at < updated.overview.fields.temperature.length; at++) {
    assert.equal(updated.overview.fields.temperature[at], initial.overview.fields.temperature[at] - 100);
  }
  assert.notDeepEqual(updated.biomeCounts, initial.biomeCounts);
});
