import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const launcherPath = fileURLToPath(new URL('../scripts/start.ts', import.meta.url));

async function reservePort(t?: TestContext) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  if (t) t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  else await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

async function launch(t: TestContext, args: string[], options: { includeBuild?: boolean; forbidVite?: boolean } = {}) {
  // Small real frontend files keep launcher checks independent of build ordering.
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-launcher-'));
  await writeFile(join(directory, 'index.html'), '<main>Launcher fixture</main>');
  if (options.includeBuild !== false) {
    await mkdir(join(directory, 'dist'));
    await writeFile(join(directory, 'dist/index.html'), '<main>Preview fixture</main>');
  }
  const runtimeArgs: string[] = [];
  if (options.forbidVite) {
    const importGuard = join(directory, 'reject-vite.mjs');
    await writeFile(importGuard, `
      import { registerHooks } from 'node:module';
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'vite' || specifier.startsWith('vite/')) {
            throw new Error('The built server must run without importing Vite');
          }
          return nextResolve(specifier, context);
        },
      });
    `);
    runtimeArgs.push('--import', importGuard);
  }
  const child = spawn(process.execPath, [...runtimeArgs, launcherPath, ...args], {
    cwd: directory,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 15_000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, `Launcher timed out:\n${output}`);
      assert.ok(child.exitCode === null && child.signalCode === null, `Launcher exited early:\n${output}`);
      await setTimeout(20);
    }
  }
  async function ready() {
    await waitFor(() => /Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//.test(output));
    const origin = output.match(/Chronicle ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    const backend = output.match(/Terrain host ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert.ok(origin && backend, output);
    return { origin, backend };
  }
  async function waitUntilExited() {
    const deadline = Date.now() + 15_000;
    while (child.exitCode === null && child.signalCode === null) {
      assert.ok(Date.now() < deadline, `Launcher did not exit:\n${output}`);
      await setTimeout(20);
    }
  }
  return { child, ready, waitUntilExited, output: () => output };
}

for (const [mode, signal] of [['development', 'SIGINT'], ['development', 'SIGTERM'], ['preview', 'SIGTERM'], ['serve', 'SIGINT']] as const) {
  test(`${mode} launcher serves frontend and terrain, then closes on ${signal}`, async t => {
    const standalone = mode !== 'development';
    const port = await reservePort();
    const app = await launch(t, [...(standalone ? [`--${mode}`] : []), '--port', String(port)], { forbidVite: standalone });
    const { origin, backend } = await app.ready();
    assert.equal(origin, `http://127.0.0.1:${port}`);
    if (standalone) assert.equal(origin, backend, 'the built frontend must be served by the backend itself');
    else assert.notEqual(origin, backend);
    const html = await (await fetch(origin)).text();
    assert.match(html, standalone ? /Preview fixture/ : /Launcher fixture/);
    const health = await fetch(`${origin}/api/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });
    const terrain = await fetch(`${origin}/api/terrain`);
    assert.equal(terrain.headers.get('cache-control'), 'no-store');
    assert.equal((await terrain.json()).world.cells.length, 27_648);
    app.child.kill(signal);
    await app.waitUntilExited();
    assert.equal(app.child.exitCode, 0, app.output());
    await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1_000) }));
    await assert.rejects(fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(1_000) }));
  });
}

test('concurrent app launches use separate terrain hosts and stopping one leaves the other available', async t => {
  const first = await launch(t, ['--port', String(await reservePort())]);
  const firstUrls = await first.ready();
  const second = await launch(t, ['--preview', '--port', String(await reservePort())]);
  const secondUrls = await second.ready();
  assert.notEqual(firstUrls.backend, secondUrls.backend);
  first.child.kill('SIGTERM');
  await first.waitUntilExited();
  const response = await fetch(`${secondUrls.origin}/api/health`);
  assert.deepEqual(await response.json(), { status: 'ok' });
  second.child.kill('SIGTERM');
  await second.waitUntilExited();
});

for (const standalone of [false, true]) {
  test(`${standalone ? 'standalone' : 'development'} Ctrl+C closes an unfinished backend request without waiting for the client to disconnect`, async t => {
    const app = await launch(t, [...(standalone ? ['--serve'] : []), '--port', String(await reservePort())]);
    const { backend } = await app.ready();
    const socket = connect(Number(new URL(backend).port), '127.0.0.1');
    t.after(() => socket.destroy());
    await once(socket, 'connect');
    const disconnected = once(socket, 'close').catch((error: NodeJS.ErrnoException) => {
      // Closing an unfinished HTTP request may reset the TCP socket.
      assert.equal(error.code, 'ECONNRESET');
    });
    await new Promise<void>((resolve, reject) => {
      socket.write('GET /api/terrain HTTP/1.1\r\nHost: localhost\r\n', error => error ? reject(error) : resolve());
    });
    app.child.kill('SIGINT');
    await app.waitUntilExited();
    await disconnected;
    assert.equal(app.child.exitCode, 0, app.output());
  });
}

for (const mode of ['development', 'preview', 'serve']) {
  test(`${mode} startup fails on an occupied app port and releases its resources`, async t => {
    const standalone = mode !== 'development';
    const port = await reservePort(t);
    const app = await launch(t, [...(standalone ? [`--${mode}`] : []), '--port', String(port)]);
    await app.waitUntilExited();
    assert.notEqual(app.child.exitCode, 0, app.output());
    assert.match(app.output(), /port.*in use/i);
    const backend = app.output().match(/Terrain host ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (standalone) assert.equal(backend, undefined, 'a failed listener cannot report readiness');
    else {
      assert.ok(backend, app.output());
      await assert.rejects(fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(1_000) }));
    }
  });
}

test('launcher rejects non-integer and out-of-range app ports before opening a host', async t => {
  for (const port of ['0', '65536', '1.5', '5173garbage']) {
    const app = await launch(t, ['--port', port]);
    await app.waitUntilExited();
    assert.notEqual(app.child.exitCode, 0);
    assert.match(app.output(), /port.*integer.*1.*65535/i);
    assert.doesNotMatch(app.output(), /Terrain host ready/);
  }
});

for (const mode of ['preview', 'serve']) {
  test(`${mode} without a production build fails with launch instructions before opening a host`, async t => {
    const port = await reservePort();
    const app = await launch(t, [`--${mode}`, '--port', String(port)], { includeBuild: false });
    await app.waitUntilExited();
    assert.notEqual(app.child.exitCode, 0);
    assert.match(app.output(), /npm run build/);
    assert.doesNotMatch(app.output(), /Terrain host ready/);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) }));
  });
}
