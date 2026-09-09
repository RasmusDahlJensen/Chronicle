import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { ViteDevServer } from 'vite';
import { buildApp } from '../server/app.ts';

async function main() {
  const { values } = parseArgs({
    options: {
      preview: { type: 'boolean', default: false },
      serve: { type: 'boolean', default: false },
      port: { type: 'string' },
    },
  });
  const standalone = values.preview || values.serve;
  const portText = values.port ?? (standalone ? '4173' : '5173');
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer from 1 to 65535.');
  }

  const staticRoot = standalone ? resolve('dist') : undefined;
  if (staticRoot) {
    try {
      await access(resolve(staticRoot, 'index.html'));
    } catch {
      throw new Error('Production build is missing. Run npm run build before npm run preview or npm run serve.');
    }
  }

  let backend: FastifyInstance | undefined;
  let frontend: ViteDevServer | undefined;
  let stopping = false;
  let startupComplete = false;
  let shutdown: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function close() {
    closing ??= (async () => {
      try {
        await Promise.all([frontend?.close(), backend?.close()]);
      } finally {
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
      }
    })();
    return closing;
  }

  function handleSignal() {
    stopping = true;
    // Start closing Vite synchronously so it releases its own exit handler first.
    shutdown ??= startupComplete ? close() : startup.catch(() => {}).then(close);
    void shutdown.catch(reportFailure);
  }

  // Remain registered while cleanup runs; signal-exit checks for live handlers.
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  const startup = (async () => {
    backend = await buildApp({ staticRoot });
    if (stopping) return;
    const backendUrl = await backend.listen({ host: '127.0.0.1', port: standalone ? port : 0 });
    console.log(`Terrain host ready at ${backendUrl}/`);
    if (stopping) return;

    if (!standalone) {
      const { createServer } = await import('vite');
      if (stopping) return;
      frontend = await createServer({
        server: {
          host: '127.0.0.1', port, strictPort: true,
          proxy: { '/api': { target: backendUrl } },
        },
      });
      if (stopping) return;
      await frontend.listen();
    }
    if (!stopping) console.log(`Chronicle ready at http://127.0.0.1:${port}/`);
  })();

  try {
    await startup;
    startupComplete = true;
  } catch (error) {
    await close();
    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already in use.`);
    }
    throw error;
  }
}

function reportFailure(error: unknown) {
  console.error(`Chronicle could not run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}

await main().catch(reportFailure);
