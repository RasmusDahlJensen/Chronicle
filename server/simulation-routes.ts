import type { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from 'typebox';
import { DEFAULT_WORLD_SETTINGS, WorldSettingsSchema, type WorldSettings } from '../shared/generated-world.ts';
import type { ApiError } from '../shared/http.ts';
import { ObserverFrameSchema, RegionMapSchema, SimulationControlSchema, type SimulationControl } from '../shared/simulation.ts';
import type { SimulationHost, SimulationWorker } from './simulation-host.ts';

/**
 * Observer routes for the simulation (VISION.md "Observer views"). They have their own admission limit, separate
 * from map responses, so polling observers cannot starve geography delivery or the other way round.
 */
export function registerSimulationRoutes(app: FastifyInstance, host: SimulationHost, admissionLimit: number) {
  let admitted = 0;
  const failure = (reply: FastifyReply, status: number, code: ApiError['error']['code'], message: string) =>
    reply.code(status).header('retry-after', '1').send({ error: { code, message, requestId: reply.request.id } });
  const worldQuery = { seed: Type.Optional(WorldSettingsSchema.properties.seed), size: Type.Optional(WorldSettingsSchema.properties.size) };
  const cursor = Type.Optional(Type.String({ pattern: '^\\d{1,9}$' }));

  async function withSimulation<T>(reply: FastifyReply, query: Partial<WorldSettings>, use: (simulation: SimulationWorker) => Promise<T>) {
    if (admitted >= admissionLimit) return failure(reply, 503, 'OVERLOADED', 'The simulation is busy. Try again shortly.');
    admitted++;
    try {
      return await use(await host.attach({ ...DEFAULT_WORLD_SETTINGS, ...query }));
    } finally {
      admitted--;
    }
  }

  app.get<{ Querystring: Partial<WorldSettings> & { cursor?: string } }>('/api/simulation/frame', {
    schema: { querystring: Type.Object({ ...worldQuery, cursor }, { additionalProperties: false }), response: { 200: ObserverFrameSchema } },
  }, (request, reply) => {
    const { cursor: from, ...world } = request.query;
    return withSimulation(reply, world, simulation => simulation.frame(Number(from ?? 0)));
  });
  app.get<{ Querystring: Partial<WorldSettings> }>('/api/simulation/regions', {
    schema: { querystring: Type.Object(worldQuery, { additionalProperties: false }), response: { 200: RegionMapSchema } },
  }, (request, reply) => withSimulation(reply, request.query, simulation => simulation.regions()));
  // The reply is a frame with the events from `cursor` on, so events emitted by the control itself are not skipped.
  app.post<{ Querystring: Partial<WorldSettings> & { cursor?: string }; Body: SimulationControl }>('/api/simulation/control', {
    schema: {
      querystring: Type.Object({ ...worldQuery, cursor }, { additionalProperties: false }), body: SimulationControlSchema,
      response: { 200: ObserverFrameSchema },
    },
  }, (request, reply) => {
    const { cursor: from, ...world } = request.query;
    return withSimulation(reply, world, simulation => simulation.control(request.body, from === undefined ? Number.MAX_SAFE_INTEGER : Number(from)));
  });
  return { snapshot: () => ({ ...host.snapshot(), admitted, admissionLimit }) };
}
