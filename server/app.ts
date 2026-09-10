import { CivilizationSnapshotSchema } from '../shared/civilization.ts';
import { randomUUID } from 'node:crypto';
import { assertSaveOutsideStatic } from './storage-path.ts';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Type } from 'typebox';
import { TerrainResponseSchema } from '../shared/terrain.ts';
import { AtlasResponseSchema } from '../shared/atlas.ts';
import { WorldSettingsSchema, WorldManifestSchema, WorldTileSchema, DEFAULT_WORLD_SETTINGS, WORLD_SIZES, WORLD_TILE_SIZE, type WorldSettings } from '../shared/generated-world.ts';
import type { TerrainStudy } from '../shared/studies.ts';
import type { ApiError } from '../shared/http.ts';
import { readBackendConfig, type BackendConfig } from './config.ts';
import { createTerrainCompute, ComputeClosedError, ComputeOverloadedError, ComputeTimeoutError, type TerrainCompute } from './compute.ts';
import { createGeneratedWorldStore } from './generated-world-store.ts';
import { SimulationOpenSchema, SimulationObserveSchema, SimulationCommandSchema, SimulationViewSchema,
  type SimulationOpen, type SimulationObserve, type SimulationCommand } from '../shared/simulation.ts';
import { createSimulationService } from './simulation.ts';
import { SimulationError } from './simulation-errors.ts';

interface AppOptions {
  config?: BackendConfig;
  compute?: TerrainCompute;
  staticRoot?: string;
  logger?: boolean;
  simulationDirectory?: string;
}

function failure(reply: FastifyReply, status: number, code: ApiError['error']['code'], message: string) {
  return reply.code(status).send({ error: { code, message, requestId: reply.request.id } });
}

/** Build and warm a host independently of its listener; closing it owns all compute. */
export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  if (options.staticRoot && options.simulationDirectory) assertSaveOutsideStatic(options.simulationDirectory, options.staticRoot);
  const config = options.config ?? readBackendConfig();
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
    requestTimeout: 10_000,
    connectionTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 100,
    forceCloseConnections: true,
    exposeHeadRoutes: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.server.headersTimeout = 10_000;
  const compute = options.compute ?? createTerrainCompute(config);
  const generatedWorlds = createGeneratedWorldStore(compute);
  const simulation = createSimulationService({ directory: options.simulationDirectory });
  const controllers = new Set<AbortController>();
  const admissionLimit = config.workers + config.maxQueue;
  let stopping = false;

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id).header('x-content-type-options', 'nosniff');
    const path = request.url.split('?')[0];
    if (path === '/api' || path.startsWith('/api/')) reply.header('cache-control', 'no-store');
    if (['/api/health', '/api/ready', '/api/terrain', '/api/atlas', '/api/world', '/api/world/tile', '/api/world/civilization'].includes(path) && request.method !== 'GET') {
      reply.header('allow', 'GET');
      return failure(reply, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    if (['/api/simulation/open', '/api/simulation/observe', '/api/simulation/release', '/api/simulation/command'].includes(path) && request.method !== 'POST') {
      reply.header('allow', 'POST');
      return failure(reply, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
  });
  app.setNotFoundHandler((_request, reply) => failure(reply, 404, 'NOT_FOUND', 'Not found.'));
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof SimulationError) {
      if (error.statusCode === 503) reply.header('retry-after', '1');
      return failure(reply, error.statusCode, error.code, error.message);
    }
    if (error.validation || error.statusCode === 400) return failure(reply, 400, 'INVALID_REQUEST', 'Invalid request.');
    if (error.statusCode === 413) return failure(reply, 413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    if (error.statusCode === 415) return failure(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type.');
    if (error instanceof ComputeOverloadedError || error instanceof ComputeClosedError) {
      reply.header('retry-after', '1');
      return failure(reply, 503, error instanceof ComputeClosedError ? 'UNAVAILABLE' : 'OVERLOADED', error.message);
    }
    if (error instanceof ComputeTimeoutError) {
      reply.header('retry-after', '1');
      return failure(reply, 504, 'COMPUTE_TIMEOUT', error.message);
    }
    request.log.error({ err: error }, 'Request failed');
    return failure(reply, 500, 'INTERNAL_ERROR', 'Unable to construct terrain. Try again.');
  });

  const querystring = Type.Object({}, { additionalProperties: false });
  app.post<{ Body: SimulationOpen }>('/api/simulation/open', {
    schema: { querystring, body: SimulationOpenSchema, response: { 200: SimulationViewSchema } },
  }, (request, reply) => sendComputed(request, reply, async signal => {
    const existing = await simulation.open(request.body);
    if (existing) return JSON.stringify(existing);
    const bundle = await generatedWorlds.get(request.body.settings, signal);
    signal.throwIfAborted();
    return JSON.stringify(await simulation.initialize(request.body, bundle));
  }));
  app.post<{ Body: SimulationObserve }>('/api/simulation/observe', {
    schema: { querystring, body: SimulationObserveSchema, response: { 200: SimulationViewSchema } },
  }, request => simulation.observe(request.body));
  app.post<{ Body: SimulationObserve }>('/api/simulation/release', {
    schema: { querystring, body: SimulationObserveSchema,
      response: { 200: Type.Object({ released: Type.Literal(true) }, { additionalProperties: false }) } },
  }, request => simulation.release(request.body));
  app.post<{ Body: SimulationCommand }>('/api/simulation/command', {
    schema: { querystring, body: SimulationCommandSchema, response: { 200: SimulationViewSchema } },
  }, request => simulation.command(request.body));
  app.get('/api/health', { schema: { querystring } }, async () => ({ status: 'ok' }));
  app.get('/api/ready', { schema: { querystring } }, async (_request, reply) => {
    const snapshot = compute.snapshot();
    const ready = !stopping && snapshot.workers > 0 && controllers.size < admissionLimit;
    if (!ready) reply.code(503).header('retry-after', '1');
    return {
      status: ready ? 'ready' : 'busy', compute: snapshot,
      simulation: simulation.snapshot(),
      admitted: controllers.size,
      limits: { workers: config.workers, queued: config.maxQueue, admitted: admissionLimit, jobTimeoutMs: config.jobTimeoutMs },
    };
  });
  app.get('/api/terrain', { schema: { querystring, response: { 200: TerrainResponseSchema } } },
    (request, reply) => sendStudy(request, reply, 'aster'));
  app.get('/api/atlas', { schema: { querystring, response: { 200: AtlasResponseSchema } } },
    (request, reply) => sendStudy(request, reply, 'verdant'));

  const worldQuery = {
    seed: Type.Optional(WorldSettingsSchema.properties.seed), size: Type.Optional(WorldSettingsSchema.properties.size),
  };
  app.get<{ Querystring: Partial<WorldSettings> }>('/api/world', {
    schema: { querystring: Type.Object(worldQuery, { additionalProperties: false }), response: { 200: WorldManifestSchema } },
  }, (request, reply) => sendComputed(request, reply, async signal => {
    const settings = { ...DEFAULT_WORLD_SETTINGS, ...request.query };
    return (await generatedWorlds.get(settings, signal)).manifest;
  }));
  app.get<{ Querystring: Partial<WorldSettings> }>('/api/world/civilization', {
    schema: { querystring: Type.Object(worldQuery, { additionalProperties: false }), response: { 200: CivilizationSnapshotSchema } },
  }, (request, reply) => sendComputed(request, reply, async signal => {
    const settings = { ...DEFAULT_WORLD_SETTINGS, ...request.query };
    return (await generatedWorlds.get(settings, signal)).civilization;
  }));
  app.get<{ Querystring: Partial<WorldSettings> & { x: string; y: string } }>('/api/world/tile', {
    schema: { querystring: Type.Object({ ...worldQuery,
      x: Type.String({ pattern: '^[0-7]$' }), y: Type.String({ pattern: '^[0-3]$' }),
    }, { additionalProperties: false }), response: { 200: WorldTileSchema } },
  }, (request, reply) => {
    const { x, y, ...overrides } = request.query;
    const settings = { ...DEFAULT_WORLD_SETTINGS, ...overrides };
    const shape = WORLD_SIZES[settings.size];
    if (Number(x) >= shape.width / WORLD_TILE_SIZE || Number(y) >= shape.height / WORLD_TILE_SIZE) {
      return failure(reply, 400, 'INVALID_REQUEST', 'Tile coordinates are outside this world.');
    }
    return sendComputed(request, reply, async signal => {
      const bundle = await generatedWorlds.get(settings, signal);
      return bundle.tiles[Number(y) * shape.width / WORLD_TILE_SIZE + Number(x)];
    });
  });

  async function sendStudy(request: FastifyRequest, reply: FastifyReply, study: TerrainStudy) {
    return sendComputed(request, reply, signal => compute.generate(signal, study));
  }

  async function sendComputed(request: FastifyRequest, reply: FastifyReply, load: (signal: AbortSignal) => Promise<string>) {
    if (stopping) throw new ComputeClosedError();
    if (controllers.size >= admissionLimit) throw new ComputeOverloadedError();
    const controller = new AbortController();
    controllers.add(controller);
    const release = () => {
      controllers.delete(controller);
      request.raw.off('aborted', cancel);
      reply.raw.off('finish', release);
      reply.raw.off('close', onClose);
    };
    const cancel = () => controller.abort(new Error('Terrain request disconnected.'));
    const onClose = () => {
      if (!reply.raw.writableFinished) cancel();
      release();
    };
    request.raw.once('aborted', cancel);
    reply.raw.once('finish', release);
    reply.raw.once('close', onClose);
    try {
      const body = await load(controller.signal);
      // This is validated and encoded in the worker, avoiding a large stringify here.
      return reply.type('application/json; charset=utf-8').send(body);
    } catch (error) {
      if (controller.signal.aborted) {
        reply.hijack();
        reply.raw.destroy();
        return reply;
      }
      throw error;
    }
  }

  app.addHook('preClose', async () => {
    stopping = true;
    generatedWorlds.close();
    // Disposable geography can cancel; the simulation service separately drains accepted commands.
    for (const controller of controllers) controller.abort(new ComputeClosedError());
  });
  app.addHook('onClose', async () => { await Promise.all([compute.close(), simulation.close()]); });
  try {
    if (options.staticRoot) await app.register(fastifyStatic, {
      root: options.staticRoot, index: ['index.html'], maxAge: 0,
    });
    await compute.ready();
    // A damaged save must not make the underlying geography unavailable.
    await simulation.ready().catch(error => app.log.error({ err: error }, 'Tribal simulation unavailable'));
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
