import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const biome = fileURLToPath(new URL('../node_modules/@biomejs/biome/bin/biome', import.meta.url));

test('architecture checks inspect TypeScript/TSX and reject broken boundaries, including types and dynamic imports', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-architecture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(new URL('../biome.json', import.meta.url), join(root, 'biome.json'));
  async function source(path: string, content: string) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await source('package.json', JSON.stringify({ type: 'module', dependencies: { react: '19.2.8' }, devDependencies: { vite: '8.2.2', 'development-only-tool': '1.0.0' } }));
  await source('shared/contract.ts', 'export type World = { id: string };');
  await source('src/world/state.ts', "export type { World } from '../../shared/contract.ts';");
  await source('src/fixtures/island.ts', 'export const island = {};');
  await source('src/world/generation/generate.ts', 'export const generate = () => ({});');
  await source('vendor/platec/generated.mjs', 'export default async function create() { return {}; }');
  await source('vendor/platec/platec.mjs', 'export class PlatecModule {}');
  const vendorRuntime = "import type { PlatecModule } from './platec.mjs'; export type Module = PlatecModule;";
  await source('vendor/platec/runtime.ts', vendorRuntime);
  await source('src/world/generation/tectonics.ts', "export { default as create } from '../../../vendor/platec/generated.mjs';");
  await source('src/components/view.tsx', "import type { World } from '../world/state.ts'; export type Widget = World; export const view = <main />;");
  await source('src/api/terrain.ts', 'export const load = () => {};');
  await source('server/workers/terrain.ts', "export { island } from '../../src/fixtures/island.ts';");
  await source('server/app.ts', 'export const app = {};');
  await source('scripts/start.ts', "import '../server/app.ts'; export const dev = import('vite');");
  await source('scripts/build-platec.ts', "export const module = import('../vendor/platec/generated.mjs'); export const tool = import('development-only-tool');");
  function check() {
    const result = spawnSync(process.execPath, [biome, 'lint', 'src', 'shared', 'server', 'scripts', 'vendor/platec/runtime.ts', '--max-diagnostics=100'], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: (result.stdout + result.stderr).replaceAll('\\', '/') };
  }
  const valid = check();
  assert.equal(valid.status, 0, valid.output);
  for (const [content, diagnostic] of [
    ["export const fs = import('node:fs');", /noNodejsModules/],
    ["export type { Widget } from '../../src/components/view.tsx';", /noRestrictedImports/],
    ["export type { World } from '../../shared/contract.ts';", /noRestrictedImports/],
    ["export const app = import('../../server/app.ts');", /noRestrictedImports/],
    ["export const renderer = import('../../src/renderer/map.ts');", /noRestrictedImports/],
    ["export const core = import('../../src/world/generation/generate.ts');", /noRestrictedImports/],
    ["export const framework = import('react');", /noRestrictedImports/],
  ] as const) {
    await source('vendor/platec/runtime.ts', content);
    const rejected = check();
    assert.equal(rejected.status, 1, `The authored vendor helper must be linted: ${content}\n${rejected.output}`);
    assert.match(rejected.output, /vendor\/platec\/runtime\.ts/);
    assert.match(rejected.output, diagnostic);
  }
  await source('vendor/platec/runtime.ts', vendorRuntime);
  assert.match(valid.output, /Checked 12 files/);

  await source('src/world/leak.ts', "import type { Widget } from '../components/view.tsx'; export type Leak = Widget;");
  await source('src/world/node.ts', "export const fs = import('node:fs');");
  await source('src/world/generation/node.ts', "export const fs = import('node:fs');");
  await source('src/world/generation/view.ts', "import type { Widget } from '../../components/view.tsx'; export type Leak = Widget;");
  await source('src/world/vite.ts', "import { createServer } from 'vite'; export { createServer };");
  await source('shared/vite.ts', "export { createServer } from 'vite';");
  await source('server/workers/vite.ts', "export const dev = import('vite');");
  await source('server/development.ts', "import 'development-only-tool';");
  await source('src/components/leak.tsx', "import '../../server/app.ts'; export const leak = <div />;");
  await source('src/components/generation.ts', "import '../fixtures/island.ts';");
  await source('src/renderer/map.ts', "import type { ReactNode } from 'react'; export type View = ReactNode;");
  await source('src/renderer/network.ts', "import '../api/terrain.ts';");
  await source('src/components/world-generator.ts', "import '../world/generation/generate.ts';");
  await source('src/renderer/world-generator.ts', "import '../world/generation/generate.ts';");
  await source('server/world-generator.ts', "import '../src/world/generation/generate.ts';");
  await source('src/simulation/browser.ts', "export const view = import('../components/view.tsx');");
  await source('src/simulation/storage.ts', "export const storage = import('node:sqlite');");
  await source('src/simulation/generation.ts', "export const generate = import('../world/generation/generate.ts');");
  await source('server/workers/simulation-worker.ts', "export const generate = import('../../src/world/generation/generate.ts');");
  await source('server/workers/terrain-generation.ts', "export const generate = import('../../src/world/generation/generate.ts');");
  await source('src/components/simulation.ts', "export const state = import('../simulation/state.ts');");

  await source('server/app.ts', "export { island } from '../src/fixtures/island.ts';");
  await source('server/workers/terrain.ts', "import '../app.ts';");
  await source('shared/leak.ts', "import '../src/world/state.ts';");
  await source('shared/a.ts', "import type { B } from './b.ts'; export type A = { b: B };");
  await source('shared/b.ts', "import type { A } from './a.ts'; export type B = { a: A };");
  const vendorLeaks = [
    ['src/components/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['src/renderer/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['src/world/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['src/fixtures/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['src/simulation/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['shared/vendor.ts', '../vendor/platec/generated.mjs'],
    ['server/vendor.ts', '../vendor/platec/generated.mjs'],
    ['server/workers/vendor.ts', '../../vendor/platec/generated.mjs'],
    ['scripts/vendor.ts', '../vendor/platec/generated.mjs'],
  ];
  for (const [path, target] of vendorLeaks) await source(path, `export const module = import('${target}');`);
  const invalid = check();
  assert.equal(invalid.status, 1, invalid.output);
  for (const path of ['src/simulation/browser.ts', 'src/simulation/storage.ts', 'src/simulation/generation.ts', 'server/workers/simulation-worker.ts', 'src/components/simulation.ts', 'src/world/leak.ts', 'src/world/node.ts', 'src/world/vite.ts', 'shared/vite.ts', 'server/workers/vite.ts', 'server/development.ts', 'src/components/leak.tsx', 'src/components/generation.ts', 'src/components/world-generator.ts', 'src/renderer/world-generator.ts', 'server/world-generator.ts', 'src/renderer/map.ts', 'src/renderer/network.ts', 'server/app.ts', 'server/workers/terrain.ts', 'shared/leak.ts']) {
    assert.ok(invalid.output.includes(path), `Missing boundary diagnostic for ${path}: ${invalid.output}`);
  }
  for (const [path] of vendorLeaks) assert.ok(invalid.output.includes(path), `Missing vendor boundary diagnostic for ${path}: ${invalid.output}`);
  assert.ok(!invalid.output.includes('server/workers/terrain-generation.ts'), 'Other workers may still generate geography');
  for (const path of ['src/world/generation/node.ts', 'src/world/generation/view.ts']) {
    assert.ok(invalid.output.includes(path), `Generation's vendor permission must preserve its other boundaries: ${path}: ${invalid.output}`);
  }
  assert.match(invalid.output, /noRestrictedImports/);
  assert.match(invalid.output, /noNodejsModules/);
  assert.match(invalid.output, /noImportCycles/);
  assert.match(invalid.output, /noUndeclaredDependencies/);
});
