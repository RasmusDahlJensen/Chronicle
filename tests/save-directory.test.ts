import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.ts';
import { resolveSaveDirectory } from '../server/storage-path.ts';

test('save configuration rejects public/build paths, including symlinked ancestors, without creating them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-save-path-')); t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(resolveSaveDirectory(undefined, root), join(root, '.chronicle'));
  assert.equal(resolveSaveDirectory('my-saves', root), join(root, 'my-saves'));
  for (const unsafe of ['public', 'public/saves', 'public/..saves', 'dist', 'dist/saves']) assert.throws(() => resolveSaveDirectory(unsafe, root), /public|dist/);
  await assert.rejects(buildApp({ staticRoot: join(root, 'published'), simulationDirectory: join(root, 'published/saves') }), /outside.*static/);
  await mkdir(join(root, 'public'));
  await symlink(join(root, 'public'), join(root, 'alias'), 'junction');
  assert.throws(() => resolveSaveDirectory('alias/saves', root), /public|dist/);
});
