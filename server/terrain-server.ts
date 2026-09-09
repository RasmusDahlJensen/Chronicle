import { createServer, type Server, type ServerResponse } from 'node:http';
import { createAsterIsland } from '../src/fixtures/aster-island.ts';
import type { TerrainWorld } from '../src/world/terrain.ts';

/** Create the local terrain host. The caller owns listening and shutdown. */
export function createTerrainServer(constructWorld: () => TerrainWorld = createAsterIsland): Server {
  return createServer((request, response) => {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const path = request.url?.split('?')[0];
    if (path === '/api/health') {
      sendJson(response, 200, { status: 'ok' });
    } else if (path === '/api/terrain') {
      try {
        sendJson(response, 200, { protocolVersion: 1, world: constructWorld() });
      } catch {
        sendJson(response, 500, { error: 'Unable to construct terrain' });
      }
    } else {
      sendJson(response, 404, { error: 'Not found' });
    }
  });
}

function sendJson(response: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}
