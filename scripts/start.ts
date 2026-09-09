import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer, preview, type PreviewServer, type ViteDevServer } from 'vite';
import { createTerrainServer } from '../server/terrain-server.ts';

async function main() {
  const { values } = parseArgs({
    options: {
      preview: { type: 'boolean', default: false },
      port: { type: 'string' },
    },
  });
  const portText = values.port ?? (values.preview ? '4173' : '5173');
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be an integer from 1 to 65535.');
  }

  const backend = createTerrainServer();
  let frontend: ViteDevServer | PreviewServer | undefined;
  let stopping = false;
  let shutdown: Promise<void> | undefined;

  async function close() {
    await Promise.all([
      frontend?.close(),
      new Promise<void>((resolve, reject) => {
        if (!backend.listening) return resolve();
        backend.close(error => error ? reject(error) : resolve());
        // The stateless fixture host has no pending mutations to drain on exit.
        backend.closeAllConnections();
      }),
    ]);
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  }

  function handleSignal() {
    stopping = true;
    shutdown ??= startup.catch(() => {}).then(close);
    void shutdown.catch(reportFailure);
  }

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  const startup = (async () => {
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    if (!address || typeof address === 'string') throw new Error('The terrain host did not open a TCP port.');
    const backendUrl = `http://127.0.0.1:${address.port}`;
    console.log(`Terrain host ready at ${backendUrl}/`);
    if (stopping) return;

    const options = {
      host: '127.0.0.1', port, strictPort: true,
      proxy: { '/api': { target: backendUrl } },
    };
    if (values.preview) {
      frontend = await preview({ preview: options });
      try {
        await access(resolve(frontend.config.root, frontend.config.build.outDir, 'index.html'));
      } catch {
        throw new Error('Production build is missing. Run npm run build before npm run preview.');
      }
    } else {
      const development = await createServer({ server: options });
      frontend = development;
      if (stopping) return;
      await development.listen();
    }
    if (!stopping) console.log(`Chronicle ready at http://127.0.0.1:${port}/`);
  })();

  try {
    await startup;
  } catch (error) {
    await close();
    throw error;
  }
}

function reportFailure(error: unknown) {
  console.error(`Chronicle could not run: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}

await main().catch(reportFailure);
