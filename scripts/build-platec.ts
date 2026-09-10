import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(root, 'vendor/platec');
const compilerVersion = '6.0.5';
const upstream = { repository: 'https://github.com/Mindwerks/plate-tectonics', commit: '2a27c4fb137c657517bca62122b9de80e6b8c255' };
const flags = [
  '-std=c++20', '-O3', '-DNDEBUG', '-fwasm-exceptions', '-Isrc',
  '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sSINGLE_FILE=1', '-sENVIRONMENT=web,worker',
  '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=16777216',
  '-sMAXIMUM_MEMORY=134217728', '-sSTACK_SIZE=1048576',
  '-sEXPORTED_FUNCTIONS=_chronicle_platec_create,_chronicle_platec_destroy,_chronicle_platec_heightmap,_chronicle_platec_finished,_chronicle_platec_step',
  '-sEXPORTED_RUNTIME_METHODS=HEAPF32',
];
const sourceDirectory = join(vendor, 'src');
const sourceNames = (await readdir(sourceDirectory, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => relative(sourceDirectory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort();
const compiledSources = sourceNames.filter(name => name.endsWith('.cpp')).map(name => `src/${name}`);
const inputNames = [...sourceNames.map(name => `vendor/platec/src/${name}`), 'vendor/platec/chronicle_platec_wasm.cpp', 'scripts/build-platec.ts'].sort();

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
async function inputHashes() {
  return Object.fromEntries(await Promise.all(inputNames.map(async path => [path, await sha256(join(root, path))])));
}

if (process.argv.slice(2).some(argument => argument !== '--check') || process.argv.length > 3) {
  throw new Error('Usage: node scripts/build-platec.ts [--check]');
}

if (process.argv.includes('--check')) {
  const manifest = JSON.parse(await readFile(join(vendor, 'manifest.json'), 'utf8'));
  if (JSON.stringify(manifest.upstream) !== JSON.stringify(upstream) ||
    manifest.compiler.version !== compilerVersion || JSON.stringify(manifest.compiler.flags) !== JSON.stringify(flags) ||
    JSON.stringify(manifest.sources) !== JSON.stringify(await inputHashes())) {
    throw new Error('Platec source or compiler configuration changed; rebuild the vendored artifact');
  }
  for (const name of ['platec.mjs', 'platec.d.mts']) {
    if (manifest.artifacts[name] !== await sha256(join(vendor, name))) {
      throw new Error(`Platec artifact checksum mismatch: ${name}`);
    }
  }
  console.log('Platec source, compiler configuration and artifact checksums match.');
} else {
  // Rebuilding is an explicit maintainer action. Everyday startup uses committed JS/WASM.
  const compiler = process.env.CHRONICLE_EMXX || 'em++';
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (version.error) throw new Error('Install Emscripten 6.0.5 and set CHRONICLE_EMXX to its em++ executable', { cause: version.error });
  if (version.status !== 0 || !/^emcc .*\b6\.0\.5(?:\s|$)/m.test(version.stdout)) {
    throw new Error(`Platec rebuild requires Emscripten ${compilerVersion}; received ${version.stdout || version.stderr}`);
  }
  const temporary = await mkdtemp(join(vendor, '.build-'));
  try {
    const output = join(temporary, 'platec.mjs');
    const build = spawnSync(compiler, [...flags, ...compiledSources, 'chronicle_platec_wasm.cpp', '-o', output], {
      cwd: vendor, stdio: 'inherit', timeout: 120000,
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error(`Platec compiler failed with exit status ${build.status}`);
    const manifest = {
      upstream,
      compiler: { version: compilerVersion, flags },
      sources: await inputHashes(),
      artifacts: { 'platec.mjs': await sha256(output), 'platec.d.mts': await sha256(join(vendor, 'platec.d.mts')) },
    };
    await rename(output, join(vendor, 'platec.mjs'));
    await writeFile(join(vendor, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Rebuilt ${relative(root, join(vendor, 'platec.mjs'))} with Emscripten ${compilerVersion}.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
