import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface TestProject {
  root: string;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  dispose(): Promise<void>;
  registerCleanup(cleanup: () => Promise<void>): void;
}

/** Copy application source, linking only installed dependencies. Edits never reach the live repo. */
export async function createTestProject(t?: Pick<TestContext, 'after'>): Promise<TestProject> {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-project-'));
  const cleanups: (() => Promise<void>)[] = [];
  let disposed = false;
  const project: TestProject = {
    root,
    read: path => readFile(projectPath(path), 'utf8'),
    async write(path, contents) {
      const target = projectPath(path);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, contents);
      await rename(temporary, target);
    },
    remove: path => rm(projectPath(path)),
    registerCleanup: cleanup => { cleanups.push(cleanup); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const results = await Promise.allSettled(cleanups.reverse().map(cleanup => cleanup()));
      await rm(root, { recursive: true, force: true });
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
  function projectPath(path: string) {
    const target = resolve(root, path);
    const child = relative(root, target);
    assert.ok(!isAbsolute(path) && child && !child.startsWith(`..${sep}`) && child !== '..', 'Use a copied project path.');
    assert.ok(child !== 'node_modules' && !child.startsWith(`node_modules${sep}`), 'Installed dependencies are shared and must not be edited.');
    return target;
  }
  t?.after(() => project.dispose());
  try {
    for (const path of ['scripts', 'server', 'shared', 'src', 'vendor', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'biome.json']) {
      await cp(join(repositoryRoot, path), join(root, path), { recursive: true });
    }
    for (const path of ['nodemon.json', '.nvmrc']) {
      await cp(join(repositoryRoot, path), join(root, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const config = await project.read('vite.config.ts');
    assert.ok(config.includes('defineConfig({'), 'Update the temporary Vite cache override for the current config.');
    await project.write('vite.config.ts', config.replace('defineConfig({', "defineConfig({ cacheDir: '.vite-test',"));
    return project;
  } catch (error) {
    await project.dispose();
    throw error;
  }
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export interface RunningProject {
  origin: string;
  output(): string;
  waitForOutput(pattern: RegExp, after?: number): Promise<void>;
  /** POSIX sends the requested signal; Windows forcibly terminates this owned process tree. */
  stop(signal?: 'SIGINT' | 'SIGTERM'): Promise<void>;
}

/** Exercise the documented npm start command in its own process group and random local port. */
export async function startProject(project: TestProject, options: { args?: string[]; env?: NodeJS.ProcessEnv } = {}): Promise<RunningProject> {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start', '--', '--port', String(port), ...(options.args ?? [])], {
    cwd: project.root, detached: process.platform !== 'win32', shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', CHRONICLE_WORKERS: '1', CHRONICLE_QUEUE_LIMIT: '1', CHRONICLE_JOB_TIMEOUT_MS: '20000', CHRONICLE_LOG_LEVEL: 'error', ...options.env },
  });
  let output = '';
  let spawnError: Error | undefined;
  let stopping: Promise<void> | undefined;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('error', error => { spawnError = error; });
  const exited = () => child.exitCode !== null || child.signalCode !== null || !!spawnError;
  async function signalGroup(signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL') {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      if (exited()) return;
      // npm.cmd has an outer shell. Terminate its owned descendants while the
      // parent PID still exists; killing only cmd.exe would orphan the watcher.
      await new Promise<void>((resolve, reject) => {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 }, error => {
          if (error && !exited()) reject(error);
          else resolve();
        });
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  async function waitForOutput(pattern: RegExp, after = 0) {
    const deadline = Date.now() + 15_000;
    while (!new RegExp(pattern.source, pattern.flags).test(output.slice(after))) {
      assert.ok(!exited(), `npm start exited before expected output:\n${output}`);
      assert.ok(Date.now() < deadline, `Expected ${pattern} after output offset ${after}:\n${output}`);
      await delay(25);
    }
  }
  const running: RunningProject = {
    origin, output: () => output, waitForOutput,
    stop(signal = 'SIGTERM') {
      stopping ??= (async () => {
        const method = process.platform === 'win32' ? 'forced Windows process-tree cleanup' : signal;
        const deadline = Date.now() + 10_000;
        try {
          await signalGroup(signal);
          while (!exited()) {
            assert.ok(Date.now() < deadline, `npm start did not stop with ${method}:\n${output}`);
            await delay(25);
          }
          const urls = new Set([...output.matchAll(/(?:Chronicle|Terrain host) ready at (http:\/\/127\.0\.0\.1:\d+)/g)].map(match => match[1]));
          for (const url of urls) {
            while (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false)) {
              assert.ok(Date.now() < deadline, `Listener survived ${method} at ${url}:\n${output}`);
              await delay(25);
            }
          }
        } catch (error) {
          await signalGroup('SIGKILL');
          throw error;
        }
      })();
      return stopping;
    },
  };
  project.registerCleanup(() => running.stop());
  try {
    await waitForOutput(/Chronicle ready at http:\/\/127\.0\.0\.1:\d+\//);
    const ready = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(ready.status, 200, output);
    assert.equal((await ready.json()).status, 'ready');
    return running;
  } catch (error) {
    await running.stop();
    throw error;
  }
}
